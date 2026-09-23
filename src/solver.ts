import type { Model, Observation } from './types';

/**
 * 差分约束求解。
 * 变量 x_r：记录器 r 的偏移；另设接地节点 G（变量恒为 0）。
 * 每条边 u -> v 权 w 表示  x_v - x_u <= w。
 *
 * 约束来源：
 *   偏移区间 [lo, hi] : G -> r 权 hi        （x_r <= hi）
 *                       r -> G 权 -lo      （-x_r <= -lo，即 x_r >= lo）
 *   观测（发送事件 a 属记录器 ra、时标 t_a；接收事件 b 属 rb、时标 t_b；延迟 [dlo, dhi]）：
 *       dlo <= (t_b + x_rb) - (t_a + x_ra) <= dhi
 *     => rb -> ra 权 t_b - t_a - dlo
 *        ra -> rb 权 dhi + t_a - t_b
 *
 * 参考机偏移为零通过其区间 [0,0] 自然表达。
 * 可行 <=> 无负环；x_i 的紧确最大值 = 接地到 i 的最短路，
 * 紧确最小值 = -(i 到接地的最短路)。全部为整数，端点必可取到。
 */

export interface EdgeMeta {
  kind: 'offsetUpper' | 'offsetLower' | 'obsLower' | 'obsUpper';
  recorder?: number;
  observation?: number;
  /** 人类可读的约束式 */
  text: string;
}

interface Edge extends EdgeMeta {
  u: number;
  v: number;
  w: number;
  /** 反向图中指回原边 */
  orig?: Edge;
}

export interface EndpointInfo {
  recorderId: number;
  which: 'min' | 'max';
  value: number;
  /** 该端点由哪份完整可行赋值达到（全体最大/全体最小赋值同时达到所有同类端点） */
  assignment: 'allMax' | 'allMin';
  /** 逐边 telescope 出该紧确值的约束见证链 */
  witness: EdgeMeta[];
  witnessSum: number;
}

export interface FeasibleResult {
  status: 'feasible';
  unique: boolean;
  bounds: { recorderId: number; min: number; max: number }[];
  /** 同时使所有记录器取到最大偏移的完整可行赋值 */
  allMaxAssignment: number[];
  /** 同时使所有记录器取到最小偏移的完整可行赋值 */
  allMinAssignment: number[];
  endpoints: EndpointInfo[];
}

export interface CycleEdge {
  meta: EdgeMeta;
  u: number;
  v: number;
  w: number;
}

export interface InfeasibleResult {
  status: 'infeasible';
  /** 闭合约束环（顺序首尾相接），沿环各上界之和严格小于零 */
  cycle: CycleEdge[];
  cycleSum: number;
}

export type SolveResult = FeasibleResult | InfeasibleResult;

/** -0 与 0 在 Object.is 下不同，统一归一为 +0，避免界面/比较怪异 */
function normalizeZero(x: number): number {
  return Object.is(x, -0) ? 0 : x;
}

interface BFResult {
  dist: number[];
  pred: (number | null)[];
  predEdge: (Edge | null)[];
  negCycle: Edge[] | null;
}

function bellmanFord(n: number, source: number, edges: Edge[]): BFResult {
  const dist = new Array<number>(n).fill(Infinity);
  const pred: (number | null)[] = new Array(n).fill(null);
  const predEdge: (Edge | null)[] = new Array(n).fill(null);
  dist[source] = 0;

  for (let iter = 0; iter < n; iter++) {
    let changed = false;
    for (const e of edges) {
      if (dist[e.u] !== Infinity && dist[e.v] > dist[e.u] + e.w) {
        dist[e.v] = dist[e.u] + e.w;
        pred[e.v] = e.u;
        predEdge[e.v] = e;
        changed = true;
        if (iter === n - 1) {
          return { dist, pred, predEdge, negCycle: extractCycle(e.v, pred, predEdge, n) };
        }
      }
    }
    if (!changed) break;
  }
  return { dist, pred, predEdge, negCycle: null };
}

function extractCycle(startNode: number, pred: (number | null)[], predEdge: (Edge | null)[], n: number): Edge[] {
  // 沿前驱回退 n 步，必落在负环上
  let cur = startNode;
  for (let k = 0; k < n; k++) cur = pred[cur]!;
  const start = cur;
  const cycleEdges: Edge[] = [];
  do {
    const e = predEdge[cur]!;
    cycleEdges.push(e);
    cur = pred[cur]!;
  } while (cur !== start);
  cycleEdges.reverse();
  return cycleEdges;
}

function toCycleEdge(e: Edge): CycleEdge {
  const src = e.orig ?? e;
  return { meta: { kind: src.kind, recorder: src.recorder, observation: src.observation, text: src.text }, u: src.u, v: src.v, w: src.w };
}

export function solveModel(model: Model): SolveResult {
  const n = model.recorders.length;
  const G = n; // 接地节点下标
  const N = n + 1;
  const recIndex = new Map<number, number>();
  model.recorders.forEach((r, i) => recIndex.set(r.id, i));
  const eventById = new Map(model.events.map((e) => [e.id, e]));

  const edges: Edge[] = [];
  model.recorders.forEach((r, i) => {
    edges.push({ u: G, v: i, w: r.offsetMax, kind: 'offsetUpper', recorder: r.id, text: `x#${r.id} ≤ ${r.offsetMax}` });
    edges.push({ u: i, v: G, w: -r.offsetMin, kind: 'offsetLower', recorder: r.id, text: `-x#${r.id} ≤ ${-r.offsetMin}（即 x#${r.id} ≥ ${r.offsetMin}）` });
  });
  model.observations.forEach((o) => {
    const a = eventById.get(o.send)!;
    const b = eventById.get(o.receive)!;
    const ra = recIndex.get(a.recorder)!;
    const rb = recIndex.get(b.recorder)!;
    edges.push({
      u: rb, v: ra, w: b.localTime - a.localTime - o.delayMin,
      kind: 'obsLower', observation: o.id,
      text: `x#${a.recorder} − x#${b.recorder} ≤ ${b.localTime - a.localTime - o.delayMin}（观测 #${o.id} 延迟下界 ${o.delayMin}）`,
    });
    edges.push({
      u: ra, v: rb, w: o.delayMax + a.localTime - b.localTime,
      kind: 'obsUpper', observation: o.id,
      text: `x#${b.recorder} − x#${a.recorder} ≤ ${o.delayMax + a.localTime - b.localTime}（观测 #${o.id} 延迟上界 ${o.delayMax}）`,
    });
  });

  // 1) 接地出发的最短路：dist[i] = x_i 紧确最大值；负环即不可行
  const fwd = bellmanFord(N, G, edges);
  if (fwd.negCycle) {
    const cycle = fwd.negCycle.map(toCycleEdge);
    return { status: 'infeasible', cycle, cycleSum: cycle.reduce((s, e) => s + e.w, 0) };
  }

  // 2) 反向图（同权）最短路：rev[i] = 原图 i→接地 的最短路径和 S*；
  //    沿该路径 telescope 得 -x_i <= S*，故 x_i 紧确最小值 = -rev[i]。
  const reversed: Edge[] = edges.map((e) => ({ ...e, u: e.v, v: e.u, orig: e }));
  const rev = bellmanFord(N, G, reversed);
  if (rev.negCycle) {
    // 反向图沿环反向遍历，转回原边后需倒置列表才能首尾相接；权值和不变
    const cycle = rev.negCycle.reverse().map(toCycleEdge);
    return { status: 'infeasible', cycle, cycleSum: cycle.reduce((s, e) => s + e.w, 0) };
  }

  const allMaxAssignment = model.recorders.map((_, i) => normalizeZero(fwd.dist[i]));
  const allMinAssignment = model.recorders.map((_, i) => normalizeZero(-rev.dist[i]));

  // 端点见证链：max 取原图中接地→i 的最短路；min 取 i→接地 的路径（反向图前驱映射回原边）
  const maxWitness = (node: number): { chain: EdgeMeta[]; sum: number } => {
    const path: Edge[] = [];
    let cur = node;
    while (cur !== G) {
      const e = fwd.predEdge[cur];
      if (!e) break;
      path.push(e);
      cur = fwd.pred[cur]!;
    }
    path.reverse();
    return { chain: path.map((e) => ({ kind: e.kind, recorder: e.recorder, observation: e.observation, text: e.text })), sum: path.reduce((s, e) => s + e.w, 0) };
  };
  const minWitness = (node: number): { chain: EdgeMeta[]; sum: number } => {
    // 反向图中接地→node 的前驱走查，正好按 node→接地 的顺序给出原边
    const path: Edge[] = [];
    let cur = node;
    while (cur !== G) {
      const e = rev.predEdge[cur];
      if (!e) break;
      path.push(e.orig!);
      cur = rev.pred[cur]!;
    }
    return { chain: path.map((e) => ({ kind: e.kind, recorder: e.recorder, observation: e.observation, text: e.text })), sum: path.reduce((s, e) => s + e.w, 0) };
  };

  const endpoints: EndpointInfo[] = [];
  model.recorders.forEach((r, i) => {
    const wMax = maxWitness(i);
    const wMin = minWitness(i);
    endpoints.push({ recorderId: r.id, which: 'max', value: normalizeZero(fwd.dist[i]), assignment: 'allMax', witness: wMax.chain, witnessSum: wMax.sum });
    endpoints.push({ recorderId: r.id, which: 'min', value: normalizeZero(-rev.dist[i]), assignment: 'allMin', witness: wMin.chain, witnessSum: wMin.sum });
  });

  const bounds = model.recorders.map((r, i) => ({ recorderId: r.id, min: normalizeZero(-rev.dist[i]), max: normalizeZero(fwd.dist[i]) }));
  const unique = bounds.every((b) => b.min === b.max);

  return { status: 'feasible', unique, bounds, allMaxAssignment, allMinAssignment, endpoints };
}

/** 给定完整偏移赋值，计算各观测实际延迟（真实接收 − 真实发送） */
export function actualDelays(
  model: Model,
  assignment: number[],
): { observation: Observation; delay: number; senderId: number; receiverId: number }[] {
  const recIndex = new Map<number, number>();
  model.recorders.forEach((r, i) => recIndex.set(r.id, i));
  const eventById = new Map(model.events.map((e) => [e.id, e]));
  return model.observations.map((o) => {
    const a = eventById.get(o.send)!;
    const b = eventById.get(o.receive)!;
    const delay = b.localTime + assignment[recIndex.get(b.recorder)!] - a.localTime - assignment[recIndex.get(a.recorder)!];
    return { observation: o, delay, senderId: a.recorder, receiverId: b.recorder };
  });
}

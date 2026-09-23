import { describe, expect, it } from 'vitest';
import type { Model } from '../src/types';
import { solveModel } from '../src/solver';

// 小型确定性伪随机
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomModel(rnd: () => number): Model {
  const recCount = 2 + Math.floor(rnd() * 3);
  const ref = Math.floor(rnd() * recCount);
  const recorders = Array.from({ length: recCount }, (_, i) => {
    if (i === ref) return { id: i + 1, reference: true, offsetMin: 0, offsetMax: 0 };
    const lo = -3 + Math.floor(rnd() * 3);
    const hi = lo + Math.floor(rnd() * 4);
    return { id: i + 1, reference: false, offsetMin: lo, offsetMax: hi };
  });

  const events: { id: number; recorder: number; localTime: number }[] = [];
  let eid = 1;
  for (let r = 0; r < recCount; r++) {
    const count = 1 + Math.floor(rnd() * 3);
    let t = -4 + Math.floor(rnd() * 3);
    for (let k = 0; k < count; k++) {
      events.push({ id: eid++, recorder: r + 1, localTime: t });
      t += 1 + Math.floor(rnd() * 3);
    }
  }

  const observations: { id: number; send: number; receive: number; delayMin: number; delayMax: number }[] = [];
  let oid = 1;
  const obsCount = Math.floor(rnd() * 5);
  for (let k = 0; k < obsCount; k++) {
    const ra = Math.floor(rnd() * recCount);
    let rb = Math.floor(rnd() * recCount);
    if (rb === ra) rb = (rb + 1) % recCount;
    const ea = events.filter((e) => e.recorder === ra + 1);
    const eb = events.filter((e) => e.recorder === rb + 1);
    const a = ea[Math.floor(rnd() * ea.length)];
    const b = eb[Math.floor(rnd() * eb.length)];
    const dlo = Math.floor(rnd() * 4);
    const dhi = dlo + Math.floor(rnd() * 4);
    observations.push({ id: oid++, send: a.id, receive: b.id, delayMin: dlo, delayMax: dhi });
  }

  return { recorders, events, observations };
}

function enumerateFeasible(model: Model): number[][] {
  const domains: number[][] = model.recorders.map((r) => {
    const out: number[] = [];
    for (let v = r.offsetMin; v <= r.offsetMax; v++) out.push(v);
    return out;
  });
  const eventById = new Map(model.events.map((e) => [e.id, e]));
  const recIndex = new Map(model.recorders.map((r, i) => [r.id, i]));

  const feasible: number[][] = [];
  const combo = new Array(model.recorders.length).fill(0);
  const walk = (r: number) => {
    if (r === domains.length) {
      let ok = true;
      for (const o of model.observations) {
        const a = eventById.get(o.send)!;
        const b = eventById.get(o.receive)!;
        const d = b.localTime + combo[recIndex.get(b.recorder)!] - a.localTime - combo[recIndex.get(a.recorder)!];
        if (d < o.delayMin || d > o.delayMax) {
          ok = false;
          break;
        }
      }
      if (ok) feasible.push(combo.slice());
      return;
    }
    for (const v of domains[r]) {
      combo[r] = v;
      walk(r + 1);
    }
  };
  walk(0);
  return feasible;
}

describe('randomized property: solver matches brute-force enumeration', () => {
  it('tight bounds / uniqueness / endpoint assignments across 300 instances', () => {
    const rnd = mulberry32(20260923);
    for (let trial = 0; trial < 300; trial++) {
      const model = randomModel(rnd);
      const brute = enumerateFeasible(model);
      const res = solveModel(model);

      if (brute.length === 0) {
        expect(res.status, `trial ${trial}`).toBe('infeasible');
        if (res.status !== 'infeasible') continue;
        expect(res.cycleSum, `trial ${trial}`).toBeLessThan(0);
        expect(res.cycleSum).toBe(res.cycle.reduce((s, e) => s + e.w, 0));
        // 环首尾相接：不等式相加 telescope 成 0 <= sum < 0
        for (let i = 0; i < res.cycle.length; i++) {
          expect(res.cycle[i].v).toBe(res.cycle[(i + 1) % res.cycle.length].u);
        }
      } else {
        expect(res.status, `trial ${trial}`).toBe('feasible');
        if (res.status !== 'feasible') continue;
        res.bounds.forEach((b, i) => {
          const vals = brute.map((c) => c[i]);
          expect(b.min, `trial ${trial} recorder ${b.recorderId} min`).toBe(Math.min(...vals));
          expect(b.max, `trial ${trial} recorder ${b.recorderId} max`).toBe(Math.max(...vals));
        });
        const uniqueBrute = brute.length === 1;
        expect(res.unique, `trial ${trial}`).toBe(uniqueBrute);
        // 端点见证链求和等于端点
        for (const ep of res.endpoints) {
          if (ep.which === 'max') expect(ep.witnessSum === ep.value).toBe(true);
          else expect(-ep.witnessSum === ep.value).toBe(true);
        }
        // 给出的两份完整赋值确实可行且落在枚举集中
        for (const a of [res.allMinAssignment, res.allMaxAssignment]) {
          expect(brute.some((c) => c.every((v, i) => v === a[i]))).toBe(true);
        }
      }
    }
  });
});

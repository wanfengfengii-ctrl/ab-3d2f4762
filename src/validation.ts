import {
  LIMIT,
  MAX_EVENTS,
  MAX_OBSERVATIONS,
  MAX_RECORDERS,
  type Model,
  type ModelInput,
  type Observation,
  type PulseEvent,
  type Recorder,
} from './types';

export interface Issue {
  /** 定位：文档级 / recorders / events / observations */
  scope: 'document' | 'recorders' | 'events' | 'observations';
  /** 条目定位，如 recorders[3]（编号 5） */
  ref: string;
  message: string;
}

function issue(
  scope: Issue['scope'],
  ref: string,
  message: string,
): Issue {
  return { scope, ref, message };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 接受整数或整数字面量字符串，拒绝浮点、布尔、空串及越界值 */
function parseIntValue(
  raw: unknown,
  opts: { min: number; max: number; allowMissing?: true; defaultValue?: number },
): { ok: true; value: number } | { ok: false; reason: string } {
  if (raw === undefined || raw === null || raw === '') {
    if (opts.allowMissing) return { ok: true, value: opts.defaultValue! };
    return { ok: false, reason: '缺少整数值' };
  }
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const t = raw.trim();
    if (!/^[+-]?\d{1,16}$/.test(t)) {
      return { ok: false, reason: `“${raw}”不是合法整数字面量` };
    }
    n = Number(t);
  } else {
    return { ok: false, reason: '不是整数' };
  }
  if (!Number.isInteger(n)) return { ok: false, reason: `“${raw}”不是整数` };
  if (!Number.isSafeInteger(n)) return { ok: false, reason: `“${raw}”超出安全整数范围` };
  if (n < opts.min) return { ok: false, reason: `${n} 小于允许下界 ${opts.min}` };
  if (n > opts.max) return { ok: false, reason: `${n} 大于允许上界 ${opts.max}` };
  return { ok: true, value: n };
}

function parseId(raw: unknown): { ok: true; value: number } | { ok: false; reason: string } {
  const r = parseIntValue(raw, { min: 0, max: LIMIT });
  if (!r.ok) return r;
  return { ok: true, value: r.value };
}

export function validateModel(input: unknown): { model?: Model; issues: Issue[] } {
  const issues: Issue[] = [];

  if (!isObject(input)) {
    issues.push(issue('document', '根节点', '模型必须是包含 recorders / events / observations 三个数组的 JSON 对象'));
    return { issues };
  }
  const root = input as unknown as ModelInput;
  if (!Array.isArray(root.recorders)) issues.push(issue('document', 'recorders', 'recorders 必须是数组'));
  if (!Array.isArray(root.events)) issues.push(issue('document', 'events', 'events 必须是数组'));
  if (!Array.isArray(root.observations)) issues.push(issue('document', 'observations', 'observations 必须是数组'));
  if (issues.length) return { issues };

  const recRaw = root.recorders as unknown[];
  const evtRaw = root.events as unknown[];
  const obsRaw = root.observations as unknown[];

  if (recRaw.length < 2) issues.push(issue('recorders', 'recorders', `记录器数量 ${recRaw.length}，至少需要 2 台`));
  if (recRaw.length > MAX_RECORDERS)
    issues.push(issue('recorders', 'recorders', `记录器数量 ${recRaw.length}，超过上限 ${MAX_RECORDERS}`));
  if (evtRaw.length > MAX_EVENTS)
    issues.push(issue('events', 'events', `事件数量 ${evtRaw.length}，超过上限 ${MAX_EVENTS}`));
  if (obsRaw.length > MAX_OBSERVATIONS)
    issues.push(issue('observations', 'observations', `观测数量 ${obsRaw.length}，超过上限 ${MAX_OBSERVATIONS}`));

  // ---- 记录器 ----
  const recorders: Recorder[] = [];
  const recorderIds = new Map<number, number>();
  let referenceCount = 0;

  recRaw.forEach((item, i) => {
    const ref = `recorders[${i}]`;
    if (!isObject(item)) {
      issues.push(issue('recorders', ref, '该条目不是对象'));
      return;
    }
    const idr = parseId(item.id);
    if (!idr.ok) {
      issues.push(issue('recorders', ref, `非法编号 id：${idr.reason}`));
      return;
    }
    const where = `${ref}（编号 ${idr.value}）`;
    if (recorderIds.has(idr.value)) {
      issues.push(issue('recorders', where, `记录器编号 ${idr.value} 重复，首次出现于 recorders[${recorderIds.get(idr.value)}]`));
      return;
    }
    recorderIds.set(idr.value, i);

    const isReference = item.reference === true;
    if (item.reference !== undefined && typeof item.reference !== 'boolean') {
      issues.push(issue('recorders', where, 'reference 必须是布尔值 true/false'));
    }
    if (isReference) referenceCount++;

    const lo = parseIntValue(item.offsetMin, { min: -LIMIT, max: LIMIT, allowMissing: true, defaultValue: -LIMIT });
    const hi = parseIntValue(item.offsetMax, { min: -LIMIT, max: LIMIT, allowMissing: true, defaultValue: LIMIT });
    if (!lo.ok) issues.push(issue('recorders', where, `非法偏移下界 offsetMin：${lo.reason}`));
    if (!hi.ok) issues.push(issue('recorders', where, `非法偏移上界 offsetMax：${hi.reason}`));

    let offsetMin = lo.ok ? lo.value : -LIMIT;
    let offsetMax = hi.ok ? hi.value : LIMIT;
    if (isReference) {
      // 参考机偏移恒为零；显式给出的界值必须与零一致
      const loGiven = item.offsetMin !== undefined && item.offsetMin !== null && item.offsetMin !== '';
      const hiGiven = item.offsetMax !== undefined && item.offsetMax !== null && item.offsetMax !== '';
      if ((loGiven || hiGiven) && (offsetMin !== 0 || offsetMax !== 0)) {
        issues.push(issue('recorders', where, `参考机偏移必须为 0，但给出的界值为 [${item.offsetMin}, ${item.offsetMax}]`));
      }
      offsetMin = 0;
      offsetMax = 0;
    } else if (lo.ok && hi.ok && offsetMin > offsetMax) {
      issues.push(issue('recorders', where, `偏移区间上下界颠倒：${offsetMin} > ${offsetMax}`));
    }
    recorders.push({ id: idr.value, reference: isReference, offsetMin, offsetMax });
  });

  if (recRaw.length >= 2 && recRaw.length <= MAX_RECORDERS) {
    if (referenceCount === 0) {
      issues.push(issue('recorders', 'recorders', '必须恰好指定一台 reference: true 的参考记录器（偏移为零）'));
    } else if (referenceCount > 1) {
      issues.push(issue('recorders', 'recorders', `参考记录器有 ${referenceCount} 台，必须恰好为 1 台`));
    }
  }

  // ---- 事件 ----
  const events: PulseEvent[] = [];
  const eventIds = new Map<number, number>();

  evtRaw.forEach((item, i) => {
    const ref = `events[${i}]`;
    if (!isObject(item)) {
      issues.push(issue('events', ref, '该条目不是对象'));
      return;
    }
    const idr = parseId(item.id);
    if (!idr.ok) {
      issues.push(issue('events', ref, `非法编号 id：${idr.reason}`));
      return;
    }
    const where = `${ref}（编号 ${idr.value}）`;
    if (eventIds.has(idr.value)) {
      issues.push(issue('events', where, `事件编号 ${idr.value} 全局重复，首次出现于 events[${eventIds.get(idr.value)}]`));
      return;
    }

    const recR = parseId(item.recorder);
    if (!recR.ok) {
      issues.push(issue('events', where, `非法记录器引用 recorder：${recR.reason}`));
    } else if (!recorderIds.has(recR.value)) {
      issues.push(issue('events', where, `非法引用：记录器编号 ${recR.value} 不存在`));
    }

    const tr = parseIntValue(item.localTime, { min: -LIMIT, max: LIMIT });
    if (!tr.ok) issues.push(issue('events', where, `非法本地时标 localTime：${tr.reason}（绝对值不得超过 ${LIMIT}）`));

    eventIds.set(idr.value, i);
    events.push({
      id: idr.value,
      recorder: recR.ok ? recR.value : Number.NaN,
      localTime: tr.ok ? tr.value : Number.NaN,
    });
  });

  // 同一记录器事件须按所列顺序时标严格递增
  const lastTimeByRecorder = new Map<number, { time: number; index: number; eventId: number }>();
  events.forEach((evt, i) => {
    if (!Number.isFinite(evt.localTime) || !recorderIds.has(evt.recorder)) return;
    const prev = lastTimeByRecorder.get(evt.recorder);
    if (prev) {
      if (!(evt.localTime > prev.time)) {
        issues.push(
          issue(
            'events',
            `events[${i}]（编号 ${evt.id}）`,
            `记录器 ${evt.recorder} 上事件时标非严格递增：${evt.localTime} 不大于前一事件 #${prev.eventId}（events[${prev.index}]）的 ${prev.time}`,
          ),
        );
      }
    }
    lastTimeByRecorder.set(evt.recorder, { time: evt.localTime, index: i, eventId: evt.id });
  });

  // ---- 观测 ----
  const observations: Observation[] = [];
  const observationIds = new Set<number>();

  obsRaw.forEach((item, i) => {
    const ref = `observations[${i}]`;
    if (!isObject(item)) {
      issues.push(issue('observations', ref, '该条目不是对象'));
      return;
    }
    const idr = parseId(item.id);
    if (!idr.ok) {
      issues.push(issue('observations', ref, `非法编号 id：${idr.reason}`));
      return;
    }
    const where = `${ref}（编号 ${idr.value}）`;
    if (observationIds.has(idr.value)) {
      issues.push(issue('observations', where, `观测编号 ${idr.value} 重复`));
      return;
    }

    const sendR = parseId(item.send);
    const recvR = parseId(item.receive);
    if (!sendR.ok) issues.push(issue('observations', where, `非法发送事件引用 send：${sendR.reason}`));
    if (!recvR.ok) issues.push(issue('observations', where, `非法接收事件引用 receive：${recvR.reason}`));

    const sendEvt = sendR.ok ? eventIds.get(sendR.value) : undefined;
    const recvEvt = recvR.ok ? eventIds.get(recvR.value) : undefined;
    if (sendR.ok && sendEvt === undefined)
      issues.push(issue('observations', where, `非法引用：发送事件 #${sendR.value} 不存在`));
    if (recvR.ok && recvEvt === undefined)
      issues.push(issue('observations', where, `非法引用：接收事件 #${recvR.value} 不存在`));

    const dlo = parseIntValue(item.delayMin, { min: 0, max: LIMIT, allowMissing: true, defaultValue: 0 });
    const dhi = parseIntValue(item.delayMax, { min: 0, max: LIMIT, allowMissing: true, defaultValue: 0 });
    if (!dlo.ok) issues.push(issue('observations', where, `非法延迟下界 delayMin（须为非负整数且不超过 ${LIMIT}）：${dlo.reason}`));
    if (!dhi.ok) issues.push(issue('observations', where, `非法延迟上界 delayMax（须为非负整数且不超过 ${LIMIT}）：${dhi.reason}`));
    if (dlo.ok && dhi.ok && dlo.value > dhi.value) {
      issues.push(issue('observations', where, `延迟区间上下界颠倒：${dlo.value} > ${dhi.value}`));
    }

    if (sendR.ok && recvR.ok && sendEvt !== undefined && recvEvt !== undefined) {
      const a = events[sendEvt];
      const b = events[recvEvt];
      if (a.recorder === b.recorder) {
        issues.push(
          issue(
            'observations',
            where,
            `观测必须连接不同记录器：发送事件 #${a.id} 与接收事件 #${b.id} 同属记录器 ${a.recorder}`,
          ),
        );
      }
    }

    observationIds.add(idr.value);
    observations.push({
      id: idr.value,
      send: sendR.ok ? sendR.value : Number.NaN,
      receive: recvR.ok ? recvR.value : Number.NaN,
      delayMin: dlo.ok ? dlo.value : Number.NaN,
      delayMax: dhi.ok ? dhi.value : Number.NaN,
    });
  });

  if (issues.length) return { issues };
  return { model: { recorders, events, observations }, issues: [] };
}

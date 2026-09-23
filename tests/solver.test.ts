import { describe, expect, it } from 'vitest';
import { validateModel } from '../src/validation';
import { actualDelays, solveModel } from '../src/solver';

const base = {
  recorders: [
    { id: 1, reference: true },
    { id: 2, offsetMin: -10, offsetMax: 10 },
    { id: 3, offsetMin: -10, offsetMax: 10 },
  ],
  events: [
    { id: 10, recorder: 1, localTime: 0 },
    { id: 11, recorder: 2, localTime: 5 },
    { id: 12, recorder: 3, localTime: 6 },
  ],
  observations: [
    { id: 100, send: 10, receive: 11, delayMin: 0, delayMax: 10 },
    { id: 101, send: 10, receive: 12, delayMin: 0, delayMax: 10 },
  ],
};

describe('solver — feasible bounds', () => {
  it('computes tight bounds via difference constraints', () => {
    const { model } = validateModel(base);
    expect(model).toBeDefined();
    const res = solveModel(model!);
    expect(res.status).toBe('feasible');
    if (res.status !== 'feasible') return;
    const b = Object.fromEntries(res.bounds.map((x) => [x.recorderId, x]));
    expect(b[1]).toEqual({ recorderId: 1, min: 0, max: 0 });
    expect(b[2]).toEqual({ recorderId: 2, min: -5, max: 5 });
    expect(b[3]).toEqual({ recorderId: 3, min: -6, max: 4 });
    expect(res.unique).toBe(false);
  });

  it('endpoint assignments are feasible: all actual delays within bounds', () => {
    const { model } = validateModel(base);
    const res = solveModel(model!);
    expect(res.status).toBe('feasible');
    if (res.status !== 'feasible') return;
    for (const assignment of [res.allMaxAssignment, res.allMinAssignment]) {
      const delays = actualDelays(model!, assignment);
      for (const { observation, delay } of delays) {
        expect(delay).toBeGreaterThanOrEqual(observation.delayMin);
        expect(delay).toBeLessThanOrEqual(observation.delayMax);
      }
    }
    // 端点确实达到紧确界
    res.bounds.forEach((bnd, i) => {
      expect(res.allMinAssignment[i]).toBe(bnd.min);
      expect(res.allMaxAssignment[i]).toBe(bnd.max);
    });
  });

  it('witness chains telescope to the endpoint value', () => {
    const { model } = validateModel(base);
    const res = solveModel(model!);
    if (res.status !== 'feasible') throw new Error('should be feasible');
    for (const ep of res.endpoints) {
      expect(ep.witness.length).toBeGreaterThan(0);
      if (ep.which === 'max') {
        expect(ep.witnessSum === ep.value).toBe(true);
      } else {
        // 最小值链沿 i→接地 取上界，x_i = -(链上界和)；=== 对 ±0 成立
        expect(-ep.witnessSum === ep.value).toBe(true);
      }
    }
  });

  it('reports unique when every range is a singleton', () => {
    const m = {
      recorders: [
        { id: 1, reference: true },
        { id: 2, offsetMin: -10, offsetMax: 10 },
      ],
      events: [
        { id: 10, recorder: 1, localTime: 0 },
        { id: 11, recorder: 2, localTime: 5 },
      ],
      observations: [
        { id: 100, send: 10, receive: 11, delayMin: 5, delayMax: 5 },
      ],
    };
    const { model } = validateModel(m);
    const res = solveModel(model!);
    expect(res.status).toBe('feasible');
    if (res.status !== 'feasible') return;
    expect(res.unique).toBe(true);
    const b2 = res.bounds.find((x) => x.recorderId === 2)!;
    expect(b2.min).toBe(0);
    expect(b2.max).toBe(0);
  });
});

describe('solver — infeasibility certificate', () => {
  it('returns a closed constraint chain with strict negative upper-bound sum', () => {
    const m = {
      recorders: [
        { id: 1, reference: true },
        { id: 2, offsetMin: -10, offsetMax: 10 },
      ],
      events: [
        { id: 10, recorder: 1, localTime: 0 },
        { id: 11, recorder: 2, localTime: 100 },
      ],
      observations: [
        { id: 100, send: 10, receive: 11, delayMin: 0, delayMax: 10 },
      ],
    };
    const { model } = validateModel(m);
    const res = solveModel(model!);
    expect(res.status).toBe('infeasible');
    if (res.status !== 'infeasible') return;
    expect(res.cycle.length).toBeGreaterThan(0);
    expect(res.cycleSum).toBeLessThan(0);
    expect(res.cycleSum).toBe(res.cycle.reduce((s, e) => s + e.w, 0));
    // 首尾相接
    for (let i = 0; i < res.cycle.length; i++) {
      const cur = res.cycle[i];
      const next = res.cycle[(i + 1) % res.cycle.length];
      expect(cur.v).toBe(next.u);
    }
  });
});

describe('validation', () => {
  it('flags duplicate recorder / event ids and bad references', () => {
    const m = {
      recorders: [
        { id: 1, reference: true },
        { id: 1, offsetMin: 0, offsetMax: 5 },
      ],
      events: [{ id: 9, recorder: 7, localTime: 0 }],
      observations: [{ id: 1, send: 9, receive: 99 }],
    };
    const { issues } = validateModel(m);
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toContain('重复');
    expect(text).toContain('记录器编号 7 不存在');
    expect(text).toContain('接收事件 #99 不存在');
  });

  it('flags missing reference, same-recorder observation, inverted ranges', () => {
    const m = {
      recorders: [
        { id: 1, offsetMin: 5, offsetMax: 1 },
        { id: 2, offsetMin: 0, offsetMax: 0 },
      ],
      events: [
        { id: 10, recorder: 1, localTime: 0 },
        { id: 11, recorder: 1, localTime: 0 },
      ],
      observations: [{ id: 100, send: 10, receive: 11, delayMin: 3, delayMax: 2 }],
    };
    const { issues } = validateModel(m);
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toContain('参考记录器');
    expect(text).toContain('上下界颠倒');
    expect(text).toContain('严格递增');
    expect(text).toContain('不同记录器');
  });

  it('flags out-of-range timestamps, non-integers, negative delays', () => {
    const m = {
      recorders: [
        { id: 1, reference: true },
        { id: 2, offsetMin: 0, offsetMax: 10 },
      ],
      events: [
        { id: 10, recorder: 1, localTime: 1000000001 },
        { id: 11, recorder: 2, localTime: 1.5 },
      ],
      observations: [{ id: 100, send: 10, receive: 11, delayMin: -1, delayMax: 5 }],
    };
    const { issues } = validateModel(m);
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toContain('localTime');
    expect(text).toContain('1.5');
    expect(text).toContain('delayMin');
  });

  it('rejects reference machine with nonzero stated bounds', () => {
    const m = {
      recorders: [
        { id: 1, reference: true, offsetMin: 0, offsetMax: 3 },
        { id: 2, offsetMin: 0, offsetMax: 10 },
      ],
      events: [],
      observations: [],
    };
    const { issues } = validateModel(m);
    expect(issues.map((i) => i.message).join('\n')).toContain('参考机偏移必须为 0');
  });

  it('accepts integer string literals and defaults', () => {
    const m = {
      recorders: [
        { id: 1, reference: true },
        { id: 2, offsetMin: '-3', offsetMax: '3' },
      ],
      events: [
        { id: 10, recorder: 1, localTime: '0' },
        { id: 11, recorder: 2, localTime: '2' },
      ],
      observations: [{ id: 100, send: 10, receive: 11 }],
    };
    const { model, issues } = validateModel(m);
    expect(issues).toEqual([]);
    expect(model!.recorders[1].offsetMin).toBe(-3);
    expect(model!.observations[0].delayMin).toBe(0);
    expect(model!.observations[0].delayMax).toBe(0);
  });
});

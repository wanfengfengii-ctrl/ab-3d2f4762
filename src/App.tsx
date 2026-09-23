import { useMemo, useState } from 'react';
import { validateModel, type Issue } from './validation';
import { actualDelays, solveModel, type EndpointInfo, type FeasibleResult } from './solver';
import { EMPTY_MODEL, SAMPLE_INFEASIBLE, SAMPLE_INVALID, SAMPLE_MULTI, SAMPLE_UNIQUE } from './samples';

export default function App() {
  const [text, setText] = useState<string>(JSON.stringify(SAMPLE_MULTI, null, 2));
  // 已审计的文本快照；输入框任何变更都会使其失效（立即清除旧裁决）
  const [auditedText, setAuditedText] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const audited = useMemo(() => {
    if (auditedText === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(auditedText);
    } catch (e) {
      return { kind: 'json-error' as const, message: (e as Error).message };
    }
    const { model, issues } = validateModel(parsed);
    if (issues.length) return { kind: 'invalid' as const, issues };
    const solve = solveModel(model!);
    return { kind: 'solve' as const, model: model!, solve };
  }, [auditedText]);

  const doAudit = () => {
    setSelected(null);
    setAuditedText(text);
  };

  const loadSample = (s: unknown) => {
    setText(JSON.stringify(s, null, 2));
    setAuditedText(null);
    setSelected(null);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const content = await f.text();
    setText(content);
    setAuditedText(null);
    setSelected(null);
  };

  return (
    <div className="app">
      <header>
        <h1>脉冲记录器偏移复核台</h1>
        <p className="subtitle">
          只有本地时标的多台脉冲记录器 · 差分约束精确求解偏移紧确界 · 纯前端，无业务后端
        </p>
      </header>

      <section className="editor">
        <div className="toolbar">
          <button className="primary" onClick={doAudit}>
            审计当前模型
          </button>
          <label className="file-btn">
            导入 JSON
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <button onClick={() => loadSample(SAMPLE_MULTI)}>示例：多解</button>
          <button onClick={() => loadSample(SAMPLE_UNIQUE)}>示例：唯一解</button>
          <button onClick={() => loadSample(SAMPLE_INFEASIBLE)}>示例：不可行</button>
          <button onClick={() => loadSample(SAMPLE_INVALID)}>示例：非法输入</button>
          <button onClick={() => loadSample(EMPTY_MODEL)}>空白模板</button>
        </div>
        <textarea
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // 输入变更立即清除旧裁决
            setAuditedText(null);
            setSelected(null);
          }}
        />
      </section>

      <section className="verdict">
        {!audited && (
          <div className="placeholder">编辑或导入模型后点击“审计当前模型”，此处显示校验与求解裁决。</div>
        )}
        {audited?.kind === 'json-error' && (
          <div className="panel bad">
            <h2>JSON 语法错误</h2>
            <pre>{audited.message}</pre>
          </div>
        )}
        {audited?.kind === 'invalid' && <IssueList issues={audited.issues} />}
        {audited?.kind === 'solve' && audited.solve.status === 'infeasible' && (
          <InfeasibleView solve={audited.solve} model={audited.model} />
        )}
        {audited?.kind === 'solve' && audited.solve.status === 'feasible' && (
          <FeasibleView
            solve={audited.solve}
            model={audited.model}
            selected={selected}
            onSelect={(key) => setSelected((cur) => (cur === key ? null : key))}
          />
        )}
      </section>

      <footer>
        <details>
          <summary>建模与求解说明</summary>
          <ul>
            <li>变量 x#r 为记录器 r 的偏移，参考机 x = 0；真实时刻 = 本地时标 + 偏移。</li>
            <li>偏移区间给出两条上界：x#r ≤ hi、−x#r ≤ −lo；观测延迟 [dlo,dhi] 给出两条上界。</li>
            <li>系统为整数差分约束，可行 ⇔ 约束图无负环；接地到节点的最短路给出紧确最大偏移，反向最短路给出紧确最小偏移。</li>
            <li>全部偏移范围为单点即唯一解；不可行时展示的闭合链上各上界之和严格小于零（相加 telescope 为 0 ≤ 和 &lt; 0）。</li>
            <li>点击任一偏移端点查看见证链、完整可行赋值与每条观测的实际延迟。</li>
          </ul>
        </details>
      </footer>
    </div>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  const scopes: { key: Issue['scope']; label: string }[] = [
    { key: 'document', label: '文档结构' },
    { key: 'recorders', label: '记录器' },
    { key: 'events', label: '事件' },
    { key: 'observations', label: '观测' },
  ];
  return (
    <div className="panel bad">
      <h2>输入非法（{issues.length} 项），未进行求解</h2>
      <p className="muted">所有非法编号、时标、界值与引用均定位到具体条目：</p>
      {scopes.map(({ key, label }) => {
        const list = issues.filter((i) => i.scope === key);
        if (!list.length) return null;
        return (
          <div key={key} className="issue-group">
            <h3>{label}</h3>
            <ul>
              {list.map((it, idx) => (
                <li key={idx}>
                  <code>{it.ref}</code>：{it.message}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function InfeasibleView({
  solve,
  model,
}: {
  solve: Extract<ReturnType<typeof solveModel>, { status: 'infeasible' }>;
  model: NonNullable<ReturnType<typeof validateModel>['model']>;
}) {
  const n = model.recorders.length;
  const label = (i: number) => (i === n ? '0（接地）' : `#${model.recorders[i].id}`);
  return (
    <div className="panel bad">
      <h2>裁决：不存在一致的真实时间解释（不可行）</h2>
      <p>
        下列闭合约束链首尾相接，将各上界同向相加，偏移项全部 telescope 抵消，得到{' '}
        <strong>0 ≤ {solve.cycleSum}</strong>
        ，而上界总和 <strong>{solve.cycleSum}</strong> 严格小于零，矛盾。
      </p>
      <ol className="chain">
        {solve.cycle.map((e, i) => (
          <li key={i}>
            <span className="chain-edge">
              x{label(e.u)} → x{label(e.v)}，权 {e.w}
            </span>
            <div className="muted">{e.meta.text}</div>
          </li>
        ))}
      </ol>
      <p className="sum-line">
        上界总和 = {solve.cycle.map((e) => `(${e.w})`).join(' + ')} = <strong>{solve.cycleSum}</strong> {'<'} 0
      </p>
    </div>
  );
}

function FeasibleView({
  solve,
  model,
  selected,
  onSelect,
}: {
  solve: FeasibleResult;
  model: NonNullable<ReturnType<typeof validateModel>['model']>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const endpoint = selected
    ? solve.endpoints.find((e) => `${e.recorderId}:${e.which}` === selected) ?? null
    : null;
  return (
    <div className="panel good">
      <h2>
        裁决：{solve.unique ? '存在唯一一致解释（全部偏移范围均为单点）' : '存在多个一致解释（至少一个偏移范围非单点）'}
      </h2>

      <h3>各记录器偏移紧确范围</h3>
      <table className="grid">
        <thead>
          <tr>
            <th>记录器</th>
            <th>参考机</th>
            <th>紧确最小值</th>
            <th>紧确最大值</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>
          {solve.bounds.map((b) => (
            <tr key={b.recorderId}>
              <td>#{b.recorderId}</td>
              <td>{model.recorders.find((r) => r.id === b.recorderId)?.reference ? '是（偏移恒 0）' : '—'}</td>
              <td>
                <button
                  className={`endpoint ${selected === `${b.recorderId}:min` ? 'active' : ''}`}
                  onClick={() => onSelect(`${b.recorderId}:min`)}
                >
                  {b.min} ▣
                </button>
              </td>
              <td>
                <button
                  className={`endpoint ${selected === `${b.recorderId}:max` ? 'active' : ''}`}
                  onClick={() => onSelect(`${b.recorderId}:max`)}
                >
                  {b.max} ▣
                </button>
              </td>
              <td>{b.min === b.max ? '单点' : `区间宽 ${b.max - b.min}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">点击任一端点数值查看见证链、完整可行赋值与各观测实际延迟。</p>

      {endpoint && <EndpointDetail ep={endpoint} solve={solve} model={model} />}
    </div>
  );
}

function EndpointDetail({
  ep,
  solve,
  model,
}: {
  ep: EndpointInfo;
  solve: FeasibleResult;
  model: NonNullable<ReturnType<typeof validateModel>['model']>;
}) {
  const assignment = ep.assignment === 'allMax' ? solve.allMaxAssignment : solve.allMinAssignment;
  const delays = actualDelays(model, assignment);
  return (
    <div className="endpoint-detail">
      <h3>
        端点见证：x#{ep.recorderId} 的紧确{ep.which === 'max' ? '最大' : '最小'}偏移 = {ep.value}
      </h3>
      <p className="muted">
        见证由“{ep.assignment === 'allMax' ? '全体取最大' : '全体取最小'}”完整可行赋值达到；该赋值同时达到所有记录器的同类端点。
      </p>

      <h4>约束见证链（逐项 telescope）</h4>
      <ol className="chain">
        {ep.witness.map((w, i) => (
          <li key={i}>{w.text}</li>
        ))}
      </ol>
      <p className="sum-line">
        {ep.which === 'max'
          ? `链上权值之和 = ${ep.witnessSum} = x#${ep.recorderId} 的紧确上界 = ${ep.value}`
          : `链上权值之和 = ${ep.witnessSum}，即 −x#${ep.recorderId} ≤ ${ep.witnessSum}，故 x#${ep.recorderId} ≥ ${-ep.witnessSum} = ${ep.value}`}
      </p>

      <h4>该端点下的完整可行偏移赋值（全部记录器）</h4>
      <table className="grid">
        <thead>
          <tr>
            <th>记录器</th>
            <th>偏移</th>
            <th>事件验算：本地时标 → 真实时刻</th>
          </tr>
        </thead>
        <tbody>
          {model.recorders.map((r, i) => (
            <tr key={r.id} className={r.id === ep.recorderId ? 'hl' : ''}>
              <td>#{r.id}{r.reference ? '（参考机）' : ''}</td>
              <td>{assignment[i]}</td>
              <td className="mono">
                {model.events
                  .filter((e) => e.recorder === r.id)
                  .map((e) => `#${e.id}: ${e.localTime} → ${e.localTime + assignment[i]}`)
                  .join('；') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>各观测实际延迟逐项核对（真实接收 − 真实发送）</h4>
      <table className="grid">
        <thead>
          <tr>
            <th>观测</th>
            <th>发送事件（记录器/本地时标）</th>
            <th>接收事件（记录器/本地时标）</th>
            <th>实际延迟</th>
            <th>要求区间</th>
            <th>核对</th>
          </tr>
        </thead>
        <tbody>
          {delays.map(({ observation: o, delay, senderId, receiverId }) => {
            const a = model.events.find((e) => e.id === o.send)!;
            const b = model.events.find((e) => e.id === o.receive)!;
            const ok = delay >= o.delayMin && delay <= o.delayMax;
            return (
              <tr key={o.id}>
                <td>#{o.id}</td>
                <td>
                  #{a.id}（机 #{senderId}，t={a.localTime}）
                </td>
                <td>
                  #{b.id}（机 #{receiverId}，t={b.localTime}）
                </td>
                <td>{delay}</td>
                <td>[{o.delayMin}, {o.delayMax}]</td>
                <td className={ok ? 'ok' : 'bad2'}>{ok ? '✓ 在区间内' : '✗ 越界'}</td>
              </tr>
            );
          })}
          {delays.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">无观测约束。</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

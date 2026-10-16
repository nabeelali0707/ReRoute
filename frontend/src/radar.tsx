import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, FileText, LoaderCircle, Printer, Radar as RadarIcon, ShieldAlert, Sparkles, X } from 'lucide-react';
import { api, money } from './lib';
import { CountryMap } from './views';
import type { Config, Radar, RadarAnalysis, RadarOrder, RecoveryCase, RiskLevel } from './types';

// Reserved status colours (dataviz reference palette); always shown with a text label and icon.
const STATUS: Record<RiskLevel, { color: string; icon: React.ReactNode }> = {
  High: { color: '#d03b3b', icon: <ShieldAlert size={13}/> },
  Medium: { color: '#fab219', icon: <AlertTriangle size={13}/> },
  Low: { color: '#0ca30c', icon: <CheckCircle2 size={13}/> },
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`risk-badge risk-${level.toLowerCase()}`}>{STATUS[level].icon}{level}</span>;
}

export function RadarView({ config, onOpenCase, onError }: { config?: Config; onOpenCase: (d: RecoveryCase) => void; onError: (m: string) => void }) {
  const [radar, setRadar] = useState<Radar>();
  const [analyzing, setAnalyzing] = useState(false);
  const [opening, setOpening] = useState('');

  async function load() { try { setRadar(await api<Radar>('/radar')); } catch (e) { onError((e as Error).message); } }
  useEffect(() => { void load(); }, []);

  async function analyze() {
    setAnalyzing(true);
    try { const analysis = await api<RadarAnalysis>('/radar/analyze', {}); setRadar(r => r && { ...r, analysis }); }
    catch (e) { onError((e as Error).message); } finally { setAnalyzing(false); }
  }
  async function open(order: RadarOrder) {
    setOpening(order.id);
    try { onOpenCase(await api<RecoveryCase>(`/radar/${order.id}/case`, {})); }
    catch (e) { onError((e as Error).message); } finally { setOpening(''); }
  }

  if (!radar) return <div className="loading"><LoaderCircle className="spin"/>Scanning open orders…</div>;
  const live = config?.agent_mode && config.agent_mode !== 'demo';
  return <div className="radar">
    <section className="metrics" aria-label="Radar summary">
      <div className="metric"><div className="metric-top"><span>Orders monitored</span><span className="metric-icon"><RadarIcon size={19}/></span></div><div className="metric-value">{String(radar.orders.length).padStart(2, '0')}<span className="metric-rule"/></div><p>Open purchase orders in the order book</p></div>
      <div className="metric"><div className="metric-top"><span>High risk now</span><span className="metric-icon"><ShieldAlert size={19}/></span></div><div className="metric-value">{String(radar.counts.High).padStart(2, '0')}<span className="metric-rule"/></div><p>{radar.counts.Medium} medium · {radar.counts.Low} low</p></div>
      <div className="metric"><div className="metric-top"><span>Value at risk</span><span className="metric-icon"><span className="currency-icon">Rs</span></span></div><div className="metric-value small-value">{money(radar.value_at_risk)}<span className="metric-rule"/></div><p>PKR, weighted by risk level</p></div>
    </section>

    <div className="radar-grid">
      <section className="panel radar-chart-panel">
        <div className="panel-heading"><h3><CircleDot size={17}/>Risk matrix</h3><span className="chart-note">Schedule risk × country signals</span></div>
        <RiskMatrix orders={radar.orders}/>
      </section>
      <section className="panel analyst-panel">
        <div className="panel-heading"><h3><Sparkles size={17}/>AI risk analyst</h3>{radar.analysis && <small>{radar.analysis.engine}</small>}</div>
        <div className="analyst-body">
          {radar.analysis ? <>
            <p className="analyst-summary">{radar.analysis.summary}</p>
            {radar.analysis.priorities.length > 0 && <ol className="priority-list">{radar.analysis.priorities.map(p => { const o = radar.orders.find(x => x.id === p.id); return <li key={p.id}><strong>{p.id}</strong>{o && <RiskBadge level={o.level}/>}<p>{p.action}</p></li>; })}</ol>}
            <small className="muted-line">Updated {new Date(radar.analysis.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Advice only: you decide which orders to act on.</small>
          </> : <p className="analyst-summary">{radar.rule_summary}</p>}
          <button className="primary full" disabled={analyzing} onClick={() => void analyze()}>{analyzing ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>}{analyzing ? 'Analysing order book…' : live ? 'Run AI risk analysis' : 'Refresh rule-based analysis'}</button>
        </div>
      </section>
    </div>

    <section className="panel map-panel">
      <div className="panel-heading"><h3><CircleDot size={17}/>Country risk map</h3><span className="chart-note">Supplier origins coloured by current signal severity</span></div>
      <CountryMap radar={radar}/>
    </section>

    <section className="panel options-panel">
      <div className="table-caption"><p>Every open order, scored by days late ÷ days until needed, plus current country signals.</p><span>{radar.source}</span></div>
      <div className="table-scroll"><table aria-label="Order risk table">
        <thead><tr><th>Order</th><th>Item & origin</th><th>Schedule</th><th>Country signals</th><th>Risk</th><th><span className="sr-only">Action</span></th></tr></thead>
        <tbody>{radar.orders.map(o => { const linked = radar.linked_cases[o.id]; return <tr key={o.id}>
          <td><strong>{o.id}</strong><small>PKR {money(o.value)}</small></td>
          <td><strong>{o.quantity} × {o.item}</strong><small>{o.supplier} · {o.origin}</small></td>
          <td><strong>{o.variance_days > 0 ? `${o.variance_days} day${o.variance_days !== 1 ? 's' : ''} late` : o.variance_days === 0 ? 'No slack' : `${-o.variance_days} day early`}</strong><small>{o.schedule_risk_pct}% schedule risk · needed in {o.required_days} days</small></td>
          <td>{o.signal_ids.length ? <><strong>{o.signal_ids.join(', ')}</strong><small>{radar.signals.filter(s => o.signal_ids.includes(s.id)).map(s => s.category).join(' · ')}</small></> : <small>None</small>}</td>
          <td><RiskBadge level={o.level}/></td>
          <td>{o.level === 'Low' && !linked ? <small>Monitoring</small> : <button className={linked ? 'secondary small' : 'primary small'} disabled={opening === o.id} onClick={() => void open(o)} aria-label={`${linked ? 'Open case for' : 'Start recovery for'} ${o.id}`}>{opening === o.id ? <LoaderCircle size={13} className="spin"/> : <ArrowRight size={13}/>}{linked ? `Open ${linked.case_id}` : 'Start recovery'}</button>}</td>
        </tr>; })}</tbody>
      </table></div>
    </section>

    <section className="signal-grid" aria-label="Risk signals">{radar.signals.map(s => <div key={s.id} className="panel signal-card"><div className="signal-top"><strong>{s.id}</strong><span>{s.country} · {s.category}</span><span className="severity" aria-label={`Severity ${s.severity} of 3`}>{'●'.repeat(s.severity)}{'○'.repeat(3 - s.severity)}</span></div><p>{s.headline}</p></div>)}</section>
  </div>;
}

function RiskMatrix({ orders }: { orders: RadarOrder[] }) {
  const [hover, setHover] = useState<{ o: RadarOrder; x: number; y: number }>();
  const W = 640, H = 300, L = 54, R = 18, T = 18, B = 46;
  const maxPct = 60; // anything beyond is pinned to the right edge and labelled "≥60%"
  const xs = (p: number) => L + Math.min(p, maxPct) / maxPct * (W - L - R);
  const ys = (c: number) => H - B - c / 4 * (H - T - B);
  // Spread points that share a position so every order stays hoverable.
  const seen: Record<string, number> = {};
  const points = orders.map(o => { const key = `${Math.min(o.schedule_risk_pct, maxPct)}|${o.country_score}`; const n = seen[key] = (seen[key] ?? -1) + 1; return { o, cx: xs(o.schedule_risk_pct) + n * 14, cy: ys(o.country_score) }; });
  return <div className="matrix-wrap">
    <div className="chart-legend" aria-label="Legend">{(['High', 'Medium', 'Low'] as RiskLevel[]).map(l => <span key={l}><i style={{ background: STATUS[l].color }}/>{STATUS[l].icon}{l}</span>)}</div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Risk matrix: schedule risk percentage against country signal severity for each open order">
      {[5, 15].map(t => <g key={t}><line x1={xs(t)} x2={xs(t)} y1={T} y2={H - B} className="threshold"/><text x={xs(t) + 4} y={T + 10} className="axis-text">{t}%</text></g>)}
      {[0, 1, 2, 3, 4].map(c => <g key={c}><line x1={L} x2={W - R} y1={ys(c)} y2={ys(c)} className="gridline"/><text x={L - 10} y={ys(c) + 4} textAnchor="end" className="axis-text">{c}</text></g>)}
      {[0, 20, 40, 60].map(p => <text key={p} x={xs(p)} y={H - B + 18} textAnchor="middle" className="axis-text">{p === maxPct ? '≥60%' : `${p}%`}</text>)}
      <text x={(L + W - R) / 2} y={H - 8} textAnchor="middle" className="axis-title">Schedule risk (days late ÷ days until needed)</text>
      <text x={14} y={(T + H - B) / 2} textAnchor="middle" className="axis-title" transform={`rotate(-90 14 ${(T + H - B) / 2})`}>Country signal severity</text>
      {points.map(({ o, cx, cy }) => <g key={o.id} onMouseEnter={() => setHover({ o, x: cx, y: cy })} onMouseLeave={() => setHover(undefined)} tabIndex={0} onFocus={() => setHover({ o, x: cx, y: cy })} onBlur={() => setHover(undefined)} aria-label={`${o.id} ${o.item}: ${o.level} risk`}>
        <circle cx={cx} cy={cy} r={16} fill="transparent"/>
        <circle cx={cx} cy={cy} r={7} fill={STATUS[o.level].color} stroke="#fff" strokeWidth={2}/>
        {o.level === 'High' && <text x={cx > W - 110 ? cx - 12 : cx + 12} y={cy - 9} textAnchor={cx > W - 110 ? 'end' : 'start'} className="point-label">{o.id}</text>}
      </g>)}
    </svg>
    {hover && <div className="chart-tooltip" style={{ left: `${hover.x / W * 100}%`, top: `${hover.y / H * 100}%` }}><strong>{hover.o.id} · {hover.o.item}</strong><span>{hover.o.origin} · {hover.o.level} risk</span><span>{hover.o.variance_days > 0 ? `${hover.o.variance_days} days late` : 'On schedule'} · {hover.o.schedule_risk_pct}%</span><span>Signals: {hover.o.signal_ids.join(', ') || 'none'}</span></div>}
  </div>;
}

export function ReportModal({ data, onClose }: { data: RecoveryCase; onClose: () => void }) {
  useEffect(() => { document.body.classList.add('printing-report'); return () => document.body.classList.remove('printing-report'); }, []);
  const plan = data.plans.find(p => p.id === (data.approval?.plan_id || data.recommended_id));
  return <div className="modal-backdrop report-backdrop" onClick={onClose}>
    <section className="modal report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={e => e.stopPropagation()}>
      <div className="report-actions"><button className="primary" onClick={() => window.print()}><Printer size={15}/>Print / save as PDF</button><button className="icon-button" aria-label="Close report" onClick={onClose}><X size={18}/></button></div>
      <article className="report-print">
        <header><span className="eyebrow">REROUTE RECOVERY REPORT</span><h2 id="report-title">{data.title}</h2><p>{data.id}{data.source_po ? ` · from ${data.source_po}` : ''} · {new Date().toLocaleString()} · Status: {data.status}</p></header>
        <h3>1. Disruption</h3><p>{data.disruption}</p>
        <dl className="report-facts"><div><dt>Need</dt><dd>{data.quantity} × {data.item}</dd></div><div><dt>Deliver to</dt><dd>{data.location}</dd></div><div><dt>Budget</dt><dd>PKR {money(data.constraints.budget)}</dd></div><div><dt>Deadline</dt><dd>{data.constraints.deadline_days} days</dd></div><div><dt>Certified only</dt><dd>{data.constraints.certified_only ? 'Yes' : 'No'}</dd></div></dl>
        <h3>2. Recommendation</h3><p>{data.summary || 'No recommendation yet.'}</p>{data.sourcing_review && <p className="report-quote">Sourcing agent: {data.sourcing_review}</p>}
        <h3>3. Options compared</h3>
        {data.plans.length ? <table><thead><tr><th>Supplier</th><th>Total (PKR)</th><th>Delivery</th><th>Evidence</th><th>Assessment</th></tr></thead><tbody>{data.plans.map(p => <tr key={p.id}><td>{p.supplier}{p.id === data.recommended_id ? ' (recommended)' : ''}</td><td>{money(p.total)}</td><td>{p.lead_days} day{p.lead_days !== 1 ? 's' : ''}</td><td>{p.evidence_id}</td><td>{p.feasible ? 'Meets constraints' : p.blockers.join('; ')}</td></tr>)}</tbody></table> : <p>Not investigated yet.</p>}
        <h3>4. Human decisions</h3>
        {data.decisions.length ? <ul>{data.decisions.map((x, i) => <li key={i}><strong>{x.action === 'revised' ? 'Redirected' : x.action === 'approved' ? 'Approved' : 'Invalidated'} (v{x.version})</strong>: {x.action === 'revised' ? `${x.rejected?.length ? `rejected ${x.rejected.join(', ')}; ` : ''}${x.changes?.join('; ') || ''} "${x.note}"` : `${x.supplier || ''}${x.total ? ` · PKR ${money(x.total)}` : ''}${x.note ? ` · ${x.note}` : ''}`}</li>)}</ul> : <p>No decisions recorded yet.</p>}
        <h3>5. Outcome</h3>
        {data.execution ? <p>Draft purchase request <strong>{data.execution.id}</strong> for PKR {money(data.execution.total)}{plan ? ` with ${plan.supplier}` : ''} was created and verified by reading it back from the destination. No payment was sent; delivery is not yet confirmed.{data.dispatch ? ` Team notification: ${data.dispatch.status} (${data.dispatch.label}).` : ''}</p> : <p>No request has been created yet.</p>}
        <h3>6. Evidence</h3>
        <ul>{data.suppliers.map(s => <li key={s.id}><strong>{s.evidence_id}</strong> · {s.name}: {s.evidence}</li>)}</ul>
        <footer><FileText size={13}/> Generated by ReRoute. Supplier records in demo mode are synthetic. AI recommendations were checked against deterministic constraints, and every action required human approval.</footer>
      </article>
    </section>
  </div>;
}

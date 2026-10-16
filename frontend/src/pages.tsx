import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, ArrowUpRight, Banknote, Bot, Boxes, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock, Download, FileText, GitBranch, Globe, History, Inbox, LayoutGrid, Link, List, Lock, MapPin, MessageSquare, Package, PlugZap, Plus, Printer, Radar, RotateCcw, ScanSearch, Search, Send, ShieldAlert, ShieldCheck, Sparkles, Truck, Unplug, User, Workflow, X } from 'lucide-react';
import type { Config, Constraints, Plan, Radar as RadarData, RecoveryCase } from './types';
import { CountryCard, Dot, Ic, RiskMatrix, RiskPill, Rich, StatusPill, WorldMap, fmt, logKind, lvl, needsAttention, pad2, plural, splitLocation, status, time, type Level } from './ui';

export type Page = 'radar' | 'recovery' | 'ask' | 'flow' | 'suppliers' | 'connections';
export const SECTIONS: { id: Page; name: string; icon: typeof Radar }[] = [
  { id: 'radar', name: 'Risk radar', icon: Radar }, { id: 'recovery', name: 'Recovery', icon: LayoutGrid }, { id: 'ask', name: 'Ask ReRoute', icon: MessageSquare },
  { id: 'flow', name: 'Agent flow', icon: Workflow }, { id: 'suppliers', name: 'Suppliers', icon: Boxes }, { id: 'connections', name: 'Connections', icon: Link },
];
const HEADS: Record<Page, [string, string]> = {
  radar: ['See trouble before it arrives.', 'Your agents watch every open order and flag risks early. You decide which ones to act on.'],
  recovery: ['Keep your next move clear.', 'Turn disruptions into decisions. Your recovery team is ready.'],
  ask: ['Ask ReRoute.', 'Ask about your orders, risks and recovery cases. The AI explains; you decide.'],
  flow: ['Watch your agents work.', 'Every agent step, human decision and output for the selected case.'],
  suppliers: ['Your recovery network.', 'Inspect the supplier evidence behind your recovery options.'],
  connections: ['Connect the dots.', 'Know where your evidence comes from and where actions go.'],
};

export type Check = { name: string; ok: boolean; detail: string; ms: number };
export type Ctx = {
  page: Page; config?: Config; cases: RecoveryCase[]; active?: RecoveryCase; radar?: RadarData; busy: Record<string, boolean>;
  country: string | null; setCountry: (c: string | null) => void; setActive: (id: string) => void; go: (p: Page) => void;
  toast: (m: string) => void; openModal: (m: 'report-disruption' | 'report' | 'help') => void; exportCase: () => void;
  investigate: () => void; revise: (c: Constraints, note: string) => void; approve: (planId: string) => void; reconcile: () => void;
  withdraw: (supplierId: string) => void; redispatch: (confirm: boolean) => void; startRecovery: (orderId: string) => void; analyze: () => void;
  runChecks: () => Promise<Check[]>; disconnect: () => void;
};
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
const useApp = () => useContext(AppCtx);
const engineName = (config?: Config) => (config?.agent_mode === 'groq' ? 'Groq' : config?.agent_mode === 'anthropic' ? 'Claude' : 'Rule-based');

// ---------------------------------------------------------------- shared chrome
export function Head() {
  const { page, openModal } = useApp();
  const name = SECTIONS.find(s => s.id === page)!.name, [h, p] = HEADS[page];
  return <header className="head">
    <div className="rr-crumbs"><span className="brandword">ReRoute</span><Ic as={ChevronRight} sm/><b>{name}</b></div>
    <div className="head__row">
      <div><div className="rr-eyebrow">Supply chain resilience</div><h1>{h}</h1><p>{p}</p></div>
      <div className="head__actions">
        <span className="rr-avatars" title="Your recovery team: Investigator, Sourcing agent, Recovery planner"><span className="rr-avatar rr-avatar--coral">IN</span><span className="rr-avatar rr-avatar--lilac">SA</span><span className="rr-avatar rr-avatar--ink">RP</span></span>
        <button className="rr-btn rr-btn--primary" onClick={() => openModal('report-disruption')}><Ic as={Plus}/>Report disruption</button>
      </div>
    </div>
  </header>;
}
function Kpis() {
  const { cases } = useApp();
  return <section className="rr-panel stats" aria-label="Recovery summary">
    <div className="rr-stat"><div className="rr-stat__label">Open disruptions <Ic as={Package} sm/></div><div className="rr-stat__value">{pad2(cases.filter(needsAttention).length)}</div><div className="rr-stat__note">Across your recovery workspace</div></div>
    <div className="rr-stat"><div className="rr-stat__label">Awaiting your decision <Ic as={ShieldCheck} sm/></div><div className="rr-stat__value">{pad2(cases.filter(c => c.status === 'review').length)}</div><div className="rr-stat__note">Human judgment makes the difference</div></div>
    <div className="rr-stat"><div className="rr-stat__label">Verified requests <Ic as={CheckCheck} sm/></div><div className="rr-stat__value">{pad2(cases.filter(c => c.status === 'recovered').length)}</div><div className="rr-stat__note">Draft requests confirmed in the ledger</div></div>
  </section>;
}
function CaseSelector({ label }: { label: string }) {
  const { cases, active, setActive } = useApp();
  const [q, setQ] = useState('');
  const list = cases.filter(c => !q.trim() || `${c.title} ${c.id} ${c.item}`.toLowerCase().includes(q.trim().toLowerCase()));
  return <section className="grid">
    <div className="tools"><h2>{label} <span className="rr-count rr-count--quiet">{cases.length}</span></h2>
      <label className="rr-search" style={{ width: 'min(280px,100%)' }}><Ic as={Search} sm/><span className="sr">Search disruptions</span><input placeholder="Search disruptions…" value={q} onChange={e => setQ(e.target.value)}/></label></div>
    <div className="cases" role="list">{list.length ? list.map(c => <button key={c.id} role="listitem" className="case-card" aria-pressed={c.id === active?.id} onClick={() => setActive(c.id)}>
      <b><Dot level={status(c.status).dot}/>{c.title}</b><span><span className="mono">{c.id}</span> · {status(c.status).word}</span></button>) : <p className="muted small">No disruptions match that search.</p>}</div>
  </section>;
}
const Footer = () => { const { config } = useApp(); return <footer className="footer"><span>ReRoute · Find the next move.</span><span>{config?.tool_mode === 'demo' ? 'Demonstration data. Suppliers, prices and stock are synthetic.' : 'Connected supplier data.'}</span></footer>; };
function LogList({ c }: { c: RecoveryCase }) {
  const ICON = { ok: CheckCircle2, warn: AlertTriangle, ai: GitBranch, human: User };
  return <ol className="log">{[...c.events].reverse().map(e => { const k = logKind(e); return <li key={e.id}><span className={`lic lic--${k}`}><Ic as={ICON[k]}/></span><div><b className="strong small">{e.title}</b><div className="small muted">{e.detail}</div><div className="xs subtle">{e.actor}</div></div><span className="xs subtle num">{time(e.at)}</span></li>; })}</ol>;
}
const Empty = ({ text }: { text: string }) => <section className="rr-panel"><p className="pad small muted" style={{ margin: 0, paddingTop: 20 }}>{text}</p></section>;

// ---------------------------------------------------------------- Risk radar
function OrderGroup({ level, title }: { level: Level; title: string }) {
  const { radar, busy, startRecovery } = useApp();
  const [open, setOpen] = useState(true);
  const rows = radar!.orders.filter(o => lvl(o.level) === level);
  return <section className="rr-panel">
    <div className="rr-panel__head">
      <button className="rr-iconbtn group-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`} onClick={() => setOpen(!open)}><Ic as={ChevronUp} sm/></button>
      <span className="rr-chip-title">{title} <span className={`rr-count${level === 'low' ? ' rr-count--quiet' : ''}`}>{rows.length}</span></span>
      <span className="xs subtle" style={{ marginLeft: 'auto' }}>{level === 'low' ? 'Monitoring' : 'Act on these first'}</span>
    </div>
    {open && <div className="scroll-x" style={{ padding: '0 8px 8px' }}><table className="rr-table" aria-label={`${title} orders`}><thead><tr><th>Order</th><th>Item &amp; origin</th><th>Schedule</th><th>Country signals</th><th>Risk</th><th><span className="sr">Action</span></th></tr></thead><tbody>
      {rows.map(o => { const linked = radar!.linked_cases[o.id]; const sigs = radar!.signals.filter(s => o.signal_ids.includes(s.id)); return <tr key={o.id}>
        <td><b className="strong">{o.id}</b><div className="meta num">PKR {fmt(o.value)}</div></td>
        <td>{o.quantity} × {o.item}<div className="meta">{o.supplier} · {o.origin}</div></td>
        <td>{o.variance_days > 0 ? `${plural(o.variance_days, 'day')} late` : o.variance_days === 0 ? 'No slack' : `${plural(-o.variance_days, 'day')} early`}<div className="meta num">{o.schedule_risk_pct}% schedule risk · needed in {o.required_days} days</div></td>
        <td>{sigs.length ? <><div className="row" style={{ gap: 4 }}>{sigs.map(s => <span key={s.id} className="rr-tag rr-tag--outline">{s.id}</span>)}</div><div className="meta">{sigs.map(s => s.category).join(' · ')}</div></> : <span className="meta">None</span>}</td>
        <td><RiskPill level={lvl(o.level)}/></td>
        <td style={{ textAlign: 'right' }}>{level === 'low' && !linked ? <span className="meta">Monitoring</span> : <button className={`rr-btn ${linked ? 'rr-btn--secondary' : 'rr-btn--accent'} rr-btn--sm`} disabled={busy[o.id]} onClick={() => startRecovery(o.id)} aria-label={`${linked ? `Open ${linked.case_id} for` : 'Start recovery for'} ${o.id}`}><Ic as={busy[o.id] ? RotateCcw : ArrowRight} sm className={busy[o.id] ? 'spin' : ''}/>{linked ? `Open ${linked.case_id}` : 'Start recovery'}</button>}</td>
      </tr>; })}
    </tbody></table></div>}
  </section>;
}
export function RadarPage() {
  const { radar, config, busy, analyze, country, setCountry } = useApp();
  if (!radar) return <><Head/><Empty text="Scanning open orders…"/></>;
  const a = radar.analysis, live = config?.agent_mode && config.agent_mode !== 'demo';
  return <>
    <Head/>
    <section className="rr-panel stats" aria-label="Risk summary">
      <div className="rr-stat"><div className="rr-stat__label">Orders monitored <Ic as={Radar} sm/></div><div className="rr-stat__value">{pad2(radar.orders.length)}</div><div className="rr-stat__note">Open purchase orders in the order book</div></div>
      <div className="rr-stat"><div className="rr-stat__label">High risk now <Ic as={ShieldAlert} sm/></div><div className="rr-stat__value">{pad2(radar.counts.High)}</div><div className="rr-stat__note">{radar.counts.Medium} medium · {radar.counts.Low} low</div></div>
      <div className="rr-stat"><div className="rr-stat__label">Value at risk <Ic as={Banknote} sm/></div><div className="rr-stat__value num">{fmt(radar.value_at_risk)}</div><div className="rr-stat__note">PKR, weighted by risk level</div></div>
    </section>
    <div className="split">
      <section className="rr-panel matrix">
        <div className="panel-head"><h2 className="panel-title"><Ic as={Radar}/>Risk matrix</h2><span className="aside">Schedule risk × country signals</span></div>
        <div className="pad"><div className="legend" style={{ marginBottom: 8 }}><span><Dot level="high"/>High</span><span><Dot level="medium"/>Medium</span><span><Dot level="low"/>Low</span></div><RiskMatrix orders={radar.orders} onPick={c => setCountry(c)}/></div>
      </section>
      <section className="rr-panel" aria-label="AI risk analyst">
        <div className="panel-head"><h2 className="panel-title"><Ic as={Sparkles}/>AI risk analyst</h2><span className="aside">{a?.engine || (live ? `${engineName(config)} · ${config?.model}` : 'Rule-based demo analyst')}</span></div>
        <div className="pad stack">
          <p className="small" style={{ margin: 0 }}>{a?.summary || radar.rule_summary}</p>
          {(a?.priorities || []).map(p => { const o = radar.orders.find(x => x.id === p.id); return <div key={p.id} className="solid-card priority" style={{ padding: '12px 14px', display: 'grid', gap: 6 }}><div className="row"><b className="strong">{p.id}</b>{o && <RiskPill level={lvl(o.level)}/>}</div><span className="small muted">{p.action}</span></div>; })}
          <p className="xs subtle" style={{ margin: 0 }}>{a ? `Updated ${time(a.at)}. ` : ''}Advice only: you decide which orders to act on.</p>
          <button className="rr-btn rr-btn--primary rr-btn--lg rr-btn--block" disabled={busy.analysis} onClick={analyze}><Ic as={busy.analysis ? RotateCcw : Sparkles} className={busy.analysis ? 'spin' : ''}/>{busy.analysis ? `Analysing ${radar.orders.length} orders…` : live ? 'Run AI risk analysis' : 'Refresh rule-based analysis'}</button>
        </div>
      </section>
    </div>
    <section className="rr-panel">
      <div className="panel-head"><h2 className="panel-title"><Ic as={Globe}/>Country risk map</h2>
        <div className="legend" style={{ marginLeft: 'auto' }}><span><Dot level="high"/>High</span><span><Dot level="medium"/>Medium</span><span><Dot level="low"/>Low</span><span><Dot level="lilac"/>Destination</span></div></div>
      <div className="mapwrap"><div className="map"><WorldMap radar={radar} selected={country} onPick={setCountry}/></div><CountryCard radar={radar} country={country} onPick={setCountry}/></div>
    </section>
    <div className="grid">
      <div className="tools"><h2>Open orders <span className="xs subtle" style={{ fontWeight: 400 }}>Scored by days late ÷ days until needed, plus current country signals</span></h2></div>
      <OrderGroup level="high" title="High risk"/><OrderGroup level="medium" title="Medium risk"/><OrderGroup level="low" title="Low risk"/>
    </div>
    <section className="grid"><div className="tools"><h2>Signal feed <span className="rr-count rr-count--quiet">{radar.signals.length}</span></h2><span className="xs subtle">{radar.source}</span></div>
      <div className="signals">{radar.signals.map(s => <article key={s.id} className="rr-panel signal"><div className="signal__top"><span><b className="strong">{s.id}</b> · {s.country} · {s.category}</span><span className="sev" aria-label={`Severity ${s.severity} of 3`}>{[1, 2, 3].map(i => <i key={i} className={i <= s.severity ? 'on' : ''}/>)}</span></div><p className="small" style={{ margin: 0 }}>{s.headline}</p></article>)}</div>
    </section>
    <Footer/>
  </>;
}

// ---------------------------------------------------------------- Recovery
const STEP_DONE: Record<string, number> = { open: 0, investigating: 0, error: 0, review: 2, blocked: 2, approved: 3, executing: 3, execution_error: 3, recovered: 4 };
function Stepper({ c }: { c: RecoveryCase }) {
  const done = STEP_DONE[c.status] ?? 0;
  return <div className="steps">{['Investigate', 'Find alternatives', 'Human review', 'Execute & verify'].map((n, i) => <React.Fragment key={n}>{i > 0 && <span className="step-line"/>}<span className={`step ${i < done ? 'done' : i === done ? 'now' : ''}`}><span className="b">{i < done ? <Ic as={Check} sm/> : i + 1}</span>{n}</span></React.Fragment>)}</div>;
}
const letter = (p: Plan) => p.supplier[0];
const ordered = (c: RecoveryCase) => { const rec = c.plans.find(p => p.id === c.recommended_id); return rec ? [rec, ...c.plans.filter(p => p !== rec)] : c.plans; };
const editable = (c: RecoveryCase) => ['review', 'blocked', 'approved'].includes(c.status);

type Desk = { budget: string; days: string; cert: boolean; excluded: string[]; notes: string };
const deskFrom = (c: RecoveryCase): Desk => ({ budget: String(c.constraints.budget), days: String(c.constraints.deadline_days), cert: c.constraints.certified_only, excluded: [...c.constraints.excluded_suppliers], notes: '' });
const deskDirty = (c: RecoveryCase, d: Desk) => +d.budget !== c.constraints.budget || +d.days !== c.constraints.deadline_days || d.cert !== c.constraints.certified_only || d.excluded.join() !== c.constraints.excluded_suppliers.join() || d.notes.trim() !== '';

function OptionsTable({ c, desk, setDesk, selected, setSelected }: { c: RecoveryCase; desk: Desk; setDesk: (d: Desk) => void; selected: string; setSelected: (s: string) => void }) {
  const { busy } = useApp();
  const locked = !editable(c) || busy[c.id];
  const toggle = (id: string) => setDesk({ ...desk, excluded: desk.excluded.includes(id) ? desk.excluded.filter(x => x !== id) : [...desk.excluded, id] });
  return <>
    <div className="row small muted" style={{ justifyContent: 'space-between', padding: '0 20px 12px' }}><span>Compare the trade-offs. Choose the next move.</span><span className="xs subtle">All costs in PKR</span></div>
    <div className="scroll-x" style={{ padding: '0 8px' }}><table className="rr-table" aria-label="Recovery options"><thead><tr><th></th><th>Supplier / plan</th><th>Total cost</th><th>Arrival</th><th>Assessment</th><th><span className="sr">Choose</span></th><th><span className="sr">Reject</span></th></tr></thead><tbody>
      {ordered(c).map(o => { const pending = desk.excluded.includes(o.id) && !c.constraints.excluded_suppliers.includes(o.id); const restoring = !desk.excluded.includes(o.id) && c.constraints.excluded_suppliers.includes(o.id); const rejected = desk.excluded.includes(o.id); const sel = selected === o.id;
        return <tr key={o.id} className={`opt-row ${o.feasible && !pending ? '' : 'is-blocked'} ${sel ? 'is-selected' : ''}`}>
          <td><span className="letter">{letter(o)}</span></td>
          <td><b className="strong">{o.supplier}</b><div className="meta">{o.location}</div>{o.id === c.recommended_id && <span className="rr-tag rr-tag--ink" style={{ marginTop: 4, height: 20, fontSize: 11 }}>Recommended</span>}</td>
          <td><span className="num strong">{fmt(o.total)}</span><div className="meta num">{o.savings >= 0 ? `${fmt(o.savings)} under budget` : `${fmt(-o.savings)} over budget`}</div></td>
          <td><span className="row" style={{ gap: 6 }}><Ic as={Truck} sm/>{plural(o.lead_days, 'day')}</span></td>
          <td>{pending ? <><span className="rr-pill rr-pill--high"><Ic as={X}/>Rejection pending</span><div className="meta">Replan to apply</div></> : restoring ? <><span className="rr-pill"><Ic as={RotateCcw}/>Restore pending</span><div className="meta">Replan to apply</div></> : o.feasible ? <><span className="rr-pill rr-pill--low"><Ic as={Check}/>Meets constraints</span><div className="meta">{o.certified ? 'Certification provided' : 'Not certified'}</div></> : <><span className="rr-pill rr-pill--medium"><Ic as={AlertTriangle}/>Blocked</span><div className="meta">{o.blockers.join(' · ')}</div></>}</td>
          <td><input type="radio" className="radio" name={`opt-${c.id}`} aria-label={`Choose ${o.supplier}`} checked={sel} disabled={!o.feasible || pending || locked} onChange={() => setSelected(o.id)}/></td>
          <td style={{ textAlign: 'right' }}>{!locked && (rejected ? <button className="rr-btn rr-btn--secondary rr-btn--sm" onClick={() => toggle(o.id)} aria-label={`Restore ${o.supplier}`}><Ic as={RotateCcw} sm/>Restore</button> : <button className="rr-btn rr-btn--danger rr-btn--sm" onClick={() => toggle(o.id)} aria-label={`Reject ${o.supplier}`}><Ic as={X} sm/>Reject</button>)}</td>
        </tr>; })}
    </tbody></table></div>
  </>;
}
function EvidenceTab({ c }: { c: RecoveryCase }) {
  return <div className="pad stack"><h3 className="panel-title" style={{ fontSize: 14 }}>Agent evidence review</h3>
    <div className="small muted">{c.sourcing_review ? <Rich text={c.sourcing_review}/> : <p style={{ margin: 0 }}>Supplier quotes were checked against your constraints in code. Connect a live model for an AI evidence review.</p>}</div>
    {c.suppliers.map(s => <details key={s.id} className="accordion"><summary><Ic as={FileText} sm/><b className="strong small">{s.evidence_id}</b><span className="xs subtle">{s.name}</span><Ic as={ChevronDown} sm className="chev"/></summary><div className="body small"><span>{s.evidence}</span><span className="xs subtle">Unit PKR {fmt(s.unit_price)} · shipping PKR {fmt(s.shipping)} · {s.stock} in stock · {plural(s.lead_days, 'day')}{s.available ? '' : ' · availability withdrawn'}</span><span className="xs subtle">Source: {c.evidence_source}</span></div></details>)}</div>;
}
function OutcomeBanner({ c, selected, dirty }: { c: RecoveryCase; selected?: Plan; dirty: boolean }) {
  const { busy, investigate, approve, reconcile, exportCase, redispatch } = useApp();
  const b = busy[c.id];
  if (c.status === 'recovered' && c.execution) {
    const d = c.dispatch;
    return <section className="banner banner--ok"><span className="ic"><Ic as={CheckCheck}/></span><div><b>Recovery request verified.</b><div className="small"><span className="mono">{c.execution.id}</span> · PKR {fmt(c.execution.total)} · Saved as a draft</div><div className="meta">Destination read-back matches your approval. Delivery is not yet confirmed.{d ? ` Team notification: ${d.status === 'sent' ? `sent via ${d.label}` : d.status}.` : ''}</div>{d && (d.status === 'failed' || d.status === 'unknown') && <button className="rr-btn rr-btn--secondary rr-btn--sm" style={{ marginTop: 8 }} onClick={() => redispatch(d.status === 'unknown')}>{d.status === 'unknown' ? 'Confirm & resend' : 'Retry notification'}</button>}</div><button className="rr-iconbtn" onClick={exportCase} aria-label="Export case as JSON"><Ic as={Download}/></button></section>;
  }
  if (c.status === 'error') return <section className="banner banner--bad"><span className="ic"><Ic as={AlertTriangle}/></span><div><b>Investigation failed.</b><div className="meta">{[...c.events].reverse().find(e => e.kind === 'error')?.detail || 'The provider did not respond.'}</div></div><button className="rr-btn rr-btn--primary" disabled={b} onClick={investigate}><Ic as={RotateCcw} className={b ? 'spin' : ''}/>{b ? 'Investigating…' : 'Retry investigation'}</button></section>;
  if (c.status === 'open' || c.status === 'investigating') return <section className="banner banner--warn"><span className="ic"><Ic as={ScanSearch}/></span><div><b>{c.status === 'investigating' ? 'Investigating…' : 'Needs investigation.'}</b><div className="meta">Your investigator will scope the disruption and pull supplier quotes. Nothing is ordered without your approval.</div></div><button className="rr-btn rr-btn--primary" disabled={b || c.status === 'investigating'} onClick={investigate}><Ic as={b || c.status === 'investigating' ? RotateCcw : ScanSearch} className={b || c.status === 'investigating' ? 'spin' : ''}/>{b || c.status === 'investigating' ? 'Investigating…' : 'Run investigation'}</button></section>;
  if (c.status === 'execution_error' || c.status === 'approved' || c.status === 'executing') return <section className="banner banner--bad"><span className="ic"><Ic as={AlertTriangle}/></span><div><b>{c.status === 'executing' ? 'Executing…' : 'Execution needs reconciliation.'}</b><div className="meta">The approved request could not be confirmed. Retrying checks the same request key first, so nothing is duplicated.</div></div><button className="rr-btn rr-btn--primary" disabled={b || c.status === 'executing'} onClick={reconcile}><Ic as={RotateCcw} className={b ? 'spin' : ''}/>{b ? 'Executing…' : 'Reconcile & retry'}</button></section>;
  if (c.status === 'blocked') return <section className="banner banner--bad"><span className="ic"><Ic as={AlertTriangle}/></span><div><b>No supplier meets every constraint.</b><div className="meta">Relax the budget or deadline, or restore a rejected supplier, then replan.</div></div><span/></section>;
  return <section className="banner banner--warn"><span className="ic"><Ic as={ShieldCheck}/></span><div><b>Awaiting your decision.</b><div className="meta">{dirty ? 'You changed the constraints. Revise & replan before approving.' : selected ? `Approving creates a draft request for ${selected.supplier} at PKR ${fmt(selected.total)}. Availability is re-checked first.` : 'No feasible option is selected. Adjust your constraints and replan.'}</div></div><button className="rr-btn rr-btn--primary" disabled={!selected || dirty || b} onClick={() => selected && approve(selected.id)}><Ic as={b ? RotateCcw : Check} className={b ? 'spin' : ''}/>{b ? 'Executing…' : 'Approve plan'}</button></section>;
}
function DecisionDesk({ c, desk, setDesk, selected }: { c: RecoveryCase; desk: Desk; setDesk: (d: Desk) => void; selected?: Plan }) {
  const { busy, revise, withdraw, config } = useApp();
  const locked = !editable(c) || busy[c.id];
  const dirty = deskDirty(c, desk);
  const name = (id: string) => c.plans.find(p => p.id === id)?.supplier || id;
  function replan() {
    const budget = +desk.budget, days = +desk.days;
    if (!(budget > 0) || !(days > 0)) return;
    const auto: string[] = [];
    const added = desk.excluded.filter(x => !c.constraints.excluded_suppliers.includes(x)).map(name), removed = c.constraints.excluded_suppliers.filter(x => !desk.excluded.includes(x)).map(name);
    if (added.length) auto.push(`Rejected ${added.join(', ')}`); if (removed.length) auto.push(`Restored ${removed.join(', ')}`);
    if (budget !== c.constraints.budget) auto.push(`Budget PKR ${fmt(budget)}`); if (days !== c.constraints.deadline_days) auto.push(`${days}-day deadline`); if (desk.cert !== c.constraints.certified_only) auto.push(desk.cert ? 'Certified only' : 'Certification optional');
    revise({ budget, deadline_days: days, certified_only: desk.cert, excluded_suppliers: desk.excluded }, desk.notes.trim() || `${auto.join('. ') || 'Instructions updated'}.`);
  }
  const TONE = { revised: 'coral', approved: 'lilac', invalidated: 'coral' } as const;
  const team: [string, string, string, string, boolean][] = [['IN', 'coral', 'Investigator', 'Scopes the disruption', c.version > 0], ['SA', 'lilac', 'Sourcing agent', 'Checks alternatives', c.plans.length > 0], ['RP', 'ink', 'Recovery planner', 'Builds the next move', !!c.summary]];
  return <aside className="desk">
    <section className="rr-panel" aria-label="Decision desk">
      <div className="panel-head"><h2 className="panel-title"><Ic as={ShieldCheck}/>Decision desk</h2><span className="aside"><Dot level={status(c.status).dot}/></span></div>
      <div className="desk__body">
        <div><div className="rr-eyebrow">Human + AI, together</div><div style={{ font: '600 18px/24px var(--font-sans)', marginTop: 4 }}>You set the direction.</div><p className="small muted" style={{ margin: '4px 0 0' }}>Review the evidence, adjust your constraints, and approve the plan you trust.</p></div>
        <label className="rr-field"><span>Total budget <em className="subtle" style={{ fontStyle: 'normal' }}>PKR</em></span><input className="rr-input num" inputMode="numeric" aria-label="Total budget" value={desk.budget} disabled={locked} onChange={e => setDesk({ ...desk, budget: e.target.value.replace(/[^\d]/g, '') })}/></label>
        <label className="rr-field"><span>Delivery within <em className="subtle" style={{ fontStyle: 'normal' }}>days</em></span><input className="rr-input num" inputMode="numeric" aria-label="Delivery within" value={desk.days} disabled={locked} onChange={e => setDesk({ ...desk, days: e.target.value.replace(/[^\d]/g, '') })}/></label>
        <label className="row small" style={{ gap: 10, alignItems: 'flex-start' }}><input type="checkbox" className="rr-check" checked={desk.cert} disabled={locked} onChange={e => setDesk({ ...desk, cert: e.target.checked })}/><span>Require certified compatibility<div className="xs subtle">Exclude unverified substitutes</div></span></label>
        <div className="rr-field"><span>Rejected suppliers</span><div className="chips">{desk.excluded.length ? desk.excluded.map(id => <button key={id} className="chip" disabled={locked} aria-label={`Restore ${name(id)}`} onClick={() => setDesk({ ...desk, excluded: desk.excluded.filter(x => x !== id) })}>{name(id)} {!locked && <Ic as={X} sm/>}</button>) : <span className="xs subtle">None. Use Reject in the options table.</span>}</div></div>
        <label className="rr-field"><span>Instructions for your agents</span><textarea className="rr-textarea" aria-label="Instructions for your agents" placeholder="Why are you rejecting this supplier? Your agents use this reasoning when they replan." value={desk.notes} disabled={locked} maxLength={2000} onChange={e => setDesk({ ...desk, notes: e.target.value })}/></label>
        <button className="rr-btn rr-btn--secondary rr-btn--block" disabled={locked || !dirty} onClick={replan}><Ic as={RotateCcw} sm className={busy[c.id] ? 'spin' : ''}/>Revise &amp; replan</button>
        {c.status === 'recovered' ? <div className="row small" style={{ color: 'var(--green-ink)' }}><Ic as={CheckCheck} sm/>Approved action verified</div> : locked && !busy[c.id] ? <div className="xs subtle">Constraints unlock once the investigation finishes.</div> : null}
        {config?.tool_mode === 'demo' && c.status === 'review' && selected && <details className="accordion scenario"><summary><Ic as={Unplug} sm/><span className="small">Demo scenario controls</span><Ic as={ChevronDown} sm className="chev"/></summary><div className="body small"><span className="muted">Simulate the selected supplier withdrawing before you approve. The execution guard will catch it and your agents re-plan.</span><button className="rr-btn rr-btn--secondary rr-btn--sm" style={{ justifySelf: 'start' }} disabled={busy[c.id] || c.withdrawn_suppliers.includes(selected.id)} onClick={() => withdraw(selected.id)}><Ic as={Unplug} sm/>Withdraw {selected.supplier}</button></div></details>}
      </div>
    </section>
    <section className="rr-panel" aria-label="How this plan evolved"><div className="panel-head"><h2 className="panel-title"><Ic as={GitBranch}/>How this plan evolved</h2></div>
      {c.decisions.length ? <ol className="timeline">{c.decisions.map((h, i) => <li key={i}><span className="dot" style={{ background: `var(--${TONE[h.action]})` }}/><div><div className="k">{h.action === 'revised' ? 'Redirected' : h.action === 'approved' ? 'Approved' : 'Invalidated'} · V{h.version}</div><div className="small">{h.action === 'revised' ? <>{h.rejected?.length ? <>Rejected <b>{h.rejected.join(', ')}</b>. </> : null}{h.changes?.length ? `${h.changes.join(' · ')}. ` : ''}“{h.note}”</> : h.action === 'approved' ? <><b>{h.supplier}</b> · PKR {fmt(h.total || 0)}</> : <><b>{h.supplier}</b>: {h.note}. Nothing was created.</>}</div></div></li>)}</ol> : <p className="pad small muted" style={{ margin: 0 }}>No decisions yet.</p>}
    </section>
    <section className="rr-panel"><div className="panel-head"><h2 className="panel-title"><Ic as={Bot}/>Your recovery team</h2><span className="aside">LangGraph · {engineName(config)} agents</span></div>
      <div className="team">{team.map(([a, t, n, d, ok]) => <div key={n}><span className={`rr-avatar rr-avatar--${t}`}>{a}</span><div><b className="strong small">{n}</b><div className="xs subtle">{d}</div></div>{ok ? <span style={{ color: 'var(--green-ink)' }}><Ic as={Check} sm/></span> : <span className="xs subtle">Idle</span>}</div>)}</div>
    </section>
  </aside>;
}
export function RecoveryPage() {
  const { active: c, config, openModal, exportCase } = useApp();
  const [tab, setTab] = useState<'options' | 'evidence' | 'activity'>('options');
  const [desk, setDesk] = useState<Desk | null>(null);
  const [selected, setSelected] = useState('');
  useEffect(() => { if (c) { setDesk(deskFrom(c)); setSelected(c.approval?.plan_id || c.recommended_id || ''); } }, [c?.id, c?.version, c?.status]);
  useEffect(() => { setTab('options'); }, [c?.id]);
  if (!c || !desk) return <><Head/><Kpis/><CaseSelector label="Recovery workspace"/><Empty text="No recovery cases yet. Start one from Risk radar or report a disruption."/><Footer/></>;
  const { city, site } = splitLocation(c.location);
  const hasPlan = c.plans.length > 0, dirty = deskDirty(c, desk);
  const sel = c.plans.find(p => p.id === selected && p.feasible && !desk.excluded.includes(p.id));
  return <>
    <Head/><Kpis/><CaseSelector label="Recovery workspace"/>
    <div className="split split--side">
      <div className="grid" style={{ minWidth: 0 }}>
        <section className="rr-panel">
          <div className="case-head">
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="mono subtle">{c.id}{c.source_po ? ` · ${c.source_po}` : ''}</span><StatusPill c={c}/></div>
            <div><h2>{c.title}</h2><p className="muted" style={{ margin: '6px 0 0' }}>{c.disruption}</p></div>
            <div className="facts">
              <div className="fact"><Ic as={Package} sm/><b>{c.quantity} units</b><small>{c.item}</small></div>
              <div className="fact"><Ic as={MapPin} sm/><b>{city}</b><small>{site}</small></div>
              <div className="fact"><Ic as={Clock} sm/><b>{c.constraints.deadline_days}-day deadline</b><small>Maximum lead time</small></div>
              <div className="fact"><Ic as={Banknote} sm/><b className="num">{fmt(c.constraints.budget)}</b><small>Budget · PKR</small></div>
            </div>
          </div>
          <Stepper c={c}/>
        </section>
        {c.alert && <section className="banner banner--bad" role="status"><span className="ic"><Ic as={AlertTriangle}/></span><div><b>{c.alert.title}</b><div className="meta">{c.alert.detail}</div></div><span/></section>}
        {hasPlan && c.summary && <section className="ai-card"><span className="ai-ic"><Ic as={Sparkles}/></span><div><b style={{ fontWeight: 600 }}>Your recovery brief</b><p className="small" style={{ margin: '6px 0 8px' }}>{c.summary}</p><span className="xs" style={{ color: 'var(--lilac-ink)' }}>{engineName(config)} planner · Plan version {c.version} · Evidence-backed constraints</span></div></section>}
        <OutcomeBanner c={c} selected={sel} dirty={dirty}/>
        {hasPlan ? <section className="rr-panel">
          <div className="panel-head"><div className="rr-tabs" role="tablist">{([['options', 'Recovery options', c.plans.length], ['evidence', 'Source evidence', 0], ['activity', 'Activity', c.events.length]] as const).map(([id, n, k]) => <button key={id} className="rr-tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{n}{k ? <> <span className="rr-count rr-count--quiet">{k}</span></> : null}</button>)}</div></div>
          {tab === 'options' ? <><OptionsTable c={c} desk={desk} setDesk={setDesk} selected={selected} setSelected={setSelected}/><div className="row xs subtle" style={{ justifyContent: 'space-between', padding: '12px 20px 16px' }}><span className="row" style={{ gap: 6 }}><Ic as={ShieldCheck} sm/>Availability is checked again before execution.</span><button className="rr-btn rr-btn--ghost rr-btn--sm" onClick={() => setTab('evidence')}>Inspect evidence <Ic as={ArrowUpRight} sm/></button></div></> : tab === 'evidence' ? <EvidenceTab c={c}/> : <LogList c={c}/>}
        </section> : <section className="rr-panel"><div className="panel-head"><h2 className="panel-title"><Ic as={History}/>Activity</h2></div><LogList c={c}/></section>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="xs subtle">{config?.tool_mode === 'demo' ? 'Demonstration data. Suppliers, prices and stock are synthetic.' : 'Connected supplier data.'}</span>
          <span className="row"><button className="rr-btn rr-btn--secondary rr-btn--sm" disabled={!hasPlan} onClick={() => openModal('report')}><Ic as={FileText} sm/>Recovery report</button><button className="rr-btn rr-btn--ghost rr-btn--sm" onClick={exportCase}><Ic as={Download} sm/>Export case</button></span>
        </div>
      </div>
      <DecisionDesk c={c} desk={desk} setDesk={setDesk} selected={sel}/>
    </div>
    <Footer/>
  </>;
}

// ---------------------------------------------------------------- Ask ReRoute
type Msg = { me: boolean; text: string; engine?: string };
type Chat = { id: string; title: string; caseId: string; when: string; msgs: Msg[] };
const CHATS = 'reroute-chats';
const loadChats = (): Chat[] => { try { return JSON.parse(localStorage.getItem(CHATS) || '[]'); } catch { return []; } };
export function AskPage({ ask }: { ask: (q: string, caseId?: string) => Promise<{ answer: string; engine: string }> }) {
  const { cases, active, radar, setCountry, go } = useApp();
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [chatId, setChatId] = useState<string | null>(null);
  const [ctxCase, setCtxCase] = useState<string>(active?.id || '');
  const [q, setQ] = useState('');
  const [typing, setTyping] = useState(false);
  const msgsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { try { localStorage.setItem(CHATS, JSON.stringify(chats.slice(0, 20))); } catch { /* storage unavailable */ } }, [chats]);
  useEffect(() => { msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight }); }, [chats, chatId, typing]);
  const chat = chats.find(x => x.id === chatId);
  const caseId = chat ? chat.caseId : ctxCase;
  const caseLabel = caseId || 'Order book';
  const suggestions = ['Which orders should I act on first?', ...(caseId ? [`Why was this plan recommended for ${caseId}?`, 'Which supplier is the safest choice and why?', 'What did the human reviewer change?'] : ['Which countries are causing the risk?'])];
  async function send(text: string) {
    const question = text.trim(); if (question.length < 2 || typing) return;
    let id = chatId;
    if (!id) { id = `c${Date.now()}`; const fresh: Chat = { id, title: question, caseId, when: new Date().toLocaleDateString('en-GB'), msgs: [] }; setChats(all => [fresh, ...all]); setChatId(id); }
    const cid = id;
    setChats(all => all.map(x => (x.id === cid ? { ...x, msgs: [...x.msgs, { me: true, text: question }] } : x)));
    setQ(''); setTyping(true);
    try { const r = await ask(question, caseId || undefined); setChats(all => all.map(x => (x.id === cid ? { ...x, msgs: [...x.msgs, { me: false, text: r.answer, engine: r.engine }] } : x))); }
    catch (e) { setChats(all => all.map(x => (x.id === cid ? { ...x, msgs: [...x.msgs, { me: false, text: (e as Error).message, engine: 'Error' }] } : x))); }
    finally { setTyping(false); }
  }
  const mentioned = (text: string) => (radar ? radar.orders.filter(o => text.replace(/[‐-―]/g, '-').includes(o.id)) : []);
  const greet = 'Hello. I watch your open orders and recovery cases. Ask me which orders are at risk, why a plan was recommended, or what changed in a case. I can explain, but you make every decision.';
  return <>
    <Head/>
    <div className="chat">
      <div className="chat__side">
        <button className="rr-btn rr-btn--primary rr-btn--lg rr-btn--block" onClick={() => { setChatId(null); setQ(''); }}><Ic as={MessageSquare}/>New chat</button>
        <div className="recent"><div className="rr-eyebrow" style={{ padding: '8px 12px 0' }}>Recent</div>{chats.length ? chats.map(x => <button key={x.id} aria-current={x.id === chatId} onClick={() => setChatId(x.id)}><span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.title}</span><span className="xs subtle">{x.caseId || 'Order book'} · {x.when}</span></button>) : <p className="xs subtle" style={{ padding: '0 12px' }}>No chats yet.</p>}</div>
      </div>
      <section className="rr-panel chat__panel">
        <div className="chat__bar"><label className="row small" htmlFor="ctx">Context</label><select className="select" id="ctx" value={caseId} disabled={!!chat} onChange={e => setCtxCase(e.target.value)}><option value="">Order book and risk signals</option>{cases.map(x => <option key={x.id} value={x.id}>{x.id} · {x.title}</option>)}</select>
          <span className="row xs" style={{ marginLeft: 'auto', color: 'var(--lilac-ink)', gap: 6 }}><Ic as={ShieldCheck} sm/>Read-only: the AI explains, you decide</span></div>
        <div className="msgs" ref={msgsRef} aria-live="polite">
          <div className="msg"><span className="rr-avatar rr-avatar--lilac"><Ic as={Bot} sm/></span><div className="bubble small"><p>{greet}</p></div></div>
          {(chat?.msgs || []).map((m, i) => m.me
            ? <div key={i} className="msg msg--me"><div className="bubble small">{m.text}</div><span className="rr-avatar rr-avatar--ink"><Ic as={User} sm/></span></div>
            : <div key={i} className="msg"><span className="rr-avatar rr-avatar--lilac"><Ic as={Bot} sm/></span><div className="bubble small"><Rich text={m.text}/>
                {mentioned(m.text).length > 0 && <div className="stack" style={{ gap: 6, marginTop: 8 }}>{mentioned(m.text).map(o => <button key={o.id} className="solid-card row" style={{ border: 0, cursor: 'pointer', justifyContent: 'space-between', padding: '10px 12px', font: 'inherit', color: 'inherit' }} onClick={() => { setCountry(o.origin === 'UAE' ? 'United Arab Emirates' : o.origin); go('radar'); }}><span className="small"><b className="strong">{o.id}</b> <span className="muted">{o.item}</span></span><RiskPill level={lvl(o.level)}/></button>)}</div>}
                {m.engine && <div className="xs subtle" style={{ marginTop: 6 }}>{m.engine}</div>}</div></div>)}
          {typing && <div className="msg"><span className="rr-avatar rr-avatar--lilac"><Ic as={Bot} sm/></span><div className="bubble" aria-label="ReRoute is thinking"><span className="typing"><i/><i/><i/></span></div></div>}
          {!typing && <div className="suggest">{suggestions.map(s => <button key={s} className="rr-btn rr-btn--secondary rr-btn--sm" onClick={() => void send(s)}>{s}</button>)}</div>}
        </div>
        <form className="composer" onSubmit={e => { e.preventDefault(); void send(q); }}><label className="sr" htmlFor="q">Message</label><textarea className="rr-textarea" id="q" aria-label="Message ReRoute" placeholder={`Ask about orders, risks or ${caseLabel === 'Order book' ? 'a recovery case' : caseLabel}…`} rows={1} value={q} maxLength={500} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(q); } }}/><button className="rr-btn rr-btn--primary rr-btn--lg" type="submit" disabled={typing || q.trim().length < 2}><Ic as={Send} sm/>Send</button></form>
        <div className="xs subtle" style={{ padding: '0 20px 14px' }}>Enter to send · Shift+Enter for a new line</div>
      </section>
    </div>
    <Footer/>
  </>;
}

// ---------------------------------------------------------------- Agent flow
const STAGES: [string, string, string[], typeof Inbox][] = [
  ['Intake', 'Disruption reported or flagged by Risk radar', ['Operations', 'Risk Radar'], Inbox],
  ['Investigator', 'Scopes the disruption and retrieves supplier records', ['Investigator'], ScanSearch],
  ['Sourcing agent', 'Checks constraints and inspects quote evidence', ['Sourcing agent'], Boxes],
  ['Recovery planner', 'Recommends a validated plan', ['Recovery planner'], Sparkles],
  ['Human reviewer', 'Redirects, rejects or approves', ['Human reviewer'], User],
  ['Execution guard', 'Re-checks supplier conditions before acting', ['Execution guard', 'Scenario simulator'], ShieldCheck],
  ['Executor', 'Creates and verifies the draft request', ['Executor', 'Coordinator'], CheckCheck],
];
export function FlowPage() {
  const { active: c, exportCase } = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!c) return <><Head/><Kpis/><CaseSelector label="Select a disruption"/><Empty text="No recovery cases yet."/><Footer/></>;
  const runs = c.events.filter(e => e.title === 'Disruption scoped').length, decisions = c.events.filter(e => e.actor === 'Human reviewer').length;
  return <>
    <Head/><Kpis/><CaseSelector label="Select a disruption"/>
    <div className="split">
      <section className="grid" style={{ minWidth: 0 }} aria-label="Agent flow">
        <div className="tools"><h2><Ic as={Workflow}/>How the agents worked on {c.id}</h2><span className="xs subtle">{plural(runs, 'investigation run')} · {plural(decisions, 'human decision')} · plan version {c.version}</span></div>
        <div className="flow">{STAGES.map(([n, d, actors, icon], i) => {
          const es = c.events.filter(e => actors.includes(e.actor)), last = es[es.length - 1], key = c.id + n, isOpen = open[key];
          const extra = n === 'Sourcing agent' ? c.sourcing_review : undefined;
          return <React.Fragment key={n}>{i > 0 && <span className="connector" aria-hidden="true"/>}<article className={`rr-panel stage ${n === 'Human reviewer' ? 'is-human' : ''}`}>
            <div className="stage__top"><span className="stage__ic"><Ic as={icon}/></span><div><b className="strong">{n}</b><div className="xs subtle">{d}</div></div><span className="rr-count rr-count--quiet">{plural(es.length, 'step')}</span></div>
            {last ? <><p className="small" style={{ margin: 0 }}><b className="strong">{last.title}:</b> <span className="muted">{last.detail.length > 150 ? `${last.detail.slice(0, 150)}…` : last.detail}</span></p>
              <button className="rr-btn rr-btn--secondary rr-btn--sm" style={{ justifySelf: 'start' }} aria-expanded={!!isOpen} onClick={() => setOpen({ ...open, [key]: !isOpen })}><Ic as={isOpen ? ChevronUp : ChevronDown} sm/>{isOpen ? 'Hide output' : 'Show output'}</button>
              {isOpen && <div className="output">{extra && <div><b className="strong">Evidence review</b><div className="muted"><Rich text={extra}/></div></div>}{[...es].reverse().map(e => <div key={e.id}><b className="strong">{e.title}</b> <span className="xs subtle">{time(e.at)}</span><div className="muted">{e.detail}</div></div>)}</div>}</>
              : <p className="small subtle" style={{ margin: 0 }}>No steps yet.</p>}
          </article></React.Fragment>;
        })}</div>
      </section>
      <section className="rr-panel" style={{ minWidth: 0 }}>
        <div className="panel-head"><h2 className="panel-title"><Ic as={History}/>Full activity log · {c.id}</h2><button className="rr-btn rr-btn--secondary rr-btn--sm" style={{ marginLeft: 'auto' }} onClick={exportCase}><Ic as={Download} sm/>Export evidence</button></div>
        <LogList c={c}/>
      </section>
    </div>
    <Footer/>
  </>;
}

// ---------------------------------------------------------------- Suppliers
export function SuppliersPage() {
  const { active: c } = useApp();
  const [view, setView] = useState<'board' | 'list'>('board');
  if (!c || !c.suppliers.length) return <><Head/><CaseSelector label="Select a disruption"/><Empty text="Run an investigation to see the supplier quotes for this case."/><Footer/></>;
  const plan = (id: string) => c.plans.find(p => p.id === id);
  const assess = (id: string) => { const o = plan(id); if (!o) return null; return o.feasible ? <span className="rr-pill rr-pill--low"><Ic as={Check}/>{o.id === c.recommended_id ? 'Recommended' : 'Meets constraints'}</span> : <span className="rr-pill rr-pill--medium" title={o.blockers.join(' · ')}><Ic as={AlertTriangle}/>{o.blockers[0]}</span>; };
  return <>
    <Head/><CaseSelector label="Select a disruption"/>
    <div className="tools"><p className="small muted" style={{ margin: 0 }}>Quotes priced for <b className="strong">{c.quantity} × {c.item}</b> · {c.id}</p>
      <div className="rr-tabs" role="tablist" aria-label="View">{([['board', 'Board', LayoutGrid], ['list', 'List', List]] as const).map(([id, n, icon]) => <button key={id} className="rr-tab" role="tab" aria-selected={view === id} onClick={() => setView(id)}><Ic as={icon}/>{n}</button>)}</div></div>
    {view === 'board' ? <div className="cards">{c.suppliers.map(s => <article key={s.id} className="rr-panel sup">
      <div className="sup__top"><span className="letter" style={{ width: 40, height: 40, fontSize: 15 }}>{s.name[0]}</span><div style={{ minWidth: 0 }}><h3 style={{ margin: 0, font: '600 16px/22px var(--font-sans)' }}>{s.name}</h3><div className="row xs subtle" style={{ gap: 4 }}><Ic as={MapPin} sm/>{s.location}</div></div></div>
      <dl className="kv"><dt>Unit price</dt><dd className="num">PKR {fmt(s.unit_price)}</dd><dt>Stock</dt><dd className="num">{s.stock} units</dd><dt>Delivery</dt><dd>{plural(s.lead_days, 'day')}</dd></dl>
      <span className={`rr-pill rr-pill--${s.certified ? 'low' : 'medium'}`} style={{ justifySelf: 'start' }}>{s.certified ? 'Certification in evidence' : 'Certification not provided'}</span>
      <p className="small muted" style={{ margin: 0 }}>{s.evidence}</p>
      <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 12 }}><span className="mono subtle">{s.evidence_id}</span>{assess(s.id)}</div>
    </article>)}</div>
    : <section className="rr-panel"><div className="scroll-x" style={{ padding: 8 }}><table className="rr-table"><thead><tr><th>Supplier</th><th>Unit price</th><th>Stock</th><th>Delivery</th><th>Certification</th><th>Quote</th><th>For {c.id}</th></tr></thead><tbody>
      {c.suppliers.map(s => <tr key={s.id}><td><span className="row"><span className="letter">{s.name[0]}</span><span><b className="strong">{s.name}</b><div className="meta">{s.location}</div></span></span></td><td className="num">PKR {fmt(s.unit_price)}</td><td className="num">{s.stock}</td><td>{plural(s.lead_days, 'day')}</td><td>{s.certified ? <span className="rr-pill rr-pill--plain-low">In evidence</span> : <span className="rr-pill rr-pill--plain-high">Not provided</span>}</td><td className="mono">{s.evidence_id}</td><td>{assess(s.id)}</td></tr>)}
    </tbody></table></div></section>}
    <Footer/>
  </>;
}

// ---------------------------------------------------------------- Connections
export function ConnectionsPage() {
  const { config, busy, runChecks, disconnect } = useApp();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const live = config?.agent_mode && config.agent_mode !== 'demo';
  const cards: [typeof Sparkles, string, string, 'ai' | 'outline' | Level, string][] = [
    [Sparkles, 'Reasoning engine', live ? `${engineName(config)} · ${config?.model}` : 'Rule-based demo', live ? 'ai' : 'outline', 'Drafts plans, briefs and answers. Every constraint is checked in code, so the model explains and ranks but never decides alone.'],
    [Link, 'Operational tools', config?.tool_mode === 'fastn' ? 'fastn MCP tools' : 'Local demo adapter', 'outline', config?.tool_mode === 'fastn' ? 'Supplier snapshots and the purchase ledger come through the configured MCP tools.' : 'Supplier quotes and the purchase ledger come from a local demo adapter. A request is confirmed only by a successful read-back.'],
    [ArrowUpRight, 'Recovery dispatch', config?.dispatch_mode === 'fastn' ? `fastn · ${config.dispatch_label}` : 'Not configured', config?.dispatch_mode === 'fastn' ? 'low' : 'medium', config?.dispatch_mode === 'fastn' ? 'After a request is verified, ReRoute runs your fastn connector action (execute_tool) to notify your team. Failures never undo the verified request.' : 'Set DISPATCH_MODE=fastn with a fastn API key, project and connector action to notify Slack, update a sheet or open a ticket once a recovery is verified.'],
    [ShieldCheck, 'Human approval', 'Enforced on the server', 'low', 'Approvals belong to one plan version. Changes to price or availability invalidate approval before execution.'],
    [Lock, 'Workspace access', config?.auth_required ? 'Operator token enabled' : 'Open demo mode', config?.auth_required ? 'low' : 'medium', 'Live modes require a configured workspace token. Provider keys remain on the backend and are never sent to this browser.'],
  ];
  return <>
    <Head/>
    <div className="cards">{cards.map(([icon, h, b, k, p]) => <article key={h} className="rr-panel conn"><span className="conn__ic"><Ic as={icon}/></span><h3>{h}</h3>{k === 'outline' ? <span className="rr-tag rr-tag--outline" style={{ justifySelf: 'start' }}>{b}</span> : <span className={`rr-pill rr-pill--${k}`} style={{ justifySelf: 'start' }}>{b}</span>}<p>{p}</p></article>)}</div>
    <section className="rr-panel"><div className="panel-head"><h2 className="panel-title"><Ic as={PlugZap}/>Ready for your own systems</h2></div>
      <div className="pad stack">
        <p className="small muted" style={{ margin: 0 }}>This screen reports configuration. Run a connection check to make one small real call to each live provider before you demo.</p>
        <div className="row"><button className="rr-btn rr-btn--secondary" disabled={busy.checks} onClick={async () => setChecks(await runChecks())}><Ic as={busy.checks ? RotateCcw : Activity} className={busy.checks ? 'spin' : ''}/>{busy.checks ? 'Checking…' : 'Run connection check'}</button>
          {config?.auth_required && <button className="rr-btn rr-btn--ghost" onClick={disconnect}><Ic as={Unplug} sm/>Disconnect this browser</button>}</div>
        {checks && <div className="stack" aria-label="Connection check results">{checks.map(r => <div key={r.name} className="check-row"><span style={{ color: `var(--${r.ok ? 'green' : 'amber'}-ink)` }}><Ic as={r.ok ? CheckCircle2 : AlertTriangle} sm/></span><div><b className="strong small">{r.name}</b><div className="xs muted">{r.detail}</div></div><span className="xs subtle num">{r.ms} ms</span></div>)}</div>}
      </div>
    </section>
    <Footer/>
  </>;
}

// ---------------------------------------------------------------- modals
export function ReportView({ c, onClose, onCopy }: { c: RecoveryCase; onClose: () => void; onCopy: () => void }) {
  const { city, site } = splitLocation(c.location);
  return <>
    <div className="modal__top"><span className="row"><button className="rr-btn rr-btn--primary" onClick={onCopy}><Ic as={FileText} sm/>Copy summary</button><button className="rr-btn rr-btn--secondary" onClick={() => window.print()}><Ic as={Printer} sm/>Print / PDF</button></span><button className="rr-iconbtn" onClick={onClose} aria-label="Close report"><Ic as={X}/></button></div>
    <div className="report"><div className="rr-eyebrow">ReRoute recovery report</div><h2 style={{ marginTop: 6 }}>{c.title}</h2><div className="small subtle"><span className="mono">{c.id}</span>{c.source_po ? ` · ${c.source_po}` : ''} · {new Date().toLocaleString('en-GB')} · Status: {status(c.status).word.toLowerCase()}</div></div>
    <h3>1. Disruption</h3><p className="small" style={{ margin: 0 }}>{c.disruption}</p>
    <div className="boxes"><div><small>Need</small><b>{c.quantity} × {c.item}</b></div><div><small>Deliver to</small><b>{city} · {site}</b></div><div><small>Budget</small><b className="num">PKR {fmt(c.constraints.budget)}</b></div><div><small>Deadline</small><b>{c.constraints.deadline_days} days</b></div><div><small>Certified only</small><b>{c.constraints.certified_only ? 'Yes' : 'No'}</b></div></div>
    <h3>2. Recommendation</h3><p className="small" style={{ margin: 0 }}>{c.summary || 'No recommendation yet.'}</p>{c.sourcing_review && <div className="quote">Sourcing agent: <Rich text={c.sourcing_review}/></div>}
    <h3>3. Options compared</h3>
    <div className="scroll-x"><table className="rr-table"><thead><tr><th>Supplier</th><th>Total (PKR)</th><th>Delivery</th><th>Evidence</th><th>Assessment</th></tr></thead><tbody>{ordered(c).map(o => <tr key={o.id}><td>{o.supplier}{o.id === c.recommended_id ? <span className="xs subtle"> (recommended)</span> : null}</td><td className="num">{fmt(o.total)}</td><td>{plural(o.lead_days, 'day')}</td><td className="mono">{o.evidence_id}</td><td>{o.feasible ? 'Meets constraints' : o.blockers.join(' · ')}</td></tr>)}</tbody></table></div>
    <h3>4. Decisions</h3>{c.decisions.length ? <ol className="timeline" style={{ padding: 0 }}>{c.decisions.map((h, i) => <li key={i}><span className="dot" style={{ background: `var(--${h.action === 'approved' ? 'lilac' : 'coral'})` }}/><div><div className="k">{h.action === 'revised' ? 'Redirected' : h.action === 'approved' ? 'Approved' : 'Invalidated'} · V{h.version}</div><div className="small">{h.action === 'revised' ? `${h.rejected?.length ? `Rejected ${h.rejected.join(', ')}. ` : ''}“${h.note}”` : `${h.supplier}${h.total ? ` · PKR ${fmt(h.total)}` : ''}${h.action === 'invalidated' ? `: ${h.note}` : ''}`}</div></div></li>)}</ol> : <p className="small muted" style={{ margin: 0 }}>None yet.</p>}
    {c.execution && <p className="small" style={{ margin: 0, color: 'var(--green-ink)' }}>Draft request <span className="mono">{c.execution.id}</span> for PKR {fmt(c.execution.total)} verified by read-back. No payment was sent; delivery is not yet confirmed.</p>}
  </>;
}
export function ReportForm({ radar, onClose, onSubmit, busy }: { radar?: RadarData; onClose: () => void; onSubmit: (v: { order: string; title: string; disruption: string; budget: number; days: number }) => void; busy: boolean }) {
  const orders = radar?.orders || [];
  const preset = (id: string) => { const o = orders.find(x => x.id === id) || orders[0]; return o ? { order: o.id, title: `${o.item}s delayed`, disruption: `${o.supplier} shipment is ${o.variance_days > 0 ? `${plural(o.variance_days, 'day')} late` : 'at risk of slipping'}. Needed in ${o.required_days} days.`, budget: String(Math.round(o.value * 1.2 / 1000) * 1000), days: String(o.required_days) } : { order: '', title: '', disruption: '', budget: '180000', days: '3' }; };
  const [v, setV] = useState(() => preset(orders[0]?.id || ''));
  const valid = v.title.trim().length >= 3 && v.disruption.trim().length >= 10 && +v.budget > 0 && +v.days > 0 && +v.days <= 90;
  return <form className="stack" style={{ gap: 16 }} onSubmit={e => { e.preventDefault(); if (valid) onSubmit({ order: v.order, title: v.title.trim(), disruption: v.disruption.trim(), budget: +v.budget, days: +v.days }); }}>
    <div className="modal__top"><div><div className="rr-eyebrow">New disruption</div><h2 style={{ marginTop: 6 }}>Report disruption</h2><p className="small muted" style={{ margin: '4px 0 0' }}>Your investigator scopes it next. Nothing is ordered without your approval.</p></div><button type="button" className="rr-iconbtn" onClick={onClose} aria-label="Close"><Ic as={X}/></button></div>
    {orders.length > 0 && <label className="rr-field"><span>Affected order</span><select className="select" style={{ width: '100%' }} value={v.order} onChange={e => setV(preset(e.target.value))}>{orders.map(x => <option key={x.id} value={x.id}>{x.id} · {x.quantity} × {x.item} · {x.origin}</option>)}</select></label>}
    <label className="rr-field"><span>Title</span><input className="rr-input" aria-label="Title" required minLength={3} maxLength={120} value={v.title} autoFocus onChange={e => setV({ ...v, title: e.target.value })}/></label>
    <label className="rr-field"><span>What happened</span><textarea className="rr-textarea" aria-label="What happened" required minLength={10} maxLength={2000} value={v.disruption} onChange={e => setV({ ...v, disruption: e.target.value })}/></label>
    <div className="form2">
      <label className="rr-field"><span>Budget <em className="subtle" style={{ fontStyle: 'normal' }}>PKR</em></span><input className="rr-input num" aria-label="Budget" inputMode="numeric" required value={v.budget} onChange={e => setV({ ...v, budget: e.target.value.replace(/[^\d]/g, '') })}/></label>
      <label className="rr-field"><span>Needed within <em className="subtle" style={{ fontStyle: 'normal' }}>days</em></span><input className="rr-input num" aria-label="Needed within days" inputMode="numeric" required value={v.days} onChange={e => setV({ ...v, days: e.target.value.replace(/[^\d]/g, '') })}/></label>
    </div>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="rr-btn rr-btn--ghost" onClick={onClose}>Cancel</button><button type="submit" className="rr-btn rr-btn--primary" disabled={!valid || busy}><Ic as={busy ? RotateCcw : Plus} sm className={busy ? 'spin' : ''}/>Report disruption</button></div>
  </form>;
}

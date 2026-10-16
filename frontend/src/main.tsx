import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, ArrowRight, ArrowDown, Bell, Boxes, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, Download, FileText, GitBranch, LayoutDashboard, Link2, LoaderCircle, MapPin, Package, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Truck, Unplug, X, AlertTriangle, Activity } from 'lucide-react';
import type { Config, Constraints, RecoveryCase, Plan } from './types';
import './styles.css';

const money = (n: number) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(n);
const statusName: Record<string, string> = { open: 'Needs investigation', investigating: 'Investigating', review: 'Awaiting review', approved: 'Approved', executing: 'Executing', recovered: 'Request verified', blocked: 'Needs attention', error: 'Investigation failed', execution_error: 'Reconciliation needed' };
let workspaceToken = sessionStorage.getItem('reroute-token') || '';
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(workspaceToken ? { Authorization: `Bearer ${workspaceToken}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Please check the form values and try again.');
  }
  return res.json();
}

function App() {
  const [config, setConfig] = useState<Config>();
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [activeId, setActiveId] = useState('');
  const [view, setView] = useState('workspace');
  const [tab, setTab] = useState('plans');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [locked, setLocked] = useState(false);
  const [selected, setSelected] = useState('');
  const [constraints, setConstraints] = useState<Constraints>({ budget: 180000, deadline_days: 3, certified_only: false });
  const [note, setNote] = useState('');
  const active = cases.find(c => c.id === activeId);
  const selectedPlan = active?.plans.find(p => p.id === selected);
  const processing = busy || ['investigating', 'executing'].includes(active?.status || '');

  function updateCase(d: RecoveryCase) { setCases(old => old.some(c => c.id === d.id) ? old.map(c => c.id === d.id ? d : c) : [d, ...old]); }
  async function load() {
    setLoading(true);
    try {
      const c = await api<Config>('/config'); setConfig(c);
      if (c.auth_required && !workspaceToken) { setLocked(true); return; }
      const all = await api<RecoveryCase[]>('/cases'); setCases(all); setActiveId(old => old || all[0]?.id || ''); setLocked(false); setError('');
    } catch (e) { setError((e as Error).message); setLocked(true); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (active) { setConstraints(active.constraints); setSelected(active.approval?.plan_id || active.recommended_id || ''); setNote(''); }
  }, [activeId, active?.version]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setNewOpen(false); setHelp(false); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!activeId || locked) return;
    const controller = new AbortController();
    async function stream() {
      try {
        const response = await fetch(`/api/cases/${activeId}/events`, { headers: workspaceToken ? { Authorization: `Bearer ${workspaceToken}` } : {}, signal: controller.signal });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          pending += decoder.decode(value, { stream: true });
          const chunks = pending.split('\n\n'); pending = chunks.pop() || '';
          for (const chunk of chunks) if (chunk.startsWith('data: ')) updateCase(JSON.parse(chunk.slice(6)));
        }
      } catch { /* Request failures surface on the next user operation. */ }
    }
    void stream(); return () => controller.abort();
  }, [activeId, locked]);

  async function action(path: string, body = {}, message = '') {
    if (!active) return;
    setBusy(true); setError('');
    try { const d = await api<RecoveryCase>(`/cases/${active.id}/${path}`, body); updateCase(d); setSelected(d.approval?.plan_id || d.recommended_id || ''); if (message) setToast(message); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function exportCase() {
    if (!active) return;
    const blob = new Blob([JSON.stringify(active, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = `${active.id}-evidence.json`; a.click(); URL.revokeObjectURL(href);
    setToast('Case evidence exported.');
  }
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('');
    try {
      const d = await api<RecoveryCase>('/cases', { title: form.get('title'), item: form.get('item'), quantity: Number(form.get('quantity')), location: form.get('location'), disruption: form.get('disruption'), constraints: { budget: Number(form.get('budget')), deadline_days: Number(form.get('deadline')), certified_only: false } });
      updateCase(d); setActiveId(d.id); setView('workspace'); setTab('plans'); setNewOpen(false); setToast('Disruption reported. Ready to investigate.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const attention = cases.filter(c => c.status !== 'recovered').length;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('workspace'); }}><span className="brand-mark"><GitBranch size={23}/></span>ReRoute<span className="brand-dot">®</span></a>
      <div className="workspace-label"><span className="workspace-icon">N</span><div>Northline Operations<small>Recovery workspace</small></div><ChevronDown size={15}/></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav aria-label="Main navigation">
        <button className={view === 'workspace' ? 'nav active' : 'nav'} onClick={() => setView('workspace')}><LayoutDashboard size={18}/>Recovery overview<span className="nav-count">{attention}</span></button>
        <button className={view === 'suppliers' ? 'nav active' : 'nav'} onClick={() => setView('suppliers')}><Boxes size={18}/>Supplier network</button>
        <button className={view === 'activity' ? 'nav active' : 'nav'} onClick={() => setView('activity')}><Activity size={18}/>Activity log</button>
        <button className={view === 'integrations' ? 'nav active' : 'nav'} onClick={() => setView('integrations')}><Link2 size={18}/>Connections</button>
      </nav>
      <div className="sidebar-bottom"><div className="human-card"><ShieldCheck size={20}/><strong>Intelligence with oversight.</strong><p>Your agents do the groundwork.<br/>You make the decisions.</p><button onClick={() => setHelp(true)}>How ReRoute works <ArrowUpRight size={14}/></button></div><button className="operator" onClick={() => setView('integrations')}><span className="avatar">OP</span><span>Workspace operator<small>{config?.auth_required ? 'Token protected' : 'Demo workspace'}</small></span><Settings2 size={17}/></button></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={14}/><span>{view === 'workspace' ? 'Recovery overview' : view === 'suppliers' ? 'Supplier network' : view === 'activity' ? 'Activity log' : 'Connections'}</span></div><div className="topbar-right"><span className="mode-pill"><i/>{config?.tool_mode === 'fastn' ? 'Connected tools' : 'Demo environment'}</span><button className="icon-button" title="Open activity log" aria-label="Open activity log" onClick={() => setView('activity')}><Bell size={19}/><span className="notification-dot"/></button><button className="icon-button" aria-label="Help" onClick={() => setHelp(true)}><CircleHelp size={19}/></button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">SUPPLY CHAIN RESILIENCE</div><h1>{view === 'workspace' ? 'Keep your next move clear.' : view === 'suppliers' ? 'Your recovery network.' : view === 'activity' ? 'Every decision, accounted for.' : 'Connect the dots.'}</h1><p>{view === 'workspace' ? 'Turn disruptions into decisions. Your recovery team is ready.' : view === 'suppliers' ? 'Inspect the supplier evidence behind your recovery options.' : view === 'activity' ? 'A traceable history of investigation, review and execution.' : 'Know where your evidence comes from and where actions go.'}</p></div><button className="primary" onClick={() => setNewOpen(true)} disabled={locked}><Plus size={17}/>Report disruption</button></div>
        {error && <div className="error-banner" role="alert"><AlertTriangle size={18}/>{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
        {locked ? <form className="login-card panel" onSubmit={e => { e.preventDefault(); workspaceToken = tokenInput; sessionStorage.setItem('reroute-token', tokenInput); void load(); }}><ShieldCheck size={30}/><h2>Open your workspace</h2><p>Enter the operator token configured on the server.</p><label>Workspace token<input type="password" required value={tokenInput} onChange={e => setTokenInput(e.target.value)} autoComplete="current-password"/></label><button className="primary">Connect workspace</button></form> : loading ? <div className="loading"><LoaderCircle className="spin"/>Loading your workspace…</div> : <>
        <section className="metrics" aria-label="Workspace summary"><Metric icon={<Package size={19}/>} label="Open disruptions" value={String(attention).padStart(2, '0')} foot="Across your recovery workspace"/><Metric icon={<ShieldCheck size={19}/>} label="Awaiting your decision" value={String(cases.filter(c => c.status === 'review').length).padStart(2, '0')} foot="Human judgment makes the difference"/><Metric icon={<CheckCheck size={19}/>} label="Verified requests" value={String(cases.filter(c => c.status === 'recovered').length).padStart(2, '0')} foot="Draft requests confirmed in the ledger"/></section>

        {view === 'integrations' ? <section className="connections-grid"><Connection name="Reasoning engine" icon={<Sparkles/>} state={config?.agent_mode === 'anthropic' ? 'Claude connected mode' : 'Deterministic demo'} text={config?.agent_mode === 'anthropic' ? `Configured model: ${config.model}. Live access is confirmed only by a successful investigation.` : 'LangGraph coordinates three workflow roles. Demo planning uses explicit rules, without an LLM call.'}/><Connection name="Operational tools" icon={<Link2/>} state={config?.tool_mode === 'fastn' ? 'fastn MCP configured' : 'Local demo adapter'} text={config?.tool_mode === 'fastn' ? 'Evidence retrieval and request creation use the configured MCP contracts. Inspect activity for operation results.' : 'Synthetic supplier quotes and a persistent local request ledger. No supplier is contacted and no money is transferred.'}/><Connection name="Human approval" icon={<ShieldCheck/>} state="Enforced on the server" text="Approvals belong to one plan version. Changes to price or availability invalidate approval before execution."/><Connection name="Workspace access" icon={<Settings2/>} state={config?.auth_required ? 'Operator token enabled' : 'Open demo mode'} text="Live modes require a configured workspace token. Provider keys remain on the backend and are never sent to this browser."/><div className="panel integration-note"><strong>Ready for your own systems</strong><p>Configure the environment variables and fastn tool contracts documented in the repository. This screen reports configuration; it does not claim a live connection has been verified.</p>{workspaceToken && <button className="secondary" onClick={() => { workspaceToken = ''; sessionStorage.removeItem('reroute-token'); setLocked(true); }}>Disconnect this browser</button>}</div></section> : <>
        <div className="section-heading"><h2>{view === 'workspace' ? 'Recovery workspace' : 'Select a disruption'} <span className="count-badge">{cases.length}</span></h2><label className="search"><Search size={16}/><input aria-label="Search disruptions" placeholder="Search disruptions…" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
        <div className="case-strip">{cases.filter(c => `${c.title} ${c.id}`.toLowerCase().includes(query.toLowerCase())).map(c => <button key={c.id} className={`case-selector ${c.id === activeId ? 'selected' : ''}`} onClick={() => setActiveId(c.id)}><span className={`case-dot ${c.status === 'recovered' ? 'green' : ''}`}/><span><strong>{c.title}</strong><small>{c.id} · {statusName[c.status]}</small></span><ChevronRight size={16}/></button>)}{!cases.filter(c => `${c.title} ${c.id}`.toLowerCase().includes(query.toLowerCase())).length && <p className="muted">No matching disruptions. Report a new one to get started.</p>}</div>

        {active && (view === 'suppliers' ? <section className="supplier-grid">{active.suppliers.length ? active.suppliers.map(s => <div className="panel supplier-panel" key={s.id}><div className="supplier-logo">{s.name.slice(0, 1)}</div><h3>{s.name}</h3><p><MapPin size={14}/>{s.location}</p><div className="supplier-facts"><span>Unit price<strong>PKR {money(s.unit_price)}</strong></span><span>Stock<strong>{s.stock} units</strong></span><span>Delivery<strong>{s.lead_days} days</strong></span></div><span className={`badge ${s.certified ? 'success' : 'warning'}`}>{s.certified ? 'Certification in evidence' : 'Certification not provided'}</span><p className="evidence-copy">{s.evidence}</p><small className="mono">{s.evidence_id}</small>{active.withdrawn_suppliers.includes(s.id) && <p className="danger">Availability withdrawn in this scenario.</p>}</div>) : <Empty title="Investigate to discover suppliers" text="Supplier evidence will appear after the first investigation." action={() => { setView('workspace'); }} label="Back to recovery"/>}</section> : view === 'activity' ? <section className="panel full-activity"><div className="panel-heading"><h3>Case activity · {active.id}</h3><button className="secondary small" onClick={exportCase}><Download size={15}/>Export evidence</button></div><Timeline data={active}/></section> : <div className="workspace-grid"><div className="workspace-main">
          <section className="panel incident-card"><div className="incident-top"><span className="case-ref"><span className="tiny-square"/>{active.id}</span><span className={`badge ${active.status === 'recovered' ? 'success' : 'warning'}`}><span className="badge-dot"/>{statusName[active.status]}</span></div><h2>{active.title}</h2><p className="incident-description">{active.disruption}</p><div className="incident-details"><div><Package size={16}/><span>{active.quantity} units<small>{active.item}</small></span></div><div><MapPin size={16}/><span>{active.location.split(' · ')[0]}<small>{active.location.split(' · ')[1] || 'Delivery location'}</small></span></div><div><Clock3 size={16}/><span>{active.constraints.deadline_days}-day deadline<small>Maximum lead time</small></span></div><div><span className="currency-icon">Rs</span><span>{money(active.constraints.budget)}<small>Budget · PKR</small></span></div></div>
          <div className="workflow-track">{['Investigate', 'Find alternatives', 'Human review', 'Execute & verify'].map((label, i) => { const progress = active.status === 'recovered' ? 4 : ['approved', 'executing', 'execution_error'].includes(active.status) ? 3 : active.plans.length ? 2 : 0; return <React.Fragment key={label}><div className={`workflow-step ${i < progress ? 'done' : i === progress ? 'current' : ''}`}><span>{i < progress ? <Check size={12}/> : i + 1}</span>{label}</div>{i < 3 && <div className="step-line"/>}</React.Fragment>; })}</div></section>

          {active.summary && <div className="recommendation"><div className="spark-box"><Sparkles size={18}/></div><div><strong>{active.status === 'blocked' ? 'A new decision is needed' : 'Your recovery brief'}</strong><p>{active.summary}</p><small>{config?.agent_mode === 'demo' ? 'Rule-based demo planner' : 'Claude planner'} · Plan version {active.version} · Evidence-backed constraints</small></div></div>}

          <section className="panel options-panel"><div className="tabs"><button className={tab === 'plans' ? 'tab active' : 'tab'} onClick={() => setTab('plans')}>Recovery options <span>{active.plans.length}</span></button><button className={tab === 'evidence' ? 'tab active' : 'tab'} onClick={() => setTab('evidence')}>Source evidence</button><button className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}>Activity</button></div>
          {tab === 'plans' ? active.plans.length ? <><div className="table-caption"><p>Compare the tradeoffs. Choose the next move.</p><span>All costs in PKR</span></div><div className="table-scroll"><table><thead><tr><th>Supplier / plan</th><th>Total cost</th><th>Arrival</th><th>Assessment</th><th><span className="sr-only">Select</span></th></tr></thead><tbody>{active.plans.map(p => <tr key={p.id} className={`${selected === p.id ? 'chosen' : ''} ${!p.feasible ? 'infeasible' : ''}`}><td><div className="supplier-cell"><span className="mini-logo">{p.supplier[0]}</span><span><strong>{p.supplier}</strong><small>{p.location}{p.id === active.recommended_id && <em>Recommended</em>}</small></span></div></td><td><strong>{money(p.total)}</strong><small>{p.savings >= 0 ? `${money(p.savings)} under budget` : `${money(-p.savings)} over budget`}</small></td><td><span className="delivery"><Truck size={14}/>{p.lead_days} day{p.lead_days !== 1 ? 's' : ''}</span></td><td><span className={`assessment ${p.feasible ? 'ok' : ''}`}>{p.feasible ? <><Check size={14}/>Meets constraints</> : <><AlertTriangle size={13}/>Blocked</>}</span><small>{p.feasible ? p.certified ? 'Certification provided' : 'Certification not provided' : p.blockers.join(' · ')}</small></td><td><input type="radio" aria-label={`Select ${p.supplier}`} name="plan" checked={selected === p.id} disabled={!p.feasible || processing || !['review', 'approved'].includes(active.status)} onChange={() => setSelected(p.id)}/></td></tr>)}</tbody></table></div><div className="table-footer"><ShieldCheck size={14}/>Availability is checked again before execution.<button onClick={() => setTab('evidence')}>Inspect evidence <ArrowUpRight size={13}/></button></div></> : <Empty title={processing ? 'Your recovery team is investigating' : active.status === 'blocked' ? 'Conditions changed. Let’s find another way.' : 'A disruption is just the starting point.'} text={processing ? 'Gathering supplier evidence and checking your constraints.' : 'Investigate this case to compare suppliers, delivery times and recovery costs.'} action={() => void action('investigate')} label={active.version ? 'Re-investigate' : 'Start investigation'} busy={processing}/> : tab === 'evidence' ? <div className="evidence-list">{active.suppliers.length ? active.suppliers.map(s => <details key={s.id} open><summary><FileText size={16}/><strong>{s.evidence_id}</strong><span>{s.name}</span><ChevronDown size={15}/></summary><p>{s.evidence}</p><small>Source: {active.evidence_source}</small></details>) : <p>No evidence retrieved yet.</p>}</div> : <Timeline data={active}/>}</section>

          {active.execution && <section className="verified panel"><span className="verified-icon"><CheckCheck size={25}/></span><div><h3>Recovery request verified.</h3><p>{active.execution.id} · PKR {money(active.execution.total)} · Saved as a draft</p><small>Destination read-back matches your approval. Delivery is not yet confirmed.</small></div><button className="icon-button" onClick={exportCase} aria-label="Export verified case"><Download size={19}/></button></section>}
          <div className="data-note"><span className="badge-dot"/>{config?.tool_mode === 'demo' ? 'Demonstration data. Suppliers, prices and stock are synthetic.' : 'Connected supplier data. Inspect source evidence before approving.'}<button onClick={exportCase}><Download size={13}/>Export case</button></div>
        </div><aside className="review-column"><section className="panel review-panel"><div className="panel-heading"><h3><ShieldCheck size={18}/>Decision desk</h3><span className="live-dot"/></div><div className="review-intro"><span className="eyebrow">HUMAN + AI, TOGETHER</span><h3>You set the direction.</h3><p>Review the evidence, adjust your constraints, and approve the plan you trust.</p></div><form onSubmit={e => { e.preventDefault(); void action('decision', { version: active.version, action: 'revise', constraints, note }, 'Recovery plan revised.'); }}><label>Total budget <span>PKR</span><input aria-label="Total budget" type="number" min={1} max={100000000} required value={constraints.budget} onChange={e => setConstraints({ ...constraints, budget: Number(e.target.value) })}/></label><label>Delivery within <span>days</span><input aria-label="Delivery within" type="number" min={1} max={90} required value={constraints.deadline_days} onChange={e => setConstraints({ ...constraints, deadline_days: Number(e.target.value) })}/></label><label className="checkbox-label"><input type="checkbox" checked={constraints.certified_only} onChange={e => setConstraints({ ...constraints, certified_only: e.target.checked })}/><span>Require certified compatibility<small>Exclude unverified substitutes</small></span></label><label>Instructions for your agents<textarea aria-label="Instructions for your agents" placeholder="e.g. This lab requires certified components. Find a compatible alternative." maxLength={2000} value={note} onChange={e => setNote(e.target.value)}/></label><button className="secondary full" disabled={processing || !['review', 'blocked', 'approved'].includes(active.status) || !note.trim()}><RefreshCw size={15}/>Revise & replan</button></form>
          <div className="approval-area">{active.status === 'recovered' ? <p className="approved-note"><CheckCheck size={16}/>Approved action verified</p> : ['approved', 'execution_error'].includes(active.status) ? <><p className="approved-note"><Check size={16}/>Version {active.version} approved</p><button className="primary full" disabled={processing} onClick={() => void action('execute', { version: active.version })}>{processing ? <LoaderCircle className="spin" size={16}/> : <ArrowRight size={16}/>} {active.status === 'execution_error' ? 'Reconcile & retry' : 'Execute approved plan'}</button><small>Creates a draft request. No payment is sent.</small></> : <><div className="approval-total"><span>Selected recovery plan</span><strong>{selectedPlan ? `PKR ${money(selectedPlan.total)}` : 'Choose a plan'}</strong></div><button className="primary full" disabled={processing || active.status !== 'review' || !selectedPlan?.feasible || JSON.stringify(constraints) !== JSON.stringify(active.constraints)} onClick={() => void action('decision', { version: active.version, action: 'approve', plan_id: selected, note }, 'Plan approved. Ready for execution.')}><ShieldCheck size={16}/>Approve recovery plan</button><small>{JSON.stringify(constraints) !== JSON.stringify(active.constraints) ? 'Replan to apply your changed constraints first.' : 'Approval applies only to this plan version.'}</small></>}</div></section>
          <section className="team-panel"><h4>Your recovery team</h4>{[['Investigator', 'Scopes the disruption'], ['Sourcing agent', 'Checks alternatives'], ['Recovery planner', 'Builds the next move']].map(([name, role], i) => <div className="team-member" key={name}><span className={`agent-avatar a${i}`}><GitBranch size={16}/></span><div><strong>{name}</strong><small>{role}</small></div>{active.plans.length ? <Check size={14} className="green-text"/> : <span className="waiting-dot"/>}</div>)}<p>{config?.agent_mode === 'demo' ? 'Demo workflow · deterministic planning' : 'LangGraph workflow · Claude planning'}</p></section>
          {config?.tool_mode === 'demo' && active.recommended_id && ['review', 'approved'].includes(active.status) && <details className="scenario-control"><summary><Settings2 size={14}/>Demo scenario controls<ChevronDown size={13}/></summary><p>Simulate a supplier withdrawing after planning. Execution will catch the change.</p><button className="secondary small" disabled={processing || active.withdrawn_suppliers.includes(active.recommended_id)} onClick={() => void action(`withdraw/${active.recommended_id}`, {}, 'Synthetic withdrawal recorded.')}><Unplug size={14}/>Withdraw recommended supplier</button></details>}
        </aside></div>)}
        </>}
        <footer><span><GitBranch size={14}/>ReRoute <span className="footer-separator">/</span> Find the next move.</span><span>Built for Human + AI collaboration.</span></footer>
        </>}
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
    {newOpen && <div className="modal-backdrop" onClick={() => setNewOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={e => e.stopPropagation()}><div className="panel-heading"><h2 id="new-title">Report a disruption</h2><button className="icon-button" aria-label="Close dialog" onClick={() => setNewOpen(false)}><X/></button></div><p>Give your recovery team the context and constraints.</p><form onSubmit={create}><label>Case title<input name="title" autoFocus required minLength={3} maxLength={120} defaultValue="Network adapters delayed"/></label><div className="form-row"><label>Required item<input name="item" required defaultValue="USB-C network adapter" maxLength={100}/></label><label>Quantity<input name="quantity" type="number" min={1} max={10000} required defaultValue={20}/></label></div><label>Delivery location<input name="location" required defaultValue="Islamabad · Engineering lab" maxLength={120}/></label><label>What happened?<textarea name="disruption" required minLength={10} maxLength={2000} defaultValue="Original shipment delayed by 7 days. Lab installation must proceed within 3 days."/></label><div className="form-row"><label>Budget (PKR)<input name="budget" type="number" min={1} max={100000000} required defaultValue={180000}/></label><label>Maximum lead time (days)<input name="deadline" type="number" min={1} max={90} required defaultValue={3}/></label></div><button className="primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>}Create recovery case</button></form></section></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><div className="panel-heading"><h2 id="help-title">A clear path to recovery.</h2><button className="icon-button" aria-label="Close help" onClick={() => setHelp(false)}><X/></button></div><ol><li><strong>Investigate</strong><p>Retrieve supplier evidence and identify feasible alternatives.</p></li><li><strong>Guide the plan</strong><p>Require certification, change a deadline or adjust a budget. Add your reasoning and replan.</p></li><li><strong>Approve a specific version</strong><p>The server binds your approval to the selected supplier and total.</p></li><li><strong>Execute and verify</strong><p>Refresh supplier conditions, create a draft request, then read it back. Delivery and payment are outside this workflow.</p></li></ol><button className="primary full" onClick={() => setHelp(false)}>Back to workspace <ArrowRight size={16}/></button></section></div>}
  </div>;
}

function Metric({ icon, label, value, foot }: { icon: React.ReactNode; label: string; value: string; foot: string }) { return <div className="metric"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{value}<span className="metric-rule"/></div><p>{foot}</p></div>; }
function Empty({ title, text, action, label, busy }: { title: string; text: string; action: () => void; label: string; busy?: boolean }) { return <div className="empty-state"><div className="route-illustration"><span><Package size={23}/></span><i/><span className="route-middle"><GitBranch size={27}/></span><i/><span><MapPin size={23}/></span></div><h3>{title}</h3><p>{text}</p><button className="primary" onClick={action} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : <Sparkles size={16}/>} {busy ? 'Investigating…' : label}</button></div>; }
function Timeline({ data }: { data: RecoveryCase }) { return <div className="timeline">{[...data.events].reverse().map(e => <div className={`timeline-event ${e.kind}`} key={e.id}><span className="timeline-marker">{e.kind === 'success' ? <Check size={12}/> : e.actor === 'Human reviewer' ? <ShieldCheck size={12}/> : <GitBranch size={12}/>}</span><div><div className="event-title"><strong>{e.title}</strong><time>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{e.detail}</p><small>{e.actor}</small></div></div>)}</div>; }
function Connection({ name, icon, state, text }: { name: string; icon: React.ReactNode; state: string; text: string }) { return <div className="panel connection"><span className="connection-icon">{icon}</span><h3>{name}</h3><span className="badge neutral">{state}</span><p>{text}</p></div>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

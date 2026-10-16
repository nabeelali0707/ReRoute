import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, CircleHelp, LoaderCircle, Route, ShieldCheck, X } from 'lucide-react';
import type { Config, Constraints, Radar as RadarData, RadarAnalysis, RecoveryCase } from './types';
import { api, authHeaders, getToken, setToken } from './lib';
import { AppCtx, AskPage, ConnectionsPage, FlowPage, RadarPage, RecoveryPage, ReportForm, ReportView, SECTIONS, SuppliersPage, type Check as CheckResult, type Ctx, type Page } from './pages';
import { Ic, fmt, mapName, needsAttention, status } from './ui';
import './styles.css';

const pageFromHash = (): Page => { const p = location.hash.slice(1) as Page; return SECTIONS.some(s => s.id === p) ? p : 'radar'; };
type Modal = 'report-disruption' | 'report' | 'help' | null;

function App() {
  const [config, setConfig] = useState<Config>();
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [radar, setRadar] = useState<RadarData>();
  const [activeId, setActiveId] = useState('');
  const [page, setPage] = useState<Page>(pageFromHash);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const active = cases.find(c => c.id === activeId) || cases[0];

  const toast = useCallback((text: string) => { const id = Date.now() + Math.random(); setToasts(t => [...t, { id, text }].slice(-3)); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200); }, []);
  const mark = (key: string, on: boolean) => setBusy(b => ({ ...b, [key]: on }));
  const updateCase = useCallback((d: RecoveryCase) => setCases(old => (old.some(c => c.id === d.id) ? old.map(c => (c.id === d.id && Date.parse(d.updated_at) >= Date.parse(c.updated_at) ? d : c)) : [d, ...old])), []);
  const refreshRadar = useCallback(() => api<RadarData>('/radar').then(setRadar).catch(() => undefined), []);

  async function load() {
    setLoading(true);
    try {
      const c = await api<Config>('/config'); setConfig(c);
      if (c.auth_required && !getToken()) { setLocked(true); return; }
      const [all] = await Promise.all([api<RecoveryCase[]>('/cases'), refreshRadar()]);
      setCases(all); setActiveId(old => old || all[0]?.id || ''); setLocked(false); setLoginError('');
    } catch (e) { setLocked(true); setLoginError((e as Error).message); setToken(''); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { const onHash = () => { setPage(pageFromHash()); window.scrollTo(0, 0); }; window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  useEffect(() => { document.title = `${SECTIONS.find(s => s.id === page)!.name} · ReRoute`; }, [page]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModal(null); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  // Live updates for the open case (server-sent events), so agent progress appears without refreshing.
  useEffect(() => {
    if (!active?.id || locked) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/cases/${active.id}/events`, { headers: authHeaders(), signal: controller.signal });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader(), decoder = new TextDecoder(); let pending = '';
        for (;;) { const { done, value } = await reader.read(); if (done) break; pending += decoder.decode(value, { stream: true }); const chunks = pending.split('\n\n'); pending = chunks.pop() || ''; for (const chunk of chunks) if (chunk.startsWith('data: ')) updateCase(JSON.parse(chunk.slice(6))); }
      } catch { /* the next user action reports any failure */ }
    })();
    return () => controller.abort();
  }, [active?.id, locked]);

  const go = (p: Page) => { if (location.hash.slice(1) !== p) location.hash = p; else setPage(p); };
  async function run(key: string, fn: () => Promise<void>) {
    mark(key, true);
    try { await fn(); } catch (e) { toast((e as Error).message); } finally { mark(key, false); }
  }
  const caseAction = (path: string, body: unknown = {}) => api<RecoveryCase>(`/cases/${active!.id}/${path}`, body);

  const ctx: Ctx = {
    page, config, cases, active, radar, busy, country, toast, go,
    setCountry: c => setCountry(c ? mapName(c) : null),
    setActive: id => setActiveId(id),
    openModal: m => setModal(m),
    exportCase: () => {
      if (!active) return;
      const href = URL.createObjectURL(new Blob([JSON.stringify(active, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = href; a.download = `${active.id}-evidence.json`; a.click(); URL.revokeObjectURL(href);
      toast(`${active.id} exported`);
    },
    investigate: () => run(active!.id, async () => { const d = await caseAction('investigate'); updateCase(d); toast(d.status === 'error' ? 'Investigation failed. See the banner for the reason.' : d.status === 'blocked' ? 'No supplier meets every constraint' : 'Recovery options ready'); }),
    revise: (constraints: Constraints, note: string) => run(active!.id, async () => { const d = await caseAction('decision', { version: active!.version, action: 'revise', constraints, note }); updateCase(d); toast(d.status === 'error' ? 'Replan failed. See the banner for the reason.' : `Plan version ${d.version} ready`); }),
    approve: (planId: string) => run(active!.id, async () => {
      const approved = await caseAction('decision', { version: active!.version, action: 'approve', plan_id: planId, note: '' }); updateCase(approved);
      const d = await caseAction('execute', { version: approved.version }); updateCase(d);
      toast(d.status === 'recovered' ? `${d.execution?.id} verified · PKR ${fmt(d.execution?.total || 0)}` : d.alert ? 'Supplier conditions changed. Your agents re-planned.' : status(d.status).word);
      void refreshRadar();
    }),
    reconcile: () => run(active!.id, async () => { const d = await caseAction('execute', { version: active!.version }); updateCase(d); toast(d.status === 'recovered' ? `${d.execution?.id} verified` : status(d.status).word); }),
    withdraw: (supplierId: string) => run(active!.id, async () => { const d = await caseAction(`withdraw/${supplierId}`); updateCase(d); toast('Synthetic withdrawal recorded. Approve to see the execution guard.'); }),
    redispatch: (confirm: boolean) => run(active!.id, async () => { const d = await caseAction('dispatch', { confirm_resend: confirm }); updateCase(d); toast(`Notification ${d.dispatch?.status}`); }),
    startRecovery: (orderId: string) => run(orderId, async () => {
      const existing = radar?.linked_cases[orderId];
      const d = await api<RecoveryCase>(`/radar/${orderId}/case`, {}); updateCase(d); setActiveId(d.id);
      if (!existing) toast(`${d.id} opened for ${orderId}`);
      void refreshRadar(); go('recovery');
    }),
    analyze: () => run('analysis', async () => { const a = await api<RadarAnalysis>('/radar/analyze', {}); setRadar(r => r && { ...r, analysis: a }); toast('Risk analysis updated'); }),
    runChecks: async () => {
      mark('checks', true); const t0 = performance.now();
      try { const r = await api<{ name: string; ok: boolean; detail: string }[]>('/diagnostics', {}); const ms = Math.round(performance.now() - t0); return r.map(x => ({ ...x, ms })) as CheckResult[]; }
      catch (e) { return [{ name: 'Connection check', ok: false, detail: (e as Error).message, ms: Math.round(performance.now() - t0) }]; }
      finally { mark('checks', false); }
    },
    disconnect: () => { setToken(''); setLocked(true); setCases([]); setRadar(undefined); },
  };

  async function createDisruption(v: { order: string; title: string; disruption: string; budget: number; days: number }) {
    const o = radar?.orders.find(x => x.id === v.order);
    await run('create', async () => {
      const d = await api<RecoveryCase>('/cases', { title: v.title, item: o?.item, quantity: o?.quantity, location: o?.destination, disruption: v.disruption, source_po: o?.id, constraints: { budget: v.budget, deadline_days: v.days, certified_only: false, excluded_suppliers: [] } });
      updateCase(d); setActiveId(d.id); setModal(null); toast(`${d.id} reported`); void refreshRadar(); go('recovery');
    });
  }
  function copySummary(c: RecoveryCase) {
    const lines = [`ReRoute recovery report — ${c.title} (${c.id})`, `Status: ${status(c.status).word}`, '', `Disruption: ${c.disruption}`, `Need: ${c.quantity} × ${c.item} to ${c.location}. Budget PKR ${fmt(c.constraints.budget)}, ${c.constraints.deadline_days} days.`, '', `Recommendation: ${c.summary || 'none yet'}`, '', 'Options:', ...c.plans.map(o => `- ${o.supplier}: PKR ${fmt(o.total)}, ${o.lead_days} days, ${o.feasible ? 'meets constraints' : o.blockers.join('; ')}`), ...(c.execution ? ['', `Verified draft request ${c.execution.id} for PKR ${fmt(c.execution.total)}.`] : [])];
    navigator.clipboard?.writeText(lines.join('\n')).then(() => toast('Report summary copied')).catch(() => toast('Your browser blocked the clipboard. Use Print / PDF instead.'));
  }

  const attention = cases.filter(needsAttention).length;
  const Shell = useMemo(() => ({ radar: RadarPage, recovery: RecoveryPage, flow: FlowPage, suppliers: SuppliersPage, connections: ConnectionsPage })[page as Exclude<Page, 'ask'>], [page]);
  return <AppCtx.Provider value={ctx}>
    <div className="app rr">
      <nav className="rail rr-rail rr-panel" aria-label="Sections">
        <span className="mark tip" data-tip="ReRoute" aria-hidden="true"><Ic as={Route}/></span>
        {SECTIONS.map(s => <a key={s.id} href={`#${s.id}`} className="rr-rail__btn tip" data-tip={s.name} aria-label={s.name} aria-current={page === s.id ? 'page' : undefined}><Ic as={s.icon}/>{s.id === 'recovery' && attention > 0 && <span className="rr-count">{attention}</span>}</a>)}
        <span className="spacer"/><span className="rr-rail__sep"/>
        <button className="rr-rail__btn tip help" data-tip="How ReRoute works" aria-label="How ReRoute works" onClick={() => setModal('help')}><Ic as={CircleHelp}/></button>
      </nav>
      <main className="main">
        {locked ? <section className="rr-panel login" aria-labelledby="login-title">
          <span className="ai-ic"><Ic as={ShieldCheck}/></span><h1 id="login-title">Open your workspace</h1><p className="muted small">Enter the operator token configured on the server. It stays in this browser tab only.</p>
          <form className="stack" onSubmit={e => { e.preventDefault(); setToken(tokenInput.trim()); setTokenInput(''); void load(); }}>
            <label className="rr-field"><span>Workspace token</span><input className="rr-input" type="password" aria-label="Workspace token" autoComplete="current-password" required value={tokenInput} onChange={e => setTokenInput(e.target.value)}/></label>
            {loginError && <p className="xs" style={{ color: 'var(--coral-ink)', margin: 0 }}>{loginError}</p>}
            <button className="rr-btn rr-btn--primary rr-btn--lg rr-btn--block">Connect workspace</button>
          </form>
        </section> : loading ? <div className="loading"><LoaderCircle className="i spin"/>Loading your workspace…</div>
          : page === 'ask' ? <AskPage ask={(question, caseId) => api('/ask', { question, case_id: caseId })}/> : <Shell/>}
      </main>
    </div>
    {modal && <div className="scrim rr" onClick={() => setModal(null)}><div className="modal" role="dialog" aria-modal="true" aria-label={modal === 'report' ? 'Recovery report' : modal === 'help' ? 'How ReRoute works' : 'Report disruption'} onClick={e => e.stopPropagation()}>
      {modal === 'report-disruption' && <ReportForm radar={radar} busy={!!busy.create} onClose={() => setModal(null)} onSubmit={v => void createDisruption(v)}/>}
      {modal === 'report' && active && <ReportView c={active} onClose={() => setModal(null)} onCopy={() => copySummary(active)}/>}
      {modal === 'help' && <>
        <div className="modal__top"><div><div className="rr-eyebrow">About</div><h2 style={{ marginTop: 6 }}>How ReRoute works</h2></div><button className="rr-iconbtn" onClick={() => setModal(null)} aria-label="Close"><Ic as={X}/></button></div>
        <ol className="help-steps">
          <li><b>Spot the risk.</b> Risk radar scores every open order by days late ÷ days until needed, plus country signals. The AI analyst ranks what to act on.</li>
          <li><b>Investigate.</b> Your agents pull supplier quotes, check every constraint in code, and inspect the evidence.</li>
          <li><b>Direct the plan.</b> Reject a supplier, change the budget or deadline, add your reasoning, and replan. Every decision is recorded.</li>
          <li><b>Approve and verify.</b> Approval binds one plan version. Supplier conditions are re-checked first; if they changed, nothing is created and your agents re-plan. Otherwise a draft request is created and read back.</li>
        </ol>
        <p className="small muted" style={{ margin: 0 }}>{config?.agent_mode === 'demo' ? 'Demo mode: planning uses explicit rules and supplier data is synthetic.' : `Live mode: ${config?.agent_mode === 'groq' ? 'Groq' : 'Claude'} (${config?.model}) powers the agents. Supplier data is ${config?.tool_mode === 'demo' ? 'synthetic' : 'connected'}.`} No payment is ever sent.</p>
      </>}
    </div></div>}
    <div className="toasts rr" aria-live="polite">{toasts.map(t => <div key={t.id} className="toast" role="status"><Ic as={Check} sm/>{t.text}</div>)}</div>
  </AppCtx.Provider>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

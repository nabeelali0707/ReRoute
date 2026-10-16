import React, { useEffect, useMemo, useRef, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import { Bot, ChevronDown, Copy, CopyCheck, CornerDownLeft, LoaderCircle, MessageSquarePlus, ShieldCheck, Trash2, User, Workflow } from 'lucide-react';
import { api, money } from './lib';
import { RiskBadge } from './radar';
import type { Radar, RadarOrder, RecoveryCase, RiskLevel, CaseEvent } from './types';

// ---------------------------------------------------------------- shared bits
const LEVEL_COLOR: Record<RiskLevel, string> = { High: '#d03b3b', Medium: '#fab219', Low: '#0ca30c' };
const MAP_NAME: Record<string, string> = { UAE: 'United Arab Emirates' };
const countryLevel = (score: number): RiskLevel => (score <= 1 ? 'Low' : score <= 2 ? 'Medium' : 'High');

// Light Markdown from models: **bold**, line breaks and list lines, rendered as text (never as HTML).
export function Rich({ text }: { text: string }) {
  return <>{text.split('\n').map((line, n) => <React.Fragment key={n}>{n > 0 && <br/>}{line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>)}</React.Fragment>)}</>;
}

// ---------------------------------------------------------------- country map
const COUNTRIES = feature(world as unknown as Topology, (world as unknown as Topology).objects.countries as GeometryCollection);

export function CountryMap({ radar, compact = false }: { radar: Radar; compact?: boolean }) {
  const [hover, setHover] = useState<{ name: string; x: number; y: number }>();
  const [selected, setSelected] = useState<string>();
  const W = 760, H = 380;
  const path = useMemo(() => geoPath(geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], COUNTRIES)), []);
  // Country risk = summed signal severity for that origin; Pakistan is the destination.
  const byCountry = useMemo(() => {
    const out: Record<string, { score: number; orders: RadarOrder[] }> = {};
    for (const s of radar.signals) { const k = MAP_NAME[s.country] || s.country; (out[k] ??= { score: 0, orders: [] }).score += s.severity; }
    for (const o of radar.orders) { const k = MAP_NAME[o.origin] || o.origin; (out[k] ??= { score: 0, orders: [] }).orders.push(o); }
    return out;
  }, [radar]);
  const info = (name: string) => byCountry[name];
  const sel = selected ? info(selected) : undefined;
  const signalsFor = (name: string) => radar.signals.filter(s => (MAP_NAME[s.country] || s.country) === name);

  return <div className={`country-map ${compact ? 'compact' : ''}`}>
    <div className="chart-legend" aria-label="Map legend">{(['High', 'Medium', 'Low'] as RiskLevel[]).map(l => <span key={l}><i style={{ background: LEVEL_COLOR[l] }}/>{l} country risk</span>)}<span><i className="dest-swatch"/>Destination (Pakistan)</span><span><i className="none-swatch"/>No open orders</span></div>
    <div className="map-stage">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="World map of country risk for supplier origins">
        {COUNTRIES.features.map((f, i) => {
          const name = (f.properties as { name: string }).name;
          const data = info(name);
          const dest = name === 'Pakistan';
          const fill = dest ? 'var(--brand)' : data ? LEVEL_COLOR[countryLevel(data.score)] : 'var(--map-land)';
          const interactive = !!data || dest;
          return <path key={i} d={path(f) || ''} fill={fill} className={`map-country ${interactive ? 'interactive' : ''} ${selected === name ? 'selected' : ''}`} tabIndex={interactive ? 0 : -1} aria-label={interactive ? `${name}${data ? `: ${countryLevel(data.score)} risk, ${data.orders.length} open order(s)` : ': destination'}` : undefined}
            onMouseMove={e => { if (!interactive) return; const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setHover({ name, x: e.clientX - box.left, y: e.clientY - box.top }); }}
            onMouseLeave={() => setHover(undefined)}
            onClick={() => interactive && setSelected(name === selected ? undefined : name)}
            onKeyDown={e => { if (interactive && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelected(name); } }}/>;
        })}
      </svg>
      {hover && <div className="chart-tooltip map-tip" style={{ left: hover.x, top: hover.y }}><strong>{hover.name}</strong>{hover.name === 'Pakistan' ? <span>Destination of all orders</span> : info(hover.name) && <><span>{countryLevel(info(hover.name)!.score)} risk · signal severity {info(hover.name)!.score}</span><span>{info(hover.name)!.orders.length} open order(s)</span></>}</div>}
    </div>
    {!compact && <div className="map-detail" aria-live="polite">{selected && selected !== 'Pakistan' && sel ? <>
      <h4>{selected} <RiskBadge level={countryLevel(sel.score)}/></h4>
      {signalsFor(selected).map(s => <p key={s.id}><strong>{s.id}</strong> {s.category}: {s.headline}</p>)}
      {sel.orders.map(o => <p key={o.id} className="map-order"><strong>{o.id}</strong> {o.quantity} × {o.item} · PKR {money(o.value)} <RiskBadge level={o.level}/></p>)}
    </> : <p className="muted-line">Select a highlighted country to see its signals and orders.</p>}</div>}
  </div>;
}

// ---------------------------------------------------------------- agent flow
type Stage = { key: string; label: string; role: string; actors: string[] };
const STAGES: Stage[] = [
  { key: 'intake', label: 'Intake', role: 'Disruption reported or flagged by Risk Radar', actors: ['Operations', 'Risk Radar'] },
  { key: 'investigator', label: 'Investigator', role: 'Scopes the disruption and retrieves supplier records', actors: ['Investigator'] },
  { key: 'sourcing', label: 'Sourcing agent', role: 'Checks constraints and inspects quote evidence', actors: ['Sourcing agent'] },
  { key: 'planner', label: 'Recovery planner', role: 'Recommends a validated plan', actors: ['Recovery planner'] },
  { key: 'human', label: 'Human reviewer', role: 'Redirects, rejects or approves', actors: ['Human reviewer'] },
  { key: 'guard', label: 'Execution guard', role: 'Re-checks supplier conditions before acting', actors: ['Execution guard', 'Scenario simulator'] },
  { key: 'executor', label: 'Executor', role: 'Creates and verifies the draft request', actors: ['Executor', 'Coordinator'] },
];

function StageOutput({ events, extra }: { events: CaseEvent[]; extra?: string }) {
  const [open, setOpen] = useState(false);
  return <div className="stage-output">
    <button className="secondary small full" aria-expanded={open} onClick={() => setOpen(!open)}><span>Show output</span><ChevronDown size={14} className={open ? 'rotated' : ''}/></button>
    {open && <div className="stage-output-body">{extra && <p className="stage-extra"><Rich text={extra}/></p>}{events.map(e => <div key={e.id}><strong>{e.title}</strong> <time>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><p>{e.detail}</p></div>)}</div>}
  </div>;
}

export function AgentFlow({ data }: { data: RecoveryCase }) {
  const runs = data.events.filter(e => e.actor === 'Investigator' && e.title === 'Disruption scoped').length;
  return <section className="agent-flow" aria-label="Agent flow">
    <div className="flow-header"><Workflow size={18}/><div><h3>How the agents worked on {data.id}</h3><p>{runs} investigation run(s) · {data.decisions.length} human decision(s) · plan version {data.version}</p></div></div>
    <ol className="flow-list">{STAGES.map((stage, i) => {
      const events = data.events.filter(e => stage.actors.includes(e.actor));
      const extra = stage.key === 'sourcing' ? data.sourcing_review : stage.key === 'planner' ? data.summary : undefined;
      const state = events.some(e => e.kind === 'error') ? 'error' : events.length ? 'done' : 'waiting';
      const last = events[events.length - 1];
      return <li key={stage.key} className={`flow-card ${state} ${stage.key === 'human' ? 'human' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
        <div className="flow-card-top"><span className="flow-avatar">{stage.key === 'human' ? <User size={16}/> : stage.key === 'guard' ? <ShieldCheck size={16}/> : <Bot size={16}/>}</span><div><strong>{stage.label}</strong><small>{stage.role}</small></div><span className={`flow-state ${state}`}>{state === 'done' ? `${events.length} step${events.length !== 1 ? 's' : ''}` : state === 'error' ? 'Error' : 'Waiting'}</span></div>
        {last && <p className="flow-last"><strong>{last.title}</strong>: {last.detail.slice(0, 160)}{last.detail.length > 160 ? '…' : ''}</p>}
        {(events.length > 0 || extra) && <StageOutput events={events} extra={extra}/>}
      </li>;
    })}</ol>
  </section>;
}

// ---------------------------------------------------------------- chat page
type ChatMessage = { role: 'user' | 'assistant'; text: string; engine?: string; showMap?: boolean };
type ChatSession = { id: string; title: string; caseId?: string; messages: ChatMessage[]; at: string };
const STORE = 'reroute-chat-sessions';
const loadSessions = (): ChatSession[] => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } };
const saveSessions = (s: ChatSession[]) => { try { localStorage.setItem(STORE, JSON.stringify(s.slice(0, 20))); } catch { /* storage unavailable */ } };
const WELCOME: ChatMessage = { role: 'assistant', text: 'Hello! I watch your open orders and recovery cases. Ask me which orders are at risk, why a plan was recommended, or what changed in a case. I can explain, but you make every decision.' };

export function ChatPage({ cases, initialCaseId, onOpenCase }: { cases: RecoveryCase[]; initialCaseId?: string; onOpenCase: (id: string) => void }) {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [currentId, setCurrentId] = useState<string>();
  const [caseId, setCaseId] = useState<string | undefined>(initialCaseId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number>();
  const [radar, setRadar] = useState<Radar>();
  const end = useRef<HTMLDivElement>(null);
  const session = sessions.find(s => s.id === currentId);
  const messages = session?.messages ?? [WELCOME];
  useEffect(() => { api<Radar>('/radar').then(setRadar).catch(() => undefined); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, busy]);
  useEffect(() => saveSessions(sessions), [sessions]);
  const activeCase = cases.find(c => c.id === caseId);
  const suggestions = activeCase ? [`Why was this plan recommended for ${activeCase.id}?`, 'Which supplier is the safest choice and why?', 'What did the human reviewer change?'] : ['Which orders are at high risk and why?', 'Which countries have active risk signals?', 'What should I act on first today?'];

  function update(id: string, fn: (s: ChatSession) => ChatSession) { setSessions(all => all.map(s => (s.id === id ? fn(s) : s))); }
  async function send(text: string) {
    const q = text.trim(); if (q.length < 2 || busy) return;
    let id = currentId;
    if (!id) { id = `chat-${Date.now()}`; const s: ChatSession = { id, title: q.slice(0, 60), caseId, messages: [WELCOME], at: new Date().toISOString() }; setSessions(all => [s, ...all]); setCurrentId(id); }
    const sid = id;
    update(sid, s => ({ ...s, messages: [...s.messages, { role: 'user', text: q }] }));
    setInput(''); setBusy(true);
    try {
      const r = await api<{ answer: string; engine: string }>('/ask', { question: q, case_id: caseId });
      update(sid, s => ({ ...s, messages: [...s.messages, { role: 'assistant', text: r.answer, engine: r.engine, showMap: /countr|map|where|region|origin/i.test(q) }] }));
    } catch (e) { update(sid, s => ({ ...s, messages: [...s.messages, { role: 'assistant', text: (e as Error).message, engine: 'Error' }] })); }
    finally { setBusy(false); }
  }
  function mentioned(text: string) { return radar ? radar.orders.filter(o => text.replace(/[‐-―]/g, '-').includes(o.id)) : []; }
  function copy(text: string, i: number) { navigator.clipboard?.writeText(text).then(() => { setCopied(i); setTimeout(() => setCopied(undefined), 1500); }).catch(() => undefined); }

  return <div className="chat-page">
    <aside className="chat-sessions" aria-label="Chat history">
      <button className="primary full" onClick={() => { setCurrentId(undefined); setInput(''); }}><MessageSquarePlus size={15}/>New chat</button>
      <p className="nav-caption">RECENT</p>
      {sessions.length ? sessions.map(s => <div key={s.id} className={`session-row ${s.id === currentId ? 'active' : ''}`}><button className="session-open" onClick={() => { setCurrentId(s.id); setCaseId(s.caseId); }}><strong>{s.title}</strong><small>{s.caseId || 'Order book'} · {new Date(s.at).toLocaleDateString()}</small></button><button className="icon-button" aria-label={`Delete chat ${s.title}`} onClick={() => { setSessions(all => all.filter(x => x.id !== s.id)); if (s.id === currentId) setCurrentId(undefined); }}><Trash2 size={14}/></button></div>) : <p className="muted-line">No chats yet.</p>}
    </aside>
    <section className="chat-main panel">
      <div className="chat-top"><label className="chat-context">Context<select value={caseId || ''} onChange={e => setCaseId(e.target.value || undefined)} aria-label="Chat context"><option value="">Order book and risk signals</option>{cases.map(c => <option key={c.id} value={c.id}>{c.id} · {c.title}</option>)}</select></label><span className="chat-guard"><ShieldCheck size={14}/>Read-only: the AI explains, you decide</span></div>
      <div className="chat-messages" aria-live="polite">
        {messages.map((m, i) => { const orders = m.role === 'assistant' ? mentioned(m.text) : []; return <div key={i} className={`bubble-row ${m.role}`}>
          <span className="bubble-avatar" aria-hidden="true">{m.role === 'user' ? <User size={15}/> : <Bot size={15}/>}</span>
          <div className="bubble">
            <div className="bubble-text">{m.role === 'assistant' ? <Rich text={m.text}/> : m.text}</div>
            {orders.length > 0 && <div className="bubble-orders">{orders.map(o => <div key={o.id} className="mini-order"><strong>{o.id}</strong><span>{o.item}</span><RiskBadge level={o.level}/>{radar?.linked_cases[o.id] && <button className="link-button" onClick={() => onOpenCase(radar.linked_cases[o.id].case_id)}>Open {radar.linked_cases[o.id].case_id}</button>}</div>)}</div>}
            {m.showMap && radar && <div className="bubble-map"><CountryMap radar={radar} compact/></div>}
            {m.role === 'assistant' && i > 0 && <div className="bubble-actions"><button className="icon-button" aria-label="Copy answer" onClick={() => copy(m.text, i)}>{copied === i ? <CopyCheck size={14}/> : <Copy size={14}/>}</button>{m.engine && <small>{m.engine}</small>}</div>}
          </div>
        </div>; })}
        {busy && <div className="bubble-row assistant"><span className="bubble-avatar"><Bot size={15}/></span><div className="bubble"><div className="typing" aria-label="ReRoute is thinking"><i/><i/><i/></div></div></div>}
        {!session && <div className="chat-suggestions">{suggestions.map(s => <button key={s} className="chip-button" onClick={() => void send(s)}>{s}</button>)}</div>}
        <div ref={end}/>
      </div>
      <form className="chat-form" onSubmit={e => { e.preventDefault(); void send(input); }}>
        <textarea aria-label="Message ReRoute" placeholder="Ask about orders, risks or a recovery case…" value={input} maxLength={500} rows={2} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}/>
        <div className="chat-form-bar"><small>Enter to send · Shift+Enter for a new line</small><button className="primary small" disabled={busy || input.trim().length < 2}>{busy ? <LoaderCircle size={13} className="spin"/> : <CornerDownLeft size={13}/>}Send message</button></div>
      </form>
    </section>
  </div>;
}

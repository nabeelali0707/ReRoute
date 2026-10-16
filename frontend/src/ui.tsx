import React, { useMemo } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import { AlertTriangle, CheckCircle2, ShieldAlert, X, type LucideIcon } from 'lucide-react';
import type { CaseEvent, Radar as RadarData, RadarOrder, RecoveryCase, RiskLevel } from './types';

export const fmt = (n: number) => Number(n).toLocaleString('en-US');
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }).toLowerCase();

export function Ic({ as: Icon, sm, className = '' }: { as: LucideIcon; sm?: boolean; className?: string }) {
  return <Icon className={`i${sm ? ' sm' : ''}${className ? ' ' + className : ''}`} aria-hidden="true"/>;
}

// ---------------------------------------------------------------- risk + status
export type Level = 'high' | 'medium' | 'low';
export const lvl = (l: RiskLevel): Level => l.toLowerCase() as Level;
const LEVEL: Record<Level, { word: string; icon: LucideIcon }> = { high: { word: 'High', icon: ShieldAlert }, medium: { word: 'Medium', icon: AlertTriangle }, low: { word: 'Low', icon: CheckCircle2 } };
export const RiskPill = ({ level }: { level: Level }) => <span className={`rr-pill rr-pill--${level}`}><Ic as={LEVEL[level].icon}/>{LEVEL[level].word}</span>;
export const Dot = ({ level }: { level: Level | 'lilac' }) => <span className={`rr-dot rr-dot--${level}`}/>;

export const STATUS: Record<string, { word: string; dot: Level }> = {
  open: { word: 'Needs investigation', dot: 'medium' },
  investigating: { word: 'Investigating', dot: 'medium' },
  review: { word: 'Awaiting your decision', dot: 'high' },
  approved: { word: 'Approved, not executed', dot: 'high' },
  executing: { word: 'Executing', dot: 'medium' },
  recovered: { word: 'Request verified', dot: 'low' },
  blocked: { word: 'Needs attention', dot: 'high' },
  error: { word: 'Investigation failed', dot: 'high' },
  execution_error: { word: 'Reconciliation needed', dot: 'high' },
};
export const status = (s: string) => STATUS[s] || { word: s, dot: 'medium' as Level };
export const StatusPill = ({ c }: { c: RecoveryCase }) => <span className="rr-pill"><Dot level={status(c.status).dot}/>{status(c.status).word}</span>;
export const needsAttention = (c: RecoveryCase) => c.status !== 'recovered';

// Activity entries: human decisions, AI steps, warnings and successes each get their own icon tone.
export const logKind = (e: CaseEvent): 'human' | 'ok' | 'warn' | 'ai' => (e.actor === 'Human reviewer' ? 'human' : e.kind === 'success' ? 'ok' : e.kind === 'warning' || e.kind === 'error' ? 'warn' : 'ai');

export function splitLocation(location: string) {
  const [city, ...rest] = location.split(' · ');
  return { city, site: rest.join(' · ') || 'Delivery site' };
}

// Light Markdown from models: **bold**, line breaks and "- " bullets, rendered as text (never HTML).
export function Rich({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <React.Fragment key={i}>{p}</React.Fragment>));
  const flush = () => { if (bullets.length) { blocks.push(<ul key={`u${blocks.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>); bullets = []; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) { bullets.push(m[1]); continue; }
    flush();
    if (line) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

// ---------------------------------------------------------------- risk matrix
export function RiskMatrix({ orders, onPick }: { orders: RadarOrder[]; onPick: (country: string) => void }) {
  const W = 640, H = 300, l = 52, r = 20, t = 16, b = 44, iw = W - l - r, ih = H - t - b;
  const x = (v: number) => l + Math.min(v, 60) / 60 * iw, y = (v: number) => t + ih - v / 4 * ih;
  const seen: Record<string, number> = {};
  const pts = orders.map(o => { const key = `${Math.min(o.schedule_risk_pct, 60).toFixed(0)}:${o.country_score}`; const n = seen[key] = (seen[key] || 0) + 1; return { o, cx: x(o.schedule_risk_pct) + (n - 1) * 14, cy: y(o.country_score) }; });
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Risk matrix: schedule risk against country signal severity">
    {[0, 1, 2, 3, 4].map(v => <g key={v}><line className="grid-l" x1={l} x2={W - r} y1={y(v)} y2={y(v)}/><text x={l - 10} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
    {[5, 15].map(v => <g key={v}><line className="thr" x1={x(v)} x2={x(v)} y1={t} y2={t + ih}/><text x={x(v) + 4} y={t + 10}>{v}%</text></g>)}
    {[0, 20, 40, 60].map(v => <text key={v} x={x(v)} y={t + ih + 18} textAnchor={v === 60 ? 'end' : 'middle'}>{v === 60 ? '≥60%' : `${v}%`}</text>)}
    <text x={l + iw / 2} y={H - 4} textAnchor="middle">Schedule risk (days late ÷ days until needed)</text>
    <text transform={`translate(12 ${t + ih / 2}) rotate(-90)`} textAnchor="middle">Country signal severity</text>
    {pts.map(p => { const level = lvl(p.o.level), right = p.cx > W - 90; return <g key={p.o.id}>
      <circle className={`c-${level}`} cx={p.cx} cy={p.cy} r={7} tabIndex={0} aria-label={`${p.o.id} ${p.o.item}: ${p.o.level} risk`} onClick={() => onPick(p.o.origin)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(p.o.origin); } }}><title>{`${p.o.id} · ${p.o.item} · ${p.o.level}`}</title></circle>
      {level === 'high' && <text className="lbl" x={p.cx + (right ? -12 : 12)} y={p.cy - 10} textAnchor={right ? 'end' : 'start'}>{p.o.id}</text>}
    </g>; })}
  </svg>;
}

// ---------------------------------------------------------------- country map
const MAP_NAME: Record<string, string> = { UAE: 'United Arab Emirates' };
export const mapName = (country: string) => MAP_NAME[country] || country;
const COUNTRIES = feature(world as unknown as Topology, (world as unknown as Topology).objects.countries as GeometryCollection);
export const countryLevel = (score: number): Level => (score >= 3 ? 'high' : score === 2 ? 'medium' : 'low');

export function countryIndex(radar: RadarData) {
  const out: Record<string, { score: number; orders: RadarOrder[] }> = {};
  for (const o of radar.orders) (out[mapName(o.origin)] ??= { score: 0, orders: [] }).orders.push(o);
  for (const s of radar.signals) if (out[mapName(s.country)]) out[mapName(s.country)].score += s.severity;
  return out;
}

export function WorldMap({ radar, selected, onPick }: { radar: RadarData; selected: string | null; onPick: (c: string | null) => void }) {
  const path = useMemo(() => geoPath(geoNaturalEarth1().fitExtent([[4, 4], [756, 376]], COUNTRIES)), []);
  const index = useMemo(() => countryIndex(radar), [radar]);
  return <svg viewBox="0 0 760 380" role="img" aria-label="Supplier origin countries coloured by signal severity">
    {COUNTRIES.features.map((f, i) => {
      const name = (f.properties as { name: string }).name;
      const data = index[name];
      let cls = name === 'Pakistan' ? 'has dest' : data ? `has lvl-${countryLevel(data.score)}` : '';
      if (selected === name) cls += ' sel';
      const interactive = cls.includes('has');
      return <path key={i} d={path(f) || ''} className={cls} tabIndex={interactive ? 0 : undefined} aria-label={interactive ? name : undefined}
        onClick={interactive ? () => onPick(name === selected ? null : name) : undefined}
        onKeyDown={interactive ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(name); } } : undefined}><title>{name}</title></path>;
    })}
  </svg>;
}

export function CountryCard({ radar, country, onPick }: { radar: RadarData; country: string | null; onPick: (c: string | null) => void }) {
  const index = countryIndex(radar);
  const clear = <button className="rr-iconbtn" style={{ width: 28, height: 28 }} onClick={() => onPick(null)} aria-label="Clear selection"><Ic as={X} sm/></button>;
  if (!country) {
    const names = Object.keys(index).sort((a, b) => index[b].score - index[a].score);
    return <div className="solid-card country-card stack"><p className="small muted" style={{ margin: 0 }}>Select a highlighted country to see its signals and orders.</p>
      {names.map(n => <button key={n} className="rr-btn rr-btn--ghost rr-btn--sm" style={{ justifyContent: 'space-between', width: '100%' }} onClick={() => onPick(n)}><span className="row"><Dot level={countryLevel(index[n].score)}/>{n}</span><span className="subtle">{plural(index[n].orders.length, 'order')}</span></button>)}
    </div>;
  }
  if (country === 'Pakistan') {
    const sites = [...new Set(radar.orders.map(o => o.destination.split(' · ')[0]))];
    return <div className="solid-card country-card stack"><div className="row" style={{ justifyContent: 'space-between' }}><b>Pakistan</b>{clear}</div><span className="rr-tag rr-tag--lilac" style={{ justifySelf: 'start' }}>Destination</span><p className="small muted" style={{ margin: 0 }}>All open orders deliver to sites in Pakistan: {sites.join(', ')}.</p></div>;
  }
  const data = index[country];
  const signals = radar.signals.filter(s => mapName(s.country) === country);
  return <div className="solid-card country-card stack">
    <div className="row" style={{ justifyContent: 'space-between' }}><b>{country}</b>{clear}</div>
    <div><RiskPill level={countryLevel(data?.score || 0)}/> <span className="xs subtle">severity {data?.score || 0}</span></div>
    <div className="stack" style={{ gap: 8 }}>{signals.length ? signals.map(s => <div key={s.id} className="small"><span className="rr-tag rr-tag--outline">{s.id}</span> <b className="strong">{s.category}</b><div className="muted">{s.headline}</div></div>) : <p className="small muted" style={{ margin: 0 }}>No active signals.</p>}</div>
    <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>{(data?.orders || []).map(o => <div key={o.id} className="row small" style={{ justifyContent: 'space-between' }}><span><b className="strong">{o.id}</b> <span className="muted">{o.quantity} × {o.item}</span></span><RiskPill level={lvl(o.level)}/></div>)}</div>
  </div>;
}

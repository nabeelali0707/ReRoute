import asyncio
import hmac
import logging
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .models import NewCase, Decision, Execute, Dispatch, Ask
from .store import Base, engine, Session, Case, read, save, all_cases, event, now, get_setting, put_setting
from . import radar
from .workflow import workflow, assess
from .adapters import get_tools
from . import fastn
from .workflow import provider


log = logging.getLogger('reroute')
logging.basicConfig(level=logging.INFO, format='%(levelname)s:     %(name)s %(message)s')


def create_case(body, source_po=None):
    identifier = 'RR-' + uuid.uuid4().hex[:6].upper()
    source_po = source_po or body.source_po
    d = dict(id=identifier, **body.model_dump(exclude={'source_po'}), status='open', version=0, plans=[], suppliers=[], events=[], approval=None, execution=None, created_at=now(), updated_at=now(), review_note='', withdrawn_suppliers=[], decisions=[], dispatch=None, alert=None, source_po=source_po)
    event(d, 'Risk Radar' if source_po else 'Operations', 'Disruption reported', body.disruption, 'warning')
    with Session.begin() as session:
        session.add(Case(id=identifier, payload=d))
    return d


@asynccontextmanager
async def lifespan(app):
    if os.getenv('AGENT_MODE', 'demo') not in ('demo', 'anthropic', 'groq') or os.getenv('TOOL_MODE', 'demo') not in ('demo', 'fastn'):
        raise RuntimeError('Invalid provider mode.')
    if os.getenv('DISPATCH_MODE', 'off') not in ('off', 'fastn'):
        raise RuntimeError('DISPATCH_MODE must be off or fastn.')
    if os.getenv('AGENT_MODE', 'demo') != 'demo' or os.getenv('TOOL_MODE', 'demo') != 'demo' or fastn.dispatch_enabled():
        if len(os.getenv('APP_TOKEN', '')) < 24:
            raise RuntimeError('Set a strong APP_TOKEN (at least 24 characters) for connected modes.')
    if os.getenv('AGENT_MODE') == 'groq' and not os.getenv('GROQ_API_KEY'):
        raise RuntimeError('Groq mode requires GROQ_API_KEY (free at console.groq.com/keys).')
    if os.getenv('AGENT_MODE') == 'anthropic' and not os.getenv('ANTHROPIC_API_KEY'):
        raise RuntimeError('Anthropic mode requires ANTHROPIC_API_KEY.')
    if fastn.dispatch_enabled() and not all(os.getenv(k) for k in ('FASTN_API_KEY', 'FASTN_PROJECT_ID', 'FASTN_DISPATCH_ACTION_ID')):
        raise RuntimeError('fastn dispatch requires FASTN_API_KEY, FASTN_PROJECT_ID and FASTN_DISPATCH_ACTION_ID.')
    if os.getenv('TOOL_MODE') == 'fastn' and not os.getenv('FASTN_MCP_URL', '').startswith('https://'):
        raise RuntimeError('fastn mode requires an HTTPS FASTN_MCP_URL.')
    Base.metadata.create_all(engine)
    # One application worker owns this demo workspace. Recover operations whose
    # process died; execution retries retain the original idempotency key.
    for record in all_cases():
        if record['status'] in ('investigating', 'executing'):
            d, revision = read(record['id'])
            was_execution = d['status'] == 'executing'
            d['status'] = 'execution_error' if was_execution else 'error'
            event(d, 'System', 'Interrupted operation recovered', 'Server restarted. Reconcile the existing request before retrying.' if was_execution else 'Server restarted. Investigation can be retried.', 'warning')
            save(d['id'], d, revision)
        if (record.get('dispatch') or {}).get('status') == 'sending':
            d, revision = read(record['id'])
            d['dispatch']['status'] = 'unknown'
            event(d, 'System', 'Dispatch outcome unknown', 'Server restarted while notifying the connected app. Check the destination before resending.', 'warning')
            save(d['id'], d, revision)
    if not all_cases() and os.getenv('TOOL_MODE', 'demo') == 'demo':
        create_case(NewCase())
        create_case(NewCase(title='Replacement sensor shipment delayed', item='Temperature sensor', quantity=12, location='Lahore · Assembly line', disruption='Demo scenario: original supplier cannot dispatch replacement sensors before the production restart.'))
    yield


app = FastAPI(title='ReRoute', lifespan=lifespan)


def authorize(authorization: str = Header(default='')):
    token = os.getenv('APP_TOKEN', '')
    if token and not hmac.compare_digest(authorization, 'Bearer ' + token):
        raise HTTPException(401, 'Workspace token required.')


def normalize(d):
    # Cases saved by earlier releases predate these fields.
    for key, default in (('decisions', []), ('dispatch', None), ('alert', None), ('source_po', None)):
        d.setdefault(key, default)
    d['constraints'].setdefault('excluded_suppliers', [])
    return d


def load_case(identifier):
    try:
        d, revision = read(identifier)
    except KeyError:
        raise HTTPException(404, 'Case not found.')
    return normalize(d), revision


def record_decision(d, action, **details):
    d['decisions'].append({'version': d['version'], 'action': action, 'at': now(), **details})


def persist(identifier, data, revision):
    try:
        return save(identifier, data, revision)
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@app.post('/api/diagnostics', dependencies=[Depends(authorize)])
async def diagnostics():
    """Make one small real call to each configured live provider; never reports success without a response."""
    async def check(name, run):
        try:
            async with asyncio.timeout(60):
                return {'name': name, 'ok': True, 'detail': await run()}
        except Exception as exc:
            detail = str(exc)[:240] if isinstance(exc, (fastn.FastnError, ValueError)) else f'{type(exc).__name__}: could not reach the provider.'
            return {'name': name, 'ok': False, 'detail': detail}
    results = []
    if provider():
        results.append(await check('Reasoning model', provider().ping))
    if fastn.dispatch_enabled():
        async def fastn_check():
            found = await fastn.find_tools('send a message or create a record for a procurement team')
            tools = found.get('tools', []) if isinstance(found, dict) else found
            configured = os.getenv('FASTN_DISPATCH_ACTION_ID')
            listed = any(isinstance(t, dict) and configured in json.dumps(t) for t in tools)
            return f"fastn gateway reachable · {len(tools)} matching action(s)" + (' · configured action found' if listed else ' · configured action not in this search (it may still be valid)')
        results.append(await check('fastn MCP gateway', fastn_check))
    if not results:
        results.append({'name': 'Demo mode', 'ok': True, 'detail': 'No live providers configured; nothing external to check.'})
    return results


def radar_context(pf):
    """Compact, model-friendly view of the portfolio (keeps free-tier token use low)."""
    return {
        'currency': 'PKR',
        'orders': [{k: o[k] for k in ('id', 'item', 'quantity', 'origin', 'value', 'required_days', 'promised_days', 'schedule_risk_pct', 'level', 'signal_ids')} for o in pf['orders']],
        'signals': [{k: s[k] for k in ('id', 'country', 'category', 'severity', 'headline')} for s in pf['signals']],
    }


@app.get('/api/radar', dependencies=[Depends(authorize)])
def get_radar():
    pf = radar.portfolio()
    linked = {}
    for d in all_cases():
        if d.get('source_po'):
            linked[d['source_po']] = {'case_id': d['id'], 'status': d['status']}
    return {**pf, 'analysis': get_setting('radar_analysis'), 'linked_cases': linked}


@app.post('/api/radar/analyze', dependencies=[Depends(authorize)])
async def analyze_radar():
    pf = radar.portfolio()
    ids = {o['id'] for o in pf['orders']}
    analysis = {'at': now(), 'engine': 'Rule-based demo analyst', 'summary': pf['rule_summary'],
                'priorities': [{'id': o['id'], 'action': 'Open a recovery case and compare alternatives before the need date.'} for o in pf['orders'] if o['level'] == 'High'][:3]}
    if provider():
        try:
            async with asyncio.timeout(120):
                result = await provider().analyze_portfolio(radar_context(pf))
            priorities = [{'id': p['id'], 'action': str(p.get('action', ''))[:200]} for p in result.get('priorities', []) if isinstance(p, dict) and p.get('id') in ids][:3]
            if not isinstance(result.get('summary'), str) or not result['summary'].strip():
                raise ValueError('Analyst returned no summary.')
            analysis = {'at': now(), 'engine': f"{'Groq' if os.getenv('AGENT_MODE') == 'groq' else 'Claude'} · {provider().model()}", 'summary': result['summary'][:600], 'priorities': priorities}
        except Exception as exc:
            log.exception('Radar analysis failed')
            raise HTTPException(502, str(exc)[:240] if isinstance(exc, ValueError) else 'The AI analyst could not be reached. Try again in a minute.')
    put_setting('radar_analysis', analysis)
    return analysis


@app.post('/api/radar/{order_id}/case', status_code=201, dependencies=[Depends(authorize)])
def open_radar_case(order_id: str):
    order = next((o for o in radar.portfolio()['orders'] if o['id'] == order_id), None)
    if order is None:
        raise HTTPException(404, 'Order not found.')
    existing = next((d for d in all_cases() if d.get('source_po') == order_id and d['status'] != 'recovered'), None)
    if existing:
        return normalize(existing)
    return create_case(NewCase(**radar.case_from_order(order)), source_po=order_id)


@app.post('/api/ask', dependencies=[Depends(authorize)])
async def ask_reroute(body: Ask):
    pf = radar.portfolio()
    context = radar_context(pf)
    if body.case_id:
        d = load_case(body.case_id)[0]
        context['open_case'] = {
            'id': d['id'], 'title': d['title'], 'status': d['status'], 'item': d['item'], 'quantity': d['quantity'],
            'constraints': d['constraints'], 'recommended_id': d.get('recommended_id'), 'summary': d.get('summary', ''),
            'plans': [{k: p[k] for k in ('id', 'supplier', 'total', 'lead_days', 'certified', 'feasible', 'blockers', 'evidence_id')} for p in d['plans']],
            'decisions': d.get('decisions', [])[-5:], 'execution': d.get('execution'),
        }
    if not provider():
        return {'answer': f"Live AI is off in demo mode, so here is the rule-based view: {pf['rule_summary']}", 'engine': 'Rule-based demo'}
    try:
        async with asyncio.timeout(120):
            text = await provider().answer(body.question, context)
    except Exception as exc:
        log.exception('Ask failed')
        raise HTTPException(502, str(exc)[:240] if isinstance(exc, ValueError) else 'The AI could not be reached. Try again in a minute.')
    return {'answer': text[:2000] or 'No answer was returned.', 'engine': provider().model()}


@app.get('/api/health')
def health():
    return {'status': 'ok'}


@app.get('/api/config')
def config():
    return {'agent_mode': os.getenv('AGENT_MODE', 'demo'), 'tool_mode': os.getenv('TOOL_MODE', 'demo'), 'auth_required': bool(os.getenv('APP_TOKEN')), 'model': provider().model() if provider() else None,
            'dispatch_mode': os.getenv('DISPATCH_MODE', 'off'), 'dispatch_label': fastn.dispatch_label() if fastn.dispatch_enabled() else None}


@app.get('/api/cases', dependencies=[Depends(authorize)])
def list_cases():
    return sorted(map(normalize, all_cases()), key=lambda d: d['created_at'], reverse=True)


@app.post('/api/cases', status_code=201, dependencies=[Depends(authorize)])
def new_case(body: NewCase):
    if body.source_po and body.source_po not in {o['id'] for o in radar.ORDERS}:
        raise HTTPException(422, 'Unknown purchase order.')
    return create_case(body)


@app.get('/api/cases/{identifier}', dependencies=[Depends(authorize)])
def get_case(identifier: str):
    return load_case(identifier)[0]


async def run_investigation(identifier, d, revision):
    d['version'] += 1
    d['status'] = 'investigating'
    d['approval'] = None
    d['plans'] = []
    d['recommended_id'] = None
    revision = persist(identifier, d, revision)
    try:
        async with asyncio.timeout(180):
            result = await workflow.ainvoke({'case': d})
        d = result['case']
    except Exception as exc:
        log.exception('Investigation %s failed', identifier)
        reason = str(exc)[:240] if isinstance(exc, ValueError) else f'{type(exc).__name__} from the configured provider.'
        # Graph nodes mutate the case in place; discard partial results from the failed run.
        d.update(status='error', plans=[], recommended_id=None, summary='', sourcing_review='')
        event(d, 'System', 'Investigation interrupted', f'{reason} No action was executed. Retry with Re-investigate.', 'error')
    persist(identifier, d, revision)
    return d


@app.post('/api/cases/{identifier}/investigate', dependencies=[Depends(authorize)])
async def investigate(identifier: str):
    d, revision = load_case(identifier)
    if d['status'] in ('investigating', 'executing', 'recovered', 'execution_error'):
        raise HTTPException(409, 'Case cannot be investigated in its current state.')
    return await run_investigation(identifier, d, revision)


def describe_changes(old, new):
    changes = []
    if old['budget'] != new['budget']:
        changes.append(f"Budget PKR {old['budget']:,} → {new['budget']:,}")
    if old['deadline_days'] != new['deadline_days']:
        changes.append(f"Deadline {old['deadline_days']} → {new['deadline_days']} days")
    if old['certified_only'] != new['certified_only']:
        changes.append('Certification required' if new['certified_only'] else 'Certification no longer required')
    return changes


@app.post('/api/cases/{identifier}/decision', dependencies=[Depends(authorize)])
async def decision(identifier: str, body: Decision):
    d, revision = load_case(identifier)
    if body.version != d['version'] or d['status'] not in ('review', 'blocked', 'approved'):
        raise HTTPException(409, 'This plan is stale or not awaiting review. Refresh the case.')
    if body.action == 'revise':
        if body.constraints is None or not body.note.strip():
            raise HTTPException(422, 'Replanning requires constraints and a reason.')
        known = {p['id']: p['supplier'] for p in d['plans']}
        if any(s not in known and s not in d['constraints']['excluded_suppliers'] for s in body.constraints.excluded_suppliers):
            raise HTTPException(422, 'Only suppliers in this case can be rejected.')
        newly_rejected = [known[s] for s in body.constraints.excluded_suppliers if s not in d['constraints']['excluded_suppliers']]
        recommended = next((p for p in d['plans'] if p['id'] == d.get('recommended_id')), None)
        record_decision(d, 'revised', note=body.note, rejected=newly_rejected, previous_recommendation=recommended['supplier'] if recommended else None,
                        changes=describe_changes(d['constraints'], body.constraints.model_dump()))
        d['constraints'] = body.constraints.model_dump()
        d['review_note'] = body.note
        d['alert'] = None
        event(d, 'Human reviewer', 'Recovery constraints revised', body.note + (f" Rejected: {', '.join(newly_rejected)}." if newly_rejected else ''), 'warning')
        return await run_investigation(identifier, d, revision)
    plan = next((p for p in d['plans'] if p['id'] == body.plan_id and p['feasible']), None)
    if plan is None:
        raise HTTPException(422, 'Choose a feasible plan.')
    d['approval'] = {'plan_id': plan['id'], 'version': d['version'], 'at': now(), 'note': body.note, 'total': plan['total']}
    d['status'] = 'approved'
    d['alert'] = None
    record_decision(d, 'approved', plan_id=plan['id'], supplier=plan['supplier'], total=plan['total'], note=body.note)
    event(d, 'Human reviewer', 'Plan approved', f"Version {d['version']} · {plan['supplier']} · PKR {plan['total']:,}. {body.note}", 'success')
    persist(identifier, d, revision)
    return d


@app.post('/api/cases/{identifier}/execute', dependencies=[Depends(authorize)])
async def execute(identifier: str, body: Execute):
    d, revision = load_case(identifier)
    if body.version != d['version']:
        raise HTTPException(409, 'Plan version changed. Review again.')
    if d['status'] == 'recovered':
        return d
    if d['status'] not in ('approved', 'execution_error') or not d['approval'] or d['approval']['version'] != d['version']:
        raise HTTPException(409, 'A current human approval is required before execution.')
    d['status'] = 'executing'
    revision = persist(identifier, d, revision)
    key = f"{identifier}:v{d['version']}:{d['approval']['plan_id']}"
    tools = get_tools()
    replan = False
    try:
        async with asyncio.timeout(120):
            expected = dict(idempotency_key=key, case_id=identifier, supplier_id=d['approval']['plan_id'], quantity=d['quantity'], total=d['approval']['total'])
            existing = await tools.lookup(key)
            if existing is None:
                snapshot = await tools.snapshot(d)
                supplier = next((s for s in snapshot.suppliers if s.id == expected['supplier_id']), None)
                current = assess(supplier.model_dump(), d) if supplier else None
                if current is None or not current['feasible'] or current['total'] != expected['total']:
                    approved = next((p for p in d['plans'] if p['id'] == expected['supplier_id']), {})
                    reason = '; '.join(current['blockers']) if current and current['blockers'] else 'Supplier no longer listed' if current is None else f"Price changed to PKR {current['total']:,}"
                    record_decision(d, 'invalidated', plan_id=expected['supplier_id'], supplier=approved.get('supplier'), total=expected['total'], note=reason)
                    d['alert'] = {'title': f"{approved.get('supplier', 'Approved supplier')} can no longer fulfil this plan", 'detail': f"{reason}. Your approval was revoked before anything was created, and your agents re-planned against current supplier conditions. Review the new plan."}
                    event(d, 'Execution guard', 'Approval invalidated', f"Live re-check before execution: {reason}. No request was created.", 'warning')
                    event(d, 'Recovery planner', 'Re-planning automatically', 'Searching current supplier conditions for another feasible recovery path.')
                    replan = True
                else:
                    await tools.create(expected)
            if not replan:
                verified = await tools.lookup(key)
                if verified is None or any(getattr(verified, k) != v for k, v in expected.items()) or verified.status != 'draft':
                    raise ValueError('Destination read-back does not match the approved request.')
                d['execution'] = verified.model_dump()
                d['status'] = 'recovered'
                event(d, 'Executor', 'Purchase request created and verified', f"{verified.id} read back from {'local demo ledger' if os.getenv('TOOL_MODE', 'demo') == 'demo' else 'fastn-connected system'}. Draft only; no payment sent and delivery not confirmed.", 'success')
    except Exception:
        d['status'] = 'execution_error'
        event(d, 'Executor', 'Execution needs reconciliation', 'Could not verify the destination record. Retry checks the same idempotency key before creating anything. Approval and request key remain unchanged.', 'error')
    if replan:
        # Outside the execution timeout: re-planning may call the model and has its own limit.
        return await run_investigation(identifier, d, revision)
    revision = persist(identifier, d, revision)
    if d['status'] == 'recovered' and fastn.dispatch_enabled():
        return await run_dispatch(identifier, d, revision)
    return d


async def run_dispatch(identifier, d, revision):
    label = fastn.dispatch_label()
    d['dispatch'] = {'status': 'sending', 'label': label, 'at': now()}
    revision = persist(identifier, d, revision)
    try:
        result = await fastn.dispatch(d)
        d['dispatch'] = {'status': 'sent', 'label': label, 'at': now(), 'result': result}
        event(d, 'Coordinator', 'Recovery dispatched through fastn', f"{label} · execute_tool completed. Connector response recorded as evidence.", 'success')
    except Exception as exc:
        reason = str(exc)[:300] if isinstance(exc, fastn.FastnError) else f'{type(exc).__name__} while contacting fastn.'
        d['dispatch'] = {'status': 'failed', 'label': label, 'at': now(), 'error': reason}
        event(d, 'Coordinator', 'Dispatch failed', f"{label}: {reason} The verified request is unaffected; retry when the connector is available.", 'error')
    persist(identifier, d, revision)
    return d


@app.post('/api/cases/{identifier}/dispatch', dependencies=[Depends(authorize)])
async def redispatch(identifier: str, body: Dispatch):
    if not fastn.dispatch_enabled():
        raise HTTPException(409, 'fastn dispatch is not configured.')
    d, revision = load_case(identifier)
    state = (d['dispatch'] or {}).get('status')
    if d['status'] != 'recovered' or state in ('sent', 'sending'):
        raise HTTPException(409, 'Nothing to dispatch for this case.')
    if state == 'unknown' and not body.confirm_resend:
        raise HTTPException(409, 'The previous dispatch may have been delivered. Check the destination, then confirm resending.')
    return await run_dispatch(identifier, d, revision)


@app.post('/api/cases/{identifier}/withdraw/{supplier_id}', dependencies=[Depends(authorize)])
def withdraw(identifier: str, supplier_id: str):
    if os.getenv('TOOL_MODE', 'demo') != 'demo':
        raise HTTPException(403, 'Scenario controls are only available with demo tools.')
    d, revision = load_case(identifier)
    if d['status'] in ('investigating', 'executing', 'recovered', 'execution_error'):
        raise HTTPException(409, 'Cannot change this case now.')
    if supplier_id not in [s['id'] for s in d['suppliers']]:
        raise HTTPException(404, 'Supplier not found.')
    if supplier_id not in d['withdrawn_suppliers']:
        d['withdrawn_suppliers'].append(supplier_id)
    event(d, 'Scenario simulator', 'Supplier availability withdrawn', 'Synthetic change: execution must refresh availability before proceeding.', 'warning')
    persist(identifier, d, revision)
    return d


@app.get('/api/cases/{identifier}/events', dependencies=[Depends(authorize)])
async def events(identifier: str):
    load_case(identifier)
    async def stream():
        last = None
        for _ in range(90):
            d, revision = load_case(identifier)
            if revision != last:
                yield f'data: {json.dumps(d)}\n\n'
                last = revision
            else:
                yield ': keepalive\n\n'
            await asyncio.sleep(2)
    return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache'})


dist = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
if dist.exists():
    app.mount('/assets', StaticFiles(directory=dist / 'assets'), name='assets')
    @app.get('/')
    def index():
        return FileResponse(dist / 'index.html')

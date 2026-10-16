import asyncio
import hmac
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .models import NewCase, Decision, Execute, PurchaseRequest
from .store import Base, engine, Session, Case, read, save, all_cases, event, now
from .workflow import workflow, assess
from .adapters import get_tools


def create_case(body):
    identifier = 'RR-' + uuid.uuid4().hex[:6].upper()
    d = dict(id=identifier, **body.model_dump(), status='open', version=0, plans=[], suppliers=[], events=[], approval=None, execution=None, created_at=now(), updated_at=now(), review_note='', withdrawn_suppliers=[])
    event(d, 'Operations', 'Disruption reported', body.disruption, 'warning')
    with Session.begin() as session:
        session.add(Case(id=identifier, payload=d))
    return d


@asynccontextmanager
async def lifespan(app):
    if os.getenv('AGENT_MODE', 'demo') not in ('demo', 'anthropic') or os.getenv('TOOL_MODE', 'demo') not in ('demo', 'fastn'):
        raise RuntimeError('Invalid provider mode.')
    if os.getenv('AGENT_MODE', 'demo') != 'demo' or os.getenv('TOOL_MODE', 'demo') != 'demo':
        if len(os.getenv('APP_TOKEN', '')) < 24:
            raise RuntimeError('Set a strong APP_TOKEN (at least 24 characters) for connected modes.')
    if os.getenv('AGENT_MODE') == 'anthropic' and not all(os.getenv(k) for k in ('ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL')):
        raise RuntimeError('Anthropic mode requires ANTHROPIC_API_KEY and ANTHROPIC_MODEL.')
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
    if not all_cases() and os.getenv('TOOL_MODE', 'demo') == 'demo':
        create_case(NewCase())
        create_case(NewCase(title='Replacement sensor shipment delayed', item='Temperature sensor', quantity=12, location='Lahore · Assembly line', disruption='Demo scenario: original supplier cannot dispatch replacement sensors before the production restart.'))
    yield


app = FastAPI(title='ReRoute', lifespan=lifespan)


def authorize(authorization: str = Header(default='')):
    token = os.getenv('APP_TOKEN', '')
    if token and not hmac.compare_digest(authorization, 'Bearer ' + token):
        raise HTTPException(401, 'Workspace token required.')


def load_case(identifier):
    try:
        return read(identifier)
    except KeyError:
        raise HTTPException(404, 'Case not found.')


def persist(identifier, data, revision):
    try:
        return save(identifier, data, revision)
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@app.get('/api/health')
def health():
    return {'status': 'ok'}


@app.get('/api/config')
def config():
    return {'agent_mode': os.getenv('AGENT_MODE', 'demo'), 'tool_mode': os.getenv('TOOL_MODE', 'demo'), 'auth_required': bool(os.getenv('APP_TOKEN')), 'model': os.getenv('ANTHROPIC_MODEL') if os.getenv('AGENT_MODE') == 'anthropic' else None}


@app.get('/api/cases', dependencies=[Depends(authorize)])
def list_cases():
    return sorted(all_cases(), key=lambda d: d['created_at'], reverse=True)


@app.post('/api/cases', status_code=201, dependencies=[Depends(authorize)])
def new_case(body: NewCase):
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
        async with asyncio.timeout(90):
            result = await workflow.ainvoke({'case': d})
        d = result['case']
    except Exception:
        d['status'] = 'error'
        event(d, 'System', 'Investigation interrupted', 'The configured provider failed or returned invalid data. Check connectivity and configuration, then retry. No action was executed.', 'error')
    persist(identifier, d, revision)
    return d


@app.post('/api/cases/{identifier}/investigate', dependencies=[Depends(authorize)])
async def investigate(identifier: str):
    d, revision = load_case(identifier)
    if d['status'] in ('investigating', 'executing', 'recovered', 'execution_error'):
        raise HTTPException(409, 'Case cannot be investigated in its current state.')
    return await run_investigation(identifier, d, revision)


@app.post('/api/cases/{identifier}/decision', dependencies=[Depends(authorize)])
async def decision(identifier: str, body: Decision):
    d, revision = load_case(identifier)
    if body.version != d['version'] or d['status'] not in ('review', 'blocked', 'approved'):
        raise HTTPException(409, 'This plan is stale or not awaiting review. Refresh the case.')
    if body.action == 'revise':
        if body.constraints is None or not body.note.strip():
            raise HTTPException(422, 'Replanning requires constraints and a reason.')
        d['constraints'] = body.constraints.model_dump()
        d['review_note'] = body.note
        event(d, 'Human reviewer', 'Recovery constraints revised', body.note, 'warning')
        return await run_investigation(identifier, d, revision)
    plan = next((p for p in d['plans'] if p['id'] == body.plan_id and p['feasible']), None)
    if plan is None:
        raise HTTPException(422, 'Choose a feasible plan.')
    d['approval'] = {'plan_id': plan['id'], 'version': d['version'], 'at': now(), 'note': body.note, 'total': plan['total']}
    d['status'] = 'approved'
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
    try:
        async with asyncio.timeout(120):
            expected = dict(idempotency_key=key, case_id=identifier, supplier_id=d['approval']['plan_id'], quantity=d['quantity'], total=d['approval']['total'])
            existing = await tools.lookup(key)
            if existing is None:
                snapshot = await tools.snapshot(d)
                supplier = next((s for s in snapshot.suppliers if s.id == expected['supplier_id']), None)
                current = assess(supplier.model_dump(), d) if supplier else None
                if current is None or not current['feasible'] or current['total'] != expected['total']:
                    d['status'] = 'blocked'
                    d['approval'] = None
                    d['plans'] = []
                    d['recommended_id'] = None
                    d['version'] += 1
                    d['summary'] = 'Supplier conditions changed. Re-investigate before approving another plan.'
                    event(d, 'Execution guard', 'Approval invalidated', d['summary'], 'warning')
                    persist(identifier, d, revision)
                    return d
                await tools.create(expected)
            verified = await tools.lookup(key)
            if verified is None or any(getattr(verified, k) != v for k, v in expected.items()) or verified.status != 'draft':
                raise ValueError('Destination read-back does not match the approved request.')
            d['execution'] = verified.model_dump()
            d['status'] = 'recovered'
            event(d, 'Executor', 'Purchase request created and verified', f"{verified.id} read back from {'local demo ledger' if os.getenv('TOOL_MODE', 'demo') == 'demo' else 'fastn-connected system'}. Draft only; no payment sent and delivery not confirmed.", 'success')
    except Exception:
        d['status'] = 'execution_error'
        event(d, 'Executor', 'Execution needs reconciliation', 'Could not verify the destination record. Retry checks the same idempotency key before creating anything. Approval and request key remain unchanged.', 'error')
    persist(identifier, d, revision)
    return d


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

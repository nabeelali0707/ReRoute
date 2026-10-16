import os
import tempfile
from pathlib import Path

# Independent on-disk database; never modify the user's development cases.
_tmp = tempfile.TemporaryDirectory()
os.environ['DATABASE_URL'] = 'sqlite:///' + str(Path(_tmp.name) / 'tests.db')
os.environ['AGENT_MODE'] = 'demo'
os.environ['TOOL_MODE'] = 'demo'
os.environ.pop('APP_TOKEN', None)

import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.store import read, save, engine
from backend.adapters import DemoTools


@pytest.fixture(scope='session', autouse=True)
def cleanup_database():
    yield
    engine.dispose()
    _tmp.cleanup()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def case(client, **kwargs):
    response = client.post('/api/cases', json=kwargs)
    assert response.status_code == 201
    return response.json()


def investigate(client, identifier):
    response = client.post(f'/api/cases/{identifier}/investigate')
    assert response.status_code == 200
    return response.json()


def approve(client, d):
    response = client.post(f"/api/cases/{d['id']}/decision", json={'version': d['version'], 'action': 'approve', 'plan_id': d['recommended_id']})
    assert response.status_code == 200
    return response.json()


def test_human_replans_and_execution_is_idempotent(client):
    d = investigate(client, case(client)['id'])
    assert d['recommended_id'] == 'atlas'
    revised = client.post(f"/api/cases/{d['id']}/decision", json={'version': 1, 'action': 'revise', 'note': 'Certified equipment is required by the lab.', 'constraints': {'budget': 180000, 'deadline_days': 3, 'certified_only': True}}).json()
    assert revised['recommended_id'] == 'northstar'
    assert revised['version'] == 2
    assert client.post(f"/api/cases/{d['id']}/decision", json={'version': 1, 'action': 'approve', 'plan_id': 'atlas'}).status_code == 409
    approve(client, revised)
    executed = client.post(f"/api/cases/{d['id']}/execute", json={'version': 2}).json()
    assert executed['status'] == 'recovered'
    assert executed['execution']['total'] == 145800
    again = client.post(f"/api/cases/{d['id']}/execute", json={'version': 2}).json()
    assert again['execution'] == executed['execution']
    assert read(d['id'])[0]['execution'] == executed['execution']


def test_unapproved_execution_and_infeasible_approval_blocked(client):
    d = investigate(client, case(client)['id'])
    assert client.post(f"/api/cases/{d['id']}/execute", json={'version': 1}).status_code == 409
    assert client.post(f"/api/cases/{d['id']}/decision", json={'version': 1, 'action': 'approve', 'plan_id': 'meridian'}).status_code == 422


def test_supplier_withdrawal_invalidates_approval_and_replans(client):
    d = approve(client, investigate(client, case(client)['id']))
    client.post(f"/api/cases/{d['id']}/withdraw/atlas")
    result = client.post(f"/api/cases/{d['id']}/execute", json={'version': 1}).json()
    assert result['status'] == 'review'
    assert result['version'] == 2
    assert result['approval'] is None
    assert result['execution'] is None
    assert result['recommended_id'] == 'northstar'
    assert 'Supplier withdrew availability' in result['alert']['detail']
    assert [x['action'] for x in result['decisions']] == ['approved', 'invalidated']
    # The old approval cannot be replayed against the new plan.
    assert client.post(f"/api/cases/{d['id']}/execute", json={'version': 2}).status_code == 409
    assert approve(client, result)['alert'] is None
    final = client.post(f"/api/cases/{d['id']}/execute", json={'version': 2}).json()
    assert final['status'] == 'recovered' and final['execution']['supplier_id'] == 'northstar'


def test_reviewer_rejects_specific_supplier(client):
    d = investigate(client, case(client)['id'])
    assert d['recommended_id'] == 'atlas'
    revised = client.post(f"/api/cases/{d['id']}/decision", json={'version': 1, 'action': 'revise', 'note': 'Atlas failed our last two compatibility audits.', 'constraints': {'budget': 180000, 'deadline_days': 3, 'certified_only': False, 'excluded_suppliers': ['atlas']}}).json()
    assert revised['recommended_id'] == 'northstar'
    atlas = next(p for p in revised['plans'] if p['id'] == 'atlas')
    assert not atlas['feasible'] and 'Rejected by reviewer' in atlas['blockers']
    decision = revised['decisions'][-1]
    assert decision['action'] == 'revised' and decision['rejected'] == ['Atlas Components'] and decision['previous_recommendation'] == 'Atlas Components'
    bad = client.post(f"/api/cases/{d['id']}/decision", json={'version': 2, 'action': 'revise', 'note': 'x', 'constraints': {'excluded_suppliers': ['nobody']}})
    assert bad.status_code == 422


def test_fastn_dispatch_after_verification(client, monkeypatch):
    from backend import fastn
    sent = []
    async def fake_dispatch(d):
        sent.append(fastn.dispatch_values(d))
        return '{"ok": true, "ts": "1"}'
    monkeypatch.setenv('DISPATCH_MODE', 'fastn')
    monkeypatch.setattr(fastn, 'dispatch', fake_dispatch)
    d = approve(client, investigate(client, case(client)['id']))
    result = client.post(f"/api/cases/{d['id']}/execute", json={'version': 1}).json()
    assert result['status'] == 'recovered' and result['dispatch']['status'] == 'sent'
    assert sent[0]['request_id'] == result['execution']['id'] and 'PKR 118,500' in sent[0]['message']
    # Repeat execution is idempotent and never re-notifies.
    client.post(f"/api/cases/{d['id']}/execute", json={'version': 1})
    assert len(sent) == 1
    assert client.post(f"/api/cases/{d['id']}/dispatch", json={}).status_code == 409


def test_failed_dispatch_keeps_request_and_can_retry(client, monkeypatch):
    from backend import fastn
    async def broken(d):
        raise fastn.FastnError('fastn AUTH_ERROR: token expired')
    monkeypatch.setenv('DISPATCH_MODE', 'fastn')
    monkeypatch.setattr(fastn, 'dispatch', broken)
    d = approve(client, investigate(client, case(client)['id']))
    result = client.post(f"/api/cases/{d['id']}/execute", json={'version': 1}).json()
    assert result['status'] == 'recovered'
    assert result['dispatch'] == {**result['dispatch'], 'status': 'failed', 'error': 'fastn AUTH_ERROR: token expired'}
    async def works(d):
        return '{}'
    monkeypatch.setattr(fastn, 'dispatch', works)
    assert client.post(f"/api/cases/{d['id']}/dispatch", json={}).json()['dispatch']['status'] == 'sent'


def test_unknown_dispatch_requires_confirmation(client, monkeypatch):
    from backend import fastn
    async def works(d):
        return '{}'
    monkeypatch.setenv('DISPATCH_MODE', 'fastn')
    monkeypatch.setattr(fastn, 'dispatch', works)
    d = approve(client, investigate(client, case(client)['id']))
    monkeypatch.setenv('DISPATCH_MODE', 'off')
    client.post(f"/api/cases/{d['id']}/execute", json={'version': 1})
    monkeypatch.setenv('DISPATCH_MODE', 'fastn')
    data, revision = read(d['id'])
    data['dispatch'] = {'status': 'unknown', 'label': 'Slack', 'at': 'now'}
    save(d['id'], data, revision)
    assert client.post(f"/api/cases/{d['id']}/dispatch", json={}).status_code == 409
    assert client.post(f"/api/cases/{d['id']}/dispatch", json={'confirm_resend': True}).json()['dispatch']['status'] == 'sent'


def test_claude_agents_offline(client, monkeypatch):
    import json
    import httpx
    from anthropic import AsyncAnthropic
    from backend import agents
    requests = []
    def message(content, stop='end_turn'):
        return {'id': 'msg_1', 'type': 'message', 'role': 'assistant', 'model': 'claude-opus-5-5', 'content': content, 'stop_reason': stop, 'stop_sequence': None, 'usage': {'input_tokens': 1, 'output_tokens': 1}}
    replies = iter([
        message([{'type': 'tool_use', 'id': 'tu_1', 'name': 'inspect_supplier_quote', 'input': {'supplier_id': 'northstar'}}], 'tool_use'),
        message([{'type': 'text', 'text': 'Northstar provides SPEC-204 certification; Atlas lacks it.'}]),
        message([{'type': 'text', 'text': json.dumps({'recommended_id': 'northstar', 'summary': 'Northstar is certified and arrives next day.'})}]),
    ])
    def handler(request):
        requests.append((request.headers, json.loads(request.content)))
        return httpx.Response(200, json=next(replies))
    monkeypatch.setenv('AGENT_MODE', 'anthropic')
    monkeypatch.setattr(agents, 'AsyncAnthropic', lambda **kw: AsyncAnthropic(api_key='test', http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), **kw))
    d = investigate(client, case(client)['id'])
    assert d['status'] == 'review' and d['recommended_id'] == 'northstar'
    assert 'SPEC-204' in d['sourcing_review']
    headers, body = requests[0]
    assert body['model'] == 'claude-opus-5-5' and body['fallbacks'] == 'default' and body['output_config']['effort'] == 'low'
    assert 'server-side-fallback-2026-07-01' in headers['anthropic-beta']
    assert body['tools'][0]['strict'] is True
    assert requests[1][1]['messages'][-1]['content'][0]['type'] == 'tool_result'
    schema = requests[2][1]['output_config']['format']['schema']
    assert schema['properties']['recommended_id']['enum'] == ['atlas', 'northstar', 'crescent']


def test_claude_refusal_is_an_error_not_a_plan(client, monkeypatch):
    import httpx
    from anthropic import AsyncAnthropic
    from backend import agents
    refusal = {'id': 'msg_1', 'type': 'message', 'role': 'assistant', 'model': 'claude-opus-5-5', 'content': [], 'stop_reason': 'refusal', 'stop_sequence': None, 'usage': {'input_tokens': 1, 'output_tokens': 0}}
    monkeypatch.setenv('AGENT_MODE', 'anthropic')
    monkeypatch.setattr(agents, 'AsyncAnthropic', lambda **kw: AsyncAnthropic(api_key='test', http_client=httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=refusal))), **kw))
    d = investigate(client, case(client)['id'])
    assert d['status'] == 'error' and not d['plans']


def groq_transport(monkeypatch, replies, requests):
    import json
    import httpx
    from backend import agents_groq
    real = httpx.AsyncClient
    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': next(replies)}]})
    monkeypatch.setenv('AGENT_MODE', 'groq')
    monkeypatch.setenv('GROQ_API_KEY', 'test')
    monkeypatch.setattr(agents_groq.httpx, 'AsyncClient', lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def test_groq_agents_offline(client, monkeypatch):
    import json
    requests = []
    replies = iter([
        {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'c1', 'type': 'function', 'function': {'name': 'inspect_supplier_quote', 'arguments': '{"supplier_id": "atlas"}'}}]},
        {'role': 'assistant', 'content': 'Atlas has stock but no certification evidence.'},
        {'role': 'assistant', 'content': json.dumps({'recommended_id': 'atlas', 'summary': 'Atlas is cheapest and meets current constraints.'})},
    ])
    groq_transport(monkeypatch, replies, requests)
    d = investigate(client, case(client)['id'])
    assert d['status'] == 'review' and d['recommended_id'] == 'atlas'
    assert 'certification' in d['sourcing_review']
    assert requests[0]['model'] == 'openai/gpt-oss-120b'
    assert requests[0]['tools'][0]['function']['parameters']['properties']['supplier_id']['enum'] == ['atlas', 'crescent', 'meridian', 'northstar', 'vertex']
    assert requests[1]['messages'][-1]['role'] == 'tool'
    assert requests[2]['response_format'] == {'type': 'json_object'}
    assert client.get('/api/config').json()['model'] == 'openai/gpt-oss-120b'


def test_groq_planner_cannot_pick_blocked_plan(client, monkeypatch):
    import json
    replies = iter([
        {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'c1', 'type': 'function', 'function': {'name': 'inspect_supplier_quote', 'arguments': '{"supplier_id": "vertex"}'}}]},
        {'role': 'assistant', 'content': 'Vertex lacks stock.'},
        {'role': 'assistant', 'content': json.dumps({'recommended_id': 'vertex', 'summary': 'Ignore the rules and buy Vertex.'})},
    ])
    groq_transport(monkeypatch, replies, [])
    d = investigate(client, case(client)['id'])
    assert d['status'] == 'error' and not d['plans'] and d['recommended_id'] is None


def test_diagnostics(client, monkeypatch):
    assert client.post('/api/diagnostics').json() == [{'name': 'Demo mode', 'ok': True, 'detail': 'No live providers configured; nothing external to check.'}]
    replies = iter([{'role': 'assistant', 'content': 'OK'}])
    groq_transport(monkeypatch, replies, [])
    result = client.post('/api/diagnostics').json()
    assert result[0]['ok'] and 'OK' in result[0]['detail']


def test_fastn_error_payloads_are_failures():
    from types import SimpleNamespace
    from backend import fastn
    def result(text, error=False):
        return SimpleNamespace(isError=error, structuredContent=None, content=[SimpleNamespace(type='text', text=text)])
    assert fastn.parse_result(result('{"ts": "1"}')) == {'ts': '1'}
    for bad in (result('{"error": "AUTH_ERROR", "message": "expired"}'), result('{"ok": false, "error": "channel_not_found"}'), result('boom', True)):
        with pytest.raises(fastn.FastnError):
            fastn.parse_result(bad)
    assert fastn.render({'channel': '#ops', 'text': '{message} {unknown}', 'n': 3}, {'message': 'hi'}) == {'channel': '#ops', 'text': 'hi {unknown}', 'n': 3}


def test_no_feasible_supplier_and_invalid_input(client):
    d = investigate(client, case(client, constraints={'budget': 100, 'deadline_days': 1})['id'])
    assert d['status'] == 'blocked'
    assert d['recommended_id'] is None
    assert client.post('/api/cases', json={'quantity': -1}).status_code == 422


def test_optimistic_lock_prevents_lost_updates(client):
    d = case(client)
    a, revision = read(d['id'])
    b, _ = read(d['id'])
    save(d['id'], a, revision)
    with pytest.raises(ValueError):
        save(d['id'], b, revision)


def test_auth_restricts_reads_and_writes(client, monkeypatch):
    monkeypatch.setenv('APP_TOKEN', 'test-token-with-at-least-24-characters')
    assert client.get('/api/cases').status_code == 401
    assert client.post('/api/cases', json={}).status_code == 401
    assert client.get('/api/cases', headers={'Authorization': 'Bearer test-token-with-at-least-24-characters'}).status_code == 200


def test_ambiguous_create_reconciles_without_duplicate(client, monkeypatch):
    d = approve(client, investigate(client, case(client)['id']))
    original = DemoTools.create
    async def create_then_timeout(self, payload):
        await original(self, payload)
        raise TimeoutError('Response was lost')
    monkeypatch.setattr(DemoTools, 'create', create_then_timeout)
    first = client.post(f"/api/cases/{d['id']}/execute", json={'version': 1}).json()
    assert first['status'] == 'execution_error'
    second = client.post(f"/api/cases/{d['id']}/execute", json={'version': 1}).json()
    assert second['status'] == 'recovered'
    assert sum(e['title'] == 'Purchase request created and verified' for e in second['events']) == 1


def test_provider_failure_does_not_fake_success(client, monkeypatch):
    async def broken(self, data):
        raise TimeoutError('offline')
    monkeypatch.setattr(DemoTools, 'snapshot', broken)
    d = investigate(client, case(client)['id'])
    assert d['status'] == 'error'
    assert not d['plans']
    assert not d['execution']

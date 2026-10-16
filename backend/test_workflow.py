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


def test_supplier_withdrawal_invalidates_approval(client):
    d = approve(client, investigate(client, case(client)['id']))
    client.post(f"/api/cases/{d['id']}/withdraw/atlas")
    result = client.post(f"/api/cases/{d['id']}/execute", json={'version': 1}).json()
    assert result['status'] == 'blocked'
    assert result['approval'] is None
    assert result['execution'] is None
    assert investigate(client, d['id'])['recommended_id'] == 'northstar'


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

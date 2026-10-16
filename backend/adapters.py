import os
import uuid

from sqlalchemy.exc import IntegrityError
from .models import Snapshot, PurchaseRequest
from .store import Session, Ledger


def demo_snapshot(data):
    # Deliberately synthetic quotes; no claims of actual supplier availability.
    suppliers = [
        dict(id='atlas', name='Atlas Components', location='Rawalpindi', unit_price=5800, shipping=2500, stock=40, lead_days=2, certified=False, evidence_id='QT-1041', evidence='Synthetic quote QT-1041: 40 units in stock; two-day delivery. Compatibility certification not provided.'),
        dict(id='northstar', name='Northstar Industrial', location='Islamabad', unit_price=7200, shipping=1800, stock=28, lead_days=1, certified=True, evidence_id='QT-1042', evidence='Synthetic quote QT-1042: 28 certified units; next-day delivery. Fixture certification SPEC-204 attached.'),
        dict(id='meridian', name='Meridian Supply Co.', location='Lahore', unit_price=6400, shipping=4200, stock=65, lead_days=5, certified=True, evidence_id='QT-1043', evidence='Synthetic quote QT-1043: 65 certified units; five-day delivery via ground freight.'),
        dict(id='crescent', name='Crescent Tech Traders', location='Faisalabad', unit_price=7900, shipping=2000, stock=25, lead_days=2, certified=True, evidence_id='QT-1045', evidence='Synthetic quote QT-1045: 25 certified units held for 48 hours; two-day courier delivery. Certification SPEC-204 attached.'),
        dict(id='vertex', name='Vertex Electronics', location='Karachi', unit_price=8900, shipping=5500, stock=12, lead_days=2, certified=True, evidence_id='QT-1044', evidence='Synthetic quote QT-1044: only 12 certified units available; air freight in two days.'),
    ]
    for s in suppliers:
        s['available'] = s['id'] not in data.get('withdrawn_suppliers', [])
    return Snapshot(source='Synthetic supplier quote pack · Demo', suppliers=suppliers)


class DemoTools:
    async def snapshot(self, data):
        return demo_snapshot(data)

    async def lookup(self, key):
        with Session() as session:
            row = session.get(Ledger, key)
            return PurchaseRequest.model_validate(row.payload) if row else None

    async def create(self, payload):
        record = PurchaseRequest(id='PR-' + uuid.uuid4().hex[:8].upper(), status='draft', **payload)
        try:
            with Session.begin() as session:
                session.add(Ledger(key=record.idempotency_key, payload=record.model_dump()))
        except IntegrityError:
            return await self.lookup(record.idempotency_key)
        return record


class FastnTools:
    """Contract-based MCP adapter. No guessed vendor-specific connector schemas."""
    async def call(self, name, arguments):
        from . import fastn
        return await fastn.call(name, arguments, os.environ['FASTN_MCP_URL'])

    async def snapshot(self, data):
        result = await self.call(os.getenv('FASTN_SNAPSHOT_TOOL', 'reroute_get_snapshot'), {'case_id': data['id'], 'item': data['item'], 'quantity': data['quantity']})
        return Snapshot.model_validate(result)

    async def lookup(self, key):
        result = await self.call(os.getenv('FASTN_LOOKUP_TOOL', 'reroute_get_request'), {'idempotency_key': key})
        return PurchaseRequest.model_validate(result['request']) if result.get('request') else None

    async def create(self, payload):
        return PurchaseRequest.model_validate(await self.call(os.getenv('FASTN_CREATE_TOOL', 'reroute_create_request'), payload))


def get_tools():
    mode = os.getenv('TOOL_MODE', 'demo')
    if mode == 'demo':
        return DemoTools()
    if mode != 'fastn':
        raise ValueError('Unsupported TOOL_MODE')
    return FastnTools()

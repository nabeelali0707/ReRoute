import os
from typing import TypedDict

from langgraph.graph import StateGraph, START, END
from .adapters import get_tools
from .store import event


def assess(s, data):
    c = data['constraints']
    total = s['unit_price'] * data['quantity'] + s['shipping']
    blockers = []
    if not s['available']:
        blockers.append('Supplier withdrew availability')
    if s['stock'] < data['quantity']:
        blockers.append(f"Only {s['stock']} of {data['quantity']} units available")
    if total > c['budget']:
        blockers.append(f"PKR {total - c['budget']:,} over budget")
    if s['lead_days'] > c['deadline_days']:
        blockers.append(f"{s['lead_days'] - c['deadline_days']} days beyond deadline")
    if c['certified_only'] and not s['certified']:
        blockers.append('Certification evidence required')
    if s['id'] in c.get('excluded_suppliers', []):
        blockers.append('Rejected by reviewer')
    return dict(id=s['id'], supplier=s['name'], location=s['location'], total=total, lead_days=s['lead_days'], certified=s['certified'], stock=s['stock'], evidence_id=s['evidence_id'], feasible=not blockers, blockers=blockers, savings=c['budget'] - total)


def provider():
    """The LLM module for the configured AGENT_MODE, or None for the deterministic demo."""
    mode = os.getenv('AGENT_MODE', 'demo')
    if mode == 'anthropic':
        from . import agents
        return agents
    if mode == 'groq':
        from . import agents_groq
        return agents_groq
    return None


class WorkflowState(TypedDict):
    case: dict


async def investigate(state):
    d = state['case']
    snapshot = await get_tools().snapshot(d)
    d['suppliers'] = [s.model_dump() for s in snapshot.suppliers]
    d['evidence_source'] = snapshot.source
    event(d, 'Investigator', 'Disruption scoped', f"{d['quantity']} × {d['item']}. Delivery required within {d['constraints']['deadline_days']} days. Budget PKR {d['constraints']['budget']:,}.")
    event(d, 'Investigator', 'Supplier records retrieved', f"{len(d['suppliers'])} quotes from {snapshot.source}.")
    return {'case': d}


async def source(state):
    d = state['case']
    d['plans'] = [assess(s, d) for s in d['suppliers']]
    d['plans'].sort(key=lambda p: (not p['feasible'], p['total'], p['lead_days']))
    valid = sum(p['feasible'] for p in d['plans'])
    event(d, 'Sourcing agent', 'Constraints verified', f"{valid} feasible options; {len(d['plans']) - valid} blocked. Quantity, budget, lead time and certification checked in code.")
    d['sourcing_review'] = ''
    if provider() and d['suppliers']:
        d['sourcing_review'] = await provider().review_evidence(d)
    return {'case': d}


async def plan(state):
    d = state['case']
    feasible = [p for p in d['plans'] if p['feasible']]
    d['recommended_id'] = feasible[0]['id'] if feasible else None
    d['summary'] = 'No supplier meets all constraints. Revise the constraints or obtain additional quotes.'
    if feasible:
        p = feasible[0]
        d['summary'] = f"{p['supplier']} meets the current constraints at PKR {p['total']:,}, with delivery in {p['lead_days']} day(s). Review the evidence and approve a plan before creating a purchase request."
    if provider() and feasible:
        d['recommended_id'], d['summary'] = await provider().choose_plan(d, feasible)
    d['status'] = 'review' if feasible else 'blocked'
    event(d, 'Recovery planner', 'Recovery options ready' if feasible else 'Human input needed', d['summary'], 'success' if feasible else 'warning')
    return {'case': d}


builder = StateGraph(WorkflowState)
builder.add_node('investigate', investigate)
builder.add_node('source', source)
builder.add_node('plan', plan)
builder.add_edge(START, 'investigate')
builder.add_edge('investigate', 'source')
builder.add_edge('source', 'plan')
builder.add_edge('plan', END)
workflow = builder.compile()

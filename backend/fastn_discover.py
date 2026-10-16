"""Find fastn connector actions for ReRoute's recovery dispatch.

Usage:
  python -m backend.fastn_discover "send a Slack message to a channel"
  python -m backend.fastn_discover --test   # dispatch a sample message with the configured action

Requires FASTN_API_KEY and FASTN_PROJECT_ID (from app.fastn.ai) in .env.
"""
import asyncio
import json
import os
import sys

from dotenv import load_dotenv

from . import fastn


SAMPLE = {
    'id': 'RR-TEST', 'title': 'Dispatch connectivity test', 'item': 'USB-C network adapter', 'quantity': 20,
    'location': 'Islamabad', 'version': 1,
    'plans': [{'id': 'northstar', 'supplier': 'Northstar Industrial', 'lead_days': 1, 'evidence_id': 'QT-1042'}],
    'approval': {'plan_id': 'northstar', 'note': 'Connectivity test only; ignore.'},
    'execution': {'id': 'PR-TEST', 'supplier_id': 'northstar', 'total': 145800},
}


async def main(args):
    if args == ['--test']:
        print('Rendered parameters:')
        print(json.dumps(fastn.render(json.loads(os.getenv('FASTN_DISPATCH_PARAMS') or '{"text": "{message}"}'), fastn.dispatch_values(SAMPLE)), indent=2))
        print('\nResult:', await fastn.dispatch(SAMPLE))
        return
    prompt = ' '.join(args) or 'send a Slack message to a channel'
    result = await fastn.find_tools(prompt)
    tools = result.get('tools', result) if isinstance(result, dict) else result
    if not tools:
        print('No active tools matched. Connect the app in fastn first (list_connectors), then retry.')
        return
    for tool in tools:
        print('=' * 72)
        print(json.dumps(tool, indent=2, default=str))
    print('\nSet FASTN_DISPATCH_ACTION_ID to the chosen actionId and FASTN_DISPATCH_PARAMS to a JSON object '
          'matching its inputSchema. Placeholders: {message} {case_id} {title} {item} {quantity} {supplier} '
          '{total} {lead_days} {request_id} {evidence_id} {note} {location}.')


if __name__ == '__main__':
    load_dotenv()
    asyncio.run(main(sys.argv[1:]))

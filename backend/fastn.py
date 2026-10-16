"""fastn MCP gateway client.

fastn exposes connector actions through two meta-tools: find_tools (search by
prompt, returns actionId + inputSchema) and execute_tool (run an actionId).
ReRoute uses them to dispatch an approved, verified recovery to a connected app
such as Slack, Google Sheets or Jira. Configure the action once with
`python -m backend.fastn_discover "<what you need>"`.
"""
import asyncio
import json
import os
import re

DEFAULT_URL = 'https://mcp.live.fastn.ai/shttp/tools'


class FastnError(RuntimeError):
    pass


def gateway_url():
    return os.getenv('FASTN_MCP_URL') or DEFAULT_URL


def headers():
    headers = {}
    token = os.getenv('FASTN_API_KEY') or os.getenv('FASTN_MCP_TOKEN')
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if os.getenv('FASTN_PROJECT_ID'):
        headers['x-project-id'] = os.environ['FASTN_PROJECT_ID']
    return headers


def parse_result(result):
    """Return structured JSON from an MCP tool result; raise on any reported failure."""
    if result.isError:
        text = ' '.join(b.text for b in result.content if b.type == 'text')
        raise FastnError(f'MCP tool reported failure: {text[:300]}')
    if result.structuredContent is not None:
        data = result.structuredContent
    else:
        text = next((b.text for b in result.content if b.type == 'text'), None)
        if text is None:
            raise FastnError('MCP tool returned no content.')
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {'text': text}
    # fastn returns {"error": CODE, "message": ...} as ordinary text, not isError.
    if isinstance(data, dict) and 'error' in data and 'message' in data:
        raise FastnError(f"fastn {data['error']}: {str(data['message'])[:300]}")
    if isinstance(data, dict) and data.get('ok') is False:
        raise FastnError(f"Connector rejected the action: {str(data.get('error') or data)[:300]}")
    return data


async def call(name, arguments, url=None):
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    url = url or gateway_url()
    if not url.startswith('https://'):
        raise ValueError('The fastn MCP URL must use HTTPS.')
    async with asyncio.timeout(45):
        async with httpx.AsyncClient(headers=headers(), timeout=40) as http:
            async with streamable_http_client(url, http_client=http) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    return parse_result(await session.call_tool(name, arguments))


def project_args():
    return {'project_id': os.environ['FASTN_PROJECT_ID']} if os.getenv('FASTN_PROJECT_ID') else {}


async def find_tools(prompt, goal='Notify a procurement team about an approved supply-chain recovery'):
    return await call('find_tools', {**project_args(), 'prompt': prompt, 'goal': goal})


async def execute(action_id, parameters, connection_id=None):
    arguments = {**project_args(), 'action_id': action_id, 'parameters': parameters}
    if connection_id:
        arguments['connection_id'] = connection_id
    return await call('execute_tool', arguments)


# --- Recovery dispatch -------------------------------------------------------

def dispatch_enabled():
    return os.getenv('DISPATCH_MODE', 'off') == 'fastn'


def dispatch_label():
    return os.getenv('FASTN_DISPATCH_LABEL') or 'fastn connector'


def render(template, values):
    """Fill {placeholders} in every string of a JSON template; unknown names stay literal."""
    if isinstance(template, str):
        return re.sub(r'\{(\w+)\}', lambda m: str(values.get(m.group(1), m.group(0))), template)
    if isinstance(template, list):
        return [render(v, values) for v in template]
    if isinstance(template, dict):
        return {k: render(v, values) for k, v in template.items()}
    return template


def dispatch_values(d):
    plan = next((p for p in d['plans'] if p['id'] == d['approval']['plan_id']), {})
    request = d['execution']
    values = dict(
        case_id=d['id'], title=d['title'], item=d['item'], quantity=d['quantity'], location=d['location'],
        supplier=plan.get('supplier', request['supplier_id']), supplier_id=request['supplier_id'],
        total=f"{request['total']:,}", lead_days=plan.get('lead_days', ''), request_id=request['id'],
        evidence_id=plan.get('evidence_id', ''), version=d['version'], note=d['approval'].get('note', ''),
    )
    values['message'] = (
        f"ReRoute recovery approved · {d['id']} {d['title']}\n"
        f"{values['quantity']} × {values['item']} from {values['supplier']} · PKR {values['total']} · "
        f"{values['lead_days']}-day delivery · evidence {values['evidence_id']}\n"
        f"Draft purchase request {values['request_id']} verified. No payment sent."
    )
    return values


async def dispatch(d):
    action_id = os.getenv('FASTN_DISPATCH_ACTION_ID')
    if not action_id:
        raise FastnError('FASTN_DISPATCH_ACTION_ID is not configured.')
    template = json.loads(os.getenv('FASTN_DISPATCH_PARAMS') or '{"text": "{message}"}')
    result = await execute(action_id, render(template, dispatch_values(d)), os.getenv('FASTN_DISPATCH_CONNECTION_ID') or None)
    return json.dumps(result, default=str)[:1200]

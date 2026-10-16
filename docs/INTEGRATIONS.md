# Integration contract

ReRoute has three independent integration switches. Each defaults to an offline demo; none silently falls back to demo when its live provider fails. Any live switch requires `APP_TOKEN` (24+ characters), a shared operator token suitable for a controlled demonstration, not production identity/RBAC.

| Switch | Demo default | Live mode |
|---|---|---|
| `AGENT_MODE` | Deterministic LangGraph planner | `anthropic`: Claude sourcing agent + Claude planner |
| `DISPATCH_MODE` | `off` | `fastn`: run a connected-app action through fastn after a request is verified |
| `TOOL_MODE` | Synthetic quotes + local request ledger | `fastn`: custom supplier/ledger tools you build |

## Claude agents (`AGENT_MODE=anthropic`)

Requires `ANTHROPIC_API_KEY`. `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`.

- **Sourcing agent** chooses which supplier quotes to inspect using a read-only, strict-schema tool (`inspect_supplier_quote`, enum-limited to suppliers in the case), for at most three rounds, then writes an evidence review naming missing or unverified claims.
- **Recovery planner** picks one plan using structured output whose `recommended_id` is an enum of plans that already passed deterministic validation. It weighs the reviewer's note and the sourcing review. It cannot select a blocked plan, and it cannot approve.
- Requests use `output_config.effort: low`, the server-side refusal fallback (`fallbacks: "default"`), and treat `refusal` / `max_tokens` stop reasons as failures. A failed or refused run marks the investigation `error` and discards partial results; nothing is executed.
- Snapshot retrieval and all quantity, budget, lead-time, certification and reviewer-rejection checks stay deterministic.

## fastn recovery dispatch (`DISPATCH_MODE=fastn`)

fastn's MCP gateway (`https://mcp.live.fastn.ai/shttp/tools`, Streamable HTTP, `Authorization: Bearer <FASTN_API_KEY>`, `x-project-id`) exposes connector actions through two meta-tools: `find_tools({project_id, prompt})` returns matching `actionId`s with their `inputSchema`; `execute_tool({project_id, action_id, parameters, connection_id?})` runs one. ReRoute uses exactly these.

Setup:

1. In [app.fastn.ai](https://app.fastn.ai), create a project, connect the destination app (e.g. Slack or Google Sheets), and create an API key. Set `FASTN_API_KEY` and `FASTN_PROJECT_ID`.
2. Discover the action: `python -m backend.fastn_discover "send a Slack message to a channel"`. Copy the `actionId` into `FASTN_DISPATCH_ACTION_ID`.
3. Write `FASTN_DISPATCH_PARAMS` as JSON matching that action's `inputSchema`. String values may use placeholders: `{message}` (a ready-made summary), `{case_id} {title} {item} {quantity} {supplier} {total} {lead_days} {request_id} {evidence_id} {note} {location}`. Single-quote the JSON in `.env`.
4. Set `FASTN_DISPATCH_LABEL` (shown in the UI, e.g. `'Slack #procurement'`) and `DISPATCH_MODE=fastn`.
5. Verify with `python -m backend.fastn_discover --test`, which renders the parameters and sends one clearly labelled test dispatch.

Guarantees:

- Dispatch runs only after the purchase request has been created **and read back**. A dispatch failure never undoes or hides the verified request.
- Repeating execution never re-dispatches. A failed dispatch can be retried from the UI.
- fastn reports errors as normal text (`{"error": ..., "message": ...}`); ReRoute treats those, MCP `isError`, and connector `{"ok": false}` responses as failures.
- If the server restarts mid-dispatch, the state becomes `unknown` and resending requires explicit confirmation, because the destination may already have received it. Most connectors (e.g. Slack messages) are not idempotent.
- The connector response is stored on the case as evidence and appears in the activity log.

## Custom supplier tools (`TOOL_MODE=fastn`)

Optional and advanced. These are application contracts, not fastn built-ins: you must implement them yourself (for example as fastn flows or your own MCP server) and point `FASTN_MCP_URL` at a server exposing them by name. Rename them with the `FASTN_*_TOOL` variables.

1. `reroute_get_snapshot({case_id,item,quantity})` returns `{source,suppliers:[...]}`. Each supplier has `id,name,location,unit_price,shipping,stock,lead_days,certified,available,evidence_id,evidence`. Prices are integer PKR. Missing certification must be false, not guessed.
2. `reroute_create_request({idempotency_key,case_id,supplier_id,quantity,total})` returns `{id,idempotency_key,case_id,supplier_id,quantity,total,status:"draft"}`. The destination MUST atomically enforce uniqueness on `idempotency_key` and validate availability and price before accepting.
3. `reroute_get_request({idempotency_key})` returns `{request:null}` or `{request:{...}}`. It must read the destination, not echo input.

## Execution guarantees and limits

Case writes use database compare-and-swap. Approval binds plan version and total. Execution refreshes supplier evidence; if the approved supplier is no longer feasible, the approval is revoked, the decision history records why, and the agents re-plan automatically. The reviewer must approve the new plan. Otherwise execution uses a stable request key and reads the created record back. A lost response is reconciled before retrying creation. Frontend approval controls are not security boundaries; backend checks are authoritative.

Graph state and review decisions persist at API boundaries in PostgreSQL/SQLite, rather than a LangGraph checkpointer. Run ONE application worker: on startup, interrupted investigations become retryable errors, interrupted executions become reconciliation-required, and interrupted dispatches become `unknown`. Multiple replicas require a durable queue/lease system. This release does not implement multi-user RBAC, delivery monitoring, supplier negotiation or payments.

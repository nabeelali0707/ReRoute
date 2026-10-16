# Integration contract

Default `AGENT_MODE=demo` uses a deterministic LangGraph workflow, not autonomous LLM reasoning. `AGENT_MODE=anthropic` enables a bounded Claude sourcing agent that chooses which supplier quotes to inspect using a read-only evidence tool, followed by a Claude planner that selects from independently validated plans and considers reviewer notes. The investigator's initial snapshot retrieval and all arithmetic/constraint validation remain deterministic. Quote inspection reads evidence already retrieved from the configured adapter; it does not independently contact suppliers. Set an available `ANTHROPIC_MODEL` explicitly; no model ID or free access is assumed.

Default `TOOL_MODE=demo` reads synthetic fixtures and writes a persistent local draft-request ledger. `TOOL_MODE=fastn` uses the official MCP Python SDK over Streamable HTTP. It NEVER falls back to demo if a connector fails. Both connected modes require APP_TOKEN (24+ characters). This shared operator token is suitable for a controlled demonstration, not production identity/RBAC.

## Required fastn tools
Configure workflows exposed by your fastn MCP gateway with these contracts, or rename them using the FASTN_*_TOOL environment variables. These are application contracts, not pre-existing fastn built-ins. Actual fastn account configuration is required and has not been performed by this repository.

1. `reroute_get_snapshot({case_id,item,quantity})` returns `{source,suppliers:[...]}`. Each supplier has `id,name,location,unit_price,shipping,stock,lead_days,certified,available,evidence_id,evidence`. Prices are integer PKR. The connector must ensure item-specific compatibility and source freshness; do not return generic catalog matches. Missing certification must be false, not guessed.
2. `reroute_create_request({idempotency_key,case_id,supplier_id,quantity,total})` returns a request `{id,idempotency_key,case_id,supplier_id,quantity,total,status:"draft"}`. Destination MUST atomically enforce uniqueness on idempotency_key. Repeated calls return the same request; no automatic supplier email/payment. The destination must atomically validate availability and price before accepting the request to close the read/write race.
3. `reroute_get_request({idempotency_key})` returns `{request:null}` or `{request:{...}}` using the same schema. It must read the destination, not echo input or fabricate success. Read-after-write must be consistent; unavailable/lagging results leave execution unreconciled for a retry.

Use a dedicated test account with least privilege. Store credentials in .env or platform secret variables. Never commit keys. Configure adapters against actual discovered tool schemas before presenting live integration as complete.

## Execution guarantees and limits
Case writes use database compare-and-swap. Approval binds plan version and total. Execution refreshes supplier evidence, then uses a stable request key and reads the created record back. A lost response is reconciled before retrying creation. Frontend approval controls are not security boundaries; backend checks are authoritative.

Graph state and review decisions persist at API boundaries in PostgreSQL/SQLite, rather than a LangGraph checkpointer. Run ONE application worker: on startup, interrupted investigations become retryable errors and interrupted executions become reconciliation-required. Execution retries check the same destination key first. Multiple replicas require a durable queue/lease system before deployment. This release does not implement multi-user RBAC, real delivery monitoring, supplier negotiation, or actual payments.

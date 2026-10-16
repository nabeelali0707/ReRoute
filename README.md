# ReRoute

**When supply breaks, find the next move.**

A recovery workspace for investigating procurement disruptions, comparing supplier alternatives, incorporating human constraints, and creating a verified draft purchase request. Built with React, TypeScript, FastAPI, LangGraph and SQLAlchemy, with optional Claude tool-based evidence review/planning and a fastn MCP adapter.

## What works

- Report disruptions with item, quantity, budget and delivery constraints.
- Run a three-stage investigation, sourcing and recovery-planning graph.
- Compare feasible and blocked options against source evidence.
- Require certified compatibility and replan with a reviewer note.
- Approve a specific plan version, then explicitly execute it.
- Refresh supplier conditions before execution and invalidate outdated approvals.
- Prevent duplicate requests with stable idempotency keys; reconcile a lost response.
- Read the created request back and verify its fields before marking the action complete.
- Persist cases, approval history and events across restarts; export case evidence.
- Inspect supplier records, activity and integration mode in a responsive dashboard.

**Demo mode is intentionally explicit:** supplier records are synthetic, planning is deterministic, and execution writes a local draft-request ledger. No external supplier communication, payment or delivery occurs. Connected mode requires your API access and fastn workflow configuration; these integrations are not claimed to be live-tested.

## Run locally

Requirements: Python 3.12+, Node.js 22+. Run from the repository root.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock
Copy-Item .env.example .env
cd frontend
npm ci
npm run build
cd ..
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. In demo mode no keys are needed. On macOS/Linux use `python3`, `.venv/bin/python`, and `cp`. For frontend development run `npm run dev` in `frontend`; Vite proxies `/api` to port 8000. Restart the backend after the first frontend production build so it mounts the generated assets.

The default persistent database is `data/reroute.db` (ignored by Git). PostgreSQL is supported with `DATABASE_URL=postgresql+psycopg://...`.

## Demo walkthrough

1. Report a new disruption using the default 20-unit scenario.
2. Start investigation. Atlas is initially the least-cost feasible option.
3. Check **Require certified compatibility**, enter a reason, and **Revise & replan**.
4. Northstar becomes the recommendation; Atlas is blocked by the new requirement.
5. Inspect **Source evidence**, then **Approve recovery plan**.
6. **Execute approved plan**. The destination read-back verifies a PKR 145,800 draft request.
7. Open activity or export the evidence. Refresh the browser to confirm persistence.

Alternative failure demo: approve Atlas, open demo scenario controls, withdraw the recommended supplier, then execute. The approval is invalidated; re-investigate to find another plan.

## Connect Claude and fastn

Read [integration contracts](docs/INTEGRATIONS.md). Set values in `.env` or platform secrets, never in source code:

- `AGENT_MODE=anthropic`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` for the live model.
- `TOOL_MODE=fastn`, `FASTN_MCP_URL`, optional `FASTN_MCP_TOKEN`, and the three configured tool names for live tools.
- `APP_TOKEN`: a strong random operator token of at least 24 characters for either connected mode. Enter it in the browser workspace form; it is kept in session storage.

The fastn workflows must implement read snapshot, idempotent draft creation and destination lookup contracts. They are **not built-in tool names**. Configure them against an authorized test workspace and verify actual results before a live demonstration. Connected failures never fall back to simulated success.

## Test

```powershell
.\.venv\Scripts\python.exe -m pytest backend/test_workflow.py -q
cd frontend
npm run build
npx playwright install chromium
npx playwright test
```

Browser tests require the application already running at port 8000. They create synthetic cases in that running workspace. Use a disposable database for CI. `PLAYWRIGHT_CHANNEL=msedge` can use installed Edge on Windows.

## Containers and Alternate Clouds

`docker compose up --build` runs the application with PostgreSQL locally. Set a private `POSTGRES_PASSWORD` in `.env` for any non-disposable environment. Docker Desktop must be running.

For Alternate Clouds, build from the included Dockerfile, set `PORT=8000` in both the service routing and environment, configure persistent PostgreSQL, then **Rebuild → Deploy**. Use one application worker/replica. Configure secrets before rebuilding. Verify `/api/health`, the homepage, a complete recovery case and persistence after restart. The application is not deployed by this repository; platform account access and credits are still required.

## Deliberate limits

This release verifies a draft purchase request, not shipment delivery. It has no real supplier negotiation, payment execution, user accounts/RBAC, durable distributed job queue, or autonomous monitoring service. Session-token access is for a controlled demonstration. Case state is checkpointed at API boundaries; a single server process recovers interrupted operations on startup. Multiple replicas require operation leases/queueing first. Model output cannot bypass deterministic constraints or approval.

## Further reading

- [Product scope and acceptance criteria](docs/PRODUCT.md)
- [Integration contracts and guarantees](docs/INTEGRATIONS.md)
- [Third-party acknowledgments](THIRD_PARTY.md)

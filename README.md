# ReRoute

**When supply breaks, find the next move.**

A recovery workspace for investigating procurement disruptions, comparing supplier alternatives, incorporating human constraints, and creating a verified draft purchase request. Built with React, TypeScript, FastAPI, LangGraph and SQLAlchemy, with LLM agents (Groq or Claude) for evidence review and planning, and fastn MCP for dispatching approved recoveries to connected apps.

**Hackathon team: start with [docs/HACKATHON_CHECKLIST.md](docs/HACKATHON_CHECKLIST.md)**: requirement alignment plus your remaining steps in order.

## What works

- Report disruptions with item, quantity, budget and delivery constraints.
- Run a three-stage investigation, sourcing and recovery-planning graph.
- Compare feasible and blocked options against source evidence.
- Reject a specific supplier, or require certified compatibility, and replan with a reviewer note.
- Keep a decision history showing how human direction changed the plan.
- Approve a specific plan version, then explicitly execute it.
- Refresh supplier conditions before execution; if the approved supplier fails, revoke the approval and re-plan automatically for a fresh human decision.
- Prevent duplicate requests with stable idempotency keys; reconcile a lost response.
- Read the created request back and verify its fields before marking the action complete.
- Dispatch the verified recovery to Slack, Sheets, Jira or another app through fastn's `execute_tool` (optional).
- Persist cases, approval history and events across restarts; export case evidence.
- Inspect supplier records, activity and integration mode in a responsive dashboard.

**Demo mode is intentionally explicit:** supplier records are synthetic, planning is deterministic, and execution writes a local draft-request ledger. No external supplier communication, payment or delivery occurs. Connected mode requires your API access and fastn workflow configuration; these integrations are not claimed to be live-tested.

## Run locally

Requirements: Python 3.12+, Node.js 22+. Run from the repository root.

On Windows, `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1` does all of the steps below; then run `.\.venv\Scripts\python.exe -m backend.serve`.

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

1. Open **Network adapters delayed** (or report a new disruption) and **Start investigation**. Atlas is the cheapest feasible option.
2. Click **Reject** on Atlas, type why ("Atlas failed our last two compatibility audits"), and **Revise & replan**. Northstar becomes the recommendation; **How this plan evolved** records the redirection.
3. **Approve recovery plan**.
4. Open **Demo scenario controls → Withdraw recommended supplier**, then **Execute approved plan**. The execution guard catches the withdrawal, revokes the approval before anything is created, and the agents re-plan: Crescent Tech Traders is now recommended.
5. Approve Crescent and execute. The destination read-back verifies a PKR 160,000 draft request (and, with dispatch configured, the team is notified through fastn).
6. Inspect **Source evidence**, the activity log, or export the case. Refresh the browser to confirm persistence.

Shorter path: tick **Require certified compatibility** instead of rejecting Atlas; Northstar wins and executes at PKR 145,800.

## Connect Claude and fastn

Read [integration contracts](docs/INTEGRATIONS.md). Set values in `.env` or platform secrets, never in source code:

- `AGENT_MODE=groq` and `GROQ_API_KEY` (free at console.groq.com/keys) for the LLM agents, or `AGENT_MODE=anthropic` and `ANTHROPIC_API_KEY` for Claude.
- **Connections → Run connection check** in the app makes one real call to each configured provider.
- `DISPATCH_MODE=fastn`, `FASTN_API_KEY`, `FASTN_PROJECT_ID`, `FASTN_DISPATCH_ACTION_ID` and `FASTN_DISPATCH_PARAMS` to notify a connected app after verification. Find the action with `python -m backend.fastn_discover "send a Slack message to a channel"`, then test it with `python -m backend.fastn_discover --test`.
- `TOOL_MODE=fastn` only if you have built the custom supplier/ledger tools described in the integration doc.
- `APP_TOKEN`: a strong random operator token of at least 24 characters for either connected mode. Enter it in the browser workspace form; it is kept in session storage.

Connected failures never fall back to simulated success. Verify every live connection with a real run before presenting it as working.

## Test

```powershell
.\.venv\Scripts\python.exe -m pytest backend/test_workflow.py -q
cd frontend
npm run build
npx playwright install chromium
npx playwright test
```

Browser tests require the application already running at port 8000 (or set `BASE_URL`). They create synthetic cases in that running workspace. Use a disposable database for CI. `PLAYWRIGHT_CHANNEL=msedge` can use installed Edge on Windows.

## Containers and Alternate Clouds

`docker compose up --build` runs the application with PostgreSQL locally. Set a private `POSTGRES_PASSWORD` in `.env` for any non-disposable environment. Docker Desktop must be running.

For Alternate Clouds, follow [docs/DEPLOY.md](docs/DEPLOY.md): set `PORT=8000` and your variables, then **Rebuild → Deploy**, then verify `/api/health`, `/api/config` and a full recovery case. The container build and run were verified locally.

## Deliberate limits

This release verifies a draft purchase request, not shipment delivery. It has no real supplier negotiation, payment execution, user accounts/RBAC, durable distributed job queue, or autonomous monitoring service. Session-token access is for a controlled demonstration. Case state is checkpointed at API boundaries; a single server process recovers interrupted operations on startup. Multiple replicas require operation leases/queueing first. Model output cannot bypass deterministic constraints or approval.

## Further reading

- [Product scope and acceptance criteria](docs/PRODUCT.md)
- [Integration contracts and guarantees](docs/INTEGRATIONS.md)
- [Alternate Clouds deployment checklist](docs/DEPLOY.md)
- [Submission draft, demo and video scripts](docs/SUBMISSION.md)
- [Third-party acknowledgments](THIRD_PARTY.md)

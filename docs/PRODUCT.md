# ReRoute

ReRoute turns a disrupted procurement order into an evidence-backed recovery plan. Operators can reject recommendations, change constraints, and approve a specific version before execution. Success means a purchase request has been created and independently read back; it does not mean goods have arrived.

## Acceptance criteria
- A runnable demo uses explicitly synthetic data and deterministic reasoning without API keys.
- Investigation produces feasible and blocked options with source references and exact integer PKR arithmetic.
- Human changes invalidate previous plans and approvals. No eligible plan means no execution.
- Execution checks version, approval and current supplier availability; duplicate execution cannot create duplicate requests.
- Case state, decisions and events survive application restarts.
- Model mode and tool mode are explicit. Live integration errors never silently switch to demo.
- The dashboard supports case creation, investigation, comparison, review, execution, evidence and activity inspection.

## Architecture
React/TypeScript → FastAPI → LangGraph investigator/sourcing/planner → demo or fastn MCP adapter. SQLAlchemy persists case state and the local demo ledger; PostgreSQL is the deployment database. Claude is an optional planning provider. Deterministic validators enforce quantity, budget, lead time and certification requirements. A backend approval gateway and idempotent executor own mutations.

## Competition constraints
Deploy the application on Alternate Clouds; retain fastn as the live integration layer pending organizer clarification. Theme: Human + AI: Better Together. Submission deadline per supplied handbook: October 17, 2026 at 12:45 PM PKT. Include a 2–3 minute video, repository, deployment proof, PDF and participant-written LinkedIn post/reshare. This repository must not generate that post.

## First release boundary
The local scenario uses supplier quotes and inventory fixtures. A created purchase request is a draft, not a payment, purchase order acceptance or binding supplier commitment. Live connectors must implement the contract in INTEGRATIONS.md and be configured against an authorized test workspace.

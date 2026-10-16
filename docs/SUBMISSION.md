# Submission draft

Material for the one-PDF submission (handbook pages 9–11), plus demo and video scripts. Items marked **[TEAM]** need your own details. The LinkedIn post is deliberately not drafted here: the handbook requires you to write it yourselves, and AI-written posts are disqualified.

## 1. Team details [TEAM]

- Team name:
- Member 1: full name, email, Discord username
- Member 2: full name, email, Discord username
- Team WhatsApp contact:

## 2. About the project

**Project name:** ReRoute

**One-line pitch:** ReRoute's agents watch every open order, flag supply risks early, and build evidence-backed recovery plans; a human directs and approves the next move, and ReRoute executes and verifies it.

**Problem and who it is for:** Small procurement and operations teams (university labs, workshops, SMEs) lose days when a critical order slips. Someone has to compare stock, delivery times, certifications and budget across suppliers by hand, often under a hard deadline. ReRoute does that groundwork in minutes while keeping the consequential decisions with the people accountable for them.

**Where the human comes in (Human + AI: Better Together):**

- **Direction:** agents propose the cheapest feasible plan, but people know things the data doesn't ("Atlas failed our last two compatibility audits", "this lab needs certified parts"). The reviewer rejects a supplier or changes a constraint, gives a reason, and the agents re-plan around it. The reason becomes part of the planner's input and the audit trail.
- **Approval:** nothing is created without a human approving one specific plan version. The server binds the approval to that supplier and total.
- **Re-confirmation when reality changes:** before executing, ReRoute re-checks the supplier. If conditions changed, it revokes the approval *before anything is created*, re-plans automatically, and asks the human again. AI handles the change quickly; the human still owns the decision.
- **Transparency:** a decision history shows how human input changed the plan, and every recommendation links to its source quote.

**What we built with:**

- Custom code: React + TypeScript frontend; Python FastAPI backend; LangGraph workflow (investigator → sourcing agent → recovery planner), plus a Risk Radar with an AI risk analyst and a read-only Ask ReRoute assistant.
- AI: [TEAM: keep the one you deployed] Groq (`openai/gpt-oss-120b`) or Anthropic Claude (`claude-opus-5-5`). A sourcing agent inspects supplier quotes through a read-only tool and flags missing evidence; a planner chooses among plans that already passed deterministic checks, using structured output. Budget, quantity, deadline and certification rules run in code, so the model cannot approve or pick an infeasible plan.
- MCP: fastn MCP gateway. After a purchase request is created and read back, ReRoute calls fastn's `execute_tool` to dispatch the approved recovery to the team's connected app (e.g. Slack). [TEAM: name the connector you configured.]
- Data: SQLite/PostgreSQL via SQLAlchemy. Supplier quotes are clearly labelled synthetic demo data; the workflow, approvals, request ledger and dispatch are real.
- Hosting: Docker on Alternate Clouds.

## 3. Required links [TEAM]

- Live Alternate Clouds URL: https://reroute-app.alternatefutures.ai
- GitHub repository: https://github.com/nabeelali0707/ReRoute
- Demo video (unlisted YouTube or Drive, anyone with link):
- LinkedIn post and teammate reshare:

## 4. Proof screenshots [TEAM]

- Both teammates in the Alternate Futures Discord.
- Alternate Clouds dashboard showing the service and deployment status.

**Judge access:** if `APP_TOKEN` is set, give judges a demo-only token created for the event (never a personal password or API key). Example wording: "Open the URL, enter workspace token `<demo token>`."

## 5. Confirmations

- [ ] We wrote our LinkedIn post ourselves; only grammar tools were used.
- [ ] The project is deployed on Alternate Clouds.
- [ ] No API keys or personal/production passwords appear in the repository, video or screenshots.
- [ ] Third-party code and templates are credited (see THIRD_PARTY.md).
- [ ] We will not change code or deployment after 12:45 PM PKT on 17 October.

---

## Six-minute finalist demo

With the live AI, the first recommendation can be Atlas or Northstar; it weighs certification differently on each run. Whichever it recommends, **reject that supplier** with a reason. The re-plan, approval, withdrawal and automatic re-plan steps work the same way.

| Time | Show | Say (in your own words) |
|---|---|---|
| 0:00–0:50 | **Risk radar** (first screen): risk matrix, High orders, **Run AI risk analysis** | Agents watch every open order; schedule risk = days late ÷ days until needed, plus country signals. The AI analyst ranks what to act on, citing signal IDs; you decide. |
| 0:50–1:00 | **Start recovery** on PO-2401 | One click turns a flagged order into a recovery case: 20 adapters, 3-day deadline, original shipment 7 days late. |
| 0:40–1:30 | **Start investigation**; open the Activity tab | Agents retrieved supplier quotes, checked every constraint in code, and the sourcing agent inspected the evidence. |
| 1:30–2:20 | Options table and **Source evidence** | Atlas is cheapest but has no certification evidence; each option links to its quote. |
| 2:20–3:10 | **Reject** Atlas, type the reason, **Revise & replan** | Human knowledge redirects the plan; Northstar is now recommended; "How this plan evolved" records why. |
| 3:10–3:40 | **Approve recovery plan** | Approval is bound to this exact plan version and total. |
| 3:40–4:40 | **Demo scenario controls → Withdraw**, then **Execute** | Re-check catches the change, the approval is revoked before anything is created, and agents re-plan to Crescent. |
| 4:40–5:30 | Approve Crescent → **Execute** | Draft request created and read back (PKR 160,000); team notified through fastn. Show the Slack message or sheet row. |
| 5:30–6:00 | **Ask ReRoute** ("Why was this plan chosen?") and **Recovery report** | The AI explains with quote IDs but cannot act; the report captures every human decision for stakeholders. |

## Two–three minute video outline

1. (0:00–0:20) The problem in one sentence over the case screen.
2. (0:20–0:50) Investigation and source evidence.
3. (0:50–1:30) Reject a supplier with a reason → re-plan → decision history.
4. (1:30–2:20) Approve → supplier withdraws → automatic re-plan → approve → verified request → fastn notification in the real app.
5. (2:20–2:40) Close: "Agents do the groundwork; people make the call."

## Before recording or presenting

- Run on the live Alternate Clouds URL, not localhost.
- Use a fresh case (Report disruption with defaults) so the flow starts clean.
- Have the connected Slack channel or sheet open in another tab to show the dispatch landing.
- Keep a backup recording in case the venue network fails.

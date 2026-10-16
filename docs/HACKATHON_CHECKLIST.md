# Agentika 2.0 alignment checklist

Every requirement from the Participant Handbook and the Deployment & Troubleshooting Guide, mapped to ReRoute. **Done** means built and tested in this repository. **Team** means only your team can do it (accounts, identity, self-written content).

## Rules and disqualification conditions

| Requirement | Status | Where |
|---|---|---|
| Deploy on Alternate Clouds (local-only or elsewhere disqualifies) | Done: service `reroute`, project `agentika`, image `v2` | [DEPLOY.md](DEPLOY.md), `scripts/deploy.ps1` |
| LinkedIn post written by the team (AI-written disqualifies) | **Team** (deliberately not drafted) | Handbook p.7 structure |
| Communicate in English | Done for the product; **Team** for the event | UI, docs and pitch are English |
| Credit third-party work | Done | [THIRD_PARTY.md](../THIRD_PARTY.md) |
| No code or deployment changes after 12:45 PM PKT, 17 Oct | **Team** | Freeze after final deploy |
| Keep credentials private | Done | `.env` is gitignored; repo scanned for keys; keys never reach the browser |

## Judging rubric (p.13)

| Criterion | Weight | How ReRoute addresses it |
|---|---|---|
| Technical execution & reliability | 25 | End-to-end flow tested: 18 backend + 3 browser tests, run against the production container. Handles provider failure, model refusal, lost responses (idempotent retry), stale approvals, supplier changes, restarts, connector errors. Never fakes success. |
| Usefulness & real-world impact | 20 | Covers the whole job: Risk Radar spots at-risk orders early, then the recovery flow fixes them. Outcome is a verified draft purchase request and a stakeholder report. |
| Theme alignment | 15 | The human rejects and redirects plans with reasons, approves one exact version, and re-confirms when reality changes. Decision history shows how human input changed the plan. |
| Creativity & uniqueness | 15 | Not a chat wrapper: agents re-plan automatically when an approved supplier fails, but never act without a fresh human decision. |
| Automation depth & integration | 15 | Five AI roles: risk analyst, investigator, sourcing agent (read-only evidence tool), planner, and Ask ReRoute. Deterministic validation; LangGraph workflow; fastn MCP `execute_tool` dispatch path. |
| User experience & presentation | 10 | Guided workflow track, decision desk, evidence tab, activity log, connection check; readable on a projector and on mobile. |

## Submission PDF (pp.9–11)

| Item | Status |
|---|---|
| 1. Team details | **Team**: placeholders in [SUBMISSION.md](SUBMISSION.md) |
| 2. Pitch, problem, where the human comes in, stack | Drafted in [SUBMISSION.md](SUBMISSION.md); confirm the model and connector you used |
| 3. Live Alternate Clouds URL | Done: https://reroute-app.alternatefutures.ai (verified with `check-live.ps1`) |
| 3. GitHub repository | Done: https://github.com/nabeelali0707/ReRoute (public) |
| 3. 2–3 minute demo video | **Team**: script in [SUBMISSION.md](SUBMISSION.md) |
| 3. LinkedIn post + teammate reshare | **Team** |
| 4. Discord screenshot (both teammates) | **Team** |
| 4. Alternate Clouds dashboard screenshot | **Team** after deploying |
| Judge access | Set `APP_TOKEN` to a demo-only value and put it in the PDF as the access code |
| 5. Confirmations | **Team** ticks them |

## Deployment guide pitfalls

| Pitfall | Handled by |
|---|---|
| 01 Port mismatch → 502 | App listens on `$PORT` (default 8000); Dockerfile exposes 8000; scripts pass `--port 8000` |
| 02 Push ≠ deploy | Documented; Route A deploys an explicit `vN` image |
| 03 Missing API key crash | Startup check prints which variable is missing instead of a `KeyError` |
| 04 Outdated CLI | Documented fix in DEPLOY.md |
| 05 n8n variables | Not applicable (custom code, no n8n) |
| 06 Read logs first | Startup logs `Application startup complete`; errors are one clear line |

---

## Your part, in order

1. **Get an AI key** (5 min): create a free key at [console.groq.com/keys](https://console.groq.com/keys). Copy `.env.example` to `.env`, then set `AGENT_MODE=groq`, `GROQ_API_KEY=...` and `APP_TOKEN=` (any 32 random characters).
2. **Try it locally** (5 min): `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1`, then `.\.venv\Scripts\python.exe -m backend.serve`. Open http://127.0.0.1:8000, enter the `APP_TOKEN`, go to **Connections → Run connection check**, and run the demo once.
3. **Optional fastn dispatch** (15 min): connect Slack or Google Sheets at app.fastn.ai, then follow [INTEGRATIONS.md](INTEGRATIONS.md) → *fastn recovery dispatch*. Confirm with `python -m backend.fastn_discover --test`.
4. **Deploy** (15 min): follow [DEPLOY.md](DEPLOY.md) Route A or B, then run `scripts\check-live.ps1` against the live URL until it says *Deployment verified*.
5. **Rehearse** the 6-minute script in [SUBMISSION.md](SUBMISSION.md) on the live URL. Record the 2–3 minute video (unlisted YouTube or Drive, anyone with the link).
6. **LinkedIn**: one of you writes and posts it in your own words, with the hashtags from handbook p.7; the other reshares.
7. **Screenshots**: Discord (both of you) and the Alternate Clouds dashboard showing the service as deployed.
8. **PDF**: fill in [SUBMISSION.md](SUBMISSION.md), export it to PDF, open every link in a private window, and submit **before 12:45 PM PKT on 17 October**.
9. **Freeze**: no code or deployment changes after the deadline; keep the service running until the closing ceremony.

# Deploying ReRoute on Alternate Clouds

What has been verified locally: the Docker image builds; the container starts with only `PORT=8000` and logs `Application startup complete`; the full browser test suite passes against it; it runs as a non-root user; and with a volume at `/app/data` the cases survive the container being replaced. `scripts/check-live.ps1` passed a full recovery case against a token-protected container.

Golden rule from the event guide: **set variables first, then Rebuild, then Deploy.**

## Step 0: choose your variables

Copy `.env.example` to `.env` and fill in what you use. Never commit `.env`.

| Variable | Minimum (demo) | Recommended for judging |
|---|---|---|
| `PORT` | `8000` | `8000` |
| `AGENT_MODE` | `demo` | `groq` (free key) or `anthropic` |
| `GROQ_API_KEY` | – | from [console.groq.com/keys](https://console.groq.com/keys) |
| `ANTHROPIC_API_KEY` | – | only if `AGENT_MODE=anthropic` |
| `APP_TOKEN` | – | 24+ random characters; **required** when any live mode is on. This is the judges' access code. |
| `DISPATCH_MODE` + `FASTN_*` | `off` | `fastn`, see [INTEGRATIONS.md](INTEGRATIONS.md) |

Generate an `APP_TOKEN`: `[System.Guid]::NewGuid().ToString("N")` in PowerShell.

If a live mode is missing its key or `APP_TOKEN`, the app refuses to start and prints a one-line reason in the Logs tab. It never pretends to be connected.

## Route A (recommended): CLI + published image

Every push to `main` runs the **Publish image** GitHub Action, which builds the tested Dockerfile and publishes `ghcr.io/nabeelali0707/reroute:vN` (N = run number, shown in the run summary).

1. Once only: on GitHub open **Packages → reroute → Package settings → Change visibility → Public**. Providers cannot pull private images.
2. Install and sign in: `npm i -g @alternatefutures/acc`, `acc login`, `acc projects create --name agentika` (or `acc projects switch`).
3. First deployment:
   `powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Image ghcr.io/nabeelali0707/reroute:vN -Create`
   The script reads your `.env`, refuses moving tags like `:latest`, checks `APP_TOKEN`, then runs `acc services create --kind docker ... --port 8000 --env ...` and `acc services deploy`.
4. Later updates: push to `main`, wait for the new `vN`, then run the same command without `-Create`.

## Route B: web app from the GitHub repository

1. In [clouds.alternatefutures.ai](https://clouds.alternatefutures.ai): **Add Service → GitHub**, select `nabeelali0707/ReRoute`, branch `main`.
2. **Source** tab: **PORT = 8000**. If you are asked for commands, leave them empty to use the Dockerfile. If the platform instead auto-detects a Python app, use build command `pip install -r requirements.txt` and start command `python -m backend.serve`. The built UI is committed in `frontend/dist`, so the auto-detect route also serves the full interface.
3. **Variables** tab: add your `.env` values.
4. **Rebuild**, wait for success, then **Deploy**.

## Optional: keep data across redeploys

Without a volume, cases live inside the container: they survive restarts but reset to the two seeded demo cases on each new deployment, which is fine for judging. To keep history, add a persistent volume in the service settings mounted at `/app/data` (1Gi is plenty). The entrypoint fixes the volume's ownership automatically. Alternatively set `DATABASE_URL` to a PostgreSQL URL (`postgresql+psycopg://...`).

## Verify the live URL

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-live.ps1 -Url https://<slug>-app.alternatefutures.ai -Token <APP_TOKEN>
```

It checks health, the homepage, the configured modes, makes one real call to each live provider (Groq/Claude, fastn), and runs a complete recovery case (investigate → approve → execute → verified request, plus dispatch if enabled). The same provider check is available in the app under **Connections → Run connection check**.

## When something breaks

| Symptom | Fix |
|---|---|
| Cloudflare 502 | PORT on the Source tab must be `8000`. Rebuild, then Deploy. |
| Live URL shows the old version | Pushing is not deploying: Rebuild then Deploy (Route B), or deploy the new `vN` (Route A). |
| Crash at startup | Logs tab: the last line names the missing variable (`GROQ_API_KEY`, `APP_TOKEN`...). Add it, Rebuild, Deploy. |
| Investigation shows "Investigation failed" | Run the connection check; the model key, model name or credits are the usual cause. Nothing is executed on failure. |
| `no active leases found` | `npm i -g @alternatefutures/acc`, `acc services close <id>`, retry. |
| Image cannot be pulled | Make the GHCR package public, and use a `vN` tag. |

For Discord support include the repo link, the log text in a code block and your steps, with keys removed.

Run a single instance; the server is designed for one worker.

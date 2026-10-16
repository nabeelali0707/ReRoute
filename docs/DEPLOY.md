# Deploying ReRoute on Alternate Clouds

Verified locally: the Dockerfile builds, the container starts with only `PORT=8000`, logs `Application startup complete`, passes the full browser test suite, and keeps its data across a container restart.

## 1. Create the service

1. Push this repository to GitHub (public, or accessible to judges).
2. Sign in at [clouds.alternatefutures.ai](https://clouds.alternatefutures.ai), open your project, choose **Add Service**, and select the GitHub repository. It builds from the root `Dockerfile`.
3. On the **Source** tab set **PORT = 8000**. This must match exactly or the public URL shows a Cloudflare 502.

## 2. Set variables BEFORE building

Set these on the **Variables** tab (or with `--env` in the CLI). Never commit `.env`.

| Variable | Demo deployment | Full deployment |
|---|---|---|
| `PORT` | `8000` | `8000` |
| `AGENT_MODE` | `demo` | `anthropic` |
| `ANTHROPIC_API_KEY` | – | your key |
| `APP_TOKEN` | – (leave empty) | 24+ random characters; required whenever any live mode is on |
| `DISPATCH_MODE` | `off` | `fastn` |
| `FASTN_API_KEY`, `FASTN_PROJECT_ID` | – | from app.fastn.ai |
| `FASTN_DISPATCH_ACTION_ID`, `FASTN_DISPATCH_PARAMS`, `FASTN_DISPATCH_LABEL` | – | see [INTEGRATIONS.md](INTEGRATIONS.md) |
| `DATABASE_URL` | – (SQLite in the container) | optional PostgreSQL URL `postgresql+psycopg://...` |

Generate an `APP_TOKEN` on Windows with `[System.Guid]::NewGuid().ToString("N")`.

The app refuses to start, with a one-line explanation in the logs, if a live mode is missing its key or `APP_TOKEN`. It never silently pretends to be connected.

## 3. Rebuild, then Deploy

Pushing to GitHub does not update the live app. On the **Source** tab click **Rebuild**, wait for success, then click **Deploy**. Repeat both after every code or variable change.

## 4. Verify the live URL

- `https://<service>/api/health` returns `{"status":"ok"}`.
- `https://<service>/api/config` shows the modes you intended (for example `"agent_mode":"anthropic"`, `"dispatch_mode":"fastn"`).
- Open the homepage, enter the `APP_TOKEN` if one is set, and run the demo walkthrough from the README end to end.
- With dispatch on, confirm the message or row actually appeared in the connected app.

## Data and limits

- Without `DATABASE_URL`, cases live in SQLite inside the container. They survive restarts but reset to the two seeded demo cases on a fresh deployment. That is fine for judging; use PostgreSQL if you need durable history.
- Run a single instance; the server is designed for one worker.
- If anything fails, read the **Logs** tab first. When asking for help on Discord, include the repo link, the log text and your steps, with keys removed.

# One-time local setup: Python environment, frontend build and a .env file.
# Usage (from the repository root):  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path .venv)) {
    Write-Host 'Creating Python virtual environment...'
    python -m venv .venv
}
& .\.venv\Scripts\python.exe -m pip install --quiet -r backend\requirements.lock
if ($LASTEXITCODE -ne 0) { throw 'Python dependency install failed.' }

Push-Location frontend
npm ci
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm ci failed.' }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Frontend build failed.' }
Pop-Location

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host 'Created .env from .env.example (demo mode). Add your keys there.'
}

Write-Host ''
Write-Host 'Setup complete. Start the app with:'
Write-Host '  .\.venv\Scripts\python.exe -m backend.serve'
Write-Host 'then open http://127.0.0.1:8000'

# Deploy ReRoute to Alternate Clouds with the acc CLI, using the published GHCR image
# and the non-empty values in your .env file.
#
#   First time:  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Image ghcr.io/nabeelali0707/reroute:v3 -Create
#   Updates:     powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Image ghcr.io/nabeelali0707/reroute:v4
#
# Prerequisites: npm i -g @alternatefutures/acc ; acc login ; acc projects switch <project>
# The image tag comes from the "Publish image" GitHub Action (vN). Make the GHCR package public once.
param(
    [Parameter(Mandatory = $true)][string]$Image,
    [string]$Name = 'reroute',
    [switch]$Create
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if ($Image -match ':(latest|main)$') { throw 'Alternate Clouds refuses moving tags. Use a versioned tag such as :v3.' }
if (-not (Get-Command acc -ErrorAction SilentlyContinue)) { throw 'acc CLI not found. Run: npm i -g @alternatefutures/acc' }
acc whoami | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Not signed in. Run: acc login' }

# Read KEY=VALUE pairs from .env, skipping comments, blanks and local-only values.
$vars = [ordered]@{ PORT = '8000' }
if (Test-Path .env) {
    foreach ($line in Get-Content .env) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $key, $value = $line -split '=', 2
        $key = $key.Trim(); $value = $value.Trim()
        if ($value.Length -ge 2 -and (($value[0] -eq "'" -and $value[-1] -eq "'") -or ($value[0] -eq '"' -and $value[-1] -eq '"'))) { $value = $value.Substring(1, $value.Length - 2) }
        if ((-not $value) -or (($key -eq 'DATABASE_URL') -and ($value -like 'sqlite*'))) { continue }
        $vars[$key] = $value
    }
}
# fastn settings are only sent when fastn is switched on. The platform's manifest
# generator also breaks on JSON values, so they must not be sent needlessly.
if ($vars['DISPATCH_MODE'] -ne 'fastn' -and $vars['TOOL_MODE'] -ne 'fastn') {
    foreach ($k in @($vars.Keys | Where-Object { $_ -like 'FASTN_*' })) { $vars.Remove($k) }
}
$live = ($vars['AGENT_MODE'] -and $vars['AGENT_MODE'] -ne 'demo') -or ($vars['DISPATCH_MODE'] -eq 'fastn')
if ($live -and (-not $vars['APP_TOKEN'] -or $vars['APP_TOKEN'].Length -lt 24)) { throw 'Live modes need APP_TOKEN (24+ characters) in .env. Generate one: [System.Guid]::NewGuid().ToString("N")' }

# Windows PowerShell 5.1 strips embedded double quotes from native arguments.
function Arg([string]$s) { if ($PSVersionTable.PSVersion.Major -lt 7) { $s -replace '"', '\"' } else { $s } }

Write-Host "Variables: $($vars.Keys -join ', ')"
if ($Create) {
    $envArgs = @(); foreach ($k in $vars.Keys) { $envArgs += '--env'; $envArgs += (Arg "$k=$($vars[$k])") }
    acc services create --kind docker --name $Name --image $Image --port 8000 @envArgs -y
    if ($LASTEXITCODE -ne 0) { throw 'Service creation failed.' }
} else {
    foreach ($k in $vars.Keys) {
        acc services env set $Name $k (Arg $vars[$k])
        if ($LASTEXITCODE -ne 0) { throw "Could not set $k." }
    }
}
acc services deploy $Name --image $Image
if ($LASTEXITCODE -ne 0) { throw 'Deploy failed. Check: acc services logs ' + $Name + ' --tail 100' }
acc services info $Name
Write-Host ''
Write-Host "Next: powershell -File scripts\check-live.ps1 -Url https://<slug>-app.alternatefutures.ai"

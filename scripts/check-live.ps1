# Verify a running ReRoute deployment end to end:
# health, configuration, live provider connections, and one complete recovery case.
#   powershell -ExecutionPolicy Bypass -File scripts\check-live.ps1 -Url https://<slug>-app.alternatefutures.ai [-Token <APP_TOKEN>]
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [string]$Token = ''
)
$ErrorActionPreference = 'Stop'
$Url = $Url.TrimEnd('/')
$headers = @{ 'Content-Type' = 'application/json' }
if ($Token) { $headers['Authorization'] = "Bearer $Token" }
$failed = 0
function Step($name, [scriptblock]$run) {
    try { $detail = & $run; Write-Host "[ OK ] $name  $detail" -ForegroundColor Green }
    catch { Write-Host "[FAIL] $name  $($_.Exception.Message)" -ForegroundColor Red; $script:failed++ }
}
function Post($path, $body) { Invoke-RestMethod -Method Post -Uri "$Url/api$path" -Headers $headers -Body ($body | ConvertTo-Json -Depth 6 -Compress) -TimeoutSec 240 }

Step 'Health' { $r = Invoke-RestMethod "$Url/api/health" -TimeoutSec 30; if ($r.status -ne 'ok') { throw 'unexpected response' }; 'status ok' }
Step 'Homepage' { $r = Invoke-WebRequest "$Url/" -UseBasicParsing -TimeoutSec 30; if ($r.Content -notmatch 'ReRoute') { throw 'UI not served' }; "HTTP $($r.StatusCode)" }
Step 'Configuration' { $c = Invoke-RestMethod "$Url/api/config" -TimeoutSec 30; "agent=$($c.agent_mode) model=$($c.model) dispatch=$($c.dispatch_mode) auth=$($c.auth_required)" }
Step 'Live connections' {
    $results = Post '/diagnostics' @{}
    $bad = @($results | Where-Object { -not $_.ok })
    ($results | ForEach-Object { "$($_.name): $($_.detail)" }) -join ' | ' | Write-Host
    if ($bad.Count) { throw "$($bad.Count) provider check(s) failed" }
    'all providers responded'
}
Step 'Full recovery case' {
    $case = Post '/cases' @{ title = "Live check $(Get-Date -Format 'HH:mm:ss')" }
    $d = Post "/cases/$($case.id)/investigate" @{}
    if ($d.status -ne 'review') { throw "investigation ended as '$($d.status)'" }
    $d = Post "/cases/$($case.id)/decision" @{ version = $d.version; action = 'approve'; plan_id = $d.recommended_id; note = 'Automated live check' }
    $d = Post "/cases/$($case.id)/execute" @{ version = $d.version }
    if ($d.status -ne 'recovered') { throw "execution ended as '$($d.status)'" }
    $dispatch = if ($d.dispatch) { " - dispatch $($d.dispatch.status)" } else { '' }
    "$($case.id) - $($d.execution.id) - PKR $($d.execution.total)$dispatch"
}
Write-Host ''
if ($failed) { Write-Host "$failed check(s) failed. Read the service logs first." -ForegroundColor Red; exit 1 }
Write-Host 'Deployment verified.' -ForegroundColor Green

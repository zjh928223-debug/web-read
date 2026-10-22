param([ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start', [switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$deploymentPath = Join-Path $root 'daily-deployment.json'
if (-not (Test-Path -LiteralPath $deploymentPath)) { throw 'Run this launcher only from the prepared frozen daily deployment.' }
$deployment = Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($deployment.root) -ne [IO.Path]::GetFullPath($root)) { throw 'Deployment root mismatch.' }
Import-Module (Join-Path $PSScriptRoot 'launcher-instance-manager.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'optimization-launch-runtime.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'optimization-release.psm1') -Force -DisableNameChecking
$state = Join-Path $root 'runtime-state'
$log = Join-Path $root 'logs'
$hostState = Join-Path $state 'host.json'
$capabilityState = Join-Path $state 'capability.json'
$gatewayState = Join-Path $state 'gateway.json'
$tokenPath = Join-Path $state 'service-token.txt'
$profile = 'optimization' # Keep copied owner identities/checksums unchanged; roots isolate writers.
$hostUrl = "http://127.0.0.1:$($deployment.hostPort)"
$gatewayUrl = "http://127.0.0.1:$($deployment.publicPort)"
$capabilityUrl = "http://127.0.0.1:$($deployment.capabilityPort)"
function Start-DailyGateway {
  param([Parameter(Mandatory)][string]$InstanceId)
  $env:READ_WEB_RELEASE_ID = $release.releaseId
  $env:READ_WEB_PROFILE_ID = $profile
  foreach ($name in @('READ_WEB_OPTIMIZATION_TEST_FAILURE', 'READ_WEB_OPTIMIZATION_TEST_KILL_PHASE', 'NODE_PATH')) {
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
  }
  Start-ManagedRuntimeInstance -ReleaseId $release.releaseId -ProfileId $profile -InstanceId $InstanceId `
    -Port $deployment.publicPort -HealthUrl "$gatewayUrl/api/app/front-door-process-health" -StatePath $gatewayState `
    -FilePath $deployment.node -ArgumentList @((Join-Path $PSScriptRoot 'daily-frozen-front-door.mjs')) `
    -WorkingDirectory $root -ReadyTimeoutSeconds 15 -ReservedDailyPorts @(5173,8765,5174,8766,5184,8776) `
    -StandardOutputPath (Join-Path $log 'gateway.out.log') -StandardErrorPath (Join-Path $log 'gateway.err.log') | Out-Null
  & tailscale serve --bg "--https=$($deployment.publicPort)" $gatewayUrl
  if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve configuration failed.' }
}
function Show-DailyReady {
  Write-Output "Windows: $gatewayUrl/"
  Write-Output "Mac (Tailscale): $($deployment.publicOrigin)"
  if ($OpenBrowser) { Start-Process "$gatewayUrl/" }
}
if ($Action -eq 'Status') {
  foreach ($url in @("$gatewayUrl/api/app/front-door-process-health", "$hostUrl/api/app/health", "$hostUrl/api/health")) {
    $health = Get-OptimizationHttpJson -Url $url
    if ($null -eq $health) { throw "Daily service unavailable: $url" }
    Write-Output "$url $($health.status)"
  }
  Write-Output $deployment.publicOrigin
  exit 0
}
if ($Action -eq 'Stop') {
  if (Test-Path -LiteralPath $hostState) {
    Invoke-OptimizationHostDrain -StatePath $hostState -TokenPath $tokenPath | Out-Null
  }
  foreach ($path in @($gatewayState, $hostState, $capabilityState)) {
    Stop-OptimizationOwnedState -StatePath $path -ProfileId $profile | Out-Null
  }
  Write-Output 'Daily services stopped. Development services and all data retained.'
  exit 0
}
$release = Get-OptimizationReleaseDescriptor -ReleaseRoot (Join-Path $root 'release')
$integrity = Test-OptimizationReleaseIntegrity -Release $release -NodePath $deployment.node -ReleaseHealthScript (Join-Path $PSScriptRoot 'release-health-check.mjs')
if (-not $integrity.passed) {
  throw 'Frozen release artifact integrity failed.'
}
$existingHost = Get-OptimizationHttpJson -Url "$hostUrl/api/app/health"
if ($null -ne $existingHost) {
  foreach ($statePath in @($hostState, $capabilityState)) {
    $saved = Read-OptimizationJsonFile -Path $statePath
    $expectedDirectory = if ($statePath -eq $hostState) { Join-Path $root 'tools/subtitle-workflow' } else { $root }
    if ($null -eq $saved -or $saved.releaseId -ne $release.releaseId -or $saved.workingDirectory -ne $expectedDirectory -or $saved.instanceId -ne $existingHost.instanceId) { throw 'Existing service is not the saved daily deployment.' }
    $health = Get-OptimizationHttpJson -Url $saved.healthUrl
    if ($null -eq $health -or $health.instanceId -ne $saved.instanceId -or $health.status -ne 'ready') { throw 'Daily deployment is partially running; use Stop before Start.' }
  }
  if ($existingHost.ownerMode.status -ne 'authoritative' -or @($existingHost.ownerMode.authoritativeDomains).Count -ne 6) { throw 'Daily backend persistence is not ready.' }
  # Restore a missing gateway without interrupting the healthy daily backend.
  # The managed launcher refuses unknown listeners or unproven processes.
  Start-DailyGateway -InstanceId $existingHost.instanceId
  Write-Output "Already running: $($deployment.publicOrigin)"
  Show-DailyReady
  exit 0
}
New-Item -ItemType Directory -Force -Path $state, $log | Out-Null
# Validate the English tokenizer files from the same explicit root inherited
# by the Host and WhisperX, instead of relying on a developer shell's NLTK_DATA.
foreach ($name in @('abbrev_types.txt','collocations.tab','ortho_context.tab','sent_starters.txt')) {
  $tokenizerFile = Join-Path $deployment.nltkData "tokenizers/punkt_tab/english/$name"
  if (-not (Test-Path -LiteralPath $tokenizerFile -PathType Leaf)) {
    throw "Daily WhisperX tokenizer data is missing: $tokenizerFile"
  }
}
foreach ($port in @($deployment.publicPort, $deployment.hostPort, $deployment.capabilityPort)) {
  if (Test-OptimizationTcpPortOccupied -Port $port) { throw "Port $port belongs to another process; refusing to replace it." }
}
$instance = 'daily-n5-' + [Guid]::NewGuid().ToString('N')
$token = New-OptimizationInstanceToken
Write-OptimizationRuntimeTextAtomic -Path $tokenPath -Text $token
$env:READ_WEB_RUNTIME_CONFIG = Join-Path $root 'config/runtime.frozen-daily.json'
$env:READ_WEB_SUBTITLE_DATA_ROOT = $deployment.dataRoot
$env:READ_WEB_PYTHON = $deployment.python
$env:READ_WEB_PYTHON_PATH = $deployment.python
$env:READ_WEB_NODE = $deployment.node
$env:READ_WEB_FRONTEND_HOST = '127.0.0.1'
$env:READ_WEB_FRONTEND_PORT = [string]$deployment.hostPort
$env:READ_WEB_BACKEND_HOST = '127.0.0.1'
$env:READ_WEB_BACKEND_PORT = [string]$deployment.capabilityPort
[Environment]::SetEnvironmentVariable('NLTK_DATA', [IO.Path]::GetFullPath($deployment.nltkData), 'Process')
$env:ECDICT_ENABLED = 'false'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
# A development shell must not inject its token, test faults, or database paths.
foreach ($name in @('READ_WEB_OPTIMIZATION_TEST_FAILURE', 'READ_WEB_OPTIMIZATION_TEST_KILL_PHASE', 'VITE_READ_WEB_SERVICE_TOKEN', 'ECDICT_DATABASE_PATH', 'LOCAL_SENTENCE_DATABASE_PATH', 'SENTENCE_TRANSLATION_CACHE_PATH', 'IELTS_READING_VOCABULARY_CANDIDATES_PATH', 'PYTHONPATH', 'PYTHONHOME', 'NODE_PATH')) {
  Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
}
$appRoot = Join-Path $deployment.dataRoot '.read-web-application'
$instanceRoot = Join-Path $appRoot "daily-instances/$instance"
$authorityRoot = Join-Path $appRoot 'profiles/optimization'
try {
  $pair = Start-OptimizationOwnedPair -Release $release -ProfileId $profile -InstanceId $instance -ServiceToken $token `
    -FrontendHost '127.0.0.1' -FrontendPort $deployment.hostPort -BackendHost '127.0.0.1' -BackendPort $deployment.capabilityPort `
    -PythonPath $deployment.python -NodePath $deployment.node -CapabilityScript (Join-Path $root 'tools/local-capability-host.mjs') `
    -WorkflowRoot (Join-Path $root 'tools/subtitle-workflow') -ProjectRoot $root `
    -OwnerWorkflowStateDir (Join-Path $deployment.dataRoot '.workflow_state') -OwnerWorkflowOutputDir (Join-Path $deployment.dataRoot 'output') `
    -OwnerMediaFallbackRoot (Join-Path $deployment.dataRoot 'output') `
    -ApplicationIsolationRoot $instanceRoot -ApplicationProfileDir (Join-Path $instanceRoot 'profile') `
    -ApplicationProfileAuthorityRoot $authorityRoot -ApplicationProfileAuthorityIsolationRoot (Join-Path $appRoot 'profiles') `
    -ApplicationPythonStateDir (Join-Path $instanceRoot 'python-state') -ApplicationPythonOutputDir (Join-Path $instanceRoot 'python-output') `
    -HostStatePath $hostState -CapabilityStatePath $capabilityState -LogRoot $log `
    -HostHealthUrl "$hostUrl/api/app/health" -WorkflowHealthUrl "$hostUrl/api/health" -CapabilityHealthUrl "$capabilityUrl/api/app/health" `
    -CapabilityBaseUrl $capabilityUrl -StartupTimeoutSeconds 45 -ReservedPorts @(5173,8765,5174,8766,5184,8776) `
    -ExpectedDataRoot $deployment.dataRoot -NltkDataPath $deployment.nltkData
  if ($pair.health.ownerMode.status -ne 'authoritative' -or @($pair.health.ownerMode.authoritativeDomains).Count -ne 6) {
    throw 'Daily backend is not authoritative for all six persistence domains.'
  }
  Start-DailyGateway -InstanceId $instance
  Write-Output "Daily N5 ready: $($deployment.publicOrigin)"
  Show-DailyReady
} catch {
  foreach ($path in @($gatewayState, $hostState, $capabilityState)) {
    Stop-OptimizationOwnedState -StatePath $path -ProfileId $profile | Out-Null
  }
  throw
}

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$managerModulePath = Join-Path $PSScriptRoot 'launcher-instance-manager.psm1'
$fixturePath = Join-Path $PSScriptRoot 'fixtures\launcher-test-host.py'
$pythonPath = (Get-Command python.exe -ErrorAction Stop).Source
Import-Module $managerModulePath -Force

function Assert-True($Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

function Get-RandomLoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Assert-LiveDescriptor($State, [string]$MessagePrefix) {
  $process = Get-Process -Id ([int]$State.pid) -ErrorAction SilentlyContinue
  Assert-True ($null -ne $process -and -not $process.HasExited) "$MessagePrefix did not resolve a live descriptor PID"
  $expected = ([DateTimeOffset]::Parse([string]$State.processStartUtc)).UtcDateTime
  $actual = $process.StartTime.ToUniversalTime()
  Assert-True ([Math]::Abs(($actual - $expected).TotalMilliseconds) -le 1000) "$MessagePrefix descriptor processStartUtc did not match the live PID"
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $connected = $client.ConnectAsync('127.0.0.1', [int]$State.port).Wait(500) -and $client.Connected
  } catch {
    $connected = $false
  } finally {
    $client.Dispose()
  }
  Assert-True $connected "$MessagePrefix descriptor PID did not leave its port reachable"
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('read-web-detached-lifetime-' + [Guid]::NewGuid().ToString('N'))
$statePath = Join-Path $testRoot 'managed.json'
$wrapperPath = Join-Path $testRoot 'caller.ps1'
$callerExitMarkerPath = Join-Path $testRoot 'caller-exited.marker'
$wrapperOutputPath = Join-Path $testRoot 'caller.out.log'
$wrapperErrorPath = Join-Path $testRoot 'caller.err.log'
$port = Get-RandomLoopbackPort
$releaseId = 'detached-lifetime-release'
$profileId = 'detached-lifetime-profile'
$instanceId = [Guid]::NewGuid().ToString('N')
$child = $null

New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
try {
  $wrapper = @'
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module '__MANAGER__' -Force
$result = Start-ManagedRuntimeInstance `
  -ReleaseId '__RELEASE__' `
  -ProfileId '__PROFILE__' `
  -InstanceId '__INSTANCE__' `
  -Port __PORT__ `
  -HealthUrl 'http://127.0.0.1:__PORT__/health' `
  -StatePath '__STATE__' `
  -FilePath '__PYTHON__' `
  -ArgumentList @('__FIXTURE__', '--port', '{port}', '--release-id', '{releaseId}', '--profile-id', '{profileId}', '--instance-id', '{instanceId}', '--executable-identity', '{executableIdentity}') `
  -WorkingDirectory '__WORKING__' `
  -ReadyTimeoutSeconds 5 `
  -ExecutableIdentity 'detached-lifetime-v1'
if ($result.status -ne 'started' -or $result.instanceId -ne '__INSTANCE__') {
  throw "Detached lifetime caller did not start the requested instance: $($result | ConvertTo-Json -Compress)"
}
[IO.File]::WriteAllText('__CALLER_EXIT__', '0')
Write-Output ($result | ConvertTo-Json -Compress)
'@
  foreach ($replacement in @{
      '__MANAGER__' = $managerModulePath
      '__RELEASE__' = $releaseId
      '__PROFILE__' = $profileId
      '__INSTANCE__' = $instanceId
      '__PORT__' = [string]$port
      '__STATE__' = $statePath
      '__CALLER_EXIT__' = $callerExitMarkerPath
      '__PYTHON__' = $pythonPath
      '__FIXTURE__' = $fixturePath
      '__WORKING__' = $testRoot
    }.GetEnumerator()) {
    $wrapper = $wrapper.Replace($replacement.Key, [string]$replacement.Value)
  }
  [IO.File]::WriteAllText($wrapperPath, $wrapper, [Text.UTF8Encoding]::new($false))

  $powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
  $child = Start-Process `
    -FilePath $powershellPath `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $wrapperPath) `
    -WorkingDirectory $testRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $wrapperOutputPath `
    -RedirectStandardError $wrapperErrorPath `
    -PassThru
  $callerDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $child.Refresh()
    if ($child.HasExited) { break }
    if (Test-Path -LiteralPath $callerExitMarkerPath -PathType Leaf) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $callerDeadline)
  $child.Refresh()
  $callerOutput = if (Test-Path -LiteralPath $wrapperOutputPath -PathType Leaf) { Get-Content -LiteralPath $wrapperOutputPath -Raw -Encoding UTF8 } else { '' }
  $callerError = if (Test-Path -LiteralPath $wrapperErrorPath -PathType Leaf) { Get-Content -LiteralPath $wrapperErrorPath -Raw -Encoding UTF8 } else { '' }
  Assert-True (Test-Path -LiteralPath $callerExitMarkerPath -PathType Leaf) "Detached lifetime caller did not reach its explicit exit boundary: $callerOutput $callerError"
  Assert-True $child.HasExited 'Detached lifetime caller reached its exit boundary but its PowerShell process did not exit'
  $callerExitCode = (Get-Content -LiteralPath $callerExitMarkerPath -Raw -Encoding UTF8).Trim()
  Assert-True ($callerExitCode -eq '0') "Detached lifetime caller reported exit code ${callerExitCode}: $callerOutput $callerError"
  $child.Dispose()
  $child = $null

  Assert-True (Test-Path -LiteralPath $statePath -PathType Leaf) 'detached lifetime caller exited without leaving managed state'
  $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-LiveDescriptor -State $state -MessagePrefix 'immediately after the caller exited'

  $initialPid = [int]$state.pid
  $initialStart = [string]$state.processStartUtc
  Start-Sleep -Seconds 31

  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
  $stateAfterWait = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-LiveDescriptor -State $stateAfterWait -MessagePrefix 'after the 30-second lease window'
  Assert-True ($health.status -eq 'ready' -and $health.releaseId -eq $releaseId -and $health.profileId -eq $profileId -and $health.instanceId -eq $instanceId) 'managed runtime did not remain healthy after the caller exited and the 30-second lease window'
  Assert-True ([int]$stateAfterWait.pid -eq $initialPid -and [string]$stateAfterWait.processStartUtc -eq $initialStart) 'managed descriptor PID/start time changed unexpectedly during the detached lifetime check'

  Write-Host ("launcher detached lifetime check passed: caller exit=0 pid=$initialPid processStartUtc=$initialStart port=$port waitSeconds=31")
} finally {
  if ($null -ne $child) {
    try { $child.Refresh(); if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue } } catch {}
    try { $child.Dispose() } catch {}
  }
  if (Test-Path -LiteralPath $statePath -PathType Leaf) {
    try {
      Stop-OwnedRuntimeInstance `
        -StatePath $statePath `
        -ExpectedReleaseId $releaseId `
        -ExpectedProfileId $profileId `
        -ExpectedInstanceId $instanceId | Out-Null
    } catch {
      Write-Warning "Detached lifetime cleanup retained the state because ownership could not be proven: $($_.Exception.Message)"
    }
  }
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'launcher-instance-manager.psm1') -Force

function Get-RandomLoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Assert-True($Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('read-web-launcher-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$python = (Get-Command python -ErrorAction Stop).Source
$fixture = Join-Path $PSScriptRoot 'fixtures\launcher-test-host.py'
$ownedState = Join-Path $testRoot 'owned.json'
$owned = $null
$unknown = $null
$orphan = $null
try {
  foreach ($reserved in @(5173, 8765, 5174, 8766)) {
    $threw = $false
    try { Assert-LauncherPortSafety -Port $reserved -ProfileId 'isolated-test' } catch { $threw = $true }
    Assert-True $threw "isolated launcher must reject reserved daily port $reserved"
  }
  $dailyAllowanceRejected = $false
  try { Assert-LauncherPortSafety -Port 5174 -ProfileId 'daily-production' } catch { $dailyAllowanceRejected = $true }
  Assert-True $dailyAllowanceRejected 'daily-production must require explicit reserved-port allowance'
  $legacyAliasRejected = $false
  try { Assert-LauncherPortSafety -Port 5174 -ProfileId 'daily' } catch { $legacyAliasRejected = $true }
  Assert-True $legacyAliasRejected 'legacy daily profile must not bypass the current daily-production ports'
  Assert-LauncherPortSafety -Port 5174 -ProfileId 'daily-production' -AllowReservedDailyPorts
  Assert-LauncherPortSafety -Port 8766 -ProfileId 'daily-production' -AllowReservedDailyPorts

  $unknownPort = Get-RandomLoopbackPort
  $unknown = Start-Process -FilePath $python -ArgumentList @('-m', 'http.server', "$unknownPort", '--bind', '127.0.0.1') -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 300
  $unknownRejected = $false
  try {
    Start-ManagedRuntimeInstance -ReleaseId 'test-release' -ProfileId 'isolated-test' -Port $unknownPort `
      -HealthUrl "http://127.0.0.1:$unknownPort/health" -StatePath (Join-Path $testRoot 'unknown.json') `
      -FilePath $python -ArgumentList @($fixture) -ReadyTimeoutSeconds 1
  } catch {
    $unknownRejected = $_.Exception.Message -match 'unknown process'
  }
  Assert-True $unknownRejected 'unknown port occupant must be rejected'
  $unknown.Refresh()
  Assert-True (-not $unknown.HasExited) 'unknown port occupant must not be stopped'

  $orphanPort = Get-RandomLoopbackPort
  $orphanInstanceId = [Guid]::NewGuid().ToString('N')
  $orphan = Start-Process -FilePath $python -ArgumentList @(
    $fixture, '--port', "$orphanPort", '--release-id', 'orphan-release',
    '--profile-id', 'orphan-profile', '--instance-id', $orphanInstanceId
  ) -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 300
  $orphanResult = Start-ManagedRuntimeInstance -ReleaseId 'orphan-release' -ProfileId 'orphan-profile' `
    -Port $orphanPort -HealthUrl "http://127.0.0.1:$orphanPort/health" `
    -StatePath (Join-Path $testRoot 'orphan.json') -FilePath $python `
    -ArgumentList @($fixture) -ReadyTimeoutSeconds 1
  Assert-True (
    $orphanResult.status -eq 'reused' -and $orphanResult.instanceId -eq $orphanInstanceId
  ) 'an identity-matching healthy runtime must be reused when its local state file is missing'
  $orphan.Refresh()
  Assert-True (-not $orphan.HasExited) 'an adopted healthy runtime must not be stopped'

  $ownedPort = Get-RandomLoopbackPort
  $sharedInstanceId = [Guid]::NewGuid().ToString('N')
  $arguments = @($fixture, '--port', '{port}', '--release-id', '{releaseId}', '--profile-id', '{profileId}', '--instance-id', '{instanceId}', '--executable-identity', '{executableIdentity}', '--health-path', '/health-loopback')
  $first = Start-ManagedRuntimeInstance -ReleaseId 'test-release' -ProfileId 'isolated-test' -Port $ownedPort `
    -HealthUrl "http://127.0.0.1:$ownedPort/health-loopback" -StatePath $ownedState -FilePath $python `
    -ArgumentList $arguments -ReadyTimeoutSeconds 3 -InstanceId $sharedInstanceId -ExecutableIdentity 'config-loopback-v1'
  Assert-True ($first.status -eq 'started' -and $first.instanceId -eq $sharedInstanceId) 'first launch should start the requested owned instance identity'
  $second = Start-ManagedRuntimeInstance -ReleaseId 'test-release' -ProfileId 'isolated-test' -Port $ownedPort `
    -HealthUrl "http://127.0.0.1:$ownedPort/health-loopback" -StatePath $ownedState -FilePath $python `
    -ArgumentList $arguments -ReadyTimeoutSeconds 3 -InstanceId $sharedInstanceId -ExecutableIdentity 'config-loopback-v1'
  Assert-True ($second.status -eq 'reused' -and $second.pid -eq $first.pid -and $second.instanceId -eq $sharedInstanceId) 'duplicate launch should reuse the shared owned instance'
  $lanAArguments = @($arguments[0..($arguments.Count - 2)] + '/health-lan-a')
  $lanA = Start-ManagedRuntimeInstance -ReleaseId 'test-release' -ProfileId 'isolated-test' -Port $ownedPort `
    -HealthUrl "http://127.0.0.1:$ownedPort/health-lan-a" -StatePath $ownedState -FilePath $python `
    -ArgumentList $lanAArguments -ReadyTimeoutSeconds 3 -InstanceId $sharedInstanceId -ExecutableIdentity 'config-private-lan-a'
  Assert-True ($lanA.status -eq 'started' -and $lanA.pid -ne $first.pid) 'loopback to private-LAN configuration must replace the proven old runtime'
  $lanBArguments = @($arguments[0..($arguments.Count - 2)] + '/health-lan-b')
  $lanB = Start-ManagedRuntimeInstance -ReleaseId 'test-release' -ProfileId 'isolated-test' -Port $ownedPort `
    -HealthUrl "http://127.0.0.1:$ownedPort/health-lan-b" -StatePath $ownedState -FilePath $python `
    -ArgumentList $lanBArguments -ReadyTimeoutSeconds 3 -InstanceId $sharedInstanceId -ExecutableIdentity 'config-private-lan-b'
  Assert-True ($lanB.status -eq 'started' -and $lanB.pid -ne $lanA.pid) 'private-LAN address change must replace the proven old runtime'
  $loopback = Start-ManagedRuntimeInstance -ReleaseId 'test-release' -ProfileId 'isolated-test' -Port $ownedPort `
    -HealthUrl "http://127.0.0.1:$ownedPort/health-loopback" -StatePath $ownedState -FilePath $python `
    -ArgumentList $arguments -ReadyTimeoutSeconds 3 -InstanceId $sharedInstanceId -ExecutableIdentity 'config-loopback-v2'
  Assert-True ($loopback.status -eq 'started' -and $loopback.pid -ne $lanB.pid) 'private-LAN to loopback configuration must replace the proven old runtime'

  $replacementFailed = $false
  try {
    Start-ManagedRuntimeInstance -ReleaseId 'test-release' -ProfileId 'isolated-test' -Port $ownedPort `
      -HealthUrl "http://127.0.0.1:$ownedPort/health-lan-failed" -StatePath $ownedState -FilePath $python `
      -ArgumentList @($fixture, '--port', '{port}', '--release-id', '{releaseId}', '--profile-id', '{profileId}', '--instance-id', '{instanceId}', '--executable-identity', '{executableIdentity}', '--health-path', '/health-lan-failed', '--fail-ready') `
      -ReadyTimeoutSeconds 1 -InstanceId $sharedInstanceId -ExecutableIdentity 'config-private-lan-failed'
  } catch { $replacementFailed = $_.Exception.Message -match 'did not become ready|previous runtime restored' }
  Assert-True $replacementFailed 'failed executable replacement must be observable'
  $restoredHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$ownedPort/health-loopback" -TimeoutSec 2
  $restoredState = Get-Content -LiteralPath $ownedState -Raw | ConvertFrom-Json
  Assert-True ($restoredHealth.status -eq 'ready' -and $restoredHealth.executableIdentity -eq 'config-loopback-v2' -and $restoredState.executableIdentity -eq 'config-loopback-v2') 'failed configuration replacement did not restore the previous healthy runtime'
  Assert-True (Stop-OwnedRuntimeInstance -StatePath $ownedState -ExpectedReleaseId 'test-release' -ExpectedProfileId 'isolated-test' -ExpectedInstanceId $first.instanceId) 'owned instance should stop'
  Assert-True (-not (Test-Path -LiteralPath $ownedState)) 'owned state should be removed after stop'

  $timeoutPort = Get-RandomLoopbackPort
  $timeoutState = Join-Path $testRoot 'timeout.json'
  $timeoutRaised = $false
  try {
    Start-ManagedRuntimeInstance -ReleaseId 'timeout-release' -ProfileId 'isolated-timeout' -Port $timeoutPort `
      -HealthUrl "http://127.0.0.1:$timeoutPort/health" -StatePath $timeoutState -FilePath $python `
      -ArgumentList @($fixture, '--port', '{port}', '--release-id', '{releaseId}', '--profile-id', '{profileId}', '--instance-id', '{instanceId}', '--ready-delay', '10') `
      -ReadyTimeoutSeconds 1
  } catch { $timeoutRaised = $_.Exception.Message -match 'did not become ready' }
  Assert-True $timeoutRaised 'ready timeout should reject startup'
  Assert-True (-not (Test-Path -LiteralPath $timeoutState)) 'ready timeout should remove runtime state'
  Start-Sleep -Milliseconds 200
  $probe = [Net.Sockets.TcpClient]::new()
  try {
    $connected = $probe.ConnectAsync('127.0.0.1', $timeoutPort).Wait(250) -and $probe.Connected
  } catch { $connected = $false } finally { $probe.Dispose() }
  Assert-True (-not $connected) 'ready timeout should stop only its newly-created process'

  Write-Host 'launcher instance manager check passed'
} finally {
  if ($null -ne $unknown) { $unknown.Refresh(); if (-not $unknown.HasExited) { Stop-Process -Id $unknown.Id -Force } }
  if ($null -ne $orphan) { $orphan.Refresh(); if (-not $orphan.HasExited) { Stop-Process -Id $orphan.Id -Force } }
  if (Test-Path -LiteralPath $ownedState) {
    try { Stop-OwnedRuntimeInstance -StatePath $ownedState -ExpectedReleaseId 'test-release' -ExpectedProfileId 'isolated-test' | Out-Null } catch {}
  }
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}

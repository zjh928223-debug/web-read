Set-StrictMode -Version Latest

function Assert-LauncherPortSafety {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$ProfileId,
    [int[]]$ReservedDailyPorts = @(5173, 8765)
  )
  if ($Port -lt 1 -or $Port -gt 65535) {
    throw "Invalid launcher port: $Port"
  }
  if ($ProfileId -ne 'daily' -and $ReservedDailyPorts -contains $Port) {
    throw "Isolated profile '$ProfileId' may not use reserved daily port $Port."
  }
}

function Test-TcpPortOccupied {
  param([Parameter(Mandatory)][int]$Port)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return $task.Wait(250) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-LoopbackPortOwnerProcess {
  param([Parameter(Mandatory)][int]$Port)
  $command = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
  if ($null -eq $command) { return $null }
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1', '0.0.0.0', '::') } |
      Select-Object -First 1
    if ($null -eq $connection -or -not $connection.OwningProcess) { return $null }
    return Get-Process -Id ([int]$connection.OwningProcess) -ErrorAction SilentlyContinue
  } catch {
    return $null
  }
}

function Get-LauncherHealth {
  param([Parameter(Mandatory)][string]$HealthUrl)
  try {
    return Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 1
  } catch {
    return $null
  }
}

function Test-HealthIdentity {
  param(
    $Health,
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$InstanceId
  )
  return $null -ne $Health `
    -and [string]$Health.releaseId -eq $ReleaseId `
    -and [string]$Health.profileId -eq $ProfileId `
    -and [string]$Health.instanceId -eq $InstanceId `
    -and [string]$Health.status -in @('ok', 'ready')
}

function Test-HealthProfileIdentity {
  param(
    $Health,
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId
  )
  return $null -ne $Health `
    -and [string]$Health.releaseId -eq $ReleaseId `
    -and [string]$Health.profileId -eq $ProfileId `
    -and -not [string]::IsNullOrWhiteSpace([string]$Health.instanceId) `
    -and [string]$Health.status -in @('ok', 'ready')
}

function Read-InstanceState {
  param([Parameter(Mandatory)][string]$StatePath)
  if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return $null }
  try {
    return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-MatchingOwnedProcess {
  param($State)
  if ($null -eq $State -or -not $State.pid -or -not $State.processStartUtc) { return $null }
  $process = Get-Process -Id ([int]$State.pid) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  try {
    $dateStyles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    $expected = ([DateTimeOffset]::Parse(
      [string]$State.processStartUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      $dateStyles
    )).UtcDateTime
    $actual = $process.StartTime.ToUniversalTime()
    if ([Math]::Abs(($actual - $expected).TotalMilliseconds) -gt 1000) { return $null }
  } catch {
    return $null
  }
  return $process
}

function Write-InstanceStateAtomic {
  param(
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)]$State
  )
  $directory = Split-Path -Parent $StatePath
  if (-not $directory) { $directory = (Get-Location).Path }
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ('.' + [IO.Path]::GetFileName($StatePath) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $StatePath -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Stop-OwnedRuntimeInstance {
  param(
    [Parameter(Mandatory)][string]$StatePath,
    [string]$ExpectedReleaseId = '',
    [string]$ExpectedProfileId = '',
    [string]$ExpectedInstanceId = '',
    [int]$StopTimeoutSeconds = 3
  )
  $state = Read-InstanceState -StatePath $StatePath
  if ($null -eq $state) { return $false }
  if ($ExpectedReleaseId -and [string]$state.releaseId -ne $ExpectedReleaseId) { throw 'Release ownership mismatch; refusing to stop process.' }
  if ($ExpectedProfileId -and [string]$state.profileId -ne $ExpectedProfileId) { throw 'Profile ownership mismatch; refusing to stop process.' }
  if ($ExpectedInstanceId -and [string]$state.instanceId -ne $ExpectedInstanceId) { throw 'Instance ownership mismatch; refusing to stop process.' }
  $process = Get-MatchingOwnedProcess -State $state
  if ($null -eq $process) { throw 'PID/start identity mismatch; refusing to stop process.' }
  Stop-Process -Id $process.Id -ErrorAction Stop
  try { $process.WaitForExit([Math]::Max(1, $StopTimeoutSeconds) * 1000) | Out-Null } catch {}
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction Stop }
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  return $true
}

function Start-ManagedRuntimeInstance {
  param(
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$HealthUrl,
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = '',
    [int]$ReadyTimeoutSeconds = 30,
    [int[]]$ReservedDailyPorts = @(5173, 8765),
    [string]$StandardOutputPath = '',
    [string]$StandardErrorPath = ''
  )
  Assert-LauncherPortSafety -Port $Port -ProfileId $ProfileId -ReservedDailyPorts $ReservedDailyPorts
  $stateDirectory = Split-Path -Parent $StatePath
  if (-not $stateDirectory) { $stateDirectory = (Get-Location).Path }
  New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
  $lockPath = "$StatePath.lock"
  $lock = $null
  try {
    try {
      $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
      throw "Runtime instance launch already in progress for profile '$ProfileId'."
    }

    $existing = Read-InstanceState -StatePath $StatePath
    if ($null -ne $existing) {
      $owned = Get-MatchingOwnedProcess -State $existing
      $health = Get-LauncherHealth -HealthUrl $HealthUrl
      if ($null -ne $owned `
        -and [string]$existing.releaseId -eq $ReleaseId `
        -and [string]$existing.profileId -eq $ProfileId `
        -and [int]$existing.port -eq $Port `
        -and (Test-HealthIdentity -Health $health -ReleaseId $ReleaseId -ProfileId $ProfileId -InstanceId ([string]$existing.instanceId))) {
        return [pscustomobject]@{ status = 'reused'; pid = $owned.Id; instanceId = [string]$existing.instanceId; url = $HealthUrl }
      }
      if ($null -ne $owned) { throw 'A launcher-owned process exists but its health identity does not match; refusing replacement.' }
      Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    }

    if (Test-TcpPortOccupied -Port $Port) {
      $health = Get-LauncherHealth -HealthUrl $HealthUrl
      if (Test-HealthProfileIdentity -Health $health -ReleaseId $ReleaseId -ProfileId $ProfileId) {
        $portOwner = Get-LoopbackPortOwnerProcess -Port $Port
        $knownPid = if ($null -ne $portOwner) { $portOwner.Id } else { 0 }
        if ($null -ne $portOwner) {
          Write-InstanceStateAtomic -StatePath $StatePath -State ([ordered]@{
            schemaVersion = 1
            releaseId = $ReleaseId
            profileId = $ProfileId
            instanceId = [string]$health.instanceId
            port = $Port
            pid = $portOwner.Id
            processStartUtc = ($portOwner.StartTime.ToUniversalTime()).ToString('O')
            startedAtUtc = ([DateTime]::UtcNow).ToString('O')
          })
        }
        return [pscustomobject]@{
          status = 'reused'
          pid = $knownPid
          instanceId = [string]$health.instanceId
          url = $HealthUrl
          adopted = $true
        }
      }
      throw "Port $Port is occupied by an unknown process; it will not be stopped. Choose another port or handle it manually."
    }

    $instanceId = [Guid]::NewGuid().ToString('N')
    $previousInstanceId = $env:READ_WEB_INSTANCE_ID
    $env:READ_WEB_INSTANCE_ID = $instanceId
    $arguments = @($ArgumentList | ForEach-Object {
      [string]$_ -replace '\{instanceId\}', $instanceId -replace '\{releaseId\}', $ReleaseId -replace '\{profileId\}', $ProfileId -replace '\{port\}', [string]$Port
    })
    $start = @{ FilePath = $FilePath; ArgumentList = $arguments; PassThru = $true; WindowStyle = 'Hidden' }
    if ($WorkingDirectory) { $start.WorkingDirectory = $WorkingDirectory }
    if ($StandardOutputPath) { $start.RedirectStandardOutput = $StandardOutputPath }
    if ($StandardErrorPath) { $start.RedirectStandardError = $StandardErrorPath }
    try { $process = Start-Process @start } finally { $env:READ_WEB_INSTANCE_ID = $previousInstanceId }
    $state = [ordered]@{
      schemaVersion = 1
      releaseId = $ReleaseId
      profileId = $ProfileId
      instanceId = $instanceId
      port = $Port
      pid = $process.Id
      processStartUtc = ($process.StartTime.ToUniversalTime()).ToString('O')
      startedAtUtc = ([DateTime]::UtcNow).ToString('O')
    }
    Write-InstanceStateAtomic -StatePath $StatePath -State $state

    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $ReadyTimeoutSeconds))
    do {
      $process.Refresh()
      if ($process.HasExited) { throw "Managed process exited before ready with code $($process.ExitCode)." }
      $health = Get-LauncherHealth -HealthUrl $HealthUrl
      if (Test-HealthIdentity -Health $health -ReleaseId $ReleaseId -ProfileId $ProfileId -InstanceId $instanceId) {
        $portOwner = Get-LoopbackPortOwnerProcess -Port $Port
        if ($null -ne $portOwner -and $portOwner.Id -ne $process.Id) {
          $state.pid = $portOwner.Id
          $state.processStartUtc = ($portOwner.StartTime.ToUniversalTime()).ToString('O')
          Write-InstanceStateAtomic -StatePath $StatePath -State $state
        }
        $readyPid = if ($null -ne $portOwner) { $portOwner.Id } else { $process.Id }
        return [pscustomobject]@{ status = 'started'; pid = $readyPid; instanceId = $instanceId; url = $HealthUrl }
      }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Managed process did not become ready within $ReadyTimeoutSeconds seconds."
  } catch {
    $failure = $_
    $created = Read-InstanceState -StatePath $StatePath
    if ($null -ne $created -and $created.releaseId -eq $ReleaseId -and $created.profileId -eq $ProfileId) {
      $owned = Get-MatchingOwnedProcess -State $created
      if ($null -ne $owned) {
        Stop-Process -Id $owned.Id -Force -ErrorAction SilentlyContinue
        try { $owned.WaitForExit(3000) | Out-Null } catch {}
      }
      Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    }
    throw $failure
  } finally {
    if ($null -ne $lock) { $lock.Dispose() }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  }
}

Export-ModuleMember -Function Assert-LauncherPortSafety, Start-ManagedRuntimeInstance, Stop-OwnedRuntimeInstance

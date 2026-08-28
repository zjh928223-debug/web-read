Set-StrictMode -Version Latest

function Set-OptimizationProcessEnvironmentValue {
  param(
    [Parameter(Mandatory)][string]$Name,
    [AllowNull()][string]$Value
  )
  if ($null -eq $Value) {
    Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
    return
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Restore-OptimizationProcessEnvironment {
  param([Parameter(Mandatory)]$Snapshot)
  foreach ($name in $Snapshot.Keys) {
    Set-OptimizationProcessEnvironmentValue -Name $name -Value $Snapshot[$name]
  }
}

function Resolve-OptimizationExecutablePath {
  param(
    [Parameter(Mandatory)][string]$Value,
    [Parameter(Mandatory)][string]$Label
  )
  if (Test-Path -LiteralPath $Value -PathType Leaf) {
    return (Resolve-Path -LiteralPath $Value).Path
  }
  $command = Get-Command $Value -ErrorAction SilentlyContinue
  if ($null -eq $command) { throw "$Label executable not found: $Value" }
  return $command.Source
}

function Resolve-OptimizationExistingPath {
  param(
    [Parameter(Mandatory)][string]$Value,
    [Parameter(Mandatory)][string]$Label
  )
  if (-not (Test-Path -LiteralPath $Value)) { throw "$Label path not found: $Value" }
  return (Resolve-Path -LiteralPath $Value).Path
}

function Read-OptimizationJsonFile {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    return ConvertFrom-Json -InputObject (Read-OptimizationRuntimeText -Path $Path)
  } catch {
    throw "Invalid JSON file: $Path"
  }
}

function Read-OptimizationRuntimeText {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $encoding = [Text.UTF8Encoding]::new($false)
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    try {
      return [IO.File]::ReadAllText($resolvedPath, $encoding)
    } catch {
      if ($attempt -eq 99) { throw }
      Start-Sleep -Milliseconds 50
    }
  }
  return ''
}

function Get-OptimizationObjectValue {
  param(
    $Object,
    [Parameter(Mandatory)][string]$Name
  )
  if ($null -eq $Object) { return $null }
  if ($Object -is [Collections.IDictionary] -and $Object.Contains($Name)) {
    return $Object[$Name]
  }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-OptimizationObjectText {
  param(
    $Object,
    [Parameter(Mandatory)][string]$Name
  )
  $value = Get-OptimizationObjectValue -Object $Object -Name $Name
  if ($null -eq $value) { return '' }
  return [string]$value
}

function Normalize-OptimizationPath {
  param([Parameter(Mandatory)][string]$Value)
  return [IO.Path]::GetFullPath($Value).TrimEnd('\', '/').ToLowerInvariant()
}

function Test-OptimizationLoopbackHost {
  param([Parameter(Mandatory)][string]$HostName)
  return $HostName.Trim().TrimStart('[').TrimEnd(']').ToLowerInvariant() -in @('127.0.0.1', 'localhost', '::1')
}

function Format-OptimizationUrlHost {
  param([Parameter(Mandatory)][string]$HostName)
  $value = $HostName.Trim()
  if ($value.Contains(':') -and -not $value.StartsWith('[')) { return "[$value]" }
  return $value
}

function Get-OptimizationHttpJson {
  param([Parameter(Mandatory)][string]$Url)
  try {
    return Invoke-RestMethod -Uri $Url -UseBasicParsing -TimeoutSec 2
  } catch {
    return $null
  }
}

function Wait-OptimizationHttpJson {
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][int]$TimeoutSeconds,
    [Parameter(Mandatory)][scriptblock]$Predicate
  )
  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $TimeoutSeconds))
  do {
    $payload = Get-OptimizationHttpJson -Url $Url
    if ($null -ne $payload -and (& $Predicate $payload)) { return $payload }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return $null
}

function Test-OptimizationTcpPortOccupied {
  param([Parameter(Mandatory)][int]$Port)
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return $task.Wait(250) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-OptimizationTcpPortFree {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][int]$TimeoutSeconds
  )
  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $TimeoutSeconds))
  do {
    if (-not (Test-OptimizationTcpPortOccupied -Port $Port)) { return $true }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

function Get-OptimizationFreePort {
  param(
    [int]$StartPort = 5200,
    [int]$EndPort = 5299,
    [int[]]$ReservedPorts = @()
  )
  foreach ($port in $StartPort..$EndPort) {
    if ($ReservedPorts -contains $port) { continue }
    if (-not (Test-OptimizationTcpPortOccupied -Port $port)) { return $port }
  }
  throw "No free optimization internal port was found in $StartPort-$EndPort."
}

function Write-OptimizationRuntimeJsonAtomic {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)]$Value
  )
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = "$Path.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
  $backup = "$Path.$PID.$([Guid]::NewGuid().ToString('N')).bak"
  try {
    $serialized = ConvertTo-Json -InputObject $Value -Depth 20
    [IO.File]::WriteAllText($temporary, ($serialized + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      [IO.File]::Replace($temporary, $Path, $backup, $true)
    } else {
      [IO.File]::Move($temporary, $Path)
    }
  } finally {
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  }
}

function Write-OptimizationRuntimeTextAtomic {
  param(
    [Parameter(Mandatory)][string]$Path,
    [AllowNull()][string]$Text
  )
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = "$Path.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
  $backup = "$Path.$PID.$([Guid]::NewGuid().ToString('N')).bak"
  try {
    [IO.File]::WriteAllText($temporary, [string]$Text, [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      [IO.File]::Replace($temporary, $Path, $backup, $true)
    } else {
      [IO.File]::Move($temporary, $Path)
    }
  } finally {
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  }
}

function Restore-OptimizationRuntimeSnapshot {
  param(
    [Parameter(Mandatory)][string]$Path,
    [AllowNull()][string]$Snapshot
  )
  if ($null -ne $Snapshot -and $Snapshot.Length -gt 0) {
    Write-OptimizationRuntimeTextAtomic -Path $Path -Text $Snapshot
  } elseif (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  }
}

function Write-OptimizationActivationJournal {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)]$Journal
  )
  Write-OptimizationRuntimeJsonAtomic -Path $Path -Value $Journal
}

function Read-OptimizationActivationJournal {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  return Read-OptimizationJsonFile -Path $Path
}

function Remove-OptimizationActivationJournal {
  param([Parameter(Mandatory)][string]$Path)
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
  }
}

function Read-OptimizationFrontDoorTarget {
  param([Parameter(Mandatory)][string]$Path)
  try { $value = Read-OptimizationJsonFile -Path $Path } catch { return $null }
  if ($null -eq $value -or (Get-OptimizationObjectText -Object $value -Name 'status') -ne 'active') { return $null }
  $host = Get-OptimizationObjectText -Object $value -Name 'host'
  $portText = Get-OptimizationObjectText -Object $value -Name 'port'
  $port = 0
  $releaseId = Get-OptimizationObjectText -Object $value -Name 'releaseId'
  $profileId = Get-OptimizationObjectText -Object $value -Name 'profileId'
  $instanceId = Get-OptimizationObjectText -Object $value -Name 'instanceId'
  if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535 -or $port -in @(5173, 8765, 5174, 8766, 5184, 8776) -or -not (Test-OptimizationLoopbackHost -HostName $host) -or [string]::IsNullOrWhiteSpace($releaseId) -or [string]::IsNullOrWhiteSpace($profileId) -or [string]::IsNullOrWhiteSpace($instanceId)) {
    return $null
  }
  return [pscustomobject]@{
    status = 'active'
    host = $host
    port = $port
    releaseId = $releaseId
    profileId = $profileId
    instanceId = $instanceId
  }
}

function Write-OptimizationFrontDoorTarget {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$HostName,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$InstanceId
  )
  if (-not (Test-OptimizationLoopbackHost -HostName $HostName)) { throw 'Front door target must be loopback.' }
  if ($Port -lt 1 -or $Port -gt 65535) { throw "Invalid front door target port: $Port" }
  if ($Port -in @(5173, 8765, 5174, 8766, 5184, 8776)) { throw "Front door target may not use a reserved port: $Port" }
  if ([string]::IsNullOrWhiteSpace($ReleaseId) -or [string]::IsNullOrWhiteSpace($ProfileId) -or [string]::IsNullOrWhiteSpace($InstanceId)) {
    throw 'Front door target release, profile, and instance identities are required.'
  }
  Write-OptimizationRuntimeJsonAtomic -Path $Path -Value ([ordered]@{
    schemaVersion = 1
    status = 'active'
    host = $HostName
    port = $Port
    releaseId = $ReleaseId
    profileId = $ProfileId
    instanceId = $InstanceId
    switchedAtUtc = ([DateTime]::UtcNow).ToString('O')
  })
}

function Clear-OptimizationFrontDoorTarget {
  param([Parameter(Mandatory)][string]$Path)
  Write-OptimizationRuntimeJsonAtomic -Path $Path -Value ([ordered]@{
    schemaVersion = 1
    status = 'empty'
    clearedAtUtc = ([DateTime]::UtcNow).ToString('O')
  })
}

function Resolve-OptimizationManagedStatePath {
  param(
    [Parameter(Mandatory)][string]$ActiveStatePath,
    [Parameter(Mandatory)][string]$StateRoot
  )
  $active = Read-OptimizationJsonFile -Path $ActiveStatePath
  $candidate = Get-OptimizationObjectText -Object $active -Name 'managerStatePath'
  if (-not $candidate) { return $ActiveStatePath }
  try {
    $resolvedRoot = (Resolve-Path -LiteralPath $StateRoot).Path.TrimEnd('\', '/')
    $resolvedCandidate = [IO.Path]::GetFullPath($candidate)
    if ($resolvedCandidate.StartsWith("$resolvedRoot\", [StringComparison]::OrdinalIgnoreCase)) {
      return $resolvedCandidate
    }
  } catch {}
  throw "Optimization active state points outside its state root: $ActiveStatePath"
}

function Write-OptimizationActiveHostState {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$ManagerStatePath,
    [Parameter(Mandatory)][string]$ProfileId
  )
  $state = Read-OptimizationJsonFile -Path $ManagerStatePath
  if ($null -eq $state) { throw "Managed production host state is missing: $ManagerStatePath" }
  if ((Get-OptimizationObjectText -Object $state -Name 'profileId') -ne $ProfileId) {
    throw "Managed production host state profile mismatch: $ManagerStatePath"
  }
  $value = [ordered]@{
    schemaVersion = 2
    status = 'active'
    managerStatePath = (Resolve-Path -LiteralPath $ManagerStatePath).Path
    releaseId = Get-OptimizationObjectText -Object $state -Name 'releaseId'
    profileId = Get-OptimizationObjectText -Object $state -Name 'profileId'
    instanceId = Get-OptimizationObjectText -Object $state -Name 'instanceId'
    port = [int](Get-OptimizationObjectText -Object $state -Name 'port')
    pid = [int](Get-OptimizationObjectText -Object $state -Name 'pid')
    processStartUtc = Get-OptimizationObjectText -Object $state -Name 'processStartUtc'
    startedAtUtc = Get-OptimizationObjectText -Object $state -Name 'startedAtUtc'
    activatedAtUtc = ([DateTime]::UtcNow).ToString('O')
  }
  Write-OptimizationRuntimeJsonAtomic -Path $Path -Value $value
}

function Test-OptimizationPairReady {
  param(
    $HostState,
    $CapabilityState,
    $HostHealth,
    $CapabilityHealth,
    $Release,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$TokenPath,
    [string]$ExpectedDataRoot = '',
    [switch]$AllowSharedCapability
  )
  if ($null -eq $Release -or $null -eq $HostState -or $null -eq $CapabilityState -or $null -eq $HostHealth -or $null -eq $CapabilityHealth) { return $false }
  $hostStatus = Get-OptimizationObjectText -Object $HostHealth -Name 'status'
  $capabilityStatus = Get-OptimizationObjectText -Object $CapabilityHealth -Name 'status'
  if ($hostStatus -ne 'ready' -or $capabilityStatus -ne 'ready') { return $false }
  $instanceId = Get-OptimizationObjectText -Object $HostState -Name 'instanceId'
  $hostManifest = Get-OptimizationObjectValue -Object $HostHealth -Name 'manifest'
  if (-not $instanceId -or $null -eq $hostManifest) { return $false }
  $releaseRuntime = Get-OptimizationObjectValue -Object $Release.manifest -Name 'runtime'
  $releasePythonIdentity = Get-OptimizationObjectValue -Object $releaseRuntime -Name 'pythonIdentity'
  $hostRuntimeIdentityMatches = (Get-OptimizationObjectText -Object $hostManifest -Name 'toolchainSha256') -eq $Release.toolchainSha256 `
    -and (Get-OptimizationObjectText -Object $hostManifest -Name 'pythonIdentitySha256') -eq (Get-OptimizationObjectText -Object $releasePythonIdentity -Name 'environmentSha256') `
    -and (Get-OptimizationObjectText -Object $hostManifest -Name 'pythonPackageSetSha256') -eq (Get-OptimizationObjectText -Object $releasePythonIdentity -Name 'packageSetSha256') `
    -and (Get-OptimizationObjectText -Object $hostManifest -Name 'pythonExecutable') -eq (Get-OptimizationObjectText -Object $releasePythonIdentity -Name 'executable')
  if (-not $hostRuntimeIdentityMatches) { return $false }
  $capabilityInstanceId = Get-OptimizationObjectText -Object $CapabilityState -Name 'instanceId'
  $capabilityReleaseId = Get-OptimizationObjectText -Object $CapabilityState -Name 'releaseId'
  if (-not $capabilityInstanceId -or -not $capabilityReleaseId) { return $false }
  $capabilityIdentityMatches = (Get-OptimizationObjectText -Object $CapabilityHealth -Name 'releaseId') -eq $capabilityReleaseId `
    -and (Get-OptimizationObjectText -Object $CapabilityHealth -Name 'profileId') -eq $ProfileId `
    -and (Get-OptimizationObjectText -Object $CapabilityHealth -Name 'instanceId') -eq $capabilityInstanceId
  if (-not $capabilityIdentityMatches) { return $false }
  $reportedDataRoot = Get-OptimizationObjectText -Object $HostHealth -Name 'dataRoot'
  $dataRootMatches = (-not $ExpectedDataRoot) -or ($reportedDataRoot -and (Normalize-OptimizationPath -Value $reportedDataRoot) -eq (Normalize-OptimizationPath -Value $ExpectedDataRoot))
  return $dataRootMatches `
    -and (Get-OptimizationObjectText -Object $HostState -Name 'profileId') -eq $ProfileId `
    -and (Get-OptimizationObjectText -Object $CapabilityState -Name 'profileId') -eq $ProfileId `
    -and (Get-OptimizationObjectText -Object $HostState -Name 'releaseId') -eq $Release.releaseId `
    -and (Get-OptimizationObjectText -Object $HostHealth -Name 'releaseId') -eq $Release.releaseId `
    -and (Get-OptimizationObjectText -Object $HostHealth -Name 'profileId') -eq $ProfileId `
    -and (Get-OptimizationObjectText -Object $HostHealth -Name 'instanceId') -eq $instanceId `
    -and (Get-OptimizationObjectText -Object $hostManifest -Name 'sha256') -eq $Release.manifestSha256 `
    -and [bool](Get-OptimizationObjectValue -Object $HostHealth -Name 'distReady') `
    -and ($AllowSharedCapability -or ($capabilityReleaseId -eq $Release.releaseId -and $capabilityInstanceId -eq $instanceId)) `
    -and (Test-Path -LiteralPath $TokenPath -PathType Leaf)
}

function New-OptimizationInstanceToken {
  $bytes = [byte[]]::new(32)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return ([Convert]::ToBase64String($bytes) -replace '\+', '-' -replace '/', '_' -replace '=+$', '')
}

function Stop-OptimizationOwnedState {
  param(
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][string]$ProfileId
  )
  $state = Read-OptimizationJsonFile -Path $StatePath
  if ($null -eq $state) { return $false }
  if ((Get-OptimizationObjectText -Object $state -Name 'profileId') -ne $ProfileId) {
    throw "Launcher state profile mismatch at $StatePath; refusing to stop it."
  }
  $instanceId = Get-OptimizationObjectText -Object $state -Name 'instanceId'
  if (-not $instanceId) { throw "Launcher state has no instance identity at $StatePath; refusing to stop it." }
  try {
    return Stop-OwnedRuntimeInstance `
      -StatePath $StatePath `
      -ExpectedProfileId $ProfileId `
      -ExpectedInstanceId $instanceId `
      -StopTimeoutSeconds 5
  } catch {
    if ($_.Exception.Message -match 'PID/start identity mismatch') {
      Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
      return $false
    }
    throw
  }
}

function Invoke-OptimizationHostDrain {
  param(
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][string]$TokenPath,
    [int]$DeadlineSeconds = 10
  )
  $state = Read-OptimizationJsonFile -Path $StatePath
  if ($null -eq $state) { return [pscustomobject]@{ status = 'absent'; drained = $true; forced = $false; inflight = 0 } }
  $port = 0
  if (-not [int]::TryParse((Get-OptimizationObjectText -Object $state -Name 'port'), [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw "Cannot drain optimization host with an invalid port: $StatePath"
  }
  if (-not (Test-Path -LiteralPath $TokenPath -PathType Leaf)) { throw "Cannot drain optimization host without a service token: $TokenPath" }
  $token = (Read-OptimizationRuntimeText -Path $TokenPath).Trim()
  if (-not $token) { throw "Cannot drain optimization host with an empty service token: $TokenPath" }
  $baseUrl = "http://127.0.0.1:$port"
  $headers = @{ 'x-read-web-token' = $token }
  try {
    Invoke-RestMethod -Method Post -Uri "$baseUrl/api/app/drain" -Headers $headers -TimeoutSec 2 | Out-Null
  } catch {
    throw "Optimization host did not accept graceful drain on port ${port}: $($_.Exception.Message)"
  }
  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $DeadlineSeconds))
  do {
    $health = Get-OptimizationHttpJson -Url "$baseUrl/api/app/health"
    $inflight = 0
    $inflightText = Get-OptimizationObjectText -Object $health -Name 'inflightRequests'
    [int]::TryParse($inflightText, [ref]$inflight) | Out-Null
    $accepting = Get-OptimizationObjectValue -Object $health -Name 'acceptingRequests'
    if ($null -ne $health -and $accepting -eq $false -and $inflight -eq 0) {
      return [pscustomobject]@{ status = 'drained'; drained = $true; forced = $false; inflight = 0 }
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  return [pscustomobject]@{ status = 'deadline'; drained = $false; forced = $true; inflight = $inflight }
}

function Initialize-OptimizationApplicationProfile {
  param(
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$ApplicationIsolationRoot,
    [Parameter(Mandatory)][string]$ApplicationProfileDir
  )
  $initializer = Join-Path $ProjectRoot 'scripts\initialize-optimization-application-profile.mjs'
  if (-not (Test-Path -LiteralPath $initializer -PathType Leaf)) {
    throw "Optimization application profile initializer is missing: $initializer"
  }
  $output = & $NodePath $initializer `
    '--isolation-root' $ApplicationIsolationRoot `
    '--profile-dir' $ApplicationProfileDir 2>&1
  $exitCode = $LASTEXITCODE
  $outputText = ($output -join "`n").Trim()
  if ($exitCode -ne 0) {
    throw "Optimization application profile initialization failed with exit code ${exitCode}: $outputText"
  }
  try {
    $result = $outputText | ConvertFrom-Json
  } catch {
    throw "Optimization application profile initializer returned invalid JSON: $outputText"
  }
  if ($null -eq $result -or [int]$result.schemaVersion -ne 1 -or [string]$result.status -notin @('existing', 'initialized-empty-candidate')) {
    throw 'Optimization application profile initializer returned an invalid result.'
  }
  if ([IO.Path]::GetFullPath([string]$result.profilePath) -ne [IO.Path]::GetFullPath((Join-Path $ApplicationProfileDir 'browser-profile.json'))) {
    throw 'Optimization application profile initializer returned an unexpected profile path.'
  }
  return $result
}

function Start-OptimizationOwnedPair {
  param(
    [Parameter(Mandatory)]$Release,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$InstanceId,
    [Parameter(Mandatory)][string]$ServiceToken,
    [Parameter(Mandatory)][string]$FrontendHost,
    [Parameter(Mandatory)][int]$FrontendPort,
    [Parameter(Mandatory)][string]$BackendHost,
    [Parameter(Mandatory)][int]$BackendPort,
    [Parameter(Mandatory)][string]$PythonPath,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$CapabilityScript,
    [Parameter(Mandatory)][string]$WorkflowRoot,
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$ApplicationIsolationRoot,
    [Parameter(Mandatory)][string]$ApplicationProfileDir,
    [Parameter(Mandatory)][string]$ApplicationPythonStateDir,
    [Parameter(Mandatory)][string]$ApplicationPythonOutputDir,
    [Parameter(Mandatory)][string]$HostStatePath,
    [Parameter(Mandatory)][string]$CapabilityStatePath,
    [Parameter(Mandatory)][string]$LogRoot,
    [Parameter(Mandatory)][string]$HostHealthUrl,
    [Parameter(Mandatory)][string]$WorkflowHealthUrl,
    [Parameter(Mandatory)][string]$CapabilityHealthUrl,
    [Parameter(Mandatory)][string]$CapabilityBaseUrl,
    [Parameter(Mandatory)][int]$StartupTimeoutSeconds,
    [Parameter(Mandatory)][int[]]$ReservedPorts,
    [string]$ExpectedDataRoot = ''
  )
  $capabilityStarted = $false
  $hostStarted = $false
  try {
    Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_RELEASE_ID' -Value ([string]$Release.releaseId)
    Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_PROFILE_ID' -Value $ProfileId
    Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_INSTANCE_ID' -Value $InstanceId
    Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_SERVICE_TOKEN' -Value $ServiceToken
    Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_ALLOWED_ORIGIN' -Value "http://$(Format-OptimizationUrlHost -HostName $FrontendHost):$FrontendPort"
    Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_CAPABILITY_HOST' -Value $BackendHost
    Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_CAPABILITY_PORT' -Value ([string]$BackendPort)

    # A brand-new optimization instance owns an empty Host-candidate profile
    # only so the 2.2 profile evidence path can start.  The Node helper
    # validates the isolation boundary and refuses to replace any existing
    # candidate state before the capability or production Host is started.
    $profileInitialization = Initialize-OptimizationApplicationProfile `
      -NodePath $NodePath `
      -ProjectRoot $ProjectRoot `
      -ApplicationIsolationRoot $ApplicationIsolationRoot `
      -ApplicationProfileDir $ApplicationProfileDir
    $profileMode = if ([string]$profileInitialization.status -eq 'initialized-empty-candidate') {
      'empty-host-candidate'
    } else {
      'existing-candidate'
    }
    Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_APPLICATION_PROFILE_MODE' -Value $profileMode

    $existingCapabilityState = Read-OptimizationJsonFile -Path $CapabilityStatePath
    $existingCapabilityHealth = Get-OptimizationHttpJson -Url $CapabilityHealthUrl
    if ([string]$env:READ_WEB_OPTIMIZATION_TEST_FAILURE -eq 'capability') {
      throw 'Synthetic capability start failure.'
    }
    $capabilityReusable = $null -ne $existingCapabilityState `
      -and (Get-OptimizationObjectText -Object $existingCapabilityState -Name 'profileId') -eq $ProfileId `
      -and [int](Get-OptimizationObjectText -Object $existingCapabilityState -Name 'port') -eq $BackendPort `
      -and (Get-OptimizationObjectText -Object $existingCapabilityState -Name 'instanceId') `
      -and (Get-OptimizationObjectText -Object $existingCapabilityHealth -Name 'status') -eq 'ready' `
      -and (Get-OptimizationObjectText -Object $existingCapabilityHealth -Name 'releaseId') -eq (Get-OptimizationObjectText -Object $existingCapabilityState -Name 'releaseId') `
      -and (Get-OptimizationObjectText -Object $existingCapabilityHealth -Name 'profileId') -eq $ProfileId `
      -and (Get-OptimizationObjectText -Object $existingCapabilityHealth -Name 'instanceId') -eq (Get-OptimizationObjectText -Object $existingCapabilityState -Name 'instanceId')
    if ($capabilityReusable) {
      $capabilityResult = Start-ManagedRuntimeInstance `
        -ReleaseId (Get-OptimizationObjectText -Object $existingCapabilityState -Name 'releaseId') `
        -ProfileId $ProfileId `
        -InstanceId (Get-OptimizationObjectText -Object $existingCapabilityState -Name 'instanceId') `
        -Port $BackendPort `
        -HealthUrl $CapabilityHealthUrl `
        -StatePath $CapabilityStatePath `
        -FilePath $NodePath `
        -ArgumentList @($CapabilityScript, '--port', '{port}') `
        -WorkingDirectory $ProjectRoot `
        -ReadyTimeoutSeconds $StartupTimeoutSeconds `
        -ReservedDailyPorts $ReservedPorts `
        -StandardOutputPath (Join-Path $LogRoot 'read-web-capability-host.out.log') `
        -StandardErrorPath (Join-Path $LogRoot 'read-web-capability-host.err.log') `
        -Metadata @{ runtimeRole = 'capability-host' }
    } else {
      $capabilityResult = Start-ManagedRuntimeInstance `
        -ReleaseId ([string]$Release.releaseId) `
        -ProfileId $ProfileId `
        -InstanceId $InstanceId `
        -Port $BackendPort `
        -HealthUrl $CapabilityHealthUrl `
        -StatePath $CapabilityStatePath `
        -FilePath $NodePath `
        -ArgumentList @($CapabilityScript, '--port', '{port}') `
        -WorkingDirectory $ProjectRoot `
        -ReadyTimeoutSeconds $StartupTimeoutSeconds `
        -ReservedDailyPorts $ReservedPorts `
        -StandardOutputPath (Join-Path $LogRoot 'read-web-capability-host.out.log') `
        -StandardErrorPath (Join-Path $LogRoot 'read-web-capability-host.err.log') `
        -Metadata @{ runtimeRole = 'capability-host' }
      if ([string]$capabilityResult.status -ne 'started' -or [string]$capabilityResult.instanceId -ne $InstanceId) {
        throw 'Capability host was not started as the new owned instance.'
      }
      $capabilityStarted = $true
    }

    $hostResult = Start-ManagedRuntimeInstance `
      -ReleaseId ([string]$Release.releaseId) `
      -ProfileId $ProfileId `
      -InstanceId $InstanceId `
      -Port $FrontendPort `
      -HealthUrl $HostHealthUrl `
      -StatePath $HostStatePath `
      -FilePath $PythonPath `
      -ArgumentList @(
        '-m', 'youtube_workflow.production_host_prototype',
        '--dist', $Release.distRoot,
        '--host', $FrontendHost,
        '--port', '{port}',
        '--release-id', '{releaseId}',
        '--profile-id', '{profileId}',
        '--instance-id', '{instanceId}',
        '--release-manifest', $Release.manifestPath,
        '--config-schema-version', [string]$Release.manifest.configuration.schemaVersion,
        '--capability-base-url', $CapabilityBaseUrl,
        '--application-isolation-root', $ApplicationIsolationRoot,
        '--application-profile-dir', $ApplicationProfileDir,
        '--application-python-state-dir', $ApplicationPythonStateDir,
        '--application-python-output-dir', $ApplicationPythonOutputDir
      ) `
      -WorkingDirectory $WorkflowRoot `
      -ReadyTimeoutSeconds $StartupTimeoutSeconds `
      -ReservedDailyPorts $ReservedPorts `
      -StandardOutputPath (Join-Path $LogRoot 'read-web-production-host.out.log') `
      -StandardErrorPath (Join-Path $LogRoot 'read-web-production-host.err.log') `
      -Metadata @{
        runtimeRole = 'production-host'
        applicationIsolationRoot = $ApplicationIsolationRoot
        applicationProfileDir = $ApplicationProfileDir
        applicationPythonStateDir = $ApplicationPythonStateDir
        applicationPythonOutputDir = $ApplicationPythonOutputDir
      }
    if ([string]$hostResult.status -ne 'started' -or [string]$hostResult.instanceId -ne $InstanceId) {
      throw 'Production host was not started as the new owned instance.'
    }
    $hostStarted = $true
    if ([string]$env:READ_WEB_OPTIMIZATION_TEST_FAILURE -eq 'host') {
      throw 'Synthetic production host readiness failure.'
    }

    $hostHealth = Wait-OptimizationHttpJson -Url $HostHealthUrl -TimeoutSeconds $StartupTimeoutSeconds -Predicate {
      param($value)
      if ($null -eq $value -or (Get-OptimizationObjectText -Object $value -Name 'status') -ne 'ready') { return $false }
      $manifest = Get-OptimizationObjectValue -Object $value -Name 'manifest'
      if ($null -eq $manifest) { return $false }
      return (Get-OptimizationObjectText -Object $value -Name 'releaseId') -eq ([string]$Release.releaseId) `
        -and (Get-OptimizationObjectText -Object $value -Name 'profileId') -eq $ProfileId `
        -and (Get-OptimizationObjectText -Object $value -Name 'instanceId') -eq $InstanceId `
        -and (Get-OptimizationObjectText -Object $manifest -Name 'sha256') -eq ([string]$Release.manifestSha256) `
        -and [bool](Get-OptimizationObjectValue -Object $value -Name 'distReady')
    }
    if ($null -eq $hostHealth) { throw "Production host did not pass readiness. See logs under $LogRoot." }
    if ([string]$env:READ_WEB_OPTIMIZATION_TEST_FAILURE -eq 'readiness') {
      throw 'Synthetic post-readiness failure.'
    }

    $workflowHealth = Wait-OptimizationHttpJson -Url $WorkflowHealthUrl -TimeoutSeconds $StartupTimeoutSeconds -Predicate {
      param($value)
      (Get-OptimizationObjectText -Object $value -Name 'service') -eq 'subtitle-workflow' `
        -and ((-not $ExpectedDataRoot) -or (Get-OptimizationObjectText -Object $value -Name 'dataRoot') -eq $ExpectedDataRoot) `
        -and (Get-OptimizationObjectText -Object $value -Name 'status') -eq 'ok'
    }
    if ($null -eq $workflowHealth) { throw "Workflow readiness did not pass through the Local App Host. See logs under $LogRoot." }

    $capabilities = Wait-OptimizationHttpJson -Url $HostHealthUrl.Replace('/api/app/health', '/api/app/capabilities') -TimeoutSeconds $StartupTimeoutSeconds -Predicate {
      param($value)
      (Get-OptimizationObjectText -Object $value -Name 'status') -eq 'ok' `
        -and @((Get-OptimizationObjectValue -Object $value -Name 'endpoints')).Count -eq 9
    }
    if ($null -eq $capabilities) { throw "Local capability readiness did not pass through the Local App Host. See logs under $LogRoot." }

    $indexResponse = Invoke-WebRequest -Uri "http://$(Format-OptimizationUrlHost -HostName $FrontendHost):$FrontendPort/" -UseBasicParsing -TimeoutSec 2
    if ($indexResponse.StatusCode -ne 200 -or $indexResponse.Content -match '@vite/client|src/main\.js') {
      throw 'Built dist index validation failed.'
    }
    return [pscustomobject]@{ host = $hostResult; capability = $capabilityResult; health = $hostHealth }
  } catch {
    if ($hostStarted) { Stop-OptimizationOwnedState -StatePath $HostStatePath -ProfileId $ProfileId | Out-Null }
    if ($capabilityStarted) { Stop-OptimizationOwnedState -StatePath $CapabilityStatePath -ProfileId $ProfileId | Out-Null }
    throw
  }
}

Export-ModuleMember -Function `
  Set-OptimizationProcessEnvironmentValue, `
  Restore-OptimizationProcessEnvironment, `
  Resolve-OptimizationExecutablePath, `
  Resolve-OptimizationExistingPath, `
  Read-OptimizationJsonFile, `
  Read-OptimizationRuntimeText, `
  Get-OptimizationObjectValue, `
  Get-OptimizationObjectText, `
  Normalize-OptimizationPath, `
  Test-OptimizationLoopbackHost, `
  Format-OptimizationUrlHost, `
  Get-OptimizationHttpJson, `
  Wait-OptimizationHttpJson, `
  Test-OptimizationTcpPortOccupied, `
  Wait-OptimizationTcpPortFree, `
  Get-OptimizationFreePort, `
  New-OptimizationInstanceToken, `
  Write-OptimizationRuntimeJsonAtomic, `
  Write-OptimizationRuntimeTextAtomic, `
  Restore-OptimizationRuntimeSnapshot, `
  Write-OptimizationActivationJournal, `
  Read-OptimizationActivationJournal, `
  Remove-OptimizationActivationJournal, `
  Read-OptimizationFrontDoorTarget, `
  Write-OptimizationFrontDoorTarget, `
  Clear-OptimizationFrontDoorTarget, `
  Resolve-OptimizationManagedStatePath, `
  Write-OptimizationActiveHostState, `
  Test-OptimizationPairReady, `
  Invoke-OptimizationHostDrain, `
  Initialize-OptimizationApplicationProfile, `
  Stop-OptimizationOwnedState, `
  Start-OptimizationOwnedPair

param(
  [switch]$NoOpen,
  [switch]$Stop,
  [switch]$DevFallback,
  [string]$BootstrapPython = '',
  [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'launcher-instance-manager.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'optimization-launch-runtime.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'optimization-release.psm1') -Force -DisableNameChecking

$projectRoot = Split-Path -Parent $PSScriptRoot
$workflowRoot = Join-Path $projectRoot 'tools\subtitle-workflow'
$runtimeConfigPath = Join-Path $projectRoot 'config\runtime.optimization.json'
$defaultOptimizationDataRoot = 'E:\ReadWebData\SubtitleWorkflow-Optimization'
$profileId = 'optimization'
$stateRoot = Join-Path $projectRoot ".codex\runtime-state\$profileId"
$hostStatePath = Join-Path $stateRoot 'production-host.json'
$capabilityStatePath = Join-Path $stateRoot 'capability-host.json'
$frontDoorStatePath = Join-Path $stateRoot 'front-door.json'
$activeReleasePath = Join-Path $stateRoot 'active-release.json'
$frontDoorTargetPath = Join-Path $stateRoot 'front-door-target.json'
$frontDoorCommittedTargetPath = Join-Path $stateRoot 'front-door-committed-target.json'
$activationJournalPath = Join-Path $stateRoot 'activation-journal.json'
$tokenPath = Join-Path $stateRoot 'production-host.token'
$frontDoorExecutableRoot = Join-Path $stateRoot 'front-door-releases'
$releaseRoot = Join-Path $projectRoot ".codex\releases\$profileId"
$stagingRoot = Join-Path $projectRoot ".codex\release-staging\$profileId"
$logRoot = Join-Path $projectRoot '.codex\startup-logs'
$capabilityScript = Join-Path $projectRoot 'tools\local-capability-host.mjs'
$frontDoorScript = Join-Path $projectRoot 'tools\optimization-stable-front-door.mjs'
$backupScript = Join-Path $projectRoot 'scripts\lib\read-web-production-backup.mjs'
$releaseHealthScript = Join-Path $projectRoot 'scripts\release-health-check.mjs'
$fixedFrontendPort = 5184
$fixedBackendPort = 8776
$frontendHost = '127.0.0.1'
$backendHost = '127.0.0.1'
$frontDoorReleaseId = 'read-web-optimization-front-door-v1'
$frontDoorInstanceId = 'optimization-front-door'
$reservedDailyPorts = @(5173, 8765, 5174, 8766)
$reservedOptimizationPorts = @($reservedDailyPorts + $fixedFrontendPort + $fixedBackendPort)
$environmentNames = @(
  'READ_WEB_RUNTIME_CONFIG',
  'READ_WEB_SUBTITLE_DATA_ROOT',
  'READ_WEB_FRONTEND_HOST',
  'READ_WEB_FRONTEND_PORT',
  'READ_WEB_BACKEND_HOST',
  'READ_WEB_BACKEND_PORT',
  'READ_WEB_PYTHON_PATH',
  'READ_WEB_PYTHON',
  'READ_WEB_RELEASE_ID',
  'READ_WEB_PROFILE_ID',
  'READ_WEB_INSTANCE_ID',
  'READ_WEB_SERVICE_TOKEN',
  'READ_WEB_ALLOWED_ORIGIN',
  'READ_WEB_CAPABILITY_HOST',
  'READ_WEB_CAPABILITY_PORT',
  'READ_WEB_APPLICATION_PROFILE_MODE',
  'READ_WEB_PROXY_URL',
  'YOUTUBE_COOKIES_PATH',
  'YT_DLP_PATH',
  'WHISPERX_PATH',
  'FFMPEG_PATH',
  'GEMINI_MODEL',
  'GEMINI_BASE_URL',
  'VITE_LOCAL_SERVICE_BASE_URL',
  'VITE_READ_WEB_SERVICE_TOKEN',
  'ECDICT_ENABLED',
  'ECDICT_DATABASE_PATH',
  'LOCAL_SENTENCE_DATABASE_PATH',
  'SENTENCE_TRANSLATION_CACHE_PATH',
  'IELTS_READING_VOCABULARY_CANDIDATES_PATH'
)
$environmentSnapshot = [ordered]@{}
foreach ($name in $environmentNames) {
  $environmentSnapshot[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Read-LegacyOptimizationRelease {
  param(
    $Health,
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$DistRoot,
    [Parameter(Mandatory)][string]$ReleaseRoot
  )
  if ($null -eq $Health -or -not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { return $null }
  try {
    $manifest = Read-OptimizationJsonFile -Path $ManifestPath
    $manifestHash = Get-OptimizationFileSha256 -Path $ManifestPath
    return [pscustomobject]@{
      releaseId = Get-OptimizationObjectText -Object $Health -Name 'releaseId'
      releaseRoot = $ReleaseRoot
      distRoot = $DistRoot
      manifestPath = $ManifestPath
      manifestSha256 = $manifestHash
      sourceSha256 = [string]$manifest.runtime.sourceSha256
      distSha256 = [string]$manifest.runtime.distSha256
      manifest = $manifest
    }
  } catch {
    return $null
  }
}

function Get-ManagedHostStatePath {
  return Resolve-OptimizationManagedStatePath -ActiveStatePath $hostStatePath -StateRoot $stateRoot
}

function Get-HostHealthUrl {
  param($State, [int]$FallbackPort = 0)
  $portText = Get-OptimizationObjectText -Object $State -Name 'port'
  $port = 0
  if (-not [int]::TryParse($portText, [ref]$port)) { $port = $FallbackPort }
  if ($port -lt 1 -or $port -gt 65535) { return '' }
  return "http://127.0.0.1:$port/api/app/health"
}

function Get-OptimizationHostRestartSpec {
  param(
    [Parameter(Mandatory)]$State,
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][int]$ReadyTimeoutSeconds
  )
  if ($null -eq $State) { return $null }
  $requiredFields = @('releaseId', 'profileId', 'instanceId', 'port', 'healthUrl', 'filePath', 'workingDirectory')
  foreach ($field in $requiredFields) {
    if ([string]::IsNullOrWhiteSpace((Get-OptimizationObjectText -Object $State -Name $field))) { return $null }
  }
  $authorityRoot = Get-OptimizationObjectText -Object $State -Name 'applicationProfileAuthorityRoot'
  $authorityIsolationRoot = Get-OptimizationObjectText -Object $State -Name 'applicationProfileAuthorityIsolationRoot'
  if (-not $authorityRoot -or -not $authorityIsolationRoot) { return $null }
  $rawArguments = @((Get-OptimizationObjectValue -Object $State -Name 'argumentList') | ForEach-Object { [string]$_ })
  if ($rawArguments.Count -eq 0) { return $null }
  $arguments = @()
  $modePresent = $false
  for ($index = 0; $index -lt $rawArguments.Count; $index++) {
    $argument = $rawArguments[$index]
    if ($argument -eq '--application-profile-lease-mode') {
      $arguments += @('--application-profile-lease-mode', 'authoritative')
      $modePresent = $true
      if ($index + 1 -lt $rawArguments.Count) { $index++ }
      continue
    }
    if ($argument -eq '--allow-standby-readiness') { continue }
    $arguments += $argument
  }
  if (-not $modePresent) { $arguments += @('--application-profile-lease-mode', 'authoritative') }
  $metadata = @{
    runtimeRole = 'production-host'
    applicationProfileAuthorityRoot = $authorityRoot
    applicationProfileAuthorityIsolationRoot = $authorityIsolationRoot
    applicationProfileLeaseMode = 'authoritative'
    standbyPreflight = $false
  }
  foreach ($metadataName in @(
      'applicationIsolationRoot', 'applicationProfileDir',
      'applicationPythonStateDir', 'applicationPythonOutputDir'
    )) {
    $metadataValue = Get-OptimizationObjectText -Object $State -Name $metadataName
    if ($metadataValue) { $metadata[$metadataName] = $metadataValue }
  }
  return @{
    ReleaseId = Get-OptimizationObjectText -Object $State -Name 'releaseId'
    ProfileId = Get-OptimizationObjectText -Object $State -Name 'profileId'
    InstanceId = Get-OptimizationObjectText -Object $State -Name 'instanceId'
    Port = [int](Get-OptimizationObjectText -Object $State -Name 'port')
    HealthUrl = Get-OptimizationObjectText -Object $State -Name 'healthUrl'
    StatePath = $StatePath
    FilePath = Get-OptimizationObjectText -Object $State -Name 'filePath'
    ArgumentList = $arguments
    WorkingDirectory = Get-OptimizationObjectText -Object $State -Name 'workingDirectory'
    ReadyTimeoutSeconds = [Math]::Max(1, $ReadyTimeoutSeconds)
    ReservedDailyPorts = $reservedDailyPorts
    StandardOutputPath = Get-OptimizationObjectText -Object $State -Name 'standardOutputPath'
    StandardErrorPath = Get-OptimizationObjectText -Object $State -Name 'standardErrorPath'
    ExecutableIdentity = Get-OptimizationObjectText -Object $State -Name 'executableIdentity'
    Metadata = $metadata
    LaunchIntentPath = "$StatePath.intent.json"
  }
}

function Start-OptimizationHostFromSnapshot {
  param(
    [Parameter(Mandatory)]$State,
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][int]$ReadyTimeoutSeconds
  )
  $spec = Get-OptimizationHostRestartSpec -State $State -StatePath $StatePath -ReadyTimeoutSeconds $ReadyTimeoutSeconds
  if ($null -eq $spec) {
    throw 'Previous optimization Host has no stable profile authority restart receipt; refusing rollback.'
  }
  Start-ManagedRuntimeInstance @spec | Out-Null
  $health = Wait-OptimizationHttpJson -Url $spec.HealthUrl -TimeoutSeconds $ReadyTimeoutSeconds -Predicate {
    param($value)
    (Get-OptimizationObjectText -Object $value -Name 'status') -eq 'ready' `
      -and (Get-OptimizationObjectText -Object $value -Name 'profileLeaseMode') -eq 'authoritative' `
      -and [bool](Get-OptimizationObjectValue -Object $value -Name 'profileLeaseReady') `
      -and [bool](Get-OptimizationObjectValue -Object $value -Name 'profileLeaseAlive') `
      -and (Get-OptimizationObjectText -Object $value -Name 'profileId') -eq $spec.ProfileId `
      -and (Get-OptimizationObjectText -Object $value -Name 'instanceId') -eq $spec.InstanceId
  }
  if ($null -eq $health) { throw 'Previous optimization Host restarted without authoritative profile readiness.' }
  return $health
}

function Get-HostWorkflowHealthUrl {
  param([Parameter(Mandatory)][string]$HostHealthUrl)
  return $HostHealthUrl.Replace('/api/app/health', '/api/health')
}

function Restore-JsonSnapshot {
  param(
    [Parameter(Mandatory)][string]$Path,
    [AllowNull()][string]$Snapshot
  )
  Restore-OptimizationRuntimeSnapshot -Path $Path -Snapshot $Snapshot
}

function Set-OptimizationActivationJournal {
  param(
    [Parameter(Mandatory)]$Journal,
    [Parameter(Mandatory)][string]$Status,
    [Parameter(Mandatory)][string]$Phase
  )
  $Journal.status = $Status
  $Journal.phase = $Phase
  $Journal.updatedAtUtc = ([DateTime]::UtcNow).ToString('O')
  Write-OptimizationActivationJournal -Path $activationJournalPath -Journal $Journal
}

function Invoke-OptimizationCrashPoint {
  param([Parameter(Mandatory)][string]$Phase)
  if ([string]$env:READ_WEB_OPTIMIZATION_TEST_KILL_PHASE -ne $Phase) { return }
  Write-Host "Synthetic launcher process termination at activation boundary: $Phase"
  try { Stop-Process -Id $PID -Force -ErrorAction Stop } catch {}
  throw "Synthetic launcher crash point did not terminate the process: $Phase"
}

function Get-OptimizationFrontDoorExecutablePath {
  param([Parameter(Mandatory)][string]$Identity)
  New-Item -ItemType Directory -Force -Path $frontDoorExecutableRoot | Out-Null
  $snapshotPath = Join-Path $frontDoorExecutableRoot "optimization-stable-front-door-$Identity.mjs"
  if (Test-Path -LiteralPath $snapshotPath -PathType Leaf) {
    if ((Get-OptimizationFileSha256 -Path $snapshotPath) -ne $Identity) {
      throw "Stable front door executable snapshot checksum mismatch: $snapshotPath"
    }
    return $snapshotPath
  }
  $temporaryPath = "$snapshotPath.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::Copy($frontDoorScript, $temporaryPath, $false)
    Move-Item -LiteralPath $temporaryPath -Destination $snapshotPath -Force
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue }
  }
  if ((Get-OptimizationFileSha256 -Path $snapshotPath) -ne $Identity) {
    throw "Stable front door executable snapshot checksum mismatch after publish: $snapshotPath"
  }
  return $snapshotPath
}

function Remove-OptimizationApplicationIsolation {
  param(
    [Parameter(Mandatory)][string]$Root,
    [AllowNull()][string]$Path
  )
  if (-not $Path) { return $true }
  try {
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $resolvedPath = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    if ($resolvedPath -ne $resolvedRoot -and $resolvedPath.StartsWith("$resolvedRoot\", [StringComparison]::OrdinalIgnoreCase)) {
      $cleanupPaths = @($resolvedPath, "$resolvedPath.read-web-path.lock")
      # The Node profile-lock holder observes the Python Host stdin pipe.  On
      # Windows a parent termination closes that pipe asynchronously, so give
      # the holder a bounded grace period before declaring the lease stuck.
      for ($attempt = 0; $attempt -lt 50; $attempt++) {
        foreach ($cleanupPath in $cleanupPaths) {
          if (Test-Path -LiteralPath $cleanupPath) {
            try { Remove-Item -LiteralPath $cleanupPath -Recurse -Force -ErrorAction Stop } catch {}
          }
        }
        if (@($cleanupPaths | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 100
      }
      return $false
    }
    return $true
  } catch { return $false }
}

function Wait-OptimizationProfileAuthorityLeaseFree {
  param(
    [Parameter(Mandatory)][string]$AuthorityRoot,
    [int]$TimeoutSeconds = 5
  )
  try {
    $resolvedAuthorityRoot = [IO.Path]::GetFullPath($AuthorityRoot).TrimEnd('\', '/')
    if (-not $resolvedAuthorityRoot) { return $false }
    $lockPath = "$resolvedAuthorityRoot.read-web-path.lock"
    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $TimeoutSeconds))
    do {
      if (-not (Test-Path -LiteralPath $lockPath)) { return $true }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    return -not (Test-Path -LiteralPath $lockPath)
  } catch { return $false }
}

function Test-OptimizationActivationPairReady {
  param([Parameter(Mandatory)]$Journal)
  try {
    $newReleaseRoot = Get-OptimizationObjectText -Object $Journal -Name 'newReleaseRoot'
    $newHostStatePath = Get-OptimizationObjectText -Object $Journal -Name 'newHostManagerStatePath'
    $newInstanceId = Get-OptimizationObjectText -Object $Journal -Name 'newInstanceId'
    if (-not $newReleaseRoot -or -not $newHostStatePath -or -not $newInstanceId) { return $false }
    $release = Get-OptimizationReleaseDescriptor -ReleaseRoot $newReleaseRoot
    $hostState = Read-OptimizationJsonFile -Path $newHostStatePath
    $capabilityState = Read-OptimizationJsonFile -Path $capabilityStatePath
    if ($null -eq $hostState -or $null -eq $capabilityState) { return $false }
    $hostHealthUrl = Get-HostHealthUrl -State $hostState
    $hostHealth = Wait-OptimizationHttpJson -Url $hostHealthUrl -TimeoutSeconds 10 -Predicate {
      param($value)
      $manifest = Get-OptimizationObjectValue -Object $value -Name 'manifest'
      (Get-OptimizationObjectText -Object $value -Name 'status') -eq 'ready' `
        -and (Get-OptimizationObjectText -Object $value -Name 'profileLeaseMode') -eq 'authoritative' `
        -and [bool](Get-OptimizationObjectValue -Object $value -Name 'profileLeaseReady') `
        -and [bool](Get-OptimizationObjectValue -Object $value -Name 'profileLeaseAlive') `
        -and (Get-OptimizationObjectText -Object $value -Name 'releaseId') -eq [string]$release.releaseId `
        -and (Get-OptimizationObjectText -Object $value -Name 'profileId') -eq $profileId `
        -and (Get-OptimizationObjectText -Object $value -Name 'instanceId') -eq $newInstanceId `
        -and (Get-OptimizationObjectText -Object $manifest -Name 'sha256') -eq [string]$release.manifestSha256 `
        -and [bool](Get-OptimizationObjectValue -Object $value -Name 'distReady')
    }
    $capabilityHealth = Wait-OptimizationHttpJson -Url "http://127.0.0.1:$fixedBackendPort/api/app/health" -TimeoutSeconds 10 -Predicate {
      param($value)
      (Get-OptimizationObjectText -Object $value -Name 'status') -eq 'ready' `
        -and (Get-OptimizationObjectText -Object $value -Name 'releaseId') -eq (Get-OptimizationObjectText -Object $capabilityState -Name 'releaseId') `
        -and (Get-OptimizationObjectText -Object $value -Name 'profileId') -eq $profileId `
        -and (Get-OptimizationObjectText -Object $value -Name 'instanceId') -eq (Get-OptimizationObjectText -Object $capabilityState -Name 'instanceId')
    }
    $workflowHealth = Wait-OptimizationHttpJson -Url (Get-HostWorkflowHealthUrl -HostHealthUrl $hostHealthUrl) -TimeoutSeconds 10 -Predicate {
      param($value)
      (Get-OptimizationObjectText -Object $value -Name 'service') -eq 'subtitle-workflow' `
        -and (Get-OptimizationObjectText -Object $value -Name 'status') -eq 'ok' `
        -and (Get-OptimizationObjectText -Object $value -Name 'dataRoot') -eq $defaultOptimizationDataRoot
    }
    if ($null -eq $workflowHealth -or [string]$workflowHealth.dataRoot -ne $defaultOptimizationDataRoot) {
      return $false
    }
    $pairReady = Test-OptimizationPairReady `
        -HostState $hostState `
        -CapabilityState $capabilityState `
        -HostHealth $hostHealth `
        -CapabilityHealth $capabilityHealth `
        -Release $release `
        -ProfileId $profileId `
        -TokenPath $tokenPath `
        -ExpectedDataRoot $defaultOptimizationDataRoot `
        -AllowSharedCapability
    if (-not $pairReady) {
      return $false
    }
    $target = Read-OptimizationFrontDoorTarget -Path $frontDoorTargetPath
    $activeRelease = Read-OptimizationActiveRelease -Path $activeReleasePath
    $activeHost = Read-OptimizationJsonFile -Path $hostStatePath
    $coherent = $null -ne $target `
      -and [string]$target.releaseId -eq [string]$release.releaseId `
      -and [string]$target.instanceId -eq $newInstanceId `
      -and [string]$target.profileId -eq $profileId `
      -and [int]$target.port -eq [int]$hostState.port `
      -and $null -ne $activeRelease `
      -and [string]$activeRelease.releaseId -eq [string]$release.releaseId `
      -and $null -ne $activeHost `
      -and [string]$activeHost.instanceId -eq $newInstanceId `
      -and [string]$activeHost.releaseId -eq [string]$release.releaseId `
      -and [string]$activeHost.profileId -eq $profileId `
      -and [int]$activeHost.port -eq [int]$hostState.port
    if (-not $coherent) {
      return $false
    }
    return $coherent
  } catch {
    return $false
  }
}

function Invoke-OptimizationLaunchIntentRecovery {
  param($Journal)
  $allComplete = $true
  $resolvedRoot = [IO.Path]::GetFullPath($stateRoot).TrimEnd('\', '/')

  # Executable-identity replacement is a nested manager transaction. Recover
  # its receipt first because the fallback path may start a new runtime and
  # therefore create a fresh launch intent.
  foreach ($replacementFile in @(Get-ChildItem -LiteralPath $stateRoot -Filter '*.replacement.json' -File -ErrorAction SilentlyContinue)) {
    try {
      $resolvedReplacement = [IO.Path]::GetFullPath($replacementFile.FullName)
      if (-not $resolvedReplacement.StartsWith("$resolvedRoot\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Optimization replacement receipt points outside its state root: $($replacementFile.FullName)"
      }
      if (-not (Recover-ManagedRuntimeReplacement -ReplacementPath $resolvedReplacement)) {
        $allComplete = $false
        Write-Warning "Optimization executable replacement recovery is incomplete; receipt retained: $resolvedReplacement"
      }
    } catch {
      $allComplete = $false
      Write-Warning "Optimization executable replacement recovery failed; receipt retained: $($replacementFile.FullName): $($_.Exception.Message)"
    }
  }
  foreach ($lockFile in @(Get-ChildItem -LiteralPath $stateRoot -Filter '*.json.lock' -File -ErrorAction SilentlyContinue)) {
    $lockHandle = $null
    try {
      # A CreateNew manager lock whose owning process crashed has no open
      # handle anymore.  Probe the exact file with FileShare.None before
      # removing it; an actively held lock is never touched.
      $lockHandle = [IO.File]::Open($lockFile.FullName, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $lockHandle.Dispose()
      $lockHandle = $null
      Remove-Item -LiteralPath $lockFile.FullName -Force -ErrorAction SilentlyContinue
    } catch {
      if ($null -ne $lockHandle) { $lockHandle.Dispose() }
    }
  }
  $intentPaths = @()
  if ($null -ne $Journal) {
    $journalIntent = Get-OptimizationObjectText -Object $Journal -Name 'newHostLaunchIntentPath'
    if ($journalIntent) { $intentPaths += $journalIntent }
  }
  foreach ($intentFile in @(Get-ChildItem -LiteralPath $stateRoot -Filter '*.intent.json' -File -ErrorAction SilentlyContinue)) {
    $intentPaths += $intentFile.FullName
  }
  $intentPaths = @($intentPaths | Sort-Object -Unique)
  foreach ($intentPath in $intentPaths) {
    if (-not $intentPath) { continue }
    $resolvedRoot = [IO.Path]::GetFullPath($stateRoot).TrimEnd('\', '/')
    try {
      $resolvedIntent = [IO.Path]::GetFullPath($intentPath)
      if (-not $resolvedIntent.StartsWith("$resolvedRoot\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Optimization launch intent points outside its state root: $intentPath"
      }
    } catch {
      throw $_
    }
    if (-not (Test-Path -LiteralPath $intentPath -PathType Leaf)) { continue }
    $intent = Read-OptimizationJsonFile -Path $intentPath
    if ($null -eq $intent) {
      $allComplete = $false
      Write-Warning "Optimization launch intent is malformed and was retained: $intentPath"
      continue
    }
    if ((Get-OptimizationObjectText -Object $intent -Name 'schemaVersion') -ne '1' `
      -or (Get-OptimizationObjectText -Object $intent -Name 'profileId') -ne $profileId) {
      throw "Optimization launch intent is invalid or belongs to another profile: $intentPath"
    }
    $intentReleaseId = Get-OptimizationObjectText -Object $intent -Name 'releaseId'
    $intentInstanceId = Get-OptimizationObjectText -Object $intent -Name 'instanceId'
    $intentHealthUrl = Get-OptimizationObjectText -Object $intent -Name 'healthUrl'
    $intentExecutablePath = Get-OptimizationObjectText -Object $intent -Name 'filePath'
    $intentExecutableIdentity = Get-OptimizationObjectText -Object $intent -Name 'executableIdentity'
    $intentPort = 0
    [int]::TryParse((Get-OptimizationObjectText -Object $intent -Name 'port'), [ref]$intentPort) | Out-Null
    $intentPid = 0
    [int]::TryParse((Get-OptimizationObjectText -Object $intent -Name 'pid'), [ref]$intentPid) | Out-Null
    $intentProcessStartUtc = Get-OptimizationObjectText -Object $intent -Name 'processStartUtc'
    $intentArguments = @((Get-OptimizationObjectValue -Object $intent -Name 'argumentList') | ForEach-Object { [string]$_ })
    if (-not $intentReleaseId -or -not $intentInstanceId -or -not $intentHealthUrl -or -not $intentExecutablePath -or $intentPort -lt 1 -or $intentPort -gt 65535 -or $intentArguments.Count -eq 0) {
      $allComplete = $false
      Write-Warning "Optimization launch intent is incomplete and was retained: $intentPath"
      continue
    }
    $cleanupComplete = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      $receiptProcess = Find-ManagedProcessByReceipt `
        -Pid $intentPid `
        -ProcessStartUtc $intentProcessStartUtc `
        -ExpectedFilePath $intentExecutablePath `
        -ExpectedArgumentFragments $intentArguments
      $match = Find-ManagedOrphanRuntime `
        -Port $intentPort `
        -HealthUrl $intentHealthUrl `
        -ReleaseId $intentReleaseId `
        -ProfileId $profileId `
        -InstanceId $intentInstanceId `
        -ExecutableIdentity $intentExecutableIdentity `
        -ExpectedFilePath $intentExecutablePath `
        -ExpectedArgumentFragments $intentArguments
      $specProcess = Find-ManagedProcessByExecutable `
        -Pid $intentPid `
        -ProcessStartUtc $intentProcessStartUtc `
        -ExpectedFilePath $intentExecutablePath `
        -ExpectedArgumentFragments $intentArguments
      if ($null -ne $match) {
        $stopped = Stop-ManagedOrphanRuntime `
          -Port $intentPort `
          -HealthUrl $intentHealthUrl `
          -ReleaseId $intentReleaseId `
          -ProfileId $profileId `
          -InstanceId $intentInstanceId `
          -ExecutableIdentity $intentExecutableIdentity `
          -ExpectedFilePath $intentExecutablePath `
          -ExpectedArgumentFragments $intentArguments `
          -StopTimeoutSeconds 5
        if ($stopped -and (Wait-OptimizationTcpPortFree -Port $intentPort -TimeoutSeconds 1)) {
          $cleanupComplete = $true
          break
        }
      } elseif ($null -ne $receiptProcess -or $null -ne $specProcess) {
        # The receipt is authoritative for the short interval between
        # CreateProcess and the listener becoming observable.  If the parent
        # died before it could write the PID receipt, the exact executable and
        # argument identity is the bounded ownership proof.  Never infer a
        # live child from a stale PID or an occupied port alone.
        $preBindProcess = if ($null -ne $receiptProcess) { $receiptProcess } else { $specProcess }
        try {
          Stop-Process -Id $preBindProcess.Id -ErrorAction Stop
          try { $preBindProcess.WaitForExit(5000) | Out-Null } catch {}
        } catch {
          Start-Sleep -Milliseconds 100
          continue
        }
        if (-not (Wait-OptimizationTcpPortFree -Port $intentPort -TimeoutSeconds 1)) {
          Start-Sleep -Milliseconds 100
          continue
        }
        $cleanupComplete = $true
        break
      } elseif (-not (Test-OptimizationTcpPortOccupied -Port $intentPort)) {
        # A child that exited before binding is already safe to forget.  A
        # still-listening process is never inferred from a stale PID alone.
        $cleanupComplete = $true
        break
      }
      Start-Sleep -Milliseconds 100
    }
    $statePath = $intentPath -replace '\.intent\.json$', ''
    if ($cleanupComplete -and (Test-Path -LiteralPath $statePath -PathType Leaf)) {
      $state = Read-OptimizationJsonFile -Path $statePath
      if ($null -ne $state -and (Get-OptimizationObjectText -Object $state -Name 'profileId') -eq $profileId -and (Get-OptimizationObjectText -Object $state -Name 'instanceId') -eq $intentInstanceId) {
        try { Stop-OptimizationOwnedState -StatePath $statePath -ProfileId $profileId | Out-Null } catch {}
      }
      if (Test-Path -LiteralPath $statePath -PathType Leaf) { Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue }
    }
    if ($cleanupComplete) {
      Remove-Item -LiteralPath $intentPath -Force -ErrorAction SilentlyContinue
    } else {
      $allComplete = $false
      Write-Warning "Optimization launch intent could not be ownership-checked and was retained: $intentPath"
    }
  }
  foreach ($lockFile in @(Get-ChildItem -LiteralPath $stateRoot -Filter '*.json.lock' -File -ErrorAction SilentlyContinue)) {
    $lockHandle = $null
    try {
      $lockHandle = [IO.File]::Open($lockFile.FullName, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $lockHandle.Dispose()
      $lockHandle = $null
      Remove-Item -LiteralPath $lockFile.FullName -Force -ErrorAction SilentlyContinue
    } catch {
      if ($null -ne $lockHandle) { $lockHandle.Dispose() }
    }
  }

  $journalCandidateComplete = $true
  if ($null -ne $Journal -and (Get-OptimizationObjectText -Object $Journal -Name 'status') -ne 'committed') {
    $journalReleaseId = Get-OptimizationObjectText -Object $Journal -Name 'newReleaseId'
    $journalInstanceId = Get-OptimizationObjectText -Object $Journal -Name 'newInstanceId'
    $journalHealthUrl = Get-OptimizationObjectText -Object $Journal -Name 'newHostHealthUrl'
    $journalExecutablePath = Get-OptimizationObjectText -Object $Journal -Name 'newHostExecutablePath'
    $journalPort = 0
    [int]::TryParse((Get-OptimizationObjectText -Object $Journal -Name 'newHostPort'), [ref]$journalPort) | Out-Null
    $journalFragments = @((Get-OptimizationObjectValue -Object $Journal -Name 'newHostArgumentFragments') | ForEach-Object { [string]$_ })
    if ($journalReleaseId -and $journalInstanceId -and $journalHealthUrl -and $journalExecutablePath -and $journalPort -gt 0 -and $journalFragments.Count -gt 0) {
      $journalCandidateComplete = $false
      for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $match = Find-ManagedOrphanRuntime `
          -Port $journalPort `
          -HealthUrl $journalHealthUrl `
          -ReleaseId $journalReleaseId `
          -ProfileId $profileId `
          -InstanceId $journalInstanceId `
          -ExpectedFilePath $journalExecutablePath `
          -ExpectedArgumentFragments $journalFragments
        $journalProcess = Find-ManagedProcessByExecutable `
          -ExpectedFilePath $journalExecutablePath `
          -ExpectedArgumentFragments $journalFragments
        if ($null -ne $match) {
          $stopped = Stop-ManagedOrphanRuntime `
            -Port $journalPort `
            -HealthUrl $journalHealthUrl `
            -ReleaseId $journalReleaseId `
            -ProfileId $profileId `
            -InstanceId $journalInstanceId `
            -ExpectedFilePath $journalExecutablePath `
            -ExpectedArgumentFragments $journalFragments `
            -StopTimeoutSeconds 5
          if ($stopped -and (Wait-OptimizationTcpPortFree -Port $journalPort -TimeoutSeconds 1)) {
            $journalCandidateComplete = $true
            break
          }
        } elseif ($null -ne $journalProcess) {
          try {
            Stop-Process -Id $journalProcess.Id -ErrorAction Stop
            try { $journalProcess.WaitForExit(5000) | Out-Null } catch {}
          } catch {
            Start-Sleep -Milliseconds 100
            continue
          }
          if (-not (Wait-OptimizationTcpPortFree -Port $journalPort -TimeoutSeconds 1)) {
            Start-Sleep -Milliseconds 100
            continue
          }
          $journalCandidateComplete = $true
          break
        } elseif (-not (Test-OptimizationTcpPortOccupied -Port $journalPort)) {
          $journalCandidateComplete = $true
          break
        }
        Start-Sleep -Milliseconds 100
      }
      if (-not $journalCandidateComplete) {
        Write-Warning "Journal candidate Host could not be ownership-checked and was retained on port $journalPort."
      }
    }
  }
  if (-not $journalCandidateComplete) { $allComplete = $false }
  return $allComplete
}

function Restore-OptimizationOldHostFromJournal {
  param([Parameter(Mandatory)]$Journal)
  $releaseStarted = (Get-OptimizationObjectText -Object $Journal -Name 'oldHostReleasedForPromotion') -eq 'True' `
    -or (Get-OptimizationObjectText -Object $Journal -Name 'oldHostReleaseInProgress') -eq 'True'
  if (-not $releaseStarted) { return $null }
  $oldHostPath = Get-OptimizationObjectText -Object $Journal -Name 'oldHostManagerStatePath'
  $oldHostSnapshot = Get-OptimizationObjectValue -Object $Journal -Name 'oldHostStateSnapshot'
  if (-not $oldHostPath -or $null -eq $oldHostSnapshot) {
    throw 'Optimization activation journal cannot restore the previous Host after promotion release.'
  }
  if (Test-Path -LiteralPath $oldHostPath -PathType Leaf) {
    $existingOldState = Read-OptimizationJsonFile -Path $oldHostPath
    if ($null -eq $existingOldState -or [string](Get-OptimizationObjectText -Object $existingOldState -Name 'instanceId') -ne [string](Get-OptimizationObjectText -Object $Journal -Name 'oldHostInstanceId')) {
      throw 'Optimization previous Host state is ambiguous; refusing promotion rollback.'
    }
    $existingHealthUrl = Get-HostHealthUrl -State $existingOldState
    $existingArguments = @((Get-OptimizationObjectValue -Object $existingOldState -Name 'argumentList') | ForEach-Object { [string]$_ })
    $existingProcess = Find-ManagedProcessByReceipt `
      -Pid ([int](Get-OptimizationObjectText -Object $existingOldState -Name 'pid')) `
      -ProcessStartUtc (Get-OptimizationObjectText -Object $existingOldState -Name 'processStartUtc') `
      -ExpectedFilePath (Get-OptimizationObjectText -Object $existingOldState -Name 'filePath') `
      -ExpectedArgumentFragments $existingArguments
    $existingHealth = if ($existingHealthUrl) { Get-OptimizationHttpJson -Url $existingHealthUrl } else { $null }
    if ($null -ne $existingProcess -and (Get-OptimizationObjectText -Object $existingHealth -Name 'status') -eq 'ready') {
      # A crash before the destructive stop was recorded leaves the old Host
      # safely serving.  Keep it and roll back the pointers; never launch a
      # second copy on its port.
      if ((Get-OptimizationObjectText -Object $Journal -Name 'oldHostReleasedForPromotion') -ne 'True') {
        return $existingHealth
      }
      throw 'Optimization promotion journal says the old Host was released, but its owned process is still serving.'
    }
    $oldPort = 0
    [int]::TryParse((Get-OptimizationObjectText -Object $existingOldState -Name 'port'), [ref]$oldPort) | Out-Null
    if ($oldPort -gt 0 -and (Test-OptimizationTcpPortOccupied -Port $oldPort)) {
      throw 'Optimization previous Host state is stale while its port is occupied; refusing promotion rollback.'
    }
    Remove-Item -LiteralPath $oldHostPath -Force -ErrorAction SilentlyContinue
  }
  $authorityRoot = Get-OptimizationObjectText -Object $Journal -Name 'newApplicationProfileAuthorityRoot'
  if (-not $authorityRoot) {
    $authorityRoot = Get-OptimizationObjectText -Object $oldHostSnapshot -Name 'applicationProfileAuthorityRoot'
  }
  if (-not $authorityRoot -or -not (Wait-OptimizationProfileAuthorityLeaseFree -AuthorityRoot $authorityRoot -TimeoutSeconds 5)) {
    throw 'Optimization promotion rollback cannot prove that the replacement Host released the stable profile lease.'
  }
  Set-OptimizationActivationJournal -Journal $Journal -Status 'rolling-back' -Phase 'old-host-restore-starting'
  $health = Start-OptimizationHostFromSnapshot `
    -State $oldHostSnapshot `
    -StatePath $oldHostPath `
    -ReadyTimeoutSeconds $StartupTimeoutSeconds
  Set-OptimizationActivationJournal -Journal $Journal -Status 'rolling-back' -Phase 'old-host-restored'
  return $health
}

function Invoke-OptimizationActivationRecovery {
  $journal = Read-OptimizationActivationJournal -Path $activationJournalPath
  if (-not (Invoke-OptimizationLaunchIntentRecovery -Journal $journal)) {
    throw 'Optimization launch-intent recovery is incomplete; unknown or unready processes were not stopped.'
  }
  if ($null -eq $journal) { return }
  if ([int](Get-OptimizationObjectText -Object $journal -Name 'schemaVersion') -ne 1 -or (Get-OptimizationObjectText -Object $journal -Name 'profileId') -ne $profileId) {
    throw "Optimization activation journal is invalid or belongs to another profile: $activationJournalPath"
  }
  $status = Get-OptimizationObjectText -Object $journal -Name 'status'
  Write-Host "Recovering interrupted optimization activation journal (phase $(Get-OptimizationObjectText -Object $journal -Name 'phase'), status $status)."
  if ($status -eq 'committed') {
    if (-not (Test-OptimizationActivationPairReady -Journal $journal)) {
      # A committed journal is durable commit intent, including the narrow
      # interval before the committed-target file is replaced.  Never send it
      # through the rollback branch just because the replacement is not ready;
      # retain the receipt for a safe forward recovery/retry.
      throw 'Committed optimization activation is not ready for forward recovery; retaining the committed journal and refusing rollback.'
    }
    $newRelease = Get-OptimizationReleaseDescriptor -ReleaseRoot (Get-OptimizationObjectText -Object $journal -Name 'newReleaseRoot')
    $newHostPath = Get-OptimizationObjectText -Object $journal -Name 'newHostManagerStatePath'
    $newHostState = Read-OptimizationJsonFile -Path $newHostPath
    Write-OptimizationFrontDoorTarget `
      -Path $frontDoorTargetPath `
      -HostName $frontendHost `
      -Port ([int]$newHostState.port) `
      -ReleaseId ([string]$newRelease.releaseId) `
      -ProfileId $profileId `
      -InstanceId (Get-OptimizationObjectText -Object $journal -Name 'newInstanceId')
    Write-OptimizationActiveRelease -Path $activeReleasePath -Release $newRelease -ProfileId $profileId
    Write-OptimizationActiveHostState -Path $hostStatePath -ManagerStatePath $newHostPath -ProfileId $profileId
    Write-OptimizationFrontDoorTarget `
      -Path $frontDoorCommittedTargetPath `
      -HostName $frontendHost `
      -Port ([int]$newHostState.port) `
      -ReleaseId ([string]$newRelease.releaseId) `
      -ProfileId $profileId `
      -InstanceId (Get-OptimizationObjectText -Object $journal -Name 'newInstanceId')
    $oldHostPath = Get-OptimizationObjectText -Object $journal -Name 'oldHostManagerStatePath'
    $oldIsolationRoot = Get-OptimizationObjectText -Object $journal -Name 'oldApplicationIsolationRoot'
    if ($oldHostPath -and $oldHostPath -ne $newHostPath -and (Test-Path -LiteralPath $oldHostPath -PathType Leaf)) {
      $oldHostState = Read-OptimizationJsonFile -Path $oldHostPath
      if (-not $oldIsolationRoot) { $oldIsolationRoot = Get-OptimizationObjectText -Object $oldHostState -Name 'applicationIsolationRoot' }
      $drain = Invoke-OptimizationHostDrain -StatePath $oldHostPath -TokenPath $tokenPath -DeadlineSeconds 10
      Write-Host "Recovered activation drained old Host: status=$($drain.status) inflight=$($drain.inflight) forced=$($drain.forced)."
      Stop-OptimizationOwnedState -StatePath $oldHostPath -ProfileId $profileId | Out-Null
    }
    if (-not (Remove-OptimizationApplicationIsolation `
        -Root (Join-Path $defaultOptimizationDataRoot '.read-web-application\instances') `
        -Path $oldIsolationRoot)) {
      throw 'Recovered activation could not remove the previous application profile lease.'
    }
    Remove-OptimizationActivationJournal -Path $activationJournalPath
    Write-Host 'Interrupted optimization activation was finalized from its committed journal.'
    return
  }

  $newInstanceId = Get-OptimizationObjectText -Object $journal -Name 'newInstanceId'
  $newHostPath = Get-OptimizationObjectText -Object $journal -Name 'newHostManagerStatePath'
  $promotionRecovery = (Get-OptimizationObjectText -Object $journal -Name 'oldHostReleasedForPromotion') -eq 'True' `
    -or (Get-OptimizationObjectText -Object $journal -Name 'oldHostReleaseInProgress') -eq 'True'
  $newHostLeaseCleanupComplete = $true
  $recoveryCleanupComplete = $true

  if ($newHostPath -and (Test-Path -LiteralPath $newHostPath -PathType Leaf)) {
    $newHostCleanupComplete = $false
    $newIsolationRoot = ''
    try {
      $newHostState = Read-OptimizationJsonFile -Path $newHostPath
      if ($null -ne $newHostState -and [string]$newHostState.instanceId -eq $newInstanceId) {
        $newIsolationRoot = Get-OptimizationObjectText -Object $newHostState -Name 'applicationIsolationRoot'
        try {
          if (Test-Path -LiteralPath $tokenPath -PathType Leaf) {
            Invoke-OptimizationHostDrain -StatePath $newHostPath -TokenPath $tokenPath -DeadlineSeconds 5 | Out-Null
          }
        } catch { Write-Warning "Interrupted new Host drain failed; ownership-checked stop will enforce cleanup: $($_.Exception.Message)" }
        try {
          Stop-OptimizationOwnedState -StatePath $newHostPath -ProfileId $profileId | Out-Null
          $newHostCleanupComplete = $true
        } catch { Write-Warning "Interrupted new Host ownership-checked stop failed; journal retained for retry: $($_.Exception.Message)" }
      }
    } catch { Write-Warning "Interrupted new Host cleanup was incomplete: $($_.Exception.Message)" }
    if (-not $newHostCleanupComplete) {
      $newHostLeaseCleanupComplete = $false
      $recoveryCleanupComplete = $false
    }
    if ($newHostCleanupComplete -or -not (Test-Path -LiteralPath $newHostPath -PathType Leaf)) {
      Remove-Item -LiteralPath $newHostPath -Force -ErrorAction SilentlyContinue
      $cleanupIsolationRoot = $newIsolationRoot
      if (-not $cleanupIsolationRoot) { $cleanupIsolationRoot = Get-OptimizationObjectText -Object $journal -Name 'newApplicationIsolationRoot' }
      if (-not (Remove-OptimizationApplicationIsolation `
          -Root (Join-Path $defaultOptimizationDataRoot '.read-web-application\instances') `
          -Path $cleanupIsolationRoot)) {
        $recoveryCleanupComplete = $false
      }
    }
  }
  $capabilityState = Read-OptimizationJsonFile -Path $capabilityStatePath
  if ($null -ne $capabilityState -and [string]$capabilityState.instanceId -eq $newInstanceId) {
    try {
      Stop-OptimizationOwnedState -StatePath $capabilityStatePath -ProfileId $profileId | Out-Null
    } catch {
      $recoveryCleanupComplete = $false
      Write-Warning "Interrupted capability ownership-checked stop failed; journal retained for retry: $($_.Exception.Message)"
    }
  }
  foreach ($pendingState in @(Get-ChildItem -LiteralPath $stateRoot -Filter 'production-host-*.json' -File -ErrorAction SilentlyContinue)) {
    try {
      $pending = Read-OptimizationJsonFile -Path $pendingState.FullName
      if ($null -ne $pending -and [string]$pending.instanceId -eq $newInstanceId) {
        $pendingIsolationRoot = Get-OptimizationObjectText -Object $pending -Name 'applicationIsolationRoot'
        try {
          Stop-OptimizationOwnedState -StatePath $pendingState.FullName -ProfileId $profileId | Out-Null
          Remove-Item -LiteralPath $pendingState.FullName -Force -ErrorAction SilentlyContinue
          if (-not (Remove-OptimizationApplicationIsolation `
              -Root (Join-Path $defaultOptimizationDataRoot '.read-web-application\instances') `
              -Path $pendingIsolationRoot)) {
            $recoveryCleanupComplete = $false
          }
        } catch {
          $newHostLeaseCleanupComplete = $false
          $recoveryCleanupComplete = $false
          Write-Warning "Interrupted pending Host ownership-checked stop failed; journal retained for retry: $($_.Exception.Message)"
        }
      }
    } catch {
      $newHostLeaseCleanupComplete = $false
      $recoveryCleanupComplete = $false
      Write-Warning "Interrupted pending Host state could not be inspected; journal retained for retry: $($_.Exception.Message)"
    }
  }
  if ($promotionRecovery) {
    if (-not $newHostLeaseCleanupComplete) {
      throw 'Interrupted optimization promotion could not ownership-check and stop the replacement Host; refusing to restore the old Host while its lease may remain held.'
    }
    # The replacement may have been authoritative when the launcher crashed.
    # Its process and stable lease must be gone before the old Host can be
    # restarted or retained as the sole authority.
    Restore-OptimizationOldHostFromJournal -Journal $journal | Out-Null
  }
  Restore-JsonSnapshot -Path $frontDoorTargetPath -Snapshot (Get-OptimizationObjectText -Object $journal -Name 'oldTargetSnapshot')
  Restore-JsonSnapshot -Path $frontDoorCommittedTargetPath -Snapshot (Get-OptimizationObjectText -Object $journal -Name 'oldCommittedTargetSnapshot')
  Restore-JsonSnapshot -Path $activeReleasePath -Snapshot (Get-OptimizationObjectText -Object $journal -Name 'oldActiveReleaseSnapshot')
  Restore-JsonSnapshot -Path $hostStatePath -Snapshot (Get-OptimizationObjectText -Object $journal -Name 'oldActiveHostSnapshot')
  if (-not (Test-Path -LiteralPath $newHostPath -PathType Leaf)) {
    if (-not (Remove-OptimizationApplicationIsolation -Root (Join-Path $defaultOptimizationDataRoot '.read-web-application\instances') -Path (Get-OptimizationObjectText -Object $journal -Name 'newApplicationIsolationRoot'))) {
      $recoveryCleanupComplete = $false
    }
  }
  if (-not (Get-OptimizationObjectText -Object $journal -Name 'oldHostInstanceId')) {
    try {
      Stop-OptimizationOwnedState -StatePath $frontDoorStatePath -ProfileId $profileId | Out-Null
    } catch {
      $recoveryCleanupComplete = $false
      Write-Warning "Interrupted front door ownership-checked stop failed; journal retained for retry: $($_.Exception.Message)"
    }
  }
  if ((Get-OptimizationObjectText -Object $journal -Name 'oldTokenPresent') -ne 'True' -and (Test-Path -LiteralPath $tokenPath)) {
    Remove-Item -LiteralPath $tokenPath -Force -ErrorAction SilentlyContinue
  }
  if (-not $recoveryCleanupComplete) {
    throw 'Interrupted optimization activation cleanup is incomplete; the activation journal and owned state are retained for a safe retry.'
  }
  Remove-OptimizationActivationJournal -Path $activationJournalPath
  Write-Host 'Interrupted optimization activation was rolled back from its journal; the previous release remains selected.'
}

if ($Stop -and $DevFallback) { throw 'Use either -Stop or -DevFallback, not both.' }

$launchSucceeded = $false
$frontDoorStarted = $false
$newPairStarted = $false
$newCapabilityStarted = $false
$frontDoorTargetSwitched = $false
$frontDoorCommittedTargetSwitched = $false
$activeReleaseSwitched = $false
$activeHostStateSwitched = $false
$oldHostStoppedForHandoff = $false
$oldRelease = $null
$oldToken = ''
$newToken = ''
$candidate = $null
$newRelease = $null
$oldActiveReleaseSnapshot = ''
$oldActiveHostSnapshot = ''
$oldFrontDoorTargetSnapshot = ''
$oldFrontDoorTarget = $null
$oldHostManagerStatePath = $null
$newHostManagerStatePath = $null
$newPair = $null
try {
  New-Item -ItemType Directory -Force -Path $stateRoot, $releaseRoot, $stagingRoot, $logRoot | Out-Null

  Invoke-OptimizationActivationRecovery

  if ($Stop) {
    $activeHost = Read-OptimizationJsonFile -Path $hostStatePath
    $hostManagerPath = Resolve-OptimizationManagedStatePath -ActiveStatePath $hostStatePath -StateRoot $stateRoot
    $hostState = Read-OptimizationJsonFile -Path $hostManagerPath
    $hostIsolationRoot = Get-OptimizationObjectText -Object $hostState -Name 'applicationIsolationRoot'
    $hostPort = 0
    [int]::TryParse((Get-OptimizationObjectText -Object $hostState -Name 'port'), [ref]$hostPort) | Out-Null
    if (Test-Path -LiteralPath $frontDoorTargetPath) { Clear-OptimizationFrontDoorTarget -Path $frontDoorTargetPath }
    if (Test-Path -LiteralPath $frontDoorCommittedTargetPath) { Remove-Item -LiteralPath $frontDoorCommittedTargetPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $hostManagerPath -PathType Leaf) {
      if (Test-Path -LiteralPath $tokenPath -PathType Leaf) {
        Invoke-OptimizationHostDrain -StatePath $hostManagerPath -TokenPath $tokenPath -DeadlineSeconds 10 | Out-Null
      }
    }
    $stoppedHost = Stop-OptimizationOwnedState -StatePath $hostManagerPath -ProfileId $profileId
    if (-not (Remove-OptimizationApplicationIsolation `
        -Root (Join-Path $defaultOptimizationDataRoot '.read-web-application\instances') `
        -Path $hostIsolationRoot)) {
      throw 'Stop could not remove the active application profile lease.'
    }
    $stoppedPendingHost = $false
    foreach ($pendingState in @(Get-ChildItem -LiteralPath $stateRoot -Filter 'production-host-*.json' -File -ErrorAction SilentlyContinue)) {
      if ($pendingState.FullName -eq $hostManagerPath) { continue }
      if (Test-Path -LiteralPath $pendingState.FullName -PathType Leaf) {
        $pendingHost = Read-OptimizationJsonFile -Path $pendingState.FullName
        $pendingIsolationRoot = Get-OptimizationObjectText -Object $pendingHost -Name 'applicationIsolationRoot'
        try { Invoke-OptimizationHostDrain -StatePath $pendingState.FullName -TokenPath $tokenPath -DeadlineSeconds 10 | Out-Null } catch { Write-Warning "Pending Host drain failed: $($_.Exception.Message)" }
      }
      if (Stop-OptimizationOwnedState -StatePath $pendingState.FullName -ProfileId $profileId) {
        $stoppedPendingHost = $true
        if (-not (Remove-OptimizationApplicationIsolation `
            -Root (Join-Path $defaultOptimizationDataRoot '.read-web-application\instances') `
            -Path $pendingIsolationRoot)) {
          throw "Stop could not remove pending application profile lease: $($pendingState.FullName)"
        }
      }
    }
    $stoppedCapability = Stop-OptimizationOwnedState -StatePath $capabilityStatePath -ProfileId $profileId
    $stoppedFrontDoor = Stop-OptimizationOwnedState -StatePath $frontDoorStatePath -ProfileId $profileId
    if (Test-Path -LiteralPath $hostStatePath) { Remove-Item -LiteralPath $hostStatePath -Force -ErrorAction SilentlyContinue }
    if ($hostManagerPath -ne $hostStatePath -and (Test-Path -LiteralPath $hostManagerPath)) {
      Remove-Item -LiteralPath $hostManagerPath -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $tokenPath) { Remove-Item -LiteralPath $tokenPath -Force }
    foreach ($pointerPath in @($activeReleasePath, (Join-Path $stateRoot 'release-manifest.json'))) {
      if (Test-Path -LiteralPath $pointerPath -PathType Leaf) {
        Remove-Item -LiteralPath $pointerPath -Force -ErrorAction SilentlyContinue
      }
    }
    if (-not (Wait-OptimizationTcpPortFree -Port $fixedFrontendPort -TimeoutSeconds 5)) {
      throw "Owned optimization front door port $fixedFrontendPort did not close; no unknown process was stopped."
    }
    if (-not (Wait-OptimizationTcpPortFree -Port $fixedBackendPort -TimeoutSeconds 5)) {
      throw "Owned optimization capability port $fixedBackendPort did not close; no unknown process was stopped."
    }
    if ($hostPort -gt 0 -and -not (Wait-OptimizationTcpPortFree -Port $hostPort -TimeoutSeconds 5)) {
      throw "Owned optimization host port $hostPort did not close; no unknown process was stopped."
    }
    if (Test-Path -LiteralPath $frontDoorTargetPath -PathType Leaf) {
      Remove-Item -LiteralPath $frontDoorTargetPath -Force -ErrorAction Stop
    }
    $stoppedLabels = @()
    if ($stoppedHost) { $stoppedLabels += 'production-host' }
    if ($stoppedPendingHost) { $stoppedLabels += 'pending-production-host' }
    if ($stoppedCapability) { $stoppedLabels += 'capability-host' }
    if ($stoppedFrontDoor) { $stoppedLabels += 'front-door' }
    if ($stoppedLabels.Count -eq 0) { Write-Host 'No optimization production instance was owned by this launcher.' }
    else { Write-Host "Stopped optimization $($stoppedLabels -join ', ')." }
    $launchSucceeded = $true
    return
  }

  $projectRoot = Resolve-OptimizationExistingPath -Value $projectRoot -Label 'Project'
  $workflowRoot = Resolve-OptimizationExistingPath -Value $workflowRoot -Label 'Workflow'
  $runtimeConfigPath = Resolve-OptimizationExistingPath -Value $runtimeConfigPath -Label 'Runtime config'
  $frontDoorScript = Resolve-OptimizationExistingPath -Value $frontDoorScript -Label 'Optimization front door'
  try {
    $runtimeConfigPayload = Get-Content -LiteralPath $runtimeConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Optimization RuntimeConfig file is invalid: $runtimeConfigPath"
  }
  $configuredPython = if ($null -ne $runtimeConfigPayload.python) { [string]$runtimeConfigPayload.python.executable } else { '' }
  if ($configuredPython -and -not [IO.Path]::IsPathRooted($configuredPython)) {
    $configCandidate = Join-Path (Split-Path -Parent $runtimeConfigPath) $configuredPython
    if (Test-Path -LiteralPath $configCandidate -PathType Leaf) { $configuredPython = $configCandidate }
  }
  $bootstrapValue = if ($BootstrapPython) { $BootstrapPython } elseif ($env:READ_WEB_PYTHON) { $env:READ_WEB_PYTHON } elseif ($env:READ_WEB_PYTHON_PATH) { $env:READ_WEB_PYTHON_PATH } elseif ($configuredPython) { $configuredPython } else { 'python' }
  $bootstrapPath = Resolve-OptimizationExecutablePath -Value $bootstrapValue -Label 'Bootstrap Python'

  foreach ($name in @(
    'READ_WEB_FRONTEND_HOST', 'READ_WEB_FRONTEND_PORT', 'READ_WEB_BACKEND_HOST',
    'READ_WEB_BACKEND_PORT', 'READ_WEB_SUBTITLE_DATA_ROOT', 'READ_WEB_PYTHON_PATH', 'READ_WEB_PYTHON',
    'READ_WEB_RELEASE_ID', 'READ_WEB_PROFILE_ID', 'READ_WEB_INSTANCE_ID',
    'READ_WEB_SERVICE_TOKEN', 'READ_WEB_ALLOWED_ORIGIN', 'READ_WEB_CAPABILITY_HOST',
    'READ_WEB_CAPABILITY_PORT', 'READ_WEB_PROXY_URL', 'YOUTUBE_COOKIES_PATH',
    'YT_DLP_PATH', 'WHISPERX_PATH', 'FFMPEG_PATH', 'GEMINI_MODEL', 'GEMINI_BASE_URL'
  )) {
    Set-OptimizationProcessEnvironmentValue -Name $name -Value $null
  }
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_RUNTIME_CONFIG' -Value $runtimeConfigPath
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_PYTHON' -Value $bootstrapPath
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_PYTHON_PATH' -Value $bootstrapPath

  Push-Location $workflowRoot
  try {
    $runtimeJson = & $bootstrapPath -m youtube_workflow.runtime_config --config $runtimeConfigPath
    $runtimeExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($runtimeExitCode -ne 0) { throw "RuntimeConfig resolution failed with exit code $runtimeExitCode." }
  $runtime = (($runtimeJson -join "`n") | ConvertFrom-Json)
  $frontendHost = [string]$runtime.frontend.host
  $frontendPort = [int]$runtime.frontend.port
  $backendHost = [string]$runtime.backend.host
  $backendPort = [int]$runtime.backend.port
  $workflowDataRoot = [string]$runtime.dataRoot
  if (-not (Test-OptimizationLoopbackHost -HostName $frontendHost) -or -not (Test-OptimizationLoopbackHost -HostName $backendHost)) {
    throw 'Optimization production host requires loopback frontend and backend hosts.'
  }
  if ($frontendPort -ne $fixedFrontendPort -or $backendPort -ne $fixedBackendPort) {
    throw "Optimization runtime must use frontend/backend ports 5184/8776; got $frontendPort/$backendPort."
  }
  if ((Normalize-OptimizationPath -Value $workflowDataRoot) -ne (Normalize-OptimizationPath -Value $defaultOptimizationDataRoot)) {
    throw "Optimization runtime must use data root $defaultOptimizationDataRoot; got $workflowDataRoot."
  }

  New-Item -ItemType Directory -Force -Path $workflowDataRoot | Out-Null
  $applicationIsolationRoot = Join-Path $workflowDataRoot '.read-web-application'
  New-Item -ItemType Directory -Force -Path $applicationIsolationRoot | Out-Null
  # The instance directory is disposable lifecycle state.  Authority lease,
  # owner-mode checkpoints, and any future cutover identity live at this
  # stable profile-level location so an overlapping replacement cannot create
  # a second authoritative writer for the same profile.
  $applicationProfileAuthorityIsolationRoot = $applicationIsolationRoot
  $applicationProfileAuthorityRoot = Join-Path $applicationProfileAuthorityIsolationRoot "profiles\$profileId"

  if ($DevFallback) {
    Write-Warning 'Using the explicit Vite development fallback; this is not the default optimization launch path.'
    $fallback = Join-Path $PSScriptRoot 'launch-next-preview.ps1'
    $fallbackParams = @{ RuntimeConfigPath = $runtimeConfigPath; BootstrapPython = $bootstrapPath }
    if ($NoOpen) { $fallbackParams.NoOpen = $true }
    & $fallback @fallbackParams
    if ($LASTEXITCODE -ne 0) { throw "Development fallback exited with code $LASTEXITCODE." }
    $launchSucceeded = $true
    return
  }

  $nodePath = Resolve-OptimizationExecutablePath -Value 'node' -Label 'Node'
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($null -eq $npmCommand) { $npmCommand = Get-Command npm -ErrorAction Stop }
  $pythonPath = Resolve-OptimizationExecutablePath -Value ([string]$runtime.python.executable) -Label 'Runtime Python'
  # This is the launcher preflight: the exact executable that will later be
  # passed to the production Host must prove the complete lock/package-set
  # contract before any release BuildAction or Host process can run.
  $pythonPreflight = Assert-OptimizationReleaseToolchain `
    -ProjectRoot $projectRoot `
    -WorkflowRoot $workflowRoot `
    -RuntimeConfigPath $runtimeConfigPath `
    -NodePath $nodePath `
    -NpmPath $npmCommand.Source `
    -PythonPath $pythonPath
  $runtimeTools = Get-OptimizationObjectValue -Object $runtime -Name 'tools'
  $configuredFfmpegPath = Get-OptimizationObjectText -Object $runtimeTools -Name 'ffmpeg'
  $configuredYtDlpPath = Get-OptimizationObjectText -Object $runtimeTools -Name 'ytDlp'
  $configuredWhisperxPath = Get-OptimizationObjectText -Object $runtimeTools -Name 'whisperx'
  $existingHostManagerStatePath = Get-ManagedHostStatePath
  $existingHostState = Read-OptimizationJsonFile -Path $existingHostManagerStatePath
  $existingHostDescriptor = Read-OptimizationJsonFile -Path $hostStatePath
  $existingFrontDoorState = Read-OptimizationJsonFile -Path $frontDoorStatePath
  $existingHostPort = 0
  [int]::TryParse((Get-OptimizationObjectText -Object $existingHostState -Name 'port'), [ref]$existingHostPort) | Out-Null
  if ($null -ne $existingHostState -and $existingHostPort -eq $fixedFrontendPort -and $null -eq (Read-OptimizationJsonFile -Path $frontDoorStatePath)) {
    throw 'A legacy fixed-port optimization host owns 5184. Run -Stop once before migrating to the stable front door.'
  }
  $existingHostHealthUrl = Get-HostHealthUrl -State $existingHostState -FallbackPort $fixedFrontendPort
  $existingWorkflowHealthUrl = if ($existingHostHealthUrl) { Get-HostWorkflowHealthUrl -HostHealthUrl $existingHostHealthUrl } else { '' }
  $existingCapabilityHealthUrl = "http://$(Format-OptimizationUrlHost -HostName $backendHost):$backendPort/api/app/health"
  $existingCapabilityState = Read-OptimizationJsonFile -Path $capabilityStatePath
  $existingHostHealth = if ($existingHostHealthUrl) { Get-OptimizationHttpJson -Url $existingHostHealthUrl } else { $null }
  $existingCapabilityHealth = Get-OptimizationHttpJson -Url $existingCapabilityHealthUrl
  # Read the old service-token receipt before any front-door preflight can
  # fail.  The catch path may remove a token only when this launch created a
  # new token; an existing Host's receipt must survive every failed upgrade.
  if (Test-Path -LiteralPath $tokenPath -PathType Leaf) {
    $oldToken = (Read-OptimizationRuntimeText -Path $tokenPath).Trim()
  }
  $activePointer = Read-OptimizationActiveRelease -Path $activeReleasePath
  $oldActiveReleaseSnapshot = Read-OptimizationRuntimeText -Path $activeReleasePath
  $oldActiveHostSnapshot = Read-OptimizationRuntimeText -Path $hostStatePath
  $oldFrontDoorTarget = Read-OptimizationFrontDoorTarget -Path $frontDoorTargetPath
  $oldFrontDoorTargetSnapshot = Read-OptimizationRuntimeText -Path $frontDoorTargetPath
  $oldCommittedTargetSnapshot = Read-OptimizationRuntimeText -Path $frontDoorCommittedTargetPath
  $activeRelease = $null
  if ($null -ne $activePointer -and (Get-OptimizationObjectText -Object $activePointer -Name 'profileId') -eq $profileId) {
    try {
      $activeRelease = Get-OptimizationReleaseDescriptor -ReleaseRoot ([string]$activePointer.releaseRoot)
    } catch {
      $activeRelease = $null
    }
  }

  $activeIntegrity = if ($null -ne $activeRelease) {
    Test-OptimizationReleaseIntegrity -Release $activeRelease -NodePath $nodePath -ReleaseHealthScript $releaseHealthScript
  } else { [pscustomobject]@{ passed = $false; manifestSha256 = ''; failures = @('no active release') } }
  $sourceFingerprint = Get-OptimizationSourceFingerprint `
    -ProjectRoot $projectRoot `
    -WorkflowRoot $workflowRoot `
    -RuntimeConfigPath $runtimeConfigPath `
    -CapabilityScript $capabilityScript `
    -BackupScript $backupScript `
    -FrontDoorScript $frontDoorScript `
    -NodePath $nodePath `
    -NpmPath $npmCommand.Source `
    -PythonPath $pythonPath `
    -FfmpegPath $configuredFfmpegPath `
    -YtDlpPath $configuredYtDlpPath `
    -WhisperxPath $configuredWhisperxPath
  $activeToolchainSha = if ($null -ne $activeRelease) { Get-OptimizationObjectText -Object $activeRelease -Name 'toolchainSha256' } else { '' }
  $activeReusable = $null -ne $activeRelease `
    -and $activeIntegrity.passed `
    -and $activeRelease.sourceSha256 -eq $sourceFingerprint.sha256 `
    -and $activeToolchainSha -and $activeToolchainSha -eq [string]$sourceFingerprint.toolchainSha256 `
    -and (Test-OptimizationReleaseCompatibility -Release $activeRelease)
  $testFailure = [string]$env:READ_WEB_OPTIMIZATION_TEST_FAILURE
  $testKillPhase = [string]$env:READ_WEB_OPTIMIZATION_TEST_KILL_PHASE
  $requireCleanCandidate = [string]$env:READ_WEB_OPTIMIZATION_RELEASE_CANDIDATE -eq '1'
  if ($testFailure -in @('capability', 'host', 'readiness', 'promotion', 'active-pointer', 'host-state', 'switch', 'front-door', 'front-door-health-identity') -or $testKillPhase -in @('target', 'active-release', 'active-host', 'commit-pointer', 'host-process-started')) {
    $activeReusable = $false
  }

  # Migrate an already-running pre-commit-marker installation before the
  # front door starts.  Once present, this file is the only public routing
  # receipt; it is never changed while a candidate is merely switching.
  if ($null -ne $activeRelease -and $null -ne $existingHostState -and $existingHostPort -gt 0) {
    $existingTarget = Read-OptimizationFrontDoorTarget -Path $frontDoorTargetPath
    $existingPointersMatch = $null -ne $existingTarget `
      -and [string]$existingTarget.profileId -eq $profileId `
      -and [string]$existingTarget.releaseId -eq [string]$activeRelease.releaseId `
      -and [string]$existingTarget.instanceId -eq [string]$existingHostState.instanceId `
      -and [int]$existingTarget.port -eq $existingHostPort
    if ($existingPointersMatch -and $null -eq (Read-OptimizationFrontDoorTarget -Path $frontDoorCommittedTargetPath)) {
      if ($oldCommittedTargetSnapshot) {
        throw 'The committed optimization front-door target is malformed; refusing to overwrite the last commit receipt.'
      }
      Write-OptimizationFrontDoorTarget `
        -Path $frontDoorCommittedTargetPath `
        -HostName ([string]$existingTarget.host) `
        -Port $existingHostPort `
        -ReleaseId ([string]$existingTarget.releaseId) `
        -ProfileId $profileId `
        -InstanceId ([string]$existingTarget.instanceId)
      $oldCommittedTargetSnapshot = Read-OptimizationRuntimeText -Path $frontDoorCommittedTargetPath
    }
  }

  $frontDoorExecutableIdentity = Get-OptimizationFileSha256 -Path $frontDoorScript
  $frontDoorExecutablePath = Get-OptimizationFrontDoorExecutablePath -Identity $frontDoorExecutableIdentity
  $frontDoorProcessHealthUrl = "http://$(Format-OptimizationUrlHost -HostName $frontendHost):$frontendPort/api/app/front-door-process-health"
  $frontDoorManagerIdentity = if ($testFailure -eq 'front-door') { "$frontDoorExecutableIdentity-test-failure" } else { $frontDoorExecutableIdentity }
  $existingFrontDoorProcessHealth = Get-OptimizationHttpJson -Url $frontDoorProcessHealthUrl
  $existingFrontDoorHealthIdentity = Get-OptimizationObjectText -Object $existingFrontDoorProcessHealth -Name 'executableIdentity'
  $frontDoorArgumentList = @(
    $frontDoorExecutablePath,
    '--host', $frontendHost,
    '--port', '{port}',
    '--target-file', $frontDoorTargetPath,
    '--release-id', '{releaseId}',
    '--profile-id', '{profileId}',
    '--instance-id', '{instanceId}',
    '--executable-identity', '{executableIdentity}',
    '--active-release-file', $activeReleasePath,
    '--active-host-file', $hostStatePath,
    '--activation-journal-file', $activationJournalPath,
    '--committed-target-file', $frontDoorCommittedTargetPath,
    '--health-identity-test-file', (Join-Path $stateRoot 'front-door-health-identity.test')
  )
  if ($testFailure -eq 'front-door') { $frontDoorArgumentList += '--fail-ready' }
  $frontDoorPreflightStart = $null
  $existingFrontDoorIdentity = Get-OptimizationObjectText -Object $existingFrontDoorState -Name 'executableIdentity'
  if ($null -ne $existingFrontDoorState -and (
      -not $existingFrontDoorIdentity `
      -or $existingFrontDoorIdentity -ne $frontDoorManagerIdentity `
      -or -not $existingFrontDoorHealthIdentity `
      -or $existingFrontDoorHealthIdentity -ne $frontDoorManagerIdentity)) {
    $frontDoorPreflightPort = Get-OptimizationFreePort -StartPort 5300 -EndPort 5399 -ReservedPorts $reservedOptimizationPorts
    $frontDoorPreflightStatePath = Join-Path $stateRoot "front-door-preflight-$([Guid]::NewGuid().ToString('N')).json"
    $frontDoorPreflightArguments = @($frontDoorArgumentList)
    $frontDoorPreflightStart = @{
      ReleaseId = $frontDoorReleaseId
      ProfileId = $profileId
      InstanceId = $frontDoorInstanceId
      Port = $frontDoorPreflightPort
      HealthUrl = "http://$(Format-OptimizationUrlHost -HostName $frontendHost):$frontDoorPreflightPort/api/app/front-door-process-health"
      StatePath = $frontDoorPreflightStatePath
      FilePath = $nodePath
      ArgumentList = $frontDoorPreflightArguments
      WorkingDirectory = $projectRoot
      ReadyTimeoutSeconds = [Math]::Min(5, [Math]::Max(1, $StartupTimeoutSeconds))
      ReservedDailyPorts = $reservedDailyPorts
      StandardOutputPath = (Join-Path $logRoot 'read-web-optimization-front-door-preflight.out.log')
      StandardErrorPath = (Join-Path $logRoot 'read-web-optimization-front-door-preflight.err.log')
      ExecutableIdentity = $frontDoorManagerIdentity
      Metadata = @{ runtimeRole = 'front-door' }
      LaunchIntentPath = "$frontDoorPreflightStatePath.intent.json"
    }
  }
  $frontDoorResult = Start-ManagedRuntimeInstance `
    -ReleaseId $frontDoorReleaseId `
    -ProfileId $profileId `
    -InstanceId $frontDoorInstanceId `
    -Port $fixedFrontendPort `
    -HealthUrl $frontDoorProcessHealthUrl `
    -StatePath $frontDoorStatePath `
    -FilePath $nodePath `
    -ArgumentList $frontDoorArgumentList `
    -WorkingDirectory $projectRoot `
    -ReadyTimeoutSeconds $StartupTimeoutSeconds `
    -ReservedDailyPorts $reservedDailyPorts `
      -StandardOutputPath (Join-Path $logRoot 'read-web-optimization-front-door.out.log') `
      -StandardErrorPath (Join-Path $logRoot 'read-web-optimization-front-door.err.log') `
      -ExecutableIdentity $frontDoorManagerIdentity `
      -Metadata @{ runtimeRole = 'front-door' } `
      -PreflightStart $frontDoorPreflightStart
  $frontDoorStarted = [string]$frontDoorResult.status -eq 'started'

  if ($activeReusable -and $null -ne $existingHostState -and (Test-OptimizationPairReady `
      -HostState $existingHostState `
      -CapabilityState $existingCapabilityState `
      -HostHealth $existingHostHealth `
      -CapabilityHealth $existingCapabilityHealth `
      -Release $activeRelease `
      -ProfileId $profileId `
      -TokenPath $tokenPath `
      -ExpectedDataRoot $defaultOptimizationDataRoot `
      -AllowSharedCapability)) {
    $currentTarget = Read-OptimizationFrontDoorTarget -Path $frontDoorTargetPath
    if ($null -eq $currentTarget `
      -or $currentTarget.port -ne $existingHostPort `
      -or $currentTarget.releaseId -ne $activeRelease.releaseId `
      -or $currentTarget.profileId -ne $profileId `
      -or $currentTarget.instanceId -ne $existingHostState.instanceId) {
      Write-OptimizationFrontDoorTarget `
        -Path $frontDoorTargetPath `
        -HostName $frontendHost `
        -Port $existingHostPort `
        -ReleaseId ([string]$activeRelease.releaseId) `
        -ProfileId $profileId `
        -InstanceId ([string]$existingHostState.instanceId)
    }
    $frontendUrl = "http://$(Format-OptimizationUrlHost -HostName $frontendHost):$frontendPort/"
    Write-Host "Reusing optimization production host at $frontendUrl (release $($activeRelease.releaseId))."
    if (-not $NoOpen) { Start-Process $frontendUrl }
    $launchSucceeded = $true
    return
  }

  foreach ($name in @('VITE_READ_WEB_SERVICE_TOKEN', 'ECDICT_DATABASE_PATH', 'LOCAL_SENTENCE_DATABASE_PATH', 'SENTENCE_TRANSLATION_CACHE_PATH', 'IELTS_READING_VOCABULARY_CANDIDATES_PATH')) {
    Set-OptimizationProcessEnvironmentValue -Name $name -Value $null
  }
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_RUNTIME_CONFIG' -Value $runtimeConfigPath
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_SUBTITLE_DATA_ROOT' -Value $workflowDataRoot
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_FRONTEND_HOST' -Value $frontendHost
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_FRONTEND_PORT' -Value ([string]$frontendPort)
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_BACKEND_HOST' -Value $backendHost
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_BACKEND_PORT' -Value ([string]$backendPort)
  Set-OptimizationProcessEnvironmentValue -Name 'VITE_LOCAL_SERVICE_BASE_URL' -Value ("http://$(Format-OptimizationUrlHost -HostName $frontendHost):$frontendPort")
  Set-OptimizationProcessEnvironmentValue -Name 'ECDICT_ENABLED' -Value 'false'

  if ($null -ne $activeRelease) {
    $oldRelease = $activeRelease
  } else {
    $oldRelease = Read-LegacyOptimizationRelease `
      -Health $existingHostHealth `
      -ManifestPath (Join-Path $stateRoot 'release-manifest.json') `
      -DistRoot (Join-Path $projectRoot 'dist') `
      -ReleaseRoot $projectRoot
  }
  $oldPairExists = $null -ne $existingHostState -or $null -ne $existingCapabilityState
  if ($oldPairExists -and $null -eq $oldRelease) {
    throw 'Cannot replace the current optimization pair without a rollback release descriptor.'
  }
  if ($null -ne $existingHostState -and -not $oldToken) {
    throw 'An existing optimization Host has no shared service-token receipt; refusing replacement until it is stopped and relaunched safely.'
  }
  if ($oldToken) { $newToken = $oldToken } else { $newToken = New-OptimizationInstanceToken }
  [IO.File]::WriteAllText($tokenPath, "$newToken`n", [Text.UTF8Encoding]::new($false))
  $newInstanceId = [Guid]::NewGuid().ToString('N')
  $newHostPort = Get-OptimizationFreePort -StartPort 5200 -EndPort 5299 -ReservedPorts $reservedOptimizationPorts
  $newHostManagerStatePath = Join-Path $stateRoot "production-host-$newInstanceId.json"
  $newHostLaunchIntentPath = "$newHostManagerStatePath.intent.json"
  $newApplicationIsolationRoot = Join-Path $applicationIsolationRoot "instances\$newInstanceId"
  $newApplicationProfileDir = Join-Path $newApplicationIsolationRoot 'profile'
  $newApplicationPythonStateDir = Join-Path $newApplicationIsolationRoot 'python-state'
  $newApplicationPythonOutputDir = Join-Path $newApplicationIsolationRoot 'python-output'
  $newHostHealthUrl = "http://$(Format-OptimizationUrlHost -HostName $frontendHost):$newHostPort/api/app/health"

  $activationJournal = [ordered]@{
    schemaVersion = 1
    status = 'prepared'
    phase = 'prepared'
    profileId = $profileId
    createdAtUtc = ([DateTime]::UtcNow).ToString('O')
    updatedAtUtc = ([DateTime]::UtcNow).ToString('O')
    oldTargetSnapshot = $oldFrontDoorTargetSnapshot
    oldCommittedTargetSnapshot = $oldCommittedTargetSnapshot
    oldActiveReleaseSnapshot = $oldActiveReleaseSnapshot
    oldActiveHostSnapshot = $oldActiveHostSnapshot
    oldHostStateSnapshot = $existingHostState
    oldHostManagerStatePath = [string]$existingHostManagerStatePath
    oldHostInstanceId = Get-OptimizationObjectText -Object $existingHostState -Name 'instanceId'
    oldApplicationIsolationRoot = Get-OptimizationObjectText -Object $existingHostState -Name 'applicationIsolationRoot'
    oldCapabilityInstanceId = Get-OptimizationObjectText -Object $existingCapabilityState -Name 'instanceId'
    oldTokenPresent = [bool]$oldToken
    oldHostReleaseInProgress = $false
    oldHostReleasedForPromotion = $false
    newReleaseId = ''
    newReleaseRoot = ''
    newHostManagerStatePath = $newHostManagerStatePath
    newHostLaunchIntentPath = $newHostLaunchIntentPath
    newInstanceId = $newInstanceId
    newHostPort = $newHostPort
    newHostHealthUrl = $newHostHealthUrl
    newHostExecutablePath = $pythonPath
    newHostArgumentFragments = @('-m', 'youtube_workflow.production_host_prototype', '--port', [string]$newHostPort, '--instance-id', $newInstanceId)
    newApplicationIsolationRoot = $newApplicationIsolationRoot
    newApplicationProfileAuthorityRoot = $applicationProfileAuthorityRoot
    newApplicationProfileAuthorityIsolationRoot = $applicationProfileAuthorityIsolationRoot
  }
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'prepared' -Phase 'prepared'

  if ($activeReusable) {
    $newRelease = $activeRelease
  } else {
    $candidate = New-OptimizationReleaseStaging `
      -ProjectRoot $projectRoot `
      -WorkflowRoot $workflowRoot `
      -RuntimeConfigPath $runtimeConfigPath `
      -CapabilityScript $capabilityScript `
      -BackupScript $backupScript `
      -FrontDoorScript $frontDoorScript `
      -StagingRoot $stagingRoot `
      -ReleaseRoot $releaseRoot `
      -NpmPath $npmCommand.Source `
      -NodePath $nodePath `
      -PythonPath $pythonPath `
      -FfmpegPath $configuredFfmpegPath `
      -YtDlpPath $configuredYtDlpPath `
      -WhisperxPath $configuredWhisperxPath `
      -ReleaseHealthScript $releaseHealthScript `
      -ProfileId $profileId `
      -FrontendHost $frontendHost `
      -FrontendPort $frontendPort `
      -BackendHost $backendHost `
      -BackendPort $backendPort `
      -DataRoot $workflowDataRoot `
      -RequireClean:$requireCleanCandidate
    $published = Publish-OptimizationRelease `
      -Candidate $candidate `
      -ReleaseRoot $releaseRoot `
      -NodePath $nodePath `
      -ReleaseHealthScript $releaseHealthScript
    $newRelease = $published.release
  }

  $activationJournal.newReleaseId = [string]$newRelease.releaseId
  $activationJournal.newReleaseRoot = [string]$newRelease.releaseRoot
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'prepared' -Phase 'release-ready'

  $newWorkflowHealthUrl = Get-HostWorkflowHealthUrl -HostHealthUrl $newHostHealthUrl
  $newCapabilityHealthUrl = $existingCapabilityHealthUrl
  $newCapabilityStarted = $false
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'prepared' -Phase 'pair-starting'
  $newPair = Start-OptimizationOwnedPair `
    -Release $newRelease `
    -ProfileId $profileId `
    -InstanceId $newInstanceId `
    -ServiceToken $newToken `
    -FrontendHost $frontendHost `
    -FrontendPort $newHostPort `
    -BackendHost $backendHost `
    -BackendPort $backendPort `
    -PythonPath $pythonPath `
    -NodePath $nodePath `
    -CapabilityScript $capabilityScript `
    -WorkflowRoot $workflowRoot `
    -ProjectRoot $projectRoot `
    -ApplicationIsolationRoot $newApplicationIsolationRoot `
    -ApplicationProfileDir $newApplicationProfileDir `
    -ApplicationProfileAuthorityRoot $applicationProfileAuthorityRoot `
    -ApplicationProfileAuthorityIsolationRoot $applicationProfileAuthorityIsolationRoot `
    -ApplicationPythonStateDir $newApplicationPythonStateDir `
    -ApplicationPythonOutputDir $newApplicationPythonOutputDir `
    -HostStatePath $newHostManagerStatePath `
    -CapabilityStatePath $capabilityStatePath `
    -LogRoot $logRoot `
    -HostHealthUrl $newHostHealthUrl `
    -WorkflowHealthUrl $newWorkflowHealthUrl `
    -CapabilityHealthUrl $newCapabilityHealthUrl `
    -CapabilityBaseUrl ("http://$(Format-OptimizationUrlHost -HostName $backendHost):$backendPort") `
    -StartupTimeoutSeconds $StartupTimeoutSeconds `
    -ReservedPorts $reservedDailyPorts `
    -ExpectedDataRoot $defaultOptimizationDataRoot `
    -ApplicationProfileLeaseMode 'standby-if-busy' `
    -AllowStandbyReadiness
  $newPairStarted = $true
  $newCapabilityStarted = [string]$newPair.capability.status -eq 'started'
  $activationJournal.newCapabilityStarted = $newCapabilityStarted
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'prepared' -Phase 'pair-ready'

  $newHostState = Read-OptimizationJsonFile -Path $newHostManagerStatePath
  if ($null -eq $newHostState) { throw 'New production host returned ready without an owned state file.' }
  $candidateProfileLeaseMode = Get-OptimizationObjectText -Object $newPair.health -Name 'profileLeaseMode'
  if ($candidateProfileLeaseMode -eq 'standby' -and $null -eq $existingHostState) {
    throw 'Optimization candidate is standby without an owned previous Host; refusing activation.'
  }
  if ($candidateProfileLeaseMode -eq 'standby') {
    $activationJournal.candidatePreflightMode = 'standby'
    $activationJournal.promotionRequired = $true
    Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'candidate-standby-ready'
    Invoke-OptimizationHostDrain -StatePath $newHostManagerStatePath -TokenPath $tokenPath -DeadlineSeconds 10 | Out-Null
    Stop-OptimizationOwnedState -StatePath $newHostManagerStatePath -ProfileId $profileId | Out-Null
    if (-not (Wait-OptimizationTcpPortFree -Port $newHostPort -TimeoutSeconds 5)) {
      throw 'Standby optimization candidate did not release its host port before promotion.'
    }
    Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'candidate-standby-stopped'

    $oldIsolationRoot = Get-OptimizationObjectText -Object $existingHostState -Name 'applicationIsolationRoot'
    $activationJournal.oldHostReleaseInProgress = $true
    Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'old-host-release-starting'
    Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'old-host-draining'
    Invoke-OptimizationHostDrain -StatePath $existingHostManagerStatePath -TokenPath $tokenPath -DeadlineSeconds 10 | Out-Null
    Stop-OptimizationOwnedState -StatePath $existingHostManagerStatePath -ProfileId $profileId | Out-Null
    if (-not (Wait-OptimizationTcpPortFree -Port $existingHostPort -TimeoutSeconds 5)) {
      throw 'Previous optimization Host did not release its host port before promotion.'
    }
    $oldHostStoppedForHandoff = $true
    $activationJournal.oldHostReleaseInProgress = $false
    $activationJournal.oldHostReleasedForPromotion = $true
    Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'old-host-released'
    if ([string]$env:READ_WEB_OPTIMIZATION_TEST_FAILURE -eq 'promotion') {
      throw 'Synthetic optimization promotion failure.'
    }

    Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'promotion-starting'
    $newPair = Start-OptimizationOwnedPair `
      -Release $newRelease `
      -ProfileId $profileId `
      -InstanceId $newInstanceId `
      -ServiceToken $newToken `
      -FrontendHost $frontendHost `
      -FrontendPort $newHostPort `
      -BackendHost $backendHost `
      -BackendPort $backendPort `
      -PythonPath $pythonPath `
      -NodePath $nodePath `
      -CapabilityScript $capabilityScript `
      -WorkflowRoot $workflowRoot `
      -ProjectRoot $projectRoot `
      -ApplicationIsolationRoot $newApplicationIsolationRoot `
      -ApplicationProfileDir $newApplicationProfileDir `
      -ApplicationProfileAuthorityRoot $applicationProfileAuthorityRoot `
      -ApplicationProfileAuthorityIsolationRoot $applicationProfileAuthorityIsolationRoot `
      -ApplicationPythonStateDir $newApplicationPythonStateDir `
      -ApplicationPythonOutputDir $newApplicationPythonOutputDir `
      -HostStatePath $newHostManagerStatePath `
      -CapabilityStatePath $capabilityStatePath `
      -LogRoot $logRoot `
      -HostHealthUrl $newHostHealthUrl `
      -WorkflowHealthUrl $newWorkflowHealthUrl `
      -CapabilityHealthUrl $newCapabilityHealthUrl `
      -CapabilityBaseUrl ("http://$(Format-OptimizationUrlHost -HostName $backendHost):$backendPort") `
      -StartupTimeoutSeconds $StartupTimeoutSeconds `
      -ReservedPorts $reservedDailyPorts `
      -ExpectedDataRoot $defaultOptimizationDataRoot `
      -ApplicationProfileLeaseMode 'authoritative'
    $newHostState = Read-OptimizationJsonFile -Path $newHostManagerStatePath
    if ($null -eq $newHostState) { throw 'Promoted optimization Host returned ready without an owned state file.' }
    if ((Get-OptimizationObjectText -Object $newPair.health -Name 'profileLeaseMode') -ne 'authoritative' `
      -or -not [bool](Get-OptimizationObjectValue -Object $newPair.health -Name 'profileLeaseReady')) {
      throw 'Optimization Host promotion did not acquire the stable profile authority lease.'
    }
    Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'promotion-ready'
  }
  if ((Get-OptimizationObjectText -Object $newPair.health -Name 'profileLeaseMode') -ne 'authoritative' `
    -or -not [bool](Get-OptimizationObjectValue -Object $newPair.health -Name 'profileLeaseReady') `
    -or -not [bool](Get-OptimizationObjectValue -Object $newPair.health -Name 'profileLeaseAlive')) {
    throw 'Optimization activation requires an authoritative stable profile lease before target publication.'
  }
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'target-pending'
  Write-OptimizationFrontDoorTarget `
    -Path $frontDoorTargetPath `
    -HostName $frontendHost `
    -Port $newHostPort `
    -ReleaseId ([string]$newRelease.releaseId) `
    -ProfileId $profileId `
    -InstanceId $newInstanceId
  $frontDoorTargetSwitched = $true
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'target-switched'
  Invoke-OptimizationCrashPoint -Phase 'target'
  if ([string]$env:READ_WEB_OPTIMIZATION_TEST_FAILURE -eq 'switch') {
    throw 'Synthetic active target switch failure.'
  }

  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'active-release-pending'
  Write-OptimizationActiveRelease -Path $activeReleasePath -Release $newRelease -ProfileId $profileId
  $activeReleaseSwitched = $true
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'active-release-switched'
  Invoke-OptimizationCrashPoint -Phase 'active-release'
  if ([string]$env:READ_WEB_OPTIMIZATION_TEST_FAILURE -eq 'active-pointer') {
    throw 'Synthetic active release pointer failure.'
  }
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'active-host-pending'
  if ([string]$env:READ_WEB_OPTIMIZATION_TEST_FAILURE -eq 'host-state') {
    throw 'Synthetic active host state failure.'
  }
  Write-OptimizationActiveHostState -Path $hostStatePath -ManagerStatePath $newHostManagerStatePath -ProfileId $profileId
  $activeHostStateSwitched = $true
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'switching' -Phase 'active-host-switched'
  Invoke-OptimizationCrashPoint -Phase 'active-host'
  $activationReady = Test-OptimizationActivationPairReady -Journal $activationJournal
  if (-not $activationReady) {
    throw 'Atomic optimization activation readiness/coherence validation failed before commit.'
  }
  # The committed journal is the durable commit intent.  Persist it before
  # publishing the committed target so a crash after that target is visible
  # can only take the forward-recovery branch.
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'committed' -Phase 'commit-pointer-pending'
  Write-OptimizationFrontDoorTarget `
    -Path $frontDoorCommittedTargetPath `
    -HostName $frontendHost `
    -Port $newHostPort `
    -ReleaseId ([string]$newRelease.releaseId) `
    -ProfileId $profileId `
    -InstanceId $newInstanceId
  $frontDoorCommittedTargetSwitched = $true
  Set-OptimizationActivationJournal -Journal $activationJournal -Status 'committed' -Phase 'commit-pointer-switched'
  Invoke-OptimizationCrashPoint -Phase 'commit-pointer'

  if ($null -ne $existingHostState -and $existingHostManagerStatePath -ne $newHostManagerStatePath) {
    $oldIsolationRoot = Get-OptimizationObjectText -Object $existingHostState -Name 'applicationIsolationRoot'
    if (-not $oldHostStoppedForHandoff) {
      $drain = Invoke-OptimizationHostDrain -StatePath $existingHostManagerStatePath -TokenPath $tokenPath -DeadlineSeconds 10
      Write-Host "Drained old optimization Host before stop: status=$($drain.status) inflight=$($drain.inflight) forced=$($drain.forced)."
      Stop-OptimizationOwnedState -StatePath $existingHostManagerStatePath -ProfileId $profileId | Out-Null
      if (-not (Wait-OptimizationTcpPortFree -Port $existingHostPort -TimeoutSeconds 5)) {
        throw 'Previous optimization Host did not release its host port after activation.'
      }
    }
    if (-not (Remove-OptimizationApplicationIsolation `
        -Root (Join-Path $defaultOptimizationDataRoot '.read-web-application\instances') `
        -Path $oldIsolationRoot)) {
      throw 'Atomic activation could not remove the previous application profile lease after drain.'
    }
  }
  Remove-OptimizationActivationJournal -Path $activationJournalPath
  $frontendUrl = "http://$(Format-OptimizationUrlHost -HostName $frontendHost):$frontendPort/"
  Write-Host "Read-Web optimization production host ready: $frontendUrl"
  Write-Host "release=$($newRelease.releaseId) profile=$profileId instance=$newInstanceId hostPort=$newHostPort"
  Write-Host "dist=$($newRelease.distRoot)"
  Write-Host "logs=$logRoot"
  if (-not $NoOpen) { Start-Process $frontendUrl }
  $launchSucceeded = $true
} catch {
  $failure = $_
  $targetRollbackFailure = $null
  $candidateStagingRoot = Get-OptimizationObjectText -Object $candidate -Name 'stagingRoot'
  if ($candidateStagingRoot -and (Test-Path -LiteralPath $candidateStagingRoot)) {
    Remove-OptimizationReleaseStaging -StagingRoot $candidateStagingRoot
  }
  $journalAtFailure = Read-OptimizationActivationJournal -Path $activationJournalPath
  if ($null -ne $journalAtFailure) {
    try {
      Invoke-OptimizationActivationRecovery
    } catch {
      $targetRollbackFailure = $_.Exception.Message
    }
  } else {
    if ($frontDoorTargetSwitched) {
      try {
        if ($oldFrontDoorTargetSnapshot) {
          Restore-JsonSnapshot -Path $frontDoorTargetPath -Snapshot $oldFrontDoorTargetSnapshot
        } else {
          Clear-OptimizationFrontDoorTarget -Path $frontDoorTargetPath
        }
      } catch {
        $targetRollbackFailure = $_.Exception.Message
      }
    }
    if ($frontDoorCommittedTargetSwitched) {
      try {
        if ($oldCommittedTargetSnapshot) {
          Restore-JsonSnapshot -Path $frontDoorCommittedTargetPath -Snapshot $oldCommittedTargetSnapshot
        } else {
          Clear-OptimizationFrontDoorTarget -Path $frontDoorCommittedTargetPath
        }
      } catch {
        $targetRollbackFailure = $_.Exception.Message
      }
    }
    if ($activeHostStateSwitched) { Restore-JsonSnapshot -Path $hostStatePath -Snapshot $oldActiveHostSnapshot }
    if ($activeReleaseSwitched) { Restore-JsonSnapshot -Path $activeReleasePath -Snapshot $oldActiveReleaseSnapshot }
    if ($newPairStarted -and $newHostManagerStatePath) {
      try { Stop-OptimizationOwnedState -StatePath $newHostManagerStatePath -ProfileId $profileId | Out-Null } catch {}
    }
    if ($newCapabilityStarted -and $newPair -and [string]$newPair.capability.status -eq 'started') {
      try { Stop-OptimizationOwnedState -StatePath $capabilityStatePath -ProfileId $profileId | Out-Null } catch {}
    }
    if ($frontDoorStarted -and $null -eq $existingHostState) {
      Clear-OptimizationFrontDoorTarget -Path $frontDoorTargetPath
      try { Stop-OptimizationOwnedState -StatePath $frontDoorStatePath -ProfileId $profileId | Out-Null } catch {}
    }
    if (-not $launchSucceeded -and -not $oldToken -and (Test-Path -LiteralPath $tokenPath)) {
      Remove-Item -LiteralPath $tokenPath -Force -ErrorAction SilentlyContinue
    }
  }
  if ($null -ne $targetRollbackFailure) {
    throw "Optimization target rollback failed: $targetRollbackFailure. Original failure: $($failure.Exception.Message)"
  }
  throw $failure
} finally {
  Restore-OptimizationProcessEnvironment -Snapshot $environmentSnapshot
}

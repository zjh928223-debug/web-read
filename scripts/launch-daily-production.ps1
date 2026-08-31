param(
  [ValidateSet('Plan', 'Apply', 'Start', 'Stop', 'Rollback')]
  [string]$Action = 'Plan',
  [switch]$ConfirmDailyProductionApply,
  [switch]$ConfirmDailyProductionRollback,
  [switch]$FixtureMode,
  [switch]$Open,
  [switch]$NoOpen,
  [string]$RuntimeConfigPath = '',
  [string]$WorkflowDataRoot = '',
  [string]$StateRoot = '',
  [string]$ReleaseRoot = '',
  [string]$StagingRoot = '',
  [string]$ApplicationIsolationRoot = '',
  [string]$LogRoot = '',
  [string]$BootstrapPython = '',
  [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$workflowRoot = Join-Path $projectRoot 'tools\subtitle-workflow'
$defaultRuntimeConfigPath = Join-Path $projectRoot 'config\runtime.daily-production.json'
$defaultDataRoot = 'E:\ReadWebData\SubtitleWorkflow-Next'
$profileId = 'daily-production'
$dailyDomains = @(
  'reader-session',
  'marks-activity',
  'passage-preview',
  'annotation',
  'vocabulary-srs',
  'workflow'
)
$reservedPorts = @(5173, 8765, 5174, 8766)
$environmentNames = @(
  'READ_WEB_RUNTIME_CONFIG', 'READ_WEB_SUBTITLE_DATA_ROOT',
  'READ_WEB_FRONTEND_HOST', 'READ_WEB_FRONTEND_PORT',
  'READ_WEB_BACKEND_HOST', 'READ_WEB_BACKEND_PORT',
  'READ_WEB_PYTHON_PATH', 'READ_WEB_PYTHON',
  'READ_WEB_RELEASE_ID', 'READ_WEB_PROFILE_ID', 'READ_WEB_INSTANCE_ID',
  'READ_WEB_SERVICE_TOKEN', 'READ_WEB_ALLOWED_ORIGIN',
  'READ_WEB_CAPABILITY_HOST', 'READ_WEB_CAPABILITY_PORT',
  'READ_WEB_APPLICATION_PROFILE_MODE', 'READ_WEB_PROXY_URL',
  'YOUTUBE_COOKIES_PATH', 'YT_DLP_PATH', 'WHISPERX_PATH', 'FFMPEG_PATH',
  'GEMINI_MODEL', 'GEMINI_BASE_URL', 'VITE_LOCAL_SERVICE_BASE_URL',
  'VITE_READ_WEB_SERVICE_TOKEN', 'ECDICT_ENABLED', 'ECDICT_DATABASE_PATH',
  'LOCAL_SENTENCE_DATABASE_PATH', 'SENTENCE_TRANSLATION_CACHE_PATH',
  'IELTS_READING_VOCABULARY_CANDIDATES_PATH'
)
$environmentSnapshot = [ordered]@{}
foreach ($name in $environmentNames) {
  $environmentSnapshot[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

Import-Module (Join-Path $PSScriptRoot 'launcher-instance-manager.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'optimization-launch-runtime.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'optimization-release.psm1') -Force -DisableNameChecking

function Resolve-DailyPath {
  param(
    [Parameter(Mandatory)][string]$Value,
    [Parameter(Mandatory)][string]$Label,
    [switch]$MustExist
  )
  try { $full = [IO.Path]::GetFullPath($Value) } catch { throw "$Label path is invalid: $Value" }
  if ($MustExist -and -not (Test-Path -LiteralPath $full)) { throw "$Label path not found: $full" }
  return $full
}

function Test-DailySamePath {
  param([Parameter(Mandatory)][string]$Left, [Parameter(Mandatory)][string]$Right)
  return (Normalize-OptimizationPath -Value $Left) -eq (Normalize-OptimizationPath -Value $Right)
}

function Test-DailyChildPath {
  param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Candidate)
  $rootPath = (Normalize-OptimizationPath -Value $Root).TrimEnd('\', '/')
  $candidatePath = Normalize-OptimizationPath -Value $Candidate
  return $candidatePath.StartsWith("$rootPath\", [StringComparison]::OrdinalIgnoreCase)
}

function Read-DailyText {
  param([Parameter(Mandatory)][string]$Path)
  return Read-OptimizationRuntimeText -Path $Path
}

function Write-DailyJson {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Value)
  Write-OptimizationRuntimeJsonAtomic -Path $Path -Value $Value
}

function Write-DailyText {
  param([Parameter(Mandatory)][string]$Path, [AllowNull()][string]$Text)
  Write-OptimizationRuntimeTextAtomic -Path $Path -Text $Text
}

function Get-DailyContext {
  $configPathValue = if ($RuntimeConfigPath) { $RuntimeConfigPath } else { $defaultRuntimeConfigPath }
  $configPath = Resolve-DailyPath -Value $configPathValue -Label 'Daily production runtime config' -MustExist
  try {
    $config = Read-OptimizationJsonFile -Path $configPath
  } catch {
    throw "Daily production runtime config is invalid: $configPath"
  }
  if ($null -eq $config -or [int]$config.schemaVersion -ne 1) {
    throw "Daily production runtime config must use schemaVersion 1: $configPath"
  }

  $configFrontend = Get-OptimizationObjectValue -Object $config -Name 'frontend'
  $configBackend = Get-OptimizationObjectValue -Object $config -Name 'backend'
  $frontendHost = Get-OptimizationObjectText -Object $configFrontend -Name 'host'
  $backendHost = Get-OptimizationObjectText -Object $configBackend -Name 'host'
  $frontendPort = [int](Get-OptimizationObjectText -Object $configFrontend -Name 'port')
  $backendPort = [int](Get-OptimizationObjectText -Object $configBackend -Name 'port')
  if (-not (Test-OptimizationLoopbackHost -HostName $frontendHost) -or -not (Test-OptimizationLoopbackHost -HostName $backendHost)) {
    throw 'Daily production requires loopback frontend and backend hosts.'
  }
  if ($frontendPort -lt 1 -or $backendPort -lt 1) { throw 'Daily production runtime ports must be valid.' }

  $configuredDataRoot = Get-OptimizationObjectText -Object $config -Name 'dataRoot'
  if (-not $configuredDataRoot) { throw 'Daily production runtime config must declare dataRoot.' }
  $dataRootValue = if ($WorkflowDataRoot) { $WorkflowDataRoot } else { $configuredDataRoot }
  $dataRoot = Resolve-DailyPath -Value $dataRootValue -Label 'Daily production workflow data root'
  $defaultConfig = Test-DailySamePath -Left $configPath -Right $defaultRuntimeConfigPath
  $defaultContract = $defaultConfig `
    -and (Test-DailySamePath -Left $dataRoot -Right $defaultDataRoot) `
    -and $frontendPort -eq 5174 `
    -and $backendPort -eq 8766 `
    -and (Test-DailySamePath -Left $configuredDataRoot -Right $defaultDataRoot)
  $defaultStateRoot = Join-Path $projectRoot ".codex\runtime-state\$profileId"
  $defaultReleaseRoot = Join-Path $projectRoot ".codex\releases\$profileId"
  $defaultStagingRoot = Join-Path $projectRoot ".codex\release-staging\$profileId"
  $defaultApplicationRoot = Join-Path $dataRoot '.read-web-application'
  $defaultLogRoot = Join-Path $projectRoot ".codex\startup-logs\$profileId"
  $hasOverride = ($RuntimeConfigPath -and -not (Test-DailySamePath -Left $configPath -Right $defaultRuntimeConfigPath)) `
    -or ($WorkflowDataRoot -and -not (Test-DailySamePath -Left $dataRoot -Right $defaultDataRoot)) `
    -or ($StateRoot -and -not (Test-DailySamePath -Left $StateRoot -Right $defaultStateRoot)) `
    -or ($ReleaseRoot -and -not (Test-DailySamePath -Left $ReleaseRoot -Right $defaultReleaseRoot)) `
    -or ($StagingRoot -and -not (Test-DailySamePath -Left $StagingRoot -Right $defaultStagingRoot)) `
    -or ($ApplicationIsolationRoot -and -not (Test-DailySamePath -Left $ApplicationIsolationRoot -Right $defaultApplicationRoot)) `
    -or ($LogRoot -and -not (Test-DailySamePath -Left $LogRoot -Right $defaultLogRoot))
  if (-not $defaultContract -and -not $FixtureMode) {
    throw 'Non-default daily-production paths require explicit -FixtureMode; the formal Apply path is fixed to 5174/8766 and SubtitleWorkflow-Next.'
  }
  if ($defaultContract -and $hasOverride -and -not $FixtureMode) {
    throw 'Path overrides require explicit -FixtureMode; the formal daily-production profile is fixed and isolated.'
  }

  $stateRootValue = if ($StateRoot) { $StateRoot } else { $defaultStateRoot }
  $releaseRootValue = if ($ReleaseRoot) { $ReleaseRoot } else { $defaultReleaseRoot }
  $stagingRootValue = if ($StagingRoot) { $StagingRoot } else { $defaultStagingRoot }
  $applicationRootValue = if ($ApplicationIsolationRoot) { $ApplicationIsolationRoot } else { Join-Path $dataRoot '.read-web-application' }
  $logRootValue = if ($LogRoot) { $LogRoot } else { $defaultLogRoot }
  $stateRoot = Resolve-DailyPath -Value $stateRootValue -Label 'Daily production state root'
  $releaseRoot = Resolve-DailyPath -Value $releaseRootValue -Label 'Daily production release root'
  $stagingRoot = Resolve-DailyPath -Value $stagingRootValue -Label 'Daily production staging root'
  $applicationRoot = Resolve-DailyPath -Value $applicationRootValue -Label 'Daily production application isolation root'
  $logRoot = Resolve-DailyPath -Value $logRootValue -Label 'Daily production log root'

  $runtimeTools = Get-OptimizationObjectValue -Object $config -Name 'tools'
  $pythonConfig = Get-OptimizationObjectValue -Object $config -Name 'python'
  $network = Get-OptimizationObjectValue -Object $config -Name 'network'
  $ai = Get-OptimizationObjectValue -Object $config -Name 'ai'
  return [pscustomobject]@{
    projectRoot = $projectRoot
    workflowRoot = $workflowRoot
    runtimeConfigPath = $configPath
    config = $config
    frontendHost = $frontendHost
    frontendPort = $frontendPort
    backendHost = $backendHost
    backendPort = $backendPort
    dataRoot = $dataRoot
    dataRootIdentity = Get-OptimizationPathIdentity -Value $dataRoot
    stateRoot = $stateRoot
    releaseRoot = $releaseRoot
    stagingRoot = $stagingRoot
    applicationIsolationRoot = $applicationRoot
    applicationProfileAuthorityRoot = Join-Path $applicationRoot "profiles\$profileId"
    logRoot = $logRoot
    runtimeMode = if ($defaultContract) { 'daily-production' } else { 'fixture' }
    fixtureMode = [bool]$FixtureMode
    hasOverride = $hasOverride
    allowReservedDailyPorts = $defaultContract
    tools = $runtimeTools
    pythonConfig = $pythonConfig
    network = $network
    ai = $ai
    capabilityScript = Join-Path $projectRoot 'tools\local-capability-host.mjs'
    backupScript = Join-Path $projectRoot 'scripts\lib\read-web-production-backup.mjs'
    dailyProfileInitializer = Join-Path $projectRoot 'scripts\initialize-daily-production-application-profile.mjs'
    releaseHealthScript = Join-Path $projectRoot 'scripts\release-health-check.mjs'
    hostStatePath = Join-Path $stateRoot 'production-host.json'
    capabilityStatePath = Join-Path $stateRoot 'capability-host.json'
    tokenPath = Join-Path $stateRoot 'production-host.token'
    activeTargetPath = Join-Path $stateRoot 'active-target.json'
    rollbackTargetPath = Join-Path $stateRoot 'rollback-target.json'
    journalPath = Join-Path $stateRoot 'promotion-journal.json'
    reservedPorts = $reservedPorts
  }
}

function Get-DailyHealthUrl {
  param([Parameter(Mandatory)][string]$HostName, [Parameter(Mandatory)][int]$Port, [string]$Path = '/api/app/health')
  return "http://$(Format-OptimizationUrlHost -HostName $HostName):$Port$Path"
}

function Test-DailyProcessReceipt {
  param([Parameter(Mandatory)]$State)
  $pidText = Get-OptimizationObjectText -Object $State -Name 'pid'
  $startText = Get-OptimizationObjectText -Object $State -Name 'processStartUtc'
  $filePath = Get-OptimizationObjectText -Object $State -Name 'filePath'
  if (-not $pidText -or -not $startText -or -not $filePath) { return $false }
  $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }
  try {
    $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    $expected = ([DateTimeOffset]::Parse($startText, [Globalization.CultureInfo]::InvariantCulture, $styles)).UtcDateTime
    if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $expected).TotalMilliseconds) -gt 1000) { return $false }
    $arguments = @((Get-OptimizationObjectValue -Object $State -Name 'argumentList') | ForEach-Object { [string]$_ })
    if (-not (Test-ManagedProcessExecutable -Process $process -ExpectedFilePath $filePath -ExpectedArgumentFragments $arguments)) { return $false }
  } catch { return $false }
  return $true
}

function Test-DailyOwnerRecordMatchesState {
  param([Parameter(Mandatory)]$State, [Parameter(Mandatory)]$Owner)
  foreach ($field in @('releaseId', 'profileId', 'instanceId', 'port', 'pid', 'processStartUtc', 'executableIdentity', 'filePath', 'workingDirectory', 'healthUrl')) {
    if ([string](Get-OptimizationObjectText -Object $State -Name $field) -ne [string](Get-OptimizationObjectText -Object $Owner -Name $field)) { return $false }
  }
  $stateArguments = @((Get-OptimizationObjectValue -Object $State -Name 'argumentList') | ForEach-Object { [string]$_ })
  $ownerArguments = @((Get-OptimizationObjectValue -Object $Owner -Name 'argumentList') | ForEach-Object { [string]$_ })
  if ($stateArguments.Count -ne $ownerArguments.Count) { return $false }
  for ($index = 0; $index -lt $stateArguments.Count; $index += 1) {
    if ($stateArguments[$index] -cne $ownerArguments[$index]) { return $false }
  }
  return $true
}

function Get-DailyEndpointPreflight {
  param(
    [Parameter(Mandatory)]$Context,
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$HostName,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$StatePath
  )
  $healthUrl = Get-DailyHealthUrl -HostName $HostName -Port $Port
  $state = Read-OptimizationJsonFile -Path $StatePath
  $health = Get-OptimizationHttpJson -Url $healthUrl
  $occupied = Test-OptimizationTcpPortOccupied -Port $Port
  $identityMatches = $null -ne $state `
    -and [string](Get-OptimizationObjectText -Object $state -Name 'profileId') -eq $profileId `
    -and [int](Get-OptimizationObjectText -Object $state -Name 'port') -eq $Port `
    -and (Get-OptimizationObjectText -Object $state -Name 'instanceId') `
    -and $null -ne $health `
    -and [string](Get-OptimizationObjectText -Object $health -Name 'profileId') -eq $profileId `
    -and [string](Get-OptimizationObjectText -Object $health -Name 'instanceId') -eq [string](Get-OptimizationObjectText -Object $state -Name 'instanceId') `
    -and [string](Get-OptimizationObjectText -Object $health -Name 'status') -in @('ok', 'ready')
  $receiptMatches = $identityMatches -and (Test-DailyProcessReceipt -State $state)
  $classification = if (-not $occupied) {
    if ($null -ne $state) { 'free-with-stale-state' } else { 'free' }
  } elseif ($receiptMatches) {
    'owned-process'
  } else {
    'unknown-process'
  }
  return [pscustomobject]@{
    name = $Name
    host = $HostName
    port = $Port
    healthUrl = $healthUrl
    statePath = $StatePath
    occupied = $occupied
    classification = $classification
    owned = $receiptMatches
    processIdentity = if ($receiptMatches) {
      [ordered]@{
        pid = [int](Get-OptimizationObjectText -Object $state -Name 'pid')
        processStartUtc = Get-OptimizationObjectText -Object $state -Name 'processStartUtc'
        executableIdentity = Get-OptimizationObjectText -Object $state -Name 'executableIdentity'
        filePath = Get-OptimizationObjectText -Object $state -Name 'filePath'
        argumentList = @((Get-OptimizationObjectValue -Object $state -Name 'argumentList') | ForEach-Object { [string]$_ })
      }
    } else { $null }
    state = $state
    health = $health
  }
}

function Get-DailyOwnerAuthority {
  param($Health)
  $ownerMode = Get-OptimizationObjectValue -Object $Health -Name 'ownerMode'
  $rawAuthoritative = Get-OptimizationObjectValue -Object $ownerMode -Name 'authoritativeDomains'
  $authoritative = if ($null -eq $rawAuthoritative) {
    @()
  } else {
    @($rawAuthoritative | ForEach-Object { if (-not [string]::IsNullOrWhiteSpace([string]$_)) { [string]$_ } } | Sort-Object -Unique)
  }
  $missing = @($dailyDomains | Where-Object { $authoritative -notcontains $_ })
  return [ordered]@{
    status = if ($missing.Count -eq 0) { 'host-api-authoritative' } else { 'legacy-browser-owner/pre-cutover' }
    authoritativeDomains = $authoritative
    requiredDomains = @($dailyDomains)
    missingDomains = $missing
    source = 'production-host-health.ownerMode'
  }
}

function ConvertTo-DailyEndpointPlan {
  param([Parameter(Mandatory)]$Endpoint)
  $health = $Endpoint.health
  return [ordered]@{
    name = $Endpoint.name
    host = $Endpoint.host
    port = $Endpoint.port
    healthUrl = $Endpoint.healthUrl
    statePath = $Endpoint.statePath
    occupied = $Endpoint.occupied
    classification = $Endpoint.classification
    owned = $Endpoint.owned
    statePresent = $null -ne $Endpoint.state
    healthStatus = Get-OptimizationObjectText -Object $health -Name 'status'
    healthProfileId = Get-OptimizationObjectText -Object $health -Name 'profileId'
    healthInstanceId = Get-OptimizationObjectText -Object $health -Name 'instanceId'
    processIdentity = $Endpoint.processIdentity
  }
}

function Get-DailyPreflight {
  param([Parameter(Mandatory)]$Context)
  $frontend = Get-DailyEndpointPreflight `
    -Context $Context `
    -Name 'frontend-host' `
    -HostName $Context.frontendHost `
    -Port $Context.frontendPort `
    -StatePath $Context.hostStatePath
  $backend = Get-DailyEndpointPreflight `
    -Context $Context `
    -Name 'capability-host' `
    -HostName $Context.backendHost `
    -Port $Context.backendPort `
    -StatePath $Context.capabilityStatePath
  $active = Read-OptimizationJsonFile -Path $Context.activeTargetPath
  $journal = Read-OptimizationJsonFile -Path $Context.journalPath
  $dataRootExists = Test-Path -LiteralPath $Context.dataRoot -PathType Container
  $ownerAuthority = Get-DailyOwnerAuthority -Health $frontend.health
  $blockers = @()
  if (-not $dataRootExists) { $blockers += "workflow data root is missing: $($Context.dataRoot)" }
  foreach ($endpoint in @($frontend, $backend)) {
    if ($endpoint.classification -eq 'unknown-process') {
      $blockers += "$($endpoint.name) port $($endpoint.port) is occupied by an unknown process; it will not be stopped"
    } elseif ($endpoint.classification -eq 'owned-process') {
      $blockers += "$($endpoint.name) port $($endpoint.port) is already owned; explicit Stop is required before Apply"
    }
  }
  if ($null -ne $journal) { $blockers += "an unfinished promotion journal exists: $($Context.journalPath)" }
  $activeStatus = Get-OptimizationObjectText -Object $active -Name 'status'
  if ($Action -eq 'Apply' -and $activeStatus -in @('active', 'stopped')) {
    $blockers += "an existing daily-production target is retained at $($Context.activeTargetPath); use Start or Rollback"
  }
  return [ordered]@{
    status = 'preflight'
    action = $Action
    profileId = $profileId
    runtimeMode = $Context.runtimeMode
    fixtureMode = [bool]$Context.fixtureMode
    runtimeConfigPath = $Context.runtimeConfigPath
    frontend = ConvertTo-DailyEndpointPlan -Endpoint $frontend
    backend = ConvertTo-DailyEndpointPlan -Endpoint $backend
    dataRoot = $Context.dataRoot
    dataRootIdentity = $Context.dataRootIdentity
    dataRootExists = $dataRootExists
    applicationIsolationRoot = $Context.applicationIsolationRoot
    applicationIsolationRootIdentity = Get-OptimizationPathIdentity -Value $Context.applicationIsolationRoot
    applicationProfileAuthorityRoot = $Context.applicationProfileAuthorityRoot
    applicationProfileAuthorityRootIdentity = Get-OptimizationPathIdentity -Value $Context.applicationProfileAuthorityRoot
    activeTargetPath = $Context.activeTargetPath
    activeTargetStatus = if ($activeStatus) { $activeStatus } else { 'absent' }
    journalPath = $Context.journalPath
    builtDistHost = [ordered]@{
      required = $true
      hostKind = 'youtube_workflow.production_host_prototype'
      verification = 'Apply verifies served index is built-dist before target commit'
    }
    ownerAuthority = $ownerAuthority
    readyForApply = $blockers.Count -eq 0
    blockers = @($blockers)
    sideEffects = @('none')
  }
}

function Resolve-DailyConfiguredExecutable {
  param([AllowEmptyString()][string]$Value, [Parameter(Mandatory)][string]$Label, [switch]$Optional)
  if (-not $Value) {
    if ($Optional) { return '' }
    throw "$Label executable is not configured."
  }
  $candidate = $Value
  if (-not [IO.Path]::IsPathRooted($candidate)) {
    $relativeCandidate = Join-Path (Split-Path -Parent $script:dailyContext.runtimeConfigPath) $candidate
    if (Test-Path -LiteralPath $relativeCandidate -PathType Leaf) { $candidate = $relativeCandidate }
  }
  if ($Optional) {
    try { return Resolve-OptimizationExecutablePath -Value $candidate -Label $Label } catch { return '' }
  }
  return Resolve-OptimizationExecutablePath -Value $candidate -Label $Label
}

function Get-DailyToolchain {
  param([Parameter(Mandatory)]$Context)
  $script:dailyContext = $Context
  $nodePath = Resolve-OptimizationExecutablePath -Value 'node' -Label 'Node'
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($null -eq $npmCommand) { $npmCommand = Get-Command npm -ErrorAction Stop }
  $pythonPath = Resolve-OptimizationDailyPython -RuntimeConfigPath $Context.runtimeConfigPath -RequestedPath $BootstrapPython
  $toolchainCheck = Assert-OptimizationReleaseToolchain `
    -ProjectRoot $Context.projectRoot `
    -WorkflowRoot $Context.workflowRoot `
    -RuntimeConfigPath $Context.runtimeConfigPath `
    -NodePath $nodePath `
    -NpmPath ([string]$npmCommand.Source) `
    -PythonPath $pythonPath
  $pythonPath = [string]$toolchainCheck.pythonPath
  $tools = $Context.tools
  return [pscustomobject]@{
    nodePath = $nodePath
    npmPath = [string]$npmCommand.Source
    pythonPath = $pythonPath
    ffmpegPath = Resolve-DailyConfiguredExecutable -Value (Get-OptimizationObjectText -Object $tools -Name 'ffmpeg') -Label 'ffmpeg' -Optional
    ytDlpPath = Resolve-DailyConfiguredExecutable -Value (Get-OptimizationObjectText -Object $tools -Name 'ytDlp') -Label 'yt-dlp' -Optional
    whisperxPath = Resolve-DailyConfiguredExecutable -Value (Get-OptimizationObjectText -Object $tools -Name 'whisperx') -Label 'whisperx' -Optional
  }
}

function Set-DailyEnvironment {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Toolchain, [string]$ServiceToken = '')
  foreach ($name in $environmentNames) { Set-OptimizationProcessEnvironmentValue -Name $name -Value $null }
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_RUNTIME_CONFIG' -Value $Context.runtimeConfigPath
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_SUBTITLE_DATA_ROOT' -Value $Context.dataRoot
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_FRONTEND_HOST' -Value $Context.frontendHost
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_FRONTEND_PORT' -Value ([string]$Context.frontendPort)
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_BACKEND_HOST' -Value $Context.backendHost
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_BACKEND_PORT' -Value ([string]$Context.backendPort)
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_PYTHON' -Value $Toolchain.pythonPath
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_PYTHON_PATH' -Value $Toolchain.pythonPath
  Set-OptimizationProcessEnvironmentValue -Name 'VITE_LOCAL_SERVICE_BASE_URL' -Value "http://$(Format-OptimizationUrlHost -HostName $Context.frontendHost):$($Context.frontendPort)"
  Set-OptimizationProcessEnvironmentValue -Name 'ECDICT_ENABLED' -Value 'false'
  if ($ServiceToken) { Set-OptimizationProcessEnvironmentValue -Name 'VITE_READ_WEB_SERVICE_TOKEN' -Value $ServiceToken }
  $proxyUrl = Get-OptimizationObjectText -Object $Context.network -Name 'proxyUrl'
  if ($proxyUrl) { Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_PROXY_URL' -Value $proxyUrl }
  $model = Get-OptimizationObjectText -Object $Context.ai -Name 'model'
  $baseUrl = Get-OptimizationObjectText -Object $Context.ai -Name 'baseUrl'
  if ($model) { Set-OptimizationProcessEnvironmentValue -Name 'GEMINI_MODEL' -Value $model }
  if ($baseUrl) { Set-OptimizationProcessEnvironmentValue -Name 'GEMINI_BASE_URL' -Value $baseUrl }
  if ($Toolchain.ffmpegPath) { Set-OptimizationProcessEnvironmentValue -Name 'FFMPEG_PATH' -Value $Toolchain.ffmpegPath }
  if ($Toolchain.ytDlpPath) { Set-OptimizationProcessEnvironmentValue -Name 'YT_DLP_PATH' -Value $Toolchain.ytDlpPath }
  if ($Toolchain.whisperxPath) { Set-OptimizationProcessEnvironmentValue -Name 'WHISPERX_PATH' -Value $Toolchain.whisperxPath }
}

function Get-DailyReleaseFields {
  param([Parameter(Mandatory)]$Release)
  return [ordered]@{
    releaseId = [string]$Release.releaseId
    releaseRoot = [string]$Release.releaseRoot
    distRoot = [string]$Release.distRoot
    manifestPath = [string]$Release.manifestPath
    manifestSha256 = [string]$Release.manifestSha256
    sourceSha256 = [string]$Release.sourceSha256
    distSha256 = [string]$Release.distSha256
  }
}

function Get-DailyReleaseFromTarget {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Target, [Parameter(Mandatory)]$Toolchain)
  Assert-DailyTargetIdentity -Context $Context -Target $Target
  $releaseRoot = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'release') -Name 'releaseRoot'
  if (-not $releaseRoot -or -not (Test-DailyChildPath -Root $Context.releaseRoot -Candidate $releaseRoot)) { throw 'Daily production target release points outside its release root.' }
  $release = Get-OptimizationReleaseDescriptor -ReleaseRoot $releaseRoot
  $integrity = Test-OptimizationReleaseIntegrity -Release $release -NodePath $Toolchain.nodePath -ReleaseHealthScript $Context.releaseHealthScript
  if (-not $integrity.passed -or -not (Test-OptimizationReleaseCompatibility -Release $release)) {
    throw 'Daily production target release failed integrity or compatibility validation.'
  }
  if ([string]$release.releaseId -ne [string](Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'release') -Name 'releaseId')) {
    throw 'Daily production target release identity mismatch.'
  }
  return $release
}

function Set-DailyProcessOwnerEnvironment {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Release, [Parameter(Mandatory)][string]$Token)
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_RELEASE_ID' -Value ([string]$Release.releaseId)
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_PROFILE_ID' -Value $profileId
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_SERVICE_TOKEN' -Value $Token
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_ALLOWED_ORIGIN' -Value "http://$(Format-OptimizationUrlHost -HostName $Context.frontendHost):$($Context.frontendPort)"
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_CAPABILITY_HOST' -Value $Context.backendHost
  Set-OptimizationProcessEnvironmentValue -Name 'READ_WEB_CAPABILITY_PORT' -Value ([string]$Context.backendPort)
}

function Start-DailyPair {
  param(
    [Parameter(Mandatory)]$Context,
    [Parameter(Mandatory)]$Release,
    [Parameter(Mandatory)]$Toolchain,
    [Parameter(Mandatory)][string]$Token,
    [Parameter(Mandatory)][string]$InstanceId
  )
  $instanceRoot = Join-Path $Context.applicationIsolationRoot "instances\$InstanceId"
  if (-not (Test-DailyChildPath -Root (Join-Path $Context.applicationIsolationRoot 'instances') -Candidate $instanceRoot)) {
    throw 'Daily production instance root escaped the application isolation root.'
  }
  $profileDir = Join-Path $instanceRoot 'profile'
  $pythonStateDir = Join-Path $instanceRoot 'python-state'
  $pythonOutputDir = Join-Path $instanceRoot 'python-output'
  $hostHealthUrl = Get-DailyHealthUrl -HostName $Context.frontendHost -Port $Context.frontendPort
  $workflowHealthUrl = Get-DailyHealthUrl -HostName $Context.frontendHost -Port $Context.frontendPort -Path '/api/health'
  $capabilityHealthUrl = Get-DailyHealthUrl -HostName $Context.backendHost -Port $Context.backendPort
  $tokenParent = Split-Path -Parent $Context.tokenPath
  New-Item -ItemType Directory -Force -Path $tokenParent | Out-Null
  Set-DailyProcessOwnerEnvironment -Context $Context -Release $Release -Token $Token
  return Start-OptimizationOwnedPair `
    -Release $Release `
    -ProfileId $profileId `
    -InstanceId $InstanceId `
    -ServiceToken $Token `
    -FrontendHost $Context.frontendHost `
    -FrontendPort $Context.frontendPort `
    -BackendHost $Context.backendHost `
    -BackendPort $Context.backendPort `
    -PythonPath $Toolchain.pythonPath `
    -NodePath $Toolchain.nodePath `
    -CapabilityScript $Context.capabilityScript `
    -WorkflowRoot $Context.workflowRoot `
    -ProjectRoot $Context.projectRoot `
    -ApplicationIsolationRoot $instanceRoot `
    -ApplicationProfileDir $profileDir `
    -ApplicationProfileAuthorityRoot $Context.applicationProfileAuthorityRoot `
    -ApplicationProfileAuthorityIsolationRoot $Context.applicationIsolationRoot `
    -ApplicationPythonStateDir $pythonStateDir `
    -ApplicationPythonOutputDir $pythonOutputDir `
    -HostStatePath $Context.hostStatePath `
    -CapabilityStatePath $Context.capabilityStatePath `
    -LogRoot $Context.logRoot `
    -HostHealthUrl $hostHealthUrl `
    -WorkflowHealthUrl $workflowHealthUrl `
    -CapabilityHealthUrl $capabilityHealthUrl `
    -CapabilityBaseUrl "http://$(Format-OptimizationUrlHost -HostName $Context.backendHost):$($Context.backendPort)" `
    -StartupTimeoutSeconds $StartupTimeoutSeconds `
    -ReservedPorts $Context.reservedPorts `
    -ExpectedDataRoot $Context.dataRoot `
    -ApplicationProfileInitializer $Context.dailyProfileInitializer `
    -ApplicationProfileLeaseMode 'authoritative' `
    -AllowReservedDailyPorts:$Context.allowReservedDailyPorts
}

function Test-DailyPairIdentity {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Release, [Parameter(Mandatory)]$Token)
  $hostState = Read-OptimizationJsonFile -Path $Context.hostStatePath
  $capabilityState = Read-OptimizationJsonFile -Path $Context.capabilityStatePath
  $hostHealthUrl = Get-DailyHealthUrl -HostName $Context.frontendHost -Port $Context.frontendPort
  $capabilityHealthUrl = Get-DailyHealthUrl -HostName $Context.backendHost -Port $Context.backendPort
  $hostHealth = Get-OptimizationHttpJson -Url $hostHealthUrl
  $capabilityHealth = Get-OptimizationHttpJson -Url $capabilityHealthUrl
  if (-not (Test-OptimizationPairReady `
      -HostState $hostState `
      -CapabilityState $capabilityState `
      -HostHealth $hostHealth `
      -CapabilityHealth $capabilityHealth `
      -Release $Release `
      -ProfileId $profileId `
      -TokenPath $Context.tokenPath `
      -ExpectedDataRoot $Context.dataRoot)) {
    throw 'Daily production pair failed owned-state, health, profile, release, or data-root identity validation.'
  }
  if (-not (Test-DailyProcessReceipt -State $hostState) -or -not (Test-DailyProcessReceipt -State $capabilityState)) {
    throw 'Daily production pair process start identity could not be proven.'
  }
  $index = Invoke-WebRequest -Uri "http://$(Format-OptimizationUrlHost -HostName $Context.frontendHost):$($Context.frontendPort)/" -UseBasicParsing -TimeoutSec 2
  if ($index.StatusCode -ne 200 -or $index.Content -match '@vite/client|src/main\.js') { throw 'Daily production requires a built-dist Host; Vite development content was detected.' }
  return [pscustomobject]@{
    hostState = $hostState
    capabilityState = $capabilityState
    hostHealth = $hostHealth
    capabilityHealth = $capabilityHealth
    ownerAuthority = Get-DailyOwnerAuthority -Health $hostHealth
  }
}

function ConvertTo-DailyOwnerRecord {
  param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$HealthUrl, [Parameter(Mandatory)][string]$StatePath)
  return [ordered]@{
    statePath = $StatePath
    releaseId = [string]$State.releaseId
    profileId = [string]$State.profileId
    instanceId = [string]$State.instanceId
    port = [int]$State.port
    pid = [int]$State.pid
    processStartUtc = [string]$State.processStartUtc
    startedAtUtc = [string]$State.startedAtUtc
    executableIdentity = [string]$State.executableIdentity
    filePath = [string]$State.filePath
    argumentList = @($State.argumentList | ForEach-Object { [string]$_ })
    workingDirectory = [string]$State.workingDirectory
    healthUrl = $HealthUrl
  }
}

function ConvertTo-DailyHealthRecord {
  param([Parameter(Mandatory)]$Health, [Parameter(Mandatory)][string]$HealthUrl)
  return [ordered]@{
    url = $HealthUrl
    status = Get-OptimizationObjectText -Object $Health -Name 'status'
    releaseId = Get-OptimizationObjectText -Object $Health -Name 'releaseId'
    profileId = Get-OptimizationObjectText -Object $Health -Name 'profileId'
    instanceId = Get-OptimizationObjectText -Object $Health -Name 'instanceId'
    profileLeaseMode = Get-OptimizationObjectText -Object $Health -Name 'profileLeaseMode'
    profileLeaseReady = [bool](Get-OptimizationObjectValue -Object $Health -Name 'profileLeaseReady')
    profileLeaseAlive = [bool](Get-OptimizationObjectValue -Object $Health -Name 'profileLeaseAlive')
    distReady = [bool](Get-OptimizationObjectValue -Object $Health -Name 'distReady')
    dataRootIdentity = Get-OptimizationObjectText -Object $Health -Name 'dataRootIdentity'
  }
}

function Assert-DailyTargetIdentity {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Target)
  if ([string](Get-OptimizationObjectText -Object $Target -Name 'profileId') -ne $profileId) {
    throw 'Daily production target profile identity mismatch.'
  }
  if ([string](Get-OptimizationObjectText -Object $Target -Name 'runtimeMode') -ne $Context.runtimeMode) {
    throw 'Daily production target runtime-mode identity mismatch.'
  }
  if ([string](Get-OptimizationObjectText -Object $Target -Name 'runtimeConfigIdentity') -ne (Get-OptimizationPathIdentity -Value $Context.runtimeConfigPath)) {
    throw 'Daily production target runtime-config identity mismatch.'
  }
  if ([string](Get-OptimizationObjectText -Object $Target -Name 'dataRootIdentity') -ne $Context.dataRootIdentity) {
    throw 'Daily production target data-root identity mismatch.'
  }
  if ([string](Get-OptimizationObjectText -Object $Target -Name 'applicationIsolationRootIdentity') -ne (Get-OptimizationPathIdentity -Value $Context.applicationIsolationRoot)) {
    throw 'Daily production target application-root identity mismatch.'
  }
  if ([string](Get-OptimizationObjectText -Object $Target -Name 'applicationProfileAuthorityRootIdentity') -ne (Get-OptimizationPathIdentity -Value $Context.applicationProfileAuthorityRoot)) {
    throw 'Daily production target profile-authority identity mismatch.'
  }
  $frontend = Get-OptimizationObjectValue -Object $Target -Name 'frontend'
  $backend = Get-OptimizationObjectValue -Object $Target -Name 'backend'
  if ([string](Get-OptimizationObjectText -Object $frontend -Name 'host') -ne $Context.frontendHost -or [int](Get-OptimizationObjectText -Object $frontend -Name 'port') -ne $Context.frontendPort) {
    throw 'Daily production target frontend identity mismatch.'
  }
  if ([string](Get-OptimizationObjectText -Object $backend -Name 'host') -ne $Context.backendHost -or [int](Get-OptimizationObjectText -Object $backend -Name 'port') -ne $Context.backendPort) {
    throw 'Daily production target backend identity mismatch.'
  }
  $profile = Get-OptimizationObjectValue -Object $Target -Name 'profile'
  $instanceId = Get-OptimizationObjectText -Object $profile -Name 'instanceId'
  $instanceRoot = Get-OptimizationObjectText -Object $profile -Name 'instanceRoot'
  $instancesRoot = Join-Path $Context.applicationIsolationRoot 'instances'
  if (-not $instanceId -or -not $instanceRoot -or -not (Test-DailyChildPath -Root $instancesRoot -Candidate $instanceRoot)) {
    throw 'Daily production target instance identity is missing or outside its application root.'
  }
  if ([string](Get-OptimizationObjectText -Object $profile -Name 'profileId') -ne $profileId -or [string](Get-OptimizationObjectText -Object $profile -Name 'authorityRoot') -ne $Context.applicationProfileAuthorityRoot) {
    throw 'Daily production target profile-authority fields mismatch.'
  }
  $built = Get-OptimizationObjectValue -Object $Target -Name 'builtDistHost'
  $builtIndex = Get-OptimizationObjectText -Object $built -Name 'indexPath'
  if (-not [bool](Get-OptimizationObjectValue -Object $built -Name 'required') -or [string](Get-OptimizationObjectText -Object $built -Name 'hostKind') -ne 'youtube_workflow.production_host_prototype' -or -not $builtIndex) {
    throw 'Daily production target does not identify the required built-dist Host.'
  }
  $builtDistRoot = Get-OptimizationObjectText -Object $built -Name 'distRoot'
  if (-not $builtDistRoot -or [IO.Path]::GetFullPath($builtIndex) -ne [IO.Path]::GetFullPath((Join-Path $builtDistRoot 'index.html'))) {
    throw 'Daily production target built-dist index identity mismatch.'
  }
  $targetReleaseRoot = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'release') -Name 'releaseRoot'
  if (-not $targetReleaseRoot -or -not (Test-DailyChildPath -Root $Context.releaseRoot -Candidate $targetReleaseRoot)) {
    throw 'Daily production target release points outside its release root.'
  }
  $health = Get-OptimizationObjectValue -Object $Target -Name 'health'
  $profileRelease = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'release') -Name 'releaseId'
  foreach ($healthName in @('host', 'capability')) {
    $healthRecord = Get-OptimizationObjectValue -Object $health -Name $healthName
    if ($null -eq $healthRecord -or [string](Get-OptimizationObjectText -Object $healthRecord -Name 'status') -ne 'ready' `
      -or [string](Get-OptimizationObjectText -Object $healthRecord -Name 'releaseId') -ne $profileRelease `
      -or [string](Get-OptimizationObjectText -Object $healthRecord -Name 'profileId') -ne $profileId `
      -or [string](Get-OptimizationObjectText -Object $healthRecord -Name 'instanceId') -ne $instanceId) {
      throw "Daily production target $healthName health identity mismatch."
    }
  }
}

function New-DailyTarget {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Release, [Parameter(Mandatory)]$Pair, [Parameter(Mandatory)][string]$InstanceId, [Parameter(Mandatory)]$Toolchain)
  $hostState = $Pair.hostState
  $capabilityState = $Pair.capabilityState
  $ownerAuthority = $Pair.ownerAuthority
  return [ordered]@{
    schemaVersion = 1
    status = 'active'
    profileId = $profileId
    runtimeMode = $Context.runtimeMode
    runtimeConfigPath = $Context.runtimeConfigPath
    runtimeConfigIdentity = Get-OptimizationPathIdentity -Value $Context.runtimeConfigPath
    frontend = [ordered]@{ host = $Context.frontendHost; port = $Context.frontendPort; healthUrl = Get-DailyHealthUrl -HostName $Context.frontendHost -Port $Context.frontendPort }
    backend = [ordered]@{ host = $Context.backendHost; port = $Context.backendPort; healthUrl = Get-DailyHealthUrl -HostName $Context.backendHost -Port $Context.backendPort }
    dataRoot = $Context.dataRoot
    dataRootIdentity = $Context.dataRootIdentity
    applicationIsolationRoot = $Context.applicationIsolationRoot
    applicationIsolationRootIdentity = Get-OptimizationPathIdentity -Value $Context.applicationIsolationRoot
    applicationProfileAuthorityRoot = $Context.applicationProfileAuthorityRoot
    applicationProfileAuthorityRootIdentity = Get-OptimizationPathIdentity -Value $Context.applicationProfileAuthorityRoot
    profile = [ordered]@{
      profileId = $profileId
      instanceId = $InstanceId
      instanceRoot = Join-Path $Context.applicationIsolationRoot "instances\$InstanceId"
      profileDir = Join-Path (Join-Path $Context.applicationIsolationRoot "instances\$InstanceId") 'profile'
      authorityRoot = $Context.applicationProfileAuthorityRoot
    }
    release = Get-DailyReleaseFields -Release $Release
    runtime = [ordered]@{ nodePath = $Toolchain.nodePath; npmPath = $Toolchain.npmPath; pythonPath = $Toolchain.pythonPath }
    health = [ordered]@{
      host = ConvertTo-DailyHealthRecord -Health $Pair.hostHealth -HealthUrl (Get-DailyHealthUrl -HostName $Context.frontendHost -Port $Context.frontendPort)
      capability = ConvertTo-DailyHealthRecord -Health $Pair.capabilityHealth -HealthUrl (Get-DailyHealthUrl -HostName $Context.backendHost -Port $Context.backendPort)
    }
    hostOwner = ConvertTo-DailyOwnerRecord -State $hostState -StatePath $Context.hostStatePath -HealthUrl (Get-DailyHealthUrl -HostName $Context.frontendHost -Port $Context.frontendPort)
    capabilityOwner = ConvertTo-DailyOwnerRecord -State $capabilityState -StatePath $Context.capabilityStatePath -HealthUrl (Get-DailyHealthUrl -HostName $Context.backendHost -Port $Context.backendPort)
    ownerAuthority = $ownerAuthority
    builtDistHost = [ordered]@{
      required = $true
      hostKind = 'youtube_workflow.production_host_prototype'
      distRoot = [string]$Release.distRoot
      indexPath = Join-Path $Release.distRoot 'index.html'
    }
    rollback = [ordered]@{ statePath = $Context.rollbackTargetPath; releasePreserved = $true; dataPreserved = $true }
    appliedAtUtc = ([DateTime]::UtcNow).ToString('O')
  }
}

function Write-DailyJournal {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Journal)
  if ($Journal -is [Collections.IDictionary]) {
    $Journal['updatedAtUtc'] = ([DateTime]::UtcNow).ToString('O')
  } else {
    $Journal.updatedAtUtc = ([DateTime]::UtcNow).ToString('O')
  }
  Write-DailyJson -Path $Context.journalPath -Value $Journal
}

function Remove-DailyJournal {
  param([Parameter(Mandatory)]$Context)
  if (Test-Path -LiteralPath $Context.journalPath -PathType Leaf) { Remove-Item -LiteralPath $Context.journalPath -Force }
}

function Remove-DailyServiceToken {
  param([Parameter(Mandatory)]$Context)
  if (Test-Path -LiteralPath $Context.tokenPath -PathType Leaf) {
    Remove-Item -LiteralPath $Context.tokenPath -Force -ErrorAction Stop
  }
}

function Invoke-DailyCrashPoint {
  param([Parameter(Mandatory)][string]$Phase)
  if ([string]$env:READ_WEB_DAILY_PRODUCTION_TEST_KILL_PHASE -ne $Phase) { return }
  Write-Host "Synthetic daily-production crash at phase: $Phase"
  try { Stop-Process -Id $PID -Force -ErrorAction Stop } catch {}
  throw "Synthetic daily-production crash at phase: $Phase"
}

function New-DailyEmptyTarget {
  param([Parameter(Mandatory)]$Context)
  return [ordered]@{
    schemaVersion = 1
    status = 'empty'
    profileId = $profileId
    clearedAtUtc = ([DateTime]::UtcNow).ToString('O')
    rollbackStatePath = $Context.rollbackTargetPath
    releasePreserved = $true
    dataPreserved = $true
  }
}

function New-DailyRollbackTarget {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Target)
  $rollback = [ordered]@{}
  foreach ($property in $Target.PSObject.Properties) { $rollback[$property.Name] = $property.Value }
  $rollback.status = 'rolled-back'
  $rollback.rolledBackAtUtc = ([DateTime]::UtcNow).ToString('O')
  $rollback.sourceTargetPath = $Context.activeTargetPath
  return $rollback
}

function Assert-DailyJournalIdentity {
  param(
    [Parameter(Mandatory)]$Context,
    [Parameter(Mandatory)]$Journal,
    [Parameter(Mandatory)][string]$Operation
  )
  if ([int](Get-OptimizationObjectText -Object $Journal -Name 'schemaVersion') -ne 1) {
    throw "Daily production journal schema is unsupported; refusing recovery at $($Context.journalPath)."
  }
  if ([string](Get-OptimizationObjectText -Object $Journal -Name 'operation') -ne $Operation) {
    throw "Daily production journal operation is not $Operation; refusing recovery."
  }
  if ([string](Get-OptimizationObjectText -Object $Journal -Name 'profileId') -ne $profileId) {
    throw 'Daily production journal profile identity mismatch; refusing recovery.'
  }
  $journalRuntimeMode = Get-OptimizationObjectText -Object $Journal -Name 'runtimeMode'
  if ($journalRuntimeMode -and $journalRuntimeMode -ne $Context.runtimeMode) {
    throw 'Daily production journal runtime-mode identity mismatch; refusing recovery.'
  }
  $journalConfig = Get-OptimizationObjectText -Object $Journal -Name 'runtimeConfigPath'
  if ($journalConfig -and -not (Test-DailySamePath -Left $journalConfig -Right $Context.runtimeConfigPath)) {
    throw 'Daily production journal runtime-config identity mismatch; refusing recovery.'
  }
  $journalDataRoot = Get-OptimizationObjectText -Object $Journal -Name 'dataRootIdentity'
  if ($journalDataRoot -and $journalDataRoot -ne $Context.dataRootIdentity) {
    throw 'Daily production journal data-root identity mismatch; refusing recovery.'
  }
}

function Get-DailyJournalInstanceId {
  param([Parameter(Mandatory)]$Journal)
  $instanceId = Get-OptimizationObjectText -Object $Journal -Name 'instanceId'
  $parsed = [Guid]::Empty
  if (-not $instanceId -or -not [Guid]::TryParse($instanceId, [ref]$parsed) -or $parsed -eq [Guid]::Empty) {
    throw 'Daily production journal has no valid instance identity; refusing recovery.'
  }
  return $instanceId
}

function Remove-DailyInterruptedStateArtifacts {
  param([Parameter(Mandatory)][string]$StatePath)
  foreach ($path in @($StatePath, "$StatePath.intent.json", "$StatePath.replacement.json", "$StatePath.lock")) {
    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force -ErrorAction Stop }
  }
}

function Stop-DailyInterruptedEndpoint {
  param(
    [Parameter(Mandatory)]$Context,
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$InstanceId,
    [string]$ExpectedReleaseId = '',
    $Owner = $null
  )
  $state = Read-OptimizationJsonFile -Path $StatePath
  if ($null -eq $state) {
    if (Test-OptimizationTcpPortOccupied -Port $Port) {
      throw "Daily production port $Port is occupied without an owned state; refusing recovery cleanup."
    }
    return
  }
  if ([string](Get-OptimizationObjectText -Object $state -Name 'profileId') -ne $profileId) {
    throw "Daily production state profile mismatch at $StatePath; refusing recovery cleanup."
  }
  if ([string](Get-OptimizationObjectText -Object $state -Name 'instanceId') -ne $InstanceId) {
    throw "Daily production state instance mismatch at $StatePath; refusing recovery cleanup."
  }
  if ([int](Get-OptimizationObjectText -Object $state -Name 'port') -ne $Port) {
    throw "Daily production state port mismatch at $StatePath; refusing recovery cleanup."
  }
  if ($ExpectedReleaseId -and [string](Get-OptimizationObjectText -Object $state -Name 'releaseId') -ne $ExpectedReleaseId) {
    throw "Daily production state release mismatch at $StatePath; refusing recovery cleanup."
  }
  if ($null -ne $Owner -and -not (Test-DailyOwnerRecordMatchesState -State $state -Owner $Owner)) {
    throw "Daily production state owner receipt mismatch at $StatePath; refusing recovery cleanup."
  }

  $receiptMatches = Test-DailyProcessReceipt -State $state
  if ($receiptMatches) {
    Stop-OptimizationOwnedState -StatePath $StatePath -ProfileId $profileId | Out-Null
    if (-not (Wait-OptimizationTcpPortFree -Port $Port -TimeoutSeconds 5)) {
      throw "Owned daily-production port $Port did not close during recovery; no unknown process was stopped."
    }
    Remove-DailyInterruptedStateArtifacts -StatePath $StatePath
    return
  }

  $pidNumber = 0
  $pidText = Get-OptimizationObjectText -Object $state -Name 'pid'
  if ([int]::TryParse($pidText, [ref]$pidNumber) -and $pidNumber -gt 0) {
    $process = Get-Process -Id $pidNumber -ErrorAction SilentlyContinue
    if ($null -ne $process) {
      throw "Daily production state at $StatePath has an unproven live process; refusing recovery cleanup."
    }
  }
  if (Test-OptimizationTcpPortOccupied -Port $Port) {
    throw "Daily production port $Port remains occupied by an unproven process; refusing recovery cleanup."
  }
  Remove-DailyInterruptedStateArtifacts -StatePath $StatePath
}

function Stop-DailyInterruptedInstance {
  param(
    [Parameter(Mandatory)]$Context,
    [Parameter(Mandatory)][string]$InstanceId,
    [string]$ExpectedReleaseId = '',
    $Target = $null
  )
  $targetHostOwner = if ($null -ne $Target) { Get-OptimizationObjectValue -Object $Target -Name 'hostOwner' } else { $null }
  $targetCapabilityOwner = if ($null -ne $Target) { Get-OptimizationObjectValue -Object $Target -Name 'capabilityOwner' } else { $null }
  $hostState = Read-OptimizationJsonFile -Path $Context.hostStatePath
  if ($null -ne $hostState -and (Test-DailyProcessReceipt -State $hostState)) {
    try { Invoke-OptimizationHostDrain -StatePath $Context.hostStatePath -TokenPath $Context.tokenPath -DeadlineSeconds 10 | Out-Null } catch {}
  }
  Stop-DailyInterruptedEndpoint `
    -Context $Context `
    -StatePath $Context.hostStatePath `
    -Port $Context.frontendPort `
    -InstanceId $InstanceId `
    -ExpectedReleaseId $ExpectedReleaseId `
    -Owner $targetHostOwner
  Stop-DailyInterruptedEndpoint `
    -Context $Context `
    -StatePath $Context.capabilityStatePath `
    -Port $Context.backendPort `
    -InstanceId $InstanceId `
    -ExpectedReleaseId $ExpectedReleaseId `
    -Owner $targetCapabilityOwner
  $instanceRoot = Join-Path $Context.applicationIsolationRoot "instances\$InstanceId"
  Remove-DailyInstanceRoot -Context $Context -InstanceRoot $instanceRoot
}

function Test-DailyApplyCandidateTarget {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Journal, [Parameter(Mandatory)]$Target)
  if ([string](Get-OptimizationObjectText -Object $Target -Name 'status') -ne 'active') {
    throw 'Daily production Apply journal points to a non-active candidate target; refusing recovery.'
  }
  $instanceId = Get-DailyJournalInstanceId -Journal $Journal
  $profile = Get-OptimizationObjectValue -Object $Target -Name 'profile'
  if ([string](Get-OptimizationObjectText -Object $profile -Name 'instanceId') -ne $instanceId) {
    throw 'Daily production Apply candidate target instance mismatch; refusing recovery.'
  }
  Assert-DailyTargetIdentity -Context $Context -Target $Target
  $releaseRoot = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'release') -Name 'releaseRoot'
  if (-not $releaseRoot -or -not (Test-DailyChildPath -Root $Context.releaseRoot -Candidate $releaseRoot)) {
    throw 'Daily production Apply candidate release points outside its release root.'
  }
  $journalReleaseId = Get-OptimizationObjectText -Object $Journal -Name 'releaseId'
  $targetReleaseId = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'release') -Name 'releaseId'
  if ($journalReleaseId -and $journalReleaseId -ne $targetReleaseId) {
    throw 'Daily production Apply candidate release mismatch; refusing recovery.'
  }
  return $true
}

function Test-DailyInterruptedTargetReady {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Target)
  try {
    Assert-DailyTargetIdentity -Context $Context -Target $Target
    $releaseRoot = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'release') -Name 'releaseRoot'
    if (-not $releaseRoot -or -not (Test-DailyChildPath -Root $Context.releaseRoot -Candidate $releaseRoot)) { return $false }
    $release = Get-OptimizationReleaseDescriptor -ReleaseRoot $releaseRoot
    $nodePath = Resolve-OptimizationExecutablePath -Value 'node' -Label 'Node'
    $integrity = Test-OptimizationReleaseIntegrity -Release $release -NodePath $nodePath -ReleaseHealthScript $Context.releaseHealthScript
    if (-not $integrity.passed -or -not (Test-OptimizationReleaseCompatibility -Release $release)) { return $false }
    if (-not (Test-Path -LiteralPath $Context.tokenPath -PathType Leaf)) { return $false }
    $hostState = Read-OptimizationJsonFile -Path $Context.hostStatePath
    $capabilityState = Read-OptimizationJsonFile -Path $Context.capabilityStatePath
    $hostHealth = Get-OptimizationHttpJson -Url (Get-DailyHealthUrl -HostName $Context.frontendHost -Port $Context.frontendPort)
    $capabilityHealth = Get-OptimizationHttpJson -Url (Get-DailyHealthUrl -HostName $Context.backendHost -Port $Context.backendPort)
    if (-not (Test-OptimizationPairReady `
        -HostState $hostState `
        -CapabilityState $capabilityState `
        -HostHealth $hostHealth `
        -CapabilityHealth $capabilityHealth `
        -Release $release `
        -ProfileId $profileId `
        -TokenPath $Context.tokenPath `
        -ExpectedDataRoot $Context.dataRoot)) { return $false }
    if (-not (Test-DailyProcessReceipt -State $hostState) -or -not (Test-DailyProcessReceipt -State $capabilityState)) { return $false }
    $index = Invoke-WebRequest -Uri "http://$(Format-OptimizationUrlHost -HostName $Context.frontendHost):$($Context.frontendPort)/" -UseBasicParsing -TimeoutSec 2
    return $index.StatusCode -eq 200 -and $index.Content -notmatch '@vite/client|src/main\.js'
  } catch {
    return $false
  }
}

function Restore-DailyApplySnapshot {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Journal)
  $oldActiveSnapshot = Get-OptimizationObjectText -Object $Journal -Name 'oldActiveTargetSnapshot'
  Restore-OptimizationRuntimeSnapshot -Path $Context.activeTargetPath -Snapshot $oldActiveSnapshot
  $oldTokenPresent = [bool](Get-OptimizationObjectValue -Object $Journal -Name 'oldTokenPresent')
  if (-not $oldTokenPresent -and (Test-Path -LiteralPath $Context.tokenPath -PathType Leaf)) {
    Remove-Item -LiteralPath $Context.tokenPath -Force -ErrorAction Stop
  }
  if ($oldTokenPresent -and -not (Test-Path -LiteralPath $Context.tokenPath -PathType Leaf)) {
    throw 'Daily production Apply recovery cannot restore the previously present service token.'
  }
}

function Invoke-DailyApplyRecovery {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Journal)
  Assert-DailyJournalIdentity -Context $Context -Journal $Journal -Operation 'daily-production-apply'
  $instanceId = Get-DailyJournalInstanceId -Journal $Journal
  $oldActiveSnapshot = Get-OptimizationObjectText -Object $Journal -Name 'oldActiveTargetSnapshot'
  $currentActiveSnapshot = Read-DailyText -Path $Context.activeTargetPath
  $currentTarget = Read-OptimizationJsonFile -Path $Context.activeTargetPath
  $isOldSnapshot = $currentActiveSnapshot -eq $oldActiveSnapshot
  $candidateTarget = $null
  if (-not $isOldSnapshot -and $null -ne $currentTarget) {
    Test-DailyApplyCandidateTarget -Context $Context -Journal $Journal -Target $currentTarget | Out-Null
    $candidateTarget = $currentTarget
  } elseif (-not $isOldSnapshot -and $currentActiveSnapshot) {
    throw 'Daily production Apply recovery found an unknown active-target state; refusing to overwrite it.'
  }

  $status = Get-OptimizationObjectText -Object $Journal -Name 'status'
  if ($status -eq 'committed' -and $null -ne $candidateTarget -and (Test-DailyInterruptedTargetReady -Context $Context -Target $candidateTarget)) {
    Remove-DailyJournal -Context $Context
    return [ordered]@{ status = 'finalized'; operation = 'Apply'; sideEffects = @('kept the committed active target', 'removed the completed promotion journal') }
  }
  if ($status -notin @('prepared', 'committed')) {
    throw "Daily production Apply journal status '$status' is unsupported; refusing recovery."
  }

  Stop-DailyInterruptedInstance `
    -Context $Context `
    -InstanceId $instanceId `
    -ExpectedReleaseId (Get-OptimizationObjectText -Object $Journal -Name 'releaseId') `
    -Target $candidateTarget
  Restore-DailyApplySnapshot -Context $Context -Journal $Journal
  Remove-DailyJournal -Context $Context
  return [ordered]@{ status = 'rolled-back'; operation = 'Apply'; sideEffects = @('stopped only the journal-owned candidate pair', 'restored the previous active target snapshot', 'removed the recovered promotion journal') }
}

function Test-DailyEmptyActiveTarget {
  param([Parameter(Mandatory)]$Context, $Target)
  return $null -ne $Target `
    -and [string](Get-OptimizationObjectText -Object $Target -Name 'status') -eq 'empty' `
    -and [string](Get-OptimizationObjectText -Object $Target -Name 'profileId') -eq $profileId `
    -and (Test-DailySamePath -Left (Get-OptimizationObjectText -Object $Target -Name 'rollbackStatePath') -Right $Context.rollbackTargetPath)
}

function Assert-DailyRollbackArtifactIdentity {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Target)
  if ([string](Get-OptimizationObjectText -Object $Target -Name 'status') -ne 'rolled-back') { throw 'Daily production rollback target status is invalid; refusing recovery.' }
  if (-not (Test-DailySamePath -Left (Get-OptimizationObjectText -Object $Target -Name 'sourceTargetPath') -Right $Context.activeTargetPath)) { throw 'Daily production rollback target source mismatch; refusing recovery.' }
  Assert-DailyTargetIdentity -Context $Context -Target $Target
}

function Assert-DailyRollbackTargetIdentity {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Target, [Parameter(Mandatory)]$SourceTarget)
  Assert-DailyRollbackArtifactIdentity -Context $Context -Target $Target
  $sourceRelease = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $SourceTarget -Name 'release') -Name 'releaseId'
  $rollbackRelease = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'release') -Name 'releaseId'
  if ($sourceRelease -ne $rollbackRelease) { throw 'Daily production rollback target release mismatch; refusing recovery.' }
  $sourceInstance = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $SourceTarget -Name 'profile') -Name 'instanceId'
  $rollbackInstance = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'profile') -Name 'instanceId'
  if ($sourceInstance -ne $rollbackInstance) { throw 'Daily production rollback target instance mismatch; refusing recovery.' }
}

function Invoke-DailyRollbackRecovery {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Journal)
  Assert-DailyJournalIdentity -Context $Context -Journal $Journal -Operation 'daily-production-rollback'
  $sourceSnapshot = Get-OptimizationObjectText -Object $Journal -Name 'activeTargetSnapshot'
  if (-not $sourceSnapshot) { throw 'Daily production rollback journal has no active target snapshot; refusing recovery.' }
  try { $sourceTarget = $sourceSnapshot | ConvertFrom-Json } catch { throw 'Daily production rollback target snapshot is invalid; refusing recovery.' }
  Assert-DailyTargetIdentity -Context $Context -Target $sourceTarget
  $instanceId = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $sourceTarget -Name 'profile') -Name 'instanceId'
  $sourceReleaseId = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $sourceTarget -Name 'release') -Name 'releaseId'
  $currentActive = Read-OptimizationJsonFile -Path $Context.activeTargetPath
  $currentActiveSnapshot = Read-DailyText -Path $Context.activeTargetPath
  $sourceStillActive = $currentActiveSnapshot -eq $sourceSnapshot
  if (-not $sourceStillActive -and -not (Test-DailyEmptyActiveTarget -Context $Context -Target $currentActive)) {
    throw 'Daily production rollback recovery found an unknown active-target state; refusing to overwrite it.'
  }

  $status = Get-OptimizationObjectText -Object $Journal -Name 'status'
  if ($status -notin @('prepared', 'committed')) { throw "Daily production rollback journal status '$status' is unsupported; refusing recovery." }

  $journalPhase = Get-OptimizationObjectText -Object $Journal -Name 'phase'
  if ($journalPhase -notin @('services-stopped', 'rollback-target-written', 'active-target-cleared') -or $sourceStillActive) {
    $Journal.phase = 'stopping'
    Write-DailyJournal -Context $Context -Journal $Journal
    Stop-DailyInterruptedInstance -Context $Context -InstanceId $instanceId -ExpectedReleaseId $sourceReleaseId -Target $sourceTarget
    $Journal.phase = 'services-stopped'
    Write-DailyJournal -Context $Context -Journal $Journal
  } else {
    Stop-DailyInterruptedInstance -Context $Context -InstanceId $instanceId -ExpectedReleaseId $sourceReleaseId -Target $sourceTarget
  }

  $rollback = Read-OptimizationJsonFile -Path $Context.rollbackTargetPath
  $rollbackReady = $false
  if ($null -ne $rollback) {
    Assert-DailyRollbackArtifactIdentity -Context $Context -Target $rollback
    $rollbackReady = $null -ne $rollback `
      -and [string](Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $rollback -Name 'release') -Name 'releaseId') -eq $sourceReleaseId `
      -and [string](Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $rollback -Name 'profile') -Name 'instanceId') -eq $instanceId
  }
  if (-not $rollbackReady) {
    $Journal.phase = 'rollback-target-pending'
    Write-DailyJournal -Context $Context -Journal $Journal
    Write-DailyJson -Path $Context.rollbackTargetPath -Value (New-DailyRollbackTarget -Context $Context -Target $sourceTarget)
    $Journal.phase = 'rollback-target-written'
    Write-DailyJournal -Context $Context -Journal $Journal
  }

  $currentActive = Read-OptimizationJsonFile -Path $Context.activeTargetPath
  if (-not (Test-DailyEmptyActiveTarget -Context $Context -Target $currentActive)) {
    $Journal.phase = 'active-target-pending'
    Write-DailyJournal -Context $Context -Journal $Journal
    Write-DailyJson -Path $Context.activeTargetPath -Value (New-DailyEmptyTarget -Context $Context)
    $Journal.phase = 'active-target-cleared'
    $Journal.status = 'committed'
    Write-DailyJournal -Context $Context -Journal $Journal
  } elseif ($status -ne 'committed' -or $journalPhase -ne 'active-target-cleared') {
    $Journal.phase = 'active-target-cleared'
    $Journal.status = 'committed'
    Write-DailyJournal -Context $Context -Journal $Journal
  }
  Remove-DailyServiceToken -Context $Context
  Remove-DailyJournal -Context $Context
  return [ordered]@{ status = 'finalized'; operation = 'Rollback'; sideEffects = @('stopped only the journal-owned pair', 'preserved the rollback target', 'cleared the active target', 'removed the completed rollback journal') }
}

function Invoke-DailyPromotionRecovery {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Journal)
  $operation = Get-OptimizationObjectText -Object $Journal -Name 'operation'
  switch ($operation) {
    'daily-production-apply' { return Invoke-DailyApplyRecovery -Context $Context -Journal $Journal }
    'daily-production-rollback' { return Invoke-DailyRollbackRecovery -Context $Context -Journal $Journal }
    default { throw "Daily production journal operation '$operation' is unsupported; refusing recovery." }
  }
}

function Remove-DailyInstanceRoot {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$InstanceRoot)
  if (-not (Test-Path -LiteralPath $InstanceRoot)) { return }
  $instancesRoot = Join-Path $Context.applicationIsolationRoot 'instances'
  if (-not (Test-DailyChildPath -Root $instancesRoot -Candidate $InstanceRoot)) { throw 'Refusing to remove an application instance outside the daily-production instances root.' }
  Remove-Item -LiteralPath $InstanceRoot -Recurse -Force
}

function Get-DailyToken {
  param([Parameter(Mandatory)]$Context)
  $token = (Read-DailyText -Path $Context.tokenPath).Trim()
  if ($token) { return $token }
  return New-OptimizationInstanceToken
}

function Stop-DailyPair {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)]$Target)
  Assert-DailyTargetIdentity -Context $Context -Target $Target
  $instanceId = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'profile') -Name 'instanceId'
  if (-not $instanceId) { throw 'Daily production target has no instance identity; refusing to stop it.' }
  $targetHostOwner = Get-OptimizationObjectValue -Object $Target -Name 'hostOwner'
  $targetCapabilityOwner = Get-OptimizationObjectValue -Object $Target -Name 'capabilityOwner'
  foreach ($owner in @($targetHostOwner, $targetCapabilityOwner)) {
    if ($null -eq $owner -or [string](Get-OptimizationObjectText -Object $owner -Name 'profileId') -ne $profileId -or [string](Get-OptimizationObjectText -Object $owner -Name 'instanceId') -ne $instanceId) {
      throw 'Daily production target owner identity mismatch; refusing to stop a process.'
    }
  }
  if ([IO.Path]::GetFullPath((Get-OptimizationObjectText -Object $targetHostOwner -Name 'statePath')) -ne [IO.Path]::GetFullPath($Context.hostStatePath) -or [IO.Path]::GetFullPath((Get-OptimizationObjectText -Object $targetCapabilityOwner -Name 'statePath')) -ne [IO.Path]::GetFullPath($Context.capabilityStatePath)) {
    throw 'Daily production target owner state paths mismatch; refusing to stop a process.'
  }
  $hostState = Read-OptimizationJsonFile -Path $Context.hostStatePath
  $capabilityState = Read-OptimizationJsonFile -Path $Context.capabilityStatePath
  if ($null -eq $hostState -and (Test-OptimizationTcpPortOccupied -Port $Context.frontendPort)) { throw "Daily production frontend port $($Context.frontendPort) is occupied without an owned state; refusing to remove or stop anything." }
  if ($null -eq $capabilityState -and (Test-OptimizationTcpPortOccupied -Port $Context.backendPort)) { throw "Daily production backend port $($Context.backendPort) is occupied without an owned state; refusing to remove or stop anything." }
  if ($null -ne $hostState -and [string]$hostState.instanceId -ne $instanceId) { throw 'Current Host state instance mismatch; refusing to stop it.' }
  if ($null -ne $capabilityState -and [string]$capabilityState.instanceId -ne $instanceId) { throw 'Current capability state instance mismatch; refusing to stop it.' }
  if ($null -ne $hostState -and (-not (Test-DailyOwnerRecordMatchesState -State $hostState -Owner $targetHostOwner) -or -not (Test-DailyProcessReceipt -State $hostState))) {
    throw 'Current Host process identity does not match the retained daily-production owner receipt; refusing to stop it.'
  }
  if ($null -ne $capabilityState -and (-not (Test-DailyOwnerRecordMatchesState -State $capabilityState -Owner $targetCapabilityOwner) -or -not (Test-DailyProcessReceipt -State $capabilityState))) {
    throw 'Current capability process identity does not match the retained daily-production owner receipt; refusing to stop it.'
  }
  if ($null -ne $hostState) {
    Invoke-OptimizationHostDrain -StatePath $Context.hostStatePath -TokenPath $Context.tokenPath -DeadlineSeconds 10 | Out-Null
    Stop-OptimizationOwnedState -StatePath $Context.hostStatePath -ProfileId $profileId | Out-Null
  }
  if ($null -ne $capabilityState) { Stop-OptimizationOwnedState -StatePath $Context.capabilityStatePath -ProfileId $profileId | Out-Null }
  $instanceRoot = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $Target -Name 'profile') -Name 'instanceRoot'
  if ($instanceRoot) { Remove-DailyInstanceRoot -Context $Context -InstanceRoot $instanceRoot }
}

function Stop-DailyOwnedInstance {
  param([Parameter(Mandatory)]$Context, [Parameter(Mandatory)][string]$InstanceId)
  $hostState = Read-OptimizationJsonFile -Path $Context.hostStatePath
  $capabilityState = Read-OptimizationJsonFile -Path $Context.capabilityStatePath
  if ($null -eq $hostState -and (Test-OptimizationTcpPortOccupied -Port $Context.frontendPort)) { throw "Daily production frontend port $($Context.frontendPort) is occupied without an owned state; refusing cleanup." }
  if ($null -eq $capabilityState -and (Test-OptimizationTcpPortOccupied -Port $Context.backendPort)) { throw "Daily production backend port $($Context.backendPort) is occupied without an owned state; refusing cleanup." }
  if ($null -ne $hostState -and [string]$hostState.profileId -eq $profileId -and [string]$hostState.instanceId -eq $InstanceId) {
    if (-not (Test-DailyProcessReceipt -State $hostState)) { throw 'New daily-production Host process identity could not be proven during cleanup.' }
    Invoke-OptimizationHostDrain -StatePath $Context.hostStatePath -TokenPath $Context.tokenPath -DeadlineSeconds 10 | Out-Null
    Stop-OptimizationOwnedState -StatePath $Context.hostStatePath -ProfileId $profileId | Out-Null
  }
  if ($null -ne $capabilityState -and [string]$capabilityState.profileId -eq $profileId -and [string]$capabilityState.instanceId -eq $InstanceId) {
    if (-not (Test-DailyProcessReceipt -State $capabilityState)) { throw 'New daily-production capability process identity could not be proven during cleanup.' }
    Stop-OptimizationOwnedState -StatePath $Context.capabilityStatePath -ProfileId $profileId | Out-Null
  }
  $instanceRoot = Join-Path $Context.applicationIsolationRoot "instances\$InstanceId"
  Remove-DailyInstanceRoot -Context $Context -InstanceRoot $instanceRoot
}

function Invoke-DailyApply {
  param([Parameter(Mandatory)]$Context)
  if (-not $ConfirmDailyProductionApply) { throw 'Apply is disabled until the user supplies -ConfirmDailyProductionApply.' }
  $plan = Get-DailyPreflight -Context $Context
  if (-not [bool]$plan.readyForApply) { throw ("Daily production Apply preflight blocked: " + (@($plan.blockers) -join '; ')) }
  if (-not (Test-Path -LiteralPath $Context.workflowRoot -PathType Container)) { throw "Workflow source root is missing: $($Context.workflowRoot)" }
  foreach ($path in @($Context.capabilityScript, $Context.backupScript, $Context.dailyProfileInitializer, $Context.releaseHealthScript)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Daily production release input is missing: $path" }
  }
  $toolchain = Get-DailyToolchain -Context $Context
  $token = Get-DailyToken -Context $Context
  Set-DailyEnvironment -Context $Context -Toolchain $toolchain -ServiceToken $token
  $oldActiveSnapshot = Read-DailyText -Path $Context.activeTargetPath
  $oldTokenSnapshot = Read-DailyText -Path $Context.tokenPath
  $instanceId = [Guid]::NewGuid().ToString('N')
  $journal = [ordered]@{
    schemaVersion = 1
    operation = 'daily-production-apply'
    status = 'prepared'
    phase = 'preflight'
    profileId = $profileId
    runtimeMode = $Context.runtimeMode
    runtimeConfigPath = $Context.runtimeConfigPath
    dataRoot = $Context.dataRoot
    dataRootIdentity = $Context.dataRootIdentity
    instanceId = $instanceId
    oldActiveTargetSnapshot = $oldActiveSnapshot
    oldTokenPresent = [bool]$oldTokenSnapshot
    createdAtUtc = ([DateTime]::UtcNow).ToString('O')
  }
  Write-DailyJournal -Context $Context -Journal $journal
  $pairStarted = $false
  $transactionCommitted = $false
  $release = $null
  try {
    $candidate = New-OptimizationReleaseStaging `
      -ProjectRoot $Context.projectRoot `
      -WorkflowRoot $Context.workflowRoot `
      -RuntimeConfigPath $Context.runtimeConfigPath `
      -CapabilityScript $Context.capabilityScript `
      -BackupScript $Context.backupScript `
      -StagingRoot $Context.stagingRoot `
      -ReleaseRoot $Context.releaseRoot `
      -NpmPath $toolchain.npmPath `
      -NodePath $toolchain.nodePath `
      -PythonPath $toolchain.pythonPath `
      -FfmpegPath $toolchain.ffmpegPath `
      -YtDlpPath $toolchain.ytDlpPath `
      -WhisperxPath $toolchain.whisperxPath `
      -ReleaseHealthScript $Context.releaseHealthScript `
      -ProfileId $profileId `
      -FrontendHost $Context.frontendHost `
      -FrontendPort $Context.frontendPort `
      -BackendHost $Context.backendHost `
      -BackendPort $Context.backendPort `
      -DataRoot $Context.dataRoot `
      -RequireClean
    $journal.phase = 'release-staged'
    $journal.candidateReleaseId = $candidate.releaseId
    Write-DailyJournal -Context $Context -Journal $journal
    $published = Publish-OptimizationRelease `
      -Candidate $candidate `
      -ReleaseRoot $Context.releaseRoot `
      -NodePath $toolchain.nodePath `
      -ReleaseHealthScript $Context.releaseHealthScript
    $release = $published.release
    $journal.phase = 'release-published'
    $journal.releaseId = $release.releaseId
    $journal.releaseRoot = $release.releaseRoot
    Write-DailyJournal -Context $Context -Journal $journal
    Write-DailyText -Path $Context.tokenPath -Text "$token`n"
    $pair = Start-DailyPair -Context $Context -Release $release -Toolchain $toolchain -Token $token -InstanceId $instanceId
    $pairStarted = $true
    $pairIdentity = Test-DailyPairIdentity -Context $Context -Release $release -Token $token
    $journal.phase = 'pair-ready'
    Write-DailyJournal -Context $Context -Journal $journal
    $target = New-DailyTarget -Context $Context -Release $release -Pair $pairIdentity -InstanceId $instanceId -Toolchain $toolchain
    Invoke-DailyCrashPoint -Phase 'apply-before-active-target'
    Write-DailyJson -Path $Context.activeTargetPath -Value $target
    Invoke-DailyCrashPoint -Phase 'apply-after-active-target'
    $journal.phase = 'active-target-written'
    $journal.status = 'committed'
    Write-DailyJournal -Context $Context -Journal $journal
    $transactionCommitted = $true
    Invoke-DailyCrashPoint -Phase 'apply-before-journal-remove'
    Remove-DailyJournal -Context $Context
    Invoke-DailyCrashPoint -Phase 'apply-after-journal-remove'
    if ($Open -and -not $NoOpen) { Start-Process "http://$(Format-OptimizationUrlHost -HostName $Context.frontendHost):$($Context.frontendPort)/" }
    return [ordered]@{
      status = 'applied'
      action = 'Apply'
      profileId = $profileId
      runtimeMode = $Context.runtimeMode
      release = Get-DailyReleaseFields -Release $release
      targetPath = $Context.activeTargetPath
      rollbackStatePath = $Context.rollbackTargetPath
      ownerAuthority = $target.ownerAuthority
      builtDistHost = $target.builtDistHost
      dataRoot = $Context.dataRoot
      dataRootIdentity = $Context.dataRootIdentity
      sideEffects = @('built immutable dist', 'started owned Host/capability pair', 'wrote atomic target state')
    }
  } catch {
    if ($transactionCommitted) { throw }
    if ($pairStarted) {
      try { Stop-DailyOwnedInstance -Context $Context -InstanceId $instanceId } catch {}
    } else {
      try {
        $hostState = Read-OptimizationJsonFile -Path $Context.hostStatePath
        if ($null -ne $hostState -and [string]$hostState.profileId -eq $profileId -and [string]$hostState.instanceId -eq $instanceId) { Stop-OptimizationOwnedState -StatePath $Context.hostStatePath -ProfileId $profileId | Out-Null }
        $capState = Read-OptimizationJsonFile -Path $Context.capabilityStatePath
        if ($null -ne $capState -and [string]$capState.profileId -eq $profileId -and [string]$capState.instanceId -eq $instanceId) { Stop-OptimizationOwnedState -StatePath $Context.capabilityStatePath -ProfileId $profileId | Out-Null }
      } catch {}
    }
    try { Restore-OptimizationRuntimeSnapshot -Path $Context.activeTargetPath -Snapshot $oldActiveSnapshot } catch {}
    try { Restore-OptimizationRuntimeSnapshot -Path $Context.tokenPath -Snapshot $oldTokenSnapshot } catch {}
    throw
  }
}

function Invoke-DailyStart {
  param([Parameter(Mandatory)]$Context)
  $target = Read-OptimizationJsonFile -Path $Context.activeTargetPath
  $targetStatus = Get-OptimizationObjectText -Object $target -Name 'status'
  if ($null -eq $target -or $targetStatus -notin @('active', 'stopped')) { throw "No retained daily-production target is available at $($Context.activeTargetPath). Apply first or inspect Rollback state." }
  $toolchain = Get-DailyToolchain -Context $Context
  $release = Get-DailyReleaseFromTarget -Context $Context -Target $target -Toolchain $toolchain
  $token = Get-DailyToken -Context $Context
  Set-DailyEnvironment -Context $Context -Toolchain $toolchain -ServiceToken $token
  $preflight = Get-DailyPreflight -Context $Context
  if ($preflight.frontend.classification -eq 'owned-process' -and $preflight.backend.classification -eq 'owned-process') {
    $pairIdentity = Test-DailyPairIdentity -Context $Context -Release $release -Token $token
    $targetInstance = Get-OptimizationObjectText -Object (Get-OptimizationObjectValue -Object $target -Name 'profile') -Name 'instanceId'
    if ([string]$pairIdentity.hostState.instanceId -ne $targetInstance) { throw 'An owned daily-production pair is running for a different target; refusing adoption.' }
    return [ordered]@{ status = 'reused'; action = 'Start'; targetPath = $Context.activeTargetPath; ownerAuthority = $pairIdentity.ownerAuthority; sideEffects = @('none') }
  }
  foreach ($endpoint in @($preflight.frontend, $preflight.backend)) {
    if ($endpoint.occupied) { throw "Daily production Start blocked by $($endpoint.classification) on $($endpoint.name) port $($endpoint.port); no process was stopped." }
  }
  $oldTokenSnapshot = Read-DailyText -Path $Context.tokenPath
  $tokenNeedsWrite = ([string]$oldTokenSnapshot).Trim() -ne $token
  $instanceId = [Guid]::NewGuid().ToString('N')
  try {
    if ($tokenNeedsWrite) { Write-DailyText -Path $Context.tokenPath -Text "$token`n" }
    $pair = Start-DailyPair -Context $Context -Release $release -Toolchain $toolchain -Token $token -InstanceId $instanceId
    $pairIdentity = Test-DailyPairIdentity -Context $Context -Release $release -Token $token
    $nextTarget = New-DailyTarget -Context $Context -Release $release -Pair $pairIdentity -InstanceId $instanceId -Toolchain $toolchain
    Write-DailyJson -Path $Context.activeTargetPath -Value $nextTarget
    if ($Open -and -not $NoOpen) { Start-Process "http://$(Format-OptimizationUrlHost -HostName $Context.frontendHost):$($Context.frontendPort)/" }
    return [ordered]@{ status = 'started'; action = 'Start'; targetPath = $Context.activeTargetPath; ownerAuthority = $nextTarget.ownerAuthority; sideEffects = @('started owned Host/capability pair', 'updated atomic target owner receipt') }
  } catch {
    try { Stop-DailyOwnedInstance -Context $Context -InstanceId $instanceId } catch {}
    try { Restore-OptimizationRuntimeSnapshot -Path $Context.tokenPath -Snapshot $oldTokenSnapshot } catch {}
    throw
  }
}

function Invoke-DailyStop {
  param([Parameter(Mandatory)]$Context)
  $target = Read-OptimizationJsonFile -Path $Context.activeTargetPath
  $targetStatus = Get-OptimizationObjectText -Object $target -Name 'status'
  if ($null -eq $target -or $targetStatus -notin @('active', 'stopped')) { return [ordered]@{ status = 'absent'; action = 'Stop'; sideEffects = @('none') } }
  Assert-DailyTargetIdentity -Context $Context -Target $target
  if ($targetStatus -eq 'active') { Stop-DailyPair -Context $Context -Target $target }
  $stopped = [ordered]@{}
  foreach ($property in $target.PSObject.Properties) { $stopped[$property.Name] = $property.Value }
  $stopped.status = 'stopped'
  $stopped.stoppedAtUtc = ([DateTime]::UtcNow).ToString('O')
  $stopped.lastOwner = $target.hostOwner
  Write-DailyJson -Path $Context.activeTargetPath -Value $stopped
  return [ordered]@{ status = 'stopped'; action = 'Stop'; targetPath = $Context.activeTargetPath; releasePreserved = $true; dataPreserved = $true; sideEffects = @('stopped only the identity-checked daily-production pair', 'preserved target and immutable release') }
}

function Invoke-DailyRollback {
  param([Parameter(Mandatory)]$Context)
  if (-not $ConfirmDailyProductionRollback) { throw 'Rollback is disabled until the user supplies -ConfirmDailyProductionRollback.' }
  $target = Read-OptimizationJsonFile -Path $Context.activeTargetPath
  $targetStatus = Get-OptimizationObjectText -Object $target -Name 'status'
  if ($null -eq $target -or $targetStatus -notin @('active', 'stopped')) { return [ordered]@{ status = 'absent'; action = 'Rollback'; sideEffects = @('none') } }
  Assert-DailyTargetIdentity -Context $Context -Target $target
  $journal = [ordered]@{
    schemaVersion = 1
    operation = 'daily-production-rollback'
    status = 'prepared'
    phase = 'preflight'
    profileId = $profileId
    activeTargetSnapshot = Read-DailyText -Path $Context.activeTargetPath
    createdAtUtc = ([DateTime]::UtcNow).ToString('O')
  }
  Write-DailyJournal -Context $Context -Journal $journal
  try {
    $journal.phase = 'stopping'
    Write-DailyJournal -Context $Context -Journal $journal
    Invoke-DailyCrashPoint -Phase 'rollback-before-stop'
    if ($targetStatus -eq 'active') { Stop-DailyPair -Context $Context -Target $target }
    $journal.phase = 'services-stopped'
    Write-DailyJournal -Context $Context -Journal $journal
    Invoke-DailyCrashPoint -Phase 'rollback-after-stop'
    $journal.phase = 'rollback-target-pending'
    Write-DailyJournal -Context $Context -Journal $journal
    Invoke-DailyCrashPoint -Phase 'rollback-before-rollback-target'
    Write-DailyJson -Path $Context.rollbackTargetPath -Value (New-DailyRollbackTarget -Context $Context -Target $target)
    Invoke-DailyCrashPoint -Phase 'rollback-after-rollback-target'
    $journal.phase = 'rollback-target-written'
    Write-DailyJournal -Context $Context -Journal $journal
    $journal.phase = 'active-target-pending'
    Write-DailyJournal -Context $Context -Journal $journal
    Invoke-DailyCrashPoint -Phase 'rollback-before-active-target-clear'
    Write-DailyJson -Path $Context.activeTargetPath -Value (New-DailyEmptyTarget -Context $Context)
    Invoke-DailyCrashPoint -Phase 'rollback-after-active-target-clear'
    $journal.phase = 'active-target-cleared'
    $journal.status = 'committed'
    Write-DailyJournal -Context $Context -Journal $journal
    Remove-DailyServiceToken -Context $Context
    Invoke-DailyCrashPoint -Phase 'rollback-before-journal-remove'
    Remove-DailyJournal -Context $Context
    Invoke-DailyCrashPoint -Phase 'rollback-after-journal-remove'
    return [ordered]@{ status = 'rolled-back'; action = 'Rollback'; rollbackStatePath = $Context.rollbackTargetPath; releasePreserved = $true; dataPreserved = $true; sideEffects = @('stopped only the identity-checked owned pair', 'cleared active target atomically', 'preserved immutable release and data root') }
  } catch {
    throw
  }
}

try {
  $script:dailyContext = Get-DailyContext
  $authorizedRecovery = $Action -in @('Start', 'Stop') `
    -or ($Action -eq 'Apply' -and $ConfirmDailyProductionApply) `
    -or ($Action -eq 'Rollback' -and $ConfirmDailyProductionRollback)
  if ($Action -ne 'Plan' -and $authorizedRecovery) {
    $pendingJournal = Read-OptimizationJsonFile -Path $script:dailyContext.journalPath
    if ($null -ne $pendingJournal) {
      $recovery = Invoke-DailyPromotionRecovery -Context $script:dailyContext -Journal $pendingJournal
      Write-Host ("Recovered daily-production $($recovery.operation) transaction: $($recovery.status).")
    }
  }
  switch ($Action) {
    'Plan' {
      $result = Get-DailyPreflight -Context $script:dailyContext
      $result | ConvertTo-Json -Depth 20
    }
    'Apply' { (Invoke-DailyApply -Context $script:dailyContext) | ConvertTo-Json -Depth 20 }
    'Start' { (Invoke-DailyStart -Context $script:dailyContext) | ConvertTo-Json -Depth 20 }
    'Stop' { (Invoke-DailyStop -Context $script:dailyContext) | ConvertTo-Json -Depth 20 }
    'Rollback' { (Invoke-DailyRollback -Context $script:dailyContext) | ConvertTo-Json -Depth 20 }
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  try { Restore-OptimizationProcessEnvironment -Snapshot $environmentSnapshot } catch {}
}

param(
  [string]$LauncherPath = 'scripts\launch-daily-production.ps1'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherPathValue = if ([IO.Path]::IsPathRooted($LauncherPath)) { $LauncherPath } else { Join-Path $projectRoot $LauncherPath }
$launcherPath = (Resolve-Path -LiteralPath $launcherPathValue).Path
$shortcutMigrationPath = Join-Path $PSScriptRoot 'release-shortcut-migration.ps1'
$optimizationReleaseModulePath = Join-Path $PSScriptRoot 'optimization-release.psm1'
$launcherSource = Get-Content -LiteralPath $launcherPath -Raw -Encoding UTF8
$dailyConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'config\runtime.daily-production.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Import-Module $optimizationReleaseModulePath -Force -DisableNameChecking

function Assert-True($Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

function Set-ProcessEnvironmentValue([string]$Name, [AllowNull()][string]$Value) {
  if ($null -eq $Value) { Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue }
  else { [Environment]::SetEnvironmentVariable($Name, $Value, 'Process') }
}

function Assert-DailyPythonSelectionBoundary {
  $dailyConfigPath = Join-Path $projectRoot 'config\runtime.daily-production.json'
  $environmentNames = @('LOCALAPPDATA', 'READ_WEB_PYTHON', 'READ_WEB_PYTHON_PATH')
  $environmentSnapshot = @{}
  foreach ($name in $environmentNames) { $environmentSnapshot[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  $missingDefaultRoot = Join-Path ([IO.Path]::GetTempPath()) ('read-web-python-missing-' + [Guid]::NewGuid().ToString('N'))
  try {
    Set-ProcessEnvironmentValue -Name 'LOCALAPPDATA' -Value $missingDefaultRoot
    Set-ProcessEnvironmentValue -Name 'READ_WEB_PYTHON' -Value $null
    Set-ProcessEnvironmentValue -Name 'READ_WEB_PYTHON_PATH' -Value $null
    $defaultPath = Get-OptimizationDefaultPythonPath
    Assert-True (-not (Test-Path -LiteralPath $defaultPath -PathType Leaf)) 'daily Python selection regression must start without the dedicated external venv'
    $missingError = $null
    try { Resolve-OptimizationDailyPython -RuntimeConfigPath $dailyConfigPath | Out-Null } catch { $missingError = $_.Exception.Message }
    Assert-True ($missingError -and $missingError -match 'external optimization Python venv') 'formal daily selection must fail closed when its dedicated external venv is missing'

    $systemPython = (Get-Command python.exe -ErrorAction Stop).Source
    $bootstrapSelection = Resolve-OptimizationDailyPython -RuntimeConfigPath $dailyConfigPath -RequestedPath $systemPython
    Assert-True ([IO.Path]::GetFullPath($bootstrapSelection) -ieq [IO.Path]::GetFullPath($systemPython)) 'explicit daily BootstrapPython selection must remain available for fixture/CI use'
    Set-ProcessEnvironmentValue -Name 'READ_WEB_PYTHON' -Value $systemPython
    $environmentSelection = Resolve-OptimizationDailyPython -RuntimeConfigPath $dailyConfigPath
    Assert-True ([IO.Path]::GetFullPath($environmentSelection) -ieq [IO.Path]::GetFullPath($systemPython)) 'explicit daily READ_WEB_PYTHON selection must remain available for fixture/CI use'
  } finally {
    foreach ($name in $environmentSnapshot.Keys) { Set-ProcessEnvironmentValue -Name $name -Value $environmentSnapshot[$name] }
  }
}

function Get-RandomSafePort {
  do {
    $candidate = Get-Random -Minimum 43100 -Maximum 47900
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
    try {
      $listener.Start()
      $available = $true
    } catch {
      $available = $false
    } finally {
      $listener.Stop()
    }
  } while (-not $available -or $candidate -in @(5173, 5174, 8765, 8766, 5184, 8776))
  return $candidate
}

function Invoke-PowerShellJson {
  param([Parameter(Mandatory)][string[]]$Arguments, [hashtable]$Environment = @{})
  $environmentSnapshot = @{}
  foreach ($name in $Environment.Keys) { $environmentSnapshot[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $stdoutPath = Join-Path ([IO.Path]::GetTempPath()) ('.read-web-daily-production-' + [Guid]::NewGuid().ToString('N') + '.stdout.log')
  $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ('.read-web-daily-production-' + [Guid]::NewGuid().ToString('N') + '.stderr.log')
  $statusPath = Join-Path ([IO.Path]::GetTempPath()) ('.read-web-daily-production-' + [Guid]::NewGuid().ToString('N') + '.exit.log')
  $batchPath = Join-Path ([IO.Path]::GetTempPath()) ('.read-web-daily-production-' + [Guid]::NewGuid().ToString('N') + '.cmd')
  $stdoutText = ''
  $stderrText = ''
  $exitCode = -1
  $child = $null
  try {
    foreach ($name in $Environment.Keys) { Set-ProcessEnvironmentValue -Name $name -Value $Environment[$name] }
    $argumentString = ($Arguments | ForEach-Object { '"' + ([string]$_ -replace '"', '\\"') + '"' }) -join ' '
    $powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
    $batchText = "@echo off`r`n`"$powershellPath`" $argumentString 1> `"$stdoutPath`" 2> `"$stderrPath`"`r`nset `"exitCode=%ERRORLEVEL%`"`r`necho %exitCode%> `"$statusPath`"`r`n"
    [IO.File]::WriteAllText($batchPath, $batchText, [Text.UTF8Encoding]::new($false))
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Command cmd.exe -ErrorAction Stop).Source
    $startInfo.Arguments = "/d /s /c call `"$batchPath`""
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $child = [Diagnostics.Process]::new()
    $child.StartInfo = $startInfo
    if (-not $child.Start()) { throw 'Could not start the daily launcher command wrapper.' }
    $child.WaitForExit()
    $child.Refresh()
    $statusText = if (Test-Path -LiteralPath $statusPath -PathType Leaf) { Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 } else { '' }
    if ($null -eq $statusText) { $statusText = '' }
    $statusText = $statusText -replace '^\s+|\s+$', ''
    if (-not [int]::TryParse($statusText, [ref]$exitCode)) { $exitCode = [int]$child.ExitCode }
    if (Test-Path -LiteralPath $stdoutPath -PathType Leaf) { $stdoutText = [string](Get-Content -LiteralPath $stdoutPath -Raw -Encoding UTF8) }
    if (Test-Path -LiteralPath $stderrPath -PathType Leaf) { $stderrText = [string](Get-Content -LiteralPath $stderrPath -Raw -Encoding UTF8) }
  } finally {
    foreach ($name in $environmentSnapshot.Keys) { Set-ProcessEnvironmentValue -Name $name -Value $environmentSnapshot[$name] }
    $ErrorActionPreference = $previousErrorAction
    Remove-Item -LiteralPath $stdoutPath,$stderrPath,$statusPath,$batchPath -Force -ErrorAction SilentlyContinue
    if ($null -ne $child) { $child.Dispose() }
  }
  $text = @($stdoutText, $stderrText) -join "`n"
  $json = $null
  foreach ($candidateText in @($stdoutText, $stderrText, $text)) {
    $candidateText = if ($null -eq $candidateText) { '' } else { [string]$candidateText }
    $jsonStart = $candidateText.IndexOf('{')
    $jsonEnd = $candidateText.LastIndexOf('}')
    if ($jsonStart -ge 0 -and $jsonEnd -gt $jsonStart) {
      try {
        $json = $candidateText.Substring($jsonStart, $jsonEnd - $jsonStart + 1) | ConvertFrom-Json
        if ($null -ne $json) { break }
      } catch {}
    }
  }
  if ($exitCode -eq 0 -and $null -eq $json) { $exitCode = 1 }
  return [pscustomobject]@{ exitCode = $exitCode; text = $text; json = $json }
}

function Read-TestShortcut([Parameter(Mandatory)][string]$Path) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  return [ordered]@{ target = $shortcut.TargetPath; arguments = $shortcut.Arguments; workingDirectory = $shortcut.WorkingDirectory; iconLocation = $shortcut.IconLocation }
}

function Assert-ShortcutEqual($Left, $Right, [string]$Message) {
  Assert-True ([string]$Left.target -eq [string]$Right.target -and [string]$Left.arguments -eq [string]$Right.arguments -and [string]$Left.workingDirectory -eq [string]$Right.workingDirectory -and [string]$Left.iconLocation -eq [string]$Right.iconLocation) $Message
}

function Test-PortFree([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return -not ($task.Wait(250) -and $client.Connected)
  } catch {
    return $true
  } finally {
    $client.Dispose()
  }
}

function Assert-DailyFixtureStopped([string]$StateRoot, [string]$ApplicationRoot, [int]$FrontendPort, [int]$BackendPort, [string]$MessagePrefix) {
  foreach ($name in @('production-host.json', 'capability-host.json', 'production-host.token', 'promotion-journal.json')) {
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $StateRoot $name) -PathType Leaf)) "$MessagePrefix retained $name"
  }
  $activeTargetPath = Join-Path $StateRoot 'active-target.json'
  if (Test-Path -LiteralPath $activeTargetPath -PathType Leaf) {
    $activeTarget = Get-Content -LiteralPath $activeTargetPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ([string]$activeTarget.status -eq 'empty' -and [string]$activeTarget.profileId -eq 'daily-production') "$MessagePrefix retained an invalid empty active target marker"
  }
  Assert-True (Test-PortFree $FrontendPort -and Test-PortFree $BackendPort) "$MessagePrefix left a fixture port occupied"
  $instancesRoot = Join-Path $ApplicationRoot 'instances'
  if (Test-Path -LiteralPath $instancesRoot -PathType Container) {
    Assert-True (@(Get-ChildItem -LiteralPath $instancesRoot -Directory -ErrorAction SilentlyContinue).Count -eq 0) "$MessagePrefix retained an application instance root"
  }
}

Assert-True ($dailyConfig.frontend.port -eq 5174 -and $dailyConfig.backend.port -eq 8766) 'daily-production config must own the current daily origin ports'
Assert-True ($dailyConfig.dataRoot -eq 'E:\ReadWebData\SubtitleWorkflow-Next') 'daily-production config must preserve the existing daily workflow root identity'
Assert-True ($launcherSource -match 'runtime\.daily-production\.json' -and $launcherSource -notmatch 'runtime\.optimization\.json') 'daily-production launcher must not widen or reuse runtime.optimization.json'
Assert-True ($launcherSource -match 'youtube_workflow\.production_host_prototype' -and $launcherSource -match 'legacy-browser-owner/pre-cutover') 'daily-production launcher must require built Host and expose pre-cutover owner status'
Assert-True ($launcherSource -match 'Resolve-OptimizationDailyPython' -and $launcherSource -notmatch 'Resolve-OptimizationSelectedPython' -and $launcherSource -match 'Assert-OptimizationReleaseToolchain') 'daily-production launcher must use the strict external Python selector and health-check it before startup'
Assert-True ($launcherSource -match 'Resolve-DailyChromePath' -and $launcherSource -match [regex]::Escape("'--new-window'")) 'daily-production launcher must open Chrome in an explicit visible window instead of relying only on the URL association'
foreach ($phase in @(
  'apply-before-active-target',
  'apply-after-active-target',
  'apply-before-journal-remove',
  'apply-after-journal-remove',
  'rollback-before-stop',
  'rollback-after-stop',
  'rollback-before-rollback-target',
  'rollback-after-rollback-target',
  'rollback-before-active-target-clear',
  'rollback-after-active-target-clear',
  'rollback-before-journal-remove',
  'rollback-after-journal-remove'
)) {
  Assert-True ($launcherSource -match [regex]::Escape($phase)) "daily-production launcher is missing crash recovery phase: $phase"
}
foreach ($domain in @('reader-session', 'marks-activity', 'passage-preview', 'annotation', 'vocabulary-srs', 'workflow')) {
  Assert-True ($launcherSource -match [regex]::Escape($domain)) "daily-production owner contract is missing domain: $domain"
}

Assert-DailyPythonSelectionBoundary

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('read-web-daily-production-' + [Guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $testRoot 'workflow-data'
$stateRoot = Join-Path $testRoot 'state'
$releaseRoot = Join-Path $testRoot 'releases'
$stagingRoot = Join-Path $testRoot 'staging'
$applicationRoot = Join-Path $testRoot 'application'
$logRoot = Join-Path $testRoot 'logs'
$configPath = Join-Path $testRoot 'runtime.fixture.json'
$shortcutPath = Join-Path $testRoot 'reader-fixture.lnk'
$shortcutStatePath = Join-Path $testRoot 'shortcut-state.json'
$frontendPort = Get-RandomSafePort
$backendPort = Get-RandomSafePort
$localAppDataRoot = Join-Path $testRoot 'local-app-data'
$stablePythonRoot = Join-Path $localAppDataRoot 'Read-Web\optimization-python'
$stablePython = Join-Path $stablePythonRoot 'Scripts\python.exe'
$unknown = $null
$common = @()
$checkPassed = $false

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
try {
  $systemPython = (Get-Command python.exe -ErrorAction Stop).Source
  & $systemPython -m venv $stablePythonRoot 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $stablePython -PathType Leaf)) { throw 'Could not create the external temporary Python venv for the daily launcher regression.' }
  $lockPath = Join-Path $projectRoot 'tools\subtitle-workflow\requirements-service.lock'
  & $stablePython -m pip install --disable-pip-version-check --require-hashes --only-binary=:all: -r $lockPath 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not install the locked production Python package set into the external temporary venv.' }

  $fixtureConfig = [ordered]@{
    schemaVersion = 1
    frontend = [ordered]@{ host = '127.0.0.1'; port = $frontendPort }
    backend = [ordered]@{ host = '127.0.0.1'; port = $backendPort }
    dataRoot = $dataRoot
    python = [ordered]@{ executable = 'python' }
    tools = [ordered]@{ ytDlp = 'yt-dlp'; whisperx = 'whisperx'; ffmpeg = 'ffmpeg' }
    network = [ordered]@{ proxyUrl = '' }
    ai = [ordered]@{ model = 'fixture'; baseUrl = '' }
  }
  [IO.File]::WriteAllText($configPath, (($fixtureConfig | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))

  $common = @(
    '-RuntimeConfigPath', $configPath,
    '-WorkflowDataRoot', $dataRoot,
    '-StateRoot', $stateRoot,
    '-ReleaseRoot', $releaseRoot,
    '-StagingRoot', $stagingRoot,
    '-ApplicationIsolationRoot', $applicationRoot,
    '-LogRoot', $logRoot,
    '-FixtureMode',
    '-NoOpen'
  )
  $stableEnvironment = @{
    LOCALAPPDATA = $localAppDataRoot
    READ_WEB_PYTHON = $null
    READ_WEB_PYTHON_PATH = $null
    READ_WEB_RUNTIME_CONFIG = $null
    READ_WEB_DAILY_PRODUCTION_TEST_KILL_PHASE = $null
  }
  $plan = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Plan') + $common)
  Assert-True ($plan.exitCode -eq 0 -and $null -ne $plan.json) "fixture Plan failed: $($plan.text)"
  Assert-True ($plan.json.runtimeMode -eq 'fixture' -and $plan.json.readyForApply -eq $true) 'fixture Plan must be side-effect-free and ready when both random ports are free'
  Assert-True (-not (Test-Path -LiteralPath $stateRoot) -and -not (Test-Path -LiteralPath $releaseRoot) -and -not (Test-Path -LiteralPath $stagingRoot)) 'Plan must not create state, release, or staging directories'

  $applyWithoutConfirmation = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Apply') + $common)
  Assert-True ($applyWithoutConfirmation.exitCode -ne 0 -and $applyWithoutConfirmation.text -match 'Apply is disabled') 'Apply must require explicit confirmation'
  Assert-True (-not (Test-Path -LiteralPath $stateRoot) -and -not (Test-Path -LiteralPath $releaseRoot) -and -not (Test-Path -LiteralPath $stagingRoot)) 'an unauthorized Apply must not create mutation state'

  $unknown = Start-Process -FilePath (Get-Command python.exe -ErrorAction Stop).Source -ArgumentList @('-m', 'http.server', "$frontendPort", '--bind', '127.0.0.1') -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 350
  $blockedPlan = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Plan') + $common)
  Assert-True ($blockedPlan.exitCode -eq 0 -and $blockedPlan.json.frontend.classification -eq 'unknown-process') 'Plan must classify an unknown fixture port occupant'
  $unknown.Refresh()
  Assert-True (-not $unknown.HasExited) 'Plan must not stop an unknown fixture port occupant'
  Stop-Process -Id $unknown.Id -Force
  $unknown = $null

  $shell = New-Object -ComObject WScript.Shell
  $originalShortcut = $shell.CreateShortcut($shortcutPath)
  $originalShortcut.TargetPath = (Get-Command powershell.exe -ErrorAction Stop).Source
  $originalShortcut.Arguments = '-NoProfile -Command "Write-Output legacy"'
  $originalShortcut.WorkingDirectory = $testRoot
  $originalShortcut.IconLocation = "$($originalShortcut.TargetPath),0"
  $originalShortcut.Save()
  $originalSpec = Read-TestShortcut -Path $shortcutPath
  $newArguments = '-Action Start -NoOpen'
  $shortcutCommon = @(
    '-ShortcutPath', $shortcutPath,
    '-StatePath', $shortcutStatePath,
    '-NewScriptPath', $launcherPath,
    '-NewWorkingDirectory', $projectRoot,
    '-NewLauncherArguments', $newArguments
  )
  $shortcutPlan = Invoke-PowerShellJson -Arguments (@('-File', $shortcutMigrationPath, '-Action', 'Plan') + $shortcutCommon)
  Assert-True ($shortcutPlan.exitCode -eq 0 -and $shortcutPlan.json.status -eq 'planned') "shortcut Plan failed: $($shortcutPlan.text)"
  Assert-True (-not (Test-Path -LiteralPath $shortcutStatePath)) 'shortcut Plan must not create rollback state'
  Assert-ShortcutEqual (Read-TestShortcut -Path $shortcutPath) $originalSpec 'shortcut Plan must not mutate the fixture shortcut'

  $shortcutApply = Invoke-PowerShellJson -Arguments (@('-File', $shortcutMigrationPath, '-Action', 'Apply') + $shortcutCommon)
  Assert-True ($shortcutApply.exitCode -eq 0 -and $shortcutApply.json.status -eq 'applied') "shortcut Apply failed: $($shortcutApply.text)"
  $appliedSpec = Read-TestShortcut -Path $shortcutPath
  Assert-True ($appliedSpec.arguments -match [regex]::Escape($launcherPath) -and $appliedSpec.arguments -match '-Action Start -NoOpen') 'shortcut Apply must preserve the explicit launcher path and arguments'
  Assert-True ((Test-Path -LiteralPath $shortcutStatePath) -and -not (Test-Path -LiteralPath "$shortcutStatePath.pending.json")) 'shortcut Apply must leave a committed rollback state without a pending transaction'

  $openArguments = '-Action Start -Open'
  $updateShortcutCommon = @(
    '-ShortcutPath', $shortcutPath,
    '-StatePath', $shortcutStatePath,
    '-NewScriptPath', $launcherPath,
    '-NewWorkingDirectory', $projectRoot,
    '-NewLauncherArguments', $openArguments
  )
  $shortcutUpdate = Invoke-PowerShellJson -Arguments (@('-File', $shortcutMigrationPath, '-Action', 'Update', '-AllowDesktopMutation') + $updateShortcutCommon)
  Assert-True ($shortcutUpdate.exitCode -eq 0 -and $shortcutUpdate.json.status -eq 'updated') "shortcut Update failed: $($shortcutUpdate.text)"
  $updatedSpec = Read-TestShortcut -Path $shortcutPath
  Assert-True ($updatedSpec.arguments -match [regex]::Escape($launcherPath) -and $updatedSpec.arguments -match '-Action Start -Open') 'shortcut Update must change only the launcher mode'
  $updatedState = Get-Content -LiteralPath $shortcutStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  Assert-ShortcutEqual $updatedState.original $originalSpec 'shortcut Update must preserve the saved original rollback target'

  $shortcutRollback = Invoke-PowerShellJson -Arguments (@('-File', $shortcutMigrationPath, '-Action', 'Rollback') + $updateShortcutCommon)
  Assert-True ($shortcutRollback.exitCode -eq 0 -and $shortcutRollback.json.status -eq 'rolled-back') "shortcut Rollback failed: $($shortcutRollback.text)"
  Assert-ShortcutEqual (Read-TestShortcut -Path $shortcutPath) $originalSpec 'shortcut Rollback must restore the saved original fixture shortcut'

  $applyCrashPhases = @(
    'apply-before-active-target',
    'apply-after-active-target',
    'apply-before-journal-remove',
    'apply-after-journal-remove'
  )
  foreach ($phase in $applyCrashPhases) {
    $crashEnvironment = @{}
    foreach ($name in $stableEnvironment.Keys) { $crashEnvironment[$name] = $stableEnvironment[$name] }
    $crashEnvironment['READ_WEB_DAILY_PRODUCTION_TEST_KILL_PHASE'] = $phase
    $crashApply = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Apply', '-ConfirmDailyProductionApply') + $common) -Environment $crashEnvironment
    $crashMarker = "Synthetic daily-production crash at phase: $phase"
    Assert-True ($crashApply.text -match [regex]::Escape($crashMarker)) "synthetic daily Apply did not reach crash phase ${phase}: $($crashApply.text)"
    Assert-True ($crashApply.exitCode -ne 0) "synthetic daily Apply crash phase did not terminate the child: $phase"
    $journalPath = Join-Path $stateRoot 'promotion-journal.json'
    $committedTargetInstanceId = ''
    $committedTargetReleaseId = ''
    if ($phase -eq 'apply-after-journal-remove') {
      Assert-True (-not (Test-Path -LiteralPath $journalPath -PathType Leaf)) "synthetic daily Apply retained a journal after its cleanup phase: $phase"
    } else {
      Assert-True (Test-Path -LiteralPath $journalPath -PathType Leaf) "synthetic daily Apply crash did not retain its journal: ${phase}: $($crashApply.text)"
      if ($phase -eq 'apply-before-journal-remove') {
        $committedJournal = Get-Content -LiteralPath $journalPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-True ([string]$committedJournal.status -eq 'committed' -and [string]$committedJournal.phase -eq 'active-target-written') "daily Apply crash did not retain committed journal evidence after phase ${phase}"
        $committedTargetPath = Join-Path $stateRoot 'active-target.json'
        Assert-True (Test-Path -LiteralPath $committedTargetPath -PathType Leaf) "daily Apply crash did not retain the committed active target after phase ${phase}"
        $committedTarget = Get-Content -LiteralPath $committedTargetPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $committedTargetInstanceId = [string]$committedTarget.profile.instanceId
        $committedTargetReleaseId = [string]$committedTarget.release.releaseId
        Assert-True ([string]$committedTarget.status -eq 'active' -and [string]$committedTarget.profileId -eq 'daily-production' -and $committedTargetInstanceId -and $committedTargetReleaseId) "daily Apply crash retained an invalid committed active target after phase ${phase}"
      }
    }
    $crashRecovery = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Start') + $common) -Environment $stableEnvironment
    if ($phase -in @('apply-before-active-target', 'apply-after-active-target')) {
      Assert-True ($crashRecovery.exitCode -ne 0 -and $crashRecovery.text -match 'Recovered daily-production Apply transaction') "daily Apply recovery did not roll back after phase ${phase}: $($crashRecovery.text)"
      Assert-DailyFixtureStopped -StateRoot $stateRoot -ApplicationRoot $applicationRoot -FrontendPort $frontendPort -BackendPort $backendPort -MessagePrefix "daily Apply recovery $phase"
    } else {
      Assert-True ($crashRecovery.exitCode -eq 0 -and $crashRecovery.json.status -eq 'reused') "daily Apply recovery did not finalize the committed target after phase ${phase}: $($crashRecovery.text)"
      if ($phase -eq 'apply-before-journal-remove') {
        Assert-True ($crashRecovery.text -match 'Recovered daily-production Apply transaction: finalized\.') "daily Apply committed-journal recovery did not report finalization after phase ${phase}: $($crashRecovery.text)"
        $recoveredTargetPath = Join-Path $stateRoot 'active-target.json'
        Assert-True (Test-Path -LiteralPath $recoveredTargetPath -PathType Leaf) "daily Apply committed-journal recovery lost the committed active target after phase ${phase}"
        $recoveredTarget = Get-Content -LiteralPath $recoveredTargetPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-True ([string]$recoveredTarget.status -eq 'active' `
          -and [string]$recoveredTarget.profileId -eq 'daily-production' `
          -and [string]$recoveredTarget.profile.instanceId -eq $committedTargetInstanceId `
          -and [string]$recoveredTarget.release.releaseId -eq $committedTargetReleaseId) "daily Apply committed-journal recovery changed the committed active target after phase ${phase}"
      } else {
        Assert-True ($crashRecovery.text -notmatch 'Recovered daily-production Apply transaction') "daily Apply post-journal crash unexpectedly reported journal recovery after phase ${phase}: $($crashRecovery.text)"
      }
      Assert-True (-not (Test-Path -LiteralPath $journalPath -PathType Leaf)) "daily Apply finalization retained its journal after phase $phase"
      $applyCleanup = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Rollback', '-ConfirmDailyProductionRollback') + $common) -Environment $stableEnvironment
      Assert-True ($applyCleanup.exitCode -eq 0 -and $applyCleanup.json.status -eq 'rolled-back') "daily Apply committed-target cleanup failed after phase ${phase}: $($applyCleanup.text)"
      Assert-DailyFixtureStopped -StateRoot $stateRoot -ApplicationRoot $applicationRoot -FrontendPort $frontendPort -BackendPort $backendPort -MessagePrefix "daily Apply committed-target cleanup $phase"
    }
  }

  $stableApply = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Apply', '-ConfirmDailyProductionApply') + $common) -Environment $stableEnvironment
  Assert-True ($stableApply.exitCode -eq 0) "daily Apply with the external stable venv failed: $($stableApply.text)"
  $activeTargetPath = Join-Path $stateRoot 'active-target.json'
  $seedActiveTargetSnapshot = Get-Content -LiteralPath $activeTargetPath -Raw -Encoding UTF8
  $seedActiveTarget = $seedActiveTargetSnapshot | ConvertFrom-Json
  Assert-True ([IO.Path]::GetFullPath([string]$seedActiveTarget.runtime.pythonPath) -ieq [IO.Path]::GetFullPath($stablePython)) 'daily Apply did not use the external stable venv selected by the default path'
  Assert-True ([string]$seedActiveTarget.builtDistHost.hostKind -eq 'youtube_workflow.production_host_prototype' -and [bool]$seedActiveTarget.builtDistHost.required) 'daily Apply did not commit the built production Host identity'
  $ownerAuthority = $seedActiveTarget.ownerAuthority
  if ([string]$ownerAuthority.status -eq 'host-api-authoritative') {
    Assert-True (@($ownerAuthority.missingDomains).Count -eq 0) 'daily launcher claimed full Host API authority while domains were still missing'
  } else {
    Assert-True ([string]$ownerAuthority.status -eq 'legacy-browser-owner/pre-cutover' -and @($ownerAuthority.missingDomains).Count -gt 0) 'daily launcher owner authority state was neither honest pre-cutover nor complete'
  }

  $openMarkerPath = Join-Path $testRoot 'daily-open.marker'
  $openCommon = @($common | Where-Object { $_ -ne '-NoOpen' }) + @('-OpenMarkerPath', $openMarkerPath)
  $reusedOpen = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Start', '-Open') + $openCommon) -Environment $stableEnvironment
  Assert-True ($reusedOpen.exitCode -eq 0 -and $reusedOpen.json.status -eq 'reused') "daily reused Start -Open failed: $($reusedOpen.text)"
  Assert-True (Test-Path -LiteralPath $openMarkerPath -PathType Leaf) 'daily reused Start -Open did not invoke the browser-open boundary'
  $openedUrl = (Get-Content -LiteralPath $openMarkerPath -Raw -Encoding UTF8).Trim()
  Assert-True ($openedUrl -eq "http://127.0.0.1:$frontendPort/") "daily reused Start -Open targeted the wrong URL: $openedUrl"

  $rollbackCrashPhases = @(
    'rollback-before-stop',
    'rollback-after-stop',
    'rollback-before-rollback-target',
    'rollback-after-rollback-target',
    'rollback-before-active-target-clear',
    'rollback-after-active-target-clear',
    'rollback-before-journal-remove',
    'rollback-after-journal-remove'
  )
  for ($index = 0; $index -lt $rollbackCrashPhases.Count; $index += 1) {
    if ($index -gt 0) {
      Set-Content -LiteralPath $activeTargetPath -Value $seedActiveTargetSnapshot -Encoding UTF8
      $restart = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Start') + $common) -Environment $stableEnvironment
      Assert-True ($restart.exitCode -eq 0) "daily target could not be restarted before rollback phase $($rollbackCrashPhases[$index]): $($restart.text)"
    }
    $phase = $rollbackCrashPhases[$index]
    $rollbackEnvironment = @{}
    foreach ($name in $stableEnvironment.Keys) { $rollbackEnvironment[$name] = $stableEnvironment[$name] }
    $rollbackEnvironment['READ_WEB_DAILY_PRODUCTION_TEST_KILL_PHASE'] = $phase
    $crashRollback = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Rollback', '-ConfirmDailyProductionRollback') + $common) -Environment $rollbackEnvironment
    Assert-True ($crashRollback.exitCode -ne 0) "synthetic daily Rollback crash phase did not terminate the child: $phase"
    if ($phase -ne 'rollback-after-journal-remove') {
      Assert-True (Test-Path -LiteralPath (Join-Path $stateRoot 'promotion-journal.json') -PathType Leaf) "daily Rollback crash did not retain its journal: $phase"
    }
    $recoveryRollback = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Rollback', '-ConfirmDailyProductionRollback') + $common) -Environment $stableEnvironment
    Assert-True ($recoveryRollback.exitCode -eq 0) "daily Rollback recovery failed after phase ${phase}: $($recoveryRollback.text)"
    $rollbackTarget = Get-Content -LiteralPath (Join-Path $stateRoot 'rollback-target.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $emptyTarget = Get-Content -LiteralPath $activeTargetPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ([string]$rollbackTarget.status -eq 'rolled-back' -and [string]$rollbackTarget.release.releaseId -eq [string]$seedActiveTarget.release.releaseId) "daily Rollback did not preserve the old target after phase $phase"
    Assert-True ([string]$emptyTarget.status -eq 'empty' -and [string]$emptyTarget.profileId -eq 'daily-production') "daily Rollback did not leave an honest empty active target after phase $phase"
    Assert-DailyFixtureStopped -StateRoot $stateRoot -ApplicationRoot $applicationRoot -FrontendPort $frontendPort -BackendPort $backendPort -MessagePrefix "daily Rollback recovery $phase"
  }

  $checkPassed = $true
  Write-Host 'daily production launcher check passed'
} finally {
  if ($null -ne $unknown) {
    try { $unknown.Refresh(); if (-not $unknown.HasExited) { Stop-Process -Id $unknown.Id -Force } } catch {}
  }
  if ($common.Count -gt 0) {
    try {
      $cleanupEnvironment = @{}
      foreach ($name in $stableEnvironment.Keys) { $cleanupEnvironment[$name] = $stableEnvironment[$name] }
      $cleanupEnvironment['READ_WEB_DAILY_PRODUCTION_TEST_KILL_PHASE'] = $null
      Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Stop') + $common) -Environment $cleanupEnvironment | Out-Null
    } catch {}
  }
  $knownRuntimeProcesses = @()
  if (Test-Path -LiteralPath $testRoot -PathType Container) {
    $knownRuntimeProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      ([string]$_.CommandLine).IndexOf($testRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
  }
  $portsStillOccupied = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @($frontendPort, $backendPort) })
  if ($checkPassed -and $knownRuntimeProcesses.Count -eq 0 -and $portsStillOccupied.Count -eq 0) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Warning "Retaining daily launcher fixture for diagnostics: $testRoot"
  }
}

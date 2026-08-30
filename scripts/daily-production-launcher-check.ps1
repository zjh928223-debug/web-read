param(
  [string]$LauncherPath = 'scripts\launch-daily-production.ps1'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherPathValue = if ([IO.Path]::IsPathRooted($LauncherPath)) { $LauncherPath } else { Join-Path $projectRoot $LauncherPath }
$launcherPath = (Resolve-Path -LiteralPath $launcherPathValue).Path
$shortcutMigrationPath = Join-Path $PSScriptRoot 'release-shortcut-migration.ps1'
$launcherSource = Get-Content -LiteralPath $launcherPath -Raw -Encoding UTF8
$dailyConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'config\runtime.daily-production.json') -Raw -Encoding UTF8 | ConvertFrom-Json

function Assert-True($Value, [string]$Message) {
  if (-not $Value) { throw $Message }
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
  param([Parameter(Mandatory)][string[]]$Arguments)
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
  $jsonStart = $text.IndexOf('{')
  $jsonEnd = $text.LastIndexOf('}')
  $json = $null
  if ($jsonStart -ge 0 -and $jsonEnd -gt $jsonStart) {
    try { $json = $text.Substring($jsonStart, $jsonEnd - $jsonStart + 1) | ConvertFrom-Json } catch {}
  }
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

Assert-True ($dailyConfig.frontend.port -eq 5174 -and $dailyConfig.backend.port -eq 8766) 'daily-production config must own the current daily origin ports'
Assert-True ($dailyConfig.dataRoot -eq 'E:\ReadWebData\SubtitleWorkflow-Next') 'daily-production config must preserve the existing daily workflow root identity'
Assert-True ($launcherSource -match 'runtime\.daily-production\.json' -and $launcherSource -notmatch 'runtime\.optimization\.json') 'daily-production launcher must not widen or reuse runtime.optimization.json'
Assert-True ($launcherSource -match 'youtube_workflow\.production_host_prototype' -and $launcherSource -match 'legacy-browser-owner/pre-cutover') 'daily-production launcher must require built Host and expose pre-cutover owner status'
foreach ($domain in @('reader-session', 'marks-activity', 'passage-preview', 'annotation', 'vocabulary-srs', 'workflow')) {
  Assert-True ($launcherSource -match [regex]::Escape($domain)) "daily-production owner contract is missing domain: $domain"
}

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
$unknown = $null

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
try {
  [ordered]@{
    schemaVersion = 1
    frontend = [ordered]@{ host = '127.0.0.1'; port = $frontendPort }
    backend = [ordered]@{ host = '127.0.0.1'; port = $backendPort }
    dataRoot = $dataRoot
    python = [ordered]@{ executable = 'python' }
    tools = [ordered]@{ ytDlp = 'yt-dlp'; whisperx = 'whisperx'; ffmpeg = 'ffmpeg' }
    network = [ordered]@{ proxyUrl = '' }
    ai = [ordered]@{ model = 'fixture'; baseUrl = '' }
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding UTF8

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
  $plan = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Plan') + $common)
  Assert-True ($plan.exitCode -eq 0 -and $null -ne $plan.json) "fixture Plan failed: $($plan.text)"
  Assert-True ($plan.json.runtimeMode -eq 'fixture' -and $plan.json.readyForApply -eq $true) 'fixture Plan must be side-effect-free and ready when both random ports are free'
  Assert-True (-not (Test-Path -LiteralPath $stateRoot) -and -not (Test-Path -LiteralPath $releaseRoot) -and -not (Test-Path -LiteralPath $stagingRoot)) 'Plan must not create state, release, or staging directories'

  $applyWithoutConfirmation = Invoke-PowerShellJson -Arguments (@('-File', $launcherPath, '-Action', 'Apply') + $common)
  Assert-True ($applyWithoutConfirmation.exitCode -ne 0 -and $applyWithoutConfirmation.text -match 'ConfirmDailyProductionApply') 'Apply must require explicit confirmation'
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

  $shortcutRollback = Invoke-PowerShellJson -Arguments (@('-File', $shortcutMigrationPath, '-Action', 'Rollback') + $shortcutCommon)
  Assert-True ($shortcutRollback.exitCode -eq 0 -and $shortcutRollback.json.status -eq 'rolled-back') "shortcut Rollback failed: $($shortcutRollback.text)"
  Assert-ShortcutEqual (Read-TestShortcut -Path $shortcutPath) $originalSpec 'shortcut Rollback must restore the saved original fixture shortcut'
  Write-Host 'daily production launcher check passed'
} finally {
  if ($null -ne $unknown) {
    try { $unknown.Refresh(); if (-not $unknown.HasExited) { Stop-Process -Id $unknown.Id -Force } } catch {}
  }
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}

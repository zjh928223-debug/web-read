param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendUrl = 'http://127.0.0.1:5184/'
$healthUrl = 'http://127.0.0.1:5184/api/app/health'
$logRoot = Join-Path $projectRoot '.codex\startup-logs'
$logPath = Join-Path $logRoot 'optimization-shortcut.log'
$launcherPath = Join-Path $PSScriptRoot 'launch-optimization-preview.ps1'
$managedOptimizationPython = Join-Path ${env:LOCALAPPDATA} 'Read-Web\optimization-python\Scripts\python.exe'

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Write-ShortcutLog {
  param([string]$Message)
  $line = "{0} {1}{2}" -f (Get-Date).ToString('s'), $Message, [Environment]::NewLine
  [IO.File]::AppendAllText($logPath, $line, [Text.UTF8Encoding]::new($false))
}

function Test-OptimizationReady {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    return [string]$health.status -eq 'ready' `
      -and [string]$health.profileId -eq 'optimization' `
      -and [bool]$health.distReady
  } catch {
    return $false
  }
}

function Open-OptimizationBrowser {
  # A Host restart changes the owner instance identity.  Always open a fresh
  # document so Chrome cannot reuse a tab whose JavaScript still belongs to the
  # previous Host instance.
  $launchId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
  $launchUrl = "$frontendUrl`?launch=$launchId"
  $browserCandidates = @(
    (Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:LOCALAPPDATA} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles} 'Microsoft\Edge\Application\msedge.exe')
  )
  $browserPath = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  if ($browserPath) {
    Start-Process -FilePath $browserPath -ArgumentList @('--new-window', $launchUrl) | Out-Null
    Write-ShortcutLog "Opened browser directly: $browserPath $launchUrl"
  } else {
    Start-Process -FilePath $launchUrl | Out-Null
    Write-ShortcutLog "Opened the default HTTP handler: $launchUrl"
  }
}

try {
  # Opening the personal tool should not be blocked by a release-reconciliation
  # failure. If the already-running optimization service is healthy, use it.
  if (Test-OptimizationReady) {
    Write-ShortcutLog 'Optimization service is already ready; opening browser without reconciliation.'
    Open-OptimizationBrowser
    exit 0
  }

  Write-ShortcutLog 'Reconciling the managed optimization release before opening the browser.'
  $bootstrapPython = if (Test-Path -LiteralPath $managedOptimizationPython -PathType Leaf) {
    $managedOptimizationPython
  } else {
    (Get-Command python -ErrorAction Stop).Source
  }
  Write-ShortcutLog "Using optimization bootstrap Python: $bootstrapPython"
  $powershellPath = Join-Path $PSHOME 'powershell.exe'
  $launcherOutputPath = Join-Path $logRoot 'optimization-shortcut-launch.out.log'
  $launcherErrorPath = Join-Path $logRoot 'optimization-shortcut-launch.err.log'
  $launcher = Start-Process `
    -FilePath $powershellPath `
    -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $launcherPath,
      '-BootstrapPython', ('"' + $bootstrapPython + '"'),
      '-NoOpen', '-StartupTimeoutSeconds', '45'
    ) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $launcherOutputPath `
    -RedirectStandardError $launcherErrorPath `
    -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-OptimizationReady) {
      Open-OptimizationBrowser
      exit 0
    }
    if ($launcher.HasExited) {
      throw "Managed optimization launcher exited with code $($launcher.ExitCode)."
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Optimization service did not become ready at $healthUrl."
} catch {
  Write-ShortcutLog "FAILED: $($_.Exception.Message)"
  exit 1
}

exit 0

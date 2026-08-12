param(
  [switch]$NoOpen,
  [string]$WorkflowRoot = 'E:\read-web-worktrees\next-feature-20260629\tools\subtitle-workflow',
  [string]$WorkflowDataRoot = 'E:\ReadWebData\SubtitleWorkflow',
  [string]$ServiceHealthUrl = 'http://127.0.0.1:8765/api/health',
  [string]$PythonPath = 'C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe',
  [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$workflowLauncher = Join-Path $PSScriptRoot 'start-latest-reader.ps1'
$baseUrl = 'http://127.0.0.1:5173'
$learningUrl = 'http://127.0.0.1:5173/'
$serverMarker = '<title>Advanced Seek Player + Smart Chunking (Pro)</title>'

function Test-ReadWebServer {
  try {
    $response = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content.Contains($serverMarker)
  } catch {
    return $false
  }
}

try {
  if (-not (Test-Path -LiteralPath $workflowLauncher)) {
    throw "Workflow launcher not found: $workflowLauncher"
  }

  & $workflowLauncher `
    -ServiceOnly `
    -NoOpen `
    -ReaderRoot $projectRoot `
    -WorkflowRoot $WorkflowRoot `
    -WorkflowDataRoot $WorkflowDataRoot `
    -ServiceHealthUrl $ServiceHealthUrl `
    -PythonPath $PythonPath `
    -StartupTimeoutSeconds $StartupTimeoutSeconds

  if (-not (Test-ReadWebServer)) {
    $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    $ecdictDatabasePath = Join-Path $projectRoot 'data\dictionaries\ecdict.sqlite'
    if (Test-Path -LiteralPath $ecdictDatabasePath) {
      $env:ECDICT_ENABLED = 'true'
      $env:ECDICT_DATABASE_PATH = $ecdictDatabasePath
    }
    $stdoutLog = Join-Path $env:TEMP 'read-web-learning-vite.out.log'
    $stderrLog = Join-Path $env:TEMP 'read-web-learning-vite.err.log'
    $serverProcess = Start-Process `
      -FilePath $npmCommand `
      -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort') `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline -and -not (Test-ReadWebServer)) {
      if ($serverProcess.HasExited) { break }
      Start-Sleep -Milliseconds 250
    }
  }

  if (-not (Test-ReadWebServer)) {
    throw 'The local learning service did not start within 30 seconds. Check the read-web-learning-vite logs in the temporary directory.'
  }

  if (-not $NoOpen) {
    Start-Process $learningUrl
  }
} catch {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.Popup($_.Exception.Message, 0, 'Read-Web Learning Page', 16)
  exit 1
}

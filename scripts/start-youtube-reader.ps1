param(
  [string]$ReaderRoot = "E:\read-web",
  [string]$WorkflowRoot = "C:\Users\0\Desktop\SubtitleWorkflow",
  [string]$ServiceHealthUrl = "http://127.0.0.1:8765/api/health",
  [string]$ReaderUrl = "http://127.0.0.1:5173",
  [string]$PythonPath = "C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe",
  [int]$StartupTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

function Test-HttpOk {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-HttpOk -Url $Url) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $false
}

if (-not (Test-Path -LiteralPath $WorkflowRoot)) {
  throw "SubtitleWorkflow path not found: $WorkflowRoot"
}
if (-not (Test-Path -LiteralPath $ReaderRoot)) {
  throw "Reader path not found: $ReaderRoot"
}

$logRoot = Join-Path $ReaderRoot ".codex\startup-logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$resolvedPythonPath = $PythonPath
if (-not (Test-Path -LiteralPath $resolvedPythonPath)) {
  $pythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
  if (-not $pythonCommand) {
    throw "Python executable not found. Expected: $PythonPath"
  }
  $resolvedPythonPath = $pythonCommand.Source
}

if (-not (Test-HttpOk -Url $ServiceHealthUrl)) {
  Start-Process -FilePath $resolvedPythonPath `
    -ArgumentList @("-m", "uvicorn", "youtube_workflow.service:app", "--host", "127.0.0.1", "--port", "8765") `
    -WorkingDirectory $WorkflowRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot "youtube-workflow-service.out.log") `
    -RedirectStandardError (Join-Path $logRoot "youtube-workflow-service.err.log")
}

Wait-HttpOk -Url $ServiceHealthUrl -TimeoutSeconds $StartupTimeoutSeconds | Out-Null

if (-not (Test-HttpOk -Url $ReaderUrl)) {
  Start-Process -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Set-Location -LiteralPath '$ReaderRoot'; npm run dev -- --host 127.0.0.1 --port 5173") `
    -WorkingDirectory $ReaderRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot "read-web-vite.out.log") `
    -RedirectStandardError (Join-Path $logRoot "read-web-vite.err.log")
}

Wait-HttpOk -Url $ReaderUrl -TimeoutSeconds $StartupTimeoutSeconds | Out-Null
Start-Process $ReaderUrl

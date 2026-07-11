param(
  [switch]$ServiceOnly,
  [switch]$FrontendOnly,
  [switch]$NoOpen,
  [string]$ReaderRoot = "E:\read-web",
  [string]$WorkflowRoot = "E:\read-web-worktrees\next-feature-20260629\tools\subtitle-workflow",
  [string]$WorkflowDataRoot = "E:\ReadWebData\SubtitleWorkflow",
  [string]$ServiceHealthUrl = "http://127.0.0.1:8765/api/health",
  [string]$ReaderUrl = "http://127.0.0.1:5173",
  [string]$PythonPath = "C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe",
  [string]$RequiredServiceVersion = "0.2.2",
  [int]$StartupTimeoutSeconds = 45
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

function Get-ServiceHealth {
  param([string]$Url)
  try {
    return Invoke-RestMethod -Uri $Url -TimeoutSec 2
  } catch {
    return $null
  }
}

function Normalize-PathText {
  param([string]$PathText)
  if (-not $PathText) {
    return ""
  }
  return [System.IO.Path]::GetFullPath($PathText).TrimEnd("\", "/").ToLowerInvariant()
}

function Test-ExpectedWorkflowService {
  param(
    $Health,
    [string]$ExpectedWorkflowRoot,
    [string]$ExpectedVersion
  )
  if (-not $Health) {
    return $false
  }
  if ($Health.service -ne "subtitle-workflow") {
    return $false
  }
  if ($Health.serviceVersion -ne $ExpectedVersion) {
    return $false
  }
  return (Normalize-PathText $Health.workflowRoot) -eq (Normalize-PathText $ExpectedWorkflowRoot)
}

function Stop-PortListener {
  param([int]$Port)
  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  foreach ($processId in ($connections | Select-Object -ExpandProperty OwningProcess -Unique)) {
    if ($processId -eq $PID) {
      continue
    }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

function Quote-PowerShellLiteral {
  param([string]$Value)
  return "'" + ($Value -replace "'", "''") + "'"
}

function Resolve-ExistingPath {
  param(
    [string]$PathText,
    [string]$Label
  )
  if (-not (Test-Path -LiteralPath $PathText)) {
    throw "$Label path not found: $PathText"
  }
  return (Resolve-Path -LiteralPath $PathText).Path
}

if ($ServiceOnly -and $FrontendOnly) {
  throw "Use either -ServiceOnly or -FrontendOnly, not both."
}

$ReaderRoot = Resolve-ExistingPath -PathText $ReaderRoot -Label "Reader"
$WorkflowRoot = Resolve-ExistingPath -PathText $WorkflowRoot -Label "SubtitleWorkflow"
New-Item -ItemType Directory -Force -Path $WorkflowDataRoot | Out-Null

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

$serviceUri = [Uri]$ServiceHealthUrl
$servicePort = $serviceUri.Port
$readerUri = [Uri]$ReaderUrl
$readerPort = $readerUri.Port
if ($readerPort -le 0) {
  throw "Reader URL must include a port: $ReaderUrl"
}

if (-not $FrontendOnly) {
  $health = Get-ServiceHealth -Url $ServiceHealthUrl
  if (-not (Test-ExpectedWorkflowService -Health $health -ExpectedWorkflowRoot $WorkflowRoot -ExpectedVersion $RequiredServiceVersion)) {
    if ($health -and $health.service -eq "subtitle-workflow") {
      Stop-PortListener -Port $servicePort
      Start-Sleep -Milliseconds 500
    } elseif ((Get-NetTCPConnection -LocalPort $servicePort -State Listen -ErrorAction SilentlyContinue)) {
      throw "Port $servicePort is already in use by another service."
    }

    $env:READ_WEB_SUBTITLE_DATA_ROOT = $WorkflowDataRoot
    Start-Process -FilePath $resolvedPythonPath `
      -ArgumentList @("-m", "uvicorn", "youtube_workflow.service:app", "--host", "127.0.0.1", "--port", "$servicePort") `
      -WorkingDirectory $WorkflowRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logRoot "youtube-workflow-service.out.log") `
      -RedirectStandardError (Join-Path $logRoot "youtube-workflow-service.err.log")
  }

}

if (-not $ServiceOnly) {
  if (-not (Test-HttpOk -Url $ReaderUrl)) {
    $readerRootLiteral = Quote-PowerShellLiteral $ReaderRoot
    $devCommand = "Set-Location -LiteralPath $readerRootLiteral; npm run dev -- --host 127.0.0.1 --port $readerPort"
    Start-Process -FilePath "powershell" `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $devCommand) `
      -WorkingDirectory $ReaderRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logRoot "read-web-vite.out.log") `
      -RedirectStandardError (Join-Path $logRoot "read-web-vite.err.log")
  }

  if (-not (Wait-HttpOk -Url $ReaderUrl -TimeoutSeconds $StartupTimeoutSeconds)) {
    throw "Reader dev server did not become ready. See logs under $logRoot"
  }

  if (-not $NoOpen) {
    Start-Process $ReaderUrl
  }
}

if (-not $FrontendOnly) {
  if (-not (Wait-HttpOk -Url $ServiceHealthUrl -TimeoutSeconds $StartupTimeoutSeconds)) {
    throw "Workflow service did not become ready. See logs under $logRoot"
  }
}

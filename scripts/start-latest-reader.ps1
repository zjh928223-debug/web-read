param(
  [switch]$ServiceOnly,
  [switch]$FrontendOnly,
  [switch]$NoOpen,
  [string]$ReaderRoot = "",
  [string]$WorkflowRoot = "",
  [string]$RuntimeConfigPath = "",
  [string]$WorkflowDataRoot = "",
  [string]$ServiceHealthUrl = "",
  [string]$ReaderUrl = "",
  [string]$PythonPath = "",
  [string]$RequiredServiceVersion = "0.2.3",
  [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot 'launcher-instance-manager.psm1') -Force

$defaultReaderRoot = Split-Path -Parent $PSScriptRoot
if (-not $ReaderRoot) {
  $ReaderRoot = $defaultReaderRoot
}
if (-not $WorkflowRoot) {
  $WorkflowRoot = Join-Path $ReaderRoot 'tools\subtitle-workflow'
}
$RuntimeConfigPath = if ($RuntimeConfigPath) { $RuntimeConfigPath } elseif ($env:READ_WEB_RUNTIME_CONFIG) { $env:READ_WEB_RUNTIME_CONFIG } else { Join-Path $ReaderRoot 'config\runtime.legacy.json' }
$bootstrapPython = if ($PythonPath) { $PythonPath } elseif ($env:READ_WEB_PYTHON) { $env:READ_WEB_PYTHON } elseif ($env:READ_WEB_PYTHON_PATH) { $env:READ_WEB_PYTHON_PATH } else { (Get-Command python -ErrorAction Stop).Source }
$runtimeArguments = @('-m', 'youtube_workflow.runtime_config')
$runtimeArguments += @('--config', $RuntimeConfigPath)
Push-Location $WorkflowRoot
try { $runtime = (& $bootstrapPython @runtimeArguments | ConvertFrom-Json) } finally { Pop-Location }
if (-not $WorkflowDataRoot) { $WorkflowDataRoot = $runtime.dataRoot }
if (-not $ServiceHealthUrl) { $ServiceHealthUrl = $runtime.backend.healthUrl }
if (-not $ReaderUrl) { $ReaderUrl = $runtime.frontend.url }
if (-not $PythonPath) { $PythonPath = $runtime.python.executable }

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
$profileProperty = $runtime.PSObject.Properties['profile']
$releaseProperty = $runtime.PSObject.Properties['release']
$profileId = if ($profileProperty -and $runtime.profile.PSObject.Properties['id']) { [string]$runtime.profile.id } else { "reader-$readerPort-workflow-$servicePort" }
$releaseId = if ($releaseProperty -and $runtime.release.PSObject.Properties['id']) { [string]$runtime.release.id } else { "read-web-$RequiredServiceVersion" }
$runtimeStateRoot = Join-Path $ReaderRoot ".codex\runtime-state\$profileId"
New-Item -ItemType Directory -Force -Path $runtimeStateRoot | Out-Null
$env:VITE_LOCAL_SERVICE_BASE_URL = $serviceUri.GetLeftPart([System.UriPartial]::Authority)
if ($readerPort -le 0) {
  throw "Reader URL must include a port: $ReaderUrl"
}

if (-not $FrontendOnly) {
  $env:READ_WEB_SUBTITLE_DATA_ROOT = $WorkflowDataRoot
  if ($RuntimeConfigPath) { $env:READ_WEB_RUNTIME_CONFIG = $RuntimeConfigPath }
  $env:READ_WEB_RELEASE_ID = $releaseId
  $env:READ_WEB_PROFILE_ID = $profileId
  $managed = Start-ManagedRuntimeInstance `
    -ReleaseId $releaseId `
    -ProfileId $profileId `
    -Port $servicePort `
    -HealthUrl $ServiceHealthUrl `
    -StatePath (Join-Path $runtimeStateRoot 'workflow.json') `
    -FilePath $resolvedPythonPath `
    -ArgumentList @("-m", "uvicorn", "youtube_workflow.service:app", "--host", "$($runtime.backend.host)", "--port", "$servicePort") `
    -WorkingDirectory $WorkflowRoot `
    -ReadyTimeoutSeconds $StartupTimeoutSeconds `
    -StandardOutputPath (Join-Path $logRoot "youtube-workflow-service.out.log") `
    -StandardErrorPath (Join-Path $logRoot "youtube-workflow-service.err.log")

}

if (-not $ServiceOnly) {
  if (-not (Test-HttpOk -Url $ReaderUrl)) {
    $readerRootLiteral = Quote-PowerShellLiteral $ReaderRoot
    $devCommand = "Set-Location -LiteralPath $readerRootLiteral; npm run dev"
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

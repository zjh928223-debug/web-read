param(
  [switch]$NoOpen,
  [string]$WorkflowDataRoot = '',
  [string]$RuntimeConfigPath = '',
  [string]$BootstrapPython = ''
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$workflowRoot = Join-Path $projectRoot 'tools\subtitle-workflow'
$RuntimeConfigPath = if ($RuntimeConfigPath) { $RuntimeConfigPath } else { Join-Path $projectRoot 'config\runtime.next.json' }
$BootstrapPython = if ($BootstrapPython) { $BootstrapPython } else { (Get-Command python -ErrorAction Stop).Source }
$launcher = Join-Path $PSScriptRoot 'launch-learning-page.ps1'
$previousRuntimeConfig = $env:READ_WEB_RUNTIME_CONFIG
$previousDataRoot = $env:READ_WEB_SUBTITLE_DATA_ROOT

try {
  $env:READ_WEB_RUNTIME_CONFIG = $RuntimeConfigPath
  if ($WorkflowDataRoot) {
    $env:READ_WEB_SUBTITLE_DATA_ROOT = $WorkflowDataRoot
  }

  Push-Location $workflowRoot
  try {
    $resolvedJson = & $BootstrapPython -m youtube_workflow.runtime_config --config $RuntimeConfigPath
    if ($LASTEXITCODE -ne 0) {
      throw "RuntimeConfig resolution failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  $runtime = $resolvedJson | ConvertFrom-Json
  $launchParams = @{
    WorkflowRoot = $workflowRoot
    RuntimeConfigPath = $RuntimeConfigPath
    WorkflowDataRoot = $runtime.dataRoot
    ServiceHealthUrl = $runtime.backend.healthUrl
    ReaderUrl = $runtime.frontend.url
    PythonPath = $runtime.python.executable
  }

  if ($NoOpen) {
    $launchParams.NoOpen = $true
  }

  & $launcher @launchParams
  exit $LASTEXITCODE
} finally {
  $env:READ_WEB_RUNTIME_CONFIG = $previousRuntimeConfig
  $env:READ_WEB_SUBTITLE_DATA_ROOT = $previousDataRoot
}

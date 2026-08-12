param(
  [switch]$NoOpen,
  [string]$WorkflowDataRoot = 'E:\ReadWebData\SubtitleWorkflow-Next'
)

$ErrorActionPreference = 'Stop'

$launcher = Join-Path $PSScriptRoot 'launch-learning-page.ps1'
$launchParams = @{
  WorkflowDataRoot = $WorkflowDataRoot
  ServiceHealthUrl = 'http://127.0.0.1:8766/api/health'
  ReaderUrl = 'http://127.0.0.1:5174/'
}

if ($NoOpen) {
  $launchParams.NoOpen = $true
}

& $launcher @launchParams
exit $LASTEXITCODE

param(
  [switch]$NoOpen,
  [string]$BootstrapPython = ''
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeConfigPath = Join-Path $projectRoot 'config\runtime.optimization.json'
$launcher = Join-Path $PSScriptRoot 'launch-next-preview.ps1'
$launchParams = @{
  RuntimeConfigPath = $runtimeConfigPath
}

if ($NoOpen) {
  $launchParams.NoOpen = $true
}
if ($BootstrapPython) {
  $launchParams.BootstrapPython = $BootstrapPython
}

& $launcher @launchParams
exit $LASTEXITCODE

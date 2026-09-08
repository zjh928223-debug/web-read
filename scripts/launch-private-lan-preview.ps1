param(
  [switch]$NoOpen,
  [switch]$Stop,
  [switch]$EnableOwnerMigration,
  [switch]$EnableOwnerPromotion,
  [string]$ApplicationProfileAuthorityIsolationRoot = '',
  [string]$BootstrapPython = '',
  [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$launcherPath = Join-Path $PSScriptRoot 'launch-optimization-preview.ps1'
$frontDoorRuntimeConfigPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\runtime.private-lan.json'
$launcherParameters = @{
  FrontDoorRuntimeConfigPath = $frontDoorRuntimeConfigPath
  StartupTimeoutSeconds = $StartupTimeoutSeconds
}
foreach ($name in @(
    'NoOpen', 'Stop', 'EnableOwnerMigration', 'EnableOwnerPromotion',
    'ApplicationProfileAuthorityIsolationRoot', 'BootstrapPython'
  )) {
  if ($PSBoundParameters.ContainsKey($name)) { $launcherParameters[$name] = $PSBoundParameters[$name] }
}

& $launcherPath @launcherParameters

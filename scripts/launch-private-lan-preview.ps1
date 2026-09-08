param(
  [switch]$NoOpen,
  [switch]$Stop,
  [switch]$EnableOwnerMigration,
  [switch]$EnableOwnerPromotion,
  [string]$ApplicationProfileAuthorityIsolationRoot = '',
  [string]$BootstrapPython = '',
  [string]$ResolvedLanAddress = '',
  [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$launcherPath = Join-Path $PSScriptRoot 'launch-optimization-preview.ps1'
$templatePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\runtime.private-lan.json'
$configModulePath = Join-Path $PSScriptRoot 'private-lan-runtime-config.psm1'
Import-Module $configModulePath -Force
$resolvedConfig = New-ResolvedPrivateLanRuntimeConfig -TemplatePath $templatePath -ResolvedLanAddress $ResolvedLanAddress
try {
  $launcherParameters = @{
    FrontDoorRuntimeConfigPath = $resolvedConfig.path
    StartupTimeoutSeconds = $StartupTimeoutSeconds
  }
  foreach ($name in @(
      'NoOpen', 'Stop', 'EnableOwnerMigration', 'EnableOwnerPromotion',
      'ApplicationProfileAuthorityIsolationRoot', 'BootstrapPython'
    )) {
    if ($PSBoundParameters.ContainsKey($name)) { $launcherParameters[$name] = $PSBoundParameters[$name] }
  }
  Write-Output "Resolved private-LAN address: $($resolvedConfig.address)"
  Write-Output "Private-LAN public URL: $($resolvedConfig.publicUrl)"
  & $launcherPath @launcherParameters
} finally {
  Remove-Item -LiteralPath $resolvedConfig.path -Force -ErrorAction SilentlyContinue
}

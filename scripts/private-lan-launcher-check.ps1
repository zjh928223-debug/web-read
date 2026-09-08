param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$entryPath = Join-Path $PSScriptRoot 'launch-private-lan-preview.ps1'
$launcherPath = Join-Path $PSScriptRoot 'launch-optimization-preview.ps1'
$configModulePath = Join-Path $PSScriptRoot 'private-lan-runtime-config.psm1'
$runtimeCheckPath = Join-Path $PSScriptRoot 'private-lan-runtime-check.ps1'
$lanConfigPath = Join-Path $projectRoot 'config\runtime.private-lan.json'
$optimizationConfigPath = Join-Path $projectRoot 'config\runtime.optimization.json'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-PowerShellSyntax {
  param([string]$Path)
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors) | Out-Null
  $errorMessages = @($errors | ForEach-Object { $_.Message })
  Assert-True ($errorMessages.Count -eq 0) "$Path has PowerShell parse errors: $($errorMessages -join '; ')"
}

Assert-PowerShellSyntax $entryPath
Assert-PowerShellSyntax $launcherPath
Assert-PowerShellSyntax $configModulePath
Assert-PowerShellSyntax $runtimeCheckPath

$entrySource = Get-Content -Raw -LiteralPath $entryPath
$launcherSource = Get-Content -Raw -LiteralPath $launcherPath
$configModuleSource = Get-Content -Raw -LiteralPath $configModulePath
$runtimeCheckSource = Get-Content -Raw -LiteralPath $runtimeCheckPath
$entryLines = @(Get-Content -LiteralPath $entryPath).Count
$lanConfig = Get-Content -Raw -LiteralPath $lanConfigPath | ConvertFrom-Json
$optimizationConfig = Get-Content -Raw -LiteralPath $optimizationConfigPath | ConvertFrom-Json

Assert-True ($entryLines -lt 100) 'private-LAN entry must stay a thin launcher adapter'
Assert-True ($entrySource -match "launch-optimization-preview\.ps1") 'private-LAN entry does not delegate to the optimization launcher'
Assert-True ($entrySource -match "config\\runtime\.private-lan\.json") 'private-LAN entry does not select its reviewed RuntimeConfig'
Assert-True ($entrySource -match 'FrontDoorRuntimeConfigPath') 'private-LAN entry does not pass the front-door RuntimeConfig seam'
Assert-True ($entrySource -match 'New-ResolvedPrivateLanRuntimeConfig') 'private-LAN entry does not resolve its LAN-specific RuntimeConfig'
Assert-True ($entrySource -notmatch '(?im)^\s*function\s+') 'private-LAN entry must not copy launcher lifecycle functions'
Assert-True ($entrySource -notmatch 'Start-Process|Stop-Process|npm\s+run\s+build|activation-journal|previous-release') 'private-LAN entry copied lifecycle behavior instead of delegating it'

Assert-True ($launcherSource -match 'runtimeConfigPath\s*=\s*Join-Path\s+\$projectRoot\s+''config\\runtime\.optimization\.json''') 'candidate Host no longer uses runtime.optimization.json'
Assert-True ($launcherSource -match 'Assert-OptimizationReleaseToolchain[\s\S]+-RuntimeConfigPath\s+\$runtimeConfigPath') 'launcher no longer applies the Python/toolchain health gate to the candidate runtime'
Assert-True ($launcherSource -match 'New-OptimizationReleaseStaging[\s\S]+-RuntimeConfigPath\s+\$runtimeConfigPath') 'LAN entry no longer reuses immutable release staging'
Assert-True ($launcherSource -match 'Start-OptimizationOwnedPair') 'LAN entry no longer reuses candidate Host and capability sidecar startup'
Assert-True ($launcherSource -match 'Stop-OptimizationOwnedState') 'LAN entry no longer reuses identity-checked stop behavior'
Assert-True ($launcherSource -match 'Invoke-OptimizationActivationRecovery') 'LAN entry no longer reuses activation rollback recovery'
Assert-True ($launcherSource -match "reservedDailyPorts\s*=\s*@\(5173,\s*8765,\s*5174,\s*8766\)") 'daily ports are no longer reserved'
Assert-True ($launcherSource -match "Optimization production host requires loopback frontend and backend hosts") 'candidate Host loopback gate is missing'
Assert-True ($launcherSource -match '''--host'',\s*\$frontDoorHost') 'stable front door does not use the selected LAN bind'
Assert-True ($launcherSource -match '''--transport-mode'',\s*\$frontDoorTransportMode') 'stable front door does not receive transport mode'
Assert-True ($launcherSource -match '''--configured-lan-host'',\s*\$configuredLanHost') 'stable front door does not receive configured LAN Host validation'
Assert-True ($launcherSource -match '\$frontDoorIdentityText\s*=\s*@\([\s\S]+\$frontDoorExecutableIdentity[\s\S]+\$frontDoorHost[\s\S]+\$frontDoorPort[\s\S]+\$frontDoorProcessHealthUrl[\s\S]+\$frontDoorTransportMode[\s\S]+\$configuredLanHost') 'managed front-door identity does not cover bind, health, transport, and LAN configuration'
Assert-True ($launcherSource -match 'Write-OptimizationFrontDoorTarget[\s\S]+-HostName\s+\$frontendHost') 'front-door target no longer stays on the candidate loopback Host'
Assert-True ($launcherSource -match 'Get-HostHealthUrl') 'candidate Python health path was bypassed'

Assert-True ([string]$lanConfig.transportMode -eq 'private-lan') 'LAN RuntimeConfig transport mode changed'
Assert-True ([string]$lanConfig.profileId -eq 'optimization') 'LAN RuntimeConfig profile changed'
Assert-True ([string]$lanConfig.frontend.host -eq [string]$lanConfig.configuredLanHost) 'LAN bind and configured Host differ'
Assert-True ([string]$lanConfig.configuredLanHost -eq 'active-private-ipv4' -and [string]$lanConfig.frontend.publicUrl -eq 'active-private-ipv4') 'LAN RuntimeConfig must resolve the active address instead of committing a machine-specific IPv4'
Assert-True ([int]$lanConfig.frontend.port -eq 5184) 'LAN stable front-door port must remain 5184'
Assert-True ([string]$lanConfig.backend.host -eq '127.0.0.1' -and [int]$lanConfig.backend.port -eq 8776) 'LAN capability sidecar must remain loopback 8776'
Assert-True ([string]$lanConfig.dataRoot -eq 'E:\ReadWebData\SubtitleWorkflow-Optimization') 'LAN RuntimeConfig left the optimization data root'
Assert-True ([string]$optimizationConfig.frontend.host -eq '127.0.0.1' -and [int]$optimizationConfig.frontend.port -eq 5184) 'ordinary optimization frontend changed'
Assert-True ([string]$optimizationConfig.backend.host -eq '127.0.0.1' -and [int]$optimizationConfig.backend.port -eq 8776) 'ordinary optimization backend changed'
Assert-True ([string]$optimizationConfig.dataRoot -eq 'E:\ReadWebData\SubtitleWorkflow-Optimization') 'ordinary optimization data root changed'
Assert-True ($configModuleSource -match "Get-NetRoute[\s\S]+DestinationPrefix\s+'0\.0\.0\.0/0'" -and $configModuleSource -match 'Get-NetIPInterface[\s\S]+ConnectionState\s+Connected') 'private-LAN resolver does not select an active default-route interface'
Assert-True ($runtimeCheckSource -match 'launcherPath\s*=\s*Join-Path\s+\$PSScriptRoot\s+''launch-private-lan-preview\.ps1''') 'runtime check bypasses the shipped private-LAN launcher'
Assert-True ($runtimeCheckSource -notmatch 'FrontDoorRuntimeConfigPath\s*=') 'runtime check overrides the shipped private-LAN RuntimeConfig seam'
Assert-True ($runtimeCheckSource -match 'AllowAutoRedirect\s*=\s*\$false' -and $runtimeCheckSource -match 'Assert-StableFrontDoorProbe') 'runtime HTTP probes do not reject or validate redirects'
Assert-True ($runtimeCheckSource -match 'Get-CapturedProcessIdentity' -and $runtimeCheckSource -match 'Wait-CapturedProcessExited') 'runtime cleanup does not verify each captured process identity exited'

Write-Host 'private-LAN launcher entry delegation and lifecycle boundary check passed'

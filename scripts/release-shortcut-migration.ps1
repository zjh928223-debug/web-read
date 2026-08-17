param(
  [ValidateSet('Plan', 'Apply', 'Rollback')][string]$Action = 'Plan',
  [Parameter(Mandatory)][string]$ShortcutPath,
  [Parameter(Mandatory)][string]$StatePath,
  [string]$NewScriptPath = 'E:\read-web-next\scripts\launch-next-preview.ps1',
  [string]$NewWorkingDirectory = 'E:\read-web-next',
  [switch]$AllowDesktopMutation
)

$ErrorActionPreference = 'Stop'
$shortcut = [IO.Path]::GetFullPath($ShortcutPath)
$state = [IO.Path]::GetFullPath($StatePath)
$desktop = [IO.Path]::GetFullPath([Environment]::GetFolderPath('Desktop')).TrimEnd('\') + '\'
if ($Action -ne 'Plan' -and $shortcut.StartsWith($desktop, [StringComparison]::OrdinalIgnoreCase) -and -not $AllowDesktopMutation) {
  throw 'Desktop shortcut mutation requires explicit -AllowDesktopMutation confirmation.'
}
if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { throw "Shortcut not found: $shortcut" }

$shell = New-Object -ComObject WScript.Shell
function Read-Shortcut([string]$Path) {
  $value = $shell.CreateShortcut($Path)
  return [ordered]@{ target = $value.TargetPath; arguments = $value.Arguments; workingDirectory = $value.WorkingDirectory; iconLocation = $value.IconLocation }
}
function Write-ShortcutAtomic([string]$Path, $Spec) {
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ('.' + [IO.Path]::GetFileNameWithoutExtension($Path) + '.' + [Guid]::NewGuid().ToString('N') + '.lnk')
  try {
    $value = $shell.CreateShortcut($temporary)
    $value.TargetPath = [string]$Spec.target
    $value.Arguments = [string]$Spec.arguments
    $value.WorkingDirectory = [string]$Spec.workingDirectory
    if ($Spec.iconLocation) { $value.IconLocation = [string]$Spec.iconLocation }
    $value.Save()
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}
function Write-StateAtomic([string]$Path, $Value) {
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ('.' + [IO.Path]::GetFileName($Path) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

$original = Read-Shortcut $shortcut
$next = [ordered]@{
  target = (Get-Command powershell.exe -ErrorAction Stop).Source
  arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$([IO.Path]::GetFullPath($NewScriptPath))`""
  workingDirectory = [IO.Path]::GetFullPath($NewWorkingDirectory)
  iconLocation = $original.iconLocation
}

if ($Action -eq 'Plan') {
  [pscustomobject]@{ status = 'planned'; shortcut = $shortcut; original = $original; next = $next } | ConvertTo-Json -Depth 8
  exit 0
}
if ($Action -eq 'Apply') {
  Write-StateAtomic $state ([ordered]@{ schema = 'read-web.shortcut-migration'; schemaVersion = 1; shortcut = $shortcut; capturedAt = [DateTime]::UtcNow.ToString('O'); original = $original; next = $next })
  Write-ShortcutAtomic $shortcut $next
  [pscustomobject]@{ status = 'applied'; shortcut = $shortcut; state = $state } | ConvertTo-Json
  exit 0
}

$saved = Get-Content -LiteralPath $state -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]$saved.schema -ne 'read-web.shortcut-migration' -or $null -eq $saved.original) { throw 'Shortcut rollback state is invalid.' }
if ([IO.Path]::GetFullPath([string]$saved.shortcut) -ne $shortcut) { throw 'Shortcut rollback state targets a different shortcut.' }
Write-ShortcutAtomic $shortcut $saved.original
[pscustomobject]@{ status = 'rolled-back'; shortcut = $shortcut; state = $state } | ConvertTo-Json

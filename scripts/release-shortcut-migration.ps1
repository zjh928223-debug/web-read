param(
  [ValidateSet('Plan', 'Apply', 'Rollback')][string]$Action = 'Plan',
  [Parameter(Mandatory)][string]$ShortcutPath,
  [Parameter(Mandatory)][string]$StatePath,
  [string]$NewScriptPath = '',
  [string]$NewWorkingDirectory = '',
  [string]$NewLauncherArguments = '',
  [switch]$AllowDesktopMutation
)

$ErrorActionPreference = 'Stop'
$shortcut = [IO.Path]::GetFullPath($ShortcutPath)
$state = [IO.Path]::GetFullPath($StatePath)
$pending = "$state.pending.json"
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
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}
function Read-State([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Test-ShortcutEqual($Left, $Right) {
  return [string]$Left.target -eq [string]$Right.target `
    -and [string]$Left.arguments -eq [string]$Right.arguments `
    -and [string]$Left.workingDirectory -eq [string]$Right.workingDirectory `
    -and [string]$Left.iconLocation -eq [string]$Right.iconLocation
}
function Remove-PendingState {
  if (Test-Path -LiteralPath $pending -PathType Leaf) { Remove-Item -LiteralPath $pending -Force }
}

$original = Read-Shortcut $shortcut
$next = $null
$resolvedNewScript = ''
$resolvedNewWorkingDirectory = ''
$resolvedLauncherArguments = ''
if ($Action -in @('Plan', 'Apply')) {
  if (-not $NewScriptPath -or -not $NewWorkingDirectory) {
    throw 'Plan/Apply require explicit -NewScriptPath and -NewWorkingDirectory; no protected workspace default is provided.'
  }
  $resolvedNewScript = [IO.Path]::GetFullPath($NewScriptPath)
  $resolvedNewWorkingDirectory = [IO.Path]::GetFullPath($NewWorkingDirectory)
  if (-not (Test-Path -LiteralPath $resolvedNewScript -PathType Leaf)) { throw "New shortcut script not found: $resolvedNewScript" }
  if (-not (Test-Path -LiteralPath $resolvedNewWorkingDirectory -PathType Container)) { throw "New shortcut working directory not found: $resolvedNewWorkingDirectory" }
  $resolvedLauncherArguments = $NewLauncherArguments.Trim()
  $fileArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$resolvedNewScript`""
  $nextArguments = if ($resolvedLauncherArguments) { "$fileArguments $resolvedLauncherArguments" } else { $fileArguments }
  $next = [ordered]@{
    target = (Get-Command powershell.exe -ErrorAction Stop).Source
    arguments = $nextArguments
    workingDirectory = $resolvedNewWorkingDirectory
    iconLocation = $original.iconLocation
  }
}
$existingState = Read-State $state
$existingPending = Read-State $pending

if ($Action -eq 'Plan') {
  [pscustomobject]@{
    status = 'planned'
    shortcut = $shortcut
    state = $state
    pendingState = $pending
    pendingTransaction = $null -ne $existingPending
    original = $original
    next = $next
    sideEffects = @('none')
  } | ConvertTo-Json -Depth 12
  exit 0
}

if ($null -ne $existingPending) {
  if ($Action -eq 'Rollback' -and [string]$existingPending.shortcut -eq $shortcut -and $null -ne $existingPending.from) {
    Write-ShortcutAtomic $shortcut $existingPending.from
    Remove-PendingState
    [pscustomobject]@{ status = 'recovered-pending-transaction'; shortcut = $shortcut; state = $state; sideEffects = @('restored pending original shortcut') } | ConvertTo-Json
    exit 0
  }
  throw "An unfinished shortcut transaction exists at $pending; refusing a new mutation."
}

if ($Action -eq 'Apply') {
  if ($null -ne $existingState) {
    if ([string]$existingState.schema -ne 'read-web.shortcut-migration' -or [string]$existingState.shortcut -ne $shortcut) { throw 'Existing shortcut migration state is invalid or targets another shortcut.' }
    if (Test-ShortcutEqual -Left $original -Right $existingState.next) {
      [pscustomobject]@{ status = 'already-applied'; shortcut = $shortcut; state = $state; sideEffects = @('none') } | ConvertTo-Json
      exit 0
    }
    throw "Shortcut migration state already exists but the current shortcut is not its saved target: $state"
  }
  $transaction = [ordered]@{
    schema = 'read-web.shortcut-migration.transaction'
    schemaVersion = 1
    operation = 'apply'
    shortcut = $shortcut
    from = $original
    to = $next
    createdAt = [DateTime]::UtcNow.ToString('O')
  }
  Write-StateAtomic $pending $transaction
  $shortcutChanged = $false
  try {
    Write-ShortcutAtomic $shortcut $next
    $shortcutChanged = $true
    Write-StateAtomic $state ([ordered]@{
      schema = 'read-web.shortcut-migration'
      schemaVersion = 1
      shortcut = $shortcut
      capturedAt = [DateTime]::UtcNow.ToString('O')
      original = $original
      next = $next
      launcherScript = $resolvedNewScript
      launcherArguments = $resolvedLauncherArguments
      workingDirectory = $resolvedNewWorkingDirectory
    })
    Remove-PendingState
    [pscustomobject]@{ status = 'applied'; shortcut = $shortcut; state = $state; sideEffects = @('updated one explicitly supplied shortcut', 'wrote rollback state atomically') } | ConvertTo-Json
    exit 0
  } catch {
    if ($shortcutChanged) {
      try {
        Write-ShortcutAtomic $shortcut $original
        Remove-PendingState
      } catch {
        throw "Shortcut Apply failed and automatic restoration also failed; pending transaction retained at $pending."
      }
    }
    throw
  }
}

if ($null -eq $existingState -or [string]$existingState.schema -ne 'read-web.shortcut-migration' -or $null -eq $existingState.original -or $null -eq $existingState.next) {
  throw 'Shortcut rollback state is invalid.'
}
if ([IO.Path]::GetFullPath([string]$existingState.shortcut) -ne $shortcut) { throw 'Shortcut rollback state targets a different shortcut.' }
$current = Read-Shortcut $shortcut
if (Test-ShortcutEqual -Left $current -Right $existingState.original) {
  [pscustomobject]@{ status = 'already-rolled-back'; shortcut = $shortcut; state = $state; sideEffects = @('none') } | ConvertTo-Json
  exit 0
}
if (-not (Test-ShortcutEqual -Left $current -Right $existingState.next)) {
  throw 'Current shortcut differs from both the saved original and the saved migrated target; refusing rollback.'
}
$rollbackTransaction = [ordered]@{
  schema = 'read-web.shortcut-migration.transaction'
  schemaVersion = 1
  operation = 'rollback'
  shortcut = $shortcut
  from = $current
  to = $existingState.original
  createdAt = [DateTime]::UtcNow.ToString('O')
}
Write-StateAtomic $pending $rollbackTransaction
$shortcutChanged = $false
try {
  Write-ShortcutAtomic $shortcut $existingState.original
  $shortcutChanged = $true
  Remove-PendingState
  [pscustomobject]@{ status = 'rolled-back'; shortcut = $shortcut; state = $state; sideEffects = @('restored saved original shortcut', 'preserved rollback state') } | ConvertTo-Json
  exit 0
} catch {
  if ($shortcutChanged) {
    try {
      Write-ShortcutAtomic $shortcut $current
      Remove-PendingState
    } catch {
      throw "Shortcut rollback failed and automatic restoration also failed; pending transaction retained at $pending."
    }
  }
  throw
}

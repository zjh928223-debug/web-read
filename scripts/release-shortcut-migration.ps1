param(
  [ValidateSet('Plan', 'Apply', 'Update', 'Rollback')][string]$Action = 'Plan',
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
function Invoke-ShortcutCrashPoint([string]$Phase) {
  if ([string]$env:READ_WEB_SHORTCUT_TEST_KILL_PHASE -ne $Phase) { return }
  Write-Host "Synthetic shortcut transaction crash at phase: $Phase"
  try { Stop-Process -Id $PID -Force -ErrorAction Stop } catch {}
  throw "Synthetic shortcut transaction crash at phase: $Phase"
}
function Assert-PendingTransaction([Parameter(Mandatory)]$PendingState) {
  if ([string]$PendingState.schema -ne 'read-web.shortcut-migration.transaction' -or [int]$PendingState.schemaVersion -ne 1) {
    throw "Pending shortcut transaction schema is invalid at $pending."
  }
  if ([IO.Path]::GetFullPath([string]$PendingState.shortcut) -ne $shortcut) {
    throw "Pending shortcut transaction targets a different shortcut: $pending"
  }
  if ([string]$PendingState.operation -notin @('apply', 'update', 'rollback') -or $null -eq $PendingState.from -or $null -eq $PendingState.to) {
    throw "Pending shortcut transaction operation or endpoints are invalid at $pending."
  }
  if ([string]$PendingState.operation -eq 'update' -and $null -eq $PendingState.state) {
    throw "Pending shortcut update transaction is missing its committed state at $pending."
  }
}
function Recover-PendingTransaction([Parameter(Mandatory)]$PendingState, [Parameter(Mandatory)]$Current, $ExistingState) {
  Assert-PendingTransaction -PendingState $PendingState
  if ([string]$PendingState.operation -ne $Action.ToLowerInvariant()) {
    throw "An unfinished $($PendingState.operation) shortcut transaction exists at $pending; use the matching action to recover it."
  }
  $from = $PendingState.from
  $to = $PendingState.to
  if ([string]$PendingState.operation -eq 'rollback') {
    if (Test-ShortcutEqual -Left $Current -Right $to) {
      Remove-PendingState
      return [pscustomobject]@{ status = 'recovered-pending-transaction'; operation = 'rollback'; shortcut = $shortcut; state = $state; sideEffects = @('confirmed the rollback target was already written', 'removed the pending transaction') }
    }
    if (Test-ShortcutEqual -Left $Current -Right $from) {
      Write-ShortcutAtomic $shortcut $to
      Remove-PendingState
      return [pscustomobject]@{ status = 'recovered-pending-transaction'; operation = 'rollback'; shortcut = $shortcut; state = $state; sideEffects = @('restored the pending rollback destination', 'removed the pending transaction') }
    }
    throw "Pending shortcut rollback is ambiguous: current shortcut matches neither from nor to; transaction retained at $pending."
  }

  if ([string]$PendingState.operation -eq 'update') {
    if (Test-ShortcutEqual -Left $Current -Right $from) {
      if ($null -ne $ExistingState -and (Test-ShortcutEqual -Left $ExistingState.next -Right $to)) {
        throw "Pending shortcut Update has committed rollback state but the current shortcut is still from; transaction retained at $pending."
      }
      Remove-PendingState
      return [pscustomobject]@{ status = 'recovered-pending-transaction'; operation = 'update'; shortcut = $shortcut; state = $state; sideEffects = @('confirmed the Update shortcut was not written', 'removed the pending transaction') }
    }
    if (Test-ShortcutEqual -Left $Current -Right $to) {
      if ($null -ne $ExistingState -and [string]$ExistingState.schema -eq 'read-web.shortcut-migration' -and (Test-ShortcutEqual -Left $ExistingState.next -Right $to)) {
        Remove-PendingState
        return [pscustomobject]@{ status = 'recovered-pending-transaction'; operation = 'update'; shortcut = $shortcut; state = $state; sideEffects = @('confirmed the Update rollback state was already written', 'removed the pending transaction') }
      }
      if ($null -eq $ExistingState -or [string]$ExistingState.schema -ne 'read-web.shortcut-migration' -or -not (Test-ShortcutEqual -Left $ExistingState.next -Right $from)) {
        throw "Pending shortcut Update conflicts with existing rollback state; transaction retained at $pending."
      }
      Write-StateAtomic $state $PendingState.state
      Remove-PendingState
      return [pscustomobject]@{ status = 'recovered-pending-transaction'; operation = 'update'; shortcut = $shortcut; state = $state; sideEffects = @('finalized the Update rollback state after the shortcut was already written', 'removed the pending transaction') }
    }
    throw "Pending shortcut Update is ambiguous: current shortcut matches neither from nor to; transaction retained at $pending."
  }

  if (Test-ShortcutEqual -Left $Current -Right $from) {
    if ($null -ne $ExistingState -and [string]$ExistingState.schema -eq 'read-web.shortcut-migration' -and (Test-ShortcutEqual -Left $ExistingState.next -Right $to)) {
      throw "Pending shortcut Apply has committed rollback state but the current shortcut is still from; transaction retained at $pending."
    }
    Remove-PendingState
    return [pscustomobject]@{ status = 'recovered-pending-transaction'; operation = 'apply'; shortcut = $shortcut; state = $state; sideEffects = @('confirmed the Apply shortcut was not written', 'removed the pending transaction') }
  }
  if (Test-ShortcutEqual -Left $Current -Right $to) {
    if ($null -ne $ExistingState) {
      if ([string]$ExistingState.schema -ne 'read-web.shortcut-migration' -or -not (Test-ShortcutEqual -Left $ExistingState.next -Right $to)) {
        throw "Pending shortcut Apply conflicts with existing rollback state; transaction retained at $pending."
      }
      Remove-PendingState
      return [pscustomobject]@{ status = 'recovered-pending-transaction'; operation = 'apply'; shortcut = $shortcut; state = $state; sideEffects = @('confirmed the Apply rollback state was already written', 'removed the pending transaction') }
    }
    Write-ShortcutAtomic $shortcut $from
    Remove-PendingState
    return [pscustomobject]@{ status = 'recovered-pending-transaction'; operation = 'apply'; shortcut = $shortcut; state = $state; sideEffects = @('restored the original shortcut after an incomplete Apply', 'removed the pending transaction') }
  }
  throw "Pending shortcut Apply is ambiguous: current shortcut matches neither from nor to; transaction retained at $pending."
}

$original = Read-Shortcut $shortcut
$next = $null
$resolvedNewScript = ''
$resolvedNewWorkingDirectory = ''
$resolvedLauncherArguments = ''
if ($Action -in @('Plan', 'Apply', 'Update')) {
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
  $recovered = Recover-PendingTransaction -PendingState $existingPending -Current $original -ExistingState $existingState
  $recovered | ConvertTo-Json -Depth 12
  exit 0
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

if ($Action -eq 'Update') {
  if ($null -eq $existingState -or [string]$existingState.schema -ne 'read-web.shortcut-migration' -or $null -eq $existingState.original -or $null -eq $existingState.next) {
    throw 'Shortcut update requires an existing valid rollback state.'
  }
  if ([IO.Path]::GetFullPath([string]$existingState.shortcut) -ne $shortcut) { throw 'Shortcut rollback state targets a different shortcut.' }
  if (Test-ShortcutEqual -Left $original -Right $next) {
    [pscustomobject]@{ status = 'already-updated'; shortcut = $shortcut; state = $state; sideEffects = @('none') } | ConvertTo-Json
    exit 0
  }
  if (-not (Test-ShortcutEqual -Left $original -Right $existingState.next)) {
    throw 'Current shortcut differs from the saved migrated target; refusing update.'
  }
  $updatedState = [ordered]@{
    schema = 'read-web.shortcut-migration'
    schemaVersion = 1
    shortcut = $shortcut
    capturedAt = [DateTime]::UtcNow.ToString('O')
    original = $existingState.original
    next = $next
    launcherScript = $resolvedNewScript
    launcherArguments = $resolvedLauncherArguments
    workingDirectory = $resolvedNewWorkingDirectory
  }
  $updateTransaction = [ordered]@{
    schema = 'read-web.shortcut-migration.transaction'
    schemaVersion = 1
    operation = 'update'
    shortcut = $shortcut
    from = $existingState.next
    to = $next
    state = $updatedState
    createdAt = [DateTime]::UtcNow.ToString('O')
  }
  Write-StateAtomic $pending $updateTransaction
  $shortcutChanged = $false
  $stateChanged = $false
  try {
    Write-ShortcutAtomic $shortcut $next
    $shortcutChanged = $true
    Write-StateAtomic $state $updatedState
    $stateChanged = $true
    Remove-PendingState
    [pscustomobject]@{ status = 'updated'; shortcut = $shortcut; state = $state; sideEffects = @('updated one explicitly supplied shortcut target', 'preserved the saved original rollback target', 'updated rollback state atomically') } | ConvertTo-Json
    exit 0
  } catch {
    try {
      if ($shortcutChanged) { Write-ShortcutAtomic $shortcut $existingState.next }
      if ($stateChanged) { Write-StateAtomic $state $existingState }
      Remove-PendingState
    } catch {
      throw "Shortcut Update failed and automatic restoration also failed; pending transaction retained at $pending."
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
Invoke-ShortcutCrashPoint -Phase 'rollback-pending-written'
$shortcutChanged = $false
try {
  Write-ShortcutAtomic $shortcut $existingState.original
  $shortcutChanged = $true
  Invoke-ShortcutCrashPoint -Phase 'rollback-shortcut-written'
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

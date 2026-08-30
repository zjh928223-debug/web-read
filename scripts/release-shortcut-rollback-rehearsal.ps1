param(
  [string]$SourceShortcut = '',
  [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$migration = Join-Path $PSScriptRoot 'release-shortcut-migration.ps1'
$root = if ($OutputRoot) { [IO.Path]::GetFullPath($OutputRoot) } else { Join-Path ([IO.Path]::GetTempPath()) ('read-web-shortcut-rehearsal-' + [Guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Force -Path $root | Out-Null
$shell = New-Object -ComObject WScript.Shell

if ($SourceShortcut) {
  $source = [IO.Path]::GetFullPath($SourceShortcut)
  $desktop = [IO.Path]::GetFullPath([Environment]::GetFolderPath('Desktop')).TrimEnd('\') + '\'
  if ($source.StartsWith($desktop, [StringComparison]::OrdinalIgnoreCase)) { throw 'Shortcut rehearsal refuses Desktop sources; use a temporary fixture shortcut.' }
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Source shortcut not found: $source" }
} else {
  $source = Join-Path $root 'source-fixture.lnk'
  $fixture = $shell.CreateShortcut($source)
  $fixture.TargetPath = (Get-Command powershell.exe -ErrorAction Stop).Source
  $fixture.Arguments = '-NoProfile -Command "Write-Output legacy"'
  $fixture.WorkingDirectory = $root
  $fixture.Save()
}

$testShortcut = Join-Path $root 'read-web-rehearsal.lnk'
$state = Join-Path $root 'shortcut-state.json'
Copy-Item -LiteralPath $source -Destination $testShortcut
function File-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
  } finally { $stream.Dispose() }
}
function Snapshot([string]$Path) {
  $value = $shell.CreateShortcut($Path)
  return [pscustomobject]@{ target = $value.TargetPath; arguments = $value.Arguments; workingDirectory = $value.WorkingDirectory; iconLocation = $value.IconLocation }
}
function Same($Left, $Right) {
  return $Left.target -eq $Right.target -and $Left.arguments -eq $Right.arguments -and $Left.workingDirectory -eq $Right.workingDirectory -and $Left.iconLocation -eq $Right.iconLocation
}

$sourceHashBefore = File-Sha256 $source
$original = Snapshot $testShortcut
$targetScript = Join-Path $PSScriptRoot 'launch-daily-production.ps1'
& $migration -Action Apply -ShortcutPath $testShortcut -StatePath $state -NewScriptPath $targetScript -NewWorkingDirectory $projectRoot -NewLauncherArguments '-Action Start -NoOpen' | Out-Null
$switched = Snapshot $testShortcut
if ($switched.workingDirectory -ne $projectRoot -or $switched.arguments -notlike "*$targetScript*" -or $switched.arguments -notlike '*-Action Start -NoOpen*') { throw 'Atomic shortcut switch did not target the explicit daily-production launcher.' }
& $migration -Action Rollback -ShortcutPath $testShortcut -StatePath $state | Out-Null
$rolledBack = Snapshot $testShortcut
if (-not (Same $original $rolledBack)) { throw 'Normal shortcut rollback did not restore the original target.' }

$failureShortcut = Join-Path $root 'read-web-failure-rehearsal.lnk'
$failureState = Join-Path $root 'failure-shortcut-state.json'
Copy-Item -LiteralPath $testShortcut -Destination $failureShortcut
$failureOriginal = Snapshot $failureShortcut
& $migration -Action Apply -ShortcutPath $failureShortcut -StatePath $failureState -NewScriptPath $targetScript -NewWorkingDirectory $projectRoot -NewLauncherArguments '-Action Start -NoOpen' | Out-Null
try {
  throw 'simulated post-switch health failure'
} catch {
  & $migration -Action Rollback -ShortcutPath $failureShortcut -StatePath $failureState | Out-Null
}
$automaticRollback = Snapshot $failureShortcut
if (-not (Same $failureOriginal $automaticRollback)) { throw 'Health-failure rollback did not restore the original target.' }
$sourceHashAfter = File-Sha256 $source
if ($sourceHashBefore -ne $sourceHashAfter) { throw 'The source fixture shortcut changed during rehearsal.' }

$report = [ordered]@{
  schema = 'read-web.shortcut-rollback-rehearsal'
  schemaVersion = 1
  status = 'passed'
  capturedAt = [DateTime]::UtcNow.ToString('O')
  sourceShortcut = [IO.Path]::GetFullPath($source)
  sourceSha256Before = $sourceHashBefore
  sourceSha256After = $sourceHashAfter
  testShortcut = $testShortcut
  targetScript = $targetScript
  original = $original
  switched = $switched
  normalRollback = $rolledBack
  healthFailureRollback = $automaticRollback
}
$reportPath = Join-Path $root 'shortcut-rollback-rehearsal.json'
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Output "Shortcut rollback rehearsal passed: $reportPath"

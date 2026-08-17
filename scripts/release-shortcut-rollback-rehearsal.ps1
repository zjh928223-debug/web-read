param(
  [string]$SourceShortcut = '',
  [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$migration = Join-Path $PSScriptRoot 'release-shortcut-migration.ps1'
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$source = $SourceShortcut
if (-not $source) {
  $source = Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -File | Where-Object {
    $candidate = $shell.CreateShortcut($_.FullName)
    $candidate.Arguments -like '*E:\read-web\scripts\launch-learning-page.ps1*'
  } | Select-Object -First 1 -ExpandProperty FullName
}
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Daily shortcut not found: $source" }
$root = if ($OutputRoot) { [IO.Path]::GetFullPath($OutputRoot) } else { Join-Path ([IO.Path]::GetTempPath()) ('read-web-shortcut-rehearsal-' + [Guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Force -Path $root | Out-Null
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
$sourceHashBefore = File-Sha256 $source
function Snapshot([string]$Path) {
  $value = $shell.CreateShortcut($Path)
  return [pscustomobject]@{ target = $value.TargetPath; arguments = $value.Arguments; workingDirectory = $value.WorkingDirectory }
}
function Same($Left, $Right) {
  return $Left.target -eq $Right.target -and $Left.arguments -eq $Right.arguments -and $Left.workingDirectory -eq $Right.workingDirectory
}

$original = Snapshot $testShortcut
& $migration -Action Apply -ShortcutPath $testShortcut -StatePath $state | Out-Null
$switched = Snapshot $testShortcut
if ($switched.workingDirectory -ne $projectRoot -or $switched.arguments -notlike '*E:\read-web-next\scripts\launch-next-preview.ps1*') { throw 'Atomic shortcut switch did not target Next.' }
& $migration -Action Rollback -ShortcutPath $testShortcut -StatePath $state | Out-Null
$rolledBack = Snapshot $testShortcut
if (-not (Same $original $rolledBack)) { throw 'Normal shortcut rollback did not restore the original target.' }

& $migration -Action Apply -ShortcutPath $testShortcut -StatePath $state | Out-Null
try {
  throw 'simulated post-switch health failure'
} catch {
  & $migration -Action Rollback -ShortcutPath $testShortcut -StatePath $state | Out-Null
}
$automaticRollback = Snapshot $testShortcut
if (-not (Same $original $automaticRollback)) { throw 'Health-failure rollback did not restore the original target.' }
$sourceHashAfter = File-Sha256 $source
if ($sourceHashBefore -ne $sourceHashAfter) { throw 'The daily shortcut changed during rehearsal.' }

$report = [ordered]@{
  schema = 'read-web.shortcut-rollback-rehearsal'
  schemaVersion = 1
  status = 'passed'
  capturedAt = [DateTime]::UtcNow.ToString('O')
  sourceShortcut = [IO.Path]::GetFullPath($source)
  sourceSha256Before = $sourceHashBefore
  sourceSha256After = $sourceHashAfter
  testShortcut = $testShortcut
  original = $original
  switched = $switched
  normalRollback = $rolledBack
  healthFailureRollback = $automaticRollback
}
$reportPath = Join-Path $root 'shortcut-rollback-rehearsal.json'
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Output "Shortcut rollback rehearsal passed: $reportPath"

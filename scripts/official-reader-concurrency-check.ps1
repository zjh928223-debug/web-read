param([int]$Runs = 3)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $root '.codex\runtime-state\optimization\production-host.json'
$logRoot = Join-Path $root ('.codex\startup-logs\concurrency-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$before = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
$mutex = [Threading.Mutex]::new($false, 'Local\ReadWebOfficialReader-5184')
$owns = $false
$logHandle = $null
$children = @()
try {
  $owns = $mutex.WaitOne(5000)
  if (-not $owns) { throw 'Another startup is active; test did not acquire the guard.' }
  # Reproduce the shared log being held by an earlier startup. Later clicks
  # must wait at the guard instead of attempting another redirection.
  $logHandle = [IO.File]::Open((Join-Path $root '.codex\startup-logs\official-reader-launch.log'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $children = @(1..$Runs | ForEach-Object {
    Start-Process -FilePath 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'start-official-reader.ps1'),'-Quiet','-NoOpen') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "run-$_.out.log") -RedirectStandardError (Join-Path $logRoot "run-$_.err.log") -PassThru
  })
  Start-Sleep -Seconds 3
  $startupLog = Get-Content -LiteralPath (Join-Path $root '.codex\startup-logs\official-reader-startup.log') -Raw -Encoding UTF8
  foreach ($child in $children) {
    if ($child.HasExited -or $startupLog.Contains("(PID $($child.Id)).")) { throw 'A queued launch entered startup before the guard was released.' }
  }
  $logHandle.Dispose()
  $logHandle = $null
  $mutex.ReleaseMutex()
  $owns = $false
  $results = foreach ($child in $children) {
    if (-not $child.WaitForExit(30000)) { throw "Startup did not complete: PID $($child.Id)." }
    [pscustomobject]@{ pid = $child.Id; exitCode = $child.ExitCode }
  }
  $after = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $health = Invoke-RestMethod 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 5
  $report = [pscustomobject]@{ runs = $results; servicePidUnchanged = $before.pid -eq $after.pid; status = $health.status; acceptingRequests = $health.acceptingRequests }
  $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $logRoot 'result.json') -Encoding UTF8
  if (@($results | Where-Object { $_.exitCode -ne 0 }).Count -gt 0 -or $health.status -ne 'ready' -or -not $health.acceptingRequests -or $before.pid -ne $after.pid) { throw 'Concurrent startup verification failed.' }
  Write-Host "PASS: $Runs concurrent desktop-mode launches waited for the locked log, all exited 0, and reused the ready service."
  Write-Host "Report: $logRoot\result.json"
} finally {
  if ($null -ne $logHandle) { $logHandle.Dispose() }
  if ($owns) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}

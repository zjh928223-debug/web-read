param(
  [int]$ServicePort = 8765
)

$ErrorActionPreference = "Stop"

$connections = @(Get-NetTCPConnection -LocalPort $ServicePort -State Listen -ErrorAction SilentlyContinue)
if (-not $connections.Count) {
  Write-Host "No local workflow service is listening on port $ServicePort."
  exit 0
}

$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($processId in $processIds) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process) {
    continue
  }
  Write-Host "Stopping workflow service process $processId ($($process.ProcessName))..."
  Stop-Process -Id $processId -Force
}

Write-Host "Workflow service stop request completed."

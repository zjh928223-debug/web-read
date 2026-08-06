param(
  [int]$PollSeconds = 30
)

$ErrorActionPreference = 'Stop'
$expectedRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\data\dictionaries\sources'))
if (-not $expectedRoot.StartsWith('E:\read-web\data\dictionaries\sources', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Unexpected local dictionary destination: $expectedRoot"
}

do {
  $jobs = @(Get-BitsTransfer -ErrorAction SilentlyContinue | Where-Object {
    $_.DisplayName -like 'read-web-*'
  })
  foreach ($job in $jobs) {
    if ($job.JobState -eq 'Transferred') {
      Complete-BitsTransfer -BitsJob $job
    } elseif ($job.JobState -eq 'TransientError') {
      Resume-BitsTransfer -BitsJob $job -Asynchronous | Out-Null
    }
  }
  if ($jobs.Count -gt 0) {
    Start-Sleep -Seconds ([Math]::Max(10, $PollSeconds))
  }
} while ($jobs.Count -gt 0)

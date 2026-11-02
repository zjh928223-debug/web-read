param([switch]$NoOpen, [switch]$Quiet)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Resolve-OfficialReaderPython {
  param([string]$PublishedPath, [string]$ConfiguredPath)
  foreach ($candidate in @($ConfiguredPath, $PublishedPath)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
  }
  throw "Python runtime not found. Checked: $PublishedPath ; $ConfiguredPath"
}
$projectRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $projectRoot '.codex\startup-logs\official-reader-startup.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null
Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format s) Starting official reader (PID $PID)." -Encoding UTF8
try {
  # Use the managed runtime independently of Explorer's inherited PATH.
  $nodeDirectory = 'E:\ReadWebRuntime\node-v24.13.1'
  $env:Path = (@($nodeDirectory) + @($env:Path -split ';' | Where-Object { $_ } | Select-Object -Unique)) -join ';'
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format s) Node: $nodeDirectory\node.exe" -Encoding UTF8
  $tailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  if (-not (Test-Path -LiteralPath $tailscale)) { throw 'Tailscale is not installed.' }
  $statusText = & $tailscale status --json
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale status.' }
  $status = ($statusText -join "`n") | ConvertFrom-Json
  if ($status.BackendState -ne 'Running') { throw 'Open Tailscale and connect before starting Read-Web.' }
  $dnsName = ([string]$status.Self.DNSName).TrimEnd('.')
  if (-not $dnsName) { throw 'Tailscale has no DNS name for this Windows computer.' }
  $macUrl = "https://${dnsName}:5184/"

  $serveText = & $tailscale serve status --json
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale Serve configuration.' }
  $serve = ($serveText -join "`n") | ConvertFrom-Json
  $webProperty = $serve.PSObject.Properties['Web']
  $entry = if ($null -ne $webProperty) { $webProperty.Value.PSObject.Properties["${dnsName}:5184"] } else { $null }
  if ($null -eq $entry) {
    & $tailscale serve --bg --https=5184 http://127.0.0.1:5184
    if ($LASTEXITCODE -ne 0) { throw 'Cannot configure the Tailscale 5184 entry.' }
  } elseif ($entry.Value.Handlers.'/'.Proxy -ne 'http://127.0.0.1:5184') {
    throw 'Tailscale port 5184 points to an unexpected service; refusing to replace it.'
  }

  $activePath = Join-Path $projectRoot '.codex\runtime-state\optimization\active-release.json'
  $active = Get-Content -LiteralPath $activePath -Raw | ConvertFrom-Json
  $manifest = Get-Content -LiteralPath $active.manifestPath -Raw | ConvertFrom-Json
  $runtimeConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'config\runtime.optimization.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $pythonPath = Resolve-OfficialReaderPython -PublishedPath ([string]$manifest.runtime.pythonIdentity.executable) -ConfiguredPath ([string]$runtimeConfig.python.executable)
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format s) Python: $pythonPath" -Encoding UTF8

  if (-not $Quiet) { Write-Host 'Starting the published Read-Web version on 5184...' }
  if ($Quiet) {
    & (Join-Path $PSScriptRoot 'launch-optimization-preview.ps1') -UseActiveRelease -NoOpen -BootstrapPython $pythonPath -FrontDoorPublicOrigin $macUrl *> (Join-Path (Split-Path -Parent $logPath) 'official-reader-launch.log')
  } else {
    & (Join-Path $PSScriptRoot 'launch-optimization-preview.ps1') -UseActiveRelease -NoOpen -BootstrapPython $pythonPath -FrontDoorPublicOrigin $macUrl
  }
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 10
  if ($health.status -ne 'ready') { throw 'Read-Web backend is not ready.' }
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format s) Read-Web is ready (5184)." -Encoding UTF8
  if (-not $Quiet) {
    Write-Host 'Read-Web is ready. Windows: http://127.0.0.1:5184/'
    Write-Host "Mac (Tailscale connected): $macUrl"
  }
  if (-not $NoOpen) { Start-Process 'http://127.0.0.1:5184/' }
} catch {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format s) Startup failed: $($_.Exception.Message)" -Encoding UTF8
  if ($Quiet) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('Read-Web could not start. Details are saved in the startup log.', 'Read-Web', 'OK', 'Error') | Out-Null
  } else {
    Write-Host "Read-Web startup failed: $($_.Exception.Message)" -ForegroundColor Red
    if (-not $NoOpen) { Read-Host 'Press Enter to close' | Out-Null }
  }
  exit 1
}

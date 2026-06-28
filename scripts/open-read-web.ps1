$ErrorActionPreference = "Stop"

$startupScript = Join-Path $PSScriptRoot "start-youtube-reader.ps1"
if (-not (Test-Path -LiteralPath $startupScript)) {
  throw "Reader startup script not found: $startupScript"
}

& $startupScript

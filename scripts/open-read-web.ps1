$ErrorActionPreference = 'SilentlyContinue'
$workspace = 'E:\read-web'
$url = 'http://127.0.0.1:5173/'
$portOpen = $false
try {
  $connection = Test-NetConnection -ComputerName 127.0.0.1 -Port 5173 -InformationLevel Quiet
  $portOpen = [bool]$connection
} catch {
  $portOpen = $false
}
if (-not $portOpen) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev -- --host 127.0.0.1 --port 5173' -WorkingDirectory $workspace -WindowStyle Hidden
  Start-Sleep -Seconds 3
}
Start-Process $url

param(
  [string]$ReaderRoot = "E:\read-web",
  [string]$WorkflowRoot = "C:\Users\0\Desktop\SubtitleWorkflow",
  [string]$ServiceHealthUrl = "http://127.0.0.1:8765/api/health",
  [string]$ReaderUrl = "http://127.0.0.1:5173"
)

function Test-HttpOk {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath $WorkflowRoot)) {
  throw "SubtitleWorkflow path not found: $WorkflowRoot"
}
if (-not (Test-Path -LiteralPath $ReaderRoot)) {
  throw "Reader path not found: $ReaderRoot"
}

if (-not (Test-HttpOk -Url $ServiceHealthUrl)) {
  Start-Process -FilePath "python" `
    -ArgumentList @("-m", "uvicorn", "youtube_workflow.service:app", "--host", "127.0.0.1", "--port", "8765") `
    -WorkingDirectory $WorkflowRoot `
    -WindowStyle Hidden
}

Start-Sleep -Milliseconds 700

if (-not (Test-HttpOk -Url $ReaderUrl)) {
  Start-Process -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "Set-Location -LiteralPath '$ReaderRoot'; npm run dev -- --host 127.0.0.1") `
    -WorkingDirectory $ReaderRoot `
    -WindowStyle Hidden
}

Start-Sleep -Milliseconds 700
Start-Process $ReaderUrl

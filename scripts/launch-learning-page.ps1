param(
  [switch]$NoOpen,
  [string]$WorkflowRoot = '',
  [string]$WorkflowDataRoot = 'E:\ReadWebData\SubtitleWorkflow',
  [string]$DictionaryDataRoot = 'E:\read-web\data\dictionaries',
  [string]$ServiceHealthUrl = 'http://127.0.0.1:8765/api/health',
  [string]$ReaderUrl = 'http://127.0.0.1:5173/',
  [string]$PythonPath = 'C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe',
  [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$WorkflowRoot = if ($WorkflowRoot) { $WorkflowRoot } else { Join-Path $projectRoot 'tools\subtitle-workflow' }
$workflowLauncher = Join-Path $PSScriptRoot 'start-latest-reader.ps1'
$baseUrl = $ReaderUrl.TrimEnd('/')
$learningUrl = "$baseUrl/"
$serverMarker = '<title>Advanced Seek Player + Smart Chunking (Pro)</title>'

function Test-ReadWebServer {
  try {
    $response = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content.Contains($serverMarker)
  } catch {
    return $false
  }
}

try {
  if (-not (Test-Path -LiteralPath $workflowLauncher)) {
    throw "Workflow launcher not found: $workflowLauncher"
  }

  & $workflowLauncher `
    -ServiceOnly `
    -NoOpen `
    -ReaderRoot $projectRoot `
    -WorkflowRoot $WorkflowRoot `
    -WorkflowDataRoot $WorkflowDataRoot `
    -ServiceHealthUrl $ServiceHealthUrl `
    -ReaderUrl $baseUrl `
    -PythonPath $PythonPath `
    -StartupTimeoutSeconds $StartupTimeoutSeconds

  if (-not (Test-ReadWebServer)) {
    $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    $readerUri = [Uri]$baseUrl
    $readerPort = $readerUri.Port
    $serviceUri = [Uri]$ServiceHealthUrl
    $env:VITE_LOCAL_SERVICE_BASE_URL = $serviceUri.GetLeftPart([System.UriPartial]::Authority)
    $ecdictDatabasePath = Join-Path $DictionaryDataRoot 'ecdict.sqlite'
    $localSentenceDatabasePath = Join-Path $DictionaryDataRoot 'local-sentences.sqlite'
    $sentenceTranslationDatabasePath = Join-Path $DictionaryDataRoot 'local-sentence-translations.sqlite'
    if (Test-Path -LiteralPath $ecdictDatabasePath) {
      $env:ECDICT_ENABLED = 'true'
      $env:ECDICT_DATABASE_PATH = $ecdictDatabasePath
    }
    if (Test-Path -LiteralPath $localSentenceDatabasePath) {
      $env:LOCAL_SENTENCE_DATABASE_PATH = $localSentenceDatabasePath
    }
    if (Test-Path -LiteralPath $sentenceTranslationDatabasePath) {
      $env:SENTENCE_TRANSLATION_CACHE_PATH = $sentenceTranslationDatabasePath
    }
    $stdoutLog = Join-Path $env:TEMP "read-web-learning-vite-$readerPort.out.log"
    $stderrLog = Join-Path $env:TEMP "read-web-learning-vite-$readerPort.err.log"
    $serverProcess = Start-Process `
      -FilePath $npmCommand `
      -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', "$readerPort", '--strictPort') `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog `
      -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline -and -not (Test-ReadWebServer)) {
      if ($serverProcess.HasExited) { break }
      Start-Sleep -Milliseconds 250
    }
  }

  if (-not (Test-ReadWebServer)) {
    throw 'The local learning service did not start within 30 seconds. Check the read-web-learning-vite logs in the temporary directory.'
  }

  if (-not $NoOpen) {
    Start-Process $learningUrl
  }
} catch {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.Popup($_.Exception.Message, 0, 'Read-Web Learning Page', 16)
  exit 1
}

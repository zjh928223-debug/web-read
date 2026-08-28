param(
  [switch]$NoOpen,
  [string]$WorkflowRoot = '',
  [string]$RuntimeConfigPath = '',
  [string]$WorkflowDataRoot = '',
  [string]$DictionaryDataRoot = '',
  [string]$ServiceHealthUrl = '',
  [string]$ReaderUrl = '',
  [string]$PythonPath = '',
  [int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$WorkflowRoot = if ($WorkflowRoot) { $WorkflowRoot } else { Join-Path $projectRoot 'tools\subtitle-workflow' }
$RuntimeConfigPath = if ($RuntimeConfigPath) { $RuntimeConfigPath } elseif ($env:READ_WEB_RUNTIME_CONFIG) { $env:READ_WEB_RUNTIME_CONFIG } else { Join-Path $projectRoot 'config\runtime.legacy.json' }
$DictionaryDataRoot = if ($DictionaryDataRoot) { $DictionaryDataRoot } else { Join-Path $projectRoot 'data\dictionaries' }
$bootstrapPython = if ($PythonPath) { $PythonPath } elseif ($env:READ_WEB_PYTHON) { $env:READ_WEB_PYTHON } elseif ($env:READ_WEB_PYTHON_PATH) { $env:READ_WEB_PYTHON_PATH } else { (Get-Command python -ErrorAction Stop).Source }
$runtimeArguments = @('-m', 'youtube_workflow.runtime_config')
$runtimeArguments += @('--config', $RuntimeConfigPath)
Push-Location $WorkflowRoot
try { $runtime = (& $bootstrapPython @runtimeArguments | ConvertFrom-Json) } finally { Pop-Location }
if (-not $WorkflowDataRoot) { $WorkflowDataRoot = $runtime.dataRoot }
if (-not $ServiceHealthUrl) { $ServiceHealthUrl = $runtime.backend.healthUrl }
if (-not $ReaderUrl) { $ReaderUrl = $runtime.frontend.url }
if (-not $PythonPath) { $PythonPath = $runtime.python.executable }
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
    -RuntimeConfigPath $RuntimeConfigPath `
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
      -ArgumentList @('run', 'dev') `
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

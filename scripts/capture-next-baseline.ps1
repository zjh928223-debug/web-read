param(
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$defaultOutputDirectory = Join-Path $repositoryRoot 'output\baselines'
$timestamp = [DateTimeOffset]::UtcNow

function Invoke-ReadOnlyCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @()
  )

  $resolved = Get-Command $Command -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $resolved) {
    return [ordered]@{
      available = $false
      exitCode = $null
      output = $null
      error = 'command-not-found'
    }
  }

  try {
    $commandOutput = @(& $resolved.Source @Arguments 2>&1 | ForEach-Object { "$_" })
    $exitCode = $LASTEXITCODE
    return [ordered]@{
      available = $true
      exitCode = $exitCode
      output = ($commandOutput -join "`n").Trim()
      error = $null
    }
  } catch {
    return [ordered]@{
      available = $true
      exitCode = $null
      output = $null
      error = $_.Exception.GetType().Name
    }
  }
}

function Get-GitBaseline {
  $revision = Invoke-ReadOnlyCommand -Command 'git' -Arguments @('-C', $repositoryRoot, 'rev-parse', 'HEAD')
  $branch = Invoke-ReadOnlyCommand -Command 'git' -Arguments @('-C', $repositoryRoot, 'branch', '--show-current')
  $status = Invoke-ReadOnlyCommand -Command 'git' -Arguments @('-C', $repositoryRoot, 'status', '--short', '--branch')

  $statusLines = if ([string]::IsNullOrWhiteSpace($status.output)) {
    @()
  } else {
    @($status.output -split "`r?`n")
  }

  return [ordered]@{
    sha = $revision.output
    branch = $branch.output
    status = $statusLines
    isDirty = @($statusLines | Where-Object { -not $_.StartsWith('## ') }).Count -gt 0
    commandAvailable = [bool]$revision.available
  }
}

function Get-ToolBaseline {
  $node = Invoke-ReadOnlyCommand -Command 'node' -Arguments @('--version')
  $npm = Invoke-ReadOnlyCommand -Command 'npm' -Arguments @('--version')
  $python = Invoke-ReadOnlyCommand -Command 'python' -Arguments @('--version')
  $pip = Invoke-ReadOnlyCommand -Command 'python' -Arguments @('-m', 'pip', '--version')

  return [ordered]@{
    node = $node
    npm = $npm
    python = $python
    pip = $pip
    powershell = [ordered]@{
      edition = $PSVersionTable.PSEdition
      version = $PSVersionTable.PSVersion.ToString()
    }
  }
}

function Get-PortListeners {
  param([Parameter(Mandatory = $true)][int]$Port)

  $listeners = @()
  try {
    $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
    foreach ($connection in $connections) {
      $processName = $null
      try {
        $processName = (Get-Process -Id $connection.OwningProcess -ErrorAction Stop).ProcessName
      } catch {
        $processName = $null
      }

      $listeners += [ordered]@{
        address = $connection.LocalAddress
        port = [int]$connection.LocalPort
        pid = [int]$connection.OwningProcess
        processName = $processName
      }
    }
  } catch {
    # Access to Get-NetTCPConnection can vary by host. netstat remains read-only.
    $netstat = Invoke-ReadOnlyCommand -Command 'netstat.exe' -Arguments @('-ano', '-p', 'tcp')
    if ($netstat.available -and $netstat.exitCode -eq 0) {
      $pattern = '^\s*TCP\s+(\S+):' + [regex]::Escape("$Port") + '\s+\S+\s+LISTENING\s+(\d+)\s*$'
      foreach ($line in @($netstat.output -split "`r?`n")) {
        if ($line -match $pattern) {
          $processId = [int]$Matches[2]
          $processName = $null
          try {
            $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
          } catch {
            $processName = $null
          }
          $listeners += [ordered]@{
            address = $Matches[1]
            port = $Port
            pid = $processId
            processName = $processName
          }
        }
      }
    }
  }

  return @($listeners | Sort-Object pid, address -Unique)
}

function Get-HealthProbe {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][ValidateSet('frontend', 'workflow')][string]$Kind
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 3
    $stopwatch.Stop()
    $probe = [ordered]@{
      url = $Url
      reachable = $true
      statusCode = [int]$response.StatusCode
      durationMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 1)
      contentType = [string]$response.Headers['Content-Type']
      health = $null
      error = $null
    }

    if ($Kind -eq 'workflow') {
      try {
        $body = $response.Content | ConvertFrom-Json
        $probe.health = [ordered]@{
          status = $body.status
          service = $body.service
          serviceVersion = $body.serviceVersion
          featureNames = @($body.features.PSObject.Properties | Where-Object { $_.Value -eq $true } | ForEach-Object { $_.Name })
        }
      } catch {
        $probe.health = [ordered]@{ parseError = 'invalid-json' }
      }
    }

    return $probe
  } catch {
    $stopwatch.Stop()
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }
    return [ordered]@{
      url = $Url
      reachable = $false
      statusCode = $statusCode
      durationMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 1)
      contentType = $null
      health = $null
      error = $_.Exception.GetType().Name
    }
  }
}

function Get-RuntimeEnvironmentPresence {
  $variableNames = @(
    'READ_WEB_SUBTITLE_DATA_ROOT',
    'READ_WEB_RUNTIME_CONFIG',
    'READ_WEB_FRONTEND_PORT',
    'READ_WEB_WORKFLOW_PORT',
    'VITE_LOCAL_SERVICE_BASE_URL',
    'ECDICT_ENABLED',
    'ECDICT_DB_PATH',
    'MERRIAM_WEBSTER_DICTIONARY_API_KEY',
    'VOCABULARY_TRANSLATION_API_KEY',
    'VOCABULARY_TRANSLATION_MODEL',
    'VOCABULARY_TRANSLATION_FALLBACK_MODELS',
    'VOCABULARY_TRANSLATION_PROXY_URL',
    'VOCABULARY_AI_PREVIEW_API_KEY',
    'VOCABULARY_AI_PREVIEW_MODEL',
    'VOCABULARY_AI_PREVIEW_FALLBACK_MODELS',
    'VOCABULARY_AI_PREVIEW_PROXY_URL',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'GEMINI_BASE_URL',
    'FFMPEG_PATH',
    'YT_DLP_PATH',
    'WHISPERX_PATH',
    'YOUTUBE_COOKIES_PATH',
    'HTTP_PROXY',
    'HTTPS_PROXY'
  )

  $result = [ordered]@{}
  foreach ($name in $variableNames) {
    $processValue = [Environment]::GetEnvironmentVariable($name, 'Process')
    $userValue = [Environment]::GetEnvironmentVariable($name, 'User')
    $machineValue = [Environment]::GetEnvironmentVariable($name, 'Machine')
    $result[$name] = [ordered]@{
      isSet = -not [string]::IsNullOrEmpty($processValue) -or -not [string]::IsNullOrEmpty($userValue) -or -not [string]::IsNullOrEmpty($machineValue)
      scopes = @(
        if (-not [string]::IsNullOrEmpty($processValue)) { 'Process' }
        if (-not [string]::IsNullOrEmpty($userValue)) { 'User' }
        if (-not [string]::IsNullOrEmpty($machineValue)) { 'Machine' }
      )
    }
  }
  return $result
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $resolvedOutputPath = Join-Path $defaultOutputDirectory ("next-baseline-{0}.json" -f $timestamp.ToString('yyyyMMddTHHmmssfffZ'))
} else {
  $candidatePath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
  } else {
    Join-Path (Get-Location).Path $OutputPath
  }
  if ([System.IO.Path]::GetExtension($candidatePath) -ieq '.json') {
    $resolvedOutputPath = [System.IO.Path]::GetFullPath($candidatePath)
  } else {
    $resolvedOutputPath = Join-Path ([System.IO.Path]::GetFullPath($candidatePath)) ("next-baseline-{0}.json" -f $timestamp.ToString('yyyyMMddTHHmmssfffZ'))
  }
}

$portDefinitions = @(
  [ordered]@{ port = 5173; profile = 'current'; kind = 'frontend'; healthUrl = 'http://127.0.0.1:5173/' },
  [ordered]@{ port = 5174; profile = 'next'; kind = 'frontend'; healthUrl = 'http://127.0.0.1:5174/' },
  [ordered]@{ port = 8765; profile = 'current'; kind = 'workflow'; healthUrl = 'http://127.0.0.1:8765/api/health' },
  [ordered]@{ port = 8766; profile = 'next'; kind = 'workflow'; healthUrl = 'http://127.0.0.1:8766/api/health' }
)

$ports = @()
foreach ($definition in $portDefinitions) {
  $ports += [ordered]@{
    port = $definition.port
    profile = $definition.profile
    kind = $definition.kind
    listeners = @(Get-PortListeners -Port $definition.port)
    probe = Get-HealthProbe -Url $definition.healthUrl -Kind $definition.kind
  }
}

$baseline = [ordered]@{
  schemaVersion = 1
  capturedAt = $timestamp.ToString('o')
  captureMode = 'read-only'
  repository = Get-GitBaseline
  tools = Get-ToolBaseline
  ports = $ports
  runtimeEnvironment = Get-RuntimeEnvironmentPresence
  redaction = [ordered]@{
    environmentValuesCaptured = $false
    rawHealthBodiesCaptured = $false
    processCommandLinesCaptured = $false
  }
}

$outputDirectory = Split-Path -Parent $resolvedOutputPath
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$temporaryPath = Join-Path $outputDirectory ('.{0}.{1}.tmp' -f ([System.IO.Path]::GetFileName($resolvedOutputPath)), ([guid]::NewGuid().ToString('N')))
$json = $baseline | ConvertTo-Json -Depth 12
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

try {
  [System.IO.File]::WriteAllText($temporaryPath, $json + [Environment]::NewLine, $utf8WithoutBom)
  if ([System.IO.File]::Exists($resolvedOutputPath)) {
    [System.IO.File]::Replace($temporaryPath, $resolvedOutputPath, $null)
  } else {
    [System.IO.File]::Move($temporaryPath, $resolvedOutputPath)
  }
} finally {
  if ([System.IO.File]::Exists($temporaryPath)) {
    [System.IO.File]::Delete($temporaryPath)
  }
}

Write-Output $resolvedOutputPath

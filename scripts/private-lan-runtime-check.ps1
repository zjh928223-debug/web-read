param(
  [int]$StartupTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $PSScriptRoot 'launch-optimization-preview.ps1'
$optimizationConfigPath = Join-Path $projectRoot 'config\runtime.optimization.json'
$privateLanConfigPath = Join-Path $projectRoot 'config\runtime.private-lan.json'
$stateRoot = Join-Path $projectRoot '.codex\runtime-state\optimization'
$dataRoot = 'E:\ReadWebData\SubtitleWorkflow-Optimization'
$applicationRoot = Join-Path $dataRoot '.read-web-application'
$authorityRootParent = Join-Path $applicationRoot 'acceptance-profile-authorities'
$frontDoorStatePath = Join-Path $stateRoot 'front-door.json'
$capabilityStatePath = Join-Path $stateRoot 'capability-host.json'
$hostStatePath = Join-Path $stateRoot 'production-host.json'
$frontDoorTargetPath = Join-Path $stateRoot 'front-door-target.json'
$frontDoorCommittedTargetPath = Join-Path $stateRoot 'front-door-committed-target.json'
$activationJournalPath = Join-Path $stateRoot 'activation-journal.json'
$tokenPath = Join-Path $stateRoot 'production-host.token'

function Assert-True {
  param([bool]$Condition, [Parameter(Mandatory)][string]$Message)
  if (-not $Condition) { throw $Message }
}

function Read-JsonFile {
  param([Parameter(Mandatory)][string]$Path)
  Assert-True (Test-Path -LiteralPath $Path -PathType Leaf) "Required JSON file is missing: $Path"
  return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

function Get-FileSha256 {
  param([Parameter(Mandatory)][string]$Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash($stream)) -replace '-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
}

function Get-Listener {
  param([Parameter(Mandatory)][int]$Port)
  return @(
    Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
      ForEach-Object {
        [pscustomobject]@{
          localAddress = [string]$_.LocalAddress
          localPort = [int]$_.LocalPort
          processId = [int]$_.OwningProcess
        }
      }
  )
}

function Get-PrivateLanAddress {
  $addresses = @(
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.AddressState -eq 'Preferred' -and
        $_.PrefixLength -lt 32 -and
        $_.IPAddress -notlike '127.*' -and
        $_.IPAddress -notlike '169.254.*' -and
        (
          $_.IPAddress -match '^10\.' -or
          $_.IPAddress -match '^192\.168\.' -or
          $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.'
        )
      } |
      Sort-Object @(
        @{ Expression = { if ($_.InterfaceAlias -match 'WLAN|Wi-?Fi|Ethernet') { 0 } else { 1 } } },
        @{ Expression = { $_.IPAddress } }
      )
  )
  Assert-True ($addresses.Count -gt 0) 'No preferred RFC1918 IPv4 address is available for a real private-LAN bind.'
  return [string]$addresses[0].IPAddress
}

function Invoke-HttpProbe {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [ValidateSet('GET', 'POST')][string]$Method = 'GET',
    [hashtable]$Headers = @{},
    [string]$Body = ''
  )
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.UseProxy = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(10)
  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::new($Method),
    $Uri
  )
  try {
    foreach ($header in $Headers.GetEnumerator()) {
      if (-not $request.Headers.TryAddWithoutValidation([string]$header.Key, [string]$header.Value)) {
        throw "Could not add HTTP header $($header.Key)."
      }
    }
    if ($Body) {
      $request.Content = [System.Net.Http.StringContent]::new(
        $Body,
        [Text.Encoding]::UTF8,
        'application/json'
      )
    }
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    return [pscustomobject]@{
      status = [int]$response.StatusCode.value__
      body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
  } finally {
    $request.Dispose()
    $client.Dispose()
    $handler.Dispose()
  }
}

function Convert-ProbeJson {
  param([Parameter(Mandatory)]$Probe, [Parameter(Mandatory)][string]$Path)
  Assert-True ($Probe.body -and $Probe.body.TrimStart().StartsWith('{')) "Expected JSON response from $Path (status=$($Probe.status))."
  try { return ($Probe.body | ConvertFrom-Json) } catch { throw "Invalid JSON response from $Path." }
}

function Assert-ProbeStatus {
  param([Parameter(Mandatory)]$Probe, [Parameter(Mandatory)][int]$Expected, [Parameter(Mandatory)][string]$Path)
  Assert-True ($Probe.status -eq $Expected) "$Path returned HTTP $($Probe.status); expected HTTP $Expected."
}

function Test-TcpReachable {
  param([Parameter(Mandatory)][string]$HostName, [Parameter(Mandatory)][int]$Port)
  $client = New-Object Net.Sockets.TcpClient
  try {
    $asyncResult = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $asyncResult.AsyncWaitHandle.WaitOne(1000)) { return $false }
    $client.EndConnect($asyncResult)
    return $true
  } catch { return $false } finally { $client.Close() }
}

function Wait-PortFree {
  param([Parameter(Mandatory)][int]$Port, [int]$TimeoutSeconds = 10)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if (@(Get-Listener -Port $Port).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

function Assert-NoUnknownPortOwner {
  param([Parameter(Mandatory)][int]$Port, [Parameter(Mandatory)][string]$Role, [Parameter(Mandatory)][string]$StatePath)
  $listeners = @(Get-Listener -Port $Port)
  if ($listeners.Count -eq 0) { return }
  $state = $null
  if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
    try { $state = Read-JsonFile $StatePath } catch { $state = $null }
  }
  $owned = $false
  foreach ($listener in $listeners) {
    $owned = $owned -or (
      $null -ne $state -and
      [string]$state.profileId -eq 'optimization' -and
      [int]$state.port -eq $Port -and
      [int]$state.pid -eq $listener.processId -and
      $null -ne (Get-Process -Id $listener.processId -ErrorAction SilentlyContinue)
    )
  }
  if ($owned) {
    throw "$Role port $Port is already occupied by an owned optimization process; refusing to replace an existing runtime during validation. Stop it with the existing launcher and rerun."
  }
  throw "$Role port $Port is occupied by a process that cannot be proven to belong to the optimization profile; refusing to stop or overwrite it."
}

function Invoke-ExistingLauncher {
  param([switch]$Stop)
  $launcherParameters = @{
    NoOpen = $true
    FrontDoorRuntimeConfigPath = $fixturePath
    ApplicationProfileAuthorityIsolationRoot = $authorityFixturePath
    StartupTimeoutSeconds = $StartupTimeoutSeconds
  }
  if ($Stop) { $launcherParameters.Stop = $true }
  try {
    $output = & $launcherPath @launcherParameters 2>&1
    if ($LASTEXITCODE -ne 0) { throw "launcher exited with code $LASTEXITCODE" }
    return @($output)
  } catch {
    throw "Existing optimization launcher failed: $($_.Exception.Message)"
  }
}

function Remove-SafeAuthorityFixture {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $resolvedParent = [IO.Path]::GetFullPath($authorityRootParent).TrimEnd('\', '/')
  $resolvedPath = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  Assert-True ($resolvedPath.StartsWith("$resolvedParent\", [StringComparison]::OrdinalIgnoreCase)) 'Refusing to remove an authority fixture outside the optimization application root.'
  Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

$fixturePath = Join-Path ([IO.Path]::GetTempPath()) ("read-web-private-lan-runtime-$([Guid]::NewGuid().ToString('N')).json")
$authorityFixturePath = Join-Path $authorityRootParent ([Guid]::NewGuid().ToString('N'))
$startAttempted = $false
$stopSucceeded = $false
$candidatePort = 0
$cleanupErrors = @()
$evidence = $null

try {
  Assert-True ([IO.Path]::GetFullPath((Get-Location).Path).Equals([IO.Path]::GetFullPath($projectRoot), [StringComparison]::OrdinalIgnoreCase)) 'Validation must run from the optimization workspace.'
  Assert-True (Test-Path -LiteralPath $launcherPath -PathType Leaf) 'Optimization launcher is missing.'
  Assert-True (Test-Path -LiteralPath $dataRoot -PathType Container) 'Optimization data root is missing.'

  $optimizationConfig = Read-JsonFile $optimizationConfigPath
  $privateLanTemplate = Read-JsonFile $privateLanConfigPath
  Assert-True ([string]$optimizationConfig.frontend.host -eq '127.0.0.1' -and [int]$optimizationConfig.frontend.port -eq 5184) 'Loopback optimization frontend baseline changed.'
  Assert-True ([string]$optimizationConfig.backend.host -eq '127.0.0.1' -and [int]$optimizationConfig.backend.port -eq 8776) 'Loopback optimization backend baseline changed.'
  Assert-True ([string]$optimizationConfig.dataRoot -eq $dataRoot) 'Loopback optimization data root changed.'
  Assert-True ([string]$privateLanTemplate.transportMode -eq 'private-lan') 'Private-LAN RuntimeConfig template is not explicit private-lan mode.'
  Assert-True ([string]$privateLanTemplate.profileId -eq 'optimization') 'Private-LAN RuntimeConfig template does not target optimization profile.'
  Assert-True ([int]$privateLanTemplate.frontend.port -eq 5184) 'Private-LAN stable front-door port changed.'
  Assert-True ([string]$privateLanTemplate.backend.host -eq '127.0.0.1' -and [int]$privateLanTemplate.backend.port -eq 8776) 'Private-LAN capability sidecar is not loopback 8776.'
  Assert-True ([string]$privateLanTemplate.dataRoot -eq $dataRoot) 'Private-LAN RuntimeConfig template left the optimization data root.'

  $configHashesBefore = @{
    optimization = Get-FileSha256 $optimizationConfigPath
    privateLan = Get-FileSha256 $privateLanConfigPath
  }
  $lanHost = Get-PrivateLanAddress
  $fixture = $privateLanTemplate | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $fixture.configuredLanHost = $lanHost
  $fixture.frontend.host = $lanHost
  $fixture.frontend.publicUrl = "http://${lanHost}:5184/"
  [IO.File]::WriteAllText($fixturePath, ($fixture | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))

  Assert-NoUnknownPortOwner -Port 5184 -Role 'stable front door' -StatePath $frontDoorStatePath
  Assert-NoUnknownPortOwner -Port 8776 -Role 'capability sidecar' -StatePath $capabilityStatePath
  New-Item -ItemType Directory -Force -Path $authorityFixturePath | Out-Null

  $startAttempted = $true
  Invoke-ExistingLauncher | Out-Null

  $frontDoorState = Read-JsonFile $frontDoorStatePath
  $capabilityState = Read-JsonFile $capabilityStatePath
  $hostDescriptor = Read-JsonFile $hostStatePath
  $hostState = Read-JsonFile ([string]$hostDescriptor.managerStatePath)
  $frontDoorTarget = Read-JsonFile $frontDoorTargetPath
  $committedTarget = Read-JsonFile $frontDoorCommittedTargetPath
  $token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
  Assert-True ($token.Length -gt 0) 'Optimization launcher did not publish a service token.'
  $candidatePort = [int]$frontDoorTarget.port
  Assert-True ([string]$frontDoorTarget.host -eq '127.0.0.1') 'Front-door target is not a loopback Host.'
  Assert-True ($candidatePort -notin @(5184, 8776)) 'Front-door target incorrectly uses a public or capability port.'
  Assert-True ([string]$committedTarget.host -eq '127.0.0.1' -and [int]$committedTarget.port -eq $candidatePort) 'Committed front-door target is not the loopback candidate Host.'

  $frontDoorListeners = @(Get-Listener -Port 5184)
  $capabilityListeners = @(Get-Listener -Port 8776)
  $hostListeners = @(Get-Listener -Port $candidatePort)
  Assert-True ($frontDoorListeners.Count -gt 0 -and @($frontDoorListeners | Where-Object { $_.localAddress -eq $lanHost }).Count -eq $frontDoorListeners.Count) '5184 is not actually listening only on the configured LAN address.'
  Assert-True (@($frontDoorListeners | Where-Object { $_.processId -eq [int]$frontDoorState.pid }).Count -gt 0) '5184 listener is not owned by the managed stable front door.'
  Assert-True ($capabilityListeners.Count -gt 0 -and @($capabilityListeners | Where-Object { $_.localAddress -eq '127.0.0.1' }).Count -eq $capabilityListeners.Count) '8776 is not actually loopback-only.'
  Assert-True (@($capabilityListeners | Where-Object { $_.processId -eq [int]$capabilityState.pid }).Count -gt 0) '8776 listener is not owned by the managed capability sidecar.'
  Assert-True ($hostListeners.Count -gt 0 -and @($hostListeners | Where-Object { $_.localAddress -eq '127.0.0.1' }).Count -eq $hostListeners.Count) 'Internal Host is not actually loopback-only.'
  Assert-True (@($hostListeners | Where-Object { $_.processId -eq [int]$hostState.pid }).Count -gt 0) 'Internal Host listener is not owned by the managed candidate Host.'
  Assert-True (-not (Test-TcpReachable -HostName $lanHost -Port 8776)) '8776 is reachable through the LAN address; capability sidecar escaped loopback.'
  Assert-True (-not (Test-TcpReachable -HostName $lanHost -Port $candidatePort)) 'Internal Host is reachable through the LAN address; candidate Host escaped loopback.'

  $originHeaders = @{ Origin = "http://${lanHost}:5184" }
  $requestResults = @()
  $indexProbe = Invoke-HttpProbe -Uri "http://${lanHost}:5184/" -Headers $originHeaders
  Assert-ProbeStatus $indexProbe 200 '/'
  Assert-True ($indexProbe.body -match '(?i)<!doctype\s+html' -and $indexProbe.body -notmatch '@vite/client') 'Stable front door did not serve the built static page.'
  $requestResults += [pscustomobject]@{ method = 'GET'; path = '/'; status = $indexProbe.status; via = 'private-lan:5184' }

  $processHealthProbe = Invoke-HttpProbe -Uri "http://${lanHost}:5184/api/app/front-door-process-health" -Headers $originHeaders
  $processHealth = Convert-ProbeJson $processHealthProbe '/api/app/front-door-process-health'
  Assert-ProbeStatus $processHealthProbe 200 '/api/app/front-door-process-health'
  Assert-True ([string]$processHealth.status -eq 'ready' -and [string]$processHealth.profileId -eq 'optimization') 'Stable front-door process health is not ready.'
  $requestResults += [pscustomobject]@{ method = 'GET'; path = '/api/app/front-door-process-health'; status = $processHealthProbe.status; via = 'private-lan:5184' }

  $frontDoorHealthProbe = Invoke-HttpProbe -Uri "http://${lanHost}:5184/api/app/front-door-health" -Headers $originHeaders
  $frontDoorHealth = Convert-ProbeJson $frontDoorHealthProbe '/api/app/front-door-health'
  Assert-ProbeStatus $frontDoorHealthProbe 200 '/api/app/front-door-health'
  Assert-True ([string]$frontDoorHealth.status -eq 'ready' -and [string]$frontDoorHealth.commitVisibility.status -eq 'committed') 'Stable front-door routing health is not committed and ready.'
  $requestResults += [pscustomobject]@{ method = 'GET'; path = '/api/app/front-door-health'; status = $frontDoorHealthProbe.status; via = 'private-lan:5184' }

  $hostHealthProbe = Invoke-HttpProbe -Uri "http://${lanHost}:5184/api/app/health" -Headers $originHeaders
  $hostHealth = Convert-ProbeJson $hostHealthProbe '/api/app/health'
  Assert-ProbeStatus $hostHealthProbe 200 '/api/app/health'
  Assert-True ([string]$hostHealth.status -eq 'ready' -and $hostHealth.distReady -eq $true -and [string]$hostHealth.profileId -eq 'optimization') 'Host health was not reachable or ready through 5184.'
  $requestResults += [pscustomobject]@{ method = 'GET'; path = '/api/app/health'; status = $hostHealthProbe.status; via = 'private-lan:5184' }

  $workflowHealthProbe = Invoke-HttpProbe -Uri "http://${lanHost}:5184/api/health" -Headers $originHeaders
  $workflowHealth = Convert-ProbeJson $workflowHealthProbe '/api/health'
  Assert-ProbeStatus $workflowHealthProbe 200 '/api/health'
  Assert-True ([string]$workflowHealth.status -eq 'ok') 'Workflow health was not reachable through the stable front door.'
  $requestResults += [pscustomobject]@{ method = 'GET'; path = '/api/health'; status = $workflowHealthProbe.status; via = 'private-lan:5184' }

  $capabilitiesProbe = Invoke-HttpProbe -Uri "http://${lanHost}:5184/api/app/capabilities" -Headers $originHeaders
  $capabilities = Convert-ProbeJson $capabilitiesProbe '/api/app/capabilities'
  Assert-ProbeStatus $capabilitiesProbe 200 '/api/app/capabilities'
  Assert-True ([string]$capabilities.status -eq 'ok' -and @($capabilities.endpoints).Count -eq 9) 'Capability API was not reachable through 5184 with the expected registry.'
  $requestResults += [pscustomobject]@{ method = 'GET'; path = '/api/app/capabilities'; status = $capabilitiesProbe.status; via = 'private-lan:5184' }

  $ownerEnvelope = @{
    contractVersion = 'windows-thin-reader-api.v1'
    requestId = "lan-runtime-$([Guid]::NewGuid().ToString('N'))"
    correlationId = "lan-runtime-correlation-$([Guid]::NewGuid().ToString('N'))"
    kind = 'query'
    domain = 'reader-session'
    operation = 'snapshot'
    capability = 'reader-session.query'
    payload = @{ profileId = [string]$hostState.profileId; instanceId = [string]$hostState.instanceId }
  } | ConvertTo-Json -Depth 10 -Compress
  $ownerProbe = Invoke-HttpProbe -Uri "http://${lanHost}:5184/api/app/owner/command" -Method POST -Headers (@{ Origin = "http://${lanHost}:5184"; 'X-Read-Web-Token' = $token }) -Body $ownerEnvelope
  $ownerResponse = Convert-ProbeJson $ownerProbe '/api/app/owner/command'
  Assert-True ($ownerProbe.status -in @(200, 503)) 'Owner query returned an unexpected HTTP status through 5184.'
  Assert-True ([string]$ownerResponse.contractVersion -eq 'windows-thin-reader-api.v1' -and [string]$ownerResponse.domain -eq 'reader-session' -and [string]$ownerResponse.operation -eq 'snapshot') 'Owner query contract was not preserved through the stable front door.'
  Assert-True ([string]$ownerResponse.outcome -in @('not-ready', 'committed', 'ok')) 'Owner query returned an unexpected outcome.'
  $requestResults += [pscustomobject]@{ method = 'POST'; path = '/api/app/owner/command'; status = $ownerProbe.status; via = 'private-lan:5184' }

  Assert-True ((Get-FileSha256 $optimizationConfigPath) -eq $configHashesBefore.optimization) 'Loopback optimization RuntimeConfig changed during LAN validation.'
  Assert-True ((Get-FileSha256 $privateLanConfigPath) -eq $configHashesBefore.privateLan) 'Private-LAN RuntimeConfig template changed during LAN validation.'

  $evidence = [ordered]@{
    schema = 'read-web.private-lan-runtime-evidence'
    schemaVersion = 1
    status = 'passed'
    transportMode = 'private-lan'
    configuredLanHost = $lanHost
    listeners = @(
      [ordered]@{ role = 'stable-front-door'; host = $lanHost; port = 5184; processId = [int]$frontDoorState.pid }
      [ordered]@{ role = 'internal-host'; host = [string]$frontDoorTarget.host; port = $candidatePort; processId = [int]$hostState.pid }
      [ordered]@{ role = 'capability-sidecar'; host = '127.0.0.1'; port = 8776; processId = [int]$capabilityState.pid }
    )
    requests = $requestResults
    directLanReachability = [ordered]@{ internalHost = $false; capabilitySidecar = $false }
    identities = [ordered]@{ profileId = [string]$hostState.profileId; releaseId = [string]$hostState.releaseId; instanceId = [string]$hostState.instanceId }
  }
} finally {
  if ($startAttempted) {
    try {
      Invoke-ExistingLauncher -Stop | Out-Null
      $stopSucceeded = $true
    } catch {
      $cleanupErrors += $_.Exception.Message
    }
  }
  if ($stopSucceeded) {
    foreach ($port in @($candidatePort, 5184, 8776)) {
      if ($port -gt 0 -and -not (Wait-PortFree -Port $port)) { $cleanupErrors += "port $port remained occupied after launcher stop" }
    }
    try { Remove-SafeAuthorityFixture $authorityFixturePath } catch { $cleanupErrors += $_.Exception.Message }
  }
  if (Test-Path -LiteralPath $fixturePath -PathType Leaf) {
    Remove-Item -LiteralPath $fixturePath -Force -ErrorAction SilentlyContinue
  }
  if ($cleanupErrors.Count -gt 0) { throw "LAN runtime cleanup failed: $($cleanupErrors -join '; ')" }
}

Assert-True ($null -ne $evidence) 'LAN runtime validation produced no evidence.'
Write-Output (($evidence | ConvertTo-Json -Depth 20))
Write-Host 'private-LAN runtime listener and front-door validation passed'

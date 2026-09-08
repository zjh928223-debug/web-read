param(
  [int]$StartupTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http

$projectRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $PSScriptRoot 'launch-private-lan-preview.ps1'
$privateLanConfigModulePath = Join-Path $PSScriptRoot 'private-lan-runtime-config.psm1'
$instanceManagerModulePath = Join-Path $PSScriptRoot 'launcher-instance-manager.psm1'
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

function Invoke-HttpProbe {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [ValidateSet('GET', 'POST')][string]$Method = 'GET',
    [hashtable]$Headers = @{},
    [string]$Body = ''
  )
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.UseProxy = $false
  $handler.AllowAutoRedirect = $false
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
    try {
      return [pscustomobject]@{
        status = [int]$response.StatusCode.value__
        body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        requestedUri = [string]$request.RequestUri.AbsoluteUri
        finalUri = [string]$response.RequestMessage.RequestUri.AbsoluteUri
        location = if ($null -ne $response.Headers.Location) { [string]$response.Headers.Location } else { '' }
      }
    } finally {
      $response.Dispose()
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

function Assert-StableFrontDoorProbe {
  param([Parameter(Mandatory)]$Probe, [Parameter(Mandatory)][string]$ExpectedUri, [Parameter(Mandatory)][string]$Path)
  Assert-True ($Probe.requestedUri -eq $ExpectedUri) "$Path was not requested from the resolved private-LAN stable front door."
  Assert-True ($Probe.finalUri -eq $ExpectedUri) "$Path resolved to an unexpected final URI: $($Probe.finalUri)"
  Assert-True (-not $Probe.location) "$Path returned an unexpected redirect to $($Probe.location)."
  Assert-True ($Probe.status -lt 300 -or $Probe.status -ge 400) "$Path returned redirect HTTP $($Probe.status)."
}

function New-ProbeEvidence {
  param([Parameter(Mandatory)]$Probe, [Parameter(Mandatory)][string]$Method, [Parameter(Mandatory)][string]$Path)
  return [pscustomobject]@{
    method = $Method
    path = $Path
    status = [int]$Probe.status
    requestedUri = [string]$Probe.requestedUri
    finalUri = [string]$Probe.finalUri
    redirectLocation = [string]$Probe.location
  }
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

function Get-CapturedProcessIdentity {
  param([Parameter(Mandatory)][string]$Role, [Parameter(Mandatory)]$State)
  $pidNumber = [int]$State.pid
  $process = Get-Process -Id $pidNumber -ErrorAction SilentlyContinue
  Assert-True ($null -ne $process) "$Role process $pidNumber was not live when its identity was captured."
  $actualStart = $process.StartTime.ToUniversalTime().ToString('O')
  $expectedStart = ([DateTime]::Parse([string]$State.processStartUtc)).ToUniversalTime()
  Assert-True ([Math]::Abs(($process.StartTime.ToUniversalTime() - $expectedStart).TotalMilliseconds) -le 1000) "$Role PID/start identity did not match its managed state."
  $actualPath = [string]$process.Path
  $managedArguments = @($State.argumentList | ForEach-Object { [string]$_ })
  Assert-True (Test-ManagedProcessExecutable -Process $process -ExpectedFilePath ([string]$State.filePath) -ExpectedArgumentFragments $managedArguments) "$Role executable identity did not match its managed state."
  return [pscustomobject]@{
    role = $Role
    processId = $pidNumber
    processStartUtc = $actualStart
    actualPath = [IO.Path]::GetFullPath($actualPath)
    managedFilePath = [IO.Path]::GetFullPath([string]$State.filePath)
    managedArguments = $managedArguments
    executableIdentity = [string]$State.executableIdentity
  }
}

function Get-CapturedProcessStatus {
  param([Parameter(Mandatory)]$Identity)
  $process = Get-Process -Id ([int]$Identity.processId) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return 'exited' }
  $sameStart = [Math]::Abs(($process.StartTime.ToUniversalTime() - ([DateTime]::Parse([string]$Identity.processStartUtc)).ToUniversalTime()).TotalMilliseconds) -le 1000
  $sameExecutable = Test-ManagedProcessExecutable -Process $process -ExpectedFilePath ([string]$Identity.managedFilePath) -ExpectedArgumentFragments @($Identity.managedArguments)
  if (-not ($sameStart -and $sameExecutable)) { return 'pid-reused-different-identity' }
  return 'still-running-same-identity'
}

function Wait-CapturedProcessExited {
  param([Parameter(Mandatory)]$Identity, [int]$TimeoutSeconds = 10)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $status = Get-CapturedProcessStatus -Identity $Identity
    if ($status -ne 'still-running-same-identity') { return $status }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  return 'still-running-same-identity'
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

function Invoke-ShippedPrivateLanLauncher {
  param([switch]$Stop)
  $launcherParameters = @{
    NoOpen = $true
    ResolvedLanAddress = $lanHost
    ApplicationProfileAuthorityIsolationRoot = $authorityFixturePath
    StartupTimeoutSeconds = $StartupTimeoutSeconds
  }
  if ($Stop) { $launcherParameters.Stop = $true }
  try {
    $output = & $launcherPath @launcherParameters 2>&1
    if ($LASTEXITCODE -ne 0) { throw "launcher exited with code $LASTEXITCODE" }
    return @($output)
  } catch {
    throw "Shipped private-LAN launcher failed: $($_.Exception.Message)"
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

$authorityFixturePath = Join-Path $authorityRootParent ([Guid]::NewGuid().ToString('N'))
$startAttempted = $false
$stopSucceeded = $false
$candidatePort = 0
$cleanupErrors = @()
$evidence = $null
$capturedProcesses = @()
$cleanupProcessResults = @()
$cleanupPortResults = @()

try {
  Assert-True ([IO.Path]::GetFullPath((Get-Location).Path).Equals([IO.Path]::GetFullPath($projectRoot), [StringComparison]::OrdinalIgnoreCase)) 'Validation must run from the optimization workspace.'
  Assert-True (Test-Path -LiteralPath $launcherPath -PathType Leaf) 'Shipped private-LAN launcher is missing.'
  Assert-True (Test-Path -LiteralPath $privateLanConfigModulePath -PathType Leaf) 'Private-LAN RuntimeConfig resolver is missing.'
  Assert-True (Test-Path -LiteralPath $instanceManagerModulePath -PathType Leaf) 'Launcher instance identity module is missing.'
  Assert-True (Test-Path -LiteralPath $dataRoot -PathType Container) 'Optimization data root is missing.'
  Import-Module $privateLanConfigModulePath -Force
  Import-Module $instanceManagerModulePath -Force

  $optimizationConfig = Read-JsonFile $optimizationConfigPath
  $privateLanTemplate = Read-JsonFile $privateLanConfigPath
  Assert-True ([string]$optimizationConfig.frontend.host -eq '127.0.0.1' -and [int]$optimizationConfig.frontend.port -eq 5184) 'Loopback optimization frontend baseline changed.'
  Assert-True ([string]$optimizationConfig.backend.host -eq '127.0.0.1' -and [int]$optimizationConfig.backend.port -eq 8776) 'Loopback optimization backend baseline changed.'
  Assert-True ([string]$optimizationConfig.dataRoot -eq $dataRoot) 'Loopback optimization data root changed.'
  Assert-True ([string]$privateLanTemplate.transportMode -eq 'private-lan') 'Private-LAN RuntimeConfig template is not explicit private-lan mode.'
  Assert-True ([string]$privateLanTemplate.profileId -eq 'optimization') 'Private-LAN RuntimeConfig template does not target optimization profile.'
  Assert-True ([string]$privateLanTemplate.configuredLanHost -eq 'active-private-ipv4' -and [string]$privateLanTemplate.frontend.host -eq 'active-private-ipv4' -and [string]$privateLanTemplate.frontend.publicUrl -eq 'active-private-ipv4') 'Private-LAN RuntimeConfig must resolve its active address at launch time.'
  Assert-True ([int]$privateLanTemplate.frontend.port -eq 5184) 'Private-LAN stable front-door port changed.'
  Assert-True ([string]$privateLanTemplate.backend.host -eq '127.0.0.1' -and [int]$privateLanTemplate.backend.port -eq 8776) 'Private-LAN capability sidecar is not loopback 8776.'
  Assert-True ([string]$privateLanTemplate.dataRoot -eq $dataRoot) 'Private-LAN RuntimeConfig template left the optimization data root.'

  $configHashesBefore = @{
    optimization = Get-FileSha256 $optimizationConfigPath
    privateLan = Get-FileSha256 $privateLanConfigPath
  }
  $lanHost = Resolve-ActivePrivateLanIPv4
  $stableFrontDoorOrigin = "http://${lanHost}:5184"

  Assert-NoUnknownPortOwner -Port 5184 -Role 'stable front door' -StatePath $frontDoorStatePath
  Assert-NoUnknownPortOwner -Port 8776 -Role 'capability sidecar' -StatePath $capabilityStatePath
  New-Item -ItemType Directory -Force -Path $authorityFixturePath | Out-Null

  $startAttempted = $true
  $launcherOutput = @(Invoke-ShippedPrivateLanLauncher)
  Assert-True (($launcherOutput -join "`n") -match [regex]::Escape("Private-LAN public URL: ${stableFrontDoorOrigin}/")) 'Shipped launcher did not report the resolved private-LAN public URL.'

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
  $capturedProcesses = @(
    Get-CapturedProcessIdentity -Role 'stable-front-door' -State $frontDoorState
    Get-CapturedProcessIdentity -Role 'internal-host' -State $hostState
    Get-CapturedProcessIdentity -Role 'capability-sidecar' -State $capabilityState
  )

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

  $originHeaders = @{ Origin = $stableFrontDoorOrigin }
  $requestResults = @()
  $indexUri = "${stableFrontDoorOrigin}/"
  $indexProbe = Invoke-HttpProbe -Uri $indexUri -Headers $originHeaders
  Assert-StableFrontDoorProbe $indexProbe $indexUri '/'
  Assert-ProbeStatus $indexProbe 200 '/'
  Assert-True ($indexProbe.body -match '(?i)<!doctype\s+html' -and $indexProbe.body -notmatch '@vite/client') 'Stable front door did not serve the built static page.'
  $requestResults += New-ProbeEvidence $indexProbe 'GET' '/'

  $processHealthUri = "${stableFrontDoorOrigin}/api/app/front-door-process-health"
  $processHealthProbe = Invoke-HttpProbe -Uri $processHealthUri -Headers $originHeaders
  Assert-StableFrontDoorProbe $processHealthProbe $processHealthUri '/api/app/front-door-process-health'
  $processHealth = Convert-ProbeJson $processHealthProbe '/api/app/front-door-process-health'
  Assert-ProbeStatus $processHealthProbe 200 '/api/app/front-door-process-health'
  Assert-True ([string]$processHealth.status -eq 'ready' -and [string]$processHealth.profileId -eq 'optimization') 'Stable front-door process health is not ready.'
  $requestResults += New-ProbeEvidence $processHealthProbe 'GET' '/api/app/front-door-process-health'

  $frontDoorHealthUri = "${stableFrontDoorOrigin}/api/app/front-door-health"
  $frontDoorHealthProbe = Invoke-HttpProbe -Uri $frontDoorHealthUri -Headers $originHeaders
  Assert-StableFrontDoorProbe $frontDoorHealthProbe $frontDoorHealthUri '/api/app/front-door-health'
  $frontDoorHealth = Convert-ProbeJson $frontDoorHealthProbe '/api/app/front-door-health'
  Assert-ProbeStatus $frontDoorHealthProbe 200 '/api/app/front-door-health'
  Assert-True ([string]$frontDoorHealth.status -eq 'ready' -and [string]$frontDoorHealth.commitVisibility.status -eq 'committed') 'Stable front-door routing health is not committed and ready.'
  $requestResults += New-ProbeEvidence $frontDoorHealthProbe 'GET' '/api/app/front-door-health'

  $hostHealthUri = "${stableFrontDoorOrigin}/api/app/health"
  $hostHealthProbe = Invoke-HttpProbe -Uri $hostHealthUri -Headers $originHeaders
  Assert-StableFrontDoorProbe $hostHealthProbe $hostHealthUri '/api/app/health'
  $hostHealth = Convert-ProbeJson $hostHealthProbe '/api/app/health'
  Assert-ProbeStatus $hostHealthProbe 200 '/api/app/health'
  Assert-True ([string]$hostHealth.status -eq 'ready' -and $hostHealth.distReady -eq $true -and [string]$hostHealth.profileId -eq 'optimization') 'Host health was not reachable or ready through 5184.'
  $requestResults += New-ProbeEvidence $hostHealthProbe 'GET' '/api/app/health'

  $workflowHealthUri = "${stableFrontDoorOrigin}/api/health"
  $workflowHealthProbe = Invoke-HttpProbe -Uri $workflowHealthUri -Headers $originHeaders
  Assert-StableFrontDoorProbe $workflowHealthProbe $workflowHealthUri '/api/health'
  $workflowHealth = Convert-ProbeJson $workflowHealthProbe '/api/health'
  Assert-ProbeStatus $workflowHealthProbe 200 '/api/health'
  Assert-True ([string]$workflowHealth.status -eq 'ok') 'Workflow health was not reachable through the stable front door.'
  $requestResults += New-ProbeEvidence $workflowHealthProbe 'GET' '/api/health'

  $capabilitiesUri = "${stableFrontDoorOrigin}/api/app/capabilities"
  $capabilitiesProbe = Invoke-HttpProbe -Uri $capabilitiesUri -Headers $originHeaders
  Assert-StableFrontDoorProbe $capabilitiesProbe $capabilitiesUri '/api/app/capabilities'
  $capabilities = Convert-ProbeJson $capabilitiesProbe '/api/app/capabilities'
  Assert-ProbeStatus $capabilitiesProbe 200 '/api/app/capabilities'
  Assert-True ([string]$capabilities.status -eq 'ok' -and @($capabilities.endpoints).Count -eq 9) 'Capability API was not reachable through 5184 with the expected registry.'
  $requestResults += New-ProbeEvidence $capabilitiesProbe 'GET' '/api/app/capabilities'

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
  $ownerUri = "${stableFrontDoorOrigin}/api/app/owner/command"
  $ownerProbe = Invoke-HttpProbe -Uri $ownerUri -Method POST -Headers (@{ Origin = $stableFrontDoorOrigin; 'X-Read-Web-Token' = $token }) -Body $ownerEnvelope
  Assert-StableFrontDoorProbe $ownerProbe $ownerUri '/api/app/owner/command'
  $ownerResponse = Convert-ProbeJson $ownerProbe '/api/app/owner/command'
  Assert-True ($ownerProbe.status -in @(200, 503)) 'Owner query returned an unexpected HTTP status through 5184.'
  Assert-True ([string]$ownerResponse.contractVersion -eq 'windows-thin-reader-api.v1' -and [string]$ownerResponse.domain -eq 'reader-session' -and [string]$ownerResponse.operation -eq 'snapshot') 'Owner query contract was not preserved through the stable front door.'
  Assert-True ([string]$ownerResponse.outcome -in @('not-ready', 'committed', 'ok')) 'Owner query returned an unexpected outcome.'
  $requestResults += New-ProbeEvidence $ownerProbe 'POST' '/api/app/owner/command'

  Assert-True ((Get-FileSha256 $optimizationConfigPath) -eq $configHashesBefore.optimization) 'Loopback optimization RuntimeConfig changed during LAN validation.'
  Assert-True ((Get-FileSha256 $privateLanConfigPath) -eq $configHashesBefore.privateLan) 'Private-LAN RuntimeConfig template changed during LAN validation.'

  $evidence = [ordered]@{
    schema = 'read-web.private-lan-runtime-evidence'
    schemaVersion = 1
    status = 'passed'
    transportMode = 'private-lan'
    configuredLanHost = $lanHost
    publicUrl = "${stableFrontDoorOrigin}/"
    listeners = @(
      [ordered]@{ role = 'stable-front-door'; host = $lanHost; port = 5184; processId = [int]$frontDoorState.pid }
      [ordered]@{ role = 'internal-host'; host = [string]$frontDoorTarget.host; port = $candidatePort; processId = [int]$hostState.pid }
      [ordered]@{ role = 'capability-sidecar'; host = '127.0.0.1'; port = 8776; processId = [int]$capabilityState.pid }
    )
    requests = $requestResults
    directLanReachability = [ordered]@{ internalHost = $false; capabilitySidecar = $false }
    identities = [ordered]@{ profileId = [string]$hostState.profileId; releaseId = [string]$hostState.releaseId; instanceId = [string]$hostState.instanceId }
    capturedProcesses = $capturedProcesses
    cleanup = $null
  }
} finally {
  if ($startAttempted) {
    try {
      foreach ($identity in $capturedProcesses) {
        Assert-True ((Get-CapturedProcessStatus -Identity $identity) -eq 'still-running-same-identity') "Refusing cleanup because captured $($identity.role) PID identity changed before stop."
      }
      Invoke-ShippedPrivateLanLauncher -Stop | Out-Null
      $stopSucceeded = $true
    } catch {
      $cleanupErrors += $_.Exception.Message
    }
  }
  if ($stopSucceeded) {
    foreach ($identity in $capturedProcesses) {
      $processStatus = Wait-CapturedProcessExited -Identity $identity
      $cleanupProcessResults += [pscustomobject]@{ role = $identity.role; processId = $identity.processId; status = $processStatus }
      if ($processStatus -eq 'still-running-same-identity') { $cleanupErrors += "$($identity.role) PID $($identity.processId) remained live after launcher stop" }
    }
    foreach ($port in @($candidatePort, 5184, 8776)) {
      if ($port -gt 0) {
        $released = Wait-PortFree -Port $port
        $listenerCount = @(Get-Listener -Port $port).Count
        $cleanupPortResults += [pscustomobject]@{ port = $port; released = $released; listenerCount = $listenerCount }
        if (-not $released -or $listenerCount -ne 0) { $cleanupErrors += "port $port remained occupied after launcher stop" }
      }
    }
    try { Remove-SafeAuthorityFixture $authorityFixturePath } catch { $cleanupErrors += $_.Exception.Message }
  }
  if ($cleanupErrors.Count -gt 0) { throw "LAN runtime cleanup failed: $($cleanupErrors -join '; ')" }
}

Assert-True ($null -ne $evidence) 'LAN runtime validation produced no evidence.'
$evidence.cleanup = [ordered]@{
  launcherStopSucceeded = $stopSucceeded
  processes = $cleanupProcessResults
  ports = $cleanupPortResults
}
Write-Output (($evidence | ConvertTo-Json -Depth 20))
Write-Host 'private-LAN runtime listener and front-door validation passed'

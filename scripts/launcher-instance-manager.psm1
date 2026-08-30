Set-StrictMode -Version Latest

function Assert-LauncherPortSafety {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$ProfileId,
    [int[]]$ReservedDailyPorts = @(5173, 8765, 5174, 8766),
    [switch]$AllowReservedDailyPorts
  )
  if ($Port -lt 1 -or $Port -gt 65535) {
    throw "Invalid launcher port: $Port"
  }
  $legacyDailyPort = $ProfileId -eq 'daily' -and $Port -in @(5173, 8765)
  $dailyProductionPort = $ProfileId -eq 'daily-production' -and $Port -in @(5174, 8766)
  if ($ReservedDailyPorts -contains $Port -and -not ($legacyDailyPort -or ($dailyProductionPort -and $AllowReservedDailyPorts))) {
    throw "Isolated profile '$ProfileId' may not use reserved daily port $Port."
  }
}

function Test-TcpPortOccupied {
  param([Parameter(Mandatory)][int]$Port)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return $task.Wait(250) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-ManagedTcpPortFree {
  param(
    [Parameter(Mandatory)][int]$Port,
    [int]$TimeoutSeconds = 5
  )
  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $TimeoutSeconds))
  do {
    if (-not (Test-TcpPortOccupied -Port $Port)) { return $true }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

function Get-LoopbackPortOwnerProcess {
  param([Parameter(Mandatory)][int]$Port)
  $command = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
  if ($null -eq $command) { return $null }
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1', '0.0.0.0', '::') } |
      Select-Object -First 1
    if ($null -eq $connection -or -not $connection.OwningProcess) { return $null }
    return Get-Process -Id ([int]$connection.OwningProcess) -ErrorAction SilentlyContinue
  } catch {
    return $null
  }
}

function Get-LauncherHealth {
  param([Parameter(Mandatory)][string]$HealthUrl)
  try {
    return Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 1
  } catch {
    return $null
  }
}

function Test-HealthIdentity {
  param(
    $Health,
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$InstanceId,
    [string]$ExecutableIdentity = ''
  )
  return $null -ne $Health `
    -and [string](Get-ManagedRecordValue -Object $Health -Name 'releaseId') -eq $ReleaseId `
    -and [string](Get-ManagedRecordValue -Object $Health -Name 'profileId') -eq $ProfileId `
    -and [string](Get-ManagedRecordValue -Object $Health -Name 'instanceId') -eq $InstanceId `
    -and (-not $ExecutableIdentity -or [string](Get-ManagedRecordValue -Object $Health -Name 'executableIdentity') -eq $ExecutableIdentity) `
    -and [string](Get-ManagedRecordValue -Object $Health -Name 'status') -in @('ok', 'ready')
}

function Test-HealthProfileIdentity {
  param(
    $Health,
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [string]$ExecutableIdentity = ''
  )
  return $null -ne $Health `
    -and [string](Get-ManagedRecordValue -Object $Health -Name 'releaseId') -eq $ReleaseId `
    -and [string](Get-ManagedRecordValue -Object $Health -Name 'profileId') -eq $ProfileId `
    -and -not [string]::IsNullOrWhiteSpace([string](Get-ManagedRecordValue -Object $Health -Name 'instanceId')) `
    -and (-not $ExecutableIdentity -or [string](Get-ManagedRecordValue -Object $Health -Name 'executableIdentity') -eq $ExecutableIdentity) `
    -and [string](Get-ManagedRecordValue -Object $Health -Name 'status') -in @('ok', 'ready')
}

function Read-InstanceState {
  param([Parameter(Mandatory)][string]$StatePath)
  if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return $null }
  try {
    return Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-MatchingOwnedProcess {
  param($State)
  if ($null -eq $State -or -not $State.pid -or -not $State.processStartUtc) { return $null }
  $process = Get-Process -Id ([int]$State.pid) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  try {
    $dateStyles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    $expected = ([DateTimeOffset]::Parse(
      [string]$State.processStartUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      $dateStyles
    )).UtcDateTime
    $actual = $process.StartTime.ToUniversalTime()
    if ([Math]::Abs(($actual - $expected).TotalMilliseconds) -gt 1000) { return $null }
  } catch {
    return $null
  }
  $expectedFilePath = [string](Get-ManagedRecordValue -Object $State -Name 'filePath')
  if ($expectedFilePath) {
    $expectedArguments = @((Get-ManagedRecordValue -Object $State -Name 'argumentList') | ForEach-Object { [string]$_ })
    if (-not (Test-ManagedProcessExecutable -Process $process -ExpectedFilePath $expectedFilePath -ExpectedArgumentFragments $expectedArguments)) {
      return $null
    }
  }
  return $process
}

function Write-InstanceStateAtomic {
  param(
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)]$State
  )
  $directory = Split-Path -Parent $StatePath
  if (-not $directory) { $directory = (Get-Location).Path }
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ('.' + [IO.Path]::GetFileName($StatePath) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $StatePath -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Get-ProcessStartUtc {
  param($Process)
  try { return $Process.StartTime.ToUniversalTime().ToString('O') } catch { return '' }
}

function Get-ProcessCommandLine {
  param($Process)
  try {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.Id)" -ErrorAction Stop
    return [string]$processInfo.CommandLine
  } catch {
    return ''
  }
}

function Test-ManagedPythonVenvInvocation {
  param(
    [Parameter(Mandatory)][string]$ExpectedFilePath,
    [Parameter(Mandatory)][string]$ActualFilePath,
    [Parameter(Mandatory)][string]$CommandLine,
    [int]$ParentProcessId = 0
  )
  # On Windows, venv\Scripts\python.exe is a launcher. The running process
  # can report the base Python executable even though the command line and its
  # import environment belong to the selected venv. Accept that one shape
  # only when the command line starts with the exact selected venv executable.
  try {
    $expectedFullPath = [IO.Path]::GetFullPath($ExpectedFilePath)
    $actualFullPath = [IO.Path]::GetFullPath($ActualFilePath)
    $expectedLeaf = [IO.Path]::GetFileName($expectedFullPath)
    $actualLeaf = [IO.Path]::GetFileName($actualFullPath)
    if (-not [String]::Equals($expectedLeaf, 'python.exe', [StringComparison]::OrdinalIgnoreCase) `
      -or -not [String]::Equals($actualLeaf, 'python.exe', [StringComparison]::OrdinalIgnoreCase) `
      -or $expectedFullPath.IndexOf('\Scripts\', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
      return $false
    }
    $trimmed = $CommandLine.TrimStart()
    $quotedPath = '"' + $expectedFullPath + '"'
    if ($trimmed.StartsWith($quotedPath, [StringComparison]::OrdinalIgnoreCase) `
      -or $trimmed.StartsWith($expectedFullPath, [StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
    if ($ParentProcessId -gt 0) {
      $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$ParentProcessId" -ErrorAction SilentlyContinue
      if ($null -ne $parent) {
        $parentPath = [string]$parent.ExecutablePath
        $parentCommandLine = ([string]$parent.CommandLine).TrimStart()
        $parentQuotedPath = '"' + $expectedFullPath + '"'
        if ([String]::Equals($parentPath, $expectedFullPath, [StringComparison]::OrdinalIgnoreCase) `
          -and ($parentCommandLine.StartsWith($parentQuotedPath, [StringComparison]::OrdinalIgnoreCase) `
            -or $parentCommandLine.StartsWith($expectedFullPath, [StringComparison]::OrdinalIgnoreCase))) {
          return $true
        }
      }
    }
    return $false
  } catch {
    return $false
  }
}

function Test-ManagedProcessExecutable {
  param(
    $Process,
    [string]$ExpectedFilePath = '',
    [string[]]$ExpectedArgumentFragments = @()
  )
  if ($null -eq $Process) { return $false }
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.Id)" -ErrorAction SilentlyContinue
  $commandLine = if ($null -ne $processInfo) { [string]$processInfo.CommandLine } else { '' }
  $parentProcessId = if ($null -ne $processInfo) { [int]$processInfo.ParentProcessId } else { 0 }
  if ($ExpectedFilePath) {
    try {
      $actualPath = [string]$Process.Path
      $pathMatches = $actualPath -and [String]::Equals(
          [IO.Path]::GetFullPath($actualPath),
          [IO.Path]::GetFullPath($ExpectedFilePath),
          [StringComparison]::OrdinalIgnoreCase)
      if (-not $pathMatches -and $actualPath -and $commandLine) {
        $pathMatches = Test-ManagedPythonVenvInvocation `
          -ExpectedFilePath $ExpectedFilePath `
          -ActualFilePath $actualPath `
          -CommandLine $commandLine `
          -ParentProcessId $parentProcessId
      }
      if (-not $pathMatches) {
        return $false
      }
    } catch {
      return $false
    }
  }
  foreach ($fragment in @($ExpectedArgumentFragments)) {
    if ($fragment -and (-not $commandLine -or $commandLine.IndexOf([string]$fragment, [StringComparison]::OrdinalIgnoreCase) -lt 0)) { return $false }
  }
  return $true
}

function Find-ManagedProcessByExecutable {
  param(
    [int]$Pid = 0,
    [string]$ProcessStartUtc = '',
    [Parameter(Mandatory)][string]$ExpectedFilePath,
    [string[]]$ExpectedArgumentFragments = @()
  )
  $expectedFullPath = ''
  try { $expectedFullPath = [IO.Path]::GetFullPath($ExpectedFilePath) } catch { return $null }
  $processes = @()
  $processMetadata = @()
  if ($Pid -gt 0) {
    $candidate = Get-Process -Id $Pid -ErrorAction SilentlyContinue
    if ($null -ne $candidate) { $processes = @($candidate) }
  } else {
    # Recovery is allowed to inspect only the executable named by the launch
    # receipt.  Do not enumerate every process on the machine: besides being
    # slow on Windows PowerShell, that would make a stale journal needlessly
    # touch unrelated process metadata.  CIM's executable path and command
    # line together are the ownership proof before a PID is adopted.
    try {
      $leaf = [IO.Path]::GetFileName($expectedFullPath)
      if (-not $leaf) { return $null }
      $escapedLeaf = $leaf.Replace("'", "''")
      $processMetadata = @(Get-CimInstance Win32_Process -Filter "Name='$escapedLeaf'" -ErrorAction Stop)
    } catch {
      return $null
    }
  }
  $candidates = if ($Pid -gt 0) { $processes | ForEach-Object { [pscustomobject]@{ process = $_; commandLine = $null; executablePath = $null } } } else {
    $processMetadata | ForEach-Object {
      $metadataPath = [string]$_.ExecutablePath
      $metadataCommandLine = [string]$_.CommandLine
      $pathMatches = [String]::Equals($metadataPath, $expectedFullPath, [StringComparison]::OrdinalIgnoreCase) `
        -or (Test-ManagedPythonVenvInvocation `
          -ExpectedFilePath $expectedFullPath `
          -ActualFilePath $metadataPath `
          -CommandLine $metadataCommandLine `
          -ParentProcessId ([int]$_.ParentProcessId))
      if ($pathMatches) {
        $process = Get-Process -Id ([int]$_.ProcessId) -ErrorAction SilentlyContinue
        if ($null -ne $process) {
          [pscustomobject]@{ process = $process; commandLine = $metadataCommandLine; executablePath = $metadataPath }
        }
      }
    }
  }
  foreach ($candidate in $candidates) {
    $process = $candidate.process
    if ($ProcessStartUtc) {
      try {
        $dateStyles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
        $expected = ([DateTimeOffset]::Parse(
          $ProcessStartUtc,
          [Globalization.CultureInfo]::InvariantCulture,
          $dateStyles
        )).UtcDateTime
        $actual = $process.StartTime.ToUniversalTime()
        if ([Math]::Abs(($actual - $expected).TotalMilliseconds) -gt 1000) { continue }
      } catch { continue }
    }
    if ($Pid -gt 0) {
      $matches = Test-ManagedProcessExecutable -Process $process -ExpectedFilePath $ExpectedFilePath -ExpectedArgumentFragments $ExpectedArgumentFragments
    } else {
      $matches = $true
      foreach ($fragment in @($ExpectedArgumentFragments)) {
        if ($fragment -and (-not $candidate.commandLine -or $candidate.commandLine.IndexOf([string]$fragment, [StringComparison]::OrdinalIgnoreCase) -lt 0)) {
          $matches = $false
          break
        }
      }
    }
    if ($matches) {
      return $process
    }
  }
  return $null
}

function Find-ManagedProcessByReceipt {
  param(
    [int]$Pid = 0,
    [string]$ProcessStartUtc = '',
    [string]$ExpectedFilePath = '',
    [string[]]$ExpectedArgumentFragments = @()
  )
  if ($Pid -lt 1 -or -not $ProcessStartUtc) { return $null }
  $process = Get-Process -Id $Pid -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  try {
    $dateStyles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    $expected = ([DateTimeOffset]::Parse(
      $ProcessStartUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      $dateStyles
    )).UtcDateTime
    $actual = $process.StartTime.ToUniversalTime()
    if ([Math]::Abs(($actual - $expected).TotalMilliseconds) -gt 1000) { return $null }
  } catch {
    return $null
  }
  if (-not (Test-ManagedProcessExecutable -Process $process -ExpectedFilePath $ExpectedFilePath -ExpectedArgumentFragments $ExpectedArgumentFragments)) { return $null }
  return $process
}

function Write-ManagedLaunchIntent {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Status,
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$InstanceId,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$HealthUrl,
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$ArgumentList,
    [string]$WorkingDirectory = '',
    [string]$StandardOutputPath = '',
    [string]$StandardErrorPath = '',
    [string]$ExecutableIdentity = '',
    [int]$Pid = 0,
    [string]$ProcessStartUtc = '',
    [hashtable]$Metadata = @{}
  )
  $intent = [ordered]@{
    schemaVersion = 1
    status = $Status
    releaseId = $ReleaseId
    profileId = $ProfileId
    instanceId = $InstanceId
    port = $Port
    healthUrl = $HealthUrl
    filePath = $FilePath
    argumentList = @($ArgumentList)
    workingDirectory = $WorkingDirectory
    standardOutputPath = $StandardOutputPath
    standardErrorPath = $StandardErrorPath
    executableIdentity = $ExecutableIdentity
    pid = $Pid
    processStartUtc = $ProcessStartUtc
    createdAtUtc = ([DateTime]::UtcNow).ToString('O')
    updatedAtUtc = ([DateTime]::UtcNow).ToString('O')
  }
  if ($Metadata) {
    $intent.metadata = [ordered]@{}
    foreach ($metadataName in $Metadata.Keys) { $intent.metadata[[string]$metadataName] = $Metadata[$metadataName] }
  }
  Write-InstanceStateAtomic -StatePath $Path -State $intent
}

function Resolve-ManagedArgumentList {
  param(
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$InstanceId,
    [Parameter(Mandatory)][int]$Port,
    [string]$ExecutableIdentity = ''
  )
  return @($ArgumentList | ForEach-Object {
    [string]$_ -replace '\{instanceId\}', $InstanceId -replace '\{releaseId\}', $ReleaseId -replace '\{profileId\}', $ProfileId -replace '\{port\}', [string]$Port -replace '\{executableIdentity\}', $ExecutableIdentity
  })
}

function Get-ManagedRecordValue {
  param($Object, [Parameter(Mandatory)][string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function ConvertTo-ManagedStartRecord {
  param([Parameter(Mandatory)][hashtable]$Spec)
  $record = [ordered]@{
    statePath = if ($Spec.ContainsKey('StatePath')) { [string]$Spec.StatePath } else { '' }
    launchIntentPath = if ($Spec.ContainsKey('LaunchIntentPath')) { [string]$Spec.LaunchIntentPath } else { '' }
    releaseId = [string]$Spec.ReleaseId
    profileId = [string]$Spec.ProfileId
    instanceId = [string]$Spec.InstanceId
    port = [int]$Spec.Port
    healthUrl = [string]$Spec.HealthUrl
    filePath = [string]$Spec.FilePath
    argumentList = @($Spec.ArgumentList)
    workingDirectory = [string]$Spec.WorkingDirectory
    readyTimeoutSeconds = [int]$Spec.ReadyTimeoutSeconds
    reservedDailyPorts = if ($Spec.ContainsKey('ReservedDailyPorts')) { @($Spec.ReservedDailyPorts) } else { @(5173, 8765, 5174, 8766) }
    allowReservedDailyPorts = if ($Spec.ContainsKey('AllowReservedDailyPorts')) { [bool]$Spec.AllowReservedDailyPorts } else { $false }
    standardOutputPath = [string]$Spec.StandardOutputPath
    standardErrorPath = [string]$Spec.StandardErrorPath
    executableIdentity = [string]$Spec.ExecutableIdentity
    metadata = [ordered]@{}
  }
  if ($Spec.Metadata) {
    foreach ($metadataName in $Spec.Metadata.Keys) { $record.metadata[[string]$metadataName] = $Spec.Metadata[$metadataName] }
  }
  return $record
}

function ConvertFrom-ManagedStartRecord {
  param(
    [Parameter(Mandatory)]$Record,
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][string]$LaunchIntentPath
  )
  $metadata = @{}
  $recordMetadata = Get-ManagedRecordValue -Object $Record -Name 'metadata'
  if ($null -ne $recordMetadata) {
    foreach ($property in @($recordMetadata.PSObject.Properties)) { $metadata[$property.Name] = $property.Value }
  }
  $reservedPorts = Get-ManagedRecordValue -Object $Record -Name 'reservedDailyPorts'
  return @{
    ReleaseId = [string](Get-ManagedRecordValue -Object $Record -Name 'releaseId')
    ProfileId = [string](Get-ManagedRecordValue -Object $Record -Name 'profileId')
    InstanceId = [string](Get-ManagedRecordValue -Object $Record -Name 'instanceId')
    Port = [int](Get-ManagedRecordValue -Object $Record -Name 'port')
    HealthUrl = [string](Get-ManagedRecordValue -Object $Record -Name 'healthUrl')
    StatePath = $StatePath
    FilePath = [string](Get-ManagedRecordValue -Object $Record -Name 'filePath')
    ArgumentList = @((Get-ManagedRecordValue -Object $Record -Name 'argumentList') | ForEach-Object { [string]$_ })
    WorkingDirectory = [string](Get-ManagedRecordValue -Object $Record -Name 'workingDirectory')
    ReadyTimeoutSeconds = [Math]::Max(1, [int](Get-ManagedRecordValue -Object $Record -Name 'readyTimeoutSeconds'))
    ReservedDailyPorts = if ($null -eq $reservedPorts) { @(5173, 8765, 5174, 8766) } else { @($reservedPorts | ForEach-Object { [int]$_ }) }
    AllowReservedDailyPorts = [bool](Get-ManagedRecordValue -Object $Record -Name 'allowReservedDailyPorts')
    StandardOutputPath = [string](Get-ManagedRecordValue -Object $Record -Name 'standardOutputPath')
    StandardErrorPath = [string](Get-ManagedRecordValue -Object $Record -Name 'standardErrorPath')
    ExecutableIdentity = [string](Get-ManagedRecordValue -Object $Record -Name 'executableIdentity')
    Metadata = $metadata
    LaunchIntentPath = $LaunchIntentPath
  }
}

function Write-ManagedReplacementRecord {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][hashtable]$Fallback,
    [Parameter(Mandatory)][hashtable]$Candidate,
    [hashtable]$Preflight = $null
  )
  $record = [ordered]@{
    schemaVersion = 1
    status = 'replacing'
    statePath = $StatePath
    profileId = [string]$Fallback.ProfileId
    port = [int]$Fallback.Port
    createdAtUtc = ([DateTime]::UtcNow).ToString('O')
    fallback = ConvertTo-ManagedStartRecord -Spec $Fallback
    candidate = ConvertTo-ManagedStartRecord -Spec $Candidate
  }
  if ($null -ne $Preflight) { $record.preflight = ConvertTo-ManagedStartRecord -Spec $Preflight }
  Write-InstanceStateAtomic -StatePath $Path -State $record
}

function Recover-ManagedRuntimeReplacement {
  param([Parameter(Mandatory)][string]$ReplacementPath)
  if (-not (Test-Path -LiteralPath $ReplacementPath -PathType Leaf)) { return $true }
  $record = Read-InstanceState -StatePath $ReplacementPath
  if ($null -eq $record -or [int](Get-ManagedRecordValue -Object $record -Name 'schemaVersion') -ne 1 -or (Get-ManagedRecordValue -Object $record -Name 'status') -ne 'replacing') { return $false }
  $statePath = [string](Get-ManagedRecordValue -Object $record -Name 'statePath')
  $fallbackRecord = Get-ManagedRecordValue -Object $record -Name 'fallback'
  $candidateRecord = Get-ManagedRecordValue -Object $record -Name 'candidate'
  $preflightRecord = Get-ManagedRecordValue -Object $record -Name 'preflight'
  if (-not $statePath -or $null -eq $fallbackRecord -or $null -eq $candidateRecord) { return $false }
  $fallback = ConvertFrom-ManagedStartRecord -Record $fallbackRecord -StatePath $statePath -LaunchIntentPath "$statePath.intent.json"
  $candidate = ConvertFrom-ManagedStartRecord -Record $candidateRecord -StatePath $statePath -LaunchIntentPath "$statePath.intent.json"
  if (-not $fallback.ReleaseId -or -not $fallback.ProfileId -or -not $fallback.InstanceId -or -not $fallback.HealthUrl -or -not $fallback.FilePath -or $fallback.Port -lt 1 -or $fallback.ArgumentList.Count -eq 0) { return $false }

  if ($null -ne $preflightRecord) {
    $preflightStatePath = [string](Get-ManagedRecordValue -Object $preflightRecord -Name 'statePath')
    if (-not $preflightStatePath) { return $false }
    $preflight = ConvertFrom-ManagedStartRecord -Record $preflightRecord -StatePath $preflightStatePath -LaunchIntentPath "$preflightStatePath.intent.json"
    if (-not $preflight.ReleaseId -or -not $preflight.ProfileId -or -not $preflight.InstanceId -or -not $preflight.HealthUrl -or -not $preflight.FilePath -or $preflight.Port -lt 1 -or $preflight.ArgumentList.Count -eq 0) { return $false }
    $preflightMatch = Find-ManagedOrphanRuntime `
      -Port $preflight.Port `
      -HealthUrl $preflight.HealthUrl `
      -ReleaseId $preflight.ReleaseId `
      -ProfileId $preflight.ProfileId `
      -InstanceId $preflight.InstanceId `
      -ExecutableIdentity $preflight.ExecutableIdentity `
      -ExpectedFilePath $preflight.FilePath `
      -ExpectedArgumentFragments $preflight.ArgumentList
    $preflightProcess = Find-ManagedProcessByExecutable `
      -ExpectedFilePath $preflight.FilePath `
      -ExpectedArgumentFragments $preflight.ArgumentList
    if ($null -ne $preflightMatch) {
      if (-not (Stop-ManagedOrphanRuntime `
          -Port $preflight.Port `
          -HealthUrl $preflight.HealthUrl `
          -ReleaseId $preflight.ReleaseId `
          -ProfileId $preflight.ProfileId `
          -InstanceId $preflight.InstanceId `
          -ExecutableIdentity $preflight.ExecutableIdentity `
          -ExpectedFilePath $preflight.FilePath `
          -ExpectedArgumentFragments $preflight.ArgumentList `
          -StopTimeoutSeconds 5) -or -not (Wait-ManagedTcpPortFree -Port $preflight.Port -TimeoutSeconds 5)) { return $false }
    } elseif ($null -ne $preflightProcess) {
      try {
        Stop-Process -Id $preflightProcess.Id -ErrorAction Stop
        try { $preflightProcess.WaitForExit(5000) | Out-Null } catch {}
      } catch { return $false }
      if (-not (Wait-ManagedTcpPortFree -Port $preflight.Port -TimeoutSeconds 5)) { return $false }
    } elseif (Test-TcpPortOccupied -Port $preflight.Port) {
      return $false
    }
    if (Test-Path -LiteralPath $preflight.StatePath -PathType Leaf) {
      $preflightState = Read-InstanceState -StatePath $preflight.StatePath
      if ($null -ne $preflightState -and [string]$preflightState.profileId -eq $preflight.ProfileId -and [string]$preflightState.instanceId -eq $preflight.InstanceId) {
        Remove-Item -LiteralPath $preflight.StatePath -Force -ErrorAction SilentlyContinue
      }
    }
    Remove-Item -LiteralPath $preflight.LaunchIntentPath -Force -ErrorAction SilentlyContinue
  }

  $oldState = Read-InstanceState -StatePath $statePath
  if ($null -ne $oldState) {
    $oldProcess = Get-MatchingOwnedProcess -State $oldState
    $oldHealth = Get-LauncherHealth -HealthUrl $fallback.HealthUrl
    if ($null -ne $oldProcess -and (Test-HealthIdentity -Health $oldHealth -ReleaseId $fallback.ReleaseId -ProfileId $fallback.ProfileId -InstanceId $fallback.InstanceId -ExecutableIdentity $fallback.ExecutableIdentity)) {
      Remove-Item -LiteralPath $ReplacementPath -Force -ErrorAction SilentlyContinue
      return $true
    }
  }

  $candidateMatch = Find-ManagedOrphanRuntime `
    -Port $candidate.Port `
    -HealthUrl $candidate.HealthUrl `
    -ReleaseId $candidate.ReleaseId `
    -ProfileId $candidate.ProfileId `
    -InstanceId $candidate.InstanceId `
    -ExecutableIdentity $candidate.ExecutableIdentity `
    -ExpectedFilePath $candidate.FilePath `
    -ExpectedArgumentFragments $candidate.ArgumentList
  $candidateProcess = Find-ManagedProcessByExecutable `
    -ExpectedFilePath $candidate.FilePath `
    -ExpectedArgumentFragments $candidate.ArgumentList
  if ($null -ne $candidateMatch) {
    $stopped = Stop-ManagedOrphanRuntime `
      -Port $candidate.Port `
      -HealthUrl $candidate.HealthUrl `
      -ReleaseId $candidate.ReleaseId `
      -ProfileId $candidate.ProfileId `
      -InstanceId $candidate.InstanceId `
      -ExecutableIdentity $candidate.ExecutableIdentity `
      -ExpectedFilePath $candidate.FilePath `
      -StopTimeoutSeconds 5
    if (-not $stopped -or (Test-TcpPortOccupied -Port $candidate.Port)) { return $false }
  } elseif ($null -ne $candidateProcess) {
    try {
      Stop-Process -Id $candidateProcess.Id -ErrorAction Stop
      try { $candidateProcess.WaitForExit(5000) | Out-Null } catch {}
    } catch {
      return $false
    }
    if (-not (Wait-ManagedTcpPortFree -Port $candidate.Port -TimeoutSeconds 5)) { return $false }
  } elseif (Test-TcpPortOccupied -Port $candidate.Port) {
    # A listener that does not prove the candidate health/path identity is
    # never stopped during replacement recovery.
    return $false
  }

  try {
    Start-ManagedRuntimeInstance @fallback -SkipTestKillHook | Out-Null
    Remove-Item -LiteralPath $ReplacementPath -Force -ErrorAction SilentlyContinue
    return $true
  } catch {
    return $false
  }
}

function Get-ManagedStartSpecFromState {
  param($State)
  if ($null -eq $State) { return $null }
  $propertyNames = @($State.PSObject.Properties | Select-Object -ExpandProperty Name)
  if ($propertyNames -notcontains 'filePath' -or $propertyNames -notcontains 'healthUrl' -or $propertyNames -notcontains 'argumentList') { return $null }
  $filePath = [string]$State.filePath
  $healthUrl = [string]$State.healthUrl
  $arguments = @($State.argumentList | ForEach-Object { [string]$_ })
  if (-not $filePath -or -not $healthUrl -or $arguments.Count -eq 0) { return $null }
  $metadata = @{}
  $reserved = @(
    'schemaVersion', 'releaseId', 'profileId', 'instanceId', 'port', 'pid',
    'processStartUtc', 'launcherPid', 'launcherProcessStartUtc', 'startedAtUtc', 'executableIdentity', 'filePath',
    'argumentList', 'workingDirectory', 'standardOutputPath', 'standardErrorPath',
    'healthUrl', 'launchIntentPath', 'reservedDailyPorts', 'allowReservedDailyPorts'
  )
  foreach ($property in @($State.PSObject.Properties)) {
    if ($reserved -notcontains $property.Name) { $metadata[$property.Name] = $property.Value }
  }
  return @{
    ReleaseId = [string]$State.releaseId
    ProfileId = [string]$State.profileId
    InstanceId = [string]$State.instanceId
    Port = [int]$State.port
    HealthUrl = $healthUrl
    StatePath = ''
    FilePath = $filePath
    ArgumentList = $arguments
    WorkingDirectory = [string]$State.workingDirectory
    ReadyTimeoutSeconds = 30
    ReservedDailyPorts = if ($null -ne (Get-ManagedRecordValue -Object $State -Name 'reservedDailyPorts')) {
      @((Get-ManagedRecordValue -Object $State -Name 'reservedDailyPorts') | ForEach-Object { [int]$_ })
    } else { @(5173, 8765, 5174, 8766) }
    AllowReservedDailyPorts = [bool](Get-ManagedRecordValue -Object $State -Name 'allowReservedDailyPorts')
    StandardOutputPath = [string]$State.standardOutputPath
    StandardErrorPath = [string]$State.standardErrorPath
    ExecutableIdentity = [string](Get-ManagedRecordValue -Object $State -Name 'executableIdentity')
    Metadata = $metadata
  }
}

function Find-ManagedOrphanRuntime {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$HealthUrl,
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$InstanceId,
    [string]$ExecutableIdentity = '',
    [string]$ExpectedFilePath = '',
    [string[]]$ExpectedArgumentFragments = @()
  )
  $process = Get-LoopbackPortOwnerProcess -Port $Port
  if ($null -eq $process) { return $null }
  $health = Get-LauncherHealth -HealthUrl $HealthUrl
  if (-not (Test-HealthIdentity -Health $health -ReleaseId $ReleaseId -ProfileId $ProfileId -InstanceId $InstanceId -ExecutableIdentity $ExecutableIdentity)) {
    return $null
  }
  if (-not (Test-ManagedProcessExecutable -Process $process -ExpectedFilePath $ExpectedFilePath -ExpectedArgumentFragments $ExpectedArgumentFragments)) {
    return $null
  }
  return [pscustomobject]@{ process = $process; health = $health }
}

function Stop-ManagedOrphanRuntime {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$HealthUrl,
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$InstanceId,
    [string]$ExecutableIdentity = '',
    [string]$ExpectedFilePath = '',
    [string[]]$ExpectedArgumentFragments = @(),
    [int]$StopTimeoutSeconds = 3
  )
  $match = Find-ManagedOrphanRuntime `
    -Port $Port `
    -HealthUrl $HealthUrl `
    -ReleaseId $ReleaseId `
    -ProfileId $ProfileId `
    -InstanceId $InstanceId `
    -ExecutableIdentity $ExecutableIdentity `
    -ExpectedFilePath $ExpectedFilePath `
    -ExpectedArgumentFragments $ExpectedArgumentFragments
  if ($null -eq $match) { return $false }
  $process = $match.process
  try {
    Stop-Process -Id $process.Id -ErrorAction Stop
    try { $process.WaitForExit([Math]::Max(1, $StopTimeoutSeconds) * 1000) | Out-Null } catch {}
    $process.Refresh()
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction Stop }
    return $true
  } catch {
    return $false
  }
}

function Start-ManagedRuntimeProcessCore {
  param(
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$InstanceId,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$HealthUrl,
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = '',
    [int]$ReadyTimeoutSeconds = 30,
    [int[]]$ReservedDailyPorts = @(5173, 8765, 5174, 8766),
    [string]$StandardOutputPath = '',
    [string]$StandardErrorPath = '',
    [string]$ExecutableIdentity = '',
    [hashtable]$Metadata = @{},
    [Parameter(Mandatory)][string]$LaunchIntentPath,
    [switch]$AllowReservedDailyPorts,
    [switch]$SkipTestKillHook
  )
  $process = $null
  $state = $null
  $arguments = @($ArgumentList | ForEach-Object {
    [string]$_ -replace '\{instanceId\}', $InstanceId -replace '\{releaseId\}', $ReleaseId -replace '\{profileId\}', $ProfileId -replace '\{port\}', [string]$Port -replace '\{executableIdentity\}', $ExecutableIdentity
  })
  Write-ManagedLaunchIntent `
    -Path $LaunchIntentPath `
    -Status 'starting' `
    -ReleaseId $ReleaseId `
    -ProfileId $ProfileId `
    -InstanceId $InstanceId `
    -Port $Port `
    -HealthUrl $HealthUrl `
    -FilePath $FilePath `
    -ArgumentList $arguments `
    -WorkingDirectory $WorkingDirectory `
    -StandardOutputPath $StandardOutputPath `
    -StandardErrorPath $StandardErrorPath `
    -ExecutableIdentity $ExecutableIdentity `
    -Metadata $Metadata
  try {
    $previousInstanceId = $env:READ_WEB_INSTANCE_ID
    $env:READ_WEB_INSTANCE_ID = $InstanceId
    $start = @{ FilePath = $FilePath; ArgumentList = $arguments; PassThru = $true; WindowStyle = 'Hidden' }
    if ($WorkingDirectory) { $start.WorkingDirectory = $WorkingDirectory }
    if ($StandardOutputPath) { $start.RedirectStandardOutput = $StandardOutputPath }
    if ($StandardErrorPath) { $start.RedirectStandardError = $StandardErrorPath }
    try { $process = Start-Process @start } finally { $env:READ_WEB_INSTANCE_ID = $previousInstanceId }

    $processStartUtc = Get-ProcessStartUtc -Process $process
    $runtimeRole = if ($Metadata.ContainsKey('runtimeRole')) { [string]$Metadata.runtimeRole } else { '' }
    if (-not $SkipTestKillHook `
      -and [string]$env:READ_WEB_OPTIMIZATION_TEST_KILL_PHASE -eq 'host-process-started' `
      -and $runtimeRole -eq 'production-host') {
      # Deliberately terminate before the PID receipt is refreshed.  The
      # activation journal carries the candidate's port/health/argument
      # identity, allowing the next launcher to find this exact child even if
      # no manager state was ever written.
      Write-Host "Synthetic launcher process termination after managed process spawn, before receipt: $InstanceId"
      Stop-Process -Id $PID -Force -ErrorAction Stop
      throw 'Synthetic launcher process-start boundary did not terminate the process.'
    }
    Write-ManagedLaunchIntent `
      -Path $LaunchIntentPath `
      -Status 'spawned' `
      -ReleaseId $ReleaseId `
      -ProfileId $ProfileId `
      -InstanceId $InstanceId `
      -Port $Port `
      -HealthUrl $HealthUrl `
      -FilePath $FilePath `
      -ArgumentList $arguments `
      -WorkingDirectory $WorkingDirectory `
      -StandardOutputPath $StandardOutputPath `
      -StandardErrorPath $StandardErrorPath `
      -ExecutableIdentity $ExecutableIdentity `
      -Pid $process.Id `
      -ProcessStartUtc $processStartUtc `
      -Metadata $Metadata

    $state = [ordered]@{
      schemaVersion = 1
      releaseId = $ReleaseId
      profileId = $ProfileId
      instanceId = $InstanceId
      port = $Port
      pid = $process.Id
      processStartUtc = $processStartUtc
      launcherPid = $process.Id
      launcherProcessStartUtc = $processStartUtc
      startedAtUtc = ([DateTime]::UtcNow).ToString('O')
      executableIdentity = $ExecutableIdentity
      healthUrl = $HealthUrl
      filePath = $FilePath
      argumentList = @($arguments)
      workingDirectory = $WorkingDirectory
      standardOutputPath = $StandardOutputPath
      standardErrorPath = $StandardErrorPath
      reservedDailyPorts = @($ReservedDailyPorts)
      allowReservedDailyPorts = [bool]$AllowReservedDailyPorts
      launchIntentPath = $LaunchIntentPath
    }
    foreach ($metadataName in $Metadata.Keys) {
      if ([string]$metadataName -in @('schemaVersion', 'releaseId', 'profileId', 'instanceId', 'port', 'pid', 'processStartUtc', 'launcherPid', 'launcherProcessStartUtc', 'startedAtUtc', 'executableIdentity', 'healthUrl', 'filePath', 'argumentList', 'workingDirectory', 'standardOutputPath', 'standardErrorPath', 'reservedDailyPorts', 'allowReservedDailyPorts', 'launchIntentPath')) {
        throw "Managed runtime metadata may not replace ownership field '$metadataName'."
      }
      $state[[string]$metadataName] = $Metadata[$metadataName]
    }
    Write-InstanceStateAtomic -StatePath $StatePath -State $state
    Write-ManagedLaunchIntent `
      -Path $LaunchIntentPath `
      -Status 'state-written' `
      -ReleaseId $ReleaseId `
      -ProfileId $ProfileId `
      -InstanceId $InstanceId `
      -Port $Port `
      -HealthUrl $HealthUrl `
      -FilePath $FilePath `
      -ArgumentList $arguments `
      -WorkingDirectory $WorkingDirectory `
      -StandardOutputPath $StandardOutputPath `
      -StandardErrorPath $StandardErrorPath `
      -ExecutableIdentity $ExecutableIdentity `
      -Pid $process.Id `
      -ProcessStartUtc $processStartUtc `
      -Metadata $Metadata

    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, $ReadyTimeoutSeconds))
    do {
      $process.Refresh()
      if ($process.HasExited) { throw "Managed process exited before ready with code $($process.ExitCode)." }
      $health = Get-LauncherHealth -HealthUrl $HealthUrl
      if (Test-HealthIdentity -Health $health -ReleaseId $ReleaseId -ProfileId $ProfileId -InstanceId $InstanceId -ExecutableIdentity $ExecutableIdentity) {
        $portOwner = Get-LoopbackPortOwnerProcess -Port $Port
        if ($null -ne $portOwner -and $portOwner.Id -ne $process.Id) {
          $state.pid = $portOwner.Id
          $state.processStartUtc = Get-ProcessStartUtc -Process $portOwner
          Write-InstanceStateAtomic -StatePath $StatePath -State $state
        }
        $readyPid = if ($null -ne $portOwner) { $portOwner.Id } else { $process.Id }
        Remove-Item -LiteralPath $LaunchIntentPath -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ status = 'started'; pid = $readyPid; instanceId = $InstanceId; url = $HealthUrl; executableIdentity = $ExecutableIdentity }
      }
      Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Managed process did not become ready within $ReadyTimeoutSeconds seconds."
  } catch {
    $failure = $_
    $stateStopped = $false
    if (Test-Path -LiteralPath $StatePath -PathType Leaf) {
      try {
        Stop-OwnedRuntimeInstance `
          -StatePath $StatePath `
          -ExpectedReleaseId $ReleaseId `
          -ExpectedProfileId $ProfileId `
          -ExpectedInstanceId $InstanceId `
          -StopTimeoutSeconds 3 | Out-Null
        $stateStopped = $true
      } catch {}
    }
    if (-not $stateStopped -and $null -ne $process) {
      try {
        $process.Refresh()
        if (-not $process.HasExited) {
          Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
          try { $process.WaitForExit(3000) | Out-Null } catch {}
        }
      } catch {}
    }
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $LaunchIntentPath -Force -ErrorAction SilentlyContinue
    throw $failure
  }
}

function Stop-OwnedRuntimeInstance {
  param(
    [Parameter(Mandatory)][string]$StatePath,
    [string]$ExpectedReleaseId = '',
    [string]$ExpectedProfileId = '',
    [string]$ExpectedInstanceId = '',
    [int]$StopTimeoutSeconds = 3
  )
  $state = Read-InstanceState -StatePath $StatePath
  if ($null -eq $state) { return $false }
  if ($ExpectedReleaseId -and [string]$state.releaseId -ne $ExpectedReleaseId) { throw 'Release ownership mismatch; refusing to stop process.' }
  if ($ExpectedProfileId -and [string]$state.profileId -ne $ExpectedProfileId) { throw 'Profile ownership mismatch; refusing to stop process.' }
  if ($ExpectedInstanceId -and [string]$state.instanceId -ne $ExpectedInstanceId) { throw 'Instance ownership mismatch; refusing to stop process.' }
  $process = Get-MatchingOwnedProcess -State $state
  if ($null -eq $process) { throw 'PID/start identity mismatch; refusing to stop process.' }
  $expectedFilePath = [string](Get-ManagedRecordValue -Object $state -Name 'filePath')
  $expectedArguments = @((Get-ManagedRecordValue -Object $state -Name 'argumentList') | ForEach-Object { [string]$_ })
  $portProcess = $null
  $portText = [string](Get-ManagedRecordValue -Object $state -Name 'port')
  $port = 0
  if ($expectedFilePath -and [int]::TryParse($portText, [ref]$port) -and $port -gt 0) {
    if (Test-TcpPortOccupied -Port $port) {
      $portProcess = Get-LoopbackPortOwnerProcess -Port $port
      if ($null -eq $portProcess) {
        throw "Managed runtime port $port is occupied but its owner could not be proven; refusing to stop any process."
      }
      if ($portProcess.Id -ne $process.Id -and -not (Test-ManagedProcessExecutable -Process $portProcess -ExpectedFilePath $expectedFilePath -ExpectedArgumentFragments $expectedArguments)) {
        throw "Managed runtime port $port is occupied by an unproven process; refusing to stop any process."
      }
    }
  }
  $launcherProcess = $null
  $launcherPidText = [string](Get-ManagedRecordValue -Object $state -Name 'launcherPid')
  $launcherStartText = [string](Get-ManagedRecordValue -Object $state -Name 'launcherProcessStartUtc')
  if ($launcherPidText -and $launcherStartText) {
    $launcherPid = 0
    if (-not [int]::TryParse($launcherPidText, [ref]$launcherPid) -or $launcherPid -lt 1) {
      throw 'Launcher process receipt is invalid; refusing to stop process.'
    }
    if ($launcherPid -ne $process.Id) {
      $launcherProcess = Find-ManagedProcessByReceipt `
        -Pid $launcherPid `
        -ProcessStartUtc $launcherStartText `
        -ExpectedFilePath ([string](Get-ManagedRecordValue -Object $state -Name 'filePath')) `
        -ExpectedArgumentFragments @((Get-ManagedRecordValue -Object $state -Name 'argumentList') | ForEach-Object { [string]$_ })
      $liveLauncher = Get-Process -Id $launcherPid -ErrorAction SilentlyContinue
      if ($null -ne $liveLauncher -and $null -eq $launcherProcess) {
        throw 'Launcher process identity mismatch; refusing to stop process.'
      }
    }
  }
  $processesToStop = @()
  foreach ($candidateProcess in @($portProcess, $process, $launcherProcess)) {
    if ($null -ne $candidateProcess -and @($processesToStop | Where-Object { $_.Id -eq $candidateProcess.Id }).Count -eq 0) {
      $processesToStop += $candidateProcess
    }
  }
  foreach ($processToStop in $processesToStop) {
    try {
      $processToStop.Refresh()
      if ($processToStop.HasExited) { continue }
      Stop-Process -Id $processToStop.Id -ErrorAction Stop
      try { $processToStop.WaitForExit([Math]::Max(1, $StopTimeoutSeconds) * 1000) | Out-Null } catch {}
      $processToStop.Refresh()
      if (-not $processToStop.HasExited) { Stop-Process -Id $processToStop.Id -Force -ErrorAction Stop }
    } catch {
      throw "Managed runtime process $($processToStop.Id) did not stop cleanly."
    }
  }
  Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
  return $true
}

function Start-ManagedRuntimeInstance {
  param(
    [Parameter(Mandatory)][string]$ReleaseId,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$HealthUrl,
    [Parameter(Mandatory)][string]$StatePath,
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = '',
    [int]$ReadyTimeoutSeconds = 30,
    [int[]]$ReservedDailyPorts = @(5173, 8765, 5174, 8766),
    [string]$StandardOutputPath = '',
    [string]$StandardErrorPath = '',
    [string]$InstanceId = '',
    [string]$ExecutableIdentity = '',
    [hashtable]$Metadata = @{},
    [string]$LaunchIntentPath = '',
    [hashtable]$FallbackStart = $null,
    [hashtable]$PreflightStart = $null,
    [switch]$AllowReservedDailyPorts,
    [switch]$SkipTestKillHook
  )
  Assert-LauncherPortSafety -Port $Port -ProfileId $ProfileId -ReservedDailyPorts $ReservedDailyPorts -AllowReservedDailyPorts:$AllowReservedDailyPorts
  $stateDirectory = Split-Path -Parent $StatePath
  if (-not $stateDirectory) { $stateDirectory = (Get-Location).Path }
  New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
  if (-not $LaunchIntentPath) { $LaunchIntentPath = "$StatePath.intent.json" }
  $lockPath = "$StatePath.lock"
  $replacementPath = "$StatePath.replacement.json"
  $lock = $null
  $replacementFallback = $null
  $fallbackRecovered = $false
  $replacementOldStopped = $false
  try {
    try {
      $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
      throw "Runtime instance launch already in progress for profile '$ProfileId'."
    }

    $existing = Read-InstanceState -StatePath $StatePath
    if ($null -ne $existing) {
      $owned = Get-MatchingOwnedProcess -State $existing
      $health = Get-LauncherHealth -HealthUrl $HealthUrl
      $requestedInstanceMatches = (-not $InstanceId) -or ([string]$existing.instanceId -eq $InstanceId)
      $baseHealthIdentityMatches = Test-HealthIdentity `
        -Health $health `
        -ReleaseId $ReleaseId `
        -ProfileId $ProfileId `
        -InstanceId ([string]$existing.instanceId)
      $executableIdentityMatches = (-not $ExecutableIdentity) -or (
        ([string](Get-ManagedRecordValue -Object $existing -Name 'executableIdentity') -eq $ExecutableIdentity) `
          -and ([string](Get-ManagedRecordValue -Object $health -Name 'executableIdentity') -eq $ExecutableIdentity)
      )
      if ($null -ne $owned `
        -and [string]$existing.releaseId -eq $ReleaseId `
        -and [string]$existing.profileId -eq $ProfileId `
        -and [int]$existing.port -eq $Port `
        -and $requestedInstanceMatches `
        -and $baseHealthIdentityMatches `
        -and $executableIdentityMatches) {
        return [pscustomobject]@{ status = 'reused'; pid = $owned.Id; instanceId = [string]$existing.instanceId; url = $HealthUrl; executableIdentity = $ExecutableIdentity }
      }
      if ($null -ne $owned) {
        $sameManagedIdentity = [string]$existing.releaseId -eq $ReleaseId `
          -and [string]$existing.profileId -eq $ProfileId `
          -and [int]$existing.port -eq $Port `
          -and $requestedInstanceMatches
        if ($ExecutableIdentity -and $sameManagedIdentity -and $baseHealthIdentityMatches -and -not $executableIdentityMatches) {
          $replacementFallback = Get-ManagedStartSpecFromState -State $existing
          if ($null -eq $replacementFallback -and $null -ne $FallbackStart) {
            $replacementFallback = @{}
            foreach ($fallbackName in $FallbackStart.Keys) { $replacementFallback[$fallbackName] = $FallbackStart[$fallbackName] }
          }
          if ($null -eq $replacementFallback) {
            throw 'Executable identity changed, but no ownership-checked recovery start specification is available; refusing replacement.'
          }
          $replacementFallback.StatePath = $StatePath
          $replacementFallback.LaunchIntentPath = $LaunchIntentPath
          $replacementFallback.ReadyTimeoutSeconds = [Math]::Max(1, $ReadyTimeoutSeconds)
          $replacementFallback.ReservedDailyPorts = @($ReservedDailyPorts)
          $replacementFallback.AllowReservedDailyPorts = [bool]$AllowReservedDailyPorts
          $replacementCandidateInstanceId = [string]$existing.instanceId
          $replacementCandidate = @{
            ReleaseId = $ReleaseId
            ProfileId = $ProfileId
            InstanceId = $replacementCandidateInstanceId
            Port = $Port
            HealthUrl = $HealthUrl
            StatePath = $StatePath
            FilePath = $FilePath
            ArgumentList = Resolve-ManagedArgumentList -ArgumentList $ArgumentList -ReleaseId $ReleaseId -ProfileId $ProfileId -InstanceId $replacementCandidateInstanceId -Port $Port -ExecutableIdentity $ExecutableIdentity
            WorkingDirectory = $WorkingDirectory
            ReadyTimeoutSeconds = [Math]::Max(1, $ReadyTimeoutSeconds)
            ReservedDailyPorts = @($ReservedDailyPorts)
            StandardOutputPath = $StandardOutputPath
            StandardErrorPath = $StandardErrorPath
            ExecutableIdentity = $ExecutableIdentity
            AllowReservedDailyPorts = [bool]$AllowReservedDailyPorts
            Metadata = $Metadata
          }
          $replacementPreflight = $null
          if ($null -ne $PreflightStart) {
            $replacementPreflight = @{}
            foreach ($preflightName in $PreflightStart.Keys) { $replacementPreflight[$preflightName] = $PreflightStart[$preflightName] }
            $replacementPreflight.ProfileId = $ProfileId
            $replacementPreflight.ReleaseId = $ReleaseId
            $replacementPreflight.ExecutableIdentity = $ExecutableIdentity
            $replacementPreflight.AllowReservedDailyPorts = [bool]$AllowReservedDailyPorts
          }
          Write-ManagedReplacementRecord `
            -Path $replacementPath `
            -StatePath $StatePath `
            -Fallback $replacementFallback `
            -Candidate $replacementCandidate `
            -Preflight $replacementPreflight
          if ($null -ne $replacementPreflight) {
            Start-ManagedRuntimeInstance @replacementPreflight -SkipTestKillHook | Out-Null
            Stop-OwnedRuntimeInstance `
              -StatePath $replacementPreflight.StatePath `
              -ExpectedReleaseId $replacementPreflight.ReleaseId `
              -ExpectedProfileId $replacementPreflight.ProfileId `
              -ExpectedInstanceId $replacementPreflight.InstanceId `
              -StopTimeoutSeconds 5 | Out-Null
          }
          Stop-OwnedRuntimeInstance `
            -StatePath $StatePath `
            -ExpectedReleaseId $ReleaseId `
            -ExpectedProfileId $ProfileId `
            -ExpectedInstanceId ([string]$existing.instanceId) `
            -StopTimeoutSeconds 5 | Out-Null
          $replacementOldStopped = $true
          $runtimeRole = if ($Metadata.ContainsKey('runtimeRole')) { [string]$Metadata.runtimeRole } else { '' }
          if ([string]$env:READ_WEB_OPTIMIZATION_TEST_KILL_PHASE -in @('runtime-replacement-stopped', 'front-door-replacement-stopped') `
            -and ($runtimeRole -eq 'front-door' -or $env:READ_WEB_OPTIMIZATION_TEST_KILL_PHASE -eq 'runtime-replacement-stopped')) {
            Write-Host "Synthetic launcher process termination after managed replacement stop: $($existing.instanceId)"
            Stop-Process -Id $PID -Force -ErrorAction Stop
            throw 'Synthetic managed replacement stop boundary did not terminate the process.'
          }
        } else {
          throw 'A launcher-owned process exists but its health identity does not match; refusing replacement.'
        }
      }
      Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    }

    if (Test-TcpPortOccupied -Port $Port) {
      $health = Get-LauncherHealth -HealthUrl $HealthUrl
      $requestedInstanceMatches = (-not $InstanceId) -or ([string]$health.instanceId -eq $InstanceId)
      if ((Test-HealthProfileIdentity -Health $health -ReleaseId $ReleaseId -ProfileId $ProfileId -ExecutableIdentity $ExecutableIdentity) -and $requestedInstanceMatches) {
        $portOwner = Get-LoopbackPortOwnerProcess -Port $Port
        if ($null -eq $portOwner) {
          throw "Port $Port has a matching health response but its loopback process owner could not be proven; refusing adoption."
        }
        $adoptedArguments = Resolve-ManagedArgumentList `
          -ArgumentList $ArgumentList `
          -ReleaseId $ReleaseId `
          -ProfileId $ProfileId `
          -InstanceId ([string]$health.instanceId) `
          -Port $Port `
          -ExecutableIdentity $ExecutableIdentity
        if (-not (Test-ManagedProcessExecutable -Process $portOwner -ExpectedFilePath $FilePath -ExpectedArgumentFragments $adoptedArguments)) {
          throw "Port $Port is occupied by a process whose executable or arguments do not match the requested runtime; refusing adoption."
        }
        Write-InstanceStateAtomic -StatePath $StatePath -State ([ordered]@{
          schemaVersion = 1
          releaseId = $ReleaseId
          profileId = $ProfileId
          instanceId = [string]$health.instanceId
          port = $Port
          pid = $portOwner.Id
          processStartUtc = Get-ProcessStartUtc -Process $portOwner
          startedAtUtc = ([DateTime]::UtcNow).ToString('O')
          executableIdentity = $ExecutableIdentity
          healthUrl = $HealthUrl
          filePath = $FilePath
          argumentList = @($adoptedArguments)
          workingDirectory = $WorkingDirectory
          reservedDailyPorts = @($ReservedDailyPorts)
          allowReservedDailyPorts = [bool]$AllowReservedDailyPorts
          standardOutputPath = $StandardOutputPath
          standardErrorPath = $StandardErrorPath
          launchIntentPath = $LaunchIntentPath
        })
        return [pscustomobject]@{
          status = 'reused'
          pid = $portOwner.Id
          instanceId = [string]$health.instanceId
          url = $HealthUrl
          adopted = $true
          executableIdentity = $ExecutableIdentity
        }
      }
      throw "Port $Port is occupied by an unknown process; it will not be stopped. Choose another port or handle it manually."
    }

    $instanceId = if ($InstanceId) { $InstanceId.Trim() } else { [Guid]::NewGuid().ToString('N') }
    if (-not $instanceId) { throw 'InstanceId must not be empty when supplied.' }
    $result = Start-ManagedRuntimeProcessCore `
      -ReleaseId $ReleaseId `
      -ProfileId $ProfileId `
      -InstanceId $instanceId `
      -Port $Port `
      -HealthUrl $HealthUrl `
      -StatePath $StatePath `
      -FilePath $FilePath `
      -ArgumentList $ArgumentList `
      -WorkingDirectory $WorkingDirectory `
      -ReadyTimeoutSeconds $ReadyTimeoutSeconds `
      -ReservedDailyPorts $ReservedDailyPorts `
      -StandardOutputPath $StandardOutputPath `
      -StandardErrorPath $StandardErrorPath `
      -ExecutableIdentity $ExecutableIdentity `
      -Metadata $Metadata `
      -LaunchIntentPath $LaunchIntentPath `
      -AllowReservedDailyPorts:$AllowReservedDailyPorts `
      -SkipTestKillHook:$SkipTestKillHook
    if (Test-Path -LiteralPath $replacementPath -PathType Leaf) { Remove-Item -LiteralPath $replacementPath -Force -ErrorAction SilentlyContinue }
    return $result
  } catch {
    $failure = $_
    $fallbackFailure = ''
    if ($null -ne $replacementFallback -and -not $replacementOldStopped) {
      # A preflight candidate failed while the old fixed-port process was
      # still serving.  Do not start a second process on that port; retain the
      # old state and remove only this completed replacement receipt.
      Remove-Item -LiteralPath $replacementPath -Force -ErrorAction SilentlyContinue
      $fallbackRecovered = $true
      $fallbackFailure = 'previous runtime remained active during preflight'
    } elseif ($null -ne $replacementFallback) {
      try {
        Start-ManagedRuntimeProcessCore @replacementFallback -SkipTestKillHook | Out-Null
        $fallbackRecovered = $true
        Remove-Item -LiteralPath $replacementPath -Force -ErrorAction SilentlyContinue
      } catch {
        $fallbackFailure = $_.Exception.Message
      }
    }
    if (-not $fallbackRecovered) {
      $created = Read-InstanceState -StatePath $StatePath
      if ($null -ne $created -and $created.releaseId -eq $ReleaseId -and $created.profileId -eq $ProfileId) {
        $owned = Get-MatchingOwnedProcess -State $created
        if ($null -ne $owned) {
          Stop-Process -Id $owned.Id -Force -ErrorAction SilentlyContinue
          try { $owned.WaitForExit(3000) | Out-Null } catch {}
        }
        Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
      }
    }
    if ($fallbackRecovered) { throw "Managed runtime replacement failed; previous runtime restored: $($failure.Exception.Message)" }
    if ($fallbackFailure) { throw "Managed runtime replacement failed and recovery failed: $($failure.Exception.Message); recovery: $fallbackFailure" }
    throw $failure
  } finally {
    if ($null -ne $lock) { $lock.Dispose() }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  }
}

Export-ModuleMember -Function `
  Assert-LauncherPortSafety, `
  Start-ManagedRuntimeInstance, `
  Stop-OwnedRuntimeInstance, `
  Find-ManagedOrphanRuntime, `
  Stop-ManagedOrphanRuntime, `
  Test-ManagedProcessExecutable, `
  Find-ManagedProcessByReceipt, `
  Find-ManagedProcessByExecutable, `
  Recover-ManagedRuntimeReplacement

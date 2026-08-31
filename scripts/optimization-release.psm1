Set-StrictMode -Version Latest

# External tools are optional at launcher startup, but an executable is only
# "verified" when its version probe has the expected tool-specific shape and
# falls inside this explicit support matrix.  A successful process exit alone
# is never sufficient: workflow capabilities consume the typed degraded or
# missing status when the probe cannot prove compatibility.
$script:OptimizationExternalToolSupportMatrix = [ordered]@{
  ffmpeg = [ordered]@{
    matrixId = 'ffmpeg-stable-6-to-8-or-git-2024-to-2026'
    kind = 'ffmpeg'
    outputPattern = '(?im)^\s*ffmpeg\s+version\s+(?<version>\S+)'
  }
  ytDlp = [ordered]@{
    matrixId = 'yt-dlp-calendar-2025-to-2026'
    kind = 'yt-dlp'
    outputPattern = '^\s*(?<version>\d{4}\.\d{2}\.\d{2})\s*$'
  }
  whisperx = [ordered]@{
    matrixId = 'whisperx-semver-3'
    kind = 'whisperx'
    outputPattern = '(?i)^\s*(?:whisperx(?:\s+version)?\s+)?v?(?<version>\d+\.\d+\.\d+)\s*$'
  }
}
$script:OptimizationFrontendEntryArtifactPath = 'dist/index.html'
$script:OptimizationPythonLockArtifactPath = 'tools/subtitle-workflow/requirements-service.lock'

function Get-OptimizationRelativePath {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Path
  )
  return $Path.Substring($Root.Length + 1).Replace('\', '/')
}

function Get-OptimizationFileSha256 {
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

function Write-OptimizationJsonAtomic {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)]$Value
  )
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = "$Path.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
  $backup = "$Path.$PID.$([Guid]::NewGuid().ToString('N')).bak"
  try {
    $encoding = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($temporary, (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine), $encoding)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      [IO.File]::Replace($temporary, $Path, $backup, $true)
    } else {
      [IO.File]::Move($temporary, $Path)
    }
  } finally {
    if (Test-Path -LiteralPath $backup) {
      Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-OptimizationViteConfigPath {
  param([Parameter(Mandatory)][string]$ProjectRoot)
  foreach ($name in @('vite.config.mjs', 'vite.config.js')) {
    $candidate = Join-Path $ProjectRoot $name
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  throw "Optimization Vite config not found under $ProjectRoot (expected vite.config.mjs or vite.config.js)."
}

function Get-OptimizationGitText {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string[]]$Arguments
  )
  try {
    return ((& git -C $ProjectRoot @Arguments 2>$null) -join "`n").Trim()
  } catch {
    return ''
  }
}

function Get-OptimizationSourceFiles {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$WorkflowRoot,
    [Parameter(Mandatory)][string]$RuntimeConfigPath,
    [Parameter(Mandatory)][string]$CapabilityScript,
    [Parameter(Mandatory)][string]$BackupScript,
    [string]$FrontDoorScript = ''
  )
  $files = @(
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'src') -Recurse -File
    Get-ChildItem -LiteralPath $WorkflowRoot -Recurse -File |
      Where-Object { $_.Extension -eq '.py' -and $_.FullName -notmatch '\\tests\\' }
    Get-Item -LiteralPath `
      (Join-Path $ProjectRoot 'index.html'),
      (Join-Path $ProjectRoot 'styles.css'),
      (Get-OptimizationViteConfigPath -ProjectRoot $ProjectRoot),
      (Join-Path $ProjectRoot 'package.json'),
      (Join-Path $ProjectRoot 'package-lock.json'),
      $RuntimeConfigPath,
      $CapabilityScript,
      $BackupScript
  )
  if ($FrontDoorScript -and (Test-Path -LiteralPath $FrontDoorScript -PathType Leaf)) {
    $files += Get-Item -LiteralPath $FrontDoorScript
  }
  $files = @($files | Sort-Object FullName -Unique)
  if ($files.Count -eq 0) { throw 'Optimization release source fingerprint has no inputs.' }
  return $files
}

function ConvertTo-OptimizationProcessArgument {
  param([AllowEmptyString()][string]$Value)
  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }

  # ProcessStartInfo.Arguments is the only argument API available on Windows
  # PowerShell 5.1.  Quote according to CommandLineToArgvW rules so paths with
  # spaces and embedded quotes survive both pwsh and powershell.exe.
  $builder = New-Object Text.StringBuilder
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq [char]92) {
      $backslashes++
      continue
    }
    if ($character -eq [char]34) {
      [void]$builder.Append((('\' * (2 * $backslashes + 1)) -join ''))
      [void]$builder.Append([char]34)
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      [void]$builder.Append(('\' * $backslashes) -join '')
      $backslashes = 0
    }
    [void]$builder.Append($character)
  }
  if ($backslashes -gt 0) { [void]$builder.Append(('\' * (2 * $backslashes)) -join '') }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Invoke-OptimizationProcessCapture {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$ArgumentList,
    [Parameter(Mandatory)][string]$WorkingDirectory,
    [AllowNull()][string]$StandardInput = $null,
    [hashtable]$Environment = @{}
  )
  $captureRoot = Join-Path ([IO.Path]::GetTempPath()) ('read-web-optimization-process-' + [Guid]::NewGuid().ToString('N'))
  $stdoutPath = Join-Path $captureRoot 'stdout.log'
  $stderrPath = Join-Path $captureRoot 'stderr.log'
  New-Item -ItemType Directory -Force -Path $captureRoot | Out-Null
  $process = $null
  try {
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (($ArgumentList | ForEach-Object { ConvertTo-OptimizationProcessArgument -Value ([string]$_) }) -join ' ')
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    foreach ($name in $Environment.Keys) {
      if ($null -eq $Environment[$name]) { $startInfo.EnvironmentVariables.Remove([string]$name) }
      else { $startInfo.EnvironmentVariables[[string]$name] = [string]$Environment[$name] }
    }
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    if ($PSBoundParameters.ContainsKey('StandardInput')) {
      $startInfo.RedirectStandardInput = $true
    }
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Process did not start: $FilePath" }
    if ($PSBoundParameters.ContainsKey('StandardInput')) {
      $process.StandardInput.Write([string]$StandardInput)
      $process.StandardInput.Close()
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = [string]$stdoutTask.Result
    $stderr = [string]$stderrTask.Result
    $exitCode = [int]$process.ExitCode
    return [pscustomobject]@{
      exitCode = [int]$exitCode
      stdout = [string]$stdout
      stderr = [string]$stderr
    }
  } finally {
    if ($null -ne $process) { $process.Dispose() }
    if (Test-Path -LiteralPath $captureRoot) {
      Remove-Item -LiteralPath $captureRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-OptimizationBuild {
  param(
    [Parameter(Mandatory)][string]$NpmPath,
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$DistRoot
  )
  $viteConfigPath = Get-OptimizationViteConfigPath -ProjectRoot $ProjectRoot
  $result = Invoke-OptimizationProcessCapture `
    -FilePath $NpmPath `
    -ArgumentList @('run', 'build', '--', '--config', $viteConfigPath, '--outDir', $DistRoot, '--emptyOutDir') `
    -WorkingDirectory $ProjectRoot
  if ($result.stdout) { Write-Host $result.stdout.TrimEnd() }
  if ($result.stderr) { Write-Host $result.stderr.TrimEnd() }
  if ($result.exitCode -ne 0) {
    throw "Production staging build failed with exit code $($result.exitCode)."
  }
}

function Get-OptimizationCommandVersion {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$Arguments
  )
  try {
    $result = Invoke-OptimizationProcessCapture `
      -FilePath $FilePath `
      -ArgumentList $Arguments `
      -WorkingDirectory (Get-Location).Path
    if ($result.exitCode -ne 0) { return '' }
    return (($result.stdout + "`n" + $result.stderr) -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
  } catch {
    return ''
  }
}

function Get-OptimizationExternalToolPolicy {
  param([Parameter(Mandatory)][string]$Name)
  switch ($Name.ToLowerInvariant()) {
    'ffmpeg' { return $script:OptimizationExternalToolSupportMatrix.ffmpeg }
    'yt-dlp' { return $script:OptimizationExternalToolSupportMatrix.ytDlp }
    'ytdlp' { return $script:OptimizationExternalToolSupportMatrix.ytDlp }
    'whisperx' { return $script:OptimizationExternalToolSupportMatrix.whisperx }
    default { throw "Unsupported optimization external tool: $Name" }
  }
}

function Get-OptimizationExternalToolFirstLine {
  param([AllowNull()][string]$Output)
  if ([string]::IsNullOrWhiteSpace($Output)) { return '' }
  return (($Output -split "`r?`n") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1).Trim()
}

function Test-OptimizationExternalToolIsoDate {
  param([Parameter(Mandatory)][string]$Value)
  try {
    $parsed = [DateTime]::ParseExact($Value, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    return $parsed.ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture) -eq $Value
  } catch {
    return $false
  }
}

function Get-OptimizationExternalToolProbeResult {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][int]$ExitCode,
    [AllowNull()][string]$Output
  )
  $policy = Get-OptimizationExternalToolPolicy -Name $Name
  $firstLine = Get-OptimizationExternalToolFirstLine -Output $Output
  $base = [ordered]@{
    version = $null
    versionLine = if ($firstLine) { $firstLine } else { $null }
    status = 'degraded'
    compatibility = [ordered]@{
      matrix = [string]$policy.matrixId
      status = 'probe-failed'
      supported = $false
      reason = ''
    }
  }
  if ($ExitCode -ne 0) {
    $base.compatibility.reason = "probe-exit-code-$ExitCode"
    return [pscustomobject]$base
  }
  if (-not $firstLine) {
    $base.compatibility.status = 'invalid-output'
    $base.compatibility.reason = 'probe-returned-no-version-banner'
    return [pscustomobject]$base
  }
  $match = [regex]::Match($firstLine, [string]$policy.outputPattern)
  if (-not $match.Success) {
    $base.compatibility.status = 'invalid-output'
    $base.compatibility.reason = "probe-output-does-not-match-$($policy.kind)-banner"
    return [pscustomobject]$base
  }
  $version = [string]$match.Groups['version'].Value
  $base.version = if ($version) { $version } else { $null }
  $supported = $false
  $reason = ''
  switch ([string]$policy.kind) {
    'ffmpeg' {
      $stable = [regex]::Match($version, '^(?<major>\d+)\.\d+(?:\.\d+)?(?:[-+].*)?$')
      if ($stable.Success) {
        $major = [int]$stable.Groups['major'].Value
        $supported = $major -ge 6 -and $major -le 8
        $reason = if ($supported) { 'supported-stable-major' } else { 'version-outside-ffmpeg-stable-major-6-to-8' }
      } else {
        $dateMatch = [regex]::Match($version, '^(?<date>20\d\d-\d\d-\d\d)(?:-|$)')
        if ($dateMatch.Success -and (Test-OptimizationExternalToolIsoDate -Value $dateMatch.Groups['date'].Value)) {
          $date = [DateTime]::ParseExact($dateMatch.Groups['date'].Value, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
          $supported = $date.Year -ge 2024 -and $date.Year -le 2026
          $reason = if ($supported) { 'supported-dated-git-build-2024-to-2026' } else { 'version-outside-ffmpeg-dated-build-2024-to-2026' }
        } else {
          $reason = 'ffmpeg-version-token-is-not-stable-or-dated-git-build'
        }
      }
    }
    'yt-dlp' {
      $dateMatch = [regex]::Match($version, '^(?<date>\d{4}\.\d{2}\.\d{2})$')
      if ($dateMatch.Success) {
        try {
          $date = [DateTime]::ParseExact($dateMatch.Groups['date'].Value, 'yyyy.MM.dd', [Globalization.CultureInfo]::InvariantCulture)
          $supported = $date.Year -ge 2025 -and $date.Year -le 2026
        } catch { $supported = $false }
      }
      $reason = if ($supported) { 'supported-calendar-release-2025-to-2026' } else { 'version-outside-yt-dlp-calendar-2025-to-2026' }
    }
    'whisperx' {
      $semver = [regex]::Match($version, '^(?<major>\d+)\.\d+\.\d+$')
      if ($semver.Success) { $supported = [int]$semver.Groups['major'].Value -eq 3 }
      $reason = if ($supported) { 'supported-whisperx-major-3' } else { 'version-outside-whisperx-major-3' }
    }
  }
  if ($supported) {
    $base.status = 'verified'
    $base.compatibility.status = 'supported'
    $base.compatibility.supported = $true
    $base.compatibility.reason = $reason
  } else {
    $base.compatibility.status = 'unsupported-version'
    $base.compatibility.reason = if ($reason) { $reason } else { 'version-is-not-supported' }
  }
  return [pscustomobject]$base
}

function Get-OptimizationExternalToolDescriptor {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string[]]$VersionArguments,
    [bool]$Required = $false,
    [string]$ExecutablePath = ''
  )
  $requested = if ($ExecutablePath) { $ExecutablePath } else { $Name }
  $policy = Get-OptimizationExternalToolPolicy -Name $Name
  $verification = "probe=$($VersionArguments -join ' '); outputPattern=$($policy.outputPattern); supportMatrix=$($policy.matrixId); sha256=resolved-executable"
  $command = $null
  $resolvedCommandPath = ''
  if ($ExecutablePath -and (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
    $resolvedCommandPath = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction SilentlyContinue).Path
  } else {
    $command = Get-Command $requested -ErrorAction SilentlyContinue
    if ($null -ne $command) { $resolvedCommandPath = [string]$command.Source }
  }
  if (-not $resolvedCommandPath) {
    return [ordered]@{
      executable = $requested
      version = $null
      source = if ($ExecutablePath) { 'configured-path' } else { 'PATH' }
      versionLine = $null
      sha256 = $null
      verification = $verification
      supportMatrix = [string]$policy.matrixId
      compatibility = [ordered]@{
        matrix = [string]$policy.matrixId
        status = 'missing'
        supported = $false
        reason = 'executable-not-found'
      }
      required = $Required
      status = 'missing'
    }
  }
  $probe = $null
  try {
    $probeProcess = Invoke-OptimizationProcessCapture `
      -FilePath $resolvedCommandPath `
      -ArgumentList $VersionArguments `
      -WorkingDirectory (Split-Path -Parent $resolvedCommandPath)
    $probe = Get-OptimizationExternalToolProbeResult `
      -Name $Name `
      -ExitCode ([int]$probeProcess.exitCode) `
      -Output (($probeProcess.stdout + "`n" + $probeProcess.stderr).Trim())
  } catch {
    $probe = Get-OptimizationExternalToolProbeResult -Name $Name -ExitCode 1 -Output $_.Exception.Message
  }
  $binaryHash = $null
  try { $binaryHash = Get-OptimizationFileSha256 -Path $resolvedCommandPath } catch {}
  return [ordered]@{
    executable = $resolvedCommandPath
    version = $probe.version
    versionLine = $probe.versionLine
    sha256 = $binaryHash
    source = $resolvedCommandPath
    verification = $verification
    supportMatrix = [string]$policy.matrixId
    compatibility = $probe.compatibility
    required = $Required
    status = $probe.status
  }
}

function Get-OptimizationCommandPath {
  param(
    [Parameter(Mandatory)][string]$Name,
    [string]$RequestedPath = ''
  )
  $requested = if ($RequestedPath) { $RequestedPath } else { $Name }
  if (Test-Path -LiteralPath $requested -PathType Leaf) {
    return (Resolve-Path -LiteralPath $requested).Path
  }
  $command = Get-Command $requested -ErrorAction SilentlyContinue
  if ($null -eq $command) { return '' }
  return [string]$command.Source
}

function Get-OptimizationDefaultPythonPath {
  # Keep this convention in sync with scripts/lib/python-runtime.mjs. The
  # launcher only discovers an existing venv here; it never installs one.
  $localAppData = [string]$env:LOCALAPPDATA
  if ([string]::IsNullOrWhiteSpace($localAppData)) {
    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  }
  if ([string]::IsNullOrWhiteSpace($localAppData)) { return '' }
  return Join-Path $localAppData 'Read-Web\optimization-python\Scripts\python.exe'
}

function Resolve-OptimizationSelectedPython {
  param(
    [Parameter(Mandatory)][string]$RuntimeConfigPath,
    [string]$RequestedPath = ''
  )
  if ($RequestedPath) {
    $resolvedRequested = Get-OptimizationCommandPath -Name 'python' -RequestedPath $RequestedPath
    if (-not $resolvedRequested) { throw "Optimization RuntimeConfig Python executable was not found: $RequestedPath" }
    return $resolvedRequested
  }
  if (-not (Test-Path -LiteralPath $RuntimeConfigPath -PathType Leaf)) {
    throw "Optimization RuntimeConfig file is missing: $RuntimeConfigPath"
  }
  try {
    $payload = Get-Content -LiteralPath $RuntimeConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Optimization RuntimeConfig file is invalid: $RuntimeConfigPath"
  }
  $defaultVenv = Get-OptimizationDefaultPythonPath
  $configured = if ($env:READ_WEB_PYTHON) {
    [string]$env:READ_WEB_PYTHON
  } elseif ($env:READ_WEB_PYTHON_PATH) {
    [string]$env:READ_WEB_PYTHON_PATH
  } elseif ($defaultVenv -and (Test-Path -LiteralPath $defaultVenv -PathType Leaf)) {
    $defaultVenv
  } elseif ($null -ne $payload.python -and $payload.python.executable) {
    [string]$payload.python.executable
  } else {
    'python'
  }
  if (-not [IO.Path]::IsPathRooted($configured)) {
    $configCandidate = Join-Path (Split-Path -Parent $RuntimeConfigPath) $configured
    if (Test-Path -LiteralPath $configCandidate -PathType Leaf) { $configured = $configCandidate }
  }
  $resolved = Get-OptimizationCommandPath -Name 'python' -RequestedPath $configured
  if (-not $resolved) { throw "Optimization RuntimeConfig Python executable was not found: $configured" }
  return $resolved
}

function Get-OptimizationToolchainIdentity {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$WorkflowRoot,
    [string]$RuntimeConfigPath = '',
    [string]$NodePath = '',
    [string]$NpmPath = '',
    [string]$PythonPath = '',
    [AllowNull()][object]$PythonHealth = $null,
    [string]$FfmpegPath = '',
    [string]$YtDlpPath = '',
    [string]$WhisperxPath = ''
  )
  $nodeExecutable = Get-OptimizationCommandPath -Name 'node' -RequestedPath $NodePath
  $npmExecutable = Get-OptimizationCommandPath -Name 'npm.cmd' -RequestedPath $NpmPath
  if (-not $npmExecutable -and -not $NpmPath) {
    $npmExecutable = Get-OptimizationCommandPath -Name 'npm'
  }
  $pythonExecutable = if ($RuntimeConfigPath) {
    Resolve-OptimizationSelectedPython -RuntimeConfigPath $RuntimeConfigPath -RequestedPath $PythonPath
  } else {
    Get-OptimizationCommandPath -Name 'python' -RequestedPath $PythonPath
  }
  $packagePath = Join-Path $ProjectRoot 'package.json'
  $package = $null
  if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
    try { $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
  }
  $pythonLockPath = Join-Path $WorkflowRoot 'requirements-service.lock'
  $pythonPolicy = ''
  if (Test-Path -LiteralPath $pythonLockPath -PathType Leaf) {
    $pythonPolicy = @(Get-Content -LiteralPath $pythonLockPath -Encoding UTF8 | Where-Object { $_ -match 'CPython\s+([0-9]+\.[0-9]+)' } | Select-Object -First 1) -join ''
  }
  $nodeVersion = if ($nodeExecutable) { Get-OptimizationCommandVersion -FilePath $nodeExecutable -Arguments @('--version') } else { '' }
  $npmVersion = if ($npmExecutable) { Get-OptimizationCommandVersion -FilePath $npmExecutable -Arguments @('--version') } else { '' }
  $pythonVersion = if ($pythonExecutable) { Get-OptimizationCommandVersion -FilePath $pythonExecutable -Arguments @('--version') } else { '' }
  $node = [ordered]@{ executable = $nodeExecutable; version = if ($nodeVersion) { $nodeVersion } else { $null }; status = if ($nodeVersion) { 'verified' } else { 'missing' } }
  $npm = [ordered]@{ executable = $npmExecutable; version = if ($npmVersion) { $npmVersion } else { $null }; status = if ($npmVersion) { 'verified' } else { 'missing' } }
  $python = [ordered]@{
    executable = $pythonExecutable
    version = if ($pythonVersion) { $pythonVersion } else { $null }
    status = if ($pythonVersion) { 'verified' } else { 'missing' }
    packageSetSha256 = if ($null -ne $PythonHealth) { [string]$PythonHealth.python.packageSetSha256 } else { $null }
    environmentSha256 = if ($null -ne $PythonHealth) { [string]$PythonHealth.python.environmentSha256 } else { $null }
    healthStatus = if ($null -ne $PythonHealth) { [string]$PythonHealth.status } else { 'unverified' }
  }
  $externalTools = [ordered]@{
    ffmpeg = Get-OptimizationExternalToolDescriptor -Name 'ffmpeg' -VersionArguments @('-version') -ExecutablePath $FfmpegPath
    ytDlp = Get-OptimizationExternalToolDescriptor -Name 'yt-dlp' -VersionArguments @('--version') -ExecutablePath $YtDlpPath
    whisperx = Get-OptimizationExternalToolDescriptor -Name 'whisperx' -VersionArguments @('--version') -ExecutablePath $WhisperxPath
  }
  $policy = [ordered]@{
    node = if ($null -ne $package) { [string]$package.engines.node } else { '' }
    npm = if ($null -ne $package) { [string]$package.engines.npm } else { '' }
    packageManager = if ($null -ne $package) { [string]$package.packageManager } else { '' }
    python = $pythonPolicy
  }
  $identity = [ordered]@{
    node = $node
    npm = $npm
    python = $python
    externalTools = $externalTools
    policy = $policy
  }
  $serialized = $identity | ConvertTo-Json -Depth 20 -Compress
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $digest = ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($serialized))) -replace '-', '').ToLowerInvariant()
  } finally { $algorithm.Dispose() }
  return [pscustomobject]@{
    node = $node
    npm = $npm
    python = $python
    externalTools = $externalTools
    policy = $policy
    sha256 = $digest
  }
}

function Assert-OptimizationExternalToolCompatibility {
  param([Parameter(Mandatory)]$Toolchain)
  foreach ($entry in @(
      @{ name = 'ffmpeg'; descriptor = $Toolchain.externalTools.ffmpeg },
      @{ name = 'yt-dlp'; descriptor = $Toolchain.externalTools.ytDlp },
      @{ name = 'whisperx'; descriptor = $Toolchain.externalTools.whisperx }
    )) {
    $descriptor = $entry.descriptor
    if ($null -eq $descriptor) { throw "Optimization release external tool descriptor is missing: $($entry.name)" }
    if ([string]$descriptor.status -eq 'missing') { continue }
    if ([string]$descriptor.status -ne 'verified' -or [string]$descriptor.compatibility.status -ne 'supported' -or -not [bool]$descriptor.compatibility.supported) {
      throw "Optimization release external tool is incompatible; related capability is fail-closed: $($entry.name) ($($descriptor.compatibility.status): $($descriptor.compatibility.reason))"
    }
  }
}

function Get-OptimizationVersionToken {
  param([AllowNull()][string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  $match = [regex]::Match($Value, '(?<![0-9])([0-9]+\.[0-9]+\.[0-9]+)(?![0-9])')
  if (-not $match.Success) { return '' }
  return $match.Groups[1].Value
}

function Invoke-OptimizationPythonDependencyHealth {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$WorkflowRoot,
    [Parameter(Mandatory)][string]$RuntimeConfigPath,
    [Parameter(Mandatory)][string]$PythonPath
  )
  $healthScript = Join-Path $ProjectRoot 'tools\subtitle-workflow\scripts\verify_python_dependency_health.py'
  $lockPath = Join-Path $WorkflowRoot 'requirements-service.lock'
  if (-not (Test-Path -LiteralPath $healthScript -PathType Leaf)) {
    throw "Optimization Python dependency health script is missing: $healthScript"
  }
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    throw "Optimization Python production lock is missing: $lockPath"
  }
  $process = Invoke-OptimizationProcessCapture `
    -FilePath $PythonPath `
    -ArgumentList @($healthScript, '--config', $RuntimeConfigPath, '--expected-executable', $PythonPath, '--lock', $lockPath, '--json') `
    -WorkingDirectory $ProjectRoot `
    -Environment @{ READ_WEB_PYTHON = $PythonPath; READ_WEB_PYTHON_PATH = $PythonPath; READ_WEB_RUNTIME_CONFIG = $RuntimeConfigPath }
  $details = ($process.stderr + "`n" + $process.stdout).Trim()
  if ($process.exitCode -ne 0) {
    $defaultVenv = Get-OptimizationDefaultPythonPath
    $hint = if ($defaultVenv) {
      "Use the repository-external optimization venv at $defaultVenv, or set READ_WEB_PYTHON / pass -BootstrapPython."
    } else {
      'Use a repository-external CPython 3.10 venv and set READ_WEB_PYTHON or pass -BootstrapPython.'
    }
    throw "Optimization Python dependency health blocked the release before BuildAction: exit $($process.exitCode); selected=$PythonPath; $details $hint"
  }
  try { $report = $process.stdout | ConvertFrom-Json } catch { throw "Optimization Python dependency health returned invalid JSON: $details" }
  if ([string]$report.status -ne 'passed') {
    throw "Optimization Python dependency health did not pass: $details"
  }
  return $report
}

function Assert-OptimizationReleaseToolchain {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$WorkflowRoot,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$NpmPath,
    [string]$PythonPath = '',
    [string]$RuntimeConfigPath = ''
  )
  $packagePath = Join-Path $ProjectRoot 'package.json'
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "Optimization release package.json is missing: $packagePath" }
  try { $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { throw "Optimization release package.json is invalid: $packagePath" }
  $expectedNode = [string]$package.engines.node
  $expectedNpm = [string]$package.engines.npm
  if ($expectedNode -notmatch '^\d+\.\d+\.\d+$' -or $expectedNpm -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Optimization release requires exact semantic package engines for Node and npm.'
  }
  $packageManager = [string]$package.packageManager
  $packageManagerMatch = [regex]::Match($packageManager, '^npm@(\d+\.\d+\.\d+)$')
  if (-not $packageManagerMatch.Success -or $packageManagerMatch.Groups[1].Value -ne $expectedNpm) {
    throw 'Optimization release packageManager must be npm@<exact engines.npm>.'
  }
  $nodeVersion = Get-OptimizationCommandVersion -FilePath $NodePath -Arguments @('--version')
  $npmVersion = Get-OptimizationCommandVersion -FilePath $NpmPath -Arguments @('--version')
  if ($RuntimeConfigPath) {
    $pythonExecutable = Resolve-OptimizationSelectedPython -RuntimeConfigPath $RuntimeConfigPath -RequestedPath $PythonPath
  } else {
    $pythonExecutable = Get-OptimizationCommandPath -Name 'python' -RequestedPath $PythonPath
  }
  $pythonVersion = if ($pythonExecutable) { Get-OptimizationCommandVersion -FilePath $pythonExecutable -Arguments @('--version') } else { '' }
  $nodeToken = Get-OptimizationVersionToken -Value $nodeVersion
  $npmToken = Get-OptimizationVersionToken -Value $npmVersion
  $pythonToken = Get-OptimizationVersionToken -Value $pythonVersion
  if (-not $nodeToken) { throw "Optimization release Node executable is missing or did not return a version: $NodePath" }
  if (-not $npmToken) { throw "Optimization release npm executable is missing or did not return a version: $NpmPath" }
  if (-not $pythonToken) { throw "Optimization release Python executable is missing or did not return a version: $pythonExecutable" }
  if ($nodeToken -ne $expectedNode) { throw "Unsupported Node version for optimization release: $nodeToken; expected $expectedNode." }
  if ($npmToken -ne $expectedNpm) { throw "Unsupported npm version for optimization release: $npmToken; expected $expectedNpm." }
  $pythonLockPath = Join-Path $WorkflowRoot 'requirements-service.lock'
  if (-not (Test-Path -LiteralPath $pythonLockPath -PathType Leaf)) { throw "Optimization release Python lock is missing: $pythonLockPath" }
  $pythonLockText = Get-Content -LiteralPath $pythonLockPath -Raw -Encoding UTF8
  $pythonPolicyMatch = [regex]::Match($pythonLockText, '(?im)CPython\s+([0-9]+\.[0-9]+)')
  if (-not $pythonPolicyMatch.Success) { throw "Optimization release Python lock does not declare a supported CPython version: $pythonLockPath" }
  $pythonPolicy = $pythonPolicyMatch.Groups[1].Value
  if (-not $pythonToken.StartsWith("$pythonPolicy.", [StringComparison]::Ordinal)) {
    throw "Unsupported Python version for optimization release: $pythonToken; expected CPython $pythonPolicy.x."
  }
  $pythonHealth = $null
  if ($RuntimeConfigPath) {
    $pythonHealth = Invoke-OptimizationPythonDependencyHealth `
      -ProjectRoot $ProjectRoot `
      -WorkflowRoot $WorkflowRoot `
      -RuntimeConfigPath $RuntimeConfigPath `
      -PythonPath $pythonExecutable
  }
  return [pscustomobject]@{
    node = $nodeVersion
    npm = $npmVersion
    python = $pythonVersion
    nodeToken = $nodeToken
    npmToken = $npmToken
    pythonToken = $pythonToken
    pythonPolicy = $pythonPolicy
    nodePath = $NodePath
    npmPath = $NpmPath
    pythonPath = $pythonExecutable
    pythonHealth = $pythonHealth
  }
}

function Get-OptimizationReleaseReuseKey {
  param([Parameter(Mandatory)]$Release)
  try {
    $manifest = $Release.manifest
    if ($null -eq $manifest) { return '' }
    $runtime = $manifest.runtime
    $toolchainSha = [string]$runtime.toolchainSha256
    if ($toolchainSha -notmatch '^[0-9a-f]{64}$') { return '' }
    $identity = [ordered]@{
      release = [ordered]@{
        releaseId = [string]$manifest.release.releaseId
        formatVersion = [int]$manifest.release.formatVersion
        application = [string]$manifest.release.application
        frontendVersion = [string]$manifest.release.frontendVersion
        productionHostVersion = [string]$manifest.release.productionHostVersion
        backendVersion = [string]$manifest.release.backendVersion
      }
      runtime = [ordered]@{
        node = [string]$runtime.node
        npm = [string]$runtime.npm
        python = [string]$runtime.python
        pythonIdentity = $runtime.pythonIdentity
        dataRoot = [string]$runtime.dataRoot
        sourceSha256 = [string]$runtime.sourceSha256
        distSha256 = [string]$runtime.distSha256
        toolchainSha256 = $toolchainSha
      }
      dependencyLocks = $manifest.dependencyLocks
      externalTools = $manifest.externalTools
      configuration = $manifest.configuration
      dataCompatibility = $manifest.dataCompatibility
      compatibility = $manifest.compatibility
    }
    $serialized = $identity | ConvertTo-Json -Depth 30 -Compress
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($serialized))) -replace '-', '').ToLowerInvariant()
    } finally { $algorithm.Dispose() }
  } catch {
    return ''
  }
}

function Get-OptimizationLockSummary {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$ProjectRoot,
    [string]$Kind = 'text',
    [string]$ArtifactPath = ''
  )
  $relative = if ($ArtifactPath) {
    $ArtifactPath.Replace('\', '/')
  } else {
    Get-OptimizationRelativePath -Root ((Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\', '/')) -Path ((Resolve-Path -LiteralPath $Path).Path)
  }
  $summary = [ordered]@{
    path = $relative
    sha256 = Get-OptimizationFileSha256 -Path $Path
    kind = $Kind
    status = 'verified'
  }
  if ($Kind -eq 'npm') {
    try { $summary.lockfileVersion = [int]((Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json).lockfileVersion) } catch { $summary.lockfileVersion = $null }
  } else {
    $summary.requireHashLines = @(Get-Content -LiteralPath $Path -Encoding UTF8 | Where-Object { $_ -match '--hash=sha256:' }).Count
  }
  return $summary
}

function Get-OptimizationSourceFingerprint {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$WorkflowRoot,
    [Parameter(Mandatory)][string]$RuntimeConfigPath,
    [Parameter(Mandatory)][string]$CapabilityScript,
    [Parameter(Mandatory)][string]$BackupScript,
    [string]$FrontDoorScript = '',
    [string]$NodePath = '',
    [string]$NpmPath = '',
    [string]$PythonPath = '',
    [AllowNull()][object]$PythonHealth = $null,
    [string]$FfmpegPath = '',
    [string]$YtDlpPath = '',
    [string]$WhisperxPath = ''
  )
  $files = Get-OptimizationSourceFiles `
    -ProjectRoot $ProjectRoot `
    -WorkflowRoot $WorkflowRoot `
    -RuntimeConfigPath $RuntimeConfigPath `
    -CapabilityScript $CapabilityScript `
    -BackupScript $BackupScript `
    -FrontDoorScript $FrontDoorScript
  $root = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\', '/')
  $sourceLines = @($files | ForEach-Object {
    $relative = Get-OptimizationRelativePath -Root $root -Path $_.FullName
    $hash = Get-OptimizationFileSha256 -Path $_.FullName
    "${relative}:$hash"
  })
  # The Python service lock is intentionally outside the source-file glob
  # above (it is not a .py source file), but it is a release input.  Keep a
  # missing marker in the fingerprint as well so a later lock appearance can
  # never reuse a release made without it.
  $pythonLockPath = Join-Path $WorkflowRoot 'requirements-service.lock'
  $pythonLockKey = if (Test-Path -LiteralPath $pythonLockPath -PathType Leaf) {
    $lockName = $pythonLockPath.Replace('\', '/')
    try {
      $resolvedLock = (Resolve-Path -LiteralPath $pythonLockPath).Path
      if ($resolvedLock.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) {
        $lockName = Get-OptimizationRelativePath -Root $root -Path $resolvedLock
      } else { $lockName = $resolvedLock.Replace('\', '/') }
    } catch {}
    "${lockName}:$(Get-OptimizationFileSha256 -Path $pythonLockPath)"
  } else {
    "requirements-service.lock:missing"
  }
  $selectedPython = if ($RuntimeConfigPath) {
    Resolve-OptimizationSelectedPython -RuntimeConfigPath $RuntimeConfigPath -RequestedPath $PythonPath
  } else {
    Get-OptimizationCommandPath -Name 'python' -RequestedPath $PythonPath
  }
  if ($null -eq $PythonHealth) {
    $PythonHealth = Invoke-OptimizationPythonDependencyHealth `
      -ProjectRoot $ProjectRoot `
      -WorkflowRoot $WorkflowRoot `
      -RuntimeConfigPath $RuntimeConfigPath `
      -PythonPath $selectedPython
  }
  $toolchain = Get-OptimizationToolchainIdentity `
    -ProjectRoot $ProjectRoot `
    -WorkflowRoot $WorkflowRoot `
    -RuntimeConfigPath $RuntimeConfigPath `
    -NodePath $NodePath `
    -NpmPath $NpmPath `
    -PythonPath $selectedPython `
    -PythonHealth $PythonHealth `
    -FfmpegPath $FfmpegPath `
    -YtDlpPath $YtDlpPath `
    -WhisperxPath $WhisperxPath
  $input = (($sourceLines + @($pythonLockKey, "toolchain:$($toolchain.sha256)")) -join "`n")
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $digest = ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($input))) -replace '-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
  return [pscustomobject]@{
    sha256 = $digest
    fileCount = $files.Count
    toolchainSha256 = [string]$toolchain.sha256
    toolchain = $toolchain
  }
}

function Get-OptimizationDistArtifacts {
  param(
    [Parameter(Mandatory)][string]$ReleaseRoot,
    [Parameter(Mandatory)][string]$DistRoot
  )
  $root = (Resolve-Path -LiteralPath $ReleaseRoot).Path.TrimEnd('\', '/')
  $files = @(Get-ChildItem -LiteralPath $DistRoot -Recurse -File | Sort-Object FullName)
  if ($files.Count -eq 0) { throw "Built staging dist is empty: $DistRoot" }
  return @($files | ForEach-Object {
    $relative = Get-OptimizationRelativePath -Root $root -Path $_.FullName
    $hash = Get-OptimizationFileSha256 -Path $_.FullName
    [ordered]@{ path = $relative; bytes = [int64]$_.Length; sha256 = $hash }
  })
}

function Get-OptimizationDigest {
  param([Parameter(Mandatory)][object[]]$Artifacts)
  $input = (($Artifacts | ForEach-Object { "$($_.path):$($_.sha256)" }) -join "`n")
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($input))) -replace '-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Invoke-OptimizationManifestHealth {
  param(
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$ReleaseHealthScript,
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$ReleaseRoot
  )
  $process = Invoke-OptimizationProcessCapture `
    -FilePath $NodePath `
    -ArgumentList @($ReleaseHealthScript, '--manifest', $ManifestPath, '--root', $ReleaseRoot) `
    -WorkingDirectory (Split-Path -Parent $ReleaseHealthScript)
  if ($process.exitCode -ne 0) {
    $details = ($process.stderr + $process.stdout).Trim()
    throw "Release manifest validation failed with exit code $($process.exitCode). $details"
  }
  $result = $process.stdout | ConvertFrom-Json
  if ([string]$result.status -ne 'passed') {
    throw 'Release manifest validation did not pass.'
  }
  return $result
}

function Invoke-OptimizationManifestSchemaHealth {
  param(
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$ReleaseHealthScript,
    [Parameter(Mandatory)]$Manifest
  )
  $manifestJson = $Manifest | ConvertTo-Json -Depth 30 -Compress
  $process = Invoke-OptimizationProcessCapture `
    -FilePath $NodePath `
    -ArgumentList @($ReleaseHealthScript, '--stdin') `
    -WorkingDirectory (Split-Path -Parent $ReleaseHealthScript) `
    -StandardInput $manifestJson
  if ($process.exitCode -ne 0) {
    $details = ($process.stderr + $process.stdout).Trim()
    throw "Release manifest schema validation failed before write with exit code $($process.exitCode). $details"
  }
  try { $result = $process.stdout | ConvertFrom-Json } catch { throw 'Release manifest schema verifier returned invalid JSON.' }
  if ([string]$result.status -ne 'passed') {
    throw 'Release manifest schema validation did not pass before write.'
  }
  return $result
}

function Get-OptimizationReleaseDescriptor {
  param([Parameter(Mandatory)][string]$ReleaseRoot)
  $resolvedRoot = (Resolve-Path -LiteralPath $ReleaseRoot).Path.TrimEnd('\', '/')
  $manifestPath = Join-Path $resolvedRoot 'release-manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $manifestHash = Get-OptimizationFileSha256 -Path $manifestPath
  return [pscustomobject]@{
    releaseId = [string]$manifest.release.releaseId
    releaseRoot = $resolvedRoot
    distRoot = Join-Path $resolvedRoot 'dist'
    manifestPath = $manifestPath
    manifestSha256 = $manifestHash
    sourceSha256 = [string]$manifest.runtime.sourceSha256
    distSha256 = [string]$manifest.runtime.distSha256
    toolchainSha256 = [string]$manifest.runtime.toolchainSha256
    manifest = $manifest
  }
}

function Test-OptimizationReleaseCompatibility {
  param([Parameter(Mandatory)]$Release)
  try {
    $indexedDb = $Release.manifest.dataCompatibility.indexedDb
    $runtime = $Release.manifest.runtime
    $locks = $Release.manifest.dependencyLocks
    $tools = $Release.manifest.externalTools
    $configuration = $Release.manifest.configuration
    $compatibility = $Release.manifest.compatibility
    $source = $Release.manifest.source
    $pythonIdentity = $runtime.pythonIdentity
    $manifestRoot = [IO.Path]::GetFullPath([string]$Release.manifest.release.root).TrimEnd('\', '/')
    $descriptorRoot = [IO.Path]::GetFullPath([string]$Release.releaseRoot).TrimEnd('\', '/')
    $artifactPaths = @($Release.manifest.artifacts | ForEach-Object { [string]$_.path.Replace('\', '/') })
    $externalToolDescriptors = @($tools.ffmpeg, $tools.ytDlp, $tools.whisperx)
    if ($externalToolDescriptors.Count -ne 3) { return $false }
    foreach ($tool in $externalToolDescriptors) {
      if ($null -eq $tool) { return $false }
      if ([string]$tool.status -notin @('verified', 'missing', 'degraded')) { return $false }
      if ([string]$tool.supportMatrix -ne [string]$tool.compatibility.matrix) { return $false }
      if ([string]::IsNullOrWhiteSpace([string]$tool.supportMatrix)) { return $false }
      if ([string]$tool.compatibility.status -notin @('supported', 'missing', 'unsupported-version', 'invalid-output', 'probe-failed')) { return $false }
      if ([string]::IsNullOrWhiteSpace([string]$tool.compatibility.reason)) { return $false }
      if ([string]$tool.status -eq 'verified' -and ([string]$tool.compatibility.status -ne 'supported' -or -not [bool]$tool.compatibility.supported)) { return $false }
      if ([string]$tool.compatibility.status -eq 'supported' -and [string]$tool.status -ne 'verified') { return $false }
      if ([string]$tool.status -eq 'missing' -and [string]$tool.compatibility.status -ne 'missing') { return $false }
      if ([string]$tool.status -eq 'degraded' -and [string]$tool.compatibility.status -eq 'supported') { return $false }
      if ($null -ne $tool.sha256 -and [string]$tool.sha256 -notmatch '^[0-9a-f]{64}$') { return $false }
    }
    return $null -ne $source `
      -and ($source.PSObject.Properties.Name -contains 'readOnly') `
      -and (([string]$source.kind -eq 'immutable-release' -and [bool]$source.readOnly) -or ([string]$source.kind -eq 'working-tree' -and -not [bool]$source.readOnly -and [string]$Release.manifest.role -eq 'optimization-local')) `
      -and [string]$pythonIdentity.status -eq 'verified' `
      -and [string]$pythonIdentity.executable `
      -and [string]$pythonIdentity.version `
      -and [string]$pythonIdentity.packageSetSha256 -match '^[0-9a-f]{64}$' `
      -and [string]$pythonIdentity.environmentSha256 -match '^[0-9a-f]{64}$' `
      -and [string]$locks.node.status -eq 'verified' `
      -and [string]$locks.python.status -eq 'verified' `
      -and [int]$Release.manifest.release.formatVersion -eq 2 `
      -and $manifestRoot -ieq $descriptorRoot `
      -and -not [string]::IsNullOrWhiteSpace([string]$runtime.node) `
      -and -not [string]::IsNullOrWhiteSpace([string]$runtime.npm) `
      -and -not [string]::IsNullOrWhiteSpace([string]$runtime.python) `
      -and [string]$runtime.toolchainSha256 -match '^[0-9a-f]{64}$' `
      -and -not [string]::IsNullOrWhiteSpace([string]$locks.node.sha256) `
      -and -not [string]::IsNullOrWhiteSpace([string]$locks.python.sha256) `
      -and [string]$locks.node.path -eq 'package-lock.json' `
      -and [string]$locks.python.path -eq $script:OptimizationPythonLockArtifactPath `
      -and $artifactPaths -contains $script:OptimizationFrontendEntryArtifactPath `
      -and $artifactPaths -contains 'package-lock.json' `
      -and $artifactPaths -contains $script:OptimizationPythonLockArtifactPath `
      -and [int]$configuration.schemaVersion -eq 1 `
      -and [int]$configuration.minimumCompatible -le 1 `
      -and [int]$configuration.maximumCompatible -ge 1 `
      -and $null -ne $compatibility.migration `
      -and $null -ne $compatibility.rollback `
      -and [bool]$compatibility.rollback.compatible `
      -and [string]$indexedDb.name -eq 'SeekPlayerDB' `
      -and [int]$indexedDb.version -eq 1 `
      -and [string]$indexedDb.objectStore -eq 'files' `
      -and [string]$indexedDb.keyPath -eq 'id' `
      -and $null -ne $Release.manifest.dataCompatibility.migration `
      -and $null -ne $Release.manifest.dataCompatibility.rollback
  } catch {
    return $false
  }
}

function Test-OptimizationReleaseIntegrity {
  param(
    [Parameter(Mandatory)]$Release,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$ReleaseHealthScript
  )
  try {
    $result = Invoke-OptimizationManifestHealth `
      -NodePath $NodePath `
      -ReleaseHealthScript $ReleaseHealthScript `
      -ManifestPath $Release.manifestPath `
      -ReleaseRoot $Release.releaseRoot
    return [pscustomobject]@{ passed = $true; manifestSha256 = [string]$result.manifestSha256; failures = @() }
  } catch {
    return [pscustomobject]@{ passed = $false; manifestSha256 = ''; failures = @($_.Exception.Message) }
  }
}

function New-OptimizationReleaseStaging {
  param(
    [Parameter(Mandatory)][string]$ProjectRoot,
    [Parameter(Mandatory)][string]$WorkflowRoot,
    [Parameter(Mandatory)][string]$RuntimeConfigPath,
    [Parameter(Mandatory)][string]$CapabilityScript,
    [Parameter(Mandatory)][string]$BackupScript,
    [string]$FrontDoorScript = '',
    [Parameter(Mandatory)][string]$StagingRoot,
    [Parameter(Mandatory)][string]$ReleaseRoot,
    [Parameter(Mandatory)][string]$NpmPath,
    [Parameter(Mandatory)][string]$NodePath,
    [string]$PythonPath = '',
    [string]$FfmpegPath = '',
    [string]$YtDlpPath = '',
    [string]$WhisperxPath = '',
    [Parameter(Mandatory)][string]$ReleaseHealthScript,
    [Parameter(Mandatory)][string]$ProfileId,
    [Parameter(Mandatory)][string]$FrontendHost,
    [Parameter(Mandatory)][int]$FrontendPort,
    [Parameter(Mandatory)][string]$BackendHost,
    [Parameter(Mandatory)][int]$BackendPort,
    [Parameter(Mandatory)][string]$DataRoot,
    [scriptblock]$BuildAction = $null,
    [scriptblock]$ManifestTransform = $null,
    [switch]$RequireClean
  )
  $stageRoot = Join-Path $StagingRoot ('stage-' + [Guid]::NewGuid().ToString('N'))
  $stagingDist = Join-Path $stageRoot 'dist'
  $manifestPath = Join-Path $stageRoot 'release-manifest.json'
  try {
    $gitStatus = Get-OptimizationGitText -ProjectRoot $ProjectRoot -Arguments @('status', '--porcelain', '--untracked-files=all')
    if ($RequireClean -and $gitStatus) {
      throw "Optimization release candidate requires a clean Git worktree; refusing to build dirty or untracked sources: $gitStatus"
    }

    $toolchainCheck = Assert-OptimizationReleaseToolchain `
      -ProjectRoot $ProjectRoot `
      -WorkflowRoot $WorkflowRoot `
      -NodePath $NodePath `
      -NpmPath $NpmPath `
      -PythonPath $PythonPath `
      -RuntimeConfigPath $RuntimeConfigPath
    $sourceBefore = Get-OptimizationSourceFingerprint `
      -ProjectRoot $ProjectRoot `
      -WorkflowRoot $WorkflowRoot `
      -RuntimeConfigPath $RuntimeConfigPath `
      -CapabilityScript $CapabilityScript `
      -BackupScript $BackupScript `
      -FrontDoorScript $FrontDoorScript `
      -NodePath $NodePath `
      -NpmPath $NpmPath `
      -PythonPath $toolchainCheck.pythonPath `
      -PythonHealth $toolchainCheck.pythonHealth `
      -FfmpegPath $FfmpegPath `
      -YtDlpPath $YtDlpPath `
      -WhisperxPath $WhisperxPath
    Assert-OptimizationExternalToolCompatibility -Toolchain $sourceBefore.toolchain

    New-Item -ItemType Directory -Force -Path $stagingDist | Out-Null

    Write-Host "Building production dist in staging: $stagingDist"
    if ($null -ne $BuildAction) {
      & $BuildAction $NpmPath $stagingDist
    } else {
      Invoke-OptimizationBuild -NpmPath $NpmPath -ProjectRoot $ProjectRoot -DistRoot $stagingDist
    }
    $distIndex = Join-Path $stagingDist 'index.html'
    if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) {
      throw "Built staging dist/index.html is missing: $stagingDist"
    }
    $sourceAfter = Get-OptimizationSourceFingerprint `
      -ProjectRoot $ProjectRoot `
      -WorkflowRoot $WorkflowRoot `
      -RuntimeConfigPath $RuntimeConfigPath `
      -CapabilityScript $CapabilityScript `
      -BackupScript $BackupScript `
      -FrontDoorScript $FrontDoorScript `
      -NodePath $NodePath `
      -NpmPath $NpmPath `
      -PythonPath $toolchainCheck.pythonPath `
      -PythonHealth $toolchainCheck.pythonHealth `
      -FfmpegPath $FfmpegPath `
      -YtDlpPath $YtDlpPath `
      -WhisperxPath $WhisperxPath
    if ($sourceBefore.sha256 -ne $sourceAfter.sha256) {
      throw 'Optimization release sources changed during the staging build; release was not published.'
    }

    $distArtifacts = @(Get-OptimizationDistArtifacts -ReleaseRoot $stageRoot -DistRoot $stagingDist)
    $packageLockPath = Join-Path $ProjectRoot 'package-lock.json'
    $pythonLockPath = Join-Path $WorkflowRoot 'requirements-service.lock'
    $projectRootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $pythonLockPath -PathType Leaf)) {
      throw "Optimization release lock disappeared during staging: $pythonLockPath"
    }
    $expectedPythonLockPath = Join-Path $projectRootPath ($script:OptimizationPythonLockArtifactPath.Replace('/', '\'))
    $resolvedPythonLockPath = (Resolve-Path -LiteralPath $pythonLockPath).Path
    if ([IO.Path]::GetFullPath($resolvedPythonLockPath) -ine [IO.Path]::GetFullPath($expectedPythonLockPath)) {
      throw "Optimization release Python lock must be rooted at $script:OptimizationPythonLockArtifactPath; received $resolvedPythonLockPath"
    }
    $lockArtifacts = @()
    $lockInputs = @(
      @{ path = $packageLockPath; artifactPath = 'package-lock.json' },
      @{ path = $pythonLockPath; artifactPath = $script:OptimizationPythonLockArtifactPath }
    )
    foreach ($lockInput in $lockInputs) {
      $lockPath = [string]$lockInput.path
      $relativeLock = [string]$lockInput.artifactPath
      if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
        throw "Optimization release lock disappeared during staging: $lockPath"
      }
      $stagedLock = Join-Path $stageRoot ($relativeLock.Replace('/', '\'))
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stagedLock) | Out-Null
      Copy-Item -LiteralPath $lockPath -Destination $stagedLock -Force
      $stagedLockItem = Get-Item -LiteralPath $stagedLock
      $lockArtifacts += [ordered]@{
        path = $relativeLock.Replace('\', '/')
        bytes = [int64]$stagedLockItem.Length
        sha256 = Get-OptimizationFileSha256 -Path $stagedLock
      }
    }
    $artifacts = @($distArtifacts + $lockArtifacts)
    $distDigest = Get-OptimizationDigest -Artifacts $distArtifacts
    $gitSha = Get-OptimizationGitText -ProjectRoot $ProjectRoot -Arguments @('rev-parse', 'HEAD')
    if (-not $gitSha) { $gitSha = 'working-tree' }
    $gitShort = if ($gitSha.Length -gt 12) { $gitSha.Substring(0, 12) } else { $gitSha }
    $releaseFormatVersion = 2
    $releaseId = "read-web-optimization-v$releaseFormatVersion-$gitShort-$($sourceBefore.sha256.Substring(0, 12))-$($distDigest.Substring(0, 12))"
    $publishedRoot = Join-Path ([IO.Path]::GetFullPath($ReleaseRoot)) $releaseId
    $packagePath = Join-Path $ProjectRoot 'package.json'
    $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $gitBranch = Get-OptimizationGitText -ProjectRoot $ProjectRoot -Arguments @('branch', '--show-current')
    $dirty = [bool]$gitStatus
    $manifest = [ordered]@{
      schemaVersion = 1
      generatedAt = ([DateTime]::UtcNow).ToString('O')
      role = 'optimization-local'
      source = [ordered]@{ kind = 'working-tree'; readOnly = $false; provenance = 'optimization release staging from current Git worktree' }
      release = [ordered]@{
        releaseId = $releaseId
        formatVersion = $releaseFormatVersion
        application = [string]$package.name
        frontendVersion = [string]$package.version
        productionHostVersion = '0.2.3'
        backendVersion = '0.2.3'
        gitSha = $gitSha
        gitBranch = $gitBranch
        dirty = $dirty
        root = $publishedRoot
      }
      runtime = [ordered]@{
        node = [string]$sourceBefore.toolchain.node.version
        npm = [string]$sourceBefore.toolchain.npm.version
        python = [string]$sourceBefore.toolchain.python.version
        pythonIdentity = [ordered]@{
          status = 'verified'
          executable = [string]$sourceBefore.toolchain.python.executable
          version = [string]$sourceBefore.toolchain.python.version
          packageSetSha256 = [string]$sourceBefore.toolchain.python.packageSetSha256
          environmentSha256 = [string]$sourceBefore.toolchain.python.environmentSha256
        }
        frontend = [ordered]@{ host = $FrontendHost; port = $FrontendPort }
        backend = [ordered]@{ host = $BackendHost; port = $BackendPort }
        dataRoot = $DataRoot
        sourceSha256 = $sourceBefore.sha256
        distSha256 = $distDigest
        toolchainSha256 = [string]$sourceBefore.toolchainSha256
      }
      dependencyLocks = [ordered]@{
        node = Get-OptimizationLockSummary -Path $packageLockPath -ProjectRoot $ProjectRoot -Kind 'npm' -ArtifactPath 'package-lock.json'
        python = Get-OptimizationLockSummary -Path $pythonLockPath -ProjectRoot $ProjectRoot -Kind 'pip-require-hashes' -ArtifactPath $script:OptimizationPythonLockArtifactPath
      }
      externalTools = $sourceBefore.toolchain.externalTools
      configuration = [ordered]@{ schemaVersion = 1; minimumCompatible = 1; maximumCompatible = 1 }
      dataCompatibility = [ordered]@{
        indexedDb = [ordered]@{ name = 'SeekPlayerDB'; version = 1; objectStore = 'files'; keyPath = 'id' }
        workflowServiceVersion = '0.2.3'
        migration = [ordered]@{ minimumSchemaVersion = 1; maximumSchemaVersion = 1; dryRunRequired = $true; reversible = $true }
        rollback = [ordered]@{ minimumSchemaVersion = 1; maximumSchemaVersion = 1; reversible = $true; dataPreserving = $true }
      }
      compatibility = [ordered]@{
        migration = [ordered]@{ fromSchemaVersion = 1; toSchemaVersion = 1; dryRun = $true; reversible = $true }
        rollback = [ordered]@{ minimumReleaseFormatVersion = 2; maximumReleaseFormatVersion = 2; compatible = $true; dataPreserving = $true; reversible = $true }
      }
      artifacts = @($artifacts)
    }
    if ($null -ne $ManifestTransform) {
      $transformedManifest = & $ManifestTransform $manifest
      if ($null -eq $transformedManifest) { throw 'Optimization manifest transform returned no manifest.' }
      $manifest = $transformedManifest
    }
    # Validate the complete manifest against the checked-in schema while it
    # is still in memory.  The staging manifest is not created until this
    # verifier has accepted the candidate.
    $schemaCheck = Invoke-OptimizationManifestSchemaHealth `
      -NodePath $NodePath `
      -ReleaseHealthScript $ReleaseHealthScript `
      -Manifest $manifest
    Write-OptimizationJsonAtomic -Path $manifestPath -Value $manifest
    $manifestCheck = Invoke-OptimizationManifestHealth `
      -NodePath $NodePath `
      -ReleaseHealthScript $ReleaseHealthScript `
      -ManifestPath $manifestPath `
      -ReleaseRoot $stageRoot
    $descriptor = Get-OptimizationReleaseDescriptor -ReleaseRoot $stageRoot
    return [pscustomobject]@{
      releaseId = $releaseId
      stagingRoot = $stageRoot
      distRoot = $stagingDist
      manifestPath = $manifestPath
      manifestSha256 = [string]$manifestCheck.manifestSha256
      sourceSha256 = $sourceBefore.sha256
      distSha256 = $distDigest
      toolchainSha256 = [string]$sourceBefore.toolchainSha256
      release = $descriptor
    }
  } catch {
    if (Test-Path -LiteralPath $stageRoot) {
      Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
  }
}

function Convert-OptimizationReleaseStagingManifestToImmutable {
  param(
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][string]$TargetRoot,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$ReleaseHealthScript
  )
  $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $source = $manifest.source
  if ($null -eq $source -or [string]$source.kind -ne 'working-tree' -or [bool]$source.readOnly) {
    throw 'Optimization release publish requires a writable working-tree staging manifest.'
  }
  if ([string]$manifest.dependencyLocks.python.path -ne $script:OptimizationPythonLockArtifactPath) {
    throw "Optimization release publish requires the canonical Python lock artifact path: $script:OptimizationPythonLockArtifactPath"
  }
  $artifactPaths = @($manifest.artifacts | ForEach-Object { [string]$_.path.Replace('\', '/') })
  foreach ($required in @($script:OptimizationFrontendEntryArtifactPath, 'package-lock.json', $script:OptimizationPythonLockArtifactPath)) {
    if ($artifactPaths -notcontains $required) {
      throw "Optimization release publish is missing the required artifact: $required"
    }
  }
  $manifest.role = 'published-release'
  $manifest.source.kind = 'immutable-release'
  $manifest.source.readOnly = $true
  $manifest.source.provenance = 'published optimization release'
  $manifest.release.root = [IO.Path]::GetFullPath($TargetRoot)
  Invoke-OptimizationManifestSchemaHealth `
    -NodePath $NodePath `
    -ReleaseHealthScript $ReleaseHealthScript `
    -Manifest $manifest | Out-Null
  Write-OptimizationJsonAtomic -Path $ManifestPath -Value $manifest
  return $manifest
}

function Publish-OptimizationRelease {
  param(
    [Parameter(Mandatory)]$Candidate,
    [Parameter(Mandatory)][string]$ReleaseRoot,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$ReleaseHealthScript
  )
  if (-not (Test-Path -LiteralPath $Candidate.stagingRoot -PathType Container)) {
    throw "Optimization staging release is missing: $($Candidate.stagingRoot)"
  }
  New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
  $targetRoot = Join-Path $ReleaseRoot $Candidate.releaseId
  if (Test-Path -LiteralPath $targetRoot) {
    try {
      $existing = Get-OptimizationReleaseDescriptor -ReleaseRoot $targetRoot
      $integrity = Test-OptimizationReleaseIntegrity -Release $existing -NodePath $NodePath -ReleaseHealthScript $ReleaseHealthScript
      $existingReuseKey = Get-OptimizationReleaseReuseKey -Release $existing
      $candidateReuseKey = Get-OptimizationReleaseReuseKey -Release ([pscustomobject]@{
        manifest = $Candidate.release.manifest
      })
      if ($integrity.passed `
        -and (Test-OptimizationReleaseCompatibility -Release $existing) `
        -and $existingReuseKey `
        -and $candidateReuseKey `
        -and $existingReuseKey -eq $candidateReuseKey) {
        Remove-Item -LiteralPath $Candidate.stagingRoot -Recurse -Force
        return [pscustomobject]@{ status = 'reused'; release = $existing }
      }
    } catch {
      # The target is immutable. A corrupt or mismatched target must never be overwritten.
    }
    throw "Immutable optimization release target already exists and does not match: $targetRoot"
  }
  $moved = $false
  try {
    Convert-OptimizationReleaseStagingManifestToImmutable `
      -ManifestPath (Join-Path $Candidate.stagingRoot 'release-manifest.json') `
      -TargetRoot $targetRoot `
      -NodePath $NodePath `
      -ReleaseHealthScript $ReleaseHealthScript | Out-Null
    Move-Item -LiteralPath $Candidate.stagingRoot -Destination $targetRoot
    $moved = $true
    $published = Get-OptimizationReleaseDescriptor -ReleaseRoot $targetRoot
    $integrity = Test-OptimizationReleaseIntegrity -Release $published -NodePath $NodePath -ReleaseHealthScript $ReleaseHealthScript
    if (-not $integrity.passed) {
      throw "Published optimization release failed post-move checksum validation: $targetRoot"
    }
    if (-not (Test-OptimizationReleaseCompatibility -Release $published)) {
      throw "Published optimization release failed compatibility validation: $targetRoot"
    }
    return [pscustomobject]@{ status = 'published'; release = $published }
  } catch {
    if ($moved -and (Test-Path -LiteralPath $targetRoot)) {
      Remove-Item -LiteralPath $targetRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $Candidate.stagingRoot) {
      Remove-Item -LiteralPath $Candidate.stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
  }
}

function Remove-OptimizationReleaseStaging {
  param([Parameter(Mandatory)][string]$StagingRoot)
  if (Test-Path -LiteralPath $StagingRoot) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Read-OptimizationActiveRelease {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Invalid active optimization release pointer: $Path"
  }
}

function Write-OptimizationActiveRelease {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)]$Release,
    [Parameter(Mandatory)][string]$ProfileId
  )
  Write-OptimizationJsonAtomic -Path $Path -Value ([ordered]@{
    schemaVersion = 1
    status = 'active'
    profileId = $ProfileId
    releaseId = $Release.releaseId
    releaseRoot = $Release.releaseRoot
    distRoot = $Release.distRoot
    manifestPath = $Release.manifestPath
    manifestSha256 = $Release.manifestSha256
    sourceSha256 = $Release.sourceSha256
    distSha256 = $Release.distSha256
    activatedAtUtc = ([DateTime]::UtcNow).ToString('O')
  })
}

Export-ModuleMember -Function `
  Get-OptimizationFileSha256, `
  Get-OptimizationViteConfigPath, `
  Get-OptimizationSourceFingerprint, `
  New-OptimizationReleaseStaging, `
  Publish-OptimizationRelease, `
  Remove-OptimizationReleaseStaging, `
  Read-OptimizationActiveRelease, `
  Write-OptimizationActiveRelease, `
  Get-OptimizationReleaseDescriptor, `
  Test-OptimizationReleaseIntegrity, `
  Test-OptimizationReleaseCompatibility, `
  Assert-OptimizationReleaseToolchain, `
  Resolve-OptimizationSelectedPython, `
  Get-OptimizationToolchainIdentity, `
  Get-OptimizationReleaseReuseKey, `
  Get-OptimizationExternalToolDescriptor, `
  Get-OptimizationExternalToolProbeResult, `
  Assert-OptimizationExternalToolCompatibility, `
  Get-OptimizationDefaultPythonPath

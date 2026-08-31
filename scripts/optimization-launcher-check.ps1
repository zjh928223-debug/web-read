param(
  [ValidateSet('auto', 'powershell', 'pwsh')]
  [string]$PowerShellKind = 'auto'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $PSScriptRoot
$workflowRoot = Join-Path $projectRoot 'tools\subtitle-workflow'
$runtimeConfigPath = Join-Path $projectRoot 'config\runtime.optimization.json'
$capabilityScript = Join-Path $projectRoot 'tools\local-capability-host.mjs'
$backupScript = Join-Path $projectRoot 'scripts\lib\read-web-production-backup.mjs'
$releaseHealthScript = Join-Path $projectRoot 'scripts\release-health-check.mjs'
$launcher = Join-Path $projectRoot 'scripts\launch-optimization-preview.ps1'
Import-Module (Join-Path $projectRoot 'scripts\launcher-instance-manager.psm1') -Force
Import-Module (Join-Path $projectRoot 'scripts\optimization-launch-runtime.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'scripts\optimization-release.psm1') -Force -DisableNameChecking
$nodePath = (Get-Command node -ErrorAction Stop).Source
$npmPath = if ($null -ne (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { (Get-Command npm.cmd -ErrorAction Stop).Source } else { (Get-Command npm -ErrorAction Stop).Source }
$pythonPath = Resolve-OptimizationSelectedPython -RuntimeConfigPath $runtimeConfigPath
$shellPath = switch ($PowerShellKind) {
  'powershell' { (Get-Command powershell -ErrorAction Stop).Source; break }
  'pwsh' { (Get-Command pwsh -ErrorAction Stop).Source; break }
  default {
    $preferred = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($null -ne $preferred) { $preferred.Source } else { (Get-Command powershell -ErrorAction Stop).Source }
  }
}

function Assert-True {
  param([bool]$Value, [Parameter(Mandatory)][string]$Message)
  if (-not $Value) { throw $Message }
}

function Get-HttpStatus {
  param([Parameter(Mandatory)][string]$Url)
  try {
    return [int](Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3).StatusCode
  } catch {
    if ($null -ne $_.Exception.Response) { return [int]$_.Exception.Response.StatusCode.value__ }
    throw
  }
}

function Get-TreeFingerprint {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return 'missing' }
  $root = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\', '/')
  $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File | Sort-Object FullName)
  $input = (($files | ForEach-Object {
    $relative = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($_.FullName)
    try {
      $hash = ([BitConverter]::ToString($algorithm.ComputeHash($stream)) -replace '-', '').ToLowerInvariant()
    } finally {
      $stream.Dispose()
      $algorithm.Dispose()
    }
    "${relative}:$hash"
  }) -join "`n")
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($input))) -replace '-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Invoke-Launcher {
  param(
    [string[]]$Arguments,
    [hashtable]$EnvironmentOverrides = @{}
  )
  $runRoot = Join-Path ([IO.Path]::GetTempPath()) ('read-web-optimization-launcher-run-' + [Guid]::NewGuid().ToString('N'))
  $stdoutPath = Join-Path $runRoot 'stdout.log'
  $stderrPath = Join-Path $runRoot 'stderr.log'
  $exitCodePath = Join-Path $runRoot 'exit-code.txt'
  $trampolinePath = Join-Path $runRoot 'launcher-trampoline.ps1'
  New-Item -ItemType Directory -Force -Path $runRoot | Out-Null
  $environmentSnapshot = @{}
  try {
    foreach ($name in $EnvironmentOverrides.Keys) {
      $environmentSnapshot[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      $value = $EnvironmentOverrides[$name]
      if ($null -eq $value) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
      else { [Environment]::SetEnvironmentVariable($name, [string]$value, 'Process') }
    }
    $argumentExpression = (($Arguments | ForEach-Object {
      $value = [string]$_
      if ($value -match '^-[A-Za-z][A-Za-z0-9-]*$') { $value }
      else { "'" + $value.Replace("'", "''") + "'" }
    }) -join ' ')
    $launcherLiteral = "'" + $launcher.Replace("'", "''") + "'"
    $exitCodeLiteral = "'" + $exitCodePath.Replace("'", "''") + "'"
    $trampoline = @"
`$ErrorActionPreference = 'Continue'
`$launcherStatus = 1
try {
  & $launcherLiteral $argumentExpression
  `$launcherStatus = if (`$?) { 0 } else { 1 }
} catch {
  Write-Error `$_
  `$launcherStatus = 1
}
[IO.File]::WriteAllText($exitCodeLiteral, [string]`$launcherStatus)
exit `$launcherStatus
"@
    [IO.File]::WriteAllText($trampolinePath, $trampoline, [Text.UTF8Encoding]::new($false))
    $argumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $trampolinePath)
    $process = Start-Process `
      -FilePath $shellPath `
      -ArgumentList $argumentList `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -PassThru
    $process.WaitForExit()
    $process.Refresh()
    if (-not $process.HasExited) {
      Wait-Process -Id $process.Id -ErrorAction Stop
      $process.Refresh()
    }
    # Prefer the trampoline receipt.  Windows PowerShell 5.1 can expose an
    # empty/stale Process.ExitCode while a redirected child has just exited;
    # the receipt is written by the same shell that invoked the launcher.
    $exitCode = $null
    $hasExitReceipt = $false
    if (Test-Path -LiteralPath $exitCodePath -PathType Leaf) {
      $receipt = (Read-OptimizationRuntimeText -Path $exitCodePath).Trim()
      $parsedReceipt = 0
      if ([int]::TryParse($receipt, [ref]$parsedReceipt)) {
        $exitCode = $parsedReceipt
        $hasExitReceipt = $true
      }
    }
    if ($null -eq $exitCode) {
      try {
        $process.Refresh()
        if ($process.HasExited) {
          $processExitText = [string]$process.ExitCode
          if ($processExitText -match '^-?\d+$') { $exitCode = [int]$processExitText }
        }
      } catch {
        $exitCode = $null
      }
    }
    # A forced crash is intentionally receipt-less.  Do not read redirected
    # stdout/stderr here: a child process can still hold the inherited handle
    # until the next launcher invocation performs journal recovery.
    if (-not $hasExitReceipt) {
      throw 'launcher process terminated before writing an exit receipt (forced termination was observed)'
    }
    $output = ''
    try {
      $output = "$(Read-OptimizationRuntimeText -Path $stdoutPath)$(Read-OptimizationRuntimeText -Path $stderrPath)"
    } catch {
      $output = "launcher output was still locked after the bounded wait: $($_.Exception.Message)"
    }
    if ([int]$exitCode -ne 0) { throw "launcher failed with exit code $exitCode`n$output" }
    return $output
  } finally {
    foreach ($name in $environmentSnapshot.Keys) {
      $value = $environmentSnapshot[$name]
      if ($null -eq $value) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
      else { [Environment]::SetEnvironmentVariable($name, [string]$value, 'Process') }
    }
    if (Test-Path -LiteralPath $runRoot) { Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Assert-CleanReleaseCandidateGate {
  $fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('read-web-optimization-clean-candidate-' + [Guid]::NewGuid().ToString('N'))
  $fixtureWorkflow = Join-Path $fixtureRoot 'workflow'
  $fixtureStaging = Join-Path $fixtureRoot 'staging'
  $fixtureReleases = Join-Path $fixtureRoot 'releases'
  $fixtureConfig = Join-Path $fixtureRoot 'runtime.json'
  $fixtureCapability = Join-Path $fixtureRoot 'capability.mjs'
  $fixtureBackup = Join-Path $fixtureRoot 'backup.mjs'
  $fixtureFrontDoor = Join-Path $fixtureRoot 'front-door.mjs'
  $fixtureHealth = Join-Path $fixtureRoot 'release-health.mjs'
  $marker = Join-Path $fixtureRoot 'build-was-run.txt'
  New-Item -ItemType Directory -Force -Path (Join-Path $fixtureRoot 'src'), $fixtureWorkflow, $fixtureStaging, $fixtureReleases | Out-Null
  try {
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'index.html'), '<!doctype html>')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'styles.css'), 'fixture')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'vite.config.js'), 'export default {}')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'package.json'), '{"name":"clean-candidate-fixture","version":"1.0.0"}')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'package-lock.json'), '{"name":"clean-candidate-fixture","version":"1.0.0","lockfileVersion":3}')
    [IO.File]::WriteAllText($fixtureConfig, '{}')
    [IO.File]::WriteAllText($fixtureCapability, 'export default {}')
    [IO.File]::WriteAllText($fixtureBackup, 'export default {}')
    [IO.File]::WriteAllText($fixtureFrontDoor, 'export default {}')
    [IO.File]::WriteAllText($fixtureHealth, 'export default {}')
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'src\entry.js'), 'export default {}')
    [IO.File]::WriteAllText((Join-Path $fixtureWorkflow 'service.py'), 'fixture = True')
    & git -C $fixtureRoot init -q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'clean-candidate fixture git init failed' }
    & git -C $fixtureRoot -c user.email=fixture@example.invalid -c user.name=Fixture add . | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'clean-candidate fixture git add failed' }
    & git -C $fixtureRoot -c user.email=fixture@example.invalid -c user.name=Fixture commit -qm fixture | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'clean-candidate fixture git commit failed' }

    foreach ($dirtyKind in @('untracked', 'tracked')) {
      if ($dirtyKind -eq 'untracked') {
        [IO.File]::WriteAllText((Join-Path $fixtureRoot 'untracked.txt'), 'untracked')
      } else {
        [IO.File]::WriteAllText((Join-Path $fixtureRoot 'styles.css'), 'tracked dirty')
      }
      $rejected = $false
      try {
        New-OptimizationReleaseStaging `
          -ProjectRoot $fixtureRoot `
          -WorkflowRoot $fixtureWorkflow `
          -RuntimeConfigPath $fixtureConfig `
          -CapabilityScript $fixtureCapability `
          -BackupScript $fixtureBackup `
          -FrontDoorScript $fixtureFrontDoor `
          -StagingRoot $fixtureStaging `
          -ReleaseRoot $fixtureReleases `
          -NpmPath $npmPath `
          -NodePath $nodePath `
          -ReleaseHealthScript $fixtureHealth `
          -ProfileId 'isolated-release-test' `
          -FrontendHost '127.0.0.1' `
          -FrontendPort 49184 `
          -BackendHost '127.0.0.1' `
          -BackendPort 49776 `
          -DataRoot (Join-Path $fixtureRoot 'data') `
          -RequireClean `
          -BuildAction { param($unusedNpm, $unusedDist) [IO.File]::WriteAllText($marker, 'unexpected') } | Out-Null
      } catch { $rejected = $true }
      Assert-True $rejected "$dirtyKind release candidate was accepted"
      Assert-True (-not (Test-Path -LiteralPath $marker -PathType Leaf)) "$dirtyKind release candidate ran its build action"
      Assert-True (@(Get-ChildItem -LiteralPath $fixtureStaging -Directory -ErrorAction SilentlyContinue).Count -eq 0) "$dirtyKind release candidate left staging output"
      if ($dirtyKind -eq 'untracked') {
        Remove-Item -LiteralPath (Join-Path $fixtureRoot 'untracked.txt') -Force
      } else {
        [IO.File]::WriteAllText((Join-Path $fixtureRoot 'styles.css'), 'fixture')
      }
    }
    Write-Host 'clean release candidate dirty/untracked gate passed'
  } finally {
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Assert-ModuleReleaseFailureSafety {
  $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('read-web-optimization-release-' + [Guid]::NewGuid().ToString('N'))
  $stagingRoot = Join-Path $testRoot 'staging'
  $releaseRoot = Join-Path $testRoot 'releases'
  $activePointerPath = Join-Path $testRoot 'active-release.json'
  New-Item -ItemType Directory -Force -Path $testRoot, $stagingRoot, $releaseRoot | Out-Null
  try {
    Assert-CleanReleaseCandidateGate
    $gitStatus = ((& git -C $projectRoot status --porcelain --untracked-files=all 2>$null) -join "`n").Trim()
    if ($gitStatus) {
      $cleanCandidateRejected = $false
      $cleanBuildMarker = Join-Path $testRoot 'clean-build-was-run.txt'
      try {
        New-OptimizationReleaseStaging `
          -ProjectRoot $projectRoot `
          -WorkflowRoot $workflowRoot `
          -RuntimeConfigPath $runtimeConfigPath `
          -CapabilityScript $capabilityScript `
          -BackupScript $backupScript `
          -StagingRoot $stagingRoot `
          -ReleaseRoot $releaseRoot `
          -NpmPath $npmPath `
          -NodePath $nodePath `
          -ReleaseHealthScript $releaseHealthScript `
          -ProfileId 'isolated-release-test' `
          -FrontendHost '127.0.0.1' `
          -FrontendPort 49184 `
          -BackendHost '127.0.0.1' `
          -BackendPort 49776 `
          -DataRoot (Join-Path $testRoot 'data') `
          -RequireClean `
          -BuildAction { param($unusedNpm, $unusedDist) [IO.File]::WriteAllText($cleanBuildMarker, 'unexpected') } | Out-Null
      } catch { $cleanCandidateRejected = $true }
      Assert-True $cleanCandidateRejected 'dirty/untracked worktree was accepted as a release candidate'
      Assert-True (-not (Test-Path -LiteralPath $cleanBuildMarker -PathType Leaf)) 'dirty release candidate ran its build action before rejection'
      Assert-True (@(Get-ChildItem -LiteralPath $stagingRoot -Directory -ErrorAction SilentlyContinue).Count -eq 0) 'dirty release candidate left a staging directory'
    }

    $build = { param($unusedNpm, $distRoot) [IO.File]::WriteAllText((Join-Path $distRoot 'index.html'), 'old release') }
    $candidate = New-OptimizationReleaseStaging `
      -ProjectRoot $projectRoot `
      -WorkflowRoot $workflowRoot `
      -RuntimeConfigPath $runtimeConfigPath `
      -CapabilityScript $capabilityScript `
      -BackupScript $backupScript `
      -StagingRoot $stagingRoot `
      -ReleaseRoot $releaseRoot `
      -NpmPath $npmPath `
      -NodePath $nodePath `
      -ReleaseHealthScript $releaseHealthScript `
      -ProfileId 'isolated-release-test' `
      -FrontendHost '127.0.0.1' `
      -FrontendPort 49184 `
      -BackendHost '127.0.0.1' `
      -BackendPort 49776 `
      -DataRoot (Join-Path $testRoot 'data') `
      -BuildAction $build
    $published = Publish-OptimizationRelease `
      -Candidate $candidate `
      -ReleaseRoot $releaseRoot `
      -NodePath $nodePath `
      -ReleaseHealthScript $releaseHealthScript
    $oldRelease = $published.release
    Assert-True (Test-OptimizationReleaseCompatibility -Release $oldRelease) 'published release is missing the complete IndexedDB compatibility contract'
    Write-OptimizationActiveRelease -Path $activePointerPath -Release $oldRelease -ProfileId 'isolated-release-test'
    $oldContent = Read-OptimizationRuntimeText -Path (Join-Path $oldRelease.distRoot 'index.html')
    $oldPointer = Read-OptimizationRuntimeText -Path $activePointerPath
    $oldReuseKey = Get-OptimizationReleaseReuseKey -Release $oldRelease
    Assert-True (-not [string]::IsNullOrWhiteSpace($oldReuseKey)) 'published release did not produce an immutable reuse key'
    $oldPythonIdentity = $oldRelease.manifest.runtime.pythonIdentity
    Assert-True ($oldPythonIdentity.status -eq 'verified' -and $oldPythonIdentity.executable -eq $pythonPath -and $oldPythonIdentity.packageSetSha256 -match '^[0-9a-f]{64}$' -and $oldPythonIdentity.environmentSha256 -match '^[0-9a-f]{64}$') `
      'published release did not record the selected Python executable and package identity'
    Assert-True ($oldRelease.manifest.role -eq 'published-release' -and $oldRelease.manifest.source.kind -eq 'immutable-release' -and $oldRelease.manifest.source.readOnly -eq $true) `
      'published release manifest did not transition to published-release immutable-release/readOnly=true'
    Assert-True ([IO.Path]::GetFullPath([string]$oldRelease.manifest.release.root) -ieq [IO.Path]::GetFullPath([string]$oldRelease.releaseRoot)) `
      'published release manifest root does not point to the published release directory'
    Assert-True ([string]$oldRelease.manifest.dependencyLocks.python.path -eq 'tools/subtitle-workflow/requirements-service.lock') `
      'published release manifest did not use the canonical Python lock artifact path'
    $preflightScriptPath = Join-Path $projectRoot 'scripts\release-preflight.mjs'
    $preflightOutput = & $nodePath $preflightScriptPath '--previous-manifest' $oldRelease.manifestPath '--previous-source-only' 2>&1
    $preflightExitCode = $LASTEXITCODE
    Assert-True ($preflightExitCode -eq 0) "published release manifest could not pass the previous-source preflight stage: $(($preflightOutput -join '`n'))"
    $preflightResult = $null
    try { $preflightResult = (($preflightOutput -join "`n") | ConvertFrom-Json) } catch {}
    Assert-True ($null -ne $preflightResult -and $preflightResult.status -eq 'passed' -and $preflightResult.previous.kind -eq 'manifest') 'published release manifest preflight output was not a passing manifest source result'
    Assert-True ([IO.Path]::GetFullPath([string]$preflightResult.previous.root) -ieq [IO.Path]::GetFullPath([string]$oldRelease.releaseRoot)) 'preflight resolved the published manifest to the wrong release root'
    Assert-True ([string]$preflightResult.previous.releaseId -eq [string]$oldRelease.releaseId) 'preflight resolved the published manifest to the wrong release identity'

    $lockChangedManifest = $oldRelease.manifest | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $lockChangedManifest.dependencyLocks.python.sha256 = ('e' * 64)
    $lockChangedKey = Get-OptimizationReleaseReuseKey -Release ([pscustomobject]@{ manifest = $lockChangedManifest })
    Assert-True ($lockChangedKey -and $lockChangedKey -ne $oldReuseKey) 'Python lock identity changed without changing the release reuse key'
    $packageSetChangedManifest = $oldRelease.manifest | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $packageSetChangedManifest.runtime.pythonIdentity.packageSetSha256 = ('f' * 64)
    $packageSetChangedKey = Get-OptimizationReleaseReuseKey -Release ([pscustomobject]@{ manifest = $packageSetChangedManifest })
    Assert-True ($packageSetChangedKey -and $packageSetChangedKey -ne $oldReuseKey) 'Python package-set identity changed without changing the release reuse key'
    $toolchainChangedManifest = $oldRelease.manifest | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $toolchainChangedManifest.externalTools.ffmpeg.version = 'synthetic-toolchain-version'
    $toolchainChangedKey = Get-OptimizationReleaseReuseKey -Release ([pscustomobject]@{ manifest = $toolchainChangedManifest })
    Assert-True ($toolchainChangedKey -and $toolchainChangedKey -ne $oldReuseKey) 'external tool identity changed without changing the release reuse key'

    $arbitraryToolDescriptor = Get-OptimizationExternalToolDescriptor `
      -Name 'ffmpeg' `
      -VersionArguments @('-c', 'print("command completed successfully")') `
      -ExecutablePath $pythonPath
    Assert-True ($arbitraryToolDescriptor.status -eq 'degraded' -and $arbitraryToolDescriptor.compatibility.status -eq 'invalid-output') `
      'an exit-0 arbitrary external-tool output was incorrectly marked verified'
    $unsupportedToolDescriptor = Get-OptimizationExternalToolDescriptor `
      -Name 'ffmpeg' `
      -VersionArguments @('-c', 'print("ffmpeg version 3.0.0")') `
      -ExecutablePath $pythonPath
    Assert-True ($unsupportedToolDescriptor.status -eq 'degraded' -and $unsupportedToolDescriptor.compatibility.status -eq 'unsupported-version') `
      'an unsupported external-tool version was incorrectly marked verified'
    $supportedToolDescriptor = Get-OptimizationExternalToolDescriptor `
      -Name 'ffmpeg' `
      -VersionArguments @('-c', 'print("ffmpeg version 7.1.1")') `
      -ExecutablePath $pythonPath
    Assert-True ($supportedToolDescriptor.status -eq 'verified' -and $supportedToolDescriptor.compatibility.status -eq 'supported') `
      'a supported external-tool banner was not verified'
    $failedToolDescriptor = Get-OptimizationExternalToolDescriptor `
      -Name 'ffmpeg' `
      -VersionArguments @('-c', 'import sys; print("ffmpeg version 7.1.1"); sys.exit(7)') `
      -ExecutablePath $pythonPath
    Assert-True ($failedToolDescriptor.status -eq 'degraded' -and $failedToolDescriptor.compatibility.status -eq 'probe-failed') `
      'an external-tool probe with a non-zero exit was not typed as degraded'
    $missingToolDescriptor = Get-OptimizationExternalToolDescriptor `
      -Name 'ffmpeg' `
      -VersionArguments @('-version') `
      -ExecutablePath (Join-Path $testRoot 'missing-ffmpeg.exe')
    Assert-True ($missingToolDescriptor.status -eq 'missing' -and $missingToolDescriptor.compatibility.status -eq 'missing') `
      'a missing external tool did not produce the typed missing compatibility state'
    $unsupportedReleaseBuildMarker = Join-Path $testRoot 'unsupported-tool-build-ran.txt'
    $unsupportedReleaseRejected = $false
    try {
      New-OptimizationReleaseStaging `
        -ProjectRoot $projectRoot `
        -WorkflowRoot $workflowRoot `
        -RuntimeConfigPath $runtimeConfigPath `
        -CapabilityScript $capabilityScript `
        -BackupScript $backupScript `
        -StagingRoot $stagingRoot `
        -ReleaseRoot $releaseRoot `
        -NpmPath $npmPath `
        -NodePath $nodePath `
        -PythonPath $pythonPath `
        -FfmpegPath $pythonPath `
        -ReleaseHealthScript $releaseHealthScript `
        -ProfileId 'isolated-release-test' `
        -FrontendHost '127.0.0.1' `
        -FrontendPort 49184 `
        -BackendHost '127.0.0.1' `
        -BackendPort 49776 `
        -DataRoot (Join-Path $testRoot 'data') `
        -BuildAction { param($unusedNpm, $unusedDist) [IO.File]::WriteAllText($unsupportedReleaseBuildMarker, 'unexpected') } | Out-Null
    } catch { $unsupportedReleaseRejected = $true }
    Assert-True $unsupportedReleaseRejected 'an incompatible external tool did not fail-close the release candidate'
    Assert-True (-not (Test-Path -LiteralPath $unsupportedReleaseBuildMarker -PathType Leaf)) 'incompatible external tool ran the release build before rejection'
    Assert-True (@(Get-ChildItem -LiteralPath $stagingRoot -Directory -ErrorAction SilentlyContinue).Count -eq 0) 'incompatible external tool left a staging release'

    $fingerprintWorkflow = Join-Path $testRoot 'fingerprint-workflow'
    New-Item -ItemType Directory -Force -Path $fingerprintWorkflow | Out-Null
    $fingerprintLock = Join-Path $fingerprintWorkflow 'requirements-service.lock'
    Copy-Item -LiteralPath (Join-Path $workflowRoot 'requirements-service.lock') -Destination $fingerprintLock
    $fingerprintArgs = @{
      ProjectRoot = $projectRoot
      WorkflowRoot = $fingerprintWorkflow
      RuntimeConfigPath = $runtimeConfigPath
      CapabilityScript = $capabilityScript
      BackupScript = $backupScript
      FrontDoorScript = (Join-Path $projectRoot 'tools\optimization-stable-front-door.mjs')
      NodePath = $nodePath
      NpmPath = $npmPath
      PythonPath = $pythonPath
    }
    $fingerprintBefore = Get-OptimizationSourceFingerprint @fingerprintArgs
    [IO.File]::AppendAllText($fingerprintLock, "`n# synthetic lock-only identity change`n", [Text.UTF8Encoding]::new($false))
    $fingerprintAfter = Get-OptimizationSourceFingerprint @fingerprintArgs
    Assert-True ($fingerprintBefore.sha256 -ne $fingerprintAfter.sha256) 'Python lock-only change did not change the optimization source fingerprint'

    $runtimeGateMarker = Join-Path $testRoot 'runtime-gate-build-ran.txt'
    $runtimeGateArgs = @{
      ProjectRoot = $projectRoot
      WorkflowRoot = $workflowRoot
      RuntimeConfigPath = $runtimeConfigPath
      CapabilityScript = $capabilityScript
      BackupScript = $backupScript
      FrontDoorScript = (Join-Path $projectRoot 'tools\optimization-stable-front-door.mjs')
      StagingRoot = $stagingRoot
      ReleaseRoot = $releaseRoot
      NpmPath = $npmPath
      NodePath = $nodePath
      PythonPath = $pythonPath
      ReleaseHealthScript = $releaseHealthScript
      ProfileId = 'isolated-release-test'
      FrontendHost = '127.0.0.1'
      FrontendPort = 49184
      BackendHost = '127.0.0.1'
      BackendPort = 49776
      DataRoot = (Join-Path $testRoot 'data')
    }
    foreach ($missingRuntime in @(
      @{ name = 'Node'; key = 'NodePath'; path = (Join-Path $testRoot 'missing-node.exe') },
      @{ name = 'npm'; key = 'NpmPath'; path = (Join-Path $testRoot 'missing-npm.cmd') },
      @{ name = 'Python'; key = 'PythonPath'; path = (Join-Path $testRoot 'missing-python.exe') }
    )) {
      $missingArgs = @{}
      foreach ($name in $runtimeGateArgs.Keys) { $missingArgs[$name] = $runtimeGateArgs[$name] }
      $missingArgs[$missingRuntime.key] = $missingRuntime.path
      $runtimeRejected = $false
      try {
        New-OptimizationReleaseStaging @missingArgs -BuildAction { param($unusedNpm, $unusedDist) [IO.File]::WriteAllText($runtimeGateMarker, 'unexpected') } | Out-Null
      } catch { $runtimeRejected = $true }
      Assert-True $runtimeRejected "missing $($missingRuntime.name) runtime was accepted"
      Assert-True (-not (Test-Path -LiteralPath $runtimeGateMarker -PathType Leaf)) "missing $($missingRuntime.name) runtime ran the build action"
      Assert-True (@(Get-ChildItem -LiteralPath $stagingRoot -Directory -ErrorAction SilentlyContinue).Count -eq 0) "missing $($missingRuntime.name) runtime left staging output"
    }

    $policyFixture = Join-Path $testRoot 'unsupported-toolchain-fixture'
    $policyFixtureWorkflow = Join-Path $policyFixture 'tools\subtitle-workflow'
    New-Item -ItemType Directory -Force -Path $policyFixtureWorkflow | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination $policyFixture -Recurse
    foreach ($requiredFile in @('index.html', 'styles.css', 'package-lock.json', 'config\runtime.optimization.json', 'tools\local-capability-host.mjs', 'scripts\lib\read-web-production-backup.mjs', 'tools\optimization-stable-front-door.mjs')) {
      $sourceFile = Join-Path $projectRoot $requiredFile
      $destinationFile = Join-Path $policyFixture $requiredFile
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destinationFile) | Out-Null
      Copy-Item -LiteralPath $sourceFile -Destination $destinationFile
    }
    $policyPackage = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $policyPackage.engines.node = '0.0.0'
    $policyPackageJson = $policyPackage | ConvertTo-Json -Depth 30
    [IO.File]::WriteAllText((Join-Path $policyFixture 'package.json'), $policyPackageJson, [Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath (Join-Path $workflowRoot 'requirements-service.lock') -Destination (Join-Path $policyFixtureWorkflow 'requirements-service.lock')
    $unsupportedStaging = Join-Path $testRoot 'unsupported-staging'
    $unsupportedReleases = Join-Path $testRoot 'unsupported-releases'
    $unsupportedArgs = @{}
    foreach ($name in $runtimeGateArgs.Keys) { $unsupportedArgs[$name] = $runtimeGateArgs[$name] }
    $unsupportedArgs.ProjectRoot = $policyFixture
    $unsupportedArgs.WorkflowRoot = $policyFixtureWorkflow
    $unsupportedArgs.RuntimeConfigPath = Join-Path $policyFixture 'config\runtime.optimization.json'
    $unsupportedArgs.CapabilityScript = Join-Path $policyFixture 'tools\local-capability-host.mjs'
    $unsupportedArgs.BackupScript = Join-Path $policyFixture 'scripts\lib\read-web-production-backup.mjs'
    $unsupportedArgs.FrontDoorScript = Join-Path $policyFixture 'tools\optimization-stable-front-door.mjs'
    $unsupportedArgs.StagingRoot = $unsupportedStaging
    $unsupportedArgs.ReleaseRoot = $unsupportedReleases
    $unsupportedRejected = $false
    try {
      New-OptimizationReleaseStaging @unsupportedArgs -BuildAction { param($unusedNpm, $unusedDist) [IO.File]::WriteAllText($runtimeGateMarker, 'unexpected') } | Out-Null
    } catch { $unsupportedRejected = $true }
    Assert-True $unsupportedRejected 'unsupported Node policy was accepted by optimization staging'
    Assert-True (-not (Test-Path -LiteralPath $runtimeGateMarker -PathType Leaf)) 'unsupported Node policy ran the build action'
    Assert-True (-not (Test-Path -LiteralPath $unsupportedStaging -PathType Leaf) -or @(Get-ChildItem -LiteralPath $unsupportedStaging -Force -ErrorAction SilentlyContinue).Count -eq 0) 'unsupported Node policy left staging output'
    Assert-True (-not (Test-Path -LiteralPath $unsupportedReleases -PathType Container) -or @(Get-ChildItem -LiteralPath $unsupportedReleases -Force -ErrorAction SilentlyContinue).Count -eq 0) 'unsupported Node policy published a release'

    $invalidManifestRejected = $false
    try {
      New-OptimizationReleaseStaging @runtimeGateArgs -BuildAction { param($unusedNpm, $distRoot) [IO.File]::WriteAllText((Join-Path $distRoot 'index.html'), 'schema-invalid') } -ManifestTransform {
        param($value)
        $value.runtime.node = $null
        return $value
      } | Out-Null
    } catch { $invalidManifestRejected = $true }
    Assert-True $invalidManifestRejected 'schema-invalid optimization manifest was accepted'
    Assert-True (@(Get-ChildItem -LiteralPath $stagingRoot -Directory -ErrorAction SilentlyContinue).Count -eq 0) 'schema-invalid manifest left staging output'
    Assert-True (@(Get-ChildItem -LiteralPath $releaseRoot -Directory -ErrorAction SilentlyContinue).Count -eq 1) 'schema-invalid manifest published a release'

    $buildFailed = $false
    try {
      New-OptimizationReleaseStaging `
        -ProjectRoot $projectRoot `
        -WorkflowRoot $workflowRoot `
        -RuntimeConfigPath $runtimeConfigPath `
        -CapabilityScript $capabilityScript `
        -BackupScript $backupScript `
        -StagingRoot $stagingRoot `
        -ReleaseRoot $releaseRoot `
        -NpmPath $npmPath `
        -NodePath $nodePath `
        -ReleaseHealthScript $releaseHealthScript `
        -ProfileId 'isolated-release-test' `
        -FrontendHost '127.0.0.1' `
        -FrontendPort 49184 `
        -BackendHost '127.0.0.1' `
        -BackendPort 49776 `
        -DataRoot (Join-Path $testRoot 'data') `
        -BuildAction { param($unusedNpm, $unusedDist) throw 'synthetic staging build failure' } | Out-Null
    } catch { $buildFailed = $true }
    Assert-True $buildFailed 'synthetic staging build failure must be observable'
    Assert-True ((Read-OptimizationRuntimeText -Path (Join-Path $oldRelease.distRoot 'index.html')) -eq $oldContent) 'staging build failure changed the active release'
    Assert-True ((Read-OptimizationRuntimeText -Path $activePointerPath) -eq $oldPointer) 'staging build failure changed the active release pointer'
    Assert-True (@(Get-ChildItem -LiteralPath $stagingRoot -Directory -ErrorAction SilentlyContinue).Count -eq 0) 'failed staging build left a staging directory'

    $candidate2 = New-OptimizationReleaseStaging `
      -ProjectRoot $projectRoot `
      -WorkflowRoot $workflowRoot `
      -RuntimeConfigPath $runtimeConfigPath `
      -CapabilityScript $capabilityScript `
      -BackupScript $backupScript `
      -StagingRoot $stagingRoot `
      -ReleaseRoot $releaseRoot `
      -NpmPath $npmPath `
      -NodePath $nodePath `
      -ReleaseHealthScript $releaseHealthScript `
      -ProfileId 'isolated-release-test' `
      -FrontendHost '127.0.0.1' `
      -FrontendPort 49184 `
      -BackendHost '127.0.0.1' `
      -BackendPort 49776 `
      -DataRoot (Join-Path $testRoot 'data') `
      -BuildAction { param($unusedNpm, $distRoot) [IO.File]::WriteAllText((Join-Path $distRoot 'index.html'), 'new release') }
    $collisionRoot = Join-Path $releaseRoot $candidate2.releaseId
    New-Item -ItemType Directory -Force -Path $collisionRoot | Out-Null
    $collisionSentinel = Join-Path $collisionRoot 'collision-sentinel.txt'
    [IO.File]::WriteAllText($collisionSentinel, 'do not overwrite')
    $publishFailed = $false
    try {
      Publish-OptimizationRelease `
        -Candidate $candidate2 `
        -ReleaseRoot $releaseRoot `
        -NodePath $nodePath `
        -ReleaseHealthScript $releaseHealthScript | Out-Null
    } catch { $publishFailed = $true }
    Assert-True $publishFailed 'immutable release target collision must fail publishing'
    Assert-True (Test-Path -LiteralPath $collisionSentinel -PathType Leaf) 'publish collision overwrote an existing release target'
    Assert-True ((Read-OptimizationRuntimeText -Path (Join-Path $oldRelease.distRoot 'index.html')) -eq $oldContent) 'publish collision changed the active release'
    Assert-True ((Read-OptimizationRuntimeText -Path $activePointerPath) -eq $oldPointer) 'publish collision changed the active release pointer'
    Remove-OptimizationReleaseStaging -StagingRoot $candidate2.stagingRoot
    Write-Host 'optimization release staging failure safety passed'
  } finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Assert-OptimizationConfigAndHealthSafety {
  $testRoot = Join-Path ([IO.Path]::GetTempPath()) ('read-web-optimization-config-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
  try {
    $defaultPython = Join-Path $testRoot 'local-app-data\Read-Web\optimization-python\Scripts\python.exe'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $defaultPython) | Out-Null
    [IO.File]::WriteAllText($defaultPython, 'fixture interpreter')
    $oldLocalAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA', 'Process')
    $oldPython = [Environment]::GetEnvironmentVariable('READ_WEB_PYTHON', 'Process')
    $oldPythonPath = [Environment]::GetEnvironmentVariable('READ_WEB_PYTHON_PATH', 'Process')
    try {
      [Environment]::SetEnvironmentVariable('LOCALAPPDATA', (Join-Path $testRoot 'local-app-data'), 'Process')
      [Environment]::SetEnvironmentVariable('READ_WEB_PYTHON', $null, 'Process')
      [Environment]::SetEnvironmentVariable('READ_WEB_PYTHON_PATH', $null, 'Process')
      $selectedDefaultPython = Resolve-OptimizationSelectedPython -RuntimeConfigPath $runtimeConfigPath
      Assert-True ([IO.Path]::GetFullPath($selectedDefaultPython) -eq [IO.Path]::GetFullPath($defaultPython)) 'PowerShell optimization resolver did not prefer the stable external venv'
    } finally {
      [Environment]::SetEnvironmentVariable('LOCALAPPDATA', $oldLocalAppData, 'Process')
      [Environment]::SetEnvironmentVariable('READ_WEB_PYTHON', $oldPython, 'Process')
      [Environment]::SetEnvironmentVariable('READ_WEB_PYTHON_PATH', $oldPythonPath, 'Process')
    }

    $jsPath = Join-Path $testRoot 'vite.config.js'
    $mjsPath = Join-Path $testRoot 'vite.config.mjs'
    [IO.File]::WriteAllText($jsPath, 'export default {}')
    Assert-True ((Get-OptimizationViteConfigPath -ProjectRoot $testRoot) -eq (Resolve-Path $jsPath).Path) 'vite.config.js fallback was not selected'
    [IO.File]::WriteAllText($mjsPath, 'export default {}')
    Assert-True ((Get-OptimizationViteConfigPath -ProjectRoot $testRoot) -eq (Resolve-Path $mjsPath).Path) 'vite.config.mjs did not take precedence over vite.config.js'

    $release = [pscustomobject]@{ releaseId = 'release'; manifestSha256 = 'manifest' }
    $hostState = [pscustomobject]@{ profileId = 'optimization'; releaseId = 'release'; instanceId = 'instance' }
    $capabilityState = [pscustomobject]@{ profileId = 'optimization'; releaseId = 'release'; instanceId = 'instance' }
    $capabilityHealth = [pscustomobject]@{ status = 'ready'; releaseId = 'release'; profileId = 'optimization'; instanceId = 'instance' }
    Assert-True (-not (Test-OptimizationPairReady `
        -HostState $hostState `
        -CapabilityState $capabilityState `
        -HostHealth $null `
        -CapabilityHealth $capabilityHealth `
        -Release $release `
        -ProfileId 'optimization' `
        -TokenPath (Join-Path $testRoot 'missing.token'))) 'null host health was treated as ready'
    $malformedHealth = [pscustomobject]@{ status = 'ready'; releaseId = 'release'; profileId = 'optimization'; instanceId = 'instance'; distReady = $true }
    Assert-True (-not (Test-OptimizationPairReady `
        -HostState $hostState `
        -CapabilityState $capabilityState `
        -HostHealth $malformedHealth `
        -CapabilityHealth $capabilityHealth `
        -Release $release `
        -ProfileId 'optimization' `
        -TokenPath (Join-Path $testRoot 'missing.token'))) 'malformed health without manifest was treated as ready'
    Write-Host 'optimization config precedence and malformed health safety passed'
  } finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Assert-RealLauncherLifecycle {
  $stateRoot = Join-Path $projectRoot '.codex\runtime-state\optimization'
  $hostStatePath = Join-Path $stateRoot 'production-host.json'
  $capabilityStatePath = Join-Path $stateRoot 'capability-host.json'
  $frontDoorStatePath = Join-Path $stateRoot 'front-door.json'
  $frontDoorTargetPath = Join-Path $stateRoot 'front-door-target.json'
  $frontDoorCommittedTargetPath = Join-Path $stateRoot 'front-door-committed-target.json'
  $activationJournalPath = Join-Path $stateRoot 'activation-journal.json'
  $frontDoorHealthIdentityTestPath = Join-Path $stateRoot 'front-door-health-identity.test'
  $tokenPath = Join-Path $stateRoot 'production-host.token'
  $applicationInstancesRoot = 'E:\ReadWebData\SubtitleWorkflow-Optimization\.read-web-application\instances'
  $initialIsolationInstanceIds = @()
  if (Test-Path -LiteralPath $applicationInstancesRoot -PathType Container) {
    $initialIsolationInstanceIds = @(Get-ChildItem -LiteralPath $applicationInstancesRoot -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
  }
  $projectDistFingerprint = Get-TreeFingerprint -Path (Join-Path $projectRoot 'dist')
  Assert-True (Wait-OptimizationTcpPortFree -Port 5184 -TimeoutSeconds 1) 'optimization launcher test requires port 5184 to be free'
  Assert-True (Wait-OptimizationTcpPortFree -Port 8776 -TimeoutSeconds 1) 'optimization launcher test requires port 8776 to be free'
  Assert-True (-not (Test-Path -LiteralPath $hostStatePath)) 'optimization launcher test refuses an existing host state'
  Assert-True (-not (Test-Path -LiteralPath $capabilityStatePath)) 'optimization launcher test refuses an existing capability state'
  Assert-True (-not (Test-Path -LiteralPath $frontDoorStatePath)) 'optimization launcher test refuses an existing front door state'
  if (Test-Path -LiteralPath $frontDoorHealthIdentityTestPath) { Remove-Item -LiteralPath $frontDoorHealthIdentityTestPath -Force }
  Assert-True (@(Get-ChildItem -LiteralPath $stateRoot -Filter 'production-host-*.json' -File -ErrorAction SilentlyContinue).Count -eq 0) 'optimization launcher test refuses pending host states'
  $started = $false
  try {
    # Mark the lifecycle as started before invoking the child.  A failed
    # invocation can have spawned owned processes before its receipt/output
    # is observed, so the finally block must always attempt -Stop cleanup.
    $started = $true
    $startOutput = Invoke-Launcher -Arguments @('-NoOpen')
    $hostDescriptor = Read-OptimizationJsonFile -Path $hostStatePath
    $hostManagerPath = [string]$hostDescriptor.managerStatePath
    $hostState = Read-OptimizationJsonFile -Path $hostManagerPath
    $capabilityState = Read-OptimizationJsonFile -Path $capabilityStatePath
    $frontDoorState = Read-OptimizationJsonFile -Path $frontDoorStatePath
    $frontDoorTarget = Read-OptimizationFrontDoorTarget -Path $frontDoorTargetPath
    $active = Read-OptimizationActiveRelease -Path (Join-Path $stateRoot 'active-release.json')
    Assert-True ($hostState.instanceId -eq $capabilityState.instanceId) 'real launcher pair does not share an instance identity'
    Assert-True ($hostState.releaseId -eq $capabilityState.releaseId) 'real launcher pair does not share a release identity'
    Assert-True ($frontDoorState.port -eq 5184 -and $frontDoorState.releaseId -eq 'read-web-optimization-front-door-v1') 'stable front door did not own port 5184'
    Assert-True ($hostState.port -ne 5184 -and $frontDoorTarget.port -eq $hostState.port) 'production host was not staged on an internal port'
    Assert-True ($frontDoorTarget.releaseId -eq $hostState.releaseId -and $frontDoorTarget.instanceId -eq $hostState.instanceId) 'front door target does not identify the active host'
    $frontDoorCommittedTarget = Read-OptimizationFrontDoorTarget -Path $frontDoorCommittedTargetPath
    Assert-True ($frontDoorCommittedTarget.releaseId -eq $frontDoorTarget.releaseId -and $frontDoorCommittedTarget.instanceId -eq $frontDoorTarget.instanceId -and $frontDoorCommittedTarget.port -eq $frontDoorTarget.port) 'front door committed target does not identify the active host'
    Assert-True ($active.releaseRoot -like '*\.codex\releases\optimization\*') 'active release is not versioned under the optimization release root'
    Assert-True ($active.distRoot -ne (Join-Path $projectRoot 'dist')) 'active host still points at projectRoot dist'
    # The instance directory is disposable; the stable profile authority
    # lease is the one that gates Host lifetime and promotion.
    $profileLeasePath = [string]$hostState.applicationProfileAuthorityRoot + '.read-web-path.lock'
    Assert-True (Test-Path -LiteralPath $profileLeasePath -PathType Container) 'active Host did not receive an application profile lease'
    $applicationProfileDir = [string]$hostState.applicationProfileDir
    $applicationProfilePath = Join-Path $applicationProfileDir 'browser-profile.json'
    Assert-True ($applicationProfileDir -eq (Join-Path ([string]$hostState.applicationIsolationRoot) 'profile')) 'active Host profile directory is not under its owned isolation root'
    Assert-True ($applicationProfileDir.StartsWith($applicationInstancesRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'active Host profile directory escaped the optimization application root'
    Assert-True (Test-Path -LiteralPath $applicationProfilePath -PathType Leaf) 'real launcher did not initialize the new instance browser profile'
    $applicationProfile = Read-OptimizationJsonFile -Path $applicationProfilePath
    Assert-True ([int]$applicationProfile.schemaVersion -eq 1 -and @($applicationProfile.indexedDbRows).Count -eq 0 -and @($applicationProfile.localStorage.PSObject.Properties).Count -eq 0) 'real launcher initialized a non-empty or unsupported Host candidate profile'
    $baselineIsolationInstanceIds = @(Get-ChildItem -LiteralPath $applicationInstancesRoot -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    $hostHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 5
    $workflowHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/health' -TimeoutSec 5
    $capabilityHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8776/api/app/health' -TimeoutSec 5
    Assert-True ($hostHealth.status -eq 'ready' -and $hostHealth.distReady) 'real production host is not ready'
    Assert-True ($hostHealth.profileEvidenceReady -eq $true) 'real launcher profile evidence is not ready after empty candidate initialization'
    Assert-True ($hostHealth.profileEvidenceMode -eq 'empty-host-candidate' -and $hostHealth.legacyBrowserData -eq 'not-read') 'real launcher health did not distinguish the empty Host candidate from legacy browser data'
    Assert-True ($hostHealth.durableOwnerReady -eq $false -and $hostHealth.acceptingApiAuthoritativeOperations -eq $false) 'pre-cutover Host candidate advertised durable owner authority'
    $ownerEnvelope = @{
      contractVersion = 'windows-thin-reader-api.v1'
      requestId = 'optimization-launcher-owner-request'
      correlationId = 'optimization-launcher-owner-correlation'
      kind = 'query'
      domain = 'reader-session'
      operation = 'snapshot'
      capability = 'reader-session.query'
      payload = @{ profileId = [string]$hostState.profileId; instanceId = [string]$hostState.instanceId }
    } | ConvertTo-Json -Compress -Depth 10
    $ownerStatus = 0
    try {
      $ownerResponse = Invoke-WebRequest `
        -Method Post `
        -Uri "http://127.0.0.1:$($hostState.port)/api/app/owner/command" `
        -Headers @{ 'X-Read-Web-Token' = (Read-OptimizationRuntimeText -Path $tokenPath).Trim() } `
        -ContentType 'application/json' `
        -Body $ownerEnvelope `
        -UseBasicParsing `
        -TimeoutSec 5
      $ownerStatus = [int]$ownerResponse.StatusCode
    } catch {
      if ($null -ne $_.Exception.Response) { $ownerStatus = [int]$_.Exception.Response.StatusCode.value__ }
      else { throw }
    }
    Assert-True ($ownerStatus -eq 503) 'pre-cutover owner command was not rejected with 503'
    Assert-True ($workflowHealth.status -eq 'ok' -and $workflowHealth.dataRoot -eq 'E:\ReadWebData\SubtitleWorkflow-Optimization') 'workflow health does not use optimization data root'
    Assert-True ($capabilityHealth.status -eq 'ready') 'capability sidecar is not ready'
    Assert-True ($hostHealth.releaseId -eq $hostState.releaseId -and $hostHealth.instanceId -eq $hostState.instanceId) 'host health identity does not match owned state'
    Assert-True ($capabilityHealth.releaseId -eq $hostState.releaseId -and $capabilityHealth.instanceId -eq $hostState.instanceId) 'capability health identity does not match owned state'
    Assert-True ((Get-TreeFingerprint -Path (Join-Path $projectRoot 'dist')) -eq $projectDistFingerprint) 'launcher staging build modified projectRoot dist'

    $initialFrontDoorStateRaw = Read-OptimizationRuntimeText -Path $frontDoorStatePath
    $initialTokenRaw = Read-OptimizationRuntimeText -Path $tokenPath
    $initialFrontDoorPid = [int]$frontDoorState.pid
    try {
      $missingIdentityState = $frontDoorState | ConvertTo-Json -Depth 20 | ConvertFrom-Json
      $missingIdentityState.PSObject.Properties.Remove('executableIdentity')
      Write-OptimizationRuntimeJsonAtomic -Path $frontDoorStatePath -Value $missingIdentityState
      $missingIdentityFailure = $false
      try {
        Invoke-Launcher `
          -Arguments @('-NoOpen') `
          -EnvironmentOverrides @{ READ_WEB_OPTIMIZATION_TEST_FAILURE = 'front-door' } | Out-Null
      } catch { $missingIdentityFailure = $true }
      Assert-True $missingIdentityFailure 'front-door candidate failure with missing executable identity was not observable'
      $missingIdentityStateAfter = Read-OptimizationJsonFile -Path $frontDoorStatePath
      $missingIdentityHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/front-door-process-health' -TimeoutSec 5
      Assert-True ($missingIdentityStateAfter.pid -eq $initialFrontDoorPid -and $missingIdentityHealth.status -eq 'ready') 'missing front-door identity candidate failure interrupted the old process'
      Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/') -eq 200) 'missing front-door identity candidate failure interrupted the stable service'
      Assert-True ((Read-OptimizationRuntimeText -Path $tokenPath) -eq $initialTokenRaw) 'missing front-door identity candidate failure changed the old service token'
    } finally {
      Restore-OptimizationRuntimeSnapshot -Path $frontDoorStatePath -Snapshot $initialFrontDoorStateRaw
    }

    # Keep the manager state intact while making the already-running front
    # door omit its health executable identity.  The launcher must treat this
    # as an identity mismatch and preflight the replacement on an alternate
    # port before it can touch the old 5184 process.
    $healthOnlyInitialStateRaw = Read-OptimizationRuntimeText -Path $frontDoorStatePath
    $healthOnlyInitialTokenRaw = Read-OptimizationRuntimeText -Path $tokenPath
    $healthOnlyInitialPid = [int](Read-OptimizationJsonFile -Path $frontDoorStatePath).pid
    $healthOnlyInitialIndex = (Invoke-WebRequest -Uri 'http://127.0.0.1:5184/' -UseBasicParsing -TimeoutSec 5).Content
    try {
      [IO.File]::WriteAllText($frontDoorHealthIdentityTestPath, 'omit', [Text.UTF8Encoding]::new($false))
      $healthOnlyProcessHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/front-door-process-health' -TimeoutSec 5
      Assert-True (-not (Get-OptimizationObjectText -Object $healthOnlyProcessHealth -Name 'executableIdentity')) 'health-only identity injection did not omit executableIdentity'
      $healthOnlyFailure = $false
      try {
        Invoke-Launcher `
          -Arguments @('-NoOpen') `
          -EnvironmentOverrides @{ READ_WEB_OPTIMIZATION_TEST_FAILURE = 'front-door-health-identity' } | Out-Null
      } catch { $healthOnlyFailure = $true }
      Assert-True $healthOnlyFailure 'front-door candidate failure with health-only identity mismatch was not observable'
      $healthOnlyStateAfter = Read-OptimizationJsonFile -Path $frontDoorStatePath
      $healthOnlyProcessHealthAfter = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/front-door-process-health' -TimeoutSec 5
      Assert-True ($healthOnlyStateAfter.pid -eq $healthOnlyInitialPid -and -not (Get-OptimizationObjectText -Object $healthOnlyProcessHealthAfter -Name 'executableIdentity')) 'health-only identity candidate failure interrupted the old process'
      $healthOnlyIndexAfter = (Invoke-WebRequest -Uri 'http://127.0.0.1:5184/' -UseBasicParsing -TimeoutSec 5).Content
      Assert-True ($healthOnlyIndexAfter -eq $healthOnlyInitialIndex) 'health-only identity candidate failure changed the stable index response'
      Assert-True ((Read-OptimizationRuntimeText -Path $tokenPath) -eq $healthOnlyInitialTokenRaw) 'health-only identity candidate failure changed the old service token'
    } finally {
      if (Test-Path -LiteralPath $frontDoorHealthIdentityTestPath) { Remove-Item -LiteralPath $frontDoorHealthIdentityTestPath -Force -ErrorAction SilentlyContinue }
      Restore-OptimizationRuntimeSnapshot -Path $frontDoorStatePath -Snapshot $healthOnlyInitialStateRaw
    }

    $frontDoorTargetRaw = Read-OptimizationRuntimeText -Path $frontDoorTargetPath
    $activationJournalRaw = Read-OptimizationRuntimeText -Path $activationJournalPath
    try {
      $invalidTargets = @(
        @{ name = 'missing target'; value = $null },
        @{ name = 'malformed target'; value = '{not-json' },
        @{ name = 'empty release identity'; value = (ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = [int]$hostState.port; releaseId = ''; profileId = 'optimization'; instanceId = [string]$hostState.instanceId }) },
        @{ name = 'empty profile identity'; value = (ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = [int]$hostState.port; releaseId = [string]$hostState.releaseId; profileId = ''; instanceId = [string]$hostState.instanceId }) },
        @{ name = 'empty instance identity'; value = (ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = [int]$hostState.port; releaseId = [string]$hostState.releaseId; profileId = 'optimization'; instanceId = '' }) },
        @{ name = 'profile mismatch'; value = (ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = [int]$hostState.port; releaseId = [string]$hostState.releaseId; profileId = 'wrong-profile'; instanceId = [string]$hostState.instanceId }) },
        @{ name = 'release mismatch'; value = (ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = [int]$hostState.port; releaseId = 'wrong-release'; profileId = 'optimization'; instanceId = [string]$hostState.instanceId }) },
        @{ name = 'instance mismatch'; value = (ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = [int]$hostState.port; releaseId = [string]$hostState.releaseId; profileId = 'optimization'; instanceId = 'wrong-instance' }) },
        @{ name = 'reserved target port'; value = (ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = 5174; releaseId = [string]$hostState.releaseId; profileId = 'optimization'; instanceId = [string]$hostState.instanceId }) },
        @{ name = 'front door self-target port'; value = (ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = 5184; releaseId = [string]$hostState.releaseId; profileId = 'optimization'; instanceId = [string]$hostState.instanceId }) },
        @{ name = 'capability self-target port'; value = (ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = 8776; releaseId = [string]$hostState.releaseId; profileId = 'optimization'; instanceId = [string]$hostState.instanceId }) }
      )
      foreach ($invalidTarget in $invalidTargets) {
        if ($null -eq $invalidTarget.value) { Remove-Item -LiteralPath $frontDoorTargetPath -Force }
        else { [IO.File]::WriteAllText($frontDoorTargetPath, [string]$invalidTarget.value, [Text.UTF8Encoding]::new($false)) }
        Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/api/app/front-door-health') -eq 503) "$($invalidTarget.name) was reported ready"
        Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/') -eq 503) "$($invalidTarget.name) was proxied"
      }
      $pendingTarget = ConvertTo-Json @{ status = 'active'; host = '127.0.0.1'; port = 59999; releaseId = 'pending-release'; profileId = 'optimization'; instanceId = 'pending-instance' }
      $pendingJournal = ConvertTo-Json @{ schemaVersion = 1; status = 'switching'; phase = 'target-switched'; profileId = 'optimization'; newReleaseId = 'pending-release'; newInstanceId = 'pending-instance'; newHostPort = 59999 }
      [IO.File]::WriteAllText($frontDoorTargetPath, $pendingTarget, [Text.UTF8Encoding]::new($false))
      [IO.File]::WriteAllText($activationJournalPath, $pendingJournal, [Text.UTF8Encoding]::new($false))
      Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/api/app/front-door-health') -eq 503) 'an in-flight activation target was reported ready'
      Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/') -eq 503) 'an in-flight activation target was proxied'
    } finally {
      Restore-OptimizationRuntimeSnapshot -Path $frontDoorTargetPath -Snapshot $frontDoorTargetRaw
      Restore-OptimizationRuntimeSnapshot -Path $activationJournalPath -Snapshot $activationJournalRaw
    }
    Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/api/app/front-door-health') -eq 200) 'valid target did not recover front-door health'

    $stagedBuildFailed = $false
    try {
      New-OptimizationReleaseStaging `
        -ProjectRoot $projectRoot `
        -WorkflowRoot $workflowRoot `
        -RuntimeConfigPath $runtimeConfigPath `
        -CapabilityScript $capabilityScript `
        -BackupScript $backupScript `
        -StagingRoot (Join-Path $projectRoot '.codex\release-staging\optimization') `
        -ReleaseRoot (Join-Path $projectRoot '.codex\releases\optimization') `
        -NpmPath $npmPath `
        -NodePath $nodePath `
        -ReleaseHealthScript $releaseHealthScript `
        -ProfileId 'optimization' `
        -FrontendHost '127.0.0.1' `
        -FrontendPort 5184 `
        -BackendHost '127.0.0.1' `
        -BackendPort 8776 `
        -DataRoot 'E:\ReadWebData\SubtitleWorkflow-Optimization' `
        -BuildAction { param($unusedNpm, $unusedDist) throw 'synthetic active-release staging failure' } | Out-Null
    } catch { $stagedBuildFailed = $true }
    Assert-True $stagedBuildFailed 'active-release staging failure must be observable'
    $healthAfterStagingFailure = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 5
    $stateAfterStagingFailure = Read-OptimizationJsonFile -Path $hostStatePath
    Assert-True ($healthAfterStagingFailure.status -eq 'ready' -and $healthAfterStagingFailure.releaseId -eq $hostState.releaseId -and $healthAfterStagingFailure.instanceId -eq $hostState.instanceId) 'staging failure interrupted the active host'
    Assert-True ($stateAfterStagingFailure.pid -eq $hostState.pid) 'staging failure changed the active host PID'

    $firstPid = $hostState.pid
    $firstCapabilityPid = $capabilityState.pid
    $firstInstance = $hostState.instanceId
    $firstRelease = $hostState.releaseId
    $firstReleaseRoot = [string]$active.releaseRoot
    Assert-True (Test-Path -LiteralPath $firstReleaseRoot -PathType Container) 'active immutable release directory is missing before failure matrix'
    $activeSnapshot = Read-OptimizationRuntimeText -Path (Join-Path $stateRoot 'active-release.json')
    $targetSnapshot = Read-OptimizationRuntimeText -Path $frontDoorTargetPath
    $committedTargetSnapshot = Read-OptimizationRuntimeText -Path $frontDoorCommittedTargetPath
    $tokenSnapshot = Read-OptimizationRuntimeText -Path $tokenPath
    $hostSnapshot = Read-OptimizationRuntimeText -Path $hostStatePath
    $validPendingJournal = ConvertTo-Json @{
      schemaVersion = 1
      status = 'switching'
      phase = 'target-switched'
      profileId = 'optimization'
      oldTargetSnapshot = $targetSnapshot
      oldActiveReleaseSnapshot = $activeSnapshot
      oldActiveHostSnapshot = $hostSnapshot
      newReleaseId = 'pending-release'
      newInstanceId = 'pending-instance'
      newHostPort = 59999
    } -Depth 8
    try {
      Remove-Item -LiteralPath $frontDoorTargetPath -Force
      [IO.File]::WriteAllText($activationJournalPath, $validPendingJournal, [Text.UTF8Encoding]::new($false))
      Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/api/app/front-door-health') -eq 503) 'missing target was reported ready despite an activation journal'
      Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/') -eq 503) 'missing target was proxied despite an activation journal'
      [IO.File]::WriteAllText($frontDoorTargetPath, '{not-json', [Text.UTF8Encoding]::new($false))
      Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/api/app/front-door-health') -eq 503) 'malformed target was reported ready despite an activation journal'
      Assert-True ((Get-HttpStatus -Url 'http://127.0.0.1:5184/') -eq 503) 'malformed target was proxied despite an activation journal'
    } finally {
      Restore-OptimizationRuntimeSnapshot -Path $frontDoorTargetPath -Snapshot $targetSnapshot
      Restore-OptimizationRuntimeSnapshot -Path $activationJournalPath -Snapshot $activationJournalRaw
    }
    $activePointerRecoveryVerified = $false
    $promotionFailureRecoveryVerified = $false
    foreach ($failureKind in @('capability', 'host', 'readiness', 'promotion', 'active-pointer', 'host-state', 'switch', 'front-door')) {
      $failureObserved = $false
      try {
        Invoke-Launcher `
          -Arguments @('-NoOpen') `
          -EnvironmentOverrides @{ READ_WEB_OPTIMIZATION_TEST_FAILURE = $failureKind } | Out-Null
      } catch { $failureObserved = $true }
      Assert-True $failureObserved "synthetic $failureKind failure was not observable"
      # Promotion and active-pointer failures can stop the old Host before
      # the recovery path restarts it.  The handoff window may therefore be
      # briefly unavailable; wait for the durable old identity to return
      # instead of requiring continuous readiness or the original PID.
      $preservedHealthStatus = Get-HttpStatus -Url 'http://127.0.0.1:5184/api/app/health'
      Assert-True ($preservedHealthStatus -in @(200, 503)) "$failureKind failure returned an unexpected Host status during recovery: $preservedHealthStatus"
      $preservedHealth = Wait-OptimizationHttpJson `
        -Url 'http://127.0.0.1:5184/api/app/health' `
        -TimeoutSeconds 15 `
        -Predicate {
          param($value)
          $value.status -eq 'ready' `
            -and $value.releaseId -eq $firstRelease `
            -and $value.profileId -eq 'optimization' `
            -and $value.instanceId -eq $firstInstance `
            -and $value.profileLeaseMode -eq 'authoritative' `
            -and $value.profileLeaseReady -eq $true `
            -and $value.profileLeaseAlive -eq $true
        }
      Assert-True ($null -ne $preservedHealth) "$failureKind failure did not restore the old stable service"
      $preservedHost = Read-OptimizationJsonFile -Path $hostStatePath
      $preservedFrontDoor = Read-OptimizationJsonFile -Path $frontDoorStatePath
      $preservedTarget = Read-OptimizationRuntimeText -Path $frontDoorTargetPath
      $preservedActive = Read-OptimizationRuntimeText -Path (Join-Path $stateRoot 'active-release.json')
      Assert-True ($null -ne $preservedHost `
        -and $preservedHost.releaseId -eq $firstRelease `
        -and $preservedHost.profileId -eq 'optimization' `
        -and $preservedHost.instanceId -eq $firstInstance `
        -and [int]$preservedHost.port -ne 5184) "$failureKind failure changed the active Host identity"
      $preservedManagerPath = [string]$preservedHost.managerStatePath
      Assert-True ($preservedManagerPath -and (Test-Path -LiteralPath $preservedManagerPath -PathType Leaf)) "$failureKind failure did not restore the active Host manager path"
      $preservedManagerState = Read-OptimizationJsonFile -Path $preservedManagerPath
      Assert-True ($null -ne $preservedManagerState `
        -and $preservedManagerState.releaseId -eq $firstRelease `
        -and $preservedManagerState.profileId -eq 'optimization' `
        -and $preservedManagerState.instanceId -eq $firstInstance `
        -and [int]$preservedManagerState.pid -gt 0) "$failureKind failure did not restore a live old Host manager state"
      Assert-True ([IO.Path]::GetFullPath([string]$preservedHost.managerStatePath) -eq [IO.Path]::GetFullPath($preservedManagerPath) `
        -and [int]$preservedHost.pid -eq [int]$preservedManagerState.pid `
        -and [string]$preservedHost.processStartUtc -eq [string]$preservedManagerState.processStartUtc `
        -and [string]$preservedHost.startedAtUtc -eq [string]$preservedManagerState.startedAtUtc) "$failureKind failure left an active Host descriptor inconsistent with its current manager receipt"
      $preservedAuthorityRoot = Get-OptimizationObjectText -Object $preservedManagerState -Name 'applicationProfileAuthorityRoot'
      Assert-True ($preservedAuthorityRoot -and (Test-Path -LiteralPath "$preservedAuthorityRoot.read-web-path.lock" -PathType Container)) "$failureKind failure did not restore the stable profile lease"
      $preservedFrontDoorHealthStatus = Get-HttpStatus -Url 'http://127.0.0.1:5184/api/app/front-door-process-health'
      Assert-True ($preservedFrontDoorHealthStatus -in @(200, 503)) "$failureKind failure returned an unexpected front-door process status: $preservedFrontDoorHealthStatus"
      $preservedFrontDoorHealth = Wait-OptimizationHttpJson `
        -Url 'http://127.0.0.1:5184/api/app/front-door-process-health' `
        -TimeoutSeconds 15 `
        -Predicate { param($value) $value.status -eq 'ready' }
      Assert-True ($null -ne $preservedFrontDoor -and $null -ne $preservedFrontDoorHealth -and [int]$preservedFrontDoor.pid -gt 0) "$failureKind failure interrupted the stable front door process"
      Assert-True ($preservedTarget -eq $targetSnapshot) "$failureKind failure changed the active front door target"
      Assert-True ((Read-OptimizationRuntimeText -Path $frontDoorCommittedTargetPath) -eq $committedTargetSnapshot) "$failureKind failure changed the committed front door target"
      Assert-True ((Read-OptimizationRuntimeText -Path $tokenPath) -eq $tokenSnapshot) "$failureKind failure changed the existing Host service token"
      Assert-True ($preservedActive -eq $activeSnapshot) "$failureKind failure changed the active release pointer"
      Assert-True (Test-Path -LiteralPath $firstReleaseRoot -PathType Container) "$failureKind failure removed the old immutable release"
      $currentActiveManagerPath = [IO.Path]::GetFullPath($preservedManagerPath)
      $pendingHostStates = @(Get-ChildItem -LiteralPath $stateRoot -Filter 'production-host-*.json' -File -ErrorAction SilentlyContinue | Where-Object { [IO.Path]::GetFullPath($_.FullName) -ne $currentActiveManagerPath })
      Assert-True ($pendingHostStates.Count -eq 0) "$failureKind failure left a pending host state"
      Assert-True (@(Get-ChildItem -LiteralPath $stateRoot -Filter '*.json.lock' -File -ErrorAction SilentlyContinue).Count -eq 0) "$failureKind failure left a stale launcher lock"
      $newIsolationRoots = @(Get-ChildItem -LiteralPath $applicationInstancesRoot -Force -ErrorAction SilentlyContinue | Where-Object { $baselineIsolationInstanceIds -notcontains $_.Name })
      Assert-True ($newIsolationRoots.Count -eq 0) "$failureKind failure left a pending application profile lease (baseline=$($baselineIsolationInstanceIds.Count), new=$(($newIsolationRoots | ForEach-Object { $_.Name }) -join ','))"
      if ($failureKind -eq 'active-pointer') { $activePointerRecoveryVerified = $true }
      if ($failureKind -eq 'promotion') { $promotionFailureRecoveryVerified = $true }
    }
    Assert-True $activePointerRecoveryVerified 'real launcher did not exercise authoritative replacement failure before committed-target publication'
    Assert-True $promotionFailureRecoveryVerified 'real launcher did not exercise standby promotion failure recovery'

    # commit-pointer is last because its forward recovery intentionally makes
    # the replacement pair the new active baseline.
    $expectedReuseHostPid = $firstPid
    $expectedReuseCapabilityPid = $firstCapabilityPid
    $expectedReuseInstanceId = $firstInstance
    $expectedReuseCapabilityInstanceId = $firstInstance
    $expectedReuseReleaseId = $firstRelease
    foreach ($crashPhase in @('target', 'active-release', 'active-host', 'host-process-started', 'commit-pointer')) {
      $crashObserved = $false
      $crashError = ''
      try {
        Invoke-Launcher `
          -Arguments @('-NoOpen') `
          -EnvironmentOverrides @{ READ_WEB_OPTIMIZATION_TEST_KILL_PHASE = $crashPhase } | Out-Null
      } catch { $crashObserved = $true; $crashError = $_.Exception.Message }
      Assert-True $crashObserved "forced launcher termination at $crashPhase was not observable ($crashError)"

      # Recovery is intentionally not invoked yet. A pending journal may
      # leave the handoff window temporarily unavailable while the old pair
      # is being drained, but it must never publish an uncommitted candidate.
      # The old crash contract required continuous 200/ready responses and
      # the old PID; that is incompatible with stop-old -> promote-new
      # stable-profile leasing. Observe the allowed 200/503 boundary and
      # validate identity only when an endpoint is actually ready.
      $preRecoveryFrontDoorStatus = Get-HttpStatus -Url 'http://127.0.0.1:5184/api/app/front-door-health'
      $preRecoveryFrontDoorHealth = $null
      $preRecoveryHealthStatus = Get-HttpStatus -Url 'http://127.0.0.1:5184/api/app/health'
      $preRecoveryHealth = $null
      if ($crashPhase -eq 'commit-pointer') {
        $commitPointerJournal = Read-OptimizationJsonFile -Path $activationJournalPath
        $commitPointerTarget = Read-OptimizationFrontDoorTarget -Path $frontDoorCommittedTargetPath
        Assert-True ($preRecoveryFrontDoorStatus -eq 200) 'commit-pointer crash did not keep the durably committed front door available'
        Assert-True ($preRecoveryHealthStatus -eq 200) 'commit-pointer crash did not keep the durably committed Host available'
        $preRecoveryFrontDoorHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/front-door-health' -TimeoutSec 5
        $preRecoveryHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 5
        Assert-True ($null -ne $commitPointerJournal -and $commitPointerJournal.status -eq 'committed') 'commit-pointer crash left a rollbackable activation journal'
        Assert-True ($null -ne $commitPointerTarget `
          -and $commitPointerTarget.releaseId -eq $commitPointerJournal.newReleaseId `
          -and $commitPointerTarget.instanceId -eq $commitPointerJournal.newInstanceId `
          -and $preRecoveryFrontDoorHealth.status -eq 'ready' `
          -and $preRecoveryFrontDoorHealth.target.releaseId -eq $commitPointerTarget.releaseId `
          -and $preRecoveryFrontDoorHealth.target.instanceId -eq $commitPointerTarget.instanceId `
          -and $preRecoveryFrontDoorHealth.commitVisibility.status -eq 'committed' `
          -and $preRecoveryHealth.status -eq 'ready' `
          -and $preRecoveryHealth.releaseId -eq $commitPointerTarget.releaseId `
          -and $preRecoveryHealth.instanceId -eq $commitPointerTarget.instanceId) 'commit-pointer crash did not expose the durably committed replacement'
      } else {
        Assert-True ($preRecoveryFrontDoorStatus -in @(200, 503)) "$crashPhase returned an unexpected front-door status during handoff: $preRecoveryFrontDoorStatus"
        Assert-True ($preRecoveryHealthStatus -in @(200, 503)) "$crashPhase returned an unexpected Host status during handoff: $preRecoveryHealthStatus"
        if ($preRecoveryFrontDoorStatus -eq 200) {
          $preRecoveryFrontDoorHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/front-door-health' -TimeoutSec 5
          Assert-True ($preRecoveryFrontDoorHealth.status -eq 'ready' `
            -and $preRecoveryFrontDoorHealth.target.releaseId -eq $firstRelease `
            -and $preRecoveryFrontDoorHealth.target.instanceId -eq $firstInstance `
            -and $preRecoveryFrontDoorHealth.commitVisibility.status -eq 'previous-release') "$crashPhase exposed a non-committed target through a ready front door (old=$firstRelease/$firstInstance, target=$($preRecoveryFrontDoorHealth.target.releaseId)/$($preRecoveryFrontDoorHealth.target.instanceId), visibility=$($preRecoveryFrontDoorHealth.commitVisibility.status), journalPresent=$(Test-Path -LiteralPath $activationJournalPath), journal=$(Get-OptimizationObjectText -Object (Read-OptimizationJsonFile -Path $activationJournalPath) -Name 'phase'), launcherError=$crashError)"
        }
        if ($preRecoveryHealthStatus -eq 200) {
          $preRecoveryHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 5
          Assert-True ($preRecoveryHealth.status -eq 'ready' -and $preRecoveryHealth.releaseId -eq $firstRelease -and $preRecoveryHealth.instanceId -eq $firstInstance) "$crashPhase exposed an uncommitted candidate through the front door"
        }
      }
      $preRecoveryIndexStatus = Get-HttpStatus -Url 'http://127.0.0.1:5184/'
      Assert-True ($preRecoveryIndexStatus -in @(200, 503)) "$crashPhase returned an unexpected index status during handoff: $preRecoveryIndexStatus"
      $interruptedJournal = Read-OptimizationJsonFile -Path $activationJournalPath
      $interruptedCandidatePort = 0
      [int]::TryParse((Get-OptimizationObjectText -Object $interruptedJournal -Name 'newHostPort'), [ref]$interruptedCandidatePort) | Out-Null
      Assert-True ($null -ne $interruptedJournal -and (Get-OptimizationObjectText -Object $interruptedJournal -Name 'newInstanceId')) "$crashPhase did not leave a recoverable activation receipt"
      if ($crashPhase -eq 'host-process-started') {
        $interruptedStatePath = Get-OptimizationObjectText -Object $interruptedJournal -Name 'newHostManagerStatePath'
        $interruptedIntentPath = Get-OptimizationObjectText -Object $interruptedJournal -Name 'newHostLaunchIntentPath'
        Assert-True (-not (Test-Path -LiteralPath $interruptedStatePath -PathType Leaf)) 'process-start boundary unexpectedly wrote manager state before forced termination'
        Assert-True (Test-Path -LiteralPath $interruptedIntentPath -PathType Leaf) 'process-start boundary did not retain its launch intent receipt'
      }

      Invoke-Launcher -Arguments @('-NoOpen') | Out-Null
      $recoveredHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 5
      $recoveredHost = Read-OptimizationJsonFile -Path $hostStatePath
      $recoveredManagerPath = [string]$recoveredHost.managerStatePath
      Assert-True ($recoveredManagerPath -and (Test-Path -LiteralPath $recoveredManagerPath -PathType Leaf)) "$crashPhase recovery did not publish a managed Host state path"
      $recoveredManagerState = Read-OptimizationJsonFile -Path $recoveredManagerPath
      Assert-True ([IO.Path]::GetFullPath([string]$recoveredHost.managerStatePath) -eq [IO.Path]::GetFullPath($recoveredManagerPath) `
        -and [int]$recoveredHost.pid -eq [int]$recoveredManagerState.pid `
        -and [string]$recoveredHost.processStartUtc -eq [string]$recoveredManagerState.processStartUtc `
        -and [string]$recoveredHost.startedAtUtc -eq [string]$recoveredManagerState.startedAtUtc) "$crashPhase recovery left an active Host descriptor inconsistent with its current manager receipt"
      if ($crashPhase -eq 'commit-pointer') {
        Assert-True ($recoveredHealth.status -eq 'ready' -and $recoveredHealth.releaseId -eq $commitPointerTarget.releaseId -and $recoveredHealth.instanceId -eq $commitPointerTarget.instanceId) 'commit-pointer recovery rolled back a committed replacement'
        Assert-True ($recoveredHost.instanceId -eq $commitPointerTarget.instanceId -and $recoveredHost.releaseId -eq $commitPointerTarget.releaseId) 'commit-pointer recovery did not retain the committed Host'
        Assert-True ($recoveredManagerState.instanceId -eq $commitPointerTarget.instanceId -and $recoveredManagerState.releaseId -eq $commitPointerTarget.releaseId -and [int]$recoveredManagerState.pid -gt 0) 'commit-pointer recovery did not retain a live committed Host state'
        Assert-True ((Read-OptimizationRuntimeText -Path $frontDoorTargetPath) -eq (Read-OptimizationRuntimeText -Path $frontDoorCommittedTargetPath)) 'commit-pointer recovery left target and committed target divergent'
        Assert-True ((Read-OptimizationRuntimeText -Path (Join-Path $stateRoot 'active-release.json')) -match [regex]::Escape([string]$commitPointerTarget.releaseId)) 'commit-pointer recovery rolled back the active release'
        $committedCapabilityState = Read-OptimizationJsonFile -Path $capabilityStatePath
        Assert-True ($null -ne $committedCapabilityState) 'commit-pointer recovery lost the capability Host state'
        $expectedReuseHostPid = [int]$recoveredManagerState.pid
        $expectedReuseCapabilityPid = [int]$committedCapabilityState.pid
        $expectedReuseInstanceId = [string]$recoveredHost.instanceId
        $expectedReuseCapabilityInstanceId = [string]$committedCapabilityState.instanceId
        $expectedReuseReleaseId = [string]$recoveredHost.releaseId
      } else {
        Assert-True ($recoveredHealth.status -eq 'ready' -and $recoveredHealth.releaseId -eq $firstRelease -and $recoveredHealth.instanceId -eq $firstInstance) "$crashPhase recovery did not preserve the old service"
        # Recovery may restart the old pair and therefore receive new PIDs.
        # The durable contract is restoration of the old release/profile/
        # instance identity and re-acquisition of the stable profile lease.
        Assert-True ($recoveredHost.instanceId -eq $firstInstance -and $recoveredHost.releaseId -eq $firstRelease -and [int]$recoveredHost.port -ne 5184) "$crashPhase recovery changed the old Host identity"
        Assert-True ($recoveredManagerState.instanceId -eq $firstInstance -and $recoveredManagerState.releaseId -eq $firstRelease -and [int]$recoveredManagerState.pid -gt 0) "$crashPhase recovery did not restore a live old Host manager state"
        $recoveredAuthorityRoot = Get-OptimizationObjectText -Object $recoveredManagerState -Name 'applicationProfileAuthorityRoot'
        Assert-True ($recoveredAuthorityRoot -and $recoveredAuthorityRoot -eq (Get-OptimizationObjectText -Object $hostState -Name 'applicationProfileAuthorityRoot')) "$crashPhase recovery changed the stable profile authority identity"
        $recoveredLeasePath = "$recoveredAuthorityRoot.read-web-path.lock"
        Assert-True (Test-Path -LiteralPath $recoveredLeasePath -PathType Container) "$crashPhase recovery did not re-acquire the stable profile lease"
        Assert-True ((Read-OptimizationRuntimeText -Path $frontDoorTargetPath) -eq $targetSnapshot) "$crashPhase recovery changed the target snapshot"
        Assert-True ((Read-OptimizationRuntimeText -Path (Join-Path $stateRoot 'active-release.json')) -eq $activeSnapshot) "$crashPhase recovery changed the active-release snapshot"
        Assert-True ((Read-OptimizationRuntimeText -Path $frontDoorCommittedTargetPath) -eq $committedTargetSnapshot) "$crashPhase recovery changed the committed target snapshot"
        Assert-True ((Read-OptimizationRuntimeText -Path $tokenPath) -eq $tokenSnapshot) "$crashPhase recovery changed the existing Host service token"
        Assert-True ($recoveredHost.profileId -eq 'optimization' -and $recoveredHost.instanceId -eq $firstInstance -and $recoveredHost.releaseId -eq $firstRelease) "$crashPhase recovery changed the active-host identity"
        $recoveredCapabilityState = Read-OptimizationJsonFile -Path $capabilityStatePath
        Assert-True ($null -ne $recoveredCapabilityState -and $recoveredCapabilityState.profileId -eq 'optimization' -and $recoveredCapabilityState.instanceId -eq $firstInstance -and $recoveredCapabilityState.releaseId -eq $firstRelease -and [int]$recoveredCapabilityState.pid -gt 0) "$crashPhase recovery did not restore the old capability identity"
        $expectedReuseHostPid = [int]$recoveredManagerState.pid
        $expectedReuseCapabilityPid = [int]$recoveredCapabilityState.pid
        $expectedReuseInstanceId = [string]$recoveredHost.instanceId
        $expectedReuseCapabilityInstanceId = [string]$recoveredCapabilityState.instanceId
        $expectedReuseReleaseId = [string]$recoveredHost.releaseId
      }
      Assert-True (-not (Test-Path -LiteralPath (Join-Path $stateRoot 'activation-journal.json'))) "$crashPhase recovery left an activation journal"
      $currentRecoveredManagerPath = [IO.Path]::GetFullPath($recoveredManagerPath)
      $pendingRecoveredHostStates = @(Get-ChildItem -LiteralPath $stateRoot -Filter 'production-host-*.json' -File -ErrorAction SilentlyContinue | Where-Object { [IO.Path]::GetFullPath($_.FullName) -ne $currentRecoveredManagerPath })
      Assert-True ($pendingRecoveredHostStates.Count -eq 0) "$crashPhase recovery left a pending Host state"
      Assert-True (@(Get-ChildItem -LiteralPath $stateRoot -Filter '*.json.lock' -File -ErrorAction SilentlyContinue).Count -eq 0) "$crashPhase recovery left a stale launcher lock"
      if ($crashPhase -eq 'host-process-started' -and $interruptedCandidatePort -gt 0) {
        Assert-True (Wait-OptimizationTcpPortFree -Port $interruptedCandidatePort -TimeoutSeconds 5) 'process-start boundary recovery left an orphan Host port occupied'
      }
      $currentActiveIsolationRoot = Get-OptimizationObjectText -Object $recoveredManagerState -Name 'applicationIsolationRoot'
      Assert-True ($currentActiveIsolationRoot) "$crashPhase recovery did not publish the active application isolation root"
      $resolvedApplicationInstancesRoot = [IO.Path]::GetFullPath($applicationInstancesRoot).TrimEnd('\', '/')
      $resolvedCurrentActiveIsolationRoot = [IO.Path]::GetFullPath($currentActiveIsolationRoot).TrimEnd('\', '/')
      Assert-True ($resolvedCurrentActiveIsolationRoot.StartsWith("$resolvedApplicationInstancesRoot\", [StringComparison]::OrdinalIgnoreCase)) "$crashPhase recovery published an active application root outside the optimization instances root"
      $currentActiveInstanceName = Split-Path -Leaf $resolvedCurrentActiveIsolationRoot
      Assert-True ($currentActiveInstanceName) "$crashPhase recovery published an empty active application instance identity"
      # The recovered manager receipt identifies the sole active instance:
      # rollback points back to the old baseline, while committed
      # forward-recovery points to the new committed instance.  Permit only
      # that one directory so an uncleared old/candidate/orphan instance is
      # observable rather than hidden by a historical baseline allow-list.
      $allowedIsolationInstanceIds = @($currentActiveInstanceName)
      $newIsolationRoots = @(Get-ChildItem -LiteralPath $applicationInstancesRoot -Force -ErrorAction SilentlyContinue | Where-Object { $allowedIsolationInstanceIds -notcontains $_.Name })
      Assert-True ($newIsolationRoots.Count -eq 0) "$crashPhase recovery left a pending application profile lease (allowed=$($allowedIsolationInstanceIds -join ','), new=$(($newIsolationRoots | ForEach-Object { $_.Name }) -join ','))"
    }

    $reuseOutput = Invoke-Launcher -Arguments @('-NoOpen')
    Assert-True ($reuseOutput -match 'Reusing optimization production host') 'second real launcher invocation did not reuse the active pair'
    $reusedHostState = Read-OptimizationJsonFile -Path $hostStatePath
    $reusedCapabilityState = Read-OptimizationJsonFile -Path $capabilityStatePath
    Assert-True ($reusedHostState.pid -eq $expectedReuseHostPid -and $reusedCapabilityState.pid -eq $expectedReuseCapabilityPid) 'reuse changed an owned process PID'
    Assert-True ($reusedHostState.instanceId -eq $expectedReuseInstanceId -and $reusedCapabilityState.instanceId -eq $expectedReuseCapabilityInstanceId) 'reuse changed the instance identity'
    Assert-True ($reusedHostState.releaseId -eq $expectedReuseReleaseId) 'reuse changed the active host descriptor'
    Write-Host 'real optimization launcher start/health/reuse and failure preservation passed'
  } finally {
    if ($started) { Invoke-Launcher -Arguments @('-Stop', '-NoOpen') | Out-Null }
  }
  Assert-True (-not (Test-Path -LiteralPath $hostStatePath)) 'stop left production host state'
  Assert-True (-not (Test-Path -LiteralPath $capabilityStatePath)) 'stop left capability state'
  Assert-True (-not (Test-Path -LiteralPath $frontDoorStatePath)) 'stop left front door state'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $stateRoot 'active-release.json'))) 'stop left active release pointer'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $stateRoot 'release-manifest.json'))) 'stop left legacy release manifest'
  Assert-True (@(Get-ChildItem -LiteralPath $stateRoot -Filter 'production-host-*.json' -File -ErrorAction SilentlyContinue).Count -eq 0) 'stop left pending host states'
  Assert-True (-not (Test-Path -LiteralPath $tokenPath)) 'stop left instance token'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $stateRoot 'activation-journal.json'))) 'stop left activation journal'
  Assert-True (-not (Test-Path -LiteralPath $frontDoorTargetPath)) 'stop left a front door target pointer'
  Assert-True (-not (Test-Path -LiteralPath $frontDoorCommittedTargetPath)) 'stop left a committed front door target pointer'
  Assert-True (@(Get-ChildItem -LiteralPath $stateRoot -Filter '*.json.lock' -File -ErrorAction SilentlyContinue).Count -eq 0) 'stop left stale launcher locks'
  $newIsolationRoots = @(Get-ChildItem -LiteralPath $applicationInstancesRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $initialIsolationInstanceIds -notcontains $_.Name })
  Assert-True ($newIsolationRoots.Count -eq 0) "stop left a pending application profile lease (initial=$($initialIsolationInstanceIds.Count), new=$(($newIsolationRoots | ForEach-Object { $_.Name }) -join ','))"
  Assert-True (Wait-OptimizationTcpPortFree -Port 5184 -TimeoutSeconds 5) 'stop did not release port 5184'
  Assert-True (Wait-OptimizationTcpPortFree -Port 8776 -TimeoutSeconds 5) 'stop did not release port 8776'
}

Assert-ModuleReleaseFailureSafety
Assert-OptimizationConfigAndHealthSafety
Assert-RealLauncherLifecycle
Write-Host 'optimization launcher integration check passed'

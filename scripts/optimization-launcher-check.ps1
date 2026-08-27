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
$nodePath = (Get-Command node -ErrorAction Stop).Source
$npmPath = if ($null -ne (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { (Get-Command npm.cmd -ErrorAction Stop).Source } else { (Get-Command npm -ErrorAction Stop).Source }
$pythonPath = (Get-Command python -ErrorAction Stop).Source
$shellPath = switch ($PowerShellKind) {
  'powershell' { (Get-Command powershell -ErrorAction Stop).Source; break }
  'pwsh' { (Get-Command pwsh -ErrorAction Stop).Source; break }
  default {
    $preferred = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($null -ne $preferred) { $preferred.Source } else { (Get-Command powershell -ErrorAction Stop).Source }
  }
}

Import-Module (Join-Path $projectRoot 'scripts\launcher-instance-manager.psm1') -Force
Import-Module (Join-Path $projectRoot 'scripts\optimization-launch-runtime.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $projectRoot 'scripts\optimization-release.psm1') -Force -DisableNameChecking

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

    $lockChangedManifest = $oldRelease.manifest | ConvertTo-Json -Depth 30 | ConvertFrom-Json
    $lockChangedManifest.dependencyLocks.python.sha256 = ('e' * 64)
    $lockChangedKey = Get-OptimizationReleaseReuseKey -Release ([pscustomobject]@{ manifest = $lockChangedManifest })
    Assert-True ($lockChangedKey -and $lockChangedKey -ne $oldReuseKey) 'Python lock identity changed without changing the release reuse key'
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
    $profileLeasePath = [string]$hostState.applicationIsolationRoot + '.read-web-path.lock'
    Assert-True (Test-Path -LiteralPath $profileLeasePath -PathType Container) 'active Host did not receive an application profile lease'
    $baselineIsolationInstanceIds = @(Get-ChildItem -LiteralPath $applicationInstancesRoot -Force -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    $hostHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 5
    $workflowHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/health' -TimeoutSec 5
    $capabilityHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8776/api/app/health' -TimeoutSec 5
    Assert-True ($hostHealth.status -eq 'ready' -and $hostHealth.distReady) 'real production host is not ready'
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
    $firstFrontDoorPid = $frontDoorState.pid
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
    foreach ($failureKind in @('capability', 'host', 'readiness', 'active-pointer', 'host-state', 'switch', 'front-door')) {
      $failureObserved = $false
      try {
        Invoke-Launcher `
          -Arguments @('-NoOpen') `
          -EnvironmentOverrides @{ READ_WEB_OPTIMIZATION_TEST_FAILURE = $failureKind } | Out-Null
      } catch { $failureObserved = $true }
      Assert-True $failureObserved "synthetic $failureKind failure was not observable"
      $preservedHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 5
      $preservedHost = Read-OptimizationJsonFile -Path $hostStatePath
      $preservedFrontDoor = Read-OptimizationJsonFile -Path $frontDoorStatePath
      $preservedTarget = Read-OptimizationRuntimeText -Path $frontDoorTargetPath
      $preservedActive = Read-OptimizationRuntimeText -Path (Join-Path $stateRoot 'active-release.json')
      Assert-True ($preservedHealth.status -eq 'ready' -and $preservedHealth.releaseId -eq $firstRelease -and $preservedHealth.instanceId -eq $firstInstance) "$failureKind failure interrupted the old stable service"
      Assert-True ($preservedHost.pid -eq $firstPid -and $preservedHost.instanceId -eq $firstInstance) "$failureKind failure changed the active host state"
      $preservedFrontDoorHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/front-door-process-health' -TimeoutSec 5
      Assert-True ($preservedFrontDoor.pid -eq $firstFrontDoorPid -and $preservedFrontDoorHealth.status -eq 'ready') "$failureKind failure interrupted the stable front door process"
      Assert-True ($preservedTarget -eq $targetSnapshot) "$failureKind failure changed the active front door target"
      Assert-True ((Read-OptimizationRuntimeText -Path $frontDoorCommittedTargetPath) -eq $committedTargetSnapshot) "$failureKind failure changed the committed front door target"
      Assert-True ((Read-OptimizationRuntimeText -Path $tokenPath) -eq $tokenSnapshot) "$failureKind failure changed the existing Host service token"
      Assert-True ($preservedActive -eq $activeSnapshot) "$failureKind failure changed the active release pointer"
      Assert-True (Test-Path -LiteralPath $firstReleaseRoot -PathType Container) "$failureKind failure removed the old immutable release"
      $pendingHostStates = @(Get-ChildItem -LiteralPath $stateRoot -Filter 'production-host-*.json' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -ne $hostManagerPath })
      Assert-True ($pendingHostStates.Count -eq 0) "$failureKind failure left a pending host state"
      $newIsolationRoots = @(Get-ChildItem -LiteralPath $applicationInstancesRoot -Force -ErrorAction SilentlyContinue | Where-Object { $baselineIsolationInstanceIds -notcontains $_.Name })
      Assert-True ($newIsolationRoots.Count -eq 0) "$failureKind failure left a pending application profile lease (baseline=$($baselineIsolationInstanceIds.Count), new=$(($newIsolationRoots | ForEach-Object { $_.Name }) -join ','))"
    }

    foreach ($crashPhase in @('target', 'active-release', 'active-host', 'commit-pointer', 'host-process-started')) {
      $crashObserved = $false
      $crashError = ''
      try {
        Invoke-Launcher `
          -Arguments @('-NoOpen') `
          -EnvironmentOverrides @{ READ_WEB_OPTIMIZATION_TEST_KILL_PHASE = $crashPhase } | Out-Null
      } catch { $crashObserved = $true; $crashError = $_.Exception.Message }
      Assert-True $crashObserved "forced launcher termination at $crashPhase was not observable ($crashError)"

      # The launcher is intentionally not invoked for recovery yet.  A
      # pending journal must keep the last committed pair visible through the
      # stable front door; it must never expose the candidate pointers or
      # create a public outage while activation is undecidable.
      $preRecoveryFrontDoorHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/front-door-health' -TimeoutSec 5
      Assert-True ($preRecoveryFrontDoorHealth.status -eq 'ready' `
        -and $preRecoveryFrontDoorHealth.target.releaseId -eq $firstRelease `
        -and $preRecoveryFrontDoorHealth.target.instanceId -eq $firstInstance `
        -and $preRecoveryFrontDoorHealth.commitVisibility.status -eq 'previous-release') "$crashPhase interrupted committed front-door visibility (old=$firstRelease/$firstInstance, status=$($preRecoveryFrontDoorHealth.status), target=$($preRecoveryFrontDoorHealth.target.releaseId)/$($preRecoveryFrontDoorHealth.target.instanceId), visibility=$($preRecoveryFrontDoorHealth.commitVisibility.status), journalPresent=$(Test-Path -LiteralPath $activationJournalPath), journal=$(Get-OptimizationObjectText -Object (Read-OptimizationJsonFile -Path $activationJournalPath) -Name 'phase'), launcherError=$crashError)"
      $preRecoveryHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5184/api/app/health' -TimeoutSec 5
      Assert-True ($preRecoveryHealth.status -eq 'ready' -and $preRecoveryHealth.releaseId -eq $firstRelease -and $preRecoveryHealth.instanceId -eq $firstInstance) "$crashPhase exposed an uncommitted candidate through the front door"
      $preRecoveryIndex = Invoke-WebRequest -Uri 'http://127.0.0.1:5184/' -UseBasicParsing -TimeoutSec 5
      Assert-True ($preRecoveryIndex.StatusCode -eq 200) "$crashPhase interrupted the committed index service"
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
      Assert-True ($recoveredHealth.status -eq 'ready' -and $recoveredHealth.releaseId -eq $firstRelease -and $recoveredHealth.instanceId -eq $firstInstance) "$crashPhase recovery did not preserve the old service"
      Assert-True ($recoveredHost.pid -eq $firstPid -and $recoveredHost.instanceId -eq $firstInstance) "$crashPhase recovery changed the old Host"
      Assert-True ((Read-OptimizationRuntimeText -Path $frontDoorTargetPath) -eq $targetSnapshot) "$crashPhase recovery changed the target snapshot"
      Assert-True ((Read-OptimizationRuntimeText -Path (Join-Path $stateRoot 'active-release.json')) -eq $activeSnapshot) "$crashPhase recovery changed the active-release snapshot"
      Assert-True ((Read-OptimizationRuntimeText -Path $frontDoorCommittedTargetPath) -eq $committedTargetSnapshot) "$crashPhase recovery changed the committed target snapshot"
      Assert-True ((Read-OptimizationRuntimeText -Path $tokenPath) -eq $tokenSnapshot) "$crashPhase recovery changed the existing Host service token"
      Assert-True ((Read-OptimizationRuntimeText -Path $hostStatePath) -eq $hostSnapshot) "$crashPhase recovery changed the active-host snapshot"
      Assert-True (-not (Test-Path -LiteralPath (Join-Path $stateRoot 'activation-journal.json'))) "$crashPhase recovery left an activation journal"
      Assert-True (@(Get-ChildItem -LiteralPath $stateRoot -Filter 'production-host-*.json' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -ne $hostManagerPath }).Count -eq 0) "$crashPhase recovery left a pending Host state"
      Assert-True (@(Get-ChildItem -LiteralPath $stateRoot -Filter '*.json.lock' -File -ErrorAction SilentlyContinue).Count -eq 0) "$crashPhase recovery left a stale launcher lock"
      if ($crashPhase -eq 'host-process-started' -and $interruptedCandidatePort -gt 0) {
        Assert-True (Wait-OptimizationTcpPortFree -Port $interruptedCandidatePort -TimeoutSeconds 5) 'process-start boundary recovery left an orphan Host port occupied'
      }
      $newIsolationRoots = @(Get-ChildItem -LiteralPath $applicationInstancesRoot -Force -ErrorAction SilentlyContinue | Where-Object { $baselineIsolationInstanceIds -notcontains $_.Name })
      Assert-True ($newIsolationRoots.Count -eq 0) "$crashPhase recovery left a pending application profile lease (baseline=$($baselineIsolationInstanceIds.Count), new=$(($newIsolationRoots | ForEach-Object { $_.Name }) -join ','))"
    }

    $reuseOutput = Invoke-Launcher -Arguments @('-NoOpen')
    Assert-True ($reuseOutput -match 'Reusing optimization production host') 'second real launcher invocation did not reuse the active pair'
    $reusedHostState = Read-OptimizationJsonFile -Path $hostStatePath
    $reusedCapabilityState = Read-OptimizationJsonFile -Path $capabilityStatePath
    Assert-True ($reusedHostState.pid -eq $firstPid -and $reusedCapabilityState.pid -eq $firstCapabilityPid) 'reuse changed an owned process PID'
    Assert-True ($reusedHostState.instanceId -eq $firstInstance -and $reusedCapabilityState.instanceId -eq $firstInstance) 'reuse changed the instance identity'
    Assert-True ((Read-OptimizationRuntimeText -Path $hostStatePath) -eq $hostSnapshot) 'reuse changed the active host descriptor'
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

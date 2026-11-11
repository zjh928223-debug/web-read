param(
  [string]$NodePath = 'E:\ReadWebRuntime\node-v24.13.1\node.exe',
  [string]$RestrictedTempPath = (Join-Path $env:SystemRoot 'TEMP')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'optimization-release.psm1') -Force -DisableNameChecking
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
try {
  # Match the failed Explorer-launched process: an existing system TEMP that
  # this desktop user cannot write. No ACL or system environment is changed.
  $env:TEMP = $RestrictedTempPath
  $env:TMP = $RestrictedTempPath
  & (Get-Module optimization-release) {
    param($NodePath, $ProjectRoot)
    $version = Get-OptimizationCommandVersion -FilePath $NodePath -Arguments @('--version')
    if ($version -notmatch '^v\d+\.\d+\.\d+$') { throw 'Version probe failed when TEMP is unavailable.' }
    $result = Invoke-OptimizationProcessCapture -FilePath $NodePath -ArgumentList @('-e', 'process.stdout.write(process.argv[1]); process.stderr.write("stderr-ok"); process.exitCode=7', 'space and "quote"') -WorkingDirectory $ProjectRoot
    if ($result.stdout -ne 'space and "quote"' -or $result.stderr -ne 'stderr-ok' -or $result.exitCode -ne 7) { throw 'Captured output, argument quoting, or exit code changed.' }
    $inputResult = Invoke-OptimizationProcessCapture -FilePath $NodePath -ArgumentList @('-e', 'process.stdin.setEncoding("utf8"); let input=""; process.stdin.on("data", chunk => input+=chunk); process.stdin.on("end", () => process.stdout.write(input))') -WorkingDirectory $ProjectRoot -StandardInput 'stdin-ok'
    if ($inputResult.exitCode -ne 0 -or $inputResult.stdout -ne 'stdin-ok') { throw 'Standard input capture changed.' }
    $warnings = @()
    $missing = Get-OptimizationCommandVersion -FilePath (Join-Path $ProjectRoot 'missing-runtime-for-check.exe') -Arguments @('--version') -WarningVariable warnings -WarningAction SilentlyContinue
    if ($missing) { throw 'Missing executables must remain unverified.' }
    if ($warnings.Count -eq 0) { throw 'The underlying launch failure was swallowed without a diagnostic.' }
    Write-Host 'PASS: unavailable TEMP, real version, stdout/stderr, quoting, nonzero exit, stdin, and missing-runtime diagnostic.'
  } $NodePath $projectRoot
} finally {
  $env:TEMP = $previousTemp
  $env:TMP = $previousTmp
}

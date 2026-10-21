# Exercise priority inheritance in disposable children without changing the test host or runner.
[CmdletBinding()]
param([switch]$Child)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Requires PowerShell 7 on Windows.' }
$helper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../scripts/windows-packaging-priority.ps1'))
if ($Child) {
  $null = & $helper -InspectOnly
  $self = [Diagnostics.Process]::GetCurrentProcess()
  try {
    $self.PriorityClass = [Diagnostics.ProcessPriorityClass]::BelowNormal
    [DshPackagingPriority]::Set(33, 1)
    [DshPackagingPriority]::Set(39, 2)
    $report = (& $helper | ConvertFrom-Json)
    if ($report.before.cpu -ne 'BelowNormal' -or $report.before.io -ne 1 -or $report.before.memory -ne 2) {
      throw 'Fixture did not establish background priority.'
    }
    if ($report.after.cpu -ne 'Normal' -or $report.after.io -ne 2 -or $report.after.memory -ne 5) {
      throw 'Packaging shell retained background priority.'
    }
    $inherited = (& (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File $helper -InspectOnly | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) { throw 'Priority inspection child failed.' }
    if ($inherited.before.cpu -ne 'Normal' -or $inherited.before.io -ne 2 -or $inherited.before.memory -ne 5) {
      throw 'Packaging child did not inherit normal priority.'
    }
  } finally {
    $self.Dispose()
  }
  exit 0
}
$process = [Diagnostics.Process]::new()
$process.StartInfo.FileName = Join-Path $PSHOME 'pwsh.exe'
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.CreateNoWindow = $true
$process.StartInfo.RedirectStandardError = $true
foreach ($argument in @('-NoProfile', '-File', $PSCommandPath, '-Child')) {
  $process.StartInfo.ArgumentList.Add($argument)
}
$started = $false
try {
  $started = $process.Start()
  if (-not $started) { throw 'Could not start priority test.' }
  $errorOutput = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(30000)) { throw 'Priority test exceeded 30 seconds.' }
  if (-not $errorOutput.Wait(5000)) { throw 'Priority test error stream did not close.' }
  if ($process.ExitCode -ne 0) { throw "Priority test failed: $($process.ExitCode): $($errorOutput.Result)" }
} finally {
  if ($started -and -not $process.HasExited) {
    $process.Kill($true)
    $process.WaitForExit()
  }
  $process.Dispose()
}
Write-Output 'Packaging priority normalization and child inheritance passed.'

# Windowless launcher acceptance without Task Scheduler, GitHub registration or signing credentials.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Requires PowerShell 7 on Windows.' }
$root = Join-Path ([IO.Path]::GetTempPath()) ('dsh-launcher-' + [guid]::NewGuid().ToString('N'))
$taskRoot = Join-Path $root 'task with spaces'
$null = New-Item -ItemType Directory -Path $taskRoot
$launcher = Join-Path $taskRoot 'launcher.exe'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe "/out:$launcher" (Join-Path $PSScriptRoot '../scripts/windows-runner-launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
$image = [IO.File]::ReadAllBytes($launcher)
$peOffset = [BitConverter]::ToInt32($image, 0x3c)
if ([BitConverter]::ToUInt16($image, $peOffset + 24 + 68) -ne 2) { throw 'Launcher must use the Windows GUI subsystem.' }
@'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
[Console]::WriteLine('console=' + [ConsoleProbe]::GetConsoleWindow().ToInt64())
[Console]::Error.WriteLine('launcher stderr probe')
exit 37
'@ | Set-Content -LiteralPath (Join-Path $taskRoot 'run.ps1')
function Invoke-Launcher([string]$Executable, [int]$ExpectedExit) {
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new($launcher)
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.ArgumentList.Add($Executable)
    try {
        $null = $process.Start()
        if (-not $process.WaitForExit(30000)) { throw 'Launcher did not exit within 30 seconds.' }
        if ($process.ExitCode -ne $ExpectedExit) { throw "Expected exit $ExpectedExit, got $($process.ExitCode)." }
        return (Join-Path $taskRoot ('launcher-' + $process.Id))
    } finally {
        if ($process.Id -and -not $process.HasExited) {
            $process.Kill($true)
            if (-not $process.WaitForExit(30000)) { throw 'Launcher teardown did not complete.' }
        }
        $process.Dispose()
    }
}
$log = Invoke-Launcher (Join-Path $PSHOME 'pwsh.exe') 37
if ((Get-Content -LiteralPath ($log + '.out.log') -Raw).Trim() -ne 'console=0') { throw 'Child allocated a console or stdout was lost.' }
if ((Get-Content -LiteralPath ($log + '.err.log') -Raw).Trim() -ne 'launcher stderr probe') { throw 'Child stderr was lost.' }
$log = Invoke-Launcher (Join-Path $root 'missing.exe') 2
if (-not (Get-Content -LiteralPath ($log + '.err.log') -Raw).Contains('Win32Exception')) { throw 'Startup failure diagnostic was lost.' }
Write-Output "PASS: GUI executable, no child console, exit propagation, stdout/stderr and startup failure. Evidence: $root"

// Compiled as a Windows GUI executable so Task Scheduler never allocates a console.
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

internal static class WindowsRunnerLauncher
{
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string log = Path.Combine(root, "launcher-" + Process.GetCurrentProcess().Id);
        try
        {
            if (args.Length != 1 || !Path.IsPathRooted(args[0]))
                throw new ArgumentException("Expected the absolute PowerShell executable path.");
            using (var output = File.Create(log + ".out.log"))
            using (var errors = File.Create(log + ".err.log"))
            using (var child = new Process())
            {
                child.StartInfo = new ProcessStartInfo
                {
                    FileName = args[0],
                    Arguments = "-NoProfile -NonInteractive -File \"" + Path.Combine(root, "run.ps1") + "\"",
                    WorkingDirectory = Directory.GetParent(root.TrimEnd(Path.DirectorySeparatorChar)).FullName,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                child.Start();
                Task stdout = child.StandardOutput.BaseStream.CopyToAsync(output);
                Task stderr = child.StandardError.BaseStream.CopyToAsync(errors);
                child.WaitForExit();
                Task.WaitAll(stdout, stderr);
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            try { File.AppendAllText(log + ".err.log", error.ToString() + Environment.NewLine); }
            catch (Exception)
            {
                // No console is available. Task Scheduler result 3 reports that diagnostics could not be written.
                return 3;
            }
            return 2;
        }
    }
}

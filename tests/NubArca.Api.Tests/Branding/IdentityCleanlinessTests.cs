using System.Diagnostics;

namespace NubArca.Api.Tests.Branding;

// Binds scripts/check-identity-cleanliness.sh into the canonical test matrix, so
// a reintroduced former-brand identifier fails `dotnet test` rather than only a
// pre-commit step somebody can forget to run.
//
// Two facts are asserted, and they are different:
//   * the checker's OWN engine is correct (--self-test), and
//   * the tracked tree is actually clean (the plain run).
// A checker that passes while asserting nothing is the failure mode this guards.
public class IdentityCleanlinessTests
{
    [Fact]
    public void Identity_Checker_Self_Test_Passes()
    {
        var (exit, stdout, stderr) = RunChecker("--self-test");
        Assert.True(exit == 0, $"identity checker self-test failed:\n{stdout}\n{stderr}");
        Assert.Contains("cases correct", stdout);
    }

    [Fact]
    public void Tracked_Source_Contains_No_Former_Brand_Outside_The_Checkout_Path()
    {
        var (exit, stdout, stderr) = RunChecker();
        Assert.True(exit == 0, $"tracked source is not identity-clean:\n{stdout}\n{stderr}");
    }

    private static (int Exit, string Stdout, string Stderr) RunChecker(params string[] args)
    {
        var repositoryRoot = FindRepositoryRoot();
        var script = Path.Combine(repositoryRoot, "scripts", "check-identity-cleanliness.sh");
        Assert.True(File.Exists(script), $"checker script not found at {script}");

        var startInfo = new ProcessStartInfo("bash")
        {
            WorkingDirectory = repositoryRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        startInfo.ArgumentList.Add(script);
        foreach (var arg in args)
        {
            startInfo.ArgumentList.Add(arg);
        }

        using var process = Process.Start(startInfo);
        Assert.NotNull(process);
        var stdout = process!.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        Assert.True(process.WaitForExit(120_000), "identity checker did not finish in 120 s");
        return (process.ExitCode, stdout, stderr);
    }

    // Walk up from the test assembly to the directory holding the solution. The
    // test working directory is the build output, several levels below the root.
    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "NubArca.sln")))
            {
                return directory.FullName;
            }
            directory = directory.Parent;
        }
        throw new InvalidOperationException("could not locate the repository root (NubArca.sln)");
    }
}

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.DependencyInjection;
using NanoCloud.Api.Tests.Endpoints;

namespace NanoCloud.Api.Tests.Branding;

// NubArca rebrand (2026-07-31): the published OpenAPI document is a
// USER-VISIBLE surface. With a bare `AddOpenApi()` the document title defaults
// to the ASSEMBLY NAME — which is still the retained legacy identifier
// "NanoCloud.Api" (it is the container ENTRYPOINT). Program.cs therefore sets
// Info.Title/Version/Description explicitly through a document transformer, and
// these tests are the regression guard: if someone drops the transformer, the
// legacy brand silently reappears in every consumer's generated client.
public class OpenApiBrandingTests
{
    private const string DocumentName = "v1";

    [Fact]
    public async Task Generated_OpenApi_Document_Is_Branded_NubArca()
    {
        using var factory = new SqliteWebApplicationFactory();
        factory.EnsureDatabaseCreated();

        var provider = factory.Services.GetKeyedService<IOpenApiDocumentProvider>(DocumentName)
            ?? factory.Services.GetService<IOpenApiDocumentProvider>();
        Assert.NotNull(provider);

        var document = await provider!.GetOpenApiDocumentAsync(CancellationToken.None);

        Assert.NotNull(document.Info);
        Assert.Contains("NubArca", document.Info!.Title);
        Assert.DoesNotContain("NanoCloud", document.Info.Title);
        Assert.Equal("v1", document.Info.Version);
        Assert.NotNull(document.Info.Description);
        Assert.Contains("NubArca", document.Info.Description!);
        Assert.DoesNotContain("NanoCloud", document.Info.Description!);
    }

    // The document is only MAPPED in Development (see Program.cs), so this test
    // runs the same SQLite host with the environment flipped and fetches the
    // real JSON over HTTP — proving what an API consumer actually downloads.
    [Fact]
    public async Task Served_OpenApi_Json_Is_Branded_NubArca()
    {
        using var factory = new SqliteWebApplicationFactory(
            new Dictionary<string, string?>
            {
                [WebHostDefaults.EnvironmentKey] = "Development",
                // appsettings.Development.json points at a real Postgres; the
                // SQLite test host must keep Program.cs's Npgsql branch off.
                ["ConnectionStrings:Postgres"] = string.Empty,
            });
        factory.EnsureDatabaseCreated();

        using var client = factory.CreateClient();
        var response = await client.GetAsync($"/openapi/{DocumentName}.json");
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();

        Assert.Contains("\"NubArca API\"", json);
        Assert.DoesNotContain("NanoCloud", json);
    }
}

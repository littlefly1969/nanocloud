using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using NanoCloud.Api.TvUpdates;

namespace NanoCloud.Api.Tests;

public sealed class TvUpdateEndpointTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"nanocloud-tv-ota-{Guid.NewGuid():N}");
    private const string Runtime = "tv-native-1";
    private const string UpdateId = "11111111-1111-4111-8111-111111111111";

    [Fact]
    public async Task CompatibleAndroidRuntimeReturnsProtocolV1ManifestAndImmutableAsset()
    {
        WritePublication(signed: true);
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        using var request = ManifestRequest(Runtime);
        request.Headers.TryAddWithoutValidation("expo-expect-signature", "sig, keyid=\"main\", alg=\"rsa-v1_5-sha256\"");
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/expo+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("1", response.Headers.GetValues("Expo-Protocol-Version").Single());
        Assert.Contains("no-cache", response.Headers.CacheControl?.ToString());
        Assert.True(response.Headers.Contains("Expo-Signature"));
        var manifest = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(UpdateId, manifest.GetProperty("id").GetString());
        Assert.Equal(Runtime, manifest.GetProperty("runtimeVersion").GetString());
        var assetUrl = manifest.GetProperty("launchAsset").GetProperty("url").GetString();
        Assert.Contains($"/{Runtime}/{UpdateId}/", assetUrl);

        var asset = await client.GetAsync(new Uri(assetUrl!).PathAndQuery);
        Assert.Equal(HttpStatusCode.OK, asset.StatusCode);
        Assert.Contains("immutable", asset.Headers.CacheControl?.ToString());
        Assert.Equal("bundle", await asset.Content.ReadAsStringAsync());
        File.WriteAllText(Path.Combine(PublicationDirectory(), "files", "unreferenced.txt"), "private");
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.GetAsync($"/api/tv-app/updates/assets/{Runtime}/{UpdateId}/unreferenced.txt")).StatusCode);
    }

    [Fact]
    public async Task IncompatibleRuntimeOrMissingPublicationReturnsNoUpdate()
    {
        WritePublication(signed: true);
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(ManifestRequest("tv-native-2"))).StatusCode);
        Directory.Delete(_root, recursive: true);
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(ManifestRequest(Runtime))).StatusCode);
    }

    [Fact]
    public async Task RejectsWrongPlatformProtocolAndUnsafeInputs()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        using var ios = ManifestRequest(Runtime, "ios");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(ios)).StatusCode);
        using var oldProtocol = ManifestRequest(Runtime);
        oldProtocol.Headers.Remove("Expo-Protocol-Version");
        oldProtocol.Headers.TryAddWithoutValidation("Expo-Protocol-Version", "0");
        Assert.Equal(HttpStatusCode.NotAcceptable, (await client.SendAsync(oldProtocol)).StatusCode);
        Assert.False(TvUpdateStore.IsSafeAssetPath("../secret"));
        Assert.False(TvUpdateStore.IsSafe("../../runtime"));
    }

    [Fact]
    public async Task MalformedOrUnsignedRequiredPublicationIsIgnored()
    {
        WritePublication(signed: false);
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        using var signedRequest = ManifestRequest(Runtime);
        signedRequest.Headers.TryAddWithoutValidation("expo-expect-signature", "sig");
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(signedRequest)).StatusCode);

        File.WriteAllText(Path.Combine(PublicationDirectory(), "manifest.json"), "{malformed");
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(ManifestRequest(Runtime))).StatusCode);
    }

    private WebApplicationFactory<Program> CreateFactory() => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Postgres"] = "",
            ["TvUpdates:RootPath"] = _root,
        })));

    private static HttpRequestMessage ManifestRequest(string runtime, string platform = "android")
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/tv-app/updates");
        request.Headers.TryAddWithoutValidation("Expo-Protocol-Version", "1");
        request.Headers.TryAddWithoutValidation("Expo-Platform", platform);
        request.Headers.TryAddWithoutValidation("Expo-Runtime-Version", runtime);
        request.Headers.TryAddWithoutValidation("expo-channel-name", "production");
        request.Headers.TryAddWithoutValidation("Accept", "multipart/mixed,application/expo+json,application/json");
        return request;
    }

    private string PublicationDirectory() => Path.Combine(_root, "publications", "android", Runtime, UpdateId);

    private void WritePublication(bool signed)
    {
        var publication = PublicationDirectory();
        var relative = "_expo/static/js/android/index.hbc";
        var asset = Path.Combine(publication, "files", relative);
        Directory.CreateDirectory(Path.GetDirectoryName(asset)!);
        File.WriteAllText(asset, "bundle");
        var hash = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes("bundle"))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var url = $"https://nanocloud.test/api/tv-app/updates/assets/{Runtime}/{UpdateId}/{relative}";
        var manifest = JsonSerializer.Serialize(new
        {
            id = UpdateId, createdAt = "2026-07-10T12:00:00.000Z", runtimeVersion = Runtime,
            launchAsset = new { hash, key = hash, contentType = "application/octet-stream", url },
            assets = Array.Empty<object>(), metadata = new { channel = "production", platform = "android" }, extra = new { }
        });
        File.WriteAllText(Path.Combine(publication, "manifest.json"), manifest);
        File.WriteAllText(Path.Combine(publication, "publication.json"), JsonSerializer.Serialize(new
        {
            id = UpdateId, runtimeVersion = Runtime, platform = "android",
            signature = signed ? "sig=\"ZmFrZQ==\", keyid=\"main\", alg=\"rsa-v1_5-sha256\"" : null
        }));
        var channel = Path.Combine(_root, "channels", "production", "android");
        Directory.CreateDirectory(channel);
        File.WriteAllText(Path.Combine(channel, $"{Runtime}.json"), JsonSerializer.Serialize(new { current = UpdateId, previous = (string?)null }));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}

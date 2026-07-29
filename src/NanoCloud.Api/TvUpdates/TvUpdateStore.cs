using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using Microsoft.Extensions.Options;

namespace NanoCloud.Api.TvUpdates;

public sealed partial class TvUpdateStore
{
    private readonly string _root;
    private readonly ILogger<TvUpdateStore> _logger;

    public TvUpdateStore(IOptions<TvUpdateOptions> options, ILogger<TvUpdateStore> logger)
    {
        _root = string.IsNullOrWhiteSpace(options.Value.RootPath)
            ? string.Empty
            : Path.GetFullPath(options.Value.RootPath);
        _logger = logger;
    }

    public TvManifestResult? FindManifest(string platform, string runtime, string channel, bool signatureRequired)
    {
        if (string.IsNullOrWhiteSpace(_root) || !Directory.Exists(_root)) return null;
        if (platform != "android" || !IsSafe(runtime) || !IsSafe(channel)) return null;
        try
        {
            var pointerPath = UnderRoot("channels", channel, platform, $"{runtime}.json");
            if (!File.Exists(pointerPath)) return null;
            var pointer = JsonSerializer.Deserialize<TvChannelPointer>(File.ReadAllText(pointerPath), JsonOptions);
            if (pointer?.Current is null || !Guid.TryParse(pointer.Current, out _)) return null;
            var directory = UnderRoot("publications", platform, runtime, pointer.Current);
            var manifestPath = Path.Combine(directory, "manifest.json");
            var metadataPath = Path.Combine(directory, "publication.json");
            if (!File.Exists(manifestPath) || !File.Exists(metadataPath)) return null;
            var body = File.ReadAllText(manifestPath);
            var metadata = JsonSerializer.Deserialize<TvPublicationMetadata>(File.ReadAllText(metadataPath), JsonOptions);
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;
            if (metadata is null || metadata.Id != pointer.Current || metadata.RuntimeVersion != runtime || metadata.Platform != platform ||
                root.GetProperty("id").GetString() != pointer.Current || root.GetProperty("runtimeVersion").GetString() != runtime ||
                (metadata.Signature is not null && !SignatureHeader().IsMatch(metadata.Signature)) ||
                (signatureRequired && string.IsNullOrWhiteSpace(metadata.Signature))) return null;
            ValidateAssets(root, directory, runtime, pointer.Current);
            return new TvManifestResult(body, metadata.Signature);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException or InvalidDataException
            or KeyNotFoundException or InvalidOperationException or UriFormatException or FormatException)
        {
            _logger.LogWarning(exception, "Ignoring malformed TV OTA publication for {Platform}/{Runtime}/{Channel}", platform, runtime, channel);
            return null;
        }
    }

    public TvAssetResult? FindAsset(string runtime, string updateId, string assetPath)
    {
        if (string.IsNullOrWhiteSpace(_root) || !IsSafe(runtime) || !Guid.TryParse(updateId, out _) || !IsSafeAssetPath(assetPath)) return null;
        try
        {
            var publication = UnderRoot("publications", "android", runtime, updateId);
            // Reject unpublished/malformed directories, even if a file happens to exist.
            var metadataPath = Path.Combine(publication, "publication.json");
            if (!File.Exists(metadataPath)) return null;
            var metadata = JsonSerializer.Deserialize<TvPublicationMetadata>(File.ReadAllText(metadataPath), JsonOptions);
            if (metadata?.Id != updateId || metadata.RuntimeVersion != runtime || metadata.Platform != "android") return null;
            var manifestPath = Path.Combine(publication, "manifest.json");
            if (!File.Exists(manifestPath)) return null;
            using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
            ValidateAssets(document.RootElement, publication, runtime, updateId);
            if (!ManifestReferences(document.RootElement, runtime, updateId, assetPath)) return null;
            var file = Path.GetFullPath(Path.Combine(publication, "files", assetPath.Replace('/', Path.DirectorySeparatorChar)));
            var filesRoot = Path.GetFullPath(Path.Combine(publication, "files")) + Path.DirectorySeparatorChar;
            if (!file.StartsWith(filesRoot, StringComparison.Ordinal) || !File.Exists(file)) return null;
            return new TvAssetResult(file, ContentType(file));
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException or InvalidDataException
            or KeyNotFoundException or InvalidOperationException or UriFormatException or FormatException)
        {
            _logger.LogWarning(exception, "Unable to serve TV OTA asset {UpdateId}/{AssetPath}", updateId, assetPath);
            return null;
        }
    }

    private void ValidateAssets(JsonElement manifest, string publication, string runtime, string updateId)
    {
        var assets = new List<JsonElement> { manifest.GetProperty("launchAsset") };
        assets.AddRange(manifest.GetProperty("assets").EnumerateArray());
        var expectedMarker = $"/assets/{Uri.EscapeDataString(runtime)}/{updateId}/";
        foreach (var asset in assets)
        {
            var url = asset.GetProperty("url").GetString();
            var hash = asset.GetProperty("hash").GetString();
            if (url is null || hash is null || !Uri.TryCreate(url, UriKind.Absolute, out var uri)) throw new InvalidDataException("Invalid asset URL");
            var marker = uri.AbsolutePath.IndexOf(expectedMarker, StringComparison.Ordinal);
            if (marker < 0) throw new InvalidDataException("Asset URL is not immutable");
            var relativePath = Uri.UnescapeDataString(uri.AbsolutePath[(marker + expectedMarker.Length)..]);
            if (!IsSafeAssetPath(relativePath)) throw new InvalidDataException("Unsafe asset path");
            var file = Path.GetFullPath(Path.Combine(publication, "files", relativePath.Replace('/', Path.DirectorySeparatorChar)));
            var filesRoot = Path.GetFullPath(Path.Combine(publication, "files")) + Path.DirectorySeparatorChar;
            if (!file.StartsWith(filesRoot, StringComparison.Ordinal) || !File.Exists(file)) throw new InvalidDataException("Missing asset");
            var actual = Convert.ToBase64String(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(file)))
                .TrimEnd('=').Replace('+', '-').Replace('/', '_');
            if (!CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(actual), System.Text.Encoding.ASCII.GetBytes(hash)))
                throw new InvalidDataException("Asset hash mismatch");
        }
    }

    private static bool ManifestReferences(JsonElement manifest, string runtime, string updateId, string assetPath)
    {
        var expected = $"/assets/{Uri.EscapeDataString(runtime)}/{updateId}/{string.Join('/', assetPath.Split('/').Select(Uri.EscapeDataString))}";
        if (new Uri(manifest.GetProperty("launchAsset").GetProperty("url").GetString()!).AbsolutePath.EndsWith(expected, StringComparison.Ordinal)) return true;
        return manifest.GetProperty("assets").EnumerateArray()
            .Any(asset => new Uri(asset.GetProperty("url").GetString()!).AbsolutePath.EndsWith(expected, StringComparison.Ordinal));
    }

    private string UnderRoot(params string[] parts)
    {
        var value = Path.GetFullPath(Path.Combine(new[] { _root }.Concat(parts).ToArray()));
        if (value != _root && !value.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidDataException("Path escaped OTA storage root");
        return value;
    }

    public static bool IsSafe(string value) => SafeSegment().IsMatch(value);
    public static bool IsSafeAssetPath(string value) => !string.IsNullOrWhiteSpace(value) && !Path.IsPathRooted(value) &&
        value.Split('/', StringSplitOptions.None).All(segment => segment.Length > 0 && segment is not "." and not ".." && !segment.Contains('\\'));

    private static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".js" => "application/javascript", ".json" => "application/json", ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg", ".webp" => "image/webp", ".gif" => "image/gif",
        ".svg" => "image/svg+xml", ".ttf" => "font/ttf", ".otf" => "font/otf",
        ".mp4" => "video/mp4", ".webm" => "video/webm", _ => "application/octet-stream"
    };

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", RegexOptions.CultureInvariant)]
    private static partial Regex SafeSegment();
    [GeneratedRegex("^sig=\"[A-Za-z0-9+/]+={0,2}\", keyid=\"main\", alg=\"rsa-v1_5-sha256\"$", RegexOptions.CultureInvariant)]
    private static partial Regex SignatureHeader();
}

public sealed record TvManifestResult(string Body, string? Signature);
public sealed record TvAssetResult(string Path, string ContentType);
internal sealed record TvChannelPointer(string? Current, string? Previous);
internal sealed record TvPublicationMetadata(string Id, string RuntimeVersion, string Platform, string? Signature);

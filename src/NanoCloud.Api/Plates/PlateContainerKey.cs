using System.Security.Cryptography;
using System.Text;

namespace NanoCloud.Api.Plates;

// Computes the hidden, owner-scoped logical container key for a user's Plates
// area: __nanocloud_plates_{ownerScopedHash}.
//
// ownerScopedHash is an HMAC-SHA256 of the owner id (with a versioned scheme
// prefix) under a configured pepper, rendered lower-hex. Using an HMAC (not a
// bare hash of the id) means the key is:
//   * deterministic per owner (same owner → same key);
//   * non-reversible (cannot recover the owner id from the key);
//   * not usable to infer the user id (the pepper gates any brute force);
//   * internal only — it is stored on PlateImage.LogicalContainerKey but NEVER
//     returned through any API/DTO/log.
// The scheme is versioned so the pepper/algorithm can be rotated later.
//
// Mirrors Files/ContentFingerprint, the established keyed-hash pattern.
public static class PlateContainerKey
{
    // RETAINED legacy-brand identifier (NubArca rebrand, 2026-07-31): this
    // prefix is PERSISTED in PlateImage.LogicalContainerKey for every existing
    // row. Renaming it would orphan every stored Plates container.
    public const string Prefix = "__nanocloud_plates_";
    public const string Scheme = "plates:v1:";

    // Fixed fallback used ONLY when no pepper is configured, so dev/test run
    // without setup. Production SHOULD configure a real secret pepper.
    // RETAINED legacy-brand identifier (NubArca rebrand, 2026-07-31): this
    // literal is HMAC key material. Changing it changes every derived container
    // key computed without a configured pepper.
    private const string DevelopmentFallbackPepper = "nanocloud-plates-dev-pepper-v1";

    public static string Compute(string? pepper, Guid ownerUserId)
    {
        var key = Encoding.UTF8.GetBytes(
            string.IsNullOrEmpty(pepper) ? DevelopmentFallbackPepper : pepper);
        var message = Encoding.UTF8.GetBytes(Scheme + ownerUserId.ToString("N"));
        var mac = HMACSHA256.HashData(key, message);
        return Prefix + Convert.ToHexStringLower(mac);
    }
}

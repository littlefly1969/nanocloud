using NanoCloud.Api.Ai.Backends;

namespace NanoCloud.Api.Ai.Resolution;

// Profile-driven backend resolution. The provider is decided by the PROFILE's
// model (AiModel.Provider), not by a single global setting — so different
// capabilities/profiles can use different providers, and new providers plug in
// without schema changes.
//
// Resolution NEVER throws for an unavailable provider/disabled AI/missing
// profile: it returns an unavailable result with a sanitized reason. Callers
// treat unavailable as a no-op and must not record per-blob skipped/failed
// status for it.
public interface IAiBackendResolver
{
    // Resolve the typed backend for a capability's default profile.
    Task<AiBackendResolution<T>> ResolveForCapabilityAsync<T>(
        string capability, CancellationToken cancellationToken = default) where T : class, IAiBackend;

    // Resolve the typed backend for a specific profile (by stable key).
    Task<AiBackendResolution<T>> ResolveForProfileKeyAsync<T>(
        string profileKey, CancellationToken cancellationToken = default) where T : class, IAiBackend;

    // Availability-only query for a capability's default profile (no backend
    // handed out). Answers: available?, sanitized reason, provider, expected
    // dimension, distance metric.
    Task<AiResolution> GetCapabilityAvailabilityAsync(
        string capability, CancellationToken cancellationToken = default);
}

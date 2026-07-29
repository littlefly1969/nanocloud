using Microsoft.Extensions.Options;
using NanoCloud.Api.Ai.Resolution;
using NanoCloud.Api.Domain.Ai;

namespace NanoCloud.Api.Ai;

public sealed class AiStatusService : IAiStatusService
{
    // Backend-served capabilities surfaced in status. Face clustering is a
    // derived job (not a backend capability) and is intentionally omitted here.
    private static readonly string[] BackendCapabilities =
    {
        AiCapabilities.ImageEmbedding,
        AiCapabilities.DocumentExtraction,
        AiCapabilities.DocumentEmbedding,
        AiCapabilities.FaceDetection,
        AiCapabilities.FaceEmbedding,
        AiCapabilities.Tagging,
        AiCapabilities.Captioning,
    };

    private readonly IOptions<AiOptions> _options;
    private readonly IAiProfileRegistry _registry;
    private readonly IAiBackendResolver _resolver;

    public AiStatusService(
        IOptions<AiOptions> options,
        IAiProfileRegistry registry,
        IAiBackendResolver resolver)
    {
        _options = options;
        _registry = registry;
        _resolver = resolver;
    }

    public async Task<AiStatus> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var options = _options.Value;
        var models = await _registry.ListModelsAsync(cancellationToken: cancellationToken);
        var profiles = await _registry.ListProfilesAsync(cancellationToken: cancellationToken);

        var capabilities = new List<AiCapabilityStatus>(BackendCapabilities.Length);
        foreach (var capability in BackendCapabilities)
        {
            var resolution = await _resolver.GetCapabilityAvailabilityAsync(capability, cancellationToken);
            capabilities.Add(new AiCapabilityStatus(
                capability,
                resolution.IsAvailable,
                resolution.UnavailableReason,
                resolution.ProfileKey,
                resolution.Dimension,
                resolution.DistanceMetric));
        }

        return new AiStatus(
            options.Enabled,
            options.Provider,
            models.Count,
            profiles.Count,
            capabilities);
    }
}

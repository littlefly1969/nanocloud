using Microsoft.Extensions.Options;
using NanoCloud.Api.Ai.Backends;
using NanoCloud.Api.Ai.Diagnostics;
using NanoCloud.Api.Ai.Resolution;
using NanoCloud.Api.Domain.Ai;
using NanoCloud.Api.Jobs;

namespace NanoCloud.Api.Ai.Jobs;

public sealed class AiTagsGenerateBackfillJobHandler : AiSkeletonBackfillJobHandler<IAiTagger>
{
    public AiTagsGenerateBackfillJobHandler(
        IOptions<AiOptions> options, IAiBackendResolver resolver, IAiDiagnosticsWriter diagnostics)
        : base(options, resolver, diagnostics)
    {
    }

    public override string JobType => JobTypes.AiTagsGenerateBackfill;
    protected override string Capability => AiCapabilities.Tagging;
    protected override bool CapabilityEnabled(AiOptions options) => options.TagsEnabled;
}

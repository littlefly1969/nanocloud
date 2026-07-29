namespace NanoCloud.Api.Ai.Video;

// VSEM-02: batch-oriented frame extraction for ONE video blob.
//
// The contract is deliberately batch-shaped: the implementation stages the
// original immutable blob ONCE per video and serves every requested sample
// timestamp from that one staged local file — never re-downloading per sample,
// and never touching the poster, preview strip, HLS renditions or any other
// derivative. Frames are transient in-memory payloads for inference; nothing
// is ever persisted as a media derivative.
//
// This interface is also the REPLACEMENT SEAM for future extraction
// strategies (chunked / one-pass); callers depend only on the per-request
// results, not on how many processes produced them.
public interface IVideoSemanticFrameExtractor
{
    Task<VideoSemanticFrameBatchResult> ExtractFramesAsync(
        Func<CancellationToken, Task<Stream>> openBlobContent,
        IReadOnlyList<VideoSemanticFrameRequest> requests,
        CancellationToken cancellationToken);
}

// One requested sample frame: the sample identity plus its manifest timestamp.
public sealed record VideoSemanticFrameRequest(Guid SampleId, long TimestampMilliseconds);

// The outcome for one requested sample. `ImageBytes` is a JPEG in source
// aspect (display-rotated); null with a sanitized VideoSemanticErrorCodes
// value on failure. Failures are per-sample: one bad seek never poisons the
// batch.
public sealed record VideoSemanticFrameResult(
    Guid SampleId,
    long TimestampMilliseconds,
    byte[]? ImageBytes,
    string? ErrorCode)
{
    public bool Succeeded => ImageBytes is not null && ErrorCode is null;
}

// The whole-batch outcome. `StagingErrorCode` is set when the blob could not
// even be staged (blob storage / temp disk) — a batch-level retryable failure
// with no per-sample results.
public sealed record VideoSemanticFrameBatchResult(
    string? StagingErrorCode,
    IReadOnlyList<VideoSemanticFrameResult> Frames)
{
    public bool Staged => StagingErrorCode is null;

    public static VideoSemanticFrameBatchResult StagingFailure(string errorCode)
        => new(errorCode, Array.Empty<VideoSemanticFrameResult>());
}

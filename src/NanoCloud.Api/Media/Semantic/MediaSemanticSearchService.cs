using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NanoCloud.Api.Ai;
using NanoCloud.Api.Ai.Backends;
using NanoCloud.Api.Ai.Photos;
using NanoCloud.Api.Ai.Resolution;
using NanoCloud.Api.Ai.Video;
using NanoCloud.Api.Data;
using NanoCloud.Api.Files;

namespace NanoCloud.Api.Media.Semantic;

// VSEM-03: ONE query → photos AND temporal video results, in one ranked page.
//
// The mandatory pipeline order is enforced here:
//   authenticated owner scope
//     → deleted/Vault/media-library + requested physical filters
//       (SemanticMediaCandidateService — bounded FileItem candidate scopes)
//     → ONE text embedding with the active paired SigLIP2 profile
//     → photo + video vector ranking, each strictly INSIDE its candidate scope
//     → video samples grouped into their parent segments (bounded, deduped)
//     → same-profile merge by comparable cosine score
//     → stable (score desc, id asc) cursor pagination
//     → owner-visible MediaItem DTO projection
//
// It never ranks globally and filters afterwards. Photos and videos merge ONLY
// because they share the same AiProfile (one image tower + its paired text
// tower); embeddings of any other profile never participate. There is no
// modality boost: scores are the same cosine contract on the same normalized
// space, tie-broken deterministically by FileItem id.
//
// CONTINUATION STRATEGY: each modality contributes its own true top
// PerModalityTopK results; the merged, bounded list (≤ 2×PerModalityTopK) is
// deterministic for the whole query, so every page is a keyset slice of the
// SAME ranked list — no offset drift, no duplicates, correct pages across
// modality exhaustion. A globally valid top page always exists inside the top
// PerModalityTopK of each modality.
public sealed class MediaSemanticSearchService
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 100;
    public const int MaxQueryLength = 256;

    // Per-modality result bound (mirrors PhotoSemanticSearchService.MaxResults'
    // order of magnitude). The merged result set is capped at twice this.
    public const int PerModalityTopK = 300;

    // Bounded additional temporal matches per video result, beyond BestMatch.
    public const int MaxAdditionalMatches = 3;

    // Per-modality physical candidate cap (same bound as the photo semantic
    // gallery's MaxSemanticCandidates and the video vector scope cap).
    private const int MaxCandidates = 20_000;

    private readonly AppDbContext _db;
    private readonly IFileItemService _files;
    private readonly SemanticMediaCandidateService _candidates;
    private readonly PhotoEmbeddingProfileService _profiles;
    private readonly IAiBackendResolver _backends;
    private readonly PhotoVectorIndexService _photoVectors;
    private readonly VideoSemanticSampleVectorIndexService _videoVectors;
    private readonly IAiVectorSerializer _serializer;
    private readonly IOptions<VideoSemanticSegmentationOptions> _segmentation;
    private readonly ILogger<MediaSemanticSearchService> _logger;

    public MediaSemanticSearchService(
        AppDbContext db,
        IFileItemService files,
        SemanticMediaCandidateService candidates,
        PhotoEmbeddingProfileService profiles,
        IAiBackendResolver backends,
        PhotoVectorIndexService photoVectors,
        VideoSemanticSampleVectorIndexService videoVectors,
        IAiVectorSerializer serializer,
        IOptions<VideoSemanticSegmentationOptions> segmentation,
        ILogger<MediaSemanticSearchService> logger)
    {
        _db = db;
        _files = files;
        _candidates = candidates;
        _profiles = profiles;
        _backends = backends;
        _photoVectors = photoVectors;
        _videoVectors = videoVectors;
        _serializer = serializer;
        _segmentation = segmentation;
        _logger = logger;
    }

    public async Task<SemanticMediaPage> SearchAsync(
        Guid ownerUserId,
        string query,
        MediaKindScope kind,
        int limit,
        string? cursor,
        ImageFilters filters,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filters);
        var normalizedQuery = query?.Trim() ?? string.Empty;
        if (normalizedQuery.Length == 0 || normalizedQuery.Length > MaxQueryLength)
        {
            throw new ArgumentOutOfRangeException(nameof(query));
        }

        var pageSize = Math.Clamp(limit, 1, MaxPageSize);
        var segmentationVersion = _segmentation.Value.SegmentationVersion;
        var started = Stopwatch.GetTimestamp();

        // ---- profile + text tower (the SAME paired-profile contract as the
        // photo semantic search — one profile, image tower + text tower) ------
        var profileResolution = await _profiles.ResolveActiveProfileAsync(null, cancellationToken);
        if (!profileResolution.Usable || profileResolution.Profile is null
            || profileResolution.Profile.Dimension is not > 0)
        {
            return SemanticMediaPage.Unavailable(
                profileResolution.UnavailableReason ?? AiUnavailableReasons.ProfileDimensionInvalid);
        }
        var profile = profileResolution.Profile;

        var backendResolution = await _backends.ResolveForProfileKeyAsync<ITextEmbedder>(
            profile.Key, cancellationToken);
        if (!backendResolution.Resolution.IsAvailable || backendResolution.Backend is null)
        {
            return SemanticMediaPage.Unavailable(backendResolution.Resolution.UnavailableReason);
        }

        // ---- cursor binding BEFORE the expensive work ----------------------
        var fingerprint = SemanticMediaCursor.Fingerprint(
            normalizedQuery, profile.Key, kind, filters, segmentationVersion);
        double? cursorScore = null;
        Guid cursorId = Guid.Empty;
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            if (!SemanticMediaCursor.TryDecode(cursor, fingerprint, out var score, out var id))
            {
                throw new SemanticSearchCursorException();
            }
            cursorScore = score;
            cursorId = id;
        }

        // ---- candidate scopes: OWNER-VISIBLE FILEITEMS FIRST ---------------
        var photoCandidates = kind != MediaKindScope.Video
            ? await _candidates.GetPhotoCandidatesAsync(ownerUserId, filters, MaxCandidates, cancellationToken)
            : Array.Empty<GalleryCandidateRef>() as IReadOnlyList<GalleryCandidateRef>;
        var videoCandidates = kind != MediaKindScope.Image
            ? await _candidates.GetVideoCandidatesAsync(ownerUserId, filters, MaxCandidates, cancellationToken)
            : Array.Empty<GalleryCandidateRef>() as IReadOnlyList<GalleryCandidateRef>;

        if (photoCandidates.Count == 0 && videoCandidates.Count == 0)
        {
            return new SemanticMediaPage(
                true, null, Array.Empty<SemanticMediaResultItem>(), null, false, 0, false);
        }

        // ---- the ONE text embedding ----------------------------------------
        var embedding = await backendResolution.Backend.EmbedTextAsync(
            normalizedQuery, profile, cancellationToken);
        if (embedding.Dimension != profile.Dimension
            || embedding.Vector.Length != profile.Dimension)
        {
            return SemanticMediaPage.Unavailable(AiUnavailableReasons.ProfileDimensionInvalid);
        }

        // ---- per-modality ranking (both strictly candidate-scoped) ---------
        var photoStarted = Stopwatch.GetTimestamp();
        var photoHits = await RankPhotosAsync(
            ownerUserId, profile, embedding.Vector, photoCandidates, cancellationToken);
        var photoElapsedMs = ElapsedMs(photoStarted);

        var videoStarted = Stopwatch.GetTimestamp();
        var videoHits = await RankVideosAsync(
            profile, embedding.Vector, videoCandidates, segmentationVersion, cancellationToken);
        var videoElapsedMs = ElapsedMs(videoStarted);

        // ---- same-profile merge + stable pagination ------------------------
        var mergeStarted = Stopwatch.GetTimestamp();
        var merged = photoHits.Concat(videoHits)
            .OrderByDescending(h => h.Score)
            .ThenBy(h => h.FileItemId)
            .ToList();
        var total = merged.Count;

        var start = 0;
        if (cursorScore is double cs)
        {
            start = merged.Count;
            for (var i = 0; i < merged.Count; i++)
            {
                var h = merged[i];
                if (h.Score < cs || (h.Score == cs && h.FileItemId.CompareTo(cursorId) > 0))
                {
                    start = i;
                    break;
                }
            }
        }

        var pageHits = merged.Skip(start).Take(pageSize).ToList();
        var pageIds = pageHits.Select(h => h.FileItemId).ToList();

        // Owner-visible DTO projection preserving rank. Hydration re-applies
        // the gallery membership gate, so anything deleted/excluded between
        // ranking and projection silently drops out.
        var hydrated = await _files.ListGalleryMediaByRankAsync(ownerUserId, pageIds, cancellationToken);
        var mediaById = hydrated.ToDictionary(m => m.Id);
        var items = pageHits
            .Where(h => mediaById.ContainsKey(h.FileItemId))
            .Select(h => new SemanticMediaResultItem(
                mediaById[h.FileItemId], h.BestMatch, h.AdditionalMatches))
            .ToList();

        var hasMore = start + pageHits.Count < total;
        string? nextCursor = null;
        if (hasMore && pageHits.Count > 0)
        {
            var last = pageHits[^1];
            nextCursor = SemanticMediaCursor.Encode(last.Score, last.FileItemId, fingerprint);
        }

        var stillIndexing = await ComputeStillIndexingAsync(
            ownerUserId, profile.Id, kind, filters, photoCandidates, videoCandidates,
            segmentationVersion, cancellationToken);

        _logger.LogInformation(
            "media-semantic: operation={Operation} profile={ProfileKey} kind={Kind} "
            + "photo-candidates={PhotoCandidates} video-candidates={VideoCandidates} "
            + "photo-results={PhotoResults} video-results={VideoResults} "
            + "temporal-matches={TemporalMatches} total={Total} still-indexing={StillIndexing} "
            + "photo-ms={PhotoMs} video-ms={VideoMs} merge-ms={MergeMs} elapsed-ms={ElapsedMs}",
            "media.semantic.search",
            profile.Key,
            kind.ToWire(),
            photoCandidates.Count,
            videoCandidates.Count,
            photoHits.Count,
            videoHits.Count,
            videoHits.Sum(h => 1 + h.AdditionalMatches.Count),
            total,
            stillIndexing,
            photoElapsedMs,
            videoElapsedMs,
            ElapsedMs(mergeStarted),
            ElapsedMs(started));

        return new SemanticMediaPage(
            true, null, items, nextCursor, hasMore, total, stillIndexing);
    }

    private readonly record struct RankedHit(
        Guid FileItemId,
        double Score,
        SemanticBestMatch BestMatch,
        IReadOnlyList<SemanticBestMatch> AdditionalMatches);

    // ---- photos ------------------------------------------------------------

    // Same ranking contract as the photo semantic gallery: pgvector exact scan
    // restricted to the candidate ids when available, in-process exact cosine
    // over canonical embeddings otherwise. Only the top PerModalityTopK
    // survive; photos carry the null-temporal evidence.
    private async Task<IReadOnlyList<RankedHit>> RankPhotosAsync(
        Guid ownerUserId,
        Domain.Ai.AiProfile profile,
        float[] queryVector,
        IReadOnlyList<GalleryCandidateRef> candidates,
        CancellationToken cancellationToken)
    {
        if (candidates.Count == 0)
        {
            return Array.Empty<RankedHit>();
        }

        var candidateIds = candidates.Select(c => c.Id).ToArray();
        var vectorHits = queryVector.Length == PhotoVectorIndexService.SupportedDimension
            ? await _photoVectors.SearchWithinCandidatesAsync(
                profile.Id, queryVector, ownerUserId, candidateIds, PerModalityTopK, cancellationToken)
            : null;
        if (vectorHits is not null)
        {
            return vectorHits
                .Select(h => new RankedHit(
                    h.FileItemId, h.Score, SemanticBestMatch.Photo, Array.Empty<SemanticBestMatch>()))
                .OrderByDescending(h => h.Score)
                .ThenBy(h => h.FileItemId)
                .Take(PerModalityTopK)
                .ToList();
        }

        // Exact in-process fallback over the candidate blobs' canonical rows.
        var blobIds = candidates.Select(c => c.BlobObjectId).Distinct().ToList();
        var vectors = await _db.BlobEmbeddings.AsNoTracking()
            .Where(e => e.ProfileId == profile.Id && blobIds.Contains(e.BlobObjectId))
            .Select(e => new { e.BlobObjectId, e.EmbeddingBytes })
            .ToListAsync(cancellationToken);

        var scoreByBlob = new Dictionary<Guid, double>(vectors.Count);
        foreach (var v in vectors)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var vector = _serializer.Deserialize(v.EmbeddingBytes);
                if (vector.Length == queryVector.Length)
                {
                    scoreByBlob[v.BlobObjectId] = Math.Round(Cosine(queryVector, vector), 6);
                }
            }
            catch
            {
                // A corrupt canonical row is skipped without leaking internals.
            }
        }

        return candidates
            .Where(c => scoreByBlob.ContainsKey(c.BlobObjectId))
            .Select(c => new RankedHit(
                c.Id, scoreByBlob[c.BlobObjectId], SemanticBestMatch.Photo,
                Array.Empty<SemanticBestMatch>()))
            .OrderByDescending(h => h.Score)
            .ThenBy(h => h.FileItemId)
            .Take(PerModalityTopK)
            .ToList();
    }

    // ---- videos ------------------------------------------------------------

    // sample score → segment score (max eligible sample) → video score
    // (max segment). VSEM-01 segments are contiguous and non-overlapping by
    // construction, so grouping samples into their parent segment IS the
    // interval deduplication; additional matches are further DISTINCT segments,
    // best-first, capped at MaxAdditionalMatches. Every eligible FileItem
    // referencing a matched blob keeps its own logical-file result (same
    // contract as the photo path), each carrying the same deduplicated
    // evidence.
    private async Task<IReadOnlyList<RankedHit>> RankVideosAsync(
        Domain.Ai.AiProfile profile,
        float[] queryVector,
        IReadOnlyList<GalleryCandidateRef> candidates,
        int segmentationVersion,
        CancellationToken cancellationToken)
    {
        if (candidates.Count == 0)
        {
            return Array.Empty<RankedHit>();
        }

        var fileIdsByBlob = candidates
            .GroupBy(c => c.BlobObjectId)
            .ToDictionary(g => g.Key, g => g.Select(c => c.Id).ToList());

        var scope = await _candidates.GetVideoSampleScopeAsync(
            fileIdsByBlob.Keys.ToList(), segmentationVersion,
            VideoSemanticSampleVectorIndexService.MaxCandidateScope, cancellationToken);
        if (scope.Count == 0)
        {
            return Array.Empty<RankedHit>();
        }

        var sampleIds = scope.Select(s => s.SampleId).ToList();
        var neighbours = await _videoVectors.SearchWithinCandidatesAsync(
            profile.Id, queryVector, sampleIds, sampleIds.Count, cancellationToken);
        if (neighbours.Count == 0)
        {
            return Array.Empty<RankedHit>();
        }

        var scoreBySample = neighbours.ToDictionary(n => n.SampleId, n => n.Score);

        // Segment score = max eligible sample; the representative timestamp is
        // that best sample's manifest timestamp.
        var segments = scope
            .Where(s => scoreBySample.ContainsKey(s.SampleId))
            .GroupBy(s => s.SegmentId)
            .Select(g =>
            {
                var best = g
                    .OrderByDescending(s => scoreBySample[s.SampleId])
                    .ThenBy(s => s.SampleTimestampMilliseconds)
                    .First();
                return new
                {
                    best.BlobObjectId,
                    SegmentId = g.Key,
                    Score = scoreBySample[best.SampleId],
                    best.SegmentStartMilliseconds,
                    best.SegmentEndMilliseconds,
                    Representative = best.SampleTimestampMilliseconds,
                };
            })
            .ToList();

        var hits = new List<RankedHit>();
        foreach (var blobGroup in segments.GroupBy(s => s.BlobObjectId))
        {
            var ordered = blobGroup
                .OrderByDescending(s => s.Score)
                .ThenBy(s => s.SegmentStartMilliseconds)
                .ToList();
            var best = ordered[0];
            var bestMatch = SemanticBestMatch.ForSegment(
                best.SegmentStartMilliseconds, best.SegmentEndMilliseconds, best.Representative);
            var additional = ordered
                .Skip(1)
                .Take(MaxAdditionalMatches)
                .Select(s => SemanticBestMatch.ForSegment(
                    s.SegmentStartMilliseconds, s.SegmentEndMilliseconds, s.Representative))
                .ToList();

            if (!fileIdsByBlob.TryGetValue(blobGroup.Key, out var fileIds))
            {
                continue;
            }

            foreach (var fileId in fileIds)
            {
                hits.Add(new RankedHit(fileId, best.Score, bestMatch, additional));
            }
        }

        return hits
            .OrderByDescending(h => h.Score)
            .ThenBy(h => h.FileItemId)
            .Take(PerModalityTopK)
            .ToList();
    }

    // ---- status ------------------------------------------------------------

    // Generic "still indexing" disclosure (same heuristic shape as the photo
    // semantic gallery): many eligible candidates without embeddings for the
    // ACTIVE profile. Never exposes model/index internals.
    private async Task<bool> ComputeStillIndexingAsync(
        Guid ownerUserId,
        Guid profileId,
        MediaKindScope kind,
        ImageFilters filters,
        IReadOnlyList<GalleryCandidateRef> photoCandidates,
        IReadOnlyList<GalleryCandidateRef> videoCandidates,
        int segmentationVersion,
        CancellationToken cancellationToken)
    {
        var photosIndexing = false;
        if (kind != MediaKindScope.Video && photoCandidates.Count > 0)
        {
            var embedded = await _files.CountEmbeddedGalleryCandidatesAsync(
                ownerUserId, filters, profileId, cancellationToken);
            photosIndexing = photoCandidates.Count - embedded
                > Math.Max(10, photoCandidates.Count / 5);
        }

        var videosIndexing = false;
        if (kind != MediaKindScope.Image && videoCandidates.Count > 0)
        {
            var blobIds = videoCandidates.Select(c => c.BlobObjectId).Distinct().ToList();
            var covered = await _candidates.CountVideoBlobsWithEmbeddingsAsync(
                blobIds, profileId, segmentationVersion, cancellationToken);
            videosIndexing = blobIds.Count - covered > Math.Max(10, blobIds.Count / 5);
        }

        return photosIndexing || videosIndexing;
    }

    private static long ElapsedMs(long startedTimestamp)
        => (long)Stopwatch.GetElapsedTime(startedTimestamp).TotalMilliseconds;

    private static double Cosine(float[] a, float[] b)
    {
        double dot = 0, na = 0, nb = 0;
        for (var i = 0; i < a.Length; i++)
        {
            dot += (double)a[i] * b[i];
            na += (double)a[i] * a[i];
            nb += (double)b[i] * b[i];
        }
        return na <= double.Epsilon || nb <= double.Epsilon
            ? 0
            : dot / (Math.Sqrt(na) * Math.Sqrt(nb));
    }
}

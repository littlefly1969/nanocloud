using System.Net;
using System.Net.Http.Json;
using Xunit;
using static NanoCloud.Api.Tests.Ai.Video.VideoFacePeopleTestHarness;

namespace NanoCloud.Api.Tests.Ai.Video;

// VFACE-02: the person-media surface, extended with video results.
//
// A video reaches a person's page only through a CONFIRMED track, carries the
// temporal evidence the player opens at, and exposes nothing internal. The
// existing photo surface is untouched.
public sealed class PersonMediaVideoTests
{
    // ---- what appears -------------------------------------------------------

    [Fact]
    public async Task An_Assigned_Video_Appears_With_Its_Interval()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var trackId = await AddTrackAsync(f, video.AnalysisId, OneHot(0), 4_000, 9_000);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        await client.PostAsJsonAsync(
            $"/api/people/video-tracks/{trackId}/assign", new { personId = alice });

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>($"/api/people/{alice}/videos");

        var item = Assert.Single(videos!);
        Assert.Equal(video.FileId, item.FileItemId);
        Assert.Equal("person", item.BestMatch.EvidenceType);
        Assert.Equal(4_000, item.BestMatch.StartMilliseconds);
        Assert.Equal(9_000, item.BestMatch.EndMilliseconds);
        Assert.InRange(
            item.BestMatch.RepresentativeMilliseconds,
            item.BestMatch.StartMilliseconds, item.BestMatch.EndMilliseconds);
        Assert.Empty(item.AdditionalMatches);
    }

    [Fact]
    public async Task Undecided_And_Ignored_Videos_Never_Appear()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var undecided = await AddTrackAsync(f, video.AnalysisId, OneHot(0), trackIndex: 0);
        var ignored = await AddTrackAsync(f, video.AnalysisId, OneHot(1), trackIndex: 1);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        await client.PostAsync($"/api/people/video-tracks/{ignored}/ignore", null);

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>($"/api/people/{alice}/videos");

        Assert.Empty(videos!);
        Assert.NotEqual(Guid.Empty, undecided);
    }

    [Fact]
    public async Task Several_Tracks_Of_One_Person_Become_Best_Plus_Additional_Matches()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");

        // One long appearance and two brief ones, out of chronological order.
        var brief1 = await AddTrackAsync(f, video.AnalysisId, OneHot(0), 30_000, 31_000, trackIndex: 0);
        var longest = await AddTrackAsync(f, video.AnalysisId, OneHot(0), 5_000, 25_000, trackIndex: 1);
        var brief2 = await AddTrackAsync(f, video.AnalysisId, OneHot(0), 1_000, 2_000, trackIndex: 2);
        foreach (var track in new[] { brief1, longest, brief2 })
        {
            await client.PostAsJsonAsync(
                $"/api/people/video-tracks/{track}/assign", new { personId = alice });
        }

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>($"/api/people/{alice}/videos");

        var item = Assert.Single(videos!);
        // Best = the longest evidence.
        Assert.Equal(5_000, item.BestMatch.StartMilliseconds);
        Assert.Equal(25_000, item.BestMatch.EndMilliseconds);
        // The rest are chronological, so the UI reads as a timeline.
        Assert.Equal(
            new long[] { 1_000, 30_000 },
            item.AdditionalMatches.Select(m => m.StartMilliseconds));
    }

    [Fact]
    public async Task Additional_Matches_Are_Capped()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");

        for (var i = 0; i < 9; i++)
        {
            var track = await AddTrackAsync(
                f, video.AnalysisId, OneHot(0), 1_000 + (i * 10_000), 3_000 + (i * 10_000),
                trackIndex: i);
            await client.PostAsJsonAsync(
                $"/api/people/video-tracks/{track}/assign", new { personId = alice });
        }

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>($"/api/people/{alice}/videos");

        var item = Assert.Single(videos!);
        Assert.Equal(4, item.AdditionalMatches.Count);
    }

    [Fact]
    public async Task Multiple_Logical_Files_On_One_Blob_Each_Appear_With_The_Same_Evidence()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var second = await AddFileReferenceAsync(f, ownerId, video.BlobId);
        var trackId = await AddTrackAsync(f, video.AnalysisId, OneHot(0), 4_000, 9_000);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        await client.PostAsJsonAsync(
            $"/api/people/video-tracks/{trackId}/assign", new { personId = alice });

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>($"/api/people/{alice}/videos");

        // Two logical media items, as the gallery already presents duplicates —
        // and ONE canonical decision behind them.
        Assert.Equal(2, videos!.Count);
        Assert.Equal(
            new[] { video.FileId, second }.OrderBy(id => id),
            videos.Select(v => v.FileItemId).OrderBy(id => id));
        Assert.All(videos, v => Assert.Equal(4_000, v.BestMatch.StartMilliseconds));
        Assert.Equal(1, await DecisionCountAsync(f, trackId));
    }

    // ---- privacy -------------------------------------------------------------

    [Fact]
    public async Task A_Vault_Only_Video_Never_Appears()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var normal = await SeedVideoAsync(f, ownerId, profileId);
        var trackId = await AddTrackAsync(f, normal.AnalysisId, OneHot(0));
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        await client.PostAsJsonAsync(
            $"/api/people/video-tracks/{trackId}/assign", new { personId = alice });

        // The visible reference is then vaulted: the decision survives, the media
        // stops surfacing.
        var vaultId = await CreateVaultAsync(f, ownerId);
        await MoveToVaultAsync(f, normal.FileId, vaultId);

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>($"/api/people/{alice}/videos");

        Assert.Empty(videos!);
    }

    [Fact]
    public async Task A_Deleted_Video_Never_Appears()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var trackId = await AddTrackAsync(f, video.AnalysisId, OneHot(0));
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        await client.PostAsJsonAsync(
            $"/api/people/video-tracks/{trackId}/assign", new { personId = alice });
        await DeleteFileAsync(f, video.FileId);

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>($"/api/people/{alice}/videos");

        Assert.Empty(videos!);
    }

    [Fact]
    public async Task Another_Owners_Person_Is_A_Generic_404()
    {
        using var f = Factory();
        await SeedProfileAsync(f);
        var (_, clientA) = await f.CreateAuthenticatedClientAsync();
        var (ownerB, _) = await f.CreateAuthenticatedClientAsync("other@example.com");
        var foreignPerson = await CreatePersonAsync(f, ownerB, "Bob");

        var response = await clientA.GetAsync($"/api/people/{foreignPerson}/videos");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task No_Internal_Identifier_Is_Exposed()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var trackId = await AddTrackAsync(f, video.AnalysisId, OneHot(0));
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        await client.PostAsJsonAsync(
            $"/api/people/video-tracks/{trackId}/assign", new { personId = alice });

        var body = await (await client.GetAsync($"/api/people/{alice}/videos")).Content.ReadAsStringAsync();

        AssertNoLeak(body);
        // The person-media surface carries logical file ids only — no track id.
        Assert.DoesNotContain(trackId.ToString(), body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("trackId", body, StringComparison.OrdinalIgnoreCase);
    }

    // ---- the photo surface is unchanged --------------------------------------

    [Fact]
    public async Task Person_Photos_Are_Unaffected_By_Video_Decisions()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        await SeedConfirmedFaceAsync(f, ownerId, profileId, alice, OneHot(0));

        var before = await client.GetFromJsonAsync<List<PersonPhoto>>($"/api/people/{alice}/photos");

        var video = await SeedVideoAsync(f, ownerId, profileId);
        var trackId = await AddTrackAsync(f, video.AnalysisId, OneHot(0));
        await client.PostAsJsonAsync(
            $"/api/people/video-tracks/{trackId}/assign", new { personId = alice });

        var after = await client.GetFromJsonAsync<List<PersonPhoto>>($"/api/people/{alice}/photos");

        Assert.Single(before!);
        Assert.Equal(
            before!.Select(p => p.FileItemId),
            after!.Select(p => p.FileItemId));
    }

    // ---- co-presence ----------------------------------------------------------

    [Fact]
    public async Task Overlapping_Confirmed_Tracks_Are_Co_Present()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        var bob = await CreatePersonAsync(f, ownerId, "Bob");

        var aliceTrack = await AddTrackAsync(f, video.AnalysisId, OneHot(0), 5_000, 15_000, trackIndex: 0);
        var bobTrack = await AddTrackAsync(f, video.AnalysisId, OneHot(1), 10_000, 20_000, trackIndex: 1);
        await client.PostAsJsonAsync($"/api/people/video-tracks/{aliceTrack}/assign", new { personId = alice });
        await client.PostAsJsonAsync($"/api/people/video-tracks/{bobTrack}/assign", new { personId = bob });

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>(
            $"/api/people/{alice}/co-present/{bob}");

        var item = Assert.Single(videos!);
        Assert.Equal(video.FileId, item.FileItemId);
        Assert.Equal(5_000, item.BestMatch.StartMilliseconds);
    }

    [Fact]
    public async Task Non_Overlapping_Tracks_In_One_Video_Are_Not_Co_Present()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        var bob = await CreatePersonAsync(f, ownerId, "Bob");

        // Far apart in the same long video: appearing in one file is not enough.
        var aliceTrack = await AddTrackAsync(f, video.AnalysisId, OneHot(0), 1_000, 5_000, trackIndex: 0);
        var bobTrack = await AddTrackAsync(f, video.AnalysisId, OneHot(1), 60_000, 70_000, trackIndex: 1);
        await client.PostAsJsonAsync($"/api/people/video-tracks/{aliceTrack}/assign", new { personId = alice });
        await client.PostAsJsonAsync($"/api/people/video-tracks/{bobTrack}/assign", new { personId = bob });

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>(
            $"/api/people/{alice}/co-present/{bob}");

        Assert.Empty(videos!);
    }

    [Fact]
    public async Task Tracks_Separated_By_Less_Than_One_Sample_Are_Co_Present()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        var bob = await CreatePersonAsync(f, ownerId, "Bob");

        // 400 ms apart: inside one 1 fps sampling interval, so the gap is an
        // artefact of sampling rather than evidence that they were never together.
        var aliceTrack = await AddTrackAsync(f, video.AnalysisId, OneHot(0), 1_000, 5_000, trackIndex: 0);
        var bobTrack = await AddTrackAsync(f, video.AnalysisId, OneHot(1), 5_400, 9_000, trackIndex: 1);
        await client.PostAsJsonAsync($"/api/people/video-tracks/{aliceTrack}/assign", new { personId = alice });
        await client.PostAsJsonAsync($"/api/people/video-tracks/{bobTrack}/assign", new { personId = bob });

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>(
            $"/api/people/{alice}/co-present/{bob}");

        Assert.Single(videos!);
    }

    [Fact]
    public async Task Undecided_Or_Ignored_Tracks_Are_Excluded_From_Co_Presence()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var video = await SeedVideoAsync(f, ownerId, profileId);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        var bob = await CreatePersonAsync(f, ownerId, "Bob");

        var aliceTrack = await AddTrackAsync(f, video.AnalysisId, OneHot(0), 5_000, 15_000, trackIndex: 0);
        var undecided = await AddTrackAsync(f, video.AnalysisId, OneHot(1), 10_000, 20_000, trackIndex: 1);
        await client.PostAsJsonAsync($"/api/people/video-tracks/{aliceTrack}/assign", new { personId = alice });

        Assert.Empty((await client.GetFromJsonAsync<List<PersonVideo>>(
            $"/api/people/{alice}/co-present/{bob}"))!);

        await client.PostAsync($"/api/people/video-tracks/{undecided}/ignore", null);
        Assert.Empty((await client.GetFromJsonAsync<List<PersonVideo>>(
            $"/api/people/{alice}/co-present/{bob}"))!);
    }

    [Fact]
    public async Task Co_Presence_Requires_The_Same_Video()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var first = await SeedVideoAsync(f, ownerId, profileId);
        var second = await SeedVideoAsync(f, ownerId, profileId);
        var alice = await CreatePersonAsync(f, ownerId, "Alice");
        var bob = await CreatePersonAsync(f, ownerId, "Bob");

        // Identical intervals, but in two DIFFERENT videos.
        var aliceTrack = await AddTrackAsync(f, first.AnalysisId, OneHot(0), 5_000, 15_000);
        var bobTrack = await AddTrackAsync(f, second.AnalysisId, OneHot(1), 5_000, 15_000);
        await client.PostAsJsonAsync($"/api/people/video-tracks/{aliceTrack}/assign", new { personId = alice });
        await client.PostAsJsonAsync($"/api/people/video-tracks/{bobTrack}/assign", new { personId = bob });

        var videos = await client.GetFromJsonAsync<List<PersonVideo>>(
            $"/api/people/{alice}/co-present/{bob}");

        Assert.Empty(videos!);
    }

    [Fact]
    public async Task The_Same_Person_Twice_Is_Rejected()
    {
        using var f = Factory();
        await SeedProfileAsync(f);
        var (ownerId, client) = await f.CreateAuthenticatedClientAsync();
        var alice = await CreatePersonAsync(f, ownerId, "Alice");

        var response = await client.GetAsync($"/api/people/{alice}/co-present/{alice}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Co_Presence_Never_Crosses_Owners()
    {
        using var f = Factory();
        var profileId = await SeedProfileAsync(f);
        var (ownerA, clientA) = await f.CreateAuthenticatedClientAsync();
        var (ownerB, _) = await f.CreateAuthenticatedClientAsync("other@example.com");
        var video = await SeedVideoAsync(f, ownerA, profileId);
        await AddFileReferenceAsync(f, ownerB, video.BlobId);
        var alice = await CreatePersonAsync(f, ownerA, "Alice");
        var foreignPerson = await CreatePersonAsync(f, ownerB, "Bob");

        var response = await clientA.GetAsync($"/api/people/{alice}/co-present/{foreignPerson}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- helpers ---------------------------------------------------------------

    private static async Task MoveToVaultAsync(
        NanoCloud.Api.Tests.Endpoints.SqliteWebApplicationFactory f, Guid fileId, Guid vaultId)
    {
        using var scope = Microsoft.Extensions.DependencyInjection
            .ServiceProviderServiceExtensions.CreateScope(f.Services);
        var db = Microsoft.Extensions.DependencyInjection
            .ServiceProviderServiceExtensions
            .GetRequiredService<NanoCloud.Api.Data.AppDbContext>(scope.ServiceProvider);
        var file = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions
            .SingleAsync(
                Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions
                    .IgnoreQueryFilters(db.FileItems),
                f2 => f2.Id == fileId);
        file.PrivateVaultId = vaultId;
        await db.SaveChangesAsync();
    }

    private sealed record PersonVideoMatch(
        string EvidenceType,
        long StartMilliseconds,
        long EndMilliseconds,
        long RepresentativeMilliseconds);

    private sealed record PersonVideo(
        Guid FileItemId,
        string Name,
        PersonVideoMatch BestMatch,
        IReadOnlyList<PersonVideoMatch> AdditionalMatches);

    private sealed record PersonPhotoFace(Guid FaceId);

    private sealed record PersonPhoto(Guid FileItemId, string Name, IReadOnlyList<PersonPhotoFace> Faces);
}

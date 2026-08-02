using Microsoft.EntityFrameworkCore;
using NanoCloud.Api.Data;
using NanoCloud.Api.Domain;
using NanoCloud.Api.Metadata;
using NanoCloud.Api.Security;

namespace NanoCloud.Api.Albums.Sharing;

// SHARE-ALBUM-01 invitation lifecycle + recipient read model.
//
// PRIVATE VAULT — an audited inconsistency, and why it is already closed:
// `AddItemAsync` reads `_db.FileItems`, which carries the global
// `PrivateVaultId == null` query filter, so a vaulted file CANNOT be added to an
// album. A file already in an album that is later moved INTO the vault keeps its
// `album_items` row, but that row's file is invisible to every query in this
// file and in AlbumAccessResolver — including the owner's own album listing. So
// vaulted media is unreachable through a share without any predicate of our own,
// and this slice deliberately does not widen that. The stale `album_items` row
// is pre-existing behavior (visible in AlbumService.ListItemsAsync too) and is
// reported, not changed here.
public sealed class AlbumSharingService : IAlbumSharingService
{
    private readonly AppDbContext _db;
    private readonly TimeProvider _time;

    public AlbumSharingService(AppDbContext db, TimeProvider time)
    {
        _db = db;
        _time = time;
    }

    // ── Owner side ──────────────────────────────────────────────────────────

    public async Task<ResolveAlbumRecipientResponse?> ResolveRecipientAsync(
        Guid ownerUserId, Guid albumId, string? email,
        CancellationToken cancellationToken = default)
    {
        var ownsAlbum = await _db.Albums
            .AsNoTracking()
            .AnyAsync(a => a.Id == albumId && a.OwnerUserId == ownerUserId, cancellationToken);
        if (!ownsAlbum)
        {
            return null;
        }

        var recipient = await FindInvitableRecipientAsync(ownerUserId, email, cancellationToken);
        return recipient is null ? null : new ResolveAlbumRecipientResponse(recipient.DisplayName);
    }

    public async Task<IReadOnlyList<AlbumMemberDto>?> ListMembersAsync(
        Guid ownerUserId, Guid albumId,
        CancellationToken cancellationToken = default)
    {
        var ownsAlbum = await _db.Albums
            .AsNoTracking()
            .AnyAsync(a => a.Id == albumId && a.OwnerUserId == ownerUserId, cancellationToken);
        if (!ownsAlbum)
        {
            return null;
        }

        // Joins Users for DisplayName and for the address that becomes the
        // MASKED hint. The member's user id is never projected, and the raw
        // address never leaves this method — see the privacy note on
        // AlbumMemberDto and RecipientEmailMask.
        //
        // Projects to an ANONYMOUS type, not straight into the positional
        // record: EF cannot compose OrderBy over a record-typed join selector
        // and falls back to client evaluation, which it then refuses. The DTO is
        // built in memory from the ordered rows instead.
        var rows = await _db.AlbumMemberships
            .AsNoTracking()
            .Where(m => m.AlbumId == albumId)
            .Join(_db.Users.AsNoTracking(),
                m => m.MemberUserId,
                u => u.Id,
                (m, u) => new
                {
                    m.Id,
                    u.DisplayName,
                    // Masked in memory below, never in the projection: the raw
                    // address must not survive past this method.
                    u.Email,
                    m.Role,
                    m.State,
                    m.AllowOriginalDownload,
                    m.InvitedAt,
                    m.AcceptedAt,
                    m.DeclinedAt,
                    m.RevokedAt,
                })
            .OrderBy(x => x.InvitedAt)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        return rows.Select(x => new AlbumMemberDto(
            x.Id, x.DisplayName, RecipientEmailMask.Mask(x.Email),
            x.Role, x.State, x.AllowOriginalDownload,
            x.InvitedAt, x.AcceptedAt, x.DeclinedAt, x.RevokedAt)).ToList();
    }

    public async Task<(InviteAlbumMemberResult Result, AlbumMemberDto? Member)> InviteAsync(
        Guid ownerUserId, Guid albumId, InviteAlbumMemberRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var role = string.IsNullOrWhiteSpace(request.Role) ? AlbumRoles.Viewer : request.Role.Trim();
        if (!AlbumRoles.IsAssignable(role))
        {
            return (InviteAlbumMemberResult.RoleNotAssignable, null);
        }

        var normalized = NormalizeEmail(request.Email);
        if (normalized is null)
        {
            return (InviteAlbumMemberResult.InvalidEmail, null);
        }

        var ownsAlbum = await _db.Albums
            .AsNoTracking()
            .AnyAsync(a => a.Id == albumId && a.OwnerUserId == ownerUserId, cancellationToken);
        if (!ownsAlbum)
        {
            return (InviteAlbumMemberResult.AlbumNotFound, null);
        }

        // Self-invite is reported distinctly ONLY here: the owner obviously
        // already knows their own address exists, so there is nothing to leak,
        // and a generic "unavailable" would be a confusing error for a very
        // easy mistake.
        var self = await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id == ownerUserId && u.Email.ToLower() == normalized, cancellationToken);
        if (self)
        {
            return (InviteAlbumMemberResult.RecipientIsOwner, null);
        }

        var recipient = await FindInvitableRecipientAsync(ownerUserId, request.Email, cancellationToken);
        if (recipient is null)
        {
            return (InviteAlbumMemberResult.RecipientUnavailable, null);
        }

        var now = _time.GetUtcNow().UtcDateTime;

        // One row per (album, member). A declined or revoked row is REUSED so
        // the unique index stays a plain one and history lives in the audit log.
        var existing = await _db.AlbumMemberships
            .FirstOrDefaultAsync(
                m => m.AlbumId == albumId && m.MemberUserId == recipient.Id,
                cancellationToken);

        if (existing is not null)
        {
            var active = existing.RevokedAt == null
                && (existing.State == AlbumMembershipStates.Pending
                    || existing.State == AlbumMembershipStates.Accepted);
            if (active)
            {
                return (InviteAlbumMemberResult.AlreadyInvited, null);
            }

            existing.Role = role;
            existing.State = AlbumMembershipStates.Pending;
            existing.AllowOriginalDownload = request.AllowOriginalDownload;
            existing.InvitedByUserId = ownerUserId;
            existing.InvitedAt = now;
            existing.AcceptedAt = null;
            existing.DeclinedAt = null;
            existing.RevokedAt = null;
            existing.UpdatedAt = now;
            await _db.SaveChangesAsync(cancellationToken);
            return (InviteAlbumMemberResult.Ok, ToDto(existing, recipient.DisplayName, recipient.Email));
        }

        var membership = new AlbumMembership
        {
            Id = Guid.NewGuid(),
            AlbumId = albumId,
            MemberUserId = recipient.Id,
            Role = role,
            State = AlbumMembershipStates.Pending,
            AllowOriginalDownload = request.AllowOriginalDownload,
            InvitedByUserId = ownerUserId,
            InvitedAt = now,
            UpdatedAt = now,
        };
        _db.AlbumMemberships.Add(membership);

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Two concurrent invites for the same recipient: the unique index
            // decided, and the loser reports the same duplicate outcome as the
            // sequential case rather than a 500.
            _db.Entry(membership).State = EntityState.Detached;
            return (InviteAlbumMemberResult.AlreadyInvited, null);
        }

        return (InviteAlbumMemberResult.Ok, ToDto(membership, recipient.DisplayName, recipient.Email));
    }

    public async Task<(AlbumMemberMutationResult Result, AlbumMemberDto? Member)> UpdateMemberAsync(
        Guid ownerUserId, Guid albumId, Guid membershipId, bool allowOriginalDownload,
        CancellationToken cancellationToken = default)
    {
        var membership = await LoadOwnedMembershipAsync(ownerUserId, albumId, membershipId, cancellationToken);
        if (membership is null)
        {
            return (AlbumMemberMutationResult.NotFound, null);
        }

        membership.AllowOriginalDownload = allowOriginalDownload;
        membership.UpdatedAt = _time.GetUtcNow().UtcDateTime;
        await _db.SaveChangesAsync(cancellationToken);

        var member = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == membership.MemberUserId)
            .Select(u => new { u.DisplayName, u.Email })
            .FirstOrDefaultAsync(cancellationToken);

        return (AlbumMemberMutationResult.Ok,
            ToDto(membership, member?.DisplayName ?? string.Empty, member?.Email));
    }

    public async Task<AlbumMemberMutationResult> RevokeMemberAsync(
        Guid ownerUserId, Guid albumId, Guid membershipId,
        CancellationToken cancellationToken = default)
    {
        var membership = await LoadOwnedMembershipAsync(ownerUserId, albumId, membershipId, cancellationToken);
        if (membership is null)
        {
            return AlbumMemberMutationResult.NotFound;
        }

        // Idempotent: an already-revoked row is left as it is (its original
        // RevokedAt is the one that matters for the audit trail).
        if (membership.RevokedAt is null)
        {
            var now = _time.GetUtcNow().UtcDateTime;
            membership.State = AlbumMembershipStates.Revoked;
            membership.RevokedAt = now;
            membership.UpdatedAt = now;
            await _db.SaveChangesAsync(cancellationToken);
        }

        return AlbumMemberMutationResult.Ok;
    }

    // ── Recipient side ──────────────────────────────────────────────────────

    public async Task<IReadOnlyList<SharedAlbumSummary>> ListSharedWithMeAsync(
        Guid actorUserId, CancellationToken cancellationToken = default)
    {
        var rows = await ActiveMembershipsOf(actorUserId)
            .Join(_db.Albums.AsNoTracking(),
                m => m.AlbumId,
                a => a.Id,
                (m, a) => new { m.Role, m.AllowOriginalDownload, m.AcceptedAt, Album = a })
            // A disabled owner's albums disappear from the list, matching
            // AlbumAccessResolver — the listing must not advertise something the
            // media routes would refuse.
            .Join(_db.Users.AsNoTracking().Where(u => u.DisabledAt == null),
                x => x.Album.OwnerUserId,
                u => u.Id,
                (x, u) => new
                {
                    x.Album.Id,
                    x.Album.Name,
                    x.Album.Description,
                    OwnerDisplayName = u.DisplayName,
                    x.Role,
                    x.AllowOriginalDownload,
                    x.AcceptedAt,
                })
            .OrderBy(x => x.Name)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
        {
            return Array.Empty<SharedAlbumSummary>();
        }

        // ONE query for every listed album's displayable members (no N+1),
        // mirroring AlbumService.ListAsync. Item counts and cover tiles are
        // derived from the SAME visibility predicate the media routes enforce,
        // so a count can never promise an item the viewer cannot open.
        var albumIds = rows.Select(x => x.Id).ToList();
        var facts = await DisplayableMembers()
            .Where(x => albumIds.Contains(x.AlbumId))
            .OrderBy(x => x.AddedAt)
            .ThenBy(x => x.FileItemId)
            .Select(x => new { x.AlbumId, x.FileItemId, x.AlbumOwnerUserId, x.MediaCategory })
            .ToListAsync(cancellationToken);

        var byAlbum = facts.GroupBy(x => x.AlbumId).ToDictionary(g => g.Key, g => g.ToList());

        return rows.Select(x =>
        {
            var members = byAlbum.GetValueOrDefault(x.Id) ?? [];
            var cover = members
                .Take(4)
                .Select(m => new SharedAlbumCoverItem(
                    m.FileItemId,
                    m.MediaCategory == MediaCategories.Video ? "video" : "image",
                    m.MediaCategory == MediaCategories.Video
                        ? SharedMediaUrls.Poster(x.Id, m.FileItemId)
                        : SharedMediaUrls.Thumbnail(x.Id, m.FileItemId)))
                .ToList();
            return new SharedAlbumSummary(
                x.Id, x.Name, x.Description, x.OwnerDisplayName,
                x.Role, x.AllowOriginalDownload,
                members.Count,
                x.AcceptedAt ?? DateTime.MinValue,
                cover);
        }).ToList();
    }

    public async Task<IReadOnlyList<AlbumInvitationDto>> ListInvitationsAsync(
        Guid actorUserId, CancellationToken cancellationToken = default)
    {
        var rows = await _db.AlbumMemberships
            .AsNoTracking()
            .Where(m => m.MemberUserId == actorUserId
                && m.State == AlbumMembershipStates.Pending
                && m.RevokedAt == null)
            .Join(_db.Albums.AsNoTracking(),
                m => m.AlbumId,
                a => a.Id,
                (m, a) => new { Membership = m, Album = a })
            .Join(_db.Users.AsNoTracking().Where(u => u.DisabledAt == null),
                x => x.Album.OwnerUserId,
                u => u.Id,
                (x, u) => new
                {
                    MembershipId = x.Membership.Id,
                    AlbumId = x.Album.Id,
                    AlbumName = x.Album.Name,
                    AlbumDescription = x.Album.Description,
                    OwnerDisplayName = u.DisplayName,
                    x.Membership.Role,
                    x.Membership.AllowOriginalDownload,
                    x.Membership.InvitedAt,
                })
            .OrderByDescending(x => x.InvitedAt)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
        {
            return Array.Empty<AlbumInvitationDto>();
        }

        // The item count an invitation advertises uses the same displayable
        // predicate as the album itself, so "12 items" means 12 openable items.
        var albumIds = rows.Select(x => x.AlbumId).ToList();
        var counts = (await DisplayableMembers()
                .Where(x => albumIds.Contains(x.AlbumId))
                .Select(x => x.AlbumId)
                .ToListAsync(cancellationToken))
            .GroupBy(id => id)
            .ToDictionary(g => g.Key, g => g.Count());

        return rows.Select(x => new AlbumInvitationDto(
            x.MembershipId,
            x.AlbumId,
            x.AlbumName,
            x.AlbumDescription,
            x.OwnerDisplayName,
            x.Role,
            x.AllowOriginalDownload,
            counts.GetValueOrDefault(x.AlbumId),
            x.InvitedAt)).ToList();
    }

    public async Task<AlbumInvitationResponseResult> RespondToInvitationAsync(
        Guid actorUserId, Guid membershipId, bool accept,
        CancellationToken cancellationToken = default)
    {
        // Only the invited user, only while pending, only while unrevoked. All
        // three are in the predicate, so a cancelled invitation cannot be
        // accepted by a client that still has the old id on screen.
        var membership = await _db.AlbumMemberships
            .FirstOrDefaultAsync(
                m => m.Id == membershipId
                    && m.MemberUserId == actorUserId
                    && m.State == AlbumMembershipStates.Pending
                    && m.RevokedAt == null,
                cancellationToken);
        if (membership is null)
        {
            return AlbumInvitationResponseResult.NotFound;
        }

        var now = _time.GetUtcNow().UtcDateTime;
        if (accept)
        {
            membership.State = AlbumMembershipStates.Accepted;
            membership.AcceptedAt = now;
        }
        else
        {
            membership.State = AlbumMembershipStates.Declined;
            membership.DeclinedAt = now;
        }
        membership.UpdatedAt = now;
        await _db.SaveChangesAsync(cancellationToken);

        return AlbumInvitationResponseResult.Ok;
    }

    // ── Shared read model ───────────────────────────────────────────────────

    public async Task<SharedAlbumDetail> GetSharedAlbumAsync(
        AlbumAccessGrant grant, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(grant);

        var album = await _db.Albums
            .AsNoTracking()
            .Where(a => a.Id == grant.AlbumId)
            .Select(a => new { a.Name, a.Description })
            .FirstAsync(cancellationToken);

        var ownerDisplayName = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == grant.AlbumOwnerUserId)
            .Select(u => u.DisplayName)
            .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;

        var count = await DisplayableMembers()
            .Where(x => x.AlbumId == grant.AlbumId)
            .CountAsync(cancellationToken);

        return new SharedAlbumDetail(
            grant.AlbumId, album.Name, album.Description, ownerDisplayName,
            grant.Role, grant.AllowOriginalDownload, count);
    }

    public async Task<IReadOnlyList<SharedAlbumItem>> ListSharedItemsAsync(
        AlbumAccessGrant grant, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(grant);

        var rows = await DisplayableMembers()
            .Where(x => x.AlbumId == grant.AlbumId)
            // Id is a stable tie-break: bulk-added items share AddedAt, and
            // without it the grid would reshuffle between loads.
            .OrderBy(x => x.AddedAt)
            .ThenBy(x => x.FileItemId)
            .Select(x => new
            {
                x.FileItemId,
                x.AddedAt,
                x.MediaCategory,
                x.DetectedContentType,
                x.Width,
                x.Height,
                x.Orientation,
            })
            .ToListAsync(cancellationToken);

        return rows.Select(x =>
        {
            var isVideo = x.MediaCategory == MediaCategories.Video;
            var (width, height) = ImageDisplayDimensions.Resolve(x.Width, x.Height, x.Orientation);
            return new SharedAlbumItem(
                x.FileItemId,
                isVideo ? "video" : "image",
                SharedMediaUrls.Thumbnail(grant.AlbumId, x.FileItemId),
                SharedMediaUrls.Preview(grant.AlbumId, x.FileItemId),
                isVideo ? SharedMediaUrls.Poster(grant.AlbumId, x.FileItemId) : null,
                // Playback is offered only for a video whose detected type the
                // server trusts, matching the owner-side /video gate.
                isVideo && SafeContentType.IsTrustedVideo(x.DetectedContentType)
                    ? SharedMediaUrls.Video(grant.AlbumId, x.FileItemId)
                    : null,
                // Advertised only when the grant permits originals. The endpoint
                // re-checks the same permission — this is a UI courtesy, not the
                // control.
                grant.AllowOriginalDownload
                    ? SharedMediaUrls.Content(grant.AlbumId, x.FileItemId)
                    : null,
                width,
                height,
                x.AddedAt);
        }).ToList();
    }

    // ── Internals ───────────────────────────────────────────────────────────

    // Accepted, unrevoked memberships of one user. The single definition of
    // "shared with me" used by every listing here.
    private IQueryable<AlbumMembership> ActiveMembershipsOf(Guid actorUserId) =>
        _db.AlbumMemberships
            .AsNoTracking()
            .Where(m => m.MemberUserId == actorUserId
                && m.State == AlbumMembershipStates.Accepted
                && m.RevokedAt == null);

    // Album members that are currently servable: owned by the album's owner,
    // not soft-deleted, in the media library, and detected image/video. This is
    // the SAME predicate AlbumAccessResolver.ResolveMediaAsync applies to a
    // single item, so listings and media requests can never disagree.
    //
    // Private Vault needs no clause: the global query filter on FileItems
    // removes vaulted rows before this composes.
    private IQueryable<MemberRow> DisplayableMembers() =>
        _db.AlbumItems
            .AsNoTracking()
            .Join(_db.Albums.AsNoTracking(),
                ai => ai.AlbumId,
                a => a.Id,
                (ai, a) => new { ai.AlbumId, ai.FileItemId, ai.AddedAt, a.OwnerUserId })
            .Join(_db.FileItems.AsNoTracking(),
                x => x.FileItemId,
                f => f.Id,
                (x, f) => new
                {
                    x.AlbumId,
                    x.FileItemId,
                    x.AddedAt,
                    AlbumOwnerUserId = x.OwnerUserId,
                    FileOwnerUserId = f.OwnerUserId,
                    f.BlobObjectId,
                    f.DeletedAt,
                    f.MediaLibraryState,
                })
            .Where(x => x.FileOwnerUserId == x.AlbumOwnerUserId
                && x.DeletedAt == null
                && x.MediaLibraryState == MediaLibraryState.Active)
            .Join(_db.BlobMetadata.AsNoTracking(),
                x => x.BlobObjectId,
                m => m.BlobObjectId,
                (x, m) => new MemberRow
                {
                    AlbumId = x.AlbumId,
                    FileItemId = x.FileItemId,
                    AddedAt = x.AddedAt,
                    AlbumOwnerUserId = x.AlbumOwnerUserId,
                    MediaCategory = m.MediaCategory,
                    DetectedContentType = m.DetectedContentType,
                    Width = m.Width,
                    Height = m.Height,
                    Orientation = m.Orientation,
                })
            .Where(x => x.MediaCategory == MediaCategories.Image
                || x.MediaCategory == MediaCategories.Video);

    // Exact, case-insensitive email match against an ACTIVE account other than
    // the caller. Deliberately not a prefix/substring search: over a unique
    // account identifier that is a directory-enumeration primitive.
    private async Task<RecipientRow?> FindInvitableRecipientAsync(
        Guid ownerUserId, string? email, CancellationToken cancellationToken)
    {
        var normalized = NormalizeEmail(email);
        if (normalized is null)
        {
            return null;
        }

        return await _db.Users
            .AsNoTracking()
            .Where(u => u.Email.ToLower() == normalized
                && u.DisabledAt == null
                && u.Id != ownerUserId)
            .Select(u => new RecipientRow(u.Id, u.DisplayName, u.Email))
            .FirstOrDefaultAsync(cancellationToken);
    }

    private Task<AlbumMembership?> LoadOwnedMembershipAsync(
        Guid ownerUserId, Guid albumId, Guid membershipId, CancellationToken cancellationToken) =>
        _db.AlbumMemberships
            .Where(m => m.Id == membershipId && m.AlbumId == albumId)
            .Where(m => _db.Albums.Any(a => a.Id == albumId && a.OwnerUserId == ownerUserId))
            .FirstOrDefaultAsync(cancellationToken);

    private static AlbumMemberDto ToDto(AlbumMembership m, string displayName, string? email) =>
        new(m.Id, displayName, RecipientEmailMask.Mask(email),
            m.Role, m.State, m.AllowOriginalDownload,
            m.InvitedAt, m.AcceptedAt, m.DeclinedAt, m.RevokedAt);

    // Lower-cased, trimmed, and minimally shape-checked. Not an RFC validator:
    // the only thing that matters is that it either matches a stored address
    // exactly or matches nothing.
    private static string? NormalizeEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return null;
        }

        var trimmed = email.Trim();
        if (trimmed.Length > 320)
        {
            return null;
        }

        var at = trimmed.IndexOf('@');
        if (at <= 0 || at != trimmed.LastIndexOf('@') || at == trimmed.Length - 1)
        {
            return null;
        }

        return trimmed.ToLowerInvariant();
    }

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException?.Message.Contains("23505") == true
        || ex.InnerException?.Message.Contains("UNIQUE") == true;

    private sealed record RecipientRow(Guid Id, string DisplayName, string Email);

    // A class (not a positional record) so EF Core can bind its members in the
    // Join result selector and still compose Where/OrderBy/Count over it —
    // the same reason PartyMediaService.MemberRow is one.
    private sealed class MemberRow
    {
        public Guid AlbumId { get; set; }
        public Guid FileItemId { get; set; }
        public DateTime AddedAt { get; set; }
        public Guid AlbumOwnerUserId { get; set; }
        public string MediaCategory { get; set; } = string.Empty;
        public string? DetectedContentType { get; set; }
        public int? Width { get; set; }
        public int? Height { get; set; }
        public int? Orientation { get; set; }
    }
}

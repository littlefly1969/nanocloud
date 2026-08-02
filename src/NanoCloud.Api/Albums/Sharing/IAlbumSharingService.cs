namespace NanoCloud.Api.Albums.Sharing;

// SHARE-ALBUM-01: invitation lifecycle + the recipient-facing read model for
// live shared albums.
//
// Split of responsibility with IAlbumAccessResolver: the resolver answers "may
// this caller act on this album" and is consulted on every single request; this
// service performs the owner's management actions and builds the DTOs a caller
// who ALREADY holds a grant is allowed to see. It never decides access for a
// media request.
public interface IAlbumSharingService
{
    // ── Owner side ──────────────────────────────────────────────────────────

    // Confirms that an exact email belongs to an invitable account and returns
    // only its display name. Null for: album missing/foreign, no such account,
    // a disabled account, a malformed address, or the owner's own address —
    // one indistinguishable answer, so this cannot be used to probe which
    // addresses are registered or which accounts are disabled.
    Task<ResolveAlbumRecipientResponse?> ResolveRecipientAsync(
        Guid ownerUserId, Guid albumId, string? email,
        CancellationToken cancellationToken = default);

    // The album's members and outstanding invitations. Null when the album is
    // missing or not the caller's.
    Task<IReadOnlyList<AlbumMemberDto>?> ListMembersAsync(
        Guid ownerUserId, Guid albumId,
        CancellationToken cancellationToken = default);

    // Invites an active user by exact email. Re-inviting somebody who declined
    // or was revoked REUSES their row: state back to pending, decision
    // timestamps cleared, a fresh InvitedAt.
    Task<(InviteAlbumMemberResult Result, AlbumMemberDto? Member)> InviteAsync(
        Guid ownerUserId, Guid albumId, InviteAlbumMemberRequest request,
        CancellationToken cancellationToken = default);

    // Changes one member's original-download permission. Takes effect on the
    // member's next request; nothing is cached.
    Task<(AlbumMemberMutationResult Result, AlbumMemberDto? Member)> UpdateMemberAsync(
        Guid ownerUserId, Guid albumId, Guid membershipId, bool allowOriginalDownload,
        CancellationToken cancellationToken = default);

    // Cancels a pending invitation or revokes an accepted membership — the same
    // operation, because both mean "this person no longer has, and no longer
    // will get, access". Idempotent: revoking an already-revoked row succeeds.
    Task<AlbumMemberMutationResult> RevokeMemberAsync(
        Guid ownerUserId, Guid albumId, Guid membershipId,
        CancellationToken cancellationToken = default);

    // ── Recipient side ──────────────────────────────────────────────────────

    // Live albums currently shared WITH the caller (accepted, not revoked, owner
    // account active). Never includes the caller's own albums.
    Task<IReadOnlyList<SharedAlbumSummary>> ListSharedWithMeAsync(
        Guid actorUserId, CancellationToken cancellationToken = default);

    // Invitations addressed to the caller and not yet answered.
    Task<IReadOnlyList<AlbumInvitationDto>> ListInvitationsAsync(
        Guid actorUserId, CancellationToken cancellationToken = default);

    // The recipient's explicit answer. Only the invited user can answer, and
    // only while the invitation is still pending and unrevoked.
    Task<AlbumInvitationResponseResult> RespondToInvitationAsync(
        Guid actorUserId, Guid membershipId, bool accept,
        CancellationToken cancellationToken = default);

    // ── Shared read model (caller already holds a grant) ────────────────────

    Task<SharedAlbumDetail> GetSharedAlbumAsync(
        AlbumAccessGrant grant, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<SharedAlbumItem>> ListSharedItemsAsync(
        AlbumAccessGrant grant, CancellationToken cancellationToken = default);
}

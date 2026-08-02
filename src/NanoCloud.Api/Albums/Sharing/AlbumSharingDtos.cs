namespace NanoCloud.Api.Albums.Sharing;

// SHARE-ALBUM-01 wire contracts.
//
// PRIVACY RULES ENCODED IN THESE SHAPES — none of them is incidental:
//
//  * No EMAIL ADDRESS of another user is ever serialised. NubArca has no public
//    handle: `User.Email` is the only unique human-typeable identifier and
//    `User.DisplayName` is the only field already shown as an identity. So an
//    invitation is addressed BY exact email (which the inviter already knows,
//    because they typed it) and every listing renders only a display name.
//  * No user id of another user is ever serialised. An owner addresses a member
//    row by its MembershipId, which is scoped to this album and useless
//    elsewhere.
//  * No `PersonId`, person name, face assignment, suggested group, AI caption or
//    owner-private annotation appears in any shape here. The recipient receives
//    media access, not the owner's semantic layer.
//  * No file NAME appears in the shared item shape. A filename is owner-authored
//    free text that can carry a person's name ("compleanno di Marco.jpg"); the
//    public Party surface already omits it for the same reason and the viewer
//    does not need it.
//  * No StorageKey, BlobId, SHA-256, physical path, thumbnail key or HLS
//    derivative id appears anywhere. Every media URL is album-scoped and is
//    re-authorized on use; a URL is a route, not a capability.

// ── Owner-facing: managing who this album is shared with ────────────────────

// One row of the owner's member list. `DisplayName` is the member's
// User.DisplayName — never their email, never their user id. `MembershipId`
// addresses this row for update/revoke.
//
// `MaskedEmail` ("m•••i@nubarca.local") exists because DisplayName is NOT
// unique: without it an owner with two members called "Mario Rossi" cannot tell
// which one to revoke. It is served ONLY here, only to the album owner, and only
// ever masked — see RecipientEmailMask for why that is the right amount.
public sealed record AlbumMemberDto(
    Guid MembershipId,
    string DisplayName,
    string MaskedEmail,
    string Role,
    string State,
    bool AllowOriginalDownload,
    DateTime InvitedAt,
    DateTime? AcceptedAt,
    DateTime? DeclinedAt,
    DateTime? RevokedAt);

// Step 1 of inviting: the owner types an exact email and gets back the display
// name to confirm they have the right person. Deliberately NOT a prefix or
// substring search — a prefix search over a unique account identifier is a
// directory-enumeration primitive, and the contract asks for the complete
// directory not to be exposed.
public sealed record ResolveAlbumRecipientRequest(string? Email);

// The confirmation shown before sending. Carries only the display name: the
// owner already holds the email (they typed it), so echoing it back adds
// nothing, and not returning it keeps emails out of every response body.
public sealed record ResolveAlbumRecipientResponse(string DisplayName);

// Step 2: send the invitation. `Role` defaults to viewer and, in
// SHARE-ALBUM-01, viewer is the only assignable value.
public sealed record InviteAlbumMemberRequest(
    string? Email,
    string? Role = null,
    bool AllowOriginalDownload = false);

// Owner changes a member's per-member original-download permission. Role changes
// are owner governance and land in SHARE-ALBUM-03.
public sealed record UpdateAlbumMemberRequest(bool AllowOriginalDownload);

// ── Recipient-facing: albums shared with me ─────────────────────────────────

// One tile of a shared album's cover mosaic. The URL is album-scoped: it only
// resolves while the caller still holds a grant on THIS album.
public sealed record SharedAlbumCoverItem(
    Guid FileItemId,
    string Kind,
    string ThumbnailUrl);

// A live album another user has shared with the caller. `OwnerDisplayName` makes
// the "owned by somebody else" state visible; `Role` and `AllowOriginalDownload`
// let the client hide controls it must not offer (the server enforces them
// regardless).
public sealed record SharedAlbumSummary(
    Guid AlbumId,
    string Name,
    string? Description,
    string OwnerDisplayName,
    string Role,
    bool AllowOriginalDownload,
    int ItemCount,
    DateTime SharedAt,
    IReadOnlyList<SharedAlbumCoverItem> CoverItems);

public sealed record SharedAlbumDetail(
    Guid AlbumId,
    string Name,
    string? Description,
    string OwnerDisplayName,
    string Role,
    bool AllowOriginalDownload,
    int ItemCount);

// One media item of a shared album. `Kind` is "image" | "video".
// `DownloadUrl` is null unless the membership permits originals — and the
// endpoint re-checks the same permission, so hiding it is a UI courtesy, not the
// control. `Width`/`Height` are DISPLAY dimensions (EXIF quarter-turns already
// applied) so the media wall can reserve a correctly-shaped tile.
public sealed record SharedAlbumItem(
    Guid FileItemId,
    string Kind,
    string ThumbnailUrl,
    string PreviewUrl,
    string? PosterUrl,
    string? VideoUrl,
    string? DownloadUrl,
    int? Width,
    int? Height,
    DateTime AddedAt);

// An invitation the caller has been sent and has not answered. Shows enough to
// decide (who, what album, how many items, what it permits) and nothing more —
// no media URLs, because a pending invitation grants no access to the content.
public sealed record AlbumInvitationDto(
    Guid MembershipId,
    Guid AlbumId,
    string AlbumName,
    string? AlbumDescription,
    string OwnerDisplayName,
    string Role,
    bool AllowOriginalDownload,
    int ItemCount,
    DateTime InvitedAt);

// ── Service outcomes ────────────────────────────────────────────────────────

// Expected, guardable outcomes of an invite. The endpoint maps these to status
// codes; the service never throws for any of them.
public enum InviteAlbumMemberResult
{
    Ok,
    // The album is missing or not the caller's. Same value for both: the caller
    // must not learn that somebody else's album exists.
    AlbumNotFound,
    // No active user holds that exact email — OR the address belongs to a
    // disabled account. One value for both, so a disabled account cannot be
    // distinguished from a nonexistent one.
    RecipientUnavailable,
    // The owner tried to invite themselves.
    RecipientIsOwner,
    // A pending or accepted membership already exists for this recipient.
    AlreadyInvited,
    // The requested role is not assignable in this slice.
    RoleNotAssignable,
    InvalidEmail,
}

public enum AlbumInvitationResponseResult
{
    Ok,
    // No pending invitation with that id is addressed to the caller.
    NotFound,
}

public enum AlbumMemberMutationResult
{
    Ok,
    // The album is missing/foreign, or no such membership belongs to it.
    NotFound,
}

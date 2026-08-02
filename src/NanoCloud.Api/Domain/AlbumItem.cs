namespace NanoCloud.Api.Domain;

// A file's membership of an album.
//
// SHARE-ALBUM-02 gave this row PROVENANCE. Before it, only the album owner could
// add anything, so "who put this here" was always the owner and never needed
// storing. Now a Contributor can add media they own to somebody else's album,
// and three questions have to be answerable from the row itself:
//
//   who owns the media   → FileItem.OwnerUserId (never duplicated here)
//   who put it here      → AddedByUserId
//   when                 → AddedAt
//
// "Is it currently active" is the existence of the row. Album items are HARD
// deleted — by the owner removing them, by the contributor withdrawing them, by
// a membership revocation, and by the permanent-delete/sweeper paths that
// already clear every AlbumItem for a file. Introducing a soft-delete instead
// would mean re-checking an `IsActive` predicate in every one of the read paths
// listed in the SHARE-ALBUM-02 audit — including Party and TV — where a single
// miss silently republishes withdrawn media. "Who removed it, and when" is
// answered by the audit log, which is where that question belongs.
public class AlbumItem
{
    public Guid AlbumId { get; set; }
    public Guid FileItemId { get; set; }
    public DateTime AddedAt { get; set; }

    // The user who placed this item in the album — the album owner for their
    // own media, or a Contributor for a linked contribution. NOT the media's
    // owner: that stays on FileItem and is never copied here, so the two can
    // never drift apart.
    //
    // Backfilled to the album's owner by the AddAlbumItemProvenance migration:
    // before SHARE-ALBUM-02 nobody else could add anything, so that value is
    // accurate rather than a placeholder. Non-nullable, so no "null means the
    // owner" special case leaks into the query predicates.
    public Guid AddedByUserId { get; set; }
}

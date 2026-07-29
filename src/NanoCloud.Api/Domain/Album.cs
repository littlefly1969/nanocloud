namespace NanoCloud.Api.Domain;

public class Album
{
    public Guid Id { get; set; }
    public Guid OwnerUserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }

    // Owner-controlled allowlist flag: when true, a paired TV session belonging
    // to this album's owner may browse/play this album's media. Owner-scoped by
    // virtue of the album itself (never blob-global); default false so nothing
    // is exposed to a TV until the owner explicitly opts in. Disabling it is
    // re-checked on every TV request, so an album disappears from the TV on the
    // next list/poll/media call.
    public bool ShowOnTv { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

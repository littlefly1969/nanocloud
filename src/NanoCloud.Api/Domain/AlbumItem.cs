namespace NanoCloud.Api.Domain;

public class AlbumItem
{
    public Guid AlbumId { get; set; }
    public Guid FileItemId { get; set; }
    public DateTime AddedAt { get; set; }
}

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NanoCloud.Api.Domain;

namespace NanoCloud.Api.Data.Configurations;

public class AlbumItemConfiguration : IEntityTypeConfiguration<AlbumItem>
{
    public void Configure(EntityTypeBuilder<AlbumItem> builder)
    {
        builder.ToTable("album_items");
        builder.HasKey(ai => new { ai.AlbumId, ai.FileItemId });
        builder.Property(ai => ai.AddedAt).HasColumnType("timestamp with time zone");

        // Reverse lookup "which albums is this file in" — the index behind the
        // albumMembership=assigned/unassigned EXISTS / NOT EXISTS predicates on
        // the photo and video galleries. Declared explicitly because a gallery
        // filter now depends on it; EF already materialises the same index from
        // the FileItemId foreign key below (IX_album_items_FileItemId, created
        // by the AddAlbums migration), so this is documentation, not a schema
        // change — it produces no new migration.
        builder.HasIndex(ai => ai.FileItemId);

        builder.HasOne<Album>()
            .WithMany()
            .HasForeignKey(ai => ai.AlbumId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<FileItem>()
            .WithMany()
            .HasForeignKey(ai => ai.FileItemId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

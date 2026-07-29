using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NanoCloud.Api.Domain;

namespace NanoCloud.Api.Data.Configurations;

public class AlbumConfiguration : IEntityTypeConfiguration<Album>
{
    public void Configure(EntityTypeBuilder<Album> builder)
    {
        builder.ToTable("albums");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();
        builder.Property(a => a.Name).IsRequired().HasMaxLength(255);
        builder.Property(a => a.Description).HasMaxLength(1000);
        builder.Property(a => a.ShowOnTv).HasDefaultValue(false);
        builder.Property(a => a.CreatedAt).HasColumnType("timestamp with time zone");
        builder.Property(a => a.UpdatedAt).HasColumnType("timestamp with time zone");

        // Album names are unique per owner.
        builder.HasIndex(a => new { a.OwnerUserId, a.Name })
            .IsUnique()
            .HasDatabaseName("ux_albums_owner_name");

        // Fast lookup of the albums an owner has enabled for TV.
        builder.HasIndex(a => new { a.OwnerUserId, a.ShowOnTv })
            .HasDatabaseName("ix_albums_owner_show_on_tv");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(a => a.OwnerUserId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}

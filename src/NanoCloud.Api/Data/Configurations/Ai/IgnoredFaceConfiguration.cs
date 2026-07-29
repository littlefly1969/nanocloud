using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NanoCloud.Api.Domain;
using NanoCloud.Api.Domain.Ai;

namespace NanoCloud.Api.Data.Configurations.Ai;

public class IgnoredFaceConfiguration : IEntityTypeConfiguration<IgnoredFace>
{
    public void Configure(EntityTypeBuilder<IgnoredFace> builder)
    {
        builder.ToTable("ignored_faces");

        builder.HasKey(i => i.Id);
        builder.Property(i => i.Id).ValueGeneratedNever();
        builder.Property(i => i.CreatedAt).HasColumnType("timestamp with time zone");

        // A face is ignored at most once per owner.
        builder.HasIndex(i => new { i.OwnerUserId, i.FaceDetectionId })
            .IsUnique()
            .HasDatabaseName("ux_ignored_faces_owner_face");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(i => i.OwnerUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<FaceDetection>()
            .WithMany()
            .HasForeignKey(i => i.FaceDetectionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

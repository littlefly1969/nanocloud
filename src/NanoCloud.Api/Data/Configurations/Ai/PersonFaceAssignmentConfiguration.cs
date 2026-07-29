using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NanoCloud.Api.Domain;
using NanoCloud.Api.Domain.Ai;

namespace NanoCloud.Api.Data.Configurations.Ai;

public class PersonFaceAssignmentConfiguration : IEntityTypeConfiguration<PersonFaceAssignment>
{
    public void Configure(EntityTypeBuilder<PersonFaceAssignment> builder)
    {
        builder.ToTable("person_face_assignments");

        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();
        builder.Property(a => a.Source).IsRequired().HasMaxLength(32);
        builder.Property(a => a.CreatedAt).HasColumnType("timestamp with time zone");
        builder.Property(a => a.UpdatedAt).HasColumnType("timestamp with time zone");

        // A face belongs to at most one person per owner.
        builder.HasIndex(a => new { a.OwnerUserId, a.FaceDetectionId })
            .IsUnique()
            .HasDatabaseName("ux_person_face_assignments_owner_face");

        builder.HasIndex(a => a.PersonId)
            .HasDatabaseName("ix_person_face_assignments_person");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(a => a.OwnerUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<Person>()
            .WithMany()
            .HasForeignKey(a => a.PersonId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<FaceDetection>()
            .WithMany()
            .HasForeignKey(a => a.FaceDetectionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

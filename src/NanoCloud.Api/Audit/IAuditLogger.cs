namespace NanoCloud.Api.Audit;

public interface IAuditLogger
{
    Task LogAsync(
        Guid? userId,
        string action,
        string entityType,
        Guid? entityId,
        string? ipAddress,
        object? metadata,
        CancellationToken cancellationToken = default);
}

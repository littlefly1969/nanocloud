namespace NanoCloud.Api.ShareLinks;

public sealed record CreateShareLinkRequest(DateTime? ExpiresAt, int? MaxDownloads);

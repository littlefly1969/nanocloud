namespace NanoCloud.Api.Auth;

public sealed record ChangeMyPasswordRequest(string? CurrentPassword, string? NewPassword);

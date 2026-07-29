using NanoCloud.Api.Domain;

namespace NanoCloud.Api.Auth;

public interface IAuthService
{
    Task<User?> AuthenticateAsync(string? email, string? password, CancellationToken cancellationToken = default);

    Task SetPasswordAsync(Guid userId, string password, CancellationToken cancellationToken = default);
}

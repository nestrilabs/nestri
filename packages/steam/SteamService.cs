using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;

// Steam Service
public class SteamService
{
    private readonly ConcurrentDictionary<string, SteamClientHandler> _clientHandlers = new();

    private readonly IServiceProvider _serviceProvider;

    public SteamService(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider;
    }

    public Action SubscribeToEvents(string clientId, Action<ServerSentEvent> callback)
    {
        if (_clientHandlers.TryGetValue(clientId, out var handler))
        {
            return handler.Subscribe(callback);
        }

        return () => { }; // Empty unsubscribe function
    }
    public async Task StartAuthentication(string userId)
    {
        var clientId = $"{userId}";

        // Check if we already have stored credentials
        using var scope = _serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();
        var storedCredential = await dbContext.SteamUserCredentials
            .FirstOrDefaultAsync(c => c.UserId == userId);

        var handler = _clientHandlers.GetOrAdd(clientId, id => new SteamClientHandler(id,
                    async (accountName, refreshToken) => await SaveCredentials(userId, accountName, refreshToken)));

        if (storedCredential != null)
        {
            // We have stored credentials, try to use them
            var success = await handler.LoginWithStoredCredentialsAsync(storedCredential.AccountName, storedCredential.RefreshToken);

            // If login failed, start fresh authentication
            if (!success)
            {
                await handler.StartAuthenticationAsync();
            }
            return;
        }

        // No stored credentials, start fresh authentication
        await handler.StartAuthenticationAsync();
    }

    private async Task SaveCredentials(string userId, string accountName, string refreshToken)
    {
        try
        {
            using var scope = _serviceProvider.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();

            var existingCredential = await dbContext.SteamUserCredentials
                .FirstOrDefaultAsync(c => c.UserId == userId);

            if (existingCredential != null)
            {
                // Update existing record
                existingCredential.AccountName = accountName;
                existingCredential.RefreshToken = refreshToken;
                existingCredential.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                // Create new record
                dbContext.SteamUserCredentials.Add(new SteamUserCredentials
                {
                    UserId = userId,
                    AccountName = accountName,
                    RefreshToken = refreshToken
                });
            }

            await dbContext.SaveChangesAsync();
            Console.WriteLine($"Saved Steam credentials for {userId}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error saving credentials: {ex.Message}");
        }
    }

    public async Task<SteamUserInfo?> GetUserInfoFromStoredCredentials(string userId)
    {
        var clientId = $"{userId}";

        // Check if we have an active session
        if (_clientHandlers.TryGetValue(clientId, out var activeHandler) && activeHandler.UserInfo != null)
        {
            return activeHandler.UserInfo;
        }

        // Try to get stored credentials
        using var scope = _serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();
        var storedCredential = await dbContext.SteamUserCredentials
            .FirstOrDefaultAsync(c => c.UserId == userId);

        if (storedCredential == null)
        {
            return null; // No stored credentials
        }

        // Create a new handler and try to log in
        var handler = new SteamClientHandler(clientId);
        var success = await handler.LoginWithStoredCredentialsAsync(
            storedCredential.AccountName,
            storedCredential.RefreshToken
        );

        if (success)
        {
            _clientHandlers.TryAdd(clientId, handler);
            return handler.UserInfo;
        }

        // Login failed, credentials might be invalid
        return null;
    }

    public Action Subscribe(string clientId, Action<string> callback)
    {
        if (_clientHandlers.TryGetValue(clientId, out var handler))
        {
            return handler.Subscribe(callback);
        }

        return () => { }; // Empty unsubscribe function
    }

    public void Unsubscribe(string clientId, Action unsubscribeAction)
    {
        unsubscribeAction();
    }

    public SteamUserInfo? GetUserInfo(string clientId)
    {
        if (_clientHandlers.TryGetValue(clientId, out var handler))
        {
            return handler.UserInfo;
        }

        return null;
    }
}
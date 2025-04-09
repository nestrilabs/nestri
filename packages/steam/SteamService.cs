using SteamAuth;
using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;

// Steam Service
public class SteamService
{
    private readonly ConcurrentDictionary<string, SteamAuthComponent> _clientHandlers = new();
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
        // Check if we already have stored credentials
        using var scope = _serviceProvider.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();
        var storedCredential = await dbContext.SteamUserCredentials
            .FirstOrDefaultAsync(c => c.UserId == userId);

        // Pass service provider instead of dbContext
        var handler = _clientHandlers.GetOrAdd(userId, id => new SteamAuthComponent(_serviceProvider, userId,
                    async (accountName, refreshToken) => await SaveCredentials(userId, accountName, refreshToken)));

        if (storedCredential != null)
        {
            handler.SetCredentials(storedCredential.AccountName, storedCredential.RefreshToken);
        }

        await handler.HandleLoginRequest();
        handler.Disconnect();
    }

    public void DisconnectUser(string userId)
    {
        if (_clientHandlers.TryGetValue(userId, out var handler))
        {
            handler.Disconnect();
            _clientHandlers.TryRemove(userId, out _);
        }
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

    // public async Task<SteamUserInfo?> GetUserInfoFromStoredCredentials(string userId)
    // {
    //     try
    //     {
    //         // Check if we have an active session
    //         if (_clientHandlers.TryGetValue(userId, out var activeHandler) && activeHandler.UserInfo != null)
    //         {
    //             return activeHandler.UserInfo;
    //         }

    //         // Try to get stored credentials
    //         using var scope = _serviceProvider.CreateScope();
    //         var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();
    //         var storedCredential = await dbContext.SteamUserCredentials
    //             .FirstOrDefaultAsync(c => c.UserId == userId);

    //         if (storedCredential == null)
    //         {
    //             return null;
    //         }

    //         // Create a new handler with service provider instead of dbContext
    //         var handler = new SteamClientHandler(userId, _serviceProvider, userId);
    //         var success = await handler.LoginWithStoredCredentialsAsync(
    //             storedCredential.AccountName,
    //             storedCredential.RefreshToken
    //         );

    //         if (success)
    //         {
    //             _clientHandlers.TryAdd(userId, handler);
    //             return handler.UserInfo;
    //         }
    //         return null;
    //     }
    //     catch (Exception ex)
    //     {
    //         Console.WriteLine($"Error retrieving cached user info: {ex.Message}");
    //         return null;
    //     }
    // }

    public async Task<SteamAccountInfo?> GetCachedUserInfoAsync(string userId)
    {
        if (string.IsNullOrEmpty(userId))
            return null;

        try
        {
            using var scope = _serviceProvider.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();
            return await dbContext.SteamAccountInfo
                .AsNoTracking()
                .FirstOrDefaultAsync(info => info.UserId == userId);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error retrieving cached user info: {ex.Message}");
            return null;
        }
    }

    public async Task<bool> HasCachedUserInfoAsync(string userId)
    {
        if (string.IsNullOrEmpty(userId))
            return false;

        try
        {
            using var scope = _serviceProvider.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();
            return await dbContext.SteamAccountInfo
                .AnyAsync(info => info.UserId == userId);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error checking for cached user info: {ex.Message}");
            return false;
        }
    }

    public void Unsubscribe(string clientId, Action unsubscribeAction)
    {
        unsubscribeAction();
    }

    // public SteamUserInfo? GetUserInfo(string clientId)
    // {
    //     if (_clientHandlers.TryGetValue(clientId, out var handler))
    //     {
    //         return handler.UserInfo;
    //     }

    //     return null;
    // }
}
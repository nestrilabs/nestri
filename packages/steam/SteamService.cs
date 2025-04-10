using Microsoft.EntityFrameworkCore;
using System.Collections.Concurrent;

namespace Steam
{
    public class SteamService
    {
        private readonly ConcurrentDictionary<string, SteamAuthComponent> _clientHandlers = new();
        private readonly IServiceProvider _serviceProvider;

        public SteamService(IServiceProvider serviceProvider)
        {
            _serviceProvider = serviceProvider;
        }

        public Action SubscribeToEvents(string userId, Action<ServerSentEvent> callback)
        {
            if (_clientHandlers.TryGetValue(userId, out var handler))
            {
                return handler.Subscribe(callback);
            }

            Console.WriteLine($"Warning: No handler found for user {userId}");
            return () => { }; // Empty unsubscribe function
        }

        public async Task StartAuthentication(string userId)
        {
            // Check for stored credentials
            using var scope = _serviceProvider.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();
            var storedCredential = await dbContext.SteamUserCredentials
                .FirstOrDefaultAsync(c => c.UserId == userId);

            // Create or get auth component
            var handler = _clientHandlers.GetOrAdd(userId, id =>
                new SteamAuthComponent(userId,
                    async (accountName, refreshToken) => await SaveCredentials(userId, accountName, refreshToken)));

            // Set credentials if available
            if (storedCredential != null)
            {
                handler.SetCredentials(storedCredential.AccountName, storedCredential.RefreshToken);
            }

            // Start authentication process
            await handler.HandleLoginRequest();
        }

        public void DisconnectUser(string userId)
        {
            if (_clientHandlers.TryGetValue(userId, out var handler))
            {
                handler.Disconnect();
                _clientHandlers.TryRemove(userId, out _);
            }
        }

        public void Unsubscribe(string userId, Action unsubscribeAction)
        {
            unsubscribeAction();
        }

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
                        RefreshToken = refreshToken,
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow
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
    }
}
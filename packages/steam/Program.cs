using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using System.Text;

namespace Steam
{
    public class Program
    {
        const string UnixSocketPath = "/tmp/steam.sock";
        
        public static void Main(string[] args)
        {
            // Delete the socket file if it exists
            if (File.Exists(UnixSocketPath))
            {
                File.Delete(UnixSocketPath);
            }

            var builder = WebApplication.CreateBuilder(args);

            // Configure Kestrel to listen on Unix socket
            builder.WebHost.ConfigureKestrel(options =>
            {
                options.ListenUnixSocket(UnixSocketPath);
                options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(10);
                options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(5);
            });

            builder.Services.AddControllers();
            builder.Services.AddSingleton<SteamService>();
            builder.Services.AddDbContext<SteamDbContext>(options =>
                options.UseSqlite($"Data Source=/tmp/steam.db"));

            var app = builder.Build();

            // Health check endpoint
            app.MapGet("/", () => "Steam Auth Service is running");

            // Long-running process example endpoint with SSE
            app.MapGet("/api/longprocess", async (HttpResponse response) =>
            {
                response.Headers.Append("Content-Type", "text/event-stream");
                response.Headers.Append("Cache-Control", "no-cache");
                response.Headers.Append("Connection", "keep-alive");

                for (int i = 0; i <= 100; i += 10)
                {
                    await response.WriteAsync($"data: {{\"progress\": {i}}}\n\n");
                    await response.Body.FlushAsync();
                    await Task.Delay(1000); // Simulate work being done
                }

                await response.WriteAsync($"data: {{\"status\": \"completed\"}}\n\n");
                await response.Body.FlushAsync();
            });

            // Steam login endpoint with SSE
            app.MapGet("/login", async (HttpContext context, SteamService steamService) =>
            {
                var userId = context.Request.Headers["user-id"].ToString();
                if (string.IsNullOrEmpty(userId))
                {
                    context.Response.StatusCode = 400;
                    await context.Response.WriteAsync("Missing user ID");
                    return;
                }

                // Set SSE headers
                context.Response.Headers.Append("Connection", "keep-alive");
                context.Response.Headers.Append("Cache-Control", "no-cache");
                context.Response.Headers.Append("Content-Type", "text/event-stream");
                context.Response.Headers.Append("Access-Control-Allow-Origin", "*");

                var responseBodyFeature = context.Features.Get<IHttpResponseBodyFeature>();
                responseBodyFeature?.DisableBuffering();
                
                // Setup cancellation
                var cancellationToken = context.RequestAborted;
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                var linkedToken = cts.Token;

                try
                {
                    // Initial connection confirmation
                    string initialEvent = new ServerSentEvent("connected", new { message = "SSE connection established" }).Serialize();
                    byte[] initialBuffer = Encoding.UTF8.GetBytes(initialEvent);
                    await context.Response.Body.WriteAsync(initialBuffer, linkedToken);
                    await context.Response.Body.FlushAsync(linkedToken);

                    await steamService.StartAuthentication(userId);

                    // Subscribe to events before starting authentication
                    var subscription = steamService.SubscribeToEvents(userId, async (evt) =>
                    {
                        try
                        {
                            // Send the event to the client
                            string eventMessage = evt.Serialize();
                            byte[] buffer = Encoding.UTF8.GetBytes(eventMessage);
                            await context.Response.Body.WriteAsync(buffer, linkedToken);
                            await context.Response.Body.FlushAsync(linkedToken);
                            Console.WriteLine($"Sent event type '{evt.Type}' to client {userId}");

                            // End connection if login completed or failed
                            if (evt.Type == "login-success" || evt.Type == "login-unsuccessful")
                            {
                                await Task.Delay(1000, linkedToken); // Allow time for the event to be sent
                                cts.Cancel();
                            }
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"Error sending event to client {userId}: {ex.Message}");
                            try { cts.Cancel(); } catch { }
                        }
                    });

                    try
                    {
                        // Wait for completion or cancellation
                        await Task.Delay(Timeout.Infinite, linkedToken);
                    }
                    catch (OperationCanceledException)
                    {
                        Console.WriteLine($"Client {userId} connection ending - authentication completed or cancelled");
                    }
                    finally
                    {
                        // Clean up
                        steamService.Unsubscribe(userId, subscription);
                        steamService.DisconnectUser(userId);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error during connection for client {userId}: {ex.Message}");
                    if (!context.Response.HasStarted)
                    {
                        context.Response.StatusCode = 500;
                        await context.Response.WriteAsync("An error occurred during authentication.");
                    }
                    else
                    {
                        // Try to send error as SSE
                        try
                        {
                            string errorEvent = new ServerSentEvent("error", new { message = "Internal server error" }).Serialize();
                            byte[] errorBuffer = Encoding.UTF8.GetBytes(errorEvent);
                            await context.Response.Body.WriteAsync(errorBuffer, CancellationToken.None);
                            await context.Response.Body.FlushAsync(CancellationToken.None);
                        }
                        catch { /* Ignore */ }
                    }
                }
            });

            // User info endpoint
            app.MapGet("/user", async (HttpContext context, SteamService steamService) =>
            {
                var userId = context.Request.Headers["user-id"].ToString();
                if (string.IsNullOrEmpty(userId))
                {
                    return Results.BadRequest("Missing user ID");
                }

                // Get user info from database
                var userInfo = await steamService.GetCachedUserInfoAsync(userId);
                if (userInfo == null)
                {
                    return Results.NotFound(new { error = "User not authenticated with Steam" });
                }

                return Results.Ok(new
                {
                    userId = userInfo.UserId,
                    username = userInfo.Username,
                    steamId = userInfo.SteamId,
                    email = userInfo.Email,
                    country = userInfo.Country,
                    personaName = userInfo.PersonaName,
                    avatarUrl = userInfo.AvatarUrl,
                    isLimited = userInfo.IsLimited,
                    isLocked = userInfo.IsLocked,
                    isBanned = userInfo.IsBanned,
                    isAllowedToInviteFriends = userInfo.IsAllowedToInviteFriends,
                    lastGame = new
                    {
                        gameId = userInfo.GameId,
                        name = userInfo.GamePlayingName
                    },
                    lastLogOn = userInfo.LastLogOn,
                    lastLogOff = userInfo.LastLogOff
                });
            });

            Console.WriteLine("Steam Auth Service started. Press Ctrl+C to stop.");

            // Ensure database is created and migrated
            using (var scope = app.Services.CreateScope())
            {
                var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();
                dbContext.Database.Migrate();
            }

            app.Run();
        }
    }
}
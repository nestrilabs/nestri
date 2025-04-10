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

                // Set keep-alive timeout - this affects how long idle connections stay open
                options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(10);

                // Set request timeout
                options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(5);
            });


            builder.Services.AddControllers();

            builder.Services.AddSingleton<SteamService>();

            builder.Services.AddDbContext<SteamDbContext>(options =>
                options.UseSqlite($"Data Source=/tmp/steam.db"));

            var app = builder.Build();

            // REST endpoints
            app.MapGet("/", () => "Hello World");

            // app.MapGet("/status", async (HttpContext context, SteamService steamService) =>
            // {
            //     var userID = context.Request.Headers["user-id"].ToString();
            //     if (string.IsNullOrEmpty(userID))
            //     {
            //         return Results.BadRequest("Missing user ID");
            //     }
            //     var userInfo = await steamService.GetUserInfoFromStoredCredentials(userID!);
            //     if (userInfo == null)
            //     {
            //         return Results.Ok(new { isAuthenticated = false });
            //     }

            //     return Results.Ok(new
            //     {
            //         isAuthenticated = true,
            //         steamId = userInfo.SteamId,
            //         username = userInfo.Username
            //     });
            // });

            // Long-running processing with progress updates endpoint
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


            app.MapGet("/login", async (HttpContext context, SteamService steamService) =>
            {
                var userID = context.Request.Headers["user-id"].ToString();
                if (string.IsNullOrEmpty(userID))
                {
                    context.Response.StatusCode = 400;
                    await context.Response.WriteAsync("Missing user ID");
                    return;  // Early return, no Results object
                }

                // Set SSE headers
                context.Response.Headers.Append("Connection", "keep-alive");
                context.Response.Headers.Append("Cache-Control", "no-cache");
                context.Response.Headers.Append("Content-Type", "text/event-stream");
                context.Response.Headers.Append("Access-Control-Allow-Origin", "*");

                var responseBodyFeature = context.Features.Get<IHttpResponseBodyFeature>();
                responseBodyFeature?.DisableBuffering();
                var cancellationToken = context.RequestAborted;
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                var linkedToken = cts.Token;

                try
                {
                    // Set up initial heartbeat and connection confirmation
                    string initialEvent = new ServerSentEvent("connected", new { message = "SSE connection established" }).Serialize();
                    byte[] initialBuffer = Encoding.UTF8.GetBytes(initialEvent);
                    await context.Response.Body.WriteAsync(initialBuffer, linkedToken);
                    await context.Response.Body.FlushAsync(linkedToken);

                    await steamService.StartAuthentication(userID);

                    // Register for updates *before* starting authentication
                    var subscription = steamService.SubscribeToEvents(userID, async (evt) =>
                    {
                        try
                        {
                            // Serialize the event to SSE format
                            string eventMessage = evt.Serialize();
                            byte[] buffer = Encoding.UTF8.GetBytes(eventMessage);
                            await context.Response.Body.WriteAsync(buffer, linkedToken);
                            await context.Response.Body.FlushAsync(linkedToken);
                            Console.WriteLine($"Sent event type '{evt.Type}' to client {userID}");

                            // If we receive a login-success or login-unsuccessful event, we can complete the process
                            if (evt.Type == "login-success" || evt.Type == "login-unsuccessful")
                            {
                                // Allow time for the event to be sent before ending
                                await Task.Delay(1000, linkedToken);
                                cts.Cancel();
                            }
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"Error sending event to client {userID}: {ex.Message}");
                            // Try to cancel on error
                            try { cts.Cancel(); } catch { }
                        }
                    });

                    try
                    {
                        // Wait for cancellation
                        await Task.Delay(Timeout.Infinite, linkedToken);
                    }
                    catch (OperationCanceledException)
                    {
                        Console.WriteLine($"Client {userID} connection ending - authentication completed or cancelled");
                    }
                    finally
                    {
                        steamService.Unsubscribe(userID, subscription);
                        steamService.DisconnectUser(userID);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error during connection for client {userID}: {ex.Message}");
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

                // try
                // {
                //     // Start Steam authentication
                //     await steamService.StartAuthentication(userID!);
                //     // Register for updates
                //     var subscription = steamService.SubscribeToEvents(clientId, async (evt) =>
                //     {
                //         try
                //         {
                //             // Serialize the event to SSE format
                //             string eventMessage = evt.Serialize();
                //             byte[] buffer = Encoding.UTF8.GetBytes(eventMessage);
                //             await context.Response.Body.WriteAsync(buffer, cancellationToken);
                //             await context.Response.Body.FlushAsync(cancellationToken);
                //             Console.WriteLine($"Sent event type '{evt.Type}' to client {clientId}");
                //         }
                //         catch (Exception ex)
                //         {
                //             Console.WriteLine($"Error sending event to client {clientId}: {ex.Message}");
                //         }
                //     });

                //     try
                //     {
                //         await Task.Delay(Timeout.Infinite, cancellationToken);
                //     }
                //     catch (TaskCanceledException)
                //     {
                //         Console.WriteLine($"Client {clientId} disconnected");
                //     }
                //     finally
                //     {
                //         steamService.Unsubscribe(clientId, subscription);
                //     }
                // }
                // catch (Exception ex)
                // {
                //     Console.WriteLine($"Error during authentication for client {clientId}: {ex.Message}");
                //     if (!context.Response.HasStarted)
                //     {
                //         context.Response.StatusCode = 500;
                //         await context.Response.WriteAsync("An error occurred during authentication.");
                //     }
                // }

                // No return statement with Results.Ok() - we're handling the response manually
            });



            app.MapGet("/user", async (HttpContext context, SteamService steamService) =>
            {
                var userID = context.Request.Headers["user-id"].ToString();
                if (string.IsNullOrEmpty(userID))
                {
                    return Results.BadRequest("Missing user ID");
                }

                // Get user info from stored credentials
                var userInfo = await steamService.GetCachedUserInfoAsync(userID);
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

            Console.WriteLine("Server started. Press Ctrl+C to stop.");

            using (var scope = app.Services.CreateScope())
            {
                var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();
                // dbContext.Database.EnsureDeleted();  // Only use during development!
                // dbContext.Database.EnsureCreated();
                dbContext.Database.Migrate();
            }

            app.Run();
        }
    }
}
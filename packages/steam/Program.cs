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

            // Configure endpoints
            app.UseWebSockets();

            // REST endpoints
            app.MapGet("/", () => "Hello World");

            app.MapGet("/status", async (HttpContext context, SteamService steamService) =>
            {
                var userID = context.Request.Headers["user-id"].ToString();
                if (string.IsNullOrEmpty(userID))
                {
                    return Results.BadRequest("Missing user ID");
                }
                var userInfo = await steamService.GetUserInfoFromStoredCredentials(userID!);
                if (userInfo == null)
                {
                    return Results.Ok(new { isAuthenticated = false });
                }

                return Results.Ok(new
                {
                    isAuthenticated = true,
                    steamId = userInfo.SteamId,
                    username = userInfo.Username
                });
            });

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
                        return Results.BadRequest("Missing user ID");
                    }

                    // Set SSE headers
                    context.Response.Headers.Append("Connection", "keep-alive");
                    context.Response.Headers.Append("Cache-Control", "no-cache");
                    context.Response.Headers.Append("Content-Type", "text/event-stream");
                    context.Response.Headers.Append("Access-Control-Allow-Origin", "*");

                    var responseBodyFeature = context.Features.Get<IHttpResponseBodyFeature>();
                    responseBodyFeature?.DisableBuffering();

                    var clientId = userID;
                    var cancellationToken = context.RequestAborted;

                    try
                    {
                        // Start Steam authentication
                        await steamService.StartAuthentication(userID!);

                        // Register for updates
                        var subscription = steamService.SubscribeToEvents(clientId, async (evt) =>
                        {
                            try
                            {
                                // Serialize the event to SSE format
                                string eventMessage = evt.Serialize();
                                byte[] buffer = Encoding.UTF8.GetBytes(eventMessage);

                                await context.Response.Body.WriteAsync(buffer, cancellationToken);
                                await context.Response.Body.FlushAsync(cancellationToken);

                                Console.WriteLine($"Sent event type '{evt.Type}' to client {clientId}");
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine($"Error sending event to client {clientId}: {ex.Message}");
                            }
                        });

                        try
                        {
                            await Task.Delay(Timeout.Infinite, cancellationToken);
                        }
                        catch (TaskCanceledException)
                        {
                            Console.WriteLine($"Client {clientId} disconnected");
                        }
                        finally
                        {
                            steamService.Unsubscribe(clientId, subscription);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error during authentication for client {clientId}: {ex.Message}");
                        return Results.Problem("An error occurred during authentication.");
                    }
                    return Results.Ok();
                });


            app.MapGet("/user", async (HttpContext context, SteamService steamService) =>
            {
                // Validate JWT
                var userID = context.Request.Headers["user-id"].ToString();
                if (string.IsNullOrEmpty(userID))
                {
                    return Results.BadRequest("Missing user ID");
                }

                // Get user info from stored credentials
                var userInfo = await steamService.GetUserInfoFromStoredCredentials(userID);
                if (userInfo == null)
                {
                    return Results.NotFound(new { error = "User not authenticated with Steam" });
                }

                return Results.Ok(new
                {
                    steamId = userInfo.SteamId,
                    username = userInfo.Username
                });
            });


        }
    }
}
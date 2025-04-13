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
            builder.Services.AddSingleton<SteamAuthService>();

            var app = builder.Build();

            // Health check endpoint
            app.MapGet("/", () => "Steam Auth Service is running");

            // QR Code login endpoint with Server-Sent Events
            app.MapGet("/api/steam/login", async (HttpResponse response, SteamAuthService steamService) =>
            {
                // Generate a unique session ID for this login attempt
                string sessionId = Guid.NewGuid().ToString();
                
                Console.WriteLine($"Starting new login session: {sessionId}");

                // Set up SSE response
                response.Headers.Append("Content-Type", "text/event-stream");
                response.Headers.Append("Cache-Control", "no-cache");
                response.Headers.Append("Connection", "keep-alive");

                try
                {
                    // Start QR login session with SSE updates
                    await steamService.StartQrLoginSessionAsync(response, sessionId);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error in login session {sessionId}: {ex.Message}");
                    
                    // Send error message as SSE
                    await response.WriteAsync($"event: error\n");
                    await response.WriteAsync($"data: {{\"message\":\"{ex.Message}\"}}\n\n");
                    await response.Body.FlushAsync();
                }
            });

            // Login with credentials endpoint (returns JSON)
            app.MapPost("/api/steam/login-with-credentials", async (LoginCredentials credentials, SteamAuthService steamService) =>
            {
                if (string.IsNullOrEmpty(credentials.Username) || string.IsNullOrEmpty(credentials.RefreshToken))
                {
                    return Results.BadRequest("Username and refresh token are required");
                }

                try
                {
                    var result = await steamService.LoginWithCredentialsAsync(
                        credentials.Username, 
                        credentials.RefreshToken);
                    
                    return Results.Ok(result);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error logging in with credentials: {ex.Message}");
                    return Results.Problem(ex.Message);
                }
            });

            // Get user info endpoint (returns JSON)
            app.MapGet("/api/steam/user", async (HttpRequest request, SteamAuthService steamService) =>
            {
                // Get credentials from headers
                var username = request.Headers["X-Steam-Username"].ToString();
                var refreshToken = request.Headers["X-Steam-Token"].ToString();

                if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(refreshToken))
                {
                    return Results.BadRequest("Username and refresh token headers are required");
                }

                try
                {
                    var userInfo = await steamService.GetUserInfoAsync(username, refreshToken);
                    return Results.Ok(userInfo);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error getting user info: {ex.Message}");
                    return Results.Problem(ex.Message);
                }
            });

            app.Run();
        }
    }

    public class LoginCredentials
    {
        public string Username { get; set; } = string.Empty;
        public string RefreshToken { get; set; } = string.Empty;
    }
}
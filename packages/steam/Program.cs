using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;

// FYI: Am very new to C# if you find any bugs or have any feedback hit me up :P
// TBH i dunno what this code does, only God and Claude know(in the slightest) what it does. 
// And yes! It does not sit right with me - am learning C# as we go, i guess 🤧
// This is the server to connect to the Steam APIs and do stuff like:
//  - authenticate a user, 
//  - get their library, 
//  - generate .vdf files for Steam Client (Steam manifest files), etc etc
var builder = WebApplication.CreateBuilder(args);

// Add JWT Authentication
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
   .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = Environment.GetEnvironmentVariable("NESTRI_AUTH_JWKS_URL"),
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            ClockSkew = TimeSpan.Zero,

            // Configure the issuer signing key provider
            IssuerSigningKeyResolver = (token, securityToken, kid, validationParameters) =>
            {
                // Fetch the JWKS manually
                var jwksUrl = $"{Environment.GetEnvironmentVariable("NESTRI_AUTH_JWKS_URL")}/.well-known/jwks.json";
                var httpClient = new HttpClient();
                var jwksJson = httpClient.GetStringAsync(jwksUrl).Result;
                var jwks = JsonSerializer.Deserialize<JsonWebKeySet>(jwksJson);

                // Return all keys or filter by kid if provided
                if (string.IsNullOrEmpty(kid))
                    return jwks?.Keys;
                else
                    return jwks?.Keys.Where(k => k.Kid == kid);
            }
        };

        // Add logging for debugging
        options.Events = new JwtBearerEvents
        {
            OnAuthenticationFailed = context =>
            {
                Console.WriteLine($"Authentication failed: {context.Exception.Message}");
                return Task.CompletedTask;
            },
            OnTokenValidated = context =>
            {
                Console.WriteLine("Token successfully validated");
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// Configure CORS
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(
        policy =>
        {
            policy.AllowAnyOrigin()
                  .AllowAnyHeader()
                  .AllowAnyMethod();
        });
});

builder.Services.AddSingleton<SteamService>();

builder.Services.AddDbContext<SteamDbContext>(options =>
    options.UseSqlite($"Data Source=/tmp/steam.db"));

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();


app.MapGet("/", () => "Hello World!");

app.MapGet("/status", [Authorize] async (HttpContext context, SteamService steamService) =>
{
    // Validate JWT
    var jwtToken = context.Request.Headers["Authorization"].ToString().Replace("Bearer ", "");
    var (isValid, userId, email) = await ValidateJwtToken(jwtToken);

    if (!isValid)
    {
        return Results.Unauthorized();
    }

    // Get team ID
    var teamId = context.Request.Headers["x-nestri-team"].ToString();
    if (string.IsNullOrEmpty(teamId))
    {
        return Results.BadRequest("Missing team ID");
    }

    // Check if user is authenticated with Steam
    var userInfo = await steamService.GetUserInfoFromStoredCredentials(teamId, userId!);
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

app.MapGet("/login", [Authorize] async (HttpContext context, SteamService steamService) =>
{
    // Validate JWT
    var jwtToken = context.Request.Headers["Authorization"].ToString().Replace("Bearer ", "");
    var (isValid, userId, email) = await ValidateJwtToken(jwtToken);

    Console.WriteLine($"User data: {userId}:{email}");

    if (!isValid)
    {
        context.Response.StatusCode = 401;
        await context.Response.WriteAsync("Invalid JWT token");
        return;
    }

    // Get team ID
    var teamId = context.Request.Headers["x-nestri-team"].ToString();
    if (string.IsNullOrEmpty(teamId))
    {
        context.Response.StatusCode = 400;
        await context.Response.WriteAsync("Missing team ID");
        return;
    }

    // Set SSE headers
    context.Response.Headers.Append("Connection", "keep-alive");
    context.Response.Headers.Append("Cache-Control", "no-cache");
    context.Response.Headers.Append("Content-Type", "text/event-stream");
    context.Response.Headers.Append("Access-Control-Allow-Origin", "*");

    // Disable response buffering
    var responseBodyFeature = context.Features.Get<IHttpResponseBodyFeature>();
    if (responseBodyFeature != null)
    {
        responseBodyFeature.DisableBuffering();
    }

    // Create unique client ID
    var clientId = $"{teamId}:{userId}";
    var cancellationToken = context.RequestAborted;

    // Start Steam authentication
    await steamService.StartAuthentication(teamId, userId!);

    // Register for updates
    var subscription = steamService.SubscribeToEvents(clientId, async (evt) =>
    {
        try
        {
            // Serialize the event to SSE format
            string eventMessage = evt.Serialize();
            byte[] buffer = Encoding.UTF8.GetBytes(eventMessage);

            await context.Response.Body.WriteAsync(buffer, 0, buffer.Length, cancellationToken);
            await context.Response.Body.FlushAsync(cancellationToken);

            Console.WriteLine($"Sent event type '{evt.Type}' to client {clientId}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error sending event to client {clientId}: {ex.Message}");
        }
    });

    // Keep the connection alive until canceled
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
});

app.MapGet("/user", [Authorize] async (HttpContext context, SteamService steamService) =>
{
    // Validate JWT
    var jwtToken = context.Request.Headers["Authorization"].ToString().Replace("Bearer ", "");
    var (isValid, userId, email) = await ValidateJwtToken(jwtToken);

    if (!isValid)
    {
        return Results.Unauthorized();
    }

    // Get team ID
    var teamId = context.Request.Headers["x-nestri-team"].ToString();
    if (string.IsNullOrEmpty(teamId))
    {
        return Results.BadRequest("Missing team ID");
    }

    // Get user info from stored credentials
    var userInfo = await steamService.GetUserInfoFromStoredCredentials(teamId, userId);
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

app.MapPost("/logout", [Authorize] async (HttpContext context, SteamService steamService) =>
{
    // Validate JWT
    var jwtToken = context.Request.Headers["Authorization"].ToString().Replace("Bearer ", "");
    var (isValid, userId, email) = await ValidateJwtToken(jwtToken);

    if (!isValid)
    {
        return Results.Unauthorized();
    }

    // Get team ID
    var teamId = context.Request.Headers["x-nestri-team"].ToString();
    if (string.IsNullOrEmpty(teamId))
    {
        return Results.BadRequest("Missing team ID");
    }

    // Delete the stored credentials
    using var scope = context.RequestServices.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<SteamDbContext>();

    var credentials = await dbContext.SteamUserCredentials
        .FirstOrDefaultAsync(c => c.TeamId == teamId && c.UserId == userId);

    if (credentials != null)
    {
        dbContext.SteamUserCredentials.Remove(credentials);
        await dbContext.SaveChangesAsync();
        return Results.Ok(new { message = "Steam authentication revoked" });
    }

    return Results.NotFound(new { error = "No Steam authentication found" });
});

// JWT validation function
async Task<(bool IsValid, string? UserId, string? Email)> ValidateJwtToken(string token)
{
    try
    {
        var jwksUrl = Environment.GetEnvironmentVariable("NESTRI_AUTH_JWKS_URL");
        var handler = new JwtSecurityTokenHandler();
        var jwtToken = handler.ReadJwtToken(token);

        // Log all claims for debugging
        // Console.WriteLine("JWT Claims:");
        // foreach (var claim in jwtToken.Claims)
        // {
        //     Console.WriteLine($"  {claim.Type}: {claim.Value}");
        // }

        // Validate token using JWKS
        var httpClient = new HttpClient();
        var jwksJson = await httpClient.GetStringAsync($"{jwksUrl}/.well-known/jwks.json");
        var jwks = JsonSerializer.Deserialize<JsonWebKeySet>(jwksJson);

        // Extract the properties claim which contains nested JSON
        var propertiesClaim = jwtToken.Claims.FirstOrDefault(c => c.Type == "properties")?.Value;
        if (!string.IsNullOrEmpty(propertiesClaim))
        {
            // Parse the nested JSON
            var properties = JsonSerializer.Deserialize<Dictionary<string, string>>(propertiesClaim);

            // Extract userID from properties
            var email = properties?.GetValueOrDefault("email");
            var userId = properties?.GetValueOrDefault("userID");

            if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(email))
            {
                // Also check standard claims as fallback
                userId = jwtToken.Claims.FirstOrDefault(c => c.Type == "sub")?.Value;
                email = jwtToken.Claims.FirstOrDefault(c => c.Type == "email")?.Value;

                if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(email))
                {
                    return (false, null, null);
                }
            }

            return (true, userId, email);
        }

        return (false, null, null);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"JWT validation error: {ex.Message}");
        return (false, null, null);
    }
}

Console.WriteLine("Server started. Press Ctrl+C to stop.");
await app.RunAsync();

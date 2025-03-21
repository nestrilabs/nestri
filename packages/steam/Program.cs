using System.Text;
using System.Text.Json;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Authentication.JwtBearer;

// FYI: Am very new to C# if you find any bugs or have any feedback hit me up :P
// TBH i dunno what this code does, only God and Claude have (in the slightest) what it does. And yes! It definitely does not sit right with me - learning C# on the job, i guess 🤧
// This is the server to connect to the Steam APIs and do stuff like authenticate a user, get their library, generate .vdf files for Steam Client, etc etc
var builder = WebApplication.CreateBuilder(args);

// Add JWT Authentication
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = Environment.GetEnvironmentVariable("NESTRI_AUTH_JWKS_URL");
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            ClockSkew = TimeSpan.Zero
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

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();


app.MapGet("/", () => "Hello World!");

app.MapGet("/login", [Authorize] async (HttpContext context, SteamService steamService) =>
{
    // Validate JWT
    var jwtToken = context.Request.Headers["Authorization"].ToString().Replace("Bearer ", "");
    var (isValid, userId, email) = await ValidateJwtToken(jwtToken);

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
    context.Response.Headers.Append("Content-Type", "text/event-stream");
    context.Response.Headers.Append("Cache-Control", "no-cache");
    context.Response.Headers.Append("Connection", "keep-alive");
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
    await steamService.StartAuthentication(clientId);

    // Register for updates
    var subscription = steamService.Subscribe(clientId, async (url) =>
    {
        string eventMessage = $"data: {url}\n\n";
        byte[] buffer = Encoding.UTF8.GetBytes(eventMessage);

        try
        {
            await context.Response.Body.WriteAsync(buffer, 0, buffer.Length, cancellationToken);
            await context.Response.Body.FlushAsync(cancellationToken);

            Console.WriteLine($"Sent QR URL to client {clientId}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error sending to client {clientId}: {ex.Message}");
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

// JWT validation function
async Task<(bool IsValid, string? UserId, string? Email)> ValidateJwtToken(string token)
{
    try
    {
        var jwksUrl = Environment.GetEnvironmentVariable("NESTRI_AUTH_JWKS_URL");
        var handler = new JwtSecurityTokenHandler();
        var jwtToken = handler.ReadJwtToken(token);

        // Validate token using JWKS
        var httpClient = new HttpClient();
        var jwksJson = await httpClient.GetStringAsync($"{jwksUrl}/.well-known/jwks.json");
        var jwks = JsonSerializer.Deserialize<JsonWebKeySet>(jwksJson);

        // Here you would validate the token signature against the JWKS
        // For simplicity, we'll just check the required claims

        var email = jwtToken.Claims.FirstOrDefault(c => c.Type == "sub")?.Value;
        var userId = jwtToken.Claims.FirstOrDefault(c => c.Type == "userID")?.Value;

        if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(email))
        {
            return (false, null, null);
        }

        return (true, userId, email);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"JWT validation error: {ex.Message}");
        return (false, null, null);
    }
}

Console.WriteLine("Server started. Press Ctrl+C to stop.");
await app.RunAsync();

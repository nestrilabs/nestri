using System;
using SteamKit2;
using System.Text.Json;
using SteamKit2.Authentication;

// create our steamclient instance
var steamClient = new SteamClient();
// create the callback manager which will route callbacks to function calls
var manager = new CallbackManager(steamClient);

// get the steamuser handler, which is used for logging on after successfully connecting
var steamUser = steamClient.GetHandler<SteamUser>();

// register a few callbacks we're interested in
// these are registered upon creation to a callback manager, which will then route the callbacks
// to the functions specified
manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);

manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);

var isRunning = true;

Console.WriteLine("Connecting to Steam...");

// initiate the connection
steamClient.Connect();

// create our callback handling loop
while (isRunning)
{
    // in order for the callbacks to get routed, they need to be handled by the manager
    manager.RunWaitCallbacks(TimeSpan.FromSeconds(1));
}

async void OnConnected(SteamClient.ConnectedCallback callback)
{
    // Start an authentication session by requesting a link
    var authSession = await steamClient.Authentication.BeginAuthSessionViaQRAsync(new AuthSessionDetails());

    // Steam will periodically refresh the challenge url, this callback allows you to draw a new qr code
    authSession.ChallengeURLChanged = () =>
    {
        Console.WriteLine();
        Console.WriteLine("Steam has refreshed the challenge url");

        OutputUrl(authSession);
    };

    // Draw current qr right away
    OutputUrl(authSession);

    // Starting polling Steam for authentication response
    // This response is later used to logon to Steam after connecting
    var pollResponse = await authSession.PollingWaitForResultAsync();

    Console.WriteLine($"Logging in as '{pollResponse.AccountName}'...");

    var credentialData = new
    {
        success = true,
        username = pollResponse.AccountName,
        accessToken = pollResponse.RefreshToken,
        timestamp = DateTime.UtcNow
    };

    Console.WriteLine(JsonSerializer.Serialize(credentialData));

    // Logon to Steam with the access token we have received
    steamUser.LogOn(new SteamUser.LogOnDetails
    {
        Username = pollResponse.AccountName,
        AccessToken = pollResponse.RefreshToken,
    });
}

void OnDisconnected(SteamClient.DisconnectedCallback callback)
{
    Console.WriteLine("Disconnected from Steam");

    isRunning = false;
}

void OnLoggedOn(SteamUser.LoggedOnCallback callback)
{
    if (callback.Result != EResult.OK)
    {
        // Output error as JSON
        var errorData = new
        {
            error = true,
            message = $"Unable to logon to Steam: {callback.Result} / {callback.ExtendedResult}"
        };

        Console.WriteLine(JsonSerializer.Serialize(errorData));

        isRunning = false;
        return;
    }

    // for this sample we'll just log off
    steamUser.LogOff();
}

void OnLoggedOff(SteamUser.LoggedOffCallback callback)
{
    Console.WriteLine("Logged off of Steam: {0}", callback.Result);
}

void OutputUrl(QrAuthSession authSession)
{
    var challengeData = new
    {
        challengeUrl = authSession.ChallengeURL,
        timestamp = DateTime.UtcNow
    };

    string jsonOutput = JsonSerializer.Serialize(challengeData);
    Console.WriteLine(jsonOutput);
}
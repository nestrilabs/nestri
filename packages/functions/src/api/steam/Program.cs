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
var steamFriends = steamClient.GetHandler<SteamFriends>();

// Create an instance to store user data
var userData = new UserData
{
    Success = true,
    Timestamp = DateTime.UtcNow
};

// register a few callbacks we're interested in
// these are registered upon creation to a callback manager, which will then route the callbacks
// to the functions specified
manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);

manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);

manager.Subscribe<SteamUser.AccountInfoCallback>(OnAccountInfo);
manager.Subscribe<SteamFriends.PersonaStateCallback>(OnPersonaState);

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

    // Store username and access token
    userData.Username = pollResponse.AccountName;
    userData.AccessToken = pollResponse.RefreshToken;

    Random random = new();

    // Logon to Steam with the access token we have received
    steamUser.LogOn(new SteamUser.LogOnDetails
    {
        Username = pollResponse.AccountName,
        LoginID = (uint?)random.Next(), //allow multiple sessions from this IP Address
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

    // We'll wait for all data to be collected before logging off
    // The account info and persona state callbacks will be called first
}

void OnLoggedOff(SteamUser.LoggedOffCallback callback)
{
    Console.WriteLine("Logged off of Steam: {0}", callback.Result);
}

void OnAccountInfo(SteamUser.AccountInfoCallback callback)
{
    // Store persona name and country
    userData.PersonaName = callback.PersonaName;
    userData.Country = callback.Country;

    // We need to explicitly make a request for our user to obtain avatar
    if (steamFriends != null && steamUser.SteamID != null)
        steamFriends.RequestFriendInfo([steamUser.SteamID]);
}

void OnPersonaState(SteamFriends.PersonaStateCallback callback)
{
    if (callback.FriendID == steamUser?.SteamID && callback.AvatarHash is not null)
    {
        var avatarStr = BitConverter.ToString(callback.AvatarHash).Replace("-", "").ToLowerInvariant();
        userData.AvatarUrl = $"https://avatars.akamai.steamstatic.com/{avatarStr}_full.jpg";

        // Now that we have all the user data, emit the complete JSON and log off
        userData.Timestamp = DateTime.UtcNow; // Update timestamp to current time
        Console.WriteLine(JsonSerializer.Serialize(userData, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));

        // Now we can log off
        steamUser.LogOff();
    }
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

// Create a class to store all user data
class UserData
{
    public bool Success { get; set; }
    public string Username { get; set; }
    public string AccessToken { get; set; }
    public string PersonaName { get; set; }
    public string Country { get; set; }
    public string AvatarUrl { get; set; }
    public DateTime Timestamp { get; set; }
}
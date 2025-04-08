using SteamKit2;
using System.Text.Json;
using SteamKit2.Authentication;

namespace Steam.Auth
{
    public class SteamLoginComponent
    {
        private readonly SteamUser _steamUser;
        private readonly SteamClient _steamClient;
        private bool _isRunning = true;
        private HttpResponse? _httpResponse;
        // private readonly SteamApps _steamApps;
        private TaskCompletionSource<bool>? _authCompletionSource;
        private readonly CallbackManager _manager;

        public SteamLoginComponent()
        {
            var clientConfiguration = SteamConfig.GetDefaultSteamClientConfig();
            _steamClient = new SteamClient(clientConfiguration);
            _manager = new CallbackManager(_steamClient);
            _steamUser = _steamClient.GetHandler<SteamUser>() ?? throw new InvalidOperationException("SteamUser handler not found");
            // _steamApps = _steamClient.GetHandler<SteamApps>() ?? throw new InvalidOperationException("SteamApps handler not found");

            // Register callbacks
            _manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
            _manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);
            _manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
            _manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
        }
        public void SetClientSocket(HttpResponse response)
        {
            _httpResponse = response;
        }
        public async Task HandleLoginRequest(LoginRequest loginRequest)
        {
            _authCompletionSource = new TaskCompletionSource<bool>();

            // Connect to Steam
            await SendToClient("status", new { message = "Connecting to Steam..." });
            _steamClient.Connect();

            // Start callback handling loop in a separate task
            await Task.Run(() =>
           {
               while (_isRunning)
               {
                   _manager.RunWaitCallbacks(TimeSpan.FromSeconds(1));
               }
           });

            // Wait for authentication to complete
            await _authCompletionSource.Task;
        }

        private async void OnConnected(SteamClient.ConnectedCallback callback)
        {
            try
            {
                if (_httpResponse == null)
                    return;

                await SendToClient("status", new { message = "Connected to Steam" });

                // If we have credentials, use them directly
                if (!string.IsNullOrEmpty(_refreshToken) && !string.IsNullOrEmpty(_username))
                {
                    await SendToClient("status", new { message = $"Logging in as '{_username}'..." });

                    _steamUser.LogOn(new SteamUser.LogOnDetails
                    {
                        Username = _username,
                        AccessToken = _refreshToken,
                        MachineName = "Nestri OS",
                    });
                }
                else
                {
                    try
                    {
                        // Start QR authentication flow
                        var authSession = await _steamClient.Authentication.BeginAuthSessionViaQRAsync(new AuthSessionDetails());

                        // Handle QR code URL refreshes
                        authSession.ChallengeURLChanged = () =>
                        {
                            SendChallengeUrl(authSession.ChallengeURL);
                        };

                        // Send initial QR code URL
                        SendChallengeUrl(authSession.ChallengeURL);

                        // Poll for authentication result
                        var pollResponse = await authSession.PollingWaitForResultAsync();

                        // Store credentials for future use
                        _username = pollResponse.AccountName;
                        _refreshToken = pollResponse.RefreshToken;

                        await SendToClient("credentials", new
                        {
                            username = pollResponse.AccountName,
                            refreshToken = pollResponse.RefreshToken,
                        });

                        await SendToClient("status", new { message = $"Logging in as '{pollResponse.AccountName}'..." });

                        _steamUser.LogOn(new SteamUser.LogOnDetails
                        {
                            Username = pollResponse.AccountName,
                            AccessToken = pollResponse.RefreshToken,
                            MachineName = "Nestri OS",
                        });

                    }
                    catch (AuthenticationException e)
                    {
                        if (e.Result == EResult.AccountLoginDeniedThrottle || e.Result == EResult.RateLimitExceeded)
                        {
                            await SendToClient("error", new { message = $"Rate limit reached" });
                            // _rateLimitReached = true;
                            // _steamClient.Disconnect();
                            return;
                        }

                        await SendToClient("error", new { message = $"QR authentication error: {e.Message}" });
                        _authCompletionSource!.SetResult(false);
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                await SendToClient("error", new { message = $"Authentication error: {ex.Message}" });
                _authCompletionSource!.SetResult(false);
            }
        }

        private async void SendChallengeUrl(string challengeUrl)
        {
            var challengeData = new
            {
                url = challengeUrl,
                timestamp = DateTime.UtcNow
            };

            await SendToClient("challenge_url", challengeData);
        }

        private async Task SendToClient(string eventName, object data)
        {
            if (_httpResponse == null)
            {
                Console.WriteLine($"Error sending data to client - client socket is null or not connected.");
                return;
            }

            try
            {
                string jsonData = JsonSerializer.Serialize(data, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                });
                string sseMessage = $"event: {eventName}\ndata: {jsonData}\n\n";
                // Send the data to the client
                await _httpResponse.WriteAsync(sseMessage);
                await _httpResponse.Body.FlushAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error sending data to client: {ex.Message}");
            }
        }
        private async void OnLoggedOn(SteamUser.LoggedOnCallback callback)
        {
            if (callback.Result != EResult.OK)
            {
                await SendToClient("error", new
                {
                    message = $"Unable to log on to Steam: {callback.Result} / {callback.ExtendedResult}"
                });

                _authCompletionSource!.SetResult(false);
                return;
            }

            await SendToClient("status", new { message = "Successfully logged on to Steam" });

            _authCompletionSource!.SetResult(true);

            // _steamUser.LogOff();
        }


        private async void OnDisconnected(SteamClient.DisconnectedCallback callback)
        {
            await SendToClient("status", new { message = "Disconnected from Steam" });
            await SendToClient("disconnected", new { success = false });

            _isRunning = false;
            _authCompletionSource!.TrySetResult(false);
        }

        private async void OnLoggedOff(SteamUser.LoggedOffCallback callback)
        {
            await SendToClient("status", new { message = $"Logged off of Steam: {callback.Result}" });
        }
        private string? _refreshToken;
        private string? _username;
        // Method to set credentials for direct login
        public void SetCredentials(string username, string refreshToken)
        {
            _username = username;
            _refreshToken = refreshToken;
        }
        public class LoginRequest
        {
            public required string Type { get; set; }
            public string? Username { get; set; }
            public string? RefreshToken { get; set; }
        }
    }
}
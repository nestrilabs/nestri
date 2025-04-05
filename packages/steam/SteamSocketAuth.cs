using System;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using SteamKit2;
using SteamKit2.Authentication;

namespace SteamSocketAuth
{
    public class SteamLoginComponent
    {
        private readonly SteamClient _steamClient;
        private readonly CallbackManager _manager;
        private readonly SteamUser _steamUser;
        private readonly SteamFriends _steamFriends;
        private Socket _clientSocket;
        private bool _isRunning = true;
        private TaskCompletionSource<bool> _authCompletionSource;

        public SteamLoginComponent()
        {
            _steamClient = new SteamClient(SteamConfiguration.Create(config=> config.WithConnectionTimeout(TimeSpan.FromSeconds(30))));
            _manager = new CallbackManager(_steamClient);
            _steamUser = _steamClient.GetHandler<SteamUser>() ?? throw new InvalidOperationException("SteamUser handler is not available.");
            _steamFriends = _steamClient.GetHandler<SteamFriends>() ?? throw new InvalidOperationException("SteamFriends handler is not available.");

            // Register callbacks
            _manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
            _manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
            _manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
            _manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);
            _manager.Subscribe<SteamUser.AccountInfoCallback>(OnAccountInfo);
            _manager.Subscribe<SteamFriends.PersonaStateCallback>(OnPersonaState);
        }

        public void SetClientSocket(Socket clientSocket)
        {
            _clientSocket = clientSocket;
        }

        public async Task HandleLoginRequest(LoginRequest loginRequest)
        {
            _authCompletionSource = new TaskCompletionSource<bool>();

            // Connect to Steam
            SendToClient(new { type = "status", message = "Connecting to Steam..." });
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
                if (_clientSocket == null)
                    return;

                SendToClient(new { type = "status", message = "Connected to Steam" });

                // If we have credentials, use them directly
                if (!string.IsNullOrEmpty(_refreshToken) && !string.IsNullOrEmpty(_username))
                {
                    SendToClient(new { type = "status", message = $"Logging in as '{_username}'..." });

                    Random random = new Random();
                    _steamUser.LogOn(new SteamUser.LogOnDetails
                    {
                        Username = _username,
                        LoginID = (uint?)random.Next(),
                        AccessToken = _refreshToken,
                    });
                }
                else
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

                    SendToClient(new
                    {
                        type = "credentials",
                        username = pollResponse.AccountName,
                        refreshToken = pollResponse.RefreshToken
                    });

                    SendToClient(new { type = "status", message = $"Logging in as '{pollResponse.AccountName}'..." });

                    // Log on using obtained credentials
                    Random random = new Random();
                    _steamUser.LogOn(new SteamUser.LogOnDetails
                    {
                        Username = pollResponse.AccountName,
                        LoginID = (uint?)random.Next(),
                        AccessToken = pollResponse.RefreshToken,
                    });
                }
            }
            catch (Exception ex)
            {
                SendToClient(new { type = "error", message = $"Authentication error: {ex.Message}" });
                _authCompletionSource.SetResult(false);
            }
        }

        private void OnDisconnected(SteamClient.DisconnectedCallback callback)
        {
            SendToClient(new { type = "status", message = "Disconnected from Steam" });
            SendToClient(new { type = "disconnected", success = false });

            _isRunning = false;
            _authCompletionSource.TrySetResult(false);
        }

        private void OnLoggedOn(SteamUser.LoggedOnCallback callback)
        {
            if (callback.Result != EResult.OK)
            {
                SendToClient(new
                {
                    type = "error",
                    message = $"Unable to log on to Steam: {callback.Result} / {callback.ExtendedResult}"
                });

                _authCompletionSource.SetResult(false);
                return;
            }

            SendToClient(new { type = "status", message = "Successfully logged on to Steam" });

            // Account info and persona state callbacks will be triggered automatically
        }

        private void OnLoggedOff(SteamUser.LoggedOffCallback callback)
        {
            SendToClient(new { type = "status", message = $"Logged off of Steam: {callback.Result}" });
        }

        private void OnAccountInfo(SteamUser.AccountInfoCallback callback)
        {
            var accountInfo = new
            {
                type = "account_info",
                personaName = callback.PersonaName,
                country = callback.Country
            };

            SendToClient(accountInfo);

            // Request additional user info
            if (_steamFriends != null && _steamUser.SteamID != null)
                _steamFriends.RequestFriendInfo(_steamUser.SteamID);
        }

        private void OnPersonaState(SteamFriends.PersonaStateCallback callback)
        {
            if (callback.FriendID == _steamUser?.SteamID && callback.AvatarHash != null && _steamUser != null)
            {
                var avatarStr = BitConverter.ToString(callback.AvatarHash).Replace("-", "").ToLowerInvariant();
                var avatarUrl = $"https://avatars.akamai.steamstatic.com/{avatarStr}_full.jpg";

                var userData = new
                {
                    type = "user_data",
                    avatarUrl,
                    username = _username,
                    personaName = callback.Name,
                    timestamp = DateTime.UtcNow
                };

                SendToClient(userData);

                // Now log off
                _steamUser.LogOff();

                // Authentication process is complete
                _authCompletionSource.TrySetResult(true);
            }
        }

        private void SendChallengeUrl(string challengeUrl)
        {
            var challengeData = new
            {
                type = "challenge_url",
                url = challengeUrl,
                timestamp = DateTime.UtcNow
            };

            SendToClient(challengeData);
        }

        private void SendToClient(object data)
        {
            if (_clientSocket == null || !_clientSocket.Connected)
                return;

            try
            {
                string jsonData = JsonSerializer.Serialize(data, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                });
                byte[] responseBytes = Encoding.UTF8.GetBytes(jsonData);
                _clientSocket.Send(responseBytes);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error sending data to client: {ex.Message}");
            }
        }

        // Store credentials for direct login
        private string _refreshToken;
        private string _username;

        // Method to set credentials for direct login
        public void SetCredentials(string username, string refreshToken)
        {
            _username = username;
            _refreshToken = refreshToken;
        }

        public void StopProcess()
        {
            _isRunning = false;
            _steamClient.Disconnect();
        }
    }

    public class LoginRequest
    {
        public required string Type { get; set; }
        public string? Username { get; set; }
        public string? RefreshToken { get; set; }
    }
}
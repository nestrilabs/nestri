using SteamKit2;
using SteamKit2.Authentication;

namespace Steam
{
    public class SteamAuthComponent
    {
        private readonly SteamClient _steamClient;
        private readonly SteamUser _steamUser;
        private readonly SteamFriends _steamFriends;
        private readonly CallbackManager _manager;
        private readonly string _userId;
        private readonly Action<string, string>? _onCredentialsObtained;
        private CancellationTokenSource? _cts;
        private Task? _callbackTask;
        private TaskCompletionSource<bool>? _authCompletionSource;
        private QrAuthSession? _authSession;

        private string? _username;
        private string? _refreshToken;
        private bool _isLoggedIn = false;

        // Event that clients can subscribe to
        public event Action<ServerSentEvent>? OnEvent;

        // Store account information
        private readonly Dictionary<string, object> _accountInfo = new();

        public SteamAuthComponent(string userId, Action<string, string>? onCredentialsObtained = null)
        {
            _userId = userId;
            _onCredentialsObtained = onCredentialsObtained;

            var configuration = SteamConfig.GetDefaultSteamClientConfig();
            // Create SteamKit2 client
            _steamClient = new SteamClient(configuration);
            _manager = new CallbackManager(_steamClient);
            _steamUser = _steamClient.GetHandler<SteamUser>() ?? throw new InvalidOperationException("SteamUser handler not available");
            _steamFriends = _steamClient.GetHandler<SteamFriends>() ?? throw new InvalidOperationException("SteamFriends handler not available");

            // Register callbacks
            _manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
            _manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
            _manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
            _manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);
            _manager.Subscribe<SteamUser.AccountInfoCallback>(OnAccountInfo);
            _manager.Subscribe<SteamFriends.PersonaStateCallback>(OnPersonaState);
            _manager.Subscribe<SteamUser.EmailAddrInfoCallback>(OnEmailInfo);
        }

        public Action Subscribe(Action<ServerSentEvent> callback)
        {
            OnEvent += callback;

            // If we already have a QR code URL, send it immediately
            if (_authSession != null)
            {
                callback(new ServerSentEvent("challenge_url", new { url = _authSession.ChallengeURL }));
            }

            return () => OnEvent -= callback;
        }

        public void SetCredentials(string username, string refreshToken)
        {
            _username = username;
            _refreshToken = refreshToken;
        }

        public async Task<bool> HandleLoginRequest()
        {
            if (_callbackTask != null)
            {
                return _isLoggedIn; // Already connected
            }

            _authCompletionSource = new TaskCompletionSource<bool>();
            _cts = new CancellationTokenSource();

            // Connect to Steam
            NotifyEvent(new ServerSentEvent("status", new { message = "Connecting to Steam..." }));
            _steamClient.Connect();

            // Run callback loop in background
            _callbackTask = Task.Run(() =>
            {
                while (!_cts.Token.IsCancellationRequested)
                {
                    _manager.RunWaitCallbacks(TimeSpan.FromSeconds(1));
                    Thread.Sleep(10);
                }
            }, _cts.Token);

            // Wait for auth to complete
            await _authCompletionSource.Task;
            return _isLoggedIn;
        }

        public void Disconnect()
        {
            _cts?.Cancel();

            if (_isLoggedIn)
            {
                _steamUser.LogOff();
            }

            _steamClient.Disconnect();

            NotifyEvent(new ServerSentEvent("disconnected", new { success = true }));
        }

        private void NotifyEvent(ServerSentEvent evt)
        {
            OnEvent?.Invoke(evt);
        }

        #region Steam Callbacks

        private async void OnConnected(SteamClient.ConnectedCallback callback)
        {
            try
            {
                NotifyEvent(new ServerSentEvent("status", new { message = "Connected to Steam" }));

                // Use stored credentials if available
                if (!string.IsNullOrEmpty(_refreshToken) && !string.IsNullOrEmpty(_username))
                {
                    NotifyEvent(new ServerSentEvent("status", new { message = $"Logging in as '{_username}'..." }));

                    _steamUser.LogOn(new SteamUser.LogOnDetails
                    {
                        Username = _username,
                        AccessToken = _refreshToken
                    });
                }
                else
                {
                    // Start QR authentication flow
                    NotifyEvent(new ServerSentEvent("status", new { message = "Starting QR authentication..." }));

                    _authSession = await _steamClient.Authentication.BeginAuthSessionViaQRAsync(
                        new AuthSessionDetails { DeviceFriendlyName = "Steam Auth Client" });

                    // Handle URL changes
                    _authSession.ChallengeURLChanged = () =>
                    {
                        NotifyEvent(new ServerSentEvent("status", new { message = "QR Code link changed" }));
                        NotifyEvent(new ServerSentEvent("challenge_url", new { url = _authSession.ChallengeURL }));
                    };

                    // Send initial QR code URL
                    NotifyEvent(new ServerSentEvent("challenge_url", new { url = _authSession.ChallengeURL }));

                    // Poll for authentication result
                    await Task.Run(async () =>
                    {
                        try
                        {
                            var pollResponse = await _authSession.PollingWaitForResultAsync();

                            // Store credentials
                            _username = pollResponse.AccountName;
                            _refreshToken = pollResponse.RefreshToken;

                            // Log in with obtained credentials
                            NotifyEvent(new ServerSentEvent("status", new { message = $"Logging in as '{_username}'..." }));

                            _steamUser.LogOn(new SteamUser.LogOnDetails
                            {
                                Username = pollResponse.AccountName,
                                AccessToken = pollResponse.RefreshToken
                            });
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[{_userId}] Authentication error: {ex.Message}");
                            NotifyEvent(new ServerSentEvent("login-unsuccessful", new { error = ex.Message }));
                            _authCompletionSource?.SetResult(false);
                        }
                    });
                }
            }
            catch (Exception ex)
            {
                NotifyEvent(new ServerSentEvent("status", new { message = $"Authentication error: {ex.Message}" }));
                NotifyEvent(new ServerSentEvent("login-unsuccessful", new { error = ex.Message }));
                _authCompletionSource?.SetResult(false);
            }
        }

        private async void OnDisconnected(SteamClient.DisconnectedCallback callback)
        {
            NotifyEvent(new ServerSentEvent("status", new { message = "Disconnected from Steam" }));
            _isLoggedIn = false;

            // Only try to reconnect if not deliberately disconnected
            if (_callbackTask != null && !_cts!.IsCancellationRequested)
            {
                NotifyEvent(new ServerSentEvent("status", new { message = "Reconnecting in 30 seconds..." }));
                await Task.Delay(TimeSpan.FromSeconds(30), _cts.Token);
                _steamClient.Connect();
            }
            else
            {
                _authCompletionSource?.TrySetResult(false);
            }
        }

        private void OnLoggedOn(SteamUser.LoggedOnCallback callback)
        {
            if (callback.Result != EResult.OK)
            {
                NotifyEvent(new ServerSentEvent("error", new { message = $"Login failed: {callback.Result}" }));
                _authCompletionSource?.SetResult(false);
                return;
            }

            _isLoggedIn = true;
            NotifyEvent(new ServerSentEvent("status", new { message = "Successfully logged in to Steam" }));

            // Store basic info
            if (callback.ClientSteamID != null)
            {
                _accountInfo["steamId"] = callback.ClientSteamID.ConvertToUInt64();
            }

            NotifyEvent(new ServerSentEvent("login-success", new
            {
                steamId = _steamUser.SteamID?.ConvertToUInt64(),
                username = _username
            }));

            // Save credentials if callback provided
            if (_onCredentialsObtained != null && !string.IsNullOrEmpty(_refreshToken) && !string.IsNullOrEmpty(_username))
            {
                _onCredentialsObtained(_username, _refreshToken);
            }

            // Request persona state
            if (_steamUser.SteamID != null)
            {
                _steamFriends.RequestFriendInfo(_steamUser.SteamID);
            }
        }

        private void OnLoggedOff(SteamUser.LoggedOffCallback callback)
        {
            _isLoggedIn = false;
            NotifyEvent(new ServerSentEvent("logged-off", new { reason = callback.Result.ToString() }));
        }

        private void OnAccountInfo(SteamUser.AccountInfoCallback callback)
        {
            _accountInfo["country"] = callback.Country;
            _accountInfo["personaName"] = callback.PersonaName;

            // Request additional user info
            if (_steamFriends != null && _steamUser.SteamID != null)
            {
                _steamFriends.RequestFriendInfo(_steamUser.SteamID);
            }
        }

        private void OnEmailInfo(SteamUser.EmailAddrInfoCallback callback)
        {
            _accountInfo["email"] = callback.EmailAddress;
        }

        private void OnPersonaState(SteamFriends.PersonaStateCallback callback)
        {
            // Only care about our own persona state
            if (callback.FriendID == _steamUser?.SteamID && _steamUser?.SteamID != null)
            {
                // Convert avatar hash to URL
                if (callback.AvatarHash != null && callback.AvatarHash.Length > 0)
                {
                    var avatarStr = BitConverter.ToString(callback.AvatarHash).Replace("-", "").ToLowerInvariant();
                    var avatarUrl = $"https://avatars.akamai.steamstatic.com/{avatarStr}_full.jpg";
                    _accountInfo["avatarUrl"] = avatarUrl;
                }

                // Update account info
                _accountInfo["username"] = _username ?? "Unknown";
                _accountInfo["personaName"] = callback.Name;
                _accountInfo["gameId"] = callback.GameID.ToUInt64();
                _accountInfo["gamePlayingName"] = callback.GameName;
                _accountInfo["lastLogOn"] = callback.LastLogOn;
                _accountInfo["lastLogOff"] = callback.LastLogOff;
                _accountInfo["steamId"] = _steamUser.SteamID.ConvertToUInt64();

                // Notify client of the updated account info
                NotifyEvent(new ServerSentEvent("account_info", new { info = _accountInfo }));

                // Complete authentication process
                _authCompletionSource?.TrySetResult(true);
            }
        }

        #endregion
    }
}
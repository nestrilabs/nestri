using SteamKit2;
using SteamKit2.Authentication;

namespace Steam
{
    public class SteamAuthService
    {
        private readonly SteamClient _steamClient;
        private readonly SteamUser _steamUser;
        private readonly SteamFriends _steamFriends;
        private readonly CallbackManager _manager;
        private CancellationTokenSource? _cts;
        private Task? _callbackTask;
        private readonly Dictionary<string, TaskCompletionSource<bool>> _authCompletionSources = new();

        public SteamAuthService()
        {
            var configuration = SteamConfiguration.Create(config =>
            {
                config.WithHttpClientFactory(HttpClientFactory.CreateHttpClient);
                config.WithMachineInfoProvider(new IMachineInfoProvider());
                config.WithConnectionTimeout(TimeSpan.FromSeconds(10));
            });

            _steamClient = new SteamClient(configuration);
            _manager = new CallbackManager(_steamClient);
            _steamUser = _steamClient.GetHandler<SteamUser>() ?? throw new InvalidOperationException("SteamUser handler not available");
            _steamFriends = _steamClient.GetHandler<SteamFriends>() ?? throw new InvalidOperationException("SteamFriends handler not available");

            // Register basic callbacks
            _manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
            _manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
            _manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
            _manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);
        }

        // Main login method - initiates QR authentication and sends SSE updates
        public async Task StartQrLoginSessionAsync(HttpResponse response, string sessionId)
        {
            response.Headers.Append("Content-Type", "text/event-stream");
            response.Headers.Append("Cache-Control", "no-cache");
            response.Headers.Append("Connection", "keep-alive");

            // Create a completion source for this session
            var tcs = new TaskCompletionSource<bool>();
            _authCompletionSources[sessionId] = tcs;

            try
            {
                // Connect to Steam if not already connected
                await EnsureConnectedAsync();

                // Send initial status
                await SendSseEvent(response, "status", new { message = "Starting QR authentication..." });

                // Begin auth session
                var authSession = await _steamClient.Authentication.BeginAuthSessionViaQRAsync(
                    new AuthSessionDetails
                    {
                        PlatformType = SteamKit2.Internal.EAuthTokenPlatformType.k_EAuthTokenPlatformType_SteamClient,
                        DeviceFriendlyName = "Nestri Cloud Gaming",
                        ClientOSType = EOSType.Linux5x
                    }
                );

                // Handle URL changes
                authSession.ChallengeURLChanged = async () =>
                {
                    await SendSseEvent(response, "challenge_url", new { url = authSession.ChallengeURL });
                };

                // Send initial QR code URL
                await SendSseEvent(response, "challenge_url", new { url = authSession.ChallengeURL });

                // Poll for authentication result
                try
                {
                    var pollResponse = await authSession.PollingWaitForResultAsync();

                    // Send credentials to client
                    await SendSseEvent(response, "credentials", new
                    {
                        username = pollResponse.AccountName,
                        refreshToken = pollResponse.RefreshToken
                    });

                    // Log in with obtained credentials
                    await SendSseEvent(response, "status", new { message = $"Logging in as '{pollResponse.AccountName}'..." });

                    //_steamUser.LogOn(new SteamUser.LogOnDetails
                    //{
                    //    Username = pollResponse.AccountName,
                    //    MachineName = "Nestri Cloud Gaming",
                    //    ClientOSType = EOSType.Linux5x,
                    //    AccessToken = pollResponse.RefreshToken
                    //});

                    // Wait for login to complete (handled by OnLoggedOn callback)
                    //await tcs.Task;

                    // Send final success message
                    //await SendSseEvent(response, "login-successful", new
                    //{
                    //    steamId = _steamUser.SteamID?.ConvertToUInt64(),
                    //    username = pollResponse.AccountName
                    //});
                }
                catch (Exception ex)
                {
                    await SendSseEvent(response, "login-unsuccessful", new { error = ex.Message });
                }
            }
            catch (Exception ex)
            {
                await SendSseEvent(response, "error", new { message = ex.Message });
            }
            finally
            {
                // Clean up
                _authCompletionSources.Remove(sessionId);
                await response.Body.FlushAsync();
		_steamClient.Disconnect();
            }
        }

        // Method to login with existing credentials and return result (no SSE)
        public async Task<LoginResult> LoginWithCredentialsAsync(string username, string refreshToken)
        {
            var sessionId = Guid.NewGuid().ToString();
            var tcs = new TaskCompletionSource<bool>();
            _authCompletionSources[sessionId] = tcs;

            try
            {
                // Connect to Steam if not already connected
                await EnsureConnectedAsync();

                // Log in with provided credentials
                _steamUser.LogOn(new SteamUser.LogOnDetails
                {
                    Username = username,
                    MachineName = "Nestri Cloud Gaming",
                    AccessToken = refreshToken,
                    ClientOSType = EOSType.Linux5x,
                });

                // Wait for login to complete (handled by OnLoggedOn callback)
                var success = await tcs.Task;

                if (success)
                {
                    return new LoginResult
                    {
                        Success = true,
                        SteamId = _steamUser.SteamID?.ConvertToUInt64(),
                        Username = username
                    };
                }
                else
                {
                    return new LoginResult
                    {
                        Success = false,
                        ErrorMessage = "Login failed"
                    };
                }
            }
            catch (Exception ex)
            {
                return new LoginResult
                {
                    Success = false,
                    ErrorMessage = ex.Message
                };
            }
            finally
            {
                _authCompletionSources.Remove(sessionId);
            }
        }

        // Method to get user information - waits for all required callbacks to complete
        public async Task<UserInfo> GetUserInfoAsync(string username, string refreshToken)
        {
            // First ensure we're logged in
            var loginResult = await LoginWithCredentialsAsync(username, refreshToken);
            if (!loginResult.Success)
            {
                throw new Exception($"Failed to log in: {loginResult.ErrorMessage}");
            }

            var userInfo = new UserInfo
            {
                SteamId = _steamUser.SteamID?.ConvertToUInt64() ?? 0,
                Username = username
            };

            // Set up completion sources for each piece of information
            var accountInfoTcs = new TaskCompletionSource<bool>();
            var personaStateTcs = new TaskCompletionSource<bool>();
            var emailInfoTcs = new TaskCompletionSource<bool>();

            // Subscribe to one-time callbacks
            var accountSub = _manager.Subscribe<SteamUser.AccountInfoCallback>(callback =>
            {
                userInfo.Country = callback.Country;
                userInfo.PersonaName = callback.PersonaName;
                accountInfoTcs.TrySetResult(true);
            });

            var personaSub = _manager.Subscribe<SteamFriends.PersonaStateCallback>(callback =>
            {
                if (callback.FriendID == _steamUser.SteamID)
                {
                    // Convert avatar hash to URL
                    if (callback.AvatarHash != null && callback.AvatarHash.Length > 0)
                    {
                        var avatarStr = BitConverter.ToString(callback.AvatarHash).Replace("-", "").ToLowerInvariant();
                        userInfo.AvatarUrl = $"https://avatars.akamai.steamstatic.com/{avatarStr}_full.jpg";
                    }

                    userInfo.PersonaName = callback.Name;
                    userInfo.GameId = callback.GameID?.ToUInt64() ?? 0;
                    userInfo.GamePlayingName = callback.GameName;
                    userInfo.LastLogOn = callback.LastLogOn;
                    userInfo.LastLogOff = callback.LastLogOff;
                    personaStateTcs.TrySetResult(true);
                }
            });

            var emailSub = _manager.Subscribe<SteamUser.EmailAddrInfoCallback>(callback =>
            {
                userInfo.Email = callback.EmailAddress;
                emailInfoTcs.TrySetResult(true);
            });

            try
            {
                // Request all the info
                if (_steamUser.SteamID != null)
                {
                    _steamFriends.RequestFriendInfo(_steamUser.SteamID);
                }

                // Wait for all callbacks with timeout
                var timeoutTask = Task.Delay(TimeSpan.FromSeconds(10));
                var tasks = new[]
                {
                    accountInfoTcs.Task,
                    personaStateTcs.Task,
                    emailInfoTcs.Task
                };

                await Task.WhenAny(Task.WhenAll(tasks), timeoutTask);

                return userInfo;
            }
            finally
            {
                // Unsubscribe from callbacks
                // _manager.Unsubscribe(accountSub);
                // _manager.Unsubscribe(personaSub);
                // _manager.Unsubscribe(emailSub);
            }
        }

        public void Disconnect()
        {
            _cts?.Cancel();

            if (_steamUser.SteamID != null)
            {
                _steamUser.LogOff();
            }

            _steamClient.Disconnect();
        }

        #region Private Helper Methods

        private async Task EnsureConnectedAsync()
        {
            if (_callbackTask == null)
            {
                _cts = new CancellationTokenSource();
                _steamClient.Connect();

                // Run callback loop in background
                _callbackTask = Task.Run(() =>
                {
                    while (!_cts.Token.IsCancellationRequested)
                    {
                        _manager.RunWaitCallbacks(TimeSpan.FromMilliseconds(500));
                        Thread.Sleep(10);
                    }
                }, _cts.Token);
                var connectionTcs = new TaskCompletionSource<bool>();
                var connectionSub = _manager.Subscribe<SteamClient.ConnectedCallback>(_ =>
                {
                    connectionTcs.TrySetResult(true);
                });

                try
                {
                    // Wait up to 10 seconds for connection
                    var timeoutTask = Task.Delay(TimeSpan.FromSeconds(10));
                    var completedTask = await Task.WhenAny(connectionTcs.Task, timeoutTask);

                    if (completedTask == timeoutTask)
                    {
                        throw new TimeoutException("Connection to Steam timed out");
                    }
                }
                finally
                {
                    // _manager.Unsubscribe(connectionSub);
                }
            }
        }

        private static async Task SendSseEvent(HttpResponse response, string eventType, object data)
        {
            var json = System.Text.Json.JsonSerializer.Serialize(data);
            await response.WriteAsync($"event: {eventType}\n");
            await response.WriteAsync($"data: {json}\n\n");
            await response.Body.FlushAsync();
        }

        #endregion

        #region Callback Handlers

        private void OnConnected(SteamClient.ConnectedCallback callback)
        {
            Console.WriteLine("Connected to Steam");
        }

        private void OnDisconnected(SteamClient.DisconnectedCallback callback)
        {
            Console.WriteLine("Disconnected from Steam");

            // Only try to reconnect if not deliberately disconnected
            if (_callbackTask != null && !_cts!.IsCancellationRequested)
            {
                Task.Delay(TimeSpan.FromSeconds(5)).ContinueWith(_ => _steamClient.Connect());
            }
        }

        private void OnLoggedOn(SteamUser.LoggedOnCallback callback)
        {
            var success = callback.Result == EResult.OK;
            Console.WriteLine($"Logged on: {success}");

            // Complete all pending auth completion sources
            foreach (var tcs in _authCompletionSources.Values)
            {
                tcs.TrySetResult(success);
            }
        }

        private void OnLoggedOff(SteamUser.LoggedOffCallback callback)
        {
            Console.WriteLine($"Logged off: {callback.Result}");
        }

        #endregion
    }

    public class LoginResult
    {
        public bool Success { get; set; }
        public ulong? SteamId { get; set; }
        public string? Username { get; set; }
        public string? ErrorMessage { get; set; }
    }

    public class UserInfo
    {
        public ulong SteamId { get; set; }
        public string? Username { get; set; }
        public string? PersonaName { get; set; }
        public string? Country { get; set; }
        public string? Email { get; set; }
        public string? AvatarUrl { get; set; }
        public ulong GameId { get; set; }
        public string? GamePlayingName { get; set; }
        public DateTime LastLogOn { get; set; }
        public DateTime LastLogOff { get; set; }
    }
}

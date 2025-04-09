using SteamKit2;
using SteamKit2.Authentication;
using SteamSocketAuth.SteamDataClient;

// Steam client handler
public class SteamClientHandler
{
    private readonly string _clientId;
    private readonly SteamClient _steamClient;
    private readonly SteamFriends _steamFriends;
    private readonly CallbackManager _manager;
    private readonly SteamUser _steamUser;
    public event Action<ServerSentEvent>? OnEvent;
    private readonly List<Action<string>> _subscribers = new();
    private QrAuthSession? _authSession;
    private Task? _callbackTask;
    private CancellationTokenSource? _cts;
    private bool _isAuthenticated = false;
    private readonly SteamDbContext _dbContext;
    private readonly string _userId;
    private readonly Dictionary<string, object> _accountInfoCache = [];
    public SteamUserInfo? UserInfo { get; private set; }

    // Add a callback for when credentials are obtained
    private readonly Action<string, string>? _onCredentialsObtained;

    // Update constructor to optionally receive the callback
    public SteamClientHandler(string clientId, SteamDbContext dbContext, string userId, Action<string, string>? onCredentialsObtained = null)
    {
        _clientId = clientId;
        _onCredentialsObtained = onCredentialsObtained;
        _userId = userId;
        _dbContext = dbContext;
        _steamClient = new SteamClient(SteamConfiguration.Create(e => e.WithConnectionTimeout(TimeSpan.FromSeconds(120))));
        _manager = new CallbackManager(_steamClient);
        _steamFriends = _steamClient.GetHandler<SteamFriends>() ?? throw new InvalidOperationException("SteamFriends handler is not available.");
        _steamUser = _steamClient.GetHandler<SteamUser>() ?? throw new InvalidOperationException("SteamUser handler is not available.");

        // Register callbacks
        _manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
        _manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
        _manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
        _manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);
        _manager.Subscribe<SteamUser.EmailAddrInfoCallback>(OnMailAddrInfoCallback);
        _manager.Subscribe<AccountLimitation.IsLimitedAccountCallback>(OnIsLimitedAccount);
        _manager.Subscribe<SteamUser.AccountInfoCallback>(OnAccountInfo);
        _manager.Subscribe<SteamFriends.PersonaStateCallback>(OnPersonaState);
    }

    // Add method to login with stored credentials
    public async Task<bool> LoginWithStoredCredentialsAsync(string accountName, string refreshToken)
    {
        if (_callbackTask != null)
        {
            return _isAuthenticated; // Already connected
        }

        _cts = new CancellationTokenSource();

        // Connect to Steam
        Console.WriteLine($"[{_clientId}] Connecting to Steam with stored credentials...");

        NotifyEvent(new ServerSentEvent("status", new
        {
            message = $"Connecting to Steam with stored credentials..."
        }));

        _steamClient.Connect();

        // Start callback loop
        _callbackTask = Task.Run(async () =>
        {
            while (!_cts.Token.IsCancellationRequested)
            {
                _manager.RunWaitCallbacks(TimeSpan.FromSeconds(1));
                await Task.Delay(10);
            }
        }, _cts.Token);

        // Wait for connection
        var connectionTask = new TaskCompletionSource<bool>();
        var connectedHandler = _manager.Subscribe<SteamClient.ConnectedCallback>(callback =>
        {
            // Once connected, try to log in with stored credentials
            Console.WriteLine($"[{_clientId}] Connected to Steam, logging in with stored credentials");

            NotifyEvent(new ServerSentEvent("status", new
            {
                message = $"Connected to Steam, logging in with stored credentials"
            }));

            _steamUser.LogOn(new SteamUser.LogOnDetails
            {
                Username = accountName,
                AccessToken = refreshToken
            });
            connectionTask.TrySetResult(true);
        });

        // Set up a handler for the login result
        var loginResultTask = new TaskCompletionSource<bool>();
        var loggedOnHandler = _manager.Subscribe<SteamUser.LoggedOnCallback>(callback =>
        {
            if (callback.Result == EResult.OK)
            {
                Console.WriteLine($"[{_clientId}] Successfully logged on with stored credentials");

                NotifyEvent(new ServerSentEvent("status", new
                {
                    message = $"Successfully logged on with stored credentials"
                }));

                _isAuthenticated = true;
                UserInfo = new SteamUserInfo
                {
                    SteamId = callback.ClientSteamID?.ConvertToUInt64(),
                    Username = accountName
                };
                loginResultTask.TrySetResult(true);
            }
            else
            {
                Console.WriteLine($"[{_clientId}] Failed to log on with stored credentials: {callback.Result}");
                loginResultTask.TrySetResult(false);
            }
        });

        // Add a timeout
        var timeoutTask = Task.Delay(TimeSpan.FromSeconds(30));

        try
        {
            await connectionTask.Task;

            var completedTask = await Task.WhenAny(loginResultTask.Task, timeoutTask);

            if (completedTask == timeoutTask)
            {
                Console.WriteLine($"[{_clientId}] Login with stored credentials timed out");

                NotifyEvent(new ServerSentEvent("status", new
                {
                    message = $"Login with stored credentials timed out"
                }));

                Shutdown();
                return false;
            }

            return await loginResultTask.Task;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[{_clientId}] Error logging in with stored credentials: {ex.Message}");
            return false;
        }
        // finally
        // {
        //     _manager.Unsubscribe(connectedHandler);
        //     _manager.Unsubscribe(loggedOnHandler);
        // }
    }

    public async Task StartAuthenticationAsync()
    {
        if (_callbackTask != null)
        {
            // Authentication already in progress
            if (_authSession != null)
            {
                // Just resend the current QR code URL to all subscribers
                NotifySubscribers(_authSession.ChallengeURL);
            }
            return;
        }

        _cts = new CancellationTokenSource();

        // Connect to Steam
        Console.WriteLine($"[{_clientId}] Connecting to Steam...");

        NotifyEvent(new ServerSentEvent("status", new
        {
            message = $"Connecting to Steam..."
        }));

        _steamClient.Connect();

        // Start callback loop
        _callbackTask = Task.Run(async () =>
        {
            while (!_cts.Token.IsCancellationRequested)
            {
                _manager.RunWaitCallbacks(TimeSpan.FromSeconds(1));
                await Task.Delay(10);
            }
        }, _cts.Token);
    }

    private void NotifyEvent(ServerSentEvent evt)
    {
        OnEvent?.Invoke(evt);

        // Also notify the legacy subscribers with just the URL if this is a URL event
        if (evt.Type == "url" && evt.Data is string url)
        {
            NotifySubscribers(url);
        }
    }

    private async void OnConnected(SteamClient.ConnectedCallback callback)
    {
        Console.WriteLine($"[{_clientId}] Connected to Steam");

        NotifyEvent(new ServerSentEvent("status", new
        {
            message = $"Connected to Steam"
        }));

        try
        {
            // Start QR authentication session
            _authSession = await _steamClient.Authentication.BeginAuthSessionViaQRAsync(new AuthSessionDetails() { DeviceFriendlyName = "Nestri OS" });

            // Handle QR code URL changes
            _authSession.ChallengeURLChanged = () =>
            {
                Console.WriteLine($"[{_clientId}] QR challenge URL refreshed");

                NotifyEvent(new ServerSentEvent("status", new
                {
                    message = $"QR challenge URL refreshed"
                }));

                NotifyEvent(new ServerSentEvent("challenge_url", new { url = _authSession.ChallengeURL }));
            };

            // Send initial QR code URL
            NotifyEvent(new ServerSentEvent("challenge_url", new { url = _authSession.ChallengeURL }));

            // Start polling for authentication result
            await Task.Run(async () =>
            {
                try
                {
                    var pollResponse = await _authSession.PollingWaitForResultAsync();

                    Console.WriteLine($"[{_clientId}] Logging in as '{pollResponse.AccountName}'");

                    NotifyEvent(new ServerSentEvent("status", new
                    {
                        message = $" Logging in as '{pollResponse.AccountName}'"
                    }));

                    // Send login attempt event
                    NotifyEvent(new ServerSentEvent("login-attempt", new { username = pollResponse.AccountName }));

                    // Login to Steam
                    _steamUser.LogOn(new SteamUser.LogOnDetails
                    {
                        Username = pollResponse.AccountName,
                        AccessToken = pollResponse.RefreshToken,
                    });
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[{_clientId}] Authentication polling error: {ex.Message}");

                    NotifyEvent(new ServerSentEvent("status", new
                    {
                        message = $" Authentication polling error: {ex.Message}"
                    }));

                    NotifyEvent(new ServerSentEvent("login-unsuccessful", new { error = ex.Message }));
                }
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[{_clientId}] Error starting authentication: {ex.Message}");

            NotifyEvent(new ServerSentEvent("status", new
            {
                message = $"Error starting authentication: {ex.Message}"
            }));

            NotifyEvent(new ServerSentEvent("login-unsuccessful", new { error = ex.Message }));
        }
    }

    private void OnDisconnected(SteamClient.DisconnectedCallback callback)
    {
        Console.WriteLine($"[{_clientId}] Disconnected from Steam");

        NotifyEvent(new ServerSentEvent("status", new
        {
            message = $"Disconnected from Steam"
        }));

        _isAuthenticated = false;
        UserInfo = null;

        // Reconnect if not intentionally stopped
        if (_callbackTask != null && !_cts!.IsCancellationRequested)
        {
            Console.WriteLine($"[{_clientId}] Reconnecting...");
            NotifyEvent(new ServerSentEvent("status", new
            {
                message = $"Reconnecting..."
            }));
            
            _steamClient.Connect();
        }
    }

    private void OnLoggedOn(SteamUser.LoggedOnCallback callback)
    {
        if (callback.Result != EResult.OK)
        {
            Console.WriteLine($"[{_clientId}] Unable to log on to Steam: {callback.Result} / {callback.ExtendedResult}");

            NotifyEvent(new ServerSentEvent("status", new
            {
                message = $"Unable to log on to Steam: {callback.Result} / {callback.ExtendedResult}"
            }));

            NotifyEvent(new ServerSentEvent("login-unsuccessful", new
            {
                error = $"Steam login failed: {callback.Result}",
                extendedError = callback.ExtendedResult.ToString()
            }));
            return;
        }

        Console.WriteLine($"[{_clientId}] Successfully logged on as {callback.ClientSteamID}");

        _isAuthenticated = true;

        // Get the username from the authentication session
        string accountName = _authSession?.PollingWaitForResultAsync().Result.AccountName ?? "Unknown";
        string refreshToken = _authSession?.PollingWaitForResultAsync().Result.RefreshToken ?? "";

        UserInfo = new SteamUserInfo
        {
            SteamId = callback.ClientSteamID?.ConvertToUInt64(),
            Username = accountName
        };

        // Send login success event
        NotifyEvent(new ServerSentEvent("login-success", new
        {
            steamId = _steamUser.SteamID?.ConvertToUInt64(),
            username = accountName
        }));

        // Save credentials if callback is provided
        if (_onCredentialsObtained != null && !string.IsNullOrEmpty(refreshToken))
        {
            _onCredentialsObtained(accountName, refreshToken);
        }

        _accountInfoCache["username"] = accountName;

        if (callback.ClientSteamID != null)
            _accountInfoCache["steamId"] = callback.ClientSteamID.ConvertToUInt64();
    }

    private async void OnMailAddrInfoCallback(SteamUser.EmailAddrInfoCallback callback)
    {
        _accountInfoCache["email"] = callback.EmailAddress;

        await SaveAccountInfoToDatabaseAsync();
    }

    private async void OnAccountInfo(SteamUser.AccountInfoCallback callback)
    {
        _accountInfoCache["country"] = callback.Country;
        _accountInfoCache["personaName"] = callback.PersonaName;

        // Request additional user info
        if (_steamFriends != null && _steamUser.SteamID != null)
            _steamFriends.RequestFriendInfo(_steamUser.SteamID);

        await SaveAccountInfoToDatabaseAsync();
    }

    private async void OnIsLimitedAccount(AccountLimitation.IsLimitedAccountCallback callback)
    {
        _accountInfoCache["isLocked"] = callback.Locked;
        _accountInfoCache["isBanned"] = callback.CommunityBanned;
        _accountInfoCache["isLimited"] = callback.Limited;
        _accountInfoCache["isAllowedToInviteFriends"] = callback.AllowedToInviteFriends;

        await SaveAccountInfoToDatabaseAsync();
    }

    private async void OnPersonaState(SteamFriends.PersonaStateCallback callback)
    {
        //Our personal info
        if (callback.FriendID == _steamUser?.SteamID && callback.AvatarHash != null && _steamUser != null)
        {
            var avatarStr = BitConverter.ToString(callback.AvatarHash).Replace("-", "").ToLowerInvariant();
            var avatarUrl = $"https://avatars.akamai.steamstatic.com/{avatarStr}_full.jpg";

            _accountInfoCache["avatarUrl"] = avatarUrl;
            _accountInfoCache["personaName"] = callback.Name;
            _accountInfoCache["gameId"] = callback.GameID;
            _accountInfoCache["sourceSteamID"] = callback.SourceSteamID.ConvertToUInt64();
            _accountInfoCache["gamePlayingName"] = callback.GameName;
            _accountInfoCache["lastLogOn"] = callback.LastLogOn;
            _accountInfoCache["lastLogOff"] = callback.LastLogOff;
            
            await SaveAccountInfoToDatabaseAsync();
        }
    }

    private void OnLoggedOff(SteamUser.LoggedOffCallback callback)
    {
        Console.WriteLine($"[{_clientId}] Logged off of Steam: {callback.Result}");

        NotifyEvent(new ServerSentEvent("status", new
        {
            message = $"Logged off of Steam: {callback.Result}"
        }));

        _isAuthenticated = false;
        UserInfo = null;

        // Unnecessary but just in case the frontend wants to listen to this
        NotifyEvent(new ServerSentEvent("logged-off", new
        {
            reason = callback.Result.ToString()
        }));
    }

    public Action Subscribe(Action<ServerSentEvent> callback)
    {
        OnEvent += callback;

        // If we already have a QR code URL, send it immediately
        if (_authSession != null)
        {
            callback(new ServerSentEvent("challenge_url", _authSession.ChallengeURL));
        }

        return () => OnEvent -= callback;
    }

    // Keep the old Subscribe method for backward compatibility
    public Action Subscribe(Action<string> callback)
    {
        lock (_subscribers)
        {
            _subscribers.Add(callback);

            // If we already have a QR code URL, send it immediately
            if (_authSession != null)
            {
                callback(_authSession.ChallengeURL);
            }
        }

        return () =>
        {
            lock (_subscribers)
            {
                _subscribers.Remove(callback);
            }
        };
    }

    private void NotifySubscribers(string url)
    {
        lock (_subscribers)
        {
            foreach (var subscriber in _subscribers)
            {
                try
                {
                    subscriber(url);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[{_clientId}] Error notifying subscriber: {ex.Message}");
                }
            }
        }
    }

    public void Shutdown()
    {
        _cts?.Cancel();
        _steamClient.Disconnect();
    }

    private async Task SaveAccountInfoToDatabaseAsync()
    {
        try
        {

            var existingInfo = _dbContext.SteamAccountInfo
                .FirstOrDefault(info => info.UserId == _userId);

            if (existingInfo == null)
            {
                // Create new record
                var newInfo = new SteamAccountInfo
                {
                    UserId = _userId,
                    Username = _accountInfoCache.ContainsKey("username") ? (string)_accountInfoCache["username"] : null,
                    SteamId = _accountInfoCache.ContainsKey("steamId") ? (ulong)_accountInfoCache["steamId"] : null,
                    Email = _accountInfoCache.ContainsKey("email") ? (string)_accountInfoCache["email"] : null,
                    Country = _accountInfoCache.ContainsKey("country") ? (string)_accountInfoCache["country"] : null,
                    PersonaName = _accountInfoCache.ContainsKey("personaName") ? (string)_accountInfoCache["personaName"] : null,
                    IsLocked = _accountInfoCache.ContainsKey("isLocked") ? (bool)_accountInfoCache["isLocked"] : null,
                    IsBanned = _accountInfoCache.ContainsKey("isBanned") ? (bool)_accountInfoCache["isBanned"] : null,
                    IsLimited = _accountInfoCache.ContainsKey("isLimited") ? (bool)_accountInfoCache["isLimited"] : null,
                    IsAllowedToInviteFriends = _accountInfoCache.ContainsKey("isAllowedToInviteFriends") ? (bool)_accountInfoCache["isAllowedToInviteFriends"] : null,
                    AvatarUrl = _accountInfoCache.ContainsKey("avatarUrl") ? (string)_accountInfoCache["avatarUrl"] : null,
                    GameId = _accountInfoCache.ContainsKey("gameId") ? (ulong)_accountInfoCache["gameId"] : null,
                    SourceSteamId = _accountInfoCache.ContainsKey("sourceSteamID") ? (ulong)_accountInfoCache["sourceSteamID"] : null,
                    GamePlayingName = _accountInfoCache.ContainsKey("gamePlayingName") ? (string)_accountInfoCache["gamePlayingName"] : null,
                    LastLogOn = _accountInfoCache.ContainsKey("lastLogOn") ? (DateTime)_accountInfoCache["lastLogOn"] : null,
                    LastLogOff = _accountInfoCache.ContainsKey("lastLogOff") ? (DateTime)_accountInfoCache["lastLogOff"] : null
                };

                _dbContext.SteamAccountInfo.Add(newInfo);
            }
            else
            {
                // Update existing record
                existingInfo.Username = _accountInfoCache.ContainsKey("username") ? (string)_accountInfoCache["username"] : existingInfo.Username;
                existingInfo.SteamId = _accountInfoCache.ContainsKey("steamId") ? (ulong)_accountInfoCache["steamId"] : existingInfo.SteamId;
                existingInfo.Email = _accountInfoCache.ContainsKey("email") ? (string)_accountInfoCache["email"] : existingInfo.Email;
                existingInfo.Country = _accountInfoCache.ContainsKey("country") ? (string)_accountInfoCache["country"] : existingInfo.Country;
                existingInfo.PersonaName = _accountInfoCache.ContainsKey("personaName") ? (string)_accountInfoCache["personaName"] : existingInfo.PersonaName;
                existingInfo.IsLocked = _accountInfoCache.ContainsKey("isLocked") ? (bool)_accountInfoCache["isLocked"] : existingInfo.IsLocked;
                existingInfo.IsBanned = _accountInfoCache.ContainsKey("isBanned") ? (bool)_accountInfoCache["isBanned"] : existingInfo.IsBanned;
                existingInfo.IsLimited = _accountInfoCache.ContainsKey("isLimited") ? (bool)_accountInfoCache["isLimited"] : existingInfo.IsLimited;
                existingInfo.IsAllowedToInviteFriends = _accountInfoCache.ContainsKey("isAllowedToInviteFriends") ? (bool)_accountInfoCache["isAllowedToInviteFriends"] : existingInfo.IsAllowedToInviteFriends;
                existingInfo.AvatarUrl = _accountInfoCache.ContainsKey("avatarUrl") ? (string)_accountInfoCache["avatarUrl"] : existingInfo.AvatarUrl;
                existingInfo.GameId = _accountInfoCache.ContainsKey("gameId") ? (ulong)_accountInfoCache["gameId"] : existingInfo.GameId;
                existingInfo.SourceSteamId = _accountInfoCache.ContainsKey("sourceSteamID") ? (ulong)_accountInfoCache["sourceSteamID"] : existingInfo.SourceSteamId;
                existingInfo.GamePlayingName = _accountInfoCache.ContainsKey("gamePlayingName") ? (string)_accountInfoCache["gamePlayingName"] : existingInfo.GamePlayingName;
                existingInfo.LastLogOn = _accountInfoCache.ContainsKey("lastLogOn") ? (DateTime)_accountInfoCache["lastLogOn"] : existingInfo.LastLogOn;
                existingInfo.LastLogOff = _accountInfoCache.ContainsKey("lastLogOff") ? (DateTime)_accountInfoCache["lastLogOff"] : existingInfo.LastLogOff;
                existingInfo.UpdatedAt = DateTime.UtcNow;
            }

            await _dbContext.SaveChangesAsync();
            Console.WriteLine($"[{_clientId}] Saved account info to database for user {_userId}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[{_clientId}] Error saving account info to database: {ex.Message}");
        }
    }
}

public class SteamUserInfo
{
    public ulong? SteamId { get; set; }
    public string Username { get; set; } = string.Empty;
}
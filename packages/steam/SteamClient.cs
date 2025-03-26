using SteamKit2;
using SteamKit2.Authentication;

// Steam client handler
public class SteamClientHandler
{
    private readonly string _clientId;
    private readonly SteamClient _steamClient;
    private readonly CallbackManager _manager;
    private readonly SteamUser _steamUser;
    public event Action<ServerSentEvent>? OnEvent;
    private readonly List<Action<string>> _subscribers = new();
    private QrAuthSession? _authSession;
    private Task? _callbackTask;
    private CancellationTokenSource? _cts;
    private bool _isAuthenticated = false;

    public SteamUserInfo? UserInfo { get; private set; }

    // Add a callback for when credentials are obtained
    private readonly Action<string, string>? _onCredentialsObtained;

    // Update constructor to optionally receive the callback
    public SteamClientHandler(string clientId, Action<string, string>? onCredentialsObtained = null)
    {
        _clientId = clientId;
        _onCredentialsObtained = onCredentialsObtained;
        _steamClient = new SteamClient(SteamConfiguration.Create(e => e.WithConnectionTimeout(TimeSpan.FromSeconds(120))));
        _manager = new CallbackManager(_steamClient);
        _steamUser = _steamClient.GetHandler<SteamUser>()!;

        // Register callbacks
        _manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
        _manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
        _manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
        _manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);
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
                _isAuthenticated = true;
                UserInfo = new SteamUserInfo
                {
                    SteamId = callback.ClientSteamID.ToString(),
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

        try
        {
            // Start QR authentication session
            _authSession = await _steamClient.Authentication.BeginAuthSessionViaQRAsync(new AuthSessionDetails());

            // Handle QR code URL changes
            _authSession.ChallengeURLChanged = () =>
            {
                Console.WriteLine($"[{_clientId}] QR challenge URL refreshed");
                NotifyEvent(new ServerSentEvent("url", _authSession.ChallengeURL));
            };

            // Send initial QR code URL
            NotifyEvent(new ServerSentEvent("url", _authSession.ChallengeURL));

            // Start polling for authentication result
            await Task.Run(async () =>
            {
                try
                {
                    var pollResponse = await _authSession.PollingWaitForResultAsync();

                    Console.WriteLine($"[{_clientId}] Logging in as '{pollResponse.AccountName}'");

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
                    NotifyEvent(new ServerSentEvent("login-unsuccessful", new { error = ex.Message }));
                }
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[{_clientId}] Error starting authentication: {ex.Message}");
            NotifyEvent(new ServerSentEvent("login-unsuccessful", new { error = ex.Message }));
        }
    }

    private void OnDisconnected(SteamClient.DisconnectedCallback callback)
    {
        Console.WriteLine($"[{_clientId}] Disconnected from Steam");

        _isAuthenticated = false;
        UserInfo = null;

        // Reconnect if not intentionally stopped
        if (_callbackTask != null && !_cts.IsCancellationRequested)
        {
            Console.WriteLine($"[{_clientId}] Reconnecting...");
            _steamClient.Connect();
        }
    }

    private void OnLoggedOn(SteamUser.LoggedOnCallback callback)
    {
        if (callback.Result != EResult.OK)
        {
            Console.WriteLine($"[{_clientId}] Unable to log on to Steam: {callback.Result} / {callback.ExtendedResult}");
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
            SteamId = callback.ClientSteamID.ToString(),
            Username = accountName
        };

        // Send login success event
        NotifyEvent(new ServerSentEvent("login-success", new
        {
            steamId = callback.ClientSteamID.ToString(),
            username = accountName
        }));

        // Save credentials if callback is provided
        if (_onCredentialsObtained != null && !string.IsNullOrEmpty(refreshToken))
        {
            _onCredentialsObtained(accountName, refreshToken);
        }
    }

    private void OnLoggedOff(SteamUser.LoggedOffCallback callback)
    {
        Console.WriteLine($"[{_clientId}] Logged off of Steam: {callback.Result}");

        _isAuthenticated = false;
        UserInfo = null;

        //Unnecessary but just in case the frontend wants to listen to this
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
            callback(new ServerSentEvent("url", _authSession.ChallengeURL));
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
}

public class SteamUserInfo
{
    public string SteamId { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
}
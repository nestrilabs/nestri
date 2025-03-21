using SteamKit2;
using SteamKit2.Authentication;
using System.Collections.Concurrent;

// Steam Service
public class SteamService
{
    private readonly ConcurrentDictionary<string, SteamClientHandler> _clientHandlers = new();
    
    public async Task StartAuthentication(string clientId)
    {
        // Create or get client handler
        var handler = _clientHandlers.GetOrAdd(clientId, id => new SteamClientHandler(id));
        
        // Start Steam authentication if not already started
        await handler.StartAuthenticationAsync();
    }
    
    public Action Subscribe(string clientId, Action<string> callback)
    {
        if (_clientHandlers.TryGetValue(clientId, out var handler))
        {
            return handler.Subscribe(callback);
        }
        
        return () => { }; // Empty unsubscribe function
    }
    
    public void Unsubscribe(string clientId, Action unsubscribeAction)
    {
        unsubscribeAction();
    }
    
    public SteamUserInfo? GetUserInfo(string clientId)
    {
        if (_clientHandlers.TryGetValue(clientId, out var handler))
        {
            return handler.UserInfo;
        }
        
        return null;
    }
}

// Steam client handler
public class SteamClientHandler
{
    private readonly string _clientId;
    private readonly SteamClient _steamClient;
    private readonly CallbackManager _manager;
    private readonly SteamUser _steamUser;
    private readonly List<Action<string>> _subscribers = new();
    private QrAuthSession? _authSession;
    private Task? _callbackTask;
    private CancellationTokenSource? _cts;
    private bool _isAuthenticated = false;
    
    public SteamUserInfo? UserInfo { get; private set; }
    
    public SteamClientHandler(string clientId)
    {
        _clientId = clientId;
        _steamClient = new SteamClient();
        _manager = new CallbackManager(_steamClient);
        _steamUser = _steamClient.GetHandler<SteamUser>()!;
        
        // Register callbacks
        _manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
        _manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
        _manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
        _manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);
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
                NotifySubscribers(_authSession.ChallengeURL);
            };
            
            // Send initial QR code URL
            NotifySubscribers(_authSession.ChallengeURL);
            
            // Start polling for authentication result
            await Task.Run(async () =>
            {
                try
                {
                    var pollResponse = await _authSession.PollingWaitForResultAsync();
                    
                    Console.WriteLine($"[{_clientId}] Logging in as '{pollResponse.AccountName}'");
                    
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
                }
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[{_clientId}] Error starting authentication: {ex.Message}");
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
            return;
        }
        
        Console.WriteLine($"[{_clientId}] Successfully logged on as {callback.ClientSteamID}");
        
        _isAuthenticated = true;
        UserInfo = new SteamUserInfo
        {
            SteamId = callback.ClientSteamID.ToString(),
            Username = _authSession?.PollingWaitForResultAsync().Result.AccountName ?? "Unknown"
        };
    }
    
    private void OnLoggedOff(SteamUser.LoggedOffCallback callback)
    {
        Console.WriteLine($"[{_clientId}] Logged off of Steam: {callback.Result}");
        
        _isAuthenticated = false;
        UserInfo = null;
    }
    
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
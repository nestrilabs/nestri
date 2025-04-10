using SteamKit2;
using SteamKit2.Authentication;
using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using SteamKit2.Internal;

namespace SteamAuth
{
    public class SteamAuthComponent
    {
        private readonly SteamUser _steamUser;
        private readonly SteamClient _steamClient;
        private CancellationTokenSource? _cts;
        // private readonly SteamApps _steamApps;
        private readonly CallbackManager _manager;
        public event Action<ServerSentEvent>? OnEvent;
        private readonly SteamFriends _steamFriends;
        private QrAuthSession? _authSession;
        private Task? _callbackTask;
        private readonly Action<string, string>? _onCredentialsObtained;
        // private bool _isRunning = true;
        private bool _isLoggedIn = false;
        private readonly string _userId;
        // private bool _isLoadingLibrary = false;
        private readonly IServiceProvider _serviceProvider; // We'll use this to create context instances when needed
        private TaskCompletionSource<bool>? _authCompletionSource;
        // private ConcurrentDictionary<uint, ulong> PackageTokens { get; } = [];
        private readonly List<Action<string>> _subscribers = new();
        // private ConcurrentDictionary<uint, SteamApps.PICSProductInfoCallback.PICSProductInfo> PackageInfo { get; } = [];
        // private ConcurrentDictionary<uint, SteamApps.PICSProductInfoCallback.PICSProductInfo> AppInfo { get; } = [];
        private ConcurrentDictionary<ulong, Dictionary<string, object>> FriendsInfo { get; } = [];
        // public ReadOnlyCollection<uint> PackageIDs { get; private set; }
        private readonly Dictionary<string, object> _accountInfoCache = [];
        public SteamAuthComponent(IServiceProvider serviceProvider, string userId, Action<string, string>? onCredentialsObtained = null)
        {
            _onCredentialsObtained = onCredentialsObtained;
            _serviceProvider = serviceProvider;
            _userId = userId;
            _steamClient = new SteamClient(SteamConfiguration.Create(config =>
            {
                config.WithConnectionTimeout(TimeSpan.FromSeconds(30));
                config.WithProtocolTypes(ProtocolTypes.Tcp | ProtocolTypes.WebSocket);
            }));
            _manager = new CallbackManager(_steamClient);
            // _steamApps = _steamClient.GetHandler<SteamApps>() ?? throw new InvalidOperationException("SteamApps handler is not available.");
            _steamUser = _steamClient.GetHandler<SteamUser>() ?? throw new InvalidOperationException("SteamUser handler is not available.");
            _steamFriends = _steamClient.GetHandler<SteamFriends>() ?? throw new InvalidOperationException("SteamFriends handler is not available.");

            // Register callbacks
            _manager.Subscribe<SteamClient.ConnectedCallback>(OnConnected);
            _manager.Subscribe<SteamClient.DisconnectedCallback>(OnDisconnected);
            _manager.Subscribe<SteamUser.LoggedOnCallback>(OnLoggedOn);
            _manager.Subscribe<SteamUser.LoggedOffCallback>(OnLoggedOff);
            _manager.Subscribe<SteamUser.AccountInfoCallback>(OnAccountInfo);
            _manager.Subscribe<SteamFriends.PersonaStateCallback>(OnPersonaState);
            _manager.Subscribe<SteamUser.EmailAddrInfoCallback>(OnMailAddrInfoCallback);
            // _manager.Subscribe<AccountLimitation.IsLimitedAccountCallback>(OnIsLimitedAccount);
            // _manager.Subscribe<SteamApps.LicenseListCallback>(OnLicenseList);
            // _manager.Subscribe<SteamFriends.FriendsListCallback>(OnFriendsList);
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

            _callbackTask = Task.Run(async () =>
            {
                while (!_cts.Token.IsCancellationRequested)
                {
                    _manager.RunWaitCallbacks(TimeSpan.FromSeconds(1));
                    await Task.Delay(10);
                }
            }, _cts.Token);

            // Wait for authentication to complete
            await _authCompletionSource.Task;

            return _isLoggedIn;
        }

        private async void OnConnected(SteamClient.ConnectedCallback callback)
        {
            try
            {
                NotifyEvent(new ServerSentEvent("status", new { message = "Connected to Steam" }));

                // If we have credentials, use them directly
                if (!string.IsNullOrEmpty(_refreshToken) && !string.IsNullOrEmpty(_username))
                {
                    NotifyEvent(new ServerSentEvent("status", new { message = $"Logging in as '{_username}'..." }));

                    _steamUser.LogOn(new SteamUser.LogOnDetails
                    {
                        Username = _username,
                        AccessToken = _refreshToken,
                    });
                }
                else
                {
                    NotifyEvent(new ServerSentEvent("status", new { message = "Starting QR authentication..." }));
                    // Start QR authentication flow
                    _authSession = await _steamClient.Authentication.BeginAuthSessionViaQRAsync(new AuthSessionDetails() { DeviceFriendlyName = "Nestri Cloud Gaming" });

                    // Handle QR code URL refreshes
                    _authSession.ChallengeURLChanged = () =>
                    {
                        NotifyEvent(new ServerSentEvent("status", new { message = "QR Code link changed" }));
                        NotifyEvent(new ServerSentEvent("challenge_url", new { url = _authSession.ChallengeURL }));
                    };

                    // Send initial QR code URL
                    NotifyEvent(new ServerSentEvent("challenge_url", new { url = _authSession.ChallengeURL }));

                    await Task.Run(async () =>
                    {
                        try
                        {
                            // Poll for authentication result
                            var pollResponse = await _authSession.PollingWaitForResultAsync();
                            // Store credentials for future use
                            _username = pollResponse.AccountName;
                            _refreshToken = pollResponse.RefreshToken;
                            // Log in using the obtained credentials
                            NotifyEvent(new ServerSentEvent("status", new { message = $"Logging in as '{_username}'..." }));

                            _steamUser.LogOn(new SteamUser.LogOnDetails
                            {
                                Username = pollResponse.AccountName,
                                AccessToken = pollResponse.RefreshToken,
                            });
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[{_userId}] Authentication polling error: {ex.Message}");

                            NotifyEvent(new ServerSentEvent("status", new
                            {
                                message = $" Authentication polling error: {ex.Message}"
                            }));

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
            NotifyEvent(new ServerSentEvent("disconnected", new { success = true }));

            _authCompletionSource?.SetResult(false);

            // _isRunning = false;

            Console.WriteLine($"[{_userId}] Disconnected from Steam");

            NotifyEvent(new ServerSentEvent("status", new
            {
                message = $"Disconnected from Steam"
            }));

            _isLoggedIn = false;

            // Reconnect if not intentionally stopped
            if (_callbackTask != null && !_cts!.IsCancellationRequested)
            {
                Console.WriteLine($"[{_userId}] Reconnecting...");
                NotifyEvent(new ServerSentEvent("status", new
                {
                    message = $"Reconnecting in 500 seconds..."
                }));

                await Task.Delay(TimeSpan.FromSeconds(30), _cts.Token);

                _steamClient.Connect();
            }
        }

        // private void OnFriendsList(SteamFriends.FriendsListCallback callback)
        // {
        //     var friends = callback.FriendList;
        //     foreach (var friend in friends)
        //     {
        //         _steamFriends.RequestFriendInfo(friend.SteamID);
        //     }
        // }

        private void OnLoggedOn(SteamUser.LoggedOnCallback callback)
        {
            if (callback.Result != EResult.OK)
            {
                NotifyEvent(new ServerSentEvent("error", new { message = $"Unable to log on to Steam: {callback.Result} / {callback.ExtendedResult}" }));

                _authCompletionSource?.SetResult(false);
                return;
            }

            _isLoggedIn = true;

            NotifyEvent(new ServerSentEvent("status", new { message = "Successfully logged in to Steam" }));

            NotifyEvent(new ServerSentEvent("login-success", new
            {
                steamId = _steamUser.SteamID?.ConvertToUInt64(),
                username = _username
            }));

            if (_onCredentialsObtained != null && !string.IsNullOrEmpty(_refreshToken) && !string.IsNullOrEmpty(_username))
            {
                _onCredentialsObtained(_username, _refreshToken);
            }

            var isLimitedAccountMsg = new ClientMsgProtobuf<CMsgClientIsLimitedAccount>(EMsg.ClientIsLimitedAccount);

            var limited = isLimitedAccountMsg.Body.bis_limited_account;
            var communityBanned = isLimitedAccountMsg.Body.bis_community_banned;
            var locked = isLimitedAccountMsg.Body.bis_locked_account;
            var allowedToInviteFriends = isLimitedAccountMsg.Body.bis_limited_account_allowed_to_invite_friends;

            _accountInfoCache["isLocked"] = locked;
            Console.WriteLine($"isLocked: {locked}");
            _accountInfoCache["isBanned"] = communityBanned;
            Console.WriteLine($"isBanned: {communityBanned}");
            _accountInfoCache["isLimited"] = limited;
            Console.WriteLine($"isLimited: {limited}");
            _accountInfoCache["isAllowedToInviteFriends"] = allowedToInviteFriends;
            Console.WriteLine($"isAllowedToInviteFriends: {allowedToInviteFriends}");
            // _steamFriends.SetPersonaState(EPersonaState.Online);

            // var friendCount = _steamFriends.GetFriendCount();

            // NotifyEvent(new ServerSentEvent("status", new { message = $"Requesting data for {friendCount} friends" }));

            // for (int i = 0; i < friendCount; i++)
            // {
            //     var friendId = _steamFriends.GetFriendByIndex(i);
            //     _steamFriends.RequestFriendInfo(friendId);
            // }

            if (callback.ClientSteamID != null)
                _accountInfoCache["steamId"] = callback.ClientSteamID.ConvertToUInt64();

            // Account info and persona state callbacks will be triggered automatically
        }

        private void OnLoggedOff(SteamUser.LoggedOffCallback callback)
        {
            NotifyEvent(new ServerSentEvent("status", new
            {
                message = $"Logged off of Steam: {callback.Result}"
            }));

            _isLoggedIn = false;

            // Unnecessary but just in case the frontend wants to listen to this
            NotifyEvent(new ServerSentEvent("logged-off", new
            {
                reason = callback.Result.ToString()
            }));
        }

        private void OnAccountInfo(SteamUser.AccountInfoCallback callback)
        {
            _accountInfoCache["country"] = callback.Country;
            _accountInfoCache["personaName"] = callback.PersonaName;

            // Request additional user info
            if (_steamFriends != null && _steamUser.SteamID != null)
                _steamFriends.RequestFriendInfo(_steamUser.SteamID);
        }

        private void OnMailAddrInfoCallback(SteamUser.EmailAddrInfoCallback callback)
        {
            // Handle mail info if needed
            _accountInfoCache["email"] = callback.EmailAddress;
        }

        // private async void OnIsLimitedAccount(AccountLimitation.IsLimitedAccountCallback callback)
        // {
        //     _accountInfoCache["isLocked"] = callback.Locked;
        //     _accountInfoCache["isBanned"] = callback.CommunityBanned;
        //     _accountInfoCache["isLimited"] = callback.Limited;
        //     _accountInfoCache["isAllowedToInviteFriends"] = callback.AllowedToInviteFriends;
        //     await SaveAccountInfoToDatabaseAsync();
        // }

        // private async void OnLicenseList(SteamApps.LicenseListCallback callback)
        // {
        //     try
        //     {
        //         _isLoadingLibrary = true;
        //         await SendToClient(new { type = "status", message = $"Got {callback.LicenseList.Count} licenses for account!" });
        //         List<uint> packageIds = [];
        //         foreach (var license in callback.LicenseList)
        //         {
        //             if ((license.LicenseFlags & ELicenseFlags.Expired) != 0)
        //                 continue;

        //             packageIds.Add(license.PackageID);
        //             if (license.AccessToken > 0)
        //                 PackageTokens.TryAdd(license.PackageID, license.AccessToken);
        //         }

        //         PackageIDs = new ReadOnlyCollection<uint>(packageIds);
        //         await RequestPackageInfo(packageIds);

        //         var requests = new List<SteamApps.PICSRequest>();
        //         var appids = new List<uint>();
        //         foreach (var package in PackageInfo.Values)
        //         {
        //             ulong token = PackageTokens.GetValueOrDefault(package.ID);
        //             foreach (var appid in package.KeyValues["appids"].Children)
        //             {
        //                 var appidI = appid.AsUnsignedInteger();
        //                 if (appids.Contains(appidI)) continue;
        //                 var req = new SteamApps.PICSRequest(appidI, token);
        //                 requests.Add(req);
        //                 appids.Add(appidI);
        //             }
        //         }

        //         await SendToClient(new { type = "status", message = $"Making requests for {requests.Count} apps" });
        //         try
        //         {
        //             var result = await _steamApps.PICSGetProductInfo(requests, []);
        //             if (result == null)
        //             {
        //                 await SendToClient(new { type = "error", message = "Failed to get apps" });
        //                 return;
        //             }

        //             if (result.Complete)
        //             {
        //                 if (result.Results == null || result.Results.Count == 0)
        //                 {
        //                     await SendToClient(new { type = "status", message = "No game results retrieved" });
        //                     return;
        //                 }

        //                 foreach (var resultItem in result.Results)
        //                 {
        //                     foreach (var app in resultItem.Apps)
        //                     {
        //                         AppInfo[app.Key] = app.Value;
        //                     }
        //                 }

        //                 await SendToClient(new { type = "status", message = $"Successfully retrieved {AppInfo.Count} games" });
        //             }
        //             else if (result.Failed)
        //             {
        //                 await SendToClient(new { type = "status", message = "Some requests failed" });
        //             }

        //         }
        //         catch (Exception exception)
        //         {
        //             await SendToClient(new { type = "error", message = $"Error when getting product list for licenses: {exception.Message}" });
        //         }
        //         _isLoadingLibrary = false;
        //     }
        //     catch (TaskCanceledException)
        //     {
        //         await SendToClient(new { type = "error", message = "Task cancelled when loading library" });
        //     }
        // }

        // public async Task RequestPackageInfo(IEnumerable<uint> packageIds)
        // {
        //     var packages = packageIds.ToList();
        //     packages.RemoveAll(PackageInfo.ContainsKey);

        //     if (packages.Count == 0)
        //         return;

        //     var packageRequests = new List<SteamApps.PICSRequest>();

        //     foreach (var package in packages)
        //     {
        //         var request = new SteamApps.PICSRequest(package);

        //         if (PackageTokens.TryGetValue(package, out var token))
        //         {
        //             request.AccessToken = token;
        //         }

        //         packageRequests.Add(request);
        //     }

        //     var packageInfoMultiple = await _steamApps.PICSGetProductInfo([], packageRequests);

        //     foreach (var packageInfo in packageInfoMultiple.Results)
        //     {
        //         foreach (var package_value in packageInfo.Packages)
        //         {
        //             var package = package_value.Value;
        //             PackageInfo[package.ID] = package;
        //         }

        //         foreach (var package in packageInfo.UnknownPackages)
        //         {
        //             PackageInfo[package] = null;
        //         }
        //     }
        // }
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
                        Console.WriteLine($"[{_userId}] Error notifying subscriber: {ex.Message}");
                    }
                }
            }
        }
        //TODO: Make this a lil bit cleaner
        private void OnPersonaState(SteamFriends.PersonaStateCallback callback)
        {
            //Our personal info
            if (callback.FriendID == _steamUser?.SteamID && _username != null && callback.AvatarHash != null && _steamUser != null)
            {
                var avatarStr = BitConverter.ToString(callback.AvatarHash).Replace("-", "").ToLowerInvariant();
                var avatarUrl = $"https://avatars.akamai.steamstatic.com/{avatarStr}_full.jpg";

                _accountInfoCache["avatarUrl"] = avatarUrl;
                _accountInfoCache["username"] = _username;
                _accountInfoCache["personaName"] = callback.Name;
                _accountInfoCache["gameId"] = callback.GameID.ToUInt64();
                _accountInfoCache["sourceSteamID"] = callback.SourceSteamID.ConvertToUInt64();
                _accountInfoCache["gamePlayingName"] = callback.GameName;
                _accountInfoCache["lastLogOn"] = callback.LastLogOn;
                _accountInfoCache["lastLogOff"] = callback.LastLogOff;
                _accountInfoCache["steamId"] = _steamUser.SteamID.ConvertToUInt64();

                NotifyEvent(new ServerSentEvent("account_info", new { info = _accountInfoCache }));
                NotifyEvent(new ServerSentEvent("status", new { message = "Successfully logged in to Steam" }));
                // Authentication process is complete
                _authCompletionSource?.TrySetResult(true);
                return;
            }

            var steamId = callback.FriendID.ConvertToUInt64();

            if (callback.AvatarHash != null)
            {
                var avatarStr = BitConverter.ToString(callback.AvatarHash).Replace("-", "").ToLowerInvariant();
                var avatarUrl = $"https://avatars.akamai.steamstatic.com/{avatarStr}_full.jpg";
                var friendInfo = FriendsInfo.GetOrAdd(steamId, _ => []);

                friendInfo["name"] = callback.Name;
                friendInfo["steamId"] = steamId;
                friendInfo["avatarUrl"] = avatarUrl;
                friendInfo["gameId"] = callback.GameID;
                friendInfo["gameName"] = callback.GameName;
                friendInfo["lastLogOn"] = callback.LastLogOn;
                friendInfo["lastLogOff"] = callback.LastLogOff;
                friendInfo["onlineState"] = callback.State.ToString();
                friendInfo["relationshipState"] = _steamFriends?.GetFriendRelationship(callback.FriendID).ToString() ?? "Unknown";
            }
        }

        // Store credentials for direct login
        private string? _refreshToken;
        private string? _username;
        // Method to set credentials for direct login
        public void SetCredentials(string username, string refreshToken)
        {
            _username = username;
            _refreshToken = refreshToken;
        }

        public void Disconnect()
        {
            Console.WriteLine("Stopping process...");
            _cts?.Cancel();
            _steamClient.Disconnect();
            // _isRunning = false;
            // if (_isLoggedIn)
            // {
            //     _steamUser.LogOff();
            //     _isLoggedIn = false;
            // }

            // _steamClient.Disconnect();

            // if (_clientSocket?.Connected == true)
            // {
            //     try
            //     {
            //         _clientSocket.Shutdown(SocketShutdown.Both);
            //         _clientSocket.Close();
            //     }
            //     catch (Exception ex)
            //     {
            //         Console.WriteLine($"Error during socket shutdown: {ex.Message}");
            //     }
            // }
        }
    }
}
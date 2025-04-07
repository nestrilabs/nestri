using SteamKit2;
using System.Text;
using System.Text.Json;
using System.Net.Sockets;
using SteamKit2.Authentication;
using SteamSocketAuth.SteamDataClient;
using System.Collections.Concurrent;
using System.Collections.ObjectModel;

namespace SteamSocketAuth
{
    public class SteamLoginComponent
    {
        private readonly SteamUser _steamUser;
        private readonly SteamClient _steamClient;
        private readonly SteamApps _steamApps;
        private readonly CallbackManager _manager;
        private readonly SteamFriends _steamFriends;
        private Socket _clientSocket;
        private bool _isRunning = true;
        private bool _isLoggedIn = false;
        private bool _isLoadingLibrary = false;
        private TaskCompletionSource<bool> _authCompletionSource;
        private ConcurrentDictionary<uint, ulong> PackageTokens { get; } = [];
        private ConcurrentDictionary<uint, SteamApps.PICSProductInfoCallback.PICSProductInfo> PackageInfo { get; } = [];
        private ConcurrentDictionary<uint, SteamApps.PICSProductInfoCallback.PICSProductInfo> AppInfo { get; } = [];
        private ConcurrentDictionary<ulong, Dictionary<string, object>> FriendsInfo { get; } = [];
        public ReadOnlyCollection<uint> PackageIDs { get; private set; }
        private readonly Dictionary<string, object> _accountInfoCache = [];
        public SteamLoginComponent()
        {
            _steamClient = new SteamClient(SteamConfiguration.Create(config =>
            {
                config.WithConnectionTimeout(TimeSpan.FromSeconds(30));
                config.WithProtocolTypes(ProtocolTypes.Tcp | ProtocolTypes.WebSocket);
            }));
            _manager = new CallbackManager(_steamClient);
            _steamApps = _steamClient.GetHandler<SteamApps>() ?? throw new InvalidOperationException("SteamApps handler is not available.");
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
            _manager.Subscribe<AccountLimitation.IsLimitedAccountCallback>(OnIsLimitedAccount);
            _manager.Subscribe<SteamApps.LicenseListCallback>(OnLicenseList);
            // _manager.Subscribe<SteamFriends.FriendsListCallback>(OnFriendsList);
        }

        public void SetClientSocket(Socket clientSocket)
        {
            _clientSocket = clientSocket;
        }

        public async Task HandleLoginRequest(LoginRequest loginRequest)
        {
            _authCompletionSource = new TaskCompletionSource<bool>();

            // Connect to Steam
            await SendToClient(new { type = "status", message = "Connecting to Steam..." });
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

                await SendToClient(new { type = "status", message = "Connected to Steam" });

                // If we have credentials, use them directly
                if (!string.IsNullOrEmpty(_refreshToken) && !string.IsNullOrEmpty(_username))
                {
                    await SendToClient(new { type = "status", message = $"Logging in as '{_username}'..." });

                    _steamUser.LogOn(new SteamUser.LogOnDetails
                    {
                        Username = _username,
                        AccessToken = _refreshToken,
                        MachineName = "Nestri"
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

                    await SendToClient(new
                    {
                        type = "credentials",
                        username = pollResponse.AccountName,
                        refreshToken = pollResponse.RefreshToken,
                    });

                    await SendToClient(new { type = "status", message = $"Logging in as '{pollResponse.AccountName}'..." });

                    _steamUser.LogOn(new SteamUser.LogOnDetails
                    {
                        Username = pollResponse.AccountName,
                        AccessToken = pollResponse.RefreshToken,
                        MachineName = "Nestri",
                    });
                }
            }
            catch (Exception ex)
            {
                await SendToClient(new { type = "error", message = $"Authentication error: {ex.Message}" });
                _authCompletionSource.SetResult(false);
            }
        }

        private async void OnDisconnected(SteamClient.DisconnectedCallback callback)
        {
            await SendToClient(new { type = "status", message = "Disconnected from Steam" });
            await SendToClient(new { type = "disconnected", success = false });

            _isRunning = false;
            _authCompletionSource.TrySetResult(false);
        }

        // private void OnFriendsList(SteamFriends.FriendsListCallback callback)
        // {
        //     var friends = callback.FriendList;
        //     foreach (var friend in friends)
        //     {
        //         _steamFriends.RequestFriendInfo(friend.SteamID);
        //     }
        // }

        private async void OnLoggedOn(SteamUser.LoggedOnCallback callback)
        {
            if (callback.Result != EResult.OK)
            {
                await SendToClient(new
                {
                    type = "error",
                    message = $"Unable to log on to Steam: {callback.Result} / {callback.ExtendedResult}"
                });

                _authCompletionSource.SetResult(false);
                return;
            }

            _isLoggedIn = true;
            await SendToClient(new { type = "status", message = "Successfully logged on to Steam" });

            _steamFriends.SetPersonaState(EPersonaState.Online);

            var friendCount = _steamFriends.GetFriendCount();
            await SendToClient(new { type = "status", message = $"Requesting data for {friendCount} friends" });

            for (int i = 0; i < friendCount; i++)
            {
                var friendId = _steamFriends.GetFriendByIndex(i);
                _steamFriends.RequestFriendInfo(friendId);
            }

            if (callback.ClientSteamID != null)
                _accountInfoCache["steamId"] = callback.ClientSteamID.ConvertToUInt64();

            // Account info and persona state callbacks will be triggered automatically
        }

        private async void OnLoggedOff(SteamUser.LoggedOffCallback callback)
        {
            await SendToClient(new { type = "status", message = $"Logged off of Steam: {callback.Result}" });
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

        private void OnIsLimitedAccount(AccountLimitation.IsLimitedAccountCallback callback)
        {
            _accountInfoCache["isLocked"] = callback.Locked;
            _accountInfoCache["isBanned"] = callback.CommunityBanned;
            _accountInfoCache["isLimited"] = callback.Limited;
            _accountInfoCache["isAllowedToInviteFriends"] = callback.AllowedToInviteFriends;
        }

        private async void OnLicenseList(SteamApps.LicenseListCallback callback)
        {
            try
            {
                _isLoadingLibrary = true;
                await SendToClient(new { type = "status", message = $"Got {callback.LicenseList.Count} licenses for account!" });
                List<uint> packageIds = [];
                foreach (var license in callback.LicenseList)
                {
                    if ((license.LicenseFlags & ELicenseFlags.Expired) != 0)
                        continue;

                    packageIds.Add(license.PackageID);
                    if (license.AccessToken > 0)
                        PackageTokens.TryAdd(license.PackageID, license.AccessToken);
                }

                PackageIDs = new ReadOnlyCollection<uint>(packageIds);
                await RequestPackageInfo(packageIds);

                var requests = new List<SteamApps.PICSRequest>();
                var appids = new List<uint>();
                foreach (var package in PackageInfo.Values)
                {
                    ulong token = PackageTokens.GetValueOrDefault(package.ID);
                    foreach (var appid in package.KeyValues["appids"].Children)
                    {
                        var appidI = appid.AsUnsignedInteger();
                        if (appids.Contains(appidI)) continue;
                        var req = new SteamApps.PICSRequest(appidI, token);
                        requests.Add(req);
                        appids.Add(appidI);
                    }
                }

                await SendToClient(new { type = "status", message = $"Making requests for {requests.Count} apps" });
                try
                {
                    var result = await _steamApps.PICSGetProductInfo(requests, []);
                    if (result == null)
                    {
                        await SendToClient(new { type = "error", message = "Failed to get apps" });
                        return;
                    }

                    if (result.Complete)
                    {
                        if (result.Results == null || result.Results.Count == 0)
                        {
                            await SendToClient(new { type = "status", message = "No game results retrieved" });
                            return;
                        }

                        foreach (var resultItem in result.Results)
                        {
                            foreach (var app in resultItem.Apps)
                            {
                                AppInfo[app.Key] = app.Value;
                            }
                        }

                        await SendToClient(new { type = "status", message = $"Successfully retrieved {AppInfo.Count} games" });
                    }
                    else if (result.Failed)
                    {
                        await SendToClient(new { type = "status", message = "Some requests failed" });
                    }

                }
                catch (Exception exception)
                {
                    await SendToClient(new { type = "error", message = $"Error when getting product list for licenses: {exception.Message}" });
                }
                _isLoadingLibrary = false;
            }
            catch (TaskCanceledException)
            {
                await SendToClient(new { type = "error", message = "Task cancelled when loading library" });
            }
        }

        public async Task RequestPackageInfo(IEnumerable<uint> packageIds)
        {
            var packages = packageIds.ToList();
            packages.RemoveAll(PackageInfo.ContainsKey);

            if (packages.Count == 0)
                return;

            var packageRequests = new List<SteamApps.PICSRequest>();

            foreach (var package in packages)
            {
                var request = new SteamApps.PICSRequest(package);

                if (PackageTokens.TryGetValue(package, out var token))
                {
                    request.AccessToken = token;
                }

                packageRequests.Add(request);
            }

            var packageInfoMultiple = await _steamApps.PICSGetProductInfo([], packageRequests);

            foreach (var packageInfo in packageInfoMultiple.Results)
            {
                foreach (var package_value in packageInfo.Packages)
                {
                    var package = package_value.Value;
                    PackageInfo[package.ID] = package;
                }

                foreach (var package in packageInfo.UnknownPackages)
                {
                    PackageInfo[package] = null;
                }
            }
        }
        //TODO: Make this a lil bit cleaner
        private void OnPersonaState(SteamFriends.PersonaStateCallback callback)
        {
            //Our personal info
            if (callback.FriendID == _steamUser?.SteamID && callback.AvatarHash != null && _steamUser != null)
            {
                var avatarStr = BitConverter.ToString(callback.AvatarHash).Replace("-", "").ToLowerInvariant();
                var avatarUrl = $"https://avatars.akamai.steamstatic.com/{avatarStr}_full.jpg";

                _accountInfoCache["avatarUrl"] = avatarUrl;
                _accountInfoCache["username"] = _username;
                _accountInfoCache["personaName"] = callback.Name;
                _accountInfoCache["gameId"] = callback.GameID;
                _accountInfoCache["sourceSteamID"] = callback.SourceSteamID.ConvertToUInt64();
                _accountInfoCache["gamePlayingName"] = callback.GameName;
                _accountInfoCache["lastLogOn"] = callback.LastLogOn;
                _accountInfoCache["lastLogOff"] = callback.LastLogOff;

                // Signal that authentication is complete
                // await SendToClient(new { type = "login_success", message = "Successfully logged in and ready for queries" });
                // Authentication process is complete
                _authCompletionSource.TrySetResult(true);
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

        private async void SendChallengeUrl(string challengeUrl)
        {
            var challengeData = new
            {
                type = "challenge_url",
                url = challengeUrl,
                timestamp = DateTime.UtcNow
            };

            await SendToClient(challengeData);
        }

        public async Task ProcessClientQuery(string queryType)
        {
            if (!_isLoggedIn)
            {
                await SendToClient(new { type = "error", message = "Not logged in to Steam" });
                return;
            }

            switch (queryType.ToLower())
            {
                case "games":
                    await GetUserGames();
                    break;
                case "friends":
                    await GetUserFriends();
                    break;
                case "account_info":
                    GetUserAccountInfo();
                    break;
                default:
                    await SendToClient(new { type = "error", message = $"Unknown query type: {queryType}" });
                    break;
            }
        }

        private async void GetUserAccountInfo()
        {
            if (_accountInfoCache.Count == 0)
            {
                await SendToClient(new { type = "error", message = "Still loading your account information. Please wait..." });

                // Wait for library loading to complete (with timeout)
                int attempts = 0;
                while (_accountInfoCache.Count == 0 && attempts < 30)
                {
                    await Task.Delay(1000);
                    attempts++;
                }

                if (_accountInfoCache.Count == 0)
                {
                    await SendToClient(new { type = "error", message = "Timeout while loading account info" });
                    return;
                }
            }

            // Create a dynamic object with all cached account information
            var accountInfo = new Dictionary<string, object>(_accountInfoCache)
            {
                ["type"] = "account_info"
            };

            await SendToClient(accountInfo);
        }

        private async Task GetUserGames()
        {
            try
            {
                // Placeholder function for getting user games
                // You can implement your own logic here
                await SendToClient(new { type = "status", message = "Retrieving games list..." });

                if (_isLoadingLibrary)
                {
                    await SendToClient(new { type = "status", message = "Still loading your game library. Please wait..." });

                    // Wait for library loading to complete (with timeout)
                    int attempts = 0;
                    while (_isLoadingLibrary && attempts < 30)
                    {
                        await Task.Delay(1000);
                        attempts++;
                    }

                    if (_isLoadingLibrary)
                    {
                        await SendToClient(new { type = "error", message = "Timeout while loading game library" });
                        return;
                    }
                }

                if (AppInfo.Count == 0)
                {
                    await SendToClient(new { type = "status", message = "No games found in your library" });
                    await SendToClient(new
                    {
                        type = "games_result",
                        message = "Games list retrieved",
                        count = 0,
                        games = Array.Empty<object>()
                    });
                    return;
                }

                var gamesList = new List<Dictionary<string, object>>();

                foreach (var appInfo in AppInfo.Values)
                {
                    if (appInfo == null || appInfo.KeyValues == null)
                        continue;

                    // Create base dictionary with app ID
                    var gameData = new Dictionary<string, object>
                    {
                        ["appId"] = appInfo.ID,
                    };

                    // Convert the entire KeyValues to a dictionary structure
                    gameData["values"] = KeyValuesToDictionary(appInfo.KeyValues);

                    gamesList.Add(gameData);
                }

                gamesList = [.. gamesList.OrderBy(g => (uint)g["appId"])];

                await SendToClient(new
                {
                    type = "games_result",
                    message = "Games list retrieved",
                    count = gamesList.Count,
                    games = gamesList
                });

            }
            catch (Exception ex)
            {
                await SendToClient(new { type = "error", message = $"Error retrieving games: {ex.Message}" });
            }
        }

        private object KeyValuesToDictionary(KeyValue kv)
        {
            if (kv == null)
                return null;

            if (kv.Children.Count == 0)
            {
                return kv.Value;
            }

            var result = new Dictionary<string, object>();

            foreach (KeyValue child in kv.Children)
            {
                // Skip children without names
                if (string.IsNullOrEmpty(child.Name))
                    continue;

                // Convert each child recursively
                result[child.Name] = KeyValuesToDictionary(child);
            }

            return result;
        }

        private async Task GetUserFriends()
        {
            await SendToClient(new { type = "status", message = "Retrieving friends list..." });

            if (!_isLoggedIn)
            {
                await SendToClient(new { type = "error", message = "Not logged in to Steam" });
                return;
            }

            if (_steamFriends == null)
            {
                await SendToClient(new { type = "error", message = "Steam Friends handler is not available" });
                return;
            }

            if (FriendsInfo.IsEmpty)
            {
                await SendToClient(new { type = "status", message = "Still loading your friends list. Please wait..." });

                // Wait for friends loading to complete (with timeout)
                int attempts = 0;
                while (FriendsInfo.IsEmpty && attempts < 30)
                {
                    await Task.Delay(1000);
                    attempts++;
                }

                // if (FriendsInfo.IsEmpty)
                // {
                //     await SendToClient(new { type = "error", message = "Timeout while loading friends list" });
                //     return;
                // }
            }

            try
            {
                //If it is still empty, force request friend information
                if (FriendsInfo.IsEmpty)
                {
                    await SendToClient(new { type = "status", message = "Initializing friends data..." });

                    var _friendCount = _steamFriends.GetFriendCount();
                    for (int i = 0; i < _friendCount; i++)
                    {
                        var friendId = _steamFriends.GetFriendByIndex(i);
                        _steamFriends.RequestFriendInfo(friendId);
                    }

                    // Give some time for callbacks to process
                    await Task.Delay(2000);
                }

                // Build a comprehensive friends list from stored data
                var friendsList = new List<Dictionary<string, object>>();

                // Add all friends from the Steam API
                var friendCount = _steamFriends.GetFriendCount();
                for (int i = 0; i < friendCount; i++)
                {
                    var friendId = _steamFriends.GetFriendByIndex(i);
                    var steamId = friendId.ConvertToUInt64();

                    // Use existing data or create new entry
                    if (FriendsInfo.TryGetValue(steamId, out var existingInfo))
                    {
                        friendsList.Add(existingInfo);
                    }
                    else
                    {
                        // Create minimal info for friends we don't have detailed data for yet
                        var friendInfo = new Dictionary<string, object>
                        {
                            ["steamId"] = steamId,
                            ["name"] = _steamFriends.GetFriendPersonaName(friendId) ?? "Unknown",
                            ["relationshipState"] = _steamFriends.GetFriendRelationship(friendId).ToString()
                        };

                        friendsList.Add(friendInfo);
                    }
                }

                await SendToClient(new
                {
                    type = "friends_result",
                    message = "Friends list retrieved",
                    count = friendsList.Count,
                    friends = friendsList
                });

            }
            catch (Exception ex)
            {
                await SendToClient(new { type = "error", message = $"Error retrieving friends: {ex.Message}" });
            }
        }

        private async Task SendToClient(object data)
        {
            if (_clientSocket == null || !_clientSocket.Connected)
            {
                Console.WriteLine($"Error sending data to client - client socket is null or not connected.");
                return;
            }

            try
            {
                string jsonData = JsonSerializer.Serialize(data, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                });

                jsonData += "\n";
                byte[] responseBytes = Encoding.UTF8.GetBytes(jsonData);
                Console.WriteLine($"Sending data to client: {jsonData}");
                // Send the data to the client
                await _clientSocket.SendAsync(responseBytes, SocketFlags.None);
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
            Console.WriteLine("Stopping process...");
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

    public class LoginRequest
    {
        public required string Type { get; set; }
        public string? Username { get; set; }
        public string? RefreshToken { get; set; }
    }
}
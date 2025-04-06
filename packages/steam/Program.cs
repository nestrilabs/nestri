using System.Text;
using SteamSocketAuth;
using System.Text.Json;
using System.Net.Sockets;

namespace SteamSocketServer
{
    public class Program
    {
        private const string SocketPath = "/tmp/steam.sock";
        private static bool _isRunning = true;

        public static void Main()
        {
            // Cleanup previous socket file
            try { File.Delete(SocketPath); } catch { }

            // Create Unix domain socket endpoint
            var endpoint = new UnixDomainSocketEndPoint(SocketPath);
            using var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            
            listener.Bind(endpoint);
            listener.Listen(10); // Max pending connections
            Console.WriteLine("Steam Socket Server listening on " + SocketPath);

            // Handle Ctrl+C to gracefully shut down
            Console.CancelKeyPress += (sender, e) =>
            {
                _isRunning = false;
                listener.Close();
                Console.WriteLine("Server shutting down...");
            };

            while (_isRunning)
            {
                try
                {
                    var client = listener.Accept();
                    Console.WriteLine("Client connected.");
                    if (client != null)
                    {
                        ThreadPool.QueueUserWorkItem(async state => await HandleClient((Socket)state!), client);
                    }
                }
                catch (Exception ex) when (_isRunning)
                {
                    Console.WriteLine($"Error accepting client: {ex.Message}");
                }
            }
        }

        private static async Task HandleClient(Socket client)
        {
            var steamLoginComponent = new SteamLoginComponent();
            steamLoginComponent.SetClientSocket(client);

            try
            {
                byte[] buffer = new byte[4096];
                while (client.Connected)
                {
                    int bytesRead = await client.ReceiveAsync(buffer, SocketFlags.None);
                    if (bytesRead == 0)
                    {
                        // Client disconnected
                        Console.WriteLine("Client disconnected");
                        break;
                    }

                    string message = Encoding.UTF8.GetString(buffer, 0, bytesRead);
                    Console.WriteLine($"Received: {message}");

                    try
                    {
                        var request = JsonSerializer.Deserialize<JsonElement>(message);
                        if (request.TryGetProperty("type", out var typeElement))
                        {
                            string requestType = typeElement.GetString() ?? string.Empty;
                            
                            if (requestType == "login")
                            {
                                // Handle login request
                                var loginRequest = new LoginRequest { Type = "login" };

                                // Check if we have credentials for direct login
                                if (request.TryGetProperty("username", out var usernameElement) && 
                                    request.TryGetProperty("refreshToken", out var tokenElement))
                                {
                                    string username = usernameElement.GetString() ?? string.Empty;
                                    string refreshToken = tokenElement.GetString() ?? string.Empty;
                                    
                                    Console.WriteLine("Using provided credentials for user login.");
                                    steamLoginComponent.SetCredentials(username, refreshToken);
                                }
                                
                                // Begin login process
                                await steamLoginComponent.HandleLoginRequest(loginRequest);
                            }
                            else if (requestType == "disconnect")
                            {
                                // Client requested to disconnect
                                Console.WriteLine("Client requested disconnect");
                                steamLoginComponent.StopProcess();
                                break;
                            }
                        } else {
                             SendErrorResponse(client, "Missing request type");
                             Console.WriteLine($"Error parsing JSON: No request type found");
                        }
                    }
                    catch (JsonException ex)
                    {
                        Console.WriteLine($"Error parsing JSON: {ex.Message}");
                        SendErrorResponse(client, "Invalid JSON format");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Client error: {ex.Message}");
                SendErrorResponse(client, $"Error: {ex.Message}");
            }
            finally
            {
                steamLoginComponent.StopProcess();
                client.Close();
                Console.WriteLine("Client connection closed");
            }
        }

        private static void SendErrorResponse(Socket client, string errorMessage)
        {
            try
            {
                var errorResponse = new { type = "error", message = errorMessage };
                string jsonResponse = JsonSerializer.Serialize(errorResponse);
                byte[] responseBytes = Encoding.UTF8.GetBytes(jsonResponse);
                client.Send(responseBytes);
            }
            catch
            {
                // Ignore send errors on an already problematic connection
            }
        }
    }
}
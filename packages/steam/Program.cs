using Microsoft.AspNetCore.WebSockets;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;

namespace Steam
{
    public class Program
    {
        const string UnixSocketPath = "/tmp/steam.sock";
        private static readonly ConcurrentDictionary<string, WebSocket> _connectedClients = new();
        private static int _connectionCounter = 0;
        private static readonly CancellationTokenSource _broadcastCts = new();

        public static void Main(string[] args)
        {
            // Delete the socket file if it exists
            if (File.Exists(UnixSocketPath))
            {
                File.Delete(UnixSocketPath);
            }

            var builder = WebApplication.CreateBuilder(args);
            
            // Configure Kestrel to listen on Unix socket
            builder.WebHost.ConfigureKestrel(options =>
            {
                options.ListenUnixSocket(UnixSocketPath);
                
                // Set keep-alive timeout - this affects how long idle connections stay open
                options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(10);
                
                // Set request timeout
                options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(5);
            });

            builder.Services.AddControllers();
            builder.Services.AddWebSockets(options =>
            {
                // Configure WebSocket options
                options.KeepAliveInterval = TimeSpan.FromSeconds(30);
            });

            var app = builder.Build();

            // Configure endpoints
            app.UseWebSockets();
            
            // REST endpoints
            app.MapGet("/", () => "Real-time Unix Socket Server - Connect to /ws for WebSocket communication");
            
            // Long-running processing with progress updates endpoint
            app.MapGet("/api/longprocess", async (HttpResponse response) => 
            {
                response.Headers.Append("Content-Type", "text/event-stream");
                response.Headers.Append("Cache-Control", "no-cache");
                response.Headers.Append("Connection", "keep-alive");
                
                for (int i = 0; i <= 100; i += 10)
                {
                    await response.WriteAsync($"data: {{\"progress\": {i}}}\n\n");
                    await response.Body.FlushAsync();
                    await Task.Delay(1000); // Simulate work being done
                }
                
                await response.WriteAsync($"data: {{\"status\": \"completed\"}}\n\n");
                await response.Body.FlushAsync();
            });

            // WebSocket endpoint
            app.Use(async (context, next) =>
            {
                if (context.Request.Path == "/ws")
                {
                    if (context.WebSockets.IsWebSocketRequest)
                    {
                        string clientId = Interlocked.Increment(ref _connectionCounter).ToString();
                        using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
                        _connectedClients.TryAdd(clientId, webSocket);
                        
                        Console.WriteLine($"Client {clientId} connected");
                        
                        // Send welcome message
                        await SendMessageAsync(webSocket, $"Welcome! You are client #{clientId}");
                        
                        try
                        {
                            await HandleWebSocketConnection(clientId, webSocket);
                        }
                        finally
                        {
                            _connectedClients.TryRemove(clientId, out _);
                            Console.WriteLine($"Client {clientId} disconnected");
                        }
                    }
                    else
                    {
                        context.Response.StatusCode = 400;
                    }
                }
                else
                {
                    await next();
                }
            });

            // Start the background task that simulates real-time updates
            _ = StartPeriodicUpdatesAsync();

            Console.WriteLine($"Server starting on Unix socket: {UnixSocketPath}");
            Console.WriteLine("WebSocket endpoint available at /ws");
            Console.WriteLine("HTTP SSE endpoint available at /api/longprocess");
            
            app.Run();
            
            // Clean up
            _broadcastCts.Cancel();
        }

        private static async Task HandleWebSocketConnection(string clientId, WebSocket webSocket)
        {
            var buffer = new byte[1024 * 4];
            var receiveResult = await webSocket.ReceiveAsync(
                new ArraySegment<byte>(buffer), CancellationToken.None);

            while (!receiveResult.CloseStatus.HasValue)
            {
                // Echo received message back to client
                var receivedMessage = Encoding.UTF8.GetString(buffer, 0, receiveResult.Count);
                Console.WriteLine($"Message from client {clientId}: {receivedMessage}");
                
                // Echo back to sender
                await SendMessageAsync(webSocket, $"Echo: {receivedMessage}");
                
                // Broadcast to all other clients
                await BroadcastMessageAsync($"Client {clientId} says: {receivedMessage}", exceptClientId: clientId);

                // Get next message
                receiveResult = await webSocket.ReceiveAsync(
                    new ArraySegment<byte>(buffer), CancellationToken.None);
            }

            await webSocket.CloseAsync(
                receiveResult.CloseStatus.Value,
                receiveResult.CloseStatusDescription,
                CancellationToken.None);
        }

        private static async Task SendMessageAsync(WebSocket socket, string message)
        {
            var bytes = Encoding.UTF8.GetBytes(message);
            await socket.SendAsync(
                new ArraySegment<byte>(bytes, 0, bytes.Length),
                WebSocketMessageType.Text,
                true,
                CancellationToken.None);
        }

        private static async Task BroadcastMessageAsync(string message, string? exceptClientId = null)
        {
            foreach (var client in _connectedClients)
            {
                if (exceptClientId != null && client.Key == exceptClientId)
                    continue;
                    
                if (client.Value.State == WebSocketState.Open)
                {
                    try
                    {
                        await SendMessageAsync(client.Value, message);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error sending to client {client.Key}: {ex.Message}");
                        // In a production app, you'd handle this better
                    }
                }
            }
        }

        private static async Task StartPeriodicUpdatesAsync()
        {
            try
            {
                var random = new Random();
                while (!_broadcastCts.Token.IsCancellationRequested)
                {
                    // Simulate some dynamic data that changes frequently
                    var data = new
                    {
                        timestamp = DateTime.Now.ToString("HH:mm:ss"),
                        value = random.Next(1, 100),
                        connectedClients = _connectedClients.Count
                    };
                    
                    await BroadcastMessageAsync($"UPDATE: {System.Text.Json.JsonSerializer.Serialize(data)}");
                    
                    // Wait before next update (5 seconds)
                    await Task.Delay(5000, _broadcastCts.Token);
                }
            }
            catch (OperationCanceledException)
            {
                // Normal cancellation, ignore
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error in periodic updates: {ex.Message}");
            }
        }
    }
}
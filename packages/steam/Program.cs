// UnixSocketServer.cs
using System;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public class UnixSocketServer
{
    private const string SocketPath = "/tmp/steam.sock";
    private static bool _isRunning = true;

    public static void Main()
    {
        // Cleanup previous socket file
        try { System.IO.File.Delete(SocketPath); } catch { }

        // Create Unix domain socket endpoint
        var endpoint = new UnixDomainSocketEndPoint(SocketPath);
        using (var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified))
        {
            listener.Bind(endpoint);
            listener.Listen(10); // Max pending connections
            Console.WriteLine("Steam Server listening...");

            // Handle Ctrl+C to gracefully shut down
            Console.CancelKeyPress += (sender, e) =>
            {
                _isRunning = false;
                listener.Close();
                Console.WriteLine("Server shutting down...");
            };

            while (_isRunning)
            {
                var client = listener.Accept();
                Console.WriteLine("Client connected.");
                ThreadPool.QueueUserWorkItem(HandleClient, client);
            }
        }
    }

    private static void HandleClient(object? obj)
    {
        if (obj is not Socket client) return;

        try
        {
            byte[] buffer = new byte[1024];
            while (true)
            {
                int bytesRead = client.Receive(buffer);
                if (bytesRead == 0)
                {
                    // Client disconnected
                    Console.WriteLine("Client disconnected");
                    break;
                }

                string message = Encoding.UTF8.GetString(buffer, 0, bytesRead);
                Console.WriteLine($"Received: {message}");

                // Process data (e.g., simulate work)
                string response = $"Processed: {message.ToUpper()}";
                byte[] responseBytes = Encoding.UTF8.GetBytes(response);
                client.Send(responseBytes);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Client error: {ex.Message}");
        }
        finally
        {
            client.Close();
        }
    }
}

using System.Text;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => "Hello World!");

app.MapGet("/server", async context =>
{
    context.Response.Headers.Append("Content-Type", "text/event-stream");
    context.Response.Headers.Append("Cache-Control", "no-cache");
    context.Response.Headers.Append("Connection", "keep-alive");
    context.Response.Headers.Append("Access-Control-Allow-Origin", "*");

    var responseBodyFeature = context.Features.Get<IHttpResponseBodyFeature>();
    if (responseBodyFeature != null)
    {
        responseBodyFeature.DisableBuffering();
    }

    int eventId = 0;
    var cancellationToken = context.RequestAborted;

    while (!cancellationToken.IsCancellationRequested)
    {
        string data = $"Message from server: {DateTime.Now}";
        string eventMessage = $"id: {eventId}\ndata: {data}\n\n";
        byte[] buffer = Encoding.UTF8.GetBytes(eventMessage);

        await context.Response.Body.WriteAsync(buffer, 0, buffer.Length, cancellationToken);
        await context.Response.Body.FlushAsync(cancellationToken);

        eventId++;
        Console.WriteLine($"Sent event #{eventId}: {data}");

        // Wait before sending the next event
        await Task.Delay(3000, cancellationToken);
    }

});

Console.WriteLine("Server started. Press Ctrl+C to stop.");
await app.RunAsync();

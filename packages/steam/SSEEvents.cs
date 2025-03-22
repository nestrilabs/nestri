using System.Text.Json;

public class ServerSentEvent
{
    public string Type { get; set; }
    public object Data { get; set; }

    public ServerSentEvent(string type, object data)
    {
        Type = type;
        Data = data;
    }

    public string Serialize()
    {
        var dataJson = JsonSerializer.Serialize(Data);
        return $"event: {Type}\ndata: {dataJson}\n\n";
    }
}
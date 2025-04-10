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
        string dataString;
        if (Data is string stringData)
        {
            dataString = stringData;
        }
        else
        {
            dataString = JsonSerializer.Serialize(Data);
        }

        return $"event: {Type}\ndata: {dataString}\n\n";
    }
}
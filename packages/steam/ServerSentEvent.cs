using System.Text.Json;

namespace Steam
{
    public class ServerSentEvent
    {
        public string Type { get; }
        public object Data { get; }

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
}
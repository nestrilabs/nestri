using SteamKit2;

public class SteamConfig
{
    public static SteamConfiguration GetDefaultSteamClientConfig()
    {
        return SteamConfiguration.Create(config =>
           {
               config.WithConnectionTimeout(TimeSpan.FromSeconds(30));
               config.WithProtocolTypes(ProtocolTypes.Tcp | ProtocolTypes.WebSocket);
           }
        );
    }
}
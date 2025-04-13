using System.Text;

namespace Steam;

/// <summary>
/// Provides information about the machine that the application is running on.
/// For Steam Guard purposes, these values must return consistent results when run
/// on the same machine / in the same container / etc., otherwise it will be treated
/// as a separate machine and you may need to reauthenticate.
/// </summary>
public class IMachineInfoProvider : SteamKit2.IMachineInfoProvider
{
    /// <summary>
    /// Provides a unique machine ID as binary data.
    /// </summary>
    /// <returns>The unique machine ID, or <c>null</c> if no such value could be found.</returns>
    public byte[]? GetMachineGuid() => Encoding.UTF8.GetBytes("Nestri-Machine");
    /// <summary>
    /// Provides the primary MAC address as binary data.
    /// </summary>
    /// <returns>The primary MAC address, or <c>null</c> if no such value could be found.</returns>
    public byte[]? GetMacAddress() => Encoding.UTF8.GetBytes("Nestri-MacAddress");
    /// <summary>
    /// Provides the boot disk's unique ID as binary data.
    /// </summary>
    /// <returns>The boot disk's unique ID, or <c>null</c> if no such value could be found.</returns>
    public byte[]? GetDiskId() => Encoding.UTF8.GetBytes("Nestri-DiskId");
}
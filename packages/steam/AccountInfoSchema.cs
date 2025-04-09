public class SteamAccountInfo
{
    public int Id { get; set; }
    public required string UserId { get; set; }
    public string? Username { get; set; }
    public ulong? SteamId { get; set; }
    public string? Email { get; set; }
    public string? Country { get; set; }
    public string? PersonaName { get; set; }
    public bool? IsLocked { get; set; }
    public bool? IsBanned { get; set; }
    public bool? IsLimited { get; set; }
    public bool? IsAllowedToInviteFriends { get; set; }
    public string? AvatarUrl { get; set; }
    public ulong? GameId { get; set; }
    public ulong? SourceSteamId { get; set; }
    public string? GamePlayingName { get; set; }
    public DateTime? LastLogOn { get; set; }
    public DateTime? LastLogOff { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
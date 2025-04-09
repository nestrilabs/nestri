public class SteamUserCredentials
{
    public int Id { get; set; }  // Keep as primary key
    public required string UserId { get; set; }
    public required string AccountName { get; set; }
    public required string RefreshToken { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;   
}
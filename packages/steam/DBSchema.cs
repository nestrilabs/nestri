public class SteamUserCredential
{
    public int Id { get; set; }
    public required string TeamId { get; set; }
    public required string UserId { get; set; }
    public required string AccountName { get; set; }
    public required string RefreshToken { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    
    // Composite key of TeamId and UserId will be unique
}
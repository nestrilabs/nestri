using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

namespace Steam
{
    // Database context
    public class SteamDbContext : DbContext
    {
        public SteamDbContext(DbContextOptions<SteamDbContext> options) : base(options) { }

        public DbSet<SteamUserCredentials> SteamUserCredentials { get; set; }
        public DbSet<SteamAccountInfo> SteamAccountInfo { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<SteamUserCredentials>()
                .HasKey(c => c.UserId);

            modelBuilder.Entity<SteamAccountInfo>()
                .HasKey(c => c.UserId);
        }
    }

    // User credentials model
    public class SteamUserCredentials
    {
        [Key]
        public string UserId { get; set; } = string.Empty;
        public string AccountName { get; set; } = string.Empty;
        public string RefreshToken { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    // Account info model
    public class SteamAccountInfo
    {
        [Key]
        public string UserId { get; set; } = string.Empty;
        public string Username { get; set; } = string.Empty;
        public ulong SteamId { get; set; }
        public string Email { get; set; } = string.Empty;
        public string Country { get; set; } = string.Empty;
        public string PersonaName { get; set; } = string.Empty;
        public string AvatarUrl { get; set; } = string.Empty;
        public bool IsLimited { get; set; }
        public bool IsLocked { get; set; }
        public bool IsBanned { get; set; }
        public bool IsAllowedToInviteFriends { get; set; }
        public ulong GameId { get; set; }
        public string GamePlayingName { get; set; } = string.Empty;
        public DateTime LastLogOn { get; set; }
        public DateTime LastLogOff { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
using Microsoft.EntityFrameworkCore;

public class SteamDbContext : DbContext
{
    public DbSet<SteamUserCredentials> SteamUserCredentials { get; set; }
    public DbSet<SteamAccountInfo> SteamAccountInfo { get; set; }

    public SteamDbContext(DbContextOptions<SteamDbContext> options) : base(options)
    {
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Create a unique index on TeamId and UserId
        modelBuilder.Entity<SteamUserCredentials>()
            .HasIndex(c => new { c.UserId })
            .IsUnique();

        modelBuilder.Entity<SteamAccountInfo>()
            .HasIndex(c => new { c.UserId })
            .IsUnique();
    }
}
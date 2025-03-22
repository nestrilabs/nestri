using Microsoft.EntityFrameworkCore;

public class SteamDbContext : DbContext
{
    public DbSet<SteamUserCredential> SteamUserCredentials { get; set; }
    
    public SteamDbContext(DbContextOptions<SteamDbContext> options) : base(options)
    {
    }
    
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Create a unique index on TeamId and UserId
        modelBuilder.Entity<SteamUserCredential>()
            .HasIndex(c => new { c.TeamId, c.UserId })
            .IsUnique();
    }
}
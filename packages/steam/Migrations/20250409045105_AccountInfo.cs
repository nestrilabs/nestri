using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace steam.Migrations
{
    /// <inheritdoc />
    public partial class AccountInfo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SteamAccountInfo",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<string>(type: "TEXT", nullable: false),
                    Username = table.Column<string>(type: "TEXT", nullable: true),
                    SteamId = table.Column<ulong>(type: "INTEGER", nullable: true),
                    Email = table.Column<string>(type: "TEXT", nullable: true),
                    Country = table.Column<string>(type: "TEXT", nullable: true),
                    PersonaName = table.Column<string>(type: "TEXT", nullable: true),
                    IsLocked = table.Column<bool>(type: "INTEGER", nullable: true),
                    IsBanned = table.Column<bool>(type: "INTEGER", nullable: true),
                    IsLimited = table.Column<bool>(type: "INTEGER", nullable: true),
                    IsAllowedToInviteFriends = table.Column<bool>(type: "INTEGER", nullable: true),
                    AvatarUrl = table.Column<string>(type: "TEXT", nullable: true),
                    GameId = table.Column<ulong>(type: "INTEGER", nullable: true),
                    SourceSteamId = table.Column<ulong>(type: "INTEGER", nullable: true),
                    GamePlayingName = table.Column<string>(type: "TEXT", nullable: true),
                    LastLogOn = table.Column<DateTime>(type: "TEXT", nullable: true),
                    LastLogOff = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SteamAccountInfo", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SteamAccountInfo_UserId",
                table: "SteamAccountInfo",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SteamAccountInfo");
        }
    }
}

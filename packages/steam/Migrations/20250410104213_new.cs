using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace steam.Migrations
{
    /// <inheritdoc />
    public partial class @new : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_SteamUserCredentials",
                table: "SteamUserCredentials");

            migrationBuilder.DropIndex(
                name: "IX_SteamUserCredentials_UserId",
                table: "SteamUserCredentials");

            migrationBuilder.DropPrimaryKey(
                name: "PK_SteamAccountInfo",
                table: "SteamAccountInfo");

            migrationBuilder.DropIndex(
                name: "IX_SteamAccountInfo_UserId",
                table: "SteamAccountInfo");

            migrationBuilder.DropColumn(
                name: "Id",
                table: "SteamUserCredentials");

            migrationBuilder.DropColumn(
                name: "Id",
                table: "SteamAccountInfo");

            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "SteamAccountInfo");

            migrationBuilder.DropColumn(
                name: "SourceSteamId",
                table: "SteamAccountInfo");

            migrationBuilder.AlterColumn<string>(
                name: "Username",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AlterColumn<ulong>(
                name: "SteamId",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0ul,
                oldClrType: typeof(ulong),
                oldType: "INTEGER",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "PersonaName",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AlterColumn<DateTime>(
                name: "LastLogOn",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified),
                oldClrType: typeof(DateTime),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AlterColumn<DateTime>(
                name: "LastLogOff",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified),
                oldClrType: typeof(DateTime),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AlterColumn<bool>(
                name: "IsLocked",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: false,
                defaultValue: false,
                oldClrType: typeof(bool),
                oldType: "INTEGER",
                oldNullable: true);

            migrationBuilder.AlterColumn<bool>(
                name: "IsLimited",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: false,
                defaultValue: false,
                oldClrType: typeof(bool),
                oldType: "INTEGER",
                oldNullable: true);

            migrationBuilder.AlterColumn<bool>(
                name: "IsBanned",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: false,
                defaultValue: false,
                oldClrType: typeof(bool),
                oldType: "INTEGER",
                oldNullable: true);

            migrationBuilder.AlterColumn<bool>(
                name: "IsAllowedToInviteFriends",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: false,
                defaultValue: false,
                oldClrType: typeof(bool),
                oldType: "INTEGER",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "GamePlayingName",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AlterColumn<ulong>(
                name: "GameId",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0ul,
                oldClrType: typeof(ulong),
                oldType: "INTEGER",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Email",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Country",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "AvatarUrl",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldNullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "PK_SteamUserCredentials",
                table: "SteamUserCredentials",
                column: "UserId");

            migrationBuilder.AddPrimaryKey(
                name: "PK_SteamAccountInfo",
                table: "SteamAccountInfo",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_SteamUserCredentials",
                table: "SteamUserCredentials");

            migrationBuilder.DropPrimaryKey(
                name: "PK_SteamAccountInfo",
                table: "SteamAccountInfo");

            migrationBuilder.AddColumn<int>(
                name: "Id",
                table: "SteamUserCredentials",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0)
                .Annotation("Sqlite:Autoincrement", true);

            migrationBuilder.AlterColumn<string>(
                name: "Username",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<ulong>(
                name: "SteamId",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: true,
                oldClrType: typeof(ulong),
                oldType: "INTEGER");

            migrationBuilder.AlterColumn<string>(
                name: "PersonaName",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<DateTime>(
                name: "LastLogOn",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(DateTime),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<DateTime>(
                name: "LastLogOff",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(DateTime),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<bool>(
                name: "IsLocked",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: true,
                oldClrType: typeof(bool),
                oldType: "INTEGER");

            migrationBuilder.AlterColumn<bool>(
                name: "IsLimited",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: true,
                oldClrType: typeof(bool),
                oldType: "INTEGER");

            migrationBuilder.AlterColumn<bool>(
                name: "IsBanned",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: true,
                oldClrType: typeof(bool),
                oldType: "INTEGER");

            migrationBuilder.AlterColumn<bool>(
                name: "IsAllowedToInviteFriends",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: true,
                oldClrType: typeof(bool),
                oldType: "INTEGER");

            migrationBuilder.AlterColumn<string>(
                name: "GamePlayingName",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<ulong>(
                name: "GameId",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: true,
                oldClrType: typeof(ulong),
                oldType: "INTEGER");

            migrationBuilder.AlterColumn<string>(
                name: "Email",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<string>(
                name: "Country",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT");

            migrationBuilder.AlterColumn<string>(
                name: "AvatarUrl",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT");

            migrationBuilder.AddColumn<int>(
                name: "Id",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0)
                .Annotation("Sqlite:Autoincrement", true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "SteamAccountInfo",
                type: "TEXT",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<ulong>(
                name: "SourceSteamId",
                table: "SteamAccountInfo",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "PK_SteamUserCredentials",
                table: "SteamUserCredentials",
                column: "Id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_SteamAccountInfo",
                table: "SteamAccountInfo",
                column: "Id");

            migrationBuilder.CreateIndex(
                name: "IX_SteamUserCredentials_UserId",
                table: "SteamUserCredentials",
                column: "UserId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SteamAccountInfo_UserId",
                table: "SteamAccountInfo",
                column: "UserId",
                unique: true);
        }
    }
}

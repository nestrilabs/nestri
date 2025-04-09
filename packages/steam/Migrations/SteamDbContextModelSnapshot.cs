﻿// <auto-generated />
using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

#nullable disable

namespace steam.Migrations
{
    [DbContext(typeof(SteamDbContext))]
    partial class SteamDbContextModelSnapshot : ModelSnapshot
    {
        protected override void BuildModel(ModelBuilder modelBuilder)
        {
#pragma warning disable 612, 618
            modelBuilder.HasAnnotation("ProductVersion", "9.0.3");

            modelBuilder.Entity("SteamAccountInfo", b =>
                {
                    b.Property<int>("Id")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("INTEGER");

                    b.Property<string>("AvatarUrl")
                        .HasColumnType("TEXT");

                    b.Property<string>("Country")
                        .HasColumnType("TEXT");

                    b.Property<DateTime>("CreatedAt")
                        .HasColumnType("TEXT");

                    b.Property<string>("Email")
                        .HasColumnType("TEXT");

                    b.Property<ulong?>("GameId")
                        .HasColumnType("INTEGER");

                    b.Property<string>("GamePlayingName")
                        .HasColumnType("TEXT");

                    b.Property<bool?>("IsAllowedToInviteFriends")
                        .HasColumnType("INTEGER");

                    b.Property<bool?>("IsBanned")
                        .HasColumnType("INTEGER");

                    b.Property<bool?>("IsLimited")
                        .HasColumnType("INTEGER");

                    b.Property<bool?>("IsLocked")
                        .HasColumnType("INTEGER");

                    b.Property<DateTime?>("LastLogOff")
                        .HasColumnType("TEXT");

                    b.Property<DateTime?>("LastLogOn")
                        .HasColumnType("TEXT");

                    b.Property<string>("PersonaName")
                        .HasColumnType("TEXT");

                    b.Property<ulong?>("SourceSteamId")
                        .HasColumnType("INTEGER");

                    b.Property<ulong?>("SteamId")
                        .HasColumnType("INTEGER");

                    b.Property<DateTime>("UpdatedAt")
                        .HasColumnType("TEXT");

                    b.Property<string>("UserId")
                        .IsRequired()
                        .HasColumnType("TEXT");

                    b.Property<string>("Username")
                        .HasColumnType("TEXT");

                    b.HasKey("Id");

                    b.HasIndex("UserId")
                        .IsUnique();

                    b.ToTable("SteamAccountInfo");
                });

            modelBuilder.Entity("SteamUserCredentials", b =>
                {
                    b.Property<int>("Id")
                        .ValueGeneratedOnAdd()
                        .HasColumnType("INTEGER");

                    b.Property<string>("AccountName")
                        .IsRequired()
                        .HasColumnType("TEXT");

                    b.Property<DateTime>("CreatedAt")
                        .HasColumnType("TEXT");

                    b.Property<string>("RefreshToken")
                        .IsRequired()
                        .HasColumnType("TEXT");

                    b.Property<DateTime>("UpdatedAt")
                        .HasColumnType("TEXT");

                    b.Property<string>("UserId")
                        .IsRequired()
                        .HasColumnType("TEXT");

                    b.HasKey("Id");

                    b.HasIndex("UserId")
                        .IsUnique();

                    b.ToTable("SteamUserCredentials");
                });
#pragma warning restore 612, 618
        }
    }
}

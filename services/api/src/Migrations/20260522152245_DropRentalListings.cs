using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    /// <inheritdoc />
    public partial class DropRentalListings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RentalListings");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RentalListings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    OwnerId = table.Column<int>(type: "INTEGER", nullable: false),
                    Address = table.Column<string>(type: "TEXT", nullable: false),
                    Area = table.Column<decimal>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Description = table.Column<string>(type: "TEXT", nullable: false),
                    Floor = table.Column<string>(type: "TEXT", nullable: false),
                    Images = table.Column<string>(type: "TEXT", nullable: false),
                    Location = table.Column<string>(type: "TEXT", nullable: false),
                    Price = table.Column<decimal>(type: "TEXT", nullable: false),
                    RentalType = table.Column<string>(type: "TEXT", nullable: false),
                    Rooms = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false),
                    Title = table.Column<string>(type: "TEXT", nullable: false),
                    Toward = table.Column<string>(type: "TEXT", nullable: false),
                    ViewCount = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RentalListings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RentalListings_Users_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RentalListings_CreatedAt",
                table: "RentalListings",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_RentalListings_OwnerId",
                table: "RentalListings",
                column: "OwnerId");

            migrationBuilder.CreateIndex(
                name: "IX_RentalListings_RentalType",
                table: "RentalListings",
                column: "RentalType");

            migrationBuilder.CreateIndex(
                name: "IX_RentalListings_Status",
                table: "RentalListings",
                column: "Status");
        }
    }
}

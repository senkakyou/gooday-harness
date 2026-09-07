using System;
using GoodayTools.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    // 手写迁移：本环境无 dotnet ef CLI。属性让运行时 MigrateAsync 能发现并应用本迁移。
    [DbContext(typeof(AppDbContext))]
    [Migration("20260523000001_AddToolFavorites")]
    public partial class AddToolFavorites : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ToolFavorites",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(type: "INTEGER", nullable: false),
                    ToolId = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ToolFavorites", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ToolFavorites_UserId",
                table: "ToolFavorites",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_ToolFavorites_UserId_ToolId",
                table: "ToolFavorites",
                columns: new[] { "UserId", "ToolId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ToolFavorites");
        }
    }
}

using GoodayTools.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260529000002_AddNotifications")]
    public partial class AddNotifications : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Notifications",
                columns: table => new {
                    Id = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(nullable: false),
                    Type = table.Column<string>(nullable: false, defaultValue: "system"),
                    Title = table.Column<string>(nullable: false, defaultValue: ""),
                    Body = table.Column<string>(nullable: false, defaultValue: ""),
                    LinkUrl = table.Column<string>(nullable: true),
                    IsRead = table.Column<bool>(nullable: false, defaultValue: false),
                    ReadAt = table.Column<DateTime>(nullable: true),
                    CreatedAt = table.Column<DateTime>(nullable: false, defaultValue: new DateTime(2026, 1, 1))
                },
                constraints: table => {
                    table.PrimaryKey("PK_Notifications", x => x.Id);
                    table.ForeignKey("FK_Notifications_Users_UserId", x => x.UserId, "Users", "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex("IX_Notifications_UserId_IsRead", "Notifications", new[] { "UserId", "IsRead" });
            migrationBuilder.CreateIndex("IX_Notifications_UserId_CreatedAt", "Notifications", new[] { "UserId", "CreatedAt" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable("Notifications");
        }
    }
}

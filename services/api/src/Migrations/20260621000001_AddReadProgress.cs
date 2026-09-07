using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260621000001_AddReadProgress")]
    public partial class AddReadProgress : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 听书加文字版 EPUB 字段
            migrationBuilder.AddColumn<string>(
                name: "EpubUrl", table: "Audiobooks", type: "TEXT", nullable: false, defaultValue: "");

            // 阅读进度表
            migrationBuilder.CreateTable(
                name: "ReadProgresses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId      = table.Column<int>(type: "INTEGER", nullable: false),
                    AudiobookId = table.Column<int>(type: "INTEGER", nullable: false),
                    Cfi         = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    Percent     = table.Column<double>(type: "REAL", nullable: false, defaultValue: 0.0),
                    UpdatedAt   = table.Column<DateTime>(type: "TEXT", nullable: false),
                },
                constraints: table => { table.PrimaryKey("PK_ReadProgresses", x => x.Id); });

            migrationBuilder.CreateIndex(
                name: "IX_ReadProgresses_UserId_AudiobookId",
                table: "ReadProgresses",
                columns: new[] { "UserId", "AudiobookId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReadProgresses_UserId_UpdatedAt",
                table: "ReadProgresses",
                columns: new[] { "UserId", "UpdatedAt" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "ReadProgresses");
            migrationBuilder.DropColumn(name: "EpubUrl", table: "Audiobooks");
        }
    }
}

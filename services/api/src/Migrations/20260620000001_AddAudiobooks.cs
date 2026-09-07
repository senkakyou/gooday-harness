using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260620000001_AddAudiobooks")]
    public partial class AddAudiobooks : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 书库
            migrationBuilder.CreateTable(
                name: "Audiobooks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Title       = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    Author      = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    Narrator    = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    CoverUrl    = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    Category    = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "其他"),
                    Description = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    IsPublished = table.Column<bool>(type: "INTEGER", nullable: false, defaultValue: true),
                    PlayCount   = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 0),
                    OrderNo     = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 0),
                    CreatedAt   = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt   = table.Column<DateTime>(type: "TEXT", nullable: true),
                },
                constraints: table => { table.PrimaryKey("PK_Audiobooks", x => x.Id); });

            // 章节（音频/视频·上传/外链）
            migrationBuilder.CreateTable(
                name: "AudiobookChapters",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    AudiobookId = table.Column<int>(type: "INTEGER", nullable: false),
                    Title       = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    MediaType   = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "audio"),
                    MediaUrl    = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    Source      = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "link"),
                    Duration    = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 0),
                    OrderNo     = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 0),
                    CreatedAt   = table.Column<DateTime>(type: "TEXT", nullable: false),
                },
                constraints: table => { table.PrimaryKey("PK_AudiobookChapters", x => x.Id); });

            // 续播进度
            migrationBuilder.CreateTable(
                name: "ListenProgresses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    UserId      = table.Column<int>(type: "INTEGER", nullable: false),
                    AudiobookId = table.Column<int>(type: "INTEGER", nullable: false),
                    ChapterId   = table.Column<int>(type: "INTEGER", nullable: false),
                    PositionSec = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 0),
                    Finished    = table.Column<bool>(type: "INTEGER", nullable: false, defaultValue: false),
                    UpdatedAt   = table.Column<DateTime>(type: "TEXT", nullable: false),
                },
                constraints: table => { table.PrimaryKey("PK_ListenProgresses", x => x.Id); });

            migrationBuilder.CreateIndex(
                name: "IX_AudiobookChapters_AudiobookId_OrderNo",
                table: "AudiobookChapters",
                columns: new[] { "AudiobookId", "OrderNo" });

            migrationBuilder.CreateIndex(
                name: "IX_ListenProgresses_UserId_ChapterId",
                table: "ListenProgresses",
                columns: new[] { "UserId", "ChapterId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ListenProgresses_UserId_UpdatedAt",
                table: "ListenProgresses",
                columns: new[] { "UserId", "UpdatedAt" });
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "ListenProgresses");
            migrationBuilder.DropTable(name: "AudiobookChapters");
            migrationBuilder.DropTable(name: "Audiobooks");
        }
    }
}

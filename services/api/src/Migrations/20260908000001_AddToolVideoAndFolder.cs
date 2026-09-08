using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260908000001_AddToolVideoAndFolder")]
    public partial class AddToolVideoAndFolder : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---- 工具的第三条动线：视频讲解 ----
            // VideoUrl 非空 = 有讲解。只有一个字段能判定，所以不存在
            // 「勾了没传 / 传了没勾」这种前台白按一次的状态（HasDownload 那对字段的老毛病）。
            migrationBuilder.AddColumn<string>(
                name: "VideoUrl", table: "Tools", type: "TEXT", nullable: true);
            migrationBuilder.AddColumn<string>(
                name: "VideoSource", table: "Tools", type: "TEXT",
                nullable: false, defaultValue: "upload");   // upload=站内文件 / link=外链
            migrationBuilder.AddColumn<int>(
                name: "VideoDuration", table: "Tools", type: "INTEGER",
                nullable: false, defaultValue: 0);
            migrationBuilder.AddColumn<int>(
                name: "VideoPlayCount", table: "Tools", type: "INTEGER",
                nullable: false, defaultValue: 0);

            // ---- 一工具一文件夹 ----
            // 只是「新文件默认落哪 + 后台按工具分组」的依据；真实路径仍完整存在
            // OnlineUrl/DownloadFileName/VideoUrl 里，不靠它拼。
            migrationBuilder.AddColumn<string>(
                name: "Folder", table: "Tools", type: "TEXT", nullable: true);

            // ---- 文件搬家后的旧链接兜底 ----
            // 站内引用由 RewriteReferencesAsync 自动改写，站外的（收藏夹、别处贴的链接、
            // 搜索引擎）改不了，没有这张表它们搬家后就是死链。
            migrationBuilder.CreateTable(
                name: "UploadRedirects",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    OldPath = table.Column<string>(type: "TEXT", nullable: false),
                    NewPath = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UploadRedirects", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_UploadRedirects_OldPath",
                table: "UploadRedirects", column: "OldPath", unique: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "UploadRedirects");
            migrationBuilder.DropColumn(name: "Folder", table: "Tools");
            migrationBuilder.DropColumn(name: "VideoPlayCount", table: "Tools");
            migrationBuilder.DropColumn(name: "VideoDuration", table: "Tools");
            migrationBuilder.DropColumn(name: "VideoSource", table: "Tools");
            migrationBuilder.DropColumn(name: "VideoUrl", table: "Tools");
        }
    }
}

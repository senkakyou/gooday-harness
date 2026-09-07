using GoodayTools.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    // 手写迁移：本环境无 dotnet ef CLI。属性让运行时 MigrateAsync 能发现并应用本迁移。
    [DbContext(typeof(AppDbContext))]
    [Migration("20260524000001_AddSecondhandOriginalPrice")]
    public partial class AddSecondhandOriginalPrice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "OriginalPrice",
                table: "SecondhandItems",
                type: "REAL",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OriginalPrice",
                table: "SecondhandItems");
        }
    }
}

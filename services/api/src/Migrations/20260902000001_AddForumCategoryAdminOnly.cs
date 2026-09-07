using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260902000001_AddForumCategoryAdminOnly")]
    public partial class AddForumCategoryAdminOnly : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 板块「仅管理员可见」开关。
            // 与 IsVisible 的区别：IsVisible=false 只是不列出来，知道链接照样能读；
            // AdminOnly=true 是访问控制，板块/帖子/回复/点赞对非管理员一律 404。
            migrationBuilder.AddColumn<bool>(
                name: "AdminOnly", table: "ForumCategories", type: "INTEGER",
                nullable: false, defaultValue: false);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "AdminOnly", table: "ForumCategories");
        }
    }
}

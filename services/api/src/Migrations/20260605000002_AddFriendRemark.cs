using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260605000002_AddFriendRemark")]
    public partial class AddFriendRemark : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RequesterRemark",
                table: "Friendships",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AddresseeRemark",
                table: "Friendships",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "RequesterRemark", table: "Friendships");
            migrationBuilder.DropColumn(name: "AddresseeRemark", table: "Friendships");
        }
    }
}

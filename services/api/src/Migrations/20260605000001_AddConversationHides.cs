using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260605000001_AddConversationHides")]
    public partial class AddConversationHides : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ConversationHides",
                columns: table => new
                {
                    Id         = table.Column<long>(nullable: false)
                                    .Annotation("Sqlite:Autoincrement", true),
                    UserId     = table.Column<int>(nullable: false),
                    OtherUserId = table.Column<int>(nullable: false),
                },
                constraints: table => table.PrimaryKey("PK_ConversationHides", x => x.Id));

            migrationBuilder.CreateIndex(
                name: "IX_ConversationHides_UserId_OtherUserId",
                table: "ConversationHides",
                columns: new[] { "UserId", "OtherUserId" },
                unique: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "ConversationHides");
        }
    }
}

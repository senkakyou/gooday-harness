using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260604000001_AddAccessLogs")]
    public partial class AddAccessLogs : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AccessLogs",
                columns: table => new
                {
                    Id         = table.Column<long>(nullable: false)
                                    .Annotation("Sqlite:Autoincrement", true),
                    Path       = table.Column<string>(nullable: false, defaultValue: ""),
                    Method     = table.Column<string>(nullable: false, defaultValue: ""),
                    Ip         = table.Column<string>(nullable: false, defaultValue: ""),
                    UserId     = table.Column<int>(nullable: true),
                    Username   = table.Column<string>(nullable: true),
                    StatusCode = table.Column<int>(nullable: false),
                    DurationMs = table.Column<int>(nullable: false),
                    UserAgent  = table.Column<string>(nullable: true),
                    CreatedAt  = table.Column<string>(nullable: false, defaultValue: "")
                },
                constraints: table => table.PrimaryKey("PK_AccessLogs", x => x.Id));

            migrationBuilder.CreateIndex("IX_AccessLogs_CreatedAt", "AccessLogs", "CreatedAt");
            migrationBuilder.CreateIndex("IX_AccessLogs_Ip",        "AccessLogs", "Ip");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "AccessLogs");
        }
    }
}

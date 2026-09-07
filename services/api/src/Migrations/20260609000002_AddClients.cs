using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260609000002_AddClients")]
    public partial class AddClients : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Clients",
                columns: table => new
                {
                    Id                   = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    UserId               = table.Column<int>(nullable: true),
                    Name                 = table.Column<string>(nullable: false, defaultValue: ""),
                    Contact              = table.Column<string>(nullable: false, defaultValue: ""),
                    ContactType          = table.Column<string>(nullable: false, defaultValue: "wechat"),
                    Source               = table.Column<string>(nullable: false, defaultValue: "admin"),
                    Status               = table.Column<string>(nullable: false, defaultValue: "prospect"),
                    Tags                 = table.Column<string>(nullable: true),
                    PreferredContact     = table.Column<string>(nullable: true),
                    Budget               = table.Column<string>(nullable: true),
                    DecisionStyle        = table.Column<string>(nullable: true),
                    TechLevel            = table.Column<string>(nullable: true),
                    PreferredStyle       = table.Column<string>(nullable: true),
                    AiSummary            = table.Column<string>(nullable: true),
                    AiSummaryUpdatedAt   = table.Column<DateTime>(nullable: true),
                    AdminNote            = table.Column<string>(nullable: true),
                    CreatedAt            = table.Column<DateTime>(nullable: false),
                    LastActiveAt         = table.Column<DateTime>(nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Clients", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Clients_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Clients_Contact",
                table: "Clients",
                column: "Contact");

            migrationBuilder.CreateIndex(
                name: "IX_Clients_Status",
                table: "Clients",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_Clients_UserId",
                table: "Clients",
                column: "UserId");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "Clients");
        }
    }
}

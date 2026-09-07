using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260609000001_AddTickets")]
    public partial class AddTickets : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Tickets",
                columns: table => new
                {
                    Id            = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    TicketNo      = table.Column<string>(nullable: false, defaultValue: ""),
                    Title         = table.Column<string>(nullable: false, defaultValue: ""),
                    Description   = table.Column<string>(nullable: false, defaultValue: ""),
                    ClientId      = table.Column<int>(nullable: true),
                    ClientName    = table.Column<string>(nullable: false, defaultValue: ""),
                    ClientContact = table.Column<string>(nullable: false, defaultValue: ""),
                    ContactType   = table.Column<string>(nullable: false, defaultValue: "wechat"),
                    Status        = table.Column<string>(nullable: false, defaultValue: "pending"),
                    Priority      = table.Column<string>(nullable: false, defaultValue: "normal"),
                    Budget        = table.Column<string>(nullable: true),
                    EstimatedPrice = table.Column<decimal>(nullable: true),
                    DevRequestId  = table.Column<int>(nullable: true),
                    Source        = table.Column<string>(nullable: false, defaultValue: "admin"),
                    AssigneeId    = table.Column<int>(nullable: true),
                    AdminNote     = table.Column<string>(nullable: true),
                    CreatedAt     = table.Column<DateTime>(nullable: false),
                    UpdatedAt     = table.Column<DateTime>(nullable: false),
                    DueAt         = table.Column<DateTime>(nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tickets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Tickets_Users_ClientId",
                        column: x => x.ClientId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Tickets_Users_AssigneeId",
                        column: x => x.AssigneeId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_TicketNo",
                table: "Tickets",
                column: "TicketNo",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_Status",
                table: "Tickets",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_CreatedAt",
                table: "Tickets",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_ClientId",
                table: "Tickets",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_Tickets_AssigneeId",
                table: "Tickets",
                column: "AssigneeId");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "Tickets");
        }
    }
}

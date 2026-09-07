using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260610000001_AddFinanceRecords")]
    public partial class AddFinanceRecords : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FinanceRecords",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Type = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "income"),
                    Amount = table.Column<decimal>(type: "TEXT", nullable: false),
                    Currency = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "CNY"),
                    Category = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "project"),
                    Title = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    Note = table.Column<string>(type: "TEXT", nullable: true),
                    TicketId = table.Column<int>(type: "INTEGER", nullable: true),
                    ClientId = table.Column<int>(type: "INTEGER", nullable: true),
                    PaymentStatus = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "pending"),
                    PaymentMethod = table.Column<string>(type: "TEXT", nullable: true),
                    Source = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "manual"),
                    AccountPeriod = table.Column<string>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ReceivedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FinanceRecords", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FinanceRecords_Clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "Clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_FinanceRecords_Tickets_TicketId",
                        column: x => x.TicketId,
                        principalTable: "Tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FinanceRecords_AccountPeriod",
                table: "FinanceRecords",
                column: "AccountPeriod");

            migrationBuilder.CreateIndex(
                name: "IX_FinanceRecords_ClientId",
                table: "FinanceRecords",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_FinanceRecords_CreatedAt",
                table: "FinanceRecords",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_FinanceRecords_PaymentStatus",
                table: "FinanceRecords",
                column: "PaymentStatus");

            migrationBuilder.CreateIndex(
                name: "IX_FinanceRecords_TicketId",
                table: "FinanceRecords",
                column: "TicketId");

            migrationBuilder.CreateIndex(
                name: "IX_FinanceRecords_Type",
                table: "FinanceRecords",
                column: "Type");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "FinanceRecords");
        }
    }
}

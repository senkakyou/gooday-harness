using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260613000001_AddTicketEventsV3")]
    public partial class AddTicketEventsV3 : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---- 1. 新表 TicketEvents（V3 事件脊柱）----
            migrationBuilder.CreateTable(
                name: "TicketEvents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TicketId    = table.Column<int>(type: "INTEGER", nullable: false),
                    EventType   = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    ActorId     = table.Column<int>(type: "INTEGER", nullable: false),
                    Level       = table.Column<string>(type: "TEXT", nullable: true),
                    Payload     = table.Column<string>(type: "TEXT", nullable: true),
                    Status      = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "new"),
                    CreatedAt   = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TicketEvents", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TicketEvents_Status_CreatedAt",
                table: "TicketEvents",
                columns: new[] { "Status", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_TicketEvents_TicketId_CreatedAt",
                table: "TicketEvents",
                columns: new[] { "TicketId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_TicketEvents_EventType",
                table: "TicketEvents",
                column: "EventType");

            // ---- 2. Tickets 加列（两级状态模型）----
            migrationBuilder.AddColumn<string>(
                name: "SubStatus", table: "Tickets", type: "TEXT", nullable: true);
            migrationBuilder.AddColumn<int>(
                name: "RetryCount", table: "Tickets", type: "INTEGER", nullable: false, defaultValue: 0);
            migrationBuilder.AddColumn<DateTime>(
                name: "StageDeadline", table: "Tickets", type: "TEXT", nullable: true);

            // ---- 3. FinanceRecords 加列（收款升级）----
            migrationBuilder.AddColumn<string>(
                name: "EvidenceUrl", table: "FinanceRecords", type: "TEXT", nullable: true);
            migrationBuilder.AddColumn<int>(
                name: "ConfirmedBy", table: "FinanceRecords", type: "INTEGER", nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "TicketEvents");
            migrationBuilder.DropColumn(name: "SubStatus", table: "Tickets");
            migrationBuilder.DropColumn(name: "RetryCount", table: "Tickets");
            migrationBuilder.DropColumn(name: "StageDeadline", table: "Tickets");
            migrationBuilder.DropColumn(name: "EvidenceUrl", table: "FinanceRecords");
            migrationBuilder.DropColumn(name: "ConfirmedBy", table: "FinanceRecords");
        }
    }
}

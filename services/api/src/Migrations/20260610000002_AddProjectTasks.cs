using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260610000002_AddProjectTasks")]
    public partial class AddProjectTasks : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProjectTasks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ProjectId  = table.Column<int>(type: "INTEGER", nullable: false),
                    Title      = table.Column<string>(type: "TEXT", nullable: false, defaultValue: ""),
                    Description = table.Column<string>(type: "TEXT", nullable: true),
                    Status     = table.Column<string>(type: "TEXT", nullable: false, defaultValue: "todo"),
                    SortOrder  = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 0),
                    CreatedAt  = table.Column<DateTime>(type: "TEXT", nullable: false),
                    UpdatedAt  = table.Column<DateTime>(type: "TEXT", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectTasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProjectTasks_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProjectTasks_ProjectId",
                table: "ProjectTasks",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_ProjectTasks_Status",
                table: "ProjectTasks",
                column: "Status");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "ProjectTasks");
        }
    }
}

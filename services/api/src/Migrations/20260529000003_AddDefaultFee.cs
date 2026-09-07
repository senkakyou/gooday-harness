using GoodayTools.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260529000003_AddDefaultFee")]
    public partial class AddDefaultFee : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "DefaultFee", table: "TeacherStudents", nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "DefaultFee", table: "TeacherStudents");
        }
    }
}

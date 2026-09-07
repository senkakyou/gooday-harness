using GoodayTools.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260529000001_AddCourseSettlement")]
    public partial class AddCourseSettlement : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Bookings 增列：实际上课时间
            migrationBuilder.AddColumn<DateTime>(
                name: "CompletedAt", table: "Bookings", nullable: true);

            migrationBuilder.CreateTable(
                name: "TeacherStudents",
                columns: table => new {
                    Id = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    TeacherId = table.Column<int>(nullable: false),
                    StudentUserId = table.Column<int>(nullable: true),
                    DisplayName = table.Column<string>(nullable: false, defaultValue: ""),
                    Phone = table.Column<string>(nullable: true),
                    Note = table.Column<string>(nullable: true),
                    IsArchived = table.Column<bool>(nullable: false, defaultValue: false),
                    CreatedAt = table.Column<DateTime>(nullable: false, defaultValue: new DateTime(2026, 1, 1))
                },
                constraints: table => {
                    table.PrimaryKey("PK_TeacherStudents", x => x.Id);
                    table.ForeignKey("FK_TeacherStudents_TeacherProfiles_TeacherId", x => x.TeacherId, "TeacherProfiles", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_TeacherStudents_Users_StudentUserId", x => x.StudentUserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Lessons",
                columns: table => new {
                    Id = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    TeacherStudentId = table.Column<int>(nullable: false),
                    BookingId = table.Column<int>(nullable: true),
                    LessonDate = table.Column<string>(nullable: false, defaultValue: ""),
                    DurationMinutes = table.Column<int>(nullable: true),
                    Fee = table.Column<decimal>(nullable: false, defaultValue: 0m),
                    Note = table.Column<string>(nullable: true),
                    CreatedAt = table.Column<DateTime>(nullable: false, defaultValue: new DateTime(2026, 1, 1))
                },
                constraints: table => {
                    table.PrimaryKey("PK_Lessons", x => x.Id);
                    table.ForeignKey("FK_Lessons_TeacherStudents_TeacherStudentId", x => x.TeacherStudentId, "TeacherStudents", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_Lessons_Bookings_BookingId", x => x.BookingId, "Bookings", "Id", onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Payments",
                columns: table => new {
                    Id = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    TeacherStudentId = table.Column<int>(nullable: false),
                    Amount = table.Column<decimal>(nullable: false, defaultValue: 0m),
                    PaidDate = table.Column<string>(nullable: false, defaultValue: ""),
                    Note = table.Column<string>(nullable: true),
                    CreatedAt = table.Column<DateTime>(nullable: false, defaultValue: new DateTime(2026, 1, 1))
                },
                constraints: table => {
                    table.PrimaryKey("PK_Payments", x => x.Id);
                    table.ForeignKey("FK_Payments_TeacherStudents_TeacherStudentId", x => x.TeacherStudentId, "TeacherStudents", "Id", onDelete: ReferentialAction.Cascade);
                });

            // 索引
            migrationBuilder.CreateIndex("IX_TeacherStudents_TeacherId", "TeacherStudents", "TeacherId");
            migrationBuilder.CreateIndex("IX_TeacherStudents_TeacherId_StudentUserId", "TeacherStudents",
                new[] { "TeacherId", "StudentUserId" }, unique: true, filter: "\"StudentUserId\" IS NOT NULL");
            migrationBuilder.CreateIndex("IX_TeacherStudents_StudentUserId", "TeacherStudents", "StudentUserId");
            migrationBuilder.CreateIndex("IX_Lessons_TeacherStudentId", "Lessons", "TeacherStudentId");
            migrationBuilder.CreateIndex("IX_Lessons_BookingId", "Lessons", "BookingId", unique: true, filter: "\"BookingId\" IS NOT NULL");
            migrationBuilder.CreateIndex("IX_Payments_TeacherStudentId", "Payments", "TeacherStudentId");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable("Payments");
            migrationBuilder.DropTable("Lessons");
            migrationBuilder.DropTable("TeacherStudents");
            migrationBuilder.DropColumn(name: "CompletedAt", table: "Bookings");
        }
    }
}

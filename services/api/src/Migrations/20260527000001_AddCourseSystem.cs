using GoodayTools.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260527000001_AddCourseSystem")]
    public partial class AddCourseSystem : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Subjects",
                columns: table => new {
                    Id = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(nullable: false, defaultValue: ""),
                    IconEmoji = table.Column<string>(nullable: false, defaultValue: "📚"),
                    IsActive = table.Column<bool>(nullable: false, defaultValue: true),
                    SortOrder = table.Column<int>(nullable: false, defaultValue: 0),
                    CreatedAt = table.Column<DateTime>(nullable: false, defaultValue: new DateTime(2026, 1, 1))
                },
                constraints: table => {
                    table.PrimaryKey("PK_Subjects", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TeacherProfiles",
                columns: table => new {
                    Id = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    UserId = table.Column<int>(nullable: false),
                    Bio = table.Column<string>(nullable: false, defaultValue: ""),
                    AvatarUrl = table.Column<string>(nullable: true),
                    Status = table.Column<string>(nullable: false, defaultValue: "pending"),
                    RejectReason = table.Column<string>(nullable: true),
                    ApprovedByUserId = table.Column<int>(nullable: true),
                    ApprovedAt = table.Column<DateTime>(nullable: true),
                    CreatedAt = table.Column<DateTime>(nullable: false, defaultValue: new DateTime(2026, 1, 1))
                },
                constraints: table => {
                    table.PrimaryKey("PK_TeacherProfiles", x => x.Id);
                    table.ForeignKey("FK_TeacherProfiles_Users_UserId", x => x.UserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TeacherSubjects",
                columns: table => new {
                    TeacherId = table.Column<int>(nullable: false),
                    SubjectId = table.Column<int>(nullable: false)
                },
                constraints: table => {
                    table.PrimaryKey("PK_TeacherSubjects", x => new { x.TeacherId, x.SubjectId });
                    table.ForeignKey("FK_TeacherSubjects_TeacherProfiles_TeacherId", x => x.TeacherId, "TeacherProfiles", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_TeacherSubjects_Subjects_SubjectId", x => x.SubjectId, "Subjects", "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TimeSlots",
                columns: table => new {
                    Id = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    TeacherId = table.Column<int>(nullable: false),
                    Date = table.Column<string>(nullable: false, defaultValue: ""),
                    StartTime = table.Column<string>(nullable: false, defaultValue: ""),
                    EndTime = table.Column<string>(nullable: false, defaultValue: ""),
                    DurationMinutes = table.Column<int>(nullable: false, defaultValue: 60),
                    Status = table.Column<string>(nullable: false, defaultValue: "available"),
                    Note = table.Column<string>(nullable: true),
                    CreatedAt = table.Column<DateTime>(nullable: false, defaultValue: new DateTime(2026, 1, 1))
                },
                constraints: table => {
                    table.PrimaryKey("PK_TimeSlots", x => x.Id);
                    table.ForeignKey("FK_TimeSlots_TeacherProfiles_TeacherId", x => x.TeacherId, "TeacherProfiles", "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Bookings",
                columns: table => new {
                    Id = table.Column<int>(nullable: false).Annotation("Sqlite:Autoincrement", true),
                    StudentId = table.Column<int>(nullable: false),
                    TeacherId = table.Column<int>(nullable: false),
                    TimeSlotId = table.Column<int>(nullable: false),
                    Status = table.Column<string>(nullable: false, defaultValue: "pending"),
                    Note = table.Column<string>(nullable: true),
                    TeacherNote = table.Column<string>(nullable: true),
                    CreatedAt = table.Column<DateTime>(nullable: false, defaultValue: new DateTime(2026, 1, 1)),
                    UpdatedAt = table.Column<DateTime>(nullable: true)
                },
                constraints: table => {
                    table.PrimaryKey("PK_Bookings", x => x.Id);
                    table.ForeignKey("FK_Bookings_Users_StudentId", x => x.StudentId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                    table.ForeignKey("FK_Bookings_TeacherProfiles_TeacherId", x => x.TeacherId, "TeacherProfiles", "Id", onDelete: ReferentialAction.Restrict);
                    table.ForeignKey("FK_Bookings_TimeSlots_TimeSlotId", x => x.TimeSlotId, "TimeSlots", "Id", onDelete: ReferentialAction.Cascade);
                });

            // 索引
            migrationBuilder.CreateIndex("IX_TeacherProfiles_UserId", "TeacherProfiles", "UserId", unique: true);
            migrationBuilder.CreateIndex("IX_TeacherProfiles_Status", "TeacherProfiles", "Status");
            migrationBuilder.CreateIndex("IX_TimeSlots_TeacherId_Date", "TimeSlots", new[] { "TeacherId", "Date" });
            migrationBuilder.CreateIndex("IX_TimeSlots_Status", "TimeSlots", "Status");
            migrationBuilder.CreateIndex("IX_Bookings_StudentId", "Bookings", "StudentId");
            migrationBuilder.CreateIndex("IX_Bookings_TeacherId", "Bookings", "TeacherId");
            migrationBuilder.CreateIndex("IX_Bookings_Status", "Bookings", "Status");
            migrationBuilder.CreateIndex("IX_Bookings_TimeSlotId", "Bookings", "TimeSlotId", unique: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable("Bookings");
            migrationBuilder.DropTable("TimeSlots");
            migrationBuilder.DropTable("TeacherSubjects");
            migrationBuilder.DropTable("TeacherProfiles");
            migrationBuilder.DropTable("Subjects");
        }
    }
}

using GoodayTools.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    // 离线学生预约支持：
    // 1. Bookings.StudentId 改为可空（离线学生无 User 账号）
    // 2. 新增 Bookings.OfflineStudentId（FK → TeacherStudents，离线学生专用）
    // StudentId / OfflineStudentId 二选一必有一个非空。
    [DbContext(typeof(AppDbContext))]
    [Migration("20260601000001_AddOfflineBooking")]
    public partial class AddOfflineBooking : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // SQLite 不支持 ALTER COLUMN，必须重建表。Bookings 当前行数为 0，安全。
            migrationBuilder.Sql(@"
CREATE TABLE ""Bookings_new"" (
    ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_Bookings"" PRIMARY KEY AUTOINCREMENT,
    ""StudentId"" INTEGER NULL,
    ""OfflineStudentId"" INTEGER NULL,
    ""TeacherId"" INTEGER NOT NULL,
    ""TimeSlotId"" INTEGER NOT NULL,
    ""SubjectId"" INTEGER NULL,
    ""Status"" TEXT NOT NULL DEFAULT 'pending',
    ""Note"" TEXT NULL,
    ""TeacherNote"" TEXT NULL,
    ""CreatedAt"" TEXT NOT NULL DEFAULT '2026-01-01 00:00:00',
    ""UpdatedAt"" TEXT NULL,
    ""CompletedAt"" TEXT NULL,
    CONSTRAINT ""FK_Bookings_Users_StudentId"" FOREIGN KEY (""StudentId"") REFERENCES ""Users"" (""Id"") ON DELETE RESTRICT,
    CONSTRAINT ""FK_Bookings_TeacherStudents_OfflineStudentId"" FOREIGN KEY (""OfflineStudentId"") REFERENCES ""TeacherStudents"" (""Id"") ON DELETE CASCADE,
    CONSTRAINT ""FK_Bookings_TeacherProfiles_TeacherId"" FOREIGN KEY (""TeacherId"") REFERENCES ""TeacherProfiles"" (""Id"") ON DELETE RESTRICT,
    CONSTRAINT ""FK_Bookings_TimeSlots_TimeSlotId"" FOREIGN KEY (""TimeSlotId"") REFERENCES ""TimeSlots"" (""Id"") ON DELETE CASCADE,
    CONSTRAINT ""FK_Bookings_Subjects_SubjectId"" FOREIGN KEY (""SubjectId"") REFERENCES ""Subjects"" (""Id"")
);
INSERT INTO ""Bookings_new"" (""Id"",""StudentId"",""OfflineStudentId"",""TeacherId"",""TimeSlotId"",""SubjectId"",""Status"",""Note"",""TeacherNote"",""CreatedAt"",""UpdatedAt"",""CompletedAt"")
    SELECT ""Id"", ""StudentId"", NULL, ""TeacherId"", ""TimeSlotId"", ""SubjectId"", ""Status"", ""Note"", ""TeacherNote"", ""CreatedAt"", ""UpdatedAt"", ""CompletedAt"" FROM ""Bookings"";
DROP TABLE ""Bookings"";
ALTER TABLE ""Bookings_new"" RENAME TO ""Bookings"";
");
            migrationBuilder.CreateIndex("IX_Bookings_StudentId", "Bookings", "StudentId");
            migrationBuilder.CreateIndex("IX_Bookings_OfflineStudentId", "Bookings", "OfflineStudentId");
            migrationBuilder.CreateIndex("IX_Bookings_TeacherId", "Bookings", "TeacherId");
            migrationBuilder.CreateIndex("IX_Bookings_Status", "Bookings", "Status");
            migrationBuilder.CreateIndex("IX_Bookings_TimeSlotId", "Bookings", "TimeSlotId");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
CREATE TABLE ""Bookings_old"" (
    ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_Bookings"" PRIMARY KEY AUTOINCREMENT,
    ""StudentId"" INTEGER NOT NULL,
    ""TeacherId"" INTEGER NOT NULL,
    ""TimeSlotId"" INTEGER NOT NULL,
    ""SubjectId"" INTEGER NULL,
    ""Status"" TEXT NOT NULL DEFAULT 'pending',
    ""Note"" TEXT NULL,
    ""TeacherNote"" TEXT NULL,
    ""CreatedAt"" TEXT NOT NULL DEFAULT '2026-01-01 00:00:00',
    ""UpdatedAt"" TEXT NULL,
    ""CompletedAt"" TEXT NULL,
    CONSTRAINT ""FK_Bookings_Users_StudentId"" FOREIGN KEY (""StudentId"") REFERENCES ""Users"" (""Id"") ON DELETE RESTRICT,
    CONSTRAINT ""FK_Bookings_TeacherProfiles_TeacherId"" FOREIGN KEY (""TeacherId"") REFERENCES ""TeacherProfiles"" (""Id"") ON DELETE RESTRICT,
    CONSTRAINT ""FK_Bookings_TimeSlots_TimeSlotId"" FOREIGN KEY (""TimeSlotId"") REFERENCES ""TimeSlots"" (""Id"") ON DELETE CASCADE
);
INSERT INTO ""Bookings_old"" SELECT ""Id"",""StudentId"",""TeacherId"",""TimeSlotId"",""SubjectId"",""Status"",""Note"",""TeacherNote"",""CreatedAt"",""UpdatedAt"",""CompletedAt"" FROM ""Bookings"" WHERE ""StudentId"" IS NOT NULL;
DROP TABLE ""Bookings"";
ALTER TABLE ""Bookings_old"" RENAME TO ""Bookings"";
");
            migrationBuilder.CreateIndex("IX_Bookings_StudentId", "Bookings", "StudentId");
            migrationBuilder.CreateIndex("IX_Bookings_TeacherId", "Bookings", "TeacherId");
            migrationBuilder.CreateIndex("IX_Bookings_Status", "Bookings", "Status");
            migrationBuilder.CreateIndex("IX_Bookings_TimeSlotId", "Bookings", "TimeSlotId");
        }
    }
}

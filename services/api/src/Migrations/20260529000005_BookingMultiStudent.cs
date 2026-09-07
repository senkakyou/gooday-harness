using GoodayTools.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    // 群课：一个时段可被多名学生预约。
    // 把 Bookings.TimeSlotId 的唯一索引改为普通索引（移除 1:1 限制）。
    [DbContext(typeof(AppDbContext))]
    [Migration("20260529000005_BookingMultiStudent")]
    public partial class BookingMultiStudent : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Bookings_TimeSlotId", table: "Bookings");
            migrationBuilder.CreateIndex(
                name: "IX_Bookings_TimeSlotId", table: "Bookings", column: "TimeSlotId");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Bookings_TimeSlotId", table: "Bookings");
            migrationBuilder.CreateIndex(
                name: "IX_Bookings_TimeSlotId", table: "Bookings", column: "TimeSlotId", unique: true);
        }
    }
}

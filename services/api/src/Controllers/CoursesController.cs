using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Services;
using System.Security.Claims;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/courses")]
public class CoursesController(AppDbContext db, NotificationService notif) : ControllerBase {

    int CurrentUserId => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
    // 公开接口里读取"可能存在"的登录用户（未登录返回 null，不抛异常）
    int? OptionalUserId => int.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var x) ? x : (int?)null;

    // ── 学科列表（公开）──
    [HttpGet("subjects")]
    public async Task<IActionResult> ListSubjects() {
        var list = await db.Subjects
            .Where(s => s.IsActive)
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Id)
            .Select(s => new { s.Id, s.Name, s.IconEmoji })
            .ToListAsync();
        return Ok(list);
    }

    // ── 某学科的老师列表（公开）──
    [HttpGet("subjects/{subjectId}/teachers")]
    public async Task<IActionResult> ListTeachers(int subjectId) {
        var list = await db.TeacherSubjects
            .Where(ts => ts.SubjectId == subjectId && ts.Teacher.Status == "approved")
            .Include(ts => ts.Teacher).ThenInclude(t => t.User)
            .Include(ts => ts.Teacher).ThenInclude(t => t.TeacherSubjects).ThenInclude(x => x.Subject)
            .Select(ts => new {
                ts.Teacher.Id,
                ts.Teacher.Bio,
                avatarUrl = ts.Teacher.AvatarUrl ?? ts.Teacher.User.AvatarUrl,
                username = ts.Teacher.User.Username,
                subjects = ts.Teacher.TeacherSubjects.Select(x => new { x.Subject.Id, x.Subject.Name })
            })
            .ToListAsync();
        return Ok(list);
    }

    // ── 老师详情（公开）──
    [HttpGet("teachers/{id}")]
    public async Task<IActionResult> GetTeacher(int id) {
        var t = await db.TeacherProfiles
            .Where(t => t.Id == id && t.Status == "approved")
            .Include(t => t.User)
            .Include(t => t.TeacherSubjects).ThenInclude(ts => ts.Subject)
            .Select(t => new {
                t.Id, t.Bio,
                avatarUrl = t.AvatarUrl ?? t.User.AvatarUrl,
                username = t.User.Username,
                subjects = t.TeacherSubjects.Select(ts => new { ts.Subject.Id, ts.Subject.Name })
            })
            .FirstOrDefaultAsync();
        if (t == null) return NotFound();
        return Ok(t);
    }

    // ── 老师某月有可用时段的日期列表（公开）──
    [HttpGet("teachers/{id}/available-days")]
    public async Task<IActionResult> GetAvailableDays(int id, [FromQuery] int year, [FromQuery] int month) {
        var prefix = $"{year:D4}-{month:D2}";
        var days = await db.TimeSlots
            .Where(s => s.TeacherId == id && s.Date.StartsWith(prefix) && s.Status != "cancelled")
            .Select(s => s.Date)
            .Distinct()
            .ToListAsync();
        return Ok(days);
    }

    // ── 老师某天的时间段（公开；登录后附带"我是否已约"标记）──
    [HttpGet("teachers/{id}/slots")]
    public async Task<IActionResult> GetSlotsByDate(int id, [FromQuery] string date) {
        var slots = await db.TimeSlots
            .Where(s => s.TeacherId == id && s.Date == date)
            .OrderBy(s => s.StartTime)
            .Select(s => new { s.Id, s.Date, s.StartTime, s.EndTime, s.DurationMinutes, s.Status, s.Note })
            .ToListAsync();

        // 登录用户：标出自己已预约（未取消）的时段，前端据此显示「已预约」并禁用，避免重复预约
        var uid = OptionalUserId;
        var mine = new HashSet<int>();
        if (uid.HasValue && slots.Count > 0) {
            var ids = slots.Select(s => s.Id).ToList();
            mine = (await db.Bookings
                .Where(b => b.StudentId == uid.Value && ids.Contains(b.TimeSlotId) && b.Status != "cancelled")
                .Select(b => b.TimeSlotId)
                .ToListAsync()).ToHashSet();
        }
        return Ok(slots.Select(s => new {
            s.Id, s.Date, s.StartTime, s.EndTime, s.DurationMinutes, s.Status, s.Note,
            mineBooked = mine.Contains(s.Id)
        }));
    }

    // ── 学生预约（需登录）──
    [Authorize]
    [HttpPost("bookings")]
    public async Task<IActionResult> CreateBooking([FromBody] CreateBookingDto dto) {
        var slot = await db.TimeSlots.Include(s => s.Teacher).FirstOrDefaultAsync(s => s.Id == dto.SlotId);
        if (slot == null) return NotFound("时间段不存在");
        if (slot.Status == "cancelled") return BadRequest("该时间段已取消");
        if (slot.Teacher.Status != "approved") return BadRequest("老师不可预约");

        // 不能预约已开始/已过去的时段（按站点时区中国 UTC+8）
        var nowCn = DateTime.UtcNow.AddHours(8);
        if (DateTime.TryParse($"{slot.Date} {slot.StartTime}", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var slotStart) && slotStart <= nowCn)
            return BadRequest("该时段已开始或已过去，无法预约");

        // 群课：同一时段可多名学生报名，仅挡同一学生的重复报名（已取消的可重约）
        var studentId = CurrentUserId;
        var already = await db.Bookings.AnyAsync(b => b.StudentId == studentId && b.TimeSlotId == slot.Id && b.Status != "cancelled");
        if (already) return BadRequest("你已预约过该时间段");

        // 科目可选；若填了，必须是该老师教的科目
        if (dto.SubjectId.HasValue) {
            var teaches = await db.TeacherSubjects.AnyAsync(ts => ts.TeacherId == slot.TeacherId && ts.SubjectId == dto.SubjectId.Value);
            if (!teaches) return BadRequest("该老师不教这个科目");
        }

        slot.Status = "booked";
        var booking = new Models.Booking {
            StudentId = studentId,
            TeacherId = slot.TeacherId,
            TimeSlotId = slot.Id,
            SubjectId = dto.SubjectId,
            Note = dto.Note,
            CreatedAt = DateTime.UtcNow
        };
        db.Bookings.Add(booking);
        await db.SaveChangesAsync();

        var studentName = User.FindFirst(ClaimTypes.Name)?.Value ?? "学生";
        await notif.Notify(slot.Teacher.UserId, "booking", "新的预约申请",
            $"{studentName} 预约了 {slot.Date} {slot.StartTime}–{slot.EndTime}，待你确认。", "/teacher/bookings");

        return Ok(new { booking.Id, booking.Status });
    }

    // ── 我的预约（学生）──
    [Authorize]
    [HttpGet("my-bookings")]
    public async Task<IActionResult> MyBookings() {
        var uid = CurrentUserId;
        var list = await db.Bookings
            .Where(b => b.StudentId == uid)
            .Include(b => b.TimeSlot)
            .Include(b => b.Teacher).ThenInclude(t => t.User)
            .Include(b => b.Teacher).ThenInclude(t => t.TeacherSubjects).ThenInclude(ts => ts.Subject)
            .OrderByDescending(b => b.CreatedAt)
            .Select(b => new {
                b.Id, b.Status, b.Note, b.TeacherNote, b.CreatedAt,
                subject = b.Subject != null ? new { b.Subject.Id, b.Subject.Name } : null,
                slot = new { b.TimeSlot.Date, b.TimeSlot.StartTime, b.TimeSlot.EndTime, b.TimeSlot.DurationMinutes, b.TimeSlot.Note },
                teacher = new {
                    b.Teacher.Id, b.Teacher.User.Username, b.Teacher.Bio,
                    avatarUrl = b.Teacher.AvatarUrl ?? b.Teacher.User.AvatarUrl,
                    subjects = b.Teacher.TeacherSubjects.Select(ts => new { ts.Subject.Id, ts.Subject.Name })
                }
            })
            .ToListAsync();
        return Ok(list);
    }

    // ── 取消预约（学生）──
    [Authorize]
    [HttpDelete("my-bookings/{id}")]
    public async Task<IActionResult> CancelBooking(int id) {
        var uid = CurrentUserId;
        var b = await db.Bookings.Include(b => b.TimeSlot).Include(b => b.Teacher).FirstOrDefaultAsync(b => b.Id == id && b.StudentId == uid);
        if (b == null) return NotFound();
        if (b.Status == "cancelled") return BadRequest("已取消");
        if (b.Status == "completed") return BadRequest("已完成的课程无法取消");  // 防止取消已结课/已计费的课导致结算与预约对不上账
        // 逾期不可取消：课程已开始/已过去就不能再退（与前端"请在上课前取消，逾期将无法取消"文案一致，按中国时区 UTC+8）
        var nowCn = DateTime.UtcNow.AddHours(8);
        if (DateTime.TryParse($"{b.TimeSlot.Date} {b.TimeSlot.StartTime}", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var slotStart) && slotStart <= nowCn)
            return BadRequest("课程已开始或已过去，无法取消");
        b.Status = "cancelled"; b.UpdatedAt = DateTime.UtcNow;
        // 群课：还有其它未取消的同学则保持 booked，全部取消才回到 available
        var hasOther = await db.Bookings.AnyAsync(x => x.TimeSlotId == b.TimeSlotId && x.Id != b.Id && x.Status != "cancelled");
        b.TimeSlot.Status = hasOther ? "booked" : "available";
        await db.SaveChangesAsync();

        // 通知老师（与老师取消通知学生对称，避免老师对已取消的课照常备课/到场）
        var studentName = User.FindFirst(ClaimTypes.Name)?.Value ?? "学生";
        await notif.Notify(b.Teacher.UserId, "booking", "学生取消了预约",
            $"{studentName} 取消了 {b.TimeSlot.Date} {b.TimeSlot.StartTime}–{b.TimeSlot.EndTime} 的课。", "/teacher/bookings");
        return Ok();
    }

    public record CreateBookingDto(int SlotId, string? Note, int? SubjectId);
}

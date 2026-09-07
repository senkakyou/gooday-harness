using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Services;
using System.Collections.Concurrent;
using System.Security.Claims;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/teacher")]
[Authorize]
public class TeacherController(AppDbContext db, NotificationService notif, ScheduleOcrService ocr) : ControllerBase {

    int CurrentUserId => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

    // 识别任务缓存（进程内）：POST 立即返回 jobId，前端轮询 GET 取结果，避免移动网络长连接超时
    record OcrJob(string Status, ScheduleOcrService.OcrResult? Result, string? Error);
    static readonly ConcurrentDictionary<string, OcrJob> OcrJobs = new();

    // 解析 "HH:mm" 为当天分钟数，格式非法返回 null
    static int? ParseHhmm(string? hhmm) {
        var parts = (hhmm ?? "").Split(':');
        if (parts.Length != 2 || !int.TryParse(parts[0], out var h) || !int.TryParse(parts[1], out var m)) return null;
        if (h < 0 || h > 23 || m < 0 || m > 59) return null;
        return h * 60 + m;
    }

    async Task<Models.TeacherProfile?> MyProfile() =>
        await db.TeacherProfiles.FirstOrDefaultAsync(t => t.UserId == CurrentUserId);

    // ── 申请成为老师（支持 rejected/revoked 状态重新申请）──
    [HttpPost("apply")]
    public async Task<IActionResult> Apply([FromBody] ApplyDto dto) {
        var uid = CurrentUserId;

        var existing = await db.TeacherProfiles
            .Include(t => t.TeacherSubjects)
            .FirstOrDefaultAsync(t => t.UserId == uid);

        if (existing != null) {
            if (existing.Status != "rejected" && existing.Status != "revoked")
                return BadRequest("已提交过申请");

            var reSubjects = await db.Subjects.Where(s => dto.SubjectIds.Contains(s.Id)).ToListAsync();
            if (!reSubjects.Any()) return BadRequest("请选择至少一个学科");

            existing.Bio = dto.Bio;
            existing.Status = "pending";
            existing.RejectReason = null;
            existing.ApprovedAt = null;
            existing.ApprovedByUserId = null;
            existing.CreatedAt = DateTime.UtcNow;

            db.TeacherSubjects.RemoveRange(existing.TeacherSubjects);
            await db.SaveChangesAsync();

            foreach (var s in reSubjects)
                db.TeacherSubjects.Add(new Models.TeacherSubject { TeacherId = existing.Id, SubjectId = s.Id });
            await db.SaveChangesAsync();

            return Ok(new { existing.Id, existing.Status });
        }

        var subjects = await db.Subjects.Where(s => dto.SubjectIds.Contains(s.Id)).ToListAsync();
        if (!subjects.Any()) return BadRequest("请选择至少一个学科");

        var profile = new Models.TeacherProfile {
            UserId = uid, Bio = dto.Bio, CreatedAt = DateTime.UtcNow
        };
        db.TeacherProfiles.Add(profile);
        await db.SaveChangesAsync();

        foreach (var s in subjects)
            db.TeacherSubjects.Add(new Models.TeacherSubject { TeacherId = profile.Id, SubjectId = s.Id });
        await db.SaveChangesAsync();

        return Ok(new { profile.Id, profile.Status });
    }

    // ── 查看我的教师资料 ──
    [HttpGet("profile")]
    public async Task<IActionResult> GetProfile() {
        var t = await db.TeacherProfiles
            .Include(t => t.TeacherSubjects).ThenInclude(ts => ts.Subject)
            .FirstOrDefaultAsync(t => t.UserId == CurrentUserId);
        if (t == null) return NotFound();
        return Ok(new {
            t.Id, t.Bio, t.AvatarUrl, t.Status, t.RejectReason, t.CreatedAt, t.ApprovedAt,
            subjects = t.TeacherSubjects.Select(ts => new { ts.Subject.Id, ts.Subject.Name })
        });
    }

    // ── 更新教师简介（科目由管理员管理，教师不可自行修改）──
    [HttpPut("profile")]
    public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileDto dto) {
        var t = await db.TeacherProfiles.FirstOrDefaultAsync(t => t.UserId == CurrentUserId);
        if (t == null) return NotFound();
        if (t.Status != "approved") return BadRequest("资料审核中，暂不可修改");

        t.Bio = dto.Bio;
        if (dto.AvatarUrl != null) t.AvatarUrl = dto.AvatarUrl;

        await db.SaveChangesAsync();
        return Ok();
    }

    // ── 查看我的时间段 ──
    [HttpGet("slots")]
    public async Task<IActionResult> GetSlots([FromQuery] string? date, [FromQuery] int? year, [FromQuery] int? month) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();

        IQueryable<Models.TimeSlot> q = db.TimeSlots.Where(s => s.TeacherId == t.Id);
        if (date != null) q = q.Where(s => s.Date == date);
        else if (year != null && month != null) q = q.Where(s => s.Date.StartsWith($"{year:D4}-{month:D2}"));

        var list = await q.OrderBy(s => s.Date).ThenBy(s => s.StartTime)
            .Select(s => new { s.Id, s.Date, s.StartTime, s.EndTime, s.DurationMinutes, s.Status, s.Note })
            .ToListAsync();
        return Ok(list);
    }

    // ── 新增时间段 ──
    [HttpPost("slots")]
    public async Task<IActionResult> CreateSlot([FromBody] CreateSlotDto dto) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();

        // 时长一律由起止时间推导，不信任前端传值（历史上前端能传出 6060 这种脏数据）
        var startMin = ParseHhmm(dto.StartTime);
        var endMin = ParseHhmm(dto.EndTime);
        if (startMin == null || endMin == null) return BadRequest("时间格式不正确");
        var duration = endMin.Value - startMin.Value;
        if (duration <= 0) return BadRequest("结束时间必须晚于开始时间");

        var conflict = await db.TimeSlots.AnyAsync(s =>
            s.TeacherId == t.Id && s.Date == dto.Date &&
            s.Status != "cancelled" &&
            string.Compare(s.StartTime, dto.EndTime) < 0 &&
            string.Compare(s.EndTime, dto.StartTime) > 0);
        if (conflict) return BadRequest("该时间段与已有排班冲突");

        var slot = new Models.TimeSlot {
            TeacherId = t.Id, Date = dto.Date,
            StartTime = dto.StartTime, EndTime = dto.EndTime,
            DurationMinutes = duration, Note = dto.Note,
            CreatedAt = DateTime.UtcNow
        };
        db.TimeSlots.Add(slot);
        await db.SaveChangesAsync();
        return Ok(new { slot.Id, slot.Date, slot.StartTime, slot.EndTime, slot.DurationMinutes, slot.Status });
    }

    // ── 批量新增时间段（快捷排课：一天多节/复制某天/照片识别确认 共用）──
    // 逐条校验时间格式、时长、与"已有排班 + 本批已通过条目"的冲突；合法的入库，非法的收集原因返回。
    // 若 StudentNames 非空，自动创建线下学生档案并生成 confirmed 预约，以便走结课流程。
    [HttpPost("slots/batch")]
    public async Task<IActionResult> CreateSlotsBatch([FromBody] CreateSlotsBatchDto dto) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();
        var items = dto.Slots ?? new();
        if (items.Count == 0) return BadRequest("没有要添加的时间段");
        if (items.Count > 200) return BadRequest("一次最多添加 200 个时间段");

        // 该批涉及日期的已有排班（未取消），一次性拉到内存做冲突判断
        var dates = items.Select(s => s.Date).Distinct().ToList();
        var existing = await db.TimeSlots
            .Where(s => s.TeacherId == t.Id && dates.Contains(s.Date) && s.Status != "cancelled")
            .Select(s => new { s.Date, s.StartTime, s.EndTime })
            .ToListAsync();
        var accepted = existing.Select(e => (e.Date, e.StartTime, e.EndTime)).ToList();

        // 当前老师所有线下学生档案（用于避免重复创建）
        var rosterCache = await db.TeacherStudents
            .Where(ts => ts.TeacherId == t.Id && ts.StudentUserId == null)
            .ToListAsync();

        var created = new List<object>();
        var skipped = new List<object>();
        bool Overlap(string date, string s, string e) =>
            accepted.Any(a => a.Date == date && string.Compare(a.StartTime, e) < 0 && string.Compare(a.EndTime, s) > 0);

        var now = DateTime.UtcNow;

        foreach (var it in items) {
            var sMin = ParseHhmm(it.StartTime); var eMin = ParseHhmm(it.EndTime);
            if (string.IsNullOrWhiteSpace(it.Date) || sMin == null || eMin == null) { skipped.Add(new { it.Date, it.StartTime, it.EndTime, reason = "时间格式不正确" }); continue; }
            if (eMin.Value - sMin.Value <= 0) { skipped.Add(new { it.Date, it.StartTime, it.EndTime, reason = "结束时间需晚于开始时间" }); continue; }
            if (Overlap(it.Date, it.StartTime, it.EndTime)) { skipped.Add(new { it.Date, it.StartTime, it.EndTime, reason = "与已有排班冲突" }); continue; }

            var slot = new Models.TimeSlot {
                TeacherId = t.Id, Date = it.Date, StartTime = it.StartTime, EndTime = it.EndTime,
                DurationMinutes = eMin.Value - sMin.Value, Note = it.Note, CreatedAt = now
            };
            db.TimeSlots.Add(slot);
            accepted.Add((it.Date, it.StartTime, it.EndTime));

            // 解析学生姓名：优先用 StudentNames 字段，其次从 Note 里提取（去掉 "科目 · " 前缀）
            var names = ParseStudentNames(it.StudentNames, it.Note);
            if (names.Count > 0) {
                await db.SaveChangesAsync();   // 先落库 slot，获取 Id
                foreach (var name in names) {
                    // 找或建线下学生档案
                    var ts = rosterCache.FirstOrDefault(x => x.DisplayName == name);
                    if (ts == null) {
                        ts = new Models.TeacherStudent {
                            TeacherId = t.Id, StudentUserId = null, DisplayName = name, CreatedAt = now
                        };
                        db.TeacherStudents.Add(ts);
                        await db.SaveChangesAsync();
                        rosterCache.Add(ts);
                    }
                    // 同一时段同一学生不重复创建
                    var alreadyBooked = await db.Bookings.AnyAsync(b =>
                        b.TimeSlotId == slot.Id && b.OfflineStudentId == ts.Id && b.Status != "cancelled");
                    if (alreadyBooked) continue;

                    db.Bookings.Add(new Models.Booking {
                        StudentId = null, OfflineStudentId = ts.Id,
                        TeacherId = t.Id, TimeSlotId = slot.Id,
                        Status = "confirmed", TeacherNote = "拍照排课自动生成", CreatedAt = now
                    });
                }
                slot.Status = "booked";
                await db.SaveChangesAsync();
            }

            created.Add(new { it.Date, it.StartTime, it.EndTime, students = names });
        }
        if (created.Count > 0) await db.SaveChangesAsync();
        return Ok(new { createdCount = created.Count, created, skipped });
    }

    // 从 studentNames 字段（优先）或 note 字段提取学生姓名列表
    static List<string> ParseStudentNames(List<string>? studentNames, string? note) {
        if (studentNames != null && studentNames.Count > 0)
            return studentNames.Select(n => n.Trim()).Where(n => n.Length > 0).Distinct().ToList();

        if (string.IsNullOrWhiteSpace(note)) return new();

        // 去掉 "科目 · " 前缀
        var raw = note.Contains(" · ") ? note[(note.IndexOf(" · ") + 3)..] : note;
        // 按顿号/逗号/斜杠分割
        var parts = raw.Split(new[] { '、', '，', ',', '/', ' ' }, StringSplitOptions.RemoveEmptyEntries)
                       .Select(s => s.Trim()).Where(s => s.Length > 0).Distinct().ToList();
        // OCR 有时把多个单字姓拼在一起（如"张李"），如果只切出一段且全是汉字则按字拆分
        if (parts.Count == 1 && parts[0].Length is >= 2 and <= 5 &&
            parts[0].All(c => c >= '一' && c <= '鿿'))
            return parts[0].Select(c => c.ToString()).Distinct().ToList();
        return parts;
    }

    // ── 课表照片识别（第一步）：接收文件、立即返回 jobId，后台异步调用视觉模型 ──
    // 前端拿到 jobId 后每 3s 轮询 GET schedule/recognize/{jobId}，避免移动网络长连接超时
    [HttpPost("schedule/recognize")]
    [RequestSizeLimit(12 * 1024 * 1024)]
    public async Task<IActionResult> StartRecognize(IFormFile? file, [FromForm] string? hint) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();
        if (file == null || file.Length == 0) return BadRequest("请上传课表照片");
        if (file.Length > 10 * 1024 * 1024) return BadRequest("图片不能超过 10MB");
        var ext = Path.GetExtension(file.FileName).ToLower();
        if (!new[] { ".jpg", ".jpeg", ".png", ".webp" }.Contains(ext)) return BadRequest("仅支持 jpg/png/webp 图片");

        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        var imageBytes = ms.ToArray();
        var contentType = file.ContentType ?? "image/jpeg";
        var hintText = string.IsNullOrWhiteSpace(hint) ? null : hint.Trim()[..Math.Min(hint.Trim().Length, 500)];

        var jobId = Guid.NewGuid().ToString("N");
        OcrJobs[jobId] = new OcrJob("pending", null, null);

        _ = Task.Run(async () => {
            try {
                var result = await ocr.Recognize(imageBytes, contentType, hintText);
                OcrJobs[jobId] = new OcrJob("done", result, null);
            } catch (Exception e) {
                OcrJobs[jobId] = new OcrJob("error", null, e.Message);
            }
        });

        return Ok(new { jobId });
    }

    // ── 课表照片识别（第二步）：轮询识别结果 ──
    [HttpGet("schedule/recognize/{jobId}")]
    public IActionResult GetRecognizeResult(string jobId) {
        if (!OcrJobs.TryGetValue(jobId, out var job)) return NotFound("任务不存在或已过期");
        if (job.Status == "pending") return Ok(new { status = "pending" });
        OcrJobs.TryRemove(jobId, out _);
        if (job.Status == "error") return Ok(new { status = "error", message = job.Error ?? "识别失败" });
        var r = job.Result!;
        return Ok(new { status = "done", mock = r.Mock, entries = r.Entries, message = r.Message });
    }

    // ── 删除时间段 ──
    [HttpDelete("slots/{id}")]
    public async Task<IActionResult> DeleteSlot(int id) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var slot = await db.TimeSlots.FirstOrDefaultAsync(s => s.Id == id && s.TeacherId == t.Id);
        if (slot == null) return NotFound();
        if (slot.Status == "booked") return BadRequest("已有学生预约，请先取消预约再删除");
        db.TimeSlots.Remove(slot);
        await db.SaveChangesAsync();
        return Ok();
    }

    // ── 老师把学生加进某时段（群课：直接确认）──
    [HttpPost("slots/{slotId}/add-student")]
    public async Task<IActionResult> AddStudentToSlot(int slotId, [FromBody] AddStudentToSlotDto dto) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();
        var slot = await db.TimeSlots.FirstOrDefaultAsync(s => s.Id == slotId && s.TeacherId == t.Id);
        if (slot == null) return NotFound("时间段不存在");
        if (slot.Status == "cancelled") return BadRequest("该时间段已取消");

        var student = await db.Users.FirstOrDefaultAsync(u => u.Id == dto.StudentUserId);
        if (student == null) return BadRequest("学生不存在");

        var already = await db.Bookings.AnyAsync(b => b.TimeSlotId == slotId && b.StudentId == dto.StudentUserId && b.Status != "cancelled");
        if (already) return BadRequest("该学生已在这节课");

        // 科目可选；若填了，必须是该老师教的科目
        if (dto.SubjectId.HasValue) {
            var teaches = await db.TeacherSubjects.AnyAsync(ts => ts.TeacherId == t.Id && ts.SubjectId == dto.SubjectId.Value);
            if (!teaches) return BadRequest("你不教这个科目");
        }

        var booking = new Models.Booking {
            StudentId = dto.StudentUserId, TeacherId = t.Id, TimeSlotId = slotId,
            SubjectId = dto.SubjectId, Status = "confirmed", TeacherNote = "老师添加",
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
        };
        db.Bookings.Add(booking);
        slot.Status = "booked";
        await db.SaveChangesAsync();

        var teacherName = User.FindFirst(ClaimTypes.Name)?.Value ?? "老师";
        await notif.Notify(dto.StudentUserId, "booking", "老师为你安排了课程",
            $"{teacherName} 老师把你加入了 {slot.Date} {slot.StartTime}–{slot.EndTime} 的课。", "/courses/my-bookings");
        return Ok(new { booking.Id });
    }

    // ── 老师把线下学生加进某时段（直接确认）──
    [HttpPost("slots/{slotId}/add-offline-student")]
    public async Task<IActionResult> AddOfflineStudentToSlot(int slotId, [FromBody] AddOfflineStudentToSlotDto dto) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();
        var slot = await db.TimeSlots.FirstOrDefaultAsync(s => s.Id == slotId && s.TeacherId == t.Id);
        if (slot == null) return NotFound("时间段不存在");
        if (slot.Status == "cancelled") return BadRequest("该时间段已取消");

        var ts = await db.TeacherStudents.FirstOrDefaultAsync(x => x.Id == dto.OfflineStudentId && x.TeacherId == t.Id);
        if (ts == null) return BadRequest("线下学生不存在");

        var already = await db.Bookings.AnyAsync(b => b.TimeSlotId == slotId && b.OfflineStudentId == dto.OfflineStudentId && b.Status != "cancelled");
        if (already) return BadRequest("该学生已在这节课");

        var booking = new Models.Booking {
            StudentId = null, OfflineStudentId = dto.OfflineStudentId,
            TeacherId = t.Id, TimeSlotId = slotId,
            Status = "confirmed", TeacherNote = "老师添加",
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
        };
        db.Bookings.Add(booking);
        slot.Status = "booked";
        await db.SaveChangesAsync();

        // 线下学生已绑定平台账号时发通知
        if (ts.StudentUserId.HasValue) {
            var tn = User.FindFirst(ClaimTypes.Name)?.Value ?? "老师";
            await notif.Notify(ts.StudentUserId.Value, "booking", "老师为你安排了课程",
                $"{tn} 老师把你加入了 {slot.Date} {slot.StartTime}–{slot.EndTime} 的课。", "/courses/my-bookings");
        }
        return Ok(new { booking.Id });
    }

    // ── 线下学生绑定平台账号 ──
    [HttpPost("students/{id}/link-user")]
    public async Task<IActionResult> LinkUser(int id, [FromBody] LinkUserDto dto) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var ts = await db.TeacherStudents.FirstOrDefaultAsync(x => x.Id == id && x.TeacherId == t.Id);
        if (ts == null) return NotFound();
        if (ts.StudentUserId.HasValue) return BadRequest("该学生已绑定平台账号");

        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == dto.Username.Trim());
        if (user == null) return BadRequest("找不到该用户名，请让学生先在平台注册");

        var conflict = await db.TeacherStudents.AnyAsync(x => x.TeacherId == t.Id && x.StudentUserId == user.Id && x.Id != id);
        if (conflict) return BadRequest("该平台用户已与另一个学生档案关联");

        ts.StudentUserId = user.Id;
        await db.SaveChangesAsync();
        return Ok(new { userId = user.Id, username = user.Username, avatarUrl = user.AvatarUrl });
    }

    // ── 查看收到的预约 ──
    [HttpGet("bookings")]
    public async Task<IActionResult> GetBookings([FromQuery] string status = "pending") {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();

        var list = await db.Bookings
            .Where(b => b.TeacherId == t.Id && (status == "all" || b.Status == status))
            .OrderByDescending(b => b.CreatedAt)
            .Select(b => new {
                b.Id, b.Status, b.Note, b.TeacherNote, b.CreatedAt,
                subject = b.Subject != null ? new { b.Subject.Id, b.Subject.Name } : null,
                slot = new { b.TimeSlot.Date, b.TimeSlot.StartTime, b.TimeSlot.EndTime, b.TimeSlot.DurationMinutes, b.TimeSlot.Note },
                student = b.Student != null ? (object)new { b.Student.Id, b.Student.Username, b.Student.AvatarUrl } : null,
                offlineStudent = b.OfflineStudent != null ? (object)new { b.OfflineStudent.Id, b.OfflineStudent.DisplayName } : null,
                defaultFee = b.OfflineStudentId != null
                    ? db.TeacherStudents.Where(ts => ts.Id == b.OfflineStudentId).Select(ts => ts.DefaultFee).FirstOrDefault()
                    : db.TeacherStudents.Where(ts => ts.TeacherId == t.Id && ts.StudentUserId == b.StudentId).Select(ts => ts.DefaultFee).FirstOrDefault()
            })
            .ToListAsync();
        return Ok(list);
    }

    // ── 确认预约 ──
    [HttpPost("bookings/{id}/confirm")]
    public async Task<IActionResult> ConfirmBooking(int id, [FromBody] TeacherNoteDto? dto) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var b = await db.Bookings.Include(b => b.TimeSlot).FirstOrDefaultAsync(b => b.Id == id && b.TeacherId == t.Id);
        if (b == null) return NotFound();
        if (b.Status != "pending") return BadRequest("只能确认待处理的预约");
        b.Status = "confirmed"; b.UpdatedAt = DateTime.UtcNow;
        if (dto?.Note != null) b.TeacherNote = dto.Note;
        await db.SaveChangesAsync();

        var teacherName2 = User.FindFirst(ClaimTypes.Name)?.Value ?? "老师";
        if (b.StudentId.HasValue) {
            await notif.Notify(b.StudentId.Value, "booking", "预约已确认",
                $"{teacherName2} 老师已确认你 {b.TimeSlot.Date} {b.TimeSlot.StartTime}–{b.TimeSlot.EndTime} 的课。", "/courses/my-bookings");
        } else if (b.OfflineStudentId.HasValue) {
            var offTs = await db.TeacherStudents.FirstOrDefaultAsync(x => x.Id == b.OfflineStudentId.Value);
            if (offTs?.StudentUserId != null)
                await notif.Notify(offTs.StudentUserId.Value, "booking", "预约已确认",
                    $"{teacherName2} 老师已确认你 {b.TimeSlot.Date} {b.TimeSlot.StartTime}–{b.TimeSlot.EndTime} 的课。", "/courses/my-bookings");
        }
        return Ok();
    }

    // ── 拒绝/取消预约 ──
    [HttpPost("bookings/{id}/cancel")]
    public async Task<IActionResult> CancelBooking(int id, [FromBody] TeacherNoteDto? dto) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var b = await db.Bookings.Include(b => b.TimeSlot).FirstOrDefaultAsync(b => b.Id == id && b.TeacherId == t.Id);
        if (b == null) return NotFound();
        if (b.Status == "cancelled") return BadRequest("已取消");
        b.Status = "cancelled"; b.UpdatedAt = DateTime.UtcNow;
        if (dto?.Note != null) b.TeacherNote = dto.Note;
        var hasOther = await db.Bookings.AnyAsync(x => x.TimeSlotId == b.TimeSlotId && x.Id != b.Id && x.Status != "cancelled");
        b.TimeSlot.Status = hasOther ? "booked" : "available";
        await db.SaveChangesAsync();

        var teacherName3 = User.FindFirst(ClaimTypes.Name)?.Value ?? "老师";
        var reason3 = string.IsNullOrWhiteSpace(dto?.Note) ? "" : $"原因：{dto!.Note}";
        if (b.StudentId.HasValue) {
            await notif.Notify(b.StudentId.Value, "booking", "预约被取消",
                $"{teacherName3} 老师取消了你 {b.TimeSlot.Date} {b.TimeSlot.StartTime}–{b.TimeSlot.EndTime} 的课。{reason3}", "/courses/my-bookings");
        } else if (b.OfflineStudentId.HasValue) {
            var offTs = await db.TeacherStudents.FirstOrDefaultAsync(x => x.Id == b.OfflineStudentId.Value);
            if (offTs?.StudentUserId != null)
                await notif.Notify(offTs.StudentUserId.Value, "booking", "预约被取消",
                    $"{teacherName3} 老师取消了你 {b.TimeSlot.Date} {b.TimeSlot.StartTime}–{b.TimeSlot.EndTime} 的课。{reason3}", "/courses/my-bookings");
        }
        return Ok();
    }

    // ════════════════ 课时结算 / 学生管理（全老师端，学生不可见）════════════════

    // 把"有预约但未建档"的平台学生补成 TeacherStudent，保证名单完整
    async Task SyncRosterFromBookings(int teacherId) {
        var bookedUserIds = await db.Bookings
            .Where(b => b.TeacherId == teacherId && b.StudentId != null)
            .Select(b => b.StudentId!.Value).Distinct().ToListAsync();
        if (bookedUserIds.Count == 0) return;
        var existing = await db.TeacherStudents
            .Where(ts => ts.TeacherId == teacherId && ts.StudentUserId != null)
            .Select(ts => ts.StudentUserId!.Value).ToListAsync();
        var missing = bookedUserIds.Except(existing).ToList();
        if (missing.Count == 0) return;
        var users = await db.Users.Where(u => missing.Contains(u.Id))
            .Select(u => new { u.Id, u.Username }).ToListAsync();
        foreach (var u in users)
            db.TeacherStudents.Add(new Models.TeacherStudent {
                TeacherId = teacherId, StudentUserId = u.Id, DisplayName = u.Username, CreatedAt = DateTime.UtcNow
            });
        await db.SaveChangesAsync();
    }

    // ── 学生名单 + 每人结算汇总 ──
    [HttpGet("students")]
    public async Task<IActionResult> GetStudents([FromQuery] bool includeArchived = false) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();
        await SyncRosterFromBookings(t.Id);

        // SQLite 不支持 DB 端 SUM(decimal)，金额一律拉到内存聚合
        var students = await db.TeacherStudents
            .Where(ts => ts.TeacherId == t.Id && (includeArchived || !ts.IsArchived))
            .Select(ts => new {
                ts.Id, ts.DisplayName, ts.Phone, ts.Note, ts.IsArchived, ts.StudentUserId, ts.DefaultFee,
                avatarUrl = ts.StudentUser != null ? ts.StudentUser.AvatarUrl : null
            })
            .ToListAsync();
        var ids = students.Select(s => s.Id).ToList();
        var lessons = await db.Lessons.Where(l => ids.Contains(l.TeacherStudentId))
            .Select(l => new { l.TeacherStudentId, l.Fee, l.LessonDate, l.DurationMinutes, l.Id }).ToListAsync();
        var payments = await db.Payments.Where(p => ids.Contains(p.TeacherStudentId))
            .Select(p => new { p.TeacherStudentId, p.Amount }).ToListAsync();
        var lessonsByS = lessons.GroupBy(l => l.TeacherStudentId).ToDictionary(g => g.Key, g => g.ToList());
        var paidByS = payments.GroupBy(p => p.TeacherStudentId).ToDictionary(g => g.Key, g => g.Sum(p => p.Amount));

        var result = students.Select(s => {
            var ls = lessonsByS.GetValueOrDefault(s.Id) ?? new();
            var due = ls.Sum(l => l.Fee);
            var paid = paidByS.GetValueOrDefault(s.Id, 0m);
            var last = ls.OrderByDescending(l => l.LessonDate).ThenByDescending(l => l.Id).FirstOrDefault();
            return new {
                s.Id, s.DisplayName, s.Phone, s.Note, s.IsArchived, s.StudentUserId, s.avatarUrl, s.DefaultFee,
                lessonCount = ls.Count, totalDue = due, totalPaid = paid, balance = paid - due,
                lastLessonDate = last != null ? last.LessonDate : null,
                lastFee = last != null ? (decimal?)last.Fee : null,
                lastDuration = last != null ? last.DurationMinutes : null
            };
        })
        .OrderByDescending(s => s.balance < 0)   // 欠费的排前面
        .ThenBy(s => s.DisplayName)
        .ToList();
        return Ok(result);
    }

    // ── 手动添加线下学生 ──
    [HttpPost("students")]
    public async Task<IActionResult> AddStudent([FromBody] AddStudentDto dto) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();
        var name = (dto.DisplayName ?? "").Trim();
        if (name.Length == 0) return BadRequest("请填写学生姓名");
        if (dto.DefaultFee < 0) return BadRequest("默认课时费不能为负");
        var ts = new Models.TeacherStudent {
            TeacherId = t.Id, StudentUserId = null, DisplayName = name,
            Phone = dto.Phone, Note = dto.Note, DefaultFee = dto.DefaultFee, CreatedAt = DateTime.UtcNow
        };
        db.TeacherStudents.Add(ts);
        await db.SaveChangesAsync();
        return Ok(new { ts.Id });
    }

    // ── 修改学生档案（备注名/电话/备注/归档）──
    [HttpPut("students/{id}")]
    public async Task<IActionResult> UpdateStudent(int id, [FromBody] UpdateStudentDto dto) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var ts = await db.TeacherStudents.FirstOrDefaultAsync(x => x.Id == id && x.TeacherId == t.Id);
        if (ts == null) return NotFound();
        if (dto.DisplayName != null) {
            var name = dto.DisplayName.Trim();
            if (name.Length == 0) return BadRequest("姓名不能为空");
            ts.DisplayName = name;
        }
        if (dto.Phone != null) ts.Phone = dto.Phone;
        if (dto.Note != null) ts.Note = dto.Note;
        if (dto.DefaultFee.HasValue) ts.DefaultFee = dto.DefaultFee.Value < 0 ? null : dto.DefaultFee.Value;
        if (dto.IsArchived.HasValue) ts.IsArchived = dto.IsArchived.Value;
        await db.SaveChangesAsync();
        return Ok();
    }

    // ── 学生详情：账本 + 课时明细 + 缴费明细 ──
    [HttpGet("students/{id}")]
    public async Task<IActionResult> GetStudentDetail(int id) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var ts = await db.TeacherStudents.Include(x => x.StudentUser)
            .FirstOrDefaultAsync(x => x.Id == id && x.TeacherId == t.Id);
        if (ts == null) return NotFound();

        var lessons = await db.Lessons.Where(l => l.TeacherStudentId == id)
            .OrderByDescending(l => l.LessonDate).ThenByDescending(l => l.Id)
            .Select(l => new { l.Id, l.LessonDate, l.DurationMinutes, l.Fee, l.Note, l.BookingId })
            .ToListAsync();
        var payments = await db.Payments.Where(p => p.TeacherStudentId == id)
            .OrderByDescending(p => p.PaidDate).ThenByDescending(p => p.Id)
            .Select(p => new { p.Id, p.Amount, p.PaidDate, p.Note })
            .ToListAsync();

        var totalDue = lessons.Sum(l => l.Fee);
        var totalPaid = payments.Sum(p => p.Amount);
        return Ok(new {
            ts.Id, ts.DisplayName, ts.Phone, ts.Note, ts.IsArchived, ts.StudentUserId, ts.DefaultFee,
            avatarUrl = ts.StudentUser != null ? ts.StudentUser.AvatarUrl : null,
            username = ts.StudentUser != null ? ts.StudentUser.Username : null,
            totalDue, totalPaid, balance = totalPaid - totalDue,
            lessons, payments
        });
    }

    // ── 手动补一节课时 ──
    [HttpPost("students/{id}/lessons")]
    public async Task<IActionResult> AddLesson(int id, [FromBody] AddLessonDto dto) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var ts = await db.TeacherStudents.FirstOrDefaultAsync(x => x.Id == id && x.TeacherId == t.Id);
        if (ts == null) return NotFound();
        if (string.IsNullOrWhiteSpace(dto.LessonDate)) return BadRequest("请选择上课日期");
        if (dto.Fee < 0) return BadRequest("课时费不能为负");
        var lesson = new Models.Lesson {
            TeacherStudentId = id, LessonDate = dto.LessonDate,
            DurationMinutes = dto.DurationMinutes, Fee = dto.Fee, Note = dto.Note,
            CreatedAt = DateTime.UtcNow
        };
        db.Lessons.Add(lesson);
        await db.SaveChangesAsync();
        return Ok(new { lesson.Id });
    }

    // ── 批量补录外部课时（一次多节，可选同时记一笔缴费）──
    [HttpPost("students/{id}/lessons/batch")]
    public async Task<IActionResult> AddLessonsBatch(int id, [FromBody] AddLessonsBatchDto dto) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var ts = await db.TeacherStudents.FirstOrDefaultAsync(x => x.Id == id && x.TeacherId == t.Id);
        if (ts == null) return NotFound();
        if (dto.Lessons == null || dto.Lessons.Count == 0) return BadRequest("请至少添加一节课");
        foreach (var l in dto.Lessons) {
            if (string.IsNullOrWhiteSpace(l.LessonDate)) return BadRequest("每节课都需选择上课日期");
            if (l.Fee < 0) return BadRequest("课时费不能为负");
        }
        var now = DateTime.UtcNow;
        foreach (var l in dto.Lessons) {
            db.Lessons.Add(new Models.Lesson {
                TeacherStudentId = id, LessonDate = l.LessonDate,
                DurationMinutes = l.DurationMinutes, Fee = l.Fee, Note = l.Note, CreatedAt = now
            });
        }
        // 可选：当场收钱，顺带记一笔缴费
        if (dto.Payment != null && dto.Payment.Amount > 0) {
            if (string.IsNullOrWhiteSpace(dto.Payment.PaidDate)) return BadRequest("请选择缴费日期");
            db.Payments.Add(new Models.Payment {
                TeacherStudentId = id, Amount = dto.Payment.Amount,
                PaidDate = dto.Payment.PaidDate, Note = dto.Payment.Note, CreatedAt = now
            });
        }
        await db.SaveChangesAsync();
        return Ok(new { lessons = dto.Lessons.Count, paid = dto.Payment?.Amount ?? 0m });
    }

    // ── 撤销结课（退回已确认 + 删除对应课时记录）──
    [HttpPost("bookings/{id}/uncomplete")]
    public async Task<IActionResult> UncompleteBooking(int id) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var b = await db.Bookings.FirstOrDefaultAsync(x => x.Id == id && x.TeacherId == t.Id);
        if (b == null) return NotFound();
        if (b.Status != "completed") return BadRequest("只能撤销已结课的预约");
        var lesson = await db.Lessons.FirstOrDefaultAsync(l => l.BookingId == id);
        if (lesson != null) db.Lessons.Remove(lesson);
        b.Status = "confirmed"; b.CompletedAt = null; b.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok();
    }

    // ── 补录的外部课时列表（BookingId 为空的 Lesson）──
    [HttpGet("external-lessons")]
    public async Task<IActionResult> GetExternalLessons() {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();

        var lessons = await db.Lessons
            .Where(l => l.TeacherStudent.TeacherId == t.Id && l.BookingId == null)
            .OrderByDescending(l => l.LessonDate).ThenByDescending(l => l.Id)
            .Select(l => new {
                l.Id, l.LessonDate, l.DurationMinutes, l.Fee, l.Note,
                student = new {
                    l.TeacherStudent.Id, l.TeacherStudent.DisplayName,
                    avatarUrl = l.TeacherStudent.StudentUser != null ? l.TeacherStudent.StudentUser.AvatarUrl : null,
                    isOffline = l.TeacherStudent.StudentUserId == null
                }
            })
            .ToListAsync();
        return Ok(lessons);
    }

    // ── 修改课时（纠错：日期/课时费/时长/备注）──
    [HttpPut("lessons/{id}")]
    public async Task<IActionResult> UpdateLesson(int id, [FromBody] UpdateLessonDto dto) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var l = await db.Lessons.Include(x => x.TeacherStudent)
            .FirstOrDefaultAsync(x => x.Id == id && x.TeacherStudent.TeacherId == t.Id);
        if (l == null) return NotFound();
        if (dto.LessonDate != null) {
            if (string.IsNullOrWhiteSpace(dto.LessonDate)) return BadRequest("请选择上课日期");
            l.LessonDate = dto.LessonDate;
        }
        if (dto.Fee.HasValue) {
            if (dto.Fee.Value < 0) return BadRequest("课时费不能为负");
            l.Fee = dto.Fee.Value;
        }
        if (dto.DurationMinutes != null) l.DurationMinutes = dto.DurationMinutes > 0 ? dto.DurationMinutes : null;
        if (dto.Note != null) l.Note = dto.Note.Trim().Length == 0 ? null : dto.Note.Trim();
        await db.SaveChangesAsync();
        return Ok();
    }

    // ── 删除课时（纠错；若关联预约则回退预约状态）──
    [HttpDelete("lessons/{id}")]
    public async Task<IActionResult> DeleteLesson(int id) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var l = await db.Lessons.Include(x => x.TeacherStudent)
            .FirstOrDefaultAsync(x => x.Id == id && x.TeacherStudent.TeacherId == t.Id);
        if (l == null) return NotFound();
        if (l.BookingId != null) {
            var b = await db.Bookings.FirstOrDefaultAsync(x => x.Id == l.BookingId);
            if (b != null && b.Status == "completed") { b.Status = "confirmed"; b.CompletedAt = null; }
        }
        db.Lessons.Remove(l);
        await db.SaveChangesAsync();
        return Ok();
    }

    // ── 记一笔缴费 ──
    [HttpPost("students/{id}/payments")]
    public async Task<IActionResult> AddPayment(int id, [FromBody] AddPaymentDto dto) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var ts = await db.TeacherStudents.FirstOrDefaultAsync(x => x.Id == id && x.TeacherId == t.Id);
        if (ts == null) return NotFound();
        if (string.IsNullOrWhiteSpace(dto.PaidDate)) return BadRequest("请选择缴费日期");
        if (dto.Amount <= 0) return BadRequest("缴费金额必须大于 0");
        var p = new Models.Payment {
            TeacherStudentId = id, Amount = dto.Amount, PaidDate = dto.PaidDate, Note = dto.Note,
            CreatedAt = DateTime.UtcNow
        };
        db.Payments.Add(p);
        await db.SaveChangesAsync();
        return Ok(new { p.Id });
    }

    // ── 删除缴费（纠错）──
    [HttpDelete("payments/{id}")]
    public async Task<IActionResult> DeletePayment(int id) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var p = await db.Payments.Include(x => x.TeacherStudent)
            .FirstOrDefaultAsync(x => x.Id == id && x.TeacherStudent.TeacherId == t.Id);
        if (p == null) return NotFound();
        db.Payments.Remove(p);
        await db.SaveChangesAsync();
        return Ok();
    }

    // ── 完成上课并记课时（产生应收）──
    [HttpPost("bookings/{id}/complete")]
    public async Task<IActionResult> CompleteBooking(int id, [FromBody] CompleteBookingDto dto) {
        var t = await MyProfile();
        if (t == null) return Forbid();
        var b = await db.Bookings.Include(b => b.TimeSlot).FirstOrDefaultAsync(b => b.Id == id && b.TeacherId == t.Id);
        if (b == null) return NotFound();
        if (b.Status != "confirmed") return BadRequest("只能完成已确认的预约");
        if (dto.Fee < 0) return BadRequest("课时费不能为负");
        if (await db.Lessons.AnyAsync(l => l.BookingId == id)) return BadRequest("该课程已记过课时");

        // 取/建该学生的档案（线下学生直接用 OfflineStudentId；平台学生按原逻辑）
        Models.TeacherStudent? ts;
        if (b.OfflineStudentId.HasValue) {
            ts = await db.TeacherStudents.FirstOrDefaultAsync(x => x.Id == b.OfflineStudentId.Value && x.TeacherId == t.Id);
            if (ts == null) return BadRequest("找不到线下学生档案");
        } else {
            ts = await db.TeacherStudents.FirstOrDefaultAsync(x => x.TeacherId == t.Id && x.StudentUserId == b.StudentId);
            if (ts == null) {
                var u = await db.Users.FirstOrDefaultAsync(u => u.Id == b.StudentId);
                ts = new Models.TeacherStudent {
                    TeacherId = t.Id, StudentUserId = b.StudentId,
                    DisplayName = u != null ? u.Username : "学生", CreatedAt = DateTime.UtcNow
                };
                db.TeacherStudents.Add(ts);
                await db.SaveChangesAsync();
            }
        }

        db.Lessons.Add(new Models.Lesson {
            TeacherStudentId = ts.Id, BookingId = b.Id,
            LessonDate = b.TimeSlot.Date, DurationMinutes = b.TimeSlot.DurationMinutes,
            Fee = dto.Fee, Note = dto.Note, CreatedAt = DateTime.UtcNow
        });
        b.Status = "completed"; b.CompletedAt = DateTime.UtcNow; b.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { studentId = ts.Id });
    }

    // ── 每月实时统计 ──
    [HttpGet("stats")]
    public async Task<IActionResult> GetStats([FromQuery] int? year, [FromQuery] int? month) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();
        var local = DateTime.UtcNow.AddHours(8);   // 站点时区（中国）
        int y = year ?? local.Year, mo = month ?? local.Month;
        var prefix = $"{y:D4}-{mo:D2}";

        // SQLite 不支持 DB 端 SUM(decimal)，金额一律拉到内存聚合
        var roster = await db.TeacherStudents.Where(x => x.TeacherId == t.Id)
            .Select(x => new { x.Id, x.IsArchived }).ToListAsync();
        var studentIds = roster.Select(x => x.Id).ToList();
        var activeIds = roster.Where(x => !x.IsArchived).Select(x => x.Id).ToHashSet();

        var monthLessons = await db.Lessons
            .Where(l => studentIds.Contains(l.TeacherStudentId) && l.LessonDate.StartsWith(prefix))
            .Select(l => new { l.Fee, l.DurationMinutes, l.TeacherStudentId })
            .ToListAsync();
        var monthPaid = (await db.Payments
            .Where(p => studentIds.Contains(p.TeacherStudentId) && p.PaidDate.StartsWith(prefix))
            .Select(p => p.Amount).ToListAsync()).Sum();

        // 全局欠费/预存（逐学生汇总，非归档）
        var allLessons = await db.Lessons.Where(l => activeIds.Contains(l.TeacherStudentId))
            .Select(l => new { l.TeacherStudentId, l.Fee }).ToListAsync();
        var allPayments = await db.Payments.Where(p => activeIds.Contains(p.TeacherStudentId))
            .Select(p => new { p.TeacherStudentId, p.Amount }).ToListAsync();
        var dueByS = allLessons.GroupBy(l => l.TeacherStudentId).ToDictionary(g => g.Key, g => g.Sum(x => x.Fee));
        var paidByS = allPayments.GroupBy(p => p.TeacherStudentId).ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));
        decimal totalOutstanding = 0m, totalPrepaid = 0m;
        foreach (var sid in activeIds) {
            var bal = paidByS.GetValueOrDefault(sid, 0m) - dueByS.GetValueOrDefault(sid, 0m);
            if (bal < 0) totalOutstanding += -bal; else totalPrepaid += bal;
        }

        return Ok(new {
            month = prefix,
            lessonCount = monthLessons.Count,
            lessonMinutes = monthLessons.Sum(l => l.DurationMinutes ?? 0),
            monthDue = monthLessons.Sum(l => l.Fee),
            monthPaid,
            activeStudents = monthLessons.Select(l => l.TeacherStudentId).Distinct().Count(),
            totalOutstanding,
            totalPrepaid,
            totalStudents = activeIds.Count
        });
    }

    // ── 当月全员汇总（对账单/月度一览表用）──
    [HttpGet("monthly-report")]
    public async Task<IActionResult> MonthlyReport([FromQuery] int? year, [FromQuery] int? month) {
        var t = await MyProfile();
        if (t == null || t.Status != "approved") return Forbid();
        var local = DateTime.UtcNow.AddHours(8);
        int y = year ?? local.Year, mo = month ?? local.Month;
        var prefix = $"{y:D4}-{mo:D2}";

        var students = await db.TeacherStudents.Where(x => x.TeacherId == t.Id && !x.IsArchived)
            .Select(x => new { x.Id, x.DisplayName, x.StudentUserId }).ToListAsync();
        var ids = students.Select(s => s.Id).ToList();
        var lessons = await db.Lessons.Where(l => ids.Contains(l.TeacherStudentId))
            .Select(l => new { l.TeacherStudentId, l.Fee, l.LessonDate }).ToListAsync();
        var payments = await db.Payments.Where(p => ids.Contains(p.TeacherStudentId))
            .Select(p => new { p.TeacherStudentId, p.Amount, p.PaidDate }).ToListAsync();

        var rows = students.Select(s => {
            var sl = lessons.Where(l => l.TeacherStudentId == s.Id).ToList();
            var sp = payments.Where(p => p.TeacherStudentId == s.Id).ToList();
            var monthLessons = sl.Where(l => l.LessonDate.StartsWith(prefix)).ToList();
            var monthPaid = sp.Where(p => p.PaidDate.StartsWith(prefix)).Sum(p => p.Amount);
            return new {
                studentId = s.Id, s.DisplayName, isPlatform = s.StudentUserId != null,
                lessonCount = monthLessons.Count,
                monthDue = monthLessons.Sum(l => l.Fee),
                monthPaid,
                balance = sp.Sum(p => p.Amount) - sl.Sum(l => l.Fee)   // 累计余额（已交−应收）
            };
        })
        .Where(r => r.lessonCount > 0 || r.monthPaid > 0)   // 只列当月有活动的学生
        .OrderByDescending(r => r.monthDue).ThenBy(r => r.DisplayName)
        .ToList();

        return Ok(new {
            month = prefix,
            rows,
            totalLessons = rows.Sum(r => r.lessonCount),
            totalDue = rows.Sum(r => r.monthDue),
            totalPaid = rows.Sum(r => r.monthPaid)
        });
    }

    public record AddStudentDto(string DisplayName, string? Phone, string? Note, decimal? DefaultFee);
    public record UpdateStudentDto(string? DisplayName, string? Phone, string? Note, bool? IsArchived, decimal? DefaultFee);
    public record AddLessonDto(string LessonDate, decimal Fee, int? DurationMinutes, string? Note);
    public record UpdateLessonDto(string? LessonDate, decimal? Fee, int? DurationMinutes, string? Note);
    public record AddPaymentDto(decimal Amount, string PaidDate, string? Note);
    public record CompleteBookingDto(decimal Fee, string? Note);
    public record AddLessonsBatchDto(List<AddLessonDto> Lessons, AddPaymentDto? Payment);

    public record ApplyDto(string Bio, int[] SubjectIds);
    public record UpdateProfileDto(string Bio, string? AvatarUrl, int[]? SubjectIds);
    public record CreateSlotDto(string Date, string StartTime, string EndTime, string? Note, List<string>? StudentNames);
    public record CreateSlotsBatchDto(List<CreateSlotDto> Slots);
    public record TeacherNoteDto(string? Note);
    public record AddStudentToSlotDto(int StudentUserId, int? SubjectId);
    public record AddOfflineStudentToSlotDto(int OfflineStudentId);
    public record LinkUserDto(string Username);
}

// =====================================================
// Controllers/DevRequestController.cs —— 定制需求接口
// 路由前缀：/api/requests
// 职责：
//   - 公开接口：任何人可提交需求（不需要登录）
//   - 管理员接口：查列表、改状态、删除、统计
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/requests")]
public class DevRequestController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    // 接收前端提交需求的数据格式
    public record SubmitReq(
        string Name, string Contact, string ContactType,
        string Title, string Description, string? Budget);

    // 需求附件允许的文件类型（仅文档与图片，禁止脚本/可执行，降低匿名上传风险）
    private static readonly HashSet<string> AllowedAttachExts = new(StringComparer.OrdinalIgnoreCase) {
        ".xlsx", ".xls", ".csv", ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".txt",
        ".png", ".jpg", ".jpeg", ".gif", ".webp",
    };

    // POST /api/requests/upload —— 上传需求附件（公开，可选，示例文件用）
    [AllowAnonymous]
    [EnableRateLimiting("anon-write")]   // 匿名写磁盘端点必限流,防脚本灌盘
    [HttpPost("upload")]
    [RequestSizeLimit(30L * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 30L * 1024 * 1024)]
    public async Task<IActionResult> UploadAttachment(IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "请选择文件" });
        var ext = Path.GetExtension(file.FileName).ToLower();
        if (string.IsNullOrEmpty(ext) || !AllowedAttachExts.Contains(ext))
            return BadRequest(new { message = "仅支持 Excel / Word / PDF / 图片 等文件" });
        if (file.Length > 30L * 1024 * 1024) return BadRequest(new { message = "文件最大 30MB" });

        var dir = Path.Combine(env.WebRootPath, "uploads", "requests");
        Directory.CreateDirectory(dir);
        var fileName = $"{Guid.NewGuid()}{ext}";
        using var stream = System.IO.File.Create(Path.Combine(dir, fileName));
        await file.CopyToAsync(stream);

        return Ok(new { url = $"/uploads/requests/{fileName}", name = file.FileName });
    }

    // POST /api/requests —— 提交需求（公开，不需要登录）
    [EnableRateLimiting("anon-write")]   // 匿名写库端点限流,防灌垃圾单
    [HttpPost]
    public async Task<IActionResult> Submit([FromBody] SubmitReq req)
    {
        // 服务端校验（和前端校验互为补充，服务端校验不可省略）
        if (string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { message = "请填写称呼" });
        if (string.IsNullOrWhiteSpace(req.Contact))
            return BadRequest(new { message = "请填写联系方式" });
        if (string.IsNullOrWhiteSpace(req.Title))
            return BadRequest(new { message = "请填写需求标题" });
        if (string.IsNullOrWhiteSpace(req.Description) || req.Description.Length < 10)
            return BadRequest(new { message = "需求描述至少10个字" });

        // 登录用户关联账户，方便后续查"我的需求"
        int? userId = null;
        if (User.Identity?.IsAuthenticated == true)
            userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        var r = new DevRequest {
            Name        = req.Name,
            Contact     = req.Contact,
            ContactType = req.ContactType,
            Title       = req.Title,
            Description = req.Description,
            Budget      = req.Budget,
            Status      = "pending",
            CreatedAt   = DateTime.UtcNow,
            UserId      = userId
        };
        db.DevRequests.Add(r);
        await db.SaveChangesAsync();

        // 提交成功后立刻触发灵犀处理（fire-and-forget，不阻塞响应）
        _ = Task.Run(() => {
            try {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo {
                    FileName = "/usr/bin/python3",
                    Arguments = "/opt/gooday/scripts/handle-dev-requests.py",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = false,
                    RedirectStandardError = false
                });
            } catch { /* 触发失败不影响提交结果，cron 兜底 */ }
        });

        return Ok(new { message = "提交成功", id = r.Id });
    }

    // GET /api/requests?status=pending —— 管理员查需求列表
    [Authorize(Roles = "admin")]
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? status)
    {
        var q = db.DevRequests.AsQueryable();
        if (!string.IsNullOrEmpty(status)) q = q.Where(r => r.Status == status);
        var list = await q.OrderByDescending(r => r.CreatedAt).ToListAsync();
        return Ok(list);
    }

    // PUT /api/requests/:id —— 管理员更新需求状态和备注
    [Authorize(Roles = "admin")]
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateReq req)
    {
        var r = await db.DevRequests.FindAsync(id);
        if (r == null) return NotFound();
        // ?? 空合并：如果 req.Status 为 null 就保持原值不变
        r.Status    = req.Status ?? r.Status;
        r.AdminNote = req.AdminNote ?? r.AdminNote;
        await db.SaveChangesAsync();
        return Ok(r);
    }

    // DELETE /api/requests/:id —— 管理员删除需求
    [Authorize(Roles = "admin")]
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var r = await db.DevRequests.FindAsync(id);
        if (r == null) return NotFound();
        db.DevRequests.Remove(r);
        await db.SaveChangesAsync();
        return Ok();
    }

    // GET /api/requests/stats —— 各状态需求数量统计（给后台概览用）
    [Authorize(Roles = "admin")]
    [HttpGet("stats")]
    public async Task<IActionResult> Stats() => Ok(new {
        total   = await db.DevRequests.CountAsync(),
        pending = await db.DevRequests.CountAsync(r => r.Status == "pending"),
        talking = await db.DevRequests.CountAsync(r => r.Status == "talking"),
        done    = await db.DevRequests.CountAsync(r => r.Status == "done")
    });

    // ---- 用户侧：我的需求 ----

    // GET /api/requests/mine —— 当前用户提交的所有需求
    [Authorize]
    [HttpGet("mine")]
    public async Task<IActionResult> Mine()
    {
        var uid = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var list = await db.DevRequests
            .Where(r => r.UserId == uid)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new {
                r.Id, r.Title, r.Description, r.Budget,
                r.Name, r.Contact, r.ContactType,
                r.Status, r.CreatedAt
            })
            .ToListAsync();
        return Ok(list);
    }

    // PUT /api/requests/mine/{id} —— 用户编辑自己的 pending 需求
    [Authorize]
    [HttpPut("mine/{id}")]
    public async Task<IActionResult> UpdateMine(int id, [FromBody] EditMyReq req)
    {
        var uid = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var r = await db.DevRequests.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid);
        if (r == null) return NotFound();
        if (r.Status != "pending") return BadRequest(new { message = "只有待处理的需求可以编辑" });
        r.Title       = req.Title ?? r.Title;
        r.Description = req.Description ?? r.Description;
        r.Budget      = req.Budget ?? r.Budget;
        await db.SaveChangesAsync();
        return Ok();
    }

    // DELETE /api/requests/mine/{id} —— 用户删除自己的 pending 需求
    [Authorize]
    [HttpDelete("mine/{id}")]
    public async Task<IActionResult> DeleteMine(int id)
    {
        var uid = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var r = await db.DevRequests.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid);
        if (r == null) return NotFound();
        if (r.Status != "pending") return BadRequest(new { message = "只有待处理的需求可以删除" });
        db.DevRequests.Remove(r);
        await db.SaveChangesAsync();
        return Ok();
    }
}

public record EditMyReq(string? Title, string? Description, string? Budget);

// 接收更新需求请求的数据格式（放在文件末尾是 C# 顶级 record 的写法）
public record UpdateReq(string? Status, string? AdminNote);

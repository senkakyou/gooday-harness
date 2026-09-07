// =====================================================
// Controllers/TicketEventsController.cs —— 工单事件流水接口（V3）
// 路由前缀：/api/ticket-events
// 职责：
//   - bot 写事件（POST）：流转凭证 / 通知 / 进度上报，落 TicketEvents 表
//   - dispatcher 与报表读事件（GET）：按 status / ticketId / eventType 过滤
//   - dispatcher 标记消费（PUT {id}/processed）
// 设计见 docs/v3/03-message-flow.md、07-database-changes.md
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/ticket-events")]
[Authorize(Roles = "admin,staff")]
public class TicketEventsController(AppDbContext db) : ControllerBase
{
    // ActorId 一律取自 JWT，不信任请求体（审计可靠：谁的 token 写的就是谁）
    private int CurrentUserId()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(id, out var uid) ? uid : 0;
    }

    public record CreateEventReq(
        int TicketId,
        string EventType,
        string? Level,
        string? Payload
    );

    // ---- POST /api/ticket-events —— 写入一条事件 ----
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateEventReq req)
    {
        if (string.IsNullOrWhiteSpace(req.EventType))
            return BadRequest(new { message = "EventType 不能为空" });

        var ev = new TicketEvent
        {
            TicketId = req.TicketId,
            EventType = req.EventType.Trim(),
            ActorId = CurrentUserId(),
            Level = string.IsNullOrWhiteSpace(req.Level) ? null : req.Level.Trim(),
            Payload = req.Payload,
            Status = "new",
            CreatedAt = DateTime.UtcNow,
        };
        db.TicketEvents.Add(ev);
        await db.SaveChangesAsync();
        return Ok(new { id = ev.Id, createdAt = ev.CreatedAt });
    }

    // ---- GET /api/ticket-events —— 查询事件 ----
    // 过滤参数：status / ticketId / eventType / since（CreatedAt >= since）/ limit（默认200，最大1000）
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery] int? ticketId,
        [FromQuery] string? eventType,
        [FromQuery] string? since,
        [FromQuery] int limit = 200)
    {
        if (limit < 1) limit = 1;
        if (limit > 1000) limit = 1000;

        var q = db.TicketEvents.AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(e => e.Status == status);
        if (ticketId.HasValue) q = q.Where(e => e.TicketId == ticketId.Value);
        if (!string.IsNullOrWhiteSpace(eventType)) q = q.Where(e => e.EventType == eventType);
        if (!string.IsNullOrWhiteSpace(since) && DateTime.TryParse(since, out var sinceDt))
        {
            var sinceUtc = DateTime.SpecifyKind(sinceDt, DateTimeKind.Utc);
            q = q.Where(e => e.CreatedAt >= sinceUtc);
        }

        // status='new' 时按时间正序（dispatcher 先进先出消费）；否则倒序（看最近）
        q = status == "new" ? q.OrderBy(e => e.CreatedAt) : q.OrderByDescending(e => e.CreatedAt);

        var rows = await q.Take(limit).ToListAsync();
        return Ok(rows);
    }

    // ---- PUT /api/ticket-events/{id}/status —— 标记消费状态（dispatcher 用）----
    public record MarkReq(string Status);

    [HttpPut("{id:int}/status")]
    public async Task<IActionResult> Mark(int id, [FromBody] MarkReq req)
    {
        var ev = await db.TicketEvents.FindAsync(id);
        if (ev == null) return NotFound(new { message = "事件不存在" });
        var s = (req.Status ?? "").Trim();
        if (s != "new" && s != "processed" && s != "skipped")
            return BadRequest(new { message = "Status 只能是 new/processed/skipped" });
        ev.Status = s;
        ev.ProcessedAt = s == "new" ? null : DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { id = ev.Id, status = ev.Status });
    }
}

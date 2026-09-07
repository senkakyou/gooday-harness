// =====================================================
// Controllers/ClientsController.cs —— 客户档案接口
// 路由前缀：/api/clients
// 职责：
//   - 客户档案 CRUD（admin 权限）
//   - Upsert 接口（如意建工单时联动调用）
//   - 客户工单历史聚合
//   - AI 画像摘要存储（由 Python 脚本写入）
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/clients")]
[Authorize(Roles = "admin,staff")]
public class ClientsController(AppDbContext db) : ControllerBase
{
    // ---- DTO ----
    public record CreateClientReq(
        string Name,
        string Contact,
        string ContactType,
        int? UserId,
        string? Source,
        string? Status,
        string? Tags,
        string? Budget,
        string? PreferredContact,
        string? DecisionStyle,
        string? TechLevel,
        string? PreferredStyle,
        string? AdminNote
    );

    public record UpdateClientReq(
        string? Name,
        string? Contact,
        string? ContactType,
        string? Status,
        string? Tags,
        string? Budget,
        string? PreferredContact,
        string? DecisionStyle,
        string? TechLevel,
        string? PreferredStyle,
        string? AdminNote
    );

    public record UpsertClientReq(
        string Name,
        string Contact,
        string ContactType,
        int? UserId,
        string? Source,
        string? Tags,
        string? Budget
    );

    public record SetSummaryReq(string Summary);

    // ---- 工具方法：构造列表条目 DTO ----
    private static object ToListItem(Client c) => new {
        c.Id, c.Name, c.Contact, c.ContactType,
        c.UserId, c.Status, c.Source, c.Tags,
        c.Budget, c.AiSummary, c.AiSummaryUpdatedAt,
        c.CreatedAt, c.LastActiveAt
    };

    // ---- GET /api/clients —— 客户列表 ----
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery] string? q,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 30)
    {
        var query = db.Clients.AsQueryable();
        if (!string.IsNullOrEmpty(status))
            query = query.Where(c => c.Status == status);
        if (!string.IsNullOrEmpty(q))
            query = query.Where(c =>
                c.Name.Contains(q) || c.Contact.Contains(q) || (c.Tags != null && c.Tags.Contains(q)));

        var total = await query.CountAsync();
        var list = await query
            .OrderByDescending(c => c.LastActiveAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(c => new {
                c.Id, c.Name, c.Contact, c.ContactType,
                c.UserId, c.Status, c.Source, c.Tags,
                c.Budget, c.AiSummary, c.AiSummaryUpdatedAt,
                c.CreatedAt, c.LastActiveAt
            })
            .ToListAsync();

        return Ok(new { total, page, pageSize, list });
    }

    // ---- GET /api/clients/{id} —— 客户详情（含工单历史）----
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(int id)
    {
        var c = await db.Clients
            .Include(c => c.User)
            .FirstOrDefaultAsync(c => c.Id == id);
        if (c == null) return NotFound(new { message = "客户不存在" });

        // 工单历史
        var tickets = await db.Tickets
            .Where(t => t.ClientId == c.UserId || t.ClientName == c.Name || t.ClientContact == c.Contact)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new {
                t.Id, t.TicketNo, t.Title, t.Status, t.Priority,
                t.Budget, t.EstimatedPrice, t.Source,
                t.CreatedAt, t.UpdatedAt, t.DueAt
            })
            .ToListAsync();

        // 统计
        var ticketTotal = tickets.Count;
        var ticketDone  = tickets.Count(t => t.Status == "done");
        var totalAmount = tickets.Sum(t => t.EstimatedPrice ?? 0);

        return Ok(new {
            c.Id, c.Name, c.Contact, c.ContactType,
            c.UserId, UserUsername = c.User?.Username,
            c.Status, c.Source, c.Tags,
            c.PreferredContact, c.Budget, c.DecisionStyle, c.TechLevel, c.PreferredStyle,
            c.AiSummary, c.AiSummaryUpdatedAt,
            c.AdminNote,
            c.CreatedAt, c.LastActiveAt,
            tickets,
            stats = new { ticketTotal, ticketDone, totalAmount }
        });
    }

    // ---- POST /api/clients —— 创建客户 ----
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateClientReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { message = "客户姓名不能为空" });

        var client = new Client
        {
            Name            = req.Name,
            Contact         = req.Contact ?? "",
            ContactType     = req.ContactType ?? "wechat",
            UserId          = req.UserId,
            Source          = req.Source ?? "admin",
            Status          = req.Status ?? "prospect",
            Tags            = req.Tags,
            Budget          = req.Budget,
            PreferredContact = req.PreferredContact,
            DecisionStyle   = req.DecisionStyle,
            TechLevel       = req.TechLevel,
            PreferredStyle  = req.PreferredStyle,
            AdminNote       = req.AdminNote,
            CreatedAt       = DateTime.UtcNow,
            LastActiveAt    = DateTime.UtcNow,
        };
        db.Clients.Add(client);
        await db.SaveChangesAsync();
        return Ok(new { message = "客户已建档", id = client.Id });
    }

    // ---- POST /api/clients/upsert —— 如意建工单时联动建档（按 Contact 去重）----
    [HttpPost("upsert")]
    public async Task<IActionResult> Upsert([FromBody] UpsertClientReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { message = "客户姓名不能为空" });

        // 按联系方式去重（精确匹配非空 contact）
        Client? existing = null;
        if (!string.IsNullOrEmpty(req.Contact))
            existing = await db.Clients.FirstOrDefaultAsync(c => c.Contact == req.Contact);

        // 也尝试按 UserId 去重
        if (existing == null && req.UserId != null)
            existing = await db.Clients.FirstOrDefaultAsync(c => c.UserId == req.UserId);

        if (existing != null)
        {
            // 更新活跃时间，补全空字段
            existing.LastActiveAt = DateTime.UtcNow;
            if (string.IsNullOrEmpty(existing.Contact) && !string.IsNullOrEmpty(req.Contact))
                existing.Contact = req.Contact;
            if (existing.UserId == null && req.UserId != null)
                existing.UserId = req.UserId;
            if (string.IsNullOrEmpty(existing.Budget) && !string.IsNullOrEmpty(req.Budget))
                existing.Budget = req.Budget;
            // 一旦有工单就升为 active
            if (existing.Status == "prospect") existing.Status = "active";
            await db.SaveChangesAsync();
            return Ok(new { message = "已更新", id = existing.Id, isNew = false });
        }

        var client = new Client
        {
            Name         = req.Name,
            Contact      = req.Contact ?? "",
            ContactType  = req.ContactType ?? "wechat",
            UserId       = req.UserId,
            Source       = req.Source ?? "ruyi",
            Status       = "active",
            Budget       = req.Budget,
            CreatedAt    = DateTime.UtcNow,
            LastActiveAt = DateTime.UtcNow,
        };
        db.Clients.Add(client);
        await db.SaveChangesAsync();
        return Ok(new { message = "已建档", id = client.Id, isNew = true });
    }

    // ---- PUT /api/clients/{id} —— 更新客户档案 ----
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateClientReq req)
    {
        var c = await db.Clients.FindAsync(id);
        if (c == null) return NotFound(new { message = "客户不存在" });

        if (req.Name != null)            c.Name = req.Name;
        if (req.Contact != null)         c.Contact = req.Contact;
        if (req.ContactType != null)     c.ContactType = req.ContactType;
        if (req.Status != null)          c.Status = req.Status;
        if (req.Tags != null)            c.Tags = req.Tags;
        if (req.Budget != null)          c.Budget = req.Budget;
        if (req.PreferredContact != null) c.PreferredContact = req.PreferredContact;
        if (req.DecisionStyle != null)   c.DecisionStyle = req.DecisionStyle;
        if (req.TechLevel != null)       c.TechLevel = req.TechLevel;
        if (req.PreferredStyle != null)  c.PreferredStyle = req.PreferredStyle;
        if (req.AdminNote != null)       c.AdminNote = req.AdminNote;

        await db.SaveChangesAsync();
        return Ok(new { message = "更新成功" });
    }

    // ---- DELETE /api/clients/{id} —— 删除客户档案 ----
    [Authorize(Roles = "admin")]
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var c = await db.Clients.FindAsync(id);
        if (c == null) return NotFound(new { message = "客户不存在" });
        db.Clients.Remove(c);
        await db.SaveChangesAsync();
        return Ok(new { message = "已删除" });
    }

    // ---- PUT /api/clients/{id}/ai-summary —— 存储 AI 画像摘要（Python 脚本调用）----
    [HttpPut("{id}/ai-summary")]
    public async Task<IActionResult> SetAiSummary(int id, [FromBody] SetSummaryReq req)
    {
        var c = await db.Clients.FindAsync(id);
        if (c == null) return NotFound(new { message = "客户不存在" });
        c.AiSummary = req.Summary;
        c.AiSummaryUpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { message = "画像已更新" });
    }

    // ---- GET /api/clients/{id}/summary-context —— 给 AI 脚本提供原始上下文 ----
    // 返回工单历史 + 近期私信摘要，供 Python 脚本调用 Claude 生成 AiSummary
    [HttpGet("{id}/summary-context")]
    public async Task<IActionResult> SummaryContext(int id)
    {
        var c = await db.Clients.FindAsync(id);
        if (c == null) return NotFound(new { message = "客户不存在" });

        var tickets = await db.Tickets
            .Where(t => t.ClientId == c.UserId || t.ClientName == c.Name || t.ClientContact == c.Contact)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new { t.TicketNo, t.Title, t.Description, t.Status, t.Budget, t.EstimatedPrice, t.CreatedAt })
            .ToListAsync();

        // 如果有关联用户，取近期私信（与如意的对话）
        object? recentMessages = null;
        if (c.UserId != null)
        {
            var msgs = await db.PrivateMessages
                .Where(m => (m.SenderId == c.UserId || m.ReceiverId == c.UserId) && m.SenderId != 1 && m.ReceiverId != 1)
                .OrderByDescending(m => m.CreatedAt)
                .Take(30)
                .Select(m => new { m.SenderId, m.SenderUsername, m.Content, m.CreatedAt })
                .ToListAsync();
            recentMessages = msgs;
        }

        return Ok(new {
            clientId = id,
            clientName = c.Name,
            contact = c.Contact,
            tickets,
            recentMessages,
            adminNote = c.AdminNote
        });
    }

    // ---- GET /api/clients/stats —— 概览统计 ----
    [HttpGet("stats")]
    public async Task<IActionResult> Stats()
    {
        var total    = await db.Clients.CountAsync();
        var prospect = await db.Clients.CountAsync(c => c.Status == "prospect");
        var active   = await db.Clients.CountAsync(c => c.Status == "active");
        var vip      = await db.Clients.CountAsync(c => c.Status == "vip");
        var inactive = await db.Clients.CountAsync(c => c.Status == "inactive");
        return Ok(new { total, prospect, active, vip, inactive });
    }
}

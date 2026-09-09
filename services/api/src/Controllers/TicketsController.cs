// =====================================================
// Controllers/TicketsController.cs —— 工单管理接口
// 路由前缀：/api/tickets
// 职责：
//   - 创建工单（admin / staff，如意AI前台使用 staff 权限创建）
//   - 管理员查询、更新、删除工单
//   - 日报接口供灵犀定时汇总推送
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;
using GoodayTools.Services;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/tickets")]
[Authorize(Roles = "admin,staff")]
public class TicketsController(AppDbContext db, DeliveryService delivery) : ControllerBase
{
    // ---- 工单编号生成：GD-YYYYMMDD-NNN ----
    private async Task<string> GenerateTicketNo()
    {
        var today = DateTime.UtcNow.ToString("yyyyMMdd");
        var prefix = $"GD-{today}-";

        // 查今天已有的最大序号
        var todayTickets = await db.Tickets
            .Where(t => t.TicketNo.StartsWith(prefix))
            .OrderByDescending(t => t.TicketNo)
            .Select(t => t.TicketNo)
            .FirstOrDefaultAsync();

        int seq = 1;
        if (todayTickets != null)
        {
            var seqPart = todayTickets.Substring(prefix.Length);
            if (int.TryParse(seqPart, out int parsed)) seq = parsed + 1;
        }

        return $"{prefix}{seq:D3}";
    }

    // ---- 请求/响应 DTO ----
    public record CreateTicketReq(
        string Title,
        string Description,
        string ClientName,
        string ClientContact,
        string ContactType,
        int? ClientId,
        string? Budget,
        string Priority,
        int? DevRequestId,
        string Source,
        string? AdminNote,
        string? DueAt
    );

    public record UpdateTicketReq(
        string? Title,
        string? Description,
        string? Status,
        string? Priority,
        string? Budget,
        decimal? EstimatedPrice,
        string? AdminNote,
        int? AssigneeId,
        string? DueAt,
        // V3：两级状态模型字段（dispatcher 写）
        string? SubStatus = null,
        int? RetryCount = null,
        string? StageDeadline = null
    );

    // V3：只有灵犀(20)/调度器(灵犀身份) 与大海(1) 可改主状态 Status。
    // 其它 bot 只产生事件，状态由 dispatcher 统一推进（防止 V2 的"任意 bot 改任意状态"）。
    private static readonly HashSet<int> _statusWriters = new() { 1, 20 };

    // V3 状态机合法跃迁表（#27 复盘 项二/八/九）：镜像 lingxi-dispatcher.py 的 TRANSITIONS，
    // 各状态加 cancelled 逃生口。未知/遗留 from 状态不拦（避免误伤历史数据）。
    private static readonly Dictionary<string, HashSet<string>> _legalNext = new()
    {
        ["pending"]           = new() { "analyst_complete", "cancelled" },
        ["analyst_complete"]  = new() { "confirmed", "in_progress", "cancelled" },
        ["confirmed"]         = new() { "in_progress", "cancelled" },
        ["in_progress"]       = new() { "delivering", "reviewing", "failed", "cancelled" },
        ["reviewing"]         = new() { "delivering", "failed", "cancelled" },
        ["delivering"]        = new() { "done", "customer_rejected", "cancelled" },
        ["customer_rejected"] = new() { "in_progress", "refunding", "cancelled" },
        ["failed"]            = new() { "refunding", "in_progress", "cancelled" },
        ["refunding"]         = new() { "refunded" },
    };

    private static bool IsLegalTransition(string from, string to)
    {
        if (from == to) return true;
        if (!_legalNext.ContainsKey(from)) return true;   // 未知/遗留状态不拦
        return _legalNext[from].Contains(to);
    }

    // ---- POST /api/tickets —— 创建工单 ----
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateTicketReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Title))
            return BadRequest(new { message = "工单标题不能为空" });
        if (string.IsNullOrWhiteSpace(req.Description))
            return BadRequest(new { message = "需求描述不能为空" });
        if (string.IsNullOrWhiteSpace(req.ClientName) && req.ClientId == null)
            return BadRequest(new { message = "请提供客户信息" });

        DateTime? dueAt = null;
        if (!string.IsNullOrEmpty(req.DueAt) && DateTime.TryParse(req.DueAt, out var parsedDue))
            dueAt = DateTime.SpecifyKind(parsedDue, DateTimeKind.Utc);

        var ticket = new Ticket
        {
            TicketNo      = await GenerateTicketNo(),
            Title         = req.Title,
            Description   = req.Description,
            ClientName    = req.ClientName ?? "",
            ClientContact = req.ClientContact ?? "",
            ContactType   = req.ContactType ?? "wechat",
            ClientId      = req.ClientId,
            Budget        = req.Budget,
            Priority      = req.Priority ?? "normal",
            DevRequestId  = req.DevRequestId,
            Source        = req.Source ?? "admin",
            AdminNote     = req.AdminNote,
            Status        = "pending",
            CreatedAt     = DateTime.UtcNow,
            UpdatedAt     = DateTime.UtcNow,
            DueAt         = dueAt,
        };

        db.Tickets.Add(ticket);
        await db.SaveChangesAsync();

        return Ok(new { message = "工单创建成功", ticketNo = ticket.TicketNo, id = ticket.Id });
    }

    // ---- GET /api/tickets —— 工单列表（支持状态/优先级筛选）----
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery] string? priority,
        [FromQuery] string? source,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        var q = db.Tickets.AsQueryable();
        if (!string.IsNullOrEmpty(status))   q = q.Where(t => t.Status == status);
        if (!string.IsNullOrEmpty(priority)) q = q.Where(t => t.Priority == priority);
        if (!string.IsNullOrEmpty(source))   q = q.Where(t => t.Source == source);

        var total = await q.CountAsync();
        var list = await q
            .OrderByDescending(t => t.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new {
                t.Id, t.TicketNo, t.Title, t.Status, t.Priority,
                t.ClientName, t.ClientContact, t.ContactType, t.ClientId,
                t.Budget, t.EstimatedPrice, t.Source, t.AssigneeId,
                t.CreatedAt, t.UpdatedAt, t.DueAt
            })
            .ToListAsync();

        return Ok(new { total, page, pageSize, list });
    }

    // ---- GET /api/tickets/{id} —— 工单详情 ----
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(int id)
    {
        var t = await db.Tickets
            .Include(t => t.Client)
            .Include(t => t.Assignee)
            .FirstOrDefaultAsync(t => t.Id == id);

        if (t == null) return NotFound(new { message = "工单不存在" });

        return Ok(new {
            t.Id, t.TicketNo, t.Title, t.Description, t.Status, t.Priority,
            t.ClientName, t.ClientContact, t.ContactType,
            t.ClientId, ClientUsername = t.Client?.Username,
            t.Budget, t.EstimatedPrice, t.Source,
            t.DevRequestId, t.AdminNote,
            t.AssigneeId, AssigneeUsername = t.Assignee?.Username,
            t.CreatedAt, t.UpdatedAt, t.DueAt
        });
    }

    // ---- PUT /api/tickets/{id} —— 更新工单 ----
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateTicketReq req)
    {
        var t = await db.Tickets.FindAsync(id);
        if (t == null) return NotFound(new { message = "工单不存在" });

        var oldStatus = t.Status;

        // V3 状态迁移收口：改主状态仅限灵犀/调度器/大海（其它 bot 走事件，由 dispatcher 推进）
        if (req.Status != null && req.Status != oldStatus)
        {
            var uidStr = User.FindFirstValue(ClaimTypes.NameIdentifier);
            int.TryParse(uidStr, out var uid);
            if (!_statusWriters.Contains(uid))
                return StatusCode(403, new { message = "工单主状态由灵犀调度器统一推进，请改为产生事件（POST /api/ticket-events）" });

            var newStatus = req.Status;

            // 合法跃迁校验（非法跃迁一律 400）
            if (!IsLegalTransition(oldStatus, newStatus))
                return BadRequest(new { message = $"非法状态迁移：{oldStatus} → {newStatus}" });

            // 项二：进入 delivering 前必须已实收款（FinanceRecords 有 income & received 且金额 > 0）。
            // 金额>0 不可省：自动建账会对无真实收款的单造出 Amount=0 的 received 记录（见工单25漏洞），
            // 只判 received 会被这种 0 元假记录骗过。
            if (newStatus == "delivering")
            {
                var paid = await db.FinanceRecords.AnyAsync(f =>
                    f.TicketId == t.Id && f.Type == "income" && f.PaymentStatus == "received" && f.Amount > 0);
                if (!paid)
                    return BadRequest(new { message = "未收款（或金额为0），不得进入交付（delivering）" });
            }

            // 项八+九：进入 done 的交付质量闸 + 客户收件确认
            if (newStatus == "done")
            {
                // 收款闸（补漏）：done 必须同样已实收款。否则闸门上线前就卡在 delivering 的历史脏单，
                // 凭 delivering→done 是合法跃迁即可绕过「进 delivering 必须收款」那道闸，未收款直接结单
                // （工单25 GD-20260614-002 即由此绕过）。同样要求金额>0，挡住 0 元自动建账假记录。
                var paidForDone = await db.FinanceRecords.AnyAsync(f =>
                    f.TicketId == t.Id && f.Type == "income" && f.PaymentStatus == "received" && f.Amount > 0);
                if (!paidForDone)
                    return BadRequest(new { message = "未收款（或金额为0），不得结单（done）" });

                var proj = await db.Projects.FirstOrDefaultAsync(p => p.TicketId == t.Id);
                if (proj == null)
                    return BadRequest(new { message = "交付不达标：工单无关联项目，不得结单" });

                var taskCount = await db.ProjectTasks.CountAsync(pt => pt.ProjectId == proj.Id);
                if (taskCount == 0)
                    return BadRequest(new { message = "交付不达标：项目无子任务（未拆分/空壳交付），不得结单" });

                var hasTodo = await db.ProjectTasks.AnyAsync(pt => pt.ProjectId == proj.Id && pt.Status == "todo");
                if (hasTodo)
                    return BadRequest(new { message = "交付不达标：存在未完成（todo）子任务，产物缺失，不得结单" });

                // 项九：交付物送达校验。
                // 【2026-09-09 换判据】：原来查的是「发给客户的私信里含 deliverables 这个词」——
                // 只要那条私信里出现过这个词就算交付了，字符串匹配形同虚设。
                // 现在交付方式改成「上架一件归属客户的私有工具」（docs/decisions/005），
                // 判据也跟着换成查那件工具本身：归属对不对、发布没有、
                // **在线/视频/下载三样齐不齐**（大海定的口径）。
                // 判定在 DeliveryService.BlockDoneReasonAsync，和上架端点共用同一份，
                // 不再出现"闸门和上架各说各话"。
                //
                // · 线下客户（ClientId 为空）：没有平台账号，交付物挂不到谁名下，
                //   仍走人工显式确认（SubStatus=delivered）。不能直接放行——
                //   否则线下单加一条收款就能空跳过交付校验结单（退回-1/洞3）。
                if (t.ClientId != null)
                {
                    var blocked = await delivery.BlockDoneReasonAsync(t);
                    if (blocked != null) return BadRequest(new { message = blocked });
                }
                else if (t.SubStatus != "delivered")
                {
                    return BadRequest(new { message = "线下客户工单须先确认交付（SubStatus=delivered）方可结单（done）" });
                }
            }
        }

        if (req.Title != null)          t.Title = req.Title;
        if (req.Description != null)    t.Description = req.Description;
        if (req.Status != null)         t.Status = req.Status;
        if (req.Priority != null)       t.Priority = req.Priority;
        if (req.Budget != null)         t.Budget = req.Budget;
        if (req.EstimatedPrice != null) t.EstimatedPrice = req.EstimatedPrice;
        if (req.AdminNote != null)      t.AdminNote = req.AdminNote;
        if (req.AssigneeId != null)     t.AssigneeId = req.AssigneeId;
        if (req.SubStatus != null)      t.SubStatus = req.SubStatus.Length == 0 ? null : req.SubStatus;
        if (req.RetryCount != null)     t.RetryCount = req.RetryCount.Value;
        if (!string.IsNullOrEmpty(req.StageDeadline) && DateTime.TryParse(req.StageDeadline, out var sd))
            t.StageDeadline = DateTime.SpecifyKind(sd, DateTimeKind.Utc);
        if (!string.IsNullOrEmpty(req.DueAt) && DateTime.TryParse(req.DueAt, out var due))
            t.DueAt = DateTime.SpecifyKind(due, DateTimeKind.Utc);

        t.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        // 工单变为 done 时，自动生成财务记录（仅在状态变化时触发一次）
        if (oldStatus != "done" && t.Status == "done")
        {
            var amount = t.EstimatedPrice ?? 0m;
            var period = DateTime.UtcNow.ToString("yyyy-MM");
            // 已有该工单的收入记录（如招财在收款时已建账）则不再重复生成
            var existing = await db.FinanceRecords
                .AnyAsync(f => f.TicketId == t.Id && f.Type == "income");

            if (!existing)
            {
                // Tickets.ClientId 指向 Users，FinanceRecords.ClientId 指向 Clients，需按 UserId 映射
                int? financeClientId = t.ClientId == null ? null
                    : await db.Clients.Where(c => c.UserId == t.ClientId)
                              .Select(c => (int?)c.Id).FirstOrDefaultAsync();

                db.FinanceRecords.Add(new FinanceRecord
                {
                    Type          = "income",
                    Amount        = amount,
                    Category      = "project",
                    Title         = $"{t.TicketNo} · {t.Title}",
                    Note          = $"工单完成自动生成，客户：{t.ClientName}",
                    TicketId      = t.Id,
                    ClientId      = financeClientId,
                    PaymentStatus = amount > 0 ? "pending" : "received",
                    Source        = "auto",
                    AccountPeriod = period,
                    CreatedAt     = DateTime.UtcNow,
                    UpdatedAt     = DateTime.UtcNow
                });
                await db.SaveChangesAsync();
            }
        }

        return Ok(new { message = "更新成功" });
    }

    // ---- DELETE /api/tickets/{id} —— 删除工单（仅 admin）----
    [Authorize(Roles = "admin")]
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var t = await db.Tickets.FindAsync(id);
        if (t == null) return NotFound(new { message = "工单不存在" });
        db.Tickets.Remove(t);
        await db.SaveChangesAsync();
        return Ok(new { message = "已删除" });
    }

    // ---- GET /api/tickets/stats —— 工单统计（给灵犀日报 + 管理后台概览）----
    [HttpGet("stats")]
    public async Task<IActionResult> Stats()
    {
        var total      = await db.Tickets.CountAsync();
        var pending    = await db.Tickets.CountAsync(t => t.Status == "pending");
        var confirmed  = await db.Tickets.CountAsync(t => t.Status == "confirmed");
        var inProgress = await db.Tickets.CountAsync(t => t.Status == "in_progress");
        var testing    = await db.Tickets.CountAsync(t => t.Status == "testing");
        var done       = await db.Tickets.CountAsync(t => t.Status == "done");
        var cancelled  = await db.Tickets.CountAsync(t => t.Status == "cancelled");

        return Ok(new { total, pending, confirmed, inProgress, testing, done, cancelled });
    }

    // ---- GET /api/tickets/daily-report —— 日报数据（灵犀每日汇总用）----
    // 返回：今天新建的工单 + 当前所有活跃工单（非done/cancelled）
    [HttpGet("daily-report")]
    public async Task<IActionResult> DailyReport()
    {
        var todayStart = DateTime.UtcNow.Date;

        var newToday = await db.Tickets
            .Where(t => t.CreatedAt >= todayStart)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new {
                t.Id, t.TicketNo, t.Title, t.Status, t.Priority,
                t.ClientName, t.Source, t.Budget, t.CreatedAt
            })
            .ToListAsync();

        var active = await db.Tickets
            .Where(t => t.Status != "done" && t.Status != "cancelled")
            .OrderBy(t => t.Priority == "urgent" ? 0 : t.Priority == "high" ? 1 : t.Priority == "normal" ? 2 : 3)
            .ThenBy(t => t.CreatedAt)
            .Select(t => new {
                t.Id, t.TicketNo, t.Title, t.Status, t.Priority,
                t.ClientName, t.Source, t.Budget, t.CreatedAt, t.DueAt
            })
            .ToListAsync();

        var stats = new {
            total      = await db.Tickets.CountAsync(),
            pending    = await db.Tickets.CountAsync(t => t.Status == "pending"),
            inProgress = await db.Tickets.CountAsync(t => t.Status == "in_progress"),
            done       = await db.Tickets.CountAsync(t => t.Status == "done"),
        };

        return Ok(new {
            date = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            newToday,
            active,
            stats
        });
    }
}

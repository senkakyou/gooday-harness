// =====================================================
// Controllers/FinanceController.cs —— 财务管理接口
// 路由前缀：/api/finance
// 职责：
//   - 财务记录 CRUD（admin only）
//   - 统计：月报、年报、总览
//   - 工单完成时自动生成财务记录（由 TicketsController 调用）
//   - 月报接口供灵犀定时发送
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/finance")]
[Authorize(Roles = "admin")]
public class FinanceController(AppDbContext db) : ControllerBase
{
    // ---- 请求/响应 DTO ----
    public record CreateRecordReq(
        string Type,
        decimal Amount,
        string Category,
        string Title,
        string? Note,
        int? TicketId,
        int? ClientId,
        string PaymentStatus,
        string? PaymentMethod,
        string? AccountPeriod,
        string? ReceivedAt,
        string? EvidenceUrl = null,   // V3 收款升级：付款凭证归档路径
        int? ConfirmedBy = null       // V3：确认人 UserId（审计）
    );

    public record UpdateRecordReq(
        string? Type,
        decimal? Amount,
        string? Category,
        string? Title,
        string? Note,
        string? PaymentStatus,
        string? PaymentMethod,
        string? AccountPeriod,
        string? ReceivedAt
    );

    // ---- GET /api/finance ---- 列表（支持过滤）
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? type,
        [FromQuery] string? paymentStatus,
        [FromQuery] string? period,     // 格式：2026-06
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 30)
    {
        var q = db.FinanceRecords
            .Include(f => f.Ticket)
            .Include(f => f.Client)
            .AsQueryable();

        if (!string.IsNullOrEmpty(type))          q = q.Where(f => f.Type == type);
        if (!string.IsNullOrEmpty(paymentStatus)) q = q.Where(f => f.PaymentStatus == paymentStatus);
        if (!string.IsNullOrEmpty(period))        q = q.Where(f => f.AccountPeriod == period);

        var total = await q.CountAsync();
        var records = await q
            .OrderByDescending(f => f.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return Ok(new { total, records });
    }

    // ---- GET /api/finance/{id} ---- 单条
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(int id)
    {
        var record = await db.FinanceRecords
            .Include(f => f.Ticket)
            .Include(f => f.Client)
            .FirstOrDefaultAsync(f => f.Id == id);

        if (record == null) return NotFound();
        return Ok(record);
    }

    // ---- POST /api/finance ---- 新增
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateRecordReq req)
    {
        // 推断账期
        var period = req.AccountPeriod ?? DateTime.UtcNow.ToString("yyyy-MM");

        var record = new FinanceRecord
        {
            Type          = req.Type,
            Amount        = req.Amount,
            Category      = req.Category,
            Title         = req.Title,
            Note          = req.Note,
            TicketId      = req.TicketId,
            ClientId      = req.ClientId,
            PaymentStatus = req.PaymentStatus,
            PaymentMethod = req.PaymentMethod,
            Source        = "manual",
            AccountPeriod = period,
            CreatedAt     = DateTime.UtcNow,
            UpdatedAt     = DateTime.UtcNow,
            ReceivedAt    = string.IsNullOrEmpty(req.ReceivedAt)
                            ? null
                            : DateTime.Parse(req.ReceivedAt).ToUniversalTime(),
            EvidenceUrl   = req.EvidenceUrl,
            ConfirmedBy   = req.ConfirmedBy
        };

        db.FinanceRecords.Add(record);
        await db.SaveChangesAsync();
        return Ok(record);
    }

    // ---- PUT /api/finance/{id} ---- 修改
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateRecordReq req)
    {
        var record = await db.FinanceRecords.FindAsync(id);
        if (record == null) return NotFound();

        if (req.Type          != null) record.Type          = req.Type;
        if (req.Amount        != null) record.Amount        = req.Amount.Value;
        if (req.Category      != null) record.Category      = req.Category;
        if (req.Title         != null) record.Title         = req.Title;
        if (req.Note          != null) record.Note          = req.Note;
        if (req.PaymentStatus != null) record.PaymentStatus = req.PaymentStatus;
        if (req.PaymentMethod != null) record.PaymentMethod = req.PaymentMethod;
        if (req.AccountPeriod != null) record.AccountPeriod = req.AccountPeriod;
        if (req.ReceivedAt    != null)
            record.ReceivedAt = DateTime.Parse(req.ReceivedAt).ToUniversalTime();
        record.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return Ok(record);
    }

    // ---- DELETE /api/finance/{id} ---- 删除
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var record = await db.FinanceRecords.FindAsync(id);
        if (record == null) return NotFound();
        db.FinanceRecords.Remove(record);
        await db.SaveChangesAsync();
        return Ok(new { message = "已删除" });
    }

    // ---- GET /api/finance/overview ---- 总览统计（年度）
    [HttpGet("overview")]
    public async Task<IActionResult> Overview([FromQuery] int? year)
    {
        var yr = year ?? DateTime.UtcNow.Year;
        var all = await db.FinanceRecords.ToListAsync();

        // 当年全部记录
        var yearRecords = all.Where(f => f.CreatedAt.Year == yr).ToList();

        var totalIncome  = yearRecords.Where(f => f.Type == "income").Sum(f => f.Amount);
        var totalExpense = yearRecords.Where(f => f.Type == "expense").Sum(f => f.Amount);
        var received     = yearRecords.Where(f => f.Type == "income" && f.PaymentStatus == "received").Sum(f => f.Amount);
        var pending      = yearRecords.Where(f => f.Type == "income" && f.PaymentStatus == "pending").Sum(f => f.Amount);

        // 按月分组
        var monthly = yearRecords
            .GroupBy(f => f.CreatedAt.ToString("yyyy-MM"))
            .Select(g => new {
                period  = g.Key,
                income  = g.Where(f => f.Type == "income").Sum(f => f.Amount),
                expense = g.Where(f => f.Type == "expense").Sum(f => f.Amount)
            })
            .OrderBy(x => x.period)
            .ToList();

        // 全局累计
        var cumIncome  = all.Where(f => f.Type == "income").Sum(f => f.Amount);
        var cumExpense = all.Where(f => f.Type == "expense").Sum(f => f.Amount);

        return Ok(new {
            year         = yr,
            totalIncome,
            totalExpense,
            profit       = totalIncome - totalExpense,
            received,
            pending,
            cumIncome,
            cumExpense,
            cumProfit    = cumIncome - cumExpense,
            monthly
        });
    }

    // ---- GET /api/finance/monthly-report ---- 月报（供灵犀发消息）
    [HttpGet("monthly-report")]
    public async Task<IActionResult> MonthlyReport([FromQuery] string? period)
    {
        var p = period ?? DateTime.UtcNow.AddMonths(-1).ToString("yyyy-MM");
        var all = await db.FinanceRecords.ToListAsync();
        var records = all.Where(f => f.AccountPeriod == p).ToList();

        var income  = records.Where(f => f.Type == "income").Sum(f => f.Amount);
        var expense = records.Where(f => f.Type == "expense").Sum(f => f.Amount);
        var received = records.Where(f => f.Type == "income" && f.PaymentStatus == "received").Sum(f => f.Amount);
        var pending  = records.Where(f => f.Type == "income" && f.PaymentStatus == "pending").Sum(f => f.Amount);
        var count   = records.Where(f => f.Type == "income").Count();

        // 今年已有月份累计
        var yr = int.Parse(p.Substring(0, 4));
        var ytd = all.Where(f => f.CreatedAt.Year == yr && f.Type == "income").Sum(f => f.Amount);

        return Ok(new {
            period  = p,
            income,
            expense,
            profit  = income - expense,
            received,
            pending,
            orderCount = count,
            ytdIncome  = ytd,
            details = records.OrderByDescending(f => f.CreatedAt).Select(f => new {
                f.Id, f.Title, f.Type, f.Amount, f.PaymentStatus, f.Category,
                f.AccountPeriod, createdAt = f.CreatedAt
            }).ToList()
        });
    }
}

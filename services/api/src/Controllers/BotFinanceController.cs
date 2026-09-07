// =====================================================
// Controllers/BotFinanceController.cs —— bot 财务写入接口（V3.1 审计 P1①）
// 路由前缀：/api/bot-finance
// 背景（docs/v3/14 审计 + doc06§3）：
//   招财从 admin 降为 staff 后，admin-only 的 FinanceController 对招财返回 403。
//   财务记账改走本端点——按 uid 白名单（招财25 / 大海1）放行写操作，
//   实现"财务岗不再握全站 admin、但仍能记账"的最小授权。
//   读统计/报表仍走 FinanceController（admin / 后台）。
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using GoodayTools.Data;
using GoodayTools.Models;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/bot-finance")]
[Authorize(Roles = "admin,staff")]
public class BotFinanceController(AppDbContext db) : ControllerBase
{
    // 财务写入白名单：仅大海(1)/招财(25)。其余角色（含其它 staff bot）一律 403。
    private static readonly HashSet<int> _financeWriters = new() { 1, 25 };

    private int CurrentUserId()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(id, out var uid) ? uid : 0;
    }

    // ---- POST /api/bot-finance —— 招财/大海 创建财务记录 ----
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] FinanceController.CreateRecordReq req)
    {
        if (!_financeWriters.Contains(CurrentUserId()))
            return StatusCode(403, new { message = "无财务写入权限（仅招财/大海）" });

        // 字段与 FinanceController.Create 一致（Source 保持 manual，对账语义不变）
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
}

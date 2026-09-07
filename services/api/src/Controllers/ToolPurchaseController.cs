// =====================================================
// Controllers/ToolPurchaseController.cs —— 工具付费购买接口
// 路由前缀：/api/purchases
// 职责：处理付费工具的购买流程（人工审核模式）
//
// 流程：
//   用户扫码付款 → 点"我已付款" → Submit() 创建 pending 记录
//   管理员在后台看到记录 → Activate() 激活 → 用户可下载
// =====================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using GoodayTools.Data;
using GoodayTools.Models;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/purchases")]
public class ToolPurchaseController(AppDbContext db) : ControllerBase
{
    // POST /api/purchases —— 用户提交"我已付款"
    [Authorize]
    [HttpPost]
    public async Task<IActionResult> Submit([FromBody] SubmitPurchaseReq req)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var tool = await db.Tools.FindAsync(req.ToolId);
        if (tool == null) return NotFound(new { message = "工具不存在" });
        if (!tool.IsPaid) return BadRequest(new { message = "该工具免费，无需购买" });

        // 已有激活记录：直接告诉用户已购买，不重复创建
        var existing = await db.ToolPurchases.FirstOrDefaultAsync(p =>
            p.UserId == userId && p.ToolId == req.ToolId && p.Status == "activated");
        if (existing != null) return Ok(new { message = "已购买", activated = true });

        // 已有待审核记录：不重复提交
        var pending = await db.ToolPurchases.FirstOrDefaultAsync(p =>
            p.UserId == userId && p.ToolId == req.ToolId && p.Status == "pending");
        if (pending != null) return Ok(new { message = "已提交，等待确认", activated = false });

        // 创建新的购买申请记录
        var purchase = new ToolPurchase {
            UserId = userId, ToolId = req.ToolId,
            Amount = tool.Price,  // 记录当时的价格（防止价格改变后金额不一致）
            Status = "pending",
            CreatedAt = DateTime.UtcNow
        };
        db.ToolPurchases.Add(purchase);
        await db.SaveChangesAsync();
        return Ok(new { message = "提交成功，等待确认", activated = false, id = purchase.Id });
    }

    // GET /api/purchases/check/:toolId —— 检查当前用户是否已购买某工具
    [Authorize]
    [HttpGet("check/{toolId}")]
    public async Task<IActionResult> Check(int toolId)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var activated = await db.ToolPurchases.AnyAsync(p =>
            p.UserId == userId && p.ToolId == toolId && p.Status == "activated");
        return Ok(new { activated });
    }

    // GET /api/purchases/my —— 当前用户的所有购买记录
    [Authorize]
    [HttpGet("my")]
    public async Task<IActionResult> My()
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var list = await db.ToolPurchases
            .Include(p => p.Tool)  // Include：联表查询，把关联的 Tool 数据一起加载
            .Where(p => p.UserId == userId)
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new {
                p.Id, p.ToolId,
                toolName = p.Tool!.Name,
                toolSlug = p.Tool.Slug,
                p.Amount, p.Status, p.CreatedAt, p.ActivatedAt
            })
            .ToListAsync();
        return Ok(list);
    }

    // GET /api/purchases?status=pending —— 管理员查所有购买记录
    [Authorize(Roles = "admin")]
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? status)
    {
        var q = db.ToolPurchases.Include(p => p.User).Include(p => p.Tool).AsQueryable();
        if (!string.IsNullOrEmpty(status)) q = q.Where(p => p.Status == status);
        var list = await q.OrderByDescending(p => p.CreatedAt)
            .Select(p => new {
                p.Id, p.UserId,
                username = p.User!.Username,
                email = p.User.Email,
                p.ToolId,
                toolName = p.Tool!.Name,
                p.Amount, p.Status, p.AdminNote,
                p.CreatedAt, p.ActivatedAt
            }).ToListAsync();
        return Ok(list);
    }

    // PUT /api/purchases/:id/activate —— 管理员激活购买（确认收款）
    [Authorize(Roles = "admin")]
    [HttpPut("{id}/activate")]
    public async Task<IActionResult> Activate(int id, [FromBody] ActivateReq req)
    {
        var p = await db.ToolPurchases.FindAsync(id);
        if (p == null) return NotFound();
        p.Status = "activated";       // 激活后用户可以下载
        p.ActivatedAt = DateTime.UtcNow;
        p.AdminNote = req.Note;       // 如"已确认收款"
        await db.SaveChangesAsync();
        return Ok(new { message = "已激活" });
    }

    // PUT /api/purchases/:id/reject —— 管理员拒绝购买
    [Authorize(Roles = "admin")]
    [HttpPut("{id}/reject")]
    public async Task<IActionResult> Reject(int id, [FromBody] ActivateReq req)
    {
        var p = await db.ToolPurchases.FindAsync(id);
        if (p == null) return NotFound();
        p.Status = "refunded";        // 拒绝状态（字段名叫 refunded，含义是"已处理/退款"）
        p.AdminNote = req.Note;
        await db.SaveChangesAsync();
        return Ok(new { message = "已拒绝" });
    }

    // DELETE /api/purchases/mine/{id} —— 用户取消自己的 pending 购买申请
    [Authorize]
    [HttpDelete("mine/{id}")]
    public async Task<IActionResult> CancelMine(int id)
    {
        var uid = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var p = await db.ToolPurchases.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid);
        if (p == null) return NotFound();
        if (p.Status != "pending") return BadRequest(new { message = "只有待确认的记录可以取消" });
        db.ToolPurchases.Remove(p);
        await db.SaveChangesAsync();
        return Ok();
    }

    // GET /api/purchases/stats —— 购买统计（给后台概览用）
    [Authorize(Roles = "admin")]
    [HttpGet("stats")]
    public async Task<IActionResult> Stats() => Ok(new {
        total    = await db.ToolPurchases.CountAsync(),
        pending  = await db.ToolPurchases.CountAsync(p => p.Status == "pending"),
        activated= await db.ToolPurchases.CountAsync(p => p.Status == "activated"),
        // 只统计已激活的购买金额之和（待确认/拒绝的不算收入）
        revenue  = await db.ToolPurchases.Where(p => p.Status == "activated").SumAsync(p => (double)p.Amount)
    });
}

public record SubmitPurchaseReq(int ToolId);
public record ActivateReq(string? Note);

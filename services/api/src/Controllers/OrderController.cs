// =====================================================
// Controllers/OrderController.cs —— 会员订阅订单接口
// 路由前缀：/api/orders
// 职责：创建订单（跳转爱发电支付）、接收支付回调、查询订阅状态
//
// 注意：这套是"时间订阅"（年度/终身会员），
//       和工具单独付费（ToolPurchase）是两套独立的机制
// =====================================================

using GoodayTools.Services;
using GoodayTools.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/orders")]
public class OrderController(SubscriptionService sub, AppDbContext db, IConfiguration cfg) : ControllerBase
{
    public record CreateOrderReq(string Plan);

    // POST /api/orders/create —— 创建订单，返回爱发电支付链接
    [Authorize]
    [HttpPost("create")]
    public async Task<IActionResult> Create([FromBody] CreateOrderReq req)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var order  = await sub.CreateOrderAsync(userId, req.Plan);

        // 根据套餐找到对应的爱发电商品 ID（配置在 appsettings.json 里）
        var planId = req.Plan switch
        {
            "founder_199"   => cfg["Afdian:PlanId199"]   ?? "YOUR_AFDIAN_PLAN_ID_199",
            "annual_299"    => cfg["Afdian:PlanId299"]   ?? "YOUR_AFDIAN_PLAN_ID_299",
            "lifetime_1688" => cfg["Afdian:PlanId1688"]  ?? "YOUR_AFDIAN_PLAN_ID_1688",
            _ => ""
        };

        // custom_order_id 把我们自己的订单号传给爱发电，回调时原样返回
        var payUrl = $"https://afdian.com/item/{planId}?custom_order_id={order.OrderNo}";
        return Ok(new { orderNo = order.OrderNo, payUrl });
    }

    // POST /api/orders/webhook/afdian —— 爱发电支付成功后的回调
    // 爱发电会向这个地址发 POST 请求，告知支付成功
    [HttpPost("webhook/afdian")]
    public async Task<IActionResult> AfdianWebhook([FromBody] AfdianWebhookReq req)
    {
        // 用 token 验证请求来源（防止伪造支付成功通知）
        var token = cfg["Afdian:Token"];
        if (string.IsNullOrEmpty(token) || req.Token != token)
            return Unauthorized();

        var orderNo    = req.Data?.Order?.CustomOrderId;  // 我们传过去的订单号
        var externalId = req.Data?.Order?.OutTradeNo ?? "";  // 爱发电的流水号
        if (string.IsNullOrEmpty(orderNo))
            return BadRequest(new { ec = 400, em = "missing order no" });

        // 标记订单为已支付，同时更新用户订阅状态
        var ok = await sub.MarkPaidAsync(orderNo, externalId);
        return Ok(new { ec = 200, em = ok ? "success" : "already_paid" });
    }

    // POST /api/orders/manual-activate —— 管理员手动核销（用于线下转账场景）
    [Authorize(Roles = "admin")]
    [HttpPost("manual-activate")]
    public async Task<IActionResult> ManualActivate([FromBody] ManualActivateReq req)
    {
        var ok = await sub.MarkPaidAsync(req.OrderNo, "manual");  // externalId 标记为 manual
        return Ok(new { success = ok });
    }

    // GET /api/orders/my-subscription —— 查询当前用户订阅状态
    [Authorize]
    [HttpGet("my-subscription")]
    public async Task<IActionResult> MySubscription()
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var result = await sub.GetUserSubscriptionAsync(userId);
        return Ok(result);
    }

    // GET /api/orders/list —— 管理员查所有订单
    [Authorize(Roles = "admin")]
    [HttpGet("list")]
    public async Task<IActionResult> ListOrders()
    {
        var orders = await db.Orders
            .OrderByDescending(o => o.CreatedAt)
            .Select(o => new {
                o.Id, o.OrderNo, o.UserId, o.Plan,
                o.Amount, o.Channel, o.Status,
                o.CreatedAt, o.PaidAt
            })
            .ToListAsync();
        return Ok(orders);
    }
}

// 爱发电 webhook 回调数据格式（按爱发电文档定义）
public record AfdianWebhookReq(string Token, AfdianData? Data);
public record AfdianData(AfdianOrder? Order);
public record AfdianOrder(string? CustomOrderId, string? OutTradeNo);
public record ManualActivateReq(string OrderNo);

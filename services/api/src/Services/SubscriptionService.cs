// =====================================================
// Services/SubscriptionService.cs —— 付费订阅业务逻辑
// 职责：创建订单、标记支付成功、检查使用权限、记录使用日志
//
// 注意：这套是"会员订阅"体系（按时间订阅），
//       和工具单独付费购买（ToolPurchase）是两套独立的机制
// =====================================================

using GoodayTools.Data;
using GoodayTools.Models;
using Microsoft.EntityFrameworkCore;
namespace GoodayTools.Services;

public class SubscriptionService(AppDbContext db)
{
    // 创建订单记录（用户选择套餐后调用，返回订单信息供前端跳转支付）
    public async Task<Order> CreateOrderAsync(int userId, string plan)
    {
        // 根据套餐名称确定金额（switch 表达式，C# 8+ 语法）
        var amount = plan switch
        {
            "founder_199"   => 199m,   // m 后缀表示 decimal 类型（精确小数，适合金额）
            "annual_299"    => 299m,
            "lifetime_1688" => 1688m,
            _ => throw new Exception("Invalid plan")  // _ 是默认分支
        };

        // 生成唯一订单号：GD + 时间戳 + 随机4位数
        var order = new Order
        {
            OrderNo   = $"GD{DateTime.UtcNow:yyyyMMddHHmmss}{Random.Shared.Next(1000,9999)}",
            UserId    = userId,
            Plan      = plan,
            Amount    = amount,
            Channel   = "afdian",  // 支付渠道（爱发电）
            Status    = "pending",
            CreatedAt = DateTime.UtcNow
        };
        db.Orders.Add(order);
        await db.SaveChangesAsync();
        return order;
    }

    // 标记订单为已支付，并更新用户订阅状态（爱发电 webhook 回调时调用）
    public async Task<bool> MarkPaidAsync(string orderNo, string externalId)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.OrderNo == orderNo);
        if (order == null || order.Status == "paid") return false;  // 订单不存在或已处理

        order.Status     = "paid";
        order.PaidAt     = DateTime.UtcNow;
        order.ExternalId = externalId;  // 支付平台的流水号

        var user = await db.Users.FindAsync(order.UserId);
        if (user == null) return false;

        // 根据套餐更新订阅状态
        if (order.Plan == "lifetime_1688")
        {
            // 终身会员：状态设为 lifetime，无过期时间
            user.SubscriptionStatus    = "lifetime";
            user.SubscriptionExpiresAt = null;
        }
        else
        {
            // 年度/创始会员：在现有到期时间基础上加365天（支持续费叠加）
            user.SubscriptionStatus = "active";
            var baseTime = (user.SubscriptionExpiresAt ?? DateTime.UtcNow) > DateTime.UtcNow
                ? user.SubscriptionExpiresAt!.Value  // 还没过期：从当前到期时间续费
                : DateTime.UtcNow;                    // 已过期：从今天开始
            user.SubscriptionExpiresAt = baseTime.AddDays(365);
        }
        user.SubscriptionPlan = order.Plan;
        await db.SaveChangesAsync();
        return true;
    }

    // 检查用户是否有权限使用某工具（付费会员无限制，免费用户每月限3次）
    public async Task<(bool allowed, string? reason)> CanUseToolAsync(int userId, int toolId)
    {
        var user = await db.Users.FindAsync(userId);
        if (user == null) return (false, "用户不存在");
        if (user.IsPaidMember()) return (true, null);  // 付费会员直接放行

        // 免费用户：统计最近30天的使用次数
        var monthAgo = DateTime.UtcNow.AddDays(-30);
        var count = await db.ToolUsageLogs.CountAsync(
            l => l.UserId == userId && l.UsedAt >= monthAgo);
        if (count >= 3)
            return (false, "免费用户每月限用3次，升级会员享无限使用");
        return (true, null);
    }

    // 记录工具使用日志（用于统计免费用户的使用次数）
    public async Task LogUsageAsync(int userId, int toolId, string action)
    {
        db.ToolUsageLogs.Add(new ToolUsageLog
        {
            UserId = userId,
            ToolId = toolId,
            Action = action,  // 如 "download"、"online_run"
            UsedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    // 获取当前用户的订阅状态（前端展示用）
    public async Task<object> GetUserSubscriptionAsync(int userId)
    {
        var user = await db.Users.FindAsync(userId);
        if (user == null) return new { status = "free" };
        return new
        {
            status    = user.SubscriptionStatus,
            expiresAt = user.SubscriptionExpiresAt,
            plan      = user.SubscriptionPlan,
            isPaid    = user.IsPaidMember()
        };
    }
}

// =====================================================
// Models/Order.cs —— 会员订阅订单数据模型
// 对应数据库 Orders 表
// 记录用户购买会员套餐的订单（通过爱发电支付）
// =====================================================

namespace GoodayTools.Models;
public class Order
{
    public int Id { get; set; }
    public string OrderNo { get; set; } = "";       // 我们生成的订单号，如 GD20240115120000xxxx
    public int UserId { get; set; }                 // 下单用户 ID
    public string Plan { get; set; } = "annual_299"; // 套餐："founder_199"|"annual_299"|"lifetime_1688"
    public decimal Amount { get; set; }             // 订单金额（元）
    public string Channel { get; set; } = "afdian"; // 支付渠道（目前只有爱发电）
    public string Status { get; set; } = "pending"; // "pending"（待支付）| "paid"（已支付）
    public string? ExternalId { get; set; }         // 爱发电的流水号（支付成功后填入，用于对账）
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? PaidAt { get; set; }           // 支付时间（未支付时为 null）
}

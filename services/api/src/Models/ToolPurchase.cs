// =====================================================
// Models/ToolPurchase.cs —— 工具购买记录数据模型
// 对应数据库 ToolPurchases 表
// 记录"哪个用户购买了哪个工具，当前状态是什么"
// =====================================================

namespace GoodayTools.Models;
public class ToolPurchase
{
    public int Id { get; set; }
    public int UserId { get; set; }     // 购买者用户 ID（外键 → Users 表）
    public int ToolId { get; set; }     // 购买的工具 ID（外键 → Tools 表）
    public decimal Amount { get; set; } // 购买时的价格（记录当时价格，防止工具改价后对账混乱）

    // 状态流转：pending（用户提交）→ activated（管理员确认）/ refunded（管理员拒绝）
    public string Status { get; set; } = "pending"; // "pending"|"activated"|"refunded"
    public string? AdminNote { get; set; }          // 管理员备注（如"已确认收款"）
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ActivatedAt { get; set; }      // 激活时间（activated 后才有值）

    // 导航属性：EF Core 用这两个属性做 JOIN 查询（查购买记录时同时拿到用户名和工具名）
    public User? User { get; set; }
    public Tool? Tool { get; set; }
}

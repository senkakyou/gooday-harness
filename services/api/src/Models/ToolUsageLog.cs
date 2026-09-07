// =====================================================
// Models/ToolUsageLog.cs —— 工具使用日志数据模型
// 对应数据库 ToolUsageLogs 表
// 用途：统计免费用户的使用次数（每月限3次的限额控制）
// =====================================================

namespace GoodayTools.Models;
public class ToolUsageLog
{
    public int Id { get; set; }
    public int UserId { get; set; }     // 使用者用户 ID
    public int ToolId { get; set; }     // 被使用的工具 ID
    public string Action { get; set; } = "";  // 操作类型，如 "download"、"online_run"
    public DateTime UsedAt { get; set; } = DateTime.UtcNow;
}

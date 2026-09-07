// =====================================================
// Models/Decision.cs —— 决策日志数据模型
// 对应数据库 Decisions 表
// 职责：记录项目中关键决策，供未来复盘和AI学习
// =====================================================

namespace GoodayTools.Models;
public class Decision
{
    public int Id { get; set; }

    // 关联项目（可选）
    public int? ProjectId { get; set; }
    public Project? Project { get; set; }

    // 关联工单（可选）
    public int? TicketId { get; set; }
    public Ticket? Ticket { get; set; }

    // 决策内容
    public string Content { get; set; } = "";      // 决策内容（做了什么决定）
    public string? Rationale { get; set; }          // 决策依据（为什么这么决定）
    public string? Outcome { get; set; }            // 结果回顾（决策后结果如何）

    // 决策人：admin=站长 | lingxi=灵犀 | system=系统自动
    public string DecidedBy { get; set; } = "admin";

    // 决策类型：pricing=定价 | scope=需求范围 | tech=技术方案 | reject=拒绝 | other=其他
    public string DecisionType { get; set; } = "other";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

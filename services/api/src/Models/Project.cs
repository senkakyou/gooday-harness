// =====================================================
// Models/Project.cs —— 项目档案数据模型
// 对应数据库 Projects 表
// 职责：承载工单转化为项目后的完整执行记录
// 状态流：planning → in_progress → testing → done | cancelled
// =====================================================

namespace GoodayTools.Models;
public class Project
{
    public int Id { get; set; }

    // 关联工单（一个工单对应一个项目）
    public int? TicketId { get; set; }
    public Ticket? Ticket { get; set; }

    // 关联客户档案
    public int? ClientId { get; set; }
    public Client? Client { get; set; }

    public string Title { get; set; } = "";
    public string Description { get; set; } = "";

    // planning=规划中 | in_progress=进行中 | testing=测试中 | done=已完成 | cancelled=已取消
    public string Status { get; set; } = "planning";

    // 项目负责人（默认擎天柱 Id=21 分析，实际执行人可另配）
    public int? AssigneeId { get; set; }
    public User? Assignee { get; set; }

    // 财务数据
    public decimal? Budget { get; set; }           // 客户预算（从工单带过来）
    public decimal? QuotedPrice { get; set; }      // 对客报价
    public decimal? ActualCost { get; set; }       // 实际成本（人工+资源）
    public decimal? ActualRevenue { get; set; }    // 实际到账金额

    // 擎天柱生成的项目方案（Markdown）
    public string? PlanMarkdown { get; set; }

    // 交付说明（完成后填写）
    public string? DeliveryNotes { get; set; }

    // 内部备注
    public string? AdminNote { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
}

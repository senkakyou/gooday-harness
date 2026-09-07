// =====================================================
// Models/Ticket.cs —— 工单数据模型
// 对应数据库 Tickets 表
// 职责：承载定制开发业务的完整生命周期
//   DevRequests（需求收集）→ Tickets（工单执行）
// 状态流：pending → confirmed → in_progress → testing → done | cancelled
// =====================================================

namespace GoodayTools.Models;
public class Ticket
{
    public int Id { get; set; }

    // 工单编号，格式：GD-20260609-001（日期+当天序号，由后端自动生成）
    public string TicketNo { get; set; } = "";

    public string Title { get; set; } = "";
    public string Description { get; set; } = "";

    // 客户信息（注册用户关联 ClientId；非注册用户用 ClientName/ClientContact 记录）
    public int? ClientId { get; set; }
    public User? Client { get; set; }
    public string ClientName { get; set; } = "";
    public string ClientContact { get; set; } = "";
    public string ContactType { get; set; } = "wechat"; // wechat | email | phone

    // 业务状态
    // pending=待确认 | confirmed=已确认 | in_progress=进行中 | testing=测试中 | done=已完成 | cancelled=已取消
    public string Status { get; set; } = "pending";

    // 优先级：low | normal | high | urgent
    public string Priority { get; set; } = "normal";

    // 预算与报价
    public string? Budget { get; set; }         // 客户预算范围，如"500-1000"
    public decimal? EstimatedPrice { get; set; } // 确认后的报价

    // 来源关联
    public int? DevRequestId { get; set; }       // 由哪条 DevRequest 转来（可选）
    // 来源渠道：ruyi=如意AI生成 | admin=站长/灵犀创建 | self=客户自助提交
    public string Source { get; set; } = "admin";

    // 负责人（站长指派的执行者，可选）
    public int? AssigneeId { get; set; }
    public User? Assignee { get; set; }

    // 内部备注（客户不可见，供站长/灵犀记录决策信息）
    public string? AdminNote { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DueAt { get; set; }

    // ---- V3 两级状态模型（见 docs/v3/04-state-machine.md、07-database-changes.md）----
    // 主状态 Status 保持不变（只加不改），异常细分挂在 SubStatus 上，避免存量状态比较代码漏单
    public string? SubStatus { get; set; }                 // 异常/阶段细分，如 payment_unverified
    public int RetryCount { get; set; } = 0;               // 当前阶段自愈重试次数（迁移主状态时清零）
    public DateTime? StageDeadline { get; set; }           // 当前阶段内部超时时刻（dispatcher 写/查，区别于对客的 DueAt）
}

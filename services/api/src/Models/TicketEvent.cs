// =====================================================
// Models/TicketEvent.cs —— 工单事件流水（V3 的脊柱）
// 对应数据库 TicketEvents 表
// 职责：工单全生命周期事件流水，既是调度凭证，也是审计日志、报表数据源。
//   - bot 间流转不再靠站内信，改写事件表（POST /api/ticket-events）
//   - dispatcher 轮询 Status='new' 的事件消费（处理后改 'processed'，永不删除可回放）
// 设计见 docs/v3/07-database-changes.md
// =====================================================

namespace GoodayTools.Models;

public class TicketEvent
{
    public int Id { get; set; }

    // 关联工单（系统级事件可为 0，如全局通知）
    public int TicketId { get; set; }

    // 事件类型（真实枚举见 docs/v3/07-database-changes.md「六、事件类型目录」）：
    //   流转触发：ticket_created / analysis_done / client_confirmed / payment_confirmed
    //     / dev_done / dev_failed / client_accepted / rework_approved / refund_approved / refund_recorded
    //   业务路由：payment_claimed / routed / scope_change / split_substandard / needs_human / dev_started / progress
    //   通知/自愈：notify（配合 Level 用）/ selfheal_done / shadow_decision
    public string EventType { get; set; } = "";

    // 产生者 UserId（灵犀20 / 擎天柱21 / 威震天22 / 如意23 / 招财25 / 大海1）
    public int ActorId { get; set; }

    // 通知类事件的级别：P0/P1/P2/P3；流转类事件为 null
    public string? Level { get; set; }

    // JSON 负载：金额、URL、失败原因、评审意见等
    public string? Payload { get; set; }

    // 消费状态：new=待 dispatcher 消费 / processed=已处理 / skipped=跳过
    public string Status { get; set; } = "new";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ProcessedAt { get; set; }
}

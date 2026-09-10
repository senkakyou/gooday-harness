// =====================================================
// Models/Ticket.cs —— 订单（对客称「订单」，代码里叫 Ticket）
// 对应数据库 Tickets 表
//
// 【为什么不叫 Order】：`Orders` 表和 `/api/orders` 已经被会员订阅占用
// （爱发电付费），同名必然出事故。而大海对本次重构的原话是
// 「不是把旧系统换个名字」——改名恰恰是换名字，删对象才是瘦身。
//
// 职责：**只记业务状态，不做工程编排**。
//   方案、任务拆解、执行证据全部归 Harness（workflows/order + evidence/），
//   不进这张表。上一版把「工单→项目→子任务→事件」四层对象都塞进库里，
//   结果是 6 行工单配 6 个项目、42 个子任务、169 条事件，而其中
//   119 条事件永远卡在 new 没人消费。
//
// 状态流（docs/decisions/006）：
//   NEW → IN_PROGRESS → DELIVERED → CLOSED
//   旁路：BLOCKED（可恢复）、CANCELLED（终态）
//   **没有任何自动流转**——每一次迁移要么大海点一下，要么主 Agent 跑一条命令。
//   合法迁移表只有一份，在 Services/TicketWorkflow.cs。
// =====================================================

namespace GoodayTools.Models;

public class Ticket
{
    public int Id { get; set; }

    // 订单编号，格式：GD-20260910-001（日期 + 当天序号，后端生成）
    public string TicketNo { get; set; } = "";

    // ---- 需求 ----
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";

    // ---- 客户 ----
    // 【指向 Clients.Id，不是 Users.Id】。上一版 Tickets.ClientId 指 Users 而
    // FinanceRecords.ClientId 指 Clients，两边语义分叉，TicketsController 里
    // 为此写了一段 UserId→ClientId 的映射补丁。这次统一到 Clients，
    // 账号关联走 Clients.UserId（线下客户为 null）。
    public int? ClientId { get; set; }
    public Client? Client { get; set; }

    // 客户没有平台账号时的兜底联系信息（有 ClientId 时以客户档案为准）
    public string ClientName { get; set; } = "";
    public string ClientContact { get; set; } = "";

    // ---- 金额 ----
    // 【如意全程不谈钱】，所以建单时这里是 null，由大海与客户确认后填。
    //
    // 结单闸门要求它非空。但要说清这道闸【到底防住了什么】（2026-09-10 灵犀评审 ③）：
    // 它只防「结单时忘了填数」，**不防「填的数和实际到账不符」**——
    // Tickets.Amount 与 FinanceRecords 是两张表，全仓没有任何一处交叉核对。
    // 换句话说：钱这条线现在零自动检查，全靠大海手工记账时自己对。
    public decimal? Amount { get; set; }

    // ---- 状态 ----
    // 取值只有 TicketWorkflow.States 那六个，全大写。
    // 【大写是刻意的硬切】：任何漏改的 Status=="done" 会立刻返回 false
    // 而不是悄悄匹配上。代价是要逐处判断 false 的方向——
    // 在闸门里 false 是拦住（安全），在过滤器里 false 是漏单（危险）。
    public string Status { get; set; } = "NEW";

    // 进 BLOCKED 必须写清卡在哪，否则没人知道要处理什么
    public string? BlockedReason { get; set; }

    // ---- 交付信息 ----
    // 交付物是工具一览里的一件私有工具（docs/decisions/005）
    public int? DeliveryToolId { get; set; }
    public DateTime? DeliveredAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

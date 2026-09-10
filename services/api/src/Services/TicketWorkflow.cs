// =====================================================
// Services/TicketWorkflow.cs —— 订单状态机
//
// 【全仓唯一一份合法迁移表】。上一版有两份：dispatcher/main.py 的 TRANSITIONS
// 和 TicketsController 的 IsLegalTransition，两边各自维护，口径迟早分叉。
// evolution/experiments/order-mainline/check.py 有一条判据专门盯这件事。
//
// ═══ 和上一版最大的不同：没有队列 ═══════════════════════════════════
//
//   上一版是「写一条事件 → dispatcher 轮询 → 它来改状态」。异步、可回放，
//   代价是「诈尸」：状态回退后旧事件重新变得合法，被当成新事件重放。
//
//   这一版是【同步迁移】：调用方直接说要触发哪个事件，合法就当场改，
//   不合法就 409。没有待消费的东西，也就没有东西可以诈尸。
//
//   注意区分两件事：**状态迁移是同步的（毫秒级），执行是异步的**
//   （workflows/order 自己跑几分钟到几十分钟）。这两者本来就该分开，
//   把它们绑在一起才是上一版复杂度的来源。
// ═══════════════════════════════════════════════════════════════════
// =====================================================

namespace GoodayTools.Services;

public static class TicketWorkflow
{
    // ---- 状态 ----
    public const string New        = "NEW";          // 如意开的单，等大海与客户确认
    public const string InProgress = "IN_PROGRESS";  // 大海下了开工令
    public const string Delivered  = "DELIVERED";    // 大海放行，客户已收到通知，等验收
    public const string Closed     = "CLOSED";       // 大海结单（并手工填财务表）
    public const string Blocked    = "BLOCKED";      // 卡住了，要人介入
    public const string Cancelled  = "CANCELLED";    // 不做了

    public static readonly IReadOnlySet<string> States = new HashSet<string>
        { New, InProgress, Delivered, Closed, Blocked, Cancelled };

    public static readonly IReadOnlySet<string> Terminal = new HashSet<string>
        { Closed, Cancelled };

    // ---- 谁能推 ----
    // 【只有大海能推业务状态】。不能用「role == admin」判——灵犀的 JWT 角色
    // 也是 admin（见 services/bot-lingxi/config.json），按角色判等于把
    // 开工权给了一个会读不可信输入的角色。
    //
    // 诚实说明这道闸挡的是谁：它挡的是【其它角色】（如意、灵犀）擅自推状态。
    // 它挡不住持有大海凭据的运维本人——workflows/order 就是拿大海的 token 跑的，
    // 那是设计如此：主 Agent 是大海的手，不是第三方。
    public const int OwnerUserId = 1;

    /// <summary>触发者只能是大海的事件。其余事件内部角色也能触发。</summary>
    public static readonly IReadOnlySet<string> OwnerOnlyEvents = new HashSet<string>
        { "start", "release", "close", "rework", "unblock", "cancel" };

    // ---- 迁移表 ----
    // key = (当前状态, 事件)，value = 目标状态
    private static readonly Dictionary<(string From, string Event), string> _t = new()
    {
        // 正线
        [(New,        "start")]   = InProgress,   // 大海下开工令
        [(InProgress, "release")] = Delivered,    // 大海放行验收 → 如意通知客户
        [(Delivered,  "close")]   = Closed,       // 大海结单

        // 返工：客户看了不满意
        [(Delivered,  "rework")]  = InProgress,

        // 卡住 / 解除。BLOCKED 一律回 IN_PROGRESS 而不是「回到卡住前那一步」——
        // 记住「之前在哪」需要多一个字段，而实际上从 NEW 卡住的单解除后
        // 也是要开工的，回 IN_PROGRESS 就是对的。少一个字段少一类不一致。
        [(New,        "block")]   = Blocked,
        [(InProgress, "block")]   = Blocked,
        [(Delivered,  "block")]   = Blocked,
        [(Blocked,    "unblock")] = InProgress,

        // 不做了
        [(New,        "cancel")]  = Cancelled,
        [(Blocked,    "cancel")]  = Cancelled,
    };

    public static readonly IReadOnlySet<string> KnownEvents =
        new HashSet<string>(_t.Keys.Select(k => k.Event));

    /// <summary>
    /// 查这一步合不合法。返回目标状态；不合法返回 null。
    /// </summary>
    public static string? Target(string from, string evt) =>
        _t.TryGetValue((from, evt), out var to) ? to : null;

    /// <summary>
    /// 不合法时给一句人能看懂的话。
    /// 【区分「事件根本不存在」和「事件存在但此刻不该发生」】——
    /// 前者是调用方拼错了，后者往往是并发或重复点击，处理方式完全不同。
    /// </summary>
    public static string RejectReason(string from, string evt)
    {
        if (!KnownEvents.Contains(evt))
            return $"没有「{evt}」这个动作。可用：{string.Join("、", KnownEvents.OrderBy(x => x))}";
        if (Terminal.Contains(from))
            return $"订单已是终态 {from}，不能再动了";
        var canDo = _t.Keys.Where(k => k.From == from).Select(k => k.Event).OrderBy(x => x);
        return $"{from} 状态下不能做「{evt}」。此刻可做：{string.Join("、", canDo)}";
    }

    /// <summary>这个状态下还能做哪些动作（给前端画按钮用，前端不再自己维护一份）。</summary>
    public static string[] AvailableEvents(string from) =>
        _t.Keys.Where(k => k.From == from).Select(k => k.Event).OrderBy(x => x).ToArray();
}

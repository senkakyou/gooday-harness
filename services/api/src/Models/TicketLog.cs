// =====================================================
// Models/TicketLog.cs —— 订单工作记录
// 对应数据库 TicketLog 表
//
// ═══ 它和被它取代的 TicketEvents 的本质区别 ═══════════════════════
//
//   TicketEvents 有一个 `Status` 列（new / processed / skipped），
//   因为它是【队列】——dispatcher 轮询 Status='new' 的事件来驱动流转。
//
//   TicketLog **没有 Status 列，因为它没有消费者**。它是审计日志和
//   给人看的时间线，不是队列。
//
//   删掉「待消费事件」这个对象，就把「诈尸」这一整类 bug 从结构上消除了：
//   旧事件在状态回退后重新变得合法，被当成新事件重放，把正在跑的单打成
//   failed —— 已产出真实交付物的单子就这样被打回过。
//   **不是加了一道防护，是让这个 bug 没有地方发生。**
//
//   代价也写清楚：失去了「先发事件、稍后异步生效」的能力。
//   本设计不需要它——没有任何自动流转。
// ═══════════════════════════════════════════════════════════════════
// =====================================================

namespace GoodayTools.Models;

public class TicketLog
{
    public long Id { get; set; }

    public int TicketId { get; set; }

    public DateTime At { get; set; } = DateTime.UtcNow;

    // 谁干的：UserId（大海 1 / 灵犀 20 / 如意 23），系统动作为 0
    public int ActorId { get; set; }
    public string ActorName { get; set; } = "";

    // 干了什么：created / transition / note / review / deliver / blocked ...
    // 【故意不做成枚举】：它只给人看，加一种记录方式不该要一次数据库迁移。
    public string Kind { get; set; } = "note";

    // 人读的一句话。状态迁移会写成「NEW → IN_PROGRESS（大海下令开工）」
    public string Text { get; set; } = "";

    // 指向 /var/lib/gooday-harness/evidence/ 下的证据文件（可空）。
    // 【只存路径不存内容】：证据可能是几百 KB 的产物，塞进业务库
    // 会让每次查订单列表都拖着它走。
    public string? EvidenceRef { get; set; }
}

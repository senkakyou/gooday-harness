// =====================================================
// Models/FinanceRecord.cs —— 财务记录数据模型
// 对应数据库 FinanceRecords 表
// 职责：记录平台收入/支出流水，支持统计分析
// 来源：工单完成自动生成 / 站长手动录入
// =====================================================

namespace GoodayTools.Models;

public class FinanceRecord
{
    public int Id { get; set; }

    // 记录类型：income=收入 | expense=支出
    public string Type { get; set; } = "income";

    // 金额（正数）
    public decimal Amount { get; set; }

    // 货币（默认 CNY）
    public string Currency { get; set; } = "CNY";

    // 分类：project=项目收款 | tool=工具收入 | refund=退款 | server=服务器 | domain=域名 | other=其他
    public string Category { get; set; } = "project";

    // 描述
    public string Title { get; set; } = "";
    public string? Note { get; set; }

    // 关联工单（可选）
    public int? TicketId { get; set; }
    public Ticket? Ticket { get; set; }

    // 关联客户（可选）
    public int? ClientId { get; set; }
    public Client? Client { get; set; }

    // 付款状态：pending=待收款 | received=已收款 | partial=部分收款 | refunded=已退款
    public string PaymentStatus { get; set; } = "pending";

    // 付款方式：wechat | alipay | bank | cash | other
    public string? PaymentMethod { get; set; }

    // 来源：auto=工单自动生成 | manual=手动录入
    public string Source { get; set; } = "manual";

    // 记录的账期（哪个月的收入，用于月报）格式：2026-06
    public string? AccountPeriod { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // 实际收款时间
    public DateTime? ReceivedAt { get; set; }

    // ---- V3 收款升级（见 docs/v3/07-database-changes.md）----
    public string? EvidenceUrl { get; set; }   // 付款凭证截图归档路径（如意经手归档）
    public int? ConfirmedBy { get; set; }       // 确认人 UserId（审计：谁拍的板）
}

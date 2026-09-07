// =====================================================
// Models/SystemSetting.cs —— 系统配置（Key-Value）
// 对应数据库 SystemSettings 表
// 职责：后台可调的运行期开关/阈值，首个用途是「小额自动放行」（docs/v3/12）
//   AutoApprove.Enabled / AutoApprove.Limit / AutoApprove.DailyCap / AutoApprove.PerCustomerDaily
// =====================================================

namespace GoodayTools.Models;

public class SystemSetting
{
    public int Id { get; set; }
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public string? Note { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

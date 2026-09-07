// =====================================================
// Models/ToolDownload.cs —— 工具下载记录数据模型
// 对应数据库 ToolDownloads 表
// 每次有用户下载工具就插入一条记录（用于统计下载量和追踪下载行为）
// =====================================================

namespace GoodayTools.Models;
public class ToolDownload {
    public int Id { get; set; }
    public int ToolId { get; set; }              // 被下载的工具 ID（外键 → Tools 表）
    public Tool Tool { get; set; } = null!;      // 导航属性（null! 告诉编译器这里不会是 null）
    public int UserId { get; set; }              // 下载者用户 ID（外键 → Users 表）
    public User User { get; set; } = null!;      // 导航属性
    public DateTime DownloadedAt { get; set; } = DateTime.UtcNow;
    public string? IpAddress { get; set; }       // 下载者 IP（可选，用于反作弊或统计地区）
}

// =====================================================
// Models/Tool.cs —— 工具数据模型
// 对应数据库 Tools 表
// =====================================================

namespace GoodayTools.Models;
public class Tool
{
    public int Id { get; set; }
    public string Name { get; set; } = "";          // 工具显示名称，如"PDF合并工具"
    public string Slug { get; set; } = "";          // URL 标识符（唯一），如 "pdf-merge"
    public string Description { get; set; } = "";   // 工具简短描述
    public string Category { get; set; } = "";      // 分类，如"效率工具"、"文件处理"
    public string IconEmoji { get; set; } = "🔧";  // 图标 emoji

    public bool IsOnline { get; set; }              // 是否支持在线运行（iframe 嵌入）
    public string? OnlineUrl { get; set; }          // 在线运行的 URL（IsOnline=true 时有值）

    public bool HasDownload { get; set; }           // 是否支持下载
    public string? DownloadFileName { get; set; }   // 下载文件名（在 uploads/ 目录下）

    public int DownloadCount { get; set; }          // 累计下载次数（每次下载自动+1）
    public int ViewCount { get; set; }              // 累计浏览次数（每次看详情自动+1）

    public bool IsPublished { get; set; } = true;  // 是否已发布（false 则前台不显示）
    public bool RequireLogin { get; set; } = true; // 是否需要登录才能下载

    public string? ReadmeMarkdown { get; set; }    // 工具说明文档（Markdown 格式）

    public bool IsPaid { get; set; } = false;      // 是否收费下载
    public decimal Price { get; set; } = 0;        // 价格（元），decimal 避免浮点精度问题

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // 导航属性：该工具的所有下载记录
    public ICollection<ToolDownload> Downloads { get; set; } = new List<ToolDownload>();
}

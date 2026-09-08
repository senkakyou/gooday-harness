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

    // ---- 视频讲解 ----
    // 【只用一个字段判断有没有视频】：VideoUrl 非空即有。
    // 不设 HasVideo 布尔，是因为上面 HasDownload/DownloadFileName 那对字段
    // 已经证明了两个字段会互相打架（勾了没传文件、传了文件没勾），前台就白按一次。
    public string? VideoUrl { get; set; }           // 站内 /uploads/... 或外链（B站等）
    public string VideoSource { get; set; } = "upload";  // upload=站内文件 / link=外链
    public int VideoDuration { get; set; }          // 时长（秒），0=未知，卡片上显示 8:32 用
    public int VideoPlayCount { get; set; }         // 讲解被播放次数（判断"讲解到底有没有人看"）

    // 归置目录：该工具的文件都放在 uploads/<Folder>/ 下，如 "tools/照片管家Pro"。
    // 【它只是"新文件默认落哪"和后台分组展示的依据】——真正的路径仍完整存在
    // OnlineUrl / DownloadFileName / VideoUrl 里，不靠 Folder 拼出来。
    // 这样外链视频、lib/ 下的共享库这类"不在自己文件夹里"的情况才表达得了。
    public string? Folder { get; set; }

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

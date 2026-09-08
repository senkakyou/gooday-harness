// =====================================================
// Models/UploadRedirect.cs —— uploads 内文件的旧路径→新路径映射
// 对应数据库 UploadRedirects 表
//
// 为什么需要它：文件改名/移动时，站内引用（工具字段、论坛帖子、页面内部引用）
// 都会被 RewriteReferencesAsync 自动改掉，但**站外的引用改不了**——
// 用户收藏的直链、别处贴过的链接、搜索引擎收录的地址。
// 没有这张表，那些链接搬家后就是死链（带扩展名的 404；不带扩展名的更糟，
// 会落到 MapFallbackToFile 拿到 200 的 index.html，存下来是个 HTML 首页）。
// =====================================================

namespace GoodayTools.Models;

public class UploadRedirect
{
    public int Id { get; set; }

    public string OldPath { get; set; } = "";   // 相对 uploads 的旧路径，如 "照片管家Pro.html"
    public string NewPath { get; set; } = "";   // 相对 uploads 的新路径，如 "tools/照片管家Pro/照片管家Pro.html"

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

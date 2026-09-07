// =====================================================
// Models/ForumCategory.cs —— 论坛板块数据模型
// 对应数据库 ForumCategories 表
// =====================================================

namespace GoodayTools.Models;

public class ForumCategory
{
    public int Id { get; set; }
    public string Name { get; set; } = "";           // 板块显示名称
    public string Slug { get; set; } = "";           // URL 标识符（唯一），如 "general"
    public string Description { get; set; } = "";   // 板块简介
    public string Icon { get; set; } = "💬";        // 板块图标 emoji
    public int SortOrder { get; set; } = 0;         // 排序权重（数值小的排前面）
    public bool IsVisible { get; set; } = true;     // false 时对普通用户隐藏（仅隐藏入口，知道链接仍可读）
    public bool AdminOnly { get; set; } = false;    // true 时仅管理员可见：板块、帖子、回复全部对非管理员返回 404
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // 导航属性：该板块下的所有帖子
    public ICollection<ForumThread> Threads { get; set; } = new List<ForumThread>();
}

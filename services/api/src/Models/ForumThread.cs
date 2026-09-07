// =====================================================
// Models/ForumThread.cs —— 论坛帖子（主题）数据模型
// 对应数据库 ForumThreads 表
// =====================================================

namespace GoodayTools.Models;

public class ForumThread
{
    public int Id { get; set; }
    public string Title { get; set; } = "";             // 帖子标题
    public int CategoryId { get; set; }                 // 所属板块 ID
    public ForumCategory Category { get; set; } = null!; // 导航属性
    public int AuthorId { get; set; }
    public User Author { get; set; } = null!;           // 发帖人

    public bool IsPinned { get; set; } = false;         // 是否置顶（管理员操作）
    public bool IsLocked { get; set; } = false;         // 是否锁定（锁定后不能回复）
    public bool IsDeleted { get; set; } = false;        // 软删除标志（不物理删除）

    public int ViewCount { get; set; } = 0;             // 浏览次数
    public int ReplyCount { get; set; } = 0;            // 回复数（含楼层）

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastReplyAt { get; set; } = DateTime.UtcNow;  // 用于列表排序
    public int? LastReplyUserId { get; set; }
    public User? LastReplyUser { get; set; }            // 最后回复的用户

    // 导航属性：该帖的所有楼层（回复）
    public ICollection<ForumPost> Posts { get; set; } = new List<ForumPost>();
}

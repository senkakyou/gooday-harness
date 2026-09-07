// =====================================================
// Models/ForumPostLike.cs —— 论坛点赞记录数据模型
// 对应数据库 ForumPostLikes 表
// 数据库层通过复合唯一索引 (PostId, UserId) 保证每人只能点一次
// =====================================================

namespace GoodayTools.Models;

public class ForumPostLike
{
    public int Id { get; set; }
    public int PostId { get; set; }
    public ForumPost Post { get; set; } = null!;
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

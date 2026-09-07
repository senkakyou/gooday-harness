// =====================================================
// Models/ForumPost.cs —— 论坛回复（楼层）数据模型
// 对应数据库 ForumPosts 表
// 帖子的首楼（#1楼）也作为一条 ForumPost 存储
// =====================================================

namespace GoodayTools.Models;

public class ForumPost
{
    public int Id { get; set; }
    public int ThreadId { get; set; }
    public ForumThread Thread { get; set; } = null!;  // 所属帖子
    public int AuthorId { get; set; }
    public User Author { get; set; } = null!;          // 发帖/回复人

    public string Content { get; set; } = "";          // 内容（支持 Markdown）
    public bool IsDeleted { get; set; } = false;       // 软删除（删除后显示"该回复已删除"）
    public int LikeCount { get; set; } = 0;            // 点赞数（冗余字段，方便排序/展示）
    public int FloorNumber { get; set; } = 1;          // 楼层号（1楼=帖子正文）

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }           // 编辑后更新

    // 导航属性：该楼的所有点赞记录
    public ICollection<ForumPostLike> Likes { get; set; } = new List<ForumPostLike>();
}

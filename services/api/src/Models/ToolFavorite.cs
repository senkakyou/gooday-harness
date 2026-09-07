// =====================================================
// Models/ToolFavorite.cs —— 用户工具收藏（账号级，跨设备）
// 每条记录表示某用户收藏了某工具；(UserId, ToolId) 唯一
// =====================================================
namespace GoodayTools.Models;

public class ToolFavorite
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int ToolId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

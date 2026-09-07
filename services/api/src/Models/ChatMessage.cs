// =====================================================
// Models/ChatMessage.cs —— 公开留言板消息数据模型
// 对应数据库 ChatMessages 表
// 用于全站公开聊天（ChatBox 悬浮窗）
// =====================================================

namespace GoodayTools.Models;

public class ChatMessage
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Username { get; set; } = "";  // 冗余存储，避免每次显示消息都关联查询用户表
    public string Content { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// =====================================================
// Models/PrivateMessage.cs —— 私信数据模型
// 对应数据库 PrivateMessages 表
// 支持纯文字、图片、文件三种消息类型
// =====================================================

namespace GoodayTools.Models;

public class PrivateMessage
{
    public int Id { get; set; }
    public int SenderId { get; set; }
    public string SenderUsername { get; set; } = "";    // 冗余存储发送方用户名，避免关联查询
    public string? SenderAvatar { get; set; }
    public int ReceiverId { get; set; }
    public string ReceiverUsername { get; set; } = "";
    public string Content { get; set; } = "";           // 文字内容（媒体消息时可为空）
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool IsRead { get; set; } = false;           // 接收方是否已读（用于未读红点统计）
    public string? MediaUrl { get; set; }               // 媒体文件 URL
    public string? MediaType { get; set; }              // "image" | "file"
    public string? MediaName { get; set; }              // 文件原始名（文件类型时展示用）
    public long? MediaSize { get; set; }                // 文件大小（字节），展示时格式化为 KB/MB
}

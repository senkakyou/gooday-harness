// =====================================================
// Models/Friendship.cs —— 好友关系数据模型
// 对应数据库 Friendships 表
// 设计：每段关系只存一条记录（RequesterId 发起，AddresseeId 接收）
// =====================================================

namespace GoodayTools.Models;

public class Friendship
{
    public int Id { get; set; }
    public int RequesterId { get; set; }                // 发起好友申请的用户
    public User Requester { get; set; } = null!;
    public int AddresseeId { get; set; }                // 收到好友申请的用户
    public User Addressee { get; set; } = null!;
    public string Status { get; set; } = "pending";     // pending | accepted | declined
    public string? RequesterRemark { get; set; }         // 发起方对被申请方的备注
    public string? AddresseeRemark { get; set; }         // 被申请方对发起方的备注
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

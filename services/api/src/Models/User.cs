// =====================================================
// Models/User.cs —— 用户数据模型
// 对应数据库 Users 表
// =====================================================

namespace GoodayTools.Models;
public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = "";         // 用户名（唯一）
    public string? Email { get; set; }                  // 邮箱（可选，唯一）
    public string PasswordHash { get; set; } = "";      // BCrypt 哈希后的密码，不存明文
    public string Role { get; set; } = "member";        // 角色：member | admin
    public bool IsActive { get; set; } = true;          // false 时账号被禁用，无法登录
    public int TokenVersion { get; set; } = 0;          // token 版本号：改密码时 +1，使旧 token 立即失效
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public string? AvatarUrl { get; set; }              // 头像图片相对路径，如 /avatars/xxx.jpg

    // 导航属性：该用户的所有工具下载记录
    public ICollection<ToolDownload> Downloads { get; set; } = new List<ToolDownload>();

    // 订阅/会员状态
    public string SubscriptionStatus { get; set; } = "free";  // free | active | lifetime
    public DateTime? SubscriptionExpiresAt { get; set; }       // 到期时间（lifetime 时为空）
    public string? SubscriptionPlan { get; set; }              // 会员计划名称

    // 判断用户是否为有效付费会员（终身 或 未到期的订阅）
    public bool IsPaidMember()
    {
        if (SubscriptionStatus == "lifetime") return true;
        if (SubscriptionStatus == "active" && SubscriptionExpiresAt > DateTime.UtcNow) return true;
        return false;
    }
}

namespace GoodayTools.Models;

// 站内通知（系统 → 用户）。与用户↔用户的 PrivateMessage 区分开
public class Notification {
    public int Id { get; set; }
    public int UserId { get; set; }          // 收件人
    public User User { get; set; } = null!;

    // booking | teacher_audit | request | announcement | system
    public string Type { get; set; } = "system";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string? LinkUrl { get; set; }     // 点击跳转，如 /teacher/bookings

    public bool IsRead { get; set; }
    public DateTime? ReadAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

namespace GoodayTools.Models;

// 师生关系 / 学生档案：课时结算的主键载体
// 平台学生（StudentUserId 有值）和线下学生（StudentUserId 为 null）统一在此建档
public class TeacherStudent {
    public int Id { get; set; }

    public int TeacherId { get; set; }
    public TeacherProfile Teacher { get; set; } = null!;

    public int? StudentUserId { get; set; }   // 平台用户；线下/微信约的学生为 null
    public User? StudentUser { get; set; }

    public string DisplayName { get; set; } = "";   // 平台学生默认 username，可改备注名；线下学生必填
    public string? Phone { get; set; }
    public string? Note { get; set; }                // 老师私人备注
    public decimal? DefaultFee { get; set; }         // 常用课时费，补课/结课时自动带入
    public bool IsArchived { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Lesson> Lessons { get; set; } = new List<Lesson>();
    public ICollection<Payment> Payments { get; set; } = new List<Payment>();
}

namespace GoodayTools.Models;

public class Booking {
    public int Id { get; set; }

    public int? StudentId { get; set; }           // 平台学生（有账号）；与 OfflineStudentId 二选一
    public User? Student { get; set; }

    public int? OfflineStudentId { get; set; }    // 线下学生（无账号）；与 StudentId 二选一
    public TeacherStudent? OfflineStudent { get; set; }

    public int TeacherId { get; set; }
    public TeacherProfile Teacher { get; set; } = null!;

    public int TimeSlotId { get; set; }
    public TimeSlot TimeSlot { get; set; } = null!;

    public int? SubjectId { get; set; }
    public Subject? Subject { get; set; }

    // pending / confirmed / cancelled / completed
    public string Status { get; set; } = "pending";
    public string? Note { get; set; }
    public string? TeacherNote { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

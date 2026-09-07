namespace GoodayTools.Models;

// 课时记录：一节实际上过的课，是「应收」的来源
public class Lesson {
    public int Id { get; set; }

    public int TeacherStudentId { get; set; }
    public TeacherStudent TeacherStudent { get; set; } = null!;

    public int? BookingId { get; set; }    // 来自平台预约则关联；线下/手动补录为 null
    public Booking? Booking { get; set; }

    public string LessonDate { get; set; } = "";   // "2026-05-30"
    public int? DurationMinutes { get; set; }
    public decimal Fee { get; set; }                // 这节课的课时费（老师填）
    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

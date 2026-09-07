namespace GoodayTools.Models;

// 缴费记录：学生交的一笔课费，是「已交」的来源
public class Payment {
    public int Id { get; set; }

    public int TeacherStudentId { get; set; }
    public TeacherStudent TeacherStudent { get; set; } = null!;

    public decimal Amount { get; set; }
    public string PaidDate { get; set; } = "";   // "2026-05-30"
    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

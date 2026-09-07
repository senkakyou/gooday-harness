namespace GoodayTools.Models;

public class TimeSlot {
    public int Id { get; set; }
    public int TeacherId { get; set; }
    public TeacherProfile Teacher { get; set; } = null!;

    public string Date { get; set; } = "";         // "2026-05-27"
    public string StartTime { get; set; } = "";    // "09:00"
    public string EndTime { get; set; } = "";      // "10:00"
    public int DurationMinutes { get; set; } = 60;

    // available / booked / cancelled
    public string Status { get; set; } = "available";
    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // 群课：一个时段可被多名学生预约
    public ICollection<Booking> Bookings { get; set; } = new List<Booking>();
}

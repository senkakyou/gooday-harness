namespace GoodayTools.Models;

public class TeacherProfile {
    public int Id { get; set; }
    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public string Bio { get; set; } = "";
    public string? AvatarUrl { get; set; }

    // pending / approved / rejected / revoked
    public string Status { get; set; } = "pending";
    public string? RejectReason { get; set; }
    public int? ApprovedByUserId { get; set; }
    public DateTime? ApprovedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<TeacherSubject> TeacherSubjects { get; set; } = new List<TeacherSubject>();
    public ICollection<TimeSlot> TimeSlots { get; set; } = new List<TimeSlot>();
    public ICollection<Booking> Bookings { get; set; } = new List<Booking>();
}

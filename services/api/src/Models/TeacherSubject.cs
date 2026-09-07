namespace GoodayTools.Models;

public class TeacherSubject {
    public int TeacherId { get; set; }
    public TeacherProfile Teacher { get; set; } = null!;

    public int SubjectId { get; set; }
    public Subject Subject { get; set; } = null!;
}

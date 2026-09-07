namespace GoodayTools.Models;

public class Subject {
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string IconEmoji { get; set; } = "📚";
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; } = 0;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<TeacherSubject> TeacherSubjects { get; set; } = new List<TeacherSubject>();
}

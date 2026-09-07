namespace GoodayTools.Models;
public class ProjectTask
{
    public int Id { get; set; }
    public int ProjectId { get; set; }
    public Project? Project { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    // todo | in_progress | done
    public string Status { get; set; } = "todo";
    public int SortOrder { get; set; } = 0;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

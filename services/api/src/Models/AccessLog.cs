namespace GoodayTools.Models;

public class AccessLog
{
    public long Id { get; set; }
    public string Path { get; set; } = "";
    public string Method { get; set; } = "";
    public string Ip { get; set; } = "";
    public int? UserId { get; set; }
    public string? Username { get; set; }
    public int StatusCode { get; set; }
    public int DurationMs { get; set; }
    public string? UserAgent { get; set; }
    public DateTime CreatedAt { get; set; }
}

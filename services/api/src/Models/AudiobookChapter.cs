// =====================================================
// Models/AudiobookChapter.cs —— 有声读书章节
// 对应数据库 AudiobookChapters 表。每章可为音频或视频，媒体可上传或外链。
// =====================================================

namespace GoodayTools.Models;

public class AudiobookChapter
{
    public int Id { get; set; }
    public int AudiobookId { get; set; }
    public string Title { get; set; } = "";            // 章节标题（如"第一章"）
    public string MediaType { get; set; } = "audio";   // audio | video
    public string MediaUrl { get; set; } = "";         // 媒体 URL：上传路径(/uploads/audiobooks/..) 或 外链
    public string Source { get; set; } = "link";       // upload | link（媒体来源，便于后台区分/清理）
    public int Duration { get; set; } = 0;             // 时长（秒，可 0=未知）
    public int OrderNo { get; set; } = 0;              // 章节顺序（小在前）
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// =====================================================
// Models/ReadProgress.cs —— 听书·文字版(EPUB)阅读进度（每用户每本一条）
// 对应数据库 ReadProgresses 表。"继续阅读" = 跳到该用户该书保存的 epub.js CFI 位置。
// 唯一约束 (UserId, AudiobookId)：一本书一条，断点续读。
// =====================================================

namespace GoodayTools.Models;

public class ReadProgress
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int AudiobookId { get; set; }
    public string Cfi { get; set; } = "";        // epub.js 的 CFI 位置（精确续读点）
    public double Percent { get; set; } = 0;     // 阅读百分比 0~1（列表展示用）
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

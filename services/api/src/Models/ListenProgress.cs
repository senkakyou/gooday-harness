// =====================================================
// Models/ListenProgress.cs —— 有声读书续播进度（每用户每章节一条）
// 对应数据库 ListenProgresses 表。"上次听到哪本/哪章" = 该用户最近 UpdatedAt 的记录。
// 唯一约束 (UserId, ChapterId)：同一用户同一章只保留一条，断点续播。
// =====================================================

namespace GoodayTools.Models;

public class ListenProgress
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int AudiobookId { get; set; }   // 冗余存书 Id，便于"我的书架"按书聚合最近进度
    public int ChapterId { get; set; }
    public int PositionSec { get; set; } = 0;   // 当前播放位置（秒）
    public bool Finished { get; set; } = false; // 该章是否听/看完（前端到尾自动置位）
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

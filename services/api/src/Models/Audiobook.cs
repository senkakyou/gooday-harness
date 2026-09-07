// =====================================================
// Models/Audiobook.cs —— 有声读书：一本书/专辑
// 对应数据库 Audiobooks 表；章节见 AudiobookChapter，续播见 ListenProgress
// =====================================================

namespace GoodayTools.Models;

public class Audiobook
{
    public int Id { get; set; }
    public string Title { get; set; } = "";            // 书名
    public string Author { get; set; } = "";           // 作者
    public string Narrator { get; set; } = "";         // 主播/播讲
    public string CoverUrl { get; set; } = "";         // 封面图 URL（上传路径或外链）
    public string EpubUrl { get; set; } = "";          // 文字版 EPUB URL（上传路径或外链，空=无文字版）
    public string Category { get; set; } = "其他";     // 分类：小说 | 历史 | 儿童 | 商业 | 其他 …
    public string Description { get; set; } = "";      // 简介
    public bool IsPublished { get; set; } = true;      // 是否上架
    public int PlayCount { get; set; } = 0;            // 播放次数
    public int OrderNo { get; set; } = 0;              // 排序（小在前）
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

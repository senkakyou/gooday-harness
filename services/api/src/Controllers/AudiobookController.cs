// =====================================================
// Controllers/AudiobookController.cs —— 有声读书接口
// 路由前缀：/api/audiobooks
// 职责：书库列表/详情(含章节) · 续播进度读写 · 我的书架 · 管理(增删改书/章节) · 媒体上传
//   章节媒体支持 音频/视频 两种、上传/外链 两种来源；进度按 用户+章节 断点续播。
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/audiobooks")]
public class AudiobookController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    int CurrentUserId => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
    bool IsAdmin => User.IsInRole("admin");

    // 物理删除上传的媒体文件（仅 Source=upload 且确在 uploads/audiobooks 下，规范化双重防穿越）
    void TryDeleteUploadedFile(string? source, string? mediaUrl)
    {
        if (source != "upload" || string.IsNullOrEmpty(mediaUrl) || !mediaUrl.StartsWith("/uploads/audiobooks/")) return;
        try
        {
            var baseDir = Path.GetFullPath(Path.Combine(env.WebRootPath, "uploads", "audiobooks"));
            var full = Path.GetFullPath(Path.Combine(env.WebRootPath, mediaUrl.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
            if (full.StartsWith(baseDir + Path.DirectorySeparatorChar) && System.IO.File.Exists(full)) System.IO.File.Delete(full);
        }
        catch { /* 删文件失败不阻断业务 */ }
    }

    // ---------- 公开浏览 ----------

    // GET /api/audiobooks?category=&keyword=&page=1
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? category = null,
        [FromQuery] string? keyword = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 24)
    {
        pageSize = Math.Clamp(pageSize, 10, 50);
        var q = db.Audiobooks.Where(b => b.IsPublished);
        if (!string.IsNullOrWhiteSpace(category) && category != "全部")
            q = q.Where(b => b.Category == category);
        if (!string.IsNullOrWhiteSpace(keyword))
            q = q.Where(b => b.Title.Contains(keyword) || b.Author.Contains(keyword) || b.Narrator.Contains(keyword));

        var total = await q.CountAsync();
        var items = await q.OrderBy(b => b.OrderNo).ThenByDescending(b => b.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(b => new {
                b.Id, b.Title, b.Author, b.Narrator, b.CoverUrl, b.Category, b.PlayCount,
                chapterCount = db.AudiobookChapters.Count(c => c.AudiobookId == b.Id)
            }).ToListAsync();
        return Ok(new { total, items });
    }

    // GET /api/audiobooks/{id} —— 详情 + 章节列表（公开）
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Detail(int id)
    {
        var b = await db.Audiobooks.FindAsync(id);
        if (b is null || (!b.IsPublished && !IsAdmin)) return NotFound();
        var rawChapters = await db.AudiobookChapters.Where(c => c.AudiobookId == id)
            .OrderBy(c => c.OrderNo).ThenBy(c => c.Id)
            .Select(c => new { c.Id, c.Title, c.MediaType, c.MediaUrl, c.Duration, c.OrderNo })
            .ToListAsync();
        // 有同名 .srt 字幕文件的章节，带上 subtitleUrl（英语版下载字幕用）
        var chapters = rawChapters.Select(c => {
            string? subtitleUrl = null;
            if (!string.IsNullOrEmpty(c.MediaUrl) && c.MediaUrl.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase)) {
                var su = c.MediaUrl[..^4] + ".lrc";
                var phys = Path.Combine(env.WebRootPath ?? "", su.TrimStart('/'));
                if (System.IO.File.Exists(phys)) subtitleUrl = su;
            }
            return new { c.Id, c.Title, c.MediaType, c.MediaUrl, c.Duration, c.OrderNo, subtitleUrl };
        }).ToList();
        return Ok(new {
            b.Id, b.Title, b.Author, b.Narrator, b.CoverUrl, b.EpubUrl, b.Category, b.Description,
            b.PlayCount, b.IsPublished, chapters
        });
    }

    // POST /api/audiobooks/{id}/play —— 播放计数 +1（公开，幂等无所谓）
    [HttpPost("{id:int}/play")]
    public async Task<IActionResult> Play(int id)
    {
        var b = await db.Audiobooks.FindAsync(id);
        if (b is null) return NotFound();
        b.PlayCount++;
        await db.SaveChangesAsync();
        return Ok(new { b.PlayCount });
    }

    // ---------- 续播进度（登录用户）----------

    public record ProgressReq(int AudiobookId, int ChapterId, int PositionSec, bool Finished);

    // POST /api/audiobooks/progress —— 上报续播进度（按 用户+章节 upsert）
    [Authorize]
    [HttpPost("progress")]
    public async Task<IActionResult> SaveProgress([FromBody] ProgressReq req)
    {
        // 校验章节存在且属于该书（防登录用户塞任意 id）
        var ch = await db.AudiobookChapters.FirstOrDefaultAsync(c => c.Id == req.ChapterId && c.AudiobookId == req.AudiobookId);
        if (ch is null) return BadRequest(new { message = "章节不存在或不属于该书" });
        var uid = CurrentUserId;
        var p = await db.ListenProgresses.FirstOrDefaultAsync(x => x.UserId == uid && x.ChapterId == req.ChapterId);
        if (p is null)
        {
            p = new ListenProgress { UserId = uid, AudiobookId = req.AudiobookId, ChapterId = req.ChapterId };
            db.ListenProgresses.Add(p);
        }
        p.AudiobookId = req.AudiobookId;
        p.PositionSec = Math.Max(0, req.PositionSec);
        p.Finished = req.Finished;
        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }

    // GET /api/audiobooks/{id}/progress —— 我在这本书各章的进度（用于续播）
    [Authorize]
    [HttpGet("{id:int}/progress")]
    public async Task<IActionResult> BookProgress(int id)
    {
        var uid = CurrentUserId;
        var list = await db.ListenProgresses.Where(p => p.UserId == uid && p.AudiobookId == id)
            .Select(p => new { p.ChapterId, p.PositionSec, p.Finished, p.UpdatedAt }).ToListAsync();
        var last = list.OrderByDescending(x => x.UpdatedAt).FirstOrDefault();
        return Ok(new { chapters = list, lastChapterId = last?.ChapterId });
    }

    // GET /api/audiobooks/shelf —— 我的书架（有进度的书，按最近续播排序）
    [Authorize]
    [HttpGet("shelf")]
    public async Task<IActionResult> Shelf()
    {
        var uid = CurrentUserId;
        // 每本书取最近一条进度
        var recent = await db.ListenProgresses.Where(p => p.UserId == uid)
            .GroupBy(p => p.AudiobookId)
            .Select(g => new { AudiobookId = g.Key, LastAt = g.Max(x => x.UpdatedAt) })
            .OrderByDescending(x => x.LastAt).Take(50).ToListAsync();
        var bookIds = recent.Select(r => r.AudiobookId).ToList();
        var books = await db.Audiobooks.Where(b => bookIds.Contains(b.Id))
            .Select(b => new { b.Id, b.Title, b.Author, b.Narrator, b.CoverUrl, b.Category }).ToListAsync();
        var items = recent.Join(books, r => r.AudiobookId, b => b.Id, (r, b) => new { book = b, lastAt = r.LastAt });
        return Ok(items);
    }

    // ---------- 文字版(EPUB)阅读进度（登录用户）----------

    public record ReadReq(int AudiobookId, string Cfi, double Percent);

    // POST /api/audiobooks/read-progress —— 上报续读进度（按 用户+书 upsert）
    [Authorize]
    [HttpPost("read-progress")]
    public async Task<IActionResult> SaveReadProgress([FromBody] ReadReq req)
    {
        var book = await db.Audiobooks.FindAsync(req.AudiobookId);
        if (book is null) return NotFound();
        var uid = CurrentUserId;
        var p = await db.ReadProgresses.FirstOrDefaultAsync(x => x.UserId == uid && x.AudiobookId == req.AudiobookId);
        if (p is null) { p = new ReadProgress { UserId = uid, AudiobookId = req.AudiobookId }; db.ReadProgresses.Add(p); }
        p.Cfi = req.Cfi ?? "";
        p.Percent = Math.Clamp(req.Percent, 0, 1);
        p.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }

    // GET /api/audiobooks/{id}/read-progress —— 我在这本书的续读位置（CFI）
    [Authorize]
    [HttpGet("{id:int}/read-progress")]
    public async Task<IActionResult> ReadProgressOf(int id)
    {
        var uid = CurrentUserId;
        var p = await db.ReadProgresses.FirstOrDefaultAsync(x => x.UserId == uid && x.AudiobookId == id);
        return Ok(new { cfi = p?.Cfi ?? "", percent = p?.Percent ?? 0 });
    }

    // GET /api/audiobooks/read-shelf —— 我的「继续阅读」书架（有阅读进度的书，按最近排序）
    [Authorize]
    [HttpGet("read-shelf")]
    public async Task<IActionResult> ReadShelf()
    {
        var uid = CurrentUserId;
        var recent = await db.ReadProgresses.Where(p => p.UserId == uid)
            .OrderByDescending(p => p.UpdatedAt).Take(50)
            .Select(p => new { p.AudiobookId, p.Percent, p.UpdatedAt }).ToListAsync();
        var ids = recent.Select(r => r.AudiobookId).ToList();
        var books = await db.Audiobooks.Where(b => ids.Contains(b.Id))
            .Select(b => new { b.Id, b.Title, b.Author, b.Narrator, b.CoverUrl, b.Category }).ToListAsync();
        var items = recent.Join(books, r => r.AudiobookId, b => b.Id, (r, b) => new { book = b, percent = r.Percent, lastAt = r.UpdatedAt });
        return Ok(items);
    }

    // ---------- 管理（admin）----------

    // 可选字段用 string? 避免 ASP.NET「非空引用=必填」校验（仅 Title 必填，handler 内查）
    public record BookReq(string? Title, string? Author, string? Narrator, string? CoverUrl, string? EpubUrl,
                          string? Category, string? Description, bool IsPublished, int OrderNo);

    [Authorize(Roles = "admin")]
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] BookReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Title)) return BadRequest(new { message = "书名不能为空" });
        var b = new Audiobook {
            Title = req.Title.Trim(), Author = req.Author ?? "", Narrator = req.Narrator ?? "",
            CoverUrl = req.CoverUrl ?? "", EpubUrl = req.EpubUrl ?? "",
            Category = string.IsNullOrWhiteSpace(req.Category) ? "其他" : req.Category,
            Description = req.Description ?? "", IsPublished = req.IsPublished, OrderNo = req.OrderNo,
        };
        db.Audiobooks.Add(b);
        await db.SaveChangesAsync();
        return Ok(new { b.Id });
    }

    [Authorize(Roles = "admin")]
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] BookReq req)
    {
        var b = await db.Audiobooks.FindAsync(id);
        if (b is null) return NotFound();
        b.Title = req.Title?.Trim() ?? b.Title; b.Author = req.Author ?? ""; b.Narrator = req.Narrator ?? "";
        b.CoverUrl = req.CoverUrl ?? ""; b.EpubUrl = req.EpubUrl ?? "";
        b.Category = string.IsNullOrWhiteSpace(req.Category) ? "其他" : req.Category;
        b.Description = req.Description ?? ""; b.IsPublished = req.IsPublished; b.OrderNo = req.OrderNo;
        b.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }

    [Authorize(Roles = "admin")]
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var b = await db.Audiobooks.FindAsync(id);
        if (b is null) return NotFound();
        // 先收集要物理删的上传文件（章节媒体 + 上传的封面）
        var upFiles = await db.AudiobookChapters.Where(c => c.AudiobookId == id && c.Source == "upload")
            .Select(c => c.MediaUrl).ToListAsync();
        db.AudiobookChapters.RemoveRange(db.AudiobookChapters.Where(c => c.AudiobookId == id));
        db.ListenProgresses.RemoveRange(db.ListenProgresses.Where(p => p.AudiobookId == id));
        db.ReadProgresses.RemoveRange(db.ReadProgresses.Where(p => p.AudiobookId == id));
        db.Audiobooks.Remove(b);
        await db.SaveChangesAsync();
        foreach (var u in upFiles) TryDeleteUploadedFile("upload", u);   // DB 删成功后再删文件，防泄漏
        TryDeleteUploadedFile("upload", b.CoverUrl);
        TryDeleteUploadedFile("upload", b.EpubUrl);   // 上传的 EPUB 一并物理删（外链不在 /uploads 下，自动跳过）
        return Ok(new { ok = true });
    }

    // ---- 章节管理 ----
    public record ChapterReq(string? Title, string? MediaType, string? MediaUrl, string? Source, int Duration, int OrderNo);

    [Authorize(Roles = "admin")]
    [HttpPost("{id:int}/chapters")]
    public async Task<IActionResult> AddChapter(int id, [FromBody] ChapterReq req)
    {
        if (await db.Audiobooks.FindAsync(id) is null) return NotFound();
        if (string.IsNullOrWhiteSpace(req.MediaUrl)) return BadRequest(new { message = "媒体地址不能为空" });
        var mt = req.MediaType == "video" ? "video" : "audio";
        var c = new AudiobookChapter {
            AudiobookId = id, Title = req.Title ?? "", MediaType = mt, MediaUrl = req.MediaUrl.Trim(),
            Source = req.Source == "upload" ? "upload" : "link", Duration = req.Duration, OrderNo = req.OrderNo,
        };
        db.AudiobookChapters.Add(c);
        await db.SaveChangesAsync();
        return Ok(new { c.Id });
    }

    [Authorize(Roles = "admin")]
    [HttpPut("chapters/{cid:int}")]
    public async Task<IActionResult> UpdateChapter(int cid, [FromBody] ChapterReq req)
    {
        var c = await db.AudiobookChapters.FindAsync(cid);
        if (c is null) return NotFound();
        c.Title = req.Title ?? c.Title;
        c.MediaType = req.MediaType == "video" ? "video" : "audio";
        if (!string.IsNullOrWhiteSpace(req.MediaUrl)) c.MediaUrl = req.MediaUrl.Trim();
        c.Source = req.Source == "upload" ? "upload" : "link";
        c.Duration = req.Duration; c.OrderNo = req.OrderNo;
        await db.SaveChangesAsync();
        return Ok(new { ok = true });
    }

    [Authorize(Roles = "admin")]
    [HttpDelete("chapters/{cid:int}")]
    public async Task<IActionResult> DeleteChapter(int cid)
    {
        var c = await db.AudiobookChapters.FindAsync(cid);
        if (c is null) return NotFound();
        db.AudiobookChapters.Remove(c);
        db.ListenProgresses.RemoveRange(db.ListenProgresses.Where(p => p.ChapterId == cid));
        await db.SaveChangesAsync();
        TryDeleteUploadedFile(c.Source, c.MediaUrl);   // 上传的媒体一并物理删，防泄漏
        return Ok(new { ok = true });
    }

    // ---- 媒体上传（admin）：音频/视频文件 → 存 wwwroot/uploads/audiobooks/ → 返回 URL ----
    [Authorize(Roles = "admin")]
    [HttpPost("upload")]
    [RequestSizeLimit(600_000_000)]                              // 整体请求体上限
    [RequestFormLimits(MultipartBodyLengthLimit = 600_000_000)]  // multipart 表单绑定上限（默认仅128MB，必须成对，否则600MB形同128MB）
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest(new { message = "未收到文件" });
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        var audioExt = new[] { ".mp3", ".m4a", ".aac", ".wav", ".ogg" };
        var videoExt = new[] { ".mp4", ".webm", ".mov", ".m4v" };
        var imageExt = new[] { ".jpg", ".jpeg", ".png", ".webp", ".gif" };   // 封面用（同端点，章节侧 accept 只给音视频，不会传图）
        var bookExt  = new[] { ".epub" };                                    // 文字版（EPUB）
        if (!audioExt.Contains(ext) && !videoExt.Contains(ext) && !imageExt.Contains(ext) && !bookExt.Contains(ext))
            return BadRequest(new { message = "仅支持音频/视频、图片(封面)或 EPUB(文字版)" });
        // 磁盘可用空间预检（2G/17G 小机防写撑爆）：需 文件大小 + 500MB 余量，不足直接拒
        try {
            var root = Path.GetPathRoot(Path.GetFullPath(env.WebRootPath));
            if (!string.IsNullOrEmpty(root) && new DriveInfo(root).AvailableFreeSpace < file.Length + 500L * 1024 * 1024)
                return StatusCode(507, new { message = "服务器磁盘空间不足，暂无法上传，请改用外链或清理后再试" });
        } catch { /* 取不到磁盘信息就不拦 */ }
        var dir = Path.Combine(env.WebRootPath, "uploads", "audiobooks");
        Directory.CreateDirectory(dir);
        var name = $"{Guid.NewGuid():N}{ext}";
        await using (var fs = System.IO.File.Create(Path.Combine(dir, name)))
            await file.CopyToAsync(fs);
        var url = $"/uploads/audiobooks/{name}";
        var mediaType = videoExt.Contains(ext) ? "video" : imageExt.Contains(ext) ? "image"
                        : bookExt.Contains(ext) ? "epub" : "audio";
        return Ok(new { url, mediaType, source = "upload" });
    }
}

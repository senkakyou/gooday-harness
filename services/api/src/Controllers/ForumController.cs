// =====================================================
// Controllers/ForumController.cs —— 社区论坛接口
// 路由前缀：/api/forum
// 职责：板块管理、帖子列表、帖子详情、发帖、回复、点赞、媒体上传、管理员操作
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/forum")]
public class ForumController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    int CurrentUserId => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
    bool IsAdmin => User.IsInRole("admin");

    // ---- 仅管理员板块（ForumCategory.AdminOnly）的访问控制 ----
    // 一律返回 404 而不是 403：403 等于告诉对方"这里有东西但你看不了"，
    // 而这个开关的目的就是让板块对非管理员**不存在**。
    // 覆盖面必须是全部入口——板块列表、板块页、帖子页、发帖、回帖、编辑、删除、点赞。
    // 只封列表页是最常见的漏法：帖子 URL 猜得到，也能从旧链接进来。
    async Task<bool> ThreadHiddenFromMe(int threadId) =>
        !IsAdmin && await db.ForumThreads.AnyAsync(t => t.Id == threadId && t.Category.AdminOnly);

    async Task<bool> PostHiddenFromMe(int postId) =>
        !IsAdmin && await db.ForumPosts.AnyAsync(p => p.Id == postId && p.Thread.Category.AdminOnly);

    // ================================================================
    // 板块（公开）
    // ================================================================

    // GET /api/forum/categories
    [HttpGet("categories")]
    public async Task<IActionResult> ListCategories()
    {
        bool isAdmin = IsAdmin;                       // 先落成局部变量，否则 EF 翻译不了 User.IsInRole
        var list = await db.ForumCategories
            .Where(c => c.IsVisible && (!c.AdminOnly || isAdmin))
            .OrderBy(c => c.SortOrder).ThenBy(c => c.Id)
            .Select(c => new {
                c.Id, c.Name, c.Slug, c.Description, c.Icon, c.AdminOnly,
                threadCount = db.ForumThreads.Count(t => t.CategoryId == c.Id && !t.IsDeleted),
                postCount   = db.ForumPosts.Count(p => p.Thread.CategoryId == c.Id && !p.IsDeleted && !p.Thread.IsDeleted),
                lastThread  = db.ForumThreads
                    .Where(t => t.CategoryId == c.Id && !t.IsDeleted)
                    .OrderByDescending(t => t.LastReplyAt)
                    .Select(t => new { t.Id, t.Title, t.LastReplyAt,
                        lastUser = t.LastReplyUser != null ? t.LastReplyUser.Username : t.Author.Username })
                    .FirstOrDefault()
            })
            .ToListAsync();
        return Ok(list);
    }

    // GET /api/forum/categories/{slug}/threads?page=1&pageSize=30
    [HttpGet("categories/{slug}/threads")]
    public async Task<IActionResult> GetThreads(string slug, [FromQuery] int page = 1, [FromQuery] int pageSize = 30)
    {
        var cat = await db.ForumCategories.FirstOrDefaultAsync(c => c.Slug == slug && c.IsVisible);
        if (cat == null) return NotFound(new { message = "板块不存在" });
        if (cat.AdminOnly && !IsAdmin) return NotFound(new { message = "板块不存在" });

        pageSize = Math.Clamp(pageSize, 10, 50);
        var q = db.ForumThreads
            .Where(t => t.CategoryId == cat.Id && !t.IsDeleted)
            .OrderByDescending(t => t.IsPinned)
            .ThenByDescending(t => t.LastReplyAt);

        var total = await q.CountAsync();
        var threads = await q
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(t => new {
                t.Id, t.Title, t.IsPinned, t.IsLocked,
                t.ViewCount, t.ReplyCount,
                t.CreatedAt, t.LastReplyAt,
                author = new { t.Author.Id, t.Author.Username },
                lastReplyUser = t.LastReplyUser != null ? new { t.LastReplyUser.Id, t.LastReplyUser.Username } : null
            })
            .ToListAsync();

        return Ok(new { category = new { cat.Id, cat.Name, cat.Slug, cat.Description, cat.Icon, cat.AdminOnly }, total, page, pageSize, threads });
    }

    // GET /api/forum/threads/{id}?page=1&pageSize=20
    [HttpGet("threads/{id:int}")]
    public async Task<IActionResult> GetThread(int id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        var thread = await db.ForumThreads
            .Include(t => t.Author)
            .Include(t => t.Category)
            .FirstOrDefaultAsync(t => t.Id == id && !t.IsDeleted);
        if (thread == null) return NotFound(new { message = "帖子不存在" });
        // 判权限要在浏览数 +1 之前：否则非管理员每探一次，计数就涨一次，
        // 等于给对方一个"这个 ID 有东西"的旁证。
        if (thread.Category.AdminOnly && !IsAdmin) return NotFound(new { message = "帖子不存在" });

        // 浏览数 +1
        thread.ViewCount++;
        await db.SaveChangesAsync();

        pageSize = Math.Clamp(pageSize, 5, 50);
        var postsQ = db.ForumPosts
            .Where(p => p.ThreadId == id)
            .OrderBy(p => p.FloorNumber);

        var total = await postsQ.CountAsync();

        // 当前登录用户已点赞的楼层 ID
        int? uid = User.Identity?.IsAuthenticated == true ? CurrentUserId : null;
        var likedPostIds = uid.HasValue
            ? await db.ForumPostLikes.Where(l => l.UserId == uid.Value && l.Post.ThreadId == id).Select(l => l.PostId).ToListAsync()
            : new List<int>();

        var posts = await postsQ
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => new {
                p.Id, p.FloorNumber, p.LikeCount,
                content = p.IsDeleted ? null : p.Content,
                p.IsDeleted, p.CreatedAt, p.UpdatedAt,
                author = new { p.Author.Id, p.Author.Username, p.Author.CreatedAt }
            })
            .ToListAsync();

        var postsWithLike = posts.Select(p => new {
            p.Id, p.FloorNumber, p.LikeCount,
            p.content, p.IsDeleted, p.CreatedAt, p.UpdatedAt, p.author,
            liked = likedPostIds.Contains(p.Id)
        });

        return Ok(new {
            thread = new {
                thread.Id, thread.Title, thread.IsPinned, thread.IsLocked,
                thread.ViewCount, thread.ReplyCount, thread.CreatedAt,
                category = new { thread.Category.Id, thread.Category.Name, thread.Category.Slug },
                author = new { thread.Author.Id, thread.Author.Username }
            },
            total, page, pageSize,
            posts = postsWithLike
        });
    }

    // ================================================================
    // 发帖 / 回帖（需登录）
    // ================================================================

    public record CreateThreadReq(int CategoryId, string Title, string Content);

    // POST /api/forum/threads
    [Authorize]
    [HttpPost("threads")]
    public async Task<IActionResult> CreateThread([FromBody] CreateThreadReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Title) || req.Title.Length < 2)
            return BadRequest(new { message = "标题至少2个字" });
        if (string.IsNullOrWhiteSpace(req.Content) || req.Content.Length < 5)
            return BadRequest(new { message = "内容至少5个字" });

        var cat = await db.ForumCategories.FindAsync(req.CategoryId);
        if (cat == null || !cat.IsVisible) return BadRequest(new { message = "板块不存在" });
        if (cat.AdminOnly && !IsAdmin) return BadRequest(new { message = "板块不存在" });

        var uid = CurrentUserId;
        var now = DateTime.UtcNow;

        var thread = new ForumThread {
            Title = req.Title.Trim(), CategoryId = req.CategoryId,
            AuthorId = uid, CreatedAt = now, LastReplyAt = now
        };
        db.ForumThreads.Add(thread);
        await db.SaveChangesAsync();

        var post = new ForumPost {
            ThreadId = thread.Id, AuthorId = uid,
            Content = req.Content, FloorNumber = 1, CreatedAt = now
        };
        db.ForumPosts.Add(post);
        await db.SaveChangesAsync();

        return Ok(new { threadId = thread.Id });
    }

    public record ReplyReq(string Content);

    // POST /api/forum/threads/{id}/posts
    [Authorize]
    [HttpPost("threads/{id:int}/posts")]
    public async Task<IActionResult> Reply(int id, [FromBody] ReplyReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Content) || req.Content.Length < 1)
            return BadRequest(new { message = "回复不能为空" });

        var thread = await db.ForumThreads.FindAsync(id);
        if (thread == null || thread.IsDeleted) return NotFound(new { message = "帖子不存在" });
        if (await ThreadHiddenFromMe(id)) return NotFound(new { message = "帖子不存在" });
        if (thread.IsLocked) return BadRequest(new { message = "帖子已锁定，无法回复" });

        var uid = CurrentUserId;
        var now = DateTime.UtcNow;
        var floor = await db.ForumPosts.Where(p => p.ThreadId == id).MaxAsync(p => (int?)p.FloorNumber) ?? 0;

        var post = new ForumPost {
            ThreadId = id, AuthorId = uid,
            Content = req.Content, FloorNumber = floor + 1, CreatedAt = now
        };
        db.ForumPosts.Add(post);

        thread.ReplyCount++;
        thread.LastReplyAt = now;
        thread.LastReplyUserId = uid;

        await db.SaveChangesAsync();
        return Ok(new { postId = post.Id, floorNumber = post.FloorNumber });
    }

    // PUT /api/forum/posts/{id}
    [Authorize]
    [HttpPut("posts/{id:int}")]
    public async Task<IActionResult> EditPost(int id, [FromBody] ReplyReq req)
    {
        var post = await db.ForumPosts.Include(p => p.Thread).FirstOrDefaultAsync(p => p.Id == id);
        if (post == null || post.IsDeleted) return NotFound();
        if (await PostHiddenFromMe(id)) return NotFound();

        var uid = CurrentUserId;
        if (post.AuthorId != uid && !IsAdmin) return Forbid();
        if (post.Thread.IsLocked && !IsAdmin) return BadRequest(new { message = "帖子已锁定" });

        post.Content = req.Content;
        post.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok();
    }

    // DELETE /api/forum/posts/{id}
    [Authorize]
    [HttpDelete("posts/{id:int}")]
    public async Task<IActionResult> DeletePost(int id)
    {
        var post = await db.ForumPosts.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == id);
        if (post == null) return NotFound();
        if (await PostHiddenFromMe(id)) return NotFound();

        var uid = CurrentUserId;
        if (post.AuthorId != uid && !IsAdmin) return Forbid();

        await db.Database.ExecuteSqlRawAsync(
            "UPDATE ForumPosts SET IsDeleted = 1 WHERE Id = {0}", id);

        // 非首楼才扣减回复计数，避免负数
        if (post.FloorNumber > 1)
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE ForumThreads SET ReplyCount = MAX(0, ReplyCount - 1) WHERE Id = {0}",
                post.ThreadId);

        return Ok();
    }

    // DELETE /api/forum/threads/{id}
    [Authorize]
    [HttpDelete("threads/{id:int}")]
    public async Task<IActionResult> DeleteThread(int id)
    {
        var thread = await db.ForumThreads.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == id);
        if (thread == null) return NotFound(new { message = "帖子不存在" });
        if (await ThreadHiddenFromMe(id)) return NotFound(new { message = "帖子不存在" });

        var uid = CurrentUserId;
        if (thread.AuthorId != uid && !IsAdmin) return Forbid();

        // 直接 SQL UPDATE 绕过 EF Core 实体追踪和级联逻辑
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE ForumThreads SET IsDeleted = 1 WHERE Id = {0}", id);
        return Ok();
    }

    // POST /api/forum/posts/{id}/like
    [Authorize]
    [HttpPost("posts/{id:int}/like")]
    public async Task<IActionResult> ToggleLike(int id)
    {
        var post = await db.ForumPosts.FindAsync(id);
        if (post == null || post.IsDeleted) return NotFound();
        if (await PostHiddenFromMe(id)) return NotFound();

        var uid = CurrentUserId;
        var existing = await db.ForumPostLikes.FirstOrDefaultAsync(l => l.PostId == id && l.UserId == uid);
        if (existing != null)
        {
            db.ForumPostLikes.Remove(existing);
            post.LikeCount = Math.Max(0, post.LikeCount - 1);
            await db.SaveChangesAsync();
            return Ok(new { liked = false, likeCount = post.LikeCount });
        }

        db.ForumPostLikes.Add(new ForumPostLike { PostId = id, UserId = uid });
        post.LikeCount++;
        await db.SaveChangesAsync();
        return Ok(new { liked = true, likeCount = post.LikeCount });
    }

    // ================================================================
    // 管理员操作
    // ================================================================

    // PUT /api/forum/threads/{id}/pin
    [Authorize(Roles = "admin")]
    [HttpPut("threads/{id:int}/pin")]
    public async Task<IActionResult> TogglePin(int id)
    {
        var t = await db.ForumThreads.FindAsync(id);
        if (t == null) return NotFound();
        t.IsPinned = !t.IsPinned;
        await db.SaveChangesAsync();
        return Ok(new { isPinned = t.IsPinned });
    }

    // PUT /api/forum/threads/{id}/lock
    [Authorize(Roles = "admin")]
    [HttpPut("threads/{id:int}/lock")]
    public async Task<IActionResult> ToggleLock(int id)
    {
        var t = await db.ForumThreads.FindAsync(id);
        if (t == null) return NotFound();
        t.IsLocked = !t.IsLocked;
        await db.SaveChangesAsync();
        return Ok(new { isLocked = t.IsLocked });
    }

    // ================================================================
    // 板块管理（admin CRUD）
    // ================================================================

    // AdminOnly 用可空 bool：老前端（或别处脚本）不带这个字段时**保持原值**，
    // 而不是被默默重置成 false——那等于一次误提交就把私密板块公开了。
    public record CategoryReq(string Name, string Slug, string Description, string Icon,
                              int SortOrder, bool IsVisible, bool? AdminOnly = null);

    [Authorize(Roles = "admin")]
    [HttpGet("admin/categories")]
    public async Task<IActionResult> AdminListCategories()
    {
        var list = await db.ForumCategories.OrderBy(c => c.SortOrder).ThenBy(c => c.Id).ToListAsync();
        return Ok(list);
    }

    [Authorize(Roles = "admin")]
    [HttpPost("admin/categories")]
    public async Task<IActionResult> AdminCreateCategory([FromBody] CategoryReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Name)) return BadRequest(new { message = "请填写板块名称" });
        if (string.IsNullOrWhiteSpace(req.Slug))  return BadRequest(new { message = "请填写板块标识" });

        if (await db.ForumCategories.AnyAsync(c => c.Slug == req.Slug))
            return BadRequest(new { message = "板块标识已存在" });

        var cat = new ForumCategory {
            Name = req.Name, Slug = req.Slug, Description = req.Description,
            Icon = string.IsNullOrWhiteSpace(req.Icon) ? "💬" : req.Icon,
            SortOrder = req.SortOrder, IsVisible = req.IsVisible,
            AdminOnly = req.AdminOnly ?? false
        };
        db.ForumCategories.Add(cat);
        await db.SaveChangesAsync();
        return Ok(cat);
    }

    [Authorize(Roles = "admin")]
    [HttpPut("admin/categories/{id:int}")]
    public async Task<IActionResult> AdminUpdateCategory(int id, [FromBody] CategoryReq req)
    {
        var cat = await db.ForumCategories.FindAsync(id);
        if (cat == null) return NotFound();

        if (await db.ForumCategories.AnyAsync(c => c.Slug == req.Slug && c.Id != id))
            return BadRequest(new { message = "板块标识已存在" });

        cat.Name = req.Name; cat.Slug = req.Slug; cat.Description = req.Description;
        cat.Icon = string.IsNullOrWhiteSpace(req.Icon) ? "💬" : req.Icon;
        cat.SortOrder = req.SortOrder; cat.IsVisible = req.IsVisible;
        if (req.AdminOnly.HasValue) cat.AdminOnly = req.AdminOnly.Value;
        await db.SaveChangesAsync();
        return Ok(cat);
    }

    [Authorize(Roles = "admin")]
    [HttpDelete("admin/categories/{id:int}")]
    public async Task<IActionResult> AdminDeleteCategory(int id)
    {
        var exists = await db.ForumCategories.AnyAsync(c => c.Id == id);
        if (!exists) return NotFound();

        // 按 FK 依赖顺序级联删除（包括软删除的行），绕过 EF Core 实体追踪
        await db.Database.ExecuteSqlRawAsync(
            @"DELETE FROM ForumPostLikes WHERE PostId IN
              (SELECT Id FROM ForumPosts WHERE ThreadId IN
               (SELECT Id FROM ForumThreads WHERE CategoryId = {0}))", id);
        await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM ForumPosts WHERE ThreadId IN (SELECT Id FROM ForumThreads WHERE CategoryId = {0})", id);
        await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM ForumThreads WHERE CategoryId = {0}", id);
        await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM ForumCategories WHERE Id = {0}", id);

        return Ok();
    }

    // GET /api/forum/admin/threads?categoryId=&page=1 (管理员查所有帖子)
    [Authorize(Roles = "admin")]
    [HttpGet("admin/threads")]
    public async Task<IActionResult> AdminListThreads([FromQuery] int? categoryId, [FromQuery] int page = 1)
    {
        const int pageSize = 30;
        var q = db.ForumThreads.Where(t => !t.IsDeleted);
        if (categoryId.HasValue) q = q.Where(t => t.CategoryId == categoryId);
        var total = await q.CountAsync();
        var threads = await q.OrderByDescending(t => t.LastReplyAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(t => new {
                t.Id, t.Title, t.IsPinned, t.IsLocked, t.ViewCount, t.ReplyCount, t.CreatedAt,
                category = new { t.Category.Id, t.Category.Name },
                author = new { t.Author.Id, t.Author.Username }
            }).ToListAsync();
        return Ok(new { total, page, pageSize, threads });
    }

    // ================================================================
    // 媒体上传（登录用户均可上传）
    // POST /api/forum/upload
    // ================================================================
    [Authorize]
    [HttpPost("upload")]
    [RequestSizeLimit(300L * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 300L * 1024 * 1024)]
    public async Task<IActionResult> UploadMedia(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "请选择文件" });

        var ext = Path.GetExtension(file.FileName).ToLower();
        var imageExts = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var videoExts = new[] { ".mp4", ".webm", ".mov" };
        bool isImage = imageExts.Contains(ext);
        bool isVideo = videoExts.Contains(ext);

        if (!isImage && !isVideo)
            return BadRequest(new { message = "只支持图片（jpg/png/gif/webp）和视频（mp4/webm/mov）" });

        long maxBytes = isImage ? 30L * 1024 * 1024 : 300L * 1024 * 1024;
        if (file.Length > maxBytes)
            return BadRequest(new { message = isImage ? "图片最大 30MB" : "视频最大 300MB" });

        var dir = Path.Combine(env.WebRootPath, "uploads", "forum");
        Directory.CreateDirectory(dir);

        var fileName = $"{Guid.NewGuid()}{ext}";
        using var stream = System.IO.File.Create(Path.Combine(dir, fileName));
        await file.CopyToAsync(stream);

        return Ok(new {
            url  = $"/uploads/forum/{fileName}",
            type = isImage ? "image" : "video"
        });
    }
}

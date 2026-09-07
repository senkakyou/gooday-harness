// =====================================================
// Controllers/AdminController.cs —— 后台管理接口
// 路由前缀：/api/admin
// 职责：用户管理、工具增删改、文件上传、统计数据
// 权限：[Authorize(Roles="admin")] 保护所有接口，非 admin 返回 403
// =====================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using GoodayTools.Data;
using GoodayTools.Models;
using GoodayTools.Services;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize(Roles="admin")]  // 整个控制器都需要 admin 角色，不需要每个方法单独标注
public class AdminController(AppDbContext db, IWebHostEnvironment env, NotificationService notif) : ControllerBase {

    int CurrentUserId => int.Parse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)!.Value);

    // GET /api/admin/users —— 获取所有用户列表（按注册时间倒序）
    [HttpGet("users")]
    public async Task<IActionResult> GetUsers() =>
        Ok(await db.Users.OrderByDescending(u => u.CreatedAt)
            .Select(u => new { u.Id,u.Username,u.Email,u.Role,u.IsActive,u.CreatedAt,u.LastLoginAt })
            .ToListAsync());

    // PUT /api/admin/users/:id/toggle —— 切换用户启用/禁用状态
    [HttpPut("users/{id}/toggle")]
    public async Task<IActionResult> ToggleUser(int id) {
        var user = await db.Users.FindAsync(id);
        if (user==null) return NotFound();
        if (user.Role=="admin") return BadRequest(new { message="不能禁用管理员" });  // 保护 admin 账号
        user.IsActive = !user.IsActive;  // 取反
        await db.SaveChangesAsync();
        return Ok(new { isActive=user.IsActive });
    }

    // ToolDto：接收新增/编辑工具时前端发来的数据
    public record ToolDto(string Name, string Slug, string Description, string Category,
        string IconEmoji, bool IsOnline, string? OnlineUrl, bool HasDownload,
        string? DownloadFileName, bool IsPublished, bool RequireLogin, string? ReadmeMarkdown,
        bool IsPaid = false, decimal Price = 0);

    // GET /api/admin/tools —— 获取所有工具（含未发布的，管理员专用）
    [HttpGet("tools")]
    public async Task<IActionResult> GetTools() =>
        Ok(await db.Tools.OrderByDescending(t => t.CreatedAt).ToListAsync());

    // POST /api/admin/tools —— 新增工具
    [HttpPost("tools")]
    public async Task<IActionResult> CreateTool(ToolDto dto) {
        // slug 必须唯一（用作 URL 标识符）
        if (await db.Tools.AnyAsync(t => t.Slug==dto.Slug))
            return BadRequest(new { message="Slug已存在" });
        var tool = new Tool { Name=dto.Name,Slug=dto.Slug,Description=dto.Description,
            Category=dto.Category,IconEmoji=dto.IconEmoji,IsOnline=dto.IsOnline,
            OnlineUrl=dto.OnlineUrl,HasDownload=dto.HasDownload,DownloadFileName=dto.DownloadFileName,
            IsPublished=dto.IsPublished,RequireLogin=dto.RequireLogin,ReadmeMarkdown=dto.ReadmeMarkdown,
            IsPaid=dto.IsPaid,Price=dto.Price };
        db.Tools.Add(tool);
        await db.SaveChangesAsync();
        return Ok(tool);
    }

    // PUT /api/admin/tools/:id —— 更新工具
    [HttpPut("tools/{id}")]
    public async Task<IActionResult> UpdateTool(int id, ToolDto dto) {
        var tool = await db.Tools.FindAsync(id);
        if (tool==null) return NotFound();
        // 逐字段更新（EF Core 会只更新有变化的字段）
        tool.Name=dto.Name; tool.Slug=dto.Slug; tool.Description=dto.Description;
        tool.Category=dto.Category; tool.IconEmoji=dto.IconEmoji; tool.IsOnline=dto.IsOnline;
        tool.OnlineUrl=dto.OnlineUrl; tool.HasDownload=dto.HasDownload;
        tool.DownloadFileName=dto.DownloadFileName; tool.IsPublished=dto.IsPublished;
        tool.RequireLogin=dto.RequireLogin; tool.ReadmeMarkdown=dto.ReadmeMarkdown;
        tool.IsPaid=dto.IsPaid; tool.Price=dto.Price;
        tool.UpdatedAt=DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(tool);
    }

    // DELETE /api/admin/tools/:id —— 删除工具
    [HttpDelete("tools/{id}")]
    public async Task<IActionResult> DeleteTool(int id) {
        var tool = await db.Tools.FindAsync(id);
        if (tool==null) return NotFound();
        // 先清理依赖记录：购买/使用日志的外键非级联，有记录时会阻止删除（如已被购买的工具）；
        // 下载虽是级联，收藏无外键，一并清掉避免遗留孤儿数据。
        db.ToolPurchases.RemoveRange(db.ToolPurchases.Where(p => p.ToolId == id));
        db.ToolUsageLogs.RemoveRange(db.ToolUsageLogs.Where(l => l.ToolId == id));
        db.ToolDownloads.RemoveRange(db.ToolDownloads.Where(d => d.ToolId == id));
        db.ToolFavorites.RemoveRange(db.ToolFavorites.Where(f => f.ToolId == id));
        db.Tools.Remove(tool);
        await db.SaveChangesAsync();
        return Ok();
    }

    // 工具分发允许的文件类型（网页工具、压缩包、文档、媒体、脚本、安装包）
    private static readonly HashSet<string> AllowedUploadExts = new(StringComparer.OrdinalIgnoreCase) {
        ".html", ".css", ".js", ".json",
        ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz",
        ".pdf", ".txt", ".md", ".csv", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
        ".mp3", ".m4a", ".wav", ".mp4", ".webm",
        ".py", ".sh", ".bat", ".ps1",
        ".exe", ".msi", ".dmg", ".apk", ".deb", ".appimage",
    };

    // POST /api/admin/upload —— 上传工具文件到 wwwroot/uploads/
    [HttpPost("upload")]
    public async Task<IActionResult> UploadFile(IFormFile file) {
        if (file.Length==0) return BadRequest(new { message="文件为空" });
        if (file.Length > 100*1024*1024) return BadRequest(new { message="不能超过100MB" });

        var orig = Path.GetFileName(file.FileName);
        var ext = Path.GetExtension(orig);
        if (string.IsNullOrEmpty(ext) || !AllowedUploadExts.Contains(ext))
            return BadRequest(new { message="不支持的文件类型" });

        var dir = Path.Combine(env.WebRootPath, "uploads");
        Directory.CreateDirectory(dir);  // 目录不存在则创建

        var name = Path.GetFileNameWithoutExtension(orig);
        var fn = orig;

        // 同名文件已存在时，加时间戳后缀避免覆盖（如 tool_20240115120000.zip）
        if (System.IO.File.Exists(Path.Combine(dir, fn)))
            fn = $"{name}_{DateTime.UtcNow:yyyyMMddHHmmss}{ext}";

        using var s = System.IO.File.Create(Path.Combine(dir, fn));
        await file.CopyToAsync(s);
        return Ok(new { fileName=fn, size=file.Length });
    }

    // 扫描所有引用 uploads/ 文件的来源，构建“相对路径→用途”和“文件名→用途”两张表。
    // 之所以两张表：在线工具/说明/二手/论坛的引用是带子目录的完整路径（按 rel 匹配），
    // 而工具的 DownloadFileName 只存了纯文件名（按 name 匹配）。
    private async Task<(Dictionary<string,string> byRel, Dictionary<string,string> byName)> BuildFileUsageAsync(string root) {
        var byRel  = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        var byName = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);

        void Add(Dictionary<string,string> map, string key, string label) {
            key = key.TrimStart('/');
            if (string.IsNullOrEmpty(key)) return;
            if (map.TryGetValue(key, out var cur)) {
                if (!cur.Contains(label)) map[key] = cur + "；" + label;
            } else map[key] = label;
        }
        // 从任意文本中提取所有 /uploads/xxx 引用（覆盖直接 URL、Markdown ![](...)、[img:...] 等写法）
        void Scan(string? text, string label) {
            if (string.IsNullOrEmpty(text)) return;
            foreach (Match m in Regex.Matches(text, @"/uploads/([^\s""'>)\]\\]+)"))
                Add(byRel, Uri.UnescapeDataString(m.Groups[1].Value), label);
        }

        // 工具：在线运行 URL（即工具本体 HTML）、说明文档内嵌图片、下载文件
        var tools = await db.Tools
            .Select(t => new { t.Name, t.OnlineUrl, t.DownloadFileName, t.ReadmeMarkdown })
            .ToListAsync();
        foreach (var t in tools) {
            Scan(t.OnlineUrl, $"在线工具：{t.Name}");
            Scan(t.ReadmeMarkdown, $"工具说明：{t.Name}");
            if (!string.IsNullOrEmpty(t.DownloadFileName)) {
                // DownloadFileName 可能是纯文件名（micrograd.zip）也可能带子目录（zip/micrograd.zip），
                // 两种都登记：带子目录的按完整相对路径匹配（byRel），纯文件名按文件名匹配（byName）。
                var dl = t.DownloadFileName!.Replace('\\', '/').TrimStart('/');
                Add(byRel, dl, $"下载文件：{t.Name}");
                Add(byName, Path.GetFileName(dl), $"下载文件：{t.Name}");
            }
        }

        // 二手商品图片（Images 为 JSON 数组字符串）
        foreach (var i in await db.SecondhandItems.Select(i => new { i.Title, i.Images }).ToListAsync())
            Scan(i.Images, $"二手商品：{i.Title}");

        // 论坛帖子内容内嵌图片/视频（排除已删除的帖子和已删除的主题）
        foreach (var p in await db.ForumPosts.Where(p => !p.IsDeleted && !p.Thread.IsDeleted).Select(p => new { p.ThreadId, p.Content }).ToListAsync())
            Scan(p.Content, $"论坛帖子(主题#{p.ThreadId})");

        // 听书：封面图、EPUB 文字版、各章节音频（外链自动跳过，Scan 只匹配 /uploads）
        var abTitles = await db.Audiobooks.Select(b => new { b.Id, b.Title, b.CoverUrl, b.EpubUrl }).ToListAsync();
        var abTitleById = abTitles.ToDictionary(b => b.Id, b => b.Title);
        foreach (var b in abTitles) {
            Scan(b.CoverUrl, $"听书封面：{b.Title}");
            Scan(b.EpubUrl,  $"听书文字版：{b.Title}");
        }
        foreach (var c in await db.AudiobookChapters.Select(c => new { c.AudiobookId, c.MediaUrl }).ToListAsync()) {
            abTitleById.TryGetValue(c.AudiobookId, out var t);
            Scan(c.MediaUrl, string.IsNullOrEmpty(t) ? "听书章节音频" : $"听书音频：{t}");
            // 字幕按约定动态挂载（章节同名 .lrc，见 AudiobookController 详情接口的 subtitleUrl），
            // 不写在任何字段里→随音频一并标为使用中，防被当空闲误删（成语英语版字幕即此类）
            if (!string.IsNullOrEmpty(c.MediaUrl) && c.MediaUrl.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase))
                Scan(c.MediaUrl[..^4] + ".lrc", string.IsNullOrEmpty(t) ? "听书章节字幕" : $"听书字幕：{t}");
        }

        // 私信内容：交付物下载链接经私信发客户(/uploads/deliverables/..，工单结单校验就靠它)、
        // 站长手动发的图片文件等。chat-media 前缀的聊天媒体天然不匹配 /uploads，不会误入
        foreach (var pm in await db.PrivateMessages.Select(m => new { m.Content, m.SenderUsername, m.ReceiverUsername }).ToListAsync())
            Scan(pm.Content, $"私信({pm.SenderUsername}→{pm.ReceiverUsername})");

        // 定制需求单：附件以「【附件】name: /uploads/requests/..」形式内嵌在描述里(见 RequestsHome.jsx)
        foreach (var r in await db.DevRequests.Select(x => new { x.Title, x.Description, x.AdminNote }).ToListAsync()) {
            Scan(r.Description, $"需求单：{r.Title}");
            Scan(r.AdminNote, $"需求单备注：{r.Title}");
        }

        // 项目：描述/方案/交付说明/内部备注，交付物链接落在其中(交付物在 /uploads/deliverables/..)
        foreach (var pj in await db.Projects.Select(p => new { p.Title, p.Description, p.PlanMarkdown, p.DeliveryNotes, p.AdminNote }).ToListAsync()) {
            Scan(pj.Description, $"项目描述：{pj.Title}");
            Scan(pj.PlanMarkdown, $"项目方案：{pj.Title}");
            Scan(pj.DeliveryNotes, $"项目交付说明：{pj.Title}");
            Scan(pj.AdminNote, $"项目备注：{pj.Title}");
        }

        // 工单描述/备注：可能内嵌交付截图或需求附件链接
        foreach (var tk in await db.Tickets.Select(t => new { t.Id, t.Description, t.AdminNote }).ToListAsync()) {
            Scan(tk.Description, $"工单#{tk.Id}");
            Scan(tk.AdminNote, $"工单备注#{tk.Id}");
        }

        // 财务付款凭证：EvidenceUrl 归档路径（如意经手），可能指向 /uploads
        foreach (var fr in await db.FinanceRecords.Select(f => new { f.Id, f.EvidenceUrl }).ToListAsync())
            Scan(fr.EvidenceUrl, $"付款凭证#{fr.Id}");

        // 固定引用：收款二维码、qianky 食品安全检查页
        Add(byName, "wechat-pay-qr.png", "收款二维码");
        Add(byName, "food-safety-check.html", "食品安全检查 (qianky)");

        // 扫描 uploads 内静态文本文件（HTML/CSS/JS 等）对其它 uploads 文件的内部引用
        // （如工具页面通过 /uploads/lib/xxx.js 引入的共享库），避免误判为空闲
        if (Directory.Exists(root)) {
            var textExt = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                { ".html", ".htm", ".css", ".js", ".json", ".md", ".svg" };
            foreach (var f in Directory.GetFiles(root, "*", SearchOption.AllDirectories)) {
                if (!textExt.Contains(Path.GetExtension(f))) continue;
                if (new FileInfo(f).Length > 2 * 1024 * 1024) continue;  // 跳过过大文件
                string content;
                try { content = await System.IO.File.ReadAllTextAsync(f); } catch { continue; }
                Scan(content, $"被页面引用：{Path.GetFileName(f)}");
            }
        }

        return (byRel, byName);
    }

    private static string? UsageOf(string rel, string name,
        Dictionary<string,string> byRel, Dictionary<string,string> byName)
        => byRel.TryGetValue(rel, out var r) ? r
         : byName.TryGetValue(name, out var n) ? n
         : null;

    // GET /api/admin/files —— 列出 uploads/ 下所有文件（含使用状态）和所有子目录
    [HttpGet("files")]
    public async Task<IActionResult> ListFiles() {
        var root = Path.Combine(env.WebRootPath, "uploads");
        if (!Directory.Exists(root)) return Ok(new { files = Array.Empty<object>(), dirs = Array.Empty<string>() });

        var (byRel, byName) = await BuildFileUsageAsync(root);

        var files = Directory.GetFiles(root, "*", SearchOption.AllDirectories)
            .Select(f => {
                var info   = new FileInfo(f);
                var rel    = Path.GetRelativePath(root, f).Replace('\\', '/');
                var usedBy = UsageOf(rel, info.Name, byRel, byName);
                return new {
                    name       = info.Name,
                    path       = rel,
                    size       = info.Length,
                    modifiedAt = info.LastWriteTimeUtc,
                    isInUse    = usedBy != null,
                    usedBy
                };
            })
            .OrderByDescending(f => f.modifiedAt)
            .ToArray();

        // 所有子目录（含空目录），供前端做文件夹导航
        var dirs = Directory.GetDirectories(root, "*", SearchOption.AllDirectories)
            .Select(d => Path.GetRelativePath(root, d).Replace('\\', '/'))
            .OrderBy(d => d, StringComparer.Ordinal)
            .ToArray();

        return Ok(new { files, dirs });
    }

    // 把 rel 安全解析为 uploads 下的绝对路径，防止路径穿越。越界返回 false。
    private static bool TryResolveUnder(string root, string? rel, out string full) {
        var r = Path.GetFullPath(root);
        full = Path.GetFullPath(Path.Combine(r, (rel ?? "").Replace('/', Path.DirectorySeparatorChar)));
        return full == r || full.StartsWith(r + Path.DirectorySeparatorChar);
    }

    // 把文本里 /uploads/oldRel 形式的引用替换为 /uploads/newRel（带分隔符边界，避免误伤前缀相同的其它文件）
    private static string ReplaceUploadUrl(string text, string oldUrl, string newUrl) =>
        Regex.Replace(text, Regex.Escape(oldUrl) + @"(?=[\s""'>)\]\\,;?#]|$)", newUrl.Replace("$", "$$"));

    // 文件改名/移动后，把数据库里（工具/二手/论坛）和 uploads 内静态文本文件里对该文件的引用全部更新，引用不断链。
    private async Task RewriteReferencesAsync(string oldRel, string newRel) {
        var oldUrl  = "/uploads/" + oldRel;
        var newUrl  = "/uploads/" + newRel;
        var oldName = Path.GetFileName(oldRel);
        var newName = Path.GetFileName(newRel);

        var tools = await db.Tools.ToListAsync();
        foreach (var t in tools) {
            if (!string.IsNullOrEmpty(t.OnlineUrl))       t.OnlineUrl       = ReplaceUploadUrl(t.OnlineUrl!, oldUrl, newUrl);
            if (!string.IsNullOrEmpty(t.ReadmeMarkdown))  t.ReadmeMarkdown  = ReplaceUploadUrl(t.ReadmeMarkdown!, oldUrl, newUrl);
            if (!string.IsNullOrEmpty(t.Description))      t.Description      = ReplaceUploadUrl(t.Description!, oldUrl, newUrl);
            if (!string.IsNullOrEmpty(t.DownloadFileName)) {
                var dl = t.DownloadFileName!.Replace('\\', '/').TrimStart('/');
                if (dl == oldRel) t.DownloadFileName = newRel;          // 带子目录形式
                else if (dl == oldName) t.DownloadFileName = newName;   // 纯文件名形式
            }
        }
        foreach (var i in await db.SecondhandItems.ToListAsync())
            if (!string.IsNullOrEmpty(i.Images)) i.Images = ReplaceUploadUrl(i.Images!, oldUrl, newUrl);
        foreach (var p in await db.ForumPosts.ToListAsync())
            if (!string.IsNullOrEmpty(p.Content)) p.Content = ReplaceUploadUrl(p.Content!, oldUrl, newUrl);
        // 听书：封面图、EPUB 文字版、各章节音频
        foreach (var b in await db.Audiobooks.ToListAsync()) {
            if (!string.IsNullOrEmpty(b.CoverUrl)) b.CoverUrl = ReplaceUploadUrl(b.CoverUrl!, oldUrl, newUrl);
            if (!string.IsNullOrEmpty(b.EpubUrl))  b.EpubUrl  = ReplaceUploadUrl(b.EpubUrl!, oldUrl, newUrl);
        }
        foreach (var c in await db.AudiobookChapters.ToListAsync())
            if (!string.IsNullOrEmpty(c.MediaUrl)) c.MediaUrl = ReplaceUploadUrl(c.MediaUrl!, oldUrl, newUrl);
        // 私信(交付物链接)、需求单附件、项目交付、工单、财务凭证——与 BuildFileUsageAsync 扫描面对齐，
        // 否则改名/移动这些文件会把客户下载链接改断
        foreach (var pm in await db.PrivateMessages.ToListAsync())
            if (!string.IsNullOrEmpty(pm.Content)) pm.Content = ReplaceUploadUrl(pm.Content!, oldUrl, newUrl);
        foreach (var r in await db.DevRequests.ToListAsync()) {
            if (!string.IsNullOrEmpty(r.Description)) r.Description = ReplaceUploadUrl(r.Description!, oldUrl, newUrl);
            if (!string.IsNullOrEmpty(r.AdminNote))   r.AdminNote   = ReplaceUploadUrl(r.AdminNote!, oldUrl, newUrl);
        }
        foreach (var pj in await db.Projects.ToListAsync()) {
            if (!string.IsNullOrEmpty(pj.Description))   pj.Description   = ReplaceUploadUrl(pj.Description!, oldUrl, newUrl);
            if (!string.IsNullOrEmpty(pj.PlanMarkdown))  pj.PlanMarkdown  = ReplaceUploadUrl(pj.PlanMarkdown!, oldUrl, newUrl);
            if (!string.IsNullOrEmpty(pj.DeliveryNotes)) pj.DeliveryNotes = ReplaceUploadUrl(pj.DeliveryNotes!, oldUrl, newUrl);
            if (!string.IsNullOrEmpty(pj.AdminNote))     pj.AdminNote     = ReplaceUploadUrl(pj.AdminNote!, oldUrl, newUrl);
        }
        foreach (var tk in await db.Tickets.ToListAsync()) {
            if (!string.IsNullOrEmpty(tk.Description)) tk.Description = ReplaceUploadUrl(tk.Description!, oldUrl, newUrl);
            if (!string.IsNullOrEmpty(tk.AdminNote))   tk.AdminNote   = ReplaceUploadUrl(tk.AdminNote!, oldUrl, newUrl);
        }
        foreach (var fr in await db.FinanceRecords.ToListAsync())
            if (!string.IsNullOrEmpty(fr.EvidenceUrl)) fr.EvidenceUrl = ReplaceUploadUrl(fr.EvidenceUrl!, oldUrl, newUrl);
        await db.SaveChangesAsync();

        // uploads 内静态文本文件之间的内部引用（如页面引入共享库）
        var root = Path.Combine(env.WebRootPath, "uploads");
        if (Directory.Exists(root)) {
            var textExt = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                { ".html", ".htm", ".css", ".js", ".json", ".md", ".svg" };
            foreach (var f in Directory.GetFiles(root, "*", SearchOption.AllDirectories)) {
                if (!textExt.Contains(Path.GetExtension(f))) continue;
                if (new FileInfo(f).Length > 2 * 1024 * 1024) continue;
                string content;
                try { content = await System.IO.File.ReadAllTextAsync(f); } catch { continue; }
                if (!content.Contains(oldUrl)) continue;
                try { await System.IO.File.WriteAllTextAsync(f, ReplaceUploadUrl(content, oldUrl, newUrl)); } catch { }
            }
        }
    }

    public record RenameFileDto(string path, string newName);
    public record MoveFileDto(string path, string targetDir);
    public record CreateFolderDto(string path);

    // POST /api/admin/files/rename —— 重命名文件（保持所在目录不变，自动同步所有引用）
    [HttpPost("files/rename")]
    public async Task<IActionResult> RenameFile([FromBody] RenameFileDto dto) {
        var root = Path.Combine(env.WebRootPath, "uploads");
        if (string.IsNullOrWhiteSpace(dto.path) || string.IsNullOrWhiteSpace(dto.newName))
            return BadRequest(new { message = "参数缺失" });
        var newName = dto.newName.Trim();
        if (newName.Contains('/') || newName.Contains('\\') || newName is "." or "..")
            return BadRequest(new { message = "文件名不能包含路径分隔符" });
        if (!TryResolveUnder(root, dto.path, out var oldFull) || !System.IO.File.Exists(oldFull))
            return NotFound(new { message = "文件不存在" });

        var newFull = Path.Combine(Path.GetDirectoryName(oldFull)!, newName);
        if (!TryResolveUnder(root, Path.GetRelativePath(root, newFull), out _))
            return BadRequest(new { message = "无效路径" });
        if (System.IO.File.Exists(newFull) || Directory.Exists(newFull))
            return BadRequest(new { message = "已存在同名文件或文件夹" });

        var oldRel = Path.GetRelativePath(root, oldFull).Replace('\\', '/');
        var newRel = Path.GetRelativePath(root, newFull).Replace('\\', '/');
        System.IO.File.Move(oldFull, newFull);
        await RewriteReferencesAsync(oldRel, newRel);
        return Ok(new { path = newRel });
    }

    // POST /api/admin/files/move —— 移动文件到指定目录（自动同步所有引用）
    [HttpPost("files/move")]
    public async Task<IActionResult> MoveFile([FromBody] MoveFileDto dto) {
        var root = Path.Combine(env.WebRootPath, "uploads");
        if (string.IsNullOrWhiteSpace(dto.path)) return BadRequest(new { message = "参数缺失" });
        if (!TryResolveUnder(root, dto.path, out var oldFull) || !System.IO.File.Exists(oldFull))
            return NotFound(new { message = "文件不存在" });

        var targetDir = (dto.targetDir ?? "").Replace('\\', '/').Trim().Trim('/');
        if (!TryResolveUnder(root, targetDir, out var targetFull))
            return BadRequest(new { message = "无效目标目录" });
        if (!Directory.Exists(targetFull)) return BadRequest(new { message = "目标目录不存在" });

        var newFull = Path.Combine(targetFull, Path.GetFileName(oldFull));
        if (string.Equals(Path.GetFullPath(newFull), Path.GetFullPath(oldFull), StringComparison.Ordinal))
            return BadRequest(new { message = "文件已在该目录" });
        if (System.IO.File.Exists(newFull) || Directory.Exists(newFull))
            return BadRequest(new { message = "目标目录已存在同名文件" });

        var oldRel = Path.GetRelativePath(root, oldFull).Replace('\\', '/');
        var newRel = Path.GetRelativePath(root, newFull).Replace('\\', '/');
        System.IO.File.Move(oldFull, newFull);
        await RewriteReferencesAsync(oldRel, newRel);
        return Ok(new { path = newRel });
    }

    // POST /api/admin/files/folder —— 新建文件夹
    [HttpPost("files/folder")]
    public IActionResult CreateFolder([FromBody] CreateFolderDto dto) {
        var root = Path.Combine(env.WebRootPath, "uploads");
        var rel = (dto.path ?? "").Replace('\\', '/').Trim().Trim('/');
        if (string.IsNullOrEmpty(rel)) return BadRequest(new { message = "文件夹名不能为空" });
        foreach (var seg in rel.Split('/'))
            if (seg is "" or "." or "..") return BadRequest(new { message = "非法文件夹名" });
        if (!TryResolveUnder(root, rel, out var full)) return BadRequest(new { message = "无效路径" });
        if (Directory.Exists(full) || System.IO.File.Exists(full))
            return BadRequest(new { message = "已存在同名文件夹或文件" });
        Directory.CreateDirectory(full);
        return Ok(new { path = rel });
    }

    // DELETE /api/admin/files/{*path} —— 删除指定文件（使用中的文件不能删除）
    [HttpDelete("files/{*path}")]
    public async Task<IActionResult> DeleteFile(string path) {
        var root     = Path.Combine(env.WebRootPath, "uploads");
        var fullPath = Path.GetFullPath(Path.Combine(root, path));
        // 防路径穿越攻击
        if (!fullPath.StartsWith(root + Path.DirectorySeparatorChar) && fullPath != root)
            return BadRequest(new { message = "无效路径" });
        if (!System.IO.File.Exists(fullPath)) return NotFound(new { message = "文件不存在" });

        var fileName = Path.GetFileName(fullPath);
        var rel      = Path.GetRelativePath(root, fullPath).Replace('\\', '/');

        // 用与列表一致的逻辑判断是否被引用
        var (byRel, byName) = await BuildFileUsageAsync(root);
        var usage = UsageOf(rel, fileName, byRel, byName);
        if (usage != null)
            return BadRequest(new { message = $"该文件正在被使用（{usage}），无法删除。" });

        System.IO.File.Delete(fullPath);
        return Ok();
    }

    public record BatchDeleteDto(string[] paths);

    // POST /api/admin/files/batch-delete —— 批量删除文件（逐个校验使用状态，跳过在用的并回报）
    [HttpPost("files/batch-delete")]
    public async Task<IActionResult> BatchDelete([FromBody] BatchDeleteDto dto) {
        var root = Path.Combine(env.WebRootPath, "uploads");
        if (dto?.paths == null || dto.paths.Length == 0) return BadRequest(new { message = "未选择文件" });
        var (byRel, byName) = await BuildFileUsageAsync(root);   // 只算一次,避免每个文件重扫全库
        int deleted = 0; var skipped = new List<object>();
        foreach (var p in dto.paths.Distinct()) {
            if (!TryResolveUnder(root, p, out var full) || !System.IO.File.Exists(full)) {
                skipped.Add(new { path = p, reason = "文件不存在" }); continue;
            }
            var rel  = Path.GetRelativePath(root, full).Replace('\\', '/');
            var usage = UsageOf(rel, Path.GetFileName(full), byRel, byName);
            if (usage != null) { skipped.Add(new { path = p, reason = $"使用中（{usage}）" }); continue; }
            try { System.IO.File.Delete(full); deleted++; }
            catch (Exception e) { skipped.Add(new { path = p, reason = e.Message }); }
        }
        return Ok(new { deleted, skipped });
    }

    // DELETE /api/admin/files/folder/{*path} —— 删除文件夹
    // 安全闸：文件夹内若有任何“使用中”文件则整体拒删并列出，避免连带删掉在用文件；
    // 全空闲(或空文件夹)才允许递归删除。
    [HttpDelete("files/folder/{*path}")]
    public async Task<IActionResult> DeleteFolder(string path) {
        var root = Path.Combine(env.WebRootPath, "uploads");
        if (string.IsNullOrWhiteSpace(path)) return BadRequest(new { message = "未指定文件夹" });
        if (!TryResolveUnder(root, path, out var full)) return BadRequest(new { message = "无效路径" });
        if (Path.GetFullPath(full) == Path.GetFullPath(root))
            return BadRequest(new { message = "不能删除 uploads 根目录" });
        if (!Directory.Exists(full)) return NotFound(new { message = "文件夹不存在" });

        var (byRel, byName) = await BuildFileUsageAsync(root);
        var inUse = new List<string>();
        foreach (var f in Directory.GetFiles(full, "*", SearchOption.AllDirectories)) {
            var rel = Path.GetRelativePath(root, f).Replace('\\', '/');
            if (UsageOf(rel, Path.GetFileName(f), byRel, byName) != null) inUse.Add(rel);
        }
        if (inUse.Count > 0)
            return BadRequest(new { message = $"文件夹含 {inUse.Count} 个使用中的文件，已阻止删除", inUse = inUse.Take(20) });

        var fileCount = Directory.GetFiles(full, "*", SearchOption.AllDirectories).Length;
        Directory.Delete(full, recursive: true);
        return Ok(new { deletedFiles = fileCount });
    }

    // POST /api/admin/files/clean-orphans —— 一键清理所有空闲文件（可选 dryRun 只预览不删）
    // dryRun=true：返回将删除的清单与总大小，不实际删除；false：执行删除。
    [HttpPost("files/clean-orphans")]
    public async Task<IActionResult> CleanOrphans([FromQuery] bool dryRun = true) {
        var root = Path.Combine(env.WebRootPath, "uploads");
        if (!Directory.Exists(root)) return Ok(new { count = 0, totalSize = 0L, items = Array.Empty<object>() });
        var (byRel, byName) = await BuildFileUsageAsync(root);
        var orphans = new List<(string rel, long size)>();
        foreach (var f in Directory.GetFiles(root, "*", SearchOption.AllDirectories)) {
            var info = new FileInfo(f);
            var rel  = Path.GetRelativePath(root, f).Replace('\\', '/');
            if (UsageOf(rel, info.Name, byRel, byName) == null) orphans.Add((rel, info.Length));
        }
        long totalSize = orphans.Sum(o => o.size);
        if (dryRun)
            return Ok(new { dryRun = true, count = orphans.Count, totalSize,
                items = orphans.OrderByDescending(o => o.size).Take(500).Select(o => new { path = o.rel, size = o.size }) });

        int deleted = 0;
        foreach (var (rel, _) in orphans)
            if (TryResolveUnder(root, rel, out var full) && System.IO.File.Exists(full)) {
                try { System.IO.File.Delete(full); deleted++; } catch { }
            }
        // 清理删空后残留的空目录（自底向上）
        foreach (var d in Directory.GetDirectories(root, "*", SearchOption.AllDirectories)
                     .OrderByDescending(x => x.Length))
            try { if (!Directory.EnumerateFileSystemEntries(d).Any()) Directory.Delete(d); } catch { }
        return Ok(new { dryRun = false, deleted, totalSize });
    }

    // GET /api/admin/stats —— 后台概览统计数据
    [HttpGet("stats")]
    public async Task<IActionResult> Stats() {
        var now = DateTime.UtcNow;
        var weekAgo = now.Date.AddDays(-6);   // 含今天共 7 天

        // 最近 7 天的下载明细（按天聚合）
        var rawDownloads = await db.ToolDownloads
            .Where(d => d.DownloadedAt >= weekAgo)
            .Select(d => d.DownloadedAt)
            .ToListAsync();
        var downloads7d = Enumerable.Range(0, 7).Select(i => {
            var day = weekAgo.AddDays(i);
            return new {
                date = day.ToString("MM-dd"),
                count = rawDownloads.Count(t => t.Date == day)
            };
        }).ToList();

        // 工具分类占比（仅统计已发布工具）
        var categoryBreakdown = await db.Tools
            .Where(t => t.IsPublished)
            .GroupBy(t => t.Category)
            .Select(g => new { category = g.Key, count = g.Count() })
            .OrderByDescending(g => g.count)
            .ToListAsync();

        // 各卡片的近7天趋势序列（供卡片右侧迷你折线图）
        var days = Enumerable.Range(0, 7).Select(i => weekAgo.AddDays(i)).ToList();
        // 累计型指标用「每日累计总数」，队列/活动型用「每日新增」
        List<int> Cumulative(List<DateTime> dates, int baseCount) {
            var s = new List<int>(); var run = baseCount;
            foreach (var day in days) { run += dates.Count(d => d.Date == day); s.Add(run); }
            return s;
        }
        var toolDates = await db.Tools.Where(t => t.CreatedAt >= weekAgo).Select(t => t.CreatedAt).ToListAsync();
        var userDates = await db.Users.Where(u => u.CreatedAt >= weekAgo).Select(u => u.CreatedAt).ToListAsync();
        var reqDates = await db.DevRequests.Where(r => r.CreatedAt >= weekAgo).Select(r => r.CreatedAt).ToListAsync();
        var purDates = await db.ToolPurchases.Where(p => p.CreatedAt >= weekAgo).Select(p => p.CreatedAt).ToListAsync();
        var revRows = await db.ToolPurchases.Where(p => p.Status == "activated" && p.CreatedAt >= weekAgo)
            .Select(p => new { p.CreatedAt, p.Amount }).ToListAsync();
        var baseRev = await db.ToolPurchases.Where(p => p.Status == "activated" && p.CreatedAt < weekAgo)
            .SumAsync(p => (double?)p.Amount) ?? 0;
        var revenueSeries = new List<double>(); { var run = baseRev; foreach (var day in days) { run += revRows.Where(r => r.CreatedAt.Date == day).Sum(r => (double)r.Amount); revenueSeries.Add(Math.Round(run, 1)); } }

        var series = new {
            tools = Cumulative(toolDates, await db.Tools.CountAsync(t => t.CreatedAt < weekAgo)),
            users = Cumulative(userDates, await db.Users.CountAsync(u => u.CreatedAt < weekAgo)),
            downloads = downloads7d.Select(d => d.count).ToList(),
            requests = days.Select(day => reqDates.Count(d => d.Date == day)).ToList(),
            purchases = days.Select(day => purDates.Count(d => d.Date == day)).ToList(),
            revenue = revenueSeries,
        };

        // 周环比趋势：本周（近7天）vs 上周（前7天）的真实计数，供卡片趋势徽章
        var thisWeekStart = now.Date.AddDays(-6);
        var prevWeekStart = now.Date.AddDays(-13);
        var trends = new {
            toolsThis = await db.Tools.CountAsync(t => t.CreatedAt >= thisWeekStart),
            toolsPrev = await db.Tools.CountAsync(t => t.CreatedAt >= prevWeekStart && t.CreatedAt < thisWeekStart),
            usersThis = await db.Users.CountAsync(u => u.CreatedAt >= thisWeekStart),
            usersPrev = await db.Users.CountAsync(u => u.CreatedAt >= prevWeekStart && u.CreatedAt < thisWeekStart),
            downloadsThis = await db.ToolDownloads.CountAsync(d => d.DownloadedAt >= thisWeekStart),
            downloadsPrev = await db.ToolDownloads.CountAsync(d => d.DownloadedAt >= prevWeekStart && d.DownloadedAt < thisWeekStart),
        };

        return Ok(new {
            totalUsers = await db.Users.CountAsync(),
            totalTools = await db.Tools.CountAsync(t => t.IsPublished),
            totalDownloads = await db.ToolDownloads.CountAsync(),
            // 最近 7 天新增的工具数（概览卡片趋势用）
            recentAddedTools = await db.Tools.CountAsync(t => t.CreatedAt >= weekAgo),
            downloads7d,
            categoryBreakdown,
            series,
            trends,
            // 最近5个注册用户，显示在概览页底部
            recentUsers = await db.Users.OrderByDescending(u => u.CreatedAt).Take(5)
                .Select(u => new { u.Username, u.Email, u.CreatedAt }).ToListAsync()
        });
    }

    // GET /api/admin/system —— 实时系统状态（顶部状态栏用）
    // 返回真实指标：进程 CPU%、系统内存负载%、近30分钟活跃用户数
    [HttpGet("system")]
    public async Task<IActionResult> SystemStatus() {
        var proc = System.Diagnostics.Process.GetCurrentProcess();
        var startCpu = proc.TotalProcessorTime;
        var sw = System.Diagnostics.Stopwatch.StartNew();
        await Task.Delay(200);
        proc.Refresh();
        sw.Stop();
        var cpuMs = (proc.TotalProcessorTime - startCpu).TotalMilliseconds;
        var cpuPct = sw.Elapsed.TotalMilliseconds > 0
            ? cpuMs / (sw.Elapsed.TotalMilliseconds * Math.Max(1, Environment.ProcessorCount)) * 100.0
            : 0;

        var gc = GC.GetGCMemoryInfo();
        var memPct = gc.TotalAvailableMemoryBytes > 0
            ? (double)gc.MemoryLoadBytes / gc.TotalAvailableMemoryBytes * 100.0
            : 0;

        // 硬盘使用率（根分区真实占用）
        double diskPct = 0;
        try {
            var drive = new System.IO.DriveInfo("/");
            if (drive.TotalSize > 0)
                diskPct = (double)(drive.TotalSize - drive.AvailableFreeSpace) / drive.TotalSize * 100.0;
        } catch { }

        var since = DateTime.UtcNow.AddMinutes(-30);
        var online = await db.Users.CountAsync(u => u.LastLoginAt != null && u.LastLoginAt >= since);

        return Ok(new {
            cpu = (int)Math.Round(Math.Clamp(cpuPct, 0, 100)),
            memory = (int)Math.Round(Math.Clamp(memPct, 0, 100)),
            disk = (int)Math.Round(Math.Clamp(diskPct, 0, 100)),
            online,
            ok = true
        });
    }

    // ─────────────────────── 学科管理 ───────────────────────

    [HttpGet("subjects")]
    public async Task<IActionResult> ListSubjects() {
        var list = await db.Subjects.OrderBy(s => s.SortOrder).ThenBy(s => s.Id)
            .Select(s => new { s.Id, s.Name, s.IconEmoji, s.IsActive, s.SortOrder })
            .ToListAsync();
        return Ok(list);
    }

    [HttpPost("subjects")]
    public async Task<IActionResult> CreateSubject([FromBody] SubjectDto dto) {
        var s = new Models.Subject { Name = dto.Name, IconEmoji = dto.IconEmoji ?? "📚", SortOrder = dto.SortOrder, IsActive = true, CreatedAt = DateTime.UtcNow };
        db.Subjects.Add(s);
        await db.SaveChangesAsync();
        return Ok(new { s.Id, s.Name, s.IconEmoji, s.IsActive, s.SortOrder });
    }

    [HttpPut("subjects/{id}")]
    public async Task<IActionResult> UpdateSubject(int id, [FromBody] SubjectDto dto) {
        var s = await db.Subjects.FindAsync(id);
        if (s == null) return NotFound();
        s.Name = dto.Name; s.IconEmoji = dto.IconEmoji ?? s.IconEmoji;
        s.SortOrder = dto.SortOrder; s.IsActive = dto.IsActive;
        await db.SaveChangesAsync();
        return Ok(new { s.Id, s.Name, s.IconEmoji, s.IsActive, s.SortOrder });
    }

    [HttpDelete("subjects/{id}")]
    public async Task<IActionResult> DeleteSubject(int id) {
        var s = await db.Subjects.FindAsync(id);
        if (s == null) return NotFound();
        db.Subjects.Remove(s);
        await db.SaveChangesAsync();
        return Ok();
    }

    // ─────────────────────── 教师申请审核 ───────────────────────

    [HttpGet("teacher-applications")]
    public async Task<IActionResult> ListTeacherApplications([FromQuery] string status = "pending") {
        var list = await db.TeacherProfiles
            .Where(t => t.Status == status)
            .Include(t => t.User)
            .Include(t => t.TeacherSubjects).ThenInclude(ts => ts.Subject)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new {
                t.Id, t.Status, t.Bio, t.RejectReason, t.CreatedAt, t.ApprovedAt,
                user = new { t.User.Id, t.User.Username, t.User.AvatarUrl },
                subjects = t.TeacherSubjects.Select(ts => new { ts.Subject.Id, ts.Subject.Name })
            })
            .ToListAsync();
        return Ok(list);
    }

    [HttpPost("teacher-applications/{id}/approve")]
    public async Task<IActionResult> ApproveTeacher(int id) {
        var t = await db.TeacherProfiles.FindAsync(id);
        if (t == null) return NotFound();
        t.Status = "approved"; t.ApprovedAt = DateTime.UtcNow; t.ApprovedByUserId = CurrentUserId; t.RejectReason = null;
        await db.SaveChangesAsync();
        await notif.Notify(t.UserId, "teacher_audit", "教师申请已通过",
            "恭喜！你的教师资格已通过审核，现在可以排班并接受预约了。", "/teacher/dashboard");
        return Ok();
    }

    [HttpPost("teacher-applications/{id}/reject")]
    public async Task<IActionResult> RejectTeacher(int id, [FromBody] RejectDto dto) {
        var t = await db.TeacherProfiles.FindAsync(id);
        if (t == null) return NotFound();
        t.Status = "rejected"; t.RejectReason = dto.Reason;
        await db.SaveChangesAsync();
        await notif.Notify(t.UserId, "teacher_audit", "教师申请未通过",
            string.IsNullOrWhiteSpace(dto.Reason) ? "很遗憾，你的教师申请未通过审核。" : $"很遗憾，你的教师申请未通过。原因：{dto.Reason}", "/teacher/dashboard");
        return Ok();
    }

    [HttpPost("teacher-applications/{id}/revoke")]
    public async Task<IActionResult> RevokeTeacher(int id, [FromBody] RevokeDto dto) {
        var t = await db.TeacherProfiles.FindAsync(id);
        if (t == null) return NotFound();
        if (t.Status != "approved") return BadRequest("只能撤销已通过的教师资格");

        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");

        // 取消未来所有空闲时间段（先按 TeacherId 过滤，再在内存中比较日期字符串）
        var allAvailableSlots = await db.TimeSlots
            .Where(s => s.TeacherId == t.Id && s.Status == "available")
            .ToListAsync();
        var futureSlots = allAvailableSlots.Where(s => string.Compare(s.Date, today) >= 0).ToList();
        foreach (var s in futureSlots) s.Status = "cancelled";

        // 取消所有待确认/已确认的预约
        var activeBookings = await db.Bookings
            .Where(b => b.TeacherId == t.Id && (b.Status == "pending" || b.Status == "confirmed"))
            .ToListAsync();
        foreach (var b in activeBookings) {
            b.Status = "cancelled";
            b.TeacherNote = dto.Reason ?? "教师资格已被撤销";
            b.UpdatedAt = DateTime.UtcNow;
        }

        t.Status = "revoked";
        t.RejectReason = dto.Reason;
        await db.SaveChangesAsync();
        return Ok(new { cancelledSlots = futureSlots.Count, cancelledBookings = activeBookings.Count });
    }

    // ── 发系统公告（广播给所有启用用户）──
    [HttpPost("notifications/broadcast")]
    public async Task<IActionResult> Broadcast([FromBody] BroadcastDto dto) {
        if (string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("标题不能为空");
        var count = await notif.Broadcast("announcement", dto.Title.Trim(), dto.Body ?? "",
            string.IsNullOrWhiteSpace(dto.LinkUrl) ? null : dto.LinkUrl.Trim());
        return Ok(new { sent = count });
    }

    // ─────────────────────── 教师管理（行情分析 / 月报数据）───────────────────────

    // GET /api/admin/teachers — 所有 approved 教师 + 本月简要统计
    [HttpGet("teachers")]
    public async Task<IActionResult> ListTeachers() {
        var local = DateTime.UtcNow.AddHours(8);
        var prefix = $"{local.Year:D4}-{local.Month:D2}";

        var teachers = await db.TeacherProfiles
            .Where(t => t.Status == "approved")
            .Include(t => t.User)
            .Include(t => t.TeacherSubjects).ThenInclude(ts => ts.Subject)
            .OrderBy(t => t.User.Username)
            .ToListAsync();

        var teacherIds = teachers.Select(t => t.Id).ToList();

        // 每位教师的学生 ID 集合
        var allStudents = await db.TeacherStudents
            .Where(ts => teacherIds.Contains(ts.TeacherId) && !ts.IsArchived)
            .Select(ts => new { ts.Id, ts.TeacherId })
            .ToListAsync();
        var studentsByTeacher = allStudents.GroupBy(s => s.TeacherId)
            .ToDictionary(g => g.Key, g => g.Select(s => s.Id).ToList());

        // 本月课节（金额拉到内存聚合）
        var allStudentIds = allStudents.Select(s => s.Id).ToList();
        var monthLessons = await db.Lessons
            .Where(l => allStudentIds.Contains(l.TeacherStudentId) && l.LessonDate.StartsWith(prefix))
            .Select(l => new { l.TeacherStudentId, l.Fee })
            .ToListAsync();
        var allLessons = await db.Lessons
            .Where(l => allStudentIds.Contains(l.TeacherStudentId))
            .Select(l => new { l.TeacherStudentId, l.Fee }).ToListAsync();
        var allPayments = await db.Payments
            .Where(p => allStudentIds.Contains(p.TeacherStudentId))
            .Select(p => new { p.TeacherStudentId, p.Amount }).ToListAsync();

        var result = teachers.Select(t => {
            var studentIds = studentsByTeacher.GetValueOrDefault(t.Id) ?? new();
            var ml = monthLessons.Where(l => studentIds.Contains(l.TeacherStudentId)).ToList();
            var al = allLessons.Where(l => studentIds.Contains(l.TeacherStudentId)).ToList();
            var ap = allPayments.Where(p => studentIds.Contains(p.TeacherStudentId)).ToList();
            var dueByS = al.GroupBy(l => l.TeacherStudentId).ToDictionary(g => g.Key, g => g.Sum(x => x.Fee));
            var paidByS = ap.GroupBy(p => p.TeacherStudentId).ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));
            decimal outstanding = 0m;
            foreach (var sid in studentIds) {
                var bal = paidByS.GetValueOrDefault(sid, 0m) - dueByS.GetValueOrDefault(sid, 0m);
                if (bal < 0) outstanding += -bal;
            }
            return new {
                t.Id, t.Bio, t.AvatarUrl, t.ApprovedAt,
                user = new { t.User.Id, t.User.Username, t.User.AvatarUrl },
                subjects = t.TeacherSubjects.Select(ts => new { ts.Subject.Id, ts.Subject.Name }),
                monthLessonCount = ml.Count,
                monthDue = ml.Sum(l => l.Fee),
                studentCount = studentIds.Count,
                totalOutstanding = outstanding,
            };
        }).ToList();

        return Ok(result);
    }

    // GET /api/admin/teachers/:id?year=&month= — 教师详情 + 月统计
    [HttpGet("teachers/{id}")]
    public async Task<IActionResult> GetTeacherDetail(int id, [FromQuery] int? year, [FromQuery] int? month) {
        var t = await db.TeacherProfiles
            .Where(t => t.Id == id)
            .Include(t => t.User)
            .Include(t => t.TeacherSubjects).ThenInclude(ts => ts.Subject)
            .FirstOrDefaultAsync();
        if (t == null) return NotFound();

        var local = DateTime.UtcNow.AddHours(8);
        int y = year ?? local.Year, mo = month ?? local.Month;
        var prefix = $"{y:D4}-{mo:D2}";

        var roster = await db.TeacherStudents.Where(x => x.TeacherId == t.Id)
            .Select(x => new { x.Id, x.IsArchived }).ToListAsync();
        var studentIds = roster.Select(x => x.Id).ToList();
        var activeIds = roster.Where(x => !x.IsArchived).Select(x => x.Id).ToHashSet();

        var monthLessons = await db.Lessons
            .Where(l => studentIds.Contains(l.TeacherStudentId) && l.LessonDate.StartsWith(prefix))
            .Select(l => new { l.Fee, l.DurationMinutes, l.TeacherStudentId }).ToListAsync();
        var monthPaid = (await db.Payments
            .Where(p => studentIds.Contains(p.TeacherStudentId) && p.PaidDate.StartsWith(prefix))
            .Select(p => p.Amount).ToListAsync()).Sum();

        var allLessons = await db.Lessons.Where(l => activeIds.Contains(l.TeacherStudentId))
            .Select(l => new { l.TeacherStudentId, l.Fee }).ToListAsync();
        var allPayments = await db.Payments.Where(p => activeIds.Contains(p.TeacherStudentId))
            .Select(p => new { p.TeacherStudentId, p.Amount }).ToListAsync();
        var dueByS = allLessons.GroupBy(l => l.TeacherStudentId).ToDictionary(g => g.Key, g => g.Sum(x => x.Fee));
        var paidByS = allPayments.GroupBy(p => p.TeacherStudentId).ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));
        decimal totalOutstanding = 0m, totalPrepaid = 0m;
        foreach (var sid in activeIds) {
            var bal = paidByS.GetValueOrDefault(sid, 0m) - dueByS.GetValueOrDefault(sid, 0m);
            if (bal < 0) totalOutstanding += -bal; else totalPrepaid += bal;
        }

        return Ok(new {
            t.Id, t.Bio, t.AvatarUrl, t.Status, t.ApprovedAt, t.CreatedAt,
            user = new { t.User.Id, t.User.Username, t.User.AvatarUrl },
            subjects = t.TeacherSubjects.Select(ts => new { ts.Subject.Id, ts.Subject.Name }),
            stats = new {
                month = prefix,
                lessonCount = monthLessons.Count,
                lessonMinutes = monthLessons.Sum(l => l.DurationMinutes ?? 0),
                monthDue = monthLessons.Sum(l => l.Fee),
                monthPaid,
                activeStudents = monthLessons.Select(l => l.TeacherStudentId).Distinct().Count(),
                totalStudents = activeIds.Count,
                totalOutstanding,
                totalPrepaid,
            }
        });
    }

    // GET /api/admin/teachers/:id/students — 该教师学生列表（含余额汇总）
    [HttpGet("teachers/{id}/students")]
    public async Task<IActionResult> GetTeacherStudents(int id, [FromQuery] bool includeArchived = false) {
        var t = await db.TeacherProfiles.FindAsync(id);
        if (t == null) return NotFound();

        var students = await db.TeacherStudents
            .Where(ts => ts.TeacherId == id && (includeArchived || !ts.IsArchived))
            .Select(ts => new {
                ts.Id, ts.DisplayName, ts.Phone, ts.Note, ts.IsArchived, ts.StudentUserId, ts.DefaultFee,
                avatarUrl = ts.StudentUser != null ? ts.StudentUser.AvatarUrl : null
            }).ToListAsync();

        var sids = students.Select(s => s.Id).ToList();
        var lessons = await db.Lessons.Where(l => sids.Contains(l.TeacherStudentId))
            .Select(l => new { l.TeacherStudentId, l.Fee, l.LessonDate, l.Id }).ToListAsync();
        var payments = await db.Payments.Where(p => sids.Contains(p.TeacherStudentId))
            .Select(p => new { p.TeacherStudentId, p.Amount }).ToListAsync();
        var lessonsByS = lessons.GroupBy(l => l.TeacherStudentId).ToDictionary(g => g.Key, g => g.ToList());
        var paidByS = payments.GroupBy(p => p.TeacherStudentId).ToDictionary(g => g.Key, g => g.Sum(p => p.Amount));

        var result = students.Select(s => {
            var ls = lessonsByS.GetValueOrDefault(s.Id) ?? new();
            var due = ls.Sum(l => l.Fee);
            var paid = paidByS.GetValueOrDefault(s.Id, 0m);
            var last = ls.OrderByDescending(l => l.LessonDate).ThenByDescending(l => l.Id).FirstOrDefault();
            return new {
                s.Id, s.DisplayName, s.Phone, s.Note, s.IsArchived, s.StudentUserId, s.avatarUrl, s.DefaultFee,
                lessonCount = ls.Count, totalDue = due, totalPaid = paid, balance = paid - due,
                lastLessonDate = last?.LessonDate,
            };
        })
        .OrderByDescending(s => s.balance < 0)
        .ThenBy(s => s.DisplayName)
        .ToList();

        return Ok(result);
    }

    // GET /api/admin/teachers/:id/students/:sid — 学生详情（课时+缴费，只读）
    [HttpGet("teachers/{id}/students/{sid}")]
    public async Task<IActionResult> GetTeacherStudentDetail(int id, int sid) {
        var exists = await db.TeacherProfiles.AnyAsync(t => t.Id == id);
        if (!exists) return NotFound();

        var ts = await db.TeacherStudents.Include(x => x.StudentUser)
            .FirstOrDefaultAsync(x => x.Id == sid && x.TeacherId == id);
        if (ts == null) return NotFound();

        var lessons = await db.Lessons.Where(l => l.TeacherStudentId == sid)
            .OrderByDescending(l => l.LessonDate).ThenByDescending(l => l.Id)
            .Select(l => new { l.Id, l.LessonDate, l.DurationMinutes, l.Fee, l.Note }).ToListAsync();
        var payments = await db.Payments.Where(p => p.TeacherStudentId == sid)
            .OrderByDescending(p => p.PaidDate).ThenByDescending(p => p.Id)
            .Select(p => new { p.Id, p.Amount, p.PaidDate, p.Note }).ToListAsync();

        var totalDue = lessons.Sum(l => l.Fee);
        var totalPaid = payments.Sum(p => p.Amount);
        return Ok(new {
            ts.Id, ts.DisplayName, ts.Phone, ts.Note, ts.IsArchived, ts.StudentUserId, ts.DefaultFee,
            avatarUrl = ts.StudentUser?.AvatarUrl,
            username = ts.StudentUser?.Username,
            totalDue, totalPaid, balance = totalPaid - totalDue,
            lessons, payments
        });
    }

    // PUT /api/admin/teachers/:id/subjects — 管理员更新教师科目
    [HttpPut("teachers/{id}/subjects")]
    public async Task<IActionResult> UpdateTeacherSubjects(int id, [FromBody] UpdateSubjectsDto dto) {
        var t = await db.TeacherProfiles.Include(t => t.TeacherSubjects)
            .FirstOrDefaultAsync(t => t.Id == id);
        if (t == null) return NotFound();
        var subjects = await db.Subjects.Where(s => dto.SubjectIds.Contains(s.Id)).ToListAsync();
        if (!subjects.Any()) return BadRequest("请选择至少一个学科");

        db.TeacherSubjects.RemoveRange(t.TeacherSubjects);
        await db.SaveChangesAsync();
        foreach (var s in subjects)
            db.TeacherSubjects.Add(new Models.TeacherSubject { TeacherId = t.Id, SubjectId = s.Id });
        await db.SaveChangesAsync();
        return Ok();
    }

    // ── 发系统公告（广播给所有启用用户）──  ← 已在上方，此处仅保留 DTO 与注释 ──

    // ── 访问记录 ──

    // GET /api/admin/access-logs?page=1&pageSize=50&ip=&path=&dateFrom=&dateTo=
    [HttpGet("access-logs")]
    public async Task<IActionResult> GetAccessLogs(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? ip = null,
        [FromQuery] string? path = null,
        [FromQuery] string? dateFrom = null,
        [FromQuery] string? dateTo = null)
    {
        var q = db.AccessLogs.AsQueryable();
        if (!string.IsNullOrEmpty(ip))
            q = q.Where(a => a.Ip.Contains(ip));
        if (!string.IsNullOrEmpty(path))
            q = q.Where(a => a.Path.Contains(path));

        // 日期过滤：先拉到内存再用 string.Compare 避免 SQLite 不支持 DateTime >= 比较
        var list = await q.OrderByDescending(a => a.CreatedAt).ToListAsync();
        if (!string.IsNullOrEmpty(dateFrom))
            list = list.Where(a => string.Compare(a.CreatedAt.ToString("o"), dateFrom, StringComparison.Ordinal) >= 0).ToList();
        if (!string.IsNullOrEmpty(dateTo))
        {
            var dateToEnd = dateTo.Length == 10 ? dateTo + "T23:59:59" : dateTo;
            list = list.Where(a => string.Compare(a.CreatedAt.ToString("o"), dateToEnd, StringComparison.Ordinal) <= 0).ToList();
        }

        var total = list.Count;
        var items = list.Skip((page - 1) * pageSize).Take(pageSize)
            .Select(a => new {
                a.Id, a.Path, a.Method, a.Ip, a.UserId, a.Username,
                a.StatusCode, a.DurationMs, a.UserAgent, a.CreatedAt
            }).ToList();
        return Ok(new { total, page, pageSize, items });
    }

    // GET /api/admin/access-logs/stats
    [HttpGet("access-logs/stats")]
    public async Task<IActionResult> GetAccessLogStats()
    {
        var todayUtc = DateTime.UtcNow.Date;
        var all = await db.AccessLogs.ToListAsync();

        var today = all.Where(a => a.CreatedAt >= todayUtc).ToList();
        var todayPv     = today.Count;
        var todayUv     = today.Select(a => a.Ip).Distinct().Count();
        var todayErrors = today.Count(a => a.StatusCode >= 400);

        // 24小时分布（按小时分组）
        var hourly = Enumerable.Range(0, 24)
            .Select(h => today.Count(a => a.CreatedAt.Hour == h))
            .ToArray();

        var topPaths = all.GroupBy(a => a.Path)
            .OrderByDescending(g => g.Count())
            .Take(10)
            .Select(g => new { path = g.Key, count = g.Count() })
            .ToList();

        var topIps = all.GroupBy(a => a.Ip)
            .OrderByDescending(g => g.Count())
            .Take(10)
            .Select(g => new { ip = g.Key, count = g.Count() })
            .ToList();

        return Ok(new { todayPv, todayUv, todayErrors, hourly, topPaths, topIps });
    }

    // DELETE /api/admin/access-logs/cleanup?days=30
    [HttpDelete("access-logs/cleanup")]
    public async Task<IActionResult> CleanupAccessLogs([FromQuery] int days = 30)
    {
        var cutoff = DateTime.UtcNow.AddDays(-days);
        var old = await db.AccessLogs.Where(a => a.CreatedAt < cutoff).ToListAsync();
        db.AccessLogs.RemoveRange(old);
        await db.SaveChangesAsync();
        return Ok(new { deleted = old.Count });
    }

    // DELETE /api/admin/access-logs/all
    [HttpDelete("access-logs/all")]
    public async Task<IActionResult> ClearAllAccessLogs()
    {
        var count = await db.AccessLogs.CountAsync();
        await db.Database.ExecuteSqlRawAsync("DELETE FROM AccessLogs");
        return Ok(new { deleted = count });
    }

    public record SubjectDto(string Name, string? IconEmoji, int SortOrder, bool IsActive);
    public record RejectDto(string Reason);
    public record RevokeDto(string? Reason);
    public record BroadcastDto(string Title, string? Body, string? LinkUrl);
    public record UpdateSubjectsDto(int[] SubjectIds);
}

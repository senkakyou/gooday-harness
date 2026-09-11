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
public class AdminController(AppDbContext db, IWebHostEnvironment env, NotificationService notif,
    UploadRedirectCache redirectCache) : ControllerBase {

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
    // VideoPlayCount 故意不在里面——它是统计值，让编辑表单能写就等于随时可能被清零。
    public record ToolDto(string Name, string Slug, string Description, string Category,
        string IconEmoji, bool IsOnline, string? OnlineUrl, bool HasDownload,
        string? DownloadFileName, bool IsPublished, bool RequireLogin, string? ReadmeMarkdown,
        bool IsPaid = false, decimal Price = 0,
        string? VideoUrl = null, int VideoDuration = 0, string? Folder = null,
        int? OwnerUserId = null, string? Visibility = null, int? SourceTicketId = null);

    // 归属与可见性归一：没有归属人的一律 public（站方工具），
    // 有归属人的默认 private（客户交付物）。
    // 【默认值只在这一处定】——散在建/改两处的话，改一处漏一处的表现是
    // "编辑一下客户的工具，它就变公开了"
    /// <summary>
    /// `OwnerUserId` / `SourceTicketId` 只有大海能写。返回非 null 表示该拦。
    ///
    /// ═══ 判据的第五次换皮（known-gaps 缺口十九 · 灵犀 2026-09-10 指出）═══
    ///
    ///   放行闸（DeliveryService.BlockReleaseReasonAsync）里唯一由代码判的
    ///   那条是「东西是不是真做出来了」。而它认定**哪件是本单交付物**靠
    ///   `SourceTicketId`，认定**归属对不对**靠 `OwnerUserId`。
    ///
    ///   这两个写入口原来只认 role=admin —— 灵犀的 JWT 角色就是 admin。
    ///   凭空造一件 `SourceTicketId=X` + `OwnerUserId=本单客户` + 三样齐的工具，
    ///   那道硬闸就对一个**空交付**放行。
    ///
    ///   灵犀那句话是这条的最好说明：
    ///   **「你的 e2e 7.1 用的正是这个手法——测试能造，攻击就能造。」**
    ///   能被测试便宜地伪造的东西，也能被攻击便宜地伪造。
    ///
    ///   注意 `POST /api/admin/tools/deliver` 不受影响：它【不从 DTO 取】
    ///   这两个字段，是服务端在过了客户档案闸之后自己设的。
    /// </summary>
    private IActionResult? RejectDeliveryFieldWrite(int? ownerUserId, int? sourceTicketId)
    {
        if (ownerUserId is null && sourceTicketId is null) return null;
        if (CurrentUserId == TicketWorkflow.OwnerUserId) return null;
        return StatusCode(403, new { message =
            "交付物的归属（OwnerUserId）与来源订单（SourceTicketId）只有大海能写——" +
            "放行闸靠这两个字段判「东西是不是真做出来了」，" +
            "改得动它们就等于能凭空造一件假交付物。" +
            "正常上架请走 POST /api/admin/tools/deliver。" });
    }

    private static (int? Owner, string Visibility) NormalizeOwnership(int? owner, string? vis)
    {
        if (owner is null or <= 0) return (null, "public");
        var v = (vis ?? "").Trim().ToLower();
        return (owner, v == "public" ? "public" : "private");
    }

    // 视频字段归一：VideoSource 不让前端自己填，从 URL 形态推出来。
    // 让它可填，迟早出现「source=link 但 URL 是站内路径」这种自相矛盾的记录，
    // 前端按 source 选播放器就会选错。
    private static (string? Url, string Source) NormalizeVideo(string? url) {
        var u = string.IsNullOrWhiteSpace(url) ? null : url.Trim();
        if (u == null) return (null, "upload");
        return (u, u.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                || u.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? "link" : "upload");
    }

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
        if (RejectDeliveryFieldWrite(dto.OwnerUserId, dto.SourceTicketId) is IActionResult deny1)
            return deny1;
        var (vurl, vsrc) = NormalizeVideo(dto.VideoUrl);
        if (NormalizeRelDir(dto.Folder, out var folder) is string ferr) return BadRequest(new { message=ferr });
        var tool = new Tool { Name=dto.Name,Slug=dto.Slug,Description=dto.Description,
            Category=dto.Category,IconEmoji=dto.IconEmoji,IsOnline=dto.IsOnline,
            OnlineUrl=dto.OnlineUrl,HasDownload=dto.HasDownload,DownloadFileName=dto.DownloadFileName,
            IsPublished=dto.IsPublished,RequireLogin=dto.RequireLogin,ReadmeMarkdown=dto.ReadmeMarkdown,
            IsPaid=dto.IsPaid,Price=dto.Price,
            VideoUrl=vurl,VideoSource=vsrc,VideoDuration=Math.Max(0,dto.VideoDuration),Folder=folder };
        var (owner, vis) = NormalizeOwnership(dto.OwnerUserId, dto.Visibility);
        tool.OwnerUserId = owner; tool.Visibility = vis; tool.SourceTicketId = dto.SourceTicketId;
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
        var (vurl, vsrc) = NormalizeVideo(dto.VideoUrl);
        if (RejectDeliveryFieldWrite(dto.OwnerUserId, dto.SourceTicketId) is IActionResult deny2)
            return deny2;
        if (NormalizeRelDir(dto.Folder, out var folder) is string ferr) return BadRequest(new { message=ferr });
        tool.VideoUrl=vurl; tool.VideoSource=vsrc;
        tool.VideoDuration=Math.Max(0,dto.VideoDuration); tool.Folder=folder;
        // 【归属只在显式传了才动】。DTO 里这三个字段是可选的，而后台前端的
        // toBody()/openEdit() 根本不带它们——无条件覆写的后果是：
        // 站长在后台点一下「上架」，客户的私有交付物当场被抹掉归属、变成站方公开工具，
        // 挂到首页上，而且不报错、没日志。（2026-09-09 灵犀评审第 1 条，上线后当天发现）
        if (dto.OwnerUserId is not null || dto.Visibility is not null) {
            var (owner, vis) = NormalizeOwnership(dto.OwnerUserId, dto.Visibility);
            tool.OwnerUserId = owner;
            tool.Visibility = vis;
        }
        if (dto.SourceTicketId is not null) tool.SourceTicketId = dto.SourceTicketId;
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

    // 视频讲解只收这两种：浏览器原生 <video> 能直接播、且 MIME 已在内置列表里。
    // .mov/.mkv 故意不收——手机拍出来的 mov 很多浏览器播不了，让它转码后再传，
    // 好过传上去才发现是个下载链接。
    private static readonly HashSet<string> AllowedVideoExts =
        new(StringComparer.OrdinalIgnoreCase) { ".mp4", ".webm" };

    // Windows 保留设备名：将来工具包被解压到 Windows 上会直接失败，源头就挡住
    private static readonly HashSet<string> ReservedNames = new(StringComparer.OrdinalIgnoreCase) {
        "CON","PRN","AUX","NUL",
        "COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9",
        "LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9",
    };

    // Unicode 归一化到 NFC。Mac 传来的中文名是分解形(NFD)，和 Linux 上的 NFC
    // 【肉眼一模一样、字节不同】：不统一就会冒出两个"同名"文件夹，
    // 引用一边对得上一边对不上，还极难看出来。
    private static string NormalizeName(string s) =>
        s.Normalize(System.Text.NormalizationForm.FormC).Trim();

    // 名字里【只允许】这些：汉字/字母/数字 + 连字符、下划线、点。
    //
    // 为什么是白名单而不是黑名单（灵犀评审第 7 条）：黑名单永远漏。
    // 我先漏了空格，补上后又漏了 U+200B 零宽空格、U+202E 这类 Unicode 格式字符——
    // 它们 char.IsControl 不认、肉眼看不出，能造出两个"同名"文件夹。
    // 漏的代价是具体的：名字里带了扫描正则的边界字符（空白、引号、括号、逗号、
    // 分号、? # %），全站扫引用就会把路径【从中间截断】→ 这个文件被判成没人用 →
    // 「一键清理空闲文件」把它删掉。
    private static bool IsNameChar(char c) =>
        char.IsLetterOrDigit(c) || c is '-' or '_' or '.';

    // 校验单段文件名/文件夹名（中文合法）。返回 null=合法，否则返回中文原因。
    private static string? ValidateSegment(string seg, string what) {
        if (string.IsNullOrWhiteSpace(seg))       return $"{what}不能为空";
        if (seg != seg.Trim())                    return $"{what}首尾不能有空格";
        if (seg is "." or "..")                   return $"{what}非法";
        if (seg.StartsWith('.'))                  return $"{what}不能以点开头（会变成隐藏文件）";
        if (seg.EndsWith('.'))                    return $"{what}不能以点结尾";
        foreach (var c in seg) {
            if (IsNameChar(c)) continue;
            if (char.IsControl(c))
                return $"{what}不能包含控制字符";
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)
                    == System.Globalization.UnicodeCategory.Format)
                return $"{what}含不可见的 Unicode 格式字符（U+{(int)c:X4}，如零宽空格/换向符）——" +
                       $"肉眼看不出来，会造出两个「同名」文件夹";
            return $"{what}只能用汉字、字母、数字和 - _ . （出现了 '{c}'）：" +
                   $"其它字符会在引用扫描或 URL 里把路径截断，文件会被误判成空闲而遭清理";
        }
        if (ReservedNames.Contains(Path.GetFileNameWithoutExtension(seg)))
            return $"{what}用了系统保留名（CON/PRN/COM1…），解压到 Windows 会失败";
        // 文件系统按【字节】限 255，一个中文 UTF-8 占 3 字节，60 字 = 180 字节，留足余量
        if (seg.Length > 60)                      return $"{what}过长（最多 60 个字）";
        return null;
    }

    // 校验并归一化「相对 uploads 的目录」，如 "tools/照片管家Pro"。
    // 返回 null=合法（结果写进 clean，空目录=uploads 根，clean 为 ""），否则返回中文原因。
    private static string? NormalizeRelDir(string? dir, out string clean) {
        clean = "";
        if (string.IsNullOrWhiteSpace(dir)) return null;
        var raw = NormalizeName(dir).Replace('\\', '/').Trim('/');
        if (raw.Length == 0) return null;
        var segs = raw.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segs.Length > 3) return "目录层级最多 3 层";
        foreach (var s in segs)
            if (ValidateSegment(s, "文件夹名") is string err) return err;
        clean = string.Join('/', segs);
        return null;
    }

    // POST /api/admin/upload?dir=tools/照片管家Pro —— 上传文件到 uploads/<dir>/
    // dir 省略时落在 uploads 根（老行为）。
    // 【RequestSizeLimit 和 RequestFormLimits 必须成对】：只写前者的话 multipart
    // 仍按默认 128MB 截断；而不写任何一个时 Kestrel 默认只给 ~28MB，
    // 代码里"不能超过100MB"那句根本轮不到执行——请求早就被框架拒了。
    [HttpPost("upload")]
    [RequestSizeLimit(100L * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 100L * 1024 * 1024)]
    public async Task<IActionResult> UploadFile(IFormFile file, [FromQuery] string? dir = null) {
        if (file.Length==0) return BadRequest(new { message="文件为空" });
        if (file.Length > 100*1024*1024) return BadRequest(new { message="不能超过100MB" });

        var orig = NormalizeName(Path.GetFileName(file.FileName));
        var ext = Path.GetExtension(orig);
        if (string.IsNullOrEmpty(ext) || !AllowedUploadExts.Contains(ext))
            return BadRequest(new { message="不支持的文件类型" });
        // 【削名而不是拒收】：用户电脑上叫「季度报告 v2.pdf」很正常，
        // 为了命名规则把上传打回去是拿规则惩罚用户。削成合法名再存，回包里告诉他叫什么了。
        orig = SanitizeSegment(Path.GetFileNameWithoutExtension(orig)) + ext;
        if (ValidateSegment(orig, "文件名") is string nerr) return BadRequest(new { message=nerr });

        return await SaveUploadAsync(file, dir, orig, ext);
    }

    // POST /api/admin/tools/video-upload?dir=tools/照片管家Pro —— 上传视频讲解
    // 单开一个端点而不是复用 upload，是因为体积档次差一个量级：
    // 讲解 8 分钟 1080p 轻松 200MB+，而给普通上传开到 500MB 等于给所有类型都开。
    // nginx 侧也要对这个路径单独放宽（ops/nginx/conf.d/gooday.conf），否则 413 死在门口。
    [HttpPost("tools/video-upload")]
    [RequestSizeLimit(500L * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 500L * 1024 * 1024)]
    public async Task<IActionResult> UploadToolVideo(IFormFile file, [FromQuery] string? dir = null) {
        if (file.Length==0) return BadRequest(new { message="文件为空" });
        if (file.Length > 500L*1024*1024) return BadRequest(new { message="视频不能超过500MB" });

        var orig = NormalizeName(Path.GetFileName(file.FileName));
        var ext = Path.GetExtension(orig);
        if (string.IsNullOrEmpty(ext) || !AllowedVideoExts.Contains(ext))
            return BadRequest(new { message="视频只支持 mp4 / webm（其它格式请先转码）" });
        orig = SanitizeSegment(Path.GetFileNameWithoutExtension(orig)) + ext;   // 同上：削名不拒收
        if (ValidateSegment(orig, "文件名") is string nerr) return BadRequest(new { message=nerr });

        return await SaveUploadAsync(file, dir, orig, ext);
    }

    // 落盘逻辑：两个上传端点共用。返回 { fileName, path, url, size }。
    // path 是【相对 uploads 的完整路径】——工具的下载字段/视频字段要存的是它，
    // 只回 fileName 的话文件在子目录里就找不到了。
    private async Task<IActionResult> SaveUploadAsync(IFormFile file, string? dir, string orig, string ext) {
        if (NormalizeRelDir(dir, out var relDir) is string derr) return BadRequest(new { message=derr });

        var root = Path.Combine(env.WebRootPath, "uploads");
        if (!TryResolveUnder(root, relDir, out var full)) return BadRequest(new { message="无效目录" });
        Directory.CreateDirectory(full);

        var name = Path.GetFileNameWithoutExtension(orig);
        var fn = orig;
        // 同名文件已存在时，加时间戳后缀避免覆盖（如 tool_20240115120000.zip）
        if (System.IO.File.Exists(Path.Combine(full, fn)))
            fn = $"{name}_{DateTime.UtcNow:yyyyMMddHHmmss}{ext}";

        using (var s = System.IO.File.Create(Path.Combine(full, fn)))
            await file.CopyToAsync(s);

        var rel = string.IsNullOrEmpty(relDir) ? fn : $"{relDir}/{fn}";
        return Ok(new { fileName=fn, path=rel, url="/uploads/"+rel, size=file.Length });
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
        // 从任意文本中提取所有 /uploads/xxx 引用（覆盖直接 URL、Markdown ![](...)、[img:...] 等写法）。
        // 【必须和改写用的是同一个正则】（UploadRefRe）：原来这里的边界比改写宽，
        // 允许 , ; ? # 进路径。私信里写「下载 /uploads/tools/X/X.zip，有问题找我」，
        // 扫描抓到的 key 就带着那个中文逗号后的尾巴，跟真文件对不上 →
        // 这个文件被判成空闲 → 「一键清理」会删掉它。（2026-09-08 灵犀评审第 1 条）
        void Scan(string? text, string label) {
            if (string.IsNullOrEmpty(text)) return;
            foreach (var rel in RefsIn(text))
                Add(byRel, rel, label);
        }

        // 工具：在线运行 URL（即工具本体 HTML）、说明文档内嵌图片、下载文件、视频讲解
        var tools = await db.Tools
            .Select(t => new { t.Name, t.OnlineUrl, t.DownloadFileName, t.ReadmeMarkdown, t.VideoUrl, t.Description })
            .ToListAsync();
        foreach (var t in tools) {
            Scan(t.OnlineUrl, $"在线工具：{t.Name}");
            Scan(t.ReadmeMarkdown, $"工具说明：{t.Name}");
            // Description 一直在被 RewriteReferences 改写，却从来没被扫描过——
            // 把图片写在简介里的工具，那张图一直处于「待删」状态（灵犀评审第 2 条）
            Scan(t.Description, $"工具简介：{t.Name}");
            // 【视频讲解必须扫】：漏了它，讲解视频会被判成空闲文件，
            // 后台「一键清理空闲文件」按一下就把所有讲解删光了。外链自动跳过（Scan 只匹配 /uploads）
            Scan(t.VideoUrl, $"视频讲解：{t.Name}");
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

        // 订单需求：附件以「【附件】name: /uploads/requests/..」形式内嵌在描述里(见 RequestsHome.jsx)
        foreach (var tk in await db.Tickets.Select(t => new { t.Id, t.Description }).ToListAsync())
            Scan(tk.Description, $"订单#{tk.Id}");

        // 订单工作记录：交付路径、证据引用会落在这里
        // 【它和下面 FixReferencesAsync 里的循环必须一一对应】——
        // 只在一边加表，就会出现「扫描说没人引用 → 允许改名 → 另一边没跟着改 → 链接断」。
        foreach (var lg in await db.TicketLogs.Select(l => new { l.TicketId, l.Text }).ToListAsync())
            Scan(lg.Text, $"订单记录#{lg.TicketId}");

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

    // 路径里有没有软链接成分。TryResolveUnder 用的 GetFullPath 【只做字符串规范化，
    // 不解析软链】——uploads 里若有一个指向别处的软链目录，"看起来在 uploads 里"
    // 的路径其实能写到系统任何地方（灵犀评审第 9-③ 条）。
    private static bool HasSymlinkComponent(string root, string full) {
        var r = Path.GetFullPath(root);
        var cur = full;
        while (cur != null && cur.Length >= r.Length) {
            try {
                if (System.IO.File.Exists(cur) || Directory.Exists(cur)) {
                    var attr = System.IO.File.GetAttributes(cur);
                    if (attr.HasFlag(FileAttributes.ReparsePoint)) return true;
                }
            } catch { /* 读不到属性就当它可疑不了，交给后续的存在性检查 */ }
            if (string.Equals(cur, r, StringComparison.Ordinal)) break;
            cur = Path.GetDirectoryName(cur);
        }
        return false;
    }

    // 同目录下有没有"只差大小写"的同名项。Linux 放得下 a.html 和 A.html，
    // 但这些文件将来会被打包发给 Windows/mac 用户，在那边就撞成一个。
    private static bool ExistsIgnoreCase(string full) {
        var dir = Path.GetDirectoryName(full);
        if (dir == null || !Directory.Exists(dir)) return false;
        var name = Path.GetFileName(full);
        return Directory.EnumerateFileSystemEntries(dir)
            .Any(e => string.Equals(Path.GetFileName(e), name, StringComparison.OrdinalIgnoreCase));
    }

    // 自底向上删掉空目录（搬空的老目录、回滚后残留的新目录）。root 本身不动。
    private static void CleanEmptyDirs(string root) {
        if (!Directory.Exists(root)) return;
        foreach (var d in Directory.GetDirectories(root, "*", SearchOption.AllDirectories)
                     .OrderByDescending(x => x.Length))
            try { if (!Directory.EnumerateFileSystemEntries(d).Any()) Directory.Delete(d); } catch { }
    }

    // 把 rel 安全解析为 uploads 下的绝对路径，防止路径穿越。越界返回 false。
    private static bool TryResolveUnder(string root, string? rel, out string full) {
        var r = Path.GetFullPath(root);
        full = Path.GetFullPath(Path.Combine(r, (rel ?? "").Replace('/', Path.DirectorySeparatorChar)));
        return full == r || full.StartsWith(r + Path.DirectorySeparatorChar);
    }

    // uploads 引用的统一形态：/uploads/<路径>，路径到这些字符为止
    // （和 BuildFileUsageAsync 的 Scan 保持同一套边界，否则"扫得到但改不着"）
    private static readonly Regex UploadRefRe = new(@"/uploads/([^\s""'>)\]\\,;?#]+)", RegexOptions.Compiled);

    // 按映射表一次过重写文本里的所有 /uploads/ 引用。
    // 【一次过、不逐条替换】：逐条替换时若映射里同时有 A→B 和 B→C，
    // 第二条会把刚换成 B 的又推到 C，凭空搬错文件。单次扫描+查表没有这个问题。
    private static string ApplyRefMap(string text, Dictionary<string,string> map) =>
        UploadRefRe.Replace(text, m => {
            var rel = Uri.UnescapeDataString(m.Groups[1].Value);
            return map.TryGetValue(rel, out var nw) ? "/uploads/" + nw : m.Value;
        });

    // 文件改名/移动后，把数据库里和 uploads 内静态文本文件里对该文件的引用全部更新，引用不断链。
    private Task RewriteReferencesAsync(string oldRel, string newRel) =>
        RewriteReferencesBatchAsync(new[] { (oldRel, newRel) });

    // 批量版：一次搬 N 个文件也只扫一遍数据库和一遍磁盘。
    // 【必须是批量的】：归置 100 多个文件时逐个调用等于把全库全盘扫 100 多遍，
    // 请求会卡在 nginx 的 150s proxy_read_timeout 上断掉，而文件已经搬了一半。
    private async Task RewriteReferencesBatchAsync(IEnumerable<(string oldRel, string newRel)> pairs) {
        var map = new Dictionary<string,string>(StringComparer.Ordinal);
        foreach (var (o, n) in pairs) {
            if (string.IsNullOrEmpty(o) || string.IsNullOrEmpty(n) || o == n) continue;
            map[o] = n;
        }
        if (map.Count == 0) return;

        // 纯文件名 → 新相对路径。工具的 DownloadFileName 历史上有"只存文件名"的写法，
        // 同名文件出现在两个目录时无从分辨，这种歧义的一律不改（宁可漏改也不能改错）。
        var byName = new Dictionary<string,string>(StringComparer.Ordinal);
        var dupName = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (o, n) in map) {
            var nm = Path.GetFileName(o);
            if (!byName.TryAdd(nm, n)) dupName.Add(nm);
        }
        foreach (var d in dupName) byName.Remove(d);

        var uploadRoot = Path.Combine(env.WebRootPath, "uploads");
        string? Fix(string? s) => string.IsNullOrEmpty(s) ? s : ApplyRefMap(s!, map);

        foreach (var t in await db.Tools.ToListAsync()) {
            t.OnlineUrl      = Fix(t.OnlineUrl);
            t.ReadmeMarkdown = Fix(t.ReadmeMarkdown);
            t.Description    = Fix(t.Description) ?? t.Description;
            t.VideoUrl       = Fix(t.VideoUrl);   // 漏了这行，移动视频文件 = 讲解按钮点开就是黑屏
            if (!string.IsNullOrEmpty(t.DownloadFileName)) {
                var dl = t.DownloadFileName!.Replace('\\', '/').TrimStart('/');
                if (map.TryGetValue(dl, out var nw)) t.DownloadFileName = nw;            // 带子目录形式
                else if (byName.TryGetValue(dl, out var nw2)
                         // 【只有这个裸文件名在老位置确实已经没有了，才认它是"被搬走的那个"】。
                         // 不加这条：别的工具搬走一个同名文件，就会把【本工具】的下载
                         // 指到别人的包上——用户下到的是另一个工具（灵犀评审第 4 条）。
                         && !System.IO.File.Exists(Path.Combine(uploadRoot, dl.Replace('/', Path.DirectorySeparatorChar))))
                    t.DownloadFileName = nw2;                                            // 纯文件名形式 → 补成完整相对路径
            }
            // 归置后 Folder 跟着文件走：它指向的目录如果整体搬了，字段也要跟上
            if (!string.IsNullOrEmpty(t.Folder)) {
                foreach (var (o, n) in map) {
                    var od = Path.GetDirectoryName(o)?.Replace('\\','/') ?? "";
                    var nd = Path.GetDirectoryName(n)?.Replace('\\','/') ?? "";
                    if (od.Length > 0 && t.Folder == od && nd.Length > 0) { t.Folder = nd; break; }
                }
            }
        }
        foreach (var i in await db.SecondhandItems.ToListAsync()) i.Images = Fix(i.Images) ?? i.Images;
        foreach (var p in await db.ForumPosts.ToListAsync())      p.Content = Fix(p.Content) ?? p.Content;
        // 听书：封面图、EPUB 文字版、各章节音频
        foreach (var b in await db.Audiobooks.ToListAsync()) {
            b.CoverUrl = Fix(b.CoverUrl) ?? b.CoverUrl;
            b.EpubUrl  = Fix(b.EpubUrl)  ?? b.EpubUrl;
        }
        foreach (var c in await db.AudiobookChapters.ToListAsync())
            c.MediaUrl = Fix(c.MediaUrl) ?? c.MediaUrl;
        // 私信(交付物链接)、需求单附件、项目交付、工单、财务凭证——与 BuildFileUsageAsync 扫描面对齐，
        // 否则改名/移动这些文件会把客户下载链接改断
        foreach (var pm in await db.PrivateMessages.ToListAsync())
            pm.Content = Fix(pm.Content) ?? pm.Content;
        foreach (var tk in await db.Tickets.ToListAsync())
            tk.Description = Fix(tk.Description) ?? tk.Description;
        // 与 BuildFileUsageAsync 的扫描面一一对应，见那边的注释
        foreach (var lg in await db.TicketLogs.ToListAsync())
            lg.Text = Fix(lg.Text) ?? lg.Text;
        foreach (var fr in await db.FinanceRecords.ToListAsync())
            fr.EvidenceUrl = Fix(fr.EvidenceUrl);

        // 旧路径→新路径映射：站内引用上面都改完了，站外的（收藏夹/别处贴的链接/搜索引擎）
        // 改不了，靠这张表在 Program.cs 里 301 兜住
        await RecordRedirectsAsync(map);
        await SaveAndInvalidateAsync();

        // uploads 内静态文本文件之间的内部引用（如页面引入共享库）
        var root = Path.Combine(env.WebRootPath, "uploads");
        if (Directory.Exists(root)) {
            var textExt = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                { ".html", ".htm", ".css", ".js", ".json", ".md", ".svg" };
            foreach (var f in Directory.GetFiles(root, "*", SearchOption.AllDirectories)) {
                if (!textExt.Contains(Path.GetExtension(f))) continue;
                if (new FileInfo(f).Length > 2 * 1024 * 1024) continue;  // 跳过过大文件
                string content;
                try { content = await System.IO.File.ReadAllTextAsync(f); } catch { continue; }
                if (!content.Contains("/uploads/")) continue;
                var replaced = ApplyRefMap(content, map);
                if (replaced == content) continue;
                try { await System.IO.File.WriteAllTextAsync(f, replaced); } catch { }
            }
        }
    }

    // 记录/维护旧路径→新路径映射（不落 SaveChanges，由调用方一起提交）
    private async Task RecordRedirectsAsync(Dictionary<string,string> map) {
        var all = await db.UploadRedirects.ToListAsync();
        foreach (var (oldRel, newRel) in map) {
            // 连续搬家 A→B、之后 B→C：老的 A→B 必须直接改指 C，
            // 否则老链接被 301 到一个已经不存在的 B，等于没兜住
            foreach (var r in all.Where(r => r.NewPath == oldRel)) r.NewPath = newRel;

            // 搬回原处：新路径上如果还挂着旧映射，会把这个文件自己的地址 301 到别处，
            // 甚至和上面的改写凑成一个来回跳的循环
            var loop = all.FirstOrDefault(r => r.OldPath == newRel);
            if (loop != null) { db.UploadRedirects.Remove(loop); all.Remove(loop); }

            var exist = all.FirstOrDefault(r => r.OldPath == oldRel);
            if (exist != null) exist.NewPath = newRel;
            else {
                var add = new UploadRedirect { OldPath = oldRel, NewPath = newRel };
                db.UploadRedirects.Add(add);
                all.Add(add);
            }
        }
        // 兜底：任何指向自己的行都清掉。上面的链式改写理论上不会留下这种行，
        // 但真留下一条，且那个文件哪天被删了，浏览器就会在同一个地址上无限打转
        foreach (var r in all.Where(r => r.OldPath == r.NewPath).ToList()) {
            db.UploadRedirects.Remove(r);
            all.Remove(r);
        }
        // 表变了，清缓存。【放在这里而不是各个调用点】——要求调用方记得清的结构，
        // 就是在等下一次有人忘；忘了的表现是"搬完之后老链接还是断的"，很难查。
        // 但这里只是"改动已进 DbContext"，还没提交，所以提交之后必须再清一次，
        // 见 SaveAndInvalidateAsync（灵犀评审第二轮第 1 条）。
        redirectCache.Invalidate();
    }

    // 提交 + 清缓存。【顺序不能反】：提交前清的话，并发的 /uploads 未命中请求会把
    // 缓存重新装成"提交前的旧表"，而之后不会再有第二次失效——老链接就一直 404 到
    // 下一次写操作为止。窗口很窄，但坏在它是静默的：没有报错，只有用户点不开。
    private async Task SaveAndInvalidateAsync() {
        await db.SaveChangesAsync();
        redirectCache.Invalidate();
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
        var newName = NormalizeName(dto.newName);
        if (ValidateSegment(newName, "文件名") is string nerr) return BadRequest(new { message = nerr });
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
        if (NormalizeRelDir(dto.path, out var rel) is string derr) return BadRequest(new { message = derr });
        if (string.IsNullOrEmpty(rel)) return BadRequest(new { message = "文件夹名不能为空" });
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

    // ================= 定制需求的交付：上架到工具一览 =================
    // 大海的口径：交付我不介入，灵犀上架、如意通知客户，交付物在线+视频+下载三样全。
    // 所以这个端点是给【灵犀】调的，不是给人在后台点的。

    public record DeliverDto(
        int TicketId,
        string? Name, string? Description, string? Category, string? IconEmoji,
        string? OnlineUrl,          // uploads 下相对路径，须在 private/<工单号>/ 里
        string? DownloadFileName,
        string? VideoUrl, int VideoDuration = 0,
        string? ReadmeMarkdown = null);

    // POST /api/admin/tools/deliver —— 把一张工单的交付物上架成客户的私有工具
    //
    // 【幂等】：同一张工单反复调用是更新同一件，不会建出第二件。
    // 灵犀的用法就是"传一样调一次"——先有在线版和下载包时调一次（这时缺视频，
    // 返回 complete=false），讲解片出完再调一次；三样齐的那一次自动让如意通知客户。
    //
    // 【不要用通用的 PUT /api/admin/tools/{id} 来干这件事】：那个是整体覆盖语义，
    // 少传一个字段就把它清空（我自己的回归脚本就这么把视频字段清过一次）。
    [HttpPost("tools/deliver")]
    public async Task<IActionResult> Deliver([FromBody] DeliverDto dto, [FromServices] DeliveryService delivery)
    {
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == dto.TicketId);
        if (ticket == null) return NotFound(new { message = $"订单 #{dto.TicketId} 不存在" });

        // ⚠️ 【必须换算，不能直接用 ticket.ClientId】（2026-09-10 语义变更）：
        //    Tickets.ClientId 现在指 Clients.Id，而 Tools.OwnerUserId 要的是 Users.Id。
        //    直接赋值的话两个都是小整数，编译器不会报错，
        //    结果是**交付物挂到了另一个用户名下**——而后台看起来一切正常。
        if (ticket.ClientId is not int clientRecordId)
            return BadRequest(new { message =
                "这张订单没有关联客户档案，没法把交付物挂到谁名下。" +
                "先在订单里绑定客户，或者走老路（私信发链接）。" });

        var clientId = await db.Clients.Where(c => c.Id == clientRecordId)
                                       .Select(c => c.UserId).FirstOrDefaultAsync();
        if (clientId is not int ownerUserId)
            return BadRequest(new { message =
                $"客户档案 #{clientRecordId} 没有绑定平台账号（线下客户），" +
                "交付物挂不到谁名下。先让客户注册并把账号绑到客户档案上。" });

        var tool = await delivery.ForTicketAsync(dto.TicketId);
        if (tool == null) {
            var baseSlug = SanitizeSegment(dto.Name ?? ticket.Title).ToLowerInvariant();
            var slug = $"d-{ticket.TicketNo.ToLowerInvariant()}";
            if (await db.Tools.AnyAsync(t => t.Slug == slug)) slug += "-" + Guid.NewGuid().ToString("N")[..6];
            tool = new Tool {
                Slug = slug,
                Name = dto.Name ?? ticket.Title,
                Description = dto.Description ?? ticket.Description,
                Category = dto.Category ?? "定制",
                IconEmoji = dto.IconEmoji ?? "📦",
                SourceTicketId = ticket.Id,
                // 【默认私有，且只有本单客户】。这两条不接受调用方覆盖——
                // 交付物默认给全站看，是这套设计里最不能出的错
                OwnerUserId = ownerUserId,
                Visibility = "private",
                // 【建的时候不发布】。上架发生在出片之前，如果出片失败就停在这儿，
                // 客户的工具一览里会躺着一件能打开、但没讲解也没人通知他的半成品——
                // 那不是"他看不到"，是"他看到一件半成品"。三样齐了才翻上架。
                IsPublished = false,
                RequireLogin = true,
                Folder = delivery.PrivateDirFor(ticket.TicketNo),
            };
            db.Tools.Add(tool);
        }

        // 传了才更新，没传保持原样——灵犀是分几次把三样凑齐的
        if (dto.Name is not null) tool.Name = dto.Name;
        if (dto.Description is not null) tool.Description = dto.Description;
        if (dto.Category is not null) tool.Category = dto.Category;
        if (dto.IconEmoji is not null) tool.IconEmoji = dto.IconEmoji;
        if (dto.ReadmeMarkdown is not null) tool.ReadmeMarkdown = dto.ReadmeMarkdown;
        if (dto.OnlineUrl is not null) { tool.OnlineUrl = dto.OnlineUrl; tool.IsOnline = true; }
        if (dto.DownloadFileName is not null) { tool.DownloadFileName = dto.DownloadFileName; tool.HasDownload = true; }
        if (dto.VideoUrl is not null) {
            var (vurl, vsrc) = NormalizeVideo(dto.VideoUrl);
            tool.VideoUrl = vurl; tool.VideoSource = vsrc;
        }
        if (dto.VideoDuration > 0) tool.VideoDuration = dto.VideoDuration;
        tool.OwnerUserId = ownerUserId;              // 每次都钉死，防止被别的路径改歪
        tool.SourceTicketId = ticket.Id;
        tool.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var status = delivery.Check(tool);
        if (status.Complete && !tool.IsPublished) {
            // 三样齐了才让客户【有可能】看见。发布 ≠ 通知，见下。
            tool.IsPublished = true;
            await db.SaveChangesAsync();
        }

        // ═══ 2026-09-10：这里原来会自动通知客户，已删（docs/decisions/006）═══
        //
        //   上一版是「三样一齐就让如意发通知」。在新流程里这是抢跑：
        //   大海要先看过东西、点「放行验收」，如意才通知客户。
        //
        //   通知现在只发生在一个地方——POST /api/tickets/{id}/transition
        //   的 release 事件里。**两个地方都能通知客户，就一定会出现
        //   「客户先收到通知，大海还没看过」**，而这条链路上大海是最后一道人工闸。
        //
        //   幂等仍由 DeliveryService.NotifyCustomerAsync 自己保证。
        // ═══════════════════════════════════════════════════════════════

        return Ok(new {
            toolId = tool.Id, tool.Slug, tool.Name,
            ownerUserId = tool.OwnerUserId, tool.Visibility, tool.IsPublished,
            complete = status.Complete,
            missing = status.Missing,
            hint = status.Complete
                ? "三样齐了，等大海点「放行验收」才通知客户"
                : "还差东西，先不放行——交付对客户必须是原子的，别让他看见半成品",
        });
    }

    // GET /api/admin/tools/deliver/{ticketId} —— 查这张工单的交付进度（灵犀轮询用）
    [HttpGet("tools/deliver/{ticketId:int}")]
    public async Task<IActionResult> DeliverStatus(int ticketId, [FromServices] DeliveryService delivery)
    {
        var tool = await delivery.ForTicketAsync(ticketId);
        if (tool == null) return Ok(new { exists = false, complete = false, missing = new[] { "还没上架" } });
        var st = delivery.Check(tool);
        return Ok(new { exists = true, toolId = tool.Id, tool.Slug, tool.Name, tool.Visibility,
                        complete = st.Complete, missing = st.Missing });
    }

    // ================= 一工具一文件夹：归置 =================
    // 分两步走，【plan 只算不动，apply 只动不算】：
    // apply 收的是一份明确的搬运清单，不是自己再算一遍——
    // 这样人可以先看清单、手工调掉不合适的几条（比如那首粤语歌不该被改成工具名），
    // 调完照单执行，执行的和审过的是同一份东西。

    public record OrganizeMove(string From, string To);
    public record OrganizeFolder(int ToolId, string Folder);
    public record OrganizeApplyDto(OrganizeMove[] Moves, OrganizeFolder[] Folders);

    // 把任意字符串削成合法的一段目录名/文件名（用于从工具名生成文件夹名）。
    // 空格和 ()[]，;?#% 一律换成连字符——不是为了好看：
    // 103 个工具里有 74 个名字带空格（"PDF 转换工具"），原样做目录名的话，
    // 全站扫引用会在空格处断掉，这些文件会被当成没人用的空闲文件清理掉。
    private static string SanitizeSegment(string raw) {
        var s = NormalizeName(raw ?? "");
        var sb = new System.Text.StringBuilder();
        // 白名单之外的一律压成连字符（空格、中文标点、箭头、括号…），
        // 和 ValidateSegment 同一套判定——否则会出现"自己生成的名字自己不收"
        foreach (var c in s) sb.Append(IsNameChar(c) ? c : '-');
        // 连续的连字符收成一个，首尾的去掉（"CSS Flexbox/Grid 可视化工具" → "CSS-Flexbox-Grid-可视化工具"）
        var o = Regex.Replace(sb.ToString(), "-{2,}", "-").Trim('-').Trim().Trim('.').Trim('-').Trim();
        if (o.Length > 60) {
            // 别把代理对(emoji)从中间劈开——劈开就是个坏码位，落到文件名上更难查
            var cut = 60;
            if (char.IsHighSurrogate(o[cut - 1])) cut--;
            o = o[..cut].Trim();
        }
        if (o.Length == 0) o = "未命名";
        if (ReservedNames.Contains(Path.GetFileNameWithoutExtension(o))) o = "_" + o;
        return o;
    }

    // 是不是站外地址。判 "://" 而不是 "http" 开头——后者会把 http-status.html
    // 这类文件名误判成外链
    private static bool IsExternal(string s) =>
        s.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
        || s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
        || s.StartsWith("//", StringComparison.Ordinal);

    // 从一段文本里取出所有 /uploads/ 引用的相对路径
    private static IEnumerable<string> RefsIn(string? text) {
        if (string.IsNullOrEmpty(text)) yield break;
        foreach (Match m in UploadRefRe.Matches(text!))
            yield return Uri.UnescapeDataString(m.Groups[1].Value);
    }

    // GET /api/admin/tools/organize/plan?prefix=tools —— 干跑，只出方案不动任何文件
    [HttpGet("tools/organize/plan")]
    public async Task<IActionResult> OrganizePlan([FromQuery] string prefix = "tools") {
        if (NormalizeRelDir(prefix, out var root0) is string perr) return BadRequest(new { message = perr });
        var root = Path.Combine(env.WebRootPath, "uploads");

        var tools = await db.Tools.OrderBy(t => t.Id).ToListAsync();

        // 谁引用了哪些文件：被两个及以上工具引用的（共享库、公共资源）一律不搬——
        // 搬进任何一个工具的文件夹都是错的，另一个工具的引用虽然会被改对，
        // 但"这个文件属于谁"从此就说不清了
        var refCount = new Dictionary<string,List<string>>(StringComparer.Ordinal);
        foreach (var t in tools)
            foreach (var r in ToolRefs(t).Select(x => x.rel).Distinct(StringComparer.Ordinal)) {
                if (!refCount.TryGetValue(r, out var owners)) refCount[r] = owners = new();
                owners.Add(t.Name);
            }

        // 文件夹重名：两个工具叫同一个名字时，后来的加 slug 区分
        var usedFolders = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var plans = new List<object>();
        var allTargets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int moveCount = 0;

        foreach (var t in tools) {
            var folderName = SanitizeSegment(t.Name);
            if (!usedFolders.Add(folderName)) {
                folderName = SanitizeSegment($"{t.Name}-{t.Slug}");
                usedFolders.Add(folderName);
            }
            var folder = string.IsNullOrEmpty(root0) ? folderName : $"{root0}/{folderName}";

            var moves = new List<object>();
            var skipped = new List<object>();
            var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var seenRel = new HashSet<string>(StringComparer.Ordinal);

            foreach (var (rel, role) in ToolRefs(t)) {
                // 【必须比到 :// 】。只判 "http" 开头的话，名字叫 http-status.html
                // 的文件会被当成外链默默丢掉——既不搬也不报，人看清单根本发现不了
                if (IsExternal(rel)) continue;
                // 同一个文件同时挂在两个字段上是常态：103 个工具里有 22 个的
                // 在线页面和下载文件【就是同一个 html】。不去重就会给同一个源文件
                // 排两条搬运指令，apply 那边直接整批拒收。
                // 按 ToolRefs 的出场顺序取第一个角色（在线 > 下载 > 视频 > 说明附件）。
                if (!seenRel.Add(rel)) continue;
                var owners = refCount.TryGetValue(rel, out var o) ? o : new List<string>();
                if (owners.Distinct().Count() > 1) {
                    skipped.Add(new { path = rel, reason = $"被 {owners.Distinct().Count()} 个工具共用（{string.Join("、", owners.Distinct().Take(4))}），留在原处" });
                    continue;
                }
                if (!TryResolveUnder(root, rel, out var srcFull) || !System.IO.File.Exists(srcFull)) {
                    skipped.Add(new { path = rel, reason = "磁盘上找不到这个文件（数据库里的引用已经是坏的）" });
                    continue;
                }
                var curDir = (Path.GetDirectoryName(rel) ?? "").Replace('\\','/');
                var ext = Path.GetExtension(rel);

                // 【已经在自己文件夹里的，一概不动】。归置要干的事是"把散在外面的收回家"，
                // 不是"照我的命名规则再改一遍名"。少了这一条，这个操作就不幂等：
                // 人工特意保留的名字（歌名、APK 的 ABI 号）会在下次点按钮时被悄悄改掉。
                if (string.Equals(curDir, folder, StringComparison.Ordinal)) continue;

                // 目标文件名：工具本体/下载包用文件夹名（这一步顺手把
                // BatchPerformanceAnalyzer_20260707023857.html 这种机器码名字改成人看得懂的），
                // 视频统一叫「讲解」，说明文档里的图片等附属文件保持原名不动
                // 【只有扩展名长得像扩展名时才敢改名】。"DBMigrate-Pro-v0.2" 这种
                // 没有扩展名的文件，GetExtension 会把版本号里的 ".2" 当成扩展名，
                // 改出来就是 "DBMigrate-Pro.2" —— 一个谁也打不开的假后缀。
                var extOk = Regex.IsMatch(ext, @"^\.[A-Za-z][A-Za-z0-9]{0,7}$");
                var targetName = !extOk ? Path.GetFileName(rel) : role switch {
                    "video" => "讲解" + ext,
                    "online" or "download" => folderName + ext,
                    _ => Path.GetFileName(rel),
                };
                // 同名冲突（比如在线本体和下载包都是 .html 却是两个不同文件）：后来的保留原名
                if (!usedNames.Add(targetName)) targetName = Path.GetFileName(rel);
                usedNames.Add(targetName);

                var to = $"{folder}/{targetName}";
                if (string.Equals(rel, to, StringComparison.Ordinal)) continue;          // 已经就位
                if (string.Equals(curDir, folder, StringComparison.Ordinal)
                    && string.Equals(Path.GetFileName(rel), targetName, StringComparison.Ordinal)) continue;
                if (!allTargets.Add(to)) {
                    skipped.Add(new { path = rel, reason = $"目标 {to} 与另一条冲突，需人工改名" });
                    continue;
                }
                moves.Add(new { from = rel, to, role });
                moveCount++;
            }

            plans.Add(new {
                toolId = t.Id, name = t.Name, slug = t.Slug,
                currentFolder = t.Folder, folder,
                moves, skipped,
            });
        }

        return Ok(new {
            toolCount = tools.Count,
            moveCount,
            plans,
            note = "这是干跑结果，没有动任何文件。人工核对后把 moves/folders 发给 apply 执行。",
        });

        // 一个工具引用到的文件及其角色
        static IEnumerable<(string rel, string role)> ToolRefs(Tool t) {
            foreach (var r in RefsIn(t.OnlineUrl))  yield return (r, "online");
            if (!string.IsNullOrEmpty(t.DownloadFileName)) {
                var dl = t.DownloadFileName!.Replace('\\','/').TrimStart('/');
                if (!IsExternal(dl)) yield return (dl, "download");
            }
            foreach (var r in RefsIn(t.VideoUrl))   yield return (r, "video");
            foreach (var r in RefsIn(t.ReadmeMarkdown)) yield return (r, "readme");
        }
    }

    // POST /api/admin/tools/organize/apply —— 照单执行
    // 【全部校验通过才开始搬】，搬到一半失败就把已搬的原样退回去，不留半拉子状态。
    // 数据库改写放在文件全部搬完之后：文件没搬成时数据库一个字没动，回退干净。
    [HttpPost("tools/organize/apply")]
    public async Task<IActionResult> OrganizeApply([FromBody] OrganizeApplyDto dto) {
        var root = Path.Combine(env.WebRootPath, "uploads");
        var moves = dto?.Moves ?? Array.Empty<OrganizeMove>();
        var folders = dto?.Folders ?? Array.Empty<OrganizeFolder>();
        if (moves.Length == 0 && folders.Length == 0)
            return BadRequest(new { message = "清单是空的" });

        // ---- 第一遍：全量校验，一条不合格就整体拒绝 ----
        var errors = new List<string>();
        var pairs = new List<(string from, string to, string fromFull, string toFull)>();
        var seenFrom = new HashSet<string>(StringComparer.Ordinal);
        var seenTo   = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var m in moves) {
            var from = NormalizeName(m.From ?? "").Replace('\\','/').Trim('/');
            var to   = NormalizeName(m.To   ?? "").Replace('\\','/').Trim('/');
            if (from.Length == 0 || to.Length == 0) { errors.Add("from/to 不能为空"); continue; }
            if (from == to) continue;

            var toSegs = to.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var bad = false;
            foreach (var s in toSegs)
                if (ValidateSegment(s, "路径") is string e) { errors.Add($"{to}：{e}"); bad = true; break; }
            if (bad) continue;

            if (!TryResolveUnder(root, from, out var fromFull) || !System.IO.File.Exists(fromFull)) {
                // 磁盘上若存的是分解形(NFD)的名字，上面 NormalizeName 转成 NFC 后就对不上了。
                // 报"不存在"没错但看不懂，点出这一层，省得对着肉眼一样的名字发懵
                var hint = Directory.Exists(Path.GetDirectoryName(fromFull) ?? root)
                    && Directory.EnumerateFiles(Path.GetDirectoryName(fromFull) ?? root)
                        .Any(f => Path.GetFileName(f).Normalize(System.Text.NormalizationForm.FormC)
                                  == Path.GetFileName(from))
                    ? "（同目录下有个名字长得一样的文件，疑似 Unicode 编码不一致 NFD/NFC）" : "";
                errors.Add($"{from}：源文件不存在{hint}"); continue;
            }
            if (!TryResolveUnder(root, to, out var toFull)) { errors.Add($"{to}：目标越界"); continue; }
            if (HasSymlinkComponent(root, toFull) || HasSymlinkComponent(root, fromFull)) {
                errors.Add($"{to}：路径里有软链接，拒绝（GetFullPath 不解析软链，能绕出 uploads）"); continue;
            }
            // 【目标存在性按忽略大小写比】。Linux 上 a.html 和 A.html 是两个文件，
            // 放得进去；但这堆文件将来会被打包发给 Windows/mac 用户，在那边就撞成一个
            if (System.IO.File.Exists(toFull) || Directory.Exists(toFull)
                || ExistsIgnoreCase(toFull)) { errors.Add($"{to}：目标已存在（大小写不同也算）"); continue; }
            if (!seenFrom.Add(from)) { errors.Add($"{from}：同一个源文件出现了两次"); continue; }
            if (!seenTo.Add(to))     { errors.Add($"{to}：两条移动指向同一个目标"); continue; }
            pairs.Add((from, to, fromFull, toFull));
        }
        foreach (var f in folders) {
            if (NormalizeRelDir(f.Folder, out _) is string e) errors.Add($"工具#{f.ToolId} 的文件夹：{e}");
            if (!await db.Tools.AnyAsync(t => t.Id == f.ToolId)) errors.Add($"工具#{f.ToolId} 不存在");
        }
        if (errors.Count > 0)
            return BadRequest(new { message = $"清单有 {errors.Count} 处问题，一个都没执行", errors = errors.Take(50) });

        // ---- 第二遍：【先把旧路径映射落库，再动文件】----
        // 顺序是刻意的（灵犀评审第 3 条）：文件还在原处时这些映射行根本命中不了（静态
        // 文件优先），所以提前写没有副作用；而一旦文件搬完、后面的改库步骤失败，
        // 至少这张兜底网已经在了——否则就是「文件走了、库没改、301 表也空」，
        // 110 条引用全断且没有任何兜底。
        var redirectMap = pairs.ToDictionary(p => p.from, p => p.to, StringComparer.Ordinal);
        await RecordRedirectsAsync(redirectMap);
        await SaveAndInvalidateAsync();

        // ---- 第三遍：搬文件。中途失败则原样退回 ----
        var done = new List<(string from, string to, string fromFull, string toFull)>();
        try {
            foreach (var p in pairs) {
                Directory.CreateDirectory(Path.GetDirectoryName(p.toFull)!);
                System.IO.File.Move(p.fromFull, p.toFull);
                done.Add(p);
            }
        } catch (Exception ex) {
            var undoFailed = new List<string>();
            foreach (var p in Enumerable.Reverse(done)) {
                try { System.IO.File.Move(p.toFull, p.fromFull); }
                catch { undoFailed.Add(p.to); }   // 退不回来的必须报出来，不能吞
            }
            // 退回后把刚才预写的映射行也撤掉，别留下指向空路径的死映射。
            // 【删完要清缓存】：不清的话缓存里还留着那几条死行，这个文件将来一改名，
            // 老地址就会 302 到一个空路径（灵犀评审第二轮第 2 条）
            if (undoFailed.Count == 0) {
                db.UploadRedirects.RemoveRange(
                    db.UploadRedirects.Where(r => redirectMap.Keys.Contains(r.OldPath)));
                await SaveAndInvalidateAsync();
            }
            CleanEmptyDirs(root);   // 已经建出来的空目录不留在磁盘上
            return StatusCode(500, new {
                message = $"搬到第 {done.Count + 1} 个时失败：{ex.Message}。数据库引用未改动。",
                rolledBack = done.Count - undoFailed.Count,
                undoFailed,
            });
        }

        // ---- 第四遍：改引用 + 写回归置目录，同一个事务里提交 ----
        // 两件事必须同生共死：只改了引用没写 Folder，下次归置会把文件当"散在外面的"再搬一次
        await using (var tx = await db.Database.BeginTransactionAsync()) {
            await RewriteReferencesBatchAsync(pairs.Select(p => (p.from, p.to)));
            foreach (var f in folders) {
                NormalizeRelDir(f.Folder, out var clean);
                var tool = await db.Tools.FindAsync(f.ToolId);
                if (tool != null) { tool.Folder = string.IsNullOrEmpty(clean) ? null : clean; tool.UpdatedAt = DateTime.UtcNow; }
            }
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        }
        redirectCache.Invalidate();   // 事务提交【之后】再清一次，理由同 SaveAndInvalidateAsync
        CleanEmptyDirs(root);   // 搬空的老目录（zip/ 之类）不留着占位

        // 库里存的是纯文件名、而同名文件不止一处的，改写时会跳过——静默跳过等于埋雷，报出来
        var ambiguous = pairs.Select(p => Path.GetFileName(p.from))
            .GroupBy(n => n, StringComparer.Ordinal).Where(g => g.Count() > 1)
            .Select(g => g.Key).ToList();

        return Ok(new { moved = pairs.Count, folders = folders.Length, ambiguousNames = ambiguous });
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
        // 「需求」这条趋势线的数据源换成订单本身（DevRequests 表已删，
        // 需求单→工单那层转换没有了，网页表单现在直接建 NEW 订单）
        var reqDates = await db.Tickets.Where(t => t.CreatedAt >= weekAgo).Select(t => t.CreatedAt).ToListAsync();
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

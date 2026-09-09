// =====================================================
// Controllers/ToolsController.cs —— 工具公开接口
// 路由前缀：/api/tools
// 职责：工具列表、工具详情（含浏览量统计）、文件下载（含付费校验）、分类列表
// 注意：List 和 Detail 是公开的（不需要登录），Download 需要登录
// =====================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using GoodayTools.Data;
using GoodayTools.Models;
using GoodayTools.Services;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ToolsController(AppDbContext db, IWebHostEnvironment env, SubscriptionService sub) : ControllerBase
{
    // 当前请求者的用户 Id（没登录返回 null）
    private int? MeOrNull() => User.UserIdOrNull();

    // 可见性判定在 Services/ToolVisibility.cs，【全站唯一一份】。
    // 任何按 id/slug 回读工具的地方都必须过它——收藏接口就是因为绕过去，
    // 把全站私有交付物的名字漏了出去（2026-09-09 灵犀评审第 2 条）。
    private IQueryable<Tool> Visible(IQueryable<Tool> q) => q.VisibleTo(User);

    // GET /api/tools?category=效率工具
    // 返回已发布工具列表，可按分类筛选。
    // 带 token 时会连同「自己的私有交付物」一起返回——交付物就长在工具一览里
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? category)
    {
        // 【先取出来存本地变量】：把 MeOrNull() 直接写进 LINQ 表达式，
        // EF 翻不成 SQL（方法调用不在可翻译集合里），运行期才炸
        var me = MeOrNull();
        var q = Visible(db.Tools.Where(t => t.IsPublished));  // 只返回已发布 + 当前身份可见的
        if (!string.IsNullOrEmpty(category)) q = q.Where(t => t.Category == category);
        return Ok(await q.OrderByDescending(t => t.CreatedAt)
            .Select(t => new {
                // Select 只返回需要的字段，减少传输数据量
                t.Id, t.Name, t.Slug, t.Description, t.Category,
                t.IconEmoji, t.IsOnline, t.HasDownload,
                t.DownloadCount, t.ViewCount, t.RequireLogin,
                t.IsPaid, t.Price, t.CreatedAt,
                // 视频讲解：列表只要"有没有"和"多长"，URL 到详情再给
                hasVideo = t.VideoUrl != null && t.VideoUrl != "",
                t.VideoDuration,
                // 卡片上要能一眼看出"这是我的、别人看不见"
                t.Visibility, isMine = t.OwnerUserId != null && t.OwnerUserId == me
            }).ToListAsync());
    }

    // GET /api/tools/:slug
    // 返回工具完整信息，并自动将 viewCount +1
    [HttpGet("{slug}")]
    public async Task<IActionResult> Detail(string slug)
    {
        var tool = await db.Tools.FetchableBy(User).FirstOrDefaultAsync(t => t.Slug == slug);
        // 【不可见就是 404，不是 403】：403 等于告诉外人"这个 slug 存在"，
        // 私有交付物连存在性都不该外泄
        if (tool == null) return NotFound();
        tool.ViewCount++;  // 每次访问详情页计一次浏览量
        await db.SaveChangesAsync();

        var me = MeOrNull();
        return Ok(new {
            tool.Id, tool.Name, tool.Slug, tool.Description, tool.Category, tool.IconEmoji,
            tool.IsOnline, tool.HasDownload, tool.DownloadCount, tool.ViewCount,
            tool.RequireLogin, tool.IsPaid, tool.Price, tool.ReadmeMarkdown,
            tool.VideoSource, tool.VideoDuration, tool.VideoPlayCount,
            tool.Visibility, tool.SourceTicketId, tool.CreatedAt,
            isMine = tool.OwnerUserId != null && tool.OwnerUserId == me,
            // 私有工具的文件【不给真实路径】，给鉴权取文件的接口地址。
            // 真实路径 /uploads/private/... 在静态层是死的，但把它发到前端等于
            // 白白多一处泄露面——外面拿到路径就会去试
            onlineUrl = ServeUrl(tool, tool.OnlineUrl, "online"),
            videoUrl = ServeUrl(tool, tool.VideoUrl, "video"),
        });
    }

    // 放在 uploads/private/ 下的文件一律换成鉴权接口地址；其它原样返回。
    //
    // 【判据是"文件存在哪"，不是"当前可见性"】。第一版按 Visibility 判，
    // 结果客户把交付物切成公开之后，详情返回的是真实路径 /uploads/private/...，
    // 而静态层对这个前缀一律 404 —— 公开之后反而谁都打不开，还顺带把真实路径发了出去。
    // 存储位置不会随一次点击而改变，可见性会，所以该由前者决定怎么送。
    private static string? ServeUrl(Tool t, string? raw, string kind)
    {
        if (string.IsNullOrEmpty(raw)) return raw;
        if (raw.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || raw.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return raw;
        var rel = raw.Replace('\\', '/').TrimStart('/');
        if (!rel.StartsWith("uploads/private/", StringComparison.OrdinalIgnoreCase)
            && !rel.StartsWith("private/", StringComparison.OrdinalIgnoreCase)) return raw;
        return $"/api/tools/{Uri.EscapeDataString(t.Slug)}/{kind}";
    }

    // POST /api/tools/:slug/video-play
    // 视频讲解播放计数 +1。无需登录（讲解本身就是公开的引流内容）。
    // 前端在真正开始播放时才打这一下，不是打开详情就算——否则数字等于浏览量，白记。
    [HttpPost("{slug}/video-play")]
    [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("anon-count")]  // 免登录写库端点必须有闸
    public async Task<IActionResult> VideoPlay(string slug)
    {
        var tool = await db.Tools.FetchableBy(User).FirstOrDefaultAsync(t => t.Slug == slug);
        if (tool == null) return NotFound();
        if (string.IsNullOrEmpty(tool.VideoUrl)) return BadRequest(new { message = "该工具没有视频讲解" });
        tool.VideoPlayCount++;
        await db.SaveChangesAsync();
        return Ok(new { playCount = tool.VideoPlayCount });
    }

    // GET /api/tools/:slug/download
    // 下载工具文件：
    // - RequireLogin=false && IsPaid=false：无需登录可直接下载
    // - RequireLogin=true：需要登录
    // - IsPaid=true：需要登录且已付费（隐含 RequireLogin）
    [HttpGet("{slug}/download")]
    public async Task<IActionResult> Download(string slug)
    {
        // 可见性和下载权限是两件事，但【不可见的连存在都不该知道】，所以先过可见性
        var tool = await db.Tools.FetchableBy(User).FirstOrDefaultAsync(t => t.Slug == slug);
        if (tool == null) return NotFound();
        if (!tool.HasDownload || string.IsNullOrEmpty(tool.DownloadFileName))
            return BadRequest(new { message = "该工具不支持下载" });

        int? userId = null;

        // 需要登录的工具，验证身份
        if (tool.RequireLogin || tool.IsPaid)
        {
            var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(idClaim) || !int.TryParse(idClaim, out var uid))
                return Unauthorized(new { message = "请先登录" });
            userId = uid;
        }
        else
        {
            // 免登录工具：如果携带了有效 token 也记录用户 ID
            var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (int.TryParse(idClaim, out var uid)) userId = uid;
        }

        // 付费工具：检查该用户是否有已激活的购买记录
        if (tool.IsPaid)
        {
            var purchased = await db.ToolPurchases.AnyAsync(p =>
                p.UserId == userId && p.ToolId == tool.Id && p.Status == "activated");
            if (!purchased)
                return StatusCode(402, new {  // 402 Payment Required
                    error = "该工具需要付费下载",
                    toolId = tool.Id,
                    price = tool.Price,
                    needPurchase = true
                });
        }

        // 拼接文件物理路径（wwwroot/uploads/<可能带子目录的相对路径>）。
        // 归置后每个工具的文件都在自己的文件夹里（tools/照片管家Pro/xxx.zip），
        // 所以这里必须按相对路径解析，并【规范化后确认没跑出 uploads】——
        // 这个字段虽然只有管理员能写，但一个 ../../ 就能读到数据库文件。
        var uploadRoot = Path.GetFullPath(Path.Combine(env.WebRootPath, "uploads"));
        var rel = tool.DownloadFileName.Replace('\\', '/').TrimStart('/');
        var fp  = Path.GetFullPath(Path.Combine(uploadRoot, rel.Replace('/', Path.DirectorySeparatorChar)));
        if (!fp.StartsWith(uploadRoot + Path.DirectorySeparatorChar))
            return BadRequest(new { message = "下载路径非法" });
        if (!System.IO.File.Exists(fp))
            return NotFound(new { message = "文件不存在" });

        // 有登录用户时记录下载日志；匿名下载只计数不插记录（UserId 不允许 null）
        if (userId.HasValue)
        {
            db.ToolDownloads.Add(new ToolDownload {
                ToolId = tool.Id, UserId = userId.Value,
                IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString()
            });
        }
        tool.DownloadCount++;
        await db.SaveChangesAsync();

        // 根据文件扩展名设置正确的 Content-Type
        var ct = Path.GetExtension(rel).ToLower() switch {
            ".py"   => "text/x-python",
            ".html" => "text/html",
            ".zip"  => "application/zip",
            // 安卓安装包：给对 MIME 手机浏览器才会下载完直接唤起安装器；
            // 落到 octet-stream 的话有些机型只当普通文件存下来，用户还得自己去文件管理器找
            ".apk"  => "application/vnd.android.package-archive",
            _       => "application/octet-stream"  // 未知类型，触发浏览器下载
        };
        // PhysicalFile：直接返回磁盘文件，第三个参数是下载时的文件名。
        // 【只能给纯文件名】：带上子目录会生成 filename="tools/x/y.zip" 这种
        // Content-Disposition，浏览器各自截取，落到用户硬盘上的名字就不可控了。
        return PhysicalFile(fp, ct, Path.GetFileName(rel));
    }

    // GET /api/tools/:slug/online —— 私有工具的在线版本体（iframe 指向这里）
    // GET /api/tools/:slug/video  —— 私有工具的讲解视频（支持 Range，进度条能拖）
    //
    // 【故意不接受路径参数】。做成 /file/{*path} 那种形式的话，
    // 就要自己防路径穿越、防越权读别的工具的文件；这里路径只从工具自己的字段来，
    // 请求方连"读哪个文件"都决定不了，那条攻击面根本不存在。
    // 代价是私有交付物只能是【单文件网页 + 一个下载包】，多文件网页的相对引用取不到。
    [HttpGet("{slug}/online")]
    public Task<IActionResult> ServeOnline(string slug) => ServeOwn(slug, "online");

    [HttpGet("{slug}/video")]
    public Task<IActionResult> ServeVideo(string slug) => ServeOwn(slug, "video");

    private async Task<IActionResult> ServeOwn(string slug, string kind)
    {
        var tool = await db.Tools.FetchableBy(User).FirstOrDefaultAsync(t => t.Slug == slug);
        if (tool == null) return NotFound();

        // 【这里不再查 RequireLogin / IsPaid】，两个理由：
        //   · private 工具的"谁能看"已经由上面的可见性判定管住了（必须是本人或站长）；
        //   · public 工具的在线版和讲解，全站口径本来就是直接打开——站方公开工具
        //     的 html 就是静态直出的，付费墙一直只挡下载。
        // 加了反而制造出"我把它公开了，别人却打不开"这种自相矛盾（实测踩到）。
        var raw = kind == "video" ? tool.VideoUrl : tool.OnlineUrl;
        if (string.IsNullOrEmpty(raw)) return NotFound();
        if (raw.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || raw.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            return Redirect(raw);       // 外链就跳过去，没什么可保护的

        var uploadRoot = Path.GetFullPath(Path.Combine(env.WebRootPath, "uploads"));
        var rel = Uri.UnescapeDataString(raw.Replace('\\', '/').TrimStart('/'));
        if (rel.StartsWith("uploads/", StringComparison.OrdinalIgnoreCase))
            rel = rel["uploads/".Length..];
        var fp = Path.GetFullPath(Path.Combine(uploadRoot, rel.Replace('/', Path.DirectorySeparatorChar)));
        // 字段是管理员写的，但仍然规范化后确认没跑出 uploads——一个 ../../ 就能读到数据库
        if (!fp.StartsWith(uploadRoot + Path.DirectorySeparatorChar) || !System.IO.File.Exists(fp))
            return NotFound();

        var ct = Path.GetExtension(fp).ToLower() switch {
            ".html" or ".htm" => "text/html; charset=utf-8",
            ".mp4" => "video/mp4",
            ".webm" => "video/webm",
            _ => "application/octet-stream",
        };

        if (ct.StartsWith("text/html")) {
            // 【交付物是 AI 按客户需求生成的代码，需求文本本身就是注入入口】。
            // 它和站点同源、在没有 sandbox 的 iframe 里跑，光靠生成时的正则自检
            // 挡不住混淆过的外带（拼字符串 eval、new Image().src=... 之类）。
            // CSP 把"往外送"这条路堵死：不许发请求、不许提交表单、不许加载外部资源。
            // 【故意仍允许 inline script 和 localStorage】——交付契约就是单文件网页，
            // 计时器、统计都靠它们，禁了等于交付物全废。
            // 真正的终局是把交付物放到独立域名（跨源），等量上来再做。
            Response.Headers.ContentSecurityPolicy =
                "default-src 'self' data: blob:; " +
                "script-src 'unsafe-inline' 'unsafe-eval' 'self'; " +
                "style-src 'unsafe-inline' 'self'; " +
                "img-src 'self' data: blob:; media-src 'self' data: blob:; " +
                "connect-src 'none'; form-action 'none'; frame-src 'none'; " +
                "object-src 'none'; base-uri 'none'";
            Response.Headers["X-Content-Type-Options"] = "nosniff";
        }
        // enableRangeProcessing：视频要能拖进度条，少了它播放器只能从头放
        return PhysicalFile(fp, ct, enableRangeProcessing: true);
    }

    public record VisibilityDto(string Visibility);

    // PUT /api/tools/:slug/visibility —— 交付物的归属人自己切公开/私有
    // 【不需要审核】（大海 2026-09-09 定）：公开就是真公开，和站方工具一视同仁；
    // 站长在后台可以随时把它改回私有或下架。
    [Authorize]
    [HttpPut("{slug}/visibility")]
    public async Task<IActionResult> SetVisibility(string slug, [FromBody] VisibilityDto dto)
    {
        var v = (dto?.Visibility ?? "").Trim().ToLower();
        if (v is not ("public" or "private"))
            return BadRequest(new { message = "可见性只能是 public 或 private" });

        var tool = await db.Tools.FirstOrDefaultAsync(t => t.Slug == slug);
        if (tool == null) return NotFound();
        var me = MeOrNull();
        // 站方工具（没有归属人）不能被谁改可见性；客户只能改自己的那件
        if (tool.OwnerUserId == null || (tool.OwnerUserId != me && !User.IsInRole("admin")))
            return NotFound();      // 同样用 404，不确认它存在

        var was = tool.Visibility;
        tool.Visibility = v;
        tool.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        // 【交付物转公开要让灵犀知道】。私有时那份 AI 生成的代码只在客户自己的
        // 浏览器里跑，出事也只伤他自己；一旦公开，它就会在任何登录用户的同源 iframe 里跑。
        // 不审核是大海定的（客户自己说了算），但"没人知道"和"不审核"是两回事。
        if (was != v && v == "public" && tool.SourceTicketId != null) {
            var lingxi = await db.Users.FirstOrDefaultAsync(u => u.Username == "灵犀");
            var owner = await db.Users.FirstOrDefaultAsync(u => u.Id == tool.OwnerUserId);
            if (lingxi != null) {
                db.PrivateMessages.Add(new PrivateMessage {
                    SenderId = lingxi.Id, SenderUsername = lingxi.Username,
                    ReceiverId = lingxi.Id, ReceiverUsername = lingxi.Username,
                    Content = $"【交付物转公开】{owner?.Username ?? "客户#" + tool.OwnerUserId}"
                              + $" 把工单#{tool.SourceTicketId} 的交付物「{tool.Name}」设成了公开。\n"
                              + $"它现在会在任何登录用户的同源 iframe 里运行。"
                              + $"看一眼没问题就不用管，有问题在后台把 Visibility 改回 private。",
                });
                await db.SaveChangesAsync();
            }
        }
        return Ok(new { visibility = tool.Visibility });
    }

    // GET /api/categories
    // 返回所有分类及每个分类的工具数量
    // 【和列表用同一套可见性】：分类数只统计当前身份看得见的工具。
    // 不这么做就会出现"分类里写着 5 个、点进去只有 4 个"——那种对不上的数字，
    // 用户不会当成权限设计，只会当成网站坏了
    [HttpGet("/api/categories")]
    public async Task<IActionResult> Categories() =>
        Ok(await Visible(db.Tools.Where(t => t.IsPublished))
            .GroupBy(t => t.Category)
            .Select(g => new { name = g.Key, count = g.Count() })
            .ToListAsync());
}

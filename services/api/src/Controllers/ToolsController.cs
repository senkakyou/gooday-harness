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
    // GET /api/tools?category=效率工具
    // 返回已发布工具列表，可按分类筛选
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? category)
    {
        var q = db.Tools.Where(t => t.IsPublished);  // 只返回已发布的
        if (!string.IsNullOrEmpty(category)) q = q.Where(t => t.Category == category);
        return Ok(await q.OrderByDescending(t => t.CreatedAt)
            .Select(t => new {
                // Select 只返回需要的字段，减少传输数据量
                t.Id, t.Name, t.Slug, t.Description, t.Category,
                t.IconEmoji, t.IsOnline, t.HasDownload,
                t.DownloadCount, t.ViewCount, t.RequireLogin,
                t.IsPaid, t.Price, t.CreatedAt
            }).ToListAsync());
    }

    // GET /api/tools/:slug
    // 返回工具完整信息，并自动将 viewCount +1
    [HttpGet("{slug}")]
    public async Task<IActionResult> Detail(string slug)
    {
        var tool = await db.Tools.FirstOrDefaultAsync(t => t.Slug == slug && t.IsPublished);
        if (tool == null) return NotFound();
        tool.ViewCount++;  // 每次访问详情页计一次浏览量
        await db.SaveChangesAsync();
        return Ok(tool);
    }

    // GET /api/tools/:slug/download
    // 下载工具文件：
    // - RequireLogin=false && IsPaid=false：无需登录可直接下载
    // - RequireLogin=true：需要登录
    // - IsPaid=true：需要登录且已付费（隐含 RequireLogin）
    [HttpGet("{slug}/download")]
    public async Task<IActionResult> Download(string slug)
    {
        var tool = await db.Tools.FirstOrDefaultAsync(t => t.Slug == slug && t.IsPublished);
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

        // 拼接文件物理路径（wwwroot/uploads/文件名）
        var fp = Path.Combine(env.WebRootPath, "uploads", tool.DownloadFileName);
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
        var ct = Path.GetExtension(tool.DownloadFileName).ToLower() switch {
            ".py"   => "text/x-python",
            ".html" => "text/html",
            ".zip"  => "application/zip",
            // 安卓安装包：给对 MIME 手机浏览器才会下载完直接唤起安装器；
            // 落到 octet-stream 的话有些机型只当普通文件存下来，用户还得自己去文件管理器找
            ".apk"  => "application/vnd.android.package-archive",
            _       => "application/octet-stream"  // 未知类型，触发浏览器下载
        };
        // PhysicalFile：直接返回磁盘文件，第三个参数是下载时的文件名
        return PhysicalFile(fp, ct, tool.DownloadFileName);
    }

    // GET /api/categories
    // 返回所有分类及每个分类的工具数量
    [HttpGet("/api/categories")]
    public async Task<IActionResult> Categories() =>
        Ok(await db.Tools.Where(t => t.IsPublished)
            .GroupBy(t => t.Category)
            .Select(g => new { name = g.Key, count = g.Count() })
            .ToListAsync());
}

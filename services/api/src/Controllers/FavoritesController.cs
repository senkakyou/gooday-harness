// =====================================================
// Controllers/FavoritesController.cs —— 工具收藏接口
// 路由前缀：/api/favorites    权限：登录用户
//   GET  /api/favorites       当前用户收藏的工具（含完整展示字段）
//   GET  /api/favorites/ids   当前用户收藏的工具 id 集（首页标记星标用）
//   POST /api/favorites/{id}  切换收藏，返回 { favorited }
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
[Route("api/favorites")]
[Authorize]
public class FavoritesController(AppDbContext db) : ControllerBase
{
    private int MyId => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

    // 收藏的工具（仅已发布），按收藏时间倒序
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var myId = MyId;
        // 【必须过可见性】：不过滤的话，别人的私有交付物只要被收藏过一次
        // （或被人遍历 id 收藏），名字和简介就会从这里吐出去。
        // 还有一条非恶意路径：客户公开 → 别人收藏 → 客户改回私有，
        // 不过滤的话它在别人的收藏页里永远还在。
        var items = await db.ToolFavorites
            .Where(f => f.UserId == myId)
            .Join(db.Tools.Where(t => t.IsPublished).VisibleTo(User),
                  f => f.ToolId, t => t.Id,
                  (f, t) => new {
                      t.Id, t.Name, t.Slug, t.Description, t.Category,
                      t.IconEmoji, t.IsOnline, t.HasDownload,
                      t.DownloadCount, t.ViewCount, t.RequireLogin,
                      t.IsPaid, t.Price, t.CreatedAt,
                      FavoritedAt = f.CreatedAt
                  })
            .OrderByDescending(x => x.FavoritedAt)
            .ToListAsync();
        return Ok(items);
    }

    // 收藏的工具 id 列表（轻量，首页标记星标用）
    [HttpGet("ids")]
    public async Task<IActionResult> Ids()
    {
        var myId = MyId;
        return Ok(await db.ToolFavorites.Where(f => f.UserId == myId)
            .Select(f => f.ToolId).ToListAsync());
    }

    // 切换收藏
    [HttpPost("{toolId:int}")]
    public async Task<IActionResult> Toggle(int toolId)
    {
        var myId = MyId;
        // 同样过可见性：不然任何登录用户遍历 id 收藏一遍，就能拿到全站私有工具的清单。
        // 不可见时报「工具不存在」而不是「无权限」——后者等于确认这个 id 存在
        if (!await db.Tools.Where(t => t.IsPublished).VisibleTo(User).AnyAsync(t => t.Id == toolId))
            return NotFound(new { message = "工具不存在" });

        var fav = await db.ToolFavorites.FirstOrDefaultAsync(f => f.UserId == myId && f.ToolId == toolId);
        if (fav != null) {
            db.ToolFavorites.Remove(fav);
            await db.SaveChangesAsync();
            return Ok(new { favorited = false });
        }
        db.ToolFavorites.Add(new ToolFavorite { UserId = myId, ToolId = toolId });
        await db.SaveChangesAsync();
        return Ok(new { favorited = true });
    }
}

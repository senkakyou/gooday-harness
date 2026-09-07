// =====================================================
// Controllers/SecondhandController.cs —— 二手交易接口
// 路由前缀：/api/secondhand
// 职责：物品列表（分页+筛选）、详情、发布、编辑、删除、标记已售、图片上传
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/secondhand")]
public class SecondhandController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    int CurrentUserId => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
    bool IsAdmin => User.IsInRole("admin");

    // GET /api/secondhand?page=1&category=&keyword=&status=available
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? category = null,
        [FromQuery] string? keyword = null,
        [FromQuery] string? condition = null,
        [FromQuery] string sort = "new",
        [FromQuery] string status = "available")
    {
        pageSize = Math.Clamp(pageSize, 10, 50);
        var q = db.SecondhandItems.AsQueryable();

        if (!string.IsNullOrWhiteSpace(status) && status != "all")
            q = q.Where(i => i.Status == status);
        if (!string.IsNullOrWhiteSpace(category) && category != "全部")
            q = q.Where(i => i.Category == category);
        if (!string.IsNullOrWhiteSpace(condition) && condition != "全部")
            q = q.Where(i => i.Condition == condition);
        if (!string.IsNullOrWhiteSpace(keyword))
            q = q.Where(i => i.Title.Contains(keyword) || i.Description.Contains(keyword));

        q = sort switch {
            "priceAsc" => q.OrderBy(i => i.Price),
            "priceDesc" => q.OrderByDescending(i => i.Price),
            _ => q.OrderByDescending(i => i.CreatedAt)
        };

        var total = await q.CountAsync();
        var items = await q
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(i => new {
                i.Id, i.Title, i.Price, i.OriginalPrice, i.Images, i.Category,
                i.Condition, i.Status, i.Location, i.ViewCount, i.CreatedAt,
                seller = new { i.Seller.Id, i.Seller.Username }
            })
            .ToListAsync();

        return Ok(new { total, page, pageSize, items });
    }

    // GET /api/secondhand/{id}
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var item = await db.SecondhandItems
            .Include(i => i.Seller)
            .FirstOrDefaultAsync(i => i.Id == id);
        if (item == null) return NotFound(new { message = "商品不存在" });

        item.ViewCount++;
        await db.SaveChangesAsync();

        return Ok(new {
            item.Id, item.Title, item.Description, item.Price, item.OriginalPrice, item.Images,
            item.Category, item.Condition, item.Status, item.Location,
            item.ViewCount, item.CreatedAt, item.UpdatedAt,
            seller = new { item.Seller.Id, item.Seller.Username }
        });
    }

    public record ItemReq(string Title, string Description, decimal Price,
        decimal? OriginalPrice, string Images, string Category, string Condition, string Location);

    // POST /api/secondhand
    [Authorize]
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ItemReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Title) || req.Title.Length < 2)
            return BadRequest(new { message = "标题至少2个字" });
        if (req.Price < 0)
            return BadRequest(new { message = "价格不能为负数" });

        var item = new SecondhandItem {
            Title = req.Title.Trim(),
            Description = req.Description ?? "",
            Price = req.Price,
            OriginalPrice = req.OriginalPrice > 0 ? req.OriginalPrice : null,
            Images = req.Images ?? "[]",
            Category = req.Category ?? "其他",
            Condition = req.Condition ?? "几乎全新",
            Location = req.Location ?? "",
            SellerId = CurrentUserId,
            CreatedAt = DateTime.UtcNow
        };
        db.SecondhandItems.Add(item);
        await db.SaveChangesAsync();
        return Ok(new { id = item.Id });
    }

    // PUT /api/secondhand/{id}
    [Authorize]
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] ItemReq req)
    {
        var item = await db.SecondhandItems.FindAsync(id);
        if (item == null) return NotFound(new { message = "商品不存在" });
        if (item.SellerId != CurrentUserId && !IsAdmin) return Forbid();

        item.Title = req.Title.Trim();
        item.Description = req.Description ?? "";
        item.Price = req.Price;
        item.OriginalPrice = req.OriginalPrice > 0 ? req.OriginalPrice : null;
        item.Images = req.Images ?? "[]";
        item.Category = req.Category ?? "其他";
        item.Condition = req.Condition ?? "几乎全新";
        item.Location = req.Location ?? "";
        item.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok();
    }

    // POST /api/secondhand/{id}/sold
    [Authorize]
    [HttpPost("{id:int}/sold")]
    public async Task<IActionResult> MarkSold(int id)
    {
        var item = await db.SecondhandItems.FindAsync(id);
        if (item == null) return NotFound(new { message = "商品不存在" });
        if (item.SellerId != CurrentUserId && !IsAdmin) return Forbid();

        item.Status = "sold";
        item.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok();
    }

    // DELETE /api/secondhand/{id}
    [Authorize]
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var item = await db.SecondhandItems.FindAsync(id);
        if (item == null) return NotFound(new { message = "商品不存在" });
        if (item.SellerId != CurrentUserId && !IsAdmin) return Forbid();

        db.SecondhandItems.Remove(item);
        await db.SaveChangesAsync();
        return Ok();
    }

    // POST /api/secondhand/upload
    [Authorize]
    [HttpPost("upload")]
    [RequestSizeLimit(30L * 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "请选择文件" });

        var ext = Path.GetExtension(file.FileName).ToLower();
        var allowed = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        if (!allowed.Contains(ext))
            return BadRequest(new { message = "只支持图片格式" });
        if (file.Length > 30L * 1024 * 1024)
            return BadRequest(new { message = "图片最大30MB" });

        var dir = Path.Combine(env.WebRootPath, "uploads", "secondhand");
        Directory.CreateDirectory(dir);
        var fileName = $"{Guid.NewGuid()}{ext}";
        using var stream = System.IO.File.Create(Path.Combine(dir, fileName));
        await file.CopyToAsync(stream);

        return Ok(new { url = $"/uploads/secondhand/{fileName}" });
    }
}

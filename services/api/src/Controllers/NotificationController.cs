using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using System.Security.Claims;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/notifications")]
[Authorize]
public class NotificationController(AppDbContext db) : ControllerBase {
    int Uid => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int page = 1) {
        const int size = 20;
        var items = await db.Notifications.Where(n => n.UserId == Uid)
            .OrderByDescending(n => n.CreatedAt)
            .Skip((page - 1) * size).Take(size)
            .Select(n => new { n.Id, n.Type, n.Title, n.Body, n.LinkUrl, n.IsRead, n.CreatedAt })
            .ToListAsync();
        return Ok(items);
    }

    [HttpGet("unread-count")]
    public async Task<IActionResult> Unread() =>
        Ok(new { count = await db.Notifications.CountAsync(n => n.UserId == Uid && !n.IsRead) });

    [HttpPost("{id}/read")]
    public async Task<IActionResult> Read(int id) {
        var n = await db.Notifications.FirstOrDefaultAsync(x => x.Id == id && x.UserId == Uid);
        if (n == null) return NotFound();
        if (!n.IsRead) { n.IsRead = true; n.ReadAt = DateTime.UtcNow; await db.SaveChangesAsync(); }
        return Ok();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> ReadAll() {
        var list = await db.Notifications.Where(n => n.UserId == Uid && !n.IsRead).ToListAsync();
        var now = DateTime.UtcNow;
        foreach (var n in list) { n.IsRead = true; n.ReadAt = now; }
        await db.SaveChangesAsync();
        return Ok(new { updated = list.Count });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id) {
        var n = await db.Notifications.FirstOrDefaultAsync(x => x.Id == id && x.UserId == Uid);
        if (n == null) return NotFound();
        db.Notifications.Remove(n);
        await db.SaveChangesAsync();
        return Ok();
    }
}

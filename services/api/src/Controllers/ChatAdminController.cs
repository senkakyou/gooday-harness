// Controllers/ChatAdminController.cs —— 留言板管理（admin）
// DELETE /api/admin/chat  → 清空全部公开留言

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/admin/chat")]
[Authorize(Roles = "admin")]
public class ChatAdminController(AppDbContext db) : ControllerBase
{
    [HttpDelete]
    public async Task<IActionResult> ClearAll()
    {
        var count = await db.ChatMessages.CountAsync();
        await db.ChatMessages.ExecuteDeleteAsync();
        return Ok(new { message = $"已清空 {count} 条留言" });
    }
}

// =====================================================
// Controllers/PublicSettingsController.cs —— 公开设置查询（无需登录）
// 路由前缀：/api/settings
// 仅暴露前端展示所需的非敏感开关，不返回财务/审批等内部配置。
// =====================================================

using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/settings")]
public class PublicSettingsController(AppDbContext db) : ControllerBase
{
    // GET /api/settings/ruyi-contact
    // 返回如意直接会话开关状态和用户 ID，供首页「联系如意」入口使用
    [HttpGet("ruyi-contact")]
    public async Task<IActionResult> GetRuyiContact()
    {
        var directChat = await db.SystemSettings
            .Where(s => s.Key == "Ruyi.DirectChat")
            .Select(s => s.Value)
            .FirstOrDefaultAsync() == "true";

        var ruyiUser = await db.Users
            .Where(u => u.Username == "如意" && u.IsActive)
            .Select(u => new { u.Id, u.Username, u.AvatarUrl })
            .FirstOrDefaultAsync();

        var chatBoxEnabled = await db.SystemSettings
            .Where(s => s.Key == "ChatBox.Enabled")
            .Select(s => s.Value)
            .FirstOrDefaultAsync() != "false";   // 默认 true（未设置 = 显示）

        return Ok(new {
            directChat,
            ruyiUserId    = ruyiUser?.Id,
            ruyiUsername  = ruyiUser?.Username,
            ruyiAvatar    = ruyiUser?.AvatarUrl,
            chatBoxEnabled,
        });
    }

    // GET /api/settings/modules
    // 返回各首页模块的显示开关（站长在后台控制）。键 Module.{name}.Enabled，
    // value=="false" 才隐藏，未设置/其它 = 显示（默认全开）。
    static readonly string[] ModuleNames = { "requests", "forum", "courses", "audiobooks", "games", "secondhand", "invest" };

    [HttpGet("modules")]
    public async Task<IActionResult> GetModules()
    {
        var off = await db.SystemSettings
            .Where(s => s.Key.StartsWith("Module.") && s.Key.EndsWith(".Enabled") && s.Value == "false")
            .Select(s => s.Key).ToListAsync();
        var result = ModuleNames.ToDictionary(n => n, n => !off.Contains($"Module.{n}.Enabled"));
        return Ok(result);   // 形如 { requests:true, forum:true, courses:true, audiobooks:true, games:true, secondhand:true }
    }
}

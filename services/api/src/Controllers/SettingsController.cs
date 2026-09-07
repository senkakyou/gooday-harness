// =====================================================
// Controllers/SettingsController.cs —— 系统配置接口（admin）
// 路由前缀：/api/admin/settings
// 职责：读写运行期开关/阈值。首个用途「小额自动放行」（docs/v3/12）。
//   GET  /api/admin/settings           → 全部配置（含 AutoApprove 默认值）
//   PUT  /api/admin/settings/{key}     → 设置单个键（body: { value })
// 招财 bot 也读这些配置决定是否自动放行；写入仅限 admin。
// =====================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/admin/settings")]
[Authorize(Roles = "admin")]
public class SettingsController(AppDbContext db) : ControllerBase
{
    // 小额自动放行默认值（首周 Enabled=false 影子观察，确认无误再开）
    private static readonly Dictionary<string, string> Defaults = new()
    {
        ["AutoApprove.Enabled"]         = "false",
        ["AutoApprove.Limit"]           = "1000",
        ["AutoApprove.DailyCap"]        = "3000",
        ["AutoApprove.PerCustomerDaily"] = "1",
    };

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var rows = await db.SystemSettings.ToListAsync();
        var map = rows.ToDictionary(r => r.Key, r => r.Value);
        // 合并默认值（未显式设置的键返回默认）
        var merged = new Dictionary<string, string>(Defaults);
        foreach (var kv in map) merged[kv.Key] = kv.Value;
        return Ok(merged);
    }

    public record PutReq(string Value);

    [HttpPut("{key}")]
    public async Task<IActionResult> Put(string key, [FromBody] PutReq req)
    {
        if (string.IsNullOrWhiteSpace(key))
            return BadRequest(new { message = "key 不能为空" });
        var s = await db.SystemSettings.FirstOrDefaultAsync(x => x.Key == key);
        if (s == null)
        {
            s = new SystemSetting { Key = key, Value = req.Value ?? "", UpdatedAt = DateTime.UtcNow };
            db.SystemSettings.Add(s);
        }
        else
        {
            s.Value = req.Value ?? "";
            s.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();
        return Ok(new { key = s.Key, value = s.Value });
    }
}

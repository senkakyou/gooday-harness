// =====================================================
// Controllers/SettingsController.cs —— 系统配置接口（admin）
// 路由前缀：/api/admin/settings
// 职责：读写运行期开关/阈值。
// ⚠️ 原注释写「首个用途小额自动放行（docs/v3/12）」—— AutoApprove 已于 2026-09-11
//    删除，docs/v3/ 也是旧系统的文档目录、本仓库里不存在。
//    【这个控制器差点被当成 AutoApprove 专用而一起删掉】：它实际还承载着
//    Ruyi.DirectChat、ChatBox.Enabled、首页模块开关、模型选择四样，
//    删了会连带打断三个不相干的功能。
//   GET  /api/admin/settings           → 全部配置
//   PUT  /api/admin/settings/{key}     → 设置单个键（body: { value })
// 读写都仅限 admin。（原注释写「招财 bot 也读这些配置决定是否自动放行」——
// 招财已于 2026-09-11 退役，那条自动放行的链路整个不存在了。）
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
    // ═══ AutoApprove 的默认值字典已删（2026-09-11）═══════════════════
    //
    //   2026-09-10 删「小额自动放行」时，我删了库里那 4 行、删了前端的审批页，
    //   **却漏了这里**——而 GetAll 每次都把 Defaults 合并进返回值，
    //   于是那 4 个键被【凭空重新造出来】，接口照旧对外宣称这个开关存在。
    //
    //   「删了数据 ≠ 删了那个概念」：只要还有一处在生成默认值，
    //   它就还活着，而且活在一个没人知道的地方。
    //   （2026-09-11 清理旧信息时 grep 到的，不是测试抓到的——
    //    没有任何判据在查「接口返回的键是不是都还有意义」。）

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        // 【没有默认值可合】：本表里的键全部靠显式写入，没写过就是没有。
        var rows = await db.SystemSettings.ToListAsync();
        return Ok(rows.ToDictionary(r => r.Key, r => r.Value));
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

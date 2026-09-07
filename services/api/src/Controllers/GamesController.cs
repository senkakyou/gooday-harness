// =====================================================
// Controllers/GamesController.cs —— 游戏档案接口
// 路由前缀：/api/games
// 职责：获取玩家战绩档案、上报对局结果（胜/负）并更新积分
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/games")]
public class GamesController(AppDbContext db) : ControllerBase
{
    [HttpGet("profile")]
    [Authorize]
    public IActionResult GetProfile()
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var row = db.Database
            .SqlQuery<GameProfileRow>(
                $"SELECT UserId, Level, WinCount, LossCount FROM GameProfiles WHERE UserId={userId}")
            .AsEnumerable()
            .FirstOrDefault();

        if (row == null)
            return Ok(new { level = 1, winCount = 0, lossCount = 0 });

        return Ok(new { level = row.Level, winCount = row.WinCount, lossCount = row.LossCount });
    }

    [HttpPost("record")]
    [Authorize]
    public IActionResult RecordResult([FromBody] RecordRequest req)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var now = DateTime.UtcNow.ToString("o");

        var exists = db.Database
            .SqlQuery<int>($"SELECT COUNT(*) AS Value FROM GameProfiles WHERE UserId={userId}")
            .AsEnumerable().First() > 0;

        if (!exists)
        {
            db.Database.ExecuteSql(
                $"INSERT INTO GameProfiles (UserId, Level, WinCount, LossCount, UpdatedAt) VALUES ({userId}, 1, 0, 0, {now})");
        }

        if (req.Won)
        {
            db.Database.ExecuteSql(
                $"UPDATE GameProfiles SET WinCount=WinCount+1, Level=MIN(10, 1+(WinCount+1)/3), UpdatedAt={now} WHERE UserId={userId}");
        }
        else
        {
            db.Database.ExecuteSql(
                $"UPDATE GameProfiles SET LossCount=LossCount+1, UpdatedAt={now} WHERE UserId={userId}");
        }

        // ExecuteSql(FormattableString) 自动参数化——GameType/Mode 是用户可控字符串,
        // 旧 ExecuteSqlRaw 字符串拼接是真 SQL 注入口(2026-07-14 全站审查修复)
        db.Database.ExecuteSql(
            $"INSERT INTO GameRecords (GameType, Mode, PlayerId, Won, CreatedAt) VALUES ({req.GameType}, {req.Mode}, {userId}, {(req.Won ? 1 : 0)}, {now})");

        return Ok();
    }
}

public class GameProfileRow
{
    public int UserId { get; set; }
    public int Level { get; set; }
    public int WinCount { get; set; }
    public int LossCount { get; set; }
}

public class RecordRequest
{
    public string GameType { get; set; } = "gomoku";
    public string Mode { get; set; } = "pvp";
    public bool Won { get; set; }
}

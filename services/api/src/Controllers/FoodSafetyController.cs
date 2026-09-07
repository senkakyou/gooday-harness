// =====================================================
// Controllers/FoodSafetyController.cs —— 食品安全检查接口
// 路由前缀：/api/food-safety
// 职责：按日期保存/读取食品安全检查记录，每用户每日唯一
// =====================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;
using GoodayTools.Data;
using GoodayTools.Models;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/food-safety")]
[Authorize]
public class FoodSafetyController(AppDbContext db) : ControllerBase
{
    public record SaveRecordDto(string Date, string DataJson);

    private int UserId => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
    private string Username => User.FindFirst(ClaimTypes.Name)!.Value;

    // GET /api/food-safety/records
    [HttpGet("records")]
    public async Task<IActionResult> GetRecords()
    {
        if (Username != "qianky") return Forbid();
        var records = await db.FoodSafetyRecords
            .Where(r => r.UserId == UserId)
            .OrderByDescending(r => r.RecordDate)
            .ToListAsync();
        var dict = records.ToDictionary(
            r => r.RecordDate,
            r => (object)JsonSerializer.Deserialize<JsonElement>(r.DataJson)
        );
        return Ok(dict);
    }

    // POST /api/food-safety/records
    [HttpPost("records")]
    public async Task<IActionResult> SaveRecord([FromBody] SaveRecordDto dto)
    {
        if (Username != "qianky") return Forbid();
        var existing = await db.FoodSafetyRecords
            .FirstOrDefaultAsync(r => r.UserId == UserId && r.RecordDate == dto.Date);
        if (existing != null) {
            existing.DataJson = dto.DataJson;
            existing.UpdatedAt = DateTime.UtcNow;
        } else {
            db.FoodSafetyRecords.Add(new FoodSafetyRecord {
                UserId = UserId,
                RecordDate = dto.Date,
                DataJson = dto.DataJson,
                UpdatedAt = DateTime.UtcNow,
            });
        }
        await db.SaveChangesAsync();
        return Ok(new { message = "保存成功" });
    }

    // DELETE /api/food-safety/records/{date}
    [HttpDelete("records/{date}")]
    public async Task<IActionResult> DeleteRecord(string date)
    {
        if (Username != "qianky") return Forbid();
        var record = await db.FoodSafetyRecords
            .FirstOrDefaultAsync(r => r.UserId == UserId && r.RecordDate == date);
        if (record == null) return NotFound();
        db.FoodSafetyRecords.Remove(record);
        await db.SaveChangesAsync();
        return Ok(new { message = "删除成功" });
    }

    // DELETE /api/food-safety/records  (清空全部)
    [HttpDelete("records")]
    public async Task<IActionResult> DeleteAllRecords()
    {
        if (Username != "qianky") return Forbid();
        var records = await db.FoodSafetyRecords
            .Where(r => r.UserId == UserId)
            .ToListAsync();
        db.FoodSafetyRecords.RemoveRange(records);
        await db.SaveChangesAsync();
        return Ok(new { message = "全部记录已清除" });
    }
}

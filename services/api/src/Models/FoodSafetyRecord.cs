// =====================================================
// Models/FoodSafetyRecord.cs —— 食品安全检查记录数据模型
// 对应数据库 FoodSafetyRecords 表
// 数据库层通过复合唯一索引 (UserId, RecordDate) 保证每用户每日唯一
// =====================================================

namespace GoodayTools.Models;
public class FoodSafetyRecord {
    public int Id { get; set; }
    public int UserId { get; set; }
    public string RecordDate { get; set; } = "";   // 日期字符串，格式：yyyy-MM-dd
    public string DataJson { get; set; } = "";     // 检查项数据（JSON 格式，由前端序列化/反序列化）
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// =====================================================
// Models/SecondhandItem.cs —— 二手物品数据模型
// 对应数据库 SecondhandItems 表
// =====================================================

namespace GoodayTools.Models;

public class SecondhandItem
{
    public int Id { get; set; }
    public string Title { get; set; } = "";             // 物品标题
    public string Description { get; set; } = "";       // 详细描述
    public decimal Price { get; set; }                   // 售价（元）
    public decimal? OriginalPrice { get; set; }          // 原价（划线价，可空；> Price 时前端显示折扣）
    public string Images { get; set; } = "[]";          // 图片 URL 列表（JSON 数组字符串）
    public string Category { get; set; } = "其他";      // 物品分类
    public string Condition { get; set; } = "几乎全新"; // 成色：几乎全新 | 轻微使用 | 明显使用
    public string Status { get; set; } = "available";   // available | sold（已售出自动下架）
    public int SellerId { get; set; }
    public User Seller { get; set; } = null!;           // 卖家（导航属性）
    public string Location { get; set; } = "";          // 所在地
    public int ViewCount { get; set; } = 0;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

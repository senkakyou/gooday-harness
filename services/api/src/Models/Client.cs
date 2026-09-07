// =====================================================
// Models/Client.cs —— 客户档案数据模型
// 对应数据库 Clients 表
// 职责：沉淀定制开发业务的客户信息、偏好画像、合作历史
// 联动：Tickets（一对多）、Users（可选注册账号绑定）
// =====================================================

namespace GoodayTools.Models;
public class Client
{
    public int Id { get; set; }

    // 关联注册账号（游客客户为 null）
    public int? UserId { get; set; }
    public User? User { get; set; }

    // 基本信息
    public string Name { get; set; } = "";
    public string Contact { get; set; } = "";                 // 微信号/手机/邮箱
    public string ContactType { get; set; } = "wechat";       // wechat | phone | email
    public string Source { get; set; } = "admin";             // ruyi | admin | form
    // prospect=潜在 | active=合作中 | vip=VIP | inactive=已流失
    public string Status { get; set; } = "prospect";
    public string? Tags { get; set; }                         // 逗号分隔，如"小程序,急单"

    // ---- 偏好画像（人工/AI 填写）----
    public string? PreferredContact { get; set; }             // 偏好沟通方式
    public string? Budget { get; set; }                       // 预算区间，如"500-2000"
    // fast=爽快拍板 | slow=需反复确认 | committee=要请示领导
    public string? DecisionStyle { get; set; }
    // none=完全不懂 | basic=基础认知 | medium=中等 | pro=专业
    public string? TechLevel { get; set; }
    public string? PreferredStyle { get; set; }               // 沟通风格偏好

    // ---- AI 生成客户画像摘要 ----
    public string? AiSummary { get; set; }                    // Claude 基于历史生成
    public DateTime? AiSummaryUpdatedAt { get; set; }

    // ---- 内部备注 ----
    public string? AdminNote { get; set; }                    // 站长手工备注，AI 不覆盖

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastActiveAt { get; set; } = DateTime.UtcNow;  // 每次新工单自动更新
}

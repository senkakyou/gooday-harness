// =====================================================
// Models/DevRequest.cs —— 定制需求数据模型
// 对应数据库 DevRequests 表
// =====================================================

namespace GoodayTools.Models;
public class DevRequest
{
    public int Id { get; set; }
    public string Name { get; set; } = "";          // 提交者称呼
    public string Contact { get; set; } = "";       // 联系账号（微信号/邮箱/手机号）
    public string ContactType { get; set; } = "wechat"; // 联系方式类型："wechat"|"email"|"phone"
    public string Title { get; set; } = "";         // 需求标题（一句话描述）
    public string Description { get; set; } = "";   // 详细需求描述
    public string? Budget { get; set; }             // 预算范围（可选，如"200-500"）

    // 状态流转：pending → talking → done / rejected
    public string Status { get; set; } = "pending"; // "pending"|"talking"|"done"|"rejected"
    public string? AdminNote { get; set; }          // 管理员内部备注（用户不可见）
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // 登录用户提交时关联账户（匿名提交时为 null）
    public int? UserId { get; set; }
    public User? User { get; set; }
}

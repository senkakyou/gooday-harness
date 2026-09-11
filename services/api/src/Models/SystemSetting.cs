// =====================================================
// Models/SystemSetting.cs —— 系统配置（Key-Value）
// 对应数据库 SystemSettings 表
// 职责：后台可调的运行期开关/阈值。
// 现用键：Ruyi.DirectChat（如意是否可被普通用户搜到）、ChatBox.Enabled（留言板）、
//        首页各模块显示开关、各角色的模型选择。
// ⚠️ 原注释写「首个用途是小额自动放行（docs/v3/12）」：那套 AutoApprove 已于
//    2026-09-10/11 整个删除（每单大海亲自拍板，自动放行没有意义），
//    而 docs/v3/ 是【旧系统】的文档目录，本仓库里从来没有它。
//    删的时候漏了 SettingsController 里的默认值字典，那 4 个键被每次 GET
//    凭空重新造出来——2026-09-11 才清掉。【删了数据 ≠ 删了那个概念】。

namespace GoodayTools.Models;

public class SystemSetting
{
    public int Id { get; set; }
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public string? Note { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

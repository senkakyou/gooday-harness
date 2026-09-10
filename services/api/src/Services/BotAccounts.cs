// =====================================================
// Services/BotAccounts.cs —— 内部角色账号名单（【全仓唯一一份】）
//
// ═══ 为什么把它抽出来 ═══════════════════════════════════════════════
//
//   这份名单原来在三个 Controller 里【各写一份】：
//     FriendsController.cs        private static readonly HashSet<string> _privateAccounts
//     PrivateMessageController.cs private static readonly HashSet<string> _privateAccounts
//     AuthController.cs           var privateAccounts   ← 局部变量，连名字都不一样
//
//   而且第三处写法不对称：查 `_privateAccounts` 的正则找不到它。
//   2026-09-10 删掉擎天柱/威震天/招财时正是这一处差点漏改——
//   **漏改的后果是「已退役的号还能被普通用户搜到并加好友」**，
//   而那三个号背后是有 shell 权限或客户数据的角色。
//
//   这不是洁癖：三份副本意味着「删一个角色」这个动作有三个地方要记得改，
//   而 policies G03 单一真源存在的理由就是「要求人记得」的设计迟早失效。
// ═══════════════════════════════════════════════════════════════════
// =====================================================

namespace GoodayTools.Services;

public static class BotAccounts
{
    /// <summary>
    /// 内部角色：不出现在好友搜索里、不接受普通用户主动私信。
    ///
    /// 2026-09-10 起只剩两个（docs/decisions/006）：
    ///   灵犀 —— 质量门禁 + 内部运维，有 Bash/Read 等工具权限
    ///   如意 —— 唯一对外窗口，零工具
    /// 擎天柱(21) / 威震天(22) / 招财(25) 已退役，账号保留但不再是内部角色。
    /// </summary>
    public static readonly IReadOnlySet<string> Private =
        new HashSet<string> { "灵犀", "如意" };

    /// <summary>
    /// 用户搜索时要藏起来的名单 = 内部角色 + 站长本人。
    /// 【比 Private 多一个 admin】——这是搜索专有的口径，不是笔误：
    /// 站长不该出现在普通用户的搜索结果里，但他显然不是"内部 bot"。
    /// 两个口径分开命名，免得下次有人把它们"统一"掉。
    /// </summary>
    public static HashSet<string> HiddenInSearch() =>
        new(Private) { "admin" };
}

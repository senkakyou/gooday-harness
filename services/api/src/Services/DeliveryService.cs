// =====================================================
// Services/DeliveryService.cs —— 定制需求的交付：三样齐了才算交付
//
// 大海定的口径（docs/decisions/005）：
//   · 交付物直接进工具一览，默认只有提需求的人看得见；
//   · **在线、视频、下载三样全**，少一样不算交付；
//   · 他不介入——灵犀上架、如意通知客户。
//
// 【"交付完成"的判定只写这一处】。上架端点用它，工单结单闸门也用它。
// 两处各写一套的下场，站上现成的例子就是：结单闸门原本查的是
// 「发给客户的私信里含 deliverables 这个词」——只要私信里出现过这个词就算交付了。
// =====================================================

using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;
namespace GoodayTools.Services;

public record DeliveryStatus(bool Complete, string[] Missing)
{
    public string Why => Complete ? "三样齐全" : string.Join("、", Missing);
}

public class DeliveryService(AppDbContext db, IWebHostEnvironment env)
{
    /// 交付物在磁盘上的根：uploads/private/<工单号>/。静态层对这个前缀一律 404。
    public string PrivateDirFor(string ticketNo) => $"private/{ticketNo}";

    private bool FileExists(string? rel)
    {
        if (string.IsNullOrWhiteSpace(rel)) return false;
        var root = Path.GetFullPath(Path.Combine(env.WebRootPath, "uploads"));
        var r = rel.Replace('\\', '/').TrimStart('/');
        if (r.StartsWith("uploads/", StringComparison.OrdinalIgnoreCase)) r = r["uploads/".Length..];
        var full = Path.GetFullPath(Path.Combine(root, r.Replace('/', Path.DirectorySeparatorChar)));
        return full.StartsWith(root + Path.DirectorySeparatorChar) && File.Exists(full);
    }

    /// <summary>
    /// 检查一件交付物是否"三样齐全"。
    /// 【查文件是否真在磁盘上，不只看字段有没有填】——字段填了文件没传，
    /// 客户点开就是 404，而后台看起来一切正常。
    /// </summary>
    public DeliveryStatus Check(Tool t)
    {
        var missing = new List<string>();
        if (t.OwnerUserId is null) missing.Add("没有归属人（交付物必须挂在客户名下）");
        if (!t.IsOnline || !FileExists(t.OnlineUrl)) missing.Add("在线版缺失");
        if (!t.HasDownload || !FileExists(t.DownloadFileName)) missing.Add("下载包缺失");
        // 视频允许外链（B站等），外链只校验字段非空——文件不在我们这儿，没法验
        var videoOk = !string.IsNullOrWhiteSpace(t.VideoUrl)
            && (t.VideoSource == "link" || FileExists(t.VideoUrl));
        if (!videoOk) missing.Add("视频讲解缺失");
        return new DeliveryStatus(missing.Count == 0, missing.ToArray());
    }

    /// <summary>某张订单的交付物（一张订单只认一件）。</summary>
    public Task<Tool?> ForTicketAsync(int ticketId)
        => db.Tools.FirstOrDefaultAsync(t => t.SourceTicketId == ticketId);

    /// <summary>
    /// 能不能放行给客户验收：必须有交付物、归属客户本人、已发布、且三样齐全。
    /// 返回 null 表示可以放行，否则返回拦下来的原因。
    ///
    /// ⚠️ 【ClientId 的语义 2026-09-10 变了】（docs/decisions/006）：
    ///    以前 Tickets.ClientId 指 Users.Id，可以直接和 Tools.OwnerUserId 比；
    ///    现在它指 Clients.Id（与 FinanceRecords 对齐），**必须先换算成 UserId**。
    ///
    ///    这里是本次重构最容易改错的一处：少了这一步换算，
    ///    `tool.OwnerUserId != t.ClientId` 比的是「用户 ID」和「客户档案 ID」，
    ///    两个都是小整数，撞上就静默判等 ——
    ///    **把别人的交付物判给这个客户，而且看起来一切正常。**
    /// </summary>
    public async Task<string?> BlockReleaseReasonAsync(Ticket t)
    {
        var tool = await ForTicketAsync(t.Id);
        if (tool == null)
            return "交付不达标：工具一览里没有这张订单的交付物（交付=上架一件归属客户的工具）";

        // ═══ 没关联客户档案 = 整条归属校验不执行（2026-09-10 灵犀复审 ①）═══
        //
        //   下面两条判据都挂在 ClientId 非空上：ClientId 为 null 时
        //   `clientUserId != null` 假、`t.ClientId != null` 也假，
        //   **两条全被跳过**，直接落到「已发布 + 三样齐」就放行了。
        //
        //   而【匿名网页表单建的单恒为 ClientId = null】——那是主拉新入口。
        //   AdminController 的 deliver 端点有一道「没客户档案就 400」的硬闸，
        //   但它不是唯一入口：admin 可以直接 POST /api/admin/tools 自带
        //   SourceTicketId + OwnerUserId，ForTicketAsync 照样认它是本单交付物。
        //   **两处入口口径不一致，宽的那处就是实际口径。**
        if (t.ClientId == null)
            return "交付不达标：这张订单没有关联客户档案（网页表单进来的单默认没有），"
                 + "交付物挂不到具体的人，不能放行。先在订单里绑定客户。";

        // Tickets.ClientId → Clients.Id → Clients.UserId → 才能和 Tools.OwnerUserId 比
        int? clientUserId = await db.Clients.Where(c => c.Id == t.ClientId)
                                            .Select(c => c.UserId).FirstOrDefaultAsync();

        if (clientUserId != null && tool.OwnerUserId != clientUserId)
            return $"交付不达标：交付物挂在用户#{tool.OwnerUserId} 名下，"
                 + $"不是本单客户（客户档案#{t.ClientId} → 用户#{clientUserId}）";

        // 客户档案存在但没绑账号（线下客户）：交付物挂不到谁名下，不能自动放行
        if (clientUserId == null)
            return $"交付不达标：客户档案#{t.ClientId} 没有绑定平台账号，交付物挂不到他名下";

        if (!tool.IsPublished)
            return "交付不达标：交付物还没发布，客户看不到";

        var st = Check(tool);
        return st.Complete ? null : $"交付不达标：{st.Why}（大海定的口径是在线、视频、下载三样全）";
    }

    /// <summary>
    /// 通知客户。【由如意发】——她是唯一对客户可见的角色，
    /// 交付这种事从别的号发出去，客户会以为是钓鱼。
    /// 文案是固定模板不是模型生成：交付通知说错一句，客户就白跑一趟。
    /// 幂等：同一件交付物只通知一次。
    /// </summary>
    public async Task<bool> NotifyCustomerAsync(Tool tool, Ticket ticket)
    {
        if (tool.OwnerUserId is not int uid) return false;
        var link = $"/?tool={tool.Slug}";
        // 【幂等标记用工具 Id，不用 slug】。slug 是从工单号派生的，
        // 工单删掉后当天新建的工单会拿到同一个号 → 同一个 slug →
        // 新交付撞上旧消息，通知被"幂等"掉，客户永远收不到（自检时踩到）。
        // Id 是自增主键，不会重复。
        var marker = $"[交付单#{tool.Id}]";

        // 已经通知过就不再发（灵犀会反复调上架端点直到三样齐，这里必须幂等）。
        // 【私信和站内通知各查各的】：只查私信的话，私信一旦被删（人工清理、
        // 客户自己删），下一次调用就会再插一条通知——实测留下过两条重复通知。
        var msgSent = await db.PrivateMessages.AnyAsync(m => m.ReceiverId == uid && m.Content.Contains(marker));
        var noteSent = await db.Notifications.AnyAsync(n => n.UserId == uid && n.LinkUrl == link);
        if (msgSent || noteSent) return false;

        var ruyi = await db.Users.FirstOrDefaultAsync(u => u.Username == "如意");
        var me = await db.Users.FirstOrDefaultAsync(u => u.Id == uid);
        if (ruyi == null || me == null) return false;

        db.PrivateMessages.Add(new PrivateMessage {
            SenderId = ruyi.Id, SenderUsername = ruyi.Username,
            ReceiverId = uid, ReceiverUsername = me.Username,
            Content =
                $"{marker}\n你的定制需求「{ticket.Title}」做好了 🎉\n\n" +
                $"东西已经放进你的工具一览里，名字是「{tool.Name}」——" +
                $"打开首页搜一下就能看到，三样都齐：\n" +
                $"· 在线使用：不用装，点开就能用\n" +
                $"· 视频讲解：一男一女两个人讲怎么用，看完就会\n" +
                $"· 下载：想放到自己电脑上离线用就下这个\n\n" +
                $"🔒 现在它**只有你看得见**。如果你愿意让别人也用，" +
                $"在工具详情页点「公开它」就行，随时能改回来。\n\n" +
                $"有哪里不对、或者想再改，直接回我。",
        });
        db.Notifications.Add(new Notification {
            UserId = uid, Type = "request",
            Title = "你的定制需求交付了", Body = $"「{tool.Name}」已放进你的工具一览，只有你可见",
            LinkUrl = link,
        });
        await db.SaveChangesAsync();
        return true;
    }
}

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

    /// <summary>某张工单的交付物（一张工单只认一件）。</summary>
    public Task<Tool?> ForTicketAsync(int ticketId)
        => db.Tools.FirstOrDefaultAsync(t => t.SourceTicketId == ticketId);

    /// <summary>
    /// 工单能不能结单：必须有交付物、归属客户本人、且三样齐全。
    /// 返回 null 表示可以结，否则返回拦下来的原因。
    /// </summary>
    public async Task<string?> BlockDoneReasonAsync(Ticket t)
    {
        var tool = await ForTicketAsync(t.Id);
        if (tool == null)
            return "交付不达标：工具一览里没有这张工单的交付物（交付=上架一件归属客户的工具）";
        if (t.ClientId != null && tool.OwnerUserId != t.ClientId)
            return $"交付不达标：交付物挂在用户#{tool.OwnerUserId} 名下，不是本单客户#{t.ClientId}";
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

        // 已经通知过就不再发（灵犀会反复调上架端点直到三样齐，这里必须幂等）
        if (await db.PrivateMessages.AnyAsync(m => m.ReceiverId == uid && m.Content.Contains(marker)))
            return false;

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

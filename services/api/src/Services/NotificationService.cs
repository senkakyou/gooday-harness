using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Hubs;
using GoodayTools.Models;

namespace GoodayTools.Services;

// 站内通知：写库 + 通过 SignalR（复用 ChatHub）实时推给目标用户
public class NotificationService(AppDbContext db, IHubContext<ChatHub> hub) {

    public async Task Notify(int userId, string type, string title, string body, string? linkUrl = null) {
        var n = new Notification {
            UserId = userId, Type = type, Title = title, Body = body, LinkUrl = linkUrl, CreatedAt = DateTime.UtcNow
        };
        db.Notifications.Add(n);
        await db.SaveChangesAsync();
        await hub.Clients.User(userId.ToString()).SendAsync("Notification",
            new { n.Id, n.Type, n.Title, n.Body, n.LinkUrl, n.IsRead, n.CreatedAt });
        await PushUnread(userId);
    }

    // 广播公告：给所有启用的用户各写一条（当前用户量级直接扇出）
    public async Task<int> Broadcast(string type, string title, string body, string? linkUrl = null) {
        var userIds = await db.Users.Where(u => u.IsActive).Select(u => u.Id).ToListAsync();
        var now = DateTime.UtcNow;
        db.Notifications.AddRange(userIds.Select(uid => new Notification {
            UserId = uid, Type = type, Title = title, Body = body, LinkUrl = linkUrl, CreatedAt = now
        }));
        await db.SaveChangesAsync();
        foreach (var uid in userIds) {
            await hub.Clients.User(uid.ToString()).SendAsync("Notification", new { type, title, body, linkUrl });
            await PushUnread(uid);
        }
        return userIds.Count;
    }

    async Task PushUnread(int userId) {
        var count = await db.Notifications.CountAsync(n => n.UserId == userId && !n.IsRead);
        await hub.Clients.User(userId.ToString()).SendAsync("NotificationUnread", count);
    }
}

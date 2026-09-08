// =====================================================
// Hubs/ChatHub.cs —— 全站公开聊天 SignalR Hub
// WebSocket 端点：/hubs/chat
// 职责：连接时推送历史消息；登录用户发消息后广播给所有在线连接
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;

namespace GoodayTools.Hubs;

public class ChatHub(AppDbContext db) : Hub
{
    // 客户端连接时，向已登录用户推送最近 50 条历史消息（未登录不下发）
    public override async Task OnConnectedAsync()
    {
        if (Context.User?.Identity?.IsAuthenticated == true)
        {
            var history = await db.ChatMessages
                .OrderByDescending(m => m.CreatedAt)
                .Take(50)
                .OrderBy(m => m.CreatedAt)
                .Select(m => new { m.Id, m.UserId, m.Username, m.Content, m.CreatedAt })
                .ToListAsync();

            await Clients.Caller.SendAsync("History", history);
        }
        await base.OnConnectedAsync();
    }

    // 发送消息（需登录）
    [Authorize]
    public async Task SendMessage(string content)
    {
        // (content ?? "")：SignalR 从线上反序列化时 content 可能是 null，
        // 而 <Nullable>enable</Nullable> 只是编译期标注，运行期拦不住。
        // 原来是先 content.Trim() 再 IsNullOrEmpty —— null 会在 Trim 那行就抛 NRE，
        // **于是 IsNullOrEmpty 里的 Null 那一半永远到不了，是死代码**。
        // （形状同 math-episodes 的 SPEC_DIR 双重赋值：前一句让后一句的一半失效。）
        // 空格那一半没问题：Trim 在判定之前，纯空格会变成空串被抓住。
        // —— 2026-09-08 灵犀评审指出
        content = (content ?? "").Trim();
        if (string.IsNullOrEmpty(content) || content.Length > 500) return;

        var userId = int.Parse(Context.User!.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var username = Context.User!.FindFirst(ClaimTypes.Name)!.Value;

        var msg = new ChatMessage {
            UserId = userId,
            Username = username,
            Content = content,
            CreatedAt = DateTime.UtcNow
        };
        db.ChatMessages.Add(msg);
        await db.SaveChangesAsync();

        // 广播给所有在线客户端
        await Clients.All.SendAsync("ReceiveMessage", new {
            msg.Id, msg.UserId, msg.Username, msg.Content, msg.CreatedAt
        });
    }
}

// =====================================================
// Controllers/PrivateMessageController.cs —— 私信接口
// 路由前缀：/api/messages
// 职责：获取会话列表、拉取历史消息（分页）、发送消息、上传媒体、标记已读、查询未读数
// 权限：全部需要登录（[Authorize] 标注在类上）
// =====================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using GoodayTools.Data;
using GoodayTools.Hubs;
using GoodayTools.Models;
using GoodayTools.Services;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/messages")]
[Authorize]
public class PrivateMessageController(AppDbContext db, IHubContext<ChatHub> hub, IWebHostEnvironment env) : ControllerBase
{

    private int MyId => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
    private string MyName => User.FindFirst(ClaimTypes.Name)!.Value;

    public record SendDto(string? Content, string? MediaUrl, string? MediaType, string? MediaName, long? MediaSize);

    // GET /api/messages/conversations
    [HttpGet("conversations")]
    public async Task<IActionResult> GetConversations()
    {
        var myId = MyId;
        var hiddenIds = await db.ConversationHides
            .Where(h => h.UserId == myId)
            .Select(h => h.OtherUserId)
            .ToListAsync();

        var msgs = await db.PrivateMessages
            .Where(m => (m.SenderId == myId || m.ReceiverId == myId)
                        && !hiddenIds.Contains(m.SenderId == myId ? m.ReceiverId : m.SenderId))
            .ToListAsync();

        if (!User.IsInRole("admin"))
        {
            var privateIds = await db.Users
                .Where(u => BotAccounts.Private.Contains(u.Username))
                .Select(u => u.Id)
                .ToListAsync();
            // 如意例外：如意主动发起的消息保留；DirectChat 开启时任意如意消息可见
            var ruyiId = await db.Users.Where(u => u.Username == "如意").Select(u => (int?)u.Id).FirstOrDefaultAsync();
            bool ruyiDirect = await db.SystemSettings.Where(s => s.Key == "Ruyi.DirectChat").Select(s => s.Value).FirstOrDefaultAsync() == "true";
            msgs = msgs.Where(m =>
                (!privateIds.Contains(m.SenderId) && !privateIds.Contains(m.ReceiverId)) ||
                (ruyiId.HasValue && (m.SenderId == ruyiId.Value || (ruyiDirect && m.ReceiverId == ruyiId.Value)) && (m.ReceiverId == myId || m.SenderId == myId))
            ).ToList();
        }

        var convs = msgs
            .GroupBy(m => m.SenderId == myId ? m.ReceiverId : m.SenderId)
            .Select(g => {
                var last = g.OrderByDescending(m => m.CreatedAt).First();
                var unread = g.Count(m => m.ReceiverId == myId && !m.IsRead);
                var otherId = g.Key;
                var lastMsg = !string.IsNullOrEmpty(last.Content) ? last.Content
                    : last.MediaType == "image" ? "[图片]"
                    : last.MediaType == "audio" ? "[语音]"
                    : last.MediaType == "file"  ? $"[文件] {last.MediaName}"
                    : "";
                return new {
                    userId = otherId,
                    username = last.SenderId == myId ? last.ReceiverUsername : last.SenderUsername,
                    avatarUrl = last.SenderId == myId ? (string?)null : last.SenderAvatar,
                    lastMessage = lastMsg,
                    lastAt = last.CreatedAt,
                    unread
                };
            })
            .OrderByDescending(c => c.lastAt)
            .ToList();

        return Ok(convs);
    }

    // DELETE /api/messages/conversations/{userId} —— 隐藏会话（消息保留，仅从列表移除）
    [HttpDelete("conversations/{userId:int}")]
    public async Task<IActionResult> HideConversation(int userId)
    {
        var myId = MyId;
        var exists = await db.ConversationHides
            .AnyAsync(h => h.UserId == myId && h.OtherUserId == userId);
        if (!exists)
        {
            db.ConversationHides.Add(new ConversationHide { UserId = myId, OtherUserId = userId });
            await db.SaveChangesAsync();
        }
        return NoContent();
    }

    // DELETE /api/messages/conversations/{userId}/messages —— 清空与某用户的全部聊天记录
    [HttpDelete("conversations/{userId:int}/messages")]
    public async Task<IActionResult> ClearConversationMessages(int userId)
    {
        var myId = MyId;
        var msgs = await db.PrivateMessages
            .Where(m => (m.SenderId == myId && m.ReceiverId == userId) ||
                        (m.SenderId == userId && m.ReceiverId == myId))
            .ToListAsync();
        // 删除关联的媒体文件
        var chatMediaDir = Path.Combine(env.WebRootPath, "chat-media");
        foreach (var m in msgs)
        {
            if (!string.IsNullOrEmpty(m.MediaUrl))
            {
                var fileName = Path.GetFileName(m.MediaUrl);
                var filePath = Path.Combine(chatMediaDir, fileName);
                if (System.IO.File.Exists(filePath))
                    System.IO.File.Delete(filePath);
            }
        }
        db.PrivateMessages.RemoveRange(msgs);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // GET /api/messages/{userId}
    [HttpGet("{userId:int}")]
    public async Task<IActionResult> GetMessages(int userId, [FromQuery] int page = 1)
    {
        var myId = MyId;
        var other = await db.Users.FindAsync(userId);
        if (other != null && BotAccounts.Private.Contains(other.Username) && !User.IsInRole("admin"))
        {
            // 如意例外：开关开启时任意用户可查看；否则仅如意主动联系过的用户可查看
            bool ruyiDirectChat = other.Username == "如意" &&
                await db.SystemSettings.Where(s => s.Key == "Ruyi.DirectChat").Select(s => s.Value).FirstOrDefaultAsync() == "true";
            bool ruyiInitiated = other.Username == "如意" &&
                await db.PrivateMessages.AnyAsync(m => m.SenderId == other.Id && m.ReceiverId == myId);
            if (!ruyiDirectChat && !ruyiInitiated)
                return StatusCode(403, new { message = "无权限查看此会话" });
        }
        var msgs = await db.PrivateMessages
            .Where(m => (m.SenderId == myId && m.ReceiverId == userId) ||
                        (m.SenderId == userId && m.ReceiverId == myId))
            .OrderByDescending(m => m.CreatedAt)
            .Skip((page - 1) * 50)
            .Take(50)
            .OrderBy(m => m.CreatedAt)
            .ToListAsync();

        // 标记已读
        var unread = await db.PrivateMessages
            .Where(m => m.SenderId == userId && m.ReceiverId == myId && !m.IsRead)
            .ToListAsync();
        foreach (var m in unread) m.IsRead = true;
        if (unread.Count > 0) await db.SaveChangesAsync();

        return Ok(msgs.Select(m => new {
            m.Id, m.SenderId, m.SenderUsername, m.SenderAvatar,
            m.ReceiverId, m.ReceiverUsername, m.Content, m.CreatedAt, m.IsRead,
            m.MediaUrl, m.MediaType, m.MediaName, m.MediaSize
        }));
    }

    // POST /api/messages/upload —— 上传私信附件（图片/文件，≤20MB）
    [HttpPost("upload")]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "文件为空" });
        if (file.Length > 20 * 1024 * 1024) return BadRequest(new { message = "文件不能超过 20MB" });

        var orig = Path.GetFileName(file.FileName);
        var ext  = Path.GetExtension(orig).ToLower();

        var allowed = new HashSet<string> { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".zip", ".txt", ".doc", ".docx", ".xls", ".xlsx", ".mp4", ".mp3", ".webm", ".ogg", ".m4a", ".wav" };
        if (!allowed.Contains(ext)) return BadRequest(new { message = "不支持的文件类型" });

        var dir = Path.Combine(env.WebRootPath, "chat-media");
        Directory.CreateDirectory(dir);
        var fn   = $"{Guid.NewGuid():N}{ext}";

        using var s = System.IO.File.Create(Path.Combine(dir, fn));
        await file.CopyToAsync(s);

        var isImage = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" }.Contains(ext);
        var isAudio = new[] { ".mp3", ".webm", ".ogg", ".m4a", ".wav" }.Contains(ext);
        return Ok(new {
            url      = $"/chat-media/{fn}",
            type     = isImage ? "image" : isAudio ? "audio" : "file",
            name     = orig,
            size     = file.Length
        });
    }

    // POST /api/messages/{userId}
    [HttpPost("{userId:int}")]
    public async Task<IActionResult> Send(int userId, SendDto dto)
    {
        var content  = dto.Content?.Trim() ?? "";
        var hasMedia = !string.IsNullOrEmpty(dto.MediaUrl);
        if (!hasMedia && (string.IsNullOrEmpty(content) || content.Length > 4000))
            return BadRequest(new { message = "消息内容无效" });

        var receiver = await db.Users.FindAsync(userId);
        if (receiver == null) return NotFound(new { message = "用户不存在" });

        var myId = MyId;

        if (BotAccounts.Private.Contains(receiver.Username) && !User.IsInRole("admin"))
        {
            // Bot 间通信例外：私有账号之间可以互发消息（如意→擎天柱等）
            bool isBotSender = BotAccounts.Private.Contains(MyName);
            if (!isBotSender)
            {
                // 如意开关：Ruyi.DirectChat=true 时任意用户可主动联系如意；
                // 否则仅如意主动发起过会话的用户可回复（永不超时）。
                bool ruyiDirectChat = receiver.Username == "如意" &&
                    await db.SystemSettings.Where(s => s.Key == "Ruyi.DirectChat").Select(s => s.Value).FirstOrDefaultAsync() == "true";
                bool ruyiInitiated = receiver.Username == "如意" &&
                    await db.PrivateMessages.AnyAsync(m => m.SenderId == receiver.Id && m.ReceiverId == myId);
                if (!ruyiDirectChat && !ruyiInitiated)
                    return StatusCode(403, new { message = "无权限向此用户发送消息" });
            }
        }

        var me = await db.Users.FindAsync(myId);

        var msg = new PrivateMessage {
            SenderId = myId,
            SenderUsername = MyName,
            SenderAvatar = me?.AvatarUrl,
            ReceiverId = userId,
            ReceiverUsername = receiver.Username,
            Content = content,
            CreatedAt = DateTime.UtcNow,
            MediaUrl = dto.MediaUrl,
            MediaType = dto.MediaType,
            MediaName = dto.MediaName,
            MediaSize = dto.MediaSize,
        };
        db.PrivateMessages.Add(msg);

        // 收到新消息时自动取消接收方对发送方的隐藏，以便重新显示会话
        var hide = await db.ConversationHides
            .FirstOrDefaultAsync(h => h.UserId == userId && h.OtherUserId == myId);
        if (hide != null) db.ConversationHides.Remove(hide);

        await db.SaveChangesAsync();

        var payload = new {
            msg.Id, msg.SenderId, msg.SenderUsername, msg.SenderAvatar,
            msg.ReceiverId, msg.ReceiverUsername, msg.Content, msg.CreatedAt,
            msg.MediaUrl, msg.MediaType, msg.MediaName, msg.MediaSize
        };

        // 实时推送给接收方和发送方的所有连接
        await hub.Clients.User(userId.ToString()).SendAsync("PrivateMessage", payload);
        await hub.Clients.User(myId.ToString()).SendAsync("PrivateMessage", payload);

        return Ok(payload);
    }

    // DELETE /api/messages/{messageId} —— 删除单条私信（发送方或接收方均可删）
    [HttpDelete("{messageId:int}")]
    public async Task<IActionResult> DeleteMessage(int messageId)
    {
        var myId = MyId;
        var msg = await db.PrivateMessages.FindAsync(messageId);
        if (msg == null) return NotFound(new { message = "消息不存在" });
        if (msg.SenderId != myId && msg.ReceiverId != myId) return Forbid();
        // 删除关联的媒体文件
        if (!string.IsNullOrEmpty(msg.MediaUrl))
        {
            var chatMediaDir = Path.Combine(env.WebRootPath, "chat-media");
            var fileName = Path.GetFileName(msg.MediaUrl);
            var filePath = Path.Combine(chatMediaDir, fileName);
            if (System.IO.File.Exists(filePath))
                System.IO.File.Delete(filePath);
        }
        db.PrivateMessages.Remove(msg);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // GET /api/messages/unread-count
    [HttpGet("unread-count")]
    public async Task<IActionResult> UnreadCount()
    {
        var myId = MyId;
        var count = await db.PrivateMessages.CountAsync(m => m.ReceiverId == myId && !m.IsRead);
        return Ok(new { count });
    }
}

// =====================================================
// Controllers/FriendsController.cs —— 好友关系接口
// 路由前缀：/api/friends
// 职责：查询好友列表、发送/同意/拒绝好友申请、删除好友、查询关系状态
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
[Route("api/friends")]
[Authorize]
public class FriendsController(AppDbContext db, IHubContext<ChatHub> hub) : ControllerBase
{

    private int MyId => int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
    private string MyName => User.FindFirst(ClaimTypes.Name)!.Value;

    // GET /api/friends —— 获取我的好友列表（含备注、好友成为时间）
    [HttpGet]
    public async Task<IActionResult> GetFriends()
    {
        var myId = MyId;
        var friendships = await db.Friendships
            .Where(f => (f.RequesterId == myId || f.AddresseeId == myId) && f.Status == "accepted")
            .Include(f => f.Requester)
            .Include(f => f.Addressee)
            .ToListAsync();

        var friends = friendships.Select(f => {
            var friend = f.RequesterId == myId ? f.Addressee : f.Requester;
            var remark  = f.RequesterId == myId ? f.RequesterRemark : f.AddresseeRemark;
            return new { friend.Id, friend.Username, friend.AvatarUrl, remark, friendSince = f.UpdatedAt };
        }).ToList();

        return Ok(friends);
    }

    // PUT /api/friends/{userId}/remark —— 设置对某好友的备注
    [HttpPut("{userId:int}/remark")]
    public async Task<IActionResult> SetRemark(int userId, [FromBody] RemarkDto dto)
    {
        var myId = MyId;
        var f = await db.Friendships.FirstOrDefaultAsync(f =>
            ((f.RequesterId == myId && f.AddresseeId == userId) ||
             (f.RequesterId == userId && f.AddresseeId == myId)) &&
            f.Status == "accepted");
        if (f == null) return NotFound(new { message = "好友关系不存在" });

        if (f.RequesterId == myId) f.RequesterRemark = dto.Remark?.Trim();
        else f.AddresseeRemark = dto.Remark?.Trim();

        await db.SaveChangesAsync();
        return NoContent();
    }

    public record RemarkDto(string? Remark);

    // GET /api/friends/requests —— 收到的待处理好友请求
    [HttpGet("requests")]
    public async Task<IActionResult> GetRequests()
    {
        var myId = MyId;
        var requests = await db.Friendships
            .Where(f => f.AddresseeId == myId && f.Status == "pending")
            .Include(f => f.Requester)
            .Select(f => new {
                f.Id, f.RequesterId,
                username = f.Requester.Username,
                avatarUrl = f.Requester.AvatarUrl,
                f.CreatedAt
            })
            .ToListAsync();
        return Ok(requests);
    }

    // GET /api/friends/status/{userId} —— 查询与某用户的关系状态
    [HttpGet("status/{userId:int}")]
    public async Task<IActionResult> GetStatus(int userId)
    {
        var myId = MyId;
        var f = await db.Friendships.FirstOrDefaultAsync(f =>
            (f.RequesterId == myId && f.AddresseeId == userId) ||
            (f.RequesterId == userId && f.AddresseeId == myId));

        if (f == null) return Ok(new { status = "none" });
        return Ok(new {
            status = f.Status,
            isSentByMe = f.RequesterId == myId
        });
    }

    // POST /api/friends/request/{userId} —— 发送好友申请
    [HttpPost("request/{userId:int}")]
    public async Task<IActionResult> SendRequest(int userId)
    {
        var myId = MyId;
        if (myId == userId) return BadRequest(new { message = "不能添加自己为好友" });

        var target = await db.Users.FindAsync(userId);
        if (target == null || !target.IsActive) return NotFound(new { message = "用户不存在" });

        if (BotAccounts.Private.Contains(target.Username) && !User.IsInRole("admin"))
            return StatusCode(403, new { message = "无权限添加此用户为好友" });

        var existing = await db.Friendships.FirstOrDefaultAsync(f =>
            (f.RequesterId == myId && f.AddresseeId == userId) ||
            (f.RequesterId == userId && f.AddresseeId == myId));

        if (existing != null) {
            if (existing.Status == "accepted") return BadRequest(new { message = "已经是好友了" });
            if (existing.Status == "pending" && existing.RequesterId == myId)
                return BadRequest(new { message = "已发送过申请，等待对方确认" });
            if (existing.Status == "pending" && existing.AddresseeId == myId)
                return BadRequest(new { message = "对方已向你发送了好友申请，请前往处理" });
            // declined → 允许重新申请
            existing.Status = "pending";
            existing.RequesterId = myId;
            existing.AddresseeId = userId;
            existing.UpdatedAt = DateTime.UtcNow;
        } else {
            db.Friendships.Add(new Friendship {
                RequesterId = myId,
                AddresseeId = userId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            });
        }
        await db.SaveChangesAsync();

        await hub.Clients.User(userId.ToString()).SendAsync("FriendRequest", new {
            fromId = myId, fromUsername = MyName
        });

        return Ok(new { message = "好友申请已发送" });
    }

    // POST /api/friends/accept/{userId} —— 接受好友申请
    [HttpPost("accept/{userId:int}")]
    public async Task<IActionResult> AcceptRequest(int userId)
    {
        var myId = MyId;
        var req = await db.Friendships.FirstOrDefaultAsync(f =>
            f.RequesterId == userId && f.AddresseeId == myId && f.Status == "pending");
        if (req == null) return NotFound(new { message = "申请不存在" });

        var requester = await db.Users.FindAsync(userId);
        if (requester != null && BotAccounts.Private.Contains(requester.Username) && !User.IsInRole("admin"))
            return StatusCode(403, new { message = "无权限接受此好友申请" });

        req.Status = "accepted";
        req.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        await hub.Clients.User(userId.ToString()).SendAsync("FriendAccepted", new {
            byId = myId, byUsername = MyName
        });

        return Ok(new { message = "已接受好友申请" });
    }

    // POST /api/friends/decline/{userId} —— 拒绝好友申请
    [HttpPost("decline/{userId:int}")]
    public async Task<IActionResult> DeclineRequest(int userId)
    {
        var myId = MyId;
        var req = await db.Friendships.FirstOrDefaultAsync(f =>
            f.RequesterId == userId && f.AddresseeId == myId && f.Status == "pending");
        if (req == null) return NotFound(new { message = "申请不存在" });

        req.Status = "declined";
        req.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok();
    }

    // DELETE /api/friends/{userId} —— 删除好友
    [HttpDelete("{userId:int}")]
    public async Task<IActionResult> RemoveFriend(int userId)
    {
        var myId = MyId;
        var friendship = await db.Friendships.FirstOrDefaultAsync(f =>
            ((f.RequesterId == myId && f.AddresseeId == userId) ||
             (f.RequesterId == userId && f.AddresseeId == myId)) &&
            f.Status == "accepted");
        if (friendship == null) return NotFound(new { message = "好友关系不存在" });

        db.Friendships.Remove(friendship);
        await db.SaveChangesAsync();
        return Ok();
    }
}

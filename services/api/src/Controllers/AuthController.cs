// =====================================================
// Controllers/AuthController.cs —— 用户认证接口
// 路由前缀：/api/auth
// 职责：注册、登录、修改密码、读写个人资料、上传头像、搜索用户
// =====================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using GoodayTools.Data;
using GoodayTools.Models;
using GoodayTools.Services;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController(AppDbContext db, TokenService ts, IWebHostEnvironment env) : ControllerBase
{
    public record RegisterDto(string Username, string? Email, string Password, string? Phone, string? Address);
    public record LoginDto(string UsernameOrEmail, string Password);
    public record ChangePasswordDto(string OldPassword, string NewPassword);
    public record UpdateProfileDto(string? Phone, string? Address, string? Email);

    // POST /api/auth/register
    [HttpPost("register")]
    [EnableRateLimiting("register")]
    public async Task<IActionResult> Register(RegisterDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Username) || dto.Username.Length < 2)
            return BadRequest(new { message = "用户名至少2个字符" });
        if (dto.Password.Length < 6)
            return BadRequest(new { message = "密码至少6位" });
        if (!string.IsNullOrEmpty(dto.Email) && !dto.Email.Contains('@'))
            return BadRequest(new { message = "邮箱格式不正确" });

        if (await db.Users.AnyAsync(u => u.Username == dto.Username))
            return BadRequest(new { message = "用户名已存在" });
        if (!string.IsNullOrEmpty(dto.Email) && await db.Users.AnyAsync(u => u.Email == dto.Email))
            return BadRequest(new { message = "该邮箱已注册" });

        var user = new User {
            Username = dto.Username,
            Email = string.IsNullOrEmpty(dto.Email) ? null : dto.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password),
            Role = "member",
            Phone = dto.Phone,
            Address = dto.Address,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        return Ok(new {
            token = ts.GenerateToken(user),
            username = user.Username,
            role = user.Role,
            userId = user.Id,
            avatarUrl = user.AvatarUrl
        });
    }

    // POST /api/auth/login
    [HttpPost("login")]
    [EnableRateLimiting("login")]
    public async Task<IActionResult> Login(LoginDto dto)
    {
        var input = dto.UsernameOrEmail?.Trim() ?? "";
        // 先按邮箱查，再按用户名查
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == input)
                ?? await db.Users.FirstOrDefaultAsync(u => u.Username == input);

        if (user == null || !BCrypt.Net.BCrypt.Verify(dto.Password, user.PasswordHash))
            return Unauthorized(new { message = "用户名/邮箱或密码错误" });
        if (!user.IsActive)
            return Unauthorized(new { message = "账号已被禁用" });

        user.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new {
            token = ts.GenerateToken(user),
            username = user.Username,
            role = user.Role,
            userId = user.Id,
            avatarUrl = user.AvatarUrl
        });
    }

    // POST /api/auth/change-password
    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordDto dto)
    {
        if (dto.NewPassword.Length < 6)
            return BadRequest(new { message = "新密码至少6位" });

        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var user = await db.Users.FindAsync(userId);
        if (user == null) return NotFound();

        if (!BCrypt.Net.BCrypt.Verify(dto.OldPassword, user.PasswordHash))
            return BadRequest(new { message = "当前密码错误" });

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword);
        user.TokenVersion++;                 // 使所有旧 token 失效（含其它设备）
        await db.SaveChangesAsync();
        // 给当前会话签发新 token，避免改密码后自己被登出
        return Ok(new { message = "密码修改成功", token = ts.GenerateToken(user) });
    }

    // GET /api/auth/profile
    [Authorize]
    [HttpGet("profile")]
    public async Task<IActionResult> GetProfile()
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var user = await db.Users.FindAsync(userId);
        if (user == null) return NotFound();
        return Ok(new {
            user.Id, user.Username, user.Email, user.Phone, user.Address,
            user.AvatarUrl, user.Role, user.CreatedAt, user.SubscriptionStatus
        });
    }

    // PUT /api/auth/profile
    [Authorize]
    [HttpPut("profile")]
    public async Task<IActionResult> UpdateProfile(UpdateProfileDto dto)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var user = await db.Users.FindAsync(userId);
        if (user == null) return NotFound();

        if (!string.IsNullOrEmpty(dto.Email) && dto.Email != user.Email) {
            if (!dto.Email.Contains('@')) return BadRequest(new { message = "邮箱格式不正确" });
            if (await db.Users.AnyAsync(u => u.Email == dto.Email && u.Id != userId))
                return BadRequest(new { message = "该邮箱已被使用" });
            user.Email = dto.Email;
        } else if (dto.Email == "") {
            user.Email = null;
        }

        user.Phone = string.IsNullOrEmpty(dto.Phone) ? null : dto.Phone;
        user.Address = string.IsNullOrEmpty(dto.Address) ? null : dto.Address;
        await db.SaveChangesAsync();

        return Ok(new {
            user.Id, user.Username, user.Email, user.Phone, user.Address, user.AvatarUrl
        });
    }

    // POST /api/auth/avatar
    [Authorize]
    [HttpPost("avatar")]
    public async Task<IActionResult> UploadAvatar(IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "请选择文件" });
        if (file.Length > 2 * 1024 * 1024) return BadRequest(new { message = "头像不能超过2MB" });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext is not (".jpg" or ".jpeg" or ".png" or ".gif" or ".webp"))
            return BadRequest(new { message = "仅支持 jpg/png/gif/webp 格式" });

        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var user = await db.Users.FindAsync(userId);
        if (user == null) return NotFound();

        var dir = Path.Combine(env.WebRootPath, "avatars");
        Directory.CreateDirectory(dir);

        // 删除旧头像
        if (!string.IsNullOrEmpty(user.AvatarUrl)) {
            var old = Path.Combine(env.WebRootPath, user.AvatarUrl.TrimStart('/'));
            if (System.IO.File.Exists(old)) System.IO.File.Delete(old);
        }

        var fileName = $"{userId}_{DateTime.UtcNow:yyyyMMddHHmmss}{ext}";
        var path = Path.Combine(dir, fileName);
        using (var stream = System.IO.File.Create(path))
            await file.CopyToAsync(stream);

        user.AvatarUrl = $"/avatars/{fileName}";
        await db.SaveChangesAsync();

        return Ok(new { avatarUrl = user.AvatarUrl });
    }

    // GET /api/auth/users/search?q=xxx  -- 搜索用户（私信对话时用）
    [Authorize]
    [HttpGet("users/search")]
    public async Task<IActionResult> SearchUsers([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 1) return Ok(new List<object>());
        var myId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var isAdmin = User.IsInRole("admin");
        var privateAccounts = new HashSet<string> { "灵犀", "擎天柱", "威震天", "如意", "招财", "admin" };
        // Ruyi.DirectChat=true 时如意可被普通用户搜索到
        var ruyiDirect = !isAdmin && await db.SystemSettings
            .Where(s => s.Key == "Ruyi.DirectChat").Select(s => s.Value).FirstOrDefaultAsync() == "true";
        if (ruyiDirect) privateAccounts.Remove("如意");
        var users = await db.Users
            .Where(u => u.Id != myId && u.IsActive && u.Username.Contains(q)
                        && (isAdmin || !privateAccounts.Contains(u.Username)))
            .Select(u => new { u.Id, u.Username, u.AvatarUrl })
            .Take(10)
            .ToListAsync();
        return Ok(users);
    }
}

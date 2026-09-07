using System.Diagnostics;
using System.Security.Claims;
using GoodayTools.Data;
using GoodayTools.Models;

namespace GoodayTools.Middleware;

public class AccessLogMiddleware(RequestDelegate next, IServiceScopeFactory factory)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        var path = ctx.Request.Path.Value ?? "/";

        // 过滤 SignalR 连接（噪音过多）
        if (path.StartsWith("/hubs", StringComparison.OrdinalIgnoreCase))
        {
            await next(ctx);
            return;
        }

        var sw = Stopwatch.StartNew();
        await next(ctx);
        sw.Stop();

        var userIdStr = ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var username  = ctx.User.FindFirst(ClaimTypes.Name)?.Value;
        var role      = ctx.User.FindFirst(ClaimTypes.Role)?.Value;

        // 排除 admin 自身的操作
        if (role == "admin") return;

        // 排除指定 IP
        var ip = ctx.Request.Headers["X-Real-IP"].FirstOrDefault()
                 ?? ctx.Connection.RemoteIpAddress?.ToString()
                 ?? "unknown";
        if (ip == "45.77.180.126") return;

        var ua        = ctx.Request.Headers.UserAgent.ToString();

        var log = new AccessLog
        {
            Path       = path,
            Method     = ctx.Request.Method,
            Ip         = ip,
            UserId     = int.TryParse(userIdStr, out var uid) ? uid : null,
            Username   = username,
            StatusCode = ctx.Response.StatusCode,
            DurationMs = (int)sw.ElapsedMilliseconds,
            UserAgent  = ua.Length > 200 ? ua[..200] : ua,
            CreatedAt  = DateTime.UtcNow
        };

        // 异步写，不阻塞响应
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = factory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.AccessLogs.Add(log);
                await db.SaveChangesAsync();
            }
            catch
            {
                // 日志写入失败不影响正常请求
            }
        });
    }
}

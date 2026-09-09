// =====================================================
// Program.cs —— ASP.NET Core 应用程序入口
// 职责：注册所有服务（依赖注入容器），配置中间件管道
//
// 理解两个阶段：
//   1. builder 阶段：往容器里"注册"服务（告诉框架有哪些类可以被注入）
//   2. app 阶段：配置请求处理"管道"（请求来了依次经过哪些中间件）
// =====================================================

using System.Text;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using GoodayTools.Data;
using GoodayTools.Hubs;
using GoodayTools.Middleware;
using GoodayTools.Services;

var builder = WebApplication.CreateBuilder(args);

// ---- 注册数据库（Entity Framework Core + SQLite） ----
// AppDbContext 是数据库上下文类，连接字符串从 appsettings.json 读取
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseSqlite(builder.Configuration.GetConnectionString("Default")));

// ---- 注册 JWT 认证 ----
// 告诉框架如何验证 token：用什么密钥、谁签发的、给谁用的
var jwtSecret = builder.Configuration["Jwt:Secret"]!;
// 生产环境使用默认弱密钥会让任何人都能伪造 token，直接拒绝启动
if (!builder.Environment.IsDevelopment() &&
    jwtSecret == "gooday-super-secret-key-2024-must-be-at-least-32-characters-long!!")
    throw new InvalidOperationException(
        "生产环境不可使用默认 JWT 密钥！请在 .env 里设置 JWT_SECRET 为强随机值后重启。");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt => {
        opt.TokenValidationParameters = new TokenValidationParameters {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ValidateIssuer = true, ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidateAudience = true, ValidAudience = builder.Configuration["Jwt:Audience"],
            ValidateLifetime = true  // 验证 token 是否过期
        };
        // token 来源优先级：Authorization 头 > query string(/hubs) > cookie
        //   - Authorization 头：API 调用的权威来源（前端从 localStorage 取）
        //   - query string：SignalR WebSocket 连接无法携带自定义请求头
        //   - cookie：仅用于浏览器页面导航/文件下载（无法带 Authorization 头时的回退）
        // 注意：有 Authorization 头时绝不用 cookie 覆盖，避免脏 cookie 误伤有效 token
        opt.Events = new JwtBearerEvents {
            OnMessageReceived = ctx => {
                var qs = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(qs) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    ctx.Token = qs;
                else if (!ctx.Request.Headers.ContainsKey("Authorization")
                         && ctx.Request.Cookies.TryGetValue("token", out var t))
                    ctx.Token = t;
                return Task.CompletedTask;
            },
            // 每个请求校验 token 是否仍有效：账号被禁用、或改密码后旧 token 立即失效
            OnTokenValidated = async ctx => {
                var idStr   = ctx.Principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                var tverStr = ctx.Principal?.FindFirst("tver")?.Value;
                if (!int.TryParse(idStr, out var uid)) { ctx.Fail("invalid token"); return; }
                var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                var u = await db.Users.Where(x => x.Id == uid)
                    .Select(x => new { x.IsActive, x.TokenVersion })
                    .FirstOrDefaultAsync();
                if (u is null || !u.IsActive) { ctx.Fail("account disabled"); return; }
                if (tverStr != u.TokenVersion.ToString()) { ctx.Fail("token revoked"); return; }
            }
        };
    });

builder.Services.AddAuthorization();

// ---- 注册自定义服务（Scoped = 每次 HTTP 请求创建一个实例） ----
builder.Services.AddScoped<TokenService>();        // 生成/解析 JWT token
builder.Services.AddScoped<SubscriptionService>(); // 订阅/付费会员业务逻辑
builder.Services.AddScoped<NotificationService>(); // 站内通知
builder.Services.AddScoped<ScheduleOcrService>();  // 课表照片识别（视觉模型，缺省 mock）
// uploads 旧链接映射：单例内存缓存，写方显式失效（见 UploadRedirectCache 注释）
builder.Services.AddSingleton<UploadRedirectCache>();
// 交付：三样齐不齐的判定 + 通知客户。上架端点和工单结单闸门【共用它】，
// 两处各写一套的下场就是原来那个「私信里含 deliverables 就算交付」
builder.Services.AddScoped<DeliveryService>();
builder.Services.AddHttpClient("vision");          // 识别服务出站请求

// 注册控制器（所有 Controller 类自动被发现）
builder.Services.AddControllers();

// ---- 注册 SignalR（实时聊天） ----
builder.Services.AddSignalR();

// ---- 注册 CORS 跨域策略 ----
builder.Services.AddCors(opt => opt.AddPolicy("dev",
    p => p.WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
          .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

// ---- 注册限流策略（.NET 8 内置，无需额外 NuGet） ----
// 限流分桶键：真实客户端 IP。必须优先取 nginx 注入的 X-Real-IP——
// 应用在容器里只见到 nginx 的 127.0.0.1,直接用 RemoteIpAddress 会全站共享一个桶:
// 任何人发10次失败登录就把所有用户锁15分钟(2026-07-14 全站审查发现的自助DoS)
static string ClientIpOf(HttpContext ctx) =>
    ctx.Request.Headers.TryGetValue("X-Real-IP", out var xr) && xr.Count > 0
        ? xr[0]!.Trim() : ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

builder.Services.AddRateLimiter(opt => {
    opt.RejectionStatusCode = 429;
    // 注册：每 IP 每小时最多 5 次（防止批量注册）
    opt.AddPolicy("register", ctx =>
        RateLimitPartition.GetFixedWindowLimiter(ClientIpOf(ctx),
            _ => new FixedWindowRateLimiterOptions {
                PermitLimit = 5, Window = TimeSpan.FromHours(1), QueueLimit = 0
            }));
    // 登录：每 IP 每 15 分钟最多 10 次（防暴力撞库）
    opt.AddPolicy("login", ctx =>
        RateLimitPartition.GetFixedWindowLimiter(ClientIpOf(ctx),
            _ => new FixedWindowRateLimiterOptions {
                PermitLimit = 10, Window = TimeSpan.FromMinutes(15), QueueLimit = 0
            }));
    // 匿名提交/上传（开发需求单）：每 IP 每小时 10 次——不登录就能写磁盘的端点必须有闸,
    // 否则脚本可无限灌 30MB 附件把 52G 盘塞满（2026-07-14 全站审查加固）
    opt.AddPolicy("anon-write", ctx =>
        RateLimitPartition.GetFixedWindowLimiter(ClientIpOf(ctx),
            _ => new FixedWindowRateLimiterOptions {
                PermitLimit = 10, Window = TimeSpan.FromHours(1), QueueLimit = 0
            }));
    // 匿名计数（视频讲解播放数）：每 IP 每小时 60 次。
    // 比 anon-write 松，是因为它不写磁盘也不产生内容，只 +1；
    // 但仍必须有闸——不限流的话一条 curl 循环既能把播放数刷成任意值，
    // 也能拿 SQLite 写入当放大器。60 次/小时对真人看视频绰绰有余。
    opt.AddPolicy("anon-count", ctx =>
        RateLimitPartition.GetFixedWindowLimiter(ClientIpOf(ctx),
            _ => new FixedWindowRateLimiterOptions {
                PermitLimit = 60, Window = TimeSpan.FromHours(1), QueueLimit = 0
            }));
});

var app = builder.Build();

// ---- 启动时执行数据库迁移（EF Core Migrations） ----
// MigrateAsync：对比 __EFMigrationsHistory 表，只执行尚未应用的迁移
// 新部署时自动建表；已有数据库只执行增量变更
using (var scope = app.Services.CreateScope()) {
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();

    // 种子数据：仅在表为空时插入示例内容
    var adminUser = db.Database
        .SqlQueryRaw<int>("SELECT Id FROM Users WHERE Role='admin' LIMIT 1")
        .AsEnumerable().FirstOrDefault();
    if (adminUser > 0)
    {
        var shCount = db.Database.SqlQueryRaw<int>("SELECT COUNT(*) FROM SecondhandItems").AsEnumerable().First();
        if (shCount == 0)
        {
            var now = DateTime.UtcNow.ToString("o");
            db.Database.ExecuteSqlRaw($@"INSERT INTO SecondhandItems
                (Title,Description,Price,Images,Category,Condition,Status,SellerId,Location,ViewCount,CreatedAt)
                VALUES
                ('iPhone 14 Pro 256G 深空黑','成色极佳，9成新，原装配件齐全，电池健康95%，无拆修记录，已贴膜，随机附赠充电头和原装数据线。',2800,'[]','数码','几乎全新','available',{adminUser},'上海·浦东新区',0,'{now}')");
        }
    }
}

// ---- 中间件管道（请求从上到下依次经过） ----
// qianky 私有页：禁止静态直链访问 HTML 文件，强制走下方鉴权路由 /qianky
// ---- 路径归一：先把重复斜杠塌掉，再让后面所有判断生效 ----
// 【2026-09-09 实测的真漏】：`//uploads/private/x.txt` 能拿到 200，
// 而 `/uploads/private/x.txt` 是 404。原因是 StartsWithSegments 对 `//uploads`
// 返回 false，而静态文件提供程序会把前导斜杠 TrimStart 掉照样找到文件——
// 一道拦截、一个提供程序，对"同一个路径"的理解不一样，中间那条缝就是洞。
// nginx 的 merge_slashes 没有兜住（实测线上同样 200）。
// 塌斜杠放在最前面：后面每一处路径判断从此只需要考虑一种写法。
app.Use(async (ctx, next) => {
    var p = ctx.Request.Path.Value ?? "";
    if (p.Contains("//")) {
        var segs = p.Split('/', StringSplitOptions.RemoveEmptyEntries);
        ctx.Request.Path = "/" + string.Join('/', segs) + (p.EndsWith('/') && segs.Length > 0 ? "/" : "");
    }
    await next();
});

app.Use(async (ctx, next) => {
    // 按【段】判断，不按前缀字符串——前缀匹配对 `//uploads`、`/uploads//private`
    // 这类写法会漏，而它们指向同一个文件
    var segs = (ctx.Request.Path.Value ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries);
    bool Seg(int i, string v) => segs.Length > i
        && string.Equals(segs[i], v, StringComparison.OrdinalIgnoreCase);

    // qianky 私有页：禁止静态直链访问，强制走下方鉴权路由 /qianky
    if (segs.Length == 2 && Seg(0, "uploads") && Seg(1, "food-safety-check.html")) {
        ctx.Response.StatusCode = 404;
        return;
    }
    // 客户交付物：整段禁止静态直链。
    // 【这是"私有"两个字的全部依据】——文件放在静态目录下，不拦就是公开的，
    // 只是没人知道路径而已；而路径会出现在浏览器历史、日志、转发的链接里。
    // 唯一的取文件入口是 /api/tools/{slug}/online|video|download，那里查归属。
    if (Seg(0, "uploads") && Seg(1, "private")) {
        ctx.Response.StatusCode = 404;
        return;
    }
    await next();
});
// 静态文件：补 .epub 等内置 MIME 列表外的类型（否则 UseStaticFiles 对未知扩展名返回 404，
// 听书的文字版 EPUB 就拉不到；音视频能服务是因 mp3/mp4 已在默认列表）
var _ctp = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
_ctp.Mappings[".epub"] = "application/epub+zip";
_ctp.Mappings[".srt"] = "application/x-subrip";
_ctp.Mappings[".lrc"] = "text/plain; charset=utf-8";   // 英语版字幕 LRC（听书下载/喜马用）
// 分卷压缩包：zip -s 切出的 .z01/.z02… 不在内置列表，不加映射一律 404，
// 只有最后那个 .zip 能下到，用户凑不齐分卷解不出来（2026-08-10 分享视频分卷时踩到）
_ctp.Mappings[".z01"] = "application/octet-stream";
_ctp.Mappings[".z02"] = "application/octet-stream";
_ctp.Mappings[".z03"] = "application/octet-stream";
// 安卓安装包：同样不在内置列表，不加映射直接 404。用这个 MIME 手机浏览器才会
// 走「下载并唤起安装器」，给成 octet-stream 有些机型只会当普通文件存下来。
_ctp.Mappings[".apk"] = "application/vnd.android.package-archive";
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = _ctp });

// ---- uploads 老链接兜底：文件搬家后，站外的旧地址 302 到新地址 ----
// 站内引用（工具字段、论坛帖子、页面内部引用）在搬家时已被 RewriteReferences 改掉，
// 但用户收藏夹里的、别处贴过的、搜索引擎收录的地址改不了——没有这段它们就是死链。
// 位置必须在 UseStaticFiles 之后：文件真在时静态中间件已经返回，走不到这里。
//
// 顺带把「找不到」的回法统一成 404。实测（2026-09-08）：带扩展名的缺失路径本来就
// 404（MapFallbackToFile 的 nonfile 约束挡住了），但**不带扩展名的会拿到 200 的
// index.html**——比如 /uploads/DBMigrate-Pro-v0.2 这类没后缀的下载文件，
// 存下来是个 HTML 首页。这里显式 404，两种情况都诚实。
app.Use(async (ctx, next) => {
    var p = ctx.Request.Path.Value ?? "";
    if (p.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase)) {
        var rel = Uri.UnescapeDataString(p["/uploads/".Length..]);
        if (rel.Length > 0) {
            // 【整张表进内存缓存】。这段在限流中间件之前，匿名请求打不中就查一次库，
            // 等于给了一个免费的放大器；表才一百多行，缓存住就没这回事了。
            // 后台改名/移动/归置时 UploadRedirectCache.Invalidate() 清缓存。
            var cache = ctx.RequestServices.GetRequiredService<UploadRedirectCache>();
            var map = await cache.GetAsync();
            var hit = map.TryGetValue(rel, out var to) ? to : null;
            // 指向自己的行跳过——真按它跳会让浏览器原地打转
            if (hit != null && hit != rel) {
                // 目标路径按段转义：中文不转义也能用，但文件名里真有 % # ? 时地址会断
                var target = "/uploads/" + string.Join('/', hit.Split('/').Select(Uri.EscapeDataString));
                // 【302 不是 301】：映射是可变的（文件可以再搬一次），而 301 会被浏览器
                // 和搜索引擎永久缓存——之后再改映射也叫不回那些客户端（灵犀评审第 5 条）
                ctx.Response.Redirect(target, permanent: false);
                return;
            }
        }
        // 【走到这里 = 这个文件真的没有】。不放行到下面的 MapFallbackToFile：
        // 无扩展名的路径会被它当成前端路由，回一个 200 的 index.html。缺文件就该是 404。
        ctx.Response.StatusCode = 404;
        return;
    }
    await next();
});

if (app.Environment.IsDevelopment()) app.UseCors("dev");
app.UseRateLimiter();
app.UseAuthentication();                           // 解析 token，填充 User.Identity
app.UseMiddleware<AccessLogMiddleware>();          // 记录所有请求（UseAuthentication 后可获取 UserId）
app.UseAuthorization();                            // 检查 [Authorize] 属性的权限
app.MapControllers();                              // 把请求路由到对应的 Controller 方法
app.MapHub<ChatHub>("/hubs/chat");                // SignalR 聊天 Hub
app.MapHub<GameHub>("/hubs/game");                // SignalR 游戏 Hub
// qianky 专属食品安全检查页（服务端校验：仅 qianky 本人可访问，token 从 cookie 读）
app.MapGet("/qianky", (HttpContext ctx, IWebHostEnvironment env) => {
    // 禁止浏览器缓存此页（含鉴权 + 内容会更新，避免缓存到旧版/他人会话）
    ctx.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
    var name = ctx.User?.FindFirst(ClaimTypes.Name)?.Value;
    if (ctx.User?.Identity?.IsAuthenticated == true && name == "qianky") {
        var path = Path.Combine(env.WebRootPath, "uploads", "food-safety-check.html");
        return Results.File(path, "text/html; charset=utf-8");
    }
    // 没带有效 cookie：若已重试过(?b=1)仍失败，说明确实未登录或非 qianky → 回首页
    if (ctx.Request.Query.ContainsKey("b"))
        return Results.Redirect("/");
    // 否则返回极简引导页：用 localStorage 的 token 补设 cookie 后立即重载，
    // 避免书签/冷启动时绕道加载整个 SPA 造成的卡顿
    var boot = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>加载中…</title></head><body>"
        + "<script>var t=localStorage.getItem('token');"
        + "if(t){document.cookie='token='+t+';path=/;SameSite=Lax;max-age=604800';location.replace('/qianky?b=1');}"
        + "else{location.replace('/');}</script></body></html>";
    return Results.Content(boot, "text/html; charset=utf-8");
});

app.MapFallbackToFile("index.html");              // 其他所有路径返回 index.html（React 路由需要）

app.Run();

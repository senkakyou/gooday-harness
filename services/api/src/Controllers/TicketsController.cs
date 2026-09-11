// =====================================================
// Controllers/TicketsController.cs —— 订单接口（对客称「订单」，代码里是 Ticket）
// 路由前缀：/api/tickets
//
// 职责边界（docs/decisions/006）：
//   本控制器【只管业务状态】。方案、拆解、执行、证据全归 Harness
//   （workflows/order + /var/lib/gooday-harness/evidence/），不进这张表。
//
// 改状态【只有一个入口】：POST /api/tickets/{id}/transition。
//   PUT /api/tickets/{id} 只改内容不改状态——上一版两件事挤在一个 PUT 里，
//   于是「改个标题」和「把单子推进下一阶段」走同一条代码路径。
//
// 合法迁移表在 Services/TicketWorkflow.cs，**全仓唯一一份**。
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;
using GoodayTools.Services;
namespace GoodayTools.Controllers;

[ApiController]
[Route("api/tickets")]
[Authorize(Roles = "admin,staff")]
public class TicketsController(AppDbContext db, DeliveryService delivery,
                               IWebHostEnvironment env) : ControllerBase
{
    // ══ 内部工具 ═══════════════════════════════════════════════════

    private int CurrentUserId()
        => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var u) ? u : 0;

    private string CurrentUserName()
        => User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "";

    /// 订单编号：GD-YYYYMMDD-NNN
    private async Task<string> GenerateTicketNo()
    {
        var prefix = $"GD-{DateTime.UtcNow:yyyyMMdd}-";
        var last = await db.Tickets
            .Where(t => t.TicketNo.StartsWith(prefix))
            .OrderByDescending(t => t.TicketNo)
            .Select(t => t.TicketNo)
            .FirstOrDefaultAsync();

        int seq = 1;
        if (last != null && int.TryParse(last.Substring(prefix.Length), out int parsed))
            seq = parsed + 1;
        return $"{prefix}{seq:D3}";
    }

    /// <summary>
    /// 写一条工作记录。**不 SaveChanges**——由调用方和业务改动一起提交，
    /// 免得出现「状态改了但记录没落」或者反过来。
    /// </summary>
    private void Log(int ticketId, string kind, string text,
                     int actorId, string actorName, string? evidence = null)
        => db.TicketLogs.Add(new TicketLog {
            TicketId = ticketId, Kind = kind, Text = text,
            ActorId = actorId, ActorName = actorName,
            EvidenceRef = evidence, At = DateTime.UtcNow,
        });

    /// <summary>
    /// 建单后给大海报一份。
    ///
    /// 【为什么放在服务端，而不是让如意自己发】：
    ///   一、建单和通知是同一件事，分成两处就一定会出现「单建了但没人知道」；
    ///   二、如意的出口白名单是【运行时只放行来找过她的人】，大海通常不在里面，
    ///       她想发也发不出去——那道白名单是防注入的结构性防线，不该为这个开口子。
    ///
    /// 【文案是固定模板，不是模型生成】：报告里说错一句，
    /// 大海就照着错的去跟客户谈。**这里一个字都不来自客户输入之外的推断。**
    /// 需求原文照抄，不做摘要。
    /// </summary>
    private async Task NotifyOwnerAsync(Ticket t)
    {
        var ruyi = await db.Users.FirstOrDefaultAsync(u => u.Username == "如意");
        var owner = await db.Users.FirstOrDefaultAsync(u => u.Id == TicketWorkflow.OwnerUserId);
        if (ruyi == null || owner == null) return;

        var body =
            $"📋 新订单 {t.TicketNo}\n" +
            $"客户：{(string.IsNullOrWhiteSpace(t.ClientName) ? "—" : t.ClientName)}" +
            $"（{(string.IsNullOrWhiteSpace(t.ClientContact) ? "无联系方式" : t.ClientContact)}）\n" +
            $"想做：{t.Title}\n" +
            // 【把绑定的账号写进通知】。建单时的 ClientUserId 是第二扇门：
            // 如意必须能传（她在私信里接待，发信人就是客户），锁不掉。
            // 锁不掉就让它【可见】——放行前大海看得到这单挂在谁头上。
            $"挂在客户档案：{(t.ClientId is int cid ? $"#{cid}" : "未关联 —— 这单现在放行不了，要先绑客户")}\n\n" +
            $"需求原文：\n{t.Description}\n\n" +
            $"—— 价格和细节你跟客户确认，谈好了在后台填金额、点「开工」，" +
            $"或者直接跟我说「{t.TicketNo} 开工」。";

        db.PrivateMessages.Add(new PrivateMessage {
            SenderId = ruyi.Id, SenderUsername = ruyi.Username,
            ReceiverId = owner.Id, ReceiverUsername = owner.Username,
            Content = body,
        });
        db.Notifications.Add(new Notification {
            UserId = owner.Id, Type = "request",
            Title = $"新订单 {t.TicketNo}",
            Body = t.Title, LinkUrl = "/admin/tickets",
        });
    }

    /// <summary>
    /// 拿 UserId 换客户档案 Id；没有就建一个。返回 null 表示这人没账号（线下客户）。
    ///
    /// 【建档案这件事跟建单绑在一起，不单独暴露成一个接口】：
    /// 客户档案的存在意义就是「这个人跟我们做过生意」，
    /// 而「做生意」的起点就是开单。分成两步就会出现有单没档案、
    /// 或者一堆从没下过单的空档案。
    /// </summary>
    private async Task<int?> ResolveClientAsync(int? userId, string? name, string? contact)
    {
        if (userId is not int uid || uid <= 0) return null;

        var existing = await db.Clients.Where(c => c.UserId == uid)
                                       .Select(c => (int?)c.Id).FirstOrDefaultAsync();
        if (existing != null) return existing;

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid);
        if (user == null) return null;          // 账号不存在就别硬建档案

        var c2 = new Client {
            UserId = uid,
            Name = string.IsNullOrWhiteSpace(name) ? user.Username : name.Trim(),
            Contact = contact?.Trim() ?? "",
            Source = "ruyi",
            Status = "prospect",
        };
        db.Clients.Add(c2);
        await db.SaveChangesAsync();
        return c2.Id;
    }

    // ══ 建单 ═══════════════════════════════════════════════════════

    /// 网页公开需求表单提交的字段。【没有预算/金额字段】——如意与前台全程不谈钱。
    public record IntakeReq(string Name, string Contact, string Title, string Description);

    // ---- POST /api/tickets/intake —— 公开建单（替代原 POST /api/requests）----
    //
    // 【它是唯一能接住未注册访客的入口】：如意只能收站内私信，
    // 没账号的人找不到她。删了这条路等于断掉拉新。
    [AllowAnonymous]
    [EnableRateLimiting("anon-write")]   // 匿名写库端点必限流，防脚本灌盘
    [HttpPost("intake")]
    public async Task<IActionResult> Intake([FromBody] IntakeReq req)
    {
        // 服务端校验不可省：前端校验只是体验，绕过它太容易
        if (string.IsNullOrWhiteSpace(req.Name))    return BadRequest(new { message = "请填写称呼" });
        if (string.IsNullOrWhiteSpace(req.Contact)) return BadRequest(new { message = "请填写联系方式" });
        if (string.IsNullOrWhiteSpace(req.Title))   return BadRequest(new { message = "请填写一句话说明想做什么" });
        if (string.IsNullOrWhiteSpace(req.Description) || req.Description.Trim().Length < 30)
            return BadRequest(new { message = "需求描述至少 30 个字，说清楚要做什么、给谁用" });

        int? userId = null;
        if (User.Identity?.IsAuthenticated == true) userId = CurrentUserId();

        var t = new Ticket {
            TicketNo      = await GenerateTicketNo(),
            Title         = req.Title.Trim(),
            Description   = req.Description.Trim(),
            ClientName    = req.Name.Trim(),
            ClientContact = req.Contact.Trim(),
            // 登录用户同样要关联/建立客户档案，理由同 ResolveClientAsync
            ClientId      = await ResolveClientAsync(userId, req.Name, req.Contact),
            Status        = TicketWorkflow.New,
            Amount        = null,        // 钱由大海与客户确认后填
        };
        db.Tickets.Add(t);
        await db.SaveChangesAsync();

        Log(t.Id, "created", $"网页需求表单提交（{req.Name}）", userId ?? 0, req.Name);
        await NotifyOwnerAsync(t);
        await db.SaveChangesAsync();

        return Ok(new { message = "收到了，我们会尽快联系你", ticketNo = t.TicketNo, id = t.Id });
    }

    // 需求附件允许的类型：只有文档与图片，禁脚本/可执行——匿名上传要收紧
    private static readonly HashSet<string> AllowedAttachExts = new(StringComparer.OrdinalIgnoreCase) {
        ".xlsx", ".xls", ".csv", ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".txt",
        ".png", ".jpg", ".jpeg", ".gif", ".webp",
    };

    // ---- POST /api/tickets/intake/upload —— 需求附件（公开，可选）----
    [AllowAnonymous]
    [EnableRateLimiting("anon-write")]
    [HttpPost("intake/upload")]
    [RequestSizeLimit(30L * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 30L * 1024 * 1024)]
    public async Task<IActionResult> UploadAttachment(IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest(new { message = "请选择文件" });
        var ext = Path.GetExtension(file.FileName).ToLower();
        if (string.IsNullOrEmpty(ext) || !AllowedAttachExts.Contains(ext))
            return BadRequest(new { message = "仅支持 Excel / Word / PDF / 图片 等文件" });
        if (file.Length > 30L * 1024 * 1024) return BadRequest(new { message = "文件最大 30MB" });

        var dir = Path.Combine(env.WebRootPath, "uploads", "requests");
        Directory.CreateDirectory(dir);
        var fileName = $"{Guid.NewGuid()}{ext}";
        using var stream = System.IO.File.Create(Path.Combine(dir, fileName));
        await file.CopyToAsync(stream);
        return Ok(new { url = $"/uploads/requests/{fileName}", name = file.FileName });
    }

    /// 内部建单（如意 intake.py / 大海手建）。同样没有金额字段。
    ///
    /// ClientUserId：如意是在【站内私信】里接待的，对方必然有账号，
    /// 她把发信人的 UserId 带上，服务端负责换算成客户档案（没有就建一个）。
    public record CreateTicketReq(
        string Title, string Description,
        string ClientName, string ClientContact, int? ClientId, int? ClientUserId);

    // ---- POST /api/tickets —— 内部建单 ----
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateTicketReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Title))
            return BadRequest(new { message = "标题不能为空" });
        if (string.IsNullOrWhiteSpace(req.Description))
            return BadRequest(new { message = "需求描述不能为空" });

        // 【必须关联客户档案，否则这张单永远交付不了】。
        // 上架端点要把交付物挂到 Clients → Users 名下，ClientId 为空时它直接拒绝。
        // 第一版 intake.py 恒传 null，结果是如意开的单全部走不到放行那一步——
        // 而这个信息本来就在手上（她在站内私信里接待，发信人必然有账号）。
        var clientId = req.ClientId ?? await ResolveClientAsync(
            req.ClientUserId, req.ClientName, req.ClientContact);

        var t = new Ticket {
            TicketNo      = await GenerateTicketNo(),
            Title         = req.Title.Trim(),
            Description   = req.Description.Trim(),
            ClientName    = req.ClientName?.Trim() ?? "",
            ClientContact = req.ClientContact?.Trim() ?? "",
            ClientId      = clientId,
            Status        = TicketWorkflow.New,
        };
        db.Tickets.Add(t);
        await db.SaveChangesAsync();

        Log(t.Id, "created", $"{CurrentUserName()} 建单", CurrentUserId(), CurrentUserName());
        // 【建单必报大海】。不是「记得通知」，是建单这个动作本身就包含它——
        // 唯一例外是大海自己建的单，他不用收自己发的通知。
        if (CurrentUserId() != TicketWorkflow.OwnerUserId) await NotifyOwnerAsync(t);
        await db.SaveChangesAsync();

        return Ok(new { message = "已建单", id = t.Id, ticketNo = t.TicketNo });
    }

    // ══ 查询 ═══════════════════════════════════════════════════════

    // ---- GET /api/tickets?status=&page=&pageSize= ----
    [HttpGet]
    public async Task<IActionResult> List(string? status, int page = 1, int pageSize = 20)
    {
        var q = db.Tickets.AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(t => t.Status == status);

        var total = await q.CountAsync();
        var list = await q.OrderByDescending(t => t.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(t => new {
                t.Id, t.TicketNo, t.Title, t.Status, t.BlockedReason,
                t.ClientId, t.ClientName, t.ClientContact, t.Amount,
                t.DeliveryToolId, t.DeliveredAt, t.CreatedAt, t.UpdatedAt,
                // 【列表也带 description】。上一版列表不返回它，而交付流水线
                // 直接拿列表里的 ticket 去生成，模型只看见标题——它照样做得出
                // 东西来、不报错，只是做的是另一件事（2026-09-09 灵犀评审 P0）。
                t.Description,
                available = TicketWorkflow.AvailableEvents(t.Status),
            }).ToListAsync();

        return Ok(new { total, page, pageSize, list });
    }

    // ---- GET /api/tickets/{id} ----
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var t = await db.Tickets.Include(x => x.Client)
                                .FirstOrDefaultAsync(x => x.Id == id);
        if (t == null) return NotFound(new { message = "订单不存在" });

        return Ok(new {
            t.Id, t.TicketNo, t.Title, t.Description, t.Status, t.BlockedReason,
            t.ClientId, t.ClientName, t.ClientContact, t.Amount,
            t.DeliveryToolId, t.DeliveredAt, t.CreatedAt, t.UpdatedAt,
            clientUserId = t.Client?.UserId,
            available = TicketWorkflow.AvailableEvents(t.Status),
        });
    }

    // ---- GET /api/tickets/{id}/log —— 工作记录时间线 ----
    [HttpGet("{id:int}/log")]
    public async Task<IActionResult> GetLog(int id, int limit = 200)
    {
        var rows = await db.TicketLogs.Where(l => l.TicketId == id)
            .OrderBy(l => l.At).ThenBy(l => l.Id).Take(limit)
            .Select(l => new { l.Id, l.At, l.ActorId, l.ActorName, l.Kind, l.Text, l.EvidenceRef })
            .ToListAsync();
        return Ok(new { ticketId = id, count = rows.Count, list = rows });
    }

    // ══ 改内容（不改状态）═══════════════════════════════════════════

    public record UpdateTicketReq(
        string? Title, string? Description,
        string? ClientName, string? ClientContact, int? ClientId,
        decimal? Amount, string? Note);

    // ---- PUT /api/tickets/{id} ----
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateTicketReq req)
    {
        var t = await db.Tickets.FindAsync(id);
        if (t == null) return NotFound(new { message = "订单不存在" });

        // ═══ 判据字段只有大海能改（2026-09-10 灵犀评审 ②）═══════════════
        //
        //   锁住动作是不够的。start / release / close 都锁给了大海，
        //   可 **release 判的是 ClientId、close 判的是 Amount**，
        //   而这个 PUT 只有 [Authorize(Roles="admin,staff")]——
        //   灵犀是 admin、如意是 staff，两个都进得来。
        //
        //   于是那道「只有大海能放行」的闸可以绕过去：
        //   注入让灵犀改掉 ClientId → 大海照常点放行 → **交付物进了别人账号**。
        //   闸门本身没被推开，是它判的那个数被换掉了。
        //
        //   规则：**谁能推那个动作，谁才能改那个动作读的字段。**
        var isOwner = CurrentUserId() == TicketWorkflow.OwnerUserId;
        if (!isOwner && (req.ClientId != null || req.Amount != null))
            return StatusCode(403, new { message =
                "客户档案与金额只有大海能改——放行闸判 ClientId、结单闸判 Amount，" +
                "改得动判据就等于绕得过闸门。" });

        var changed = new List<string>();
        if (req.Title != null && req.Title != t.Title)               { t.Title = req.Title; changed.Add("标题"); }
        if (req.Description != null && req.Description != t.Description) { t.Description = req.Description; changed.Add("需求"); }
        if (req.ClientName != null)    { t.ClientName = req.ClientName; changed.Add("客户名"); }
        if (req.ClientContact != null) { t.ClientContact = req.ClientContact; changed.Add("联系方式"); }
        if (req.ClientId != null)      { t.ClientId = req.ClientId; changed.Add($"客户档案→#{req.ClientId}"); }
        if (req.Amount != null && req.Amount != t.Amount) { t.Amount = req.Amount; changed.Add($"金额→{req.Amount}"); }

        if (changed.Count == 0 && string.IsNullOrWhiteSpace(req.Note))
            return Ok(new { message = "没有变化" });

        t.UpdatedAt = DateTime.UtcNow;
        if (changed.Count > 0)
            Log(id, "edit", "改了：" + string.Join("、", changed), CurrentUserId(), CurrentUserName());
        if (!string.IsNullOrWhiteSpace(req.Note))
            Log(id, "note", req.Note.Trim(), CurrentUserId(), CurrentUserName());

        await db.SaveChangesAsync();
        return Ok(new { message = "已更新", changed });
    }

    // ══ 改状态（唯一入口）═══════════════════════════════════════════

    public record TransitionReq(string Event, string? Reason, string? EvidenceRef);

    // ---- POST /api/tickets/{id}/transition ----
    [HttpPost("{id:int}/transition")]
    public async Task<IActionResult> Transition(int id, [FromBody] TransitionReq req)
    {
        var t = await db.Tickets.FindAsync(id);
        if (t == null) return NotFound(new { message = "订单不存在" });

        var evt = (req?.Event ?? "").Trim();
        var uid = CurrentUserId();
        var who = CurrentUserName();

        // 1) 合法性。【非法迁移返 409 不是 400】——它多半是并发或重复点击，
        //    而不是参数写错，调用方的处理方式不一样。
        var to = TicketWorkflow.Target(t.Status, evt);
        if (to == null)
            return Conflict(new { message = TicketWorkflow.RejectReason(t.Status, evt),
                                  current = t.Status, available = TicketWorkflow.AvailableEvents(t.Status) });

        // 2) 谁能推。不能按 role=="admin" 判——灵犀的 JWT 角色也是 admin。
        if (TicketWorkflow.OwnerOnlyEvents.Contains(evt) && uid != TicketWorkflow.OwnerUserId)
            return StatusCode(403, new { message = $"「{evt}」只有大海能做。其它角色只能 block / 写工作记录。" });

        // 3) 各自的闸门
        if (evt == "block" && string.IsNullOrWhiteSpace(req?.Reason))
            return BadRequest(new { message = "进 BLOCKED 必须写清卡在哪，否则没人知道要处理什么" });

        if (evt == "release")
        {
            // 【交付闸 · 全程唯一一道代码硬闸】：钱、开工、验收都交给人判，
            // 但「东西是不是真做出来了」人肉看不准——上一版的判据一度是
            // 「发给客户的私信里含 deliverables 这个词」。
            var blocked = await delivery.BlockReleaseReasonAsync(t);
            if (blocked != null) return BadRequest(new { message = blocked });
        }

        if (evt == "close" && t.Amount == null)
            return BadRequest(new { message =
                "结单前必须填金额。注意这道闸只防「忘了填」，不防「填错」——" +
                "系统不会拿它和财务表核对（见 Models/Ticket.cs）。" });

        // 4) 迁移
        var from = t.Status;
        t.Status = to;
        t.UpdatedAt = DateTime.UtcNow;

        // BlockedReason 的生命周期跟着 BLOCKED 走：进去写上，出来清掉。
        // 不清的话，一张早就恢复的单会一直挂着「卡在哪」，看板上永远是红的。
        t.BlockedReason = to == TicketWorkflow.Blocked ? req!.Reason!.Trim() : null;

        var text = $"{from} → {to}（{evt}，{who}）"
                 + (string.IsNullOrWhiteSpace(req?.Reason) ? "" : $"：{req!.Reason!.Trim()}");
        Log(id, "transition", text, uid, who, req?.EvidenceRef);
        await db.SaveChangesAsync();

        // 5) 放行之后才通知客户。
        //    【上架和通知是分开的两件事】：主 Agent 先把东西挂到客户名下但不声张，
        //    大海看过点「放行验收」，如意才发通知。文案是固定模板不是模型生成——
        //    交付通知说错一句，客户就白跑一趟。
        object? notify = null;
        if (evt == "release")
        {
            var tool = await delivery.ForTicketAsync(t.Id);
            if (tool != null)
            {
                var sent = await delivery.NotifyCustomerAsync(tool, t);
                t.DeliveryToolId = tool.Id;
                t.DeliveredAt = DateTime.UtcNow;
                Log(id, "deliver", sent ? "如意已通知客户" : "客户此前已收到过通知（幂等，未重复发）",
                    uid, who);
                await db.SaveChangesAsync();
                notify = new { notified = sent, toolId = tool.Id, tool.Slug };
            }
        }

        return Ok(new { message = "已迁移", from, to, notify,
                        available = TicketWorkflow.AvailableEvents(to) });
    }

    // ══ 删除与统计 ═════════════════════════════════════════════════

    [Authorize(Roles = "admin")]
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var t = await db.Tickets.FindAsync(id);
        if (t == null) return NotFound(new { message = "订单不存在" });
        // 工作记录跟着订单一起走：留下没有主体的日志只会让人以为单子还在
        db.TicketLogs.RemoveRange(db.TicketLogs.Where(l => l.TicketId == id));
        db.Tickets.Remove(t);
        await db.SaveChangesAsync();
        return Ok(new { message = "已删除" });
    }

    // ---- GET /api/tickets/stats ----
    [HttpGet("stats")]
    public async Task<IActionResult> Stats()
    {
        // 【按状态分组数一次，不是一个状态查一次库】。上一版是七个 CountAsync，
        // 加一个状态就要记得加一行，而漏掉的那个状态在概览里【显示为不存在】。
        var byStatus = await db.Tickets.GroupBy(t => t.Status)
            .Select(g => new { Status = g.Key, N = g.Count() }).ToListAsync();
        var map = byStatus.ToDictionary(x => x.Status, x => x.N);

        return Ok(new {
            total = map.Values.Sum(),
            // 六个状态一个不少地列出来，没有的补 0——前端不必猜哪个键会缺
            byStatus = TicketWorkflow.States.ToDictionary(s => s, s => map.GetValueOrDefault(s, 0)),
        });
    }

    // ---- GET /api/tickets/daily-report —— 日报数据 ----
    [HttpGet("daily-report")]
    public async Task<IActionResult> DailyReport()
    {
        var todayStart = DateTime.UtcNow.Date;

        var newToday = await db.Tickets.Where(t => t.CreatedAt >= todayStart)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new { t.Id, t.TicketNo, t.Title, t.Status, t.ClientName, t.Amount, t.CreatedAt })
            .ToListAsync();

        // 活跃 = 不在终态。【用 Terminal 集合判，不是列举 != 某几个状态】——
        // 列举法在加状态时必漏，而漏掉的单会从日报里静默消失。
        var terminal = TicketWorkflow.Terminal.ToList();
        var active = await db.Tickets.Where(t => !terminal.Contains(t.Status))
            .OrderBy(t => t.CreatedAt)
            .Select(t => new { t.Id, t.TicketNo, t.Title, t.Status, t.BlockedReason,
                               t.ClientName, t.Amount, t.CreatedAt, t.UpdatedAt })
            .ToListAsync();

        var byStatus = await db.Tickets.GroupBy(t => t.Status)
            .Select(g => new { Status = g.Key, N = g.Count() }).ToListAsync();

        return Ok(new {
            date = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            newToday,
            active,
            stats = byStatus.ToDictionary(x => x.Status, x => x.N),
        });
    }
}

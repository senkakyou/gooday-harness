// =====================================================
// Controllers/ProjectsController.cs —— 项目档案接口
// 路由前缀：/api/projects
// 职责：
//   - 项目 CRUD（admin/staff 权限）
//   - 从工单一键转化为项目
//   - 统计接口供管理后台展示
//   - 决策日志 CRUD
// =====================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
using GoodayTools.Models;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/projects")]
[Authorize(Roles = "admin,staff")]
public class ProjectsController(AppDbContext db) : ControllerBase
{
    // ---- DTO ----
    public record CreateProjectReq(
        string Title,
        string Description,
        int? TicketId,
        int? ClientId,
        int? AssigneeId,
        decimal? Budget,
        decimal? QuotedPrice,
        string? AdminNote
    );

    public record UpdateProjectReq(
        string? Title,
        string? Description,
        string? Status,
        int? AssigneeId,
        decimal? Budget,
        decimal? QuotedPrice,
        decimal? ActualCost,
        decimal? ActualRevenue,
        string? PlanMarkdown,
        string? DeliveryNotes,
        string? AdminNote,
        string? StartDate,
        string? EndDate
    );

    // ---- GET /api/projects —— 列表 ----
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        var q = db.Projects
            .Include(p => p.Ticket)
            .Include(p => p.Client)
            .Include(p => p.Assignee)
            .AsQueryable();

        if (!string.IsNullOrEmpty(status)) q = q.Where(p => p.Status == status);

        var total = await q.CountAsync();
        var items = await q
            .OrderByDescending(p => p.UpdatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return Ok(new { total, page, pageSize, items });
    }

    // ---- GET /api/projects/{id} —— 详情 ----
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(int id)
    {
        var p = await db.Projects
            .Include(p => p.Ticket)
            .Include(p => p.Client)
            .Include(p => p.Assignee)
            .FirstOrDefaultAsync(p => p.Id == id);

        if (p == null) return NotFound(new { message = "项目不存在" });

        // 同时返回决策日志
        var decisions = await db.Decisions
            .Where(d => d.ProjectId == id)
            .OrderByDescending(d => d.CreatedAt)
            .ToListAsync();

        return Ok(new { project = p, decisions });
    }

    // ---- POST /api/projects —— 创建项目 ----
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateProjectReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Title))
            return BadRequest(new { message = "项目标题不能为空" });

        var project = new Project
        {
            Title       = req.Title,
            Description = req.Description ?? "",
            TicketId    = req.TicketId,
            ClientId    = req.ClientId,
            AssigneeId  = req.AssigneeId,
            Budget      = req.Budget,
            QuotedPrice = req.QuotedPrice,
            AdminNote   = req.AdminNote,
            Status      = "planning",
            CreatedAt   = DateTime.UtcNow,
            UpdatedAt   = DateTime.UtcNow
        };

        db.Projects.Add(project);
        await db.SaveChangesAsync();

        return Ok(project);
    }

    // ---- POST /api/projects/from-ticket/{ticketId} —— 工单转项目 ----
    [HttpPost("from-ticket/{ticketId}")]
    public async Task<IActionResult> FromTicket(int ticketId)
    {
        var ticket = await db.Tickets.FindAsync(ticketId);
        if (ticket == null) return NotFound(new { message = "工单不存在" });

        // 检查是否已有项目
        var existing = await db.Projects.FirstOrDefaultAsync(p => p.TicketId == ticketId);
        if (existing != null)
            return BadRequest(new { message = "该工单已有对应项目", projectId = existing.Id });

        decimal? budget = null;
        if (!string.IsNullOrEmpty(ticket.Budget))
        {
            // 尝试解析预算（取中间值，如"500-1000"→750）
            var parts = ticket.Budget.Split('-');
            if (parts.Length == 2 &&
                decimal.TryParse(parts[0].Trim(), out var lo) &&
                decimal.TryParse(parts[1].Trim(), out var hi))
                budget = (lo + hi) / 2;
            else if (decimal.TryParse(ticket.Budget.Trim(), out var single))
                budget = single;
        }

        // ticket.ClientId 是 Users.Id，Projects.ClientId 是 Clients.Id，需要映射
        int? clientRecordId = null;
        if (ticket.ClientId.HasValue)
        {
            var clientRecord = await db.Clients.FirstOrDefaultAsync(c => c.UserId == ticket.ClientId);
            clientRecordId = clientRecord?.Id;
        }

        var project = new Project
        {
            Title       = ticket.Title,
            Description = ticket.Description,
            TicketId    = ticket.Id,
            ClientId    = clientRecordId,
            AssigneeId  = 21, // 默认指派给擎天柱（AI项目经理）
            Budget      = budget,
            QuotedPrice = ticket.EstimatedPrice,
            Status      = "planning",
            CreatedAt   = DateTime.UtcNow,
            UpdatedAt   = DateTime.UtcNow,
            StartDate   = DateTime.UtcNow
        };

        db.Projects.Add(project);

        // 更新工单状态为进行中
        if (ticket.Status == "confirmed")
        {
            ticket.Status    = "in_progress";
            ticket.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();

        return Ok(new { message = "项目已创建", project });
    }

    // ---- PUT /api/projects/{id} —— 更新项目 ----
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateProjectReq req)
    {
        var project = await db.Projects.FindAsync(id);
        if (project == null) return NotFound(new { message = "项目不存在" });

        if (!string.IsNullOrEmpty(req.Title))       project.Title         = req.Title;
        if (!string.IsNullOrEmpty(req.Description)) project.Description   = req.Description;
        if (!string.IsNullOrEmpty(req.Status))      project.Status        = req.Status;
        if (req.AssigneeId.HasValue)                project.AssigneeId    = req.AssigneeId;
        if (req.Budget.HasValue)                    project.Budget        = req.Budget;
        if (req.QuotedPrice.HasValue)               project.QuotedPrice   = req.QuotedPrice;
        if (req.ActualCost.HasValue)                project.ActualCost    = req.ActualCost;
        if (req.ActualRevenue.HasValue)             project.ActualRevenue = req.ActualRevenue;
        if (req.PlanMarkdown != null)               project.PlanMarkdown  = req.PlanMarkdown;
        if (req.DeliveryNotes != null)              project.DeliveryNotes = req.DeliveryNotes;
        if (req.AdminNote != null)                  project.AdminNote     = req.AdminNote;

        if (!string.IsNullOrEmpty(req.StartDate) && DateTime.TryParse(req.StartDate, out var sd))
            project.StartDate = DateTime.SpecifyKind(sd, DateTimeKind.Utc);
        if (!string.IsNullOrEmpty(req.EndDate) && DateTime.TryParse(req.EndDate, out var ed))
            project.EndDate = DateTime.SpecifyKind(ed, DateTimeKind.Utc);

        if (req.Status == "done" && project.EndDate == null)
            project.EndDate = DateTime.UtcNow;

        project.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Ok(project);
    }

    // ---- DELETE /api/projects/{id} —— 删除项目（仅admin）----
    [HttpDelete("{id}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var project = await db.Projects.FindAsync(id);
        if (project == null) return NotFound(new { message = "项目不存在" });

        db.Projects.Remove(project);
        await db.SaveChangesAsync();
        return Ok(new { message = "已删除" });
    }

    // ---- GET /api/projects/stats —— 统计 ----
    [HttpGet("stats")]
    public async Task<IActionResult> Stats()
    {
        var all = await db.Projects.ToListAsync();
        var revenue = all.Where(p => p.ActualRevenue.HasValue).Sum(p => p.ActualRevenue!.Value);
        var cost    = all.Where(p => p.ActualCost.HasValue).Sum(p => p.ActualCost!.Value);

        return Ok(new
        {
            total      = all.Count,
            planning   = all.Count(p => p.Status == "planning"),
            inProgress = all.Count(p => p.Status == "in_progress"),
            testing    = all.Count(p => p.Status == "testing"),
            done       = all.Count(p => p.Status == "done"),
            cancelled  = all.Count(p => p.Status == "cancelled"),
            totalRevenue = revenue,
            totalCost    = cost,
            totalProfit  = revenue - cost
        });
    }

    // ---- GET /api/projects/{id}/tasks —— 子任务列表 ----
    [HttpGet("{id}/tasks")]
    public async Task<IActionResult> ListTasks(int id)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == id))
            return NotFound(new { message = "项目不存在" });

        var tasks = await db.ProjectTasks
            .Where(t => t.ProjectId == id)
            .OrderBy(t => t.SortOrder).ThenBy(t => t.CreatedAt)
            .Select(t => new { t.Id, t.Title, t.Description, t.Status, t.SortOrder, t.CreatedAt, t.UpdatedAt })
            .ToListAsync();

        return Ok(tasks);
    }

    // ---- POST /api/projects/{id}/tasks —— 创建子任务 ----
    [HttpPost("{id}/tasks")]
    public async Task<IActionResult> CreateTask(int id, [FromBody] CreateTaskReq req)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == id))
            return NotFound(new { message = "项目不存在" });
        if (string.IsNullOrWhiteSpace(req.Title))
            return BadRequest(new { message = "任务标题不能为空" });

        var task = new ProjectTask
        {
            ProjectId   = id,
            Title       = req.Title,
            Description = req.Description,
            Status      = "todo",
            SortOrder   = req.SortOrder ?? 0,
            CreatedAt   = DateTime.UtcNow,
            UpdatedAt   = DateTime.UtcNow,
        };
        db.ProjectTasks.Add(task);
        await db.SaveChangesAsync();
        return Ok(new { message = "任务已创建", id = task.Id });
    }

    // ---- PUT /api/projects/{id}/tasks/{taskId} —— 更新子任务 ----
    [HttpPut("{id}/tasks/{taskId}")]
    public async Task<IActionResult> UpdateTask(int id, int taskId, [FromBody] UpdateTaskReq req)
    {
        var task = await db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == id);
        if (task == null) return NotFound(new { message = "任务不存在" });

        if (req.Title != null)       task.Title       = req.Title;
        if (req.Description != null) task.Description = req.Description;
        if (req.Status != null)      task.Status      = req.Status;
        if (req.SortOrder.HasValue)  task.SortOrder   = req.SortOrder.Value;
        task.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();

        // A2：所有任务完成时，自动推进项目状态并通知大海验收
        if (req.Status == "done")
        {
            var allTasks = await db.ProjectTasks.Where(t => t.ProjectId == id).ToListAsync();
            if (allTasks.Count > 0 && allTasks.All(t => t.Status == "done"))
            {
                var project = await db.Projects.FindAsync(id);
                if (project != null && project.Status == "in_progress")
                {
                    project.Status    = "testing";
                    project.UpdatedAt = DateTime.UtcNow;

                    // 通知大海（Id=1），直接查 Username 字段避免 EF 追踪缓存问题
                    var optimusName = await db.Users.Where(u => u.Id == 21).Select(u => u.Username).FirstOrDefaultAsync();
                    var dahaiName   = await db.Users.Where(u => u.Id == 1).Select(u => u.Username).FirstOrDefaultAsync();
                    if (optimusName != null && dahaiName != null)
                    {
                        db.PrivateMessages.Add(new PrivateMessage
                        {
                            SenderId         = 21,
                            SenderUsername   = optimusName,
                            ReceiverId       = 1,
                            ReceiverUsername = dahaiName,
                            Content          = $"✅ **{project.Title}** 所有执行任务已完成（共 {allTasks.Count} 条）\n\n项目已自动进入测试阶段，请安排验收。\n\n前往 `/admin/projects` 查看详情。",
                            CreatedAt        = DateTime.UtcNow,
                        });
                    }

                    await db.SaveChangesAsync();
                }
            }
        }

        return Ok(new { message = "已更新" });
    }

    // ---- DELETE /api/projects/{id}/tasks/{taskId} —— 删除子任务 ----
    [HttpDelete("{id}/tasks/{taskId}")]
    public async Task<IActionResult> DeleteTask(int id, int taskId)
    {
        var task = await db.ProjectTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == id);
        if (task == null) return NotFound(new { message = "任务不存在" });
        db.ProjectTasks.Remove(task);
        await db.SaveChangesAsync();
        return Ok(new { message = "已删除" });
    }

    public record CreateTaskReq(string Title, string? Description, int? SortOrder);
    public record UpdateTaskReq(string? Title, string? Description, string? Status, int? SortOrder);
}

// =====================================================
// DecisionsController —— 决策日志接口
// 路由前缀：/api/decisions
// =====================================================

[ApiController]
[Route("api/decisions")]
[Authorize(Roles = "admin,staff")]
public class DecisionsController(AppDbContext db) : ControllerBase
{
    public record CreateDecisionReq(
        int? ProjectId,
        int? TicketId,
        string Content,
        string? Rationale,
        string DecisionType,
        string? DecidedBy
    );

    // ---- GET /api/decisions?projectId=x ----
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? projectId, [FromQuery] int? ticketId)
    {
        var q = db.Decisions.AsQueryable();
        if (projectId.HasValue) q = q.Where(d => d.ProjectId == projectId);
        if (ticketId.HasValue)  q = q.Where(d => d.TicketId == ticketId);

        var items = await q.OrderByDescending(d => d.CreatedAt).Take(100).ToListAsync();
        return Ok(items);
    }

    // ---- POST /api/decisions ----
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateDecisionReq req)
    {
        if (string.IsNullOrWhiteSpace(req.Content))
            return BadRequest(new { message = "决策内容不能为空" });

        var userId = User.FindFirstValue(
            "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier");

        var decision = new Decision
        {
            ProjectId    = req.ProjectId,
            TicketId     = req.TicketId,
            Content      = req.Content,
            Rationale    = req.Rationale,
            DecisionType = req.DecisionType ?? "other",
            DecidedBy    = req.DecidedBy ?? "admin",
            CreatedAt    = DateTime.UtcNow
        };

        db.Decisions.Add(decision);
        await db.SaveChangesAsync();
        return Ok(decision);
    }

    // ---- PUT /api/decisions/{id}/outcome —— 补充结果 ----
    [HttpPut("{id}/outcome")]
    public async Task<IActionResult> UpdateOutcome(int id, [FromBody] string outcome)
    {
        var d = await db.Decisions.FindAsync(id);
        if (d == null) return NotFound();
        d.Outcome = outcome;
        await db.SaveChangesAsync();
        return Ok(d);
    }

    // ---- DELETE /api/decisions/{id} ----
    [HttpDelete("{id}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var d = await db.Decisions.FindAsync(id);
        if (d == null) return NotFound();
        db.Decisions.Remove(d);
        await db.SaveChangesAsync();
        return Ok(new { message = "已删除" });
    }
}

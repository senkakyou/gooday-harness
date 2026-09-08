// =====================================================
// Data/AppDbContext.cs —— 数据库上下文（EF Core 核心类）
// 职责：
//   1. 声明数据库里有哪些"表"（每个 DbSet 对应一张表）
//   2. 通过 OnModelCreating 配置表结构（索引、外键、唯一约束）
//
// 理解 EF Core：
//   你只需要写 C# 类（Model），EF Core 自动帮你建表、写 SQL
//   查询时写 LINQ（db.Users.Where(...)），EF Core 翻译成 SQL 执行
// =====================================================

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using GoodayTools.Models;
namespace GoodayTools.Data;

// 继承 DbContext，构造函数用 C# 12 主构造函数写法（等价于传统的带 this.options = options 的写法）
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options) {

    // ---- 数据库表声明 ----
    // 每个属性对应数据库里的一张表，属性类型是表里行的类型
    public DbSet<User> Users => Set<User>();
    public DbSet<Tool> Tools => Set<Tool>();
    public DbSet<ToolDownload> ToolDownloads => Set<ToolDownload>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<ToolUsageLog> ToolUsageLogs => Set<ToolUsageLog>();
    public DbSet<DevRequest> DevRequests => Set<DevRequest>();
    public DbSet<ToolPurchase> ToolPurchases => Set<ToolPurchase>();

    // 论坛
    public DbSet<ForumCategory> ForumCategories => Set<ForumCategory>();
    public DbSet<ForumThread> ForumThreads => Set<ForumThread>();
    public DbSet<ForumPost> ForumPosts => Set<ForumPost>();
    public DbSet<ForumPostLike> ForumPostLikes => Set<ForumPostLike>();

    // 聊天 / 好友
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<PrivateMessage> PrivateMessages => Set<PrivateMessage>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<ConversationHide> ConversationHides => Set<ConversationHide>();

    // 食品安全检查记录
    public DbSet<FoodSafetyRecord> FoodSafetyRecords => Set<FoodSafetyRecord>();

    // 二手交易
    public DbSet<SecondhandItem> SecondhandItems => Set<SecondhandItem>();

    // 工具收藏
    public DbSet<ToolFavorite> ToolFavorites => Set<ToolFavorite>();

    // 课程系统
    public DbSet<Subject> Subjects => Set<Subject>();
    public DbSet<TeacherProfile> TeacherProfiles => Set<TeacherProfile>();
    public DbSet<TeacherSubject> TeacherSubjects => Set<TeacherSubject>();
    public DbSet<TimeSlot> TimeSlots => Set<TimeSlot>();
    public DbSet<Booking> Bookings => Set<Booking>();

    // 课时结算
    public DbSet<TeacherStudent> TeacherStudents => Set<TeacherStudent>();
    public DbSet<Lesson> Lessons => Set<Lesson>();
    public DbSet<Payment> Payments => Set<Payment>();

    // 站内通知
    public DbSet<Notification> Notifications => Set<Notification>();

    // 访问记录
    public DbSet<AccessLog> AccessLogs => Set<AccessLog>();

    // 工单系统（数字公司·定制开发业务）
    public DbSet<Ticket> Tickets => Set<Ticket>();

    // 客户档案（数字公司·客户沉淀与画像）
    public DbSet<Client> Clients => Set<Client>();

    // 项目档案（数字公司·项目执行记录）
    public DbSet<Project> Projects => Set<Project>();

    // 决策日志（数字公司·关键决策归档）
    public DbSet<Decision> Decisions => Set<Decision>();

    // 财务记录（数字公司·收支流水与统计）
    public DbSet<FinanceRecord> FinanceRecords => Set<FinanceRecord>();

    // 项目子任务（数字公司·擎天柱拆解的执行任务）
    public DbSet<ProjectTask> ProjectTasks => Set<ProjectTask>();

    // 工单事件流水（数字公司 V3·调度凭证 + 审计日志 + 报表数据源）
    public DbSet<TicketEvent> TicketEvents => Set<TicketEvent>();

    // 系统配置（Key-Value·小额自动放行等运行期开关）
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();

    // 有声读书（书库 + 章节[音频/视频·上传/外链] + 续播进度）
    public DbSet<Audiobook> Audiobooks => Set<Audiobook>();
    public DbSet<AudiobookChapter> AudiobookChapters => Set<AudiobookChapter>();
    public DbSet<ListenProgress> ListenProgresses => Set<ListenProgress>();
    public DbSet<ReadProgress> ReadProgresses => Set<ReadProgress>();

    // uploads 文件搬家后的旧路径→新路径映射（站外老链接靠它 301，不断链）
    public DbSet<UploadRedirect> UploadRedirects => Set<UploadRedirect>();

    // ---- 表结构配置 ----
    // 这里配置的内容在 EnsureCreated() 时会自动应用到数据库
    protected override void OnModelCreating(ModelBuilder m) {
        // 唯一索引：邮箱可空，仅对非空值保证唯一
        m.Entity<User>().HasIndex(u => u.Email).IsUnique().HasFilter("\"Email\" IS NOT NULL");
        m.Entity<User>().HasIndex(u => u.Username).IsUnique();

        // 唯一索引：每个工具的 slug（URL标识符）不能重复
        m.Entity<Tool>().HasIndex(t => t.Slug).IsUnique();

        // 唯一索引：一个旧路径只能指向一个新路径（同一文件多次搬家时改写既有行，不新增）
        m.Entity<UploadRedirect>().HasIndex(r => r.OldPath).IsUnique();

        // 唯一索引：订单号不能重复
        m.Entity<Order>().HasIndex(o => o.OrderNo).IsUnique();
        m.Entity<Order>().HasIndex(o => o.UserId);  // 普通索引，加速按用户查订单

        // 复合索引：加速"查某用户某时间段的使用记录"这类查询
        m.Entity<ToolUsageLog>().HasIndex(l => new { l.UserId, l.UsedAt });

        // 索引：加速按状态筛选需求
        m.Entity<DevRequest>().HasIndex(r => r.Status);

        // 索引：加速按用户/工具/状态查购买记录
        m.Entity<ToolPurchase>().HasIndex(p => p.UserId);
        m.Entity<ToolPurchase>().HasIndex(p => p.ToolId);
        m.Entity<ToolPurchase>().HasIndex(p => p.Status);

        // 外键关系：ToolPurchase.UserId → Users 表，ToolPurchase.ToolId → Tools 表
        m.Entity<ToolPurchase>()
            .HasOne(p => p.User).WithMany().HasForeignKey(p => p.UserId);
        m.Entity<ToolPurchase>()
            .HasOne(p => p.Tool).WithMany().HasForeignKey(p => p.ToolId);

        // 外键关系：ToolDownload 同时关联 Tool 和 User
        m.Entity<ToolDownload>()
            .HasOne(d => d.Tool).WithMany(t => t.Downloads).HasForeignKey(d => d.ToolId);
        m.Entity<ToolDownload>()
            .HasOne(d => d.User).WithMany(u => u.Downloads).HasForeignKey(d => d.UserId);

        // 论坛：板块 slug 唯一
        m.Entity<ForumCategory>().HasIndex(c => c.Slug).IsUnique();

        // 论坛：帖子关联板块和作者
        m.Entity<ForumThread>()
            .HasOne(t => t.Category).WithMany(c => c.Threads).HasForeignKey(t => t.CategoryId);
        m.Entity<ForumThread>()
            .HasOne(t => t.Author).WithMany().HasForeignKey(t => t.AuthorId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<ForumThread>()
            .HasOne(t => t.LastReplyUser).WithMany().HasForeignKey(t => t.LastReplyUserId).OnDelete(DeleteBehavior.SetNull);
        m.Entity<ForumThread>().HasIndex(t => t.CategoryId);
        m.Entity<ForumThread>().HasIndex(t => t.LastReplyAt);

        // 论坛：楼层关联帖子和作者
        m.Entity<ForumPost>()
            .HasOne(p => p.Thread).WithMany(t => t.Posts).HasForeignKey(p => p.ThreadId);
        m.Entity<ForumPost>()
            .HasOne(p => p.Author).WithMany().HasForeignKey(p => p.AuthorId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<ForumPost>().HasIndex(p => p.ThreadId);

        // 论坛：点赞（每人每楼只能点一次）
        m.Entity<ForumPostLike>()
            .HasOne(l => l.Post).WithMany(p => p.Likes).HasForeignKey(l => l.PostId);
        m.Entity<ForumPostLike>()
            .HasOne(l => l.User).WithMany().HasForeignKey(l => l.UserId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<ForumPostLike>().HasIndex(l => new { l.PostId, l.UserId }).IsUnique();

        // 食品安全检查记录：每用户每天唯一
        m.Entity<FoodSafetyRecord>().HasIndex(r => new { r.UserId, r.RecordDate }).IsUnique();

        // 好友关系
        m.Entity<Friendship>()
            .HasOne(f => f.Requester).WithMany().HasForeignKey(f => f.RequesterId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<Friendship>()
            .HasOne(f => f.Addressee).WithMany().HasForeignKey(f => f.AddresseeId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<Friendship>()
            .HasIndex(f => new { f.RequesterId, f.AddresseeId }).IsUnique();

        // 二手交易
        m.Entity<SecondhandItem>()
            .HasOne(i => i.Seller).WithMany().HasForeignKey(i => i.SellerId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<SecondhandItem>().HasIndex(i => i.Status);
        m.Entity<SecondhandItem>().HasIndex(i => i.Category);
        m.Entity<SecondhandItem>().HasIndex(i => i.CreatedAt);

        // 工具收藏：每用户每工具只能收藏一次
        m.Entity<ToolFavorite>().HasIndex(f => new { f.UserId, f.ToolId }).IsUnique();
        m.Entity<ToolFavorite>().HasIndex(f => f.UserId);

        // 课程系统
        m.Entity<TeacherProfile>()
            .HasOne(t => t.User).WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<TeacherProfile>().HasIndex(t => t.UserId).IsUnique();
        m.Entity<TeacherProfile>().HasIndex(t => t.Status);

        m.Entity<TeacherSubject>().HasKey(ts => new { ts.TeacherId, ts.SubjectId });
        m.Entity<TeacherSubject>()
            .HasOne(ts => ts.Teacher).WithMany(t => t.TeacherSubjects).HasForeignKey(ts => ts.TeacherId);
        m.Entity<TeacherSubject>()
            .HasOne(ts => ts.Subject).WithMany(s => s.TeacherSubjects).HasForeignKey(ts => ts.SubjectId);

        m.Entity<TimeSlot>()
            .HasOne(s => s.Teacher).WithMany(t => t.TimeSlots).HasForeignKey(s => s.TeacherId);
        m.Entity<TimeSlot>().HasIndex(s => new { s.TeacherId, s.Date });
        m.Entity<TimeSlot>().HasIndex(s => s.Status);

        m.Entity<Booking>()
            .HasOne(b => b.Student).WithMany().HasForeignKey(b => b.StudentId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<Booking>()
            .HasOne(b => b.OfflineStudent).WithMany().HasForeignKey(b => b.OfflineStudentId).OnDelete(DeleteBehavior.Cascade);
        m.Entity<Booking>()
            .HasOne(b => b.Teacher).WithMany(t => t.Bookings).HasForeignKey(b => b.TeacherId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<Booking>()
            .HasOne(b => b.TimeSlot).WithMany(s => s.Bookings).HasForeignKey(b => b.TimeSlotId);
        m.Entity<Booking>()
            .HasOne(b => b.Subject).WithMany().HasForeignKey(b => b.SubjectId).OnDelete(DeleteBehavior.SetNull);
        m.Entity<Booking>().HasIndex(b => b.StudentId);
        m.Entity<Booking>().HasIndex(b => b.OfflineStudentId);
        m.Entity<Booking>().HasIndex(b => b.TeacherId);
        m.Entity<Booking>().HasIndex(b => b.Status);
        m.Entity<Booking>().HasIndex(b => b.TimeSlotId);   // 群课：非唯一（一个时段多名学生）

        // 课时结算
        m.Entity<TeacherStudent>()
            .HasOne(ts => ts.Teacher).WithMany().HasForeignKey(ts => ts.TeacherId).OnDelete(DeleteBehavior.Cascade);
        m.Entity<TeacherStudent>()
            .HasOne(ts => ts.StudentUser).WithMany().HasForeignKey(ts => ts.StudentUserId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<TeacherStudent>().HasIndex(ts => ts.TeacherId);
        m.Entity<TeacherStudent>()
            .HasIndex(ts => new { ts.TeacherId, ts.StudentUserId }).IsUnique().HasFilter("\"StudentUserId\" IS NOT NULL");

        m.Entity<Lesson>()
            .HasOne(l => l.TeacherStudent).WithMany(ts => ts.Lessons).HasForeignKey(l => l.TeacherStudentId).OnDelete(DeleteBehavior.Cascade);
        m.Entity<Lesson>()
            .HasOne(l => l.Booking).WithMany().HasForeignKey(l => l.BookingId).OnDelete(DeleteBehavior.SetNull);
        m.Entity<Lesson>().HasIndex(l => l.TeacherStudentId);
        m.Entity<Lesson>().HasIndex(l => l.BookingId).IsUnique().HasFilter("\"BookingId\" IS NOT NULL");

        m.Entity<Payment>()
            .HasOne(p => p.TeacherStudent).WithMany(ts => ts.Payments).HasForeignKey(p => p.TeacherStudentId).OnDelete(DeleteBehavior.Cascade);
        m.Entity<Payment>().HasIndex(p => p.TeacherStudentId);

        // 站内通知
        m.Entity<Notification>()
            .HasOne(n => n.User).WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);
        m.Entity<Notification>().HasIndex(n => new { n.UserId, n.IsRead });
        m.Entity<Notification>().HasIndex(n => new { n.UserId, n.CreatedAt });

        // 访问记录
        m.Entity<AccessLog>().HasIndex(a => a.CreatedAt);
        m.Entity<AccessLog>().HasIndex(a => a.Ip);

        // 会话隐藏（每用户每对话唯一）
        m.Entity<ConversationHide>().HasIndex(h => new { h.UserId, h.OtherUserId }).IsUnique();

        // 客户档案
        m.Entity<Client>().HasIndex(c => c.Contact);
        m.Entity<Client>().HasIndex(c => c.Status);
        m.Entity<Client>().HasIndex(c => c.UserId);
        m.Entity<Client>()
            .HasOne(c => c.User).WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.SetNull);

        // 工单系统
        m.Entity<Ticket>().HasIndex(t => t.TicketNo).IsUnique();
        m.Entity<Ticket>().HasIndex(t => t.Status);
        m.Entity<Ticket>().HasIndex(t => t.CreatedAt);
        m.Entity<Ticket>()
            .HasOne(t => t.Client).WithMany().HasForeignKey(t => t.ClientId).OnDelete(DeleteBehavior.SetNull);
        m.Entity<Ticket>()
            .HasOne(t => t.Assignee).WithMany().HasForeignKey(t => t.AssigneeId).OnDelete(DeleteBehavior.SetNull);

        // 项目档案
        m.Entity<Project>().HasIndex(p => p.Status);
        m.Entity<Project>().HasIndex(p => p.CreatedAt);
        m.Entity<Project>()
            .HasOne(p => p.Ticket).WithMany().HasForeignKey(p => p.TicketId).OnDelete(DeleteBehavior.SetNull);
        m.Entity<Project>()
            .HasOne(p => p.Client).WithMany().HasForeignKey(p => p.ClientId).OnDelete(DeleteBehavior.SetNull);
        m.Entity<Project>()
            .HasOne(p => p.Assignee).WithMany().HasForeignKey(p => p.AssigneeId).OnDelete(DeleteBehavior.SetNull);

        // 决策日志
        m.Entity<Decision>().HasIndex(d => d.CreatedAt);
        m.Entity<Decision>().HasIndex(d => d.DecisionType);
        m.Entity<Decision>()
            .HasOne(d => d.Project).WithMany().HasForeignKey(d => d.ProjectId).OnDelete(DeleteBehavior.SetNull);
        m.Entity<Decision>()
            .HasOne(d => d.Ticket).WithMany().HasForeignKey(d => d.TicketId).OnDelete(DeleteBehavior.SetNull);

        // 项目子任务
        m.Entity<ProjectTask>().HasIndex(t => t.ProjectId);
        m.Entity<ProjectTask>().HasIndex(t => t.Status);
        m.Entity<ProjectTask>()
            .HasOne(t => t.Project).WithMany().HasForeignKey(t => t.ProjectId).OnDelete(DeleteBehavior.Cascade);

        // 财务记录
        m.Entity<FinanceRecord>().HasIndex(f => f.CreatedAt);
        m.Entity<FinanceRecord>().HasIndex(f => f.Type);
        m.Entity<FinanceRecord>().HasIndex(f => f.AccountPeriod);
        m.Entity<FinanceRecord>().HasIndex(f => f.PaymentStatus);
        m.Entity<FinanceRecord>()
            .HasOne(f => f.Ticket).WithMany().HasForeignKey(f => f.TicketId).OnDelete(DeleteBehavior.SetNull);
        m.Entity<FinanceRecord>()
            .HasOne(f => f.Client).WithMany().HasForeignKey(f => f.ClientId).OnDelete(DeleteBehavior.SetNull);

        // 工单事件流水（V3）
        m.Entity<TicketEvent>().HasIndex(e => new { e.Status, e.CreatedAt });  // dispatcher 轮询主索引
        m.Entity<TicketEvent>().HasIndex(e => new { e.TicketId, e.CreatedAt }); // 单工单时间线
        m.Entity<TicketEvent>().HasIndex(e => e.EventType);

        // 系统配置：Key 唯一
        m.Entity<SystemSetting>().HasIndex(s => s.Key).IsUnique();

        // 有声读书索引
        m.Entity<AudiobookChapter>().HasIndex(c => new { c.AudiobookId, c.OrderNo }); // 按书取章节列表
        m.Entity<ListenProgress>().HasIndex(p => new { p.UserId, p.ChapterId }).IsUnique(); // 每用户每章一条
        m.Entity<ListenProgress>().HasIndex(p => new { p.UserId, p.UpdatedAt });      // "我的书架"按最近续播排序
        m.Entity<ReadProgress>().HasIndex(p => new { p.UserId, p.AudiobookId }).IsUnique(); // 每用户每书一条(续读)
        m.Entity<ReadProgress>().HasIndex(p => new { p.UserId, p.UpdatedAt });        // "继续阅读"按最近排序

        // 全局 DateTime → UTC 修复
        // SQLite 存的是无时区字符串，读出来一律标为 Utc
        // JSON 序列化后自带 Z 后缀，前端 new Date() 正确识别为 UTC 再转北京时间
        var dtUtc = new ValueConverter<DateTime, DateTime>(
            v => v,
            v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
        var dtNullUtc = new ValueConverter<DateTime?, DateTime?>(
            v => v,
            v => v == null ? null : DateTime.SpecifyKind(v.Value, DateTimeKind.Utc));
        // decimal? 容错：SQLite TEXT 列若残留空字符串，用 string 路径读取避免 GetDecimal() 崩溃
        var decNullConv = new ValueConverter<decimal?, string?>(
            v => v.HasValue ? v.Value.ToString(System.Globalization.CultureInfo.InvariantCulture) : null,
            s => string.IsNullOrWhiteSpace(s) ? (decimal?)null
                 : decimal.Parse(s, System.Globalization.CultureInfo.InvariantCulture));
        foreach (var et in m.Model.GetEntityTypes())
            foreach (var p in et.GetProperties()) {
                if (p.ClrType == typeof(DateTime))       p.SetValueConverter(dtUtc);
                else if (p.ClrType == typeof(DateTime?)) p.SetValueConverter(dtNullUtc);
                else if (p.ClrType == typeof(decimal?))  p.SetValueConverter(decNullConv);
            }
    }
}

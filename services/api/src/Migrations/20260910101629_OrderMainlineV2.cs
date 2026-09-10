using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    /// <summary>
    /// 订单主链路 v2（docs/decisions/006）：
    /// 删掉「工单→项目→子任务→事件」四层对象，Tickets 瘦身到 14 列，
    /// 新增只写不调度的 TicketLogs，并把 Tickets.ClientId 的外键从 Users 改指 Clients。
    ///
    /// ═══ 本文件是【手写】的，不是 `dotnet ef migrations add` 的产物 ═══════
    ///
    ///   自动生成的那份有 1475 行，其中包含对 AccessLogs / Notifications /
    ///   Payments / Bookings / Lessons 等 **11 张早已存在的表**的 CreateTable。
    ///   照它跑下去就是 "table already exists"，而 Program.cs 在启动时
    ///   `await db.Database.MigrateAsync()` —— **API 会直接起不来**。
    ///
    ///   根因是仓库里的 AppDbContextModelSnapshot.cs 本来就漏了那 11 个实体
    ///   （那些表是手写 SQL 建的，没走 EF 迁移），快照与真实库长期漂移。
    ///   本次顺带把快照补齐了（`migrations add` 重新生成的那份是模型准确的），
    ///   所以以后再 `migrations add` 不会再出现这批幽灵 CreateTable。
    ///
    ///   教训：**这个仓库里自动生成的迁移不能直接用，必须逐条看过。**
    /// ═══════════════════════════════════════════════════════════════════
    /// </summary>
    // 【属性写在配套的 .Designer.cs 里，本文件不要重复声明】——
    // 仓库里更早的几个迁移是手写的、没有 Designer 文件，属性直接标在类上；
    // 本次用 `migrations add` 生成了 Designer，两边都标就是 CS0579 重复属性。
    public partial class OrderMainlineV2 : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. 清数据 ────────────────────────────────────────────────
            // 大海 2026-09-10 的口径：需求、工单、客户、财务【都清】，纯净环境开始。
            // 备份在 /srv/gooday-harness/backups/gooday/pre-order-mainline-v2.db，
            // 逐表 JSON 归档在 .../pre-order-mainline-v2-archive/。
            //
            // 【顺序是从子到父】：先清引用方再清被引用方，
            // 否则开着 foreign_keys 时删父表会撞上子行。
            migrationBuilder.Sql("DELETE FROM TicketEvents;");
            migrationBuilder.Sql("DELETE FROM ProjectTasks;");
            migrationBuilder.Sql("DELETE FROM Decisions;");
            migrationBuilder.Sql("DELETE FROM Projects;");
            migrationBuilder.Sql("DELETE FROM DevRequests;");
            migrationBuilder.Sql("DELETE FROM FinanceRecords;");
            migrationBuilder.Sql("DELETE FROM Tickets;");
            migrationBuilder.Sql("DELETE FROM Clients;");

            // 小额自动放行整套作废：每单大海亲自拍板，自动放行没有意义
            migrationBuilder.Sql("DELETE FROM SystemSettings WHERE \"Key\" LIKE 'AutoApprove.%';");

            // ── 2. 删掉四层中间对象 ──────────────────────────────────────
            // Decisions 与 Projects 都有指向 Tickets 的外键，必须排在重建 Tickets 之前。
            migrationBuilder.DropTable(name: "Decisions");
            migrationBuilder.DropTable(name: "ProjectTasks");
            migrationBuilder.DropTable(name: "Projects");
            migrationBuilder.DropTable(name: "TicketEvents");
            migrationBuilder.DropTable(name: "DevRequests");

            // ── 3. 重建 Tickets ─────────────────────────────────────────
            // 【为什么整表重建而不是逐列 DropColumn】：
            //   要改的不只是列，还有外键指向——旧表里写死了
            //   FOREIGN KEY ("ClientId") REFERENCES "Users"("Id")，
            //   而新语义是 ClientId → Clients.Id。SQLite 改不了已有外键，
            //   本来就要整表重建；表此刻已经是空的，重建零风险且一步到位。
            migrationBuilder.Sql("DROP TABLE \"Tickets\";");
            migrationBuilder.Sql(@"
                CREATE TABLE ""Tickets"" (
                    ""Id""             INTEGER NOT NULL CONSTRAINT ""PK_Tickets"" PRIMARY KEY AUTOINCREMENT,
                    ""TicketNo""       TEXT    NOT NULL DEFAULT '',
                    ""Title""          TEXT    NOT NULL DEFAULT '',
                    ""Description""    TEXT    NOT NULL DEFAULT '',
                    ""ClientId""       INTEGER NULL,
                    ""ClientName""     TEXT    NOT NULL DEFAULT '',
                    ""ClientContact""  TEXT    NOT NULL DEFAULT '',
                    ""Amount""         TEXT    NULL,
                    ""Status""         TEXT    NOT NULL DEFAULT 'NEW',
                    ""BlockedReason""  TEXT    NULL,
                    ""DeliveryToolId"" INTEGER NULL,
                    ""DeliveredAt""    TEXT    NULL,
                    ""CreatedAt""      TEXT    NOT NULL,
                    ""UpdatedAt""      TEXT    NOT NULL,
                    CONSTRAINT ""FK_Tickets_Clients_ClientId""
                        FOREIGN KEY (""ClientId"") REFERENCES ""Clients"" (""Id"") ON DELETE SET NULL
                );");
            migrationBuilder.Sql(@"CREATE UNIQUE INDEX ""IX_Tickets_TicketNo"" ON ""Tickets"" (""TicketNo"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Tickets_Status""    ON ""Tickets"" (""Status"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Tickets_CreatedAt"" ON ""Tickets"" (""CreatedAt"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Tickets_ClientId""  ON ""Tickets"" (""ClientId"");");

            // ── 4. 工作记录 ─────────────────────────────────────────────
            // 【没有 Status 列】——它没有消费者，是日志不是队列。见 Models/TicketLog.cs。
            migrationBuilder.Sql(@"
                CREATE TABLE ""TicketLogs"" (
                    ""Id""          INTEGER NOT NULL CONSTRAINT ""PK_TicketLogs"" PRIMARY KEY AUTOINCREMENT,
                    ""TicketId""    INTEGER NOT NULL,
                    ""At""          TEXT    NOT NULL,
                    ""ActorId""     INTEGER NOT NULL DEFAULT 0,
                    ""ActorName""   TEXT    NOT NULL DEFAULT '',
                    ""Kind""        TEXT    NOT NULL DEFAULT 'note',
                    ""Text""        TEXT    NOT NULL DEFAULT '',
                    ""EvidenceRef"" TEXT    NULL
                );");
            // 按订单查时间线是唯一的读法
            migrationBuilder.Sql(@"CREATE INDEX ""IX_TicketLogs_TicketId_At"" ON ""TicketLogs"" (""TicketId"", ""At"");");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // 【Down 只还原结构，还不回数据】——数据回滚走备份文件，见
            // evolution/experiments/order-mainline/README.md 的回滚演练。
            // 那份演练实测出两件事：`-wal`/`-shm` 必须一起删，
            // 且备份必须是 `sqlite3 .backup` 产物而不是 cp 出来的。
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_TicketLogs_TicketId_At\";");
            migrationBuilder.Sql("DROP TABLE IF EXISTS \"TicketLogs\";");

            migrationBuilder.Sql("DROP TABLE IF EXISTS \"Tickets\";");
            migrationBuilder.Sql(@"
                CREATE TABLE ""Tickets"" (
                    ""Id""             INTEGER NOT NULL CONSTRAINT ""PK_Tickets"" PRIMARY KEY AUTOINCREMENT,
                    ""TicketNo""       TEXT    NOT NULL DEFAULT '',
                    ""Title""          TEXT    NOT NULL DEFAULT '',
                    ""Description""    TEXT    NOT NULL DEFAULT '',
                    ""ClientId""       INTEGER NULL,
                    ""ClientName""     TEXT    NOT NULL DEFAULT '',
                    ""ClientContact""  TEXT    NOT NULL DEFAULT '',
                    ""ContactType""    TEXT    NOT NULL DEFAULT 'wechat',
                    ""Status""         TEXT    NOT NULL DEFAULT 'pending',
                    ""Priority""       TEXT    NOT NULL DEFAULT 'normal',
                    ""Budget""         TEXT    NULL,
                    ""EstimatedPrice"" TEXT    NULL,
                    ""DevRequestId""   INTEGER NULL,
                    ""Source""         TEXT    NOT NULL DEFAULT 'admin',
                    ""AssigneeId""     INTEGER NULL,
                    ""AdminNote""      TEXT    NULL,
                    ""CreatedAt""      TEXT    NOT NULL,
                    ""UpdatedAt""      TEXT    NOT NULL,
                    ""DueAt""          TEXT    NULL,
                    ""SubStatus""      TEXT    NULL,
                    ""RetryCount""     INTEGER NOT NULL DEFAULT 0,
                    ""StageDeadline""  TEXT    NULL,
                    CONSTRAINT ""FK_Tickets_Users_ClientId""
                        FOREIGN KEY (""ClientId"") REFERENCES ""Users"" (""Id"") ON DELETE SET NULL,
                    CONSTRAINT ""FK_Tickets_Users_AssigneeId""
                        FOREIGN KEY (""AssigneeId"") REFERENCES ""Users"" (""Id"") ON DELETE SET NULL
                );");
            migrationBuilder.Sql(@"CREATE UNIQUE INDEX ""IX_Tickets_TicketNo""   ON ""Tickets"" (""TicketNo"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Tickets_Status""      ON ""Tickets"" (""Status"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Tickets_CreatedAt""   ON ""Tickets"" (""CreatedAt"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Tickets_ClientId""    ON ""Tickets"" (""ClientId"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Tickets_AssigneeId""  ON ""Tickets"" (""AssigneeId"");");

            migrationBuilder.Sql(@"
                CREATE TABLE ""DevRequests"" (
                    ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_DevRequests"" PRIMARY KEY AUTOINCREMENT,
                    ""Name"" TEXT NOT NULL DEFAULT '', ""Contact"" TEXT NOT NULL DEFAULT '',
                    ""ContactType"" TEXT NOT NULL DEFAULT 'wechat', ""Title"" TEXT NOT NULL DEFAULT '',
                    ""Description"" TEXT NOT NULL DEFAULT '', ""Budget"" TEXT NULL,
                    ""Status"" TEXT NOT NULL DEFAULT 'pending', ""AdminNote"" TEXT NULL,
                    ""UserId"" INTEGER NULL, ""CreatedAt"" TEXT NOT NULL
                );");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_DevRequests_Status"" ON ""DevRequests"" (""Status"");");

            migrationBuilder.Sql(@"
                CREATE TABLE ""TicketEvents"" (
                    ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_TicketEvents"" PRIMARY KEY AUTOINCREMENT,
                    ""TicketId"" INTEGER NOT NULL, ""EventType"" TEXT NOT NULL DEFAULT '',
                    ""ActorId"" INTEGER NOT NULL, ""Level"" TEXT NULL, ""Payload"" TEXT NULL,
                    ""Status"" TEXT NOT NULL DEFAULT 'new', ""CreatedAt"" TEXT NOT NULL,
                    ""ProcessedAt"" TEXT NULL
                );");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_TicketEvents_Status_CreatedAt"" ON ""TicketEvents"" (""Status"", ""CreatedAt"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_TicketEvents_TicketId_CreatedAt"" ON ""TicketEvents"" (""TicketId"", ""CreatedAt"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_TicketEvents_EventType"" ON ""TicketEvents"" (""EventType"");");

            migrationBuilder.Sql(@"
                CREATE TABLE ""Projects"" (
                    ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_Projects"" PRIMARY KEY AUTOINCREMENT,
                    ""TicketId"" INTEGER NULL, ""ClientId"" INTEGER NULL,
                    ""Title"" TEXT NOT NULL DEFAULT '', ""Description"" TEXT NOT NULL DEFAULT '',
                    ""Status"" TEXT NOT NULL DEFAULT 'planning', ""AssigneeId"" INTEGER NULL,
                    ""Budget"" TEXT NULL, ""QuotedPrice"" TEXT NULL, ""ActualCost"" TEXT NULL,
                    ""ActualRevenue"" TEXT NULL, ""PlanMarkdown"" TEXT NULL,
                    ""DeliveryNotes"" TEXT NULL, ""AdminNote"" TEXT NULL,
                    ""CreatedAt"" TEXT NOT NULL, ""UpdatedAt"" TEXT NOT NULL,
                    ""StartDate"" TEXT NULL, ""EndDate"" TEXT NULL
                );");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Projects_Status"" ON ""Projects"" (""Status"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Projects_CreatedAt"" ON ""Projects"" (""CreatedAt"");");

            migrationBuilder.Sql(@"
                CREATE TABLE ""ProjectTasks"" (
                    ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_ProjectTasks"" PRIMARY KEY AUTOINCREMENT,
                    ""ProjectId"" INTEGER NOT NULL, ""Title"" TEXT NOT NULL DEFAULT '',
                    ""Description"" TEXT NULL, ""Status"" TEXT NOT NULL DEFAULT 'todo',
                    ""SortOrder"" INTEGER NOT NULL DEFAULT 0,
                    ""CreatedAt"" TEXT NOT NULL, ""UpdatedAt"" TEXT NOT NULL
                );");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_ProjectTasks_ProjectId"" ON ""ProjectTasks"" (""ProjectId"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_ProjectTasks_Status"" ON ""ProjectTasks"" (""Status"");");

            migrationBuilder.Sql(@"
                CREATE TABLE ""Decisions"" (
                    ""Id"" INTEGER NOT NULL CONSTRAINT ""PK_Decisions"" PRIMARY KEY AUTOINCREMENT,
                    ""ProjectId"" INTEGER NULL, ""TicketId"" INTEGER NULL,
                    ""Title"" TEXT NOT NULL DEFAULT '', ""Content"" TEXT NOT NULL DEFAULT '',
                    ""DecisionType"" TEXT NOT NULL DEFAULT 'other', ""Outcome"" TEXT NULL,
                    ""DecidedBy"" INTEGER NULL, ""CreatedAt"" TEXT NOT NULL
                );");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Decisions_CreatedAt"" ON ""Decisions"" (""CreatedAt"");");
            migrationBuilder.Sql(@"CREATE INDEX ""IX_Decisions_DecisionType"" ON ""Decisions"" (""DecisionType"");");
        }
    }
}

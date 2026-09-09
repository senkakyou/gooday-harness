using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GoodayTools.Migrations
{
    [Microsoft.EntityFrameworkCore.Infrastructure.DbContext(typeof(GoodayTools.Data.AppDbContext))]
    [Migration("20260909000001_AddToolOwnerVisibility")]
    public partial class AddToolOwnerVisibility : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 定制需求的交付方式改版：做完的东西直接进工具一览，
            // 但只有提需求的人看得见，他自己可以切公开。
            //
            // 【默认值必须是 public】：现存 103 个工具都是站方的（OwnerUserId 为 null），
            // 迁移后必须原样对所有人可见。默认给 private 的话，这条迁移一跑，
            // 整个工具库当场从首页消失——而且不报错。
            migrationBuilder.AddColumn<int>(
                name: "OwnerUserId", table: "Tools", type: "INTEGER", nullable: true);
            migrationBuilder.AddColumn<string>(
                name: "Visibility", table: "Tools", type: "TEXT",
                nullable: false, defaultValue: "public");
            migrationBuilder.AddColumn<int>(
                name: "SourceTicketId", table: "Tools", type: "INTEGER", nullable: true);

            // 按归属人查"我的交付物"是每次打开工具一览都要做的事，加索引
            migrationBuilder.CreateIndex(
                name: "IX_Tools_OwnerUserId", table: "Tools", column: "OwnerUserId");

            // 【不加外键约束】：SQLite 不支持给已有表 ALTER 加外键，EF 只能整表重建——
            // 为一个约束把 103 行的生产表重建一次不划算，风险也不对等。
            // 归属人失效的情况由业务侧处理（可见性判定认不到用户就只剩站长可见）。
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(name: "IX_Tools_OwnerUserId", table: "Tools");
            migrationBuilder.DropColumn(name: "SourceTicketId", table: "Tools");
            migrationBuilder.DropColumn(name: "Visibility", table: "Tools");
            migrationBuilder.DropColumn(name: "OwnerUserId", table: "Tools");
        }
    }
}

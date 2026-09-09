// =====================================================
// Services/ToolVisibility.cs —— 工具可见性判定（全站唯一一份）
//
// 定制需求的交付物直接进工具一览，但只有提需求的人看得见（docs/decisions/005）。
//
// 【为什么单独抽成一处】：第一版把判定写在 ToolsController 里，
// 结果 FavoritesController 完全绕过它——任何登录用户遍历 id 收藏一遍，
// 收藏页就会把全站私有交付物的名字和简介吐出来。文件下不走，
// 但「某某公司报价系统 v2」这种名字本身就是泄露。
// 收藏还有一条非恶意路径：客户公开 → 别人收藏 → 客户改回私有 → 收藏页里永远还在。
//
// 所以：任何按 id/slug 回读工具的地方，都必须过这里。加新接口时也一样。
// =====================================================

using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using GoodayTools.Models;
namespace GoodayTools.Services;

public static class ToolVisibility
{
    /// <summary>当前身份的用户 Id；没登录返回 null。</summary>
    public static int? UserIdOrNull(this ClaimsPrincipal user)
        => int.TryParse(user.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

    /// <summary>
    /// 过滤成「这个身份看得见的工具」。
    ///   站方工具（OwnerUserId 为 null）→ 一律公开
    ///   客户交付物 → public 时公开；private 时只有本人和站长看得到
    /// </summary>
    public static IQueryable<Tool> VisibleTo(this IQueryable<Tool> q, ClaimsPrincipal user)
    {
        if (user.IsInRole("admin")) return q;          // 站长看全部，否则没法排查
        var me = user.UserIdOrNull();
        return q.Where(t => t.Visibility == "public" || (me != null && t.OwnerUserId == me));
    }

    /// <summary>单个工具对这个身份是否可见（判定与上面同一套）。</summary>
    public static bool IsVisibleTo(this Tool t, ClaimsPrincipal user)
        => user.IsInRole("admin")
           || t.Visibility == "public"
           || (t.OwnerUserId != null && t.OwnerUserId == user.UserIdOrNull());
}

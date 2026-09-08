// =====================================================
// Services/UploadRedirectCache.cs —— uploads 旧路径→新路径映射的内存缓存
//
// 为什么要缓存：查这张表的中间件在 UseRateLimiter【之前】，任何匿名请求只要
// 打不中一个 /uploads 文件就会触发一次数据库查询。不缓存的话，
// 一条 `for i in {1..99999}; do curl /uploads/x$i.zip; done` 就是一台免费的放大器。
// 表本身只有一百多行，整张揣在内存里最省事。
//
// 失效由写方显式调用 Invalidate()（改名/移动/归置三处），不靠过期时间——
// 靠 TTL 的话，搬完文件到缓存过期之间的那段时间里，老链接是断的。
// =====================================================

using Microsoft.EntityFrameworkCore;
using GoodayTools.Data;
namespace GoodayTools.Services;

public class UploadRedirectCache(IServiceScopeFactory scopeFactory)
{
    private volatile Dictionary<string, string>? _map;
    private readonly SemaphoreSlim _lock = new(1, 1);

    /// <summary>旧路径 → 新路径。首次访问时从库里装载。</summary>
    public async Task<IReadOnlyDictionary<string, string>> GetAsync()
    {
        var cur = _map;
        if (cur != null) return cur;

        await _lock.WaitAsync();
        try
        {
            // 双检：等锁期间可能已经有人装好了
            if (_map != null) return _map;
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.UploadRedirects.AsNoTracking()
                .Select(r => new { r.OldPath, r.NewPath }).ToListAsync();
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var r in rows) map[r.OldPath] = r.NewPath;   // 同一 OldPath 有唯一索引，重复不会有
            _map = map;
            return map;
        }
        finally { _lock.Release(); }
    }

    /// <summary>表被写过了，下次访问重新装载。</summary>
    public void Invalidate() => _map = null;
}

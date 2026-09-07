// =====================================================
// Controllers/InvestController.cs —— 「投资」模块：收息者买点评分卡
// 路由前缀：/api/invest
// 职责：行情/财务/分红数据代理(腾讯+东财) · 五维评分(A股息30/B可靠25/C买点20/D风险15/E存续10)
//       · 预期年化回报估算 · 击球价反推 · 固定自选列表
// 数据仅为公开行情与财报，输出为研究辅助，非投资建议(前端有免责声明)。
// 缓存：行情60s、K线/财务/分红24h(免费源省着用)。
// 口径要点(2026-07-13 大改)：
//   · 个股买点分位 = 股息率十年分位(不复权价重建),不再用前复权价格分位——
//     前复权把分红扣回历史价,老牌分红股现价永远"处历史高位"(工行分位98),系统性冤枉收息标的
//   · ETF 收益/波动/回撤 = 天天基金累计净值(含分红总回报);买点分位 = 不复权市价
//   · 周期股(煤炭/石油)股息按近5年均值口径折减,防把周期顶点分红当永续
//   · 10年国债收益率每日自动拉东财,失败回退常数
// =====================================================

using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace GoodayTools.Controllers;

[ApiController]
[Route("api/invest")]
public class InvestController : ControllerBase
{
    static readonly HttpClient http = CreateHttp();
    static HttpClient CreateHttp()
    {
        var c = new HttpClient(new HttpClientHandler { AutomaticDecompression = System.Net.DecompressionMethods.All });
        c.Timeout = TimeSpan.FromSeconds(20);
        c.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Gooday-Invest)");
        return c;
    }

    // —— 简易缓存（进程内） ——
    static readonly ConcurrentDictionary<string, (DateTime ts, object data)> _cache = new();
    static async Task<T> Cached<T>(string key, TimeSpan ttl, Func<Task<T>> fetch) where T : class
    {
        if (_cache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.ts < ttl && hit.data is T ok) return ok;
        var v = await fetch();
        _cache[key] = (DateTime.UtcNow, v);
        // 防无限膨胀:任意代码查询会按code积累条目,超阈值时清掉>24h的旧项(2G小机器经不起漏)
        if (_cache.Count > 4000)
            foreach (var k in _cache.Where(x => DateTime.UtcNow - x.Value.ts > TimeSpan.FromHours(24)).Select(x => x.Key).ToList())
                _cache.TryRemove(k, out _);
        return v;
    }

    // —— 固定自选（大海指定） ——
    record Fixed(string Code, string Name, string Industry);
    static readonly Fixed[] Watchlist = {
        new("512890", "红利低波ETF", "ETF基准"),
        new("159545", "恒生红利低波ETF", "ETF基准"),
        new("159209", "红利质量ETF", "ETF基准"),
        new("600900", "长江电力", "公用事业"),
        new("003816", "中国广核", "公用事业"),
        new("000538", "云南白药", "医药消费"),
        new("601318", "中国平安", "保险"),
        new("601398", "工商银行", "银行"),
        new("600941", "中国移动", "运营商"),
        new("600036", "招商银行", "银行"),
        new("000651", "格力电器", "家电"),
    };
    static readonly HashSet<string> FinancialIndustries = new() { "银行", "保险" };
    static readonly HashSet<string> MatureIndustries = new() { "公用事业", "银行", "保险", "医药消费", "高速公路", "铁路", "白酒", "运营商", "家电", "煤炭", "石油", "港口", "水务" };
    static readonly HashSet<string> CyclicalIndustries = new() { "煤炭", "石油" };   // 股息按5年均值口径折减
    // 单一品类集中度惩罚的豁免行业:特许/垄断/牌照类"单一"是护城河(长电水电100%),
    // 金融本就单一业务,周期股已有5年均值折减——只罚竞争性行业(家电/医药/白酒/其他等)
    static readonly HashSet<string> ConcentrationExempt = new() { "银行", "保险", "公用事业", "运营商", "铁路", "港口", "高速公路", "水务", "煤炭", "石油" };

    const double DefaultBondYield = 1.75;   // 十年国债收益率%兜底(自动拉取失败时用;可用 ?bond= 覆盖)

    // 10年国债收益率:东财 RPTA_WEB_TREASURYYIELD 的 EMM00166466 列(日频),12h缓存,失败回退常数
    record Num(double V);
    async Task<double> FetchBondYield()
        => (await Cached("bond10y", TimeSpan.FromHours(12), async () =>
        {
            try
            {
                var raw = await GetText("https://datacenter.eastmoney.com/api/data/get?type=RPTA_WEB_TREASURYYIELD&sty=ALL&st=SOLAR_DATE&sr=-1&p=1&ps=5");
                using var doc = JsonDocument.Parse(raw);
                foreach (var r in doc.RootElement.GetProperty("result").GetProperty("data").EnumerateArray())
                    if (r.TryGetProperty("EMM00166466", out var v) && v.ValueKind == JsonValueKind.Number)
                    {
                        var y = v.GetDouble();
                        if (y is > 0.3 and < 8) return new Num(Math.Round(y, 2));   // 合理区间守卫,防脏数据
                    }
            }
            catch { }
            return new Num(DefaultBondYield);
        })).V;

    // 主营构成(按产品)最大品类占比%——竞争性行业的单一品类=终值风险(格力消费电器78%)。
    // 只取 MAINOP_TYPE=2(按产品)最新报告期,剔除"其他/合计/抵"类目;无产品口径数据→0(不罚)
    async Task<double> FetchTopProductRatio(string code)
        => (await Cached($"mainop:{code}", TimeSpan.FromDays(7), async () =>
        {
            try
            {
                var filter = Uri.EscapeDataString($"(SECUCODE=\"{code}.{Market(code).ToUpper()}\")");
                var raw = await GetText($"https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FN_MAINOP&columns=REPORT_DATE,MAINOP_TYPE,ITEM_NAME,MBI_RATIO&filter={filter}&pageSize=100&sortColumns=REPORT_DATE&sortTypes=-1");
                using var doc = JsonDocument.Parse(raw);
                string latest = ""; double top = 0;
                if (doc.RootElement.TryGetProperty("result", out var res) && res.ValueKind == JsonValueKind.Object
                    && res.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                    foreach (var r in data.EnumerateArray())
                    {
                        if ((r.TryGetProperty("MAINOP_TYPE", out var t) ? t.GetString() : "") != "2") continue;
                        var name = r.TryGetProperty("ITEM_NAME", out var n) ? n.GetString() ?? "" : "";
                        if (name.Contains("其他") || name.Contains("合计") || name.Contains("抵")) continue;
                        var dt = r.TryGetProperty("REPORT_DATE", out var d0) ? d0.GetString() ?? "" : "";
                        if (latest == "") latest = dt;               // 已按报告期倒序,首个type=2即最新期
                        if (dt != latest) break;
                        var ratio = r.TryGetProperty("MBI_RATIO", out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
                        top = Math.Max(top, ratio * 100);
                    }
                return new Num(Math.Round(top, 1));
            }
            catch { return new Num(0); }
        })).V;

    // —— 自选持久化(手动增删;首次由 Watchlist 默认11只初始化) ——
    const string MyWatchPath = "/app/data/invest-mywatch.json";
    static readonly object _watchLock = new();
    static List<Fixed> LoadMyWatch()
    {
        lock (_watchLock)
        {
            try
            {
                if (System.IO.File.Exists(MyWatchPath))
                    return JsonSerializer.Deserialize<List<Fixed>>(System.IO.File.ReadAllText(MyWatchPath)) ?? new();
            }
            catch { }
            var init = Watchlist.ToList();
            try { System.IO.File.WriteAllText(MyWatchPath, JsonSerializer.Serialize(init)); } catch { }
            return init;
        }
    }
    static void SaveMyWatch(List<Fixed> list)
    {
        lock (_watchLock)
        {
            try { System.IO.File.WriteAllText(MyWatchPath, JsonSerializer.Serialize(list)); } catch { }
        }
    }

    public record WatchReq(string? name);

    // POST /api/invest/watch/{code} —— 手动加自选(admin)
    [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin")]
    [HttpPost("watch/{code}")]
    public async Task<IActionResult> AddWatch(string code, [FromBody] WatchReq? req)
    {
        code = new string(code.Where(char.IsDigit).ToArray());
        if (code.Length is >= 1 and <= 4) code = code.PadLeft(5, '0');   // 港股短码补零(700→00700)
        if (code.Length != 6 && code.Length != 5) return BadRequest(new { message = "代码须为6位A股或5位港股数字" });
        bool hk = IsHk(code);
        var list = LoadMyWatch();
        if (list.Any(x => x.Code == code)) return BadRequest(new { message = "已在自选" });
        // 先验行情:代码打错就进自选会让榜单每天多一张error卡,还占一次抓取配额(按市场走对应行情源)
        try { double p = hk ? await FetchHkPrice(code) : (await FetchQuote(code)).Price; if (p <= 0) throw new Exception(); }
        catch { return BadRequest(new { message = "行情查不到该代码,请核对后再加" }); }
        // 港股行业留空由BuildStockCard的MapHkIndustry推断;名字取分红报告口径
        string industry = IsEtf(code) ? "ETF基准" : hk ? "" : await FetchIndustry(code);
        string name = req?.name ?? "";
        if (string.IsNullOrEmpty(name) && !IsEtf(code)) name = (hk ? await FetchHkDividends(code) : await FetchDividends(code)).Name;
        if (string.IsNullOrEmpty(name)) name = code;
        list.Add(new Fixed(code, name, industry));
        SaveMyWatch(list);
        _cache.TryRemove("wl:json", out _);   // 自选变了,榜单结果缓存立即失效
        return Ok(new { ok = true, count = list.Count });
    }

    // DELETE /api/invest/watch/{code} —— 取消自选(admin)
    [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin")]
    [HttpDelete("watch/{code}")]
    public IActionResult RemoveWatch(string code)
    {
        var list = LoadMyWatch();
        int n = list.RemoveAll(x => x.Code == code);
        if (n == 0) return NotFound(new { message = "不在自选" });
        SaveMyWatch(list);
        _cache.TryRemove("wl:json", out _);   // 自选变了,榜单结果缓存立即失效
        return Ok(new { ok = true, count = list.Count });
    }

    static bool IsEtf(string code) => code.Length == 6 && (code.StartsWith("5") || code.StartsWith("15") || code.StartsWith("16") || code.StartsWith("18"));
    static string Market(string code) => (code.StartsWith("6") || code.StartsWith("5")) ? "sh" : "sz";
    // 港股代码为5位(A股/ETF均6位),据此区分市场
    static bool IsHk(string code) => code.Length == 5;
    // 腾讯行情/K线的标的符号:港股 hk 前缀,A股 sh/sz
    static string Sym(string code) => IsHk(code) ? "hk" + code : Market(code) + code;

    // 港股高息ETF(各只仅披露前10大,故取多只拓宽覆盖):港股红利/恒生红利低波/港股通高股息(含汇丰)/港股通红利(含航运)
    static readonly string[] HkPoolEtfs = { "513630", "159545", "513900", "513920" };

    // ---------------- 数据抓取 ----------------

    // 统一取文本：腾讯系接口响应头标 charset=GBK 而 .NET Core 未注册该编码,
    // GetStringAsync 一律会抛 → 全部走字节流手动解码(行情用 Latin-1 保数字,JSON 用 UTF-8)
    static async Task<string> GetText(string url, bool latin1 = false)
    {
        byte[] bytes;
        try { bytes = await http.GetByteArrayAsync(url); }
        catch (Exception) { await Task.Delay(1200); bytes = await http.GetByteArrayAsync(url); }   // 偶发超时重试一次
        return latin1 ? System.Text.Encoding.Latin1.GetString(bytes) : System.Text.Encoding.UTF8.GetString(bytes);
    }

    // 腾讯实时行情：只取数字字段,不解 GBK（价idx3/PE idx39/PB idx46/总市值 idx45）
    // 主源 qt.gtimg.cn 挂了→兜底走 ifzq K线接口的 qt 块(不同域名,同字段布局)
    record Quote(double Price, double Pe, double Pb, double MktCapYi);
    async Task<Quote> FetchQuote(string code)
        => await Cached($"q:{code}", TimeSpan.FromSeconds(60), async () =>
        {
            try
            {
                var raw = await GetText($"https://qt.gtimg.cn/q={Market(code)}{code}", latin1: true);
                var f = raw.Split('~');
                if (f.Length < 48) throw new Exception($"行情返回异常({code})");
                double P(int i) => double.TryParse(f[i], NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0;
                var q = new Quote(P(3), P(39), P(46), P(45));
                if (q.Price > 0) return q;
                throw new Exception($"行情价格为0({code})");
            }
            catch
            {
                var sym = $"{Market(code)}{code}";
                var raw2 = await GetText($"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},month,,,2,qfq");
                using var doc = JsonDocument.Parse(raw2);
                var qt = doc.RootElement.GetProperty("data").GetProperty(sym).GetProperty("qt").GetProperty(sym);
                double P2(int i) => i < qt.GetArrayLength() && qt[i].ValueKind == JsonValueKind.String
                    && double.TryParse(qt[i].GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0;
                if (P2(3) <= 0) throw new Exception($"行情双源均失败({code})");
                return new Quote(P2(3), P2(39), P2(46), P2(45));
            }
        });

    // 腾讯月K(120根≈10年)：fq="qfq"前复权(算收益/波动) / fq=""不复权(算买点分位,防复权漂移)
    async Task<List<(string date, double close)>> FetchMonthly(string code, string fq = "qfq")
        => await Cached($"k:{fq}:{code}", TimeSpan.FromHours(24), async () =>
        {
            var sym = Sym(code);   // 港股 hk 前缀,A股 sh/sz
            var raw = await GetText($"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},month,,,120,{fq}");
            using var doc = JsonDocument.Parse(raw);
            var node = doc.RootElement.GetProperty("data").GetProperty(sym);
            JsonElement arr = default; bool found = false;
            var keys = fq == "" ? new[] { "month" } : new[] { "qfqmonth", "month" };
            foreach (var k in keys)
                if (node.TryGetProperty(k, out arr)) { found = true; break; }
            if (!found) throw new Exception($"K线返回异常({code})");
            var list = new List<(string, double)>();
            foreach (var row in arr.EnumerateArray())
                list.Add((row[0].GetString() ?? "", double.Parse(row[2].GetString() ?? "0", CultureInfo.InvariantCulture)));
            return list;
        });

    // ETF累计净值(天天基金 pingzhongdata,日频→月末采样)=含分红的总回报序列;失败返回null由调用方退化
    async Task<List<(string date, double close)>?> FetchAcWorth(string code)
    {
        try
        {
            return await Cached($"ac:{code}", TimeSpan.FromHours(24), async () =>
            {
                var req = new HttpRequestMessage(HttpMethod.Get, $"https://fund.eastmoney.com/pingzhongdata/{code}.js");
                req.Headers.Referrer = new Uri("https://fund.eastmoney.com/");
                var resp = await http.SendAsync(req);
                var js = System.Text.Encoding.UTF8.GetString(await resp.Content.ReadAsByteArrayAsync());
                var m = System.Text.RegularExpressions.Regex.Match(js, @"Data_ACWorthTrend\s*=\s*(\[\[.*?\]\])");
                if (!m.Success) throw new Exception("无ACWorth数据");
                using var doc = JsonDocument.Parse(m.Groups[1].Value);
                var byMonth = new SortedDictionary<string, (string d, double v)>();   // yyyy-MM → 月末值
                foreach (var p in doc.RootElement.EnumerateArray())
                {
                    if (p.GetArrayLength() < 2 || p[1].ValueKind != JsonValueKind.Number) continue;
                    var dt = DateTimeOffset.FromUnixTimeMilliseconds(p[0].GetInt64()).UtcDateTime.AddHours(8);
                    byMonth[dt.ToString("yyyy-MM")] = (dt.ToString("yyyy-MM-dd"), p[1].GetDouble());
                }
                var list = byMonth.Values.Select(x => (x.d, x.v)).ToList();
                if (list.Count < 6) throw new Exception("ACWorth序列过短");
                if (list.Count > 121) list = list.TakeLast(121).ToList();   // 对齐月K的10年窗口
                return list;
            });
        }
        catch { return null; }
    }

    // 东财年报主要指标（近5年）；Kf=扣非净利(盈利质量红旗用)
    record Annual(int Year, double Roe, double DebtRatio, double CashToProfit, double NetProfit, double NetProfitYoy, double Eps, double Kf);
    async Task<List<Annual>> FetchAnnuals(string code)
        => await Cached($"f:{code}", TimeSpan.FromHours(24), async () =>
        {
            var secu = $"{code}.{Market(code).ToUpper()}";
            var filter = Uri.EscapeDataString($"(SECUCODE=\"{secu}\")(REPORT_TYPE=\"年报\")");
            var raw = await GetText(
                $"https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter={filter}&pageSize=6&sortColumns=REPORT_DATE&sortTypes=-1");
            using var doc = JsonDocument.Parse(raw);
            var list = new List<Annual>();
            if (doc.RootElement.TryGetProperty("result", out var res) && res.ValueKind == JsonValueKind.Object
                && res.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                foreach (var r in data.EnumerateArray())
                {
                    double D(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
                    list.Add(new Annual((int)D("REPORT_YEAR"), D("ROEJQ"), D("ZCFZL"), D("NCO_NETPROFIT"), D("PARENTNETPROFIT"), D("PARENTNETPROFITTZ"), D("EPSJB"), D("KCFJCXSYJLR")));
                }
            return list;
        });

    // 东财分红明细 → ①年度每股分红(按报告期聚合,一年多派会加总;供连续年数/CAGR)
    //               ②TTM每股分红(按【除息日】滚动最近365天实付合计——真·年周期口径,
    //                 防"最新报告年度只进了中期分红"时股息率被腰斩式低估)
    // 接口口径为10派X,须/10。EX_DIVIDEND_DATE 为空=方案未实施,不计入TTM。
    record DivInfo(string Name, Dictionary<int, double> ByYear, double Ttm, int CompleteYear);
    async Task<DivInfo> FetchDividends(string code)
        => await Cached($"d:{code}", TimeSpan.FromHours(24), async () =>
        {
            var filter = Uri.EscapeDataString($"(SECURITY_CODE=\"{code}\")");
            var raw = await GetText(
                $"https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&columns=SECURITY_NAME_ABBR,REPORT_DATE,EX_DIVIDEND_DATE,PRETAX_BONUS_RMB&filter={filter}&pageSize=60&sortColumns=REPORT_DATE&sortTypes=-1");
            using var doc = JsonDocument.Parse(raw);
            var by = new Dictionary<int, double>();          // 报告年度→已实施每股分红合计
            var hasAnnual = new HashSet<int>();              // 该年度的"年报分红"是否已实施
            var today = DateTime.UtcNow.Date;
            string name = "";
            if (doc.RootElement.TryGetProperty("result", out var res) && res.ValueKind == JsonValueKind.Object
                && res.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                foreach (var r in data.EnumerateArray())
                {
                    if (name == "" && r.TryGetProperty("SECURITY_NAME_ABBR", out var nm)) name = nm.GetString() ?? "";
                    var dt = r.GetProperty("REPORT_DATE").GetString() ?? "";
                    if (dt.Length < 7 || !int.TryParse(dt[..4], out var year)) continue;
                    var amt = r.TryGetProperty("PRETAX_BONUS_RMB", out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
                    if (amt <= 0) continue;
                    // 只统计【已除息到手】的钱:公告未实施不算(旧口径会把没到手的算进股息率)
                    var ex = r.TryGetProperty("EX_DIVIDEND_DATE", out var xd) && xd.ValueKind == JsonValueKind.String ? xd.GetString() : null;
                    if (ex == null || !DateTime.TryParse(ex, out var exd) || exd.Date > today) continue;
                    by[year] = by.GetValueOrDefault(year) + amt / 10.0;   // 10派X → 每股;一年多派自动加总
                    if (dt.Substring(5, 2) == "12") hasAnnual.Add(year);  // 报告期12-31=年报分红
                }
            // —— 新浪补缺:东财 RPT_SHAREBONUS_DET 对部分公司的中期分红整体缺失(云南白药实测漏
            //    2024/2025两笔中期,大海发现)——用新浪分红页交叉补齐。只取"除权日为有效日期"的行
            //    (预案未实施行除权日是'--',天然过滤,全程不依赖中文解码);按除权日±2天+金额去重;
            //    补入笔归属=除权年(年报除权在次年但东财年报不缺,漏的都是中期/特别分红,除权年=报告年)。
            try
            {
                var exDates = new List<(DateTime d, double a)>();   // 东财已有(除权日,每股)用于去重
                if (doc.RootElement.TryGetProperty("result", out var res2) && res2.ValueKind == JsonValueKind.Object
                    && res2.TryGetProperty("data", out var data2) && data2.ValueKind == JsonValueKind.Array)
                    foreach (var r in data2.EnumerateArray())
                    {
                        var ex = r.TryGetProperty("EX_DIVIDEND_DATE", out var xd) && xd.ValueKind == JsonValueKind.String ? xd.GetString() : null;
                        var amt = r.TryGetProperty("PRETAX_BONUS_RMB", out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
                        if (ex != null && amt > 0 && DateTime.TryParse(ex, out var exd)) exDates.Add((exd.Date, amt / 10.0));
                    }
                var sina = await GetText($"https://vip.stock.finance.sina.com.cn/corp/go.php/vISSUE_ShareBonus/stockid/{code}.phtml", latin1: true);
                // 只圈定分红表(sharebonus_1)——页面下方还有配股表(sharebonus_2),其"基准股本"列
                // 会被当成派息金额,给配过股的公司记入亿级幻影分红(新奥2018年配股实测中招:
                // 息率分位被12个月天文息率压死在89,重仓价崩到-70%)
                int anchor = sina.IndexOf("id=\"sharebonus_1\"", StringComparison.Ordinal);
                if (anchor >= 0)
                {
                    int tableEnd = sina.IndexOf("</table>", anchor, StringComparison.Ordinal);
                    sina = tableEnd > anchor ? sina[anchor..tableEnd] : sina[anchor..];
                }
                foreach (var tr in sina.Split("</tr>"))
                {
                    var tds = System.Text.RegularExpressions.Regex.Matches(tr, @"<td[^>]*>(.*?)</td>",
                        System.Text.RegularExpressions.RegexOptions.Singleline)
                        .Select(m => System.Text.RegularExpressions.Regex.Replace(m.Groups[1].Value, "<[^>]+>", "").Trim()).ToList();
                    if (tds.Count < 6) continue;
                    if (!double.TryParse(tds[3], NumberStyles.Any, CultureInfo.InvariantCulture, out var pay) || pay <= 0) continue;
                    if (tds[5].Length < 10 || !DateTime.TryParse(tds[5][..10], out var exd2)) continue;   // 无除权日=未实施
                    if (exd2.Date > DateTime.UtcNow.Date) continue;
                    double per = pay / 10.0;
                    if (per > 100) continue;   // 兜底:A股史上最高每股分红量级为几十元(茅台27),再大必是股本数等脏数据
                    bool dup = exDates.Any(x => Math.Abs((x.d - exd2.Date).TotalDays) <= 2 && Math.Abs(x.a - per) < 0.005);
                    if (dup) continue;
                    int gy = exd2.Year;
                    by[gy] = by.GetValueOrDefault(gy) + per;
                    exDates.Add((exd2.Date, per));
                }
            }
            catch { /* 新浪源失败→退化为仅东财,不阻塞 */ }

            // "最近完整已实施财年"口径:最新年度若缺年报分红(只派了中期)=不完整→回退上一年,
            // 防两类系统性偏差:①派息月漂移使365天窗口装下3笔(TTM虚高,如工行) ②只进中期时腰斩(虚低)
            double ttm = 0; int cy = 0;
            if (by.Count > 0)
            {
                int y = by.Keys.Max();
                cy = hasAnnual.Contains(y) || !by.ContainsKey(y - 1) ? y : y - 1;
                ttm = by[cy];
            }
            return new DivInfo(name, by, ttm, cy);
        });

    // ============ 港股数据层(东财 HKF10 + 腾讯 hk 行情) ============
    // 行情:腾讯 hk 前缀(只取现价,PE/PB/市值走东财已算好的口径,避免猜港股行情字段位置)
    async Task<double> FetchHkPrice(string code)
        => (await Cached($"hkq:{code}", TimeSpan.FromSeconds(60), async () =>
        {
            var raw = await GetText($"https://qt.gtimg.cn/q=hk{code}", latin1: true);
            var f = raw.Split('~');
            double p = f.Length > 3 && double.TryParse(f[3], NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0;
            if (p <= 0) throw new Exception($"港股现价为0/异常({code})");
            return new Num(p);
        })).V;

    // 港股主要财务指标(东财 RPT_HKF10_FN_MAININDICATOR):年报行→Annual;最新行→PE_TTM/PB_TTM/市值;
    // 据 NET_INTEREST_INCOME/PREMIUM_INCOME 是否有值判银行/保险(金融股负债率豁免要用)
    record HkFin(List<Annual> Annuals, double PeTtm, double PbTtm, double MktCapYi, string OrgKind);
    async Task<HkFin> FetchHkFinancials(string code)
        => await Cached($"hkfin:{code}", TimeSpan.FromHours(24), async () =>
        {
            var filter = Uri.EscapeDataString($"(SECUCODE=\"{code}.HK\")");
            var raw = await GetText($"https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_HKF10_FN_MAININDICATOR&columns=ALL&filter={filter}&pageSize=24&sortColumns=STD_REPORT_DATE&sortTypes=-1");
            using var doc = JsonDocument.Parse(raw);
            var annuals = new List<Annual>();
            double peTtm = 0, pbTtm = 0, mkt = 0; string kind = "other"; bool first = true;
            if (doc.RootElement.TryGetProperty("result", out var res) && res.ValueKind == JsonValueKind.Object
                && res.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                foreach (var r in data.EnumerateArray())
                {
                    double D(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
                    string S(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
                    if (first)
                    {
                        peTtm = D("PE_TTM"); pbTtm = D("PB_TTM"); mkt = D("TOTAL_MARKET_CAP") / 1e8;
                        if (D("NET_INTEREST_INCOME") != 0) kind = "银行";
                        else if (D("PREMIUM_INCOME") != 0) kind = "保险";
                        first = false;
                    }
                    var rd = S("REPORT_DATE");
                    if (rd.Length >= 7 && rd.Substring(5, 2) == "12" && int.TryParse(rd[..4], out var yr))   // 年报(12-31)
                    {
                        double np = D("HOLDER_PROFIT");
                        annuals.Add(new Annual(yr, D("ROE_AVG"), D("DEBT_ASSET_RATIO"),
                            np != 0 ? D("NETCASH_OPERATE") / np : 0, np, D("HOLDER_PROFIT_YOY"), D("BASIC_EPS"), 0));   // 港股无扣非字段→Kf=0
                    }
                }
            return new HkFin(annuals, peTtm, pbTtm, mkt, kind);
        });

    // 港股分红(东财 RPT_HKF10_INFO_DIVIDEND):金额在 PLAN_EXPLAIN 文本里,正则提港币每股;按财年(中期+末期)聚合。
    // 返回毛息口径(未扣税),税后在 BuildStockCard 里统一×(1-税率)。
    async Task<DivInfo> FetchHkDividends(string code)
        => await Cached($"hkd:{code}", TimeSpan.FromHours(24), async () =>
        {
            var filter = Uri.EscapeDataString($"(SECUCODE=\"{code}.HK\")");
            var raw = await GetText($"https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_HKF10_INFO_DIVIDEND&columns=ALL&filter={filter}&pageSize=80&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1");
            using var doc = JsonDocument.Parse(raw);
            var by = new Dictionary<int, double>(); var hasAnnual = new HashSet<int>();
            var today = DateTime.UtcNow.Date; string name = "";
            if (doc.RootElement.TryGetProperty("result", out var res) && res.ValueKind == JsonValueKind.Object
                && res.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
                foreach (var r in data.EnumerateArray())
                {
                    string S(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
                    if (name == "") name = S("SECURITY_NAME_ABBR");
                    var ex = S("EX_DIVIDEND_DATE");
                    if (ex.Length < 10 || !DateTime.TryParse(ex[..10], out var exd) || exd.Date > today) continue;  // 未除净/未来不计
                    var period = S("ASSIGN_PERIOD");                       // 如 "2025末期"/"2025中期"
                    if (period.Length < 4 || !int.TryParse(period[..4], out var year)) continue;
                    var explain = S("PLAN_EXPLAIN");
                    var m = System.Text.RegularExpressions.Regex.Match(explain, @"港币([\d.]+)元");     // 人民币宣派→"相当于港币X元";港币宣派→"每股派港币X元"
                    if (!m.Success) m = System.Text.RegularExpressions.Regex.Match(explain, @"([\d.]+)\s*港元");
                    if (!m.Success || !double.TryParse(m.Groups[1].Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var hkd) || hkd <= 0) continue;
                    if (explain.Contains("每10股")) hkd /= 10.0;           // 港股一般每股,兜底
                    if (hkd > 100) continue;                              // 脏数据兜底
                    by[year] = by.GetValueOrDefault(year) + hkd;
                    if (period.Contains("末期") || period.Contains("年度")) hasAnnual.Add(year);   // 末期分红=该财年已完整
                }
            double ttm = 0; int cy = 0;
            if (by.Count > 0)
            {
                int y = by.Keys.Max();
                cy = hasAnnual.Contains(y) || !by.ContainsKey(y - 1) ? y : y - 1;
                ttm = by[cy];
            }
            return new DivInfo(name, by, ttm, cy);
        });

    // 港股公司概况(东财 RPT_HKF10_INFO_ORGPROFILE):注册地→H股判定(内地注册=H股;港/开曼/境外=红筹),
    // 行业→东财 BELONG_INDUSTRY(比名称关键词可靠)
    record HkProfile(bool IsHShare, string BelongIndustry, string MainBusiness);
    async Task<HkProfile> FetchHkProfile(string code)
        => await Cached($"hkprof:{code}", TimeSpan.FromDays(7), async () =>
        {
            try
            {
                var filter = Uri.EscapeDataString($"(SECUCODE=\"{code}.HK\")");
                var raw = await GetText($"https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_HKF10_INFO_ORGPROFILE&columns=ALL&filter={filter}&pageSize=1");
                using var doc = JsonDocument.Parse(raw);
                var r = doc.RootElement.GetProperty("result").GetProperty("data")[0];
                string S(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
                var reg = S("REG_PLACE");
                // H股=内地注册企业(REG_PLACE含"中国"且非港澳台);中移动虽用人民币宣派但注册在香港→红筹
                bool hShare = reg.Contains("中国") && !reg.Contains("香港") && !reg.Contains("澳门") && !reg.Contains("台湾");
                var mb = S("MAIN_BUSINESS"); if (mb.Length > 80) mb = mb[..80] + "…";
                return new HkProfile(hShare, S("BELONG_INDUSTRY"), mb);
            }
            catch { return new HkProfile(false, "", ""); }   // 拿不到→保守当红筹(28%)
        });

    // 港股行业推断:银行/保险据财报字段(金融负债率豁免最可靠);其余据东财BELONG_INDUSTRY/名称关键词
    static string MapHkIndustry(string name, string orgKind)
    {
        if (orgKind is "银行" or "保险") return orgKind;
        if (name.Contains("电讯") || name.Contains("电信") || name.Contains("通讯") || name.Contains("移动") || name.Contains("联通")) return "运营商";
        if (name.Contains("航运") || name.Contains("港口")) return "港口";
        if (name.Contains("公用") || name.Contains("电力") || name.Contains("燃气") || name.Contains("水务") || name.Contains("环保") || name.Contains("环境")) return "公用事业";
        if (name.Contains("医") || name.Contains("药") || name.Contains("生物")) return "医药消费";
        if (name.Contains("石油") || name.Contains("石化") || name.Contains("海油") || name.Contains("能源")) return "石油";
        if (name.Contains("煤") || name.Contains("神华") || name.Contains("兖")) return "煤炭";
        if (name.Contains("电力") || name.Contains("华能") || name.Contains("大唐") || name.Contains("燃气") || name.Contains("电网")) return "公用事业";
        if (name.Contains("电信") || name.Contains("移动") || name.Contains("联通") || name.Contains("电讯")) return "运营商";
        if (name.Contains("高速") || name.Contains("公路")) return "高速公路";
        if (name.Contains("港口") || name.Contains("海")) return "港口";
        if (name.Contains("医") || name.Contains("药")) return "医药消费";
        if (name.Contains("银行")) return "银行";
        if (name.Contains("保险") || name.Contains("人寿") || name.Contains("平安")) return "保险";
        return "其他";
    }

    // A/H 配对键:归一公司名(去"股份/集团/(H股)"等差异),让同一公司的A股与H股在前端归组做对比
    static string NormAhKey(string name)
    {
        var s = name ?? "";
        foreach (var t in new[] { "股份", "集团", "有限公司", "(H股)", "（H股）", " ", "-", "Ａ", "Ｈ" }) s = s.Replace(t, "");
        return s;
    }

    // 港股高息池:HkPoolEtfs 持仓合并去重(同股取最大权重),按权重降序
    async Task<List<Holding>> FetchHkPoolHoldings()
    {
        var byCode = new Dictionary<string, Holding>();
        foreach (var etf in HkPoolEtfs)
        {
            try
            {
                foreach (var hz in await FetchEtfHoldings(etf))
                    if (IsHk(hz.Code) && (!byCode.TryGetValue(hz.Code, out var cur) || hz.Weight > cur.Weight))
                        byCode[hz.Code] = hz;
            }
            catch { }
        }
        return byCode.Values.OrderByDescending(x => x.Weight).ToList();
    }
    const int HkPoolCap = 40;   // 港股成分上限

    // 动态成分池来源:一组红利/质量/央企红利 ETF 的持仓,覆盖低波/周期/质量/央企不同风格,
    // 各自抓取后合并去重(白嫖指数公司的选股研究,定期随其调仓自动更新)。
    //   512890 红利低波(银行为主) · 510880 上证红利(周期能源) · 159209 红利质量(优质白马) · 560080 央企红利(医药央企)
    // 每只 ETF 成功即单独落盘;某只接口挂掉时读它自己的旧持仓,防整池静默退化成纯自选。
    static readonly string[] PoolEtfs = { "512890", "510880", "159209", "560080" };
    const int PoolCap = 100;   // 池子(含自选)去重后上限,防无限膨胀拖慢刷新/打爆免费源
    record Holding(string Code, string Name, double Weight);
    static string HoldingsPath(string code) => $"/app/data/invest-holdings-{code}.json";
    async Task<List<Holding>> FetchEtfHoldings(string code)
        => await Cached($"hold:{code}", TimeSpan.FromDays(7), async () =>
        {
            try
            {
                var url = $"https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=100";
                var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Referrer = new Uri("https://fundf10.eastmoney.com/");
                var resp = await http.SendAsync(req);
                var h = System.Text.Encoding.UTF8.GetString(await resp.Content.ReadAsByteArrayAsync());
                var list = new List<Holding>();
                foreach (var tr in h.Split("</tr>"))
                {
                    var m = System.Text.RegularExpressions.Regex.Match(tr, @">(\d{5,6})</a></td><td class='tol'><a[^>]*>([^<]+)</a>");   // 6位=A股/ETF,5位=港股
                    var w = System.Text.RegularExpressions.Regex.Match(tr, @"<td class='tor'>([\d.]+)%</td>");
                    if (m.Success && w.Success)
                        list.Add(new Holding(m.Groups[1].Value, m.Groups[2].Value,
                            double.Parse(w.Groups[1].Value, CultureInfo.InvariantCulture)));
                }
                if (list.Count < 8) throw new Exception($"{code}持仓解析仅{list.Count}只,页面结构可能变了");  // 部分质量类ETF仅披露十余只
                var sorted = list.OrderByDescending(x => x.Weight).ToList();
                try { await System.IO.File.WriteAllTextAsync(HoldingsPath(code), JsonSerializer.Serialize(sorted)); } catch { }
                return sorted;
            }
            catch
            {
                if (System.IO.File.Exists(HoldingsPath(code)))
                {
                    var bak = JsonSerializer.Deserialize<List<Holding>>(await System.IO.File.ReadAllTextAsync(HoldingsPath(code)));
                    if (bak is { Count: >= 8 }) return bak;
                }
                throw;
            }
        });

    // 合并 PoolEtfs 各自持仓 → 去重(同股取跨ETF最大权重)→ 按权重降序,给上层按上限截取
    async Task<List<Holding>> FetchPoolHoldings()
    {
        var byCode = new Dictionary<string, Holding>();
        foreach (var etf in PoolEtfs)
        {
            try
            {
                foreach (var hz in await FetchEtfHoldings(etf))
                    if (!byCode.TryGetValue(hz.Code, out var cur) || hz.Weight > cur.Weight)
                        byCode[hz.Code] = hz;   // 跨ETF去重,保留最大权重(核心红利股权重高)
            }
            catch { /* 单只ETF失败不影响其它,不阻塞 */ }
        }
        return byCode.Values.OrderByDescending(x => x.Weight).ToList();
    }

    // 个股行业(证监会分类→内部词表),供动态成分股的金融豁免/E行业分
    async Task<string> FetchIndustry(string code)
        => await Cached($"ind:{code}", TimeSpan.FromDays(7), async () =>
        {
            var filter = Uri.EscapeDataString("(SECUCODE=\"" + code + "." + Market(code).ToUpper() + "\")");
            var raw = await GetText($"https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO&columns=SECUCODE,INDUSTRYCSRC1&filter={filter}&pageSize=1");
            using var doc = JsonDocument.Parse(raw);
            string csrc = "";
            if (doc.RootElement.TryGetProperty("result", out var res) && res.ValueKind == JsonValueKind.Object
                && res.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0
                && data[0].TryGetProperty("INDUSTRYCSRC1", out var v) && v.ValueKind == JsonValueKind.String)
                csrc = v.GetString() ?? "";
            return MapIndustry(csrc);
        });

    static string MapIndustry(string c)
    {
        if (string.IsNullOrEmpty(c)) return "其他";
        if (c.Contains("银行") || c.Contains("货币金融")) return "银行";
        if (c.Contains("保险")) return "保险";
        if (c.Contains("煤炭")) return "煤炭";
        if (c.Contains("石油")) return "石油";
        if (c.Contains("电力") || c.Contains("燃气")) return "公用事业";
        if (c.Contains("水的生产")) return "水务";
        if (c.Contains("铁路运输")) return "铁路";
        if (c.Contains("水上运输") || c.Contains("装卸")) return "港口";
        if (c.Contains("道路运输")) return "高速公路";
        if (c.Contains("电信")) return "运营商";
        if (c.Contains("家用电器") || c.Contains("电气机械")) return "家电";
        if (c.Contains("医药")) return "医药消费";
        if (c.Contains("酒")) return "白酒";
        // 以下仅用于「显示更清楚」——均不在 成熟/周期/金融/集中度豁免 集合,评分口径完全不变
        if (c.Contains("有色金属")) return "有色金属";
        if (c.Contains("黑色金属") || c.Contains("钢")) return "钢铁";
        if (c.Contains("化学") || c.Contains("化工")) return "化工";
        if (c.Contains("房地产")) return "房地产";
        if (c.Contains("建筑") || c.Contains("土木")) return "建筑";
        if (c.Contains("非金属矿物")) return "建材";
        if (c.Contains("汽车")) return "汽车";
        if (c.Contains("纺织") || c.Contains("服装") || c.Contains("服饰")) return "纺织服装";
        if (c.Contains("食品") || c.Contains("农副")) return "食品";
        if (c.Contains("农") || c.Contains("牧") || c.Contains("渔")) return "农业";
        if (c.Contains("出版") || c.Contains("新闻") || c.Contains("广播") || c.Contains("传媒")) return "传媒";
        if (c.Contains("互联网") || c.Contains("软件") || c.Contains("信息技术")) return "互联网科技";
        if (c.Contains("通用设备") || c.Contains("专用设备") || c.Contains("设备制造")) return "机械设备";
        if (c.Contains("计算机") || c.Contains("电子")) return "电子";
        if (c.Contains("商务服务") || c.Contains("租赁")) return "商务服务";
        if (c.Contains("零售") || c.Contains("批发") || c.Contains("商业")) return "商贸零售";
        if (c.Contains("航空") || c.Contains("航运") || c.Contains("物流") || c.Contains("运输")) return "交通运输";
        if (c.Contains("建材")) return "建材";
        return "其他";
    }

    // 主营业务一句话简介(东财 MAIN_BUSINESS)——详情页给小白一句话看懂"这家做什么"。7天缓存。
    async Task<string> FetchBusiness(string code)
        => await Cached($"biz:{code}", TimeSpan.FromDays(7), async () =>
        {
            try
            {
                var filter = Uri.EscapeDataString($"(SECUCODE=\"{code}.{Market(code).ToUpper()}\")");
                var raw = await GetText($"https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO&columns=SECUCODE,MAIN_BUSINESS,ORG_PROFILE&filter={filter}&pageSize=1");
                using var doc = JsonDocument.Parse(raw);
                if (doc.RootElement.TryGetProperty("result", out var res) && res.ValueKind == JsonValueKind.Object
                    && res.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0)
                {
                    var r = data[0];
                    string S(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? "").Trim() : "";
                    var mb = S("MAIN_BUSINESS");
                    if (!string.IsNullOrWhiteSpace(mb)) return mb.Length > 80 ? mb[..80] + "…" : mb;
                    var pf = S("ORG_PROFILE");
                    if (!string.IsNullOrWhiteSpace(pf)) return pf.Length > 80 ? pf[..80] + "…" : pf;
                }
            }
            catch { }
            return "";
        });

    // ---------------- 计算 ----------------

    static double Percentile(List<double> series, double value)
    {
        if (series.Count == 0) return 50;
        return 100.0 * series.Count(x => x <= value) / series.Count;
    }

    static (double annVol, double maxDrawdown, Dictionary<string, double?> annReturns) PriceStats(List<(string date, double close)> monthly, double price)
    {
        var closes = monthly.Select(m => m.close).ToList();
        var rets = new List<double>();
        for (int i = 1; i < closes.Count; i++)
            if (closes[i - 1] > 0) rets.Add(closes[i] / closes[i - 1] - 1);
        double vol = 0;
        if (rets.Count > 2)
        {
            var mean = rets.Average();
            vol = Math.Sqrt(rets.Sum(r => (r - mean) * (r - mean)) / (rets.Count - 1)) * Math.Sqrt(12) * 100;
        }
        double peak = 0, mdd = 0;
        foreach (var c in closes)
        {
            peak = Math.Max(peak, c);
            if (peak > 0) mdd = Math.Max(mdd, (peak - c) / peak);
        }
        var ann = new Dictionary<string, double?>();
        foreach (var (label, months) in new[] { ("1年", 12), ("2年", 24), ("3年", 36), ("4年", 48), ("5年", 60) })
        {
            if (closes.Count > months && closes[^ (months + 1)] > 0)
                ann[label] = (Math.Pow(price / closes[^(months + 1)], 12.0 / months) - 1) * 100;
            else ann[label] = null;
        }
        return (vol, mdd * 100, ann);
    }

    record Dim(string Key, string Name, double Score, double Max, string Detail);

    // ETF 评分:收益/回撤/波动来自累计净值总回报序列(a5/a3/vol/mdd 由调用方算好传入,
    // 反推击球价时天然不随假设价变);买点分位用不复权市价序列(总回报序列长期上行,分位无意义)
    static (double total, List<Dim> dims) ScoreEtf(double price, List<double> nomCloses, double a5, double a3, double annVol, double mdd, string name, bool trOk)
    {
        var dims = new List<Dim>();
        double a = a5 >= 10 ? 30 : a5 >= 8 ? 24 : a5 >= 6 ? 16 : a5 >= 4 ? 8 : Math.Max(0, a5 * 2);
        dims.Add(new("A", "长期收益", Math.Round(a, 1), 30,
            trOk ? $"总回报年化(5年优先){a5:F1}%(累计净值口径,已含分红)" : $"价格年化{a5:F1}% | 分红源不可用,真实总回报更高(约+股息率)"));
        double b = (a3 >= 0 ? 10 : a3 >= -3 ? 5 : 0) + (mdd <= 20 ? 10 : mdd <= 30 ? 6 : mdd <= 45 ? 3 : 0);
        dims.Add(new("B", "收益稳健", Math.Round(b, 1), 20, $"3年年化{a3:F1}% | 最大回撤{mdd:F0}%"));
        double pct = Percentile(nomCloses, price);
        double c = pct < 20 ? 20 : pct < 35 ? 15 : pct < 50 ? 10 : pct < 65 ? 5 : 0;
        dims.Add(new("C", "买点位置", Math.Round(c, 1), 20, $"市价历史分位{pct:F0}%(不复权)"));
        double dd = annVol < 15 ? 15 : annVol < 20 ? 10 : annVol < 28 ? 5 : 0;
        dims.Add(new("D", "波动风险", Math.Round(dd, 1), 15, $"年化波动{annVol:F0}%"));
        double e = (name.Contains("红利") && name.Contains("低波")) ? 15 : (name.Contains("红利") || name.Contains("低波") || name.Contains("质量")) ? 12 : 8;
        dims.Add(new("E", "品种匹配", Math.Round(e, 1), 15, "红利/低波类与收息目标的贴合度"));
        return (Math.Round(dims.Sum(x => x.Score), 1), dims);
    }

    // 价格无关的风险红旗(2026-07-13加,大海要求把"格力式盲区"规则化):
    // TopRatio=最大品类营收占比%(竞争性行业才罚) Decline2y=净利连续两年下滑
    // DivCut3y=近3个完整年度有削减分红(>20%) KfRatio=扣非/归母(经常性盈利质量)
    record RiskFlags(double TopRatio, bool ConcApplies, bool Decline2y, bool DivCut3y, double KfRatio);

    // 个股评分（分数是价格的函数 → 可反推击球价）
    // yieldSeries = 历史股息率序列(上一完整年度每股分红/当月不复权收盘,%),买点分位的基准
    static (double total, List<Dim> dims) ScoreStock(double price, double pe, double pb,
        List<double> monthlyCloses, double divTtm, Dictionary<int, double> divByYear,
        List<Annual> annuals, string industry, double bondYield, double annVol, List<double> yieldSeries, RiskFlags flags,
        double payoutDiv = -1)   // 分红率(B维)用的每股分红:港股传毛息(公司真派),A股默认=divTtm
    {
        var dims = new List<Dim>();
        bool isFin = FinancialIndustries.Contains(industry);
        double eps = annuals.Count > 0 ? annuals[0].Eps : 0;
        // 价随手动态：PE/PB 按价格等比缩放
        double basePrice = monthlyCloses.Count > 0 ? monthlyCloses[^1] : price;
        double peAdj = pe > 0 && basePrice > 0 ? pe * price / basePrice : 0;
        double pbAdj = pb > 0 && basePrice > 0 ? pb * price / basePrice : 0;

        // A 股息收益 30 —— 2026-07-13重标定:老档"息5%+利差2.5"即满分,半个池子顶格,
        // 49元的平安和40元的平安一个分。满分留给真肥球(息7%+利差4.5),锚=平安2024年40元≈重仓
        double dy = price > 0 ? divTtm / price * 100 : 0;
        double a1 = dy >= 7 ? 15 : dy >= 6 ? 12.5 : dy >= 5.5 ? 11 : dy >= 5 ? 9 : dy >= 4.5 ? 7 : dy >= 4 ? 5 : dy >= 3.5 ? 3 : dy >= 3 ? 1.5 : 0;
        double spread = dy - bondYield;
        double a2 = spread >= 4.5 ? 15 : spread > 0 ? 15 * spread / 4.5 : 0;
        dims.Add(new("A", "股息收益", Math.Round(a1 + a2, 1), 30, $"股息率{dy:F2}% | 对国债利差{spread:F2}pct"));

        // B 股息可靠性 25
        int contYears = 0;
        if (divByYear.Count > 0)
        {
            int y = divByYear.Keys.Max();
            while (divByYear.ContainsKey(y - contYears)) contYears++;
        }
        double b1 = contYears >= 10 ? 8 : contYears >= 5 ? 5 : contYears >= 3 ? 2 : 0;
        // 分红率=公司真实派息/EPS(可持续性指标),港股用毛息(不扣投资者红利税);A股 payoutDiv<0 时退回 divTtm
        double payout = eps > 0 ? (payoutDiv >= 0 ? payoutDiv : divTtm) / eps * 100 : 0;
        double b2 = payout is >= 40 and <= 80 ? 7 : payout is >= 30 and < 40 or > 80 and <= 95 ? 4 : payout > 0 ? 1 : 0;
        double cashRatio = annuals.Count > 0 ? annuals[0].CashToProfit : 0;
        double b3 = cashRatio >= 1.2 ? 5 : cashRatio >= 1.0 ? 3 : cashRatio >= 0.8 ? 1 : 0;
        double b4 = 0;
        var profits = annuals.Select(x => x.NetProfit).Where(x => x > 0).ToList();
        if (profits.Count >= 4)
        {
            var mean = profits.Average();
            var cv = Math.Sqrt(profits.Sum(x => (x - mean) * (x - mean)) / (profits.Count - 1)) / mean;
            b4 = cv < 0.15 ? 5 : cv < 0.25 ? 3 : cv < 0.35 ? 1 : 0;
        }
        double bPen = 0; string bFlag = "";
        if (flags.DivCut3y) { bPen += 3; bFlag += " | ⚠近3年有削减分红"; }
        if (flags.KfRatio != 0 && flags.KfRatio < 0.6) { bPen += 2; bFlag += $" | ⚠扣非仅占归母{flags.KfRatio * 100:F0}%"; }   // 负值=扣非亏损,更要罚
        dims.Add(new("B", "股息可靠性", Math.Round(Math.Max(0, b1 + b2 + b3 + b4 - bPen), 1), 25,
            $"连续分红{contYears}年 | 分红率{payout:F0}% | 现金流/净利{cashRatio:F2}{bFlag}"));

        // C 买点估值 20 —— 股息率十年分位(高=息率处历史高位=便宜),替代前复权价格分位:
        // 前复权把分红扣回历史价,分红越久现价分位越高,恰好惩罚收息模型想找的标的
        // 短历史守卫:分红年数<4 或月度点<24,股息率分位不可靠→C1给中性4分,不凭虚假分位判"便宜"
        bool shortHist = divByYear.Count(x => x.Value > 0) < 4 || yieldSeries.Count < 24;
        double dyPct = divTtm > 0 && yieldSeries.Count > 0 ? Percentile(yieldSeries, dy) : 0;
        double c1 = shortHist ? 4 : dyPct >= 95 ? 10 : dyPct >= 85 ? 8 : dyPct >= 70 ? 6 : dyPct >= 55 ? 4 : dyPct >= 40 ? 2 : 0;
        double c2 = peAdj <= 0 ? 0 : peAdj <= 7 ? 5 : peAdj <= 10 ? 4 : peAdj <= 15 ? 3 : peAdj <= 20 ? 2 : peAdj <= 25 ? 1 : 0;
        double c3 = pbAdj <= 0 ? 0 : pbAdj <= 0.7 ? 5 : pbAdj <= 1 ? 4 : pbAdj <= 1.5 ? 3 : pbAdj <= 2.5 ? 2 : pbAdj <= 3.5 ? 1 : 0;
        dims.Add(new("C", "买点估值", Math.Round(c1 + c2 + c3, 1), 20,
            (shortHist ? "股息率历史不足(仅供参考)" : $"股息率十年分位{dyPct:F0}%(高=便宜)") + $" | PE {peAdj:F1} | PB {pbAdj:F2}"));

        // D 风险 15（金融股负债率不适用,给基准4分）——好公司仍满档(债<60/波动<20/正增长各5),只加细分把中段/差段拉开
        double debt = annuals.Count > 0 ? annuals[0].DebtRatio : 0;
        double d1 = isFin ? 4 : debt <= 0 ? 3 : debt < 60 ? 5 : debt < 70 ? 3 : debt < 80 ? 1 : 0;   // 好(<60)不变5,加<80→1档
        double d2 = annVol < 18 ? 5 : annVol < 24 ? 4 : annVol < 30 ? 3 : annVol < 38 ? 1 : 0;        // 低波不变5,20-24拉到4
        double yoy = annuals.Count > 0 ? annuals[0].NetProfitYoy : 0;
        double d3 = flags.Decline2y ? 0 : yoy >= 0 ? 5 : yoy >= -8 ? 3 : yoy >= -20 ? 1 : 0;           // 正增长不变5,只细分下跌段
        dims.Add(new("D", "风险", Math.Round(d1 + d2 + d3, 1), 15,
            (isFin ? "金融股不计负债率" : $"负债率{debt:F0}%") + $" | 年化波动{annVol:F0}% | 净利同比{yoy:F1}%"
            + (flags.Decline2y ? " | ⚠净利连续两年下滑" : "")));

        // E 生意存续 10 —— 基础(ROE 5 + 成熟行业 3)保持好公司满档不掉;耐用性加分(0-2)拉开差距:
        //   ROE常年稳 + 利润不萎缩 = 耐用印钞机(长电得满);ROE忽高忽低/利润下台阶 = 脆弱(达仁堂扣2)。
        var roes = annuals.Select(x => x.Roe).Where(x => x != 0).ToList();
        double avgRoe = roes.Count > 0 ? roes.Average() : 0;
        double e1 = avgRoe >= 12 ? 5 : avgRoe >= 10 ? 4 : avgRoe >= 8 ? 2 : 0;   // 旧口径,好公司不掉
        double e2 = MatureIndustries.Contains(industry) ? 3 : 2;                 // 成熟行业(旧5/3→3/2,腾出耐用性加分空间)
        // ROE稳定性(变异系数);利润长期趋势(近年归母净利对数回归斜率≥0=没萎缩)
        double roeCv = 99;
        if (roes.Count >= 3 && Math.Abs(avgRoe) > 0.01)
            roeCv = Math.Sqrt(roes.Sum(x => (x - avgRoe) * (x - avgRoe)) / (roes.Count - 1)) / Math.Abs(avgRoe);
        bool stable = roes.Count < 3 || roeCv < 0.30;   // 数据不足按稳(不误伤)
        bool notShrink = true;
        var npPts = annuals.Where(a => a.NetProfit > 0).Select(a => ((double)a.Year, Math.Log(a.NetProfit))).ToList();
        if (npPts.Count >= 4)
        {
            double mx = npPts.Average(p => p.Item1), my = npPts.Average(p => p.Item2);
            double den = npPts.Sum(p => (p.Item1 - mx) * (p.Item1 - mx));
            double slope = den != 0 ? npPts.Sum(p => (p.Item1 - mx) * (p.Item2 - my)) / den : 0;
            notShrink = slope >= -0.01;
        }
        double e3 = (stable ? 1 : 0) + (notShrink ? 1 : 0);   // 耐用性加分 0-2
        double ePen = flags.ConcApplies ? (flags.TopRatio >= 85 ? 4 : flags.TopRatio >= 70 ? 2 : 0) : 0;
        string roeStab = roes.Count < 3 ? "" : roeCv < 0.30 ? "·稳" : "·波动";
        dims.Add(new("E", "生意存续", Math.Round(Math.Max(0, e1 + e2 + e3 - ePen), 1), 10,
            $"ROE五年均{avgRoe:F1}%{roeStab} | {(notShrink ? "利润未萎缩" : "⚠利润长期萎缩")} | 行业:{industry}"
            + (ePen > 0 ? $" | ⚠单一品类占营收{flags.TopRatio:F0}%" : "")));

        return (Math.Round(dims.Sum(d => d.Score), 1), dims);
    }

    static string Grade(double s) => s >= 80 ? "击球区" : s >= 65 ? "逼近区" : s >= 50 ? "观察区" : "不符合";

    // ---------------- 接口 ----------------

    const string SnapshotPath = "/app/data/invest-snapshot.json";   // gooday_data 卷,重启不丢

    // —— 防滥用(接口匿名可访问,须防被刷到上游封IP) ——
    static DateTime _lastRefresh = DateTime.MinValue;                 // refresh=1 节流
    static int _bgBuilding;                                           // 冷启动后台重建防重入
    static readonly ConcurrentDictionary<string, (DateTime win, int n)> _ipHits = new();
    string ClientIp() => Request.Headers.TryGetValue("X-Real-IP", out var xr) && xr.Count > 0
        ? xr[0]!.Trim() : HttpContext.Connection.RemoteIpAddress?.ToString() ?? "?";
    static bool RateLimited(string ip, int perMinute)
    {
        var now = DateTime.UtcNow;
        var e = _ipHits.AddOrUpdate(ip, _ => (now, 1),
            (_, old) => now - old.win > TimeSpan.FromMinutes(1) ? (now, 1) : (old.win, old.n + 1));
        if (_ipHits.Count > 5000)
            foreach (var k in _ipHits.Where(x => now - x.Value.win > TimeSpan.FromMinutes(2)).Select(x => x.Key).ToList())
                _ipHits.TryRemove(k, out _);
        return e.n > perMinute;
    }

    // GET /api/invest/watchlist —— 固定自选汇总
    // ?refresh=1 强制重拉(供每日收盘后 cron 定点更新;10分钟节流防匿名滥用清缓存打上游)
    // 默认参数结果缓存10分钟(评分是纯计算但41只×千余次反推不便宜);冷启动秒回快照并后台重建
    [HttpGet("watchlist")]
    public async Task<IActionResult> GetWatchlist([FromQuery] double? bond, [FromQuery] int refresh = 0)
    {
        if (refresh == 1 && DateTime.UtcNow - _lastRefresh < TimeSpan.FromMinutes(10)) refresh = 0;
        if (refresh == 1)
        {
            _lastRefresh = DateTime.UtcNow;
            _cache.Clear();
        }
        else if (_cache.IsEmpty && System.IO.File.Exists(SnapshotPath))
        {
            // 冷启动:先秒回昨日快照,后台异步重建缓存+新快照(下次访问即新数据);防重入
            var snap = await System.IO.File.ReadAllTextAsync(SnapshotPath);
            if (Interlocked.CompareExchange(ref _bgBuilding, 1, 0) == 0)
                _ = Task.Run(async () =>
                {
                    try { await Cached("wl:json", TimeSpan.FromMinutes(10), () => BuildWatchlistAsync(null, save: true)); }
                    finally { Interlocked.Exchange(ref _bgBuilding, 0); }
                });
            return Content(snap, "application/json");
        }
        if (bond == null && refresh == 0)
        {
            // 后台正在重建且结果缓存未就绪→继续回快照,避免并发double-build浪费上游配额
            if (_bgBuilding == 1 && !_cache.ContainsKey("wl:json") && System.IO.File.Exists(SnapshotPath))
                return Content(await System.IO.File.ReadAllTextAsync(SnapshotPath), "application/json");
            return Content(await Cached("wl:json", TimeSpan.FromMinutes(10), () => BuildWatchlistAsync(null, save: true)), "application/json");
        }
        var json = await BuildWatchlistAsync(bond, save: bond == null);
        if (bond == null) _cache["wl:json"] = (DateTime.UtcNow, json);   // refresh 的新结果直接顶入结果缓存
        return Content(json, "application/json");
    }

    // 构建 watchlist JSON;save=true 时落盘快照(仅默认参数的结果才落,避免 ?bond= 试算污染快照)
    // bondOverride=null 时自动拉10年国债收益率。单只抓取失败→沿用上次快照该只数据并标 stale,
    // 快照永远保留"最后一次成功"的卡片,不再因任何一只源抽风就整天不更新
    async Task<string> BuildWatchlistAsync(double? bondOverride, bool save)
    {
        double bondYield = bondOverride ?? await FetchBondYield();
        // 池 = 固定自选 + 4只红利ETF合并成分(去重,自选优先);总数上限 PoolCap;行业按证监会分类映射
        var myWatch = LoadMyWatch();
        var pool = new List<(Fixed w, string source)>(myWatch.Select(w => (w, "自选")));
        try
        {
            var known = new HashSet<string>(myWatch.Select(x => x.Code));
            int room = PoolCap - myWatch.Count;   // 自选恒进,ETF成分填满剩余名额
            // 排除自选已含、排除ETF自身(如自选里的基准ETF),按权重取到上限
            var holds = (await FetchPoolHoldings())
                .Where(x => !known.Contains(x.Code) && !IsEtf(x.Code) && !IsHk(x.Code))
                .Take(Math.Max(0, room)).ToList();
            foreach (var hz in holds)
                pool.Add((new Fixed(hz.Code, hz.Name, await FetchIndustry(hz.Code)), "红利成分"));
        }
        catch { /* 持仓源失败→退化为仅自选,不阻塞 */ }
        // 港股高息池:HkPoolEtfs 成分,行业留空由 BuildStockCard 的 MapHkIndustry 推断,上限 HkPoolCap
        try
        {
            var have = new HashSet<string>(pool.Select(x => x.w.Code));
            var hk = (await FetchHkPoolHoldings())
                .Where(x => !have.Contains(x.Code)).Take(HkPoolCap).ToList();
            foreach (var hz in hk)
                pool.Add((new Fixed(hz.Code, hz.Name, ""), "港股红利"));
        }
        catch { /* 港股源失败→不影响A股,不阻塞 */ }

        // 并行抓取,限流5并发(免费源友好)
        var gate = new SemaphoreSlim(5);
        var tasks = pool.Select(async pw =>
        {
            var w = pw.w;
            await gate.WaitAsync();
            try
            {
                object card = IsEtf(w.Code)
                    ? await BuildEtfCard(w.Code, w.Name, bondYield, pw.source)
                    : await BuildStockCard(w.Code, w.Name, w.Industry, bondYield, pw.source);
                return (code: w.Code, card, ok: true);
            }
            catch (Exception e)
            {
                return (code: w.Code, card: (object)new { code = w.Code, name = w.Name, error = e.Message }, ok: false);
            }
            finally { gate.Release(); }
        }).ToArray();
        var results = await Task.WhenAll(tasks);

        // 失败的票 → 用上次快照里的旧卡顶上(标 stale),只有从没成功过的才输出 error 卡
        var old = new Dictionary<string, JsonElement>();
        try
        {
            if (System.IO.File.Exists(SnapshotPath))
            {
                using var doc = JsonDocument.Parse(await System.IO.File.ReadAllTextAsync(SnapshotPath));
                if (doc.RootElement.TryGetProperty("items", out var arr) && arr.ValueKind == JsonValueKind.Array)
                    foreach (var it in arr.EnumerateArray())
                        if (it.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String && !it.TryGetProperty("error", out _))
                            old[c.GetString()!] = it.Clone();
            }
        }
        catch { }
        int errors = 0;
        var items = new List<object>();
        foreach (var r in results)
        {
            if (r.ok) { items.Add(r.card); continue; }
            errors++;
            if (old.TryGetValue(r.code, out var prev))
            {
                var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(prev.GetRawText())!;
                dict["stale"] = JsonSerializer.SerializeToElement(true);
                items.Add(dict);
            }
            else items.Add(r.card);
        }
        var payload = JsonSerializer.Serialize(new { bondYield, updatedAt = DateTime.UtcNow, errors, items });
        if (save)
            try { await System.IO.File.WriteAllTextAsync(SnapshotPath, payload); } catch { /* 快照写失败不影响响应 */ }
        return payload;
    }

    // GET /api/invest/stock/600900 —— 任意个股详情
    [HttpGet("stock/{code}")]
    public async Task<IActionResult> GetStock(string code, [FromQuery] double? bond)
    {
        // 每IP每分钟20次:人手点详情绰绰有余,挡住脚本遍历代码把本机IP刷进上游黑名单
        if (RateLimited(ClientIp(), 20)) return StatusCode(429, new { message = "查询太频繁,请一分钟后再试" });
        code = new string(code.Where(char.IsDigit).ToArray());
        if (code.Length != 6 && code.Length != 5) return BadRequest(new { message = "代码须为6位A股或5位港股数字" });
        var my = LoadMyWatch();
        var known = my.FirstOrDefault(x => x.Code == code);
        string src = known != null ? "自选" : "查询";
        try
        {
            double bondYield = bond ?? await FetchBondYield();
            if (IsEtf(code))
                return Ok(await BuildEtfCard(code, known?.Name ?? code, bondYield, src));
            // 港股行业由 BuildStockCard 内 MapHkIndustry 推断,不调A股FetchIndustry
            var industry = known?.Industry ?? (IsHk(code) ? "" : await FetchIndustry(code));
            var card = await BuildStockCard(code, known?.Name, industry, bondYield, src, withIntro: true);
            return Ok(card);
        }
        catch (Exception e) { return StatusCode(502, new { message = $"数据源异常:{e.Message}" }); }
    }

    // GET /api/invest/debug/score-inputs/600900 —— admin专用:吐 ScoreStock 未取整输入向量+输出,供回测Python端口金标核对
    [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin")]
    [HttpGet("debug/score-inputs/{code}")]
    public async Task<IActionResult> DebugScoreInputs(string code, [FromQuery] double? bond)
    {
        code = new string(code.Where(char.IsDigit).ToArray());
        if (code.Length != 6 && code.Length != 5) return BadRequest(new { message = "代码须为6位A股或5位港股数字" });
        if (IsEtf(code)) return BadRequest(new { message = "ETF评分逻辑不同,此端点仅个股" });
        try
        {
            double bondYield = bond ?? await FetchBondYield();
            var my = LoadMyWatch();
            var known = my.FirstOrDefault(x => x.Code == code);
            var industry = known?.Industry ?? (IsHk(code) ? "" : await FetchIndustry(code));
            var card = await BuildStockCard(code, known?.Name, industry, bondYield, known != null ? "自选" : "查询", debug: true);
            return Ok(card);
        }
        catch (Exception e) { return StatusCode(502, new { message = $"数据源异常:{e.Message}" }); }
    }

    // GET /api/invest/backtest-report —— 评分模型历史回测验证结果(离线Python产出,写入data卷,前端展示"已验证")
    [HttpGet("backtest-report")]
    public IActionResult BacktestReport()
    {
        var path = "/app/data/invest-backtest-report.json";
        if (!System.IO.File.Exists(path)) return NotFound(new { message = "尚无回测报告" });
        return Content(System.IO.File.ReadAllText(path), "application/json; charset=utf-8");
    }

    async Task<object> BuildEtfCard(string code, string fallbackName, double bondYield, string source)
    {
        var q = await FetchQuote(code);
        double price = q.Price;
        if (price <= 0) throw new Exception("现价为0(停牌或代码有误)");
        // 总回报序列=累计净值(含分红);拉不到→退化为前复权价格口径。买点分位单独用不复权市价
        var ac = await FetchAcWorth(code);
        bool trOk = ac != null;
        var tr = ac ?? await FetchMonthly(code);
        var nomMonthly = await FetchMonthly(code, "");
        var nomCloses = nomMonthly.Select(m => m.close).ToList();
        var trAnchor = trOk ? tr[^1].close : price;   // 净值口径锚定序列末值;退化口径锚定市价
        var (vol, mdd, ann) = PriceStats(tr, trAnchor);
        double a5 = ann.GetValueOrDefault("5年") ?? ann.GetValueOrDefault("3年") ?? ann.GetValueOrDefault("1年") ?? 0;
        double a3 = ann.GetValueOrDefault("3年") ?? ann.GetValueOrDefault("1年") ?? 0;
        var (total, dims) = ScoreEtf(price, nomCloses, a5, a3, vol, mdd, fallbackName, trOk);
        double strike = 0, heavy = 0;
        if (total >= 80) strike = price;
        else for (double p2 = price; p2 >= price * 0.4; p2 *= 0.995)
        { var (s2, _) = ScoreEtf(p2, nomCloses, a5, a3, vol, mdd, fallbackName, trOk); if (s2 >= 80) { strike = Math.Round(p2, 3); break; } }
        if (total >= 90) heavy = price;
        else for (double p2 = price; p2 >= price * 0.3; p2 *= 0.995)
        { var (s2, _) = ScoreEtf(p2, nomCloses, a5, a3, vol, mdd, fallbackName, trOk); if (s2 >= 90) { heavy = Math.Round(p2, 3); break; } }
        var best = dims.OrderByDescending(x => x.Score / x.Max).First();
        var worst = dims.OrderBy(x => x.Score / x.Max).First();
        string action = total >= 80 ? "可作底仓分批配置" : total >= 65 ? "等回调再配" : "先观察";
        string verdict = $"{best.Name}是强项({best.Score}/{(int)best.Max}),{worst.Name}拖后腿({worst.Score}/{(int)worst.Max})——{action}。";
        double pct = Percentile(nomCloses, price);
        // 预期年化=长短窗口取小(悲观者赢);次新基金只有短窗口,夹在[-10,15]内防把一年行情当永续
        double expReturn = Math.Round(Math.Clamp(Math.Min(a5, a3) + (pct > 70 ? -1 : 0), -10, 15), 1);
        var fit = new List<string> { "不想挑个股、要一篮子吃息的人", "定投打底仓的人" };
        var unfit = new List<string>();
        if (pct > 70) unfit.Add("现在追高的人(市价处历史高位)");
        unfit.Add("追求跑赢指数超额收益的人");
        // 走势图用不复权市价(与现价/击球价同尺度;总回报数字在 annReturns 里)
        int step = Math.Max(1, (int)Math.Ceiling(nomMonthly.Count / 60.0));
        var sampled = nomMonthly.Where((_, i) => i % step == 0 || i == nomMonthly.Count - 1).ToList();
        return new
        {
            code, name = fallbackName, industry = "ETF", source, type = "etf",
            market = "a", currency = "¥", ahKey = "",
            price, pe = (double?)null, pb = (double?)null, mktCapYi = (double?)null,
            divTtm = (double?)null, divYield = (double?)null,
            score = total, grade = Grade(total),
            dims = dims.Select(d => new { d.Key, d.Name, d.Score, d.Max, d.Detail }),
            expReturn,
            expReturnNote = expReturn >= 8 ? "达到红利基准区间" : "低于红利基准,等更好价格",
            strikePrice = strike > 0 ? strike : (double?)null,
            strikeNote = total >= 80 ? "当前已在击球区" : strike > 0 ? $"跌至 ¥{strike:F3} 进入击球区(≥80分)" : "步进至-60%仍未到80分",
            verdict,
            buyBands = new { suggest = strike > 0 ? strike : (double?)null, heavy = heavy > 0 ? heavy : (double?)null },
            paybackYears = (int?)null,
            suitability = new { fit, unfit },
            spark = new { dates = sampled.Select(m => m.date), closes = sampled.Select(m => m.close) },
            sparkNote = "市价(不复权)",
            pricePercentile10y = Math.Round(pct, 0),
            annVol = Math.Round(vol, 1), maxDrawdown10y = Math.Round(mdd, 1), annReturns = ann,
            trBased = trOk,
            bondYield, asOf = DateTime.UtcNow,
            note = trOk ? "ETF按累计净值总回报口径评分(收益已含分红);现金分红细节以基金公告为准"
                        : "分红数据源暂不可用,本次按价格口径评分(真实总回报更高);现金分红以基金公告为准",
            disclaimer = "免费公开数据+规则打分,为研究辅助,不构成投资建议"
        };
    }

    async Task<object> BuildStockCard(string code, string? fallbackName, string industry, double bondYield, string source = "自选", bool debug = false, bool withIntro = false)
    {
        // ── 数据抓取按市场分流(港股:东财HKF10+腾讯hk行情+港股通税后息;A股:腾讯+东财) ──
        bool hk = IsHk(code);
        double price, pe, pb, mktCap;
        List<(string date, double close)> monthly;
        List<Annual> annuals;
        DivInfo div;
        double grossTtm = 0;      // 港股毛息(未扣税),仅展示用
        bool hkIsHShare = false; double hkTaxRate = 0;
        string intro = "";   // 主营一句话简介(仅详情页 withIntro 时取,列表不额外拉)
        if (hk)
        {
            price = await FetchHkPrice(code);
            if (price <= 0) throw new Exception("现价为0(停牌或代码有误)");
            var fin = await FetchHkFinancials(code);
            var prof = await FetchHkProfile(code);
            if (withIntro) intro = prof.MainBusiness;
            pe = fin.PeTtm; pb = fin.PbTtm; mktCap = fin.MktCapYi; annuals = fin.Annuals;
            monthly = await FetchMonthly(code, "");   // 不复权
            var draw = await FetchHkDividends(code);
            industry = MapHkIndustry(!string.IsNullOrEmpty(prof.BelongIndustry) ? prof.BelongIndustry : draw.Name, fin.OrgKind);
            grossTtm = draw.Ttm;
            // 港股通红利税精准区分:H股(内地注册)20% / 红筹·港股本地(境外注册)28%
            hkIsHShare = prof.IsHShare; hkTaxRate = hkIsHShare ? 0.20 : 0.28;
            double k = 1 - hkTaxRate;   // 税后口径贯穿评分(削减/增长等比率类红旗不受常数影响)
            div = draw with { ByYear = draw.ByYear.ToDictionary(x => x.Key, x => x.Value * k), Ttm = draw.Ttm * k };
        }
        else
        {
            var q = await FetchQuote(code);
            price = q.Price; pe = q.Pe; pb = q.Pb; mktCap = q.MktCapYi;
            if (price <= 0) throw new Exception("现价为0(停牌或代码有误)");
            if (withIntro) intro = await FetchBusiness(code);
            // A股一律用不复权序列:腾讯前复权是减法复权,大额分红股历史价会被扣成负数/近零
            // (神华2016年qfq=-5.7),波动/回撤/年化全是废数。价格口径不含分红,股息价值在A维度体现
            monthly = await FetchMonthly(code, "");
            annuals = await FetchAnnuals(code);
            div = await FetchDividends(code);
        }
        var name = string.IsNullOrEmpty(div.Name) ? (fallbackName ?? code) : div.Name;
        double divTtm = div.Ttm;   // 最近完整已实施财年每股分红(港股为税后)

        // 僵尸股息守卫:最近完整分红财年落后超一个财年=实质已停付,股息按0计——
        // 防止拿两年前的分红算出漂亮股息率(实操大坑:停派股照样显示高息)
        string zombieNote = "";
        if (div.CompleteYear > 0 && div.CompleteYear < DateTime.UtcNow.Year - 2)
        {
            zombieNote = $"最近分红财年为{div.CompleteYear},已停付,股息按0计";
            divTtm = 0;
        }

        // 价格无关的风险红旗(详见 RiskFlags 注释)
        bool concApplies = !hk && !ConcentrationExempt.Contains(industry);   // 主营构成仅A股口径,港股跳过(优雅降级)
        double topRatio = concApplies ? await FetchTopProductRatio(code) : 0;
        bool decline2y = annuals.Count >= 2 && annuals[0].NetProfitYoy < 0 && annuals[1].NetProfitYoy < 0;
        bool divCut3y = false;
        for (int i = 0; i <= 2 && !divCut3y; i++)
            if (div.ByYear.TryGetValue(div.CompleteYear - i, out var cur) && div.ByYear.TryGetValue(div.CompleteYear - i - 1, out var prv)
                && prv > 0 && cur < prv * 0.8) divCut3y = true;
        double kfRatio = annuals.Count > 0 && annuals[0].NetProfit > 0 && annuals[0].Kf != 0
            ? annuals[0].Kf / annuals[0].NetProfit : 0;
        var flags = new RiskFlags(topRatio, concApplies, decline2y, divCut3y, kfRatio);

        // 周期股(煤炭/石油)防"把周期顶点分红当永续":打分与预期收益用近5年均值口径(取小)
        double divScore = divTtm;
        string cycNote = "";
        if (CyclicalIndustries.Contains(industry) && div.CompleteYear > 0)
        {
            var recent = Enumerable.Range(0, 5).Select(i => div.ByYear.GetValueOrDefault(div.CompleteYear - i)).Where(v => v > 0).ToList();
            if (recent.Count > 0 && recent.Average() < divTtm)
            {
                divScore = recent.Average();
                cycNote = $"周期股按5年均值口径(每股{divScore:F2}元)";
            }
        }

        // 历史股息率序列:上一完整年度每股分红/当月不复权收盘(与当前点"完整财年分红/现价"同口径)
        var closes = monthly.Select(m => m.close).ToList();
        var yieldSeries = new List<double>();
        foreach (var (d0, c0) in monthly)
        {
            if (c0 <= 0 || d0.Length < 4 || !int.TryParse(d0[..4], out var yy)) continue;
            var dv = div.ByYear.GetValueOrDefault(yy - 1);
            if (dv > 0) yieldSeries.Add(dv / c0 * 100);
        }

        var (vol, mdd, ann) = PriceStats(monthly, price);
        double payoutDiv = hk ? grossTtm : -1.0;   // 分红率用毛息:港股传税前每股,A股-1退回divTtm
        var (total, dims) = ScoreStock(price, pe, pb, closes, divScore, div.ByYear, annuals, industry, bondYield, vol, yieldSeries, flags, payoutDiv);
        if (cycNote != "") dims[0] = dims[0] with { Detail = dims[0].Detail + " | " + cycNote };
        if (zombieNote != "") dims[0] = dims[0] with { Detail = dims[0].Detail + " | ⚠" + zombieNote };

        // 预期年化回报（保守）= 股息率 + 分红增长打对折(封顶6) + 股息率分位修正
        double dy = divScore / price * 100;
        // 分红增长:近8个完整年度的对数回归斜率(≥5个点),比首尾两点CAGR抗单年异常;点不够退回两点法
        double growth = 0;
        var pts = new List<(int y, double lnD)>();
        for (int y = div.CompleteYear - 7; y <= div.CompleteYear; y++)
            if (div.ByYear.TryGetValue(y, out var d0v) && d0v > 0) pts.Add((y, Math.Log(d0v)));
        if (pts.Count >= 5)
        {
            double mx = pts.Average(p => p.y), my = pts.Average(p => p.lnD);
            double slope = pts.Sum(p => (p.y - mx) * (p.lnD - my)) / pts.Sum(p => (p.y - mx) * (p.y - mx));
            growth = Math.Clamp((Math.Exp(slope) - 1) * 100 / 2.5, 0, 4);   // 更强均值回归:除2.5、封顶4(原/2封6),不把近期高增速当永续
        }
        else if (div.ByYear.TryGetValue(div.CompleteYear - 5, out var d5) && d5 > 0 && div.ByYear.GetValueOrDefault(div.CompleteYear) > 0)
            growth = Math.Clamp((Math.Pow(div.ByYear[div.CompleteYear] / d5, 1 / 5.0) - 1) * 100 / 2.5, 0, 4);
        if (CyclicalIndustries.Contains(industry)) growth = Math.Min(growth, 1.5);   // 周期股增速不外推,5年均值口径之上最多给通胀量级
        if (decline2y) growth = Math.Min(growth, 1.5);   // 净利连续下滑时,分红增长大概率靠提高分红率硬撑,不可外推
        if (divScore <= 0) growth = 0;                   // 已停派(僵尸股息)谈不上增长,预期回报归零而非"负分位修正+旧增长"的怪数
        // 估值修正用股息率分位(高=便宜):息率处历史低位=贵,扣分;高位=便宜,小幅加分
        double dyPctNow = divScore > 0 && yieldSeries.Count > 0 ? Percentile(yieldSeries, dy) : 0;
        double valAdj = divScore <= 0 || yieldSeries.Count == 0 ? 0 : dyPctNow < 30 ? -1.5 : dyPctNow < 50 ? -0.5 : dyPctNow > 70 ? 0.5 : 0;
        double expReturn = Math.Round(dy + growth + valAdj, 1);

        // 击球价：从现价向下步进0.5%,找到评分≥80的最高价
        double strike = 0;
        if (total >= 80) strike = price;
        else
            for (double p = price; p >= price * 0.4; p *= 0.995)
            {
                var (s, _) = ScoreStock(p, pe, pb, closes, divScore, div.ByYear, annuals, industry, bondYield, vol, yieldSeries, flags, payoutDiv);
                if (s >= 80) { strike = Math.Round(p, 2); break; }
            }

        // 重仓价(90分,与"重仓级"横幅同一门槛)——与击球价同法反推
        double heavy = 0;
        if (total >= 90) heavy = price;
        else
            for (double p2 = price; p2 >= price * 0.3; p2 *= 0.995)
            {
                var (s2, _) = ScoreStock(p2, pe, pb, closes, divScore, div.ByYear, annuals, industry, bondYield, vol, yieldSeries, flags, payoutDiv);
                if (s2 >= 90) { heavy = Math.Round(p2, 2); break; }
            }

        // 一句话点评(规则拼装,非AI):最强项+最短板+行动指令
        var best = dims.OrderByDescending(x => x.Score / x.Max).First();
        var worst = dims.OrderBy(x => x.Score / x.Max).First();
        string action = total >= 80 ? "当前价可按纪律分批建仓"
                      : total >= 65 ? (strike > 0 ? $"差一口价——挂单等 ¥{strike:F2}" : "差一口价,等回调")
                      : total >= 50 ? "入自选,别追,让价格来找你"
                      : "与收息目标不匹配,先略过";
        string verdict = $"{best.Name}是强项({best.Score}/{(int)best.Max}),{worst.Name}拖后腿({worst.Score}/{(int)worst.Max})——{action}。";

        // 股息回本年数(按 股息率+增长 复利,封顶40年;周期股用折减口径)
        int payback = 0; double cum = 0, dNow = divScore;
        if (divScore > 0)
            for (int y = 1; y <= 40; y++)
            {
                cum += dNow; dNow *= 1 + growth / 100;
                if (cum >= price) { payback = y; break; }
            }

        // 适合/不适合(规则生成)
        var fit = new List<string>(); var unfit = new List<string>();
        if (dy >= 4.5 && dims[1].Score >= 20) fit.Add("吃息为主的长期持有者");
        if (growth >= 2.5) fit.Add("看重股息逐年增长的人");
        if (vol < 20) fit.Add("求低波动、拿得住的人");
        if (fit.Count == 0) fit.Add("愿意等更好价格的耐心投资者");
        if (yieldSeries.Count > 0 && dyPctNow < 30) unfit.Add("现在追高的人(股息率处十年低位)");
        if (dy < 3) unfit.Add("指望股息现金流生活的人(息偏薄)");
        if (vol >= 28) unfit.Add("受不了大幅波动的人");
        if (industry is "煤炭" or "石油") unfit.Add("把周期高点利润当永续的人");
        if (divCut3y) unfit.Add("把分红当刚性承诺的人(近3年削减过)");
        if (decline2y) unfit.Add("以为盈利只会横盘不会下台阶的人");
        if (flags.ConcApplies && topRatio >= 70) unfit.Add($"忽视单一品类风险的人(最大品类占营收{topRatio:F0}%)");
        if (unfit.Count == 0) unfit.Add("追求短期暴利的人");

        // 十年月线走势采样(≤60点,给前端画图)
        int step = Math.Max(1, (int)Math.Ceiling(monthly.Count / 60.0));
        var sampled = monthly.Where((_, i) => i % step == 0 || i == monthly.Count - 1).ToList();

        return new
        {
            code, name, industry, source, type = "stock",
            market = hk ? "hk" : "a", currency = hk ? "HK$" : "¥",   // 港股/A股 + 币种符号(前端展示用)
            ahKey = NormAhKey(name),                                   // A/H 配对键(前端把同名A股与H股归组做对比)
            price, pe = pe > 0 ? Math.Round(pe, 2) : (double?)null, pb = pb > 0 ? Math.Round(pb, 2) : (double?)null,   // 负PE/PB(亏损/负资产)显示为—,不给误导数字
            mktCapYi = mktCap,
            divTtm, divYield = Math.Round(divTtm / price * 100, 2),   // 港股为税后到手息;评分/预期用divScore
            grossDivYield = hk ? Math.Round(grossTtm / price * 100, 2) : (double?)null,   // 港股毛息(未扣红利税)
            hkShareType = hk ? (hkIsHShare ? "H股" : "红筹/港股") : null,
            hkTaxRate = hk ? (int)Math.Round(hkTaxRate * 100) : (int?)null,
            hkTaxNote = hk ? $"{(hkIsHShare ? "H股" : "红筹/港股本地股")}·港股通红利税{(int)Math.Round(hkTaxRate * 100)}%,已折为税后到手口径" : null,
            score = total, grade = Grade(total),
            intro = string.IsNullOrWhiteSpace(intro) ? null : intro,   // 主营一句话简介(详情页展示)
            // 回测金标核对用:debug=true 时吐出 ScoreStock 的完整输入向量(未取整)+输出,供 Python 端口逐位核对
            scoreInputs = !debug ? null : (object)new
            {
                price, pe, pb, closes, divScore, divByYear = div.ByYear, industry, bondYield, annVol = vol, yieldSeries, payoutDiv,
                annuals = annuals.Select(a => new { a.Year, a.Roe, a.DebtRatio, a.CashToProfit, a.NetProfit, a.NetProfitYoy, a.Eps, a.Kf }),
                flags = new { flags.TopRatio, flags.ConcApplies, flags.Decline2y, flags.DivCut3y, flags.KfRatio },
                outTotal = total, outDims = dims.Select(d => new { d.Key, d.Score })
            },
            dims = dims.Select(d => new { d.Key, d.Name, d.Score, d.Max, d.Detail }),
            expReturn,
            expReturnNote = expReturn >= 12 ? "显著跑赢红利ETF基准,值得单独持有" :
                            expReturn >= 8 ? "合格,与红利ETF相当,想省心可直接ETF" : "低于红利ETF基准,建议等更好价格",
            strikePrice = strike > 0 ? strike : (double?)null,
            strikeNote = total >= 80 ? "当前已在击球区" : strike > 0 ? $"跌至 {(hk ? "HK$" : "¥")}{strike:F2} 进入击球区(≥80分)" : "步进至-60%仍未到80分",
            verdict,
            buyBands = new { suggest = strike > 0 ? strike : (double?)null, heavy = heavy > 0 ? heavy : (double?)null },
            paybackYears = payback > 0 ? payback : (int?)null,
            suitability = new { fit, unfit },
            spark = new { dates = sampled.Select(m => m.date), closes = sampled.Select(m => m.close) },
            pricePercentile10y = Math.Round(Percentile(closes, price), 0),
            divYieldPct10y = yieldSeries.Count > 0 ? Math.Round(dyPctNow, 0) : (double?)null,   // 高=便宜
            annVol = Math.Round(vol, 1), maxDrawdown10y = Math.Round(mdd, 1), annReturns = ann,
            bondYield,
            asOf = DateTime.UtcNow,
            disclaimer = "免费公开数据+规则打分,为研究辅助,不构成投资建议"
        };
    }
}


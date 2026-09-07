namespace GoodayTools.Services;

// 课表照片识别：把老师上传的纸质课表照片交给视觉模型，抽取出「星期/起止时间/备注」结构化条目。
//
// 设计：
//   - 走宿主机 Claude CLI OCR 服务（Vision:ClaudeUrl，即 scripts/ocr_server.py），
//     由 claude CLI 用订阅账号凭据（~/.claude/.credentials.json）识别，不使用任何 API Key。
//   - 未配置 ClaudeUrl 则返回 mock 草稿，整条链路不需要凭据也能演示。
public class ScheduleOcrService(IHttpClientFactory httpFactory, IConfiguration config, ILogger<ScheduleOcrService> log) {

    public record OcrEntry(int? Weekday, string? Date, string StartTime, string EndTime, string? Note);
    public record OcrResult(bool Mock, List<OcrEntry> Entries, string? Message);

    bool HasClaudeUrl => !string.IsNullOrWhiteSpace(config["Vision:ClaudeUrl"]);

    public async Task<OcrResult> Recognize(byte[] image, string contentType, string? hint = null) {
        if (!HasClaudeUrl) return MockResult();
        try {
            return await CallClaudeLocal(image, contentType, hint);
        } catch (Exception e) {
            log.LogWarning(e, "课表识别调用失败，回退 mock");
            return MockResult() with { Message = "识别服务暂时不可用，已给出示例草稿，请手动核对修改" };
        }
    }

    // ── 宿主机 Claude CLI OCR 服务（订阅账号凭据，不用 API Key）──
    async Task<OcrResult> CallClaudeLocal(byte[] image, string contentType, string? hint) {
        var url      = config["Vision:ClaudeUrl"]!.TrimEnd('/') + "/recognize";
        var curMonth = DateTime.UtcNow.ToString("yyyy-MM");
        var payload  = new {
            image     = Convert.ToBase64String(image),
            mediaType = string.IsNullOrEmpty(contentType) ? "image/jpeg" : contentType,
            month     = curMonth,
            hint      = hint ?? ""
        };
        var http = httpFactory.CreateClient("vision");
        http.Timeout = TimeSpan.FromSeconds(300);
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Content = new StringContent(System.Text.Json.JsonSerializer.Serialize(payload), System.Text.Encoding.UTF8, "application/json");
        var resp = await http.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) throw new Exception($"claude-local {(int)resp.StatusCode}: {body}");
        using var doc = System.Text.Json.JsonDocument.Parse(body);
        var entries = new List<OcrEntry>();
        if (doc.RootElement.TryGetProperty("entries", out var arr) && arr.ValueKind == System.Text.Json.JsonValueKind.Array) {
            foreach (var e in arr.EnumerateArray()) {
                string? S(string k) => e.TryGetProperty(k, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
                int? I(string k)    => e.TryGetProperty(k, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.Number && v.TryGetInt32(out var n) ? n : null;
                var st = S("startTime"); var note = S("note");
                if (string.IsNullOrWhiteSpace(st) || string.IsNullOrWhiteSpace(note)) continue;
                entries.Add(new OcrEntry(I("weekday"), S("date"), st!, S("endTime") ?? "", note!));
            }
        }
        log.LogInformation("CallClaudeLocal: {Count} entries", entries.Count);
        return new OcrResult(false, entries, entries.Count == 0 ? "未能从照片识别出课程，请重拍或手动添加" : null);
    }

    // ── mock：给一份典型周课表草稿，让老师在没配识别服务时也能体验「确认→生成」 ──
    static OcrResult MockResult() => new(true, new() {
        new OcrEntry(1, null, "09:00", "10:00", "示例·数学"),
        new OcrEntry(1, null, "10:00", "11:00", "示例·英语"),
        new OcrEntry(3, null, "14:00", "16:00", "示例·物理(2小时)"),
        new OcrEntry(6, null, "10:00", "11:00", "示例·化学"),
    }, "当前为示例识别结果（未配置识别服务）。核对修改后即可生成正式课表；配置 Vision:ClaudeUrl 后将自动改为真实识别。");
}

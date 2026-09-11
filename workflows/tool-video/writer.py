#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""写稿：把工具自己的素材喂给模型，要回一份**双人对话讲解**脚本，再逐条验收。

片子的标准形态见 docs/specs/003-tool-video-standard.md。这一层守两条底线：

**底线一：不许替工具吹牛。** 讲解片挂在工具详情页上，说错一句，
用户点进去就是被骗一次。所以过三道闸：
  1. 结构闸：只收 JSON，版式从固定几种里选，不许写 HTML；
  2. 事实闸：旁白里出现的数字（3.3.5a / 1080p / 7890 …）必须在素材里出现过——
     模型最容易编的就是数字；
  3. 口径闸：禁用"最好/第一/永久免费/保证"这类夸张与承诺词。

**底线二：不许只是念说明书。** 大海要的是"专业有深度的讲解"，不是功能罗列。
所以还要过深度闸：必须有真提问、必须讲到取舍/坑/适用边界、
老师的回答不能句句都短（全是短句 = 没展开）。

不过闸就整篇拒收、这一轮不出片。**宁可不出，也不出一条水的。**
"""
import json
import os
import re
import sys

sys.path.insert(0, "/opt/gooday-harness/packages")
from botkit import model as mdl                                   # noqa: E402

MIN_TURNS = 14            # 少于这个数不可能讲透，多半是模型偷懒
MIN_ASKS = 4              # 至少四个真问题，否则就是单口相声
MIN_SAY, MAX_SAY = 8, 110  # 单轮字数：太长字幕排不下、听着也累，让它拆成多轮
MIN_TOTAL_CHARS = 900     # 全片旁白总字数下限 ≈ 4 分钟。时长不限，但"讲清楚"有下限
MIN_LONG_TURNS = 6        # 至少 6 轮是 45 字以上的展开，防止通篇一问一短答

# 夸张 / 承诺 / 法律风险的说法。
# 【必须写成词组，不能写单词】：第一版把「第一」整词禁掉，结果把
# 「第一步」「第一个 BOSS」这种正常序数全误伤了，连续三次拒收都是它——
# 闸门误伤的代价不是"严格"，是产线出不了片，而且看日志还以为模型不听话。
BANNED = ["最好用", "全网最", "排名第一", "业界第一", "行业第一", "号称第一",
          "永久免费", "无限量", "百分百", "零风险", "秒杀", "绝对安全",
          "官方授权", "行业领先", "包你", "保证一定"]

# 深度信号词：讲取舍、讲坑、讲边界的话里一定会出现这类词。
# 【这是启发式，不是真理】——它挡不住"看起来有深度"的空话，
# 但能挡住"通篇功能罗列"，而后者才是这类片子最常见的失败形态。
DEPTH_HINTS = ["为什么", "原理", "取舍", "代价", "坑", "注意", "误区", "区别", "对比",
               "适合", "不适合", "前提", "限制", "否则", "本质", "常见问题", "怎么选"]

SYSTEM = """你在给一个工具站写讲解片脚本。片子的形态是【两个人对讲的一堂课】：

- teacher（男声）：懂这个工具、也懂它背后那套东西的人。讲原理、讲取舍、讲坑。
- asker（女声）：替观众提问的人。她问的必须是真问题——用户看到这一步会卡住的、
  会误解的、会想"那如果……呢"的地方。

【最重要的一条】这不是产品介绍，是讲解。功能罗列谁都会写，观众要的是：
为什么这么做、什么时候别用、坑在哪、和别的做法比差在哪、出了问题怎么判断。
把工具当成一个话题展开，不是把说明书念一遍。

铁律：
1. 只能用「素材」里写到的信息。素材没提的功能、数字、平台名，一个字都不许加。
   但【可以基于素材做专业解释】：素材说"用 yt-dlp"，你可以解释 yt-dlp 是什么、
   为什么这类工具要频繁更新——这是讲解，不是编造。
2. 不确定的地方就说不确定，或者不说。不要用"可能""据说"糊过去。
3. 不写夸张词（最好/第一/唯一/保证/无限/永久免费）。
4. 素材里写明的限制或前提（比如"网页只是演示，要下载到本机才能真用"），
   必须专门用几轮讲清楚——这种话恰恰是用户最需要提前知道的。
5. 旁白是给人念的：口语、短句为主，单轮不超过 110 字；一段话讲不完就拆成几轮，
   让 asker 在中间插一句，别写成一大段独白。
6. 时长不限，讲清楚为止。宁可多讲两轮，不要留个半懂不懂的结尾。

只输出一个 JSON 对象，不要解释，不要代码块围栏：
{"turns":[ ... ]}

每一轮 turn 的字段：
  speaker: "teacher" 或 "asker"（必填）
  say:     这一轮说的话（必填）
  board:   可选。要换画面时给一块新板（结构见下）
  reveal:  可选，true 表示"在当前板上再点亮一条"（讲到第几条就点第几条）

板（board）的类型与字段：
  cover    封面：{"type":"cover","title","subtitle","icon"(一个 emoji)}
  bullets  要点：{"type":"bullets","kicker","title","items":[{"text","tone"}]}  tone: purple/teal/pink
  cards    三卡：{"type":"cards","kicker","title","cards":[{"icon","title","desc"}]}
  steps    步骤：{"type":"steps","kicker","title","steps":[{"label","note"}]}
  compare  对照：{"type":"compare","kicker","title","left":{"title","items":[..]},"right":{"title","items":[..]}}
  quote    结论：{"type":"quote","kicker","title","text"}

结构要求：
- 第一轮必须带 cover 板，由 teacher 开场。
- 至少 14 轮，其中 asker 至少 4 轮，且问题要分散在全片，不能都堆在开头。
- **长度由素材决定，不由你决定。** 素材厚就展开，素材薄就写到 14 轮左右收住。
  宁可短而全是真的，也不要为了长度铺到四十轮、然后拿编出来的细节填。
  **一个素材里没有的数字，就足以让整篇作废重写。**
- 单轮 8~110 字。**低于 8 字不行**——配出来是一声突兀的气音。
  想表达「真的吗？」这种短反应，就和下一句合成一轮
  （写成「真的吗？那它是怎么做到的」）。
- 至少要有一块 compare 或 quote 板——有取舍或有结论，才叫讲解。
- 每块 bullets/cards/steps 板，后续要用 reveal:true 逐条点亮，别一次全亮。
- 最后一轮由 teacher 收尾，给一句能记住的结论。
"""


class WriteError(RuntimeError):
    def __init__(self, msg, infra=False):
        super().__init__(msg)
        self.infra = infra


def material(tool, page_text):
    """喂给模型的素材。只有这些，模型不许超出。"""
    return json.dumps({
        "工具名": tool["name"],
        "分类": tool.get("category"),
        "一句话描述": tool.get("description"),
        "说明文档": (tool.get("readmeMarkdown") or "")[:6000],
        "工具页面正文摘录": page_text[:6000],
        "有在线版": bool(tool.get("isOnline")),
        "有下载包": bool(tool.get("hasDownload")),
        "是否收费": bool(tool.get("isPaid")),
    }, ensure_ascii=False, indent=1)


def _numbers(text):
    """抽出"像数字事实"的 token：3.3.5a、1080p、7890、1000+ 这类。

    纯粹的"3 个""五种"不算——中文数量词模型编不出花来，
    真正容易编的是版本号、端口、分辨率、平台数量这种看起来很具体的东西。
    """
    return set(re.findall(r"\d[\d.]*[a-zA-Z+]*", text))


BOARD_TYPES = {"cover", "bullets", "cards", "steps", "compare", "quote"}


def check(script, mat):
    """验收。返回问题列表，空列表 = 通过。"""
    bad = []
    turns = script.get("turns")
    if not isinstance(turns, list) or not turns:
        return ["没有 turns 数组"]

    if len(turns) < MIN_TURNS:
        bad.append(f"只有 {len(turns)} 轮，少于 {MIN_TURNS} 轮讲不透")
    if not (turns[0].get("board") or {}).get("type") == "cover":
        bad.append("第一轮没带 cover 板")
    if turns[0].get("speaker") == "asker":
        bad.append("开场应该由 teacher 起")
    if turns[-1].get("speaker") != "teacher":
        bad.append("最后一轮该由 teacher 收尾")

    asks = [i for i, t in enumerate(turns) if t.get("speaker") == "asker"]
    if len(asks) < MIN_ASKS:
        bad.append(f"提问只有 {len(asks)} 轮，少于 {MIN_ASKS} 轮就是单口相声")
    elif asks and max(asks) < len(turns) * 0.5:
        bad.append("提问全堆在前半段，后半段没人插话")

    total = sum(len((t.get("say") or "")) for t in turns)
    if total < MIN_TOTAL_CHARS:
        bad.append(f"全片旁白 {total} 字，少于 {MIN_TOTAL_CHARS} 字——时长不限但要讲清楚")
    longs = sum(1 for t in turns if t.get("speaker") == "teacher" and len(t.get("say") or "") >= 45)
    if longs < MIN_LONG_TURNS:
        bad.append(f"只有 {longs} 轮是展开讲的（≥45 字），通篇短答等于没讲")

    all_say = " ".join(t.get("say") or "" for t in turns)
    if not any(h in all_say for h in DEPTH_HINTS):
        bad.append("全片没有一处讲到为什么/取舍/坑/边界——这是功能罗列，不是讲解")

    board_types = set()
    mat_nums = _numbers(mat)
    for i, t in enumerate(turns):
        if t.get("speaker") not in ("teacher", "asker"):
            bad.append(f"第{i + 1}轮 speaker 不对：{t.get('speaker')}")
        say = (t.get("say") or "").strip()
        if not MIN_SAY <= len(say) <= MAX_SAY:
            bad.append(f"第{i + 1}轮 {len(say)} 字，超出 {MIN_SAY}~{MAX_SAY}（长了就拆成几轮）")
        for w in BANNED:
            if w in say:
                bad.append(f"第{i + 1}轮出现夸张词「{w}」")
        for n in _numbers(say) - mat_nums:
            if len(n) >= 2:      # 单个数字（"3 关"）放过，中文语境里多半是量词
                bad.append(f"第{i + 1}轮里的「{n}」在素材里找不到，疑似编的")
        b = t.get("board")
        if b:
            if b.get("type") not in BOARD_TYPES:
                bad.append(f"第{i + 1}轮板块类型不认识：{b.get('type')}")
            else:
                board_types.add(b["type"])
        if "<" in json.dumps(t, ensure_ascii=False):
            bad.append(f"第{i + 1}轮里带了尖括号，字段不许写 HTML")

    if not ({"compare", "quote"} & board_types):
        bad.append("全片没有 compare/quote 板——没有取舍也没有结论")
    return bad


_SPLIT_AT = "。！？；!?;"


def autofix(script):
    """能机械修好的就别退回去重写。

    目前只修一件事：**单轮说太长**。模型天然会写 110~130 字的长句，
    而 110 字是字幕区能排下的物理上限——这不是内容问题，是版式问题，
    按句号切成两轮就解决了，没必要为此让整篇作废、重跑一次模型。
    切分保持同一个说话人，也不额外 reveal，观感上就是他喘了口气继续说。
    """
    out = []
    for t in script.get("turns", []):
        say = (t.get("say") or "").strip()
        if len(say) <= MAX_SAY:
            out.append(t)
            continue
        # 按句末标点切，凑到 ≤MAX_SAY 就断一轮
        chunks, cur = [], ""
        for ch in say:
            cur += ch
            if ch in _SPLIT_AT and len(cur) >= MAX_SAY * 0.45:
                chunks.append(cur)
                cur = ""
        if cur:
            chunks.append(cur)
        # 还有超长的（整段没标点）就硬切
        flat = []
        for c in chunks:
            while len(c) > MAX_SAY:
                flat.append(c[:MAX_SAY])
                c = c[MAX_SAY:]
            if c:
                flat.append(c)
        # 【把过短的碎片并回上一段】：硬切会切出"。"这种一两个字的尾巴，
        # 单独成一轮就是配音里一声突兀的气音，验收也会判它超出下限
        merged = []
        for c in flat:
            if merged and len(c) < MIN_SAY:
                merged[-1] += c
            else:
                merged.append(c)
        flat = merged or flat
        for i, c in enumerate(flat):
            nt = dict(t)
            nt["say"] = c
            if i:                       # 只有第一段保留换板/点亮，后续是同一轮的续说
                nt.pop("board", None)
                nt.pop("reveal", None)
            out.append(nt)
    script["turns"] = out
    return script


def _extract(raw):
    """从模型输出里挖出 JSON。围栏、寒暄、结尾多余文字都可能有。"""
    s = raw.strip()
    s = re.sub(r"^```(?:json)?|```$", "", s, flags=re.M).strip()
    m = re.search(r"\{.*\}", s, re.S)
    if not m:
        raise WriteError(f"模型没给出 JSON：{s[:200]}")
    body = m.group(0)
    for attempt in range(3):
        try:
            return json.loads(body)
        except json.JSONDecodeError as e:
            if attempt == 0:
                body = re.sub(r",(\s*[}\]])", r"\1", body)          # 尾逗号
            elif attempt == 1:
                # 字符串里的裸换行/制表符。模型写长句时偶尔会带进来，
                # 严格 JSON 不允许，但内容本身是好的——换成空格比整篇重写划算
                body = re.sub(r'(?<!\\)[\n\r\t]+(?=[^"]*"(?:[^"]*"[^"]*")*[^"]*$)', " ", body)
                body = body.replace("\n", " ").replace("\r", " ").replace("\t", " ")
            else:
                raise WriteError(f"JSON 解析失败：{e}；原文 {body[:200]}")


def write(tool, page_text, *, tag="tool-video", timeout=900, attempts=3):
    """调模型写稿 → 自动修 → 验收；不过就把问题回给模型重写，最多 attempts 次。

    【为什么要把问题回给模型，而不是直接失败】：验收是硬的（编数字、说夸张话
    一律拒），但"这一轮不出片"对产线是很贵的失败。带着具体问题重写一次，
    模型多半能改对——而它改不对的那些，恰恰是真该人来看的。
    """
    mat = material(tool, page_text)
    prompt = f"素材：\n{mat}\n\n按系统提示输出 JSON。"
    last = ""
    for i in range(attempts):
        text, ok, err = mdl.call(prompt, SYSTEM, tag=tag, timeout=timeout)
        if not ok:
            # 【必须分清是基础设施还是内容问题】：凭据过期会表现成"今天写得不好"，
            # 混在一起报，没人会去查凭据
            raise WriteError(f"模型调用失败：{err[:300]}", infra=mdl.is_infra_error(err))
        try:
            script = autofix(_extract(text))
        except (WriteError, json.JSONDecodeError) as e:
            last = f"上一版输出不是合法 JSON（{str(e)[:120]}）"
            prompt = (f"素材：\n{mat}\n\n上一次的输出有问题：{last}\n"
                      f"请重新输出【完整且合法】的 JSON，不要围栏、不要任何解释文字。")
            continue
        problems = check(script, mat)
        if not problems:
            return script
        last = "；".join(problems[:8])
        # ═══ 指导必须把两个边界都说全（2026-09-11 实测换来的）═══════════
        #
        #   原来这一段只说「单轮不超过 110 字」，**从来没说过下限 8 字**，
        #   而验收报给它的是「超出 8~110」。于是模型一次次写出 4~6 字的短轮，
        #   三次重写全挂在同一条上 —— **它不是不听话，是没被告知过。**
        #
        #   同理「素材里没有的数字一个都不能写」说了，但没说**怎么办**：
        #   它拿 700 字的素材铺了 46 轮，不编细节填不满。
        #   所以这次把解法也给出来：写不出那么多就少写几轮。
        prompt = (f"素材：\n{mat}\n\n你上一版稿子没过验收，问题是：\n{last}\n\n"
                  f"逐条改掉再输出一遍完整 JSON。特别注意：\n"
                  f"· **素材里没有的数字一个都不能写。** 写不出那么多内容就少写几轮——"
                  f"轮数下限只有 {MIN_TURNS}，够用；"
                  f"把稿子铺长再编细节填，是最坏的选择。\n"
                  f"· 单轮 {MIN_SAY}~{MAX_SAY} 字。长了拆成两轮；"
                  f"**短了要和相邻那句合成一轮**，别留 4 个字一轮。\n"
                  f"· 不写夸张词。")
    raise WriteError(f"写了 {attempts} 次仍没过验收，最后一次：{last}")

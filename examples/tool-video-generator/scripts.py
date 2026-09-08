# -*- coding: utf-8 -*-
"""三个工具的讲解脚本。

内容全部来自工具自己的页面和说明文档（下载量前三：小飞机 14 / 魔兽搭建手册 11 / 视频拉取 9）。
**不替工具吹它没有的能力**——尤其「视频拉取」，网页端只是模拟，真下载要装本地程序，
这一点必须在片子里明说，否则用户点进去只会觉得被骗。
"""

def li(text, cls="", delay=0.0):
    return (f'<div class="el li {cls}" data-in="{delay}"><span class="dot"></span>'
            f'<span>{text}</span></div>')


PLANE = {
    "name": "小飞机",
    "slug": "xiaofeiji",
    "scenes": [
        {
            "say": "小飞机，一个打开就能玩的手机网页射击游戏。三个关卡，三个 BOSS，不用安装，不用注册。",
            "html": """
              <div class="el hero-ico" data-in="0" style="text-align:center">🛩️</div>
              <h1 class="el" data-in="0.25" style="text-align:center;margin-top:8px">小飞机</h1>
              <div class="el sub" data-in="0.5" style="text-align:center">
                手机网页射击游戏 · 触屏即玩 · 无需安装</div>
              <div class="sprite" data-in="0.2" data-dur="2.4" data-path="[120,640,1160,120]"
                   style="font-size:40px">✨</div>
              <div class="sprite" data-in="0.6" data-dur="2.6" data-path="[1120,660,180,180]"
                   style="font-size:34px">💫</div>
            """,
        },
        {
            "say": "它只有一个 HTML 文件。在线点开就是完整的游戏，下载下来断网照样能玩。",
            "html": """
              <div class="kicker el" data-in="0">这是什么</div>
              <h2 class="el" data-in="0.15">一个 HTML 文件<br>就是一整个游戏</h2>
              <div class="cards" style="margin-top:8px">
                <div class="card el" data-in="0.5"><div class="ico">🌐</div>
                  <div class="t">在线直接玩</div><div class="d">点开就是游戏本体，<br>不跳下载页</div></div>
                <div class="card el" data-in="0.75"><div class="ico">📴</div>
                  <div class="t">离线也能玩</div><div class="d">存到手机里，<br>没网照样开局</div></div>
                <div class="card el" data-in="1.0"><div class="ico">🎮</div>
                  <div class="t">不用注册</div><div class="d">没有账号，<br>没有内购</div></div>
              </div>
            """,
        },
        {
            "say": "操作只有一个动作：手指按住战机拖动，火力全自动。电脑上用方向键也一样。",
            "html": """
              <div class="kicker el" data-in="0">怎么玩</div>
              <h2 class="el" data-in="0.15">手指拖着走，子弹自己打</h2>
              <div class="mock el" data-in="0.45" style="width:520px;height:330px;margin:0 auto;position:relative">
                <div class="tb"><i></i><i></i><i></i></div>
                <div class="bd" style="text-align:center;color:#7c6cff;font-size:20px">触屏拖动 / 方向键</div>
                <div class="sprite" data-in="0.7" data-dur="2.2" data-path="[160,250,380,180]"
                     style="font-size:46px">🛩️</div>
                <div class="sprite" data-in="1.1" data-dur="1.6" data-path="[380,180,380,60]"
                     style="font-size:26px">🔸</div>
                <div class="sprite" data-in="1.6" data-dur="1.4" data-path="[380,180,380,60]"
                     style="font-size:26px">🔸</div>
              </div>
              <div class="el" data-in="1.9" style="text-align:center;margin-top:22px">
                <span class="tag">自动开火</span><span class="tag p">连击加分</span>
                <span class="tag k">本地最高分</span></div>
            """,
        },
        {
            "say": "内容不算小：三个 BOSS 分别是霓虹蜂、虚空蛇和霓虹霸主，五种敌机，四种道具，还有粒子爆炸和合成音效。",
            "html": """
              <div class="kicker el" data-in="0">里面有什么</div>
              <h2 class="el" data-in="0.15">3 关 · 3 个 BOSS</h2>
              """ + li("霓虹蜂 · 虚空蛇 · 霓虹霸主，三种打法", "", 0.45)
                  + li("5 种敌机 + 4 种道具：武器升级、护盾、炸弹、加命", "teal", 0.75)
                  + li("粒子爆炸特效 + Web Audio 合成音效", "pink", 1.05)
                  + li("连击系统，最高分存在本机", "", 1.35),
        },
        {
            "say": "在 Gooday 工具库搜小飞机，点在线使用直接开局，想离线玩就点下载。",
            "html": """
              <div class="el kicker" data-in="0" style="text-align:center">现在就能玩</div>
              <h2 class="el" data-in="0.2" style="text-align:center">gooday.ltd · 搜「小飞机」</h2>
              <div class="cards" style="margin-top:36px">
                <div class="card el" data-in="0.5" style="text-align:center">
                  <div class="ico">▶</div><div class="t" style="color:#00d4aa">在线使用</div>
                  <div class="d">点开即玩</div></div>
                <div class="card el" data-in="0.75" style="text-align:center">
                  <div class="ico">🎬</div><div class="t" style="color:#f472b6">视频讲解</div>
                  <div class="d">就是这一条</div></div>
                <div class="card el" data-in="1.0" style="text-align:center">
                  <div class="ico">⬇</div><div class="t" style="color:#a99cff">下载</div>
                  <div class="d">存下来离线玩</div></div>
              </div>
            """,
        },
    ],
}


WOW = {
    "name": "魔兽搭建手册",
    "slug": "wow-server",
    "scenes": [
        {
            "say": "魔兽搭建手册。在 Windows 11 上，从零搭起一台巫妖王之怒 3.3.5a 的私人服务器。",
            "html": """
              <div class="el hero-ico" data-in="0" style="text-align:center">⚔️</div>
              <h1 class="el" data-in="0.25" style="text-align:center;margin-top:8px">魔兽搭建手册</h1>
              <div class="el sub" data-in="0.5" style="text-align:center">
                Win11 · 3.3.5a 巫妖王之怒 · AzerothCore 开源方案</div>
            """,
        },
        {
            "say": "搭私服最难的从来不是某一步，而是教程散在十几个地方，版本还对不上，报错一卡就是一晚上。",
            "html": """
              <div class="kicker el" data-in="0">为什么需要它</div>
              <h2 class="el" data-in="0.15">难的不是哪一步<br>是没有一条完整的线</h2>
              """ + li("教程散在十几个论坛，版本互相对不上", "", 0.5)
                  + li("编译参数错一个，几个小时白等", "pink", 0.8)
                  + li("报错搜不到，卡一晚上是常事", "pink", 1.1),
        },
        {
            "say": "这份手册把全过程串成一条线：装环境、编译服务端、建数据库、提取地图数据、改配置、开服进游戏。",
            "html": """
              <div class="kicker el" data-in="0">全流程</div>
              <h2 class="el" data-in="0.15">六步，一条线走完</h2>
              <div class="steps el" data-in="0.4" data-dy="0" style="margin-top:34px">
                <div class="step" data-hot="0.7"><div class="n">1</div><div class="l">装环境<br>MySQL8 / VS2022</div></div>
                <div class="step" data-hot="1.2"><div class="n">2</div><div class="l">编译<br>AzerothCore</div></div>
                <div class="step" data-hot="1.7"><div class="n">3</div><div class="l">建库<br>账号权限</div></div>
                <div class="step" data-hot="2.2"><div class="n">4</div><div class="l">提取<br>地图数据</div></div>
                <div class="step" data-hot="2.7"><div class="n">5</div><div class="l">改配置<br>两个 conf</div></div>
                <div class="step" data-hot="3.2"><div class="n">6</div><div class="l">开服<br>建号进游戏</div></div>
              </div>
              <div class="el" data-in="3.5" data-bar="1.1" style="margin-top:40px">
                <div class="bar"><i></i></div></div>
            """,
        },
        {
            "say": "每一步都能勾掉，命令一键复制，不用手抄。经验金币倍率有配置模板，局域网联机也写了。",
            "html": """
              <div class="kicker el" data-in="0">好用在哪</div>
              <h2 class="el" data-in="0.15">照着点，不用手抄</h2>
              """ + li("交互式进度追踪：每步可勾选，完成即标 ✓", "teal", 0.45)
                  + li("PowerShell / MySQL 命令一键复制", "", 0.75)
                  + li("经验、金币、技能倍率配置模板", "", 1.05)
                  + li("局域网联机指南，和朋友一起玩", "teal", 1.35)
                  + li("八大常见报错的 FAQ", "pink", 1.65),
        },
        {
            "say": "两点先说清楚：整套跑下来大概两到四个小时；工具完全离线，下载后没网也能看。仅供个人学习研究。",
            "html": """
              <div class="kicker el" data-in="0">先说清楚</div>
              <div class="cards" style="margin-top:18px">
                <div class="card el" data-in="0.3"><div class="ico">⏱️</div>
                  <div class="t">2 ~ 4 小时</div><div class="d">编译和提取地图<br>是大头，急不来</div></div>
                <div class="card el" data-in="0.6"><div class="ico">📴</div>
                  <div class="t">完全离线</div><div class="d">下载后无网可用<br>单文件带走</div></div>
                <div class="card el" data-in="0.9"><div class="ico">📖</div>
                  <div class="t">仅供学习</div><div class="d">个人研究用途<br>请勿商用</div></div>
              </div>
              <div class="el" data-in="1.3" style="margin-top:40px;text-align:center">
                <span class="tag p mono">Windows 10 / 11 64 位</span>
                <span class="tag mono">WoW 3.3.5a 客户端</span></div>
            """,
        },
        {
            "say": "在 Gooday 工具库搜魔兽搭建手册，在线直接看，也可以下载下来边搭边勾。",
            "html": """
              <div class="el kicker" data-in="0" style="text-align:center">开搭</div>
              <h2 class="el" data-in="0.2" style="text-align:center">gooday.ltd · 搜「魔兽搭建手册」</h2>
              <div class="cards" style="margin-top:36px">
                <div class="card el" data-in="0.5" style="text-align:center">
                  <div class="ico">▶</div><div class="t" style="color:#00d4aa">在线使用</div>
                  <div class="d">直接翻手册</div></div>
                <div class="card el" data-in="0.75" style="text-align:center">
                  <div class="ico">🎬</div><div class="t" style="color:#f472b6">视频讲解</div>
                  <div class="d">先看这条</div></div>
                <div class="card el" data-in="1.0" style="text-align:center">
                  <div class="ico">⬇</div><div class="t" style="color:#a99cff">下载</div>
                  <div class="d">离线边搭边勾</div></div>
              </div>
            """,
        },
    ],
}


VIDOS = {
    "name": "视频拉取",
    "slug": "vidos-down",
    "scenes": [
        {
            "say": "视频拉取，一个基于 yt-dlp 的视频下载工具，支持一千多个平台。",
            "html": """
              <div class="el hero-ico" data-in="0" style="text-align:center">📥</div>
              <h1 class="el" data-in="0.25" style="text-align:center;margin-top:8px">视频拉取</h1>
              <div class="el sub" data-in="0.5" style="text-align:center">
                YouTube · B站 · 抖音 · 快手 · 微博 · 小红书 · 1000+ 平台</div>
            """,
        },
        {
            "say": "先说最重要的一句：网页上那个界面只是演示，真要下载得把它下载下来，在自己电脑上运行。",
            "html": """
              <div class="kicker el" data-in="0" style="color:#f472b6">先看这条</div>
              <h2 class="el" data-in="0.15">网页是演示<br>下载要装到本机</h2>
              <div class="cards" style="margin-top:8px">
                <div class="card el" data-in="0.5"><div class="ico">🌐</div>
                  <div class="t" style="color:#9aa4bb">在线使用</div>
                  <div class="d">只是界面演示<br>看它长什么样</div></div>
                <div class="card el" data-in="0.8" style="border-color:rgba(0,212,170,.5)">
                  <div class="ico">⬇</div><div class="t" style="color:#00d4aa">下载运行</div>
                  <div class="d">这才是真能下视频的<br>那一份</div></div>
              </div>
              <div class="el sub" data-in="1.2" style="font-size:25px">
                视频下载要读你的浏览器登录态、走你的网络，这些事只能在你自己的电脑上做。</div>
            """,
        },
        {
            "say": "用起来是三步：粘贴链接，选画质和格式，点下载。",
            "html": """
              <div class="kicker el" data-in="0">三步</div>
              <h2 class="el" data-in="0.15">粘链接 → 选画质 → 下载</h2>
              <div class="steps el" data-in="0.4" data-dy="0" style="margin-top:26px">
                <div class="step" data-hot="0.8"><div class="n">1</div><div class="l">粘贴视频链接<br>自动识别平台</div></div>
                <div class="step" data-hot="1.5"><div class="n">2</div><div class="l">选画质与类型<br>1080p / mp4 / mp3</div></div>
                <div class="step" data-hot="2.2"><div class="n">3</div><div class="l">点下载<br>看进度条</div></div>
              </div>
              <div class="el" data-in="2.4" data-bar="1.4" style="margin-top:44px">
                <div class="bar"><i></i></div></div>
            """,
        },
        {
            "say": "能做的事不止一个视频：整个播放列表、一次贴一批链接、只要音频转成 mp3、中英文字幕下载甚至压进视频里。",
            "html": """
              <div class="kicker el" data-in="0">能做什么</div>
              <h2 class="el" data-in="0.15">不止下一个视频</h2>
              """ + li("播放列表 / 频道，可只取前 N 个", "", 0.45)
                  + li("批量：一行一个链接，平台可以混着来", "teal", 0.75)
                  + li("只要音频 → 直接存成 mp3", "", 1.05)
                  + li("中英文字幕，可以嵌进视频里", "teal", 1.35)
                  + li("下载历史留最近 100 条", "pink", 1.65),
        },
        {
            "say": "两个能少走弯路的设置：Cookies 直接从浏览器读，不用手动导文件；YouTube 这类站要填代理端口，Clash 一般是 7890，V2rayN 是 10809。填错了就表现为下载失败。",
            "html": """
              <div class="kicker el" data-in="0">少走两个弯路</div>
              <h2 class="el" data-in="0.15">Cookies 和代理</h2>
              """ + li("Cookies 直接从浏览器读，不用手动导出文件", "teal", 0.45)
                  + li("用 Chrome / Edge 时要先退出浏览器，否则数据库被锁", "pink", 0.8)
                  + li("代理端口：Clash 默认 7890，V2rayN 默认 10809", "", 1.15)
                  + li("填错端口的表现就是「下载失败网络超时」", "pink", 1.5),
        },
        {
            "say": "平台反爬几乎每周都在变，工具里带了一键升级 yt-dlp，下载失败先点它。",
            "html": """
              <div class="kicker el" data-in="0">下载失败了怎么办</div>
              <h2 class="el" data-in="0.15">先点「升级 yt-dlp」</h2>
              <div class="mock el" data-in="0.5" style="width:660px;margin:26px auto 0">
                <div class="tb"><i></i><i></i><i></i></div>
                <div class="bd">🔧 维护工具<br>
                  <span style="color:#9aa4bb;font-size:21px">
                  平台反爬每周都在变，社区几乎每周发新版修复</span><br>
                  <span class="tag" style="margin-top:14px">⬆ 一键升级 yt-dlp</span></div>
              </div>
            """,
        },
        {
            "say": "在 Gooday 工具库搜视频拉取，记得下载那一份才是真正能用的。",
            "html": """
              <div class="el kicker" data-in="0" style="text-align:center">去用</div>
              <h2 class="el" data-in="0.2" style="text-align:center">gooday.ltd · 搜「视频拉取」</h2>
              <div class="cards" style="margin-top:36px">
                <div class="card el" data-in="0.5" style="text-align:center">
                  <div class="ico">▶</div><div class="t" style="color:#9aa4bb">在线使用</div>
                  <div class="d">界面演示</div></div>
                <div class="card el" data-in="0.75" style="text-align:center">
                  <div class="ico">🎬</div><div class="t" style="color:#f472b6">视频讲解</div>
                  <div class="d">就是这一条</div></div>
                <div class="card el" data-in="1.0" style="text-align:center;border-color:rgba(0,212,170,.5)">
                  <div class="ico">⬇</div><div class="t" style="color:#00d4aa">下载 ← 用这个</div>
                  <div class="d">装到本机才能真下</div></div>
              </div>
            """,
        },
    ],
}

ALL = [PLANE, WOW, VIDOS]

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""上架：上传视频 → 挂到工具上 → 回查线上确认。

**回查是硬要求，不是保险起见。**
「调用返回 200」和「用户点开真能播」是两件事：文件可能没落盘、
字段可能写到了别的工具、静态服务可能不认这个扩展名。
不回查就报"已上线"，等于把验证外包给用户。
（同一条铁律在 bot 侧写作「报已办前必须回查数据库」。）
"""
import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

sys.path.insert(0, "/opt/gooday-harness/packages")
from botkit.auth import make_token                                # noqa: E402

API = os.environ.get("TOOLVIDEO_API", "http://127.0.0.1:8081")
SITE = os.environ.get("TOOLVIDEO_SITE", "https://www.gooday.ltd")
DB = os.environ.get("TOOLVIDEO_DB", "/var/lib/docker/volumes/gooday_gooday_data/_data/gooday.db")
ADMIN_ID, ADMIN_NAME = 1, "admin"

_TOOL_FIELDS = ("name", "slug", "description", "category", "iconEmoji", "isOnline", "onlineUrl",
                "hasDownload", "downloadFileName", "isPublished", "requireLogin",
                "readmeMarkdown", "isPaid", "price", "folder")


class PublishError(RuntimeError):
    pass


def db_path():
    """运行库路径。签 JWT 只用它查一行 TokenVersion。

    【直接读原库，不复制快照】。曾经想过"读不到就 docker cp 一份"，被 G14 拦下来
    才想明白：WAL 模式下复制主文件拿到的是缺最近写入的半份，而且不报错。
    正确解法是让进程有权读原库——这条产线因此以 root 跑，
    模型凭据靠 `HOME=/home/agent` 指过去（凭据是同一个物理文件，不能有第二份副本，
    OAuth 的 refreshToken 会轮换，两份副本各自刷新会互相顶掉）。

    手动以 agent 身份跑时，用 TOOLVIDEO_DB 指到一份自己准备的库。
    """
    if not os.access(DB, os.R_OK):
        raise PublishError(
            f"读不到运行库 {DB}。这条产线要以 root 跑（cron 里已写 runas: root），"
            f"手动跑请用 TOOLVIDEO_DB=<可读的库> 覆盖。")
    return DB


def token():
    return make_token(ADMIN_ID, ADMIN_NAME, "admin", db_path())


def _req(path, *, data=None, method=None, headers=None, base=None, timeout=600):
    url = (base or API) + path
    h = {"Authorization": "Bearer " + token()}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"),
                                 headers=h)
    ctx = ssl.create_default_context()
    return urllib.request.urlopen(req, timeout=timeout, context=ctx)


def list_tools():
    return json.load(_req("/api/admin/tools"))


def page_text(tool):
    """抓工具在线页正文，作为写稿素材。抓不到就返回空串，不阻断。"""
    url = (tool.get("onlineUrl") or "").strip()
    if not url.startswith("/uploads/"):
        return ""
    root = "/srv/gooday-harness/media/uploads"
    p = os.path.join(root, urllib.parse.unquote(url[len("/uploads/"):]))
    if not os.path.exists(p) or os.path.getsize(p) > 3_000_000:
        return ""
    import html as _html
    import re
    s = open(p, encoding="utf-8", errors="ignore").read()
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.S | re.I)
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", s)))


def upload_video(mp4, folder):
    """走真实的 video-upload 端点，和人在后台点上传是同一条路。"""
    b = uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"讲解.mp4\"\r\n"
            f"Content-Type: video/mp4\r\n\r\n").encode() + open(mp4, "rb").read() + \
           f"\r\n--{b}--\r\n".encode()
    q = urllib.parse.urlencode({"dir": folder}) if folder else ""
    r = _req("/api/admin/tools/video-upload" + (f"?{q}" if q else ""), data=body, method="POST",
             headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    return json.load(r)


def attach(tool, video_url, duration):
    payload = {k: tool.get(k) for k in _TOOL_FIELDS}
    payload["videoUrl"] = video_url
    payload["videoDuration"] = int(round(duration))
    r = _req(f"/api/admin/tools/{tool['id']}", data=json.dumps(payload).encode(), method="PUT",
             headers={"Content-Type": "application/json"})
    return json.load(r)


def detach(tool):
    """撤下：只清视频字段，其它字段原样写回。"""
    payload = {k: tool.get(k) for k in _TOOL_FIELDS}
    payload["videoUrl"] = None
    payload["videoDuration"] = 0
    _req(f"/api/admin/tools/{tool['id']}", data=json.dumps(payload).encode(), method="PUT",
         headers={"Content-Type": "application/json"})


def delete_upload(rel_path):
    try:
        _req("/api/admin/files/" + urllib.parse.quote(rel_path), method="DELETE")
    except Exception:
        pass


def verify_live(slug, video_rel):
    """回查线上：详情接口认它、静态直链能取、支持 Range（否则拖不动进度条）。"""
    problems = []
    try:
        d = json.load(urllib.request.urlopen(f"{API}/api/tools/{slug}", timeout=60))
        if not d.get("videoUrl"):
            problems.append("详情接口里 videoUrl 是空的")
        elif urllib.parse.unquote(d["videoUrl"]) != "/uploads/" + video_rel:
            problems.append(f"详情接口里的 videoUrl 是 {d['videoUrl']}，不是刚上传的那个")
    except Exception as e:
        problems.append(f"详情接口查不到：{e}")

    url = SITE + "/uploads/" + urllib.parse.quote(video_rel)
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, method="GET",
                                                          headers={"Range": "bytes=0-1023"}),
                                   timeout=60, context=ssl.create_default_context())
        if r.status not in (200, 206):
            problems.append(f"视频直链返回 {r.status}")
        if r.status == 200:
            problems.append("视频不支持 Range（进度条会拖不动）")
        if (r.headers.get("Content-Type") or "") != "video/mp4":
            problems.append(f"视频 Content-Type 是 {r.headers.get('Content-Type')}")
    except urllib.error.HTTPError as e:
        problems.append(f"视频直链 HTTP {e.code}")
    except Exception as e:
        problems.append(f"视频直链取不到：{e}")
    return problems


def publish(tool, mp4, duration):
    """上传 + 挂载 + 回查。回查不过就整体撤回，不留半挂状态。"""
    up = upload_video(mp4, tool.get("folder") or "")
    try:
        attach(tool, up["url"], duration)
    except Exception as e:
        delete_upload(up["path"])
        raise PublishError(f"挂载失败已撤回上传：{e}")

    problems = verify_live(tool["slug"], up["path"])
    if problems:
        detach(tool)
        delete_upload(up["path"])
        raise PublishError("回查线上不通过，已撤回：" + "；".join(problems))
    return up

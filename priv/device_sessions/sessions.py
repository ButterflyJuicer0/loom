# Runs on a device through loom-node (see LoomWeb.DeviceSessionsController).
# Loom prepends one line, `ARGS = {...}`. Prints a single JSON object.
#
#   ARGS["op"] == "list":       the agent sessions on this machine, newest first
#   ARGS["op"] == "transcript": the last messages of one session file
#
# Read-only: it opens files under ~/.claude and ~/.codex and nothing else.
import glob, json, os, socket, sys, time

HOME = os.path.expanduser("~")
CLAUDE = os.path.join(HOME, ".claude")
CODEX = os.path.join(HOME, ".codex")
MAX_TEXT = 4000


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except PermissionError:
        return True
    except Exception:
        return False


def text_of(content, kinds=("text", "input_text", "output_text")):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") in kinds
        )
    return ""


def is_noise(t):
    t = t.lstrip()
    return t == "" or t.startswith(("<", "Caveat:", "# AGENTS.md instructions"))


def clip(t, n):
    t = " ".join(t.split())
    return t if len(t) <= n else t[: n - 1] + "…"


def iso_ms(ms):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000))


def lines(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                yield json.loads(line)
            except Exception:
                continue


# ── Claude Code ───────────────────────────────────────────────────────────


def claude_live():
    """sessionId -> the running process's own record (~/.claude/sessions/<pid>.json)."""
    live = {}
    for p in glob.glob(os.path.join(CLAUDE, "sessions", "*.json")):
        try:
            d = json.load(open(p))
        except Exception:
            continue
        if d.get("sessionId") and alive(d.get("pid", 0)):
            live[d["sessionId"]] = d
    return live


def claude_summary(path):
    s = {"agent": "claude", "id": os.path.basename(path)[:-6], "file": path,
         "title": None, "first": None, "last": None, "cwd": None, "model": None,
         "branch": None, "messages": 0, "started": None}
    custom = None
    for d in lines(path):
        t = d.get("type")
        if t == "custom-title":
            custom = d.get("customTitle") or custom
        elif t == "ai-title":
            s["title"] = d.get("aiTitle") or s["title"]
        elif t == "summary" and not s["title"]:
            s["title"] = d.get("summary")
        if t not in ("user", "assistant") or d.get("isSidechain") or d.get("isMeta"):
            continue
        s["cwd"] = d.get("cwd") or s["cwd"]
        s["branch"] = d.get("gitBranch") or s["branch"]
        s["started"] = s["started"] or d.get("timestamp")
        msg = d.get("message") or {}
        body = text_of(msg.get("content"))
        if t == "user":
            if is_noise(body):
                continue
            s["messages"] += 1
            s["first"] = s["first"] or clip(body, 160)
        else:
            s["model"] = msg.get("model") or s["model"]
            if body.strip():
                s["messages"] += 1
                s["last"] = body
    if custom:
        s["title"] = custom
    s["last"] = clip(s["last"], 220) if s["last"] else None
    return s


def claude_transcript(path, limit):
    out = []
    for d in lines(path):
        t = d.get("type")
        if t not in ("user", "assistant") or d.get("isSidechain") or d.get("isMeta"):
            continue
        content = (d.get("message") or {}).get("content")
        at = d.get("timestamp")
        if t == "user":
            body = text_of(content)
            if is_noise(body):
                continue
            out.append({"role": "user", "text": body[:MAX_TEXT], "at": at})
            continue
        body = text_of(content)
        tools = []
        if isinstance(content, list):
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    tools.append(tool_label(b.get("name"), b.get("input")))
        # One API reply is split over several lines; merge them into one turn.
        if out and out[-1]["role"] == "assistant" and out[-1].get("_mid") == d.get("message", {}).get("id"):
            prev = out[-1]
            if body.strip():
                prev["text"] = (prev["text"] + "\n\n" + body).strip()[:MAX_TEXT]
            prev["tools"] += tools
            continue
        if body.strip() or tools:
            out.append({"role": "assistant", "text": body[:MAX_TEXT], "tools": tools, "at": at,
                        "_mid": (d.get("message") or {}).get("id")})
    for m in out:
        m.pop("_mid", None)
    return out[-limit:], len(out)


def tool_label(name, args):
    name = name or "tool"
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            return name + " " + clip(args, 80)
    if isinstance(args, dict):
        for k in ("command", "cmd", "file_path", "path", "pattern", "url", "query", "description", "prompt"):
            v = args.get(k)
            if isinstance(v, list):
                v = " ".join(map(str, v))
            if v:
                return name + " " + clip(str(v), 80)
    return name


# ── Codex ─────────────────────────────────────────────────────────────────


def codex_summary(path):
    s = {"agent": "codex", "id": None, "file": path, "title": None, "first": None, "last": None,
         "cwd": None, "model": None, "branch": None, "messages": 0, "started": None}
    for d in lines(path):
        t, p = d.get("type"), d.get("payload") or {}
        if t == "session_meta":
            s["id"] = p.get("id")
            s["cwd"] = p.get("cwd")
            s["started"] = p.get("timestamp")
            s["branch"] = (p.get("git") or {}).get("branch")
        elif t == "turn_context":
            s["model"] = p.get("model") or s["model"]
        elif t == "response_item" and p.get("type") == "message":
            body = text_of(p.get("content"))
            if p.get("role") == "user" and not is_noise(body):
                s["messages"] += 1
                s["first"] = s["first"] or clip(body, 160)
            elif p.get("role") == "assistant" and body.strip():
                s["messages"] += 1
                s["last"] = body
    s["id"] = s["id"] or os.path.basename(path)[:-6]
    s["last"] = clip(s["last"], 220) if s["last"] else None
    return s


def codex_transcript(path, limit):
    out = []
    for d in lines(path):
        t, p = d.get("type"), d.get("payload") or {}
        if t != "response_item":
            continue
        pt = p.get("type")
        if pt == "message" and p.get("role") in ("user", "assistant"):
            body = text_of(p.get("content"))
            if p["role"] == "user" and is_noise(body):
                continue
            if body.strip():
                out.append({"role": p["role"], "text": body[:MAX_TEXT], "tools": [], "at": d.get("timestamp")})
        elif pt in ("function_call", "custom_tool_call"):
            label = tool_label(p.get("name"), p.get("arguments") or p.get("input"))
            if out and out[-1]["role"] == "assistant":
                out[-1]["tools"].append(label)
            else:
                out.append({"role": "assistant", "text": "", "tools": [label], "at": d.get("timestamp")})
    return out[-limit:], len(out)


# ── Entry points ──────────────────────────────────────────────────────────


def recent(pattern, n):
    files = glob.glob(pattern, recursive=True)
    files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
    return files[:n]


def list_sessions(limit):
    sessions = []
    live = claude_live()
    files = recent(os.path.join(CLAUDE, "projects", "*", "*.jsonl"), limit)
    # A running session whose file is older than the cut still belongs on top.
    for sid in live:
        for f in glob.glob(os.path.join(CLAUDE, "projects", "*", sid + ".jsonl")):
            if f not in files:
                files.append(f)
    for f in files:
        try:
            s = claude_summary(f)
        except Exception:
            continue
        s["updated"] = os.path.getmtime(f)
        rec = live.get(s["id"])
        if rec:
            s["live"] = True
            s["pid"] = rec.get("pid")
            s["status"] = rec.get("status")
            s["name"] = rec.get("name")
            s["kind"] = rec.get("kind")
            s["cwd"] = s["cwd"] or rec.get("cwd")
            if rec.get("statusUpdatedAt"):
                s["status_at"] = iso_ms(rec["statusUpdatedAt"])
        sessions.append(s)
    for f in recent(os.path.join(CODEX, "sessions", "**", "*.jsonl"), max(limit // 2, 10)):
        try:
            s = codex_summary(f)
        except Exception:
            continue
        s["updated"] = os.path.getmtime(f)
        # Codex leaves no pid file; a file written in the last two minutes is taken as running.
        if time.time() - s["updated"] < 120:
            s["live"] = True
            s["status"] = "recent"
        sessions.append(s)
    sessions = [s for s in sessions if s["messages"] > 0 or s.get("live")]
    sessions.sort(key=lambda s: (bool(s.get("live")), s["updated"]), reverse=True)
    for s in sessions:
        s["updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(s["updated"]))
        s["live"] = bool(s.get("live"))
    counts = {
        "claude": len(glob.glob(os.path.join(CLAUDE, "projects", "*", "*.jsonl"))),
        "codex": len(glob.glob(os.path.join(CODEX, "sessions", "**", "*.jsonl"), recursive=True)),
    }
    return {"host": socket.gethostname(), "home": HOME, "sessions": sessions, "totals": counts}


def transcript(agent, path, limit):
    real = os.path.realpath(path)
    root = os.path.realpath(os.path.join(CLAUDE, "projects") if agent == "claude" else os.path.join(CODEX, "sessions"))
    if not real.startswith(root + os.sep) or not real.endswith(".jsonl"):
        return {"error": "not a session file"}
    if not os.path.isfile(real):
        return {"error": "that session file is gone"}
    msgs, total = (claude_transcript if agent == "claude" else codex_transcript)(real, limit)
    return {"messages": msgs, "total": total,
            "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(real)))}


def main():
    a = ARGS  # noqa: F821 — prepended by Loom
    if a.get("op") == "transcript":
        res = transcript(a.get("agent"), a.get("file", ""), int(a.get("limit", 120)))
    else:
        res = list_sessions(int(a.get("limit", 40)))
    sys.stdout.write(json.dumps(res, ensure_ascii=False))


main()

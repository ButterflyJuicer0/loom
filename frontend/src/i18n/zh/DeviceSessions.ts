// DeviceSessions.tsx: the Claude Code, Codex and Kiro sessions found on a device or on this server.
export default {
  // The head.
  "Sessions on {name}": "{name} 上的会话",
  "Sessions · {name}": "会话 · {name}",
  "{live} running · {recent} recent": "{live} 个运行中 · 最近 {recent} 个",
  Refresh: "刷新",

  // Smart pick.
  "Describe the task to pick its session…": "描述任务，找出对应的会话…",
  "Pick the session this task belongs to": "找出这个任务所属的会话",
  "Picking…": "挑选中…",
  Pick: "挑选",
  "Suggested (by matching words)": "推荐（按关键词匹配）",
  Suggested: "推荐",
  Clear: "清除",
  "No session looks like that task.": "没有会话和这个任务相符。",

  // The list.
  All: "全部",
  Running: "运行中",
  "Scanning {name}…": "正在扫描 {name}…",
  "No sessions here.": "这里没有会话。",
  "Running now": "正在运行",
  Recent: "最近",
  "Pick a session to see its conversation.": "选择一个会话，查看它的对话。",

  // A card.
  running: "运行中",
  "not running": "未运行",
  server: "服务器",
  "{n} msgs": "{n} 条消息",
  "just now": "刚刚",
  "{n}m ago": "{n} 分钟前",
  "{n}h ago": "{n} 小时前",
  "{n}d ago": "{n} 天前",

  // The open session.
  "this server": "本服务器",
  "a Loom session": "Loom 会话",
  "updated {when}": "更新于 {when}",
  "Session id": "会话 ID",
  "Still running — stop it first": "仍在运行，请先停止",
  "Delete from this server": "从本服务器删除",
  "Delete from {device}": "从“{device}”删除",
  "Reading the conversation…": "正在读取对话…",
  "Showing the last {n} of {total} messages": "共 {total} 条消息，显示最近 {n} 条",

  // Carrying it on in Loom.
  "One of Loom's own sessions: it opens as it is.": "这是 Loom 自己的会话，会直接打开。",
  "Open in Loom": "在 Loom 中打开",
  "What next? Leave empty to open it on a recap. {where}": "接下来做什么？留空则先回顾一遍再开始。{where}",
  "Runs on this server in {path}.": "将在本服务器的 {path} 中运行。",
  "Runs on this server.": "将在本服务器上运行。",
  "Runs on {device} in {path}.": "将在“{device}”的 {path} 中运行。",
  "Runs on {device}.": "将在“{device}”上运行。",
  "Still open on this server: the new session works beside it.": "它在本服务器上还开着：新会话会和它并行工作。",
  "Still open on {device}: the new session works beside it.": "它在“{device}”上还开着：新会话会和它并行工作。",
  "Starting…": "启动中…",
  "Continue in Loom": "在 Loom 中继续",

  // Deleting one.
  "Delete this {agent} session from this server?": "从本服务器删除这个 {agent} 会话？",
  "Delete this {agent} session from {device}?": "从“{device}”删除这个 {agent} 会话？",
  "It is one of Loom's own: it leaves the sidebar too. Its files go to the trash, here and in Loom.":
    "这是 Loom 自己的会话：它也会从侧边栏消失。它在这里和 Loom 里的文件都会移到回收站。",
  "“{title}” — its files go to the trash on this server, so it can be put back from there.":
    "“{title}”——它的文件会移到本服务器的回收站，可以从那里恢复。",
  "“{title}” — its files go to the trash on {device}, so it can be put back from there.":
    "“{title}”——它的文件会移到“{device}”的回收站，可以从那里恢复。",
  "Deleting from this server…": "正在从本服务器删除…",
  "Deleting from {device}…": "正在从“{device}”删除…",
} satisfies Record<string, string>

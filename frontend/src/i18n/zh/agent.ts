// agent.ts: the lines the timeline writes itself (notices, retries). They go
// through `say`, which Chat.tsx fills with `t`; agent.ts does not import i18n.
export default {
  error: "错误",
  interrupted: "已中断",
  "Removed from its project": "已从项目中移出",
  "Loom filed this session under {name}": "Loom 已将此会话归入 {name}",
  "Moved to {name}": "已移到 {name}",
  // {count} is " 2" or " 2/10", or nothing.
  "API {status}, retrying{count}": "API {status}，正在重试{count}",
  "API {status}, retrying{count} in {s}s": "API {status}，{s} 秒后重试{count}",
  "context compacted automatically": "上下文已自动压缩",
  "context compacted": "上下文已压缩",
  // After either of the two above.
  ": {pre} → {post}": "：{pre} → {post}",
  "reload: Claude Code restarts on its next turn, Codex once no Codex turn is running":
    "重新加载：Claude Code 会在下一轮重启，Codex 会在没有 Codex 轮次运行时重启",
} satisfies Record<string, string>

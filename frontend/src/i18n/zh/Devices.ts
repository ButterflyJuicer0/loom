// Devices.tsx: the devices dialog — add, rename, remove, and the install command.
export default {
  Devices: "设备",
  "No devices yet. Add your Mac, PC or a WSL box, run the command it gives you there, and agents can run commands on it.":
    "还没有设备。添加你的 Mac、PC 或 WSL，在那台机器上运行这里给出的命令，智能体就能在它上面执行命令。",
  "name, e.g. mac": "名称，例如 mac",
  "Adding…": "添加中…",
  Icon: "图标",

  // The groups.
  Other: "其他",
  Offline: "离线",

  // A device's row.
  online: "在线",
  offline: "离线",
  "never connected": "从未连接",
  "seen just now": "刚刚在线",
  "seen {n}m ago": "{n} 分钟前在线",
  "seen {n}h ago": "{n} 小时前在线",
  "seen {n}d ago": "{n} 天前在线",
  "Double-click to rename": "双击重命名",
  "Claude Code and Codex sessions on this device": "这台设备上的 Claude Code 和 Codex 会话",
  sessions: "会话",
  "New install command (replaces this device's token)": "生成新的安装命令（会替换这台设备的令牌）",
  install: "安装",
  "Remove device": "移除设备",

  // Removing one.
  "Remove {name}? loom-node uninstalls itself from it: right away if it is online, otherwise the next time it connects.":
    "移除“{name}”？loom-node 会从这台设备上自行卸载：设备在线则立即卸载，否则在它下次连接时卸载。",
  "It is the workstation of {names}, who will stop working until given another.":
    "它是 {names} 的工作站，移除后他们会停止工作，直到分配新的工作站。",
  // Between the items of a list.
  ", ": "、",

  // The install box.
  "Run in a terminal — works once, within 2 minutes:": "在终端中运行——只能使用一次，2 分钟内有效：",
  "Run in PowerShell — works once, within 2 minutes:": "在 PowerShell 中运行——只能使用一次，2 分钟内有效：",
  // "Install the [Loom Node app], open it, and enter this code:" — the middle is a link.
  "Install the": "安装",
  "Loom Node app": "Loom Node 应用",
  ", open it, and enter this code:": "，打开后输入这个安装码：",
} satisfies Record<string, string>

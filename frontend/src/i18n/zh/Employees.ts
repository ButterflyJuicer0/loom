export default {
  // Where an employee stands
  Working: "进行中",
  Sleeping: "休眠中",
  Paused: "已暂停",
  "Budget reached": "预算已用完",
  "Needs you": "需要你处理",
  "Workstation offline": "工作站离线",

  // The page and its tabs
  "{name} · updates": "{name} · 动态",
  "Show sidebar": "显示侧边栏",
  Updates: "动态",
  Chat: "会话",
  KPIs: "KPI",
  Reports: "报告",

  // The bar under the header
  "wakes {time}": "{time} 唤醒",
  Restricted: "受限",
  "Spent today, of today's budget": "今日已用 / 今日预算",
  "Wake it now": "立即唤醒",
  Wake: "唤醒",
  "Let it carry on": "让它继续工作",
  "Stop it, now and until resumed": "立即停下，恢复前不再工作",
  Resume: "继续",
  Pause: "暂停",
  "Today's budget is spent": "今日预算已用完",
  "— {spent} of {cap}. It rests until you approve more, or until tomorrow.":
    "— 已用 {spent}，预算 {cap}。追加预算后它才会继续，否则休息到明天。",
  "+{amount} today": "今日 +{amount}",
  other: "其他",
  "{n} turns": "{n} 轮",

  // KPIs
  "To do": "待办",
  "In progress": "进行中",
  "For review": "待验收",
  Parked: "搁置",
  "Avg. progress": "平均进度",
  "New KPI": "新建 KPI",
  'No KPIs yet. Add one here, or tell {name} in the chat — "research X by Friday" becomes a KPI.':
    "还没有 KPI。在这里添加，或者直接在会话里告诉 {name}，比如“周五前调研 X”就会成为一项 KPI。",
  high: "高优先级",
  low: "低优先级",
  "due {date}": "{date} 截止",
  "Done when: {criteria}": "完成标准：{criteria}",
  Accept: "通过",
  "Send back": "退回",
  Title: "标题",
  "e.g. A market report on X": "例如：一份关于 X 的市场报告",
  What: "任务内容",
  "The task, in as much detail as it needs.": "把任务说清楚，需要多细就写多细。",
  "Done when": "完成标准",
  "How you will check it: tests pass, five sources cited…": "你会怎么验收：测试通过、引用五个来源…",
  Due: "截止日期",
  Priority: "优先级",
  High: "高",
  Normal: "普通",
  Low: "低",
  Status: "状态",
  "Progress · {n}%": "进度 · {n}%",
  "Delete {title}?": "删除“{title}”？",
  "The KPI goes from the list. What was done for it stays in the work log.":
    "这项 KPI 会从列表中移除，已做的工作仍保留在工作记录中。",
  "What is missing from “{title}”": "“{title}”还缺什么",
  "It goes to its next wake-up, which is now.": "它会立即被唤醒，并看到这段话。",

  // Reports
  "All reports": "全部报告",
  "loading…": "加载中…",
  "None yet. A weekly report comes on {day} at {time}.": "暂无报告。周报会在每{day} {time} 生成。",
  "report|Weekly": "周报",
  "report|Daily": "日报",
  "kpi|Open": "未完成",
  "Recent work": "近期工作",
  "Nothing yet.": "暂无内容。",
  "Spend, last days": "近几日花费",
  "Nothing spent yet.": "还没有花费。",
  "today {time}": "今天 {time}",

  // Settings
  Monday: "周一",
  Tuesday: "周二",
  Wednesday: "周三",
  Thursday: "周四",
  Friday: "周五",
  Saturday: "周六",
  Sunday: "周日",
  Schedule: "日程",
  "Working hours": "工作时间",
  "All day": "全天",
  "Between…": "指定时段…",
  From: "从",
  To: "到",
  "Heartbeat, min": "心跳间隔（分钟）",
  "Shortest sleep, min": "最短休眠（分钟）",
  "Longest turn, min": "单轮最长（分钟）",
  "Weekly report": "周报",
  at: "时间",
  "Times are Beijing time (UTC+8).": "以上时间均为北京时间（UTC+8）。",
  "Agent, model and budget": "引擎、模型与预算",
  Agent: "引擎",
  Model: "模型",
  "Spent, it stops and asks you; what you approve on top counts for that day only. The agent is for good; a model change applies once its sessions restart.":
    "预算用完后它会停下来问你；你追加批准的额度仅当天有效。引擎选定后不可更改；更换模型会在它的会话重启后生效。",
  "{agent} reports no cost, so the budget is turns a day; past it, it stops and asks you, and what you approve counts for that day only. The agent is for good; a model change applies once its sessions restart.":
    "{agent} 不报告花费，所以预算按每天的轮数计；超出后它会停下来问你，你批准的额度仅当天有效。引擎选定后不可更改；更换模型会在它的会话重启后生效。",
  "Ask me first before": "做这些事之前先问我",
  "One per line. It asks with an urgent update, and waits.": "每行一项。它会发一条紧急动态来问你，然后等你答复。",
  Permissions: "权限",
  "Every tool, like any chat.": "可使用全部工具，与普通会话一样。",
  "Hard, for its work: Claude Code itself refuses anything else there, and refusals show in Updates. Its chat with you is not limited.":
    "硬性限制，仅针对它的工作：超出范围的操作会被 Claude Code 直接拒绝，拒绝记录显示在“动态”中。它与你的会话不受限制。",
  "Hard limits — only some tools, only some commands — are set in conversation.":
    "硬性限制（只允许部分工具、部分命令）需要在会话中设定。",
  "Change in a chat": "在会话中修改",
  Workspace: "工作区",
  Advanced: "高级",
  Workstation: "工作站",
  "This server": "本服务器",
  "{name} (offline)": "{name}（离线）",
  "{name} (removed)": "{name}（已移除）",
  "Its chats and memory stay on this server; what it does — commands, files, browsing, the web — happens on the workstation. While that is offline it does not work, and costs nothing.":
    "它的会话和记忆保留在本服务器；实际操作（命令、文件、浏览器、联网）都在工作站上进行。工作站离线时它不工作，也不产生费用。",
  "Let go": "解雇",
  Saved: "已保存",
  "Let {name} go?": "解雇 {name}？",
  "Its chat and updates, its KPIs and reports, and the workspace {workspace}. This cannot be undone.":
    "它的会话和动态、KPI 和报告，以及工作区 {workspace} 都将被删除。此操作无法撤销。",

  // Who it is: hiring and settings
  Name: "名称",
  "e.g. 小研": "例如：小研",
  Role: "岗位",
  "e.g. researcher, developer": "例如：研究员、开发工程师",
  "How it should work": "工作方式",
  "e.g. Careful and thorough. Every conclusion with its sources. Prefer small, tested changes.":
    "例如：细致周全，每个结论都附上来源；倾向小步修改，改完先测试。",
  "Writes to you in": "沟通语言",
  "Projects it may work in": "可参与的项目",
  "No projects yet; it has its own workspace either way.": "还没有项目；不过它有自己的工作区。",
  "Soft: it is told to stay in these, and nothing else stops it.": "软性约束：只是告知它留在这些项目内，没有强制限制。",

  // Hiring
  "Hire a virtual employee": "招聘虚拟员工",
  "Describe it in a chat": "在会话中描述",
  "Say what you need; the agent sets it up, permissions included, once you agree.":
    "说出你的需求，经你确认后自动完成设置，包括权限。",
  "or fill in the form": "或填写表单",
  "{hint} For good, as for any session.": "{hint}选定后不可更改，与普通会话一样。",
  "It starts at once: looks around, then sleeps until there is work. Wakes every 2 hours and writes a weekly report on Fridays; all of it can be changed later.":
    "入职后立即开始：先熟悉环境，然后休眠到有工作为止。每 2 小时唤醒一次，每周五写周报；这些之后都可以修改。",
  Hire: "招聘",

  // Agents
  "Reports what each turn cost, so its budget is in dollars.": "会报告每轮的花费，所以预算按美元计。",
  "Kiro CLI, on your Kiro login. It reports no cost, so its budget is turns a day.":
    "Kiro CLI，使用你的 Kiro 登录。它不报告花费，所以预算按每天的轮数计。",
  "Needs `codex` on the server. It reports no cost, so its budget is turns a day.":
    "需要服务器上装有 `codex`。它不报告花费，所以预算按每天的轮数计。",
  "Auto (Kiro picks)": "自动（由 Kiro 选择）",
  "Codex's default": "Codex 默认",
  "Budget a day, $": "每日预算（$）",
  "Turns a day": "每日轮数",
} satisfies Record<string, string>

// Tasks.tsx: the scheduled prompts page, its composer and the task editor.
export default {
  // The page.
  "Show sidebar": "显示侧边栏",
  Tasks: "任务",
  "loading…": "加载中…",
  "Start from": "从模板开始",
  "Get started": "快速开始",

  // A card.
  "{kind} · paused": "{kind} · 已暂停",
  "Last run failed: {error}": "上次运行失败：{error}",

  // The composer at the foot.
  "Write a task out by hand": "手动填写任务",
  "Schedule a task": "安排一个任务",
  "Make it": "创建任务",

  // The editor.
  Task: "任务",
  "New task": "新建任务",
  Name: "名称",
  "e.g. Morning news": "例如：早间新闻",
  Instructions: "说明",
  "What it should do each time it runs.": "每次运行时要做什么。",
  Repeats: "重复",
  "Every day": "每天",
  Weekdays: "工作日",
  Weekly: "每周",
  Monthly: "每月",
  "Custom (cron)": "自定义（cron）",
  "Cron (minute hour day month weekday)": "Cron（分 时 日 月 周）",
  At: "时间",
  Day: "日期",
  Days: "星期",
  "Times are Beijing time (UTC+{n}).": "时间均为北京时间（UTC+{n}）。",
  "Open conversation": "打开会话",
  "Running now; the reply lands in its conversation.": "已开始运行，回复会出现在它的会话里。",
  "Run now": "立即运行",
  Resume: "继续",
  Pause: "暂停",
  Create: "创建",
  "Delete {name}?": "删除“{name}”？",
  "The task stops. Its conversation, and every reply so far, stays.": "任务会停止，它的会话和已有的回复都会保留。",

  // What the templates do (their names and prompts go to the server as written).
  "Every morning, the AI and cloud news worth knowing, in five bullets.": "每天早上，用五条要点讲完值得关注的 AI 和云计算新闻。",
  "Every Monday, what changed in AWS services and solutions architecture.": "每周一，汇总 AWS 服务和解决方案架构的最新变化。",
  "Each morning, disk, memory and services on this machine, and anything wrong.": "每天早上，检查这台机器的磁盘、内存和服务，有问题就指出来。",
  "Every Friday, which of Loom's dependencies have updates worth taking.": "每周五，看看 Loom 的依赖有哪些值得升级。",
  "Mondays and Thursdays, fresh postings that fit me.": "每周一和周四，找出适合我的最新职位。",
} satisfies Record<string, string>

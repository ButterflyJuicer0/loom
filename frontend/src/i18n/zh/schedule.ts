// schedule.ts: a task's cron expression as people say it.
export default {
  // Two characters each: the weekly picker shows a name's first two, and the
  // card's list of days its first three.
  Sunday: "周日",
  Monday: "周一",
  Tuesday: "周二",
  Wednesday: "周三",
  Thursday: "周四",
  Friday: "周五",
  Saturday: "周六",

  // A day of the month, as "Monthly on the {day}" takes it.
  "{n}st": "{n} 日",
  "{n}nd": "{n} 日",
  "{n}rd": "{n} 日",
  "{n}th": "{n} 日",

  // The card's blue word, and its last line.
  Daily: "每日",
  "Every day · {time}": "每天 · {time}",
  Weekdays: "工作日",
  "Monday to Friday · {time}": "周一至周五 · {time}",
  Weekly: "每周",
  "Every {day} · {time}": "每{day} · {time}",
  "Every {days} · {time}": "每{days} · {time}",
  // Between the items of a list.
  ", ": "、",
  Monthly: "每月",
  "Monthly on the {day} · {time}": "每月 {day} · {time}",
  Custom: "自定义",
} satisfies Record<string, string>

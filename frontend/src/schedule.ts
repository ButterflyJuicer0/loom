/**
 * A task's cron expression as people say it, and back: what the Tasks page
 * shows on a card ("Weekly", "Every Monday · 09:00") and what its editor
 * builds from a frequency, a time and a day. Anything the editor cannot
 * build is "Custom" and shown as the expression itself.
 *
 * Times are the task's own wall clock (see `Task.utc_offset`), so nothing
 * here converts anything.
 */
import { t } from "./i18n"

export type Frequency = "daily" | "weekdays" | "weekly" | "monthly" | "custom"

export type Schedule = {
  frequency: Frequency
  // "HH:MM".
  time: string
  // Weekly: 0 (Sunday) to 6.
  days: number[]
  // Monthly: 1 to 31.
  dom: number
  // Custom: the expression as typed.
  cron: string
}

export const DAY_NAMES = [t("Sunday"), t("Monday"), t("Tuesday"), t("Wednesday"), t("Thursday"), t("Friday"), t("Saturday")]
const SHORT = DAY_NAMES.map((d) => d.slice(0, 3))

const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null)

/** What the editor can show for `cron`; "custom" when it is not one of ours. */
export function readCron(cron: string): Schedule {
  const custom: Schedule = { frequency: "custom", time: "09:00", days: [1], dom: 1, cron }
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return custom
  const [m, h, dom, mon, dow] = parts
  const minute = num(m)
  const hour = num(h)
  if (minute === null || hour === null || minute > 59 || hour > 23 || mon !== "*") return custom
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  const base = { ...custom, time }

  if (dom === "*" && dow === "*") return { ...base, frequency: "daily" }
  if (dom === "*" && dow === "1-5") return { ...base, frequency: "weekdays" }
  if (dom === "*" && /^[0-7](,[0-7])*$/.test(dow)) {
    const days = [...new Set(dow.split(",").map((d) => Number(d) % 7))].sort()
    return { ...base, frequency: "weekly", days }
  }
  const day = num(dom)
  if (day !== null && day >= 1 && day <= 31 && dow === "*") return { ...base, frequency: "monthly", dom: day }
  return custom
}

/** The expression the editor's choices make. */
export function buildCron(s: Schedule): string {
  if (s.frequency === "custom") return s.cron.trim().split(/\s+/).join(" ")
  const [h, m] = s.time.split(":").map(Number)
  const at = `${m} ${h}`
  switch (s.frequency) {
    case "daily":
      return `${at} * * *`
    case "weekdays":
      return `${at} * * 1-5`
    case "weekly":
      return `${at} * * ${(s.days.length ? s.days : [1]).join(",")}`
    case "monthly":
      return `${at} ${s.dom} * *`
  }
}

const ORDINAL = (n: number) =>
  n % 10 === 1 && n !== 11
    ? t("{n}st", { n })
    : n % 10 === 2 && n !== 12
      ? t("{n}nd", { n })
      : n % 10 === 3 && n !== 13
        ? t("{n}rd", { n })
        : t("{n}th", { n })

/** The card's blue word, and its last line. */
export function describeCron(cron: string): { kind: string; when: string } {
  const s = readCron(cron)
  switch (s.frequency) {
    case "daily":
      return { kind: t("Daily"), when: t("Every day · {time}", { time: s.time }) }
    case "weekdays":
      return { kind: t("Weekdays"), when: t("Monday to Friday · {time}", { time: s.time }) }
    case "weekly":
      return {
        kind: t("Weekly"),
        when:
          s.days.length === 1
            ? t("Every {day} · {time}", { day: DAY_NAMES[s.days[0]], time: s.time })
            : t("Every {days} · {time}", { days: s.days.map((d) => SHORT[d]).join(t(", ")), time: s.time }),
      }
    case "monthly":
      return { kind: t("Monthly"), when: t("Monthly on the {day} · {time}", { day: ORDINAL(s.dom), time: s.time }) }
    case "custom":
      return { kind: t("Custom"), when: cron }
  }
}

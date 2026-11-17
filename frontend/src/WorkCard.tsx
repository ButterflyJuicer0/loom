import { AlarmClock, BellRing, ListChecks, MessageSquareShare, Play, Siren } from "lucide-react"
import { t } from "./i18n"
import "./Employees.css"

/**
 * A virtual employee's work card (`Loom.Employees.Card`), as the transcript
 * shows it: when it wakes next, the KPIs it moved, what it reported. Mid-stream
 * the JSON is unfinished, and so is the card.
 */
type Card = {
  next?: string
  wake_at?: string
  sleep_minutes?: number
  summary?: string
  kpis?: { id?: string; progress?: number; status?: string; note?: string }[]
  kpi_add?: { title?: string; due?: string }[]
  report?: { level?: string; text?: string }
  wake_now?: boolean
  note_for_work?: string
}

export function WorkCard({ text }: { text: string }) {
  let card: Card
  try {
    card = JSON.parse(text)
  } catch {
    return <div className="work-card pending">{t("work card…")}</div>
  }
  if (!card || typeof card !== "object") return null

  const next =
    card.next === "continue"
      ? t("Carrying on in a minute")
      : card.wake_at
        ? t("Sleeping until {time}", { time: card.wake_at })
        : card.sleep_minutes
          ? t("Sleeping {duration}", { duration: minutes(card.sleep_minutes) })
          : card.next === "sleep"
            ? t("Sleeping until the heartbeat")
            : null
  const level = card.report?.level

  return (
    <div className={"work-card" + (level ? " " + level : "")}>
      {card.report?.text && (
        <div className="work-card-row work-card-report">
          {level === "urgent" ? <Siren /> : <BellRing />}
          <span>
            <b>{level === "urgent" ? t("Needs you") : level === "important" ? t("Report") : t("Note")}</b> · {card.report.text}
          </span>
        </div>
      )}
      {card.kpis?.map((k, i) => (
        <div key={i} className="work-card-row">
          <ListChecks />
          <span>
            {k.id}
            {typeof k.progress === "number" && ` · ${k.progress}%`}
            {k.status && ` · ${k.status}`}
            {k.note && <span className="work-card-dim"> — {k.note}</span>}
          </span>
        </div>
      ))}
      {card.kpi_add?.map((k, i) => (
        <div key={`a${i}`} className="work-card-row">
          <ListChecks />
          <span>
            {t("New KPI · {title}", { title: k.title ?? "" })}
            {k.due && <span className="work-card-dim"> — {t("due {date}", { date: k.due })}</span>}
          </span>
        </div>
      ))}
      {card.note_for_work && (
        <div className="work-card-row">
          <MessageSquareShare />
          <span>
            {t("For the work session")} <span className="work-card-dim">— {card.note_for_work}</span>
          </span>
        </div>
      )}
      {card.wake_now && (
        <div className="work-card-row">
          <Play />
          <span>{t("Starting work now")}</span>
        </div>
      )}
      {next && (
        <div className="work-card-row work-card-dim">
          <AlarmClock />
          <span>{next}</span>
        </div>
      )}
    </div>
  )
}

const minutes = (n: number) => (n >= 60 ? t("{n} h", { n: Math.round((n / 60) * 10) / 10 }) : t("{n} min", { n }))

import { Moon, PanelLeft, Undo2 } from "lucide-react"
import { useEffect, useState, type ComponentProps } from "react"
import { Chat } from "./Chat"
import { Confirm } from "./Confirm"
import {
  dreamMemories,
  getDream,
  runDream,
  undoDream,
  updateDream,
  type AgentInfo,
  type Dream,
  type Memory,
} from "./api"
import "./Sleep.css"

/**
 * Sleep (`Loom.Dream`): each scope's memory gone over by night, in a session
 * of its own that the lists leave out and the moon opens. A scope is a
 * project, or "home" for the sessions outside any; Claude Code keeps one
 * memory directory for each.
 *
 * The session is the report: each night is a turn, and the user answers in
 * it. Beside it, the memory it keeps and the settings.
 */

export type SleepTab = "report" | "memory" | "settings"

export const isDream = (s: AgentInfo) => s.kind === "dream"
export const scopeOf = (s: AgentInfo) => s.project_id ?? "home"
const busy = (s: AgentInfo) => s.status === "starting" || s.status === "running"
/** Something it said that the user has not seen yet. */
export const unread = (s: AgentInfo) => !busy(s) && s.seq > (s.seen_seq ?? 0)

/** The moon: a scope's sleep, lit while it sleeps, marked when it has news. */
export function MoonButton({
  dream,
  active,
  label,
  onOpen,
  className = "",
  what = "",
}: {
  dream: AgentInfo | undefined
  active: boolean
  label?: string
  onOpen: () => void
  className?: string
  // Whose sleep, for the tooltip.
  what?: string
}) {
  const asleep = dream !== undefined && busy(dream)
  const news = dream !== undefined && unread(dream)
  const title = (asleep ? "Dreaming now" : news ? "Dream: a new report" : "Dream: memory and reports") + what
  return (
    <button
      className={
        "moon-btn" + (asleep ? " asleep" : "") + (news ? " news" : "") + (active ? " on" : "") + " " + className
      }
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    >
      <Moon />
      {label && <span>{label}</span>}
      {label && <span className="devices-count">{asleep ? "asleep" : news ? "new" : ""}</span>}
    </button>
  )
}

type ChatProps = Omit<ComponentProps<typeof Chat>, "session" | "tabs">

export function Sleep({
  session,
  scopeName,
  tab,
  onTab,
  onSeen,
  chat,
}: {
  session: AgentInfo
  scopeName: string
  tab: SleepTab
  onTab: (tab: SleepTab) => void
  // Read up to here; see `Loom.Agent.Session.seen/2`.
  onSeen: (seq: number) => void
  chat: ChatProps
}) {
  const scope = scopeOf(session)

  // The report is read once it is on screen, and again as it grows.
  useEffect(() => {
    if (tab === "report" && session.seq > (session.seen_seq ?? 0) && !busy(session)) onSeen(session.seq)
  }, [tab, session.seq, session.seen_seq, session.status])

  const tabs = (
    <div className="sleep-tabs" role="tablist">
      {(["report", "memory", "settings"] as const).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => onTab(t)}>
          {{ report: "Report", memory: "Memory", settings: "Settings" }[t]}
        </button>
      ))}
    </div>
  )

  const titled = { ...session, title: `Dream · ${scopeName}` }
  if (tab === "report") return <Chat {...chat} session={titled} tabs={tabs} />

  return (
    <div className="chat">
      <header className="chat-header">
        {!chat.sidebarOpen && (
          <button className="icon-btn" onClick={chat.onToggleSidebar} title="Show sidebar">
            <PanelLeft />
          </button>
        )}
        <span className="chat-name sleep-name">
          <Moon /> <span className="wide-only">Dream · {scopeName}</span>
        </span>
        {tabs}
        <span className="sleep-head-spacer" />
      </header>
      <div className="sleep-scroll">
        <div className="sleep-column">
          {tab === "memory" ? (
            <MemoryPane scope={scope} session={session} onReport={() => onTab("report")} />
          ) : (
            <SettingsPane scope={scope} scopeName={scopeName} session={session} />
          )}
        </div>
      </div>
    </div>
  )
}

// The scope's status, read again whenever the session settles: a sleep that
// just ended changed it.
function useDream(scope: string, session: AgentInfo) {
  const [dream, setDream] = useState<Dream | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    getDream(scope).then(setDream, (e: Error) => setError(e.message))
  }, [scope, session.status])
  return { dream, setDream, error, setError }
}

function MemoryPane({ scope, session, onReport }: { scope: string; session: AgentInfo; onReport: () => void }) {
  const { dream, setDream, error, setError } = useDream(scope, session)
  const [memories, setMemories] = useState<Memory[] | null>(null)
  const [undoing, setUndoing] = useState(false)
  useEffect(() => {
    dreamMemories(scope).then(setMemories, (e: Error) => setError(e.message))
  }, [scope, session.status, dream?.runs.length, dream?.can_undo])

  const asleep = busy(session)
  const sleepNow = async () => {
    try {
      setDream(await runDream(scope))
      onReport()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const kept = memories?.filter((m) => !m.archived) ?? []
  const archived = memories?.filter((m) => m.archived) ?? []

  return (
    <>
      {error && <div className="sleep-error">{error}</div>}
      <div className="sleep-bar">
        <Moon className={"sleep-bar-moon" + (asleep ? " asleep" : "")} />
        <div className="sleep-bar-text">
          <div>
            {asleep
              ? "Dreaming now…"
              : dream?.last_run_at
                ? `Last dreamed ${when(dream.last_run_at)}`
                : "Has not dreamed yet"}
          </div>
          {dream && !asleep && (
            <div className="sleep-dim">
              {dream.pending_sessions === 0
                ? "Nothing new since then"
                : `${dream.pending_sessions} session${dream.pending_sessions === 1 ? "" : "s"} to go over`}
              {dream.enabled ? ` · dreams on its own ${hours(dream.window)}` : " · only when asked"}
            </div>
          )}
        </div>
        {dream?.can_undo && !asleep && (
          <button className="text-btn sleep-undo" onClick={() => setUndoing(true)} title="Put the memory back as it was before the last sleep">
            <Undo2 /> Undo last dream
          </button>
        )}
        <button className="sleep-now" disabled={asleep || !dream} onClick={sleepNow}>
          Dream now
        </button>
      </div>

      {memories === null && !error && <div className="sleep-dim">loading…</div>}
      {memories?.length === 0 && (
        <div className="sleep-empty">
          No memories yet. Claude Code saves them as you work here, and Dream tidies them by night.
        </div>
      )}
      {kept.map((m) => (
        <MemoryRow key={m.file} m={m} />
      ))}
      {archived.length > 0 && (
        <>
          <h2 className="sleep-section">Archived</h2>
          <div className="sleep-dim sleep-note">Set aside by Dream for going unused. Still there, out of the index.</div>
          {archived.map((m) => (
            <MemoryRow key={m.file} m={m} />
          ))}
        </>
      )}
      {dream?.memory_dir && <div className="sleep-path">{dream.memory_dir}</div>}

      {undoing && (
        <Confirm
          title="Undo the last dream?"
          detail="The memory goes back to how it was before it. The report stays."
          action="Undo"
          onYes={async () => setDream(await undoDream(scope))}
          onClose={() => setUndoing(false)}
        />
      )}
    </>
  )
}

function MemoryRow({ m }: { m: Memory }) {
  const index = m.file === "MEMORY.md"
  return (
    <div className={"memory-row" + (m.archived ? " archived" : "")}>
      <span className={"memory-type " + (index ? "index" : (m.type ?? ""))}>{index ? "index" : (m.type ?? "—")}</span>
      <div className="memory-text">
        <div className="memory-name">{index ? "MEMORY.md" : m.name}</div>
        {!index && m.description && <div className="memory-desc">{m.description}</div>}
      </div>
      <span className="memory-when" title={new Date(m.mtime).toLocaleString()}>
        {when(m.mtime)}
      </span>
    </div>
  )
}

function SettingsPane({ scope, scopeName, session }: { scope: string; scopeName: string; session: AgentInfo }) {
  const { dream, setDream, error, setError } = useDream(scope, session)
  if (!dream) return error ? <div className="sleep-error">{error}</div> : <div className="sleep-dim">loading…</div>

  // The box or the hour moves on the tap; back, with why, if the server says no.
  const save = async (attrs: Parameters<typeof updateDream>[1]) => {
    const before = dream
    setDream({ ...dream, ...attrs })
    try {
      setDream(await updateDream(scope, attrs))
      setError(null)
    } catch (e) {
      setDream(before)
      setError((e as Error).message)
    }
  }
  const here = -new Date().getTimezoneOffset()
  const [from, to] = dream.window

  return (
    <>
      {error && <div className="sleep-error">{error}</div>}
      <label className="sleep-setting sleep-check">
        <input type="checkbox" checked={dream.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
        <span>
          Dream on its own at night
          <span className="sleep-dim"> — for {scopeName}. Off, it dreams only when asked.</span>
        </span>
      </label>

      <div className="sleep-setting">
        <span>Night</span>
        <select value={from} onChange={(e) => save({ window: [Number(e.target.value), to] })}>
          {HOURS.map((h) => (
            <option key={h} value={h} disabled={h === to}>
              {pad(h)}:00
            </option>
          ))}
        </select>
        <span>to</span>
        <select value={to} onChange={(e) => save({ window: [from, Number(e.target.value)] })}>
          {HOURS.map((h) => (
            <option key={h} value={h} disabled={h === from}>
              {pad(h)}:00
            </option>
          ))}
        </select>
        <span className="sleep-dim">
          {utc(dream.utc_offset)}, for every project
          {dream.utc_offset !== here && (
            <>
              {" · "}
              <button className="link-btn" onClick={() => save({ utc_offset: here })}>
                use this device's ({utc(here)})
              </button>
            </>
          )}
        </span>
      </div>
      <div className="sleep-dim sleep-note">
        A night's dream waits until nothing here has been touched for half an hour, and goes over only what changed
        since the last one.
      </div>

      <h2 className="sleep-section">Recent nights</h2>
      {dream.runs.length === 0 && <div className="sleep-dim">None yet.</div>}
      {dream.runs.map((r) => (
        <div key={r.at} className={"sleep-run" + (r.undone ? " undone" : "")}>
          <span>{new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
          <span className="sleep-dim">
            {r.sessions === 0 ? "nothing new" : `${r.sessions} session${r.sessions === 1 ? "" : "s"}`}
            {r.undone && " · undone"}
          </span>
        </div>
      ))}
    </>
  )
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const pad = (n: number) => String(n).padStart(2, "0")
const hours = ([from, to]: [number, number]) => `${pad(from)}:00–${pad(to)}:00`
const utc = (offset: number) =>
  `UTC${offset >= 0 ? "+" : "−"}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? ":" + pad(Math.abs(offset) % 60) : ""}`

function when(ms: number) {
  const d = new Date(ms)
  const today = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
  if (d.toDateString() === today.toDateString()) return `today ${time}`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + time
}

import { ArrowUp, Bell, Check, CheckCircle2, Circle, Clock, History, MessageSquare, Moon, X } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  addTodo,
  deleteTodo,
  dismissNotice,
  laterNotice,
  updateTodo,
  type Notice,
  type Todo,
} from "./api"
import "./Notices.css"

/**
 * The bell (`Loom.Notices`): what the agents working for the user want them
 * to see, most urgent first. One list; a card is who, one line, the start
 * of its brief, and its priority. Nothing is answered on the card: tapping
 * it opens the notice's own session, which opens on the whole brief and
 * passes the user's decision to where it came from. On the card, only Done,
 * and Later for an urgent or important one.
 *
 * The bands, by priority: 0–2 urgent and 3–5 important (notified at once,
 * one each; only 0 between 00:00 and 07:00), 6–10 the rest.
 *
 * Beside the notices, the user's to-dos.
 */

type Tab = "notices" | "todos"

/** Put off by the user, and not yet back. */
export const putOff = (n: Notice) => (n.later_until ?? 0) > Date.now()
export const urgent = (n: Notice) => n.status === "open" && n.priority <= 2 && !putOff(n)
export const important = (n: Notice) => n.status === "open" && n.priority >= 3 && n.priority <= 5 && !putOff(n)

const BANDS: { label: string; tone: string; has: (n: Notice) => boolean }[] = [
  { label: "Urgent", tone: "urgent", has: (n) => n.priority <= 2 },
  { label: "Important", tone: "important", has: (n) => n.priority >= 3 && n.priority <= 5 },
  { label: "Other", tone: "other", has: (n) => n.priority >= 6 },
]

/** Most urgent first, then newest. */
export const openNotices = (notices: Notice[]) =>
  notices.filter((n) => n.status === "open").sort((a, b) => a.priority - b.priority || b.created_at - a.created_at)

/** The sidebar's bell: a count of the urgent ones, else a dot for important. */
export function BellButton({ notices, onClick }: { notices: Notice[]; onClick: () => void }) {
  const count = notices.filter(urgent).length
  const dot = count === 0 && notices.some(important)
  return (
    <button className="icon-btn bell-btn" onClick={onClick} title="Notifications">
      <Bell />
      {count > 0 && <span className="bell-count">{count > 9 ? "9+" : count}</span>}
      {dot && <span className="bell-dot" />}
    </button>
  )
}

export function NoticesSheet({
  notices,
  todos,
  onOpen,
  onAnswered,
  onClose,
}: {
  notices: Notice[]
  todos: Todo[]
  onOpen: (n: Notice) => void
  onAnswered: (n: Notice) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>("notices")
  const [history, setHistory] = useState(false)
  const all = openNotices(notices)
  const open = all.filter((n) => !putOff(n))
  const later = all.filter(putOff).sort((a, b) => (a.later_until ?? 0) - (b.later_until ?? 0))
  const settled = notices.filter((n) => n.status !== "open").sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0))
  const openTodos = todos.filter((t) => !t.done).length

  return createPortal(
    <div className="search-sheet" onClick={onClose}>
      <div className={"search-panel bell-panel"} onClick={(e) => e.stopPropagation()}>
        <div className="bell-head">
          <div className="bell-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "notices"} className={tab === "notices" ? "on" : ""} onClick={() => setTab("notices")}>
              Notifications{open.length > 0 && <span className="bell-tab-n">{open.length}</span>}
            </button>
            <button role="tab" aria-selected={tab === "todos"} className={tab === "todos" ? "on" : ""} onClick={() => setTab("todos")}>
              To-do{openTodos > 0 && <span className="bell-tab-n">{openTodos}</span>}
            </button>
          </div>
          {tab === "notices" && (
            <button
              className={"icon-btn" + (history ? " on" : "")}
              onClick={() => setHistory((h) => !h)}
              title={history ? "Back to the open ones" : "History"}
            >
              <History />
            </button>
          )}
          <button className="icon-btn" onClick={onClose} title="Close">
            <X />
          </button>
        </div>
        {tab === "todos" ? (
          <TodoList todos={todos} />
        ) : (
          <div className="search-results bell-list">
            {history ? (
              settled.length ? (
                settled.map((n) => <Card key={n.id} n={n} onOpen={onOpen} onAnswered={onAnswered} />)
              ) : (
                <div className="search-empty">Nothing yet.</div>
              )
            ) : all.length ? (
              <>
                {BANDS.map((band) => {
                  const inBand = open.filter(band.has)
                  return (
                    inBand.length > 0 && (
                      <section key={band.label}>
                        <div className={"bell-band " + band.tone}>{band.label}</div>
                        {inBand.map((n) => (
                          <Card key={n.id} n={n} onOpen={onOpen} onAnswered={onAnswered} />
                        ))}
                      </section>
                    )
                  )
                })}
                {later.length > 0 && (
                  <section>
                    <div className="bell-band later">Later</div>
                    {later.map((n) => (
                      <Card key={n.id} n={n} onOpen={onOpen} onAnswered={onAnswered} />
                    ))}
                  </section>
                )}
              </>
            ) : (
              <div className="bell-empty">
                <CheckCircle2 />
                <span>All caught up</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** The user's own list: added here, or by an agent told to; ticked off here. */
function TodoList({ todos: given }: { todos: Todo[] }) {
  const [text, setText] = useState("")
  const [due, setDue] = useState("")
  const [showDone, setShowDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A tick or a removal shows on the tap, before the server's list comes back
  // with it; the next list from the server replaces these guesses.
  const [guess, setGuess] = useState<Record<string, boolean | "gone">>({})
  // Added here and not yet in the server's list.
  const [adding, setAdding] = useState<Todo[]>([])
  useEffect(() => {
    setGuess({})
    setAdding((a) => a.filter((t) => !given.some((g) => g.text === t.text && g.due === t.due)))
  }, [given])
  const todos = [...given, ...adding]
    .filter((t) => guess[t.id] !== "gone")
    .map((t) => (typeof guess[t.id] === "boolean" ? { ...t, done: guess[t.id] as boolean } : t))
  const open = todos.filter((t) => !t.done)
  const done = todos.filter((t) => t.done)
  const today = new Date().toLocaleDateString("sv")

  const run = (id: string, change: boolean | "gone", call: Promise<unknown>) => {
    setError(null)
    setGuess((g) => ({ ...g, [id]: change }))
    call.catch((err) => {
      setGuess((g) => {
        const { [id]: _, ...rest } = g
        return rest
      })
      setError((err as Error).message)
    })
  }
  // The field clears on the tap; what was typed comes back if it failed.
  const add = () => {
    const what = text.trim()
    if (!what) return
    const when = due
    setText("")
    setDue("")
    setError(null)
    const row: Todo = { id: `adding-${Date.now()}`, text: what, due: when || null, session: null, by: "you", done: false, created_at: Date.now() }
    setAdding((a) => [...a, row])
    addTodo(what, when || null).catch((err) => {
      setAdding((a) => a.filter((t) => t !== row))
      setText(what)
      setDue(when)
      setError((err as Error).message)
    })
  }

  const row = (t: Todo) => (
    <div key={t.id} className={"todo-row" + (t.done ? " done" : "")}>
      <button className="todo-check" onClick={() => run(t.id, !t.done, updateTodo(t.id, { done: !t.done }))} title={t.done ? "Not done" : "Done"}>
        {t.done ? <CheckCircle2 /> : <Circle />}
      </button>
      <span className="todo-text">
        {t.text}
        {(t.due || t.by !== "you") && (
          <span className="todo-meta">
            {t.due && <span className={!t.done && t.due < today ? "late" : t.due === today ? "today" : ""}>{t.due}</span>}
            {t.by !== "you" && <span>via {t.by}</span>}
          </span>
        )}
      </span>
      <button className="todo-rm" onClick={() => run(t.id, "gone", deleteTodo(t.id))} title="Remove">
        <X />
      </button>
    </div>
  )

  return (
    <div className="search-results bell-list">
      <form
        className="todo-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={text} placeholder="Add a to-do" enterKeyHint="done" onChange={(e) => setText(e.target.value)} />
        <input className="todo-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} title="Due" />
        <button className="bell-send" type="submit" disabled={!text.trim()} title="Add">
          <ArrowUp />
        </button>
      </form>
      {error && <div className="bell-note bell-error">{error}</div>}
      {open.map(row)}
      {open.length === 0 && <div className="search-empty">Nothing to do.</div>}
      {done.length > 0 && (
        <>
          <button className="bell-band todo-done-toggle" onClick={() => setShowDone((v) => !v)}>
            Done · {done.length}
          </button>
          {showDone && done.map(row)}
        </>
      )}
    </div>
  )
}

/**
 * One notice, as the bell shows it; also under the turn it came from. Who,
 * one line, the start of its brief; tapping it opens the notice's own
 * session, where it is asked about and decided. Here only Later and Done.
 */
export function Card({
  n,
  onOpen,
  onAnswered,
}: {
  n: Notice
  onOpen?: (n: Notice) => void
  onAnswered: (n: Notice) => void
}) {
  const [busy, setBusy] = useState(false)
  const [choosingLater, setChoosingLater] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What a tap will make of it, shown at once; the server's answer replaces
  // it, a refusal puts the card back as it was, with why.
  const [guess, setGuess] = useState<Partial<Notice> | null>(null)
  n = guess ? { ...n, ...guess } : n
  const tone = n.priority <= 2 ? "urgent" : n.priority <= 5 ? "important" : "other"
  const act = async (call: () => Promise<Notice>, shown: Partial<Notice> = {}) => {
    setBusy(true)
    setError(null)
    setGuess(shown)
    setChoosingLater(false)
    try {
      onAnswered(await call())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGuess(null)
      setBusy(false)
    }
  }
  // What the user decided, beside "Approved in its chat" and the like.
  const said = n.answer && n.answer !== "approve" && n.answer !== "reject" ? `: ${n.answer}` : ""
  const canLater = n.status === "open" && n.priority <= 5 && !putOff(n)
  const opens = onOpen && (n.chat || n.session)

  return (
    <div
      className={"bell-card " + tone + (n.status === "open" ? "" : " settled") + (opens ? "" : " inline")}
      role={opens ? "button" : undefined}
      onClick={() => opens && onOpen?.(n)}
    >
      <div className="bell-card-head">
        <SourceMark n={n} />
        <span className="bell-source">{n.source.name}</span>
        <span className="bell-age">· {when(n.updated_at)}</span>
        <span className={"bell-p " + tone}>P{n.priority}</span>
      </div>
      <div className="bell-summary">{n.summary}</div>
      {n.detail && <div className="bell-detail">{plain(n.detail)}</div>}
      {n.note && (
        <div className="bell-note">
          {n.note}
          {said}
        </div>
      )}
      {n.status === "open" && putOff(n) && <div className="bell-note">Later · back at {clock(n.later_until!)}</div>}
      {/* Put off, or done with: the rest is decided in its own session. */}
      {n.status === "open" && (
        <div className="bell-acts" onClick={(e) => e.stopPropagation()}>
          {choosingLater ? (
            <>
              {laterChoices().map(([label, at]) => (
                <button
                  key={label}
                  className="bell-btn"
                  disabled={busy}
                  onClick={() => act(() => laterNotice(n.id, at), { later_until: at })}
                >
                  {label}
                </button>
              ))}
              <button className="bell-btn bell-icon" onClick={() => setChoosingLater(false)} title="Cancel">
                <X />
              </button>
            </>
          ) : (
            <>
              {canLater && (
                <button className="bell-btn" disabled={busy} onClick={() => setChoosingLater(true)}>
                  <Clock /> Later
                </button>
              )}
              <button className="bell-btn" disabled={busy} onClick={() => act(() => dismissNotice(n.id), { status: "done", note: "Dismissed" })}>
                <Check /> Done
              </button>
            </>
          )}
        </div>
      )}
      {error && <div className="bell-note bell-error">{error}</div>}
    </div>
  )
}

/** Where "Later" can put a notice: in an hour or three, tonight, tomorrow morning. */
function laterChoices(): [string, number][] {
  const now = new Date()
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d.getTime()
  }
  const hour = 3_600_000
  const choices: [string, number][] = [
    ["1 h", now.getTime() + hour],
    ["3 h", now.getTime() + 3 * hour],
  ]
  if (now.getHours() < 19) choices.push(["Tonight", at(0, 20)])
  choices.push(["Tomorrow", at(1, 9)])
  return choices
}

/** The brief is markdown; on the card, only its words. */
function plain(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function clock(ms: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`
}

function SourceMark({ n }: { n: Notice }) {
  if (n.source.kind === "dream") return <Moon className="bell-mark" />
  if (n.source.kind === "employee") return <span className="emp-avatar sm">{[...n.source.name.trim()][0] ?? "?"}</span>
  return <MessageSquare className="bell-mark" />
}

function when(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

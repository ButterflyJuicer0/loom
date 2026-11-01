import { ArrowUp, Bell, Check, CheckCircle2, Circle, Clock, History, MessageSquare, Moon, Reply, X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  addTodo,
  answerNotice,
  deleteTodo,
  dismissNotice,
  laterNotice,
  replyNotice,
  updateTodo,
  type Notice,
  type Todo,
} from "./api"
import "./Notices.css"

/**
 * The bell (`Loom.Notices`): what the agents working for the user want them
 * to see, most urgent first. One list; a card is who, one line, and its
 * priority. Approving takes a tap here; anything else is answered where it
 * came from, which tapping the card opens. A card carries what is needed to
 * answer it there: the background, and the answers its source foresees as
 * buttons. An urgent or important one can be put off until later.
 *
 * The bands, by priority: 0–2 urgent (notified at once), 3–5 important (one
 * notification at 20:00), 6–10 the rest.
 *
 * Beside the notices, the user's to-dos, and a chat with the bell's own
 * session to go through both in plain words.
 */

type Tab = "notices" | "todos" | "chat"

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
  chat,
  onWantChat,
  onOpen,
  onAnswered,
  onClose,
}: {
  notices: Notice[]
  todos: Todo[]
  // The bell's chat, once its session exists; asked for whenever it is opened.
  chat: ReactNode | null
  onWantChat: () => void
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

  // Each time, not just the first: the server starts the chat afresh each day.
  useEffect(() => {
    if (tab === "chat") onWantChat()
  }, [tab])

  return createPortal(
    <div className="search-sheet" onClick={onClose}>
      <div className={"search-panel bell-panel" + (tab === "chat" ? " chatting" : "")} onClick={(e) => e.stopPropagation()}>
        <div className="bell-head">
          <div className="bell-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "notices"} className={tab === "notices" ? "on" : ""} onClick={() => setTab("notices")}>
              Notifications{open.length > 0 && <span className="bell-tab-n">{open.length}</span>}
            </button>
            <button role="tab" aria-selected={tab === "todos"} className={tab === "todos" ? "on" : ""} onClick={() => setTab("todos")}>
              To-do{openTodos > 0 && <span className="bell-tab-n">{openTodos}</span>}
            </button>
            <button role="tab" aria-selected={tab === "chat"} className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
              Chat
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
        {tab === "chat" ? (
          <div className="bell-chat">{chat ?? <div className="bell-empty">Starting…</div>}</div>
        ) : tab === "todos" ? (
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
function TodoList({ todos }: { todos: Todo[] }) {
  const [text, setText] = useState("")
  const [due, setDue] = useState("")
  const [showDone, setShowDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = todos.filter((t) => !t.done)
  const done = todos.filter((t) => t.done)
  const today = new Date().toLocaleDateString("sv")

  const run = async (call: Promise<unknown>) => {
    setError(null)
    try {
      await call
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const add = async () => {
    if (!text.trim()) return
    await run(addTodo(text.trim(), due || null))
    setText("")
    setDue("")
  }

  const row = (t: Todo) => (
    <div key={t.id} className={"todo-row" + (t.done ? " done" : "")}>
      <button className="todo-check" onClick={() => run(updateTodo(t.id, { done: !t.done }))} title={t.done ? "Not done" : "Done"}>
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
      <button className="todo-rm" onClick={() => run(deleteTodo(t.id))} title="Remove">
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
          void add()
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

/** One notice, as the bell shows it; also under the turn it came from. */
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
  const [replying, setReplying] = useState(false)
  const [choosingLater, setChoosingLater] = useState(false)
  const [more, setMore] = useState(false)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const tone = n.priority <= 2 ? "urgent" : n.priority <= 5 ? "important" : "other"
  const options = n.status === "open" && n.session ? (n.options ?? []) : []
  const act = async (call: () => Promise<Notice>) => {
    setBusy(true)
    setError(null)
    try {
      onAnswered(await call())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const send = () => text.trim() && act(() => replyNotice(n.id, text.trim()))
  // What the user wrote back from here, beside "Answered in the bell".
  const said = n.answer && n.answer !== "approve" && n.answer !== "reject" ? `: ${n.answer}` : ""
  const canReply = n.session && (n.needs === "reply" || options.length > 0)
  const canLater = n.status === "open" && n.priority <= 5 && !putOff(n)

  return (
    <div
      className={"bell-card " + tone + (n.status === "open" ? "" : " settled") + (onOpen ? "" : " inline")}
      role={onOpen ? "button" : undefined}
      onClick={() => !replying && n.session && onOpen?.(n)}
    >
      <div className="bell-card-head">
        <SourceMark n={n} />
        <span className="bell-source">{n.source.name}</span>
        <span className="bell-age">· {when(n.updated_at)}</span>
        <span className={"bell-p " + tone}>P{n.priority}</span>
      </div>
      <div className="bell-summary">{n.summary}</div>
      {n.detail && (
        <div
          className={"bell-detail" + (more ? " open" : "")}
          onClick={(e) => {
            e.stopPropagation()
            setMore((m) => !m)
          }}
        >
          {n.detail}
        </div>
      )}
      {n.note && (
        <div className="bell-note">
          {n.note}
          {said}
        </div>
      )}
      {n.status === "open" && putOff(n) && <div className="bell-note">Later · back at {clock(n.later_until!)}</div>}
      {/* Its answers, foreseen: one tap answers it. */}
      {options.length > 0 && !replying && (
        <div className="bell-options" onClick={(e) => e.stopPropagation()}>
          {options.map((o) => (
            <button key={o} className="bell-option" disabled={busy} onClick={() => act(() => replyNotice(n.id, o))}>
              {o}
            </button>
          ))}
        </div>
      )}
      {/* Handled here, without going there: approve, a line back, later, or done. */}
      {n.status === "open" && (
        <div className="bell-acts" onClick={(e) => e.stopPropagation()}>
          {choosingLater ? (
            <>
              {laterChoices().map(([label, at]) => (
                <button
                  key={label}
                  className="bell-btn"
                  disabled={busy}
                  onClick={() => act(() => laterNotice(n.id, at)).then(() => setChoosingLater(false))}
                >
                  {label}
                </button>
              ))}
              <button className="bell-btn bell-icon" onClick={() => setChoosingLater(false)} title="Cancel">
                <X />
              </button>
            </>
          ) : replying ? (
            <form
              className="bell-reply"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <input
                autoFocus
                value={text}
                placeholder={`Reply to ${n.source.name}`}
                enterKeyHint="send"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setReplying(false)}
              />
              <button className="bell-send" type="submit" disabled={busy || !text.trim()} title="Send">
                <ArrowUp />
              </button>
            </form>
          ) : (
            <>
              {n.needs === "approve" && (
                <>
                  <button className="bell-btn pri" disabled={busy} onClick={() => act(() => answerNotice(n.id, true))}>
                    <Check /> Approve
                  </button>
                  <button className="bell-btn" disabled={busy} onClick={() => act(() => answerNotice(n.id, false))}>
                    Reject
                  </button>
                </>
              )}
              {canReply && (
                <button
                  className={"bell-btn" + (n.needs === "reply" && options.length === 0 ? " pri" : "")}
                  disabled={busy}
                  onClick={() => setReplying(true)}
                >
                  <Reply /> {options.length > 0 ? "Other…" : "Reply"}
                </button>
              )}
              {canLater && (
                <button className="bell-btn" disabled={busy} onClick={() => setChoosingLater(true)}>
                  <Clock /> Later
                </button>
              )}
              <button className="bell-btn" disabled={busy} onClick={() => act(() => dismissNotice(n.id))}>
                Done
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

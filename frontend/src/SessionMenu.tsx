import { Archive, ArchiveRestore, Check, ChevronLeft, ChevronRight, CornerDownRight, Folder, FolderInput, FolderMinus, Pencil, Pin, PinOff, Send, Trash2 } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { isArchived, relaySession, type AgentBackend, type AgentInfo, type Project } from "./api"
import { isComposing } from "./ime"
import { BackendIcon } from "./BackendIcon"
import { BACKENDS } from "./NewMenu"

/**
 * What can be done to one session, from the `…` on its row: rename, pin,
 * continue it in a new chat, move into a project (or out of one), archive, delete. ChatGPT's menu, minus what
 * Loom has no use for.
 *
 * In a portal, placed by the button it opened from: the session list scrolls
 * and would clip it. "Move to project" swaps the list in place rather than
 * opening a submenu beside it, which a phone has no room for.
 *
 * A move is refused mid-turn (the backend cannot change directory then), so
 * it is offered only between turns, and a refusal is shown here.
 *
 * "Send a message" writes into this session without opening it (see
 * `Loom.Agent.Relay`): the user's own words, queued if it is mid-turn. Only
 * the user's own chats take one.
 */
export function SessionMenu({
  session,
  projects,
  anchor,
  onRename,
  onPin,
  onDone,
  onContinue,
  onMove,
  onArchive,
  onDelete,
  onClose,
}: {
  session: AgentInfo
  projects: Project[]
  anchor: DOMRect
  onRename: () => void
  onPin: (pinned: boolean) => Promise<void>
  // Only for a session in the sidebar's Working group: out of it.
  onDone?: () => Promise<void>
  // Only for the user's own chats; an employee's or Dream's carry on by themselves.
  // With a backend, on that one instead of its own.
  onContinue?: (backend?: AgentBackend) => Promise<void>
  onMove: (projectId: string | null) => Promise<void>
  onArchive: (archived: boolean) => Promise<void>
  onDelete: () => void
  onClose: () => void
}) {
  const [view, setView] = useState<"main" | "move" | "continue" | "send">("main")
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const ownChat = session.kind == null && !session.employee_id
  const sendIt = async () => {
    const text = message.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    try {
      const r = await relaySession(session.id, text)
      setSent(r.status === "queued" ? "Queued: it goes in when this turn ends." : "Sent.")
      setMessage("")
      setTimeout(onClose, 1200)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)

  // Below the button, right edges lined up; above it when there is no room.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const below = anchor.bottom + 4
    const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - 4 - height) : below
    const left = Math.min(Math.max(8, anchor.right - width), window.innerWidth - width - 8)
    setPlace({ top, left })
  }, [anchor, view])

  useEffect(() => {
    // Not the `…` it opened from, whose click closes it on its own.
    const away = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if ((e.target as Element | null)?.closest?.(".session-more")) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener("mousedown", away)
    window.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("mousedown", away)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [onClose])

  const run = async (action: () => Promise<void>) => {
    try {
      await action()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const busy = session.status === "starting" || session.status === "running"
  const current = projects.find((p) => p.id === session.project_id) ?? null
  const archived = isArchived(session)

  return createPortal(
    <div
      ref={ref}
      className="session-menu"
      role="menu"
      style={place ? { top: place.top, left: place.left } : { visibility: "hidden" }}
    >
      {view === "main" ? (
        <>
          {/* First: in Working it is what the menu is opened for most. */}
          {onDone && (
            <button role="menuitem" onClick={() => run(onDone)}>
              <Check /> Done
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              onClose()
              onRename()
            }}
          >
            <Pencil /> Rename
          </button>
          <button role="menuitem" onClick={() => run(() => onPin(!session.pinned))}>
            {session.pinned ? <PinOff /> : <Pin />} {session.pinned ? "Unpin" : "Pin"}
          </button>
          {onContinue && (
            // The tap carries it on as it is; the arrow picks another backend.
            <div className="new-menu-kind">
              <button role="menuitem" onClick={() => run(() => onContinue())}>
                <CornerDownRight /> <span className="session-menu-label">Continue in new chat</span>
              </button>
              <button className="new-menu-more" title="Continue on another engine" onClick={() => setView("continue")}>
                <ChevronRight />
              </button>
            </div>
          )}
          {ownChat && (
            <button role="menuitem" onClick={() => setView("send")}>
              <Send /> <span className="session-menu-label">Send a message…</span>
            </button>
          )}
          <div className="session-menu-sep" />
          <button
            role="menuitem"
            onClick={() => setView("move")}
            disabled={busy}
            title={busy ? "Wait for the turn to end" : undefined}
          >
            {current ? (
              <>
                <Folder /> Project <Scrolling text={current.name} />
              </>
            ) : (
              <>
                <FolderInput /> Move to project
              </>
            )}
            <ChevronRight className="session-menu-more" />
          </button>
          <div className="session-menu-sep" />
          <button role="menuitem" onClick={() => run(() => onArchive(!archived))}>
            {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Unarchive" : "Archive"}
          </button>
          <button
            role="menuitem"
            className="danger"
            onClick={() => {
              onClose()
              onDelete()
            }}
          >
            <Trash2 /> Delete
          </button>
        </>
      ) : view === "send" ? (
        <div className="session-menu-send">
          <button role="menuitem" className="session-menu-back" onClick={() => setView("main")}>
            <ChevronLeft /> Send to <Scrolling text={session.title ?? session.id} />
          </button>
          <div className="session-menu-sep" />
          <textarea
            autoFocus
            rows={4}
            value={message}
            placeholder={busy ? "It is working: this waits for the turn to end." : "Write to this session without opening it."}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isComposing(e)) {
                e.preventDefault()
                void sendIt()
              }
            }}
          />
          <div className="session-menu-send-row">
            <span className="session-menu-note">{sent ?? "⌘/Ctrl + Enter"}</span>
            <button className="text-btn" disabled={!message.trim() || sending || !!sent} onClick={() => void sendIt()}>
              <Send /> {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      ) : view === "continue" && onContinue ? (
        <>
          <button role="menuitem" className="session-menu-back" onClick={() => setView("main")}>
            <ChevronLeft /> Continue in new chat
          </button>
          <div className="session-menu-sep" />
          {BACKENDS.map((b) => (
            <button key={b.id} role="menuitem" onClick={() => run(() => onContinue(b.id))}>
              <BackendIcon backend={b.id} /> <span className="session-menu-label">{b.label}</span>
              {b.id === session.backend && <Check className="session-menu-more" />}
            </button>
          ))}
        </>
      ) : (
        <>
          <button role="menuitem" className="session-menu-back" onClick={() => setView("main")}>
            <ChevronLeft /> Move to project
          </button>
          <div className="session-menu-sep" />
          {projects.length === 0 && <div className="session-menu-note">No projects yet.</div>}
          {projects.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              disabled={p.id === current?.id}
              onClick={() => run(() => onMove(p.id))}
            >
              <Folder /> <span className="session-menu-label">{p.name}</span>
              {p.id === current?.id && <Check className="session-menu-more" />}
            </button>
          ))}
          {current && (
            <>
              <div className="session-menu-sep" />
              <button role="menuitem" onClick={() => run(() => onMove(null))}>
                <FolderMinus /> Remove from {current.name}
              </button>
            </>
          )}
          <div className="session-menu-note">
            It carries on in the project's workspace; files it already made stay where they are.
          </div>
        </>
      )}
      {error && <div className="session-menu-note failed">{error}</div>}
    </div>,
    document.body,
  )
}

/** A name in the row's leftover room: when too long, it scrolls to its end and back, as the chat header's does. */
function Scrolling({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    const run = el?.firstElementChild as HTMLElement | null
    if (el && run) setShift(Math.max(0, Math.ceil(run.offsetWidth - el.clientWidth)))
  }, [text])
  return (
    <span
      ref={ref}
      className={"session-menu-project" + (shift > 0 ? " marquee" : "")}
      style={shift > 0 ? ({ "--shift": `-${shift}px`, "--marquee-s": `${4 + shift / 30}s` } as CSSProperties) : undefined}
    >
      <span className="session-menu-project-run">{text}</span>
    </span>
  )
}

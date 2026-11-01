import { useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from "react"
import { createPortal } from "react-dom"
import type { AgentInfo } from "./api"
import { gist, unread } from "./Sidebar"

// How far up a card has to be thrown, or how fast, to count as Done.
const THROW_PX = 90
const THROW_SPEED = 0.6 // px per ms

/**
 * The phone's switcher for the sessions in Working, opened by dragging up the
 * line under the composer: iOS's app switcher over the blurred chat. A card
 * each, swiped across; crumbs below in the colour of each one's state (as the
 * status dot: working, stopped, unread, idle), the one in view drawn long. A
 * tap opens the session, a card thrown up is Done, a tap beside the cards
 * closes it.
 */
export function Switcher({
  sessions,
  activeId,
  onSelect,
  onDone,
  onClose,
}: {
  sessions: AgentInfo[]
  activeId: string | null
  onSelect: (id: string) => void
  onDone: (id: string) => void
  onClose: () => void
}) {
  const strip = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(0)
  // The card being thrown: which, and how far up it is.
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null)
  const [gone, setGone] = useState<string | null>(null)
  const touch = useRef<{ id: string; x: number; y: number; t: number; vertical: boolean | null } | null>(null)

  const step = () => {
    const card = strip.current?.firstElementChild as HTMLElement | null
    return card ? card.offsetWidth + 14 : 1
  }

  // Opens on the session on screen, if it is one of them.
  useLayoutEffect(() => {
    const i = sessions.findIndex((s) => s.id === activeId)
    if (i > 0 && strip.current) strip.current.scrollLeft = i * step()
    setShown(Math.max(0, i))
    // Only as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Nothing left to switch to.
  useEffect(() => {
    if (sessions.length === 0) onClose()
  }, [sessions.length, onClose])

  const start = (id: string, e: TouchEvent) => {
    const t = e.touches[0]
    touch.current = { id, x: t.clientX, y: t.clientY, t: e.timeStamp, vertical: null }
  }
  const move = (e: TouchEvent) => {
    const at = touch.current
    if (!at) return
    const t = e.touches[0]
    const dx = t.clientX - at.x
    const dy = t.clientY - at.y
    // The first clear direction decides: sideways is the strip's, up is a throw.
    if (at.vertical == null && Math.hypot(dx, dy) > 8) at.vertical = Math.abs(dy) > Math.abs(dx)
    if (at.vertical) setDrag({ id: at.id, dy: Math.min(0, dy) })
  }
  const end = (e: TouchEvent) => {
    const at = touch.current
    touch.current = null
    if (!at?.vertical || !drag) return setDrag(null)
    const speed = -drag.dy / Math.max(1, e.timeStamp - at.t)
    if (-drag.dy > THROW_PX || speed > THROW_SPEED) {
      setGone(at.id)
      // Off the top, then out of the list.
      setTimeout(() => {
        onDone(at.id)
        setGone(null)
      }, 220)
    }
    setDrag(null)
  }

  return createPortal(
    <div className="switcher" onClick={onClose}>
      <div
        ref={strip}
        className="switcher-strip"
        onScroll={(e) => setShown(Math.round(e.currentTarget.scrollLeft / step()))}
      >
        {sessions.map((s) => {
          const dy = gone === s.id ? -window.innerHeight : drag?.id === s.id ? drag.dy : 0
          return (
            <div
              key={s.id}
              className={"switcher-card" + (s.id === activeId ? " active" : "") + (unread(s) ? " unread" : "")}
              style={{
                transform: dy ? `translateY(${dy}px)` : undefined,
                opacity: dy ? Math.max(0.2, 1 + dy / 400) : undefined,
                transition: drag?.id === s.id ? "none" : undefined,
              }}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(s.id)
              }}
              onTouchStart={(e) => start(s.id, e)}
              onTouchMove={move}
              onTouchEnd={end}
              onTouchCancel={end}
            >
              <div className="switcher-title">
                <span className={"dot " + s.status} title={s.status} />
                <span className="switcher-label">{s.title ?? s.id}</span>
                {unread(s) && <span className="session-unread" />}
              </div>
              <div className="switcher-gist">{gist(s)}</div>
            </div>
          )
        })}
      </div>
      {sessions.length > 1 && (
        <div className="switcher-crumbs" onClick={(e) => e.stopPropagation()}>
          {sessions.map((s, i) => (
            <button
              key={s.id}
              className={
                "switcher-crumb " +
                (s.status === "idle" && unread(s) ? "unread" : s.status) +
                (i === Math.min(shown, sessions.length - 1) ? " shown" : "")
              }
              aria-label={s.title ?? s.id}
              onClick={() => strip.current?.scrollTo({ left: i * step(), behavior: "smooth" })}
            />
          ))}
        </div>
      )}
      <div className="switcher-hint">Swipe a card up when it is done</div>
    </div>,
    document.body,
  )
}

/**
 * The line under the phone's composer: dragged up (or tapped), it opens the
 * switcher. Faint on purpose; it sits above the home indicator, whose own
 * swipe from the very bottom edge is the system's.
 */
export function Grabber({ onOpen }: { onOpen: () => void }) {
  const from = useRef<number | null>(null)
  return (
    <div
      className="grabber"
      role="button"
      aria-label="Switch between the sessions in Working"
      onClick={onOpen}
      onTouchStart={(e) => (from.current = e.touches[0].clientY)}
      onTouchMove={(e) => {
        if (from.current != null && from.current - e.touches[0].clientY > 24) {
          from.current = null
          onOpen()
        }
      }}
      onTouchEnd={() => (from.current = null)}
    >
      <span />
    </div>
  )
}

/** "Done · Undo", for a few seconds after a session leaves Working. */
export function UndoDone({ title, onUndo }: { title: string; onUndo: () => void }) {
  return createPortal(
    <div className="undo-done" role="status">
      <span className="undo-done-text">Done: {title}</span>
      <button onClick={onUndo}>Undo</button>
    </div>,
    document.body,
  )
}

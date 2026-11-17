import { Brain } from "lucide-react"
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { EFFORTS, updateAgent, type AgentInfo } from "./api"
import { t, tc } from "./i18n"

// "Light" alone is also the appearance in Settings, which is another word in
// Chinese.
const LIGHT = tc("effort", "Light")

const LABELS: Record<string, string> = {
  low: LIGHT,
  medium: t("Standard"),
  high: t("Extended"),
  xhigh: t("Heavy"),
  max: t("Max"),
}

// How long a finger rests on the track before it drags: until then a sideways
// swipe is the page's (the drawer), not the slider's.
const HOLD_MS = 300
// Moving further than this before the hold is up makes it a swipe.
const SLOP = 10

// Under the dots, where six full names do not fit.
const SHORT: Record<string, string> = {
  low: LIGHT,
  medium: t("Std"),
  high: t("Ext"),
  xhigh: t("Heavy"),
  max: t("Max"),
}

const label = (effort: string | null) => (effort ? (LABELS[effort] ?? effort) : t("Auto"))

/**
 * Beside +, after ChatGPT's thinking time: a brain that opens a slider from the
 * model's own default (the left end) through each level the agent takes. The
 * level is the session's, kept by the server and given to the agent as the
 * next turn starts; a turn already running keeps the one it began with.
 *
 * On a touch screen the thumb moves only after a short hold, so swiping across
 * the composer still opens the drawer; tapping a level's name picks it too.
 * A mouse drags at once.
 */
export function EffortButton({ session }: { session: AgentInfo }) {
  const levels = EFFORTS[session.backend] ?? []
  const stops = [null, ...levels]
  const server = session.effort ?? null
  // Ahead of the server while a choice is being saved.
  const [value, setValue] = useState<string | null>(server)
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  // The hold: armed when its timer runs out with the finger still in place.
  const pending = useRef<{ timer: number; x: number; y: number; id: number } | null>(null)

  useEffect(() => setValue(server), [server])
  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  // Closed by a tap anywhere else, or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // While dragging, the touch is the slider's alone: not a scroll, and not a
  // swipe for the drawer (whose listeners sit on the chat, above this).
  useEffect(() => {
    const el = track.current
    if (!el || !armed) return
    const hold = (e: TouchEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    el.addEventListener("touchmove", hold, { passive: false })
    el.addEventListener("touchend", hold)
    return () => {
      el.removeEventListener("touchmove", hold)
      el.removeEventListener("touchend", hold)
    }
  }, [armed])

  if (levels.length === 0) return null

  const index = Math.max(0, stops.indexOf(value))
  const fill = index / (stops.length - 1)

  const choose = (next: string | null) => {
    setValue(next)
    // Once the thumb settles, not at every stop it passes.
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      if (next !== server) updateAgent(session.id, { effort: next }).catch(() => setValue(server))
    }, 350)
  }

  const stopAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect()
    const at = (clientX - rect.left) / Math.max(1, rect.width)
    const i = Math.round(Math.min(1, Math.max(0, at)) * (stops.length - 1))
    if (stops[i] !== value) {
      navigator.vibrate?.(5)
      choose(stops[i])
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (e.pointerType === "mouse") {
      el.setPointerCapture(e.pointerId)
      setArmed(true)
      stopAt(e.clientX)
      return
    }
    const x = e.clientX
    const timer = window.setTimeout(() => {
      const p = pending.current
      pending.current = null
      if (!p) return
      try {
        el.setPointerCapture(p.id)
      } catch {
        // The finger already lifted.
        return
      }
      navigator.vibrate?.(10)
      setArmed(true)
      stopAt(p.x)
    }, HOLD_MS)
    pending.current = { timer, x, y: e.clientY, id: e.pointerId }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pending.current
    if (p) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) cancelHold()
      else p.x = e.clientX
      return
    }
    if (armed) stopAt(e.clientX)
  }

  const cancelHold = () => {
    if (pending.current) window.clearTimeout(pending.current.timer)
    pending.current = null
  }

  const onPointerEnd = () => {
    cancelHold()
    setArmed(false)
  }

  return (
    <div className="effort" ref={root}>
      <button
        className={"composer-btn effort-btn" + (value ? " set" : "") + (open ? " open" : "")}
        onClick={() => setOpen((o) => !o)}
        title={t("Thinking: {level}", { level: label(value) })}
        aria-expanded={open}
      >
        <Brain />
        {value && <span className="effort-btn-label">{label(value)}</span>}
      </button>

      {open && (
        <div className="effort-pop" role="dialog" aria-label={t("Thinking level")}>
          <div className="effort-head">
            <span>{t("Thinking")}</span>
            <span className="effort-value">{label(value)}</span>
          </div>
          <div
            ref={track}
            className={"slider effort-track" + (armed ? " armed" : "")}
            style={{ "--fill": fill } as CSSProperties}
            role="slider"
            tabIndex={0}
            aria-valuemin={0}
            aria-valuemax={stops.length - 1}
            aria-valuenow={index}
            aria-valuetext={label(value)}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
              if (!step) return
              e.preventDefault()
              choose(stops[Math.min(stops.length - 1, Math.max(0, index + step))])
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            <div className="slider-ticks" aria-hidden>
              {stops.map((stop, i) => (
                <span key={stop ?? "auto"} className={i <= index ? "on" : ""} />
              ))}
            </div>
            <span className="slider-thumb" aria-hidden />
          </div>
          <div className="effort-stops">
            {stops.map((stop, i) => (
              <button
                key={stop ?? "auto"}
                className={stop === value ? "on" : ""}
                style={{ "--at": i / (stops.length - 1) } as CSSProperties}
                onClick={() => choose(stop)}
                title={label(stop)}
              >
                {stop ? (SHORT[stop] ?? stop) : t("Auto")}
              </button>
            ))}
          </div>
          <div className="effort-hint">
            {t("Hold the track to drag. From the next turn on.")}
          </div>
        </div>
      )}
    </div>
  )
}

import { ChevronLeft, ChevronRight, HatGlasses, SquarePen } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { AgentBackend } from "./api"
import { BackendIcon } from "./BackendIcon"

export const BACKENDS: { id: AgentBackend; label: string }[] = [
  { id: "claude_code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "kiro", label: "Kiro" },
]

type Kind = "chat" | "incognito"

/**
 * What a new session is, in the session menu's look. From New chat: a chat or
 * an incognito one (out of Recents, sandboxed; see `Loom.Agent.Sandbox`), on
 * the default engine — or, behind each one's arrow, on any engine; the model
 * is the engine's default, picked later in the header. From a project page's "+" (`engines`): just which engine. Opens
 * upwards when there is no room below, as from the phone's floating pill.
 */
export function NewMenu({
  anchor,
  owner,
  engines = false,
  defaultBackend = "claude_code",
  onPick,
  onClose,
}: {
  anchor: DOMRect
  /** The button it opened from, whose own click closes it. */
  owner: string
  engines?: boolean
  defaultBackend?: AgentBackend
  onPick: (backend: AgentBackend, model: string | null, incognito: boolean) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)
  // Which one's engines are shown, in place of the two.
  const [models, setModels] = useState<Kind | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const below = anchor.bottom + 4 + height <= window.innerHeight - 8
    setPlace({
      top: below ? anchor.bottom + 4 : Math.max(8, anchor.top - 4 - height),
      left: Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8),
    })
  }, [anchor, models])

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if ((e.target as Element | null)?.closest?.(owner)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (models ? setModels(null) : onClose())
    document.addEventListener("mousedown", away)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", away)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose, owner, models])

  const kind = (k: Kind, icon: ReactNode, label: string) => (
    <div className="new-menu-kind">
      <button role="menuitem" onClick={() => onPick(defaultBackend, null, k === "incognito")}>
        {icon}
        <span className="session-menu-label">{label}</span>
      </button>
      <button className="new-menu-more" title="Choose the engine" onClick={() => setModels(k)}>
        <ChevronRight />
      </button>
    </div>
  )

  const body = engines ? (
    BACKENDS.map((b) => (
      <button key={b.id} role="menuitem" onClick={() => onPick(b.id, null, false)}>
        <BackendIcon backend={b.id} /> {b.label}
      </button>
    ))
  ) : models ? (
    <>
      <button role="menuitem" className="session-menu-back" onClick={() => setModels(null)}>
        <ChevronLeft /> {models === "incognito" ? "Incognito chat" : "Chat"}
      </button>
      <div className="session-menu-sep" />
      {BACKENDS.map((b) => (
        <button key={b.id} role="menuitem" onClick={() => onPick(b.id, null, models === "incognito")}>
          <BackendIcon backend={b.id} /> {b.label}
        </button>
      ))}
    </>
  ) : (
    <>
      {kind("chat", <SquarePen />, "Chat")}
      {kind("incognito", <HatGlasses />, "Incognito chat")}
    </>
  )

  return createPortal(
    <div
      ref={ref}
      className="session-menu new-menu"
      role="menu"
      style={place ? { top: place.top, left: place.left } : { visibility: "hidden" }}
    >
      {body}
    </div>,
    document.body,
  )
}

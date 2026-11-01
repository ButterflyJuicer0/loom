import { HatGlasses } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { AgentBackend } from "./api"
import { BackendIcon } from "./BackendIcon"

const BACKENDS: { id: AgentBackend; label: string }[] = [
  { id: "claude_code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "kiro", label: "Kiro" },
]

/**
 * Which engine a new session runs on, in the session menu's look: a project
 * page's "+", and the arrow beside New chat, which also offers each engine
 * incognito (out of Recents, sandboxed; see `Loom.Agent.Sandbox`). Opens
 * upwards when there is no room below, as from the phone's floating pill.
 */
export function NewMenu({
  anchor,
  owner,
  incognito = false,
  onPick,
  onClose,
}: {
  anchor: DOMRect
  /** The button it opened from, whose own click closes it. */
  owner: string
  incognito?: boolean
  onPick: (backend: AgentBackend, incognito: boolean) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const below = anchor.bottom + 4 + height <= window.innerHeight - 8
    setPlace({
      top: below ? anchor.bottom + 4 : Math.max(8, anchor.top - 4 - height),
      left: Math.min(Math.max(8, anchor.right - width), window.innerWidth - width - 8),
    })
  }, [anchor])

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if ((e.target as Element | null)?.closest?.(owner)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("mousedown", away)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", away)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose, owner])

  const items = (incog: boolean) =>
    BACKENDS.map((b) => (
      <button key={b.id + incog} role="menuitem" onClick={() => onPick(b.id, incog)}>
        <BackendIcon backend={b.id} /> {b.label}
      </button>
    ))

  return createPortal(
    <div
      ref={ref}
      className="session-menu"
      role="menu"
      style={place ? { top: place.top, left: place.left } : { visibility: "hidden" }}
    >
      {items(false)}
      {incognito && (
        <>
          <div className="menu-sep" />
          <div className="menu-heading">
            <HatGlasses /> Incognito
          </div>
          {items(true)}
        </>
      )}
    </div>,
    document.body,
  )
}

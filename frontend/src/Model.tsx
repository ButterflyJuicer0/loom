import { Check, ChevronDown, ChevronLeft } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MODELS, changeAgent, modelName, type AgentInfo } from "./api"

/** The session's model as the menu names it: its own pick, or the agent's default. */
export const modelLabel = (model: string | null | undefined) => (model ? modelName(model) : "Default")

/**
 * The models a session can be on: the agent's default, then `MODELS` for its
 * backend. A pick is the session's, kept by the server and given to the agent
 * as the next turn starts; a turn already running keeps the one it began with.
 */
export function ModelList({
  session,
  onBack,
  onDone,
}: {
  session: AgentInfo
  onBack?: () => void
  onDone: () => void
}) {
  const current = session.model ?? null
  const choices: (string | null)[] = [null, ...(MODELS[session.backend] ?? [])]
  if (current && !choices.includes(current)) choices.push(current)

  // Shown at once, the menu closed; see `changeAgent`.
  const pick = (model: string | null) => {
    if (model !== current) changeAgent(session, { model })
    onDone()
  }

  return (
    <>
      {onBack && (
        <>
          <button role="menuitem" className="session-menu-back" onClick={onBack}>
            <ChevronLeft /> Model
          </button>
          <div className="session-menu-sep" />
        </>
      )}
      {choices.map((model) => (
        <button key={model ?? ""} role="menuitem" onClick={() => pick(model)} title={model ?? undefined}>
          <span className="session-menu-label">{modelLabel(model)}</span>
          {model === current && <Check className="session-menu-more" />}
        </button>
      ))}
      <div className="session-menu-note">From the next message on.</div>
    </>
  )
}

/** On a wide window, the header's model chip: the menu the phone has under `…`. */
export function ModelChip({ session }: { session: AgentInfo }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!at) return
    const away = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if ((e.target as Element | null)?.closest?.(".model-chip")) return
      setAt(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAt(null)
    document.addEventListener("pointerdown", away)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", away)
      document.removeEventListener("keydown", onKey)
    }
  }, [at])

  return (
    <>
      <button
        className="chip button model-chip"
        title="Model"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(e) => {
          if (at) return setAt(null)
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ top: r.bottom + 4, right: window.innerWidth - r.right })
        }}
      >
        {modelLabel(session.model)}
        <ChevronDown />
      </button>
      {at &&
        createPortal(
          <div className="session-menu pane-menu" role="menu" ref={ref} style={at}>
            <ModelList session={session} onDone={() => setAt(null)} />
          </div>,
          document.body,
        )}
    </>
  )
}

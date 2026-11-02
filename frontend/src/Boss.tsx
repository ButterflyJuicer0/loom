import { ChevronRight, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { addBossLine, bossProfile, deleteBossLine, updateBossLine, type BossLine } from "./api"
import { isComposing } from "./ime"
import "./Boss.css"

/**
 * The boss profile (`Loom.Employees`) in Settings: what every employee knows
 * about the user, a sentence a line, with who heard it and when. Employees
 * add to it when the user tells them something about themselves. Settings
 * shows only a row; the lines are a page of their own, opened from it.
 */
export function BossRow({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="settings-row archived">
      <button className="settings-text archived-head" onClick={onOpen}>
        <span className="settings-label">Boss profile</span>
        <span className="settings-hint">What every employee knows about you.</span>
        <ChevronRight className="archived-fold" />
      </button>
    </div>
  )
}

/** The page: tap a line to change or delete it, or add one at the foot. */
export function BossPage() {
  const [lines, setLines] = useState<BossLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  // `shown`, the list as the tap will leave it, is on screen at once; the
  // server's list replaces it, a refusal puts the old one back.
  const act = async (call: Promise<BossLine[]>, shown?: BossLine[]) => {
    const before = lines
    if (shown) setLines(shown)
    try {
      setLines(await call)
      setError(null)
      return true
    } catch (e) {
      if (shown) setLines(before)
      setError((e as Error).message)
      return false
    }
  }

  useEffect(() => {
    void act(bossProfile())
  }, [])

  return (
    <div className="boss-page">
      <div className="settings-hint boss-intro">
        Tell any employee something about yourself and it lands here, for all of them, from their next wake-up.
      </div>
      {error && <div className="boss-error">{error}</div>}
      {lines?.length === 0 && <div className="settings-hint">Nothing yet.</div>}
      {lines?.map((line) =>
        editing === line.id ? (
          <EditLine
            key={line.id}
            line={line}
            onSave={async (text) => {
              setEditing(null)
              if (text === line.text) return
              const shown = (lines ?? []).map((l) => (l.id === line.id ? { ...l, text } : l))
              if (!(await act(updateBossLine(line.id, text), shown))) setEditing(line.id)
            }}
            onDelete={async () => {
              setEditing(null)
              await act(deleteBossLine(line.id), (lines ?? []).filter((l) => l.id !== line.id))
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button key={line.id} className="boss-line" onClick={() => setEditing(line.id)}>
            <span className="boss-text">{line.text}</span>
            <span className="boss-meta">
              {day(line.at)} · {line.by_name ? `told ${line.by_name}` : "you wrote it"}
            </span>
          </button>
        ),
      )}
      <AddLine onAdd={(text) => act(addBossLine(text))} />
    </div>
  )
}

function EditLine({
  line,
  onSave,
  onDelete,
  onCancel,
}: {
  line: BossLine
  onSave: (text: string) => Promise<void>
  onDelete: () => Promise<void>
  onCancel: () => void
}) {
  const [text, setText] = useState(line.text)
  return (
    <div className="boss-line editing">
      <textarea
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isComposing(e)) return
          if (e.key === "Enter" && !e.shiftKey && text.trim()) {
            e.preventDefault()
            void onSave(text.trim())
          }
          if (e.key === "Escape") {
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="boss-actions">
        <button className="boss-delete" onClick={onDelete} title="Delete this line">
          <Trash2 /> Delete
        </button>
        <span className="boss-spacer" />
        <button className="boss-button" onClick={onCancel}>
          Cancel
        </button>
        <button className="boss-button strong" disabled={!text.trim()} onClick={() => onSave(text.trim())}>
          Save
        </button>
      </div>
    </div>
  )
}

/** A line of its own, added on Enter. */
function AddLine({ onAdd }: { onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const value = text.trim()
    if (!value || busy) return
    // Cleared on the tap; back if it did not go.
    setBusy(true)
    setText("")
    if (!(await onAdd(value))) setText(value)
    setBusy(false)
  }

  return (
    <div className="boss-add">
      <input
        value={text}
        placeholder="Add a line"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (isComposing(e)) return
          if (e.key === "Enter") {
            e.preventDefault()
            void send()
          }
        }}
      />
      <button className="icon-btn" onClick={send} disabled={!text.trim() || busy} title="Add">
        <Plus />
      </button>
    </div>
  )
}

// "10-29", as the employees are told it.
function day(ms: number) {
  const d = new Date(ms)
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

import { ArchiveRestore, ChevronLeft, ChevronRight, Moon, Sun, Trash2, X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { AgentBackend, AgentInfo, Project } from "./api"
import type { Appearance, Settings } from "./settings"
import { Slider } from "./Slider"
import { BossPage, BossRow } from "./Boss"
import { lastActive } from "./useLobby"

/**
 * The gear at the foot of the sidebar: this device's appearance and text sizes, the
 * engine "+" starts a session on, the boss profile the employees share, and
 * the archived and the incognito sessions. Each choice takes
 * effect as it is made; there is nothing to save.
 */
export function SettingsDialog({
  settings,
  onChange,
  onClose,
  archived,
  projects,
  onOpen,
  onUnarchive,
  incognito,
  onKeep,
  onDelete,
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  archived: AgentInfo[]
  projects: Project[]
  onOpen: (id: string) => void
  onUnarchive: (id: string) => Promise<void>
  incognito: AgentInfo[]
  onKeep: (id: string) => void
  onDelete: (id: string) => void
}) {
  // A page opened from a row, in place of the list, with a way back.
  const [page, setPage] = useState<"boss" | "archived" | "incognito" | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (page ? setPage(null) : onClose())
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose, page])

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-dialog" role="dialog" aria-label="Settings">
        <div className="modal-head">
          {page ? (
            <button className="settings-back" onClick={() => setPage(null)}>
              <ChevronLeft />
              {page === "boss" ? "Boss profile" : page === "archived" ? "Archived" : "Incognito"}
            </button>
          ) : (
            <span>Settings</span>
          )}
          <button className="icon-btn" onClick={onClose} title="Close">
            <X />
          </button>
        </div>

        {page === "boss" ? (
          <div className="settings-body">
            <BossPage />
          </div>
        ) : page === "archived" ? (
          <div className="settings-body">
            <Archived sessions={archived} projects={projects} onOpen={onOpen} onUnarchive={onUnarchive} />
          </div>
        ) : page === "incognito" ? (
          <div className="settings-body">
            <Incognito sessions={incognito} onOpen={onOpen} onKeep={onKeep} onDelete={onDelete} />
          </div>
        ) : (
          <div className="settings-body">
            <Row label="Appearance" hint="On this device.">
              <Segmented<Appearance>
                value={settings.appearance}
                options={[
                  ["light", "Light", <Sun key="s" />],
                  ["dark", "Dark", <Moon key="m" />],
                ]}
                onChange={(appearance) => onChange({ appearance })}
              />
            </Row>

            <TextSizes settings={settings} onChange={onChange} />

            <Row label="New sessions" hint="The agent + starts. A session keeps its agent for good.">
              <Segmented<AgentBackend>
                value={settings.backend}
                options={[
                  ["claude_code", "Claude Code"],
                  ["codex", "Codex"],
                  ["kiro", "Kiro"],
                ]}
                onChange={(backend) => onChange({ backend })}
              />
            </Row>

            <BossRow onOpen={() => setPage("boss")} />

            <PageRow
              label="Archived"
              hint={archived.length ? `${archived.length}, hidden from the lists.` : "None."}
              onOpen={() => setPage("archived")}
            />

            <PageRow
              label="Incognito"
              hint={incognito.length ? `${incognito.length}, out of Recents, with no memory.` : "None."}
              onOpen={() => setPage("incognito")}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// The interface in px, as it is set; each area in percent of it.
const AREAS: {
  key: "sidebarScale" | "chatScale" | "codeScale" | "cardTitleScale" | "cardTextScale" | "cardBodyScale"
  label: string
}[] = [
  { key: "sidebarScale", label: "Sidebar" },
  { key: "chatScale", label: "Messages" },
  { key: "codeScale", label: "Code" },
  // The phone's switcher cards; the recap is also a Working row's second line.
  { key: "cardTitleScale", label: "Card title" },
  { key: "cardTextScale", label: "Card summary" },
  { key: "cardBodyScale", label: "Card text" },
]

/**
 * Text size: the whole interface, then the sidebar, the conversation and its
 * code each on top of it. Sliders, applied as they move, so the page behind
 * the dialog is the preview. Folded until asked for: eight sliders are a lot
 * of dialog for something set once.
 */
function TextSizes({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const px = Math.round(16 * settings.fontScale)
  const changed = settings.fontScale !== 1 || AREAS.some(({ key }) => settings[key] !== 1)
  const [open, setOpen] = useState(false)
  return (
    <div className="settings-row text-sizes">
      <div className="settings-text">
        <button className={"text-sizes-toggle" + (open ? " open" : "")} onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="settings-label">Text size</span>
          <ChevronRight />
        </button>
        <span className="settings-hint">On this device.</span>
        {changed && (
          <button
            className="settings-reset"
            onClick={() =>
              onChange({
                fontScale: 1,
                sidebarScale: 1,
                chatScale: 1,
                codeScale: 1,
                cardTitleScale: 1,
                cardTextScale: 1,
                cardBodyScale: 1,
              })
            }
          >
            Reset
          </button>
        )}
      </div>
      {open && (
      <div className="size-rows">
        <div className="size-row">
          <span className="size-name">Interface</span>
          <Slider
            min={12}
            max={20}
            step={1}
            value={px}
            label="Interface text size"
            valueText={`${px}px`}
            onChange={(v) => onChange({ fontScale: v / 16 })}
          />
          <span className="size-value">{px}px</span>
        </div>
        {AREAS.map(({ key, label }) => {
          const pct = Math.round(settings[key] * 100)
          return (
            <div className="size-row" key={key}>
              <span className="size-name">{label}</span>
              <Slider
                min={80}
                max={140}
                step={5}
                value={pct}
                label={`${label} text size`}
                valueText={`${pct}%`}
                onChange={(v) => onChange({ [key]: v / 100 })}
              />
              <span className="size-value">{pct}%</span>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

/** A row that opens a page of its own, like Boss profile's. */
function PageRow({ label, hint, onOpen }: { label: string; hint: string; onOpen: () => void }) {
  return (
    <div className="settings-row archived">
      <button className="settings-text archived-head" onClick={onOpen}>
        <span className="settings-label">{label}</span>
        <span className="settings-hint">{hint}</span>
        <ChevronRight className="archived-fold" />
      </button>
    </div>
  )
}

/**
 * The archived sessions: out of the sidebar's lists, nothing else changed.
 * A row each — tap to open it, or bring it back.
 */
function Archived({
  sessions,
  projects,
  onOpen,
  onUnarchive,
}: {
  sessions: AgentInfo[]
  projects: Project[]
  onOpen: (id: string) => void
  onUnarchive: (id: string) => Promise<void>
}) {
  const name = (id?: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? "") : "")
  return (
    <div className="archived-list">
      <p className="settings-hint">Hidden from the lists. Writing in one brings it back.</p>
      {sessions.length === 0 && <p className="settings-hint">None.</p>}
      {sessions.map((s) => (
        <div className="archived-item" key={s.id}>
          <button className="archived-open" onClick={() => onOpen(s.id)}>
            <span className="archived-title">{s.title || "Untitled"}</span>
            {s.project_id && <span className="archived-project">{name(s.project_id)}</span>}
          </button>
          <button className="icon-btn" title="Unarchive" onClick={() => void onUnarchive(s.id)}>
            <ArchiveRestore />
          </button>
        </div>
      ))}
    </div>
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The incognito sessions, listed nowhere else: each deleted 30 days after its
 * last message (`Loom.Agent.Incognito`), unless kept — into Recents, out of
 * its sandbox, after a confirmation (the app's).
 */
function Incognito({
  sessions,
  onOpen,
  onKeep,
  onDelete,
}: {
  sessions: AgentInfo[]
  onOpen: (id: string) => void
  onKeep: (id: string) => void
  onDelete: (id: string) => void
}) {
  const left = (s: AgentInfo) => Math.max(0, 30 - Math.floor((Date.now() - lastActive(s)) / DAY_MS))
  return (
    <div className="archived-list">
      <p className="settings-hint">
        No memory, not in Recents. Each is deleted 30 days after its last message unless pinned or kept.
      </p>
      {sessions.length === 0 && <p className="settings-hint">None. New chat → Incognito chat starts one.</p>}
      {sessions.map((s) => (
        <div className="archived-item" key={s.id}>
          <button className="archived-open" onClick={() => onOpen(s.id)}>
            <span className="archived-title">{s.title || "Untitled"}</span>
            <span className="archived-project">{s.pinned ? "pinned" : `${left(s)}d left`}</span>
          </button>
          <button className="keep-btn" title="Keep it: into Recents" onClick={() => onKeep(s.id)}>
            Keep
          </button>
          <button className="icon-btn" title="Delete" onClick={() => onDelete(s.id)}>
            <Trash2 />
          </button>
        </div>
      ))}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-text">
        <span className="settings-label">{label}</span>
        <span className="settings-hint">{hint}</span>
      </div>
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: [T, string, ReactNode?][]
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, label, icon]) => (
        <button
          key={v}
          role="radio"
          aria-checked={v === value}
          className={v === value ? "on" : ""}
          onClick={() => onChange(v)}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  )
}

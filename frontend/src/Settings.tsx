import { ArchiveRestore, ChevronDown, ChevronLeft, ChevronRight, Moon, Sun, Trash2, X } from "lucide-react"
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
  onKeep: (id: string) => Promise<void>
  onDelete: (id: string) => void
}) {
  // A page opened from a row, in place of the list, with a way back.
  const [page, setPage] = useState<"boss" | null>(null)
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
              Boss profile
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

            <Archived sessions={archived} projects={projects} onOpen={onOpen} onUnarchive={onUnarchive} />

            <Incognito sessions={incognito} onOpen={onOpen} onKeep={onKeep} onDelete={onDelete} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// The interface in px, as it is set; each area in percent of it.
const AREAS: {
  key: "sidebarScale" | "chatScale" | "codeScale"
  label: string
}[] = [
  { key: "sidebarScale", label: "Sidebar" },
  { key: "chatScale", label: "Messages" },
  { key: "codeScale", label: "Code" },
]

/**
 * Text size: the whole interface, then the sidebar, the conversation and its
 * code each on top of it. Sliders, applied as they move, so the page behind
 * the dialog is the preview.
 */
function TextSizes({ settings, onChange }: { settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const px = Math.round(16 * settings.fontScale)
  const changed = settings.fontScale !== 1 || AREAS.some(({ key }) => settings[key] !== 1)
  return (
    <div className="settings-row text-sizes">
      <div className="settings-text">
        <span className="settings-label">Text size</span>
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
              })
            }
          >
            Reset
          </button>
        )}
      </div>
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
    </div>
  )
}

/**
 * The archived sessions: out of the sidebar's lists, nothing else changed.
 * Folded; open, a row each — tap to open it, or bring it back.
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
  const [open, setOpen] = useState(false)
  const name = (id?: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? "") : "")
  return (
    <div className="settings-row archived">
      <button className="settings-text archived-head" onClick={() => setOpen((o) => !o)} disabled={!sessions.length}>
        <span className="settings-label">Archived</span>
        <span className="settings-hint">
          {sessions.length ? `${sessions.length}, hidden from the lists. Writing in one brings it back.` : "None."}
        </span>
        {sessions.length > 0 &&
          (open ? <ChevronDown className="archived-fold" /> : <ChevronRight className="archived-fold" />)}
      </button>
      {open && sessions.length > 0 && (
        <div className="archived-list">
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
      )}
    </div>
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The incognito sessions, listed nowhere else: each deleted 30 days after its
 * last message (`Loom.Agent.Incognito`), unless kept — into Recents, out of
 * its sandbox. Folded like Archived.
 */
function Incognito({
  sessions,
  onOpen,
  onKeep,
  onDelete,
}: {
  sessions: AgentInfo[]
  onOpen: (id: string) => void
  onKeep: (id: string) => Promise<void>
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const left = (s: AgentInfo) => Math.max(0, 30 - Math.floor((Date.now() - lastActive(s)) / DAY_MS))
  return (
    <div className="settings-row archived">
      <button className="settings-text archived-head" onClick={() => setOpen((o) => !o)} disabled={!sessions.length}>
        <span className="settings-label">Incognito</span>
        <span className="settings-hint">
          {sessions.length
            ? `${sessions.length}, no memory, out of Recents. Each goes 30 days after its last message.`
            : "None. The arrow beside New chat starts one."}
        </span>
        {sessions.length > 0 &&
          (open ? <ChevronDown className="archived-fold" /> : <ChevronRight className="archived-fold" />)}
      </button>
      {open && sessions.length > 0 && (
        <div className="archived-list">
          {sessions.map((s) => (
            <div className="archived-item" key={s.id}>
              <button className="archived-open" onClick={() => onOpen(s.id)}>
                <span className="archived-title">{s.title || "Untitled"}</span>
                <span className="archived-project">{left(s)}d left</span>
              </button>
              <button className="keep-btn" title="Keep it: into Recents" onClick={() => void onKeep(s.id)}>
                Keep
              </button>
              <button className="icon-btn" title="Delete" onClick={() => onDelete(s.id)}>
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      )}
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

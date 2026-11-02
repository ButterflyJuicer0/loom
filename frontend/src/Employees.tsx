import {
  AlarmClock,
  Check,
  CircleAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Hourglass,
  ListChecks,
  LoaderCircle,
  Lock,
  MessageCircle,
  PanelLeft,
  Pause,
  Play,
  Plus,
  Settings as SettingsIcon,
  Siren,
  Undo2,
  Unplug,
  Wallet,
  X,
} from "lucide-react"
import { useEffect, useState, type ComponentProps, type ComponentType, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Chat } from "./Chat"
import { Confirm } from "./Confirm"
import { Markdown } from "./markdown"
import {
  addKpi,
  approveEmployee,
  createEmployee,
  deleteEmployee,
  deleteKpi,
  employeeReport,
  employeeSeen,
  employeeReports,
  pauseEmployee,
  reviewKpi,
  updateEmployee,
  updateKpi,
  wakeEmployee,
  type AgentBackend,
  type AgentInfo,
  type Device,
  type Employee,
  type EmployeeReport,
  type EmployeeSettings,
  type Kpi,
  type KpiAttrs,
  type Project,
} from "./api"
import "./Employees.css"

/**
 * Virtual employees (`Loom.Employees`): an agent at work on a heartbeat, on
 * the projects it is given, toward KPIs, within a daily budget.
 *
 * Its page has five tabs. Chat and Updates are its two sessions — the chat
 * with the user, and the work itself, which is its report; KPIs, the daily
 * and weekly reports it writes, and its settings are pages of their own. The
 * tab bar and where it stands sit under the header of all five.
 */

export type EmployeeTab = "chat" | "kpis" | "updates" | "reports" | "settings"

export const isEmployeeSession = (s: AgentInfo) => s.kind === "employee_chat" || s.kind === "employee_work"

const busy = (s: AgentInfo | undefined) => s !== undefined && (s.status === "starting" || s.status === "running")
/** Its work session said something the user has not read. */
export const hasNews = (work: AgentInfo | undefined) =>
  work !== undefined && !busy(work) && work.seq > (work.seen_seq ?? 0)

export const STATUS: Record<Employee["status"], { label: string; tone: string }> = {
  working: { label: "Working", tone: "green" },
  sleeping: { label: "Sleeping", tone: "dim" },
  paused: { label: "Paused", tone: "dim" },
  approval: { label: "Budget reached", tone: "amber" },
  blocked: { label: "Needs you", tone: "red" },
  offline: { label: "Workstation offline", tone: "dim" },
}

/** A round initial on a neutral disc, the same for everyone, like the rest of the sidebar. */
export function Avatar({ employee, size = "md" }: { employee: Pick<Employee, "name" | "id">; size?: "sm" | "md" | "lg" }) {
  return <span className={"emp-avatar " + size}>{[...employee.name.trim()][0] ?? "?"}</span>
}

/**
 * Where it stands, as one small icon: the sidebar's row has no room for words.
 * One colour, in line like the rest of the sidebar; what wants you is bright,
 * what is quiet is dim. Not a moon for sleeping — that is Dream's.
 */
const STATUS_ICON: Record<Employee["status"], ComponentType<{ className?: string; "aria-label"?: string }>> = {
  working: LoaderCircle,
  sleeping: Zzz,
  paused: Pause,
  approval: Hourglass,
  blocked: CircleAlert,
  offline: Unplug,
}

const LOUD: Employee["status"][] = ["working", "approval", "blocked"]

export function StatusIcon({ status }: { status: Employee["status"] }) {
  const Icon = STATUS_ICON[status]
  return (
    <Icon
      className={"emp-status-icon " + status + (LOUD.includes(status) ? " loud" : "")}
      aria-label={STATUS[status].label}
    />
  )
}

// Three z's rising, drawn in the same line as lucide's icons.
function Zzz({ className, ...rest }: { className?: string; "aria-label"?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      {...rest}
    >
      <path d="M13 3h7l-7 8h7" />
      <path d="M6.5 11h4.5l-4.5 5h4.5" />
      <path d="M2.5 17.5h3l-3 3.5h3" />
    </svg>
  )
}

/** Today's spend against today's budget, as a ring that fills clockwise. */
export function BudgetRing({ employee: e }: { employee: Pick<Employee, "spent_today" | "cap_today"> }) {
  const r = 7
  const c = 2 * Math.PI * r
  const part = e.cap_today > 0 ? Math.min(1, e.spent_today / e.cap_today) : 0
  return (
    <svg className={"emp-ring" + (part >= 1 ? " full" : "")} viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r={r} className="emp-ring-track" />
      {part > 0 && <circle cx="9" cy="9" r={r} className="emp-ring-fill" strokeDasharray={`${part * c} ${c}`} />}
    </svg>
  )
}

type ChatProps = Omit<ComponentProps<typeof Chat>, "session" | "tabs" | "subhead">

export function EmployeePage({
  employee,
  chatSession,
  workSession,
  tab,
  onTab,
  onSeen,
  onUpsert,
  onDeleted,
  projects,
  devices,
  chat,
  onSetupChat,
}: {
  employee: Employee
  // A setup chat about this employee: where its permissions are changed.
  onSetupChat: (employeeId: string) => void
  chatSession: AgentInfo | undefined
  workSession: AgentInfo | undefined
  tab: EmployeeTab
  onTab: (tab: EmployeeTab) => void
  // Updates read up to here; see `Loom.Agent.Session.seen/2`.
  onSeen: (seq: number) => void
  onUpsert: (employee: Employee) => void
  onDeleted: () => void
  projects: Project[]
  devices: Device[]
  chat: ChatProps
}) {
  // Updates are read once they are on screen, and again as they grow.
  useEffect(() => {
    if (tab === "updates" && workSession && hasNews(workSession)) onSeen(workSession.seq)
  }, [tab, workSession?.seq, workSession?.seen_seq, workSession?.status])
  // And what it reported with them, an important one, once it has been read
  // there. Not an urgent one: that waits for its answer.
  useEffect(() => {
    if (tab === "updates" && employee.attention?.level === "important")
      employeeSeen(employee.id).then(onUpsert, () => {})
  }, [tab, employee.attention?.at])

  const bar = <EmployeeBar employee={employee} work={workSession} tab={tab} onTab={onTab} onUpsert={onUpsert} />

  if (tab === "chat" && chatSession)
    return (
      <Chat
        {...chat}
        session={{ ...chatSession, title: employee.name }}
        subhead={bar}
        earlier={employee.past_chat}
      />
    )
  if (tab === "updates" && workSession)
    return (
      <Chat
        {...chat}
        session={{ ...workSession, title: `${employee.name} · updates` }}
        subhead={bar}
        earlier={employee.past_work}
      />
    )

  return (
    <div className="chat">
      <header className="chat-header">
        {!chat.sidebarOpen && (
          <button className="icon-btn" onClick={chat.onToggleSidebar} title="Show sidebar">
            <PanelLeft />
          </button>
        )}
        <span className="chat-name emp-title">
          <Avatar employee={employee} size="sm" />
          <span className="emp-title-text">{employee.name}</span>
          {employee.role && <span className="emp-title-role wide-only">{employee.role}</span>}
        </span>
      </header>
      {bar}
      <div className="emp-scroll">
        <div className="emp-column">
          {tab === "kpis" && <KpiPane employee={employee} onUpsert={onUpsert} />}
          {tab === "reports" && <ReportsPane employee={employee} />}
          {tab === "settings" && (
            <SettingsPane
              employee={employee}
              projects={projects}
              devices={devices}
              onUpsert={onUpsert}
              onDeleted={onDeleted}
              onSetupChat={() => onSetupChat(employee.id)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── The bar under the header ───────────────────────────────────────────────

const TABS: { id: EmployeeTab; label: string; icon: ReactNode }[] = [
  { id: "chat", label: "Chat", icon: <MessageCircle /> },
  { id: "kpis", label: "KPIs", icon: <ListChecks /> },
  { id: "updates", label: "Updates", icon: <Siren /> },
  { id: "reports", label: "Reports", icon: <FileText /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon /> },
]

function EmployeeBar({
  employee: e,
  work,
  tab,
  onTab,
  onUpsert,
}: {
  employee: Employee
  work: AgentInfo | undefined
  tab: EmployeeTab
  onTab: (tab: EmployeeTab) => void
  onUpsert: (employee: Employee) => void
}) {
  const [error, setError] = useState<string | null>(null)
  // `shown`, what the tap will make of it, is on screen at once; the server's
  // answer replaces it, a refusal puts it back.
  const act = async (call: Promise<Employee>, shown?: Employee) => {
    const before = e
    if (shown) onUpsert(shown)
    try {
      onUpsert(await call)
      setError(null)
    } catch (err) {
      if (shown) onUpsert(before)
      setError((err as Error).message)
    }
  }
  const status = STATUS[e.status]
  const review = e.kpis.filter((k) => k.status === "review").length
  const news = hasNews(work)

  return (
    <div className="emp-bar">
      <div className="emp-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={"emp-tab" + (tab === t.id ? " on" : "")}
            onClick={() => onTab(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.id === "updates" && news && <span className="emp-tab-dot" />}
            {t.id === "kpis" && review > 0 && <span className="emp-tab-count">{review}</span>}
          </button>
        ))}
      </div>

      <div className="emp-state">
        <span className={"emp-status " + status.tone}>
          <span className="emp-status-dot" />
          {status.label}
          {e.status === "sleeping" && e.wake_at && <span className="emp-dim"> · wakes {clock(e.wake_at)}</span>}
        </span>
        {e.permissions && (
          <span className="emp-restricted" title={e.permissions.summary}>
            <Lock /> Restricted
          </span>
        )}
        <span className="emp-spend" title="Spent today, of today's budget">
          <Wallet />
          {short(e, e.spent_today)}
          <span className="emp-dim"> / {amount(e, e.cap_today)}</span>
        </span>
        <span className="emp-state-actions">
          {!e.paused && e.status !== "working" && e.status !== "approval" && (
            <button className="emp-pill" onClick={() => act(wakeEmployee(e.id), { ...e, status: "working" })} title="Wake it now">
              <Play /> Wake
            </button>
          )}
          <button
            className="emp-pill"
            onClick={() => act(pauseEmployee(e.id, !e.paused), { ...e, paused: !e.paused })}
            title={e.paused ? "Let it carry on" : "Stop it, now and until resumed"}
          >
            {e.paused ? <Play /> : <Pause />} {e.paused ? "Resume" : "Pause"}
          </button>
        </span>
      </div>

      {e.status === "approval" && <Approval employee={e} onDone={act} />}
      {e.attention && e.status !== "approval" && (
        <button className={"emp-attention " + e.attention.level} onClick={() => onTab("updates")}>
          {e.attention.level === "urgent" ? <Siren /> : <AlarmClock />}
          <span>{e.attention.text}</span>
        </button>
      )}
      {error && <div className="emp-error">{error}</div>}
    </div>
  )
}

/** Today's budget is spent: more, for today only, or rest until tomorrow. */
function Approval({ employee: e, onDone }: { employee: Employee; onDone: (call: Promise<Employee>) => void }) {
  const [custom, setCustom] = useState("")
  return (
    <div className="emp-approval">
      <div>
        <b>Today's budget is spent</b>
        <span className="emp-dim">
          {" "}
          — {amount(e, e.spent_today)} of {amount(e, e.cap_today)}. It rests until you approve more, or until tomorrow.
        </span>
      </div>
      <div className="emp-approval-actions">
        {(e.budget_unit === "usd" ? [20, 50] : [10, 20]).map((n) => (
          <button key={n} className="emp-pill strong" onClick={() => onDone(approveEmployee(e.id, n))}>
            +{amount(e, n)} today
          </button>
        ))}
        <form
          className="emp-approval-custom"
          onSubmit={(ev) => {
            ev.preventDefault()
            const n = Number(custom)
            if (n > 0) onDone(approveEmployee(e.id, n))
          }}
        >
          <span>{e.budget_unit === "usd" ? "$" : "+"}</span>
          <input inputMode="decimal" value={custom} onChange={(ev) => setCustom(ev.target.value)} placeholder="other" />
        </form>
      </div>
    </div>
  )
}

// ── KPIs ───────────────────────────────────────────────────────────────────

const KPI_STATUS: Record<Kpi["status"], string> = {
  todo: "To do",
  doing: "In progress",
  review: "For review",
  done: "Done",
  parked: "Parked",
}

function KpiPane({ employee: e, onUpsert }: { employee: Employee; onUpsert: (e: Employee) => void }) {
  const [editing, setEditing] = useState<Kpi | "new" | null>(null)
  const [sending, setSending] = useState<Kpi | null>(null)
  const [error, setError] = useState<string | null>(null)
  // `shown`, what the tap will make of it, is on screen at once; the server's
  // answer replaces it, a refusal puts it back.
  const act = async (call: Promise<Employee>, shown?: Employee) => {
    const before = e
    if (shown) onUpsert(shown)
    try {
      onUpsert(await call)
      setError(null)
    } catch (err) {
      if (shown) onUpsert(before)
      setError((err as Error).message)
    }
  }

  const order: Kpi["status"][] = ["review", "doing", "todo", "parked", "done"]
  const kpis = [...e.kpis].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || prio(a) - prio(b) || a.created_at - b.created_at,
  )
  const open = e.kpis.filter((k) => k.status !== "done" && k.status !== "parked")
  const average = open.length ? Math.round(open.reduce((n, k) => n + k.progress, 0) / open.length) : null

  return (
    <>
      <div className="emp-summary">
        <Stat label="Open" value={open.length} />
        <Stat label="For review" value={e.kpis.filter((k) => k.status === "review").length} />
        <Stat label="Done" value={e.kpis.filter((k) => k.status === "done").length} />
        <Stat label="Avg. progress" value={average === null ? "—" : `${average}%`} />
        <button className="emp-new" onClick={() => setEditing("new")}>
          <Plus /> New KPI
        </button>
      </div>
      {error && <div className="emp-error">{error}</div>}

      {kpis.length === 0 && (
        <div className="emp-empty">
          No KPIs yet. Add one here, or tell {e.name} in the chat — "research X by Friday" becomes a KPI.
        </div>
      )}

      {kpis.map((k) => (
        <div key={k.id} className={"kpi-card " + k.status} onClick={() => setEditing(k)}>
          <div className="kpi-top">
            <span className={"kpi-status " + k.status}>{KPI_STATUS[k.status]}</span>
            {k.priority !== "normal" && <span className={"kpi-prio " + k.priority}>{k.priority}</span>}
            {k.due && <span className="emp-dim kpi-due">due {k.due}</span>}
          </div>
          <div className="kpi-title">{k.title}</div>
          {k.criteria && <div className="kpi-criteria">Done when: {k.criteria}</div>}
          <div className="kpi-progress">
            <span className="kpi-track">
              <span className="kpi-fill" style={{ width: `${k.progress}%` }} />
            </span>
            <span className="emp-dim">{k.progress}%</span>
          </div>
          {k.note && <div className="kpi-note">{k.note}</div>}
          {k.status === "review" && (
            <div className="kpi-review" onClick={(ev) => ev.stopPropagation()}>
              <button className="emp-pill strong" onClick={() => act(reviewKpi(e.id, k.id, true), withKpi(e, k.id, "done"))}>
                <Check /> Accept
              </button>
              <button className="emp-pill" onClick={() => setSending(k)}>
                <Undo2 /> Send back
              </button>
            </div>
          )}
        </div>
      ))}

      {editing && (
        <KpiEditor
          kpi={editing === "new" ? null : editing}
          onSave={async (attrs) => {
            onUpsert(editing === "new" ? await addKpi(e.id, attrs) : await updateKpi(e.id, editing.id, attrs))
          }}
          onDelete={editing === "new" ? null : async () => onUpsert(await deleteKpi(e.id, editing.id))}
          onClose={() => setEditing(null)}
        />
      )}
      {sending && (
        <SendBack
          kpi={sending}
          onSend={(note) => act(reviewKpi(e.id, sending.id, false, note), withKpi(e, sending.id, "doing"))}
          onClose={() => setSending(null)}
        />
      )}
    </>
  )
}

// The employee with one KPI moved on, as a review is about to make it.
const withKpi = (e: Employee, id: string, status: Kpi["status"]): Employee => ({
  ...e,
  kpis: e.kpis.map((k) => (k.id === id ? { ...k, status } : k)),
})

const prio = (k: Kpi) => ({ high: 0, normal: 1, low: 2 })[k.priority]

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="emp-stat">
      <div className="emp-stat-value">{value}</div>
      <div className="emp-dim">{label}</div>
    </div>
  )
}

function KpiEditor({
  kpi,
  onSave,
  onDelete,
  onClose,
}: {
  kpi: Kpi | null
  onSave: (attrs: KpiAttrs) => Promise<void>
  onDelete: (() => Promise<void>) | null
  onClose: () => void
}) {
  const [draft, setDraft] = useState<KpiAttrs>(
    kpi ?? { title: "", detail: "", criteria: "", due: "", priority: "normal", status: "todo", progress: 0 },
  )
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const set = (attrs: KpiAttrs) => setDraft((d) => ({ ...d, ...attrs }))

  return (
    <Modal title={kpi ? "KPI" : "New KPI"} onClose={onClose}>
      <form
        className="project-form"
        onSubmit={async (ev) => {
          ev.preventDefault()
          try {
            await onSave(draft)
            onClose()
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        <label>
          <span>Title</span>
          <input autoFocus value={draft.title ?? ""} onChange={(ev) => set({ title: ev.target.value })} placeholder="e.g. A market report on X" />
        </label>
        <label>
          <span>What</span>
          <textarea rows={3} value={draft.detail ?? ""} onChange={(ev) => set({ detail: ev.target.value })} placeholder="The task, in as much detail as it needs." />
        </label>
        <label>
          <span>Done when</span>
          <textarea rows={2} value={draft.criteria ?? ""} onChange={(ev) => set({ criteria: ev.target.value })} placeholder="How you will check it: tests pass, five sources cited…" />
        </label>
        <div className="emp-form-row">
          <label>
            <span>Due</span>
            <input type="date" value={draft.due ?? ""} onChange={(ev) => set({ due: ev.target.value })} />
          </label>
          <label>
            <span>Priority</span>
            <select value={draft.priority} onChange={(ev) => set({ priority: ev.target.value as Kpi["priority"] })}>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </label>
          {kpi && (
            <label>
              <span>Status</span>
              <select value={draft.status} onChange={(ev) => set({ status: ev.target.value as Kpi["status"] })}>
                {Object.entries(KPI_STATUS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {kpi && (
          <label>
            <span>Progress · {draft.progress}%</span>
            <input type="range" min={0} max={100} step={5} value={draft.progress ?? 0} onChange={(ev) => set({ progress: Number(ev.target.value) })} />
          </label>
        )}
        {error && <div className="device-error">{error}</div>}
        <div className="confirm-actions">
          {onDelete && (
            <button type="button" className="text-btn danger project-delete" onClick={() => setAsking(true)}>
              Delete
            </button>
          )}
          <button type="button" className="text-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="text-btn primary" disabled={!draft.title?.trim()}>
            {kpi ? "Save" : "Add"}
          </button>
        </div>
      </form>
      {asking && onDelete && (
        <Confirm
          title={`Delete ${kpi?.title}?`}
          detail="The KPI goes from the list. What was done for it stays in the work log."
          onYes={async () => {
            await onDelete()
            onClose()
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </Modal>
  )
}

function SendBack({ kpi, onSend, onClose }: { kpi: Kpi; onSend: (note: string) => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState("")
  return (
    <Modal title="Send back" onClose={onClose}>
      <form
        className="project-form"
        onSubmit={(ev) => {
          ev.preventDefault()
          // Closes on the tap; a refusal shows on the employee's page.
          void onSend(note)
          onClose()
        }}
      >
        <label>
          <span>What is missing from “{kpi.title}”</span>
          <textarea autoFocus rows={4} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="It goes to its next wake-up, which is now." />
        </label>
        <div className="confirm-actions">
          <button type="button" className="text-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="text-btn primary">
            Send back
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Reports ────────────────────────────────────────────────────────────────────

function ReportsPane({ employee: e }: { employee: Employee }) {
  const [reports, setReports] = useState<EmployeeReport[] | null>(null)
  const [open, setOpen] = useState<{ file: string; text: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Read again whenever it has written something: a turn just ended.
  const latest = e.log[0]?.at
  useEffect(() => {
    employeeReports(e.id).then(setReports, (err: Error) => setError(err.message))
  }, [e.id, latest])

  const show = (file: string) => {
    setOpen({ file, text: null })
    employeeReport(e.id, file).then(
      (text) => setOpen({ file, text }),
      (err: Error) => setError(err.message),
    )
  }

  if (open)
    return (
      <>
        <button className="emp-back" onClick={() => setOpen(null)}>
          <ChevronLeft /> All reports
        </button>
        <div className="emp-report">
          {open.text === null ? <div className="emp-dim">loading…</div> : <Markdown text={open.text} />}
        </div>
      </>
    )

  // In the budget's unit: dollars, or turns where there is no cost to go by.
  const budget = e.budget_unit === "usd" ? e.budget_usd : e.budget_turns
  const days = Object.entries(e.budget_unit === "usd" ? e.spend_days : (e.turn_days ?? {}))
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7)
  const most = Math.max(budget, ...days.map(([, n]) => n))

  return (
    <>
      {error && <div className="emp-error">{error}</div>}
      <h2 className="emp-section">Reports</h2>
      {reports === null && !error && <div className="emp-dim">loading…</div>}
      {reports?.length === 0 && (
        <div className="emp-empty">
          None yet. A weekly report comes on {DAYS[e.weekly_report.day - 1]} at {e.weekly_report.time}.
        </div>
      )}
      {reports?.map((r) => (
        <button key={r.file} className="emp-report-row" onClick={() => show(r.file)}>
          <span className={"emp-report-kind " + r.kind}>{r.kind === "weekly" ? "Weekly" : "Daily"}</span>
          <span className="emp-report-title">{r.title.replace(/^(daily|weekly)-/, "")}</span>
          <span className="emp-dim">{when(r.mtime)}</span>
        </button>
      ))}

      <h2 className="emp-section">Recent work</h2>
      {e.log.length === 0 && <div className="emp-empty">Nothing yet.</div>}
      {e.log.slice(0, 30).map((entry) => (
        <div key={entry.at} className="emp-log-row">
          <span className="emp-dim emp-log-when">{when(entry.at)}</span>
          <span>
            {entry.summary ?? <span className="emp-dim">—</span>}
            {entry.report && entry.report.level !== "info" && (
              <span className={"emp-log-report " + entry.report.level}> {entry.report.text}</span>
            )}
          </span>
        </div>
      ))}

      <h2 className="emp-section">Spend, last days</h2>
      {days.length === 0 && <div className="emp-empty">Nothing spent yet.</div>}
      {days.map(([day, n]) => (
        <div key={day} className="emp-spend-row">
          <span className="emp-dim">{day.slice(5)}</span>
          <span className="kpi-track">
            <span className={"kpi-fill" + (n > budget ? " over" : "")} style={{ width: `${(n / most) * 100}%` }} />
          </span>
          <span>{short(e, n)}</span>
        </div>
      ))}
    </>
  )
}

// ── Settings ───────────────────────────────────────────────────────────────

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

function SettingsPane({
  employee: e,
  projects,
  devices,
  onUpsert,
  onDeleted,
  onSetupChat,
}: {
  employee: Employee
  projects: Project[]
  devices: Device[]
  onUpsert: (e: Employee) => void
  onDeleted: () => void
  onSetupChat: () => void
}) {
  // Folded unless in use: most never need it.
  const [advanced, setAdvanced] = useState(e.workstation !== null)
  const [draft, setDraft] = useState<EmployeeSettings>(() => editable(e))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  useEffect(() => setDraft(editable(e)), [e.id])

  const save = async () => {
    try {
      onUpsert(await updateEmployee(e.id, draft))
      setError(null)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form
      className="project-form emp-settings"
      onSubmit={(ev) => {
        ev.preventDefault()
        void save()
      }}
    >
      <ProfileFields draft={draft} setDraft={setDraft} projects={projects} />

      <h2 className="emp-section">Schedule</h2>
      <div className="emp-form-row">
        <label>
          <span>Working hours</span>
          <select
            value={draft.hours ? "set" : "all"}
            onChange={(ev) => setDraft((d) => ({ ...d, hours: ev.target.value === "all" ? null : [9, 22] }))}
          >
            <option value="all">All day</option>
            <option value="set">Between…</option>
          </select>
        </label>
        {draft.hours && (
          <>
            <label>
              <span>From</span>
              <select value={draft.hours[0]} onChange={(ev) => setDraft((d) => ({ ...d, hours: [Number(ev.target.value), d.hours![1]] }))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {pad(h)}:00
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>To</span>
              <select value={draft.hours[1]} onChange={(ev) => setDraft((d) => ({ ...d, hours: [d.hours![0], Number(ev.target.value)] }))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {pad(h)}:00
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="emp-form-row">
        <NumberField label="Heartbeat, min" value={draft.heartbeat_min} onChange={(n) => setDraft((d) => ({ ...d, heartbeat_min: n }))} />
        <NumberField label="Shortest sleep, min" value={draft.min_gap_min} onChange={(n) => setDraft((d) => ({ ...d, min_gap_min: n }))} />
        <NumberField label="Longest turn, min" value={draft.max_turn_min} onChange={(n) => setDraft((d) => ({ ...d, max_turn_min: n }))} />
      </div>
      <div className="emp-form-row">
        <label>
          <span>Weekly report</span>
          <select
            value={draft.weekly_report?.day}
            onChange={(ev) => setDraft((d) => ({ ...d, weekly_report: { ...d.weekly_report!, day: Number(ev.target.value) } }))}
          >
            {DAYS.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>at</span>
          <input
            type="time"
            value={draft.weekly_report?.time}
            onChange={(ev) => setDraft((d) => ({ ...d, weekly_report: { ...d.weekly_report!, time: ev.target.value } }))}
          />
        </label>
      </div>
      <small className="emp-dim">Times are Beijing time (UTC+8).</small>

      <h2 className="emp-section">Agent, model and budget</h2>
      <div className="emp-form-row">
        <label>
          <span>Agent</span>
          <input value={BACKENDS.find((b) => b.id === e.backend)?.label ?? e.backend} disabled />
        </label>
        <ModelField backend={e.backend} value={draft.model} onChange={(model) => setDraft((d) => ({ ...d, model }))} />
        <BudgetField backend={e.backend} draft={draft} setDraft={setDraft} />
      </div>
      <small className="emp-dim">
        {e.budget_unit === "usd"
          ? "Spent, it stops and asks you; what you approve on top counts for that day only."
          : `${BACKENDS.find((b) => b.id === e.backend)?.label} reports no cost, so the budget is turns a day; past it, it stops and asks you, and what you approve counts for that day only.`}{" "}
        The agent is for good; a model change applies once its sessions restart.
      </small>

      <h2 className="emp-section">Ask me first before</h2>
      <textarea
        rows={5}
        value={(draft.ask_first ?? []).join("\n")}
        onChange={(ev) => setDraft((d) => ({ ...d, ask_first: ev.target.value.split("\n") }))}
      />
      <small className="emp-dim">One per line. It asks with an urgent update, and waits.</small>

      <h2 className="emp-section">Permissions</h2>
      <p className="emp-permissions">
        {e.permissions ? (
          <>
            <Lock /> {e.permissions.summary}
          </>
        ) : (
          "Every tool, like any chat."
        )}
      </p>
      <small className="emp-dim">
        {e.permissions
          ? "Hard, for its work: Claude Code itself refuses anything else there, and refusals show in Updates. Its chat with you is not limited. "
          : "Hard limits — only some tools, only some commands — are set in conversation. "}
        <button type="button" className="text-btn emp-inline-btn" onClick={onSetupChat}>
          Change in a chat
        </button>
      </small>

      <h2 className="emp-section">Workspace</h2>
      <code className="project-path">{e.workspace}</code>

      <button type="button" className="emp-section emp-advanced" onClick={() => setAdvanced((a) => !a)}>
        Advanced {advanced ? <ChevronDown /> : <ChevronRight />}
      </button>
      {advanced && (
        <>
          <div className="emp-form-row">
            <label>
              <span>Workstation</span>
              <select
                value={draft.workstation ?? ""}
                onChange={(ev) => setDraft((d) => ({ ...d, workstation: ev.target.value || null }))}
              >
                <option value="">This server</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.online ? "" : " (offline)"}
                  </option>
                ))}
                {e.workstation && !devices.some((d) => d.id === e.workstation) && (
                  <option value={e.workstation}>{e.workstation_name ?? "?"} (removed)</option>
                )}
              </select>
            </label>
          </div>
          <small className="emp-dim">
            Its chats and memory stay on this server; what it does — commands, files, browsing, the web — happens on
            the workstation. While that is offline it does not work, and costs nothing.
          </small>
        </>
      )}

      {error && <div className="device-error">{error}</div>}
      <div className="confirm-actions emp-settings-actions">
        <button type="button" className="text-btn danger project-delete" onClick={() => setAsking(true)}>
          Let go
        </button>
        <button type="submit" className="text-btn primary">
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      {asking && (
        <Confirm
          title={`Let ${e.name} go?`}
          detail={`Its chat and updates, its KPIs and reports, and the workspace ${e.workspace}. This cannot be undone.`}
          action="Let go"
          onYes={async () => {
            await deleteEmployee(e.id)
            onDeleted()
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </form>
  )
}

const editable = (e: Employee): EmployeeSettings => ({
  name: e.name,
  role: e.role,
  persona: e.persona,
  language: e.language,
  project_ids: e.project_ids,
  hours: e.hours,
  heartbeat_min: e.heartbeat_min,
  min_gap_min: e.min_gap_min,
  max_turn_min: e.max_turn_min,
  budget_usd: e.budget_usd,
  budget_turns: e.budget_turns,
  weekly_report: e.weekly_report,
  ask_first: e.ask_first,
  model: e.model,
  workstation: e.workstation,
})

/** Who it is and what it may touch: shared by hiring and settings. */
function ProfileFields({
  draft,
  setDraft,
  projects,
}: {
  draft: EmployeeSettings
  setDraft: (f: (d: EmployeeSettings) => EmployeeSettings) => void
  projects: Project[]
}) {
  const ids = draft.project_ids ?? []
  return (
    <>
      <div className="emp-form-row">
        <label>
          <span>Name</span>
          <input value={draft.name ?? ""} onChange={(ev) => setDraft((d) => ({ ...d, name: ev.target.value }))} placeholder="e.g. 小研" />
        </label>
        <label>
          <span>Role</span>
          <input value={draft.role ?? ""} onChange={(ev) => setDraft((d) => ({ ...d, role: ev.target.value }))} placeholder="e.g. researcher, developer" />
        </label>
      </div>
      <label>
        <span>How it should work</span>
        <textarea
          rows={4}
          value={draft.persona ?? ""}
          onChange={(ev) => setDraft((d) => ({ ...d, persona: ev.target.value }))}
          placeholder="e.g. Careful and thorough. Every conclusion with its sources. Prefer small, tested changes."
        />
      </label>
      <label>
        <span>Writes to you in</span>
        <input value={draft.language ?? ""} onChange={(ev) => setDraft((d) => ({ ...d, language: ev.target.value }))} />
      </label>
      <div className="emp-field">
        <span className="emp-field-label">Projects it may work in</span>
        {projects.length === 0 && <div className="emp-dim">No projects yet; it has its own workspace either way.</div>}
        <div className="emp-chips">
          {projects.map((p) => {
            const on = ids.includes(p.id)
            return (
              <button
                type="button"
                key={p.id}
                className={"emp-chip" + (on ? " on" : "")}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    project_ids: on ? ids.filter((x) => x !== p.id) : [...ids, p.id],
                  }))
                }
              >
                {on && <Check />}
                {p.name}
              </button>
            )
          })}
        </div>
        <small className="emp-dim">Soft: it is told to stay in these, and nothing else stops it.</small>
      </div>
    </>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (n: number) => void }) {
  return (
    <label>
      <span>{label}</span>
      <input type="number" min={0} value={value ?? ""} onChange={(ev) => onChange(Number(ev.target.value))} />
    </label>
  )
}

// ── Hiring ─────────────────────────────────────────────────────────────────

export function HireDialog({
  projects,
  onHired,
  onChat,
  onClose,
}: {
  projects: Project[]
  onHired: (e: Employee) => void
  // Hire in conversation instead: a setup chat, which saves what you agree on.
  onChat: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<EmployeeSettings>({
    name: "",
    role: "",
    persona: "",
    language: "简体中文",
    project_ids: [],
    backend: "claude_code",
    model: MODELS.claude_code[0][0],
    budget_usd: 50,
    budget_turns: 40,
  })
  const backend = draft.backend ?? "claude_code"
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Modal title="Hire a virtual employee" onClose={onClose} wide>
      <form
        className="project-form"
        onSubmit={async (ev) => {
          ev.preventDefault()
          setBusy(true)
          try {
            onHired(await createEmployee(draft))
            onClose()
          } catch (err) {
            setError((err as Error).message)
            setBusy(false)
          }
        }}
      >
        <button
          type="button"
          className="emp-hire-chat"
          onClick={() => {
            onChat()
            onClose()
          }}
        >
          <MessageCircle />
          <span>
            <strong>Describe it in a chat</strong>
            <small className="emp-dim">Say what you need; the agent sets it up, permissions included, once you agree.</small>
          </span>
          <ChevronRight />
        </button>
        <div className="emp-hire-or emp-dim">or fill in the form</div>
        <div className="emp-field">
          <span className="emp-field-label">Agent</span>
          <div className="emp-chips">
            {BACKENDS.map((b) => (
              <button
                type="button"
                key={b.id}
                className={"emp-chip" + (backend === b.id ? " on" : "")}
                onClick={() => setDraft((d) => ({ ...d, backend: b.id, model: MODELS[b.id][0][0] }))}
              >
                {backend === b.id && <Check />}
                {b.label}
              </button>
            ))}
          </div>
          <small className="emp-dim">{BACKENDS.find((b) => b.id === backend)?.hint} For good, as for any session.</small>
        </div>
        <ProfileFields draft={draft} setDraft={setDraft} projects={projects} />
        <div className="emp-form-row">
          <ModelField backend={backend} value={draft.model} onChange={(model) => setDraft((d) => ({ ...d, model }))} />
          <BudgetField backend={backend} draft={draft} setDraft={setDraft} />
        </div>
        <small className="emp-dim">
          It starts at once: looks around, then sleeps until there is work. Wakes every 2 hours and writes a weekly report on
          Fridays; all of it can be changed later.
        </small>
        {error && <div className="device-error">{error}</div>}
        <div className="confirm-actions">
          <button type="button" className="text-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="text-btn primary" disabled={!draft.name?.trim() || busy}>
            Hire
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return createPortal(
    <div className="modal-scrim" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className={"modal project-dialog emp-modal" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// ── Agents ─────────────────────────────────────────────────────────────────

const BACKENDS: { id: AgentBackend; label: string; hint: string }[] = [
  { id: "claude_code", label: "Claude Code", hint: "Reports what each turn cost, so its budget is in dollars." },
  { id: "kiro", label: "Kiro", hint: "Kiro CLI, on your Kiro login. It reports no cost, so its budget is turns a day." },
  { id: "codex", label: "Codex", hint: "Needs `codex` on the server. It reports no cost, so its budget is turns a day." },
]

// Each agent's models, its best first: what an employee starts on.
const MODELS: Record<AgentBackend, [string, string][]> = {
  claude_code: [
    ["opus", "Opus"],
    ["sonnet", "Sonnet"],
  ],
  kiro: [
    ["claude-opus-5.5", "Claude Opus 5.5"],
    ["claude-opus-5", "Claude Opus 5"],
    ["claude-sonnet-5", "Claude Sonnet 5"],
    ["auto", "Auto (Kiro picks)"],
  ],
  codex: [["", "Codex's default"]],
}

function ModelField({ backend, value, onChange }: { backend: AgentBackend; value: string | undefined; onChange: (model: string) => void }) {
  const options = MODELS[backend]
  const known = options.some(([id]) => id === value)
  return (
    <label>
      <span>Model</span>
      <select value={value ?? ""} onChange={(ev) => onChange(ev.target.value)} disabled={options.length === 1}>
        {!known && value && <option value={value}>{value}</option>}
        {options.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Dollars a day for Claude Code, which reports cost; turns a day for the others. */
function BudgetField({
  backend,
  draft,
  setDraft,
}: {
  backend: AgentBackend
  draft: EmployeeSettings
  setDraft: (f: (d: EmployeeSettings) => EmployeeSettings) => void
}) {
  return backend === "claude_code" ? (
    <NumberField label="Budget a day, $" value={draft.budget_usd} onChange={(n) => setDraft((d) => ({ ...d, budget_usd: n }))} />
  ) : (
    <NumberField label="Turns a day" value={draft.budget_turns} onChange={(n) => setDraft((d) => ({ ...d, budget_turns: Math.round(n) }))} />
  )
}

// ── Formatting ─────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const pad = (n: number) => String(n).padStart(2, "0")
export const money = (n: number) => n.toFixed(2)
/** An amount in the employee's budget unit: "$12.40", or "12 turns". */
export const amount = (e: Pick<Employee, "budget_unit">, n: number) =>
  e.budget_unit === "turns" ? `${Math.round(n)} turns` : `$${money(n)}`
/** The same, short, where the unit is said beside it. */
export const short = (e: Pick<Employee, "budget_unit">, n: number) =>
  e.budget_unit === "turns" ? `${Math.round(n)}` : `$${money(n)}`

function clock(ms: number) {
  const d = new Date(ms)
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`
}

function when(ms: number) {
  const d = new Date(ms)
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
  if (d.toDateString() === new Date().toDateString()) return `today ${time}`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + time
}

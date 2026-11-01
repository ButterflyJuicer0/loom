import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Folder,
  FolderPlus,
  Globe,
  Keyboard,
  KeyboardOff,
  MonitorSmartphone,
  MoreHorizontal,
  PanelLeft,
  Settings,
  SquarePen,
  UserPlus,
  Users,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"
import type { AgentBackend, AgentInfo, Device, Employee, Notice, Project } from "./api"
import { Avatar, BudgetRing, short, STATUS, StatusIcon } from "./Employees"
import { BellButton } from "./Notices"
import { RenameInput } from "./Confirm"
import { DevicesDialog } from "./Devices"
import { SessionMenu } from "./SessionMenu"
import { MoonButton, scopeOf } from "./Sleep"
import type { Push } from "./push"
import { lastActive } from "./useLobby"
import { useNarrow } from "./useNarrow"

/**
 * Which parts of the sidebar are not as they start, by key: `toggled` in App.
 * Sessions and Pinned start open, Projects starts folded, so
 * a key in the set means the opposite of that.
 */
export const PROJECTS_SECTION = "section:projects"
export const SESSIONS_SECTION = "section:sessions"
export const PINNED_SECTION = "section:pinned"
export const EMPLOYEES_SECTION = "section:employees"
// The foot's switches: a list, or folded to a row of their icons.
export const FOOT_SECTION = "section:foot"

const OPEN_AT_FIRST = [SESSIONS_SECTION, PINNED_SECTION, EMPLOYEES_SECTION, FOOT_SECTION]
export const isOpen = (toggled: Set<string>, key: string) =>
  OPEN_AT_FIRST.includes(key) ? !toggled.has(key) : toggled.has(key)

/**
 * The sidebar as a phone opens it, to keep to the conversations: Recents
 * open, Projects, Employees and the foot folded. Pinned is left as it was —
 * pinning is already a choice to keep it in view.
 */
export function focused(toggled: Set<string>): Set<string> {
  const next = new Set(toggled)
  const want = (key: string, open: boolean) => {
    if (isOpen(next, key) === open) return
    if (next.has(key)) next.delete(key)
    else next.add(key)
  }
  want(SESSIONS_SECTION, true)
  for (const key of [PROJECTS_SECTION, EMPLOYEES_SECTION, FOOT_SECTION]) want(key, false)
  return next
}

/**
 * The sidebar's lists, which overlap on purpose: each project (most recently
 * used first) with all its sessions; then the pinned sessions; then the rest,
 * most recently active first. A session put in a project stays in the list it
 * was found in.
 */
export function sidebarGroups(sessions: AgentInfo[], projects: Project[]) {
  const inside = new Map<string, AgentInfo[]>(projects.map((p) => [p.id, []]))
  for (const s of sessions) if (s.project_id) inside.get(s.project_id)?.push(s)
  const used = (p: Project) => {
    const first = inside.get(p.id)![0]
    return first ? lastActive(first) : p.created_at
  }
  const groups = [...projects]
    .sort((a, b) => used(b) - used(a))
    .map((project) => ({ project, sessions: inside.get(project.id)! }))
  return { groups, pinned: sessions.filter((s) => s.pinned), recent: sessions.filter((s) => !s.pinned) }
}

/** What j/k walks: every session row that is showing, each once, top to bottom. Projects list theirs on their own pages. */
export function sidebarOrder(sessions: AgentInfo[], projects: Project[], toggled: Set<string>): AgentInfo[] {
  const { pinned, recent } = sidebarGroups(sessions, projects)
  const rows = [
    ...(isOpen(toggled, PINNED_SECTION) ? pinned : []),
    ...(isOpen(toggled, SESSIONS_SECTION) ? recent : []),
  ]
  return rows.filter((s, i) => rows.findIndex((r) => r.id === s.id) === i)
}

type Props = {
  sessions: AgentInfo[]
  projects: Project[]
  // What is folded or unfolded against its default; see `isOpen`.
  toggled: Set<string>
  onToggle: (key: string) => void
  // A project to edit, or null to make one.
  onEditProject: (project: Project | null) => void
  // A project's page, and the one showing, if any.
  onOpenProject: (id: string) => void
  openProjectId: string | null
  // The Tasks page, and whether it is the one showing.
  tasksOpen: boolean
  onOpenTasks: () => void
  devices: Device[]
  onUpsertDevice: (device: Device) => void
  push: Push
  // Desktop only, so null on a phone; see keys.tsx.
  vim: { on: boolean; toggle: () => void } | null
  activeId: string | null
  // The session under the keyboard's cursor while the list is walked; see App.
  cursorId: string | null
  // The session whose name is being edited in its row, and where it goes.
  renamingId: string | null
  onRenamed: (id: string, title: string | null) => Promise<void>
  onSelect: (id: string) => void
  onCreate: (backend: AgentBackend, projectId?: string) => void
  onDelete: (id: string) => void
  // From a row's menu: put its name up for editing, pin it, move it.
  onRename: (id: string) => void
  onPin: (id: string, pinned: boolean) => Promise<void>
  onContinue: (id: string) => Promise<void>
  onMove: (id: string, projectId: string | null) => Promise<void>
  onArchive: (id: string, archived: boolean) => Promise<void>
  onCollapse: () => void
  browserOpen: boolean
  onToggleBrowser: () => void
  // What "+" starts, with no menu to choose from; see Settings.
  defaultBackend: AgentBackend
  onOpenSettings: () => void
  // The sleep sessions, which the lists leave out: one moon each. See Sleep.tsx.
  dreams: AgentInfo[]
  onOpenDream: (scope: string) => void
  // Virtual employees; see Employees.tsx. The one whose page is showing, if any.
  employees: Employee[]
  activeEmployeeId: string | null
  onOpenEmployee: (id: string) => void
  onHire: () => void
  // The bell, whose button sits beside Search; see Notices.tsx.
  notices: Notice[]
  onOpenBell: () => void
}

export function Sidebar({
  sessions,
  projects,
  toggled,
  onToggle,
  onEditProject,
  onOpenProject,
  openProjectId,
  tasksOpen,
  onOpenTasks,
  devices,
  onUpsertDevice,
  push,
  vim,
  activeId,
  cursorId,
  renamingId,
  onRenamed,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onPin,
  onContinue,
  onMove,
  onArchive,
  onCollapse,
  browserOpen,
  onToggleBrowser,
  defaultBackend,
  onOpenSettings,
  dreams,
  onOpenDream,
  employees,
  activeEmployeeId,
  onOpenEmployee,
  onHire,
  notices,
  onOpenBell,
}: Props) {
  // Ages are relative, so they go stale without any new data. A local clock,
  // not a poll: nothing is fetched.
  const [, setNow] = useState(0)
  // On a phone the foot is not a list but a button that unfolds it upwards,
  // beside a "New chat" one: ChatGPT's two at the bottom of its drawer.
  const narrow = useNarrow()
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const [devicesOpen, setDevicesOpen] = useState(false)
  const online = devices.filter((d) => d.online).length
  const { groups, pinned, recent } = sidebarGroups(sessions, projects)
  const open = (key: string) => isOpen(toggled, key)
  // The row whose menu is open, and where its button is.
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const menuFor = menu && sessions.find((s) => s.id === menu.id)
  const projectName = (s: AgentInfo) => projects.find((p) => p.id === s.project_id)?.name
  const dreamOf = (scope: string) => dreams.find((d) => scopeOf(d) === scope)
  const homeDream = dreamOf("home")

  const row = (s: AgentInfo) => (
    <div
      key={s.id}
      ref={s.id === cursorId ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
      className={
        "session" +
        (menu?.id === s.id ? " menu-open" : "") +
        (s.id === activeId ? " active" : "") +
        (s.id === cursorId ? " cursor" : "") +
        (unread(s) ? " unread" : "")
      }
      onClick={() => onSelect(s.id)}
      // Outside its project, which one it is in: on hover here, and in its menu.
      title={projectName(s) ? `in ${projectName(s)}` : undefined}
    >
      <span className={"dot " + s.status} title={s.status} />
      {s.id === renamingId ? (
        <RenameInput value={s.title ?? s.id} stem={false} onDone={(title) => onRenamed(s.id, title)} />
      ) : (
        <span className="session-label">{s.title ?? s.id}</span>
      )}
      {s.queued > 0 && (
        <span className="session-queued" title="queued messages">
          {s.queued}
        </span>
      )}
      {unread(s) && <span className="session-unread" title="Unread: a reply not yet read on any device" />}
      <span className="session-when" title={"last active " + new Date(lastActive(s)).toLocaleString()}>
        {when(lastActive(s))}
      </span>
      <button
        className="session-del session-more"
        title="Rename, pin, move to a project, delete"
        onClick={(e) => {
          e.stopPropagation()
          const anchor = e.currentTarget.getBoundingClientRect()
          setMenu((m) => (m?.id === s.id ? null : { id: s.id, anchor }))
        }}
      >
        <MoreHorizontal />
      </button>
    </div>
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">loom</span>
        <span className="sidebar-actions">
          <BellButton notices={notices} onClick={onOpenBell} />
          {/* A phone's drawer is put away by a swipe or a tap beside it. */}
          {!narrow && (
            <button className="icon-btn" onClick={onCollapse} title="Hide sidebar">
              <PanelLeft />
            </button>
          )}
        </span>
      </div>

      <div className="session-list">
        {/* ChatGPT's first row on a desktop. A phone has its floating pill. */}
        {!narrow && (
          <div className="nav-item nav-new" role="button" onClick={() => onCreate(defaultBackend)}>
            <SquarePen className="nav-icon" />
            <span className="nav-label">New chat</span>
          </div>
        )}
        {/* A top-level entry, like the sidebar's others: folded until asked. */}
        <div
          className={"nav-item" + (open(PROJECTS_SECTION) ? " open" : "")}
          role="button"
          aria-expanded={open(PROJECTS_SECTION)}
          onClick={() => onToggle(PROJECTS_SECTION)}
        >
          <Folder className="nav-icon" />
          <span className="nav-label">Projects</span>
          <ChevronRight className="nav-chevron" />
        </div>
        {open(PROJECTS_SECTION) && (
          <div className="nav-children">
            {/* Each opens the project's page, its files and sessions: the
                row itself does not unfold. */}
            {groups.map(({ project, sessions: inside }) => (
              <div
                key={project.id}
                className={
                  "project-row" +
                  (project.id === openProjectId ? " current" : "") +
                  (inside.some((s) => s.id === activeId) ? " holds-active" : "")
                }
                onClick={() => onOpenProject(project.id)}
                title={project.workspace}
              >
                <Folder className="project-icon" />
                <span className="session-label">{project.name}</span>
                {/* Nothing to sleep on until something has happened here. */}
                {(inside.length > 0 || dreamOf(project.id)) && (
                  <MoonButton
                    dream={dreamOf(project.id)}
                    active={dreamOf(project.id)?.id === activeId}
                    what={` — ${project.name}`}
                    onOpen={() => onOpenDream(project.id)}
                  />
                )}
                {inside.some(unread) && <span className="session-unread" title="Unread replies" />}
                {inside.length > 0 && <span className="nav-count">{inside.length}</span>}
              </div>
            ))}
            {/* New goes last, inside: the heading carries nothing but its name. */}
            <button className="project-row project-new-row" onClick={() => onEditProject(null)}>
              <FolderPlus className="project-icon" />
              <span className="session-label">New project</span>
            </button>
          </div>
        )}

        {/* Virtual employees: a row each, with where it stands. Open until folded. */}
        <div
          className={"nav-item" + (open(EMPLOYEES_SECTION) ? " open" : "")}
          role="button"
          aria-expanded={open(EMPLOYEES_SECTION)}
          onClick={() => onToggle(EMPLOYEES_SECTION)}
        >
          <Users className="nav-icon" />
          <span className="nav-label">Employees</span>
          <ChevronRight className="nav-chevron" />
        </div>
        {open(EMPLOYEES_SECTION) && (
          <div className="nav-children">
            {employees.map((e) => {
              const status = STATUS[e.status]
              return (
                <div
                  key={e.id}
                  className={"emp-row" + (e.id === activeEmployeeId ? " active" : "")}
                  onClick={() => onOpenEmployee(e.id)}
                  title={`${e.role ? `${e.name} — ${e.role}` : e.name}\n${status.label} · ${short(e, e.spent_today)} of ${short(e, e.cap_today)}${e.budget_unit === "turns" ? " turns" : ""}`}
                >
                  <Avatar employee={e} size="sm" />
                  <span className="emp-row-name">
                    {e.name}
                    {e.workstation && <span className="emp-row-station"> · {e.workstation_name}</span>}
                  </span>
                  <StatusIcon status={e.status} />
                  <BudgetRing employee={e} />
                </div>
              )
            })}
            <button className="project-row project-new-row" onClick={onHire}>
              <UserPlus className="project-icon" />
              <span className="session-label">Hire an employee</span>
            </button>
          </div>
        )}

        {/* Another top-level entry: a page of its own, not a list. */}
        <div className={"nav-item" + (tasksOpen ? " current" : "")} role="button" onClick={onOpenTasks}>
          <Clock className="nav-icon" />
          <span className="nav-label">Tasks</span>
        </div>

        {pinned.length > 0 && (
          <>
            <Heading label="Pinned" open={open(PINNED_SECTION)} onToggle={() => onToggle(PINNED_SECTION)} />
            {open(PINNED_SECTION) && pinned.map((s) => row(s))}
          </>
        )}

        <Heading label="Recents" open={open(SESSIONS_SECTION)} onToggle={() => onToggle(SESSIONS_SECTION)} />
        {open(SESSIONS_SECTION) &&
          (recent.length ? (
            recent.map((s) => row(s))
          ) : (
            <div className="session-empty">{pinned.length ? "Nothing else yet." : "No sessions yet."}</div>
          ))}
      </div>

      {menu && menuFor && (
        <SessionMenu
          session={menuFor}
          projects={projects}
          anchor={menu.anchor}
          onRename={() => onRename(menuFor.id)}
          onPin={(on) => onPin(menuFor.id, on)}
          onContinue={menuFor.kind == null && !menuFor.employee_id ? () => onContinue(menuFor.id) : undefined}
          onMove={(projectId) => onMove(menuFor.id, projectId)}
          onArchive={(on) => onArchive(menuFor.id, on)}
          onDelete={() => onDelete(menuFor.id)}
          onClose={() => setMenu(null)}
        />
      )}

      {/* Folded, a row of the same buttons as icons: still one tap each. On a
          phone, unfolded is a column over the dimmed list; picking one folds it. */}
      {narrow && open(FOOT_SECTION) && <div className="dial-scrim" onClick={() => onToggle(FOOT_SECTION)} />}
      <div
        className={"sidebar-foot" + (narrow ? " dial" : "") + (open(FOOT_SECTION) ? "" : " folded")}
        onClick={narrow ? (e) => (e.target as Element).closest("button") && onToggle(FOOT_SECTION) : undefined}
      >
        {vim && (
          <button
            className={"devices-btn push-btn" + (vim.on ? " on" : "")}
            onClick={vim.toggle}
            title={vim.on ? "Vim mode is on; ? lists the keys. Click to turn it off." : "Turn on Vim mode: keys for the panes, ? lists them"}
          >
            {vim.on ? <Keyboard /> : <KeyboardOff />}
            <span>Vim mode</span>
            <span className="devices-count">{vim.on ? "on" : "off"}</span>
          </button>
        )}

        <PushButton push={push} />

        {/* Loom's own browser, the one agents drive: taking it over is how a
            site gets logged in to once and stays logged in. */}
        <button
          className={"devices-btn push-btn" + (browserOpen ? " on" : "")}
          onClick={onToggleBrowser}
          title="Loom's browser: log in to a site, or get past a check for the agents"
        >
          <Globe />
          <span>Browser</span>
          <span className="devices-count">{browserOpen ? "open" : ""}</span>
        </button>

        {/* The user's own machines, reachable by agents through loom-node. */}
        <button
          className={"devices-btn push-btn" + (online > 0 ? " on" : "")}
          onClick={() => setDevicesOpen(true)}
          title="Devices"
        >
          {/* An icon like the two above, so the labels line up; lit while any is online. */}
          <MonitorSmartphone />
          <span>Devices</span>
          <span className="devices-count">
            {online}/{devices.length}
          </span>
        </button>
        {/* Sleep for the sessions outside any project, which share one memory;
            each project's is the moon on its row. Always here, like its
            neighbours, even before there is anything to dream on. */}
        <MoonButton
          className="devices-btn push-btn foot"
          label="Dream"
          dream={homeDream}
          active={homeDream?.id === activeId}
          what=" — sessions outside any project"
          onOpen={() => onOpenDream("home")}
        />
        {/* This device's preferences: appearance, and the agent "+" starts.
            The fold at the end of its row, where the row is empty. */}
        <div className="foot-last">
          <button className="devices-btn push-btn" onClick={onOpenSettings} title="Settings">
            <Settings />
            <span>Settings</span>
          </button>
          <button
            className="devices-btn foot-fold"
            onClick={() => onToggle(FOOT_SECTION)}
            aria-expanded={open(FOOT_SECTION)}
            title={open(FOOT_SECTION) ? "Fold to icons" : "Unfold"}
          >
            {open(FOOT_SECTION) ? <ChevronDown /> : <ChevronUp />}
          </button>
        </div>
      </div>
      {narrow && (
        <div className="sidebar-float">
          <button className="new-chat" onClick={() => onCreate(defaultBackend)}>
            <SquarePen />
            New chat
          </button>
          <button
            className="dial-btn"
            onClick={() => onToggle(FOOT_SECTION)}
            aria-expanded={open(FOOT_SECTION)}
            title={open(FOOT_SECTION) ? "Close" : "Notifications, Browser, Devices, Dream, Settings"}
          >
            {open(FOOT_SECTION) ? <X /> : <ChevronUp />}
          </button>
        </div>
      )}
      {devicesOpen && (
        <DevicesDialog
          devices={devices}
          employees={employees}
          onUpsert={onUpsertDevice}
          onClose={() => setDevicesOpen(false)}
        />
      )}
    </aside>
  )
}

/** A list's heading, ChatGPT's "Pinned" and "Recent": bold, and it folds. */
function Heading({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button className={"list-heading" + (open ? " open" : "")} onClick={onToggle} aria-expanded={open}>
      {label}
      <ChevronRight />
    </button>
  )
}

const PUSH_HINT: Record<Push["state"], string> = {
  on: "This device is notified when a turn ends. Click to stop.",
  off: "Get a notification on this device when a turn ends",
  denied: "Notifications are blocked for this site in the browser's settings",
  unsupported: "On an iPhone, add Loom to the Home Screen and open it from there to get notifications",
}

/** Notifications for this device, on or off; see `usePush`. */
function PushButton({ push }: { push: Push }) {
  const on = push.state === "on"
  const Icon = on ? Bell : BellOff
  return (
    <button
      className={"devices-btn push-btn" + (on ? " on" : "")}
      onClick={push.toggle}
      disabled={push.busy || push.state === "denied" || push.state === "unsupported"}
      title={push.error ?? PUSH_HINT[push.state]}
    >
      <Icon />
      <span>Notifications</span>
      <span className="devices-count">
        {push.error ? "failed" : push.busy ? "…" : on ? "on" : push.state === "off" ? "off" : "n/a"}
      </span>
    </button>
  )
}

/**
 * A reply that no device has read yet: `Chat` marks it read once it is on a
 * screen, scrolled to. Not while the turn is still going; the dot says that.
 */
export function unread(s: AgentInfo): boolean {
  return s.status === "idle" && (s.reply_seq ?? 0) > (s.seen_seq ?? 0)
}

export function when(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

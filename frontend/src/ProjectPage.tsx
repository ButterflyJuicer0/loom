import {
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Pin,
  Plus,
  Settings,
} from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  downloadProjectFile,
  projectTree,
  type AgentBackend,
  type AgentInfo,
  type Project,
  type TreeFile,
} from "./api"
import { RenameInput } from "./Confirm"
import { build, formatTime, iconFor, type Node as TreeNode } from "./FileBrowser"
import { formatBytes } from "./format"
import { SessionMenu } from "./SessionMenu"
import { unread, when } from "./Sidebar"
import { MoonButton } from "./Sleep"
import { NewMenu } from "./NewMenu"
import { lastActive } from "./useLobby"
import "./ProjectPage.css"

export type ProjectTab = "files" | "sessions"

/**
 * A project's own page, opened from its row in the sidebar instead of
 * unfolding it there: its workspace as a tree, and its sessions, a tab each.
 * The head carries what the row used to: a new session, the project's dream,
 * its settings.
 */
export function ProjectPage({
  project,
  projects,
  sessions,
  dream,
  activeId,
  tab,
  onTab,
  showSidebarButton,
  onToggleSidebar,
  onOpenSession,
  onCreate,
  onEdit,
  onOpenDream,
  renamingId,
  onRenamed,
  onRename,
  onPin,
  onContinue,
  onMove,
  onArchive,
  onDelete,
}: {
  project: Project
  projects: Project[]
  // The project's, most recently active first.
  sessions: AgentInfo[]
  dream: AgentInfo | undefined
  activeId: string | null
  tab: ProjectTab
  onTab: (tab: ProjectTab) => void
  showSidebarButton: boolean
  onToggleSidebar: () => void
  onOpenSession: (id: string) => void
  onCreate: (backend: AgentBackend) => void
  onEdit: () => void
  onOpenDream: () => void
  renamingId: string | null
  onRenamed: (id: string, title: string | null) => Promise<void>
  onRename: (id: string) => void
  onPin: (id: string, pinned: boolean) => Promise<void>
  onContinue: (id: string) => Promise<void>
  onMove: (id: string, projectId: string | null) => Promise<void>
  onArchive: (id: string, archived: boolean) => Promise<void>
  onDelete: (id: string) => void
}) {
  const [newMenu, setNewMenu] = useState<DOMRect | null>(null)

  return (
    <div className="proj-page">
      <header className="proj-head">
        {showSidebarButton && (
          <button className="proj-round" onClick={onToggleSidebar} title="Show sidebar">
            <PanelLeft />
          </button>
        )}
        <h1 title={project.workspace}>{project.name}</h1>
        <span className="proj-actions">
          <MoonButton
            className="proj-round proj-moon"
            dream={dream}
            active={false}
            what={` — ${project.name}`}
            onOpen={onOpenDream}
          />
          <button
            className="proj-round proj-new"
            title={`New session in ${project.name}`}
            onClick={(e) => {
              const anchor = e.currentTarget.getBoundingClientRect()
              setNewMenu((m) => (m ? null : anchor))
            }}
          >
            <Plus />
          </button>
          <button className="proj-round" title="Project settings" onClick={onEdit}>
            <Settings />
          </button>
        </span>
      </header>

      <div className="proj-tabs" role="tablist">
        <Tab on={tab === "files"} onClick={() => onTab("files")} icon={<Folder />} label="Files" />
        <Tab
          on={tab === "sessions"}
          onClick={() => onTab("sessions")}
          icon={<MessageSquare />}
          label="Sessions"
          count={sessions.length}
          dot={sessions.some(unread)}
        />
      </div>

      <div className="proj-scroll">
        <div className="proj-column">
          {tab === "files" ? (
            <Files project={project} />
          ) : (
            <Sessions
              sessions={sessions}
              projects={projects}
              activeId={activeId}
              onOpen={onOpenSession}
              renamingId={renamingId}
              onRenamed={onRenamed}
              onRename={onRename}
              onPin={onPin}
              onContinue={onContinue}
              onMove={onMove}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>

      {newMenu && (
        <NewMenu
          owner=".proj-new"
          anchor={newMenu}
          onPick={(backend) => {
            setNewMenu(null)
            onCreate(backend)
          }}
          onClose={() => setNewMenu(null)}
        />
      )}
    </div>
  )
}

function Tab({
  on,
  onClick,
  icon,
  label,
  count,
  dot,
}: {
  on: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  count?: number
  dot?: boolean
}) {
  return (
    <button role="tab" aria-selected={on} className={"proj-tab" + (on ? " on" : "")} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className="proj-tab-count">{count}</span>}
      {dot && <span className="proj-tab-dot" />}
    </button>
  )
}

/**
 * The workspace as a tree, newest first at every level, like the canvas's
 * file browser. Only to find and download a file: it is the agents' working
 * directory, not this page's to rename or delete in. Listed each time the tab
 * is shown.
 */
function Files({ project }: { project: Project }) {
  const [list, setList] = useState<{ files: TreeFile[]; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let live = true
    projectTree(project.id).then(
      (t) => live && setList(t),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [project.id])

  const tree = useMemo(() => (list ? build(list.files) : []), [list])

  const open = (node: TreeNode) => {
    if (!node.children) return void downloadProjectFile(project.id, node.path).catch((e: Error) => setError(e.message))
    setUnfolded((s) => {
      const next = new Set(s)
      if (next.has(node.path)) next.delete(node.path)
      else next.add(node.path)
      return next
    })
  }

  const rows = (nodes: TreeNode[], depth: number): ReactNode[] =>
    nodes.flatMap((node) => {
      const isDir = !!node.children
      const here = isDir && unfolded.has(node.path)
      const Icon = isDir ? (here ? FolderOpen : Folder) : iconFor(node.name)
      const row = (
        <div
          key={node.path}
          className="tree-row proj-file"
          style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}
          onClick={() => open(node)}
          title={`${node.path}\n${formatBytes(node.size)} · ${formatTime(node.mtime)}`}
        >
          <span className="tree-fold">{isDir && (here ? <ChevronDown /> : <ChevronRight />)}</span>
          <Icon className="tree-icon" />
          <span className="tree-name">{node.name}</span>
          <span className="proj-file-when">{formatTime(node.mtime)}</span>
          <span className="proj-file-dl">{!isDir && <Download />}</span>
        </div>
      )
      return here ? [row, ...rows(node.children!, depth + 1)] : [row]
    })

  if (error) return <div className="proj-note failed">{error}</div>
  if (!list) return <div className="proj-note">loading…</div>
  return (
    <div className="proj-files">
      {tree.length ? rows(tree, 0) : <div className="proj-note">The workspace is empty.</div>}
      {list.truncated && <div className="proj-note">Only the first {list.files.length} files are listed.</div>}
    </div>
  )
}

function Sessions({
  sessions,
  projects,
  activeId,
  onOpen,
  renamingId,
  onRenamed,
  onRename,
  onPin,
  onContinue,
  onMove,
  onArchive,
  onDelete,
}: {
  sessions: AgentInfo[]
  projects: Project[]
  activeId: string | null
  onOpen: (id: string) => void
  renamingId: string | null
  onRenamed: (id: string, title: string | null) => Promise<void>
  onRename: (id: string) => void
  onPin: (id: string, pinned: boolean) => Promise<void>
  onContinue: (id: string) => Promise<void>
  onMove: (id: string, projectId: string | null) => Promise<void>
  onArchive: (id: string, archived: boolean) => Promise<void>
  onDelete: (id: string) => void
}) {
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const menuFor = menu && sessions.find((s) => s.id === menu.id)

  if (!sessions.length) return <div className="proj-note">No sessions yet. + starts one.</div>
  return (
    <div className="proj-sessions">
      {sessions.map((s) => (
        <div
          key={s.id}
          className={
            "proj-session" + (s.id === activeId ? " active" : "") + (menu?.id === s.id ? " menu-open" : "")
          }
          onClick={() => onOpen(s.id)}
        >
          <span className={"dot " + s.status} title={s.status} />
          {s.id === renamingId ? (
            <RenameInput value={s.title ?? s.id} stem={false} onDone={(title) => onRenamed(s.id, title)} />
          ) : (
            <span className="session-label">{s.title ?? s.id}</span>
          )}
          {s.pinned && <Pin className="session-pin" />}
          {unread(s) && <span className="session-unread" title="Unread: a reply not yet read on any device" />}
          <span className="proj-session-when" title={"last active " + new Date(lastActive(s)).toLocaleString()}>
            {when(lastActive(s))}
          </span>
          <button
            className="proj-session-more session-more"
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
      ))}
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
    </div>
  )
}

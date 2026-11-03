import { ChevronLeft, Maximize, Minimize, Plus, X } from "lucide-react"
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Canvas } from "./Canvas"
import { moved, touches, type CanvasItem } from "./canvasItems"
import { Confirm } from "./Confirm"
import { Chat } from "./Chat"
import { Switcher } from "./Switcher"
import type { TreeNav } from "./FileBrowser"
import { KeyHelp, useGlobalKey, useKeys, WhichKey, type Keymap } from "./keys"
import { Login } from "./Login"
import { usePush, useVisible } from "./push"
import { ProjectDialog } from "./Projects"
import { SettingsDialog } from "./Settings"
import { useSettings } from "./settings"
import { Tasks } from "./Tasks"
import { focused, isOpen, PROJECTS_SECTION, Sidebar, sidebarGroups, sidebarOrder } from "./Sidebar"
import { ProjectPage, type ProjectTab } from "./ProjectPage"
import { isDream, scopeOf, Sleep, type SleepTab } from "./Sleep"
import { EmployeePage, HireDialog, isEmployeeSession, type EmployeeTab } from "./Employees"
import { Terminal } from "./Terminal"
// noVNC is only for the browser pane, so it loads when that is first opened.
const Browser = lazy(() => import("./Browser").then((m) => ({ default: m.Browser })))
import { lastActive, useLobby } from "./useLobby"
import { useNarrow } from "./useNarrow"
import { useSwipe } from "./useSwipe"
import {
  changeAgent,
  continueAgent,
  showChangesWith,
  createAgentLater,
  createSession,
  deleteAgent,
  deleteSession,
  checkAuth,
  renameAgent,
  updateAgent,
  isArchived,
  getToken,
  listSessions,
  onUnauthorized,
  openDream,
  readNotice,
  bellSession,
  employeeSetup,
  type AgentBackend,
  type Employee,
  type Notice,
  type Project,
} from "./api"
import { NoticesSheet } from "./Notices"
import { dropSocket } from "./socket"
import "./App.css"
// Last, so it decides the look over every other stylesheet.
import "./theme.css"

const SIDEBAR_KEY = "loom_sidebar_open"
const CANVAS_KEY = "loom_canvas"
const TREE_KEY = "loom_canvas_tree"
const VIM_KEY = "loom_vim"
const TOGGLED_KEY = "loom_sidebar_toggled"
const SIDEBAR_W_KEY = "loom_sidebar_width"

// The desktop sidebar's width, dragged at its right edge and kept in this
// browser; a double-click goes back to the default. Set as a CSS variable so a
// drag moves the edge without rendering the app again.
const setSidebarWidth = (px: number | null) =>
  px === null
    ? document.documentElement.style.removeProperty("--sidebar-w")
    : document.documentElement.style.setProperty("--sidebar-w", `${px}px`)
{
  const saved = Number(localStorage.getItem(SIDEBAR_W_KEY))
  if (saved > 0) setSidebarWidth(saved)
}

function SidebarResize() {
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const sidebar = e.currentTarget.previousElementSibling as HTMLElement | null
    if (!sidebar || e.button !== 0) return
    e.preventDefault()
    const left = sidebar.getBoundingClientRect().left
    const appStyle = getComputedStyle(sidebar.parentElement!)
    const available = sidebar.parentElement!.clientWidth
      - parseFloat(appStyle.paddingLeft) - parseFloat(appStyle.paddingRight)
    let width = 0
    const move = (ev: PointerEvent) => {
      width = Math.round(Math.min(Math.max(ev.clientX - left, 200), available - 400))
      setSidebarWidth(width)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      document.body.classList.remove("sidebar-resizing")
      if (width) localStorage.setItem(SIDEBAR_W_KEY, String(width))
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    document.body.classList.add("sidebar-resizing")
  }
  const reset = () => {
    localStorage.removeItem(SIDEBAR_W_KEY)
    setSidebarWidth(null)
  }
  return <div className="sidebar-resize" onPointerDown={drag} onDoubleClick={reset} />
}

// The right-hand side shows one thing at a time: the terminals or the canvas.
type Side = "terminal" | "canvas" | "browser" | null

function loadCanvases(): Record<string, CanvasItem> {
  try {
    return JSON.parse(localStorage.getItem(CANVAS_KEY) ?? "{}")
  } catch {
    return {}
  }
}

function takeSessionParam(): string | null {
  const url = new URL(window.location.href)
  const id = url.searchParams.get("session")
  if (id) {
    url.searchParams.delete("session")
    history.replaceState(null, "", url.pathname + url.search + url.hash)
  }
  return id
}

function App() {
  const [authed, setAuthed] = useState(!!getToken())
  // Pushed by the server as sessions change; see `useLobby`.
  const push = usePush(authed)
  const visible = useVisible()
  // Opened from a notification: `?session=` names the session to show, and
  // goes from the address bar once read.
  const [activeId, setActiveId] = useState<string | null>(takeSessionParam)
  const {
    sessions: everything,
    devices,
    upsertDevice,
    projects,
    upsertProject,
    employees,
    upsertEmployee,
    dropEmployee,
    notices,
    upsertNotice,
    todos,
    loaded,
    upsert,
    drop,
  } = useLobby(
    authed,
    push.endpoint ? { endpoint: push.endpoint, session: visible ? activeId : null } : null,
  )
  // The sleep sessions stay out of every list; the moons open them. See Sleep.tsx.
  // A virtual employee's two sessions likewise; its page opens them.
  // And the bell's chat, which lives in the bell; and a task's own session,
  // opened from the task (Tasks.tsx). What is left is the
  // user's, and the archived of those are in Settings instead.
  const ordinary = useMemo(
    () =>
      everything.filter(
        (s) =>
          !isDream(s) &&
          !isEmployeeSession(s) &&
          s.kind !== "bell" &&
          s.kind !== "task" &&
          s.kind !== "incognito",
      ),
    [everything],
  )
  // Incognito sessions are listed in Settings, newest first; a pinned one in
  // the sidebar's Pinned too, never in Recents.
  const incognito = useMemo(
    () => everything.filter((s) => s.kind === "incognito").sort((a, b) => lastActive(b) - lastActive(a)),
    [everything],
  )
  const sessions = useMemo(
    () => [...ordinary.filter((s) => !isArchived(s)), ...incognito.filter((s) => s.pinned)],
    [ordinary, incognito],
  )
  const archived = useMemo(
    () => ordinary.filter(isArchived).sort((a, b) => (b.archived_at ?? 0) - (a.archived_at ?? 0)),
    [ordinary],
  )
  // Newest first: each night sleeps in a session of its own, and the moon
  // opens the latest.
  const dreams = useMemo(
    () => everything.filter(isDream).sort((a, b) => b.created_at - a.created_at),
    [everything],
  )
  const narrow = useNarrow()
  // This device's appearance and default agent; see settings.ts.
  const [settings, changeSettings] = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)

  // The token outlives the app now (see `getToken`), so a stored one can be
  // dead. Checked once on open, and any 401 later lands here too.
  useEffect(() => {
    onUnauthorized(() => {
      dropSocket()
      setAuthed(false)
    })
    void checkAuth()
  }, [])

  // Remembered, because you collapse it once and want it to stay collapsed
  // across reloads. Desktop only: on a phone the sidebar is a drawer over the
  // chat, which starts closed and closes again once you pick something.
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) !== "0",
  )
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [side, setSide] = useState<Side>(null)
  const terminalOpen = side === "terminal"

  // The right-hand column across the whole window, chat and sidebar hidden —
  // for presenting a page from the canvas, or a terminal with room. Not on a
  // phone, where the column covers the chat already. Closing the column ends
  // it, so it never comes back on its own.
  const [full, setFull] = useState(false)
  const maximized = full && side !== null && !narrow
  useEffect(() => {
    if (side === null) setFull(false)
  }, [side])
  // Esc leaves it, except from a shell, where Esc is the editor's.
  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent) => {
      // Not from a shell, where Esc is the editor's, nor one something else
      // took already (a rename box putting the old name back).
      if (e.key !== "Escape" || e.defaultPrevented) return
      if ((e.target as Element | null)?.closest?.(".terminal-pane")) return
      setFull(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [maximized])
  const toggleFull = () => setFull((f) => !f)
  const setTerminalOpen = (open: boolean) => setSide(open ? "terminal" : null)

  // What each session's canvas shows. Per session and kept across switching
  // away (to the terminals, another session, a reload): coming back finds it
  // as it was. Replaced only when something new is opened in it.
  const [canvases, setCanvases] = useState(loadCanvases)
  useEffect(() => {
    localStorage.setItem(CANVAS_KEY, JSON.stringify(canvases))
  }, [canvases])

  // Opening is also reading again: a second click on a file rewritten since
  // the first shows what is there now.
  const openCanvas = (sessionId: string, item: CanvasItem) => {
    setCanvases((all) => ({ ...all, [sessionId]: { ...item, rev: Date.now() } }))
    setSide("canvas")
  }
  // A turn rewrote what the canvas shows: read it again, without opening the
  // canvas if it is closed.
  const refreshCanvas = (sessionId: string, outputs: string[]) =>
    setCanvases((all) => {
      const item = all[sessionId]
      return item && touches(item, outputs)
        ? { ...all, [sessionId]: { ...item, rev: Date.now() } }
        : all
    })
  // Something renamed or deleted in the file tree: the canvas follows it to its
  // new name, or lets go of it.
  const followCanvas = (sessionId: string, source: "output" | "files", from: string, to: string | null) =>
    setCanvases((all) => {
      const item = all[sessionId]
      const next = item && moved(item, source, from, to)
      if (next === undefined) return all
      const { [sessionId]: _gone, ...rest } = all
      return next === null ? rest : { ...all, [sessionId]: { ...next, rev: Date.now() } }
    })
  const toggleCanvas = () => setSide((s) => (s === "canvas" ? null : "canvas"))
  // The canvas's file tree, beside what it shows. Remembered like the sidebar.
  const [treeOpen, setTreeOpen] = useState(() => localStorage.getItem(TREE_KEY) !== "0")
  useEffect(() => {
    localStorage.setItem(TREE_KEY, treeOpen ? "1" : "0")
  }, [treeOpen])
  // Bumped when the active session's files may have changed, so the canvas's
  // file browser lists them again.
  const [filesRev, setFilesRev] = useState(0)
  // PTY session ids, top to bottom in the right-hand column.
  const [ptyIds, setPtyIds] = useState<string[]>([])
  const openingTerminal = useRef(false)

  // On a phone, swiping right over the chat pulls the drawer out and swiping
  // left over the drawer puts it back. Not over the terminals: a shell has its
  // own uses for a drag, and they are opened and closed by tapping.
  const chatRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  useSwipe(chatRef, "right", narrow && loaded && !drawerOpen && side === null, () =>
    setDrawerOpen(true),
  )
  useSwipe(drawerRef, "left", narrow && drawerOpen, () => setDrawerOpen(false))

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? "1" : "0")
  }, [sidebarOpen])

  // Open the first session once the list arrives, and move off a session that
  // disappears — deleted here or on another device.
  useEffect(() => {
    if (!loaded) return
    setActiveId((current) =>
      current && everything.some((s) => s.id === current)
        ? current
        : (sessions[0]?.id ?? null),
    )
  }, [loaded, everything, sessions])

  // What the sidebar has folded or unfolded against its defaults (see
  // `isOpen`). Remembered, like the sidebar.
  const [toggled, setToggled] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(TOGGLED_KEY) ?? "[]"))
    } catch {
      return new Set()
    }
  })
  useEffect(() => {
    localStorage.setItem(TOGGLED_KEY, JSON.stringify([...toggled]))
  }, [toggled])
  const toggle = (key: string) =>
    setToggled((t) => {
      const next = new Set(t)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  // On a phone, the sidebar opens on the conversations: each time the drawer
  // comes out, and each time the app comes back from the background (or is
  // opened), whatever was unfolded last time.
  useEffect(() => {
    if (narrow && (drawerOpen || visible)) setToggled(focused)
  }, [narrow, drawerOpen, visible])
  // A desktop the same way, once, when the page is (re)loaded.
  const narrowAtLoad = useRef(narrow)
  useEffect(() => {
    if (!narrowAtLoad.current) setToggled(focused)
  }, [])
  // A project something just happened in: Projects unfolded, to show its row.
  const reveal = () =>
    setToggled((t) => (isOpen(t, PROJECTS_SECTION) ? t : new Set(t).add(PROJECTS_SECTION)))
  // The project being made (`"new"`) or edited in its dialog.
  const [projectDialog, setProjectDialog] = useState<Project | "new" | null>(null)

  // The backend is chosen here and never again: the conversation lives in that
  // engine's own store, so there is nothing to migrate if it changes. The
  // project too: its workspace is the session's working directory for good.
  // "Continue in a new chat", from a row's menu or under an error: the new
  // session opens at once, on its handoff summary. See `Loom.Agent.Carry`.
  const carryOn = async (id: string, backend?: AgentBackend) => {
    const session = await continueAgent(id, backend)
    if (session.project_id) reveal()
    upsert(session)
    setActiveId(session.id)
    setView("chat")
    setDrawerOpen(false)
  }

  // Opens at once: the server makes it in the background while the user
  // types, and the first message waits for it. See `createAgentLater`.
  const create = async (backend: AgentBackend, projectId?: string, incognito?: boolean, model?: string | null) => {
    const { info: session, made } = createAgentLater(backend, projectId, incognito, model)
    made.then(upsert, () => {})
    if (projectId) reveal()
    upsert(session)
    setActiveId(session.id)
    setView("chat")
    setDrawerOpen(false)
    return session.id
  }

  // The main column shows the active session, or the Tasks page or a
  // project's page instead.
  const [view, setView] = useState<"chat" | "tasks" | "project">("chat")
  const [projectPage, setProjectPage] = useState<string | null>(null)
  // Kept across projects and visits: back from a chat, the tab it was on.
  const [projectTab, setProjectTab] = useState<ProjectTab>("files")
  // The session last opened from a project's page, which alone gets "‹" back
  // to it: one opened from Recents, search or elsewhere does not.
  const [fromProject, setFromProject] = useState<string | null>(null)
  const openProject = (id: string) => {
    reveal()
    setProjectPage(id)
    setView("project")
    setDrawerOpen(false)
  }

  // An employee's page shows one of its sessions, or a page of its own: which
  // one is the tab, null for whichever session is the active one.
  const [employeeTab, setEmployeeTab] = useState<EmployeeTab | null>(null)
  const [hiring, setHiring] = useState(false)
  // By id from the sidebar; the employee itself when it was only just hired.
  const openEmployee = (which: string | Employee, tab: EmployeeTab = "chat") => {
    const e = typeof which === "string" ? employees.find((x) => x.id === which) : which
    if (!e) return
    select(tab === "updates" ? e.work_session : e.chat_session)
    setEmployeeTab(tab === "chat" || tab === "updates" ? null : tab)
  }

  const select = (id: string) => {
    setFromProject(null)
    setFocusId(null)
    setEmployeeTab(null)
    setActiveId(id)
    setView("chat")
    setDrawerOpen(false)
  }

  // A setup chat (`Loom.Employees.setup_chat/1`): to hire in conversation, or
  // to change an employee, its permissions included. Into Recents, opened.
  const setupChat = async (employeeId?: string) => {
    try {
      select(await employeeSetup(employeeId))
    } catch (err) {
      alert((err as Error).message)
    }
  }

  // A moon: the scope's sleep session, made on first use, on its report.
  // Asked of the server each time: it moves a session a safety classifier
  // stopped to a fresh one. Offline, the one known.
  const [sleepTab, setSleepTab] = useState<SleepTab>("report")
  const openSleep = async (scope: string) => {
    let id = dreams.find((d) => scopeOf(d) === scope)?.id
    try {
      const made = await openDream(scope)
      upsert(made)
      id = made.id
    } catch (e) {
      if (!id) throw e
    }
    setSleepTab("report")
    select(id)
  }

  // The bell. Opening a notice goes to where it is answered: the turn it came
  // from, with the notice under it.
  const [bellOpen, setBellOpen] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const focusNotice = focusId ? notices.find((n) => n.id === focusId) : undefined
  const openNotice = (n: Notice) => {
    if (n.status === "open" && n.needs === "read") readNotice(n.id).then(upsertNotice, () => {})
    if (n.session) {
      select(n.session)
      setFocusId(n.id)
    }
    setBellOpen(false)
  }

  // A notification tapped while the app is already open: the worker names the
  // session rather than opening a second window.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "open-session" && typeof e.data.session === "string") {
        setEmployeeTab(null)
        setActiveId(e.data.session)
        setDrawerOpen(false)
      }
    }
    navigator.serviceWorker?.addEventListener("message", onMessage)
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage)
  }, [])

  // Asked first, always: the history does not come back. See `Confirm`.
  const [deleting, setDeleting] = useState<string | null>(null)
  const remove = (id: string) => setDeleting(id)
  // Keeping an incognito session cannot be undone, so it is asked first.
  const [keeping, setKeeping] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const renamed = async (id: string, title: string | null) => {
    setRenaming(null)
    if (title === null) return
    const before = everything.find((s) => s.id === id)
    if (before) upsert({ ...before, title })
    renameAgent(id, title).then(upsert, (e: Error) => {
      if (before) upsert(before)
      setOops(`Couldn't rename it — ${e.message}`)
    })
  }
  // One line at the foot of the window for a change the server refused after
  // the screen already showed it.
  const [oops, setOops] = useState<string | null>(null)
  useEffect(() => showChangesWith({ upsert, oops: setOops }), [upsert])
  useEffect(() => {
    if (!oops) return
    const t = setTimeout(() => setOops(null), 5000)
    return () => clearTimeout(t)
  }, [oops])

  // ── Terminals ────────────────────────────────────────────────────────────
  //
  // All of them live in the right-hand column, stacked. Hiding the column
  // leaves them running: the shells are server-side and a hidden pane just has
  // zero size, which the Terminal component already handles.

  // Line the column up with the shells the server is actually running: a shell
  // may have been opened on another device, or have exited while the column
  // was hidden. Shells already on screen keep their places; new ones go after
  // them, oldest first. Returns how many there are now.
  const syncTerminals = async (current: string[]) => {
    const live = await listSessions().catch(() => null)
    if (live === null) return current.length

    const alive = new Set(live.map((s) => s.id))
    const kept = current.filter((id) => alive.has(id))
    const added = [...live]
      .sort((a, b) => a.created_at - b.created_at)
      .map((s) => s.id)
      .filter((id) => !kept.includes(id))
    setPtyIds([...kept, ...added])
    return kept.length + added.length
  }

  // Up front, so the header's count is right before the column is ever opened.
  // The panes mount hidden and stay idle: a terminal only joins its channel
  // once it has a size.
  useEffect(() => {
    if (authed) void syncTerminals([])
  }, [authed])

  const toggleTerminal = async () => {
    if (terminalOpen) {
      setTerminalOpen(false)
      return
    }

    // Guarded against a double click: the second call would see no shells
    // yet and spawn one nobody asked for.
    if (openingTerminal.current) return
    openingTerminal.current = true

    try {
      // Only when nothing is running is a new one started.
      if ((await syncTerminals(ptyIds)) === 0) {
        setPtyIds([(await createSession("terminal")).id])
      }
    } finally {
      openingTerminal.current = false
    }

    setTerminalOpen(true)
  }

  const addTerminal = async () => {
    const session = await createSession("terminal")
    setPtyIds((ids) => [...ids, session.id])
  }

  const closeTerminal = async (id: string) => {
    const next = ptyIds.filter((p) => p !== id)
    setPtyIds(next)
    // Nothing left to show, so drop the column rather than leave a gap.
    if (next.length === 0) setTerminalOpen(false)
    await deleteSession(id).catch(() => {})
  }

  // ── Keys ─────────────────────────────────────────────────────────────────
  //
  // See keys.tsx and docs/keys.md. The session list has a cursor of its own
  // while it is being walked with j/k; Enter opens the session under it.
  //
  // The canvas's file tree is walked the same way, by `treeNav`, which the
  // tree fills in.
  // Off until turned on: not everyone wants single keys to do things.
  const [vim, setVim] = useState(() => localStorage.getItem(VIM_KEY) === "1")
  useEffect(() => {
    localStorage.setItem(VIM_KEY, vim ? "1" : "0")
  }, [vim])
  const [listCursor, setListCursor] = useState<string | null>(null)
  const [treeWalk, setTreeWalk] = useState(false)
  const treeNav = useRef<TreeNav | null>(null)
  const [help, setHelp] = useState(false)
  const walking = listCursor !== null || treeWalk
  useEffect(() => {
    if (!walking) return
    // A dialog the walk opened (deleting, asks first) is still part of it.
    const away = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(".modal")) return
      setListCursor(null)
      setTreeWalk(false)
    }
    window.addEventListener("mousedown", away)
    return () => window.removeEventListener("mousedown", away)
  }, [walking])
  // Nothing to walk once the tree is out of sight.
  useEffect(() => {
    if (side !== "canvas" || !treeOpen) setTreeWalk(false)
  }, [side, treeOpen])

  const timeline = () => document.querySelector<HTMLElement>(".timeline")
  const scroll = (by: (el: HTMLElement) => number, smooth = false) => {
    const el = timeline()
    el?.scrollBy({ top: by(el), behavior: smooth ? "smooth" : "instant" })
  }
  const step = (ids: string[], from: string | null, by: number) => {
    if (ids.length === 0) return null
    const at = from === null ? -1 : ids.indexOf(from)
    return ids[at === -1 ? 0 : Math.min(ids.length - 1, Math.max(0, at + by))]
  }
  const ids = sidebarOrder(sessions, projects, toggled).map((s) => s.id)

  // Into the columns either side of the chat, opening them as needed: `h` and
  // `␣b` to the session list, `l` and `␣e` to the file tree.
  const toList = () => {
    setTreeWalk(false)
    setFull(false)
    setSidebarOpen(true)
    setListCursor(activeId ?? ids[0] ?? null)
  }
  const toTree = () => {
    setListCursor(null)
    setSide("canvas")
    setTreeOpen(true)
    setTreeWalk(true)
  }

  const leader: Keymap = {
    "Space e": {
      desc: "file tree (j/k, h/l, Enter)",
      run: () => {
        if (!treeWalk) return toTree()
        setTreeWalk(false)
        setTreeOpen(false)
      },
    },
    "Space b": {
      desc: "session list (j/k, Enter)",
      run: () => {
        if (listCursor === null) return toList()
        setListCursor(null)
        setSidebarOpen(false)
      },
    },
    "Space t": { desc: "terminal", run: () => void toggleTerminal() },
    "Space c": { desc: "canvas", run: toggleCanvas },
    "Space f": { desc: "full window", run: () => side !== null && toggleFull() },
    "Space n c": { desc: "new Claude Code session", run: () => void create("claude_code") },
    "Space n x": { desc: "new Codex session", run: () => void create("codex") },
    "Space n k": { desc: "new Kiro session", run: () => void create("kiro") },
  }
  const keymap: Keymap = treeWalk
    ? {
        j: { desc: "next file", run: () => treeNav.current?.move(1) },
        k: { desc: "previous file", run: () => treeNav.current?.move(-1) },
        h: {
          desc: "fold, up to the folder, or back to the chat",
          run: () => treeNav.current?.left() || setTreeWalk(false),
        },
        l: { desc: "unfold, or open", run: () => treeNav.current?.right() },
        Enter: { desc: "open the file, or fold the folder", run: () => treeNav.current?.enter() },
        Esc: { desc: "leave the tree", run: () => setTreeWalk(false) },
        d: { desc: "delete it (asks)", run: () => treeNav.current?.remove() },
        r: { desc: "rename it", run: () => treeNav.current?.rename() },
        ...leader,
      }
    : listCursor !== null
      ? {
          j: { desc: "next session", run: () => setListCursor((c) => step(ids, c, 1)) },
          k: { desc: "previous session", run: () => setListCursor((c) => step(ids, c, -1)) },
          Enter: {
            desc: "open it",
            run: () => {
              select(listCursor)
              setListCursor(null)
            },
          },
          Esc: { desc: "leave the list", run: () => setListCursor(null) },
          d: { desc: "delete the session (asks)", run: () => setDeleting(listCursor) },
          r: { desc: "rename the session", run: () => setRenaming(listCursor) },
          l: { desc: "back to the chat", run: () => setListCursor(null) },
          ...leader,
        }
      : {
          i: {
            desc: "type a message",
            run: () => document.querySelector<HTMLElement>(".composer-input")?.focus(),
          },
          j: { desc: "scroll down", run: () => scroll(() => 60) },
          k: { desc: "scroll up", run: () => scroll(() => -60) },
          "C-d": { desc: "half a page down", run: () => scroll((el) => el.clientHeight / 2, true) },
          "C-u": { desc: "half a page up", run: () => scroll((el) => -el.clientHeight / 2, true) },
          "g g": { desc: "top", run: () => timeline()?.scrollTo({ top: 0 }) },
          G: { desc: "bottom", run: () => scroll((el) => el.scrollHeight) },
          h: { desc: "to the session list", run: toList },
          l: { desc: "to the file tree", run: toTree },
          J: { desc: "next session", run: () => activeId && select(step(ids, activeId, 1)!) },
          K: { desc: "previous session", run: () => activeId && select(step(ids, activeId, -1)!) },
          ...leader,
          "?": { desc: "all keys", run: () => setHelp(true) },
        }
  const keysOn = vim && authed && loaded && !narrow
  const pending = useKeys(keysOn, keymap)
  useGlobalKey(keysOn, (e) => e.ctrlKey && e.code === "Backquote", () => void toggleTerminal())

  // The phone's switcher (Switcher.tsx).
  const [switching, setSwitching] = useState(false)

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  if (!loaded) return <div className="loading">connecting…</div>

  const active = everything.find((s) => s.id === activeId) ?? null
  const shownProject = projects.find((p) => p.id === projectPage) ?? null
  const activeProject = active?.project_id ? projects.find((p) => p.id === active.project_id) : undefined
  // The newest: it starts afresh each day.
  const bellChat = everything.filter((s) => s.kind === "bell").sort((a, b) => b.created_at - a.created_at)[0]
  // By its sessions rather than `employee_id`: a summary from an older
  // server, or an older route, may not carry it.
  const activeEmployee =
    (active && employees.find((e) => e.chat_session === active.id || e.work_session === active.id)) ?? null

  // Out of Working, from the sidebar or the switcher. Writing in it again
  // brings it back.
  // A tap shows at once: the row moves, the pin shows, before the server has
  // answered. Its answer replaces the guess; a refusal puts the row back and
  // says why. Returns at once, so a menu closes on the tap.
  const change = async (id: string, attrs: Parameters<typeof updateAgent>[1]) => {
    const before = everything.find((s) => s.id === id)
    if (before) changeAgent(before, attrs)
  }
  const markDone = (id: string) => change(id, { done: true })
  const working = sidebarGroups(sessions, projects).working

  const sidebar = (
    <Sidebar
      sessions={sessions}
      projects={projects}
      toggled={toggled}
      onToggle={toggle}
      onEditProject={(project) => setProjectDialog(project ?? "new")}
      onOpenProject={openProject}
      openProjectId={view === "project" ? projectPage : null}
      tasksOpen={view === "tasks"}
      onOpenTasks={() => {
        setView("tasks")
        setDrawerOpen(false)
      }}
      devices={devices}
      onUpsertDevice={upsertDevice}
      push={push}
      vim={narrow ? null : { on: vim, toggle: () => setVim((v) => !v) }}
      activeId={activeId}
      cursorId={listCursor}
      renamingId={renaming}
      onRenamed={renamed}
      onSelect={select}
      onCreate={create}
      onDelete={remove}
      onRename={setRenaming}
      onPin={(id, pinned) => change(id, { pinned })}
      onContinue={carryOn}
      onArchive={(id, archived) => change(id, { archived })}
      onDone={markDone}
      onMove={async (id, projectId) => {
        void change(id, { project_id: projectId })
        if (projectId) reveal()
      }}
      onCollapse={() => (narrow ? setDrawerOpen(false) : setSidebarOpen(false))}
      defaultBackend={settings.backend}
      onOpenSettings={() => {
        setSettingsOpen(true)
        setDrawerOpen(false)
      }}
      browserOpen={side === "browser"}
      onToggleBrowser={() => {
        if (narrow) setDrawerOpen(false)
        setSide((s) => (s === "browser" ? null : "browser"))
      }}
      dreams={dreams}
      onOpenDream={(scope) => void openSleep(scope)}
      employees={employees}
      notices={notices}
      onOpenBell={() => {
        setBellOpen(true)
        setDrawerOpen(false)
      }}
      activeEmployeeId={view === "chat" ? (activeEmployee?.id ?? null) : null}
      onOpenEmployee={(id) => openEmployee(id)}
      onHire={() => {
        setHiring(true)
        setDrawerOpen(false)
      }}
    />
  )


  const chatProps = active && {
    sidebarOpen: !narrow && sidebarOpen,
    onToggleSidebar: () => (narrow ? setDrawerOpen(true) : setSidebarOpen((open) => !open)),
    terminalOpen,
    terminalCount: ptyIds.length,
    onToggleTerminal: toggleTerminal,
    canvasOpen: side === "canvas",
    onToggleCanvas: toggleCanvas,
    onOpenCanvas: (item: CanvasItem) => openCanvas(active.id, item),
    onFilesChanged: (outputs: string[]) => {
      setFilesRev((n) => n + 1)
      refreshCanvas(active.id, outputs)
    },
    focus: focusNotice ? { notice: focusNotice, onAnswered: upsertNotice } : null,
    onContinue:
      active.kind == null && !active.employee_id
        ? (backend?: AgentBackend) => carryOn(active.id, backend)
        : undefined,
    onSwitch: narrow && working.length > 0 ? () => setSwitching(true) : undefined,
  }

  return (
    <div className={"app" + (side !== null ? " side-open" : "") + (maximized ? " maximized" : "")}>
      {narrow ? (
        // Always mounted so it can slide rather than pop. Over the chat, not
        // beside it: a phone has no width to give a second column.
        <div
          ref={drawerRef}
          className={"drawer" + (drawerOpen ? " open" : "")}
          inert={!drawerOpen}
        >
          <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />
          {sidebar}
        </div>
      ) : (
        sidebarOpen &&
        !maximized && (
          <>
            {sidebar}
            <SidebarResize />
          </>
        )
      )}

      <main className="main">
        <div className="main-chat" ref={chatRef}>
          {view === "project" && shownProject ? (
            <ProjectPage
              key={shownProject.id}
              project={shownProject}
              projects={projects}
              sessions={sidebarGroups(sessions, projects).groups.find((g) => g.project.id === shownProject.id)?.sessions ?? []}
              dream={dreams.find((d) => scopeOf(d) === shownProject.id)}
              activeId={activeId}
              tab={projectTab}
              onTab={setProjectTab}
              showSidebarButton={narrow || !sidebarOpen}
              onToggleSidebar={() => (narrow ? setDrawerOpen(true) : setSidebarOpen(true))}
              onOpenSession={(id) => {
                select(id)
                setFromProject(id)
              }}
              onCreate={async (backend) => setFromProject(await create(backend, shownProject.id))}
              onEdit={() => setProjectDialog(shownProject)}
              onOpenDream={() => void openSleep(shownProject.id)}
              renamingId={renaming}
              onRenamed={renamed}
              onRename={setRenaming}
              onPin={(id, pinned) => change(id, { pinned })}
              onContinue={carryOn}
              onMove={(id, projectId) => change(id, { project_id: projectId })}
              onArchive={(id, archived) => change(id, { archived })}
              onDelete={remove}
            />
          ) : view === "tasks" ? (
            <Tasks
              showSidebarButton={narrow || !sidebarOpen}
              onToggleSidebar={() => (narrow ? setDrawerOpen(true) : setSidebarOpen(true))}
              onOpenSession={select}
            />
          ) : active && chatProps && activeEmployee ? (
            <EmployeePage
              key={activeEmployee.id}
              employee={activeEmployee}
              chatSession={everything.find((s) => s.id === activeEmployee.chat_session)}
              workSession={everything.find((s) => s.id === activeEmployee.work_session)}
              tab={employeeTab ?? (active.kind === "employee_work" ? "updates" : "chat")}
              onTab={(tab) => openEmployee(activeEmployee.id, tab)}
              onSeen={async (seq) => upsert(await updateAgent(activeEmployee.work_session, { seen_seq: seq }))}
              onUpsert={upsertEmployee}
              onDeleted={() => {
                dropEmployee(activeEmployee.id)
                select(sessions[0]?.id ?? "")
              }}
              projects={projects}
              devices={devices}
              chat={chatProps}
              onSetupChat={(id) => void setupChat(id)}
            />
          ) : active && chatProps && isDream(active) ? (
            <Sleep
              key={active.id}
              session={active}
              scopeName={projects.find((p) => p.id === scopeOf(active))?.name ?? "outside projects"}
              tab={sleepTab}
              onTab={setSleepTab}
              onSeen={async (seq) => upsert(await updateAgent(active.id, { seen_seq: seq }))}
              chat={chatProps}
            />
          ) : active && chatProps ? (
            // Keyed by id so switching sessions rebuilds the channel and the
            // transcript rather than mixing two conversations.
            <Chat
              key={active.id}
              session={active}
              {...chatProps}
              onSeen={(seq) => updateAgent(active.id, { seen_seq: seq }).then(upsert, () => {})}
              incognito={
                active.kind === "incognito"
                  ? {
                      pinned: active.pinned ?? false,
                      onPin: (pinned) => change(active.id, { pinned }),
                      onKeep: () => setKeeping(active.id),
                    }
                  : undefined
              }
              project={
                activeProject && fromProject === active.id
                  ? { name: activeProject.name, onOpen: () => openProject(activeProject.id) }
                  : undefined
              }
              reading={!narrow || (!drawerOpen && side === null)}
            />
          ) : (
            <div className="placeholder">
              <p>No session selected.</p>
              <div className="backend-choice">
                <button
                  className="text-btn"
                  onClick={() => create("claude_code")}
                >
                  new Claude Code session
                </button>
                <button
                  className="text-btn"
                  onClick={() => create("codex")}
                >
                  new Codex session
                </button>
                <button className="text-btn" onClick={() => create("kiro")}>
                  new Kiro session
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Kept mounted, so a page keeps its state (a video its position)
            while the terminals are shown instead. */}
        <div className="side-column" style={{ display: side === "canvas" ? "flex" : "none" }}>
          <Canvas
            sessionId={active?.id ?? null}
            item={active ? (canvases[active.id] ?? null) : null}
            filesRev={filesRev}
            onOpen={(item) => active && openCanvas(active.id, item)}
            narrow={narrow}
            onBack={() => setSide(null)}
            maximized={maximized}
            onToggleMaximized={toggleFull}
            treeOpen={treeOpen}
            onTreeOpen={setTreeOpen}
            walking={treeWalk}
            nav={treeNav}
            onMoved={(source, from, to) => active && followCanvas(active.id, source, from, to)}
          />
        </div>

        {side === "browser" && (
          <div className="side-column">
            <Suspense fallback={null}>
              <Browser
                narrow={narrow}
                maximized={maximized}
                onToggleMaximized={toggleFull}
                onClose={() => setSide(null)}
              />
            </Suspense>
          </div>
        )}

        {/* Kept mounted once opened: unmounting would drop the channel and
            xterm's scrollback, and the shell itself keeps running server-side
            either way. */}
        {ptyIds.length > 0 && (
          <div
            className="side-column terminal-column"
            style={{ display: terminalOpen ? "flex" : "none" }}
          >
            {ptyIds.map((id, index) => (
              <div className="terminal-pane" key={id}>
                <div className="pane-head">
                  <span className="pane-title">
                    {/* On a phone the terminals cover the chat, and the
                        header's toggle with it. */}
                    {narrow && index === 0 && (
                      <button
                        className="pane-btn"
                        onClick={() => setTerminalOpen(false)}
                        title="Back to the chat"
                      >
                        <ChevronLeft />
                      </button>
                    )}
                    terminal {index + 1}
                  </span>
                  <span className="pane-actions">
                    {/* On every pane rather than once, so they do not move
                        around as terminals are closed. */}
                    {!narrow && (
                      <button
                        className="pane-btn"
                        onClick={toggleFull}
                        title={maximized ? "Back beside the chat (Esc outside a shell)" : "Full window"}
                      >
                        {maximized ? <Minimize /> : <Maximize />}
                      </button>
                    )}
                    <button
                      className="pane-btn"
                      onClick={addTerminal}
                      title="New terminal"
                    >
                      <Plus />
                    </button>
                    <button
                      className="pane-btn"
                      onClick={() => closeTerminal(id)}
                      title="Close this terminal"
                    >
                      <X />
                    </button>
                  </span>
                </div>
                <div className="pane-body">
                  <Terminal sessionId={id} active={terminalOpen} />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {deleting && (
        <Confirm
          title={`Delete ${everything.find((s) => s.id === deleting)?.title ?? deleting}?`}
          detail="The session and its whole history, with what it made. This cannot be undone."
          onYes={async () => {
            const id = deleting
            // The cursor moves on to a neighbour rather than off the list.
            if (listCursor === id) setListCursor(step(ids, id, 1) === id ? step(ids, id, -1) : step(ids, id, 1))
            // Gone from the list on the tap; back, with why, if the server says no.
            const before = everything.find((s) => s.id === id)
            drop(id)
            deleteAgent(id).catch((e: Error) => {
              if (before) upsert(before)
              setOops(`Couldn't delete it — ${e.message}`)
            })
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {keeping && (
        <Confirm
          title={`Keep ${everything.find((s) => s.id === keeping)?.title ?? "this chat"}?`}
          detail="It joins Recents as an ordinary chat and leaves its sandbox: from the next message it can write files and memory like any other. It cannot be made incognito again."
          action="Keep"
          danger={false}
          onYes={async () => upsert(await updateAgent(keeping, { incognito: false }))}
          onClose={() => setKeeping(null)}
        />
      )}
      {projectDialog && (
        <ProjectDialog
          project={projectDialog === "new" ? null : projectDialog}
          sessionCount={
            projectDialog === "new" ? 0 : sessions.filter((s) => s.project_id === projectDialog.id).length
          }
          onSaved={(project) => {
            upsertProject(project)
            if (projectDialog === "new") openProject(project.id)
          }}
          onClose={() => setProjectDialog(null)}
        />
      )}
      {hiring && (
        <HireDialog
          projects={projects}
          onHired={(e) => {
            upsertEmployee(e)
            openEmployee(e)
          }}
          onChat={() => void setupChat()}
          onClose={() => setHiring(false)}
        />
      )}
      {bellOpen && (
        <NoticesSheet
          notices={notices}
          todos={todos}
          chat={
            bellChat && (
              <Chat
                key={bellChat.id}
                session={bellChat}
                bare
                sidebarOpen
                onToggleSidebar={() => {}}
                terminalOpen={false}
                terminalCount={0}
                onToggleTerminal={() => {}}
                canvasOpen={false}
                onToggleCanvas={() => {}}
                onOpenCanvas={() => {}}
                onFilesChanged={() => {}}
              />
            )
          }
          onWantChat={() => void bellSession().catch(() => {})}
          onOpen={openNotice}
          onAnswered={upsertNotice}
          onClose={() => setBellOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={changeSettings}
          onClose={() => setSettingsOpen(false)}
          archived={archived}
          projects={projects}
          onOpen={(id) => {
            setSettingsOpen(false)
            select(id)
          }}
          onUnarchive={(id) => change(id, { archived: false })}
          incognito={incognito}
          onKeep={setKeeping}
          onDelete={remove}
        />
      )}
      {oops && (
        <div className="app-oops" role="alert" onClick={() => setOops(null)}>
          {oops}
        </div>
      )}
      <WhichKey pending={pending} keymap={keymap} groups={{ "Space n": "new session" }} />
      {help && (
        <KeyHelp
          keymap={keymap}
          extra={[["C-`", "terminal, from anywhere — a shell too"]]}
          onClose={() => setHelp(false)}
        />
      )}
      {switching && (
        <Switcher
          sessions={working}
          activeId={activeId}
          onSelect={(id) => {
            setSwitching(false)
            select(id)
          }}
          onDone={(id) => void markDone(id)}
          onClose={() => setSwitching(false)}
        />
      )}
    </div>
  )
}

export default App

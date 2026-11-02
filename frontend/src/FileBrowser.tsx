import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react"
import {
  deleteAgentOutputOrAttachment,
  downloadAgentOutput,
  downloadAgentZip,
  downloadAttachment,
  downloadWorkspaceFile,
  renameAgentOutputOrAttachment,
  sessionTree,
  type SessionTree,
  type TreeFile,
} from "./api"
import { Confirm, RenameInput } from "./Confirm"
import { itemForAttachment, itemForPath, viewerFor, type CanvasItem, type Viewer } from "./canvasItems"
import { formatBytes } from "./format"

// The project's workspace is listed too, but only to find and download a
// file: it is the agents' working directory, not this session's to rename or
// delete in, and it has no canvas route.
type Editable = "output" | "files"
type Section = Editable | "workspace"

/** The tree walked from the keyboard; see the keys in App.tsx. */
export type TreeNav = {
  move: (by: number) => void
  // Enter: a directory folds or unfolds, a file opens. The walk goes on
  // either way: the canvas takes no keys, so there is nowhere else to be.
  enter: () => void
  // h: fold, or up to the parent; false when neither, at the left edge.
  // l: unfold, or into it; a file opens.
  left: () => boolean
  right: () => void
  // d and r, on the row under the cursor.
  remove: () => void
  rename: () => void
}

export type Node = {
  name: string
  path: string
  size: number
  // The newest file at or under it, which is what a directory sorts by.
  mtime: number
  // Directories only.
  children?: Node[]
}

/**
 * Everything one session holds, as two trees: what the agent made (`output/`)
 * and what the user attached (`files/`) — three in a project, whose shared
 * workspace is listed between them. The cards in the chat only announce
 * what each turn changed; this is where last week's report is found again.
 *
 * Newest first at every level, like the chat itself. The row of what the
 * canvas is showing is marked; sizes and dates are in each row's tooltip, as
 * the tree is a narrow column. Clicking a file opens it
 * in the canvas when there is a viewer for it and downloads it otherwise; a
 * directory folds open, and offers its page (if it has an `index.html`) and a
 * zip of itself.
 *
 * Listed when shown and again whenever `rev` moves — the session bumps it when
 * a turn leaves outputs or a message brings attachments — rather than polled.
 *
 * While `walking`, a cursor moves over the rows that are showing, by `nav`,
 * which can also delete (after asking) or rename the row it is on. Either one
 * is reported by `onMoved`, so the canvas can follow what it shows.
 */
export function FileBrowser({
  sessionId,
  rev,
  current,
  onOpen,
  walking,
  nav,
  onMoved,
}: {
  sessionId: string
  rev: number
  // What the canvas shows, as `source:path`, so its row can be marked.
  current: string | null
  onOpen: (item: CanvasItem) => void
  walking: boolean
  nav: RefObject<TreeNav | null>
  onMoved: (source: Editable, from: string, to: string | null) => void
}) {
  const [tree, setTree] = useState<SessionTree | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Unfolded directories, as `section:path`.
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set())
  // Listed again after a rename or a delete here, which no turn reports.
  const [changes, setChanges] = useState(0)
  // The row whose name is being edited, and the one waiting for a yes.
  const [renaming, setRenaming] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ key: string; section: Section; node: Node } | null>(
    null,
  )
  // A rename (the new name) or a delete (null) shown on the tap, as
  // `section:path`, until the next listing has it or the server refuses.
  const [pending, setPending] = useState<Map<string, string | null>>(() => new Map())
  const expect = (key: string, name: string | null | undefined) =>
    setPending((m) => {
      const next = new Map(m)
      if (name === undefined) next.delete(key)
      else next.set(key, name)
      return next
    })

  useEffect(() => {
    let live = true
    sessionTree(sessionId).then(
      (t) => {
        if (!live) return
        setTree(t)
        setPending(new Map())
        setError(null)
      },
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [sessionId, rev, changes])

  const output = useMemo(() => (tree ? build(tree.output) : []), [tree])
  const files = useMemo(() => (tree ? build(tree.files) : []), [tree])
  const workspace = useMemo(() => (tree?.workspace ? build(tree.workspace) : null), [tree])

  const fail = (e: Error) => setError(e.message)

  const fold = (key: string, open: boolean) =>
    setUnfolded((s) => {
      const next = new Set(s)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })

  const open = (section: Section, node: Node) => {
    if (node.children) {
      const key = `${section}:${node.path}`
      fold(key, !unfolded.has(key))
      return
    }
    if (section === "workspace") return download(section, node)
    const item =
      section === "output"
        ? itemForPath(node.path)
        : itemForAttachment({ name: node.name, path: node.path, size: node.size, content_type: "" })
    if (item) onOpen(item)
    else download(section, node)
  }

  const download = (section: Section, node: Node) => {
    // A workspace folder has no zip: only files come down from there.
    if (section === "workspace" && node.children) return
    const done =
      section === "workspace"
        ? downloadWorkspaceFile(sessionId, node.path)
        : section === "files"
          ? downloadAttachment(sessionId, node.path)
          : node.children
            ? downloadAgentZip(sessionId, node.path)
            : downloadAgentOutput(sessionId, node.path)
    done.catch(fail)
  }

  // The rows showing, top to bottom, for the cursor to move over.
  type Row = { key: string; section: Section; node: Node; parent: string | null }
  const showing: Row[] = []
  const walk = (section: Section, nodes: Node[], parent: string | null) => {
    for (const node of nodes) {
      const key = `${section}:${node.path}`
      showing.push({ key, section, node, parent })
      if (node.children && unfolded.has(key)) walk(section, node.children, key)
    }
  }
  walk("output", output, null)
  if (workspace) walk("workspace", workspace, null)
  walk("files", files, null)

  // Starts on what the canvas shows, or at the top.
  const [cursor, setCursor] = useState<string | null>(null)
  const any = showing.length > 0
  useEffect(() => {
    if (!walking || !any) return
    setCursor((c) =>
      c !== null && showing.some((r) => r.key === c)
        ? c
        : (showing.find((r) => r.key === current)?.key ?? showing[0].key),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking, any])

  const at = showing.findIndex((r) => r.key === cursor)
  const here = at === -1 ? undefined : showing[at]
  nav.current = {
    move: (by) => {
      if (!any) return
      setCursor(showing[Math.min(showing.length - 1, Math.max(0, at + by))].key)
    },
    enter: () => {
      if (here) open(here.section, here.node)
    },
    left: () => {
      if (here?.node.children && unfolded.has(here.key)) fold(here.key, false)
      else if (here?.parent) setCursor(here.parent)
      else return false
      return true
    },
    right: () => {
      if (!here) return
      if (!here.node.children) open(here.section, here.node)
      else if (!unfolded.has(here.key)) fold(here.key, true)
      else if (showing[at + 1]?.parent === here.key) setCursor(showing[at + 1].key)
    },
    remove: () => {
      if (here && here.section !== "workspace") setAsking(here)
    },
    rename: () => {
      if (here && here.section !== "workspace") setRenaming(here.key)
    },
  }

  const remove = async (section: Editable, node: Node) => {
    const key = `${section}:${node.path}`
    expect(key, null)
    try {
      await deleteAgentOutputOrAttachment(sessionId, section, node.path)
    } catch (e) {
      expect(key, undefined)
      return fail(e as Error)
    }
    // The cursor goes to the next row that is not inside what went, else the
    // one before.
    const i = showing.findIndex((r) => r.key === key)
    const next =
      showing.slice(i + 1).find((r) => !r.key.startsWith(key + "/")) ?? showing[i - 1]
    if (cursor === key) setCursor(next?.key ?? null)
    onMoved(section, node.path, null)
    setChanges((n) => n + 1)
  }

  const rename = async (section: Editable, node: Node, name: string | null) => {
    setRenaming(null)
    if (name === null || name === node.name) return
    const from = `${section}:${node.path}`
    expect(from, name)
    let path: string
    try {
      ;({ path } = await renameAgentOutputOrAttachment(sessionId, section, node.path, name))
    } catch (e) {
      expect(from, undefined)
      return fail(e as Error)
    }
    const to = `${section}:${path}`
    const move = (k: string) => (k === from || k.startsWith(from + "/") ? to + k.slice(from.length) : k)
    setUnfolded((s) => new Set([...s].map(move)))
    setCursor((c) => (c === null ? c : move(c)))
    onMoved(section, node.path, path)
    setChanges((n) => n + 1)
  }

  const rows = (section: Section, nodes: Node[], depth: number): ReactNode[] =>
    nodes.flatMap((node) => {
      const later = pending.get(`${section}:${node.path}`)
      if (later === null) return []
      const name = later ?? node.name
      const isDir = !!node.children
      const unfoldedHere = isDir && unfolded.has(`${section}:${node.path}`)
      const page = isDir && node.children!.some((c) => c.name === "index.html" && !c.children)
      const Icon = isDir ? (unfoldedHere ? FolderOpen : Folder) : iconFor(node.name)
      // The row of what is shown, or the folded directory hiding it.
      const shown =
        current === `${section}:${node.path}` ||
        (isDir && !unfoldedHere && !!current?.startsWith(`${section}:${node.path}/`))
      const key = `${section}:${node.path}`
      const onCursor = walking && key === cursor
      const row = (
        <div
          key={key}
          ref={onCursor ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
          className={"tree-row" + (shown ? " current" : "") + (onCursor ? " cursor" : "")}
          style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
          onClick={() => open(section, node)}
          title={`${node.path}\n${formatBytes(node.size)} · ${formatTime(node.mtime)}`}
        >
          <span className="tree-fold">
            {isDir && (unfoldedHere ? <ChevronDown /> : <ChevronRight />)}
          </span>
          <Icon className="tree-icon" />
          {renaming === key ? (
            <RenameInput value={node.name} onDone={(name) => rename(section as Editable, node, name)} />
          ) : (
            <span className="tree-name">{name}</span>
          )}
          <span className="tree-actions">
            {page && (
              <button
                className="pane-btn"
                title={`Show ${node.path} in the canvas`}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen({
                    path: `${node.path}/index.html`,
                    title: node.path,
                    download: { kind: "dir", path: node.path },
                  })
                }}
              >
                <AppWindow />
              </button>
            )}
            {!(section === "workspace" && isDir) && (
              <button
                className="pane-btn download"
                title={isDir ? `Download ${node.path} as a zip` : `Download ${node.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  download(section, node)
                }}
              >
                <Download />
              </button>
            )}
          </span>
        </div>
      )
      return unfoldedHere ? [row, ...rows(section, node.children!, depth + 1)] : [row]
    })

  return (
    <div className="file-browser">
      {asking && (
        <Confirm
          title={`Delete ${asking.node.name}?`}
          detail={
            asking.node.children
              ? `The folder ${asking.node.path} and everything in it. This cannot be undone.`
              : `${asking.node.path} — this cannot be undone.`
          }
          onYes={() => void remove(asking.section as Editable, asking.node)}
          onClose={() => setAsking(null)}
        />
      )}
      {error && <div className="canvas-note failed">{error}</div>}
      {!tree && !error && <div className="canvas-note">loading…</div>}
      {tree && (
        <>
          <div className="tree-section">Output</div>
          {output.length ? (
            rows("output", output, 0)
          ) : (
            <div className="tree-empty">Nothing made in this session yet.</div>
          )}
          {workspace && (
            <>
              <div className="tree-section" title="The project's working directory, shared by its sessions">
                Workspace
              </div>
              {workspace.length ? (
                rows("workspace", workspace, 0)
              ) : (
                <div className="tree-empty">The project's workspace is empty.</div>
              )}
              {tree.workspace_truncated && (
                <div className="tree-empty">Only the first {tree.workspace!.length} files are listed.</div>
              )}
            </>
          )}
          <div className="tree-section">Uploads</div>
          {files.length ? (
            rows("files", files, 0)
          ) : (
            <div className="tree-empty">Nothing attached in this session yet.</div>
          )}
        </>
      )}
    </div>
  )
}

/** Flat paths into a tree, each level newest first. */
export function build(list: TreeFile[]): Node[] {
  const root: Node = { name: "", path: "", size: 0, mtime: 0, children: [] }
  for (const file of list) {
    const parts = file.path.split("/")
    let dir = root
    parts.forEach((name, i) => {
      dir.size += file.size
      dir.mtime = Math.max(dir.mtime, file.mtime)
      const path = parts.slice(0, i + 1).join("/")
      if (i === parts.length - 1) {
        dir.children!.push({ name, path, size: file.size, mtime: file.mtime })
        return
      }
      let next = dir.children!.find((c) => c.children && c.name === name)
      if (!next) {
        next = { name, path, size: 0, mtime: 0, children: [] }
        dir.children!.push(next)
      }
      dir = next
    })
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
    for (const n of nodes) if (n.children) sort(n.children)
  }
  sort(root.children!)
  return root.children!
}

const ICONS: Record<Viewer, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileMusic,
  markdown: FileText,
  table: FileSpreadsheet,
  text: FileCode,
  frame: AppWindow,
}

export function iconFor(name: string): LucideIcon {
  if (/\.(xlsx?|numbers)$/i.test(name)) return FileSpreadsheet
  if (/\.(docx?|pdf|pptx?|key)$/i.test(name)) return FileText
  const viewer = viewerFor(name)
  return viewer ? ICONS[viewer] : FileIcon
}

// Time of day for today, the date otherwise, with the year only when it is not this one.
export function formatTime(seconds: number): string {
  const d = new Date(seconds * 1000)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  })
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Token lives in localStorage, so it survives the app being closed. On iOS the
// only way to reload a home-screen web app is to kill it, and sessionStorage
// made every reload a password prompt. The server's 30-day max_age is what
// eventually logs a device out.
const TOKEN_KEY = "loom_token"

// Who to tell when the server stops accepting the token. Set once by `App`.
let unauthorizedListener: (() => void) | null = null

export function onUnauthorized(listener: () => void) {
  unauthorizedListener = listener
}

// A 401 means the token is dead — expired after its 30 days, or signed with a
// secret that has since changed. Kept, it would be sent forever, so it goes and
// the app falls back to the login screen.
function unauthorized(): UnauthorizedError {
  clearToken()
  unauthorizedListener?.()
  return new UnauthorizedError()
}

/**
 * Ask the server whether the token is still good, logging out if not.
 *
 * Needed because most of the app talks over the socket, and a socket refused
 * at connect only reports "error" — the same as being offline. One HTTP request
 * tells the two apart.
 */
export async function checkAuth(): Promise<void> {
  if (!getToken()) return
  const res = await fetch("/api/layout", { headers: authHeaders() }).catch(() => null)
  if (res?.status === 401) unauthorized()
}

export function getToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) return token

  // A login from before the move. Carried over once rather than asking again.
  const old = sessionStorage.getItem(TOKEN_KEY)
  if (old) {
    localStorage.setItem(TOKEN_KEY, old)
    sessionStorage.removeItem(TOKEN_KEY)
  }
  return old
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

export async function login(password: string): Promise<string> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  })
  if (res.status === 401) throw new Error("invalid_password")
  if (!res.ok) throw new Error(`login failed: ${res.status}`)
  const data = await res.json()
  setToken(data.token)
  return data.token
}

function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export type SessionInfo = {
  id: string
  title: string | null
  created_at: number
  cols: number
  rows: number
}

export async function listSessions(): Promise<SessionInfo[]> {
  const res = await fetch("/api/sessions", { headers: authHeaders() })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw new Error(`listSessions failed: ${res.status}`)
  const data = await res.json()
  return data.sessions
}

export async function createSession(title?: string): Promise<SessionInfo> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(title ? { title } : {}),
  })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`)
  return res.json()
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (res.status === 401) throw unauthorized()
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteSession failed: ${res.status}`)
  }
}

// Reported verbatim by whichever backend ran the turn, and the two disagree
// about almost every key. Nothing here depends on the shape, so it stays
// opaque rather than being flattened into a lowest common denominator.
export type AgentUsage = Record<string, unknown>

export type AgentBackend = "claude_code" | "codex" | "kiro"

/**
 * `starting` is the gap between asking the backend to begin and it saying
 * anything — a cold Claude Code process takes seconds to boot.
 * Without a state for it the UI looks hung.
 *
 * `interrupted` is not a transition but a resting state: the turn was stopped
 * and the queue is parked until the user types.
 */
export type AgentStatus = "idle" | "starting" | "running" | "interrupted"

export type AgentInfo = {
  id: string
  title: string | null
  backend: AgentBackend
  backend_label: string
  // The project it was made in, for good; null outside any. Older servers do
  // not send it.
  project_id?: string | null
  // Shown above everything else in the sidebar.
  pinned?: boolean
  // When the user archived it (ms), or null. Only the page reads it; see
  // `isArchived`.
  archived_at?: number | null
  // "dream" for a scope's sleep session, which the lists leave out and the
  // moon opens; see `Sleep.tsx`. "employee_chat" and "employee_work" for a
  // virtual employee's, opened from its page; see `Employees.tsx`. "bell" for
  // the bell's chat; "task" for a task's own session, opened from the task.
  // Older servers do not send it.
  kind?: "dream" | "employee_chat" | "employee_work" | "bell" | "task" | null
  employee_id?: string | null
  // How far the user has read; with `seq`, the moon's unread mark.
  seen_seq?: number
  // Where the agent last said something; past `seen_seq`, a conversation is
  // unread. Older servers do not send it.
  reply_seq?: number
  // The thinking level from the next turn on; null for the model's default.
  // See `EFFORTS` for what each agent takes. Older servers do not send it.
  effort?: string | null
  // The model from the next turn on; null for the agent's default. See
  // `MODELS`. Older servers do not send it.
  model?: string | null
  created_at: number
  // The last message either way, as ms since the epoch: what orders the
  // sidebar and what its age shows. Older servers do not send it.
  last_active_at?: number
  status: AgentStatus
  queued: number
  // The parked messages themselves, so an interrupted session can show what is
  // waiting and let the user drop a line that no longer applies.
  queue: string[]
  usage: AgentUsage | null
  // How big the conversation is now, from the backend's own last API call —
  // never the turn's cumulative token traffic, which is several times larger.
  context_tokens: number
  context_window: number | null
  turns: number
  // Orders summaries from the lobby channel: the higher one is newer.
  seq: number
}

export async function listAgents(): Promise<AgentInfo[]> {
  const res = await fetch("/api/agents", { headers: authHeaders() })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw new Error(`listAgents failed: ${res.status}`)
  const data = await res.json()
  return data.sessions
}

// `backend` is required and permanent: the conversation lives in that engine's
// own store, so there is nothing to migrate if it changes later. So is the
// project: its workspace becomes the session's working directory.
export async function createAgent(backend: AgentBackend, projectId?: string | null): Promise<AgentInfo> {
  const res = await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(projectId ? { backend, project_id: projectId } : { backend }),
  })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw new Error(`createAgent failed: ${res.status}`)
  return res.json()
}

// Local to loom — a sidebar label, never pushed to the backend.
export async function renameAgent(
  id: string,
  title: string,
): Promise<AgentInfo> {
  const res = await fetch(`/api/agents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
  })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw new Error(`renameAgent failed: ${res.status}`)
  return res.json()
}

/**
 * The thinking levels each agent takes, lowest first: Claude Code's
 * `--effort`, Codex's per-turn `effort`. Mirrors `Loom.Agent.Backend.efforts/1`;
 * Kiro has none.
 */
export const EFFORTS: Record<AgentBackend, string[]> = {
  claude_code: ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh"],
  kiro: [],
}

/**
 * The models offered for each agent, besides its default: Bedrock's for
 * Claude Code, Bedrock Mantle's for Codex (`~/.codex/config.toml`), and what
 * `kiro-cli chat --list-models` lists. The server takes any id; this is only
 * the menu.
 */
export const MODELS: Record<AgentBackend, string[]> = {
  claude_code: [
    "us.anthropic.claude-opus-5-5",
    "us.anthropic.claude-fable-5-1[1m]",
    "us.anthropic.claude-sonnet-5-5",
    "us.anthropic.claude-haiku-5-5",
  ],
  codex: ["openai.gpt-6-astra", "openai.gpt-6.1-sol", "openai.gpt-6.1-terra", "openai.gpt-6-luna", "openai.gpt-5.5"],
  // Kiro's default is "auto", which picks per task.
  kiro: [
    "claude-opus-5.5",
    "claude-fable-5.1",
    "claude-sonnet-5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "glm-5",
    "deepseek-3.2",
  ],
}

/**
 * A model id as a person says it: `us.anthropic.claude-opus-5-5` and Kiro's
 * `claude-opus-5.5` are both "Opus 5.5", `openai.gpt-6-astra` "GPT-6 Astra".
 */
export function modelName(id: string): string {
  const bare = id.replace(/\[.*\]$/, "").replace(/^(us|eu|apac|global)\./, "").replace(/^(anthropic|openai)\./, "")
  const claude = bare.match(/^claude-([a-z]+)-(\d+)(?:[-.](\d))?(?![\d])/)
  if (claude) {
    const [, family, major, minor] = claude
    return `${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? "." + minor : ""}`
  }
  const gpt = bare.match(/^gpt-([\d.]+)(?:-(.+))?$/)
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? " " + gpt[2][0].toUpperCase() + gpt[2].slice(1) : ""}`
  return bare === "auto" ? "Auto" : bare
}

/**
 * Archived, and not used since: out of the lists, in Settings → Archived.
 * Writing in one (or a task writing in it) brings it back by itself.
 */
export const isArchived = (s: AgentInfo) =>
  s.archived_at != null && (s.last_active_at ?? 0) <= s.archived_at

/**
 * Pin or unpin a session, archive it, or move it into a project (null: out of any). A
 * move is refused mid-turn; the server says so.
 */
export function updateAgent(
  id: string,
  attrs: {
    pinned?: boolean
    archived?: boolean
    project_id?: string | null
    seen_seq?: number
    effort?: string | null
    model?: string | null
  },
): Promise<AgentInfo> {
  return apiCall(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify(attrs) })
}

/** A session's unsent composer text, on the server; "" when there is none. */
export function getDraft(id: string): Promise<{ text: string }> {
  return apiCall(`/api/agents/${id}/draft`, { method: "GET" })
}

/** Replace it; "" clears it. `keepalive` lets it outlive the page going away. */
export function putDraft(id: string, text: string, keepalive = false): Promise<{ text: string }> {
  return apiCall(`/api/agents/${id}/draft`, { method: "PUT", body: JSON.stringify({ text }), keepalive })
}

// Permanent: the server discards the session's history too, otherwise it would
// reappear at the next boot when Bootstrap restores everything on disk.
export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`/api/agents/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (res.status === 401) throw unauthorized()
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteAgent failed: ${res.status}`)
  }
}

/**
 * A file stored under the session's own directory, as the server named it.
 *
 * `path` is absolute and goes to the model in the message it receives; the
 * backend reads it with its own tools. The server re-checks it belongs to this
 * session on submit, so a rewritten path is refused rather than read.
 */
export type AgentFile = {
  name: string
  path: string
  size: number
  content_type: string
}

/**
 * One entry of a turn's outputs: a file directly in `output/`, or a whole
 * directory (`kind: "dir"`) however many files changed in it. A directory with
 * an `index.html` is a page for the canvas. Events from before directories were
 * grouped have no `kind` and are files.
 */
export type OutputFile = AgentFile & {
  kind?: "file" | "dir"
  // Directories only: how many files, and the page to open if there is one.
  files?: number
  index?: string | null
  // Already announced by an earlier turn and rewritten since.
  updated: boolean
}

/** One file in a session's `files/` or `output/`, as the file browser lists it. */
export type TreeFile = {
  path: string
  size: number
  // Seconds since the epoch.
  mtime: number
}

/**
 * Everything the session holds: what the user attached, what the agent made,
 * and, in a project, the workspace its sessions share — capped, so
 * `workspace_truncated` says when there is more than was listed.
 */
export type SessionTree = {
  files: TreeFile[]
  output: TreeFile[]
  workspace?: TreeFile[]
  workspace_truncated?: boolean
}

export async function sessionTree(id: string): Promise<SessionTree> {
  const res = await fetch(`/api/agents/${id}/tree`, { headers: authHeaders() })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw new Error(`could not list the files: ${res.status}`)
  return res.json()
}

export function outputUrl(id: string, path: string): string {
  return `/api/agents/${id}/output/${path.split("/").map(encodeURIComponent).join("/")}`
}

/** Where an attachment can be read back. `path` is the one `store` returned. */
export function attachmentUrl(id: string, path: string): string {
  return `/api/agents/${id}/files/${encodeURIComponent(path.split("/").pop() ?? path)}`
}

// One object URL per file, for the life of the page: a transcript re-renders
// and remounts constantly, and a thumbnail must not be fetched each time.
const blobs = new Map<string, Promise<string>>()

/**
 * Whether a file of this type may be shown as a thumbnail. Not SVG: it is a
 * document that can carry script, and an object URL has loom's own origin — an
 * `<img>` would not run it, but "open image in new tab" would, with the login
 * token in reach.
 */
export const isThumbnail = (contentType: string | undefined) =>
  !!contentType?.startsWith("image/") && !contentType.startsWith("image/svg")

/**
 * An authenticated file as something `<img src>` can show.
 *
 * The routes are behind the bearer token, which an `<img>` cannot send, so the
 * file is fetched and handed over as an object URL.
 */
export function blobUrl(url: string): Promise<string> {
  let p = blobs.get(url)
  if (!p) {
    p = fetch(url, { headers: authHeaders() }).then(async (res) => {
      if (res.status === 401) throw unauthorized()
      if (!res.ok) throw new Error(`${res.status}`)
      return URL.createObjectURL(await res.blob())
    })
    // A failure is kept too: the transcript re-renders on every delta, and
    // retrying each time would be a request per streamed chunk. A reload
    // starts over.
    p.catch(() => {})
    blobs.set(url, p)
  }
  return p
}

/**
 * Hand `blobUrl` a copy it already has: the image a user just attached is on
 * this device, so its bubble needs no round trip.
 */
export function seedBlobUrl(url: string, objectUrl: string) {
  if (!blobs.has(url)) blobs.set(url, Promise.resolve(objectUrl))
}

/**
 * Download one of a session's outputs.
 *
 * Fetched rather than linked: the route is behind the bearer token, and an
 * `<a href>` cannot send one. The blob is handed to a throwaway link so the
 * browser treats it as a download under the file's own name.
 */
export async function downloadAgentOutput(id: string, path: string): Promise<void> {
  await download(outputUrl(id, path), path.split("/").pop() ?? path)
}

/** One file of the session's project workspace, by its path there. */
export async function downloadWorkspaceFile(id: string, path: string): Promise<void> {
  const url = `/api/agents/${id}/workspace/${path.split("/").map(encodeURIComponent).join("/")}`
  await download(url, path.split("/").pop() ?? path)
}

/** One attachment, by its stored name, handed to the browser as a download. */
export async function downloadAttachment(id: string, name: string): Promise<void> {
  await download(attachmentUrl(id, name), name)
}

/** One output directory as a zip, built by the server. */
export async function downloadAgentZip(id: string, path: string): Promise<void> {
  const url = `/api/agents/${id}/zip/${path.split("/").map(encodeURIComponent).join("/")}`
  await download(url, `${path.split("/").pop() ?? path}.zip`)
}

async function download(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { headers: authHeaders() })
  if (res.status === 401) throw unauthorized()
  if (res.status === 404) throw new Error("the file is no longer there")
  if (res.status === 413) throw new Error("too big to zip (over 1 GB)")
  if (!res.ok) throw new Error(`download failed: ${res.status}`)

  // Typed as opaque bytes: an HTML or SVG blob that a browser navigated to
  // instead of saving would run on loom's origin.
  const blob = new Blob([await res.blob()], { type: "application/octet-stream" })
  const href = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked late: Safari reads the blob after `click()` returns.
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

// The canvas's signed prefixes per session, re-fetched well before the
// server's one-day expiry.
export type CanvasBases = { output: string; files: string }
const canvasBases = new Map<string, { at: number; bases: Promise<CanvasBases> }>()
const CANVAS_TTL = 12 * 60 * 60 * 1000

/**
 * Where this session's outputs are served to the canvas iframe — a signed
 * `/canvas/<id>/<token>/` prefix, because an iframe cannot send the bearer
 * header — and its attachments, under `/canvas-files/<id>/<token>/`. See
 * `LoomWeb.CanvasController`.
 */
export function canvasBase(id: string): Promise<CanvasBases> {
  const cached = canvasBases.get(id)
  if (cached && Date.now() - cached.at < CANVAS_TTL) return cached.bases

  const bases = fetch(`/api/agents/${id}/canvas`, { method: "POST", headers: authHeaders() }).then(
    async (res) => {
      if (res.status === 401) throw unauthorized()
      if (!res.ok) throw new Error(`canvas failed: ${res.status}`)
      const body = await res.json()
      return { output: body.base as string, files: body.files as string }
    },
  )
  bases.catch(() => canvasBases.delete(id))
  canvasBases.set(id, { at: Date.now(), bases })
  return bases
}

/**
 * Upload attachments for a session.
 *
 * Over HTTP rather than the channel: a 20 MB screenshot sent as a WebSocket
 * frame would sit in front of every event and delta on the same socket.
 */
export async function uploadAgentFiles(
  id: string,
  files: File[],
): Promise<AgentFile[]> {
  const body = new FormData()
  for (const file of files) body.append("files[]", file)

  // No Content-Type header: the browser has to set the multipart boundary.
  const res = await fetch(`/api/agents/${id}/files`, {
    method: "POST",
    headers: authHeaders(),
    body,
  })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.error ?? `upload failed: ${res.status}`)
  }
  return (await res.json()).files
}

export type Tab = {
  id: string
  panes: string[] // session ids, left → right
}

export type Layout = {
  tabs: Tab[]
  active_tab: string | null
}

export async function getLayout(): Promise<Layout> {
  const res = await fetch("/api/layout", { headers: authHeaders() })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw new Error(`getLayout failed: ${res.status}`)
  return res.json()
}

export async function putLayout(layout: Layout): Promise<Layout> {
  const res = await fetch("/api/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(layout),
  })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw new Error(`putLayout failed: ${res.status}`)
  return res.json()
}

/** One of the user's machines, as `Loom.Nodes` describes it. */
export type Device = {
  id: string
  name: string
  online: boolean
  os: string | null
  arch: string | null
  hostname: string | null
  version: string | null
  created_at: string
  last_seen_at: string | null
}

// The server words its refusals ("there is already a device called mac", "that
// name is taken"), so they are shown as they are.
async function apiCall<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders() },
  })
  if (res.status === 401) throw unauthorized()
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `request failed: ${res.status}`)
  return body
}

/** Sessions whose conversation mentions `q`, newest match first; see `Loom.Agent.Search`. */
export type SearchHit = { id: string; seq: number; at: number; snippet: string }
export async function searchSessions(q: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: authHeaders(), signal })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw new Error(`search failed: ${res.status}`)
  return (await res.json()).results
}

/** Register a device: it comes back with its one-time install code. */
export function createDevice(name: string): Promise<{ node: Device; code: string }> {
  return apiCall("/api/devices", { method: "POST", body: JSON.stringify({ name }) })
}

export function renameDevice(id: string, name: string): Promise<{ node: Device }> {
  return apiCall(`/api/devices/${id}`, { method: "PATCH", body: JSON.stringify({ name }) })
}

export function deleteDevice(id: string): Promise<void> {
  return apiCall(`/api/devices/${id}`, { method: "DELETE" })
}

/** A new install code for a device; using it replaces the device's token. */
export function deviceInstallCode(id: string): Promise<{ code: string }> {
  return apiCall(`/api/devices/${id}/install`, { method: "POST" })
}

/**
 * What to paste into a terminal on the device, per kind of system. One code:
 * whichever is run first uses it up.
 */
/**
 * Where devices join loom. Defaults to the domain the dashboard is served on,
 * but a deployment can send joins to a separate hostname — so the main domain
 * is not printed in any install link — by setting VITE_NODE_JOIN_ORIGIN at
 * build time. The host a device joins through is the one it keeps dialling.
 */
const joinOrigin = (import.meta.env.VITE_NODE_JOIN_ORIGIN as string | undefined) || window.location.origin

export function installCommands(code: string): { system: string; command: string }[] {
  const url = `${joinOrigin}/node/install/${code}`
  return [
    { system: "macOS, Linux, WSL", command: `curl -fsSL ${url} | sh` },
    { system: "Windows PowerShell", command: `irm ${url}/ps1 | iex` },
  ]
}

/**
 * Android is an app, not a terminal: install the Loom Node app, open it, and
 * paste the install URL into it — the app writes the token and keeps the node
 * alive with a foreground service (no Termux). Both URLs carry the same
 * one-time code, so this device's APK download dies with the code (~a day);
 * use one install method or the other.
 */
export function androidInstall(code: string): { appUrl: string; pasteUrl: string } {
  return { appUrl: `${joinOrigin}/node/app/${code}`, pasteUrl: `${joinOrigin}/node/install/${code}` }
}

// ── Projects (see Loom.Projects) ──────────────────────────────────────────

/**
 * Sessions under one name, sharing a working directory and standing
 * instructions. Loom makes the `workspace` and removes it with the project.
 */
export type Project = {
  id: string
  name: string
  instructions: string
  created_at: number
  workspace: string
}

export function createProject(attrs: { name: string; instructions?: string }): Promise<Project> {
  return apiCall("/api/projects", { method: "POST", body: JSON.stringify(attrs) })
}

/** The workspace is fixed; only these change. */
export function updateProject(id: string, attrs: { name?: string; instructions?: string }): Promise<Project> {
  return apiCall(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(attrs) })
}

/** The project and every session in it, and the workspace if Loom made it. */
export function deleteProject(id: string): Promise<void> {
  return apiCall(`/api/projects/${id}`, { method: "DELETE" })
}

// ── Sleep (see Loom.Dream, LoomWeb.DreamController) ───────────────────────
//
// A scope is a project id, or "home" for the sessions outside any project:
// Claude Code keeps one memory directory for each.

export type Dream = {
  scope: string
  // Its sleep session, once there is one.
  session: string | null
  enabled: boolean
  last_run_at: number | null
  // Newest first.
  runs: { at: number; sessions: number; undone?: boolean }[]
  can_undo: boolean
  // Sessions active since the last sleep: what the next one would go over.
  pending_sessions: number
  memory_dir: string | null
  memories: number
  // Local hours, [start, end), in `utc_offset` (minutes east of UTC).
  window: [number, number]
  utc_offset: number
}

export type Memory = {
  file: string
  name: string
  description: string | null
  type: string | null
  mtime: number
  archived: boolean
}

export function getDream(scope: string): Promise<Dream> {
  return apiCall(`/api/dreams/${scope}`, { method: "GET" })
}

/** The scope's sleep session, made if there is none yet. */
export async function openDream(scope: string): Promise<AgentInfo> {
  const { session } = await apiCall<{ session: AgentInfo }>(`/api/dreams/${scope}/session`, { method: "POST" })
  return session
}

export function runDream(scope: string): Promise<Dream> {
  return apiCall(`/api/dreams/${scope}/run`, { method: "POST" })
}

export function undoDream(scope: string): Promise<Dream> {
  return apiCall(`/api/dreams/${scope}/undo`, { method: "POST" })
}

/** `enabled` is the scope's; `window` and `utc_offset` are every scope's. */
export function updateDream(
  scope: string,
  attrs: Partial<Pick<Dream, "enabled" | "window" | "utc_offset">>,
): Promise<Dream> {
  return apiCall(`/api/dreams/${scope}`, { method: "PATCH", body: JSON.stringify(attrs) })
}

export async function dreamMemories(scope: string): Promise<Memory[]> {
  const { memories } = await apiCall<{ memories: Memory[] }>(`/api/dreams/${scope}/memories`, { method: "GET" })
  return memories
}

// ── Tasks (see Loom.Cron, LoomWeb.TaskController) ─────────────────────────

/**
 * A prompt sent to a session on a schedule. `cron` is five fields in the
 * task's own wall-clock time, `utc_offset` minutes east of UTC (Shanghai,
 * 480, unless set). `target` is the session its runs land in.
 */
export type Task = {
  id: string
  name: string
  prompt: string
  cron: string
  utc_offset: number
  paused: boolean
  target: string
  target_title: string | null
  next_at: string | null
  last_run_at: string | null
  last_error: string | null
}

export function listTasks(): Promise<{ tasks: Task[]; utc_offset: number }> {
  return apiCall("/api/tasks", { method: "GET" })
}

/** From fields, or `{text}`: the task said in words, which the server reads. */
export function createTask(
  attrs: { name?: string; prompt: string; cron: string } | { text: string },
): Promise<Task> {
  return apiCall("/api/tasks", { method: "POST", body: JSON.stringify(attrs) })
}

export function updateTask(
  id: string,
  attrs: Partial<Pick<Task, "name" | "prompt" | "cron" | "paused">>,
): Promise<Task> {
  return apiCall(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(attrs) })
}

/** Now, off its schedule; the reply lands in its session. */
export function runTask(id: string): Promise<Task> {
  return apiCall(`/api/tasks/${id}/run`, { method: "POST" })
}

/** The task only: its session stays. */
export function deleteTask(id: string): Promise<void> {
  return apiCall(`/api/tasks/${id}`, { method: "DELETE" })
}

// ── Notifications (see push.ts) ───────────────────────────────────────────

/** The key the server signs pushes with, base64url, to subscribe against. */
export function pushKey(): Promise<{ key: string }> {
  return apiCall("/api/push", { method: "GET" })
}

export function savePushSubscription(subscription: PushSubscriptionJSON, test: boolean): Promise<void> {
  return apiCall("/api/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({ subscription, origin: window.location.origin, test }),
  })
}

export function deletePushSubscription(endpoint: string): Promise<void> {
  return apiCall("/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint }) })
}

// ── Files in the canvas's tree ─────────────────────────────────────────────

/** Renamed where it is; comes back as its new path. */
export function renameOutput(id: string, path: string, name: string): Promise<{ path: string }> {
  return apiCall(outputUrl(id, path), { method: "PATCH", body: JSON.stringify({ new_name: name }) })
}

/** A file, or a directory and everything in it. */
export function deleteOutput(id: string, path: string): Promise<void> {
  return apiCall(outputUrl(id, path), { method: "DELETE" })
}

export function renameAttachment(id: string, name: string, newName: string): Promise<{ path: string }> {
  return apiCall(attachmentUrl(id, name), { method: "PATCH", body: JSON.stringify({ new_name: newName }) })
}

export function deleteAttachment(id: string, name: string): Promise<void> {
  return apiCall(attachmentUrl(id, name), { method: "DELETE" })
}

/** Either side of the tree: an output by its path, an attachment by its name. */
export function renameAgentOutputOrAttachment(
  id: string,
  source: "output" | "files",
  path: string,
  name: string,
): Promise<{ path: string }> {
  return source === "files" ? renameAttachment(id, path, name) : renameOutput(id, path, name)
}

export function deleteAgentOutputOrAttachment(
  id: string,
  source: "output" | "files",
  path: string,
): Promise<void> {
  return source === "files" ? deleteAttachment(id, path) : deleteOutput(id, path)
}

// ── Virtual employees (see Loom.Employees, LoomWeb.EmployeeController) ────

export type EmployeeStatus = "working" | "sleeping" | "paused" | "approval" | "blocked" | "offline"
export type KpiStatus = "todo" | "doing" | "review" | "done" | "parked"
export type Priority = "high" | "normal" | "low"

export type Kpi = {
  id: string
  title: string
  detail: string | null
  // What done means.
  criteria: string | null
  due: string | null
  priority: Priority
  progress: number
  status: KpiStatus
  // The employee's latest word on it.
  note: string | null
  created_at: number
  updated_at: number
}

export type Report = { level: "info" | "important" | "urgent"; text: string; at?: number }

export type Employee = {
  id: string
  name: string
  role: string
  persona: string
  language: string
  project_ids: string[]
  projects: { id: string; name: string }[]
  // Local hours [from, to), or null for all day.
  hours: [number, number] | null
  heartbeat_min: number
  min_gap_min: number
  max_turn_min: number
  budget_usd: number
  // ISO weekday, 1 is Monday.
  weekly_report: { day: number; time: string }
  ask_first: string[]
  // Chosen at hiring, for good.
  backend: AgentBackend
  model: string
  // Where the backend reports no cost (Codex, Kiro), the budget is turns.
  budget_turns: number
  budget_unit: "usd" | "turns"
  paused: boolean
  // A device's id: where what it does happens (null: this server). Its name
  // is kept when the device is removed.
  workstation: string | null
  workstation_name: string | null
  status: EmployeeStatus
  chat_session: string
  work_session: string
  // Its earlier work sessions, newest first: one a day, shown above the
  // current one as a single thread.
  past_work?: string[]
  created_at: number
  kpis: Kpi[]
  // Newest first: one line per work turn.
  log: { at: number; summary?: string; report?: Report }[]
  wake_at: number | null
  wake_reason: string | null
  last_wake_at: number | null
  attention: Report | null
  // In `budget_unit`.
  spent_today: number
  cap_today: number
  // Dollars, where the backend reports them.
  usd_today: number
  // Day (YYYY-MM-DD, the user's) to dollars, and to turns.
  spend_days: Record<string, number>
  turn_days: Record<string, number>
  workspace: string
  // Things waiting for its next wake-up.
  pending_notes: number
}

export type EmployeeSettings = Partial<
  Pick<
    Employee,
    | "name"
    | "role"
    | "persona"
    | "language"
    | "project_ids"
    | "hours"
    | "heartbeat_min"
    | "min_gap_min"
    | "max_turn_min"
    | "budget_usd"
    | "budget_turns"
    | "backend"
    | "weekly_report"
    | "ask_first"
    | "model"
    | "workstation"
  >
>

export type EmployeeReport = { file: string; kind: "daily" | "weekly"; title: string; mtime: number; size: number }

const one = async (call: Promise<{ employee: Employee }>) => (await call).employee

export function createEmployee(attrs: EmployeeSettings): Promise<Employee> {
  return one(apiCall("/api/employees", { method: "POST", body: JSON.stringify(attrs) }))
}

export function updateEmployee(id: string, attrs: EmployeeSettings): Promise<Employee> {
  return one(apiCall(`/api/employees/${id}`, { method: "PATCH", body: JSON.stringify(attrs) }))
}

/** Its sessions and workspace go with it. */
export function deleteEmployee(id: string): Promise<void> {
  return apiCall(`/api/employees/${id}`, { method: "DELETE" })
}

export function pauseEmployee(id: string, paused: boolean): Promise<Employee> {
  return one(apiCall(`/api/employees/${id}/pause`, { method: "POST", body: JSON.stringify({ paused }) }))
}

export function wakeEmployee(id: string, note?: string): Promise<Employee> {
  return one(apiCall(`/api/employees/${id}/wake`, { method: "POST", body: JSON.stringify({ note }) }))
}

/** What it reported has been read: the banner goes. */
export function employeeSeen(id: string): Promise<Employee> {
  return one(apiCall(`/api/employees/${id}/seen`, { method: "POST" }))
}

/** More budget, for today only. */
export function approveEmployee(id: string, usd: number): Promise<Employee> {
  return one(apiCall(`/api/employees/${id}/approve`, { method: "POST", body: JSON.stringify({ usd }) }))
}

export type KpiAttrs = Partial<Pick<Kpi, "title" | "detail" | "criteria" | "due" | "priority" | "progress" | "status" | "note">>

export function addKpi(id: string, attrs: KpiAttrs): Promise<Employee> {
  return one(apiCall(`/api/employees/${id}/kpis`, { method: "POST", body: JSON.stringify(attrs) }))
}

export function updateKpi(id: string, kpi: string, attrs: KpiAttrs): Promise<Employee> {
  return one(apiCall(`/api/employees/${id}/kpis/${kpi}`, { method: "PATCH", body: JSON.stringify(attrs) }))
}

export function deleteKpi(id: string, kpi: string): Promise<Employee> {
  return one(apiCall(`/api/employees/${id}/kpis/${kpi}`, { method: "DELETE" }))
}

/** Accept a KPI put up for review, or send it back with a note. */
export function reviewKpi(id: string, kpi: string, accept: boolean, note?: string): Promise<Employee> {
  return one(
    apiCall(`/api/employees/${id}/kpis/${kpi}/review`, { method: "POST", body: JSON.stringify({ accept, note }) }),
  )
}

export async function employeeReports(id: string): Promise<EmployeeReport[]> {
  const { reports } = await apiCall<{ reports: EmployeeReport[] }>(`/api/employees/${id}/reports`, { method: "GET" })
  return reports
}

export async function employeeReport(id: string, file: string): Promise<string> {
  const { text } = await apiCall<{ text: string }>(`/api/employees/${id}/reports/${encodeURIComponent(file)}`, {
    method: "GET",
  })
  return text
}

// ── The boss profile, all employees' one ─────────────────────────────────

/** A fact or rule about the user, a sentence; `by_name` the employee who heard it, null when the user wrote it. */
export type BossLine = { id: string; text: string; by: string | null; by_name: string | null; at: number }

const boss = async (call: Promise<{ boss: BossLine[] }>) => (await call).boss

export function bossProfile(): Promise<BossLine[]> {
  return boss(apiCall("/api/boss", { method: "GET" }))
}

export function addBossLine(text: string): Promise<BossLine[]> {
  return boss(apiCall("/api/boss", { method: "POST", body: JSON.stringify({ text }) }))
}

export function updateBossLine(id: string, text: string): Promise<BossLine[]> {
  return boss(apiCall(`/api/boss/${id}`, { method: "PATCH", body: JSON.stringify({ text }) }))
}

export function deleteBossLine(id: string): Promise<BossLine[]> {
  return boss(apiCall(`/api/boss/${id}`, { method: "DELETE" }))
}

// ── The bell (`Loom.Notices`) ────────────────────────────────────────────

/** What an agent wants the user to see, 0 (most urgent) to 10. */
export type Notice = {
  id: string
  source: { kind: "employee" | "dream" | "session"; id: string; name: string }
  // The session it points to, where it is answered.
  session: string | null
  summary: string
  priority: number
  key: string | null
  needs: "read" | "reply" | "approve"
  status: "open" | "done" | "expired" | "withdrawn"
  // Why Loom changed or settled it: lowered, answered in chat, expired…
  note: string | null
  // "approve", "reject", or what the user wrote back from the bell.
  answer?: string
  // The background, beyond the one line.
  detail?: string | null
  // The answers its source foresees, each a button.
  options?: string[]
  // The `seq` of the message that started the turn it came from.
  anchor?: number | null
  // Put off until then (ms); back in the list after.
  later_until?: number | null
  created_at: number
  updated_at: number
  done_at?: number
}

const notice = async (call: Promise<{ notice: Notice }>) => (await call).notice

/** Opened: done, if it only asked to be read. */
export function readNotice(id: string): Promise<Notice> {
  return notice(apiCall(`/api/notices/${id}/read`, { method: "POST" }))
}

/** Answered in the bell: the text goes to its session as the user's. */
export function replyNotice(id: string, text: string): Promise<Notice> {
  return notice(apiCall(`/api/notices/${id}/reply`, { method: "POST", body: JSON.stringify({ text }) }))
}

/** Put off until `until` (ms): out of the list until then, then notified again. */
export function laterNotice(id: string, until: number): Promise<Notice> {
  return notice(apiCall(`/api/notices/${id}/later`, { method: "POST", body: JSON.stringify({ until }) }))
}

/** Settled by hand: nothing more to do about it. */
export function dismissNotice(id: string): Promise<Notice> {
  return notice(apiCall(`/api/notices/${id}/dismiss`, { method: "POST" }))
}

/** Approved or rejected from the bell; its session is told. */
export function answerNotice(id: string, approve: boolean): Promise<Notice> {
  return notice(apiCall(`/api/notices/${id}/answer`, { method: "POST", body: JSON.stringify({ approve }) }))
}

/** The user's own list, beside the bell: added by them, or by an agent they told to. */
export type Todo = {
  id: string
  text: string
  due: string | null
  // The session it was added from, if an agent added it.
  session: string | null
  // "you", or the agent's name.
  by: string
  done: boolean
  done_at?: number
  created_at: number
}

const todo = async (call: Promise<{ todo: Todo }>) => (await call).todo

export function addTodo(text: string, due: string | null): Promise<Todo> {
  return todo(apiCall("/api/todos", { method: "POST", body: JSON.stringify({ text, due }) }))
}

export function updateTodo(id: string, attrs: Partial<Pick<Todo, "done" | "text" | "due">>): Promise<Todo> {
  return todo(apiCall(`/api/todos/${id}`, { method: "PATCH", body: JSON.stringify(attrs) }))
}

export async function deleteTodo(id: string): Promise<void> {
  await apiCall(`/api/todos/${id}`, { method: "DELETE" })
}

/** The bell's chat session, made on first use. */
export async function bellSession(): Promise<string> {
  return (await apiCall<{ session: string }>("/api/notices/session", { method: "POST" })).session
}

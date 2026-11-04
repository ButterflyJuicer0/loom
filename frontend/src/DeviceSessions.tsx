import { ArrowLeft, CornerDownRight, RefreshCw, Sparkles, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { DeviceIcon, deviceIcon } from "./DeviceIcon"
import { Markdown } from "./markdown"
import { useNarrow } from "./useNarrow"
import {
  continueDeviceSession,
  deviceSessions,
  pickDeviceSession,
  deviceTranscript,
  type Device,
  type DeviceSession,
  type DeviceSessions,
  type DeviceTranscriptMessage,
  type SessionPick,
} from "./api"

/**
 * The Claude Code and Codex sessions on one of the user's devices, read from
 * the device itself (see `LoomWeb.DeviceSessionsController`): the ones running
 * now on top, then the rest by when they last moved. Picking one shows its
 * latest messages. Both refresh on their own while the dialog is open.
 *
 * Describing a task picks the sessions most likely to be that work (the server
 * asks a small model, see `LoomWeb.DeviceSessionsController`), and any session
 * can be carried on in a new Loom session that works on the device.
 */
export function DeviceSessionsDialog({
  device,
  onClose,
  onOpenSession,
}: {
  device: Device
  onClose: () => void
  onOpenSession: (id: string) => void
}) {
  const narrow = useNarrow()
  const [data, setData] = useState<DeviceSessions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<DeviceSession | null>(null)
  const [filter, setFilter] = useState<"all" | "live" | "claude" | "codex" | "kiro">("all")
  const busy = useRef(false)
  // Smart pick: the task as typed, and what came back for it.
  const [task, setTask] = useState("")
  const [picking, setPicking] = useState(false)
  const [picks, setPicks] = useState<{ task: string; list: SessionPick[]; by: string } | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)

  const pick = async () => {
    const t = task.trim()
    if (!t || picking) return
    setPicking(true)
    setPickError(null)
    try {
      const r = await pickDeviceSession(device.id, t)
      setPicks({ task: t, list: r.picks, by: r.by })
      setFilter("all")
      const best = r.picks[0]?.session ?? (r.picks[0] && data?.sessions.find((x) => x.file === r.picks[0].file))
      if (best) setPicked(best)
    } catch (e) {
      setPickError((e as Error).message)
    } finally {
      setPicking(false)
    }
  }

  const load = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    try {
      const d = await deviceSessions(device.id, 60)
      setData(d)
      setError(null)
      // Keep the open one current (its title, status and counts move).
      setPicked((p) => (p ? (d.sessions.find((s) => keyOf(s) === keyOf(p)) ?? p) : p))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [device.id])

  useEffect(() => {
    void load()
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 20_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopImmediatePropagation()
      if (picked && narrow) setPicked(null)
      else onClose()
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [onClose, picked, narrow])

  const sessions = (data?.sessions ?? []).filter((s) =>
    filter === "all" ? true : filter === "live" ? s.live : s.agent === filter,
  )
  const suggested = (picks?.list ?? [])
    .map((p) => ({ p, s: p.session ?? data?.sessions.find((x) => x.file === p.file) }))
    .filter((x): x is { p: SessionPick; s: DeviceSession } => !!x.s)
  const reasonOf = (s: DeviceSession) =>
    picks?.list.find((p) => (p.session ? keyOf(p.session) === keyOf(s) : p.file === s.file))
  const live = sessions.filter((s) => s.live)
  const rest = sessions.filter((s) => !s.live)
  const liveCount = data?.sessions.filter((s) => s.live).length ?? 0

  const showList = !narrow || !picked
  const showDetail = !narrow || picked

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal dsess" role="dialog" aria-label={`Sessions on ${device.name}`}>
        <div className="modal-head">
          <span className="dsess-title">
            {narrow && picked && (
              <button className="icon-btn" onClick={() => setPicked(null)} title="Back">
                <ArrowLeft />
              </button>
            )}
            <DeviceIcon icon={deviceIcon(device)} />
            <span>Sessions · {device.name}</span>
            {data && (
              <span className="dsess-sub">
                {liveCount} running · {data.sessions.length} recent
              </span>
            )}
          </span>
          <span className="dsess-head-actions">
            <button
              className={"icon-btn" + (loading ? " dsess-spin" : "")}
              onClick={() => void load()}
              title="Refresh"
              disabled={loading}
            >
              <RefreshCw />
            </button>
            <button className="icon-btn" onClick={onClose} title="Close">
              <X />
            </button>
          </span>
        </div>

        <div className="dsess-body">
          {showList && (
            <div className="dsess-list">
              <form
                className="dsess-pick"
                onSubmit={(e) => {
                  e.preventDefault()
                  void pick()
                }}
              >
                <input
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="Describe the task to pick its session…"
                  disabled={!data}
                />
                <button type="submit" className="text-btn" disabled={!task.trim() || picking || !data} title="Pick the session this task belongs to">
                  <Sparkles /> {picking ? "Picking…" : "Pick"}
                </button>
              </form>
              {pickError && <div className="device-error">{pickError}</div>}
              {picks && (
                <>
                  <div className="dsess-group">
                    Suggested{picks.by === "words" ? " (by matching words)" : ""}
                    <button className="dsess-clear" onClick={() => setPicks(null)} title="Clear">
                      <X />
                    </button>
                  </div>
                  {suggested.length === 0 && <div className="device-empty">No session looks like that task.</div>}
                  {suggested.map(({ p, s }) => (
                    <SessionCard onHost={device.id === "host"}
                      key={"pick-" + keyOf(s)}
                      s={s}
                      home={data?.home}
                      on={(!!picked && keyOf(picked) === keyOf(s))}
                      onPick={() => setPicked(s)}
                      reason={p.reason}
                      score={p.score}
                    />
                  ))}
                </>
              )}
              <div className="dsess-filters">
                {(["all", "live", "claude", "codex", "kiro"] as const).map((f) => (
                  <button
                    key={f}
                    className={"dsess-filter" + (filter === f ? " on" : "")}
                    onClick={() => setFilter(f)}
                  >
                    {f === "all" ? "All" : f === "live" ? "Running" : LONG[f]}
                  </button>
                ))}
              </div>

              {error && <div className="device-error">{error}</div>}
              {!data && !error && <div className="device-empty">Scanning {device.name}…</div>}
              {data && sessions.length === 0 && <div className="device-empty">No sessions here.</div>}

              {live.length > 0 && <div className="dsess-group">Running now</div>}
              {live.map((s) => (
                <SessionCard onHost={device.id === "host"} key={keyOf(s)} s={s} home={data?.home} on={(!!picked && keyOf(picked) === keyOf(s))} onPick={() => setPicked(s)} />
              ))}
              {rest.length > 0 && <div className="dsess-group">Recent</div>}
              {rest.map((s) => (
                <SessionCard onHost={device.id === "host"} key={keyOf(s)} s={s} home={data?.home} on={(!!picked && keyOf(picked) === keyOf(s))} onPick={() => setPicked(s)} />
              ))}
            </div>
          )}

          {showDetail && (
            <div className="dsess-detail">
              {picked ? (
                <Transcript
                  key={keyOf(picked)}
                  device={device}
                  session={picked}
                  home={data?.home}
                  reason={reasonOf(picked)?.reason ?? null}
                  draft={picks && reasonOf(picked) ? picks.task : ""}
                  onOpenSession={onOpenSession}
                />
              ) : (
                <div className="dsess-placeholder">Pick a session to see its conversation.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SessionCard({
  s,
  home,
  on,
  onPick,
  reason,
  score,
  onHost,
}: {
  onHost?: boolean
  s: DeviceSession
  home?: string
  on: boolean
  onPick: () => void
  reason?: string | null
  score?: number | null
}) {
  const state = s.live ? (s.status === "idle" ? "idle" : "busy") : "off"
  return (
    <button className={"dsess-card" + (on ? " on" : "")} onClick={onPick}>
      <div className="dsess-card-top">
        <span className={"dsess-dot " + state} title={s.live ? (s.status ?? "running") : "not running"} />
        <span className={"dsess-agent " + s.agent}>{SHORT[s.agent]}</span>
        {s.source === "host" && !onHost && <span className="dsess-where">server</span>}
        {s.loom_id && <span className="dsess-where loom">Loom</span>}
        <span className="dsess-card-title">{s.loom_title || s.title || s.first || s.id}</span>
      </div>
      <div className="dsess-card-meta">
        {[shortPath(s.cwd, home), s.model, `${s.messages} msgs`, ago(s.updated)].filter(Boolean).join(" · ")}
      </div>
      {reason ? (
        <div className="dsess-card-reason">
          <Sparkles /> {score != null && <b>{score}%</b>} {reason}
        </div>
      ) : (
        s.last && <div className="dsess-card-last">{s.last}</div>
      )}
    </button>
  )
}

function Transcript({
  device,
  session,
  home,
  reason,
  draft,
  onOpenSession,
}: {
  device: Device
  session: DeviceSession
  home?: string
  reason: string | null
  draft: string
  onOpenSession: (id: string) => void
}) {
  const [instruction, setInstruction] = useState(draft)
  const [going, setGoing] = useState(false)
  const [goError, setGoError] = useState<string | null>(null)
  const carryOn = async () => {
    if (going) return
    setGoing(true)
    setGoError(null)
    try {
      const r = await continueDeviceSession(source, session, instruction.trim())
      onOpenSession(r.id)
    } catch (e) {
      setGoError((e as Error).message)
      setGoing(false)
    }
  }
  const [messages, setMessages] = useState<DeviceTranscriptMessage[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const { agent, file, live } = session
  // A pick can come from the server while a device is open, or the reverse.
  const source = session.source ?? device.id
  const place = source === "host" ? "this server" : device.name
  useEffect(() => {
    let gone = false
    setMessages(null)
    setError(null)
    stick.current = true
    const load = async () => {
      try {
        const r = await deviceTranscript(source, { agent, file })
        if (gone) return
        setMessages(r.messages)
        setTotal(r.total)
        setError(null)
      } catch (e) {
        if (!gone) setError((e as Error).message)
      }
    }
    void load()
    // A running session is followed; a finished one does not change.
    const t = live ? setInterval(() => document.visibilityState === "visible" && void load(), 8_000) : null
    return () => {
      gone = true
      if (t) clearInterval(t)
    }
  }, [source, agent, file, live])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div className="dsess-transcript">
      <div className="dsess-info">
        <div className="dsess-info-title">{session.title || session.first || session.id}</div>
        <div className="dsess-info-meta">
          <span className={"dsess-agent " + session.agent}>{LONG[session.agent]}</span>
          {source === "host" && <span className="dsess-where">this server</span>}
          {session.loom_id && <span className="dsess-where loom">a Loom session</span>}
          {session.live && <span className="dsess-live">● {session.status ?? "running"}{session.pid ? ` · pid ${session.pid}` : ""}</span>}
          {session.cwd && <code>{shortPath(session.cwd, home)}</code>}
          {session.branch && session.branch !== "HEAD" && <span>⎇ {session.branch}</span>}
          {session.model && <span>{session.model}</span>}
          <span>{session.messages} msgs</span>
          <span>updated {ago(session.updated)}</span>
        </div>
        <code className="dsess-id" title="Session id">{session.id}</code>
        {reason && (
          <div className="dsess-card-reason">
            <Sparkles /> {reason}
          </div>
        )}
      </div>

      <div
        className="dsess-msgs"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {error && <div className="device-error">{error}</div>}
        {!messages && !error && <div className="device-empty">Reading the conversation…</div>}
        {messages && total > messages.length && (
          <div className="dsess-more">Showing the last {messages.length} of {total} messages</div>
        )}
        {messages?.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="user-turn">
              <div className="bubble user">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="dsess-assistant">
              {m.text.trim() && (
                <div className="bubble assistant">
                  <Markdown text={m.text} />
                </div>
              )}
              {m.tools && m.tools.length > 0 && (
                <div className="dsess-tools">
                  {m.tools.map((t, j) => (
                    <div key={j} className="dsess-tool">
                      ▸ {t}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      {session.loom_id ? (
        <div className="dsess-continue">
          <div className="dsess-continue-row">
            <span className="dsess-warn">One of Loom&apos;s own sessions: it opens as it is.</span>
            <button className="text-btn dsess-go" onClick={() => onOpenSession(session.loom_id!)}>
              <CornerDownRight /> Open in Loom
            </button>
          </div>
        </div>
      ) : (
      <form
        className="dsess-continue"
        onSubmit={(e) => {
          e.preventDefault()
          void carryOn()
        }}
      >
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void carryOn()
            }
          }}
          rows={2}
          placeholder={`What next? Leave empty to open it on a recap. Runs on ${place}${session.cwd ? " in " + shortPath(session.cwd, home) : ""}.`}
        />
        <div className="dsess-continue-row">
          {goError && <span className="device-error">{goError}</span>}
          {session.live && <span className="dsess-warn">Still open on {place}: the new session works beside it.</span>}
          <button type="submit" className="text-btn dsess-go" disabled={going}>
            <CornerDownRight /> {going ? "Starting…" : "Continue in Loom"}
          </button>
        </div>
      </form>
      )}
    </div>
  )
}

const SHORT = { claude: "Claude", codex: "Codex", kiro: "Kiro" } as const
const LONG = { claude: "Claude Code", codex: "Codex", kiro: "Kiro" } as const

/** One session, wherever it is: the same path can exist on two machines. */
const keyOf = (s: DeviceSession) => `${s.source ?? ""}:${s.file}`

function shortPath(p: string | null, home?: string): string | null {
  if (!p) return null
  return home && (p === home || p.startsWith(home + "/")) ? "~" + p.slice(home.length) : p
}

function ago(iso: string | null | undefined): string {
  if (!iso) return ""
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

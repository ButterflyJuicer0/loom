// Meeting mode's UI: the dialog that offers the model download and starts the
// capture, and the bar over the composer while a meeting runs. The work is in
// meeting.ts.

import { useEffect, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { ChevronRight, Mic, Square, Sparkles, Users } from "lucide-react"
import {
  askNow,
  closeMeetingDialog,
  downloadModels,
  meetingState,
  serverMeeting,
  startMeeting,
  stopMeeting,
  subscribeMeeting,
} from "./meeting"

export function useMeeting() {
  return useSyncExternalStore(subscribeMeeting, meetingState)
}

const mb = (n: number) => `${Math.round(n / 1048576)} MB`

/** Shown from the menu's "Meeting mode" until the meeting runs or the user backs out. */
export function MeetingDialog() {
  const m = useMeeting()
  const open = ["checking", "offer", "server", "browser", "ready", "loading", "error"].includes(m.phase)
  if (!open || !m.sessionId) return null
  const sessionId = m.sessionId
  const pct = m.total > 0 ? Math.min(100, (m.got / m.total) * 100) : 0

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && closeMeetingDialog()}>
      <div className="modal confirm meeting-dialog" role="dialog" aria-label="Meeting mode">
        <div className="modal-head">Meeting mode</div>
        <div className="confirm-body">
          {m.phase === "checking" && <p>Checking the speech models…</p>}

          {m.phase === "offer" && (
            <>
              <p>
                Meeting mode transcribes the meeting in this browser and tells voices apart, then
                the agent in this chat gives hints as it goes and writes the minutes at the end.
              </p>
              <p>
                It needs the speech models first (about {mb(m.total || 228_000_000)}, once). The
                server fetches them and passes them on; this browser keeps them.
              </p>
              {m.error && <p className="confirm-error">{m.error}</p>}
            </>
          )}

          {(m.phase === "server" || m.phase === "browser") && (
            <>
              <p>
                {m.phase === "browser"
                  ? "Downloading to this browser…"
                  : m.unpacking
                    ? "The server is unpacking the models…"
                    : "The server is fetching the models…"}
                <span className="meeting-pct">
                  {m.total > 0 ? `${mb(m.got)} / ${mb(m.total)}` : mb(m.got)}
                </span>
              </p>
              <div className="meeting-progress">
                <div style={{ width: `${pct}%` }} />
              </div>
            </>
          )}

          {m.phase === "ready" && (
            <>
              <p>
                On a computer, share your screen <b>with system audio</b> on — that is how the other
                side is heard. Your microphone is you. Headphones keep the two apart.
              </p>
              <p>No screen to share (a phone, or a meeting in the room): only the microphone is used.</p>
            </>
          )}

          {m.phase === "loading" && <p>Starting the recognisers…</p>}
          {m.phase === "error" && <p className="confirm-error">{m.error}</p>}

          <div className="confirm-actions">
            <button className="text-btn" onClick={closeMeetingDialog}>
              {m.phase === "server" || m.phase === "browser" ? "Hide" : "Cancel"}
            </button>
            {m.phase === "offer" && (
              <button className="text-btn" onClick={() => void downloadModels()}>
                Download
              </button>
            )}
            {m.phase === "ready" && (
              <button className="text-btn" onClick={() => void startMeeting(sessionId)}>
                Start
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  const hh = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return <>{hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`}</>
}

/** Over the composer: the meeting in this chat, live; or one this page lost (a reload) to resume or end. */
export function MeetingBar({ sessionId }: { sessionId: string }) {
  const m = useMeeting()
  const here = m.sessionId === sessionId && m.phase === "running"
  const [orphan, setOrphan] = useState<{ lines: number } | null>(null)

  useEffect(() => {
    if (here) return setOrphan(null)
    let live = true
    void serverMeeting(sessionId).then((r) => live && setOrphan(r))
    return () => {
      live = false
    }
  }, [sessionId, here, m.phase])

  if (here) {
    const live = m.partial.them || m.partial.me
    return (
      <div className="meeting-bar">
        <span className="meeting-dot" />
        <span className="meeting-time">
          <Elapsed since={m.startedAt ?? Date.now()} />
        </span>
        <span className="meeting-live" title={live}>
          {live || (m.systemAudio ? "Listening…" : "Listening (microphone only)…")}
        </span>
        {m.speakers && (
          <span className="meeting-meta" title="Voices are told apart">
            <Users />
          </span>
        )}
        <span className="meeting-meta">{m.lines}</span>
        <button className="meeting-btn" title="Send what was said so far and get hints now" onClick={() => void askNow()}>
          <Sparkles />
          Ask
        </button>
        <button className="meeting-btn end" title="End the meeting and write the minutes" onClick={() => void stopMeeting()}>
          <Square />
          End
        </button>
      </div>
    )
  }

  if (orphan && m.phase !== "running") {
    return (
      <div className="meeting-bar">
        <span className="meeting-dot off" />
        <span className="meeting-live">A meeting is open in this chat but not listening here.</span>
        <button className="meeting-btn" onClick={() => void startMeeting(sessionId, true)}>
          <Mic />
          Resume
          <ChevronRight />
        </button>
        <button className="meeting-btn end" onClick={() => void stopMeeting(sessionId).then(() => setOrphan(null))}>
          <Square />
          End
        </button>
      </div>
    )
  }
  return null
}

import { Circle, CircleCheck, Copy, Download, Share as ShareIcon, X } from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { createPortal, flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { shareImage } from "./api"
import type { TimelineItem } from "./agent"
import { Markdown } from "./markdown"
import "./Share.css"

/**
 * "Share…" in the chat's menu: the conversation as exchanges (a message and
 * what came back), all picked to start with; tool calls, thinking and files
 * left out. Untick what should not go; "Share image" draws the rest on the
 * server as one long PNG (`Loom.Snapshot`) and shows it the way ChatGPT's
 * share dialog does — a preview card, then round buttons: share, save, copy.
 */

export type Segment = { key: string; user: string | null; at?: number; replies: string[] }

/** The timeline as exchanges: each user message with the replies after it. */
export function segments(items: TimelineItem[]): Segment[] {
  const out: Segment[] = []
  let cur: Segment | null = null
  for (const item of items) {
    if (item.kind === "user") {
      if (item.pending || item.failed) continue
      cur = { key: item.key, user: item.text.trim() ? item.text : null, at: item.at, replies: [] }
      out.push(cur)
    } else if (item.kind === "assistant") {
      const text = item.text.trim()
      if (!text || text === "·") continue
      if (!cur) out.push((cur = { key: item.key, user: null, replies: [] }))
      cur.replies.push(item.text)
    }
  }
  return out.filter((s) => s.user || s.replies.length)
}

type State = "idle" | "making" | { image: Blob; url: string } | { error: string }

export function ShareView({
  items,
  sessionId,
  title,
  onClose,
}: {
  items: TimelineItem[]
  sessionId: string
  title: string
  onClose: () => void
}) {
  const segs = useMemo(() => segments(items), [items])
  // What is left out, rather than what is in: everything starts picked.
  const [off, setOff] = useState<Set<string>>(new Set())
  const [state, setState] = useState<State>("idle")
  const picked = segs.filter((s) => !off.has(s.key))
  const allOn = picked.length === segs.length

  const image = typeof state === "object" && "image" in state ? state : null
  useEffect(() => () => void (image && URL.revokeObjectURL(image.url)), [image])

  const flip = (key: string) =>
    setOff((x) => {
      const next = new Set(x)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const go = () => {
    if (state === "making") return
    setState("making")
    const html = renderPage(<ImageDoc title={title} segs={picked} />)
    shareImage(sessionId, html, IMAGE_CSS).then(
      (blob) => setState({ image: blob, url: URL.createObjectURL(blob) }),
      (e: Error) => setState({ error: e.message }),
    )
  }

  return (
    <div className="share-view">
      <div className="share-list">
        <div className="share-inner">
          <div className="share-top">
            <span>Pick what to share</span>
            <button
              type="button"
              className="text-btn"
              onClick={() => setOff(allOn ? new Set(segs.map((s) => s.key)) : new Set())}
            >
              {allOn ? "Select none" : "Select all"}
            </button>
          </div>
          {segs.length === 0 && <div className="empty">Nothing to share yet.</div>}
          {segs.map((s) => {
            const on = !off.has(s.key)
            return (
              <div key={s.key} className={"share-seg" + (on ? " on" : "")} onClick={() => flip(s.key)}>
                <button type="button" className="share-check" aria-pressed={on} title={on ? "Leave out" : "Include"}>
                  {on ? <CircleCheck /> : <Circle />}
                </button>
                <div className="share-body">
                  {s.user && (
                    <div className="share-user">
                      <div className="bubble user">{s.user}</div>
                    </div>
                  )}
                  {s.replies.map((r, i) => (
                    <div key={i} className="bubble assistant">
                      <Markdown text={r} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="share-bar-wrap">
        <div className="share-bar">
          <button type="button" className="share-cancel" onClick={onClose}>
            Cancel
          </button>
          <span className="share-count">
            {typeof state === "object" && "error" in state ? (
              <span className="failed">{state.error}</span>
            ) : (
              `${picked.length} of ${segs.length}`
            )}
          </span>
          <button type="button" className="share-go" disabled={picked.length === 0 || state === "making"} onClick={go}>
            <ShareIcon />
            {state === "making" ? "Drawing…" : "Share image"}
          </button>
        </div>
      </div>

      {image && (
        <ShareDialog
          title={title}
          image={image.image}
          url={image.url}
          onBack={() => setState("idle")}
          onDone={onClose}
        />
      )}
    </div>
  )
}

/** ChatGPT's share dialog, for an image: a preview card, then round buttons. */
function ShareDialog({
  title,
  image,
  url,
  onBack,
  onDone,
}: {
  title: string
  image: Blob
  url: string
  onBack: () => void
  onDone: () => void
}) {
  const [said, setSaid] = useState<string | null>(null)
  const file = useMemo(() => new File([image], `${safeName(title) || "Loom"}.png`, { type: "image/png" }), [image, title])
  const canShare = !!navigator.canShare?.({ files: [file] })
  const canCopy = typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write

  const flash = (text: string) => {
    setSaid(text)
    setTimeout(() => setSaid((s) => (s === text ? null : s)), 1600)
  }

  const share = () =>
    navigator.share({ files: [file] }).then(onDone, (e: Error) => {
      if (e.name !== "AbortError") flash(e.message)
    })
  const save = () => {
    saveFile(file)
    flash("Saved")
  }
  const copy = () =>
    navigator.clipboard.write([new ClipboardItem({ "image/png": image })]).then(
      () => flash("Copied"),
      () => flash("Could not copy"),
    )

  return createPortal(
    <div className="share-scrim" onClick={onBack}>
      <div className="share-dialog" role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-head">
          <span className="share-dialog-title">{title}</span>
          <button type="button" className="icon-btn" title="Back" onClick={onBack}>
            <X />
          </button>
        </div>
        <div className="share-preview">
          <img src={url} alt="The conversation as an image" />
        </div>
        <div className="share-actions">
          {canShare && <Action icon={<ShareIcon />} label="Share" onClick={share} />}
          <Action icon={<Download />} label="Save image" onClick={save} />
          {canCopy && <Action icon={<Copy />} label="Copy image" onClick={copy} />}
        </div>
        <div className="share-said" aria-live="polite">{said ?? " "}</div>
      </div>
    </div>,
    document.body,
  )
}

function Action({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="share-action" onClick={onClick}>
      <span className="share-action-icon">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function ImageDoc({ title, segs }: { title: string; segs: Segment[] }) {
  const first = segs.find((s) => s.at)?.at
  const date = new Date(first ?? Date.now()).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  return (
    <article className="img">
      <header className="img-head">
        <h1>{title}</h1>
        <div className="img-date">{date}</div>
      </header>
      {segs.map((s) => (
        <section key={s.key} className="img-seg">
          {s.user && (
            <div className="img-user">
              <div className="img-bubble">{s.user}</div>
            </div>
          )}
          {s.replies.map((r, i) => (
            <div key={i} className="img-reply">
              <Markdown text={r} />
            </div>
          ))}
        </section>
      ))}
      <footer className="img-foot">Loom</footer>
    </article>
  )
}

function renderPage(node: ReactNode): string {
  const host = document.createElement("div")
  const root = createRoot(host)
  flushSync(() => root.render(node))
  const html = host.innerHTML
  root.unmount()
  return html
}

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").trim().slice(0, 60)
}

function saveFile(file: File) {
  const href = URL.createObjectURL(file)
  const a = document.createElement("a")
  a.href = href
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

// The drawn image: ChatGPT's light chat, a phone wide (440 CSS px, set by
// `Loom.Snapshot`). Its own stylesheet — the app's is not there.
const IMAGE_CSS = `
* { box-sizing: border-box; }
body { background: #fff; color: #0d0d0d; font: 15px/1.65 -apple-system, "Helvetica Neue", Arial, "Liberation Sans", "PingFang SC", "Noto Sans CJK SC", sans-serif; -webkit-font-smoothing: antialiased; }
code, pre { font-family: "SF Mono", Menlo, "DejaVu Sans Mono", "Noto Sans Mono CJK SC", monospace; font-size: 12.5px; }
.img { padding: 28px 22px 20px; }
.img-head { margin-bottom: 22px; }
.img-head h1 { font-size: 20px; line-height: 1.35; margin: 0 0 4px; font-weight: 600; }
.img-date { color: #8f8f8f; font-size: 12.5px; }
.img-seg { margin-bottom: 22px; }
.img-user { display: flex; justify-content: flex-end; margin-bottom: 14px; }
.img-bubble { max-width: 82%; background: #f4f4f4; border-radius: 18px; padding: 9px 15px; white-space: pre-wrap; word-break: break-word; }
.img-reply { word-break: break-word; margin-bottom: 8px; }
.img-foot { border-top: 1px solid #ececec; padding-top: 12px; color: #8f8f8f; font-size: 12.5px; font-weight: 600; letter-spacing: 0.04em; text-align: center; }
.md-h { line-height: 1.4; margin: 16px 0 6px; }
h1.md-h { font-size: 18px; } h2.md-h { font-size: 16.5px; } h3.md-h { font-size: 15.5px; }
.md-p { margin: 0 0 10px; }
.md-list { margin: 0 0 10px; padding-left: 22px; }
.md-list li { margin: 3px 0; }
.md-task { list-style: none; }
.md-check svg { width: 14px; height: 14px; vertical-align: -2px; margin-right: 4px; }
.md-quote { margin: 0 0 10px; padding-left: 12px; border-left: 3px solid #d9d9d9; color: #4a4a4a; }
.md-code { background: #ececec; border-radius: 4px; padding: 1px 4px; }
.code-block { background: #f7f7f7; border-radius: 10px; margin: 0 0 10px; }
.code-block pre { margin: 0; padding: 10px 12px; white-space: pre-wrap; word-break: break-all; }
.code-tools, .code-copy, .msg-copy { display: none; }
.md-table-wrap { margin: 0 0 10px; }
.md-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.md-table th, .md-table td { border: 1px solid #e3e3e3; padding: 4px 7px; text-align: left; vertical-align: top; }
.md-table th { background: #f7f7f7; }
.md-hr { border: 0; border-top: 1px solid #ececec; margin: 14px 0; }
a, .md-download { color: #2964aa; text-decoration: none; }
.md-image { color: #8f8f8f; }
`

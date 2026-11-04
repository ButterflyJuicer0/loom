import { Check, Circle, CircleCheck, FileText, Share as ShareIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import {
  attachmentUrl,
  fetchBlob,
  isThumbnail,
  outputUrl,
  printPdf,
  zipUrl,
  type AgentFile,
  type OutputFile,
} from "./api"
import type { TimelineItem } from "./agent"
import { formatBytes } from "./format"
import { Markdown } from "./markdown"
import "./Share.css"

/**
 * "Share…" in the chat's menu: the conversation as exchanges (a message and
 * what came back), all picked to start with, tool calls and thinking left
 * out. Untick what should not go; "Share PDF" prints the rest on the server
 * (`Loom.Pdf`) and hands it, with the picked output files, to the system's
 * share sheet — or downloads them where there is none.
 *
 * Images the agent made, and those the user sent, are inlined in the PDF;
 * other outputs travel beside it as files (a directory as a zip).
 */

type UserItem = Extract<TimelineItem, { kind: "user" }>

export type Segment = {
  key: string
  user: UserItem | null
  replies: string[]
  outputs: OutputFile[]
}

/** The timeline as exchanges: each user message with the replies and outputs after it. */
export function segments(items: TimelineItem[]): Segment[] {
  const out: Segment[] = []
  let cur: Segment | null = null
  const fresh = (key: string, user: UserItem | null): Segment => {
    const s = { key, user, replies: [], outputs: [] }
    out.push(s)
    return s
  }
  for (const item of items) {
    if (item.kind === "user") {
      if (item.pending || item.failed) continue
      cur = fresh(item.key, item)
    } else if (item.kind === "assistant") {
      const text = item.text.trim()
      if (!text || text === "·") continue
      ;(cur ??= fresh(item.key, null)).replies.push(item.text)
    } else if (item.kind === "outputs") {
      const seg = (cur ??= fresh(item.key, null))
      for (const f of item.files) {
        seg.outputs = seg.outputs.filter((o) => o.path !== f.path)
        seg.outputs.push(f)
      }
    }
  }
  return out.filter((s) => (s.user && (s.user.text.trim() || s.user.files.length)) || s.replies.length || s.outputs.length)
}

const fileKey = (seg: Segment, f: { path: string }) => `${seg.key}|${f.path}`
const nameOf = (path: string) => path.split("/").pop() ?? path
const imageOutput = (f: OutputFile) => f.kind !== "dir" && isThumbnail(f.content_type)

type State = "idle" | "making" | { ready: File[] } | { error: string }

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
  const [offSegs, setOffSegs] = useState<Set<string>>(new Set())
  const [offFiles, setOffFiles] = useState<Set<string>>(new Set())
  const [state, setState] = useState<State>("idle")

  const picked = segs.filter((s) => !offSegs.has(s.key))
  const files = picked.flatMap((s) => s.outputs.filter((f) => !offFiles.has(fileKey(s, f))).map((f) => ({ seg: s, f })))
  const allOn = picked.length === segs.length

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  const make = async (): Promise<File[]> => {
    const chosen = picked.map((s) => ({
      ...s,
      outputs: s.outputs.filter((f) => !offFiles.has(fileKey(s, f))),
    }))
    // Images, inlined: the page may not reach the network.
    const images = new Map<string, string>()
    const urls: string[] = []
    for (const s of chosen) {
      for (const f of s.user?.files ?? []) if (isThumbnail(f.content_type)) urls.push(attachmentUrl(sessionId, f.path))
      for (const f of s.outputs) if (imageOutput(f)) urls.push(outputUrl(sessionId, f.path))
    }
    await Promise.all(
      urls.map(async (url) => {
        const blob = await fetchBlob(url).catch(() => null)
        if (blob && blob.size < 12_000_000) images.set(url, await dataUrl(blob))
      }),
    )

    const html = renderPage(
      <PdfDoc title={title} segs={chosen} sessionId={sessionId} images={images} />,
    )
    const pdf = await printPdf(sessionId, html, PDF_CSS, title)
    const base = safeName(title) || "Loom"
    const out = [new File([pdf], `${base}.pdf`, { type: "application/pdf" })]

    // The other outputs ride along as they are; images are in the PDF already.
    const taken = new Set<string>()
    for (const s of chosen) {
      for (const f of s.outputs) {
        if (imageOutput(f) || taken.has(f.path)) continue
        taken.add(f.path)
        const dir = f.kind === "dir"
        const blob = await fetchBlob(dir ? zipUrl(sessionId, f.path) : outputUrl(sessionId, f.path))
        const name = nameOf(f.path) + (dir ? ".zip" : "")
        out.push(new File([blob], name, { type: dir ? "application/zip" : blob.type || "application/octet-stream" }))
      }
    }
    return out
  }

  const share = async (ready: File[]) => {
    if (navigator.canShare?.({ files: ready })) {
      try {
        await navigator.share({ files: ready, title })
        onClose()
      } catch (e) {
        const name = (e as Error).name
        // Cancelled: stay, ready to try again. Not allowed: the tap's
        // permission ran out while the PDF was made — one more tap shares.
        if (name === "AbortError" || name === "NotAllowedError") setState({ ready })
        else setState({ error: (e as Error).message })
      }
    } else {
      ready.forEach(saveFile)
      onClose()
    }
  }

  const go = () => {
    if (state === "making") return
    if (typeof state === "object" && "ready" in state) return void share(state.ready)
    setState("making")
    make().then(
      (ready) => {
        setState({ ready })
        return share(ready)
      },
      (e: Error) => setState({ error: e.message }),
    )
  }

  // Changing the pick makes the prepared files stale.
  const repick = (fn: () => void) => {
    fn()
    if (state !== "making") setState("idle")
  }

  const ready = typeof state === "object" && "ready" in state
  const count = `${picked.length} of ${segs.length}` + (files.length ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : "")

  return (
    <div className="share-view">
      <div className="share-list">
        <div className="share-inner">
          <div className="share-top">
            <span>Pick what to share</span>
            <button
              type="button"
              className="text-btn"
              onClick={() => repick(() => setOffSegs(allOn ? new Set(segs.map((s) => s.key)) : new Set()))}
            >
              {allOn ? "Select none" : "Select all"}
            </button>
          </div>
          {segs.length === 0 && <div className="empty">Nothing to share yet.</div>}
          {segs.map((s) => {
            const on = !offSegs.has(s.key)
            return (
              <div key={s.key} className={"share-seg" + (on ? " on" : "")}>
                <button
                  type="button"
                  className="share-check"
                  aria-pressed={on}
                  title={on ? "Leave out" : "Include"}
                  onClick={() => repick(() => setOffSegs((x) => toggle(x, s.key)))}
                >
                  {on ? <CircleCheck /> : <Circle />}
                </button>
                <div className="share-body" onClick={() => repick(() => setOffSegs((x) => toggle(x, s.key)))}>
                  {s.user && s.user.text.trim() !== "" && (
                    <div className="share-user">
                      <div className="bubble user">{s.user.text}</div>
                    </div>
                  )}
                  {s.replies.map((r, i) => (
                    <div key={i} className="bubble assistant">
                      <Markdown text={r} />
                    </div>
                  ))}
                  {s.outputs.length > 0 && (
                    <div className="share-files">
                      {s.outputs.map((f) => {
                        const fon = on && !offFiles.has(fileKey(s, f))
                        return (
                          <button
                            key={f.path}
                            type="button"
                            className={"share-file" + (fon ? " on" : "")}
                            disabled={!on}
                            aria-pressed={fon}
                            onClick={(e) => {
                              e.stopPropagation()
                              repick(() => setOffFiles((x) => toggle(x, fileKey(s, f))))
                            }}
                          >
                            {fon ? <Check /> : <FileText />}
                            <span className="share-file-name">{nameOf(f.path)}{f.kind === "dir" ? ".zip" : ""}</span>
                            <span className="file-size">{imageOutput(f) ? "in PDF" : formatBytes(f.size)}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
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
            {typeof state === "object" && "error" in state ? <span className="failed">{state.error}</span> : count}
          </span>
          <button
            type="button"
            className="share-go"
            disabled={picked.length === 0 || state === "making"}
            onClick={go}
          >
            <ShareIcon />
            {state === "making" ? "Making…" : ready ? "Share" : "Share PDF"}
          </button>
        </div>
      </div>
    </div>
  )
}

function PdfDoc({
  title,
  segs,
  sessionId,
  images,
}: {
  title: string
  segs: Segment[]
  sessionId: string
  images: Map<string, string>
}) {
  const first = segs.find((s) => s.user?.at)?.user?.at
  const date = new Date(first ?? Date.now()).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  return (
    <article>
      <header className="pdf-head">
        <h1>{title}</h1>
        <div className="pdf-date">{date}</div>
      </header>
      {segs.map((s) => (
        <section key={s.key} className="pdf-seg">
          {s.user && (s.user.text.trim() !== "" || s.user.files.length > 0) && (
            <div className="pdf-user">
              <div className="pdf-bubble">
                {s.user.text.trim() !== "" && <div className="pdf-text">{s.user.text}</div>}
                {s.user.files.map((f) => (
                  <Attachment key={f.path} file={f} src={images.get(attachmentUrl(sessionId, f.path))} />
                ))}
              </div>
            </div>
          )}
          {s.replies.map((r, i) => (
            <div key={i} className="pdf-reply">
              <Markdown text={r} />
            </div>
          ))}
          {s.outputs.map((f) => {
            const src = imageOutput(f) ? images.get(outputUrl(sessionId, f.path)) : undefined
            return src ? (
              <figure key={f.path} className="pdf-figure">
                <img src={src} alt="" />
                <figcaption>{nameOf(f.path)}</figcaption>
              </figure>
            ) : (
              <div key={f.path} className="pdf-file">
                📎 {nameOf(f.path)}
                {f.kind === "dir" ? ".zip" : ""} · {formatBytes(f.size)}
              </div>
            )
          })}
        </section>
      ))}
    </article>
  )
}

function Attachment({ file, src }: { file: AgentFile; src?: string }) {
  return src ? <img className="pdf-attach" src={src} alt="" /> : <div className="pdf-file">📎 {file.name}</div>
}

function renderPage(node: React.ReactNode): string {
  const host = document.createElement("div")
  const root = createRoot(host)
  flushSync(() => root.render(node))
  const html = host.innerHTML
  root.unmount()
  return html
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|\n\r\t]+/g, " ").trim().slice(0, 60)
}

function saveFile(file: File) {
  // Opaque bytes, as every download here: see `download` in api.ts.
  const href = URL.createObjectURL(new Blob([file], { type: "application/octet-stream" }))
  const a = document.createElement("a")
  a.href = href
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

// The printed page: plain, black on white, A4. Its own stylesheet — the app's
// is not there when Chrome prints.
const PDF_CSS = `
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #0d0d0d; font: 10.5pt/1.6 -apple-system, "Helvetica Neue", Arial, "Liberation Sans", "PingFang SC", "Noto Sans CJK SC", sans-serif; }
code, pre { font-family: "DejaVu Sans Mono", "Noto Sans Mono CJK SC", monospace; font-size: 9pt; }
.pdf-head { border-bottom: 1px solid #e5e5e5; padding-bottom: 8pt; margin-bottom: 14pt; }
.pdf-head h1 { font-size: 17pt; margin: 0 0 2pt; line-height: 1.3; }
.pdf-date { color: #6b6b6b; font-size: 9pt; }
.pdf-seg { margin-bottom: 14pt; }
.pdf-user { display: flex; justify-content: flex-end; margin-bottom: 8pt; break-inside: avoid; }
.pdf-bubble { max-width: 80%; background: #f2f2f2; border-radius: 14pt; padding: 7pt 11pt; }
.pdf-text { white-space: pre-wrap; word-break: break-word; }
.pdf-attach { display: block; max-width: 100%; max-height: 60mm; border-radius: 6pt; margin-top: 5pt; }
.pdf-reply { margin-bottom: 8pt; word-break: break-word; }
.pdf-figure { margin: 6pt 0 10pt; break-inside: avoid; }
.pdf-figure img { display: block; max-width: 100%; max-height: 200mm; border-radius: 4pt; }
.pdf-figure figcaption, .pdf-file { color: #6b6b6b; font-size: 9pt; margin-top: 3pt; }
.pdf-file { margin: 4pt 0; }
.md-h { line-height: 1.35; margin: 12pt 0 5pt; break-after: avoid; }
h1.md-h { font-size: 14pt; } h2.md-h { font-size: 12.5pt; } h3.md-h { font-size: 11pt; }
.md-p { margin: 0 0 7pt; }
.md-list { margin: 0 0 7pt; padding-left: 18pt; }
.md-list li { margin: 2pt 0; }
.md-task { list-style: none; }
.md-check svg { width: 10pt; height: 10pt; vertical-align: -1pt; margin-right: 3pt; }
.md-quote { margin: 0 0 7pt; padding-left: 10pt; border-left: 2.5pt solid #d0d0d0; color: #444; }
.md-code { background: #f2f2f2; border-radius: 3pt; padding: 0.5pt 3pt; }
.code-block { background: #f6f6f6; border: 1px solid #e8e8e8; border-radius: 6pt; margin: 0 0 8pt; }
.code-block pre, .pdf-text pre { margin: 0; padding: 7pt 9pt; white-space: pre-wrap; word-break: break-all; }
.code-tools, .code-copy, .msg-copy, button svg { display: none; }
.md-table-wrap { margin: 0 0 8pt; }
.md-table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
.md-table th, .md-table td { border: 1px solid #ddd; padding: 3pt 6pt; text-align: left; vertical-align: top; }
.md-table th { background: #f6f6f6; }
tr { break-inside: avoid; }
.md-hr { border: 0; border-top: 1px solid #e5e5e5; margin: 10pt 0; }
a { color: #2964aa; text-decoration: none; }
.md-image { color: #6b6b6b; }
`

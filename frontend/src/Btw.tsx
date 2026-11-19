import { ArrowUp, MessageCircleQuestion, Square, Trash2, X } from "lucide-react"
import { useEffect, useLayoutEffect, useRef } from "react"
import type { BtwItem } from "./api"
import { splitReplies } from "./agent"
import { t } from "./i18n"
import { isComposing } from "./ime"
import { Markdown } from "./markdown"
import "./Btw.css"

const MAX_LINES = 4

/**
 * Beside the thinking level: opens the side questions. Lit while the panel is
 * open or holds something, with a dot while an answer is on its way — which
 * is how a closed panel says it is still at work.
 */
export function BtwButton({
  open,
  count,
  answering,
  onToggle,
}: {
  open: boolean
  count: number
  answering: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={"composer-btn btw-btn" + (open ? " open" : "") + (count > 0 ? " set" : "")}
      title={t("BTW: ask on the side — the turn carries on")}
      aria-pressed={open}
      onClick={onToggle}
    >
      <MessageCircleQuestion />
      {answering && <i className="btw-btn-dot" aria-hidden />}
    </button>
  )
}

/**
 * BTW: questions asked on the side of a session. Each goes to a copy of the
 * conversation as it stands — the turn under way included — which answers
 * once; the turn carries on and nothing here joins the conversation (see
 * `Loom.Agent.Btw`). Above the composer, with an input of its own, so that
 * what is typed here cannot be taken for a message to the agent.
 */
export function BtwPanel({
  items,
  answering,
  error,
  text,
  setText,
  focus,
  onAsk,
  onStop,
  onClear,
  onClose,
}: {
  items: BtwItem[]
  answering: boolean
  // Why the last request was refused, if it was.
  error: string | null
  // Held by the chat: a question that could not be asked comes back here.
  text: string
  setText: (text: string) => void
  // Opened to type in, rather than by a question already on its way.
  focus: boolean
  onAsk: (text: string) => void
  onStop: () => void
  onClear: () => void
  onClose: () => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)

  // Follows the answer as it grows, unless the reader has scrolled up.
  const stuck = useRef(true)
  useLayoutEffect(() => {
    const el = list.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, [items])
  // A new question is where the reader wants to be.
  useLayoutEffect(() => {
    stuck.current = true
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length])

  useEffect(() => {
    if (focus && !matchMedia("(pointer: coarse)").matches) input.current?.focus()
  }, [focus])

  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = "auto"
    const style = getComputedStyle(el)
    const line = parseFloat(style.lineHeight)
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    el.style.height = Math.min(el.scrollHeight - padding, line * MAX_LINES) + padding + "px"
  }, [text])

  const sendable = text.trim() !== "" && !answering
  const send = () => {
    if (sendable) onAsk(text.trim())
  }

  return (
    <section className="btw-panel" aria-label={t("Side questions")}>
      <header className="btw-head">
        <MessageCircleQuestion />
        <span className="btw-title">BTW</span>
        <span className="btw-hint">{t("asked on the side — the turn carries on, and none of this joins the conversation")}</span>
        {items.length > 0 && (
          <button type="button" className="btw-icon" title={t("Clear the side questions")} onClick={onClear}>
            <Trash2 />
          </button>
        )}
        <button type="button" className="btw-icon" title={t("Close")} onClick={onClose}>
          <X />
        </button>
      </header>

      {items.length > 0 && (
        <div
          className="btw-list"
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget
            stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          {items.map((it) => (
            <Answer key={it.id} item={it} />
          ))}
        </div>
      )}

      {error && <div className="btw-note error">{error}</div>}

      <div className="btw-ask">
        <textarea
          ref={input}
          className="btw-input"
          value={text}
          rows={1}
          enterKeyHint="send"
          placeholder={
            items.length > 0 ? t("Ask another on the side…") : t("Ask on the side: what is it doing, why, what does that mean…")
          }
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isComposing(e) && !composing.current) {
              e.preventDefault()
              onClose()
              return
            }
            // As in the composer: Enter asks, Shift+Enter is a new line, and on
            // a touch screen return is a new line and the button asks.
            if (e.key !== "Enter" || e.shiftKey) return
            if (isComposing(e) || composing.current) return
            if (matchMedia("(pointer: coarse)").matches) return
            e.preventDefault()
            send()
          }}
        />
        {answering ? (
          <button type="button" className="composer-btn stop" title={t("Stop this answer")} onClick={onStop}>
            <Square fill="currentColor" />
          </button>
        ) : (
          <button type="button" className="composer-btn send" title={t("Ask on the side")} disabled={!sendable} onClick={send}>
            <ArrowUp />
          </button>
        )}
      </div>
    </section>
  )
}

function Answer({ item }: { item: BtwItem }) {
  // A copy answers as the agent would, suggested replies and all; they are
  // for the conversation, which this is not.
  const answer = splitReplies(item.answer).text
  return (
    <div className="btw-item">
      <div className="btw-q">{item.question}</div>
      {answer.trim() !== "" ? (
        <div className="btw-a">
          <Markdown text={answer} />
        </div>
      ) : (
        item.status === "answering" && (
          <div className="working running" role="status">
            <span className="working-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="shimmer">{t("Reading the conversation…")}</span>
          </div>
        )
      )}
      {item.status === "stopped" && <div className="btw-note">{t("Stopped")}</div>}
      {item.status === "error" && (
        <div className="btw-note error">{item.error || t("It could not be answered")}</div>
      )}
    </div>
  )
}

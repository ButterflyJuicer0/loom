import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Clock as ClockIcon,
  CornerDownRight,
  Ellipsis,
  Forward,
  HatGlasses,
  Inbox,
  Merge,
  Moon,
  PanelLeft,
  Plus,
  RotateCw,
  Square,
  SquareTerminal,
  X,
} from "lucide-react"
import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { Grabber } from "./Switcher"
import { createPortal } from "react-dom"
import { EffortButton } from "./Effort"
import { ModelList, modelLabel } from "./Model"
import { Card as NoticeCard } from "./Notices"
import {
  applySnapshot,
  buildTimeline,
  currentReplies,
  emptyTranscript,
  foldFinished,
  isBusy,
  type CronJob,
  type Question,
  type Snapshot,
  type TimelineItem,
} from "./agent"
import { getSocket } from "./socket"
import { itemForAttachment, itemForOutput, itemForPath, type CanvasItem } from "./canvasItems"
import { BackendIcon } from "./BackendIcon"
import { formatBytes } from "./format"
import { isComposing } from "./ime"
import { Markdown, MessageCopy, OutputLink } from "./markdown"
import { useNarrow } from "./useNarrow"
import { useAgent } from "./useAgent"
import { useDraft } from "./useDraft"
import {
  useAttachments,
  useFileDrop,
  type Attachment,
  type Attachments,
  type LocalFile,
} from "./useAttachments"
import {
  attachmentUrl,
  blobUrl,
  isThumbnail,
  downloadAgentOutput,
  downloadAgentZip,
  downloadAttachment,
  modelName,
  outputUrl,
  type AgentFile,
  type AgentInfo,
  type Notice,
  type OutputFile,
} from "./api"
import "./Chat.css"

type Props = {
  session: AgentInfo
  sidebarOpen: boolean
  onToggleSidebar: () => void
  terminalOpen: boolean
  terminalCount: number
  onToggleTerminal: () => void
  canvasOpen: boolean
  onToggleCanvas: () => void
  onOpenCanvas: (item: CanvasItem) => void
  // A turn left outputs (their top-level paths), or a message brought
  // attachments (no paths).
  onFilesChanged: (outputs: string[]) => void
  // Beside the title: the sleep session's tabs (see `Sleep.tsx`).
  tabs?: ReactNode
  // Under the header, across the whole column: a virtual employee's tabs and
  // where it stands (see `Employees.tsx`).
  subhead?: ReactNode
  // No header: the chat inside another pane, the bell's (see `Notices.tsx`).
  bare?: boolean
  // Earlier sessions of the same thread, newest first, shown above this one a
  // day at a time: a virtual employee's work (see `Employees.tsx`).
  earlier?: string[]
  // Read up to here, from any device; clears the sidebar's unread mark. Only
  // for a plain conversation: the sleep and employee pages keep their own.
  onSeen?: (seq: number) => void
  // Whether the chat is what is on screen: not under the phone's drawer or a
  // pane over it.
  reading?: boolean
  // A notice from the bell that was opened here: the conversation goes to the
  // turn it came from, and shows it under that turn to be answered.
  focus?: { notice: Notice; onAnswered: (n: Notice) => void } | null
  // Carry it on in a new session ("Continue in a new chat"), offered under a
  // turn that ended in an error. Only for a plain conversation.
  onContinue?: () => Promise<void>
  /** Set only for an incognito session: pin it (it stays incognito), or keep it, into Recents. */
  incognito?: { pinned: boolean; onPin: (pinned: boolean) => void; onKeep: () => void }
  // The project it is in: "‹ name" before the title goes back to its page.
  project?: { name: string; onOpen: () => void }
  // On a phone with sessions in Working: the line under the composer that
  // opens the switcher (Switcher.tsx).
  onSwitch?: () => void
}

// How a card or link deep in the transcript opens something in the canvas.
const OpenCanvas = createContext<(item: CanvasItem) => void>(() => {})

// What a message that did not get through can do: be sent again, or let go.
const Unsent = createContext<{ resend: (id: string) => void; discard: (id: string) => void }>({
  resend: () => {},
  discard: () => {},
})

export function Chat({
  session,
  sidebarOpen,
  onToggleSidebar,
  terminalOpen,
  terminalCount,
  onToggleTerminal,
  canvasOpen,
  onToggleCanvas,
  onOpenCanvas,
  onFilesChanged,
  tabs,
  subhead,
  earlier,
  bare = false,
  onSeen,
  reading = true,
  focus,
  onContinue,
  incognito,
  project,
  onSwitch,
}: Props) {
  const { transcript, joinError, submit, resend, discard, interrupt, dropQueued, rename, draft: remoteDraft } = useAgent(
    session.id,
    (event) => {
      if (event.kind === "output_files") {
        const files = (event.payload.files as OutputFile[] | undefined) ?? []
        onFilesChanged(files.map((f) => f.path))
      } else if (event.kind === "user") onFilesChanged([])
      // A turn that just built a page opens it — only then, and only for the
      // page. Anything else waits for a click.
      const open = event.kind === "output_files" ? event.payload.open : null
      if (typeof open === "string") {
        const item = itemForPath(open)
        if (item) onOpenCanvas(item)
      }
    },
  )
  const busy = isBusy(transcript)
  const thread = earlier ?? session.earlier ?? []
  // At the end of the transcript, where the newest reply is.
  const [atEnd, setAtEnd] = useState(true)
  const pageVisible = usePageVisible()
  const replySeq = session.reply_seq ?? 0
  const seenSeq = session.seen_seq ?? 0
  // Each seq once, while the summary that says so is on its way back.
  const sentSeqRef = useRef(0)
  // Read means seen: the page in front, this chat on it, scrolled to the end.
  useEffect(() => {
    if (!onSeen || !reading || !pageVisible || !atEnd) return
    if (replySeq <= seenSeq || replySeq <= sentSeqRef.current) return
    sentSeqRef.current = replySeq
    onSeen(replySeq)
  }, [onSeen, reading, pageVisible, atEnd, replySeq, seenSeq])
  // Kept while the transcript is: the timeline follows the end whenever the
  // items change, so a fresh array on every render (the app's keys re-render
  // it) would pull it back down just after `gg` or `k` scrolled it up.
  const items = useMemo(() => foldFinished(buildTimeline(transcript), busy), [transcript, busy])
  const replies = useMemo(() => (busy ? null : currentReplies(items)), [items, busy])
  const [draft, setDraft] = useDraft(session.id, remoteDraft)
  const narrow = useNarrow()

  // Stable, because a context change re-renders every message that links a
  // file — memoised or not — and this would otherwise change with each delta.
  const renderOutput = useCallback(
    (path: string, label: ReactNode) => {
      const item = itemForPath(path)
      return item ? (
        <button type="button" className="md-download" title={`Show ${path}`} onClick={() => onOpenCanvas(item)}>
          {label}
        </button>
      ) : (
        <DownloadLink sessionId={session.id} path={path} label={label} />
      )
    },
    [session.id, onOpenCanvas],
  )

  const attachments = useAttachments(session.id)
  // Dropping is accepted anywhere in the conversation, not just on the
  // composer: by the time you have dragged a screenshot this far, aiming at a
  // 40-pixel target is the last thing you want to do.
  const drop = useFileDrop(attachments.add)

  const send = (text: string) => {
    submit(text, attachments.ready)
    attachments.clear()
    setDraft("")
  }

  // The composer floats over the end of the conversation, which has to leave
  // room for it — however tall it has grown.
  // So does the header over its start. A reader at the end stays there as
  // the composer grows.
  const chatRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const dock = dockRef.current
    const top = topRef.current
    const chat = chatRef.current
    if (!dock || !top || !chat) return
    const set = () => {
      const timeline = chat.querySelector<HTMLElement>(".timeline")
      const atEnd =
        timeline && timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 80
      chat.style.setProperty("--dock-h", dock.offsetHeight + "px")
      chat.style.setProperty("--top-h", top.offsetHeight + "px")
      if (timeline && atEnd) timeline.scrollTop = timeline.scrollHeight
    }
    set()
    const observer = new ResizeObserver(set)
    observer.observe(dock)
    observer.observe(top)
    return () => observer.disconnect()
  }, [])
  const unsent = useMemo(() => ({ resend, discard }), [resend, discard])

  return (
    <div
      ref={chatRef}
      className={"chat" + (bare ? " bare" : "") + (drop.dragging ? " dragging" : "")}
      {...drop.handlers}
    >
      {drop.dragging && (
        <div className="drop-note">drop to attach to this conversation</div>
      )}

      <div className="chat-top" ref={topRef}>
      {!bare && (
      <header className="chat-header">
        {!sidebarOpen && (
          <button
            className={"icon-btn" + (narrow ? " glass" : "")}
            onClick={onToggleSidebar}
            title="Show sidebar"
          >
            {narrow ? <TwoLines /> : <PanelLeft />}
          </button>
        )}

        {project && (
          <button className="chat-project" onClick={project.onOpen} title={`Back to ${project.name}`}>
            <ChevronLeft />
            <span>{project.name}</span>
          </button>
        )}
        <Title
          title={session.title ?? session.id}
          backend={session.backend}
          backendLabel={session.backend_label}
          onRename={rename}
        />
        {tabs}
        {incognito && <PinChip pinned={incognito.pinned} onPin={incognito.onPin} />}

        <div className="chat-meta">
          {narrow ? (
            <PaneMenu
              session={session}
              terminalOpen={terminalOpen}
              terminalCount={terminalCount}
              onToggleTerminal={onToggleTerminal}
              canvasOpen={canvasOpen}
              onToggleCanvas={onToggleCanvas}
              onContinue={onContinue}
              onKeep={incognito?.onKeep}
            />
          ) : (
            <>
          <button
            className={"chip button terminal-toggle" + (terminalOpen ? " on" : "")}
            onClick={onToggleTerminal}
            title={
              (terminalOpen ? "Hide" : "Show") +
              ` terminals — ${terminalCount || "none"} running` +
              " (they open in your home directory)"
            }
          >
            <SquareTerminal />
            {terminalCount > 0 && <span className="count">{terminalCount}</span>}
          </button>
          <button
            className={"chip button canvas-toggle" + (canvasOpen ? " on" : "")}
            onClick={onToggleCanvas}
            title={(canvasOpen ? "Hide" : "Show") + " the canvas"}
          >
            <AppWindow />
          </button>
          {/* The rest, as on a phone: the model, continuing, keeping. */}
          <PaneMenu
            session={session}
            panes={false}
            terminalOpen={terminalOpen}
            terminalCount={terminalCount}
            onToggleTerminal={onToggleTerminal}
            canvasOpen={canvasOpen}
            onToggleCanvas={onToggleCanvas}
            onContinue={onContinue}
            onKeep={incognito?.onKeep}
          />
            </>
          )}
        </div>
      </header>
      )}
      {subhead}

      {joinError && <div className="chat-banner">{joinError}</div>}
      {session.flagged_at && (
        <div className="chat-banner flagged continue-row">
          {session.kind && session.kind !== "incognito" ? (
            "Stopped by a safety classifier; Loom goes on in a fresh session next time."
          ) : (
            <>
              Stopped by a safety classifier; later replies here may be too.
              {onContinue && !busy && <ContinueButton onContinue={onContinue} />}
            </>
          )}
        </div>
      )}
      </div>

      {/* `output/…` links in a reply become downloads from this session, and
          attachments, sent or about to be, open in the canvas. */}
      <OpenCanvas.Provider value={onOpenCanvas}>
        <Unsent.Provider value={unsent}>
        <OutputLink.Provider value={renderOutput}>
          <Timeline
            items={items}
            sessionId={session.id}
            truncatedBefore={transcript.truncatedBefore}
            before={
              thread.length > 0 && (
                // A fresh one, with nothing said yet, opens on the last.
                <EarlierDays ids={thread} currentAt={session.created_at} open={session.turns === 0} />
              )
            }
            onAnswer={submit}
            onAtEnd={setAtEnd}
            tail={<Working status={transcript.status} queued={transcript.queue.length} />}
            focus={
              focus && focus.notice.session === session.id
                ? {
                    id: focus.notice.id,
                    key: focus.notice.anchor != null ? `e${focus.notice.anchor}` : null,
                    node: <NoticeCard n={focus.notice} onAnswered={focus.onAnswered} />,
                  }
                : null
            }
            after={
              (!replies && onContinue && !busy && items[items.length - 1]?.kind === "error"
                ? { key: "continue", node: <ContinueButton onContinue={onContinue} /> }
                : null) ||
              (replies && {
                key: replies.key,
                node: replies.questions ? (
                  <QuestionCard
                    questions={replies.questions}
                    text={draft}
                    setText={setDraft}
                    onSend={() => send(draft.trim())}
                  />
                ) : (
                  <ReplyCard
                    replies={replies.replies ?? []}
                    text={draft}
                    setText={setDraft}
                    onSend={() => send(draft.trim())}
                  />
                ),
              })
            }
          />
        </OutputLink.Provider>
        </Unsent.Provider>

        <div className="dock" ref={dockRef}>
        {transcript.queue.length > 0 && (
          <QueuePanel
            messages={transcript.queue}
            interrupted={transcript.status === "interrupted"}
            onDrop={dropQueued}
          />
        )}

        <Composer
          busy={busy}
          interrupted={transcript.status === "interrupted"}
          attachments={attachments}
          onSubmit={send}
          onInterrupt={interrupt}
          tools={<EffortButton session={session} />}
          text={draft}
          setText={setDraft}
          under={onSwitch && <Grabber onOpen={onSwitch} />}
        />
        </div>
      </OpenCanvas.Provider>
    </div>
  )
}

/** Under a turn that ended in an error: carry the session on in a new one. */
/**
 * An incognito session says so beside its title, with a pin: pinned, it is
 * in the sidebar's Pinned and never deleted, and stays incognito. Keeping it
 * (into Recents) is under the header's "…" instead.
 */
function PinChip({ pinned, onPin }: { pinned: boolean; onPin: (pinned: boolean) => void }) {
  return (
    <button
      className="chip button keep-chip"
      onClick={() => onPin(!pinned)}
      title={
        pinned
          ? "Incognito, pinned: in Pinned, never deleted. Tap to unpin."
          : "Incognito: no memory, not in Recents, deleted 30 days after its last message. Tap to pin."
      }
    >
      <HatGlasses />
      <span>{pinned ? "Unpin" : "Pin"}</span>
    </button>
  )
}

function ContinueButton({ onContinue }: { onContinue: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "going" | string>("idle")
  return (
    <div className="continue-row">
      <button
        className="text-btn"
        disabled={state === "going"}
        onClick={() => {
          setState("going")
          onContinue().catch((e) => setState((e as Error).message))
        }}
      >
        <CornerDownRight /> Continue in a new chat
      </button>
      {state !== "idle" && state !== "going" && <span className="failed">{state}</span>}
    </div>
  )
}

/**
 * The replies the agent foresaw, under the reply that offered them, as ChatGPT
 * lays out its choices: one per row, any number picked, then sent.
 *
 * A reply is picked while it is a line of the message being written: picking
 * adds it as one, picking again takes that line out. So the message box shows
 * what will go, and whatever is typed around the picks stays.
 */
function ReplyCard({
  replies,
  text,
  setText,
  onSend,
}: {
  replies: string[]
  text: string
  setText: (text: string) => void
  onSend: () => void
}) {
  const lines = text.split("\n").map((l) => l.trim())
  const toggle = (reply: string) => {
    if (lines.includes(reply)) {
      setText(text.split("\n").filter((l) => l.trim() !== reply).join("\n").trim())
    } else {
      setText(text.trim() === "" ? reply : text.trimEnd() + "\n" + reply)
    }
  }
  const picked = replies.some((r) => lines.includes(r))

  return (
    <div className="replies" role="group" aria-label="Suggested replies">
      {replies.map((reply) => {
        const on = lines.includes(reply)
        return (
          <button
            key={reply}
            type="button"
            className={"reply" + (on ? " on" : "")}
            aria-pressed={on}
            onClick={() => toggle(reply)}
          >
            <span className="reply-text">{reply}</span>
            {on && <Check />}
          </button>
        )
      })}
      <button type="button" className="replies-send" disabled={!picked} onClick={onSend}>
        Send
      </button>
    </div>
  )
}

/**
 * Several things asked at once, one page each, the next a swipe or a Next
 * away: Claude Code's questions. What is picked is written into the message
 * box as numbered lines, one per question — `2. this、that` — which is also
 * where the card reads it back from, so a draft brought back by a reload
 * shows the same picks. Whatever else is typed stays below them.
 *
 * The pages are a scroller that snaps, rather than a transform: a finger
 * moves it natively, and the drawer's swipe leaves a touch alone while it
 * would scroll something (`useSwipe`).
 */
function QuestionCard({
  questions,
  text,
  setText,
  onSend,
}: {
  questions: Question[]
  text: string
  setText: (text: string) => void
  onSend: () => void
}) {
  const [page, setPage] = useState(0)
  const pagesRef = useRef<HTMLDivElement>(null)
  const sep = questions.some((q) => /[\u3000-\u9fff]/.test(q.title + q.options.join(""))) ? "、" : ", "
  const { picks, rest } = readAnswers(text, questions, sep)
  const last = questions.length - 1

  const go = (to: number) => {
    const el = pagesRef.current
    if (!el) return
    el.scrollTo({ left: to * el.clientWidth, behavior: "smooth" })
  }

  const write = (next: string[][]) => {
    const numbered = next.flatMap((p, i) => (p.length > 0 ? [`${i + 1}. ${p.join(sep)}`] : []))
    setText([...numbered, ...rest].join("\n"))
  }

  const pick = (qi: number, option: string) => {
    const q = questions[qi]
    const had = picks[qi].includes(option)
    const mine = q.multi
      ? had
        ? picks[qi].filter((o) => o !== option)
        : q.options.filter((o) => o === option || picks[qi].includes(o))
      : had
        ? []
        : [option]
    write(picks.map((p, i) => (i === qi ? mine : p)))
    // One answer and that is the question done: on to the next.
    if (!q.multi && !had && qi < last) setTimeout(() => go(qi + 1), 180)
  }

  const answered = picks.some((p) => p.length > 0)

  return (
    <div className="replies questions" role="group" aria-label="Questions">
      <div className="questions-head">
        <button
          type="button"
          className="questions-back"
          onClick={() => go(page - 1)}
          disabled={page === 0}
          aria-label="Previous question"
        >
          ‹ Back
        </button>
        <span className="questions-count">
          {page + 1}/{questions.length}
          {questions[page]?.multi && " · Pick any"}
        </span>
      </div>
      <div
        className="questions-pages"
        ref={pagesRef}
        onScroll={(e) => {
          const el = e.currentTarget
          setPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
        }}
      >
        {questions.map((q, qi) => (
          <div key={qi} className="qpage" inert={qi !== page} aria-hidden={qi !== page}>
            <div className="qpage-title">{q.title}</div>
            {q.options.map((option) => {
              const on = picks[qi].includes(option)
              return (
                <button
                  key={option}
                  type="button"
                  className={"reply" + (on ? " on" : "")}
                  aria-pressed={on}
                  onClick={() => pick(qi, option)}
                >
                  <span className="reply-text">{option}</span>
                  {on && <Check />}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {page < last ? (
        <button type="button" className="replies-send next" onClick={() => go(page + 1)}>
          Next
        </button>
      ) : (
        <button type="button" className="replies-send" disabled={!answered} onClick={onSend}>
          Send
        </button>
      )}
    </div>
  )
}

/**
 * The picks in the message box, per question, and the lines that are not
 * picks. A line counts as one only if it is a question's number and nothing
 * but that question's answers, so a numbered list typed by hand is left be.
 */
function readAnswers(
  text: string,
  questions: Question[],
  sep: string,
): { picks: string[][]; rest: string[] } {
  const picks: string[][] = questions.map(() => [])
  const rest: string[] = []
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d+)\.\s+(.*)$/)
    const qi = m ? Number(m[1]) - 1 : -1
    const q = questions[qi]
    // Written in the question's order, so matched whole rather than split:
    // an answer may have the separator in it.
    const said = m ? m[2].trim() : ""
    const found = q ? q.options.filter((o) => said.includes(o)) : []
    const mine = q?.options.includes(said) ? [said] : found.join(sep) === said ? found : []
    if (q && picks[qi].length === 0 && mine.length > 0) picks[qi] = mine
    else rest.push(line)
  }
  while (rest.length > 0 && rest[0].trim() === "") rest.shift()
  return { picks, rest }
}

/**
 * The terminals and the canvas on a phone, folded into one `…`: the header has
 * room for the title or for four buttons, not both. And the model, which swaps
 * the list in place, and a reload.
 */
function PaneMenu({
  session,
  terminalOpen,
  terminalCount,
  onToggleTerminal,
  canvasOpen,
  onToggleCanvas,
  onContinue,
  onKeep,
  panes = true,
}: {
  session: AgentInfo
  /** Terminals and canvas too: a phone's header has no room for their own buttons. */
  panes?: boolean
  terminalOpen: boolean
  terminalCount: number
  onToggleTerminal: () => void
  canvasOpen: boolean
  onToggleCanvas: () => void
  onContinue?: () => Promise<void>
  onKeep?: () => void
}) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  const [view, setView] = useState<"main" | "model">("main")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!at) return setView("main")
    const away = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if ((e.target as Element | null)?.closest?.(".pane-more")) return
      setAt(null)
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [at])

  const pick = (action: () => void) => {
    setAt(null)
    action()
  }

  return (
    <>
      <button
        className={"chip button pane-more" + (panes ? "" : " desk") + (panes && (terminalOpen || canvasOpen) ? " on" : "")}
        title={panes ? "Model, terminals, canvas and more" : "Model and more"}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(e) => {
          if (at) return setAt(null)
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ top: r.bottom + 4, right: window.innerWidth - r.right })
        }}
      >
        <Ellipsis />
        {panes && terminalCount > 0 && <span className="count">{terminalCount}</span>}
      </button>
      {at &&
        createPortal(
          <div className="session-menu pane-menu" role="menu" ref={ref} style={at}>
            {view === "model" ? (
              <ModelList session={session} onBack={() => setView("main")} onDone={() => setAt(null)} />
            ) : (
            <>
            <button role="menuitem" onClick={() => setView("model")}>
              <Cpu />
              Model
              <span className="pane-menu-count">{modelLabel(session.model)}</span>
              <ChevronRight />
            </button>
            <div className="session-menu-sep" />
            {panes && (
              <>
                <button role="menuitem" onClick={() => pick(onToggleTerminal)}>
                  <SquareTerminal />
                  {terminalOpen ? "Hide terminals" : "Terminals"}
                  {terminalCount > 0 && <span className="pane-menu-count">{terminalCount}</span>}
                </button>
                <button role="menuitem" onClick={() => pick(onToggleCanvas)}>
                  <AppWindow />
                  {canvasOpen ? "Hide canvas" : "Canvas"}
                </button>
              </>
            )}
            {onContinue && (
              <button role="menuitem" onClick={() => pick(() => void onContinue().catch(() => {}))}>
                <CornerDownRight />
                Continue in new chat
              </button>
            )}
            {onKeep && (
              <button role="menuitem" onClick={() => pick(onKeep)}>
                <Inbox />
                Keep chat
              </button>
            )}
            <div className="session-menu-sep" />
            {/* A home-screen app has no reload of its own. */}
            <button role="menuitem" onClick={() => location.reload()}>
              <RotateCw />
              Reload
            </button>
            </>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

/** Whether the page is in front: not a background tab, not a locked phone. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible")
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [])
  return visible
}

// ── Timeline ───────────────────────────────────────────────────────────────

// How many items are rendered at first, and added each time the reader nears
// the top. A session keeps 500 events; on a phone, laying all of them out
// before the newest one shows is the slow part of opening it.
const PAGE = 60
// How close to the top counts as nearing it, in pixels.
const NEAR_TOP = 600

function Timeline({
  items,
  sessionId,
  truncatedBefore,
  onAnswer,
  onAtEnd,
  after,
  tail,
  before,
  focus,
}: {
  items: TimelineItem[]
  sessionId: string
  truncatedBefore: number | null
  // Above everything, once all of this one is shown: earlier sessions.
  before?: ReactNode
  onAnswer: (text: string) => void
  onAtEnd: (atEnd: boolean) => void
  // Shown just below the item with this key: the suggested replies.
  after?: { key: string; node: ReactNode } | null
  // After everything: whether the agent is at work.
  tail?: ReactNode
  // Scrolled to and marked: the message with `key` (the start of a turn), and
  // `node` shown at that turn's end; at the end when it is not here.
  focus?: { id: string; key: string | null; node: ReactNode } | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  // The ref decides whether to follow; this only drives the button, so a
  // scroll that does not cross the line re-renders nothing.
  const [pinned, setPinned] = useState(true)
  // Set while `toBottom` scrolls. A smooth scroll fires scroll events all the
  // way down, and judging those by position would unpin it again — and bring
  // the button straight back — before it lands.
  const jumpingRef = useRef(false)
  // The tail that is rendered. Grows, never shrinks, for this mount.
  const [shown, setShown] = useState(PAGE)
  // The scroll height before more was rendered above, so the reader stays on
  // the line they were reading instead of jumping with the new content.
  const growFromRef = useRef<number | null>(null)
  // The focus: where it starts, and the last item of its turn.
  const focusAt = focus?.key ? items.findIndex((i) => i.key === focus.key) : -1
  const focusEnd = (() => {
    if (!focus) return -1
    if (focusAt < 0) return items.length - 1
    const next = items.findIndex((i, n) => n > focusAt && i.kind === "user")
    return next < 0 ? items.length - 1 : next - 1
  })()
  const focusMarkRef = useRef<HTMLDivElement>(null)
  // Each focus is gone to once; after that the reader scrolls as they like.
  const focusedRef = useRef<string | null>(null)
  const hidden = Math.max(0, items.length - Math.max(shown, focusAt >= 0 ? items.length - focusAt : 0))
  const visible = hidden > 0 ? items.slice(hidden) : items

  const showMore = () => {
    const el = ref.current
    if (!el || hidden === 0 || growFromRef.current !== null) return
    growFromRef.current = el.scrollHeight
    setShown((n) => n + PAGE)
  }

  useLayoutEffect(() => {
    const el = ref.current
    const from = growFromRef.current
    if (!el || from === null) return
    growFromRef.current = null
    el.scrollTop += el.scrollHeight - from
  }, [shown])

  // Only follow the output when the user is already at the bottom; scrolling up
  // to read something while the agent streams must not yank them back down.
  const onScroll = () => {
    const el = ref.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < NEAR_TOP) showMore()
    if (jumpingRef.current) {
      if (!atBottom) return
      jumpingRef.current = false
    }
    pinnedRef.current = atBottom
    setPinned(atBottom)
    onAtEnd(atBottom)
  }

  // The user taking over mid-jump wins.
  const cancelJump = () => {
    jumpingRef.current = false
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [items])

  useLayoutEffect(() => {
    if (!focus || focusedRef.current === focus.id || focusAt < 0) return
    const mark = focusMarkRef.current
    if (!mark) return
    focusedRef.current = focus.id
    pinnedRef.current = false
    setPinned(false)
    onAtEnd(false)
    mark.scrollIntoView({ block: "start" })
  }, [focus?.id, focusAt])

  const toBottom = () => {
    const el = ref.current
    if (!el) return
    // Pinned straight away, not when the smooth scroll lands: output arriving
    // mid-scroll should be followed, not left behind.
    pinnedRef.current = true
    setPinned(true)
    jumpingRef.current = true
    onAtEnd(true)
    // A long transcript is tens of thousands of pixels: smooth all the way it
    // takes seconds. Cut to a screen above the end, then glide the rest, which
    // still shows which way it went.
    const end = el.scrollHeight - el.clientHeight
    if (end - el.scrollTop > el.clientHeight * 2) el.scrollTop = end - el.clientHeight
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }

  return (
    <div className="timeline-wrap">
      <div
        className="timeline"
        ref={ref}
        onScroll={onScroll}
        onWheel={cancelJump}
        onTouchStart={cancelJump}
      >
        {/* The scroll container is the outer element and the measure is this
            one, so prose, tool cards and turn lines all share a single column
            width — a card spanning the window while the text beside it stopped
            half way across read as two different layouts. */}
        <div className="timeline-inner">
          {hidden === 0 && before}
          {hidden > 0 ? (
            // Scrolling up gets here first and loads more on its own; this is
            // for `gg`, which lands on it, and for anyone who would rather click.
            <button type="button" className="notice show-earlier" onClick={showMore}>
              {hidden} earlier
            </button>
          ) : truncatedBefore ? (
            <div className="notice">
              earlier messages are no longer kept in memory (up to #
              {truncatedBefore})
            </div>
          ) : null}

          {items.length === 0 && !before && (
            <div className="empty">Send a message to start.</div>
          )}

          {visible.map((item, n) => (
            <Fragment key={item.key}>
              {n + hidden === focusAt && <div className="focus-mark" ref={focusMarkRef} />}
              <Item item={item} sessionId={sessionId} onAnswer={onAnswer} />
              {after?.key === item.key && after.node}
              {n + hidden === focusEnd && focus?.node}
            </Fragment>
          ))}
          {tail}
        </div>
      </div>

      {/* Outside the scroller, so it stays put over the composer instead of
          scrolling away with the conversation. */}
      {!pinned && (
        <button
          className="to-bottom"
          onClick={toBottom}
          title="Jump to the latest"
          aria-label="Jump to the latest"
        >
          <ArrowDown />
        </button>
      )}
    </div>
  )
}

const noAnswer = () => {}
const dayOf = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })

/**
 * Earlier sessions of a thread, read-only, loaded a day at a time on demand:
 * each is joined once for its transcript and left. Oldest at the top, each
 * under a line with its date.
 */
function EarlierDays({ ids, currentAt, open }: { ids: string[]; currentAt: number; open?: boolean }) {
  const [days, setDays] = useState<{ id: string; at: number; items: TimelineItem[] }[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const next = ids[days.length]
  // What was added goes above the reader, who stays on the line they were on.
  const ref = useRef<HTMLDivElement>(null)
  const heightRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current?.closest(".timeline")
    if (el && heightRef.current !== null) el.scrollTop += el.scrollHeight - heightRef.current
    heightRef.current = null
  }, [days])

  const load = () => {
    if (!next || loading) return
    setLoading(true)
    const channel = getSocket().channel(`agent:${next}`, () => ({ since_seq: 0, device: "earlier" }))
    channel
      .join()
      .receive("ok", (snapshot: Snapshot) => {
        const items = foldFinished(buildTimeline(applySnapshot(snapshot, emptyTranscript)), false)
        heightRef.current = ref.current?.closest(".timeline")?.scrollHeight ?? null
        setDays((d) => [...d, { id: next, at: snapshot.meta.created_at, items }])
        setLoading(false)
        channel.leave()
      })
      .receive("error", () => {
        setFailed(true)
        setLoading(false)
        channel.leave()
      })
  }

  useEffect(() => {
    if (open && days.length === 0) load()
  }, [open])

  return (
    <>
      <div ref={ref} hidden />
      {next && !failed && (
        <button type="button" className="notice show-earlier" onClick={load} disabled={loading}>
          {loading ? "loading…" : "earlier days"}
        </button>
      )}
      {[...days].reverse().map((day) => (
        <Fragment key={day.id}>
          <div className="earlier-day">{dayOf(day.at)}</div>
          {day.items.map((item) => (
            <Item key={item.key} item={item} sessionId={day.id} onAnswer={noAnswer} />
          ))}
        </Fragment>
      ))}
      {days.length > 0 && <div className="earlier-day">{dayOf(currentAt)}</div>}
    </>
  )
}

type ItemProps = {
  item: TimelineItem
  sessionId: string
  onAnswer: (text: string) => void
}

/**
 * One message, re-rendered only when it changed.
 *
 * The timeline is rebuilt from the transcript on every event and every
 * streamed chunk, so each item is a fresh object every time — but what is in
 * it comes from the events, which do not change once they have arrived. Without
 * this, each chunk of a reply re-rendered the whole conversation, markdown and
 * all, which on a long one is most of the time a phone spends.
 */
const Item = memo(ItemView, (a: ItemProps, b: ItemProps) =>
  a.sessionId === b.sessionId && a.onAnswer === b.onAnswer && same(a.item, b.item),
)

// Structural equality that is cheap for timeline items: what they hold is
// mostly the very objects and strings of the events, so `===` settles nearly
// every comparison before any walking happens.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => same(x, b[i]))
  }
  if (Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  return ka.every((k) => k in rb && same(ra[k], rb[k]))
}

function ItemView({ item, sessionId, onAnswer }: ItemProps) {
  switch (item.kind) {
    case "user":
      return (
        // The copy button sits under the bubble rather than in it, where it
        // would push the time onto a line of its own on a phone.
        <div className="user-turn">
          <div className={"bubble user" + (item.pending ? " pending" : "") + (item.failed ? " failed" : "")}>
            {item.failed && item.clientMsgId && <UnsentMark id={item.clientMsgId} reason={item.failed} />}
            {/* A merge's summary is the agent's writing, not the user's words: markdown. */}
            {item.text.trim() !== "" &&
              (item.origin === "tidy" || item.origin === "handoff" ? <Markdown text={item.text} /> : <Rich text={item.text} />)}
            {item.files.length > 0 && <SentFiles sessionId={sessionId} files={item.files} />}
            {item.uploads && item.uploads.length > 0 && <LocalFiles files={item.uploads} sending={!item.failed} />}
            {item.queued && <span className="tag">queued</span>}
            {item.origin === "phone" && <span className="tag">phone</span>}
            {item.origin === "cron" && <span className="tag"><ClockIcon /> cron</span>}
            {item.origin === "dream" && <span className="tag"><Moon /> dream</span>}
            {item.origin === "tidy" && <span className="tag"><Merge /> merged</span>}
            {item.origin === "handoff" && <span className="tag"><Forward /> handed off</span>}
            {item.at && <Clock at={item.at} />}
          </div>
          {item.text.trim() !== "" && !item.pending && <MessageCopy text={item.text} />}
        </div>
      )

    case "assistant":
      // Where markdown is rendered (and a merge's summary, above). Tool output
      // and the user's own words are shown verbatim — see `markdown.tsx`.
      return (
        <div className={"bubble assistant" + (item.streaming ? " live" : "")}>
          <Markdown text={item.text} />
          {!item.streaming && item.text.trim() !== "" && <MessageCopy text={item.text} />}
        </div>
      )

    case "thinking":
      // Opus returns thinking blocks with empty text under the default
      // display, so the fallback is the normal case rather than an edge case.
      return (
        <div className="thinking">{item.text.trim() || "thought for a moment"}</div>
      )

    case "tool":
      return <ToolCard item={item} />

    case "tools":
      return <ToolGroup item={item} sessionId={sessionId} onAnswer={onAnswer} />

    case "question":
      return (
        <div className="question">
          <Rich text={item.question} />
          {item.options.length > 0 && (
            <div className="options">
              {/* The model supplies options precisely so the answer is one
                  click; typing them back out would waste that. */}
              {item.options.map((o) => (
                <button className="option" key={o} onClick={() => onAnswer(o)}>
                  {o}
                </button>
              ))}
            </div>
          )}
        </div>
      )

    case "outputs":
      return <OutputFiles sessionId={sessionId} files={item.files} more={item.more} />

    case "turn":
      return <TurnLine item={item} />

    case "error":
      return <div className="error">{item.text}</div>

    case "notice":
      return <div className="notice">{item.text}</div>
    case "retry":
      return <div className="notice retry">{item.text}</div>

    case "cron":
      return <CronJobs jobs={item.jobs} />
  }
}

/**
 * The red "!" beside a message that did not get through, as in a chat app.
 * Pressing it offers to send it again — under the same id, so one that did
 * arrive after all is not sent twice — or to let it go.
 */
function UnsentMark({ id, reason }: { id: string; reason: string }) {
  const { resend, discard } = useContext(Unsent)
  // Where the menu goes, in the window: under the mark, or over it when the
  // mark is near the bottom — where a failed message usually is, the latest
  // one, just above the composer. Out of the timeline (a portal), so its
  // scrolling cannot hide the menu.
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const mark = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLSpanElement>(null)

  const toggle = () => {
    if (at) return setAt(null)
    const r = mark.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8))
    const below = window.innerHeight - r.bottom
    setAt(below > MENU_HEIGHT + 120 ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 })
  }

  useEffect(() => {
    if (!at) return
    const away = (e: Event) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !mark.current?.contains(t)) setAt(null)
    }
    // Scrolling moves the mark out from under a menu fixed to the window.
    const scrolled = () => setAt(null)
    document.addEventListener("pointerdown", away)
    window.addEventListener("resize", scrolled)
    document.querySelector(".timeline")?.addEventListener("scroll", scrolled, { passive: true })
    return () => {
      document.removeEventListener("pointerdown", away)
      window.removeEventListener("resize", scrolled)
      document.querySelector(".timeline")?.removeEventListener("scroll", scrolled)
    }
  }, [at])

  return (
    <span className="unsent">
      <button ref={mark} className="unsent-mark" title={`Not sent: ${reason}`} aria-label="Not sent" onClick={toggle}>
        !
      </button>
      {at &&
        createPortal(
          <span className="unsent-menu" role="menu" ref={menu} style={at}>
            <span className="unsent-why">Not sent: {reason}</span>
            <button role="menuitem" onClick={() => (setAt(null), resend(id))}>
              Resend
            </button>
            <button role="menuitem" className="danger" onClick={() => (setAt(null), discard(id))}>
              Delete
            </button>
          </span>,
          document.body,
        )}
    </span>
  )
}

// The menu's size, near enough, for placing it inside the window.
const MENU_WIDTH = 208
const MENU_HEIGHT = 150

// Shown in local time; the expression itself is UTC, and says so.
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "never"

function CronJobs({ jobs }: { jobs: CronJob[] }) {
  if (jobs.length === 0) return <div className="notice">no scheduled jobs</div>

  return (
    <div className="cron-jobs">
      {jobs.map((job) => (
        <div key={job.id} className="cron-job" title={job.prompt}>
          <div className="cron-head">
            <span className="cron-name">{job.name}</span>
            <code>{job.cron}</code>
            <span className="cron-dim">UTC</span>
          </div>
          <div className="cron-dim">
            → {job.target_title ?? job.target} · next {when(job.next_at)}
            {job.last_run_at && <> · last {when(job.last_run_at)}</>}
          </div>
          {job.last_error && <div className="cron-error">{job.last_error}</div>}
          <div className="cron-dim cron-id">{job.id}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * The session name, editable in place.
 *
 * Renaming is loom-local — the title is a sidebar label, not conversation
 * state — so it never goes to the backend and needs no confirmation.
 */
function Title({
  title,
  backend,
  backendLabel,
  onRename,
}: {
  title: string
  backend: string
  backendLabel: string
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  // On a phone, a name too long for the header scrolls through, back and
  // forth, instead of being cut off — there that is most names. A wide window
  // shows most of it already, and a long slide across it is only noise.
  const narrow = useNarrow()
  const nameRef = useRef<HTMLSpanElement>(null)
  const [overflow, setShift] = useState(0)
  const shift = narrow ? overflow : 0
  useLayoutEffect(() => {
    const el = nameRef.current
    if (!el) return
    // The run's own width, which its transform does not change.
    const measure = () => {
      const run = el.firstElementChild as HTMLElement | null
      setShift(run ? Math.max(0, Math.ceil(run.offsetWidth - el.clientWidth)) : 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [title, editing, narrow])

  const commit = () => {
    const value = draft.trim()
    if (value !== "" && value !== title) onRename(value)
    setEditing(false)
  }

  return (
    <div className="chat-title">
      {/* Which engine runs it: permanent, and the two behave differently
          enough that it belongs by the name. The sidebar's badge, so the
          header is one line. */}
      <BackendIcon backend={backend} title={backendLabel} />
      {editing ? (
        <input
          className="chat-name-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (isComposing(e)) return
            if (e.key === "Enter") commit()
            if (e.key === "Escape") {
              setDraft(title)
              setEditing(false)
            }
          }}
        />
      ) : (
        <span
          ref={nameRef}
          className={"chat-name" + (shift > 0 ? " marquee" : "")}
          title="Double-click to rename"
          style={
            shift > 0
              ? ({
                  "--shift": `-${shift}px`,
                  "--marquee-s": `${4 + shift / 30}s`,
                } as CSSProperties)
              : undefined
          }
          onDoubleClick={() => {
            setDraft(title)
            setEditing(true)
          }}
        >
          <span className="chat-name-run">{title}</span>
        </span>
      )}
    </div>
  )
}

/**
 * Messages waiting for the current turn, or parked by an interrupt.
 *
 * Showing them matters most in the interrupted case: they were written for a
 * trajectory that no longer exists, so the user needs to see what is about to
 * be sent and be able to drop a line that no longer applies.
 */
function QueuePanel({
  messages,
  interrupted,
  onDrop,
}: {
  messages: string[]
  interrupted: boolean
  onDrop: (index: number) => void
}) {
  return (
    <div className={"queue-panel" + (interrupted ? " parked" : "")}>
      <div className="queue-head">
        {/* Only reachable when the backend refused to take the message into the
            running turn, or when the session was stopped. A message typed
            mid-turn normally goes straight in. */}
        {interrupted
          ? `${messages.length} message${messages.length > 1 ? "s" : ""} parked — they go out with your next one`
          : `${messages.length} waiting — the turn would not take it`}
      </div>
      {messages.map((text, i) => (
        <div className="queue-item" key={i}>
          <span className="queue-text">{text}</span>
          <button
            className="queue-drop"
            title="Discard this message"
            onClick={() => onDrop(i)}
          >
            <X />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── File cards ─────────────────────────────────────────────────────────────

/**
 * One file as a small square: an image shows itself, anything else its
 * extension and name. The same card everywhere a file appears — waiting in the
 * composer, sent with a message, or left by the agent for download — so a file
 * looks the same on its way in and on its way out.
 */
function FileCard({
  name,
  label,
  image,
  busy = false,
  error,
  title,
  onClick,
  onRemove,
}: {
  name: string
  // Shown in place of the extension: a directory has none.
  label?: string
  // Where the thumbnail comes from: a local object URL, or a promise of one
  // for a file behind the API token. `null` for anything not an image.
  image: string | Promise<string> | null
  busy?: boolean
  error?: string | null
  title: string
  onClick?: () => void
  onRemove?: () => void
}) {
  const [src, unreachable] = useResolved(image)
  // A format the browser cannot draw (HEIC, say), or a file that could not be
  // fetched, falls back to the plain card.
  const [broken, setBroken] = useState(false)
  const failedImage = broken || unreachable
  const showImage = image !== null && !failedImage && src !== null
  const loading = busy || (image !== null && !failedImage && src === null && !error)

  return (
    <span
      className={
        "file-card" +
        (showImage ? " image" : "") +
        (error ? " failed" : "") +
        (onClick ? " clickable" : "")
      }
      title={error ? `${name}: ${error}` : title}
      onClick={onClick}
    >
      {showImage ? (
        <img src={src} alt={name} onError={() => setBroken(true)} />
      ) : (
        <>
          <span className="file-ext">{label ?? extension(name)}</span>
          <span className="file-name">{name}</span>
        </>
      )}
      {loading && <span className="file-spinner" aria-label="loading" />}
      {onRemove && (
        <button
          className="file-drop"
          title="Remove"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <X />
        </button>
      )}
    </span>
  )
}

/** A thumbnail source, settled: `[src, failed]`, src `null` until it arrives. */
function useResolved(image: string | Promise<string> | null): [string | null, boolean] {
  const [state, setState] = useState<[string | null, boolean]>([
    typeof image === "string" ? image : null,
    false,
  ])

  useEffect(() => {
    if (image === null || typeof image === "string") {
      setState([image, false])
      return
    }
    let live = true
    setState([null, false])
    image.then(
      (url) => live && setState([url, false]),
      () => live && setState([null, true]),
    )
    return () => {
      live = false
    }
  }, [image])

  return state
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).slice(0, 5).toUpperCase() : "FILE"
}

/** A message's files still on this device: on their way, or not got through with it. */
function LocalFiles({ files, sending }: { files: LocalFile[]; sending: boolean }) {
  return (
    <div className="files">
      {files.map((file, i) => (
        <FileCard
          key={i}
          name={file.name}
          image={file.preview}
          busy={sending}
          error={null}
          title={`${file.name} · ${formatBytes(file.size)}`}
        />
      ))}
    </div>
  )
}

/** The attachments that went out with a message. */
function SentFiles({ sessionId, files }: { sessionId: string; files: AgentFile[] }) {
  return (
    <div className="files">
      {files.map((file) => (
        <SentFile key={file.path} sessionId={sessionId} file={file} />
      ))}
    </div>
  )
}

/**
 * One sent attachment. Like an output, a click shows it in the canvas when the
 * browser can and downloads it otherwise.
 */
function SentFile({ sessionId, file }: { sessionId: string; file: AgentFile }) {
  const openCanvas = useContext(OpenCanvas)
  const [state, setState] = useState<"idle" | "busy" | { error: string }>("idle")
  const item = itemForAttachment(file)
  const stored = file.path.split("/").pop() ?? file.path

  const download = () => {
    if (state === "busy") return
    setState("busy")
    downloadAttachment(sessionId, stored).then(
      () => setState("idle"),
      (e: Error) => setState({ error: e.message }),
    )
  }

  return (
    <FileCard
      name={file.name}
      image={isThumbnail(file.content_type) ? blobUrl(attachmentUrl(sessionId, file.path)) : null}
      busy={state === "busy"}
      error={typeof state === "object" ? state.error : null}
      title={`${item ? "Show" : "Download"} ${file.name} · ${formatBytes(file.size)}`}
      onClick={item ? () => openCanvas(item) : download}
    />
  )
}

/**
 * What a turn left in the output directory, one card per file; a click
 * downloads it.
 *
 * Comes from the server scanning the directory, not from the reply, so it is
 * here even when the model forgot to mention the file. See `Loom.Agent.Output`.
 */
function OutputFiles({
  sessionId,
  files,
  more,
}: {
  sessionId: string
  files: OutputFile[]
  more: number
}) {
  return (
    <div className="files outputs">
      {files.map((file) => (
        <OutputCard key={file.path} sessionId={sessionId} file={file} />
      ))}
      {more > 0 && <span className="file-card more">+{more}</span>}
    </div>
  )
}

/**
 * One output. A click shows it in the canvas when the browser can (a page, an
 * image, a video, a PDF, text), and downloads it otherwise; a directory with no
 * page downloads as a zip. The canvas has its own download button.
 */
function OutputCard({ sessionId, file }: { sessionId: string; file: OutputFile }) {
  const openCanvas = useContext(OpenCanvas)
  const [state, setState] = useState<"idle" | "busy" | { error: string }>("idle")
  const dir = file.kind === "dir"
  const name = file.path.split("/").pop() ?? file.path
  const item = itemForOutput(file)

  const download = () => {
    if (state === "busy") return
    setState("busy")
    ;(dir ? downloadAgentZip(sessionId, file.path) : downloadAgentOutput(sessionId, file.path)).then(
      () => setState("idle"),
      (e: Error) => setState({ error: e.message }),
    )
  }

  const size = formatBytes(file.size)
  const what = dir ? `${file.files} file${file.files === 1 ? "" : "s"} · ${size}` : size

  return (
    <FileCard
      name={name}
      label={dir ? (file.index ? "PAGE" : "DIR") : undefined}
      image={!dir && isThumbnail(file.content_type) ? blobUrl(outputUrl(sessionId, file.path)) : null}
      busy={state === "busy"}
      error={typeof state === "object" ? state.error : null}
      title={
        `${item ? "Show" : dir ? "Download as a zip:" : "Download"} ${file.path} · ${what}` +
        (file.updated ? " · updated" : "")
      }
      onClick={item ? () => openCanvas(item) : download}
    />
  )
}

/**
 * A button that fetches one output and hands it to the browser as a download.
 *
 * A button, not a link: the file is behind the API token. The label stays put
 * while it downloads and the failure, if any, replaces it — a file deleted
 * since the turn is the usual one.
 */
function DownloadLink({
  sessionId,
  path,
  label,
  className = "md-download",
}: {
  sessionId: string
  path: string
  label: ReactNode
  className?: string
}) {
  const [state, setState] = useState<"idle" | "busy" | { error: string }>("idle")

  const start = () => {
    if (state === "busy") return
    setState("busy")
    downloadAgentOutput(sessionId, path).then(
      () => setState("idle"),
      (e: Error) => setState({ error: e.message }),
    )
  }

  const failed = typeof state === "object"
  return (
    <button
      type="button"
      className={className + (state === "busy" ? " busy" : "") + (failed ? " failed" : "")}
      title={failed ? state.error : `Download ${path}`}
      onClick={start}
    >
      {label}
      {failed && <span className="file-size">{state.error}</span>}
    </button>
  )
}

function ToolCard({
  item,
}: {
  item: Extract<TimelineItem, { kind: "tool" }>
}) {
  const [open, setOpen] = useState(false)
  const summary = toolSummary(item.name, item.input)
  const result = item.result

  // While it runs, show whatever has streamed out; once it finishes, the
  // result replaces it. The stream is for liveness and may be partial — Codex
  // coalesces chunks — so it is never the thing we keep.
  const output = result ? result.output : item.streamed
  const live = !result && item.streamed !== ""

  return (
    <div className={"tool" + (result && !result.ok ? " failed" : "")}>
      <div className="tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="tool-name">{item.name}</span>
        <span className="tool-summary">{summary}</span>
        <span className="tool-state">
          {result ? result.ok ? <Check /> : <X /> : "…"}
        </span>
      </div>

      {open && Object.keys(item.input).length > 0 && (
        <pre className="tool-input">{formatInput(item.input)}</pre>
      )}

      {output.trim() !== "" && (
        <pre
          className={
            "tool-output" + (open ? " full" : "") + (live ? " live" : "")
          }
        >
          {output}
        </pre>
      )}
    </div>
  )
}

/** A finished stretch of tool calls, folded; see `foldFinished`. */
function ToolGroup({
  item,
  sessionId,
  onAnswer,
}: {
  item: Extract<TimelineItem, { kind: "tools" }>
  sessionId: string
  onAnswer: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Which tools, in the order first used: "Bash, Read" says more than a count.
  const names = [
    ...new Set(item.steps.flatMap((s) => (s.kind === "tool" ? [s.name] : []))),
  ]
  // Folded from the first call (see `foldFinished`), so a card can still be
  // working: one of its calls has no result yet.
  const running = item.steps.some((s) => s.kind === "tool" && s.result === null)

  return (
    <div className={"tool group" + (open ? " open" : "") + (running ? " running" : "")}>
      <div className="tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="tool-name">
          {running ? "using" : "used"} {item.tools} tool{item.tools === 1 ? "" : "s"}
        </span>
        <span className="tool-summary">{names.join(", ")}</span>
        <span className={"tool-state" + (item.failed > 0 ? " bad" : "")}>
          {item.failed > 0 && (
            <>
              {item.failed} <X />
            </>
          )}
          {running ? "…" : item.failed > 0 ? null : <Check />}
          {open ? <ChevronDown /> : <ChevronRight />}
        </span>
      </div>

      {open && (
        <div className="group-steps">
          {item.steps.map((step) => (
            <Item key={step.key} item={step} sessionId={sessionId} onAnswer={onAnswer} />
          ))}
        </div>
      )}
    </div>
  )
}

// A quiet end-of-turn marker. Worth a line because it is where the context and
// cost numbers in the header came from.
function TurnLine({ item }: { item: Extract<TimelineItem, { kind: "turn" }> }) {
  const parts: string[] = []
  if (item.contextTokens > 0) {
    parts.push(
      item.contextWindow
        ? `${formatTokens(item.contextTokens)} / ${formatTokens(item.contextWindow)}`
        : `${formatTokens(item.contextTokens)} ctx`,
    )
  }
  const model = item.model ? modelName(item.model) : null
  // Another model than asked for: Claude Code fell back, or the API answered
  // from another one. Said, not hidden in the footnote's gray.
  const off = model && item.expected && modelName(item.expected) !== model ? modelName(item.expected) : null
  return (
    <div className="turn-line">
      <Clock at={item.at} />
      {parts.map((part) => ` · ${part}`)}
      {model && " · "}
      {model && (
        <span className={"turn-model" + (off ? " off" : "")} title={item.model ?? undefined}>
          {off ? `${model}, not ${off}` : model}
        </span>
      )}
    </div>
  )
}

// A message's time: just the clock today, the date as well before that. The
// full timestamp is on hover.
function Clock({ at }: { at: number }) {
  const date = new Date(at)
  const today = date.toDateString() === new Date().toDateString()
  const text = date.toLocaleString(undefined, {
    ...(today ? {} : { month: "short", day: "numeric" }),
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  return (
    <time className="clock" dateTime={date.toISOString()} title={date.toLocaleString()}>
      {text}
    </time>
  )
}

/**
 * The agent at work, at the end of the conversation where the work will show
 * up — the header has no room for it on a phone. Nothing while idle; a stop
 * is already a notice in the transcript.
 */
function Working({ status, queued }: { status: string; queued: number }) {
  if (status !== "starting" && status !== "running") return null
  return (
    <div className={"working " + status} role="status">
      <span className="working-dot" />
      {/* `starting` is the backend booting — seconds for a cold Claude Code
          process. Saying so beats looking hung. */}
      {status === "starting" ? "Starting…" : "Working…"}
      {queued > 0 ? ` · ${queued} queued` : ""}
    </div>
  )
}

// ChatGPT's sidebar button on a phone: two lines, the lower one shorter.
function TwoLines() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 9h16M4 15h10" />
    </svg>
  )
}

// ── Composer ───────────────────────────────────────────────────────────────

// What a message can be instead of a prompt. `/compact` goes to the backend
// (Codex's adapter turns it into an RPC); `/reload` and `/cron` are loom's own.
const COMMANDS = [
  { name: "/compact", hint: "summarize the conversation to free up context" },
  { name: "/reload", hint: "reload Claude Code and Codex config: settings, MCP, skills" },
  { name: "/cron", hint: "list every scheduled job" },
]

// Only a message that *starts* with `/` is a command, and only while the first
// word is still being typed: a `/` later on is just text.
function commandMatches(text: string) {
  if (!text.startsWith("/") || /\s/.test(text)) return []
  return COMMANDS.filter((c) => c.name.startsWith(text))
}

function Composer({
  busy,
  interrupted,
  attachments,
  onSubmit,
  onInterrupt,
  tools,
  text,
  setText,
  under,
}: {
  busy: boolean
  interrupted: boolean
  attachments: Attachments
  onSubmit: (text: string) => void
  onInterrupt: () => void
  // Beside +: the thinking level.
  tools?: ReactNode
  // Held by the chat, so the suggested replies can fill it in.
  text: string
  setText: (text: string) => void
  // Below the box, in the space kept for the home indicator.
  under?: ReactNode
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  // True between compositionstart and compositionend. Needed in addition to
  // `isComposing` because the two disagree across browsers — see below.
  const composingRef = useRef(false)

  // The command menu: open while the text could still become a command, until
  // Escape dismisses it (typing anything brings it back).
  const [pick, setPick] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const matches = dismissed === text ? [] : commandMatches(text)
  const selected = matches[Math.min(pick, matches.length - 1)]
  const complete = (name: string) => {
    setText(name)
    ref.current?.focus()
  }

  // One line with the buttons beside it until the text needs more; then the
  // text gets the full width and the buttons drop to a row underneath.
  const [multiline, setMultiline] = useState(false)
  // How long the text was when it first wrapped. Going multiline widens the
  // box, so the same text may fit on one line again — leaving at that point
  // would flip straight back. The font is monospace, so length tracks width.
  const wrappedAt = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const style = getComputedStyle(el)
    const line = parseFloat(style.lineHeight)
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)

    if (text === "") {
      // The placeholder can wrap too, and is not worth a second line.
      wrappedAt.current = 0
      setMultiline(false)
      el.style.height = ""
      return
    }

    el.style.height = "auto"
    const content = el.scrollHeight - padding

    if (!multiline && (text.includes("\n") || content > line * 1.5)) {
      wrappedAt.current = text.length
      setMultiline(true)
      return // measured again in the wider layout
    }
    if (multiline && !text.includes("\n") && text.length < wrappedAt.current) {
      setMultiline(false)
      return
    }

    // Grow to six lines, then scroll inside.
    el.style.height = Math.min(content, line * MAX_LINES) + padding + "px"
  }, [text, multiline])

  // An attachment on its own is a message: dragging in a screenshot and
  // pressing send, with nothing typed, is a normal way to ask about it.
  const sendable =
    (text.trim() !== "" || attachments.items.length > 0) && !attachments.preparing

  const send = () => {
    if (!sendable) return
    onSubmit(text.trim())
    setText("")
  }

  return (
    <div className="composer">
      {attachments.items.length > 0 && (
        <div className="tray">
          {attachments.items.map((item) => (
            <AttachmentChip
              key={item.key}
              item={item}
              onRemove={() => attachments.remove(item.key)}
            />
          ))}
        </div>
      )}

      <div className={"composer-box" + (multiline ? " multiline" : "")}>
        {selected && (
          <ul className="command-menu" role="listbox">
            {matches.map((c) => (
              <li
                key={c.name}
                role="option"
                aria-selected={c === selected}
                className={c === selected ? "on" : ""}
                // mousedown, not click: the textarea must keep focus.
                onMouseDown={(e) => {
                  e.preventDefault()
                  complete(c.name)
                }}
              >
                <span className="name">{c.name}</span>
                <span className="hint">{c.hint}</span>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={picker}
          className="composer-file"
          type="file"
          multiple
          onChange={(e) => {
            attachments.add(Array.from(e.target.files ?? []))
            // Reset, or picking the same file twice in a row does nothing.
            e.target.value = ""
          }}
        />
        <div className="composer-tools">
          <button
            className="composer-btn attach"
            title="Attach files — or drop them anywhere in the conversation"
            onClick={() => picker.current?.click()}
          >
            <Plus />
          </button>
          {tools}
        </div>

        <textarea
          ref={ref}
          className="composer-input"
          value={text}
          rows={1}
          placeholder={
            busy
              ? "Steer the agent mid-turn…"
              : interrupted
                ? "Stopped — type to continue"
                : "Message the agent…"
          }
          onChange={(e) => {
            setText(e.target.value)
            setPick(0)
            setDismissed(null)
          }}
          // A pasted screenshot is the commonest attachment there is, and it
          // never exists as a file on disk to pick.
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length === 0) return
            e.preventDefault()
            attachments.add(files)
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={(e) => {
            if (selected && !composingRef.current && !e.nativeEvent.isComposing) {
              const n = matches.length
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault()
                setPick((pick + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
                return
              }
              if (e.key === "Escape") {
                e.preventDefault()
                setDismissed(text)
                return
              }
              // Tab, or Enter on a half-typed name, completes it; Enter on a
              // complete one falls through and sends.
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && text !== selected.name)) {
                e.preventDefault()
                complete(selected.name)
                return
              }
            }

            // Enter sends; Shift+Enter or Ctrl+Enter (⌘+Enter on a Mac) is a
            // new line. On a touch screen return is a new line and the send
            // button sends: a phone's keyboard has no other way to break a line.
            if (e.key !== "Enter" || e.shiftKey) return

            // An IME uses Enter to commit the candidate, and that keystroke
            // must not also send the message. Both guards are needed because
            // the browsers disagree about ordering:
            //
            //   Chrome  — the committing keydown has isComposing === true.
            //   Safari  — compositionend fires *after* that keydown, so
            //             isComposing is already false; the ref is still true.
            //
            // Either way the commit is swallowed, and the next Enter (with no
            // composition in progress) sends.
            if (e.nativeEvent.isComposing || composingRef.current) return

            const el = e.currentTarget
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault()
              const at = el.selectionStart
              setText(text.slice(0, at) + "\n" + text.slice(el.selectionEnd))
              requestAnimationFrame(() => el.setSelectionRange(at + 1, at + 1))
              return
            }
            if (matchMedia("(pointer: coarse)").matches) return

            e.preventDefault()
            send()
          }}
        />

        <div className="composer-actions">
          {busy && (
            <button
              className="composer-btn stop"
              onClick={onInterrupt}
              title="Stop the turn"
            >
              <Square fill="currentColor" />
            </button>
          )}
          {/* While the agent works, an empty box has nothing to send and the
              stop button is the one that matters. */}
          {!(busy && !sendable) && (
            <button
              className="composer-btn send"
              onClick={send}
              disabled={!sendable}
              title={
                attachments.preparing
                  ? "Preparing…"
                  : interrupted
                    ? "Continue"
                    : busy
                      ? "Send — it reaches the agent mid-turn"
                      : "Send"
              }
            >
              <ArrowUp />
            </button>
          )}
        </div>
      </div>
      {under}
    </div>
  )
}

// Past this the box scrolls instead of eating the conversation.
const MAX_LINES = 6

/**
 * One file in the tray, on this device until send. A moment's spinner while
 * an image is scaled down.
 */
function AttachmentChip({
  item,
  onRemove,
}: {
  item: Attachment
  onRemove: () => void
}) {
  return (
    <FileCard
      name={item.name}
      image={item.preview}
      busy={item.preparing}
      error={null}
      title={`${item.name} · ${formatBytes(item.size)}`}
      onRemove={onRemove}
    />
  )
}

// ── Text rendering ─────────────────────────────────────────────────────────

/**
 * Fenced blocks and inline code, nothing else.
 *
 * Used for the *user's* messages and for a question's prompt — text that was
 * typed by a person, where turning a `*` into emphasis would be rewriting what
 * they wrote. Assistant messages go through `Markdown` instead.
 */
function Rich({ text }: { text: string }) {
  const parts = text.split("```")

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre className="code" key={i}>
            {part.replace(/^[\w+-]*\n/, "")}
          </pre>
        ) : (
          <span className="prose" key={i}>
            {inlineCode(part)}
          </span>
        ),
      )}
    </>
  )
}

function inlineCode(text: string) {
  return text.split("`").map((piece, i) =>
    i % 2 === 1 ? (
      <code key={i}>{piece}</code>
    ) : (
      <span key={i}>{piece}</span>
    ),
  )
}

// ── Formatting ─────────────────────────────────────────────────────────────

function toolSummary(name: string, input: Record<string, unknown>): string {
  const str = (key: string) => String(input[key] ?? "")

  switch (name) {
    // Claude Code
    case "Bash":
      return str("command")
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return str("file_path")
    case "Glob":
      return str("pattern")
    case "Grep":
      return str("pattern") + (input.path ? ` in ${str("path")}` : "")
    case "WebFetch":
      return str("url")
    case "Task":
      return str("description")
    case "Skill":
      return str("skill")

    // Codex
    case "shell":
      return (input.cwd ? `${str("cwd")} ` : "") + str("command")
    case "apply_patch":
      return patchFiles(str("patch")).join(", ") || changedFiles(input) || "patch"
    case "web_search":
      return str("query")

    default:
      return Object.keys(input).length > 0 ? formatInput(input) : ""
  }
}

// Codex reports a patch as structured changes rather than an envelope.
function changedFiles(input: Record<string, unknown>): string {
  const changes = input.changes
  if (!Array.isArray(changes)) return ""
  return changes
    .map((c) =>
      c && typeof c === "object" ? String((c as Record<string, unknown>).path ?? "") : "",
    )
    .filter((p) => p !== "")
    .join(", ")
}

// The envelope names every file it touches on its own header lines, which is a
// far better one-line summary than the first 80 characters of a diff.
function patchFiles(patch: string): string[] {
  const files: string[] = []
  for (const line of patch.split("\n")) {
    const m = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line.trim())
    if (m) files.push(m[1])
  }
  return files
}

function formatInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input)
  if (entries.length === 1 && typeof entries[0][1] === "string") {
    return entries[0][1] as string
  }
  return JSON.stringify(input, null, 2)
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

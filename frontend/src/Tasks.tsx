import { ArrowUp, Loader2, MessageSquare, PanelLeft, Pause, Play, Plus, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { createTask, deleteTask, listTasks, runTask, updateTask, type Task } from "./api"
import { Confirm } from "./Confirm"
import { isComposing } from "./ime"
import { buildCron, DAY_NAMES, describeCron, readCron, type Frequency, type Schedule } from "./schedule"
import "./Tasks.css"

/**
 * Tasks, after ChatGPT's: a card per scheduled prompt, a few to start from,
 * and a composer to say a new one in words ("every Monday at nine, an AWS
 * industry report"), which the server reads into a name, a prompt and a
 * schedule. A card opens its editor.
 *
 * Every task has a session its runs land in, which the editor opens. Times
 * are the task's own wall clock, Shanghai unless the server says otherwise.
 */
export function Tasks({
  showSidebarButton,
  onToggleSidebar,
  onOpenSession,
}: {
  showSidebarButton: boolean
  onToggleSidebar: () => void
  onOpenSession: (id: string) => void
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The editor: a task, or a draft for a new one.
  const [editing, setEditing] = useState<Task | Draft | null>(null)

  const reload = () =>
    listTasks().then(
      ({ tasks }) => {
        setTasks(tasks)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )

  useEffect(() => {
    void reload()
  }, [])

  const saved = (task: Task) => {
    setTasks((all) => {
      const rest = (all ?? []).filter((t) => t.id !== task.id)
      return [task, ...rest]
    })
  }

  return (
    <div className="tasks-page">
      <header className="tasks-head">
        {showSidebarButton ? (
          <button className="tasks-round" onClick={onToggleSidebar} title="Show sidebar">
            <PanelLeft />
          </button>
        ) : (
          <span className="tasks-round-spacer" />
        )}
        <h1>Tasks</h1>
        <span className="tasks-round-spacer" />
      </header>

      <div className="tasks-scroll">
        <div className="tasks-column">
          {error && <div className="tasks-error">{error}</div>}
          {tasks === null && !error && <div className="tasks-note">loading…</div>}

          {tasks?.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={() => setEditing(task)} />
          ))}

          <h2 className="tasks-section">{tasks?.length ? "Start from" : "Get started"}</h2>
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              className="task-template"
              onClick={() => setEditing({ draft: true, name: t.name, prompt: t.prompt, cron: t.cron })}
            >
              <span className="task-template-head">
                <span className="task-template-emoji">{t.emoji}</span>
                <span className="task-template-name">{t.name}</span>
                <Plus className="task-template-plus" />
              </span>
              <span className="task-template-desc">{t.description}</span>
            </button>
          ))}
        </div>
      </div>

      <SayTask onMade={saved} onBlank={() => setEditing({ draft: true, name: "", prompt: "", cron: "0 9 * * *" })} />

      {editing && (
        <TaskEditor
          task={editing}
          onSaved={saved}
          onDeleted={(id) => setTasks((all) => (all ?? []).filter((t) => t.id !== id))}
          onOpenSession={onOpenSession}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { kind, when } = describeCron(task.cron)
  return (
    <button className={"task-card" + (task.paused ? " paused" : "")} onClick={onOpen}>
      <span className="task-kind">{task.paused ? `${kind} · paused` : kind}</span>
      <span className="task-name">{task.name}</span>
      <span className="task-prompt">{task.prompt}</span>
      <span className="task-rule" />
      <span className="task-when">{when}</span>
      {task.last_error && <span className="task-failed">Last run failed: {task.last_error}</span>}
    </button>
  )
}

/**
 * The composer at the foot of the page: a task in words, made on send. The
 * "+" opens an empty editor instead, for one written out by hand.
 */
function SayTask({ onMade, onBlank }: { onMade: (task: Task) => void; onBlank: () => void }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grows with what is typed, to five lines.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 5 * 26)}px`
  }, [text])

  const send = async () => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      onMade(await createTask({ text: value }))
      setText("")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tasks-composer">
      {error && <div className="tasks-composer-error">{error}</div>}
      <div className="tasks-composer-box">
        <button className="tasks-composer-btn" onClick={onBlank} title="Write a task out by hand">
          <Plus />
        </button>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder="Schedule a task"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (isComposing(e)) return
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button
          className="tasks-composer-btn send"
          onClick={send}
          disabled={!text.trim() || busy}
          title="Make it"
        >
          {busy ? <Loader2 className="spin" /> : <ArrowUp />}
        </button>
      </div>
    </div>
  )
}

type Draft = { draft: true; name: string; prompt: string; cron: string }

const FREQUENCIES: [Frequency, string][] = [
  ["daily", "Every day"],
  ["weekdays", "Weekdays"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["custom", "Custom (cron)"],
]

/**
 * One task, or a new one: its name, what it asks, and when. An existing one
 * can also be paused, run now, deleted, or followed to the session its runs
 * land in.
 */
function TaskEditor({
  task,
  onSaved,
  onDeleted,
  onOpenSession,
  onClose,
}: {
  task: Task | Draft
  onSaved: (task: Task) => void
  onDeleted: (id: string) => void
  onOpenSession: (id: string) => void
  onClose: () => void
}) {
  const existing = "id" in task ? task : null
  const [name, setName] = useState(task.name)
  const [prompt, setPrompt] = useState(task.prompt)
  const [schedule, setSchedule] = useState<Schedule>(() => readCron(task.cron))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (asking) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose, asking])

  const act = async (action: () => Promise<Task | void>, close = true) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (result) onSaved(result)
      if (close) onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    act(() => {
      const attrs = { name: name.trim(), prompt: prompt.trim(), cron: buildCron(schedule) }
      return existing ? updateTask(existing.id, attrs) : createTask(attrs)
    })

  const set = (patch: Partial<Schedule>) => setSchedule((s) => ({ ...s, ...patch }))
  const ready = prompt.trim() !== "" && (schedule.frequency !== "custom" || schedule.cron.trim() !== "")

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal task-editor" role="dialog" aria-label={existing ? "Task" : "New task"}>
        <div className="modal-head">
          <span>{existing ? "Task" : "New task"}</span>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X />
          </button>
        </div>

        <form
          className="project-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) void save()
          }}
        >
          <label>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning news" />
          </label>

          <label>
            <span>Instructions</span>
            <textarea
              value={prompt}
              rows={5}
              autoFocus={!existing}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What it should do each time it runs."
            />
          </label>

          <div className="task-schedule">
            <label>
              <span>Repeats</span>
              <select
                value={schedule.frequency}
                onChange={(e) => {
                  const frequency = e.target.value as Frequency
                  // A switch to custom starts from what the other choices make.
                  set(frequency === "custom" ? { frequency, cron: buildCron(schedule) } : { frequency })
                }}
              >
                {FREQUENCIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {schedule.frequency === "custom" ? (
              <label className="task-schedule-wide">
                <span>Cron (minute hour day month weekday)</span>
                <input
                  value={schedule.cron}
                  onChange={(e) => set({ cron: e.target.value })}
                  placeholder="0 9 * * 1-5"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </label>
            ) : (
              <label>
                <span>At</span>
                <input type="time" value={schedule.time} onChange={(e) => set({ time: e.target.value || "09:00" })} />
              </label>
            )}

            {schedule.frequency === "monthly" && (
              <label>
                <span>Day</span>
                <select value={schedule.dom} onChange={(e) => set({ dom: Number(e.target.value) })}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {schedule.frequency === "weekly" && (
            <div className="task-days" role="group" aria-label="Days">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = schedule.days.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    className={"task-day" + (on ? " on" : "")}
                    onClick={() =>
                      set({
                        days: on
                          ? schedule.days.filter((x) => x !== d).length
                            ? schedule.days.filter((x) => x !== d)
                            : schedule.days
                          : [...schedule.days, d].sort(),
                      })
                    }
                  >
                    {DAY_NAMES[d].slice(0, 2)}
                  </button>
                )
              })}
            </div>
          )}

          <small className="task-zone">Times are Beijing time (UTC+{(existing?.utc_offset ?? 480) / 60}).</small>

          {existing && (
            <div className="task-actions">
              <button type="button" className="text-btn" onClick={() => onOpenSession(existing.target)}>
                <MessageSquare /> Open conversation
              </button>
              <button
                type="button"
                className="text-btn"
                onClick={() =>
                  act(async () => {
                    // Said on the tap; taken back if it did not start.
                    setNote("Running now; the reply lands in its conversation.")
                    try {
                      return await runTask(existing.id)
                    } catch (e) {
                      setNote(null)
                      throw e
                    }
                  }, false)
                }
              >
                <Play /> Run now
              </button>
              <button
                type="button"
                className="text-btn"
                onClick={() => act(() => updateTask(existing.id, { paused: !existing.paused }))}
              >
                {existing.paused ? <Play /> : <Pause />} {existing.paused ? "Resume" : "Pause"}
              </button>
            </div>
          )}

          {note && <div className="task-note">{note}</div>}
          {error && <div className="device-error">{error}</div>}

          <div className="confirm-actions">
            {existing && (
              <button type="button" className="text-btn danger project-delete" onClick={() => setAsking(true)}>
                Delete
              </button>
            )}
            <button type="button" className="text-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="text-btn primary" disabled={!ready || busy}>
              {existing ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>

      {asking && existing && (
        <Confirm
          title={`Delete ${existing.name}?`}
          detail="The task stops. Its conversation, and every reply so far, stays."
          onYes={async () => {
            await deleteTask(existing.id)
            onDeleted(existing.id)
            onClose()
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </div>,
    document.body,
  )
}

/** What the page offers to start from, each opening the editor filled in. */
const TEMPLATES = [
  {
    emoji: "📰",
    name: "Morning tech news",
    description: "Every morning, the AI and cloud news worth knowing, in five bullets.",
    cron: "0 9 * * *",
    prompt:
      "Search the web for today's most important AI and cloud computing news. Give me the five that matter most, each with a one-line summary and a link.",
  },
  {
    emoji: "☁️",
    name: "AWS architecture weekly",
    description: "Every Monday, what changed in AWS services and solutions architecture.",
    cron: "0 9 * * 1",
    prompt:
      "Give me an industry weekly for AWS solutions architecture work: notable AWS service and architecture updates, Amazon Bedrock and agent news, and what they mean for customers. Keep it scannable.",
  },
  {
    emoji: "🩺",
    name: "Server health check",
    description: "Each morning, disk, memory and services on this machine, and anything wrong.",
    cron: "0 8 * * *",
    prompt:
      "Check this server's health: disk usage, memory, load, failed systemd units, and recent errors from the loom service. Report only what needs attention, briefly; say all clear if nothing does.",
  },
  {
    emoji: "📦",
    name: "Dependency updates",
    description: "Every Friday, which of Loom's dependencies have updates worth taking.",
    cron: "0 17 * * 5",
    prompt:
      "In ~/loom, check for outdated Elixir dependencies (mix hex.outdated) and frontend ones (pnpm outdated in frontend/). Summarize which updates matter and why, and which are safe to take.",
  },
  {
    emoji: "💼",
    name: "Job openings",
    description: "Mondays and Thursdays, fresh postings that fit me.",
    cron: "0 9 * * 1,4",
    prompt:
      "Find recent job postings for senior cloud solutions architect roles, and list the best ten with company, location and a link.",
  },
]

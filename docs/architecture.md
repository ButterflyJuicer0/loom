# Architecture

Loom is a single-user lobby for cloud agents. Every device connects to the same
session; state lives on the server and on disk; the agent itself is Claude Code
or Codex. Protocol details are in [backends.md](backends.md), and deployment is
in [deploy.md](deploy.md).

## 1. Non-goals

- **Multi-tenancy.** One password, one token for every device. Agents run as
  the BEAM's uid, with no sandbox (an incognito session's, §2.12, keeps it
  tidy, not safe).
- **Permission prompts.** Everything runs in auto mode. Nobody is around to
  press `y`, so a prompt would only stall the agent.
- **Our own agent loop.** Tools, context, compaction and memory belong to the
  backend. Why the old in-house loop went: [backends.md §1](backends.md).
- **A per-session working directory.** A session outside a project starts in
  `$HOME`, or `LOOM_WORKSPACE` if set. One in a project starts in the
  project's workspace (§2.7); there is no other way to choose.

## 2. One session, one GenServer

```
Loom.Agent.Session        one process per session, restart: :transient
  ├─ Loom.Agent.Backend   adapter behaviour (ClaudeCode, Codex)
  ├─ Loom.Agent.Store     meta.json + events.jsonl
  └─ PubSub "agent:<id>"  events and deltas
```

There is one process per session because failures and turn state are
per-session: one bad response must not take nine other transcripts down with
it. The process holds no sockets, so a turn finishes even with every browser
closed.

### 2.1 States

```
:idle ─submit→ :starting ─backend up→ :running ─turn ends→ :idle
                                         │ interrupt
                                         ↓
                                   :interrupted ─submit→ :starting
```

- **`:starting`** covers the backend's cold start, which takes seconds.
- **`:interrupted`** exists only to suppress "idle with a queue → dequeue".
  After a stop, nothing moves on its own. Typing resumes the session, and the
  parked messages go out with the new one.

### 2.2 Submit

| State | Action | Returns |
|---|---|---|
| `:idle` | start a turn | `:started` |
| `:starting` / `:running`, `mode: :queue` (the chat) | queue for the next turn | `:queued` |
| `:starting` / `:running`, otherwise (cron, notices, employees) | steer into the current turn | `:steered` |
| steer rejected | queue | `:queued` |
| `:interrupted` | queue + new message, start a turn | `:started` |

Both backends support mid-turn injection natively, but a message typed in the
chat waits for the turn to end, as in Claude Code: the work is not cut into, and
the queue goes out merged as the next turn. `steer_queued/1` ("Send now") steers
the whole queue into the running turn instead; if that is refused it stays
queued. Besides those, the queue holds messages typed while interrupted and
steers that were rejected (Codex's `expectedTurnId` mismatch). It is persisted
to disk.

### 2.3 Crash recovery

When the supervisor restarts a session with its original spec, `init/1` finds
`meta.json` on disk and reattaches; the disk always wins over the spec.

A Claude Code or Kiro turn survives a restart of the node. Their CLIs run
outside it (`Loom.Agent.Proc`): stdin is a FIFO the CLI opens read-write, so it
never sees EOF; stdout is appended to a file; `setsid` gives it a session of
its own; and systemd kills only the node (`KillMode=process`). A stopping node
lets the process go (`Backend.detach/1`). After every batch of output, once its
events are on disk, the backend saves its decoding state beside the file
(`Backend.checkpoint/1`), so the next node takes the process back from exactly
there (`Backend.adopt/1`). That works even after `kill -9`: the session stays
`:running`, reads what was written while nobody was reading, and the turn ends
as it would have. A warm idle process is taken back too. Measured with a
two-step shell task: Claude Code across a SIGTERM, Kiro across a SIGKILL. Both
finished while Loom was down, and every event arrived once, in order. The
header's `seq` can lag the log after a hard kill, so restore numbers on from
whichever is ahead.

Everything else is treated as an involuntary interrupt: a Codex turn, whose
app-server dies with the node, or a process that has gone. Resending would show
the model the message twice, so the session comes back `:interrupted`, with its
queue kept and a status event explaining why. A session being *deleted* still
kills its process.

### 2.4 `/reload`

Loom's own command; it never reaches a backend. Typed in any session, it tells
every session to let its backend process go: right away if idle, at the end of
the turn if not. The next Claude Code turn is then a fresh `claude --resume`
that reads the new settings, MCP servers and skills. Codex has one shared
app-server, which restarts itself as soon as no Codex turn is running. Its
threads are reattached silently on their next turn
([backends.md §6.11](backends.md)). Only a message that is exactly `/reload`
counts. The composer suggests `/compact`, `/reload` and `/cron` when the first
character is `/`.

### 2.5 Scheduled prompts

`Loom.Cron` submits a fixed prompt to an existing session at every match of a
five-field cron expression, read in the job's wall-clock time (`utc_offset`,
minutes east of UTC; a fixed offset, no tz database, so summer time is an hour
out). The turn is an ordinary one, so its reply, outputs and canvas land in
that session like any other; a backend's own scheduler would run outside Loom
and update nothing. The message is marked `origin: "cron"` and a busy session
steers or queues it as usual.

- **Truth is `~/.loom/cron.json`.** One process under the supervisor reads it
  at boot and rewrites it on every change; `next_at` is never stored. Minutes
  missed while Loom was down are skipped, not caught up. A paused job keeps
  its place and never fires.
- **The Tasks page** (`/api/tasks`, `LoomWeb.TaskController`) lists, makes,
  edits, pauses, runs and deletes them. A task made there gets a session of
  its own, named after it, where its runs land: `kind: "task"`, out of the
  sidebar's lists (and so out of tidying), opened from the task's dialog;
  deleting the task leaves the session. Times default to Shanghai (480). A task can be said in words:
  `Loom.Cron.Describe` asks a `Loom.OneShot` (haiku, given the user's local
  time) for a name, a prompt and an expression, and parses the expression
  before anything is made.
- **Or by hand on the node**, by an agent or anyone with a shell, with
  `bin/loom rpc`. The prompt goes in a `~S"""` heredoc, so quotes, newlines
  and `#{}` arrive verbatim:

  ```sh
  bin/loom rpc 'IO.inspect(Loom.Cron.add(%{name: "CI", cron: "30 0 * * 1-5",
    target: "a_…", utc_offset: 480, prompt: ~S"""
  …
  """}))'
  bin/loom rpc 'IO.inspect(Loom.Cron.list())'
  bin/loom rpc 'IO.inspect(Loom.Cron.delete("c_…"))'
  ```

- **`/cron`**, typed in any session, lists every job. Like `/reload`, it never
  reaches a backend.

### 2.6 Notifications

`Loom.Push` sends a Web Push notification to every device that turned them on
(the switch at the foot of the sidebar), only for what the bell says matters
(§2.10: 0–5 at once, only 0 from 00:00 to 07:00), through `notify/4`. A turn
ending sends nothing (the user's call, 2026-11-02): a long job that wants the
phone to ring posts a notice. Tapping it opens the notice's session.

- **No account anywhere.** The VAPID key pair is made on first boot and kept
  in `~/.loom/push.json`, beside the subscriptions; encryption and signing are
  `:crypto` (`Loom.Push.WebPush`). Losing the file orphans every device, which
  then has to turn notifications on again.
- **Not to a device that is looking.** Each subscribed device tells the lobby
  channel which session it is showing (`watching`, `nil` when hidden), and is
  skipped for that one. In memory against the channel's pid, so a device that
  drops off counts as not looking.
- **Declarative Web Push payload** (`web_push: 8030`): Safari 18.4+ shows it
  even if the service worker never runs; elsewhere `frontend/public/sw.js`
  shows the same fields. The worker has no fetch handler and caches nothing.
- **iPhone:** only from the home-screen app (iOS 16.4+); Safari tabs have no
  Push API. Apple refuses a VAPID subject on `localhost` or plain http, so a
  dev server signs with a stand-in address.
- A push service answering 404 or 410 has dropped the subscription, and so
  does Loom.

### 2.7 Projects

`Loom.Projects` groups sessions under a name, a working directory and
standing instructions, like ChatGPT's projects.

- **The workspace is the cwd**, always `~/.loom/projects/<id>/workspace`.
  Loom makes and owns it; the user never names a directory. Every session in
  the project works there, so files one leaves are where the next looks, and
  Claude Code, which keys its memory by cwd, keeps memory per project.
- **A session can move.** Into a project, out of one or between them
  (`project_id` on `PATCH /api/agents/:id`, refused mid-turn).
  `Backend.relocate/3` carries the conversation on from the new cwd: Claude
  Code's `--resume` finds it from any directory, and Codex resumes the thread
  with a `cwd` override. Files it already made stay where they are.
- **Instructions go in the system prompt**, after Loom's own, naming the
  workspace and carrying the user's text; nothing is written into the
  workspace. A conversation already under way cannot be given a new one —
  Claude Code ignores `--append-system-prompt` on `--resume` (measured,
  2.1.312) — so a move or an edit goes ahead of the next message the backend
  gets instead, once, marked as Loom's and not shown.
- **New sessions are filed.** A session's first message, outside any project
  while projects exist, waits for `Loom.Projects.Classifier`: one `claude -p`
  on haiku, without tools, settings or persistence, asked for a project id or
  `NONE` (about 2 s). A match moves the session before the turn starts, so it
  begins in the workspace with the instructions in its system prompt. 15 s
  without an answer starts the turn where it is. The transcript says so
  (`project_moved`, `auto: true`), and the session menu moves it back.
- **The sidebar lists overlap.** Each project lists its sessions, and the
  session list holds every session, pinned ones first (`pinned` on `PATCH`).
- **Deleting a project deletes its sessions and its workspace.**
- **Truth is `~/.loom/projects.json`.** Changes go out on the lobby channel.
  The file tree lists the workspace (hidden entries, symlinks and build
  directories skipped, 2000 files at most), download only.

### 2.8 Sleep

`Loom.Dream` goes over each scope's Claude Code memory by night. A scope is a
project, or `home` for the sessions outside any; Claude Code keys memory by
cwd, so each has one directory. Claude Code's own consolidation (auto-dream) is
gated by a server flag a Bedrock login never gets (measured, 2.1.312).

- **A hidden session sleeps.** One Claude Code session per scope, `kind:
  "dream"`, in the scope's cwd, so it has the same memory directory and Claude
  Code's memory instructions. The lists leave it out; the moon on a project's
  row (and Sleep at the sidebar's foot, for `home`) opens it, with Report,
  Memory and Settings tabs. Each night is one turn with `origin: "dream"`:
  the transcript shows a line, the backend gets `Loom.Dream.Prompt`. The reply
  is the report, and the user answers proposals in the same session.
- **When:** in the night window (03:00–06:00 Shanghai by default, one setting
  for every scope), 12 hours after the last sleep at least, with a session
  active since then, none mid-turn and none touched for 30 minutes. One scope
  per 10-minute tick. Or now, from the Memory tab.
- **The prompt** replays every session since the last night (user messages in
  full, the ending, narrow greps), weighs corrections and "remember this"
  highest, adds a source line to what it writes, archives to `archive/`
  rather than deleting, and proposes, never does, anything outside the memory
  directory: skills, `~/.claude/CLAUDE.md`.
- **Undo.** The memory directory is a git repository: committed before each
  sleep and after each turn of the sleep session. Undo restores the directory
  as it was before the last sleep, as a new commit.
- **Unread** is `seen_seq` on the session (`PATCH /api/agents/:id`), set as
  the report is read; the moon shows a dot while `seq` is past it.
- **Truth is `~/.loom/dream.json`**: the window, the offset, and per scope its
  session, `enabled`, and recent runs. `/api/dreams/:scope` and its
  `session`, `run`, `undo` and `memories` routes serve the tabs.

### 2.9 Virtual employees

`Loom.Employees`: an agent that keeps working while Loom is up, on the
projects it is given, toward KPIs the user sets, within a daily budget, and
says when it needs the user.

- **Two hidden sessions each**, on the agent chosen at hiring (Claude Code on
  Opus by default, `--model` from `cc_model`; Kiro on claude-opus-5.5,
  `kiro_model`; or Codex), both in the employee's own workspace
  (`~/.loom/employees/<id>/workspace`) so they share memory and files:
  `kind: "employee_chat"`, where the user talks to it, and
  `"employee_work"`, where it works. The work session is the report: every
  turn is a wake-up or the user answering. Neither is in the lists; the
  Employees section of the sidebar opens a page with Chat, KPIs, Updates (the
  work session), Reports and Settings.
- **A heartbeat, not a loop.** A one-minute tick wakes an employee when its
  `wake_at` comes (within its hours), or for the weekly report
  (`reports/weekly-YYYY-Www.md`). No daily report since 2026-10-31 (the boss
  reviews employees when they choose); old `reports/daily-*.md` stay listed,
  and the stored `daily_report`/`last_daily` are dropped on load. A wake-up is
  one turn, `origin: "employee"`, with `Loom.Employees.Prompt.wake/3` behind a
  one-line display. It ends with a **work card** (`Loom.Employees.Card`), a
  fenced `employee-card` JSON block: when to wake (kept between the minimum
  gap and the heartbeat; `continue` is a minute), KPI progress (never `done`,
  which becomes `review` for the user to accept), a report. No card: sleep
  until the heartbeat. The chat ends with a card only to add KPIs, hand a note
  to the next wake-up, or wake it now. The transcript renders the card
  (`WorkCard.tsx`).
- **The system prompt is fixed at the first turn** (§2.7's gotcha), so it
  holds only the rules; name, projects, KPIs, budget and what to ask first
  are in every wake-up and in `.employee/status.md`, rewritten on every
  change, for the chat to read. The system prompt is read by the session from
  `~/.loom/employees/<id>/system_<kind>.md`: a session starting from inside
  `Loom.Employees` cannot ask it.
- **Budget.** Claude Code's `total_cost_usd` is the running total of its
  process, so the backend emits each turn's difference as a `:cost` event,
  which the session broadcasts as `{:turn_cost, id, usd}` on the turns topic
  and does not keep. Every turn of both sessions counts toward the day (the
  user's wall clock, UTC+8). Kiro and Codex report no cost, so theirs is in
  turns a day (`budget_turns`), counted at each turn's end. Spent, the work turn is interrupted, nothing
  wakes, and the user is notified once; an approval adds to that day only.
  A turn past `max_turn_min` is interrupted too.
- **Reports go to the bell** (§2.10): the card's `report` has a `priority`
  (0–10; the old `info`/`important`/`urgent` read as 7/4/2), an optional
  `key` and `needs`, and `withdraw` takes keys back. 0–2 also shows "Needs
  you" until a later turn reports otherwise. Each wake-up lists its reports
  still open, to re-rate or withdraw. The work session's own turn ends notify
  nothing (`kind` rides on `{:turn_ended, …}`).
- **A fresh work session a day**, and sooner past 60k tokens of context (12
  turns where the backend gives none): at the next wake-up the old one goes
  to `past_work` and a new one starts, told to read `HANDOFF.md`, which the
  rules have it keep. Until that file exists the old session is asked to
  write it first. The page shows `past_work` above today as one thread, a
  day at a time (`EarlierDays` in `Chat.tsx`).
- **A workstation** (`workstation`, a device id; Settings → Advanced): the
  sessions stay here, but each has rules in `~/.loom/guards/<session>.json`
  (`Loom.Agent.Guard`), and its backend then installs `rel/loom-guard` as the
  hook before every tool call (Claude Code `--settings` PreToolUse, Kiro
  agent `hooks.preToolUse`). Allowed: `loom-node` to that device (where it
  has the run of the machine; the shared browser is here, so it browses with
  the device's own), our CLIs, the employee's own notes and memory, its
  skills, and looking things up (MCP tools, web search/fetch); refused (exit 2) is
  logged to `blocked.jsonl` and shown in Updates (`Session.note/2`, a
  `loom_note` event). Offline: not woken, status `offline`, one priority-4
  notice past a heartbeat, withdrawn when back. No workstation, no rules.
- **The boss profile**, one for all employees: a sentence a line, with who
  heard it and when (`boss` in `employees.json`, `/api/boss`, `Boss.tsx`).
  A card's `boss` adds a line (or `replaces` one by id) at once, no one
  asked; the user edits it in Settings. Every wake-up and `status.md` carry
  it whole, a chat's system prompt has it as of its start and is told each
  change ahead of its next message (`Agent.tell/2`). Mirrored to
  `~/.loom/boss.md`, which Sleep is told to leave its facts in.
- **Permissions are soft, unless it is given some.** Soft: the projects and
  their workspaces are named in the prompt, with what to ask first; same Unix
  user as every agent. Hard (`permissions`, Claude Code only):
  `{tools, allow, deny, summary}`, for the **work session only** — the chat
  is the boss talking to it and stays an ordinary session, told never to act
  on what the work session read. Carried in the work session's guard file,
  and turned by `Guard.claude_args/1` into Claude Code's own flags at each spawn:
  `--tools` (the only built-ins it has; the rest, `WebFetch` say, don't
  exist), `--allowedTools` (its `allow`, plus what Loom adds: read/write its
  workspace and memory, read its skills and own files,
  `Bash(loom-notice:*)`), `--disallowedTools`, and `--strict-mcp-config`
  unless `allow` names an MCP tool (`mcp__server__tool`, or `mcp__server`):
  MCP is allowed tool by tool, the servers' other tools refused like any
  call. All under `--permission-mode dontAsk` instead of `bypassPermissions`, so
  a call no rule allows is refused, never asked about. Claude Code splits
  `&&`/`;`/`|` chains and refuses `$(…)`, so a `Bash(prefix:*)` rule holds;
  absolute paths are `Read(//abs/**)`. A refusal comes back as
  `system/permission_denied`; the backend logs it to `blocked.jsonl` with
  `by: "permissions"` (`Guard.denied/3`), and Updates shows it. They are not
  among the page's settings (`PATCH` ignores them): only a setup chat sets
  them, JSON and summary together; the page shows the summary, and a lock
  "Restricted" mark on the page and the sidebar row. A change starts the work
  session again (`Agent.reload_backend/1`) and tells it. Nothing they are
  allowed reaches Loom: no shell, `curl`, `loom rpc` or `node-cli.json`, so a
  restricted employee cannot lift its own; the setup prompt says never to
  allow those. Kiro and Codex employees cannot have them: saving says why.
- **Setup chats** (`kind: "employee_setup"`, `Employees.setup_chat/1`,
  `POST /api/employees/setup`): "Describe it in a chat" on top of the hiring
  form, and "Change in a chat" under Permissions, open one in the sidebar.
  Its instructions (`Prompt.setup/0`, in code rather than a skill, so they
  ship with Loom) have it talk the job through and, once the user agrees,
  end a reply with a fenced `loom-employee` JSON block: settings to hire
  with, or an `id` and what to change. `Loom.Employees` reads the last block
  when the turn ends, saves it, and says so in the chat (`Session.note/2`)
  and to the agent (`Agent.tell/2`). Before the first message it is told the
  projects, the devices and, for a change, the employee's settings.
- **Truth is `~/.loom/employees.json`.** Pushed on the lobby as `employee`
  and `employee_removed`; `/api/employees` and its `pause`, `wake`,
  `approve`, `kpis` and `reports` routes serve the page. Sleep (§2.8) leaves
  employee sessions out of every scope.

### 2.10 The bell

`Loom.Notices`: what the agents want the user to see, each with a priority
from 0 (most urgent) to 10, in one list by priority instead of a
notification per report. The sidebar's bell shows the count of 0–2, or a dot
for 3–5.

- **Posting.** Employees through their card (§2.9); any session with
  `loom-notice post --priority N [--key K] [--needs read|reply|approve]`
  (`rel/loom-notice`, installed into `~/.local/bin` by `rel/deploy.sh`). It
  calls `/api/notice/*` with the `loom-node` key (`NodeCliAuth`) and the
  session from `LOOM_SESSION_ID`, which `Loom.Agent.Proc.spawn/4` gives every
  agent process along with `LOOM_CLI`, the key file's path. A session posts
  as its employee, a sleep session as Dream, any other as itself.
- **Judgement is the agents'**, in the `loom-notify` skill: which priority,
  when to re-rate (post the same key again) or withdraw. Code keeps only what
  cannot be left to them: one 0–2 a day per source (the next is posted as 3,
  with a note), the clock, and what counts as answered.
- **Notifying.** 0–5 at once, one notification per notice; 6–10 never.
  Between 00:00 and 07:00 only a 0 (the user's call, 2026-11-02): the rest,
  as they come in or come back from Later, wait and go out at 07:00, one by
  one, most urgent first. Through `Loom.Push.notify/4`. A 0–1 also rings
  Bark: `~/.claude/skills/bark/ring`, a critical alert to the iPhone through
  the self-hosted bark-server, which sounds through silent mode and Focus;
  no script or no key, no ring. Volume 10; a 0 rings for 30 s (`--call`).
- **A session of its own** (2026-11-04, the user's call: the card is too
  little to answer on). A new notice starts a Claude Code session,
  `kind: "notice"`, in its source's project, id in the notice's `chat`; it
  opens on the notice's `detail` — the brief, markdown, up to 6000
  characters, written by the source — shown as the agent's message without
  a turn (`Agent.brief/3`), and its agent is told the notice id and the
  source session (`Loom.Notices.Prompt.notice/0`). An update by key adds
  the new brief there. Its agent may read the source session
  (`loom-session read`, even an employee's or Dream's) and act on its own
  notice (`loom-notice act`, `Notices.relay/4`): the decision goes to the
  source as the user's message, `origin: "notice"`, even after the notice
  was settled. The page lists it once the user has written in it; one never
  written in is deleted with its notice after 30 days. Pushes open it.
- **Done** when the user writes in the source session (`AgentChannel`'s
  submit calls `replied/1`), when the notice's session relays a decision,
  when they tap Done, or when they open one that only asks to be read.
  Writing in the notice's session alone does not settle it. 6–10 expire
  after a week unread; settled ones are kept 30 days.
- **Truth is `~/.loom/notices.json`.** The whole list rides on the lobby
  join and comes again as `notices` on every change. A card (`Notices.tsx`)
  shows the summary and two lines of the brief, and has only Later (0–5)
  and Done; tapping it opens its session. Approve, reject, reply and
  options on the card were removed the same day: deciding from a card,
  without the matter in view, was not safe.
- **To-dos** sit beside the notices, in the same file: added in the bell, or
  by an agent the user told to (`loom-notice todo add`; the skill says only
  when asked — soft). Pushed as `todos`.
- **The bell's chat** (`kind: "bell"`, `POST /api/notices/session`, standing
  orders `Loom.Notices.Prompt.system/0`, `loom-notice all` / `act`) is still
  on the server, but the page no longer shows it since 2026-11-04: each
  notice has its own session instead.
- **Sleep** posts its night with the same command, and sleeps in a new
  session each night (`past` keeps the old ones, answerable still).

### 2.11 Tidying sessions

Making the right session quick to pick on a phone: the `loom-tidy` skill
(and `loom-retitle` inside it) retitles, archives and merges in one go, with
no confirmation (all of it can be undone), asked in a chat or as a scheduled
task. The agent runs `loom-session` (`rel/loom-session`,
installed like `loom-notice`), calling `/api/tidy/*` (`TidyController`).

- **Nothing is deleted.** Archiving sets `archived_at` and nothing else: the
  session runs, restores, is read by Dream and reached from the bell as
  before. Only the page reads the mark: archived sessions leave Recents and
  the project lists for Settings → Archived, until the session is active
  again (`last_active_at` past `archived_at`), so writing in one brings it
  back with no request.
- **Merge** starts a new session in the same project, on the backend of the
  most recent source, with the summary shown as its first message (`origin:
  "tidy"`, rendered as markdown) and given to the backend ahead of the next
  message (`Session.seed/4`, the `notice` slot); the sources are archived.
- **New first.** Each action, and `keep` (looked at, left as is), sets
  `tidied_at`; `list` puts first the sessions never tidied or active since,
  so a scheduled run reads only what changed.
- **Titles** record who gave them (`title_by`: auto, user, tidy; inferred for
  older sessions). A retitle never replaces the user's.
- **What may be tidied is a whitelist in code**: Recents only — no `kind`, no
  employee, not pinned. Employee, Dream and bell sessions are never listed and
  always refused, as is any kind added later. Archive and merge also refuse a
  session mid-turn, the caller, one with an open notice, and a merge across
  projects.
- **Handoff** (`loom-session handoff`, the `loom-handoff` skill) tidies
  nothing: a new session in Recents (the caller's project, another, or home),
  on the caller's backend, that begins with the caller's brief (`origin:
  "handoff"`, "handed off"), or starts on it at once with `--start`. The
  user's agreement first is the skill's rule; the backend is told who handed
  it off.

### 2.12 Incognito sessions

For quick, scattered questions that must not pollute memory or project files:
`kind: "incognito"` (`POST /api/agents` with `incognito: true`, from the arrow
beside New chat; any engine). Hygiene, not security: nothing is hidden.

- **Its own directory.** The cwd is `<session>/workspace`, gone with the
  session; never in a project (a move is refused until it is kept).
- **Read everything, write little** (`Loom.Agent.Sandbox`). Claude Code and
  Kiro run under `bwrap`: `/` read-only, writable only the workspace, the
  output, `/tmp`, `~/.cache` and the engine's own conversation store (CC's
  `projects/<cwd-slug>`, Kiro's `~/.kiro/sessions` and
  `~/.local/share/kiro-cli` minus its knowledge bases). Claude Code's auto
  memory is off (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`). Codex threads get
  `workspace-write` with the output as a writable root and the network on,
  on start and every resume. The agent is told in its system prompt.
- **Out of every list** but Settings → Incognito: not Recents, search, tidy,
  project filing, or Dream (no scope).
- **Kept** with `incognito: false` (`Session.promote/1`, refused mid-turn): the
  sandbox goes, the session relocates to the home directory and joins Recents,
  and the backend is told ahead of its next message. Files stay where they were.
- **Pinned**, it is also in the sidebar's Pinned (never Recents), stays
  incognito, and is not deleted. The header's chip pins; Keep is under "…".
- **Deleted 30 days after its last message** (`Loom.Agent.Incognito`, hourly)
  unless pinned, with Claude Code's directory for it.

### 2.13 New sessions

New chat asks: Chat or Incognito chat, each on the default engine and model,
or any engine behind its arrow; the model is picked later in the header.

- **Warmed at once.** A session made there starts its engine before the first
  message (`Backend.warm/2`): Claude Code's process loads and waits on stdin
  (its first reply 2.1 s after the message instead of 4.5 s), Kiro runs its
  ACP handshake. Codex already opened its thread in `start/2`. The idle
  release takes the process back as usual.
- **Deleted when left empty.** Five minutes after it was made (`@unused_ms`,
  rescheduled on restore), a session of the user's own (no kind, or
  incognito) with nothing sent or seeded, not named, pinned or with a draft
  waiting, is deleted. A draft gives it another five minutes.

### 2.14 Sessions a classifier stopped

When a safety classifier stops the model, what tripped it stays in the
conversation and trips it again on later turns (measured 2026-11-01: a sleep
went on on Opus 4.8; the user's "hello" there the next morning was refused).
A session kept for a fixed job would then fail at that job for good, so each
one is set aside by what runs it.

- **One signal.** Claude Code's `system/informational` ("…safeguards stopped
  the response…", it goes on once on another model) and
  `system/model_refusal_no_fallback` become a `:flagged` event; a turn of any
  backend that fails with "safeguards"/"usage policy" counts too. The session
  keeps `flagged_at` and `flagged_category` (`Loom.Agent.flagged?/1`) and shows
  a line in the conversation; the page shows a banner, with Continue for the
  user's own chats (`Loom.Agent.Carry`).
- **Who sets aside what.** Dream: the moon opens a fresh session, told the
  last report. An employee's work session: turned over at the next wake-up,
  handoff or not, told not to read the old one. An employee's chat: afresh
  each day (after 30 quiet minutes) and as soon as a flagged turn ends; a new
  day's may look back with `loom-session read`. The bell's chat: likewise,
  daily and when flagged. A task's own session (`kind: "task"`): a new one
  for every run; a session a task was pointed at is the user's and stays.
- **Nothing of the flagged conversation goes along** but what Loom passes in
  the first message's notice (Dream's report) and the files an employee keeps.
  The new session lists the ones before it in `earlier` (30 kept), which the
  page shows above it as one thread, opened on the last while nothing has been
  said yet.

## 3. Client protocol

```
event  has a seq, persisted to events.jsonl, replayed on reconnect. The truth.
delta  no seq, transient, never replayed. The typewriter.
```

Deltas append to a placeholder keyed by `block_id`. The event carrying the same
`block_id` then replaces the placeholder whole. A stream cut mid-sentence
therefore costs nothing.

Delta types: `:block_start`, `:block_end`, `:text`, `:thinking`,
`:tool_use_start`, and `:tool_output` (Codex only). `:tool_output` reuses the
tool card's `block_id`, the same pattern as text.

- **Loom owns `seq`.** The session is the only writer of `events.jsonl`. Backend
  ids go into `backend_ref` and are used for dedup on reattach.
- **Multiple devices.** A client joins with the last `seq` it saw and receives
  only the gap. PubSub does the fan-out. The channel holds no state.
- **Session list.** It is pushed on the `agents` lobby channel, not polled,
  and ordered by `last_active_at`: the last user message, reply or turn end.
  Status events do not count, so a restart does not make every session "now".
  It is derived from the transcript on restore, not stored.
- **A message that does not get through stays.** The client's bubble is
  optimistic, keyed by `client_msg_id`, and replaced by the `:user` event.
  No reply in 20 s, or a refusal, marks it with a red "!" offering Resend or
  Delete; unsent ones are kept in `localStorage` (`loom_unsent_<id>`) across
  reloads. A resend goes under the same id, and the session answers
  `:duplicate` for an id it already has, so one that did arrive late (phoenix.js
  still sends a timed-out push on rejoin) is never read twice.

## 4. Storage

```
~/.loom/sessions/<id>/meta.json      header, rewritten atomically (temp + rename)
~/.loom/sessions/<id>/events.jsonl   normalized transcript, append-only, :sync
~/.loom/sessions/<id>/files/…        user attachments
~/.loom/sessions/<id>/output/…       files the agent made for the user
~/.loom/cron.json                    scheduled prompts (§2.5)
~/.loom/projects.json                projects (§2.7)
~/.loom/projects/<id>/workspace/…    a project's workspace
~/.loom/employees.json               virtual employees and the boss profile (§2.9)
~/.loom/boss.md                      the boss profile, mirrored for Sleep
~/.loom/employees/<id>/…             an employee's system prompts and workspace
```

The base is `~/.loom` (or `LOOM_HOME`), not `priv/`, because a deploy replaces
`priv/`.

There is no message log. The conversation belongs to the backend: CC keeps it
in `~/.claude/projects/…`, Codex in its thread store. `events.jsonl` is only
the display truth, and it may legitimately differ from the backend's history.
For example, text streamed before an interrupt is shown but dropped by the
backend. **Never reconcile one against the other.**

> **Gotcha:** `Store.read_meta/1` uses `String.to_existing_atom/1` and falls
> back to string keys. An adapter atom may not exist yet at boot, so adapters
> read meta through `Backend.meta_get/2`, which accepts both.

### 4.1 Attachments

Attachments are uploaded over HTTP (multipart), not the channel, so a 20 MB
screenshot doesn't block every event behind it. The model gets an absolute path
and reads the file with its own tools: CC's `Read`, Codex's `view_image`. There
is no base64 and no multimodal content block.

- **Nothing travels before send, and a message goes whole.** Picked files
  stay on the device (scaled down there) until send. Then the bubble shows at
  once, its files go up together in one request, which the server stores
  all-or-nothing, and the message is submitted only after (`useAgent`'s
  `send`). Any failure marks the whole message with the red "!", and Resend
  uploads what is not stored yet and submits again. Files not uploaded don't
  survive a reload (a kept message says to attach them again).
- **The displayed text is not what the model gets.** The user's text and the
  attachment list are stored separately. Only the copy sent to the backend
  carries the paths.
- **Files show as small cards**, the same in the composer, in a sent bubble
  and for a download: an image shows a thumbnail, anything else its extension
  and name. The thumbnail of an attachment you just added comes from the local
  copy. Otherwise it is fetched with the token, from
  `GET /api/agents/:id/files/:name` or the output route, and cached for the
  page.
- **Images are scaled down in the browser first** (`shrink.ts`), to 2000 px
  on the long edge, about what CC and Codex scale them to before a model sees
  them. A phone photo goes from about 4 MB to under 1 MB, which matters on a
  phone's uplink and against Bedrock's ~32 MB cap on a request, which every
  turn's history counts toward. Only the size changes: the format stays (HEIC
  becomes JPEG), and a JPEG keeps its EXIF — time, GPS, camera — with the
  orientation set to 1, as the pixels are turned upright. A file that is small
  already, would come out bigger (a screenshot's PNG often does), or will not
  decode goes up untouched; GIF and SVG always do.
- **A path is a capability.** `Files.verify/2` rejects anything outside this
  session's `files/`, and file names are treated as hostile.

### 4.2 Output

Output is the reverse of attachments. The backend's system prompt names the
session's `output/` directory: CC via `--append-system-prompt`, Codex via
`developerInstructions`. At every turn end (done, failed or interrupted) Loom
diffs that directory against a snapshot and emits `:output_files` before
`turn_done`. The frontend shows a download card whether or not the model
linked the file.

The card shows one entry per top-level name in `output/`. A file directly in
`output/` is one card. A directory is also one card, however many files
changed in it; a comic chapter of forty pages is one card, not forty. A
directory with an `index.html` is a page; any other directory downloads as a
zip (`GET /api/agents/:id/zip/*path`), stored uncompressed and capped at 1 GB.

Downloads need the bearer token. The frontend therefore fetches the file as a
blob rather than using `<a href>`. `Output.resolve/2` refuses paths outside
`output/` and any symlink along the way.

### 4.3 Canvas

The canvas is a browser pane for `output/`. It shares the right-hand column
with the terminals and shows one of the two at a time. Clicking a previewable
output (a page, an image, a video, a PDF, text or code) shows it there, and the
canvas has its own download button. Anything else downloads on click. What
each session's canvas shows is kept per session, so switching to the terminals,
to another session, or reloading the page finds it as it was. Only one thing
opens the canvas without a click: a turn ending with a new or changed
`index.html`. That page is `open` in the `:output_files` event, and only a live
event acts on it, never history replayed on join. The agent is told the
convention in its system prompt: `output/<name>/index.html` with assets beside
it, referenced by relative paths.

The cards in the chat only announce what each turn changed. Beside the view,
the way NERDTree sits beside a buffer, is a file tree for the whole session:
`output/` and the uploads in `files/`, newest first, from
`GET /api/agents/:id/tree`, with the shown file's row marked. The button at the
left of the canvas's head folds it, and that is remembered. On a phone the tree
covers the view and folds itself once a file is picked. A file rewritten in place keeps its path, so the canvas does not go by the
path alone: opening something reads it again, and so does a live
`:output_files` event that names what is on show (the file, or the directory a
page lives in). It lists when shown and
again whenever a live `:output_files` or `user` event arrives, rather than
polling. A file opens in the canvas when there is a viewer for it and
downloads otherwise; a directory offers its page and a zip of itself.

From the keyboard (docs/keys.md) a row can also be renamed or deleted:
`PATCH`/`DELETE /api/agents/:id/output/*path` and `…/files/:name`, the new
name in `new_name`. The same path checks as a download, plus: a rename keeps
the directory, refuses a taken name (409) and one that would hide or move it
(422). The chat's cards and chips still name the old path, and show nothing
once it has gone; the canvas follows what it shows to the new name.

The page is model output, so it is treated as hostile:

- It runs in `<iframe sandbox="allow-scripts …">` without `allow-same-origin`,
  so it has an opaque origin and cannot reach loom's token or API. The server
  sends the same sandbox as a CSP header on every response, so a canvas URL
  opened in a tab of its own is just as confined.
- An iframe cannot send the bearer header, so the files are served under a
  signed, session-scoped prefix, `/canvas/<id>/<token>/`, valid for a day. The
  token is in the path, so the page's own relative URLs inherit it.
  `Referrer-Policy: no-referrer` keeps the token from being sent to the CDNs a
  page loads from.
- Logs, data and source files are sent as `text/plain`, so they display
  instead of downloading.

### 4.4 Devices (loom-node)

Agents can reach the user's own machines, such as a Mac, a Windows PC or a
WSL box. Each
device runs `loom-node daemon`, which is the Go program in `node/`. One binary
serves both ends of the link:

```
agent ──zsh──> loom-node exec mac -- '…'      CLI, on this host
                 │  HTTP on loom's own port, NDJSON stream
                 ▼
          NodeController ── Loom.Nodes (who is registered / online)
                 │  Erlang messages
                 ▼
          NodeChannel  ◄── wss /node/websocket, through cloudflared ──  loom-node daemon (device)
```

- **Registering a device.** The Devices dialog at the foot of the sidebar
  registers a name and returns a one-time install code, valid for a day. The
  user runs `curl …/node/install/<code> | sh` on the device, or
  `irm …/node/install/<code>/ps1 | iex` in PowerShell on Windows. Fetching
  either
  script redeems the code: it mints the device's token, which loom keeps only
  as a SHA-256 hash, and kills the previous token. The script then downloads
  the binary for the device's OS and arch from `/node/download/…`, writes
  `~/.config/loom-node/config.json`, and installs a per-user service (launchd
  or a systemd user unit). On Windows it is a value under the user's
  `HKCU\…\Run` key, which starts `loom-noded.exe` at logon. That file is the
  same binary with its PE subsystem set to GUI, so no console window ever
  opens for it. Reinstalling is how a token is replaced, and
  removing the device revokes its token.
- **Removing a device uninstalls it.** The removed token is kept in
  `nodes.json` under `wipes`. The device is disconnected, redials with it, and
  is let in only to be pushed `uninstall` (the same happens whenever an offline
  one comes back). The daemon answers `uninstalled`, then deletes its config
  and binaries, takes away its service, and stops (on Windows a detached `cmd`
  deletes `loom-noded.exe` once it has exited). Its config, its logs and
  `~/.local/state/loom-node/work` (`$LOOM_WORK`, agents' scratch space on a
  device) go with it, so nothing is left behind. A daemon that does not say
  `"uninstall": "1"` when it joins predates this, and is refused as before.
- **How the CLI gets in.** The CLI's routes, `/api/node/*`, share a port with
  everything Cloudflare forwards. They require the key from
  `~/.loom/node-cli.json`, a mode-600 file that loom writes at boot, so only
  this user can read it. They also refuse any request carrying `cf-ray`,
  whatever key it presents.
- **Broken IPv6.** The daemon dials the usual dual-stack way first. When
  that fails on the network (no HTTP answer), it dials again over IPv4 only
  (`dialSocket` in `node/phx.go`), and once IPv4 got through it tries IPv4
  first on every reconnect. Go's own fallback covers only a connect that
  fails. Some networks connect over IPv6 and then fail the first write
  ("socket is not connected"), so that fallback never starts. An HTTP answer,
  such as a 403 from the WAF, is final and is not retried another way.
- **Online state.** A device is online while its channel is alive. Joins and
  drops are pushed on the lobby channel. Neither side polls.
- **Requests.** Each request (`exec`, `read`, `write`) gets an id. The
  controller sends it to the channel, the channel pushes it to the device, and
  the device's events (`out`/`exit`, `chunk`/`done`, `written`, `error`) come
  back along the same path.
  - The controller pings the CLI every second. When a ping fails to write, the
    CLI has gone away, and the device is told to `cancel`.
  - An offline device gets 10s to reconnect before the request is refused.
- **Losing the device mid-request.**
  - The controller monitors the channel, so a dropped device ends the stream
    with `lost`, and the CLI exits 255 with a hint to check `loom-node list`.
  - The device kills everything it was running when its connection drops,
    because nobody is left to read the output. This includes heartbeats going
    unanswered for 15s.
  - The server lets a silent socket go after 45s.
- **Running a command.** It runs as `$SHELL -lc` in its own process group:
  - on Windows it runs in PowerShell (`pwsh` if installed, else Windows
    PowerShell) with `-NoProfile -Command`. Output is forced to UTF-8
    and the command runs in a hidden console. A job object stands in for the
    process group;
  - stdin is closed;
  - the timeout defaults to 120s and is capped at 1800s, with exit 124 on
    expiry;
  - output is capped at 10 MB.

  Writes land in a temporary file beside the target, which is renamed into
  place. Every request is logged on the device in
  `~/.local/state/loom-node/log`.
- **A device's agent sessions.** `LoomWeb.DeviceSessionsController` (the
  Devices dialog's **sessions**) runs `priv/device_sessions/sessions.py` on
  the device over the same channel, as `python3 -c` with the script
  base64'd in its argument, and returns the JSON it prints: the Claude Code
  sessions in `~/.claude/projects` (running ones known by
  `~/.claude/sessions/<pid>.json` and a live pid) and the Codex ones in
  `~/.codex/sessions`, or the last turns of one of those files — it reads
  nothing else. *Continue* starts a Loom session seeded with that session's
  gist and recent turns, told to work on the device through loom-node;
  *pick* asks `Loom.OneShot` which sessions a described task is.
- **Skill.** `rel/deploy.sh` builds every target with `make -C node`,
  installs the CLI at `~/.local/bin/loom-node`, and copies `node/SKILL.md`
  into the skill directories of both backends.

## 5. A session's backend is for life

`POST /api/agents` without a `backend` returns 422; there is no default. The
history lives in the backend's own store, so switching backends would lose it.
Titles exist only on Loom's side and are never sent to the backend.

## 6. Supervision tree

```
Loom.Supervisor
├─ Phoenix.PubSub
├─ Registry + DynamicSupervisor   Loom.Terminal.Session (PTYs)
├─ Loom.Terminal.Layout
├─ Registry + DynamicSupervisor   Loom.Agent.Session (max_restarts 20/5s)
├─ Task.Supervisor
├─ Loom.Agent.Codex.Server        the one shared codex app-server
├─ Loom.Agent.Bootstrap           reattaches persisted sessions at boot
├─ Loom.Cron                      scheduled prompts
├─ Loom.Nodes                     the user's devices (loom-node)
├─ Loom.Push                      notifications for the bell
├─ Loom.Employees                 virtual employees' heartbeat and budget
├─ Loom.Restarter                 restart once no Codex turn runs, for deploys
└─ LoomWeb.Endpoint
```

`Codex.Server` respawns its OS process itself, with backoff. A `codex` that
fails instantly would otherwise crash-loop a permanent child and take the
application down with it.

## 7. Terminals

Each `Loom.Terminal.Session` owns one PTY (`expty`). Terminals are global, not
tied to an agent session.

- **Several clients, one shell.** Every client gets the output, and input is
  serialized through the GenServer mailbox. The buffer is replayed inside
  `subscribe/3`, so no output can slip in between "fetch buffer" and
  "subscribe".
- **The size follows whoever typed last** (tmux's `window-size latest`). A
  resize from a client that is only watching is stored but not applied.
- **A non-driver's terminal replies are dropped.** These are cursor reports,
  DA, OSC, DCS, focus events and similar answers that xterm sends on its own.
  Without this, two browsers would both answer the same query.

## 8. Frontend

```
App.tsx           layout: sidebar | chat | terminals or canvas (drawer + overlay on phones)
Canvas.tsx        the canvas pane; canvasItems.ts decides what opens there
Sidebar.tsx       session list, new-session menu
Chat.tsx          timeline, tool cards, queue, composer
agent.ts          pure reducers: applySnapshot / applyEvent / applyDelta / buildTimeline / foldFinished
markdown.tsx      markdown for assistant messages only
Terminal.tsx      one xterm pane
push.ts           this device's notifications on/off, and whether it is looking
keys.tsx          vim-style keys, desktop only (docs/keys.md)
useAgent.ts       one agent channel's lifecycle
```

- **All transcript rules live in `agent.ts`**, as pure functions. When a turn
  is finished, `foldFinished` collapses its consecutive tool calls into one
  "used N tools" card.
- **Channel params are a function**, so every rejoin asks for the gap since the
  last `seq` actually seen.
- **The queue is never derived from events.** The server's `:queue` event
  carries the full list.
- **Markdown is rendered from `marked.lexer()` tokens into React elements**,
  never through HTML. Model output can contain anything from a fetched page,
  and this way it cannot become markup. Raw `html` tokens render as text,
  `javascript:` links are inert, and images are not loaded.
- **IME:** check both `isComposing` and a `compositionend` flag. Chrome and
  Safari order those events differently.

### 8.1 Debugging: record and replay

```sh
pnpm transcript record <session-id> "prompt" [--attach a.png]
pnpm transcript replay <file.json> [--steps]
pnpm transcript check  <file.json>
```

`tools/transcript.mjs` imports `src/agent.ts` directly. It separates "the data
is wrong" (duplicate deltas, `block_id` collisions) from "the data is fine, so
it's CSS".

## 9. Not done

- `:question` events (CC `AskUserQuestion`, Codex `requestUserInput`). Today a
  question arrives as plain text.
- Codex turns that survive a Loom restart (a Codex daemon mode). Claude Code
  and Kiro turns do; see §2.3.
- Cleanup of uploads that were removed from the tray.
- Range requests on the canvas, so a long video can seek, and a proper video
  player. Markdown in the canvas shows as plain text, the way a browser shows
  it.

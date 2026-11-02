# Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

All notable changes to this fork. Versions are git tags; each one is a build
that ran live. Format after [Keep a Changelog](https://keepachangelog.com/).

| Version | Date | Theme |
| --- | --- | --- |
| [0.4.0](#040--2026-11-02) | 2026-11-02 | Model picker, Continue, incognito, Working, Android |
| [0.3.0](#030--2026-10-31) | 2026-10-31 | The bell, tidy, employee workstations, safer devices |
| [0.2.0](#020--2026-10-29) | 2026-10-29 | Projects, ChatGPT UI, Kiro, Sleep, employees, restart survival |
| [0.1.0](#010--2026-10-28) | 2026-10-28 | Upstream base |

## [Unreleased]

### Added
- **Meeting mode**: "Meeting mode" in a chat's `…` menu listens to a meeting
  (your microphone plus the shared screen's system audio), transcribes it in
  the browser with sherpa-onnx (Chinese + English, voices told apart), and
  sends the agent a batch about every 30 s for live hints; "End" asks for the
  minutes. Batches and quiet turns are folded. The speech models (~230 MB) load
  only after you agree, through the server, with progress. The opening prompt
  can be replaced with `~/.loom/meeting/prompt.md`.
- **Hire in a chat**: "Describe it in a chat" on top of the hiring form opens
  a chat that talks the job through and creates the employee once you agree.
  The form stays.
- **Hard permissions for an employee's work** (Claude Code): only the tools,
  commands and MCP tools it is allowed, enforced by Claude Code itself, so
  text it reads (mail, web pages) can't talk it into more. Its chat with you
  stays unlimited. Set in a chat; the page shows a summary in words and a
  "Restricted" mark, refusals show in Updates.

### Fixed
- An employee's memory directory in its guard rules: Claude Code turns every
  character but letters and digits into a dash, `_` included.

### Changed
- **Only the bell rings the phone.** A turn ending no longer sends a
  notification; only bell notices 0–5 do, at once, one each. The 20:00
  digest is gone. Between 00:00 and 07:00 only a 0 rings; the rest go out
  at 07:00. A long job that should wake you posts a notice.
- **Taps answer at once**: New chat opens immediately and the server makes
  the session in the background (the first message waits for it, retrying on
  a weak network). Pin, archive, done, move, rename, delete and to-do ticks
  show on the tap and are put back, with a note, if the server refuses.
  So do the model pick, bell answers, to-dos, employee Wake/Pause/KPI review,
  Boss lines, file rename/delete, Sleep settings and device rename.

## [0.4.0] – 2026-11-02

### Added
- **Model per session**: pick it from the chat header (Claude Code, Codex,
  Kiro); every turn shows the model that answered.
- **Continue in a new chat**: carry a session on by forking it or by reading
  it, from the session menu or the chat header. `loom-sessions` skill.
- **Incognito chats**: sandboxed with `bwrap`, out of Recents, memory and
  projects, kept or pinned on request, deleted 30 days after the last message.
  New chat offers Chat or Incognito chat.
- **Working**: sessions used in the last hour sit above Recents until marked
  Done; on a phone, swipeable cards with title, recap and the last reply.
- **Project page** with Files and Sessions tabs; a chevron back from a chat.
- **Android devices**: `loom-node` as a one-APK install; screen control
  through an AccessibilityService (`loom-node control`).
- **Device icons**: Windows, Mac, Android, Linux or Bot, picked when adding.
- **Resizable desktop sidebar**, width kept per browser.
- **Copy**: tap inline code to copy it; a copy button under every message.
- Sessions a safety classifier stopped are set aside, with a short banner and
  Continue.

### Changed
- Enter sends; Shift/Ctrl/Cmd+Enter is a new line; on a touch keyboard return
  stays a new line and the send button sends.
- `rel/ship.sh` lists the commits since what is live and ships only with
  `--yes`.

### Fixed
- A phone back from sleep reconnects the socket phoenix.js closed on
  pagehide; Reload in the phone's menu.
- The iOS home-screen app's first rows start below iOS's top blur band.
- `loom-node` keeps its token out of dial errors.

### Security
- 20 wrong install codes within 2 minutes void the live ones.

## [0.3.0] – 2026-10-31

### Added
- **The bell**: notices posted by agents with a priority from 0 to 10, a
  background and answers; handled on the card, opening one jumps to its turn,
  Later puts it off. The user's to-dos beside them, and a chat to go through
  both. `loom-notify` skill.
- **Tidy**: retitle, archive (UI-only, listed in Settings) and merge
  sessions; new-since-last-tidy first. `loom-tidy` and `loom-retitle` skills.
- **Employees**: a shared boss profile learned from the boss's words (its own
  page in Settings); a workstation that binds an employee to one device,
  enforced by a hook.
- **Handoff**: `loom-handoff` opens a new session with a brief, once the user
  agrees.
- **Devices**: removing one makes `loom-node` uninstall itself, now or when it
  next connects, with its `$LOOM_WORK` scratch space and logs.
- `rel/ship.sh`: deploys committed code only, and never a build that leaves
  out what is live.

### Changed
- Attachments upload on send, all at once; a message goes whole or not at all.
- Install codes last a day instead of an hour.
- A task's own session is kind `task`, out of the sidebar's lists.
- Employees no longer write a daily report.
- The bell takes Search's place in the sidebar.

### Removed
- Search (from 0.2.0).

## [0.2.0] – 2026-10-29

### Added
- **Projects**: sessions grouped under a shared workspace and instructions;
  pin sessions and move them in and out; a moved session is told about its
  project.
- **Kiro CLI** as a third backend over ACP, with Claude Code's MCP servers
  and skills.
- **Sleep / Dream**: nightly memory consolidation per project, with a report
  and undo.
- **Virtual employees**: agents with a role, KPIs and a daily budget.
- **Turns survive restarts**: Claude Code and Kiro turns carry on through a
  restart or crash and are taken back after it.
- **Tasks**: an HTTP API for `Loom.Cron`, wall-clock times, tasks said in
  words, and a Tasks page.
- **Suggested replies**: a choice card above the composer, several questions
  at once.
- **Drafts** per session, kept on the device and the server, synced across
  devices.
- **Unsent messages** stay with a red "!" to resend; the server deduplicates.
- **Search** by title or content.
- Native **Windows** devices for `loom-node` (PowerShell).
- A phone-shaped browser window and stream.
- Thinking level per session, text size per area, light/dark, an unread mark.
- `loom-guide` skill.

### Changed
- A ChatGPT look throughout: its greys, type and proportions; the phone theme
  measured from ChatGPT's iOS app; glass composer and header; "Recents".
- Tool calls fold from the first one, not once the turn is over.
- Engine marks (Claude, Codex, Kiro) in the chat header.

### Fixed
- One-shot `claude` runs carry the settings' env, so a Bedrock host is logged
  in.
- Terminals kill the shell's whole process group.

## [0.1.0] – 2026-10-28

The fork point: [EthanLLL/loom](https://github.com/EthanLLL/loom) at
`cf1facd`. Claude Code and Codex sessions, terminals, canvas, slides,
scheduled prompts, `loom-node` for macOS/Linux/WSL, the shared browser, PWA
and push notifications.

[0.4.0]: https://github.com/quanquan1996/loom/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/quanquan1996/loom/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/quanquan1996/loom/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/quanquan1996/loom/tree/v0.1.0

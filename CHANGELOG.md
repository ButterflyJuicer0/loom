# Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

All notable changes to this fork. Versions are git tags; each one is a build
that ran live. Format after [Keep a Changelog](https://keepachangelog.com/).

| Version | Date | Theme |
| --- | --- | --- |
| [0.6.0](#060--2026-11-04) | 2026-11-04 | Message queue, device sessions, reference a chat, share as image, titles that keep up, a session per bell notice, trash, security fixes |
| [0.5.0](#050--2026-11-03) | 2026-11-03 | Meeting mode, hiring in a chat, hard employee permissions, only the bell rings, loom-home |
| [0.4.0](#040--2026-11-02) | 2026-11-02 | Model picker, Continue, incognito, Working, Android |
| [0.3.0](#030--2026-10-31) | 2026-10-31 | The bell, tidy, employee workstations, safer devices |
| [0.2.0](#020--2026-10-29) | 2026-10-29 | Projects, ChatGPT UI, Kiro, Sleep, employees, restart survival |
| [0.1.0](#010--2026-10-28) | 2026-10-28 | Upstream base |

## [Unreleased]

### Added
- **Passkeys, and a yes from a signed-in device**: a device signs in with a
  passkey (Settings → Sign-in adds one: Face ID, Touch ID, Windows Hello,
  Android's screen lock; it asks for the password again), or with the
  password and an Allow pressed within two minutes on a device already
  signed in — each shows "Sign-in request · Allow / Deny", and phones get a
  push. The password alone works only while no device is signed in. Every
  device has a login of its own, listed in Settings → Sign-in, where it can
  be signed out; 30 days unused signs it out. Nobody is signed out by the
  change. `loomctl login` waits for the Allow too and shows as `loomctl ·
  <host>`; the way back in with no device at hand is in docs/deploy.md §7.
  From quanquan1996/loom 0.7.0 (7013b68, 7eeb53a, d77e543, bf1891e), with
  the screens in Chinese and in the theme's colours.
- **`LOOM_TRUSTED_PROXIES`**: with a CDN in front of the tunnel, the outer
  proxy's addresses, so sign-in notices and the login brake see the visitor.
- **BTW — ask on the side while the agent works**: a button beside the
  thinking level (or `/btw <question>`, or the second button beside send
  while a turn runs) puts a question to a copy of the conversation as it
  stands, turn under way included. The answer shows in a panel above the
  composer; the turn is neither interrupted nor steered, and nothing of it
  joins the conversation. Each question is a fresh copy, so a later one sees
  the progress since. Claude Code and Codex sessions; the copy cannot act
  (tool calls refused / read-only), and its request is read from the
  session's prompt cache.
- **The interface in Chinese**: Settings → Language switches every menu,
  dialog, tooltip and hint between 中文 and English, per device; Chinese is
  the default. What an agent writes, and what is sent to one, is untouched.
- **Themes**: Settings → Theme offers Loom's own look and eight designed
  themes, each in light and dark and each a tribute drawn after the real
  thing — every picture is Loom's own pixel art (hand-laid grids in
  `frontend/tools/art/<id>.mjs`), made after looking at screenshots of the
  game; nothing is taken from a game's files and no logo is reproduced.
  **山山兔**: the Arknights plush rabbit, drawn sitting after the product
  photographs — it hops up to sit on the composer while you type, turns on
  a running tool card, and is a list's dots; other operator versions hop
  while the agent works. Beside it 龙泡泡 — 黍, 年, 夕, 令, 重岳 and 望 — and the seven 小笼泡
  buns in their steamer, after the brand's photographs, and the game's own things
  for everything else: 作战记录, 招聘许可 and a drone in the sidebar, an item
  per tool, 合成玉 for unread, 源石 for done, 理智 as the context gauge, the
  home screen's black label bars with cyan slashes.
  **蔚蓝 (Celeste)**: the game's dialogue box with a portrait for what you
  say, checkpoint plaques, dash crystals, crystal hearts, a zip mover for a
  running tool, the cabin by night and Golden Ridge's dusk by day.
  **以撒 (The Binding of Isaac)**: Rebirth's pixels — a Basement room with
  its doors, the HUD's hearts and coin / bomb / key counters, the black item
  banner for headings, paper menus, the D6 charging on a tool card.
  **星露谷物语 (Stardew Valley)**: the wooden menu frame and its tabs, the
  parchment dialogue box, the clock box, Junimos at work, a farm at the
  sidebar's foot. **小丑牌 (Balatro)**: the left column of panels, the
  swirling table, chips × mult on a tool card, Play Hand and Discard, cards
  and Jokers. **我的世界 (Minecraft)**: dirt, stone buttons, container
  windows and slots, advancement toasts, hearts and hunger over the composer,
  the furnace while a tool runs. **死亡细胞 (Dead Cells)**: the Prisoners'
  Quarters by night and the island at dusk by day, copper-framed panels,
  the three scroll colours, the Beheaded's flame. **泰拉瑞亚 (Terraria)**:
  the surface by day and night, inventory slots for sessions, life hearts
  and mana stars, the NPC dialogue box, the gold-framed map. Built on
  Tailwind CSS and shadcn/ui tokens; a theme is its own files
  (`frontend/tools/themes/README.md`). In each theme a turn's context
  usage is the game's own gauge (dash pips, the boss bar, the energy bar,
  a score bar, the experience bar, the health bar, life hearts) and each
  tool has its own picture (a pickaxe for Bash in 星露谷物语, a command
  block in 我的世界, a bomb in 以撒 …). Pixel lettering is Fusion Pixel
  (SIL OFL), bundled with Loom and fetched only by the themes that use it;
  nothing is loaded from another site.
- **New project from Move to project**: a session's … → Move to project ends
  in **New project…**: type a name, Enter, and the project is made and the
  session moved into it. Instructions are set later in Projects.
- **Search is back**: the magnifier beside the bell, or ⌘K / Ctrl+K, finds
  chats by title and by what was said in them — archived ones too, marked as
  such. The full-text search behind it had stayed; only the button had gone.
- **Engine icon in the sidebar**: each session row shows whether it runs on
  Claude Code, Codex or Kiro, after its status dot; titles stay lined up
  whether or not the dot shows.
- **Send a message into another session**: a session's `…` menu →
  **Send a message…** writes into it without opening it; an agent does the
  same with `loom-session send ID --text …`, once the user agreed (the
  loom-sessions skill). It waits for that session's turn to end. An agent's
  message arrives as "↪ From <session>", and the receiving agent is told it is
  not the user. Only the user's own sessions take one. Works between Claude
  Code, Codex and Kiro sessions in any direction.
- **Delete a device's sessions**: in Sessions (a device or this server), the
  trash button on an open session moves its files to the trash on that
  machine — macOS Trash, the XDG Trash on Linux, `~/.loom-trash` if neither
  can be written — so it can be put back. Refused while the session runs. One
  of Loom's own leaves the sidebar too, into Loom's trash.

### Changed
- **山山兔: the sidebar on warm beige**: the sidebar's ground is a bright,
  warm beige, ruled a shade deeper, with its text in brown ink — in place
  of the pale blue by day and the navy by night. In the dark appearance the
  page stays dark and the sidebar is as by day: its rows, buttons and
  pictures keep their daytime colours. The deck and the sign-in page keep
  the sky.
- **GPT-6.2 in the Codex model menu**: a Codex chat's model list now offers
  GPT-6.2 Astra and GPT-6.2 Sol (`openai.gpt-6.2-astra`, `openai.gpt-6.2-sol`
  on Bedrock), above the earlier ones.
- **A theme's stylesheets load when it is chosen**: only the theme in use is
  fetched (the default look fetches none), instead of all nine up front —
  the page's own CSS is back to about 170 KB from 1.5 MB.
- **A chat's header lists every action**: on a desktop the top right of a
  chat no longer folds the model, continuing, sharing, meeting mode and
  reload under `…`; each is its own icon beside the terminals and the canvas,
  and hovering one (or reaching it with Tab) opens its name under it. The
  model button says which model the chat is on. A phone keeps the one `…`.
- **The agent's steps look lighter, and move**: a folded stretch of tool calls
  is a soft chip with the tools as small tags; while it runs its mark spins
  and its words shimmer, a finished one's check pops in, the chevron turns as
  it opens and its steps slide down. Thinking has a spark, and "Working…" is
  three dots in a wave. Nothing moves under the system's "reduce motion".
- **The trash empties itself**: a deleted session stays in
  `~/.loom/sessions/.trash` for 30 days, so it can still be put back, and then
  goes for good (checked hourly).
- **Project files open on the project page**: a Markdown, image, video, PDF,
  web page, table or text file in the Files tab now opens in place with the
  canvas's viewers; the download mark on its row still downloads it.
- **The bell acts on your answer**: a notice's session now carries out what you
  decided itself, then tells the employee or task that asked what it did.
- **Suggested answers in a notice's session**: the answers the employee or task
  foresaw show as one-tap replies under the brief — in the session, after
  you have read it, not on the card.
- **One card for the night's sleep**: every project's Dream proposals gather in
  one notice; its session asks one question per project, and a project with
  nothing to ask posts nothing.
- **Employees do it in the chat**: when you ask an employee something in its
  chat, it does it there; it adds a KPI only when you ask for one, and can
  remove a KPI it added. What it can't see (calls, SFDC), it asks about
  ("done yet?") instead of calling it undone.
- **Cheaper idle wake-ups**: an employee's work session turns over at 150k
  tokens instead of 60k, and wake-up sections that haven't changed are sent
  as one line.

### Fixed
- **山山兔: the head sits square under the ears**: the hood's black rim ran
  down the right side of the head only, so the head was a square wider on
  that side and the ears — themselves a mirrored pair — looked uneven. The
  rim now runs down both sides, on the rabbit on the composer, the big
  sitting one and the small one.
- **Themes: a square choice no longer sits in a round track**: in Settings'
  switches (language, appearance, engine) of 死亡细胞, 小丑牌 and 山山兔 the
  track was a pill while what was chosen was square; tags, file cards, menu
  rows and tool cards had the same mismatch in places. Loom's shared shape
  rules outweighed the theme's own; they no longer do.
- **蔚蓝 and 死亡细胞: the picture at the sidebar's foot no longer covers the
  list**: it kept two or three rows' worth of the list for itself, and in
  死亡细胞 it grew with a wider sidebar until it lay over the last titles.
  Now it is the end of the list: it stands on the foot when the sessions
  leave room, and comes after the last of them when they do not.
- **iPhone dialogs clear the notch**: in the iPhone home-screen app, tall
  dialogs such as Devices no longer run under the notch and home indicator.
- Codex sessions now get `LOOM_SESSION_ID` in their shell commands (through the
  thread's `shell_environment_policy`), so `loom-session` and `loom-notice` work
  there as in Claude Code and Kiro; before, they failed with "LOOM_SESSION_ID is
  not set".
- Device sessions: arguments reach the scan script through `json.loads`, so a
  `true` or `null` no longer breaks it.
- loom-node falls back to IPv4 when the usual dial fails on the network, and
  tries IPv4 first on later reconnects. A network whose IPv6 is broken past the
  connect ("write: socket is not connected") used to keep the device offline
  until IPv6 was turned off on it.
- **An employee's work card is no longer lost to a queued message.** A
  message typed in an employee's Updates (or chat) while it worked started the
  next turn the moment the turn ended, and that turn's end was never
  announced: its card (KPI progress, the report for the bell, when to wake)
  was dropped, and only the follow-up turn's card counted. Every turn's end
  is announced now. A turn with no card also keeps a wake that was already
  planned instead of pushing it out to the heartbeat.

## [0.6.0] – 2026-11-04

### Added
- **Message queue**: a message typed while the agent is working no longer
  cuts into the turn. It waits in the queue above the composer and goes out
  as the next turn when this one ends — several at once go together, as in
  Claude Code. **Send now** puts them into the running turn after all; ✕
  drops one. Cron, notices and employees still steer as before.
- **A device's sessions**: Devices → **sessions** on an online Mac or Linux
  box lists the Claude Code and Codex sessions on it, the running ones on
  top (busy or idle, pid), each with its folder, model, size and last reply;
  pick one to read its latest turns, followed live while it runs. Read on
  the device through loom-node by a read-only script
  (`priv/device_sessions/sessions.py`); nothing is kept on the host.
- **Continue a device session in Loom**: from any of them, **Continue in
  Loom** opens a new session whose brief carries that session's gist and
  recent turns, and which works where it did — on the device, in its folder,
  through loom-node (resuming the original there with `claude --resume`
  when the whole history matters). With a next step written it starts at
  once; without, it opens on the brief.
- **Smart pick**: describe the task and the sessions most likely to be that
  work come first, with a score and a reason each (a one-shot model call;
  matching words when no model answers).
- **Device sessions** at the top of the sidebar, under Tasks: unfold it,
  tap a device, and its sessions open — no trip through the Devices dialog.
- **This server in Device sessions**: the server Loom runs on is listed
  first, so the main agent's own history can be read and picked from like a
  device's. Loom's own sessions are marked and open as themselves rather
  than being continued into a copy; Smart pick on a device searches this
  server's sessions too.
- **Kiro sessions** are listed beside Claude Code and Codex (its subagent
  sessions left out), with their transcripts, and can be continued in Loom.
- **Titles that keep up**: ten minutes after a turn, the same small-model call
  that writes a Working row's recap also retitles the session — from its first
  message to what it is about, and to "old topic · new topic" once the talk
  moves on. Never over a title the user gave, nor in a meeting's chat.
- **Reference a recent chat**: the composer's + opens a menu — Files, or
  "Reference a chat…", a dialog of recent chats with a title filter. A picked chat rides along as a chip; the agent is told
  its title, id and directory and reads it with `loom-session read` only if the
  request needs it. Tap the chip in a sent message to open that chat.
- **Share a chat as an image**: "Share…" in the chat's menu lists the
  conversation as exchanges, all picked, tool calls, thinking and files left
  out; untick what should not go. "Share image" draws it on the server as one
  long PNG (headless Chrome, no network) and shows it the way ChatGPT's share
  dialog does: a preview card, then Share (the system sheet), Save image and
  Copy image.
- **Continue picks the backend**: an arrow beside "Continue in new chat" (in
  the chat and in a sidebar row's menu) lets the new chat run on another
  backend instead of the old one's.

### Fixed
- One-shot model calls (filing a session into a project, reading a described
  schedule, smart pick) on a gateway that refuses `haiku` now retry on the
  CLI's default model. `LOOM_ONESHOT_MODEL` sets the model (empty for the CLI
  default).
- Sidebar: a Working row's dot sits level with the engine icon beside it.

### Changed
- **Deleting a session moves it to the trash** (`~/.loom/sessions/.trash/
  <id>.<ms>`) instead of removing it; nothing is ever removed, and getting a
  session back is a `mv`. (From EthanLLL/loom.)
- The queue panel is a card as wide as the composer; folded to icons, the
  sidebar foot shows each button's label as a bubble on hover. A queued
  message shows only in the queue until it goes out, then lands where it
  was sent.
- Slash-command menu: the picked command is clearly highlighted and hover
  picks it; a phone keyboard's return key says send. (From EthanLLL/loom.)
- `rel/systemd/loom.service`: an OOM kill takes only its victim, not Loom.
  (From EthanLLL/loom.)
- **Each bell notice has a session of its own**: posting one starts a session
  that opens on the brief its source wrote (now up to 6000 characters,
  markdown; `loom-notice post --detail-file`). Tapping the card or the push
  opens it; ask there and decide, and its agent passes the decision to the
  source session. It shows in Recents once you write in it. The card keeps
  only Later and Done, plus two lines of the brief: the one-tap answers,
  Approve/Reject and the inline reply are gone, and so is the bell's Chat tab.
- Devices: online ones are grouped by kind (Linux, Windows, Mac, Android,
  Bot), offline ones last.
- Employee page tabs: Updates comes first.
- Meeting bar: the people icon and the bare line count are gone; they read as
  attendees and rounds.
- loom-home: the Bedrock connection is warmed when a device opens its channel
  and kept alive for 75 s, so the first reply comes sooner.
- loom-home: the reply starts sooner — it begins at a short pause and plays
  once the sentence is clearly complete (longer wait if it ends mid-thought);
  at most one filler, only when the reply is late.

### Security
From an AWS Continuum code scan (40 issues; the critical, high and medium ones
handled here). Nothing changes for normal use.
- Login: wrong passwords are throttled per client (5 tries, then a growing
  wait up to 15 min) and globally, cost 300 ms each and are logged; the login
  page says when to wait. An empty `LOOM_PASSWORD` no longer starts, and an
  empty password never matches. Changing the password logs out every device
  (tokens minted before this release still last their 30 days).
- Meeting models and `bpe.vocab` are checked against pinned SHA-256 before
  they are unpacked or served.
- Session ids from headers or URLs must look like session ids, so none can
  reach a path outside `~/.loom/sessions` (read or delete); the bell's
  act-for-the-user gate also needs the session's header to name itself.
- `claude` one-shots end their options with `--`, so a prompt starting with
  `-` stays a prompt. Session titles in the Dream prompt are fenced and
  stripped of control characters.
- loom-node: the install script passes the token on stdin, not on the command
  line; the MQTT broker drops users with an empty password; exec timeouts are
  capped at 30 min; device-reported join fields are length-checked; a
  cleartext `http://` loom URL logs a warning.
- loom-home: optional TLS (`tls`, `mqtt.tls`), per-robot tokens
  (`device_tokens`) or a Device-Id allowlist, an optional local API token; the
  local API refuses browser requests (Origin/Referer, non-loopback Host) and
  only calls tools the robot lists. Conversation history is capped.

## [0.5.0] – 2026-11-03

### Added
- **loom-home** (`home/`): an open home IoT setup on Loom. `loom-node` has a
  minimal MQTT broker (`loom-node mqtt pub|sub`, e.g. on the router); devices
  announce what they can do and take commands over it ([PROTOCOL](home/PROTOCOL.md)).
  A voice server lets xiaozhi-protocol robots control them by speech
  (VAD → SenseVoice → Claude or GPT on Bedrock → local TTS / edge-tts), with
  nothing hard-coded about the devices. Bedrock can be reached directly, through a
  proxy or through your own endpoint (`bedrock.endpoint`).
- **Meeting mode**: "Meeting mode" in a chat's `…` menu listens to a meeting
  (your microphone plus the shared screen's system audio), transcribes it in
  the browser with sherpa-onnx (Chinese + English, voices told apart), and
  sends the agent a batch about every 30 s for live hints; "End" asks for the
  minutes. Batches and quiet turns are folded. The speech models (~230 MB) load
  only after you agree, through the server, with progress. The opening prompt
  can be replaced with `~/.loom/meeting/prompt.md`. Opening it already sends
  the prompt and starts the recognisers, so the agent is ready by Start.
  Product names are favoured as hotwords: AWS by default, plus what the agent
  learns — it reads through misrecognised names, writes the right ones, and
  adds customers, people and products to `~/.loom/meeting/hotwords.txt`
  (the `loom-meeting` skill), which a running meeting picks up at the next
  pause. Ten minutes of silence, or a closed page,
  ends the meeting with minutes as End does.
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
- **Desktop spacing**: a 12px inset keeps controls away from the window edges,
  with rounded content corners, including in full screen. Sidebar resizing and
  installed-app window controls account for the inset.
- **Only the bell rings the phone.** A turn ending no longer sends a
  notification; only bell notices 0–5 do, at once, one each. The 20:00
  digest is gone. Between 00:00 and 07:00 only a 0 rings; the rest go out
  at 07:00. A long job that should wake you posts a notice.
- **0–1 ring through silent mode**: a bell notice at 0–1 also sends a Bark
  critical alert (self-hosted bark-server, `bark` skill), when set up; a 0
  keeps ringing for 30 seconds.
- **Taps answer at once**: New chat opens immediately and the server makes
  the session in the background (the first message waits for it, retrying on
  a weak network). Pin, archive, done, move, rename, delete and to-do ticks
  show on the tap and are put back, with a note, if the server refuses.
  So do the model pick, bell answers, to-dos, employee Wake/Pause/KPI review,
  Boss lines, file rename/delete, Sleep settings and device rename.
- **Employees keep an hour-long prompt cache** when their heartbeat is between
  5 and 60 minutes, so an idle wake-up no longer rewrites its whole context.
- **New app icon**: an interlaced three-loop knot.

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

[0.6.0]: https://github.com/quanquan1996/loom/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/quanquan1996/loom/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/quanquan1996/loom/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/quanquan1996/loom/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/quanquan1996/loom/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/quanquan1996/loom/tree/v0.1.0

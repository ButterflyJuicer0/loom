---
name: loom-guide
description: Answer questions about Loom itself — what it can do, how a feature works or is set up, where its settings and data live, how to deploy or restart it. Use when the user asks about Loom, this web UI, its sessions, projects, tasks/cron, devices, browser, canvas, keys or deployment ("loom 怎么…", "这个软件支持…吗", "how do I … in Loom").
---

# loom-guide: read Loom's own docs before answering

Loom's documentation lives in its checkout, which is not necessarily your
working directory. Find it from the service:

```sh
systemctl cat loom | grep WorkingDirectory    # usually ~/loom
```

Then read the file that fits the question, rather than answering from memory:

- `README.md` — what Loom does, feature by feature, for the user.
- `docs/architecture.md` — how each part works: sessions, channels, devices
  (loom-node), the browser, cron, files.
- `docs/deploy.md` — installing, the systemd unit, `rel/deploy.sh`, restarts.
- `docs/backends.md` — the Claude Code, Codex and Kiro backends.
- `docs/keys.md` — API keys and credentials.

Some features are told only in the skill that uses them and in
`CHANGELOG.md`, not yet in the docs above:

- **Sessions talking to each other.** A message can be written into a
  session that already exists, without opening it: by the user from that
  session's … menu → *Send a message…*, or by an agent with
  `loom-session send ID --text "…"` (`POST /api/tidy/send`, one path for both
  in `Loom.Agent.Relay`). It waits for that session's turn to end, then is
  its next turn. Only the user's own sessions take one — not an employee's,
  Dream's or the bell's, nor the sender's own. An agent's message shows as
  "↪ From <session>", and the receiving agent treats it as a request from
  that session, not the user, and checks with the user before acting on it.
  An agent sends only with the user's yes. How to find the id and write the
  message: the loom-sessions skill (`skills/loom-sessions/SKILL.md`, "Sending
  into another session"). To start a new session with a brief instead, that
  is loom-handoff.
- **Which engine a session runs on.** Every row in the sidebar shows the
  engine's icon — Claude Code, Codex or Kiro — after the status dot, with its
  name on hover (`BackendIcon` in `frontend/src/Sidebar.tsx`). An idle row
  keeps the dot's place, so titles line up. The engine is fixed for a
  session's life; to carry one on in another, use its … menu → *Continue in
  new chat* and the arrow beside it.
- **Devices on a network with broken IPv6.** loom-node retries a failed dial
  over IPv4 only, then keeps trying IPv4 first, so such a device comes online
  without turning IPv6 off. It needs a loom-node with this fix: an older one
  is updated by reinstalling (`loomctl node reinstall DEVICE`). Details:
  `docs/architecture.md` §4.4, "Broken IPv6"; code: `dialSocket` in
  `node/phx.go`.
- **Android phone: "the Android app was not built on this host".** The APK
  is only built when the host has a JDK and Android SDK, and deploy skips it
  without saying so. Build it once and copy it to `priv/node/loom-node.apk`,
  then make a fresh install code. Steps: skills/loom-cli, "When a device does
  not connect"; background: `node/android/README`.
- **Device sessions in the sidebar: lit vs grey.** A device row is lit
  whenever the device is online, grey only when it is offline. Only macOS and
  Linux rows open the sessions view (it runs `python3` on the device); an
  online Windows or Android row is lit but does not open, and says so on
  hover. Code: the `devices.map` under "Device sessions" in
  `frontend/src/Sidebar.tsx`.
- **A chat's header buttons.** On a desktop the top right of a chat lists
  every action as its own icon, left to right: model (opens the list of
  models), terminals, canvas, continue in a new chat (opens the list of
  engines), share, keep (an incognito chat only), meeting mode, reload.
  Hovering one, or reaching it with Tab, opens its name under it — the model
  button's says which model the chat is on. On a phone there is no room and
  no hover: the same actions are under the one `…`. Code: `HeaderActions`
  and `Tip` (desktop), `PaneMenu` (phone) in `frontend/src/Chat.tsx`; the
  tip is shadcn/ui's `components/ui/tooltip.tsx`, styled `.head-tip` in
  `theme.css`.
- **Language of the interface.** Settings → Language: 中文 or English, per
  device (localStorage), Chinese by default; changing it reloads the page.
  Only the interface is translated — titles, replies and notices show as they
  come. Mechanism: `t("English")` looks the text up in the Chinese
  dictionaries `frontend/src/i18n/zh/*.ts` (one per source file) and falls
  back to the English (`frontend/src/i18n.ts`); a string still in English in
  the Chinese interface is one nobody has put in a dictionary.
- **Themes.** Settings → Theme: "Loom 默认" (the original look) and eight
  designed themes — 山山兔, 蔚蓝 (Celeste), 以撒 (The Binding of Isaac:
  Rebirth), 星露谷物语 (Stardew Valley), 小丑牌 (Balatro), 我的世界
  (Minecraft), 死亡细胞 (Dead Cells), 泰拉瑞亚 (Terraria) — each light and
  dark (the Appearance switch), per device. They are tributes: every picture
  is Loom's own pixel art drawn after screenshots of the real thing; nothing
  is taken from a game's files. A designed theme is colours, corners,
  shadows and a font (system fonts, or the bundled pixel font) as shadcn/ui
  tokens, plus pictures and motion of its own for every kind of component;
  in the game themes the line under a turn shows context usage as the
  game's gauge (energy bar, experience bar, hearts …) and each tool has its
  own picture; motion stops under the system's "reduce motion". How: `settings.ts` puts the theme in
  `data-style` and light/dark in `data-theme` on `<html>`. **A theme is its
  own files and nothing else** (`frontend/tools/themes/README.md`): tokens
  `frontend/tools/themes/<id>.json` → `src/themes/<id>.tokens.css` and
  `<id>.meta.json` (`node tools/themes.mjs <id>`), mapped onto Loom's
  variables by `themes.css`; design `src/themes/<id>.css`; pictures
  `src/themes/art/<id>-*.svg` from `tools/art/<id>.mjs`
  (`node tools/theme-art.mjs <id>`; `<id>-mark.svg` is the one on its card).
  Nothing is listed by hand: `themes.ts` and the picker find them by name,
  and `themes/index.ts` fetches a theme's stylesheets only when it is chosen
  (`settings.ts` sets `data-style` once they have arrived), so the page
  loads one theme's CSS, not all of them. What components expose to themes: `--usage` (0–1) and `data-usage` on
  `.turn-line` for a context gauge, `data-tool` on `.tool`, `.tool-chip` and
  `.tool.group` for a picture per tool, and the bundled pixel font Fusion
  Pixel (OFL, `frontend/public/fonts`) behind `--font-pixel`. Don't set `position` on `.sidebar`
  in a theme: it is a drawer on a phone. Tailwind CSS and shadcn/ui
  components (`frontend/src/components/ui`, `components.json`) are available
  for new UI; the theme picker (`ThemePicker.tsx`) is built with them.
- **Opening a project's files.** On a project's page → Files, a Markdown,
  image, video, PDF, HTML, table or text file opens in a viewer in place; the
  download mark on its row still downloads it. Served from a signed, sandboxed
  `/project-files/<id>/<token>/` prefix (`LoomWeb.CanvasController`).
- **Searching chats.** The magnifier beside the bell at the top of the
  sidebar, or ⌘K (Ctrl+K off Apple devices; not from inside the terminal),
  opens Search: empty it lists the latest chats, typed in it finds chats by
  title at once and by what was said (the user's messages and the agent's
  replies, not tools or thinking) from `GET /api/search`. Archived chats are
  found too and marked "archived"; incognito, employee, Dream and bell
  sessions are not. A full scan of every `events.jsonl` per query, no index
  (`Loom.Agent.Search`); UI in `frontend/src/Search.tsx`.
- **Moving a session into a new project.** A session's … menu → *Move to
  project* lists the projects and ends in *New project…*: a name typed there
  and Enter creates the project (name only; instructions later in Projects)
  and moves the session into it. Code: `createAndMove` in
  `frontend/src/SessionMenu.tsx`.
- **The session trash.** Deleting a session moves its directory to
  `~/.loom/sessions/.trash/<id>.<unix ms>`; there is no page for it. To put
  one back, `mv` it to `~/.loom/sessions/<id>` and restart
  Loom so the sidebar picks it up. After 30 days an entry is removed for good
  (`Loom.Agent.Trash`, hourly; `Store.purge_trash/2`). Device sessions deleted
  from Sessions go to that machine's own trash instead and are not purged.
- **Giving a virtual employee work from another session.** There is no CLI
  for it; a session uses the HTTP API on the host
  (`http://127.0.0.1:4000/api`, header
  `authorization: Bearer $(cat ~/.loom/cli-token)`; routes in
  `lib/loom_web/router.ex`, `EmployeeController`). `GET /employees` and
  `/employees/<id>` show `status`, `hours`, `wake_at`, `kpis`, `model`,
  `max_turn_min`. A task is a KPI plus a wake-up: `POST /employees/<id>/kpis`
  (`title`, optional `detail`, `criteria`, `due`, `priority`), then
  `POST /employees/<id>/wake {"note": "…"}`. Outside its `hours` the wake
  waits for them; to start now, `PATCH /employees/<id> {"hours": null}`, wake
  it, and put the hours back once `turn_started_at` is set. `PATCH` also sets
  `model` (an employee cannot change its own), `heartbeat_min`,
  `max_turn_min`, `budget_usd` and the other settings of its page. Do this
  only when the user asked for it. An employee's reports reach the user
  through the bell: every turn's work card is read, including the turn a
  queued message follows (docs/architecture.md §2.9). To check that a report
  arrived, look for the notice itself (`GET /notices`, or
  `~/.loom/notices.json`), not the employee's word.

If the docs don't settle it, read the code: `lib/` (Elixir server),
`frontend/src/` (UI), `node/` (loom-node). Say which you checked.

Don't restart Loom unasked. Restart it with
`_build/prod/rel/loom/bin/loom rpc 'Loom.Restarter.request()'`, which is how
`rel/deploy.sh` does it — never `systemctl restart`. Claude Code and Kiro turns,
this one included, keep running through the restart and are taken back by the
new node (docs/architecture.md §2.3), so the request waits only for Codex turns.
To check something after the restart, add a temporary `Loom.Cron` job aimed at
your own session to wake you, and delete it when done.

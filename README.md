<div align="center">

# Loom

**A self-hosted, phone-first home for coding agents.**
Claude Code, Codex and Kiro on your own server, from any browser or phone,
with your own machines one command away.

[![Version](https://img.shields.io/badge/version-0.4.0-black)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE)
[![Elixir](https://img.shields.io/badge/Elixir-Phoenix-4B275F)](mix.exs)
[![React](https://img.shields.io/badge/React-Vite-149ECA)](frontend/)
[![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Codex%20%7C%20Kiro-D97757)](docs/backends.md)

**English** · [简体中文](README.zh-CN.md)

[Website](https://quanquan1996.github.io/loom) ·
[Features](#features) ·
[What's new vs upstream](#whats-new-in-this-fork) ·
[Changelog](CHANGELOG.md) ·
[Quick start](#quick-start) ·
[Docs](#docs)

</div>

---

Loom is a single-user front end for coding agents. The agents run on your
server; Loom streams them to every device you own. Close the laptop, pick up
the phone, and the turn is still running. Nothing is sent to a model by Loom
itself: the `claude`, `codex` and `kiro-cli` CLIs do the work, with the logins
you already have (Anthropic, Bedrock, OpenAI, Kiro).

This repository is a fork of [EthanLLL/loom](https://github.com/EthanLLL/loom),
branched at `cf1facd` (2026-10-28) and developed on its own since, with 140+
commits on top. It does not track upstream.

## Highlights

- **Three agents, one UI.** Claude Code, Codex and Kiro CLI (ACP), picked per
  session, with the model picked per session too and shown on every turn.
- **Built for the phone.** A ChatGPT-style interface measured from its iOS
  app: swipeable Working cards, tap-to-answer suggested replies, one-tap copy,
  drafts that follow you between devices.
- **Turns survive restarts.** Upgrade or restart Loom mid-turn; Claude Code
  and Kiro keep working and Loom picks them up again.
- **Agents that work without you.** Scheduled tasks said in words, virtual
  employees with budgets and KPIs, a nightly Sleep that tidies memory, and a
  bell where they ask for your decision.
- **Your own machines as tools.** macOS, Linux, WSL, native Windows and
  Android join with one line (or one APK); remove a device and it uninstalls
  itself.
- **Organised, not just a list.** Projects with a shared workspace, pinning,
  incognito chats, Continue-in-new-chat, and automatic retitling and archiving.

## What's new in this fork

| Area | Upstream Loom | This fork |
| --- | --- | --- |
| Agent backends | Claude Code, Codex | **+ Kiro CLI** (ACP), with Claude Code's MCP servers and skills carried over |
| Model choice | Per backend | **Per session**, from the chat header; each turn labelled with the model that answered; fallback model on overload |
| Restarts | Sessions restored from disk | **Turns in flight carry on** through a restart or crash and are taken back after it |
| Interface | Dark theme | ChatGPT look, phone theme measured from ChatGPT iOS, glass header and composer, light/dark, text size per area |
| Session list | One list | Recents, **Pinned**, **Working** (last hour, swipeable cards with a recap), resizable sidebar |
| Projects | — | Sessions grouped around a **shared workspace and instructions**; a project page with Files and Sessions |
| Session kinds | Normal | **Incognito** (sandboxed, auto-deleted after 30 days), **Continue in new chat** (fork or read), classifier-stopped sessions set aside |
| Composer | Text + attachments | **Suggested replies** (incl. several questions at once), drafts synced across devices, failed messages kept with resend, atomic attachment upload |
| Copying | Select text | Tap inline code to copy; copy button under every message |
| Scheduling | `/cron` | **Tasks page**, HTTP API, wall-clock times, tasks described in plain words |
| Autonomy | — | **Virtual employees** (budget, KPIs, workstation on one device, shared boss profile), **Sleep / Dream** memory consolidation |
| Notifications | Push when a turn ends | **The bell**: prioritised notices (0–10) posted by agents, with background, answers, Later; plus your to-do list |
| Housekeeping | — | `loom-tidy` / `loom-retitle`: retitle, archive, merge sessions, on a schedule |
| Devices (`loom-node`) | macOS, Linux, WSL | **+ native Windows, + Android** (one APK, screen control), device icons, self-uninstall on removal, install-code brute-force lock |
| Browser | Desktop window | + a **phone-shaped** window and stream |
| Deploy | `rel/deploy.sh` | **`rel/ship.sh`**: ships committed code only, never older than what is live, lists the commits and waits for `--yes` |

See the [changelog](CHANGELOG.md) for what came in which version.

## Features

### Agent sessions

- **Claude Code, Codex and Kiro**, chosen per session. Claude Code keeps one
  warm `claude -p` per session, so replies start in about 2s instead of 10s.
  Kiro runs over the Agent Client Protocol and gets Claude Code's MCP servers
  and skills.
- **Model and thinking level per session**, switched from the header; each
  turn shows which model answered. `LOOM_CLAUDE_FALLBACK_MODEL` takes over
  when the usual model is overloaded.
- **Every device sees the same session.** Start a turn on the laptop, watch it
  finish on the phone. A reconnecting tab replays only what it missed, and a
  phone back from sleep reconnects by itself.
- **Talk while it works.** A message sent mid-turn joins the running turn.
- **Turns survive restarts.** A Claude Code or Kiro turn keeps running while
  Loom is down, even after a crash, and is picked up where it was. Only a
  Codex turn is waited for before a restart.
- **Slash commands**: `/compact`, `/reload`, `/cron`, with a menu in the
  composer.

### Chat on a phone

- **Suggested replies.** An agent ends its reply with the answers it expects;
  they show as buttons that fill the composer. Several questions at once get a
  page each, and the picks come back as numbered lines.
- **Nothing gets lost.** Each session's draft is kept on the device and on the
  server, so it follows you between devices. A message that does not get
  through stays with a red "!" to resend. Attachments upload on send, all at
  once: the message goes whole or not at all.
- **One-tap copy**: tap inline code, or the copy button under any message.
- A ChatGPT look, glass header and composer, light and dark themes, text size
  per area, an unread mark, and an iOS home-screen app that keeps clear of
  iOS's top blur.

### Organising sessions

- **Projects**: sessions that share a workspace and instructions. A project
  opens a page with Files and Sessions tabs; sessions move in and out, and a
  moved session is told about its project before its next message.
- **Pinned, Working, Recents.** Sessions used in the last hour sit in Working
  until marked Done; on a phone they are cards you swipe through, each with a
  recap and the start of the last reply.
- **Incognito chats** run sandboxed (`bwrap`: read everything, write only
  their own workspace), stay out of Recents, memory and projects, and are
  deleted 30 days after their last message unless kept or pinned.
- **Continue in a new chat**: carry a long session on, by forking it or by
  having the new one read it.
- **Tidy**: the `loom-tidy` and `loom-retitle` skills retitle, archive and
  merge sessions in one go, as a daily task if you like. Archived sessions
  are in Settings.
- **Handoff**: an agent that finds a matter belongs in its own conversation
  can, once you agree, open one in Recents with a brief.

### Agents that work on their own

- **Tasks.** "Every weekday at 10:00, check …": prompts on a schedule, in
  wall-clock time, created by agents from what you say, listed on a Tasks
  page, with an HTTP API (`Loom.Cron`).
- **Virtual employees.** An agent with a role, KPIs and a daily budget that
  keeps working on the projects it is given, on Claude Code, Kiro or Codex. A
  workstation can bind it to one device, enforced by a hook. All employees
  share one boss profile, learned from your words and editable by you.
- **Sleep / Dream.** At night a hidden session goes over each project's
  sessions and consolidates Claude Code's memory, writes a report, and only
  proposes changes outside the memory directory. The memory is a git
  repository, so a night can be undone.
- **The bell.** Agents post notices with a priority from 0 to 10, a
  background and suggested answers; opening one jumps to the turn it is about,
  and Later puts it off. Your to-dos sit beside them.
- **Safety classifier stops** are handled: a flagged session is set aside and
  can be continued in a fresh one.

### Terminals

- Real PTY shells beside the chat, several at once, that outlive the tab and
  can be shared by two devices. OSC 52 clipboard writes reach the browser.

### Canvas and slides

- Anything an agent writes to the session's `output/` directory shows up in a
  pane beside the chat: pages, charts, dashboards, image galleries, with
  viewers for images, audio, video, Markdown, CSV and text, and a file tree of
  everything in the session.
- Pages run sandboxed on an opaque origin, so they cannot reach Loom's token
  or API.
- Ask for a deck and the agent writes a reveal.js page, with code
  highlighting, KaTeX, offline assets and a PDF button.

### Your own devices (`loom-node`)

Install `loom-node` on a Mac, a Linux box, WSL, a Windows PC or an Android
phone, and agents in any session can work on that machine as you.

- **Run commands** in your login shell (PowerShell on Windows), with output
  streamed back and the real exit code; **read and write files**,
  binary-safe.
- **Android**: one APK; with accessibility enabled, agents can see the screen
  and tap, swipe and type (`loom-node control`).
- **One-line install** from the Devices dialog: `curl … | sh`, or
  `irm … | iex` on Windows. A per-user service reconnects after sleep and
  reboot; no administrator needed.
- **Outbound only**: the device dials Loom, so it works behind NAT.
- **Its sessions**: the Devices dialog lists the Claude Code and Codex
  sessions on a Mac or Linux device — running ones first — shows their
  latest turns, picks the one a described task belongs to, and continues any
  of them in a new Loom session that works on the device.
- **Safe defaults**: each device has its own token, stored only as a hash.
  Install codes last a day, and 20 wrong codes in 2 minutes void them all.
  Removing a device makes `loom-node` uninstall itself and delete its scratch
  space and logs. Everything a device runs is logged on that device.

### Browser

An optional Chromium that stays running on the host, on a virtual display
(`rel/browser/`), desktop- or phone-shaped. Agents drive it over CDP; you take
it over from **Browser** in the sidebar (noVNC, behind Loom's login) to sign
in once or pass a captcha.

### Skills that ship with Loom

| Skill | What it does |
| --- | --- |
| `browser` | Use the shared, logged-in Chromium |
| `slides` | reveal.js decks in the canvas |
| `loom-guide` | Answer questions about Loom from its own docs |
| `loom-notify` | Post to the bell and the to-do list |
| `loom-sessions` | Find and read an earlier session |
| `loom-handoff` | Hand a matter off to a new session |
| `loom-tidy`, `loom-retitle` | Retitle, archive and merge sessions |

### App

- Installable as a PWA. **Notifications** when a turn ends, on the lock screen
  too, with no account or push key of your own.
- **Vim-style keys** on desktop: `i` to type, `j`/`k` to scroll, Space as the
  leader, `?` for the list ([docs/keys.md](docs/keys.md)).

## Quick start

Requirements:

- Elixir / Erlang (see `mix.exs`), Node.js + pnpm, Go (for `loom-node`)
- At least one agent CLI on `PATH` and logged in: `claude`, `codex` or
  `kiro-cli`

```sh
git clone https://github.com/quanquan1996/loom && cd loom
mix setup && (cd frontend && pnpm install)

mix phx.server             # backend on :4000
cd frontend && pnpm dev    # frontend on :5173, proxies /api and /socket
```

Open <http://localhost:5173>. The password is `LOOM_PASSWORD` (`loom` in dev).

For a server, see [docs/deploy.md](docs/deploy.md): one machine, Loom on
loopback, Cloudflare Tunnel in front, systemd. Then
release with:

```sh
rel/ship.sh            # lists the commits since what is live
rel/ship.sh --yes      # builds and restarts; running turns carry on
rel/ship.sh --frontend --yes   # frontend-only hot swap, no restart
```

## Development

| Command | |
| --- | --- |
| `mix test` | Backend tests |
| `mix precommit` | Compile with warnings as errors, format, test |
| `cd frontend && pnpm build` | Type-check and build |
| `cd frontend && pnpm md:check` | Markdown renderer cases |
| `cd frontend && pnpm transcript …` | Record / replay a live agent stream ([details](docs/architecture.md#81-debugging-record-and-replay)) |

## Docs

- [docs/architecture.md](docs/architecture.md): how Loom is built (sessions,
  projects, sleep, employees, the bell, incognito, devices)
- [docs/backends.md](docs/backends.md): the Claude Code, Codex and Kiro
  protocols, as measured
- [docs/deploy.md](docs/deploy.md): deploying on one machine
- [docs/keys.md](docs/keys.md): the keyboard
- [CHANGELOG.md](CHANGELOG.md): versions and what each added

## Acknowledgements

Built on [EthanLLL/loom](https://github.com/EthanLLL/loom), which this fork
started from.

## License

[MIT](LICENSE)

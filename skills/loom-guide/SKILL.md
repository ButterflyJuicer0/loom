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
- **Devices on a network with broken IPv6.** loom-node retries a failed dial
  over IPv4 only, then keeps trying IPv4 first, so such a device comes online
  without turning IPv6 off. It needs a loom-node with this fix: an older one
  is updated by reinstalling (`loomctl node reinstall DEVICE`). Details:
  `docs/architecture.md` §4.4, "Broken IPv6"; code: `dialSocket` in
  `node/phx.go`.

If the docs don't settle it, read the code: `lib/` (Elixir server),
`frontend/src/` (UI), `node/` (loom-node). Say which you checked.

Don't restart Loom unasked. Restart it with
`_build/prod/rel/loom/bin/loom rpc 'Loom.Restarter.request()'`, which is how
`rel/deploy.sh` does it — never `systemctl restart`. Claude Code and Kiro turns,
this one included, keep running through the restart and are taken back by the
new node (docs/architecture.md §2.3), so the request waits only for Codex turns.
To check something after the restart, add a temporary `Loom.Cron` job aimed at
your own session to wake you, and delete it when done.

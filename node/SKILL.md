---
name: loom-nodes
description: Run commands and read or write files on the user's own machines (their Mac, Windows PC, WSL, home PC) rather than on this server. Use when the user refers to "my computer", "my Mac", "my PC", "local", "本地", "我电脑上", "我的 Mac", "Windows", "WSL", or a device by name, or asks for something that only exists on their machine.
---

# loom-nodes: the user's own devices

This server is not the user's computer. Their machines connect to loom and can
be reached with the `loom-node` CLI, from your shell.

## 1. See what is there

```sh
loom-node list
```

Shows each device's name, whether it is online, its OS and arch. Use the
NAME column in the commands below. If the user did not say which device and
there is more than one online, ask.

## 2. Run a command

```sh
loom-node exec <device> [--cwd DIR] [--timeout SECONDS] -- '<command>'
```

- **Single-quote the command.** It is run on the device by the user's login
  shell (`$SHELL -lc`). Unquoted, `~`, `$VAR`, globs and pipes would be
  expanded by *this* server's shell first.
- Starts in the device's home directory unless `--cwd` is given.
- **Scratch files go in `$LOOM_WORK`** (`$env:LOOM_WORK` on Windows): clones,
  downloads, build output, anything that is yours rather than the user's. It
  is deleted with loom-node when the device is removed, so nothing of yours is
  left on someone else's machine. Write elsewhere only what the user asked for.
- stdout and stderr come back as they are produced, and the exit code is the
  command's own.
- No stdin and no terminal: anything interactive (prompts, `sudo` asking for a
  password, editors, pagers) cannot be answered. Pass flags like `-y`, or use
  `git --no-pager`, `| cat`.
- **Windows devices** (OS `windows` in the list) run the command in
  PowerShell — `pwsh` if installed, else Windows PowerShell 5.1, which has no
  `&&` (use `;` and `if ($?) {…}`). Write PowerShell, not sh: `Get-ChildItem`
  or `ls`, `$env:USERPROFILE`, `Select-String` for grep. Output is UTF-8.
  `C:\Users\…` and `~\…` paths both work for read/write.
- Default timeout 120s, at most 1800s. A command that runs past it is killed
  and exits 124 — raise `--timeout` for builds and long tests.
- Output beyond 10 MB is dropped (a note says so); narrow it with `head`,
  `tail`, `grep`.

## 3. Move files

```sh
loom-node read  <device> <path> > local-file     # device → here
loom-node write <device> <path> < local-file     # here → device
```

Binary-safe. `write` creates parent directories and replaces the file
atomically. `~/…` and relative paths are relative to the device's home. To show
the user a file from their device, read it into your `output/` directory.

## Exit code 255

loom itself could not finish: the device is offline, unknown, or dropped the
connection mid-command (the command was killed on the device). stderr says
which. Run `loom-node list` to check that the device is back online before
retrying; if it stays offline, tell the user rather than retrying in a loop.

## 4. Drive an Android screen (see, tap, type)

An Android device (OS `android`) running the Loom Node app can also be *driven*
— screenshot, read the on-screen UI, tap, swipe, type, Back/Home/Recents — once
the user has turned on **屏幕控制** (the app's accessibility service). No adb, no
root, no curl needed on the device.

The daemon drops a callable copy of itself at `$HOME/loom-node`; use its
`control` subcommand, which fills in the local token for you:

```sh
loom-node exec <device> -- '"$HOME/loom-node" control <call> [k=v ...]'
```

If a call says "turn on 屏幕控制" / can't reach the service, it is not enabled:
ask the user to open the Loom Node app and tap **开启屏幕控制**.

Calls (all print small JSON unless noted):

- `control ping` — `{"ok":"true"}` when live.
- `control dump` — the interactive UI as `{"nodes":[{cls,text,desc,id,bounds:[l,t,r,b],cx,cy,clickable,editable,scrollable},…]}`. `cx,cy` is the tap point. Read this first and tap by its coordinates rather than guessing.
- `control tap x=<cx> y=<cy>`
- `control swipe x1= y1= x2= y2= ms=300` — scroll by swiping (up = y1 high → y2 low).
- `control text s="你好"` — set the focused field's text (Chinese works). Tap the field first. Replaces, does not append.
- `control key name=back|home|recents|notifications`
- `control launch pkg=<package>` — open an app by package name.

Screenshot is a file (binary), not inline: the call writes a PNG on the device
and prints its path; pull it back and view it:

```sh
loom-node exec <device> -- '"$HOME/loom-node" control screenshot'
# → {"path":"/data/.../cache/screen.png","w":...,"h":...}
loom-node read <device> /data/.../cache/screen.png > output/screen.png
```

Loop: screenshot or `dump` → decide → `tap`/`text`/`swipe` → screenshot again
to confirm. A window marked FLAG_SECURE (banking apps, DRM video) screenshots
black — expected. Per the user's standing rule, bank screens are read-only and
every payment step is confirmed with the user first.

### Updating a device's app (Android, no user tap)

Once 屏幕控制 is on, you can push a new build with no tap from the user — the
accessibility service taps the installer's confirm button itself:

```sh
loom-node write <device> update.apk < priv/node/loom-node.apk
loom-node exec  <device> -- '"$HOME/loom-node" control update'
```

First time only, the device must have "install unknown apps" allowed for Loom
Node: if `control update` returns `{"need":"allow-unknown-sources"}`, it has
opened that settings screen — ask the user to turn it on once, then retry.

## 5. MQTT broker (optional, per device)
A daemon can also run a minimal MQTT 3.1.1 broker for LAN devices (robots, sensors). It is off unless asked for, so a plain node opens no port. Turn it on with `loom-node daemon --mqtt HOST:PORT`, or with `"mqtt": {"listen": "HOST:PORT", "users": {"name": "password"}}` in config.json; changes need a daemon restart. Users are required: there is no anonymous login.
- Each broker stands alone: no bridging between nodes.
- QoS 0 only: QoS 1/2 publishes are acknowledged, then delivered at QoS 0. No retained messages, wills or persistent sessions.
- From the device, `loom-node mqtt pub TOPIC MSG` and `loom-node mqtt sub FILTER...` use its own broker as the first user in config.json; `--addr` and `--user` override this. From here: `loom-node exec <device> -- 'loom-node mqtt pub home/x hi'`.
- Never print config.json: it holds the node token and the MQTT passwords.

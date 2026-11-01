---
name: loom-sessions
description: Find and actually read the earlier Loom session the user means, before answering — when they say "之前那个 X 的 session / 另一个 session / 今晚聊的那个 / 我之前 … 的会话 / 接着那个做", "look at my other session", or ask where an earlier session put a file or a download. Also when a new chat opens on a topic an earlier session already worked on.
---

# loom-sessions: 找到并读完用户说的那个旧会话

The user often opens a new chat to carry on an earlier one: it ended in an
error, a safety classifier stopped it, the model fell back, or it grew long.
They name it loosely ("我之前路由器那个 session"). Your job is to find it
yourself and read it before you answer — never answer from a guess, never
make them dig out an id or paste a path the earlier session already had.

## 1. Find it

```
loom-session search WORDS... [--archived]
```

Searches the user's own sessions (Recents and projects; not employees'), by
title and by what was said, newest first, with a snippet. Try the words they
used, then a synonym or two (路由器 / OpenWrt / router). `--archived` only when
they say it was archived or nothing else matches. `loom-session list --all`
shows every title if words fail.

- **One clear match**: read it.
- **Several**: ask which, as reply buttons (`loom:replies`), at most 5, each
  the title and how long ago ("微信 · wxread 源码 · 1天前"). Do not read all of
  them first.
- **None**: say what you searched for, and ask.

## 2. Read it

```
loom-session read ID [--files] [--full]
```

- Plain `read` gives the conversation: the user's messages and each turn's
  last reply. Enough for "how far did it get, what was concluded".
- Add `--files` when you need what it made or where it put things: files it
  wrote, paths it read, wrote or downloaded on the user's devices, commits,
  share links. Those were tool calls, which plain `read` leaves out. Always
  add it when carrying the session on.
- Add `--full` when each turn's last reply is not enough.

It may be long; read it all, the end most carefully — the last turns are where
it got to.

## 3. Say so, then answer

Your first reply begins with one line: 我读了「标题」，它做到了…… — the state
and the conclusion, in your own words. Then answer what they asked. If what
you find there contradicts what you thought, say so plainly.

Do not quote passwords, keys or tokens from it, nor repeat at length whatever
a session was stopped for; summarise.

## A new chat on an old topic

When a new chat opens on something an earlier session already worked on (a
search on its topic finds a session clearly about it, recent), ask in a line
before starting over: 这件事在「X」里做过（N天前），要接着那个吗？ — with reply
buttons. Once is enough; if they say no, go on here.

## "Continue in a new chat"

A session opened from another's "Continue in a new chat" begins with a Loom
note naming the old one. Follow it: read the old one (`--files`) unless its
conversation was copied in, write the handoff summary it asks for, and wait.

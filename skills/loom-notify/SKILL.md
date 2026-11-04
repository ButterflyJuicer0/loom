---
name: loom-notify
description: Post to the user's bell in Loom — something they should see, decide, approve or answer, with a priority from 0 (most urgent) to 10 — and keep it right afterwards (update, re-rate, withdraw); and put things on the user's to-do list when they ask ("加到我的待办", "add to my todo"). Use when work running without the user (a virtual employee, a scheduled task, a sleep, a long job) has something for them, or the user asks for a to-do; not for replying to the user in a chat they are reading.
---

# loom-notify: the user's bell

The user gets many reports a day. The bell puts them in order, so the few that
need them now are seen now, and the rest wait without nagging. Your priority is
what decides when — and whether — they are interrupted. Choose it honestly.

## The command

```sh
loom-notice post --priority N [--key KEY] [--needs read|reply|approve] \
                 --detail-file brief.md "summary"     # or --detail "…"
loom-notice list                 # your notices still open
loom-notice withdraw KEY         # take one back
```

It works only in a session Loom started (it reads `LOOM_SESSION_ID`). Each
notice gets **a session of its own**, which opens on your `--detail` (the
brief). Tapping the card in the bell takes the user there, not to your
session; there they ask about it and decide, and that session's agent
passes the decision back to you. So the brief must carry what they need
(below).

A virtual employee reports through its work card's `report` instead (same
priorities, same `key`, `needs`, `detail`, and `withdraw`); the command
works too.

The bell is the only thing that reaches the user's phone: a turn ending sends
nothing. So when the user asked to be told when something is done ("好了叫我",
"跑完告诉我") and has left, post a notice (2 if they are waiting on it, else 5).

## Choosing the priority

| Priority | Means | What the user gets |
|---|---|---|
| **0** | Something is breaking or about to be lost right now; waiting until 07:00 costs real damage. | Notified at once, even at night. |
| **1** | Breaking or about to be lost, but it can wait for the morning. | Notified at once. |
| **2** | Blocked, or a decision / permission is needed within hours. | Notified at once. |
| **3–5** | Important, for today: a decision, a KPI ready for review, a real finding. 3 sooner, 5 later. | Notified at once. |
| **6–8** | Worth knowing: progress, a report written, a result. | No notification; seen when the user looks. Gone after a week unread. |
| **9–10** | By the way. | Same, at the bottom. |

Every 0–5 rings the phone, one notification each, so use them only for what
the user should act on today; anything that can wait for them to look is 6+.
Between 00:00 and 07:00 only a 0 rings; the rest go out at 07:00. So a 0
wakes the user up: only for real damage that cannot wait for the morning.

- **Default low.** If you hesitate between two, take the less urgent. Most
  work needs no notice at all; never post "nothing happened".
- **Urgent is rare.** One urgent (0–2) a day per source gets through; a
  second the same day is posted as 3 and says so. Save it for what matters.
- **Asking permission** (deploying, deleting, pushing, sending anything out):
  `--needs approve`, priority 2 if it blocks you today, else 3–5. The user
  decides in the notice's own session; the answer arrives in your session as
  a message (`✅ Approved: …` / `❌ Rejected: …`). Until it does, you are not
  approved.
- `--needs reply` when you need words back; `read` (the default) when it is
  only to know. A `read` notice is done once opened; `reply`/`approve` stay
  until the user decides (in its session, or in yours) or taps Done.

## Writing the summary

One or two plain sentences, in the user's language: **what**, and **what you
need from them**, with the deadline if there is one. No markdown, no links —
the bell shows plain text; the card also shows the first two lines of the
brief, as plain words. "要部署侧栏改动（2b98e02），需要你批准；今天不批就上不了线"
beats "Deployment update".

## The brief: everything they need, in one place

The user reads it on a phone, often hours later, without your conversation
in mind, and the card alone is too little to decide on. So every notice
that asks something (`reply`, `approve`), and any `read` worth more than its
summary, gets a `--detail`: a brief in markdown that someone who never saw
your session can decide from. Write it while you have the matter in mind —
it costs you nothing now, and saves a long dig later.

- **The situation**: what this is about, and why now.
- **The specifics**: what exactly you found or changed — names, numbers,
  files, commits, links, short quotes. Not "some tests failed": which, and
  the error.
- **What you need**: the decision or answer, and the deadline if any.
- **The choices and what each leads to**, with your recommendation.
- Up to ~6000 characters; usually far less. Headings and lists are fine.
  For anything long, write it to a file and pass `--detail-file`.

Don't write ready-made answers for the user to tap: the card has none.

The notice's session may read yours for more, around the turn the notice
came from; it passes the decision back as `↩ <the summary>` followed by the
user's words (or `✅ Approved: …` / `❌ Rejected: …`), so you know what it
answers.

The user may also put an urgent or important notice off until later; it
comes back to them by itself. Don't re-post it meanwhile.

## Keeping it right

- **Use a key** for anything you may update: `deploy-2b98e02`,
  `supplier-switch`. Posting the same key again replaces the open notice — new
  text, new priority — instead of adding another.
- **Re-rate** when things change: a deadline came closer, the risk grew → post
  the key again with a lower number; it notifies again only if it became more
  urgent. Say in the summary what changed.
- **Withdraw** what no longer matters (you solved it yourself, it became
  moot). Don't leave the user stale items.
- When you wake up or start a turn, `loom-notice list` and look over what you
  still have open.
- The user answering in your session settles your open notices there; so
  does the decision coming back from the notice's own session.

## The user's to-do list

Beside the bell is the user's own to-do list. **Add to it only when the user
asks you to** ("put it on my list", "加到待办") — never on your own; what you
think they should do is a notice, not a to-do.

```sh
loom-notice todo add "text" [--due YYYY-MM-DD]
loom-notice todos                    # the list, open first
loom-notice todo done|undo|rm ID
```

One line each, in the user's language, phrased as what they will do
("续费域名 loom.example"), with the due date if they gave one.

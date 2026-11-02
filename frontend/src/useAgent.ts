import { useCallback, useEffect, useRef, useState } from "react"
import type { Channel } from "phoenix"
import { getSocket } from "./socket"
import { attachmentUrl, seedBlobUrl, uploadAgentFiles, whenCreated, whenMade } from "./api"
import type { LocalFile } from "./useAttachments"
import {
  addPending,
  dropPending,
  markPending,
  updatePending,
  applyDelta,
  applyEvent,
  applySnapshot,
  emptyTranscript,
  newClientMsgId,
  type PendingMessage,
  type AgentDelta,
  type AgentEvent,
  type Snapshot,
  type Transcript,
} from "./agent"

// Shown as the `origin` on messages so a transcript read on one device says
// where each message was typed.
const DEVICE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  ? "phone"
  : "desktop"

// The last few sessions' transcripts, kept when their chat unmounts so going
// back to one shows it at once and the join asks only for what came since.
// Memory only, and bounded: a long transcript is a few megabytes of objects.
const CACHED_SESSIONS = 8
const cache = new Map<string, Transcript>()

function remember(id: string, t: Transcript) {
  cache.delete(id)
  // Streaming placeholders do not survive a remount: the join drops them
  // anyway. Nor does a message's being on its way: its ack may never come to
  // this mount, so it comes back as not got through, to be sent again.
  cache.set(id, { ...t, streaming: [], toolStreams: [], lastDeltaSeq: 0, pending: unsentOf(t.pending) })
  for (const old of cache.keys()) {
    if (cache.size <= CACHED_SESSIONS) break
    cache.delete(old)
  }
}

// How long a message may go unanswered before it is shown as not got through.
// Longer than phoenix.js's 10 s: on a weak connection a slow ack is common,
// and a message marked failed that then arrives only looks broken.
const SUBMIT_TIMEOUT_MS = 20_000

// What did not get through, per session, on this device: a reload, or an app
// the phone killed in the background, must not lose what the user typed.
const UNSENT_KEY = (id: string) => `loom_unsent_${id}`

const unsentOf = (pending: PendingMessage[]): PendingMessage[] =>
  pending.map((p) => (p.failed ? p : { ...p, failed: "the connection dropped before it was confirmed" }))

function loadUnsent(id: string): PendingMessage[] {
  try {
    const list = JSON.parse(localStorage.getItem(UNSENT_KEY(id)) ?? "[]")
    // Files not uploaded yet kept their names only: the bytes and the preview
    // were this page's.
    return Array.isArray(list)
      ? list.map((p: PendingMessage) =>
          p.uploads?.length ? { ...p, uploads: p.uploads.map((u) => ({ ...u, preview: null, blob: undefined })) } : p,
        )
      : []
  } catch {
    return []
  }
}

function saveUnsent(id: string, pending: PendingMessage[]) {
  const unsent = pending.filter((p) => p.failed)
  try {
    if (unsent.length) localStorage.setItem(UNSENT_KEY(id), JSON.stringify(unsent))
    else localStorage.removeItem(UNSENT_KEY(id))
  } catch {
    // Storage full or off: the bubble still shows for as long as the page does.
  }
}

// What the device kept, laid over what the cache kept, without doubles.
function withUnsent(t: Transcript, id: string): Transcript {
  const kept = loadUnsent(id).filter((u) => !t.pending.some((p) => p.clientMsgId === u.clientMsgId))
  return kept.length ? { ...t, pending: [...t.pending, ...kept] } : t
}

type Agent = {
  transcript: Transcript
  joinError: string | null
  submit: (text: string, uploads?: LocalFile[]) => void
  // A message that did not get through: send it again, or let it go.
  resend: (clientMsgId: string) => void
  discard: (clientMsgId: string) => void
  interrupt: () => void
  dropQueued: (index: number) => void
  rename: (title: string) => void
  // The composer's draft as last written from any device, while this one has
  // the session open; a fresh object each time. See `useDraft`.
  draft: { id: string; text: string } | null
}

/**
 * Own one `agent:<id>` channel.
 *
 * Rejoin is the interesting part. Params are passed as a *function* so
 * phoenix.js re-evaluates them on every rejoin, which means a reconnect asks
 * for `since_seq` = the last seq we actually saw and gets only the gap. The
 * reply is then merged rather than replacing state, because on a rejoin it is
 * a gap and not the whole transcript.
 */
export function useAgent(
  sessionId: string | null,
  // Called for each event as it happens — never for history replayed on join,
  // so a reaction to it (opening the canvas) fires once, on the device that
  // was watching, and not again on every reload.
  onLiveEvent?: (event: AgentEvent) => void,
): Agent {
  const onLiveRef = useRef(onLiveEvent)
  onLiveRef.current = onLiveEvent
  // Straight from the cache on the first render, so there is no empty frame.
  const [transcript, setTranscript] = useState<Transcript>(() =>
    sessionId ? withUnsent(cache.get(sessionId) ?? emptyTranscript, sessionId) : emptyTranscript,
  )
  const [joinError, setJoinError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null)
  const channelRef = useRef<Channel | null>(null)
  // Which session the channel is for now: an upload that finishes after the
  // user moved on must not send its message into the next one.
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  // Read inside the params closure on rejoin, so it must not be state.
  const lastSeqRef = useRef(0)
  // For the cache, written on unmount.
  const transcriptRef = useRef(transcript)
  transcriptRef.current = transcript
  // Bumped to join again from nothing when the cache turns out to be wrong.
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    const cached = sessionId ? cache.get(sessionId) : undefined
    setTranscript(sessionId ? withUnsent(cached ?? emptyTranscript, sessionId) : emptyTranscript)
    setJoinError(null)
    setDraft(null)
    lastSeqRef.current = cached?.lastSeq ?? 0
    if (!sessionId) return

    let joined = false
    // Set if the effect is torn down before the join resolves; see the cleanup.
    let leaveWhenJoined = false

    // A chat only just made here may not be on the server yet: the channel
    // waits for it, trying again while this is open. See `whenCreated`.
    let channel: Channel | null = null
    let torn = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const wait = () =>
      whenCreated(sessionId).then(
        () => {
          if (!torn) channel = open()
        },
        () => {
          if (torn) return
          setJoinError("Can't reach the server to start this chat — trying again…")
          retry = setTimeout(wait, 3000)
        },
      )
    const open = (): Channel => {
      const channel = getSocket().channel(`agent:${sessionId}`, () => ({
        since_seq: lastSeqRef.current,
        device: DEVICE,
      }))
      channelRef.current = channel

      // Two joins overlap whenever an effect is torn down before its join
      // resolves — StrictMode does this on every mount — and phoenix.js dispatches
      // an incoming message to *every* channel object matching the topic. So a
      // handler belonging to a channel we have already replaced must do nothing;
      // `delta_seq` would catch the duplicate anyway, but not touching state at
      // all is cheaper and keeps the reducer honest.
      const current = () => channelRef.current === channel

      channel.on("event", (event: AgentEvent) => {
        if (!current()) return
        const fresh = event.seq > lastSeqRef.current
        lastSeqRef.current = Math.max(lastSeqRef.current, event.seq)
        setTranscript((t) => applyEvent(t, event))
        if (fresh) onLiveRef.current?.(event)
      })

      channel.on("delta", (delta: AgentDelta) => {
        if (!current()) return
        setTranscript((t) => applyDelta(t, delta))
      })

      channel.on("draft", ({ text }: { text: string }) => {
        if (current()) setDraft({ id: sessionId, text })
      })

      channel
        .join()
        .receive("ok", (snapshot: Snapshot) => {
          const wasJoined = joined
          joined = true
          if (leaveWhenJoined || channelRef.current !== channel) {
            channel.leave()
            return
          }
          // Behind what we hold: not a gap but a different history (the session
          // was replaced under the same id). The cache is no use; start over.
          if (snapshot.last_seq < lastSeqRef.current) {
            cache.delete(sessionId)
            channelRef.current = null
            channel.leave()
            setEpoch((e) => e + 1)
            return
          }
          // A gap like a rejoin's, from the cache too — unless the server has
          // since dropped events we never saw. Then the reply is everything it
          // still keeps, and merging would hide the hole.
          const hole =
            snapshot.truncated_before !== null && lastSeqRef.current < snapshot.truncated_before
          const merge = (wasJoined || !!cached) && !hole
          lastSeqRef.current = snapshot.last_seq
          // Not merging still keeps what is waiting to be sent: those bubbles are
          // ours, not the server's, and its events clear the ones that arrived.
          setTranscript((t) => applySnapshot(snapshot, merge ? t : { ...emptyTranscript, pending: t.pending }))
          setJoinError(null)
        })
        .receive("error", (resp: { reason?: string }) =>
          setJoinError(resp?.reason ?? "join failed"),
        )
        .receive("timeout", () => setJoinError("join timed out"))
      return channel
    }
    void wait()

    return () => {
      torn = true
      clearTimeout(retry)
      if (!channel) return
      // phoenix.js silently *skips* the leave push when the channel has not
      // finished joining — it fakes a local "ok" and closes its own copy — so
      // the server keeps the channel, keeps it subscribed, and keeps pushing to
      // this socket. React StrictMode mounts, unmounts and remounts every
      // effect, so in dev that happened on every single session open: two
      // server channels, every delta delivered twice.
      if (joined) {
        channel.leave()
      } else {
        leaveWhenJoined = true
      }

      channelRef.current = null
      // Only a transcript the server has filled; an unjoined mount holds
      // nothing worth keeping, and must not replace what the cache has.
      if (joined && transcriptRef.current.lastSeq > 0) remember(sessionId, transcriptRef.current)
      // The socket is shared with the terminal; never disconnect it here.
    }
  }, [sessionId, epoch])

  // Kept on the device as they change: one marked failed, one sent again,
  // one whose `:user` event finally came back and took it off the list.
  useEffect(() => {
    if (sessionId) saveUnsent(sessionId, transcript.pending)
  }, [sessionId, transcript.pending])

  // The message itself, its files already on the server.
  const push = useCallback((p: PendingMessage, waited = 0): void => {
    const channel = channelRef.current
    const fail = (reason: string) => setTranscript((t) => markPending(t, p.clientMsgId, reason))
    // A new chat's channel opens once the server has it; see `whenCreated`.
    if (!channel) {
      if (waited >= SUBMIT_TIMEOUT_MS) return fail("not connected")
      setTimeout(() => push(p, waited + 250), 250)
      return
    }

    channel
      .push(
        "submit",
        {
          text: p.text,
          client_msg_id: p.clientMsgId,
          // Already uploaded; only the path travels. The server checks it is
          // one of this session's own attachments before the model is told.
          files: p.files.map((f) => ({ path: f.path, name: f.name })),
        },
        SUBMIT_TIMEOUT_MS,
      )
      .receive("ok", (reply: { status?: string }) => {
        // It had already arrived; the `:user` event we have is the bubble.
        if (reply?.status === "duplicate") setTranscript((t) => dropPending(t, p.clientMsgId))
      })
      .receive("error", (resp: { reason?: string }) => fail(resp?.reason ?? "the server refused it"))
      // phoenix.js still sends a push that timed out once the channel is back,
      // so a message marked here can arrive after all; its event clears it.
      .receive("timeout", () => fail("no answer — the connection may be weak"))
  }, [])

  // One go at a pending message. Its bubble is already on screen; this only
  // decides whether it ends up marked. Files still on this device go up first,
  // all in one request the server stores all-or-nothing, and the message only
  // after: it arrives with all of them or is marked with all of them, and a
  // resend picks up where it stopped (what is stored stays in `files`). Sent
  // again under the same id, so the server can tell a resend of something
  // that did arrive (`:duplicate`).
  const send = useCallback((p: PendingMessage) => {
    const fail = (reason: string) => setTranscript((t) => markPending(t, p.clientMsgId, reason))
    const uploads = p.uploads ?? []
    if (!sessionId) return fail("not connected")
    if (uploads.length === 0) {
      whenMade(sessionId).then(() => push(p), () => fail("couldn't start this chat — the connection may be weak"))
      return
    }
    if (uploads.some((u) => !u.blob)) return fail("its files were lost when the page reloaded — attach them again")

    const blobs = uploads.map((u) => (u.blob instanceof File ? u.blob : new File([u.blob!], u.name, { type: u.type })))
    whenMade(sessionId).then(() => uploadAgentFiles(sessionId, blobs)).then(
      (stored) => {
        // Moved to another session meanwhile: this one's copy, kept on the
        // device, shows it as not got through; a resend uploads again.
        if (sessionRef.current !== sessionId) return
        // The bubble will ask for each by its server URL; it can have the
        // local copy instead.
        stored.forEach((f, i) => {
          const preview = uploads[i]?.preview
          if (preview) seedBlobUrl(attachmentUrl(sessionId, f.path), preview)
        })
        const next = { ...p, files: [...p.files, ...stored], uploads: [] }
        setTranscript((t) => updatePending(t, next))
        push(next)
      },
      (e: unknown) => fail(e instanceof Error ? e.message : "upload failed"),
    )
  }, [sessionId, push])


  const submit = useCallback(
    (text: string, uploads: LocalFile[] = []) => {
      // Optimistic: the bubble appears now and is replaced by the
      // authoritative `:user` event, matched on `client_msg_id`. Without that
      // id the sender would see its own message twice.
      const p: PendingMessage = { clientMsgId: newClientMsgId(), text, files: [], uploads }
      setTranscript((t) => addPending(t, p))
      send(p)
    },
    [send],
  )

  const resend = useCallback(
    (clientMsgId: string) => {
      const p = transcriptRef.current.pending.find((m) => m.clientMsgId === clientMsgId)
      if (!p) return
      setTranscript((t) => markPending(t, clientMsgId, null))
      send({ ...p, failed: undefined })
    },
    [send],
  )

  const discard = useCallback((clientMsgId: string) => {
    setTranscript((t) => dropPending(t, clientMsgId))
  }, [])

  // Stopping parks the queue rather than draining it, so nothing is optimistic
  // here: the server sends the resting state and the parked list.
  const interrupt = useCallback(() => {
    channelRef.current?.push("interrupt", {})
  }, [])

  const dropQueued = useCallback((index: number) => {
    channelRef.current?.push("drop_queued", { index })
  }, [])

  const rename = useCallback((title: string) => {
    channelRef.current?.push("rename", { title })
  }, [])

  return { transcript, joinError, submit, resend, discard, interrupt, dropQueued, rename, draft }
}

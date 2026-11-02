// Meeting mode, on the page: capture the meeting, transcribe it in the browser,
// and post finished sentences to the session (see lib/loom/meeting.ex).
//
// - Audio: the microphone is "me"; the shared screen's system audio is "them".
//   No system audio (a phone, a meeting in the room): the microphone alone,
//   with its voices told apart instead.
// - Recognition: public/meeting/asr-worker.js. Who is speaking:
//   public/meeting/diar-worker.js, on 15 s chunks of the "them" track; a
//   sentence from that track waits for the chunk covering it, then goes out
//   labelled 对方1, 对方2…
// - Models: nothing loads until the user says so. They come from the server
//   (which fetches them from GitHub on the first request) into Cache Storage,
//   with progress shown for both legs.
//
// One meeting at a time, page-wide, so it keeps going while the user looks at
// another chat. State is a small store for useSyncExternalStore.

import { getToken } from "./api"

const CACHE = "loom-meeting-models-v1.13.7"
const CACHED_FLAG = "loom_meeting_models_cached"
const RATE = 16000
const DIAR_CHUNK = 15 * RATE
const HOLD_MAX_MS = 45_000

export type MeetingPhase =
  | "idle"
  | "checking" // asking the server about the models
  | "offer" // the dialog offers the download
  | "server" // the server is fetching them from GitHub
  | "browser" // this browser is fetching them from the server
  | "ready" // downloaded; the dialog's Start button captures (needs a tap)
  | "loading" // starting the recognisers
  | "running"
  | "error"

export type MeetingState = {
  phase: MeetingPhase
  sessionId: string | null
  got: number
  total: number
  error: string | null
  partial: { me: string; them: string }
  lines: number
  startedAt: number | null
  systemAudio: boolean
  speakers: boolean // whether voices are being told apart
  unpacking: boolean
}

let state: MeetingState = {
  phase: "idle",
  sessionId: null,
  got: 0,
  total: 0,
  error: null,
  partial: { me: "", them: "" },
  lines: 0,
  startedAt: null,
  systemAudio: false,
  speakers: false,
  unpacking: false,
}
const listeners = new Set<() => void>()

function set(patch: Partial<MeetingState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function subscribeMeeting(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const meetingState = () => state

// --- server calls -----------------------------------------------------------

function auth(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

type ModelStatus =
  | { state: "ready"; files: Record<string, Record<string, number>> }
  | { state: "downloading"; got: number; total: number; unpacking?: boolean }
  | { state: "missing"; error: string | null; size: number }

async function modelStatus(): Promise<ModelStatus> {
  const res = await fetch("/api/meeting/models", { headers: auth() })
  if (!res.ok) throw new Error(`models: ${res.status}`)
  return res.json()
}

async function post(sessionId: string, body: object) {
  const res = await fetch(`/api/agents/${sessionId}/meeting`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth() },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`meeting: ${res.status}`)
  return res.json()
}

export async function serverMeeting(sessionId: string): Promise<{ lines: number } | null> {
  const res = await fetch(`/api/agents/${sessionId}/meeting`, { headers: auth() })
  if (!res.ok) return null
  return (await res.json()).meeting
}

const fileUrl = (bundle: string, name: string) => `/api/meeting/models/${bundle}/${name}`

// --- models -----------------------------------------------------------------

type Files = { js: string; api: string; wasm: string; data: string }

function filesOf(manifest: Record<string, Record<string, number>>, bundle: string): Files {
  const names = Object.keys(manifest[bundle] ?? {})
  const pick = (test: (n: string) => boolean) => {
    const n = names.find(test)
    if (!n) throw new Error(`model bundle ${bundle} is incomplete`)
    return fileUrl(bundle, n)
  }
  return {
    js: pick((n) => n.startsWith("sherpa-onnx-wasm-main") && n.endsWith(".js")),
    api: pick((n) => !n.startsWith("sherpa-onnx-wasm-main") && n.endsWith(".js")),
    wasm: pick((n) => n.endsWith(".wasm")),
    data: pick((n) => n.endsWith(".data")),
  }
}

let manifest: Record<string, Record<string, number>> | null = null

async function missingInBrowser(m: Record<string, Record<string, number>>) {
  const cache = await caches.open(CACHE)
  const out: { url: string; size: number }[] = []
  for (const [bundle, files] of Object.entries(m))
    for (const [name, size] of Object.entries(files)) {
      const url = fileUrl(bundle, name)
      if (!(await cache.match(url))) out.push({ url, size })
    }
  return out
}

async function downloadToBrowser(missing: { url: string; size: number }[]) {
  const cache = await caches.open(CACHE)
  const total = missing.reduce((n, f) => n + f.size, 0)
  let got = 0
  set({ phase: "browser", got, total })
  for (const f of missing) {
    const res = await fetch(f.url, { headers: auth() })
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      got += value.length
      set({ got })
    }
    await cache.put(f.url, new Response(new Blob(chunks as BlobPart[]), { headers: { "Content-Type": res.headers.get("Content-Type") ?? "" } }))
  }
  localStorage.setItem(CACHED_FLAG, "1")
}

// --- the meeting ------------------------------------------------------------

let asr: Worker | null = null
let diar: Worker | null = null
let ctx: AudioContext | null = null
let streams: MediaStream[] = []
let flushTimer: number | null = null
let outbox: { at: string; speaker: string; text: string }[] = []
// "them" sentences waiting for their speaker.
let held: { text: string; start: number; end: number; heldAt: number; at: string }[] = []
let diarBuf: Float32Array[] = []
let diarLen = 0
let diarOffset = 0
let diarTrack: "me" | "them" = "them"
let diarOk = false
const wallStart: Record<string, number> = {}
// Samples seen per track: the clock both workers' times are on.
const counts: Record<string, number> = {}

/** The menu's "Meeting mode": a tap, so screen capture is allowed straight away when the models are here. */
export async function openMeeting(sessionId: string) {
  if (state.phase === "running" || state.phase === "loading") return
  set({ sessionId, error: null, phase: "checking" })
  // The agent gets the meeting prompt now, not at Start: it loads its skills
  // and looks the meeting up while the models come and the user picks a screen.
  void begin(sessionId)
  try {
    const status = await modelStatus()
    if (status.state === "ready") {
      manifest = status.files
      const missing = await missingInBrowser(status.files)
      if (missing.length === 0) {
        warm()
        return set({ phase: "ready" })
      }
      return set({ phase: "offer", total: missing.reduce((n, f) => n + f.size, 0) })
    }
    if (status.state === "downloading") return await watchServer()
    set({ phase: "offer", total: status.size, error: status.error })
  } catch (e) {
    set({ phase: "error", error: String((e as Error).message ?? e) })
  }
}

// Whether the server has this session's meeting open (the prompt was sent).
let begun: string | null = null

async function begin(sessionId: string) {
  if (begun === sessionId) return
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const title = `会议 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  try {
    await post(sessionId, { action: "start", title })
    begun = sessionId
  } catch {
    // Start tries again.
  }
}

// The recognisers, started as soon as the models are here so Start is quick.
let asrReady: Promise<Worker> | null = null
let diarReady: Promise<Worker> | null = null

function warm() {
  if (!manifest) return
  asrReady ??= startWorker("/meeting/asr-worker.js", filesOf(manifest, "asr"))
  diarReady ??= startWorker("/meeting/diar-worker.js", filesOf(manifest, "diar"))
  // Failures surface at Start (asr) or as no speaker labels (diar).
  asrReady.catch(() => {})
  diarReady.catch(() => {})
}

function coolDown() {
  for (const p of [asrReady, diarReady]) p?.then((w) => w.terminate(), () => {})
  asrReady = diarReady = null
}

/** The dialog's Download. */
export async function downloadModels() {
  try {
    const res = await fetch("/api/meeting/models", { method: "POST", headers: auth() })
    if (!res.ok) throw new Error(`models: ${res.status}`)
    const status: ModelStatus = await res.json()
    if (status.state === "ready") {
      manifest = status.files
      await downloadToBrowser(await missingInBrowser(status.files))
      warm()
      return set({ phase: "ready" })
    }
    await watchServer()
  } catch (e) {
    set({ phase: "error", error: String((e as Error).message ?? e) })
  }
}

async function watchServer() {
  for (;;) {
    const status = await modelStatus()
    if (status.state === "ready") {
      manifest = status.files
      await downloadToBrowser(await missingInBrowser(status.files))
      warm()
      return set({ phase: "ready" })
    }
    if (status.state === "missing") throw new Error(status.error ?? "download failed on the server")
    set({ phase: "server", got: status.got, total: status.total, unpacking: !!status.unpacking })
    await new Promise((r) => setTimeout(r, 1000))
  }
}

/** Cancel, or a tap outside: backing out before the meeting started. */
export function closeMeetingDialog() {
  if (state.phase === "running" || state.phase === "loading") return
  // Hiding a download keeps it going (and the meeting open); anything else
  // backs out of the meeting the menu opened.
  if (state.phase !== "server" && state.phase !== "browser") {
    coolDown()
    if (begun) void post(begun, { action: "cancel" }).catch(() => {})
    begun = null
  }
  set({ phase: "idle", error: null })
}

function startWorker(script: string, files: Files): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const w = new Worker(script)
    w.onmessage = (e) => {
      if (e.data.type === "ready") resolve(w)
      else if (e.data.type === "error") reject(new Error(e.data.message))
    }
    w.onerror = (e) => reject(new Error(e.message || "worker failed"))
    w.postMessage({ type: "init", cache: CACHE, files })
  })
}

function clock(track: string, seconds: number) {
  const d = new Date((wallStart[track] ?? Date.now()) + seconds * 1000)
  return d.toTimeString().slice(0, 8)
}

/** The dialog's Start, or Resume after a reload: a tap, which screen capture needs. */
export async function startMeeting(sessionId: string, resume = false) {
  set({ sessionId, phase: "loading", error: null })
  try {
    // Capture first, while the tap still counts.
    let display: MediaStream | null = null
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        // Chrome: offer "share system audio" and keep Loom's own tab out of the list.
        ...({ systemAudio: "include", selfBrowserSurface: "exclude" } as object),
      })
    } catch {
      display = null // a phone, or the user said no: the microphone alone
    }
    const systemAudio = !!display && display.getAudioTracks().length > 0
    if (display && !systemAudio) display.getTracks().forEach((t) => t.stop())
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    streams = [mic, ...(systemAudio && display ? [display] : [])]

    if (!manifest) {
      const status = await modelStatus()
      if (status.state !== "ready") throw new Error("the speech models are not downloaded")
      manifest = status.files
    }
    warm()
    const asrP = asrReady!
    const diarP = diarReady!
    asrReady = diarReady = null // theirs now: teardown terminates them
    try {
      asr = await asrP
    } catch (e) {
      diarP.then((w) => w.terminate(), () => {})
      throw e
    }
    diarTrack = systemAudio ? "them" : "me"
    diarOk = false
    diarP.then(
      (w) => {
        diar = w
        diarOk = true
        diar.onmessage = onDiar
        set({ speakers: true })
      },
      (e) => console.warn("meeting: no speaker labels:", e),
    )

    asr.onmessage = onAsr
    ctx = new AudioContext({ sampleRate: RATE })
    tap(mic, "me")
    if (systemAudio && display) {
      tap(display, "them")
      // Ending the share from the browser's own bar ends the meeting.
      display.getVideoTracks()[0]?.addEventListener("ended", () => void stopMeeting())
    }

    if (!resume) await begin(sessionId)
    if (!resume && begun !== sessionId) throw new Error("could not start the meeting on the server")
    flushTimer = window.setInterval(flush, 2000)
    set({ phase: "running", startedAt: Date.now(), lines: 0, systemAudio, partial: { me: "", them: "" } })
  } catch (e) {
    teardown()
    set({ phase: "error", error: String((e as Error).message ?? e) })
  }
}

function tap(stream: MediaStream, track: "me" | "them") {
  if (!ctx) return
  const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  wallStart[track] = Date.now()
  counts[track] = 0
  proc.onaudioprocess = (e) => {
    const samples = new Float32Array(e.inputBuffer.getChannelData(0))
    if (track === diarTrack && diarOk) {
      // A chunk starts where the track is now: diarization may start late.
      if (diarLen === 0) diarOffset = counts[track] / RATE
      diarBuf.push(samples.slice())
      diarLen += samples.length
      if (diarLen >= DIAR_CHUNK) {
        const chunk = new Float32Array(diarLen)
        let at = 0
        for (const b of diarBuf) {
          chunk.set(b, at)
          at += b.length
        }
        diar?.postMessage({ type: "chunk", samples: chunk, offset: diarOffset }, [chunk.buffer])
        diarBuf = []
        diarLen = 0
      }
    }
    counts[track] += samples.length
    asr?.postMessage({ type: "audio", track, samples }, [samples.buffer])
  }
  source.connect(proc)
  proc.connect(ctx.destination) // silent: the output buffer is never written
}

function onAsr(e: MessageEvent) {
  const m = e.data
  if (m.type === "partial") {
    set({ partial: { ...state.partial, [m.track]: m.text } })
  } else if (m.type === "final") {
    const at = clock(m.track, m.start)
    if (m.track === diarTrack && diarOk) {
      held.push({ text: m.text, start: m.start, end: m.end, heldAt: Date.now(), at })
    } else {
      outbox.push({ at, speaker: m.track === "me" ? (diarTrack === "me" ? "说话人" : "我") : "对方", text: m.text })
    }
  } else if (m.type === "error") {
    console.warn("meeting asr:", m.message)
  }
}

function label(speaker: number | undefined) {
  const base = diarTrack === "me" ? "说话人" : "对方"
  return speaker === undefined || speaker < 0 ? base : `${base}${speaker + 1}`
}

function onDiar(e: MessageEvent) {
  const m = e.data
  if (m.type === "error") return console.warn("meeting diar:", m.message)
  if (m.type !== "segments") return
  const until = m.offset + m.duration
  const segs: { start: number; end: number; speaker: number }[] = m.segments
  held = held.filter((h) => {
    if (h.end > until + 0.5) return true
    const by = new Map<number, number>()
    for (const s of segs) {
      const len = Math.max(0, Math.min(h.end, s.end) - Math.max(h.start, s.start))
      if (len > 0) by.set(s.speaker, (by.get(s.speaker) ?? 0) + len)
    }
    let best: number | undefined
    let bestLen = 0
    for (const [sp, len] of by) {
      if (len > bestLen) {
        best = sp
        bestLen = len
      }
    }
    outbox.push({ at: h.at, speaker: label(best), text: h.text })
    return false
  })
}

async function flush() {
  // Sentences whose chunk never came (diarization slow or gone) go unlabelled.
  const now = Date.now()
  held = held.filter((h) => {
    if (now - h.heldAt < HOLD_MAX_MS) return true
    outbox.push({ at: h.at, speaker: label(undefined), text: h.text })
    return false
  })
  if (!state.sessionId || outbox.length === 0) return
  const lines = outbox.sort((a, b) => a.at.localeCompare(b.at))
  outbox = []
  try {
    const r = await post(state.sessionId, { action: "lines", lines })
    set({ lines: r.meeting?.lines ?? state.lines + lines.length })
  } catch {
    outbox = lines.concat(outbox) // try again next time
  }
}

export async function askNow() {
  if (!state.sessionId) return
  await flush()
  await post(state.sessionId, { action: "ask" }).catch(() => {})
}

function teardown() {
  if (flushTimer) clearInterval(flushTimer)
  flushTimer = null
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
  streams = []
  void ctx?.close()
  ctx = null
  asr?.terminate()
  diar?.terminate()
  asr = diar = null
  diarBuf = []
  diarLen = 0
  diarOffset = 0
  diarOk = false
}

export async function stopMeeting(sessionId = state.sessionId) {
  if (!sessionId) return
  // What is still waiting for a speaker goes out unlabelled rather than lost.
  for (const h of held) outbox.push({ at: h.at, speaker: label(undefined), text: h.text })
  held = []
  await flush()
  teardown()
  set({ phase: "idle", startedAt: null, partial: { me: "", them: "" }, speakers: false })
  begun = null
  await post(sessionId, { action: "stop" }).catch(() => {})
}

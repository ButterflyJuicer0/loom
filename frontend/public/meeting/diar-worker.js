// Meeting mode's "who is speaking", off the page's thread: sherpa-onnx's
// offline speaker diarization (pyannote segmentation + speaker embeddings),
// compiled to WebAssembly (https://github.com/k2-fsa/sherpa-onnx, Apache-2.0).
//
// That build labels one recording at a time, and its labels mean nothing from
// one chunk to the next. So each chunk is diarized with a few seconds of every
// voice heard so far in front of it ("anchors"): the clustering puts a known
// voice's anchor and its new speech under the same label, which says who the
// new speech is. A label with no anchor is a new voice, and its longest stretch
// becomes that voice's anchor.
//
// In:  {type: "init", cache, files: {js, api, wasm, data}}
//      {type: "chunk", samples, offset}   16 kHz mono; offset in seconds
// Out: {type: "ready"} | {type: "error", message}
//      {type: "segments", offset, duration, segments: [{start, end, speaker}]}
//      speaker: 0, 1, 2… stable for the whole meeting

/* global createOfflineSpeakerDiarization */
let sd = null
const anchors = [] // {speaker, samples}
const RATE = 16000
const GAP = new Float32Array(RATE / 2)
const ANCHOR_MAX = 4 * RATE
const ANCHOR_MIN = 1.5 * RATE
const MAX_ANCHORS = 8
let nextId = 0

async function fromCache(cacheName, url) {
  const cache = await caches.open(cacheName)
  const res = await cache.match(url)
  if (!res) throw new Error("model file missing from cache: " + url)
  return res
}

async function load(cacheName, url) {
  const text = await (await fromCache(cacheName, url)).text()
  importScripts(URL.createObjectURL(new Blob([text], { type: "text/javascript" })))
}

async function init({ cache, files }) {
  const [wasm, data] = await Promise.all([
    fromCache(cache, files.wasm).then((r) => r.arrayBuffer()),
    fromCache(cache, files.data).then((r) => r.arrayBuffer()),
  ])
  await new Promise((resolve, reject) => {
    self.Module = {
      wasmBinary: wasm,
      getPreloadedPackage: () => data,
      locateFile: (p) => p,
      print: () => {},
      printErr: (m) => console.debug("[diar]", m),
      setStatus: () => {},
      onRuntimeInitialized: resolve,
      onAbort: (why) => reject(new Error("wasm aborted: " + why)),
    }
    load(cache, files.api)
      .then(() => load(cache, files.js))
      .catch(reject)
  })
  sd = createOfflineSpeakerDiarization(self.Module)
  const config = sd.config
  config.clustering = { numClusters: -1, threshold: 0.5 }
  sd.setConfig(config)
}

function concat(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function chunk(samples, offset) {
  // Layout: anchor, gap, anchor, gap, …, chunk.
  const parts = []
  const spans = [] // {speaker, start, end} in seconds of the joined audio
  let at = 0
  for (const a of anchors) {
    parts.push(a.samples, GAP)
    spans.push({ speaker: a.speaker, start: at / RATE, end: (at + a.samples.length) / RATE })
    at += a.samples.length + GAP.length
  }
  const base = at / RATE
  parts.push(samples)

  const segs = sd.process(concat(parts)) || []

  // label -> known speaker, by which anchor it covers most.
  const byLabel = new Map()
  for (const span of spans) {
    let best = -1
    let bestLen = 0
    for (const s of segs) {
      const len = overlap(s.start, s.end, span.start, span.end)
      if (len > bestLen) {
        bestLen = len
        best = s.speaker
      }
    }
    if (best >= 0 && !byLabel.has(best)) byLabel.set(best, span.speaker)
  }

  const out = []
  const fresh = new Map() // label -> {speaker, longest seg}
  for (const s of segs) {
    if (s.end <= base) continue
    const start = Math.max(s.start, base) - base
    const end = s.end - base
    let speaker = byLabel.get(s.speaker)
    if (speaker === undefined) {
      let f = fresh.get(s.speaker)
      if (!f) {
        f = { speaker: nextId++, start, end }
        fresh.set(s.speaker, f)
      } else if (end - start > f.end - f.start) {
        f.start = start
        f.end = end
      }
      speaker = f.speaker
    }
    out.push({ start: offset + start, end: offset + end, speaker })
  }

  for (const f of fresh.values()) {
    const len = Math.round((f.end - f.start) * RATE)
    if (len < ANCHOR_MIN || anchors.length >= MAX_ANCHORS) continue
    const from = Math.round(f.start * RATE)
    anchors.push({ speaker: f.speaker, samples: samples.slice(from, from + Math.min(len, ANCHOR_MAX)) })
  }
  // A new voice too short to anchor can't be recognised next time, so its
  // number would mean nothing: reported as -1, and its number given back.
  const anchored = new Set(anchors.map((a) => a.speaker))
  for (const o of out) if (!anchored.has(o.speaker)) o.speaker = -1
  nextId = anchors.reduce((n, a) => Math.max(n, a.speaker + 1), 0)
  return out
}

onmessage = (e) => {
  const m = e.data
  if (m.type === "init") {
    init(m).then(
      () => postMessage({ type: "ready" }),
      (err) => postMessage({ type: "error", message: String(err?.message ?? err) }),
    )
  } else if (m.type === "chunk" && sd) {
    try {
      const segments = chunk(m.samples, m.offset)
      postMessage({ type: "segments", offset: m.offset, duration: m.samples.length / RATE, segments })
    } catch (err) {
      postMessage({ type: "error", message: String(err?.message ?? err) })
    }
  }
}

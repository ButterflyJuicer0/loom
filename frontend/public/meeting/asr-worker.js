// Meeting mode's speech recognition, off the page's thread: sherpa-onnx's
// streaming Chinese+English zipformer, compiled to WebAssembly
// (https://github.com/k2-fsa/sherpa-onnx, Apache-2.0).
//
// One recognizer, one stream per track ("me" = the microphone, "them" = the
// shared system audio), so the 200 MB model is in memory once.
//
// The model files come from Cache Storage, put there by the page (see
// meeting.ts), never fetched here: the worker has no login token.
//
// In:  {type: "init", cache, files: {js, api, wasm, data}}
//      {type: "audio", track, samples}   16 kHz mono Float32Array
// Out: {type: "ready"} | {type: "error", message}
//      {type: "partial", track, text}
//      {type: "final", track, text, start, end}   seconds on that track's clock

/* global createOnlineRecognizer */
let recognizer = null
const tracks = {}

async function fromCache(cacheName, url) {
  const cache = await caches.open(cacheName)
  const res = await cache.match(url)
  if (!res) throw new Error("model file missing from cache: " + url)
  return res
}

async function load(cacheName, url) {
  const res = await fromCache(cacheName, url)
  const text = await res.text()
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
      printErr: (m) => console.debug("[asr]", m),
      setStatus: () => {},
      onRuntimeInitialized: resolve,
      onAbort: (why) => reject(new Error("wasm aborted: " + why)),
    }
    load(cache, files.api)
      .then(() => load(cache, files.js))
      .catch(reject)
  })
  recognizer = createOnlineRecognizer(self.Module)
}

function track(name) {
  let t = tracks[name]
  if (!t) {
    t = tracks[name] = { stream: recognizer.createStream(), samples: 0, start: null, last: "" }
  }
  return t
}

function feed(name, samples) {
  const t = track(name)
  t.stream.acceptWaveform(16000, samples)
  t.samples += samples.length
  while (recognizer.isReady(t.stream)) recognizer.decode(t.stream)

  const text = recognizer.getResult(t.stream).text.trim()
  const now = t.samples / 16000
  if (text && t.start === null) t.start = Math.max(0, now - samples.length / 16000 - 0.5)
  if (text !== t.last) {
    t.last = text
    postMessage({ type: "partial", track: name, text })
  }
  if (recognizer.isEndpoint(t.stream)) {
    if (text) postMessage({ type: "final", track: name, text, start: t.start ?? now, end: now })
    recognizer.reset(t.stream)
    t.start = null
    t.last = ""
    postMessage({ type: "partial", track: name, text: "" })
  }
}

onmessage = (e) => {
  const m = e.data
  if (m.type === "init") {
    init(m).then(
      () => postMessage({ type: "ready" }),
      (err) => postMessage({ type: "error", message: String(err?.message ?? err) }),
    )
  } else if (m.type === "audio" && recognizer) {
    try {
      feed(m.track, m.samples)
    } catch (err) {
      postMessage({ type: "error", message: String(err?.message ?? err) })
    }
  }
}

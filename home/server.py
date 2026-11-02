"""loom-home voice: a small LAN voice server for xiaozhi-protocol robots, with home devices from MQTT.

Device protocol: 78/xiaozhi-esp32 docs/websocket.md + docs/mcp-protocol.md, checked
against the firmware (main/application.cc, protocols/websocket_protocol.cc, mcp_server.cc).
Pipeline modeled on xinnan-tech/xiaozhi-esp32-server: Silero VAD -> SenseVoice ASR ->
Claude on Bedrock -> edge-tts -> Opus. Home devices: PROTOCOL.md, via home.py.

Run:  python server.py   (config.json next to it; see config.example.json)
Local control (127.0.0.1 only): POST /api/say {"text"}, POST /api/tool {"name","arguments"},
GET /api/status.
"""
import asyncio, io, json, logging, random, re, time, uuid, wave
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiohttp, av, edge_tts, numpy as np, sherpa_onnx
from aiohttp import web

from home import Home

ROOT = Path(__file__).resolve().parent
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
MODELS = ROOT / "models"
FRAME_MS = 60
OUT_RATE = 24000             # ESP-Hi output rate (boards/espressif/esp-hi/config.h): no resampling on device
PREBUF = 0.36                # seconds of audio sent ahead; device decode queue holds only 1.2 s, extra is dropped
IDLE_CLOSE = CFG.get("idle_close_seconds", 20)
BYE = re.compile(r"(再见|拜拜|退下|不聊了|没事了|晚安)")
EMOTIONS = ("neutral happy laughing funny sad angry crying loving embarrassed surprised shocked "
            "thinking winking relaxed delicious confident sleepy silly confused").split()
TAG = re.compile(r"[\[【]\s*(?:(do|vol)\s*[:：]\s*)?([a-z_]+|\d{1,3})\s*[\]】]"
                 r"|[\[【]\s*call\s*[:：]\s*([a-z0-9-]+)\.([a-z0-9_]+)\s*(\{.*?\})?\s*[\]】]")  # [call:<device>.<tool> {args}]
SENT_END = re.compile(r"[。！？!?；;\n]")
TZ = timezone(timedelta(hours=CFG.get("utc_offset_hours", 8)))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    handlers=[logging.FileHandler(ROOT / "logs" / "server.log", encoding="utf-8"),
                              logging.StreamHandler()])
log = logging.getLogger("xz")

def _sense_voice(lang):
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(MODELS / "sensevoice" / "model.int8.onnx"), tokens=str(MODELS / "sensevoice" / "tokens.txt"),
        num_threads=4, language=lang, use_itn=True)


ASR_AUTO, ASR_ZH = _sense_voice("auto"), _sense_voice("zh")


def new_vad():
    c = sherpa_onnx.VadModelConfig()
    c.silero_vad.model = str(MODELS / "silero_vad.onnx")
    c.silero_vad.threshold = 0.5
    c.silero_vad.min_silence_duration = CFG.get("vad_silence_seconds", 0.6)
    c.silero_vad.min_speech_duration = 0.25
    c.silero_vad.max_speech_duration = 20
    c.sample_rate = 16000
    return sherpa_onnx.VoiceActivityDetector(c, buffer_size_in_seconds=30)


def transcribe(samples):
    """Auto language (Mandarin/Cantonese/English); short clips often get misread as ja/ko -> redo as zh."""
    for rec in ((ASR_ZH,) if CFG.get("asr_language", "zh") == "zh" else (ASR_AUTO, ASR_ZH)):
        s = rec.create_stream()
        s.accept_waveform(16000, samples)
        rec.decode_stream(s)
        if rec is ASR_ZH or s.result.lang.strip("<|>") in ("zh", "yue", "en"):
            return s.result.text.strip()


def dump_wav(samples, keep=30):
    d = ROOT / "logs" / "utt"
    d.mkdir(exist_ok=True)
    with wave.open(str(d / datetime.now(TZ).strftime("%m%d-%H%M%S.wav")), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
    for old in sorted(d.glob("*.wav"))[:-keep]:
        old.unlink()


MUSIC = ROOT / "music"
THINK = ["嗯，", "我想想，", "嗯…让我想想，", "好的，"]
FILLER_PCM = {}


def load_audio(path):
    """Any audio file -> 24 kHz mono int16 PCM."""
    out = []
    with av.open(str(path)) as f:
        rs = av.AudioResampler(format="s16", layout="mono", rate=OUT_RATE)
        for fr in f.decode(audio=0):
            out += [r.to_ndarray().reshape(-1) for r in rs.resample(fr)]
    return np.concatenate(out) if out else np.zeros(0, np.int16)


def shows():
    """music/shows/<name>.json: {"name": tag, "desc": for the LLM, "file", "start", "end", "lag",
        "moves": [[t, action], ...]}
        with t in seconds from the clip start."""
    out = []
    for p in sorted((MUSIC / "shows").glob("*.json")):
        try:
            sh = json.loads(p.read_text(encoding="utf-8"))
            out.append(dict(sh, path=p.with_name(sh["file"])))
        except Exception as e:
            log.warning("bad show %s: %r", p.name, e)
    return out


HOME_PROMPT = ("家里还有这些设备，用调用标签控制，写法 [call:设备.工具 {{JSON 参数}}]，例如 [call:bedroom.set {{\"on\":false}}]；"
               "可以和动作标签一起写，写了标签才会真的执行，执行结果系统会告诉主人，你不用说成功没成功：\n{devices}")
_CLIPS = {}


def show_clip(show):
    """Cut + fade the show's clip once (decoding a whole song takes ~2 s); keyed by file and range."""
    key = (str(show["path"]), show.get("start", 0), show.get("end"), show["path"].stat().st_mtime)
    if key not in _CLIPS:
        pcm = load_audio(show["path"])
        a, b = int(show.get("start", 0) * OUT_RATE), int(show.get("end", len(pcm) / OUT_RATE) * OUT_RATE)
        pcm = pcm[a:b].copy()
        fade = min(len(pcm), OUT_RATE)  # 1 s fade-out, 30 ms fade-in
        pcm[-fade:] = (pcm[-fade:] * np.linspace(1, 0, fade)).astype(np.int16)
        pcm[:720] = (pcm[:720] * np.linspace(0, 1, 720)).astype(np.int16)
        _CLIPS[key] = pcm
    return _CLIPS[key]


BEDROCK_HTTP = None


async def bedrock_stream(msgs):
    """Bedrock ConverseStream with a Bedrock API key (bearer token) -> text pieces.
    Response is AWS eventstream: [total_len u32][headers_len u32][prelude crc][headers][payload][crc]."""
    global BEDROCK_HTTP
    b = CFG["bedrock"]
    if BEDROCK_HTTP is None:  # bedrock.proxy: optional HTTP proxy (Anthropic models refuse some regions' source IPs)
        BEDROCK_HTTP = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30, sock_connect=3))
    body = {"system": [{"text": msgs[0]["content"]}, {"cachePoint": {"type": "default"}}],
            "messages": [{"role": m["role"], "content": [{"text": m["content"]}]} for m in msgs[1:] if m["content"]],
            "inferenceConfig": {"maxTokens": 160},  # Claude 5 rejects temperature
            "additionalModelRequestFields": {"thinking": {"type": "disabled"}}}  # thinking ate the whole budget
    body.update(b.get("extra", {}))
    url = f"https://bedrock-runtime.{b['region']}.amazonaws.com/model/{b['model']}/converse-stream"
    async with BEDROCK_HTTP.post(url, json=body, headers={"Authorization": "Bearer " + b["api_key"]},
                                 proxy=b.get("proxy")) as r:
        if r.status != 200:
            raise RuntimeError(f"bedrock http {r.status}: {(await r.text())[:300]}")
        buf = b""
        async for chunk in r.content.iter_any():
            buf += chunk
            while len(buf) >= 12 and len(buf) >= int.from_bytes(buf[:4], "big"):
                total, hlen = int.from_bytes(buf[:4], "big"), int.from_bytes(buf[4:8], "big")
                hdr, payload, buf = buf[12:12 + hlen], buf[12 + hlen:total - 4], buf[total:]
                headers, i = {}, 0
                while i < len(hdr):  # only string headers (type 7) appear here
                    n = hdr[i]; name = hdr[i + 1:i + 1 + n].decode(); i += 1 + n
                    vlen = int.from_bytes(hdr[i + 1:i + 3], "big")
                    headers[name] = hdr[i + 3:i + 3 + vlen].decode(); i += 3 + vlen
                ev = json.loads(payload or b"{}")
                if headers.get(":message-type") == "exception":
                    raise RuntimeError(f"bedrock {headers.get(':exception-type')}: {ev}")
                if headers.get(":event-type") == "contentBlockDelta":
                    yield ev.get("delta", {}).get("text", "")
                elif headers.get(":event-type") == "metadata":
                    log.info("bedrock usage %s", ev.get("usage"))


async def synth(text):
    """edge-tts -> 24 kHz mono int16 PCM."""
    mp3 = bytearray()
    local = CFG.get("tts_local_addr")
    conn = aiohttp.TCPConnector(local_addr=(local, 0)) if local else None
    async for c in edge_tts.Communicate(text, CFG.get("voice", "zh-CN-XiaoxiaoNeural"),
                                        rate=CFG.get("voice_rate", "+10%"), connector=conn).stream():
        if c["type"] == "audio":
            mp3 += c["data"]
    if not mp3:
        return np.zeros(0, np.int16)
    out = []
    with av.open(io.BytesIO(bytes(mp3))) as f:
        rs = av.AudioResampler(format="s16", layout="mono", rate=OUT_RATE)
        for fr in f.decode(audio=0):
            out += [r.to_ndarray().reshape(-1) for r in rs.resample(fr)]
    return np.concatenate(out) if out else np.zeros(0, np.int16)


def clean(text):
    text = re.sub(r"[*#`>_~]|\[[^\]]*\]\([^)]*\)", "", text)
    return re.sub(r"[\U0001F000-\U0001FAFF\u2600-\u27BF]", "", text).strip()


class Session:
    def __init__(self, ws, device_id):
        self.ws, self.device_id, self.sid = ws, device_id, uuid.uuid4().hex[:12]
        self.ip = None
        self.listening, self.mode = False, "auto"
        self.vad = new_vad()
        # audio since listen start (absolute index = pcm_base + i). Silero catches onsets late, so the
        # VAD only marks the END of an utterance; ASR gets everything since the previous cut (<= 1.5 s
        # before the detected onset). A second segment before we start talking is merged with the first.
        self.pcm, self.pcm_base, self.cut, self.utt = np.zeros(0, np.float32), 0, 0, 0
        self.speaking = False
        self.dec = av.CodecContext.create("libopus", "r")
        self.dec.sample_rate, self.dec.layout = 16000, "mono"
        self.dec_rs = av.AudioResampler(format="flt", layout="mono", rate=16000)  # libopus decodes at 48 kHz
        self.enc = self._encoder()
        self.enc_pts, self.play_clock = 0, 0.0
        self.tools = []
        self.mcp_id, self.mcp_wait = 10, {}
        self.reply_task, self.act_task, self.pending_song, self.failed = None, None, False, []
        self.calling = False
        self.history = HISTORY.setdefault(device_id, {"msgs": [], "at": 0})
        self.last_activity = time.monotonic()

    @staticmethod
    def _encoder():
        e = av.CodecContext.create("libopus", "w")
        e.sample_rate, e.layout, e.format, e.bit_rate = OUT_RATE, "mono", "s16", 32000
        e.options = {"frame_duration": str(FRAME_MS), "application": "audio"}
        e.open()
        return e

    async def send(self, obj):
        obj.setdefault("session_id", self.sid)
        if not self.ws.closed:
            await self.ws.send_str(json.dumps(obj, ensure_ascii=False))

    # ---------- device -> server ----------
    async def on_text(self, m):
        t = m.get("type")
        if t == "hello":
            await self.send({"type": "hello", "transport": "websocket", "audio_params": {
                "format": "opus", "sample_rate": OUT_RATE, "channels": 1, "frame_duration": FRAME_MS}})
            if (m.get("features") or {}).get("mcp"):
                asyncio.create_task(self.init_mcp())
        elif t == "listen":
            st = m.get("state")
            if st == "start":
                self.listening, self.mode = True, m.get("mode", "auto")
                self.vad.reset()
                self.pcm, self.pcm_base, self.cut, self.utt = np.zeros(0, np.float32), 0, 0, 0
                self.last_activity = time.monotonic()
            elif st == "stop":
                self.listening = False
                self.vad.flush()
                await self.drain_vad()
            elif st == "detect":
                log.info("wake word: %s", m.get("text"))
        elif t == "abort":
            await self.stop_reply()
        elif t == "mcp":
            p = m.get("payload") or {}
            fut = self.mcp_wait.pop(p.get("id"), None)
            if fut and not fut.done():
                fut.set_result(p)

    async def on_audio(self, data):
        if not self.listening:
            return
        try:
            frames = self.dec.decode(av.Packet(data))
        except av.error.FFmpegError:
            return
        for fr in frames:
            for r in self.dec_rs.resample(fr):
                x = r.to_ndarray().reshape(-1).astype(np.float32)
                self.vad.accept_waveform(x)
                self.pcm = np.concatenate([self.pcm, x])
        if len(self.pcm) > 16000 * 40:  # keep at most 40 s
            drop = len(self.pcm) - 16000 * 30
            self.pcm, self.pcm_base = self.pcm[drop:], self.pcm_base + drop
        if self.vad.is_speech_detected():
            self.last_activity = time.monotonic()
        await self.drain_vad()

    async def drain_vad(self):
        while not self.vad.empty():
            seg = self.vad.front
            seg_start, seg_end = seg.start, seg.start + len(seg.samples)
            self.vad.pop()
            merging = bool(self.reply_task and not self.reply_task.done() and not self.speaking)
            if not merging:
                self.utt = max(self.cut, seg_start - 24000, self.pcm_base)
            self.cut = seg_end
            samples = self.pcm[max(0, self.utt - self.pcm_base): seg_end - self.pcm_base]
            dump_wav(samples)
            t0 = time.monotonic()
            text = await asyncio.get_running_loop().run_in_executor(None, transcribe, samples)
            log.info("asr %.2fs audio in %.3fs%s: %s", len(samples) / 16000, time.monotonic() - t0,
                     " (merged)" if merging else "", text)
            if len(re.sub(r"[\W_嗯啊哦呃]", "", text)) < 1:
                continue
            await self.stop_reply()
            self.reply_task = asyncio.create_task(self.reply(text))

    # ---------- MCP (server is the client; device is the MCP server) ----------
    async def mcp(self, method, params=None, timeout=5.0):
        self.mcp_id += 1
        mid = self.mcp_id
        fut = asyncio.get_running_loop().create_future()
        self.mcp_wait[mid] = fut
        await self.send({"type": "mcp", "payload": {"jsonrpc": "2.0", "id": mid, "method": method,
                                                    "params": params or {}}})
        return await asyncio.wait_for(fut, timeout)

    async def init_mcp(self):
        try:
            await self.mcp("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                          "clientInfo": {"name": "loom-home", "version": "0.1"}})
            tools, cursor = [], ""
            while True:
                r = (await self.mcp("tools/list", {"cursor": cursor} if cursor else {})).get("result", {})
                tools += r.get("tools", [])
                cursor = r.get("nextCursor") or ""
                if not cursor:
                    break
            self.tools = tools
            log.info("device tools: %s", [t["name"] for t in tools])
        except Exception as e:
            log.warning("mcp init failed: %r", e)

    async def call_tool(self, name, args):
        r = await self.mcp("tools/call", {"name": name, "arguments": args})
        if "error" in r:
            return "error: " + json.dumps(r["error"], ensure_ascii=False)
        return " ".join(c.get("text", "") for c in r.get("result", {}).get("content", []) if c.get("type") == "text")

    def actions(self):
        """Body actions from the device's MCP tools: tools taking one `action` string list their keys in the
        description ("forward: 向前移动"); zero-arg self.light.turn_on/off become light_on/light_off."""
        acts = {}
        for t in self.tools:
            props = (t.get("inputSchema") or {}).get("properties") or {}
            if list(props) == ["action"]:
                for line in t.get("description", "").splitlines():
                    m = re.match(r"\s*([a-z_]+)\s*[:：]\s*(.+)", line)
                    if m:
                        acts[m.group(1)] = (m.group(2).strip(), t["name"], {"action": m.group(1)})
            elif not props and t["name"] in ("self.light.turn_on", "self.light.turn_off"):
                acts["light_" + t["name"].rsplit("_", 1)[1]] = (t.get("description", ""), t["name"], {})
        return acts

    def system_prompt(self):
        acts = self.actions()
        acts.update({sh["name"]: (sh["desc"], "", {}) for sh in shows()})
        body = "，".join(f"{k}（{v[0]}）" for k, v in acts.items()) or "（暂时没有）"
        vol = any(t["name"] == "self.audio_speaker.set_volume" for t in self.tools)
        devices = HOME.prompt(skip=CFG.get("home_ids", {}).get(self.device_id))  # its own body is in {actions}
        return CFG.get("device_prompts", {}).get(self.device_id, CFG["system_prompt"]).format(emotions=" ".join(EMOTIONS), actions=body) + \
            ("主人要调音量时写 [vol:数字]，0 到 100。" if vol else "") + \
            ("\n" + CFG.get("home_prompt", HOME_PROMPT).format(devices=devices) if devices else "")

    async def run_tag(self, kind, arg):
        """Execute one inline tag from the LLM text: [do:<action>], [vol:<0-100>] or [call:<device>.<tool> {args}]."""
        try:
            if kind == "call":
                dev, tool, args = arg
                ack = await HOME.call(dev, tool, json.loads(args) if args else {})
                log.info("call %s.%s %s -> %s", dev, tool, args, json.dumps(ack, ensure_ascii=False)[:200])
                if not ack.get("ok"):
                    self.failed.append(f"{HOME.name(dev)}没有执行成功。")
                return
            show = next((sh for sh in shows() if kind == "do" and sh["name"] == arg), None)
            if show:
                self.pending_song = show
                return
            if kind == "do":
                a = self.actions().get(arg)
                if not a:
                    return log.info("unknown action tag %s", arg)
                res = await self.call_tool(a[1], a[2])
            else:
                res = await self.call_tool("self.audio_speaker.set_volume", {"volume": max(0, min(100, int(arg)))})
            log.info("tag [%s:%s] -> %s", kind, arg, res)
        except Exception as e:
            log.warning("tag [%s:%s] failed: %r", kind, arg, e)
            if kind == "call":
                self.failed.append(f"{HOME.name(arg[0])}没有执行成功。")

    # ---------- reply: LLM -> sentences -> TTS -> paced Opus ----------
    async def stop_reply(self):
        if self.reply_task and not self.reply_task.done():
            self.reply_task.cancel()
            try:
                await self.reply_task
            except (asyncio.CancelledError, Exception):
                pass
            if self.speaking:
                await self.send({"type": "tts", "state": "stop"})
            self.speaking = False

    async def reply(self, text):
        await self.send({"type": "stt", "text": text})
        self.failed, self.calling = [], False
        filler = random.choice(THINK)  # pre-synthesized, plays the moment ASR is done
        h = self.history
        if time.monotonic() - h["at"] > 1800:
            h["msgs"].clear()
        h["at"] = time.monotonic()
        sentences = asyncio.Queue()
        if filler in FILLER_PCM:
            await sentences.put((filler, FILLER_PCM[filler]))
        speaker = asyncio.create_task(self.speak(sentences))
        try:
            content = await self.llm(text, sentences, said=filler if filler in FILLER_PCM else "")
            # tags stay in history: they show the model its own working pattern
            h["msgs"][:] = (h["msgs"] + [{"role": "user", "content": text},
                                         {"role": "assistant", "content": content}])[-12:]
        except asyncio.CancelledError:
            speaker.cancel()
            raise
        except Exception:
            log.exception("reply failed")
            await sentences.put("抱歉，我脑子卡了一下。")
        if self.calling and self.act_task:  # say it when a home device did not do what was asked
            await asyncio.wait([self.act_task], timeout=12)
        for f in self.failed:
            await sentences.put(f)
        await sentences.put(None)
        await speaker
        if self.pending_song:
            song, self.pending_song = self.pending_song, False
            await self.play_show(song)
        await self.send({"type": "tts", "state": "stop"})
        self.speaking = False
        self.last_activity = time.monotonic()
        if BYE.search(text):
            asyncio.get_running_loop().call_later(1.0, lambda: asyncio.create_task(self.ws.close()))

    async def llm(self, text, sentences, said=""):
        """Stream one LLM reply; run [emotion]/[do:x]/[vol:n] tags as they complete, queue clean sentences."""
        now = datetime.now(TZ).strftime("%m月%d日 %A %H:%M")
        msgs = [{"role": "system", "content": self.system_prompt()}] + self.history["msgs"] + \
               [{"role": "user", "content": f"（现在{now}）{text}" + (
                   f"（你已经先说了“{said}”，接着往下说，别重复）" if said else "")}]
        content, buf, spoke, t0 = "", "", False, time.monotonic()
        actions = []  # run sequentially, without blocking speech
        async for piece in bedrock_stream(msgs):
                if not piece:
                    continue
                if not content:
                    log.info("llm first token %.2fs", time.monotonic() - t0)
                content += piece
                buf += piece
                while (m := TAG.search(buf)):
                    kind, arg = m.group(1), m.group(2)
                    if m.group(3):
                        actions.append(("call", (m.group(3), m.group(4), m.group(5))))
                        self.calling = True
                    elif kind is None and arg in EMOTIONS:
                        await self.send({"type": "llm", "emotion": arg})
                    elif kind:
                        actions.append((kind, arg))
                    buf = buf[:m.start()] + buf[m.end():]
                if actions:  # chain after earlier tags so the dog moves in the order written
                    self.act_task = asyncio.create_task(self._run_tags(actions, after=self.act_task))
                    actions = []
                if re.search(r"[\[【][^\]】]*$", buf):
                    continue  # an unfinished tag: wait before cutting sentences
                while True:
                    m = SENT_END.search(buf)
                    comma = buf.find("，") + 1
                    cut = m.end() if m else (comma if comma and (len(buf) > 30 or (not spoke and comma >= 5)) else 0)
                    if not cut:
                        break
                    s, buf = clean(buf[:cut]), buf[cut:]
                    if s:
                        spoke = True
                        await sentences.put(s)
        rest = clean(TAG.sub("", buf))
        if rest:
            await sentences.put(rest)
        return content

    async def _run_tags(self, todo, after=None):
        if after:
            await asyncio.gather(after, return_exceptions=True)
        for kind, arg in todo:
            await self.run_tag(kind, arg)

    async def speak(self, sentences):
        """Start TTS for every sentence as soon as the LLM emits it; send them in order, in real time."""
        jobs = asyncio.Queue()

        async def producer():
            while (s := await sentences.get()) is not None:
                if isinstance(s, tuple):  # (text, ready pcm): pre-synthesized filler
                    fut = asyncio.get_running_loop().create_future(); fut.set_result(s[1])
                    await jobs.put((s[0], fut))
                else:
                    await jobs.put((s, asyncio.create_task(synth(s))))
            await jobs.put(None)

        prod, started = asyncio.create_task(producer()), False
        try:
            while (item := await jobs.get()) is not None:
                s, job = item
                t0 = time.monotonic()
                try:
                    pcm = await job
                except Exception as e:
                    log.warning("tts failed for %r: %r", s, e)
                    continue
                if time.monotonic() - t0 > 0.05:
                    log.info("tts wait %.2fs: %s", time.monotonic() - t0, s)
                if not started:
                    self.speaking = True
                    await self.send({"type": "tts", "state": "start"})
                    started = True
                await self.send({"type": "tts", "state": "sentence_start", "text": s})
                await self.send_pcm(pcm)
        finally:
            prod.cancel()
            while not jobs.empty():
                item = jobs.get_nowait()
                if item:
                    item[1].cancel()
        if started:
            # let the device play out what is already queued before "stop"
            await asyncio.sleep(max(0.0, self.play_clock - time.monotonic() - PREBUF))

    async def send_pcm(self, pcm):
        n = OUT_RATE * FRAME_MS // 1000
        pad = (-len(pcm)) % n + 2 * n  # finish the last frame + a short pause between sentences
        pcm = np.concatenate([pcm, np.zeros(pad, np.int16)])
        for i in range(0, len(pcm), n):
            fr = av.AudioFrame.from_ndarray(pcm[i:i + n].reshape(1, -1), format="s16", layout="mono")
            fr.sample_rate, fr.pts = OUT_RATE, self.enc_pts
            self.enc_pts += n
            for p in self.enc.encode(fr):
                now = time.monotonic()
                self.play_clock = max(self.play_clock, now)
                if self.play_clock - now > PREBUF:
                    await asyncio.sleep(self.play_clock - now - PREBUF)
                if self.ws.closed:
                    return
                await self.ws.send_bytes(bytes(p))
                self.play_clock += FRAME_MS / 1000

    async def play_show(self, show):
        """Keyword-triggered song clip with a fixed choreography sent over the LAN API, timed to playback."""
        log.info("show %s", show["path"].name)
        pcm = await asyncio.get_running_loop().run_in_executor(None, show_clip, show)
        self.speaking = True
        await self.send({"type": "tts", "state": "start"})
        if show.get("say"):
            await self.speak_now(show["say"])
        await self.send({"type": "tts", "state": "sentence_start", "text": "♪ " + show["path"].stem})
        # device plays PREBUF behind what we send; play_clock is when the first sample will be heard
        t0 = max(self.play_clock, time.monotonic()) + show.get("lag", 0.15)  # Wi-Fi + decode delay
        moves = asyncio.create_task(self._choreo(t0, show.get("moves", [])))
        try:
            await self.send_pcm(pcm)
            await asyncio.sleep(max(0.0, self.play_clock - time.monotonic() - PREBUF))
        finally:
            moves.cancel()
            await self.send({"type": "tts", "state": "stop"})
            self.speaking = False
            self.last_activity = time.monotonic()

    async def speak_now(self, text):
        q = asyncio.Queue()
        await q.put(text)
        await q.put(None)
        await self.speak(q)

    async def _choreo(self, t0, moves):
        """Send each move at its time, one at a time (a new move interrupts the old one on the robot).
        Uses the device's MCP tools: the LAN /control numbering differs between firmware versions.
        Never pile up calls: the firmware's servo_dog_ctrl_send blocks the device's main loop when its
        5-slot action queue is full, after which the robot stops answering. Skip late moves, stop on timeout."""
        acts = self.actions()
        for t, act in moves:
            late = time.monotonic() - (t0 + t)
            if late > 0.3:
                log.info("move %s skipped (%.1fs late)", act, late)
                continue
            await asyncio.sleep(-late)
            if act not in acts:
                log.info("move %s not on this device", act)
                continue
            try:
                r = await asyncio.wait_for(self.mcp("tools/call", {"name": acts[act][1], "arguments": acts[act][2]}), 1.5)
                log.info("move %s -> %s", act, "error" if "error" in r else "ok")
            except (asyncio.TimeoutError, Exception) as e:
                log.warning("move %s failed: %r; robot not answering, stopping moves", act, e)
                return

    async def say(self, text):
        q = asyncio.Queue()
        for part in [p for p in re.split(r"(?<=[。！？!?；;\n])", text) if p.strip()]:
            await q.put(clean(part))
        await q.put(None)
        await self.speak(q)
        await self.send({"type": "tts", "state": "stop"})
        self.speaking = False
        self.last_activity = time.monotonic()


HISTORY, SESSIONS = {}, {}
HOME = Home(CFG.get("mqtt"))


async def ws_handler(req):
    if req.headers.get("Authorization", "").removeprefix("Bearer ").strip() != CFG["token"]:
        log.warning("rejected ws from %s", req.remote)
        raise web.HTTPUnauthorized()
    ws = web.WebSocketResponse(max_msg_size=1 << 20)
    await ws.prepare(req)
    dev = req.headers.get("Device-Id", req.remote)
    s = Session(ws, dev)
    s.ip = req.remote
    SESSIONS[dev] = s
    log.info("device connected %s from %s (protocol %s)", dev, req.remote, req.headers.get("Protocol-Version"))
    watchdog = asyncio.create_task(idle_watchdog(s))
    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                await s.on_text(json.loads(msg.data))
            elif msg.type == aiohttp.WSMsgType.BINARY:
                await s.on_audio(msg.data)
    finally:
        watchdog.cancel()
        await s.stop_reply()
        if SESSIONS.get(dev) is s:
            del SESSIONS[dev]
        log.info("device disconnected %s", dev)
    return ws


async def idle_watchdog(s):
    """Close the channel after IDLE_CLOSE s without speech so the robot goes back to wake-word idle."""
    while not s.ws.closed:
        await asyncio.sleep(1)
        busy = s.reply_task and not s.reply_task.done()
        if s.listening and not busy and time.monotonic() - s.last_activity > IDLE_CLOSE:
            log.info("idle %ss, closing channel", IDLE_CLOSE)
            await s.ws.close()


def local_only(fn):
    async def wrap(req):
        if req.remote not in ("127.0.0.1", "::1"):
            raise web.HTTPForbidden()
        return await fn(req)
    return wrap


def pick_session():
    return next(iter(SESSIONS.values()), None)


@local_only
async def api_say(req):
    s = pick_session()
    if not s:
        return web.json_response({"ok": False, "error": "robot not connected; wake it first"}, status=409)
    text = (await req.json())["text"]
    await s.stop_reply()
    s.reply_task = asyncio.create_task(s.say(text))
    return web.json_response({"ok": True})


@local_only
async def api_tool(req):
    s = pick_session()
    if not s:
        return web.json_response({"ok": False, "error": "robot not connected; wake it first"}, status=409)
    j = await req.json()
    return web.json_response({"ok": True, "result": await s.call_tool(j["name"], j.get("arguments", {}))})


@local_only
async def api_status(req):
    return web.json_response({"devices": {k: {"tools": [t["name"] for t in s.tools], "listening": s.listening}
                                          for k, s in SESSIONS.items()},
                              "home": {k: [t["name"] for t in c["tools"]] for k, c in HOME.devices.items()},
                              "history": {k: v["msgs"][-6:] for k, v in HISTORY.items()}})


async def health(req):
    return web.Response(text="loom-home voice ok\n")


async def main():
    home_task = asyncio.create_task(HOME.run())  # noqa: F841 (kept so it is not garbage-collected)
    for f in set(THINK):  # pre-synthesize fillers so they play ~0 ms after ASR
        try:
            FILLER_PCM[f] = await synth(f)
        except Exception as e:
            log.warning("filler synth failed %s: %r", f, e)
    for sh in shows():  # warm the clip cache so a show starts the moment it is asked for
        await asyncio.get_running_loop().run_in_executor(None, show_clip, sh)
    app = web.Application()
    app.add_routes([web.get("/xiaozhi/v1/", ws_handler), web.get("/xiaozhi/v1", ws_handler),
                    web.post("/api/say", api_say), web.post("/api/tool", api_tool),
                    web.get("/api/status", api_status), web.get("/", health)])
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, CFG.get("host", "0.0.0.0"), CFG.get("port", 8000)).start()
    log.info("loom-home voice listening on %s:%s", CFG.get("host", "0.0.0.0"), CFG.get("port", 8000))
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())

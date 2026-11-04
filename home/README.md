# loom-home

An open home IoT setup built on Loom: devices talk over the MQTT broker inside
`loom-node`, and a voice server lets xiaozhi-protocol robots control them by
speech. MIT, like the rest of this repository.

```
 robots (xiaozhi websocket)          home devices (lights, AC, sensors, ...)
          │                                     │  home/<id>/caps|cmd|ack|state
          ▼                                     ▼
  server.py (voice) ── MQTT ──▶ loom-node broker (e.g. on the router)
          │
          └─ Bedrock (Claude), edge-tts
```

- [`PROTOCOL.md`](PROTOCOL.md) — topics and JSON formats every device follows.
  Read this first if you are adding a device.
- `server.py` — the voice server: Silero VAD → SenseVoice ASR → Claude on
  Amazon Bedrock → edge-tts → Opus, over the xiaozhi websocket protocol.
  The model controls the robot's own body through its MCP tools (`[do:…]`
  tags) and home devices through MQTT (`[call:<device>.<tool> {args}]` tags),
  with the device list learned from `caps` at run time — nothing is hard-coded.
- `home.py` — the MQTT side: discovery, the tool list for the prompt, calls
  with `ack` and one resend.
- `mqtt.py` — a minimal asyncio MQTT 3.1.1 client (QoS 0), no dependencies.

## Run the voice server

1. Python 3.10+, `pip install -r requirements.txt`.
2. Models in `models/`:
   - `models/sensevoice/model.int8.onnx` and `tokens.txt` from
     [sherpa-onnx SenseVoice](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17);
   - `models/silero_vad.onnx` from the
     [sherpa-onnx releases](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx).
3. `mkdir logs`, copy `config.example.json` to `config.json` and fill it in.
   Personas go in `system_prompt` / `device_prompts` (keyed by the robot's
   `Device-Id` header); `{emotions}` and `{actions}` are filled in for you, and
   the home device list is appended when MQTT has any. `home_ids` maps a
   robot's `Device-Id` to its own MQTT id, so it is not offered its own body twice.
4. `python server.py`, then point the robot's websocket URL at
   `ws://<this machine>:8000/xiaozhi/v1/` with the token from the config.

## TLS

Both the robot websocket and the MQTT link transmit secrets (the shared
bearer token the robot sends in the `Authorization` header, the Opus audio
and STT/LLM transcripts, and the MQTT broker user/password). Without TLS
they travel in cleartext, so any device on the same LAN -- a guest on the
Wi-Fi, a compromised IoT device on the same segment, an ARP-spoofing
neighbour -- can recover the token and the broker credentials and then
command every home device. Enable TLS in production:

- Websocket (`wss://`): fill in the `tls` block in `config.json`
  (`cert_file`, `key_file`, optionally `client_ca_file` to require robot
  client certificates), then point robots at `wss://<host>:8000/xiaozhi/v1/`.
  If `tls` is not configured the server still starts on `ws://` and logs a
  warning on every boot.
- MQTT: set `mqtt.tls=true` and `mqtt.ca_file` to the PEM bundle that signs
  the broker certificate (optionally `mqtt.server_hostname` if the broker
  address is an IP). Without this the MQTT CONNECT and every PUBLISH travel
  in cleartext and `mqtt.py` logs a warning.

Optional: `music/shows/<name>.json` adds a song clip with timed moves that
the model can start with `[do:<name>]` (see `shows()` in `server.py`).

## Run the bus

Turn on the broker of any always-on `loom-node` (see `node/SKILL.md`, section
5): `"mqtt": {"listen": "<lan ip>:1883", "users": {...}}` in its config. Then
`loom-node mqtt sub 'home/#'` shows everything on the bus.

## Credits

- Device protocol compatible with
  [78/xiaozhi-esp32](https://github.com/78/xiaozhi-esp32) (MIT): websocket and
  MCP protocol docs.
- Pipeline modeled on
  [xinnan-tech/xiaozhi-esp32-server](https://github.com/xinnan-tech/xiaozhi-esp32-server).
- [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) ASR and
  [Silero VAD](https://github.com/snakers4/silero-vad), run through
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx).
- [edge-tts](https://github.com/rany2/edge-tts) for speech.

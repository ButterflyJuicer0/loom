"""The home devices the voice model can use, learned from MQTT (see PROTOCOL.md).

Devices announce themselves on home/<id>/caps; a tool call is a message on
home/<id>/cmd with a rid, answered on home/<id>/ack.
"""
import asyncio, json, logging, secrets, ssl, time

from mqtt import MQTT

log = logging.getLogger("home")
DISCOVER_EVERY = 300   # seconds; a device that misses two rounds is dropped
ACK_TIMEOUT = 10


def _mqtt_ssl_context(cfg):
    """Build an ssl.SSLContext from the mqtt.* keys, or return None for plaintext.

    Config keys (all optional, additive): tls (bool), ca_file (path to a PEM CA bundle used to
    pin the broker's issuer), insecure (bool, disables hostname/cert verification -- test only).
    """
    if not cfg.get("tls"):
        return None
    ctx = ssl.create_default_context(cafile=cfg.get("ca_file"))
    if cfg.get("insecure"):
        log.warning("mqtt.insecure=true: TLS certificate verification disabled")
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


class Home:
    def __init__(self, cfg):
        self.devices, self.seen, self.pending = {}, {}, {}
        self.bus = None
        if cfg and cfg.get("host"):
            self.bus = MQTT(cfg["host"], cfg.get("port", 1883), cfg["user"], cfg["password"],
                            cfg.get("client_id", "loom-home-voice"), ["home/+/caps", "home/+/ack"],
                            self.on_message, on_connect=self.discover,
                            ssl_context=_mqtt_ssl_context(cfg),
                            server_hostname=cfg.get("server_hostname"))

    async def run(self):
        if not self.bus:
            log.info("no mqtt in config.json: no home devices")
            return
        self.task = asyncio.create_task(self.bus.run())  # keep a reference: asyncio holds tasks weakly
        while True:
            await asyncio.sleep(DISCOVER_EVERY)
            self.discover()

    def discover(self):
        cutoff = time.monotonic() - 2 * DISCOVER_EVERY - 10
        for i in [i for i, t in self.seen.items() if t < cutoff]:
            log.info("home device %s gone", i)
            self.devices.pop(i, None), self.seen.pop(i, None)
        self.bus.publish("home/discover", '{"v":1}')

    def on_message(self, topic, payload):
        parts = topic.split("/")
        if len(parts) != 3:
            return
        dev, kind = parts[1], parts[2]
        try:
            msg = json.loads(payload)
        except ValueError:
            return log.info("bad json on %s", topic)
        if kind == "caps" and msg.get("id") == dev and isinstance(msg.get("tools"), list):
            if dev not in self.devices:
                log.info("home device %s: %s", dev, [t.get("name") for t in msg["tools"]])
            self.devices[dev], self.seen[dev] = msg, time.monotonic()
        elif kind == "ack":
            fut = self.pending.pop(msg.get("rid"), None)
            if fut and not fut.done():
                fut.set_result(msg)

    def prompt(self, skip=None):
        """Lines for the system prompt: one per tool, with its arguments. skip: the robot's own id."""
        lines = []
        for dev, caps in sorted(self.devices.items()):
            if dev == skip:
                continue
            for t in caps["tools"]:
                props = (t.get("input_schema") or {}).get("properties") or {}
                args = "，".join(f"{k}: {v.get('type', '')}" + (f" 可选值 {'/'.join(map(str, v['enum']))}" if v.get("enum") else "")
                                for k, v in props.items())
                lines.append(f"- {dev}.{t['name']}（{caps.get('name', dev)}）：{t.get('description', '')} 参数 {{{args}}}")
        return "\n".join(lines)

    def name(self, dev):
        return (self.devices.get(dev) or {}).get("name", dev)

    async def call(self, dev, tool, args):
        """Publish one command and wait for its ack (resent once with the same rid). Returns the ack."""
        if dev not in self.devices:
            return {"ok": False, "error": "unknown device"}
        if not self.bus or not self.bus.connected:
            return {"ok": False, "error": "mqtt not connected"}
        rid = secrets.token_hex(6)
        msg = json.dumps({"v": 1, "tool": tool, "args": args, "rid": rid, "from": "voice"}, ensure_ascii=False)
        fut = asyncio.get_running_loop().create_future()
        self.pending[rid] = fut
        try:
            for wait in (ACK_TIMEOUT / 2, ACK_TIMEOUT):
                self.bus.publish(f"home/{dev}/cmd", msg)
                try:
                    return await asyncio.wait_for(asyncio.shield(fut), wait)
                except asyncio.TimeoutError:
                    pass
            return {"ok": False, "error": "no answer"}
        finally:
            self.pending.pop(rid, None)

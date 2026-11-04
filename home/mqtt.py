"""A minimal asyncio MQTT 3.1.1 client: QoS 0 publish/subscribe, keepalive, reconnect.

Enough for the loom-node broker (node/mqtt.go), which only does QoS 0 and has no
retained messages or wills. Packet layout per the MQTT 3.1.1 spec, sections 2-3.
"""
import asyncio, logging

log = logging.getLogger("mqtt")

CONNECT, CONNACK, PUBLISH, SUBSCRIBE, PINGREQ, DISCONNECT = 1, 2, 3, 8, 12, 14


def _str(s):
    b = s.encode() if isinstance(s, str) else s
    return len(b).to_bytes(2, "big") + b


def _packet(typ, flags, body):
    n, rl = len(body), bytearray()
    while True:
        n, d = divmod(n, 128)
        rl.append(d | (0x80 if n else 0))
        if not n:
            break
    return bytes([typ << 4 | flags]) + bytes(rl) + body


class MQTT:
    def __init__(self, host, port, user, password, client_id, subs, on_message, on_connect=None,
                 ssl_context=None, server_hostname=None):
        self.addr, self.user, self.password, self.client_id = (host, port), user, password, client_id
        self.subs, self.on_message, self.on_connect = subs, on_message, on_connect
        # ssl_context: an ssl.SSLContext for a TLS CONNECT, or None for plaintext (unchanged legacy behaviour).
        # server_hostname: SNI / certificate-identity override; defaults to the broker host.
        self.ssl_context = ssl_context
        self.server_hostname = server_hostname if server_hostname is not None else host
        self.writer = None

    @property
    def connected(self):
        return self.writer is not None

    def publish(self, topic, payload):
        """QoS 0: dropped when not connected, like any QoS 0 message may be."""
        if self.writer:
            data = payload if isinstance(payload, bytes) else payload.encode()
            self.writer.write(_packet(PUBLISH, 0, _str(topic) + data))

    async def run(self):
        while True:
            try:
                await self._session()
            except (OSError, asyncio.IncompleteReadError, ConnectionError, ValueError) as e:
                log.warning("mqtt %s:%s: %r; reconnecting in 5 s", *self.addr, e)
            self.writer = None
            await asyncio.sleep(5)

    async def _session(self):
        if self.ssl_context is not None:
            r, w = await asyncio.wait_for(
                asyncio.open_connection(*self.addr, ssl=self.ssl_context,
                                        server_hostname=self.server_hostname), 10)
        else:
            log.warning("mqtt %s:%s: TLS disabled; broker user/password and all PUBLISH traffic are "
                        "transmitted in cleartext. Set mqtt.tls=true and mqtt.ca_file in config.json.",
                        *self.addr)
            r, w = await asyncio.wait_for(asyncio.open_connection(*self.addr), 10)
        try:
            w.write(_packet(CONNECT, 0, _str("MQTT") + bytes([4, 0xC2]) + (60).to_bytes(2, "big") +
                            _str(self.client_id) + _str(self.user) + _str(self.password)))
            typ, body = await self._read(r)
            if typ != CONNACK or len(body) < 2 or body[1] != 0:
                raise ValueError(f"connect refused (code {body[1] if len(body) > 1 else '?'})")
            w.write(_packet(SUBSCRIBE, 2, (1).to_bytes(2, "big") + b"".join(_str(s) + b"\0" for s in self.subs)))
            self.writer = w
            log.info("mqtt connected to %s:%s", *self.addr)
            if self.on_connect:
                self.on_connect()
            ping = asyncio.create_task(self._ping(w))
            try:
                while True:
                    typ, body = await asyncio.wait_for(self._read(r), 90)
                    if typ == PUBLISH:
                        n = int.from_bytes(body[:2], "big")
                        try:
                            self.on_message(body[2:2 + n].decode(), body[2 + n:])
                        except Exception:
                            log.exception("mqtt handler failed")
            finally:
                ping.cancel()
        finally:
            w.close()

    async def _ping(self, w):
        while True:
            await asyncio.sleep(30)
            w.write(_packet(PINGREQ, 0, b""))

    @staticmethod
    async def _read(r):
        head = (await r.readexactly(1))[0]
        n, shift = 0, 0
        while True:
            d = (await r.readexactly(1))[0]
            n |= (d & 0x7F) << shift
            shift += 7
            if not d & 0x80:
                break
            if shift > 21:
                raise ValueError("bad remaining length")
        body = await r.readexactly(n)
        if head >> 4 == PUBLISH and (head >> 1) & 3:  # QoS > 0: drop the packet id
            n = int.from_bytes(body[:2], "big")
            body = body[:2 + n] + body[4 + n:]
        return head >> 4, body

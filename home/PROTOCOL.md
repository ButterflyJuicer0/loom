# loom-home protocol

Version 1. How devices in one home talk over MQTT: what they can do (`caps`),
how to ask them to do it (`cmd`), how they answer (`ack`) and what they look
like now (`state`).

The bus is the MQTT 3.1.1 broker built into `loom-node` (see `node/SKILL.md`,
section 5). That broker is deliberately small, and this protocol is shaped by
its limits:

- **QoS 0 only.** A message can be lost. Callers that care use `ack` and retry.
- **No retained messages, no wills.** Nobody learns a device's caps or state
  just by subscribing; they ask with `home/discover`. A device that drops off
  is noticed by its silence, not by a last-will message.
- **One broker per home, no bridging.** Everything below happens on it.

## 1. Topics

| Topic | Who publishes | Payload |
|---|---|---|
| `home/discover` | anyone | discover request (section 4) |
| `home/<id>/caps` | the device | what it can do (section 2) |
| `home/<id>/cmd` | anyone | a command (section 3) |
| `home/<id>/ack` | the device | the result of a command (section 3) |
| `home/<id>/state` | the device | its current state (section 5) |

`<id>` is the device id: lowercase ASCII letters, digits and `-`, 1–32
characters, unique in the home, stable across restarts (e.g. `bedroom`,
`living-ac`, `dog`). Human names in any language go in `name`, never in the
topic.

A *device* is anything with its own id. One program may front several devices
(a bridge for a light gateway publishes one `caps` per room or per light);
each still gets its own topics.

Every payload is a UTF-8 JSON object, at most 16 KiB. Unknown fields must be
ignored, so fields can be added later without breaking anyone.

## 2. caps — what a device can do

Published on `home/<id>/caps`:

- when the device connects;
- in answer to a matching `home/discover`;
- whenever its tools change.

```json
{
  "v": 1,
  "id": "bedroom",
  "name": "Bedroom lights",
  "room": "bedroom",
  "kind": "light",
  "tools": [
    {
      "name": "set",
      "description": "Turn all bedroom lights on or off.",
      "input_schema": {
        "type": "object",
        "properties": { "on": { "type": "boolean" } },
        "required": ["on"]
      }
    }
  ]
}
```

- `v` — protocol version, `1`.
- `id` — same as in the topic.
- `name` — what people call it; shown to the voice model.
- `room`, `kind` — optional hints (`light`, `ac`, `speaker`, `robot`,
  `sensor`, …) for grouping and for "turn off everything in the bedroom".
- `tools` — same shape as an MCP tool: `name` (`[a-z0-9_]`, unique within the
  device), `description` written for a language model, `input_schema` as JSON
  Schema. A tool with no input has `{"type":"object","properties":{}}`.

A voice brain turns each tool into a model tool named `<id>__<tool>`
(e.g. `bedroom__set`), so ids and tool names together stay under 64
characters.

## 3. cmd and ack — doing something

To call a tool, publish to `home/<id>/cmd`:

```json
{ "v": 1, "tool": "set", "args": { "on": false }, "rid": "k3f9a2", "from": "voice" }
```

- `tool`, `args` — the tool and its input, matching `caps`.
- `rid` — request id chosen by the caller, unique enough to tell its own
  requests apart (8+ random characters). Optional: without `rid` the device
  acts and sends no `ack` (fire and forget, e.g. a cron job).
- `from` — optional, who is asking; for logs only.

When `rid` is present the device answers once on `home/<id>/ack`:

```json
{ "v": 1, "rid": "k3f9a2", "ok": true, "result": { "acked": true } }
{ "v": 1, "rid": "k3f9a2", "ok": false, "error": "unknown tool: dim" }
```

- `ok` — whether the device did it. `result` is optional and tool-specific;
  `error` is a short human-readable reason when `ok` is false.
- `ok: true` means the device did what it could, not that the world changed:
  a light bridge without feedback says so in `result` (e.g. `"acked": true`
  only means the gateway echoed the frame).
- A device answers within 10 s. A long action acks when it starts and reports
  progress through `state`.
- Malformed JSON, unknown tool or bad args: `ok: false` with an error, if a
  `rid` can be read; otherwise the message is dropped.

Callers subscribe to `home/<id>/ack` (or `home/+/ack`) **before** publishing
the command, match on `rid`, and treat 10 s of silence as "no answer". Because
QoS 0 can lose either message, a caller may resend the same command with the
same `rid` once; a device that has already handled that `rid` in the last
minute just repeats its ack instead of acting twice.

## 4. discover — who is there

Publish to `home/discover`:

```json
{ "v": 1 }
{ "v": 1, "ids": ["bedroom", "dog"] }
```

- With no `ids`, every device answers; with `ids`, only those.
- Each device answers by publishing its `caps` and then its `state` (if it has
  any), after a random delay of 0–1 s so a whole house does not answer in the
  same instant.
- A caller collects answers for 3 s. Devices that did not answer are absent.

A caller that keeps a device list (e.g. the voice brain):

1. subscribes to `home/+/caps` and `home/+/state`;
2. publishes `home/discover`;
3. keeps listening — devices that connect later announce themselves;
4. drops a device after it misses two discovers in a row, and rediscovers
   every 5 minutes or when a command gets no ack.

## 5. state — what it looks like now

Published on `home/<id>/state` when the state changes and after `caps` in
answer to a discover:

```json
{ "v": 1, "state": { "on": true }, "ts": 1793577600 }
```

- `state` — device-specific object; keys should match the tool arguments that
  set them (`on`, `mode`, `temp`, …) so a model can read it without a manual.
- `ts` — Unix seconds when it was true, if the device has a clock.
- A device with no way to know its state (a light behind a gateway without
  feedback) publishes no `state` at all rather than guessing.

## 6. Security

The broker requires a user name and password for every client and listens on
the home LAN only. There are no per-topic permissions: any logged-in client can
command any device. Do not put the broker on the internet. Remote control goes
through Loom: `loom-node exec <router> -- loom-node mqtt pub home/<id>/cmd '…'`.

## 7. Examples

Turn the bedroom lights off from the shell, fire and forget:

```sh
loom-node mqtt pub home/bedroom/cmd '{"v":1,"tool":"set","args":{"on":false}}'
```

A daily reminder from cron on the router, spoken by a speaker device:

```cron
0 22 * * * loom-node mqtt pub home/speaker/cmd '{"v":1,"tool":"say","args":{"text":"Time for bed."}}'
```

Watch everything:

```sh
loom-node mqtt sub 'home/#'
```

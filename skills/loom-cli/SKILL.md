---
name: loom-cli
description: Set up this Loom host and add the user's machines to it with `loomctl` — when they want to "加一台设备 / 加个节点 / 让我的 Mac/PC/服务器/手机 接入 Loom / 下游节点加入 / 重装 loom-node / 设备连不上", see what devices are online, rename or remove one, check that Loom is healthy ("loom 状态 / 检查一下 loom 配置"), or set the address devices join through.
---

# loom-cli: configure Loom and bring devices in

`loomctl` runs on the host Loom runs on. It talks to Loom's own API, so it
needs the Loom password once (`$LOOM_PASSWORD`, or asked for); the token is
cached in `~/.loom/cli-token` for 30 days. If `loomctl` is not on PATH, it is
`skills/loom-cli/bin/loomctl` in the Loom repo (`loomctl install` links it into
`~/.local/bin`; `rel/deploy.sh` does that too).

## Check the host first

```
loomctl status      # Loom's URL, public URL, git version, sessions working, devices online
loomctl doctor      # service, API, public URL reachable, agent CLIs, loom-node builds, login
```

`doctor` exits non-zero when something a device join depends on is missing,
and prints the fix under each ✗.

## Settings

```
loomctl config                                   # show
loomctl config set public_url https://HOST       # the address devices dial — required to add one
loomctl config set url http://127.0.0.1:4000     # the API, only if Loom is not on the default
```

`public_url` must be the address the *device* can reach (the CloudFront or
tunnel host), not `127.0.0.1`: the device keeps dialling it after it joins.
If unset, the frontend build's `VITE_NODE_JOIN_ORIGIN` is used.

## Add a device (a downstream node)

```
loomctl node add NAME [--icon linux|mac|windows|android|bot] --wait
```

It prints one line per system — `curl -fsSL …/node/install/CODE | sh` for
macOS/Linux/WSL, `irm …/ps1 | iex` for Windows PowerShell, and the two URLs
for the Android app — and with `--wait` watches until the device connects.
**The code works once and only for 2 minutes**: give the user the line for
their system as a code block, say it must be run on that machine now, and
wait. Out of time, or a machine that lost its token: `loomctl node reinstall
DEVICE --wait` makes a fresh code for the same device.

When the agent can already reach the machine (it is a device, or an AWS
instance with SSM), run the line there yourself instead of asking.

**A headless Linux server** (a cloud instance, no desktop login): loom-node
installs as a systemd *user* service, which needs a user session. Run the line
as a normal user after enabling lingering, not as root — over SSM that is:

```
loginctl enable-linger ec2-user
sudo -iu ec2-user env XDG_RUNTIME_DIR=/run/user/$(id -u ec2-user) sh -c 'curl -fsSL …/node/install/CODE | sh'
```

As root over SSM it falls back to a background process, which SSM kills when
the command ends ("Terminated"), and the device never shows up.

## Manage

```
loomctl node list [--json]          # online first: id, name, state, system, loom-node version, last seen
loomctl node wait DEVICE            # until it is online
loomctl node rename DEVICE NEW
loomctl node rm DEVICE --yes        # loom-node uninstalls itself; ask the user before removing
```

DEVICE is the id (`n_…`) or the name.

## When a device does not connect

- The device's `curl` printed HTML with **403 … Request blocked**: the CDN or
  WAF in front of Loom refuses that network (e.g. a WAF that only allows some
  countries). Say so and what would fix it — allow its country or IP, or a
  `public_url` it can reach. Changing the WAF is the user's call.
- `this install link is used up or expired`: `loomctl node reinstall DEVICE`.
- `downloading loom-node for linux-arm64` then `curl: (22) … 404`: this host
  has no build for that system. `loomctl doctor` lists what is missing and
  the `make -C node …` line that builds it (with the Go version `node/go.mod`
  needs, fetched and checksum-verified).
- Windows or Android and the device sessions view: that view needs `python3`
  on the device (macOS/Linux).
- Once online, reach it with `loom-node` (see the loom-nodes skill).

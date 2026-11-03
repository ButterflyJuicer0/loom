# Deploy

One EC2 machine. The BEAM serves HTTP itself on `127.0.0.1:4000`, and
`cloudflared` on the same machine tunnels it out. There is no nginx, and TLS is
not terminated on the box.

```
browser ─https→ Cloudflare edge ─tunnel (outbound)→ cloudflared ─http→ 127.0.0.1:4000
```

## 1. Bind to loopback

The tunnel dials out, so the security group needs no inbound rules. Set
`LOOM_BIND` only if the tunnel runs on another machine, and then restrict
ingress to that host. Whoever reaches the port gets an unsandboxed agent behind
a single password. 

## 2. `.env`

`rel/env.sh.eex` sources it on every start. It looks for `$LOOM_ENV_FILE`
first, then `.env` next to the release, then `./.env`. See
[.env.example](../.env.example) for the full list.

```sh
SECRET_KEY_BASE=   # mix phx.gen.secret; changing it logs everyone out
LOOM_PASSWORD=
PHX_SERVER=true    # without it the release serves no HTTP
```

Optional settings:

- `PORT` (default 4000)
- `LOOM_BIND` (default 127.0.0.1)
- `LOOM_HOME` (default `~/.loom`)
- `LOOM_WORKSPACE`
- `LOOM_CLAUDE_CLI` and `LOOM_CODEX_CLI`
- `LOOM_CLAUDE_FALLBACK_MODEL`: Claude Code's `--fallback-model`, for when
  the usual model is overloaded (see docs/backends.md §6.13)
- `LOOM_ONESHOT_MODEL`: the model of Loom's own one-shot calls (`haiku` by
  default; empty for the CLI's default). A refused model is retried on the
  CLI's default anyway.

No TLS settings and no model API keys are needed.

## 3. Agent CLIs

Loom makes no model requests itself. Before starting it, log in on the server:

- `claude`, or set `CLAUDE_CODE_USE_BEDROCK=1` and provide AWS credentials
- `codex login`, or set a provider in `~/.codex/config.toml`

Both must be on the service's `PATH`. Loom passes that `PATH` on to agents and
terminal shells.

Incognito sessions (architecture §2.12) run Claude Code and Kiro under
`bwrap` (`apt install bubblewrap`). Ubuntu 24.04 blocks the unprivileged user
namespace it needs unless bwrap has an AppArmor profile:

```
# /etc/apparmor.d/bwrap
abi <abi/4.0>,
include <tunables/global>
profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
```

then `sudo apparmor_parser -r /etc/apparmor.d/bwrap`. Without it an incognito
Claude Code or Kiro session fails to start ("setting up uid map: Permission
denied"); everything else is unaffected.

## 4. Build

The frontend is served by `Plug.Static` from `priv/static`, so build it before
the release:

```sh
mix assets.deploy        # pnpm install && pnpm build → priv/static
MIX_ENV=prod mix release
```

If the build step is skipped, `/` returns a 404 saying "run mix assets.deploy".

## 5. systemd

The unit is [`rel/systemd/loom.service`](../rel/systemd/loom.service). It runs as
`ubuntu` in `~/loom`, with `Restart=always` and `KillMode=process`: only the
node is stopped, so Claude Code and Kiro turns carry on and the next node takes
them back ([architecture.md §2.3](architecture.md)). Loom kills the agent
processes it means to stop itself.
After editing it:

```sh
sudo cp rel/systemd/loom.service /etc/systemd/system/
sudo systemctl daemon-reload
```

`cloudflared` runs as its own service, with ingress pointing at
`http://localhost:4000`.

## 6. Deploying Loom from inside Loom

An agent inside Loom is part of the service's process tree. A Claude Code or
Kiro agent survives the node's restart and is taken back by the next node, but
a Codex one does not. Use `rel/deploy.sh` instead of restarting by hand:

1. It builds into `_build/prod/rel/loom.next` and leaves the running release
   alone.
2. It calls `Loom.Restarter.request()`. Once no Codex turn is running, the
   node stops. Claude Code and Kiro turns don't hold it up, including the one
   that asked; they carry on through the restart.
3. systemd restarts it, and `promote-next.sh` in `ExecStartPre` swaps in
   `loom.next`. The old release is kept as `loom.prev`.

`rel/deploy.sh --build` only builds. A restart request that hasn't fired after
10 minutes is dropped. There is no automatic rollback: after 5 failed starts
systemd gives up, and you move `loom.prev` back by hand.

A frontend-only change needs no restart. Copy `frontend/dist` into the running
release's `lib/loom-*/priv/static`.

## 7. Limits

- Cloudflare caps request bodies at 100 MB. Attachments are capped at 25 MB
  per file. A 413 from Cloudflare never shows up in Loom's logs.
- Phoenix's 30 s heartbeat keeps WebSockets under Cloudflare's idle timeout.

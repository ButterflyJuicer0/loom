#!/bin/sh
# Build a release into _build/prod/rel/loom.next, then ask the running node to
# restart into it once every agent session is idle (Loom.Restarter). systemd
# brings it back up and promote-next.sh swaps loom.next into place on the way.
#
#   rel/deploy.sh             build, then request the restart
#   rel/deploy.sh --build     build only
#
# Safe to run from inside loom: the build never touches the running release,
# and the restart waits for the turn that ran this script to finish.
set -eu
cd "$(dirname "$0")/.."

export MIX_ENV=prod
# Inherited from loom's own .env when run from a loom shell; would make the
# build try to start a server.
unset PHX_SERVER
# An agent's shell may not have corepack's pnpm on PATH.
command -v pnpm >/dev/null 2>&1 || PATH=/usr/lib/node_modules/corepack/shims:$PATH
# Where the release is staged; rel/ship.sh builds in a worktree and points this
# at the live checkout's.
next="${LOOM_NEXT:-_build/prod/rel/loom.next}"

mix deps.get --only prod
mix assets.deploy

# loom-node: the binaries devices download (into priv/, so the release carries
# them), the CLI agents call here, and the skill that tells them how. A host
# without Go still deploys; it just cannot hand out devices.
if command -v go >/dev/null 2>&1; then
  make -C node -j4
  # The Android app (one APK, no Termux), served at GET /node/app/:code. Needs a
  # JDK + Android SDK + host-arch aapt2/zipalign; a host without them still
  # deploys, Android devices just won't get the app.
  if command -v aapt2 >/dev/null 2>&1 && [ -x node/android/build.sh ]; then
    # Same join origin the frontend bakes in, so the app accepts a bare code.
    LOOM_JOIN_ORIGIN=$(sed -n 's/^VITE_NODE_JOIN_ORIGIN=//p' frontend/.env.production.local 2>/dev/null) \
      sh node/android/build.sh && cp node/android/build/loom-node.apk priv/node/loom-node.apk
  else
    echo "deploy: no Android build toolchain; skipping the Android app" >&2
  fi
  case "$(uname -m)" in aarch64|arm64) arch=arm64 ;; *) arch=amd64 ;; esac
  mkdir -p "$HOME/.local/bin"
  # Renamed into place, so a CLI call already running keeps its binary.
  cp "priv/node/loom-node-linux-$arch" "$HOME/.local/bin/.loom-node.new"
  mv "$HOME/.local/bin/.loom-node.new" "$HOME/.local/bin/loom-node"
  for skills in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
    mkdir -p "$skills/loom-nodes"
    cp node/SKILL.md "$skills/loom-nodes/SKILL.md"
  done
else
  echo "deploy: no Go toolchain; skipping loom-node (devices cannot be installed from this host)" >&2
fi

# Skills that are not tied to loom-node, for both backends.
for skills in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
  for skill in skills/*/; do
    mkdir -p "$skills/$(basename "$skill")"
    # A skill linked into the repo is already the file itself.
    [ "$skill"SKILL.md -ef "$skills/$(basename "$skill")/SKILL.md" ] ||
      cp "$skill"SKILL.md "$skills/$(basename "$skill")/SKILL.md"
  done
done

# loom-notice: what agents post to the bell with (the loom-notify skill);
# loom-session: what they tidy sessions with (the loom-tidy skill);
# loom-guard: the hook that keeps an employee on its workstation.
mkdir -p "$HOME/.local/bin"
for cli in loom-notice loom-session loom-guard; do
  cp "rel/$cli" "$HOME/.local/bin/.$cli.new"
  mv "$HOME/.local/bin/.$cli.new" "$HOME/.local/bin/$cli"
done
# A skill's own CLIs (skills/<name>/bin/*), e.g. loomctl from loom-cli.
for cli in skills/*/bin/*; do
  [ -f "$cli" ] || continue
  cp "$cli" "$HOME/.local/bin/.$(basename "$cli").new"
  chmod +x "$HOME/.local/bin/.$(basename "$cli").new"
  mv "$HOME/.local/bin/.$(basename "$cli").new" "$HOME/.local/bin/$(basename "$cli")"
done

mix release --path "$next" --overwrite

if [ "${1:-}" = "--build" ]; then
  echo "built $next; not restarting"
  exit 0
fi

_build/prod/rel/loom/bin/loom rpc 'IO.inspect(Loom.Restarter.request())'

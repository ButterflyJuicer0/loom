#!/bin/sh
# Deploy a commit, never a working tree, and never one that would take back
# what is already live. What is live is the ref refs/deploy/live; its reflog
# (`git reflog refs/deploy/live`) is the history of deploys.
#
#   rel/ship.sh [REV]              full release + restart (rel/deploy.sh)
#   rel/ship.sh --frontend [REV]   swap the built frontend in, no restart
#   rel/ship.sh --force ...        allow REV not to contain live (a rollback)
#   rel/ship.sh --yes ...          ship the commits listed since live
#
# Without --yes it only lists the commits between live and REV and stops:
# dev carries other sessions' work, some of it the user said not to ship
# yet. Show the list to the user, and re-run with --yes once they agree.
#
# REV defaults to dev. Several sessions deploy from this checkout; one that
# built from an older tree used to undo another's deploy unnoticed.
set -eu
cd "$(dirname "$0")/.."
repo=$(pwd)

mode=full force= yes=
while [ $# -gt 0 ]; do
  case "$1" in
    --frontend) mode=frontend ;;
    --force) force=1 ;;
    --yes) yes=1 ;;
    *) break ;;
  esac
  shift
done
rev=$(git rev-parse --verify "${1:-dev}^{commit}")
live=$(git rev-parse -q --verify refs/deploy/live || true)

if [ -n "$live" ] && [ -z "$force" ] && ! git merge-base --is-ancestor "$live" "$rev"; then
  echo "ship: $(git log -1 --format='%h %s' "$live") is live and not in $(git rev-parse --short "$rev")." >&2
  echo "ship: rebase onto it (or merge), or pass --force to roll back." >&2
  exit 1
fi
if [ "$mode" = frontend ] && [ -n "$live" ] &&
   git diff --name-only "$live" "$rev" -- . ':!frontend' ':!docs' ':!*.md' | grep -q .; then
  echo "ship: changes outside frontend/ since live; a frontend swap would not ship them:" >&2
  git diff --name-only "$live" "$rev" -- . ':!frontend' ':!docs' ':!*.md' | sed 's/^/  /' >&2
  exit 1
fi

if [ -z "$yes" ]; then
  echo "ship: these commits would go live ($mode):"
  if [ -n "$live" ]; then git log --no-merges --format='  %h %ar  %s' "$live..$rev"
  else git log -1 --format='  %h %s' "$rev"; fi
  echo "ship: nothing shipped. Check with the user, then re-run with --yes."
  exit 2
fi

wt=$(mktemp -d /tmp/loom-ship-XXXXXX)
trap 'git -C "$repo" worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt"' EXIT
git worktree add -q --detach "$wt" "$rev"
ln -s "$repo/frontend/node_modules" "$wt/frontend/node_modules"
command -v pnpm >/dev/null 2>&1 || PATH=/usr/lib/node_modules/corepack/shims:$PATH

if [ "$mode" = frontend ]; then
  (cd "$wt/frontend" && pnpm build)
  # The running release, and a staged one so the next restart keeps it.
  for static in "$repo"/_build/prod/rel/loom/lib/loom-*/priv/static \
                "$repo"/_build/prod/rel/loom.next/lib/loom-*/priv/static; do
    [ -d "$static" ] || continue
    rm -rf "$static/assets" "$static/fonts" "$static/vendor" "$static/index.html"
    cp -R "$wt/frontend/dist/." "$static/"
  done
else
  ln -s "$repo/deps" "$wt/deps"
  mkdir -p "$wt/_build"
  cp -R "$repo/_build/prod" "$wt/_build/prod"
  rm -rf "$wt/_build/prod/lib/loom" "$wt/_build/prod/rel"
  (cd "$wt" && LOOM_NEXT="$repo/_build/prod/rel/loom.next" rel/deploy.sh --build)
fi

git update-ref -m "ship $mode" --create-reflog refs/deploy/live "$rev"
echo "ship: live is $(git log -1 --format='%h %s' "$rev") ($mode)"

[ "$mode" = full ] && "$repo/_build/prod/rel/loom/bin/loom" rpc 'IO.inspect(Loom.Restarter.request())'
exit 0

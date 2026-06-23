#!/usr/bin/env bash
#
# deploy-ec2.sh — one-shot, FAIL-FAST deploy of TaxFlow Assistant to the EC2 box.
#
# Why this exists (2026-06-22): an ad-hoc deploy piped the api-server build
# through `| tail`, which MASKED the build's non-zero exit, so a transient build
# failure didn't stop the script — it went on to `pm2 restart` a STALE dist and
# briefly served the old build. This script makes that impossible:
#   * `set -euo pipefail` + a build that runs UNPIPED → a build failure aborts.
#   * the api-server is built and TYPECHECKED **before** the restart; if either
#     fails the running process is left UNTOUCHED (no stale-dist restart). NOTE:
#     this gates BUILD/TYPECHECK failures only — a build that succeeds but CRASHES
#     ON BOOT (a runtime error tsc can't catch) restarts onto the broken dist;
#     the health gate then aborts the deploy non-zero, but prod is left on the
#     broken build with NO automatic rollback (migrations are additive, so the
#     old code stays forward-compatible — restore via the prior SHA + rebuild +
#     restart). Auto-rollback on a failed health check is a tracked follow-up.
#   * the restart is GATED on a post-restart health check; a failure exits non-zero.
#   * the frontend is built LOCALLY (the 908 MiB box OOMs on Vite) and rsynced.
#
# Usage:   ./deploy-ec2.sh
# Env overrides (sane defaults below):
#   SSH_KEY   path to the PEM         (default ~/Downloads/taxflow-key.pem)
#   EC2_HOST  ubuntu@<dns>            (default the prod box)
#   REMOTE_DIR project dir on the box (default ~/taxflow-pro)
#   SKIP_FRONTEND=1  to deploy api-server only (no Vite build / rsync)

set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/Downloads/taxflow-key.pem}"
EC2_HOST="${EC2_HOST:-ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com}"
# Relative to the remote $HOME (the non-interactive ssh shell lands there) —
# avoids tilde-through-ssh expansion pitfalls.
REMOTE_DIR="${REMOTE_DIR:-taxflow-pro}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$EC2_HOST")

echo "==> deploy-ec2: host=$EC2_HOST dir=$REMOTE_DIR"

# 1) Build the frontend LOCALLY first (the box can't — Vite OOMs at 908 MiB).
#    Doing it before touching prod means a frontend build break aborts BEFORE
#    any remote change.
if [[ "${SKIP_FRONTEND:-}" != "1" ]]; then
  echo "==> [local] building frontend (Vite)"
  ( cd "$REPO_ROOT" && pnpm --filter @workspace/tax-app run build )
fi

# 2) Remote api-server deploy — pull, install, migrate, TYPECHECK, BUILD, and
#    ONLY THEN restart. Every step is fail-fast (set -e) and UNPIPED so a
#    non-zero exit propagates. The restart is unreachable if the build fails.
echo "==> [remote] api-server: pull -> install -> migrate -> typecheck -> build -> restart"
"${SSH[@]}" REMOTE_DIR="$REMOTE_DIR" 'bash -se' <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

# pnpm-lock.yaml conflicts on every pull (catalog churn) — discard the local copy.
git checkout -- pnpm-lock.yaml 2>/dev/null || true
git pull origin main
pnpm install

# Credentials live in the pm2 process env, not a .env file.
DATABASE_URL="$(pm2 env 0 | awk -F': ' '/^DATABASE_URL:/ {print $2; exit}')"
AI_API_KEY="$(pm2 env 0 | awk -F': ' '/^AI_API_KEY:/ {print $2; exit}')"
export DATABASE_URL AI_API_KEY

# Apply any pending versioned migrations (no-op when there are none).
pnpm --filter @workspace/db run migrate

# Gate the restart on a clean build: typecheck THEN build, both UNPIPED so a
# failure aborts here — the running pm2 process keeps its last-good dist.
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run build

pm2 restart taxflow
sleep 3
echo "--- post-restart health ---"
curl -fsS http://localhost:8080/api/healthz
echo
REMOTE

# 3) Frontend rsync (after the api-server is confirmed healthy above; the
#    api-server serves these static files directly).
if [[ "${SKIP_FRONTEND:-}" != "1" ]]; then
  echo "==> [local] rsync frontend dist -> prod"
  rsync -e "ssh -i $SSH_KEY -o ConnectTimeout=20" -avz --delete \
    "$REPO_ROOT/artifacts/tax-app/dist/public/" \
    "$EC2_HOST:$REMOTE_DIR/artifacts/tax-app/dist/public/"
fi

# 4) Final public health gate (from the deploy host, not inside EC2 — AWS drops
#    the loopback to the public DNS from inside the box).
PUBLIC_URL="${PUBLIC_URL:-http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com}"
echo "==> [local] public health check: $PUBLIC_URL/api/healthz"
curl -fsS --max-time 15 "$PUBLIC_URL/api/healthz"
echo
echo "==> deploy-ec2: DONE (api-server healthy; frontend rsynced)."

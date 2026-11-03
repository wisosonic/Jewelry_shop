#!/usr/bin/env bash
# One-shot dev environment setup for Naya Sophia Jewelry:
# installs dependencies, prepares server/.env, migrates + seeds the SQLite
# database, then starts both dev servers. Safe to re-run (every step is
# idempotent) - use it for first-time setup or to get back to a running
# state after a clean checkout.
#
# Usage: ./setup.sh   (or: bash setup.sh)
# Stop both servers with Ctrl+C.

set -euo pipefail
# Job control, off by default in non-interactive scripts, is needed so each
# `&` background job below gets its own process group - without it, `kill`
# on a job's PID only kills npm's own wrapper process, leaving the actual
# tsx/vite node process (npm's child) running.
set -m

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (v20+) but was not found on PATH." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found on PATH." >&2
  exit 1
fi

echo "==> Installing dependencies (client + server workspaces)"
# --no-audit skips a bulk vulnerability-advisory network call that has been
# observed to hang indefinitely (npm connects fine but the request never
# completes) on some networks - see CLAUDE.md. Run `npm audit` manually
# afterward if you want a security check.
npm install --no-audit --no-fund

if [ ! -f server/.env ]; then
  echo "==> Creating server/.env from server/.env.example"
  cp server/.env.example server/.env
  echo "    Edit server/.env to set a real METALS_API_KEY (https://metals.dev) and"
  echo "    JWT secrets before relying on live metal prices or a real deployment."
else
  echo "==> server/.env already exists, leaving it as-is"
fi

echo "==> Generating Prisma client and applying database migrations"
npm run --workspace server prisma:generate
(cd server && npx prisma migrate deploy)

echo "==> Seeding the database (admin + customer users, settings, sample products)"
npm run seed

echo ""
echo "==> Starting the API server"

cleanup() {
  echo ""
  echo "Stopping dev servers..."
  # Kill each job's whole process group (negative PID) so npm's actual
  # tsx/vite child process dies too, not just npm's wrapper process.
  # Falls back to a plain kill if process groups aren't supported. Safe to
  # call even if CLIENT_PID isn't set yet (e.g. the API never became
  # ready) - kill still signals SERVER_PID and just errors harmlessly on
  # the empty second operand, suppressed below.
  kill -- "-$SERVER_PID" "-${CLIENT_PID:-}" 2>/dev/null || kill "$SERVER_PID" "${CLIENT_PID:-}" 2>/dev/null || true
  # On Windows, tsx/vite can still leave a child node.exe behind (see
  # CLAUDE.md's "Windows dev quirk"). If restarting this script reports
  # EADDRINUSE, run in PowerShell:
  #   Get-Process node | Stop-Process -Force
}
trap cleanup EXIT INT TERM

npm run dev:server &
SERVER_PID=$!

# The client's Vite dev server proxies /api, /uploads, and /socket.io to
# the API - if it starts (and the browser opens) before the API is
# actually accepting connections, the very first requests (notably the
# Socket.IO client's connection attempt on page load) fail with a proxy
# ECONNREFUSED. Vite itself boots in well under a second while the API
# takes a few seconds longer (loading env, connecting Prisma), so polling
# GET /api/health (mounted before auth/CORS - no credentials needed) until
# it responds, before starting the client at all, closes that race.
echo "==> Waiting for the API to be ready..."
MAX_WAIT_SECONDS=30
API_READY=false
for ((i = 0; i < MAX_WAIT_SECONDS; i++)); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "The API server exited before becoming ready. Check the output above for what went wrong." >&2
    exit 1
  fi
  if curl -sf -o /dev/null http://localhost:4000/api/health; then
    API_READY=true
    break
  fi
  sleep 1
done

if [ "$API_READY" != true ]; then
  echo "The API did not become ready within ${MAX_WAIT_SECONDS}s. Check the output above for what went wrong." >&2
  exit 1
fi

echo "==> API is ready - starting the client"
echo "    API:    http://localhost:4000"
echo "    Client: http://localhost:5173"
echo "    Seeded admin login:    admin@nayasofia.com / Admin1234!"
echo "    Seeded customer login: customer@nayasofia.com / Customer123!"
echo "    Press Ctrl+C to stop both servers."
echo ""

npm run dev:client &
CLIENT_PID=$!

wait

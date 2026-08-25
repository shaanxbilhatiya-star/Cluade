#!/usr/bin/env bash
# Start the CineFlex movie booking server.
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "  ================================================"
echo "   CineFlex - Movie Ticket Booking System"
echo "  ================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  [X] Node.js was not found."
  echo ""
  echo "  Install it from https://nodejs.org (version 18 or newer), then run this script again."
  echo ""
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  [X] Node.js 18 or newer is required (found $(node -v))."
  exit 1
fi

PORT="${PORT:-3000}"
echo "  Customer app :  http://localhost:${PORT}/"
echo "  Admin panel  :  http://localhost:${PORT}/admin/"
echo ""
echo "  Press Ctrl+C to stop the server."
echo ""

# Open a browser if we can, without failing when there is no desktop session.
if command -v xdg-open >/dev/null 2>&1; then
  (sleep 1.5 && xdg-open "http://localhost:${PORT}/" >/dev/null 2>&1 || true) &
elif command -v open >/dev/null 2>&1; then
  (sleep 1.5 && open "http://localhost:${PORT}/" >/dev/null 2>&1 || true) &
fi

exec node server.js

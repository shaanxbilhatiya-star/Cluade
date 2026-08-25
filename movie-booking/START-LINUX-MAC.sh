#!/bin/bash
echo "===================================="
echo "  CineBook - Movie Booking System"
echo "===================================="
echo ""
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo "Installing dependencies..."
npm install
echo ""
echo " User Portal  ->  http://localhost:3000"
echo " Admin Panel  ->  http://localhost:3000/admin"
echo ""
# Try to open browser
if command -v xdg-open &> /dev/null; then
  xdg-open http://localhost:3000
elif command -v open &> /dev/null; then
  open http://localhost:3000
fi
node server.js

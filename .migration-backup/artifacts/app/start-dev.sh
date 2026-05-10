#!/usr/bin/env bash
# Start only the Vite frontend — the API server has its own dedicated workflow
PORT=${PORT:-23863} BASE_PATH=${BASE_PATH:-/} pnpm --filter @workspace/app run dev:watch

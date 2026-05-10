#!/usr/bin/env bash
# Start both the API server and the Vite frontend in parallel
pnpm --filter @workspace/api-server run dev &
API_PID=$!

PORT=${PORT:-23863} BASE_PATH=${BASE_PATH:-/} pnpm --filter @workspace/app run dev:watch

wait $API_PID

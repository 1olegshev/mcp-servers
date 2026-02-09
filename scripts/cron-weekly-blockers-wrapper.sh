#!/bin/bash

# Cron/Launchd Wrapper for Weekly Blockers Report
# Runs on Fridays at 14:00 CET (local time)
# This script ensures proper environment for running the Node.js script
# Designed to work even when Mac is locked/sleeping

# Set comprehensive PATH to include Node.js and system binaries
export PATH="/Users/olegshevchenko/.nvm/versions/node/v22.9.0/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Set required environment variables for cron
export HOME="/Users/olegshevchenko"
export USER="olegshevchenko"
export NODE_ENV=production

# Change to MCP directory
cd /Users/olegshevchenko/Sourses/MCP || {
    echo "$(date): ERROR - Could not change to MCP directory" >> logs/cron-weekly-blockers.log
    exit 1
}

# Log start with system info and wake status
echo "$(date): Starting weekly blockers report job (PID: $$, User: $(whoami))" >> logs/cron-weekly-blockers.log
echo "$(date): System wake status: $(pmset -g | grep 'System-wide power settings')" >> logs/cron-weekly-blockers.log

# Try to prevent system sleep during execution
caffeinate -i -t 300 &  # Prevent idle sleep for 5 minutes
CAFFEINATE_PID=$!

# Verify Node.js is available
if ! command -v node >/dev/null 2>&1; then
    echo "$(date): ERROR - Node.js not found in PATH" >> logs/cron-weekly-blockers.log
    exit 1
fi

# Check LM Studio server health (LM Studio runs as always-on service)
if curl -s --max-time 5 http://localhost:1234/v1/models | grep -q '"data"'; then
    echo "$(date): LM Studio server is running" >> logs/cron-weekly-blockers.log

    # Pre-warm the model (JIT loading means first request loads model into memory)
    echo "$(date): Pre-warming LLM model..." >> logs/cron-weekly-blockers.log
    WARMUP_RESPONSE=$(curl -s --max-time 120 http://localhost:1234/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d '{"messages": [{"role": "user", "content": "Reply with just: ready"}], "max_tokens": 10, "stream": false}' 2>&1)
    if echo "$WARMUP_RESPONSE" | grep -q '"choices"'; then
        echo "$(date): Model pre-warmed successfully" >> logs/cron-weekly-blockers.log
    else
        echo "$(date): Model pre-warm failed (will use regex fallback)" >> logs/cron-weekly-blockers.log
    fi
else
    echo "$(date): WARNING - LM Studio server not responding, will use regex fallback" >> logs/cron-weekly-blockers.log
fi

# Run the Node.js script
node scripts/weekly-blockers-auto.mjs >> logs/cron-weekly-blockers.log 2>&1
EXIT_CODE=$?

# Log completion with exit code
echo "$(date): Weekly blockers job completed with exit code $EXIT_CODE" >> logs/cron-weekly-blockers.log

# Clean up caffeinate
kill $CAFFEINATE_PID 2>/dev/null

exit $EXIT_CODE

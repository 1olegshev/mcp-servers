#!/bin/bash

# Cron/Launchd Wrapper for Release Status Automation
# This script ensures proper environment for running the Node.js script
# Designed to work even when Mac is locked/sleeping
#
# DST-aware scheduling:
# - Winter (CET, UTC+1): runs at 11:15 local
# - Summer (CEST, UTC+2): runs at 12:15 local
# This keeps the job at 10:15 UTC = 18:15 Philippines time year-round

# Set comprehensive PATH to include Node.js and system binaries
export PATH="/Users/olegshevchenko/.nvm/versions/node/v22.9.0/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Set required environment variables for cron
export HOME="/Users/olegshevchenko"
export USER="olegshevchenko"
export NODE_ENV=production

# Change to MCP directory
cd /Users/olegshevchenko/Sourses/MCP || {
    echo "$(date): ERROR - Could not change to MCP directory" >> logs/cron-auto-release.log
    exit 1
}

# DST-aware execution to always run at 10:15 UTC (18:15 Philippines)
# CET (winter, UTC+1) = run at 11:15 local
# CEST (summer, UTC+2) = run at 12:15 local
#
# Since pmset only supports one wake time (11:10), in summer we:
# 1. Wake at 11:10, trigger at 11:15
# 2. Wait until 12:15 (using caffeinate to prevent sleep)
# 3. Then execute the job

CURRENT_HOUR=$(date +%H)
UTC_OFFSET=$(date +%z | sed 's/00$//' | sed 's/^+//' | sed 's/^0//')  # e.g., +0100 -> 1, +0200 -> 2

# If triggered at 12:15 in winter, skip (shouldn't happen often, but be safe)
if [ "$UTC_OFFSET" = "1" ] && [ "$CURRENT_HOUR" = "12" ]; then
    echo "$(date): Skipping - winter time (UTC+1) but triggered at 12:xx" >> logs/cron-auto-release.log
    exit 0
fi

# If it's summer (UTC+2) and we're triggered at 11:xx, wait until 12:15
if [ "$UTC_OFFSET" = "2" ] && [ "$CURRENT_HOUR" = "11" ]; then
    echo "$(date): Summer time (UTC+2) - waiting until 12:15 to match Philippines schedule" >> logs/cron-auto-release.log
    # Calculate seconds until 12:15
    TARGET_TIME=$(date -v12H -v15M -v0S +%s)
    NOW=$(date +%s)
    WAIT_SECONDS=$((TARGET_TIME - NOW))
    if [ "$WAIT_SECONDS" -gt 0 ] && [ "$WAIT_SECONDS" -lt 7200 ]; then
        echo "$(date): Waiting ${WAIT_SECONDS} seconds (until 12:15)..." >> logs/cron-auto-release.log
        # Use caffeinate to prevent sleep while waiting
        caffeinate -i sleep "$WAIT_SECONDS"
        echo "$(date): Wait complete, proceeding with job" >> logs/cron-auto-release.log
    fi
fi

# If triggered at 12:xx in summer, proceed (this is the intended time)
# If triggered at 11:xx in winter, proceed (this is the intended time)

# Log start with system info and wake status
echo "$(date): Starting cron release status job (PID: $$, User: $(whoami))" >> logs/cron-auto-release.log
echo "$(date): System wake status: $(pmset -g | grep 'System-wide power settings')" >> logs/cron-auto-release.log

# Try to prevent system sleep during execution (increased for model pre-warming)
caffeinate -i -t 600 &  # Prevent idle sleep for 10 minutes
CAFFEINATE_PID=$!

# Verify Node.js is available
if ! command -v node >/dev/null 2>&1; then
    echo "$(date): ERROR - Node.js not found in PATH" >> logs/cron-auto-release.log
    exit 1
fi

# Start LM Studio server for LLM-based blocker classification (if available)
LMS_STARTED=false
if command -v lms >/dev/null 2>&1; then
    # Check if LM Studio server is already running
    if ! curl -s http://localhost:1234/v1/models >/dev/null 2>&1; then
        echo "$(date): Starting LM Studio server for LLM classification..." >> logs/cron-auto-release.log
        lms server start >> logs/lms-cron.log 2>&1
        LMS_STARTED=true

        # Wait for LM Studio server to be ready (max 30 seconds)
        for i in {1..30}; do
            if curl -s http://localhost:1234/v1/models >/dev/null 2>&1; then
                echo "$(date): LM Studio server ready after ${i}s" >> logs/cron-auto-release.log
                break
            fi
            sleep 1
        done
    else
        echo "$(date): LM Studio server already running" >> logs/cron-auto-release.log
    fi

    # Pre-warm the model (loads it into memory before the actual report runs)
    echo "$(date): Pre-warming LLM model..." >> logs/cron-auto-release.log
    WARMUP_START=$(date +%s)
    WARMUP_RESPONSE=$(curl -s --max-time 120 http://localhost:1234/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d '{"messages": [{"role": "user", "content": "Reply with just: ready"}], "max_tokens": 10, "stream": false}' 2>&1)
    WARMUP_END=$(date +%s)
    WARMUP_DURATION=$((WARMUP_END - WARMUP_START))

    if echo "$WARMUP_RESPONSE" | grep -q '"choices"'; then
        echo "$(date): Model pre-warmed successfully in ${WARMUP_DURATION}s" >> logs/cron-auto-release.log
    else
        echo "$(date): Model pre-warm failed after ${WARMUP_DURATION}s (will use regex fallback): $WARMUP_RESPONSE" >> logs/cron-auto-release.log
    fi
else
    echo "$(date): LM Studio CLI not installed, using regex-only detection" >> logs/cron-auto-release.log
fi

# Run the Node.js script
node scripts/release-status-auto.mjs >> logs/cron-auto-release.log 2>&1
EXIT_CODE=$?

# Stop LM Studio server if we started it (save resources when sleeping)
if [ "$LMS_STARTED" = true ]; then
    echo "$(date): Stopping LM Studio server" >> logs/cron-auto-release.log
    lms server stop >> logs/lms-cron.log 2>&1
fi

# Log completion with exit code
echo "$(date): Cron job completed with exit code $EXIT_CODE" >> logs/cron-auto-release.log

# Clean up caffeinate
kill $CAFFEINATE_PID 2>/dev/null

exit $EXIT_CODE
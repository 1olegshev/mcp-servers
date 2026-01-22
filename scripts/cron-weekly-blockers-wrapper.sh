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

# Start Ollama for LLM-based classification (if available)
OLLAMA_STARTED=false
if command -v ollama >/dev/null 2>&1; then
    # Check if Ollama is already running
    if ! pgrep -x "ollama" >/dev/null 2>&1; then
        echo "$(date): Starting Ollama for LLM classification..." >> logs/cron-weekly-blockers.log
        ollama serve >> logs/ollama-cron.log 2>&1 &
        OLLAMA_PID=$!
        OLLAMA_STARTED=true

        # Wait for Ollama to be ready (max 30 seconds)
        for i in {1..30}; do
            if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
                echo "$(date): Ollama ready after ${i}s" >> logs/cron-weekly-blockers.log
                break
            fi
            sleep 1
        done
    else
        echo "$(date): Ollama already running" >> logs/cron-weekly-blockers.log
    fi
else
    echo "$(date): Ollama not installed, using regex-only detection" >> logs/cron-weekly-blockers.log
fi

# Run the Node.js script
node scripts/weekly-blockers-auto.mjs >> logs/cron-weekly-blockers.log 2>&1
EXIT_CODE=$?

# Stop Ollama if we started it (save resources when sleeping)
if [ "$OLLAMA_STARTED" = true ] && [ -n "$OLLAMA_PID" ]; then
    echo "$(date): Stopping Ollama (PID: $OLLAMA_PID)" >> logs/cron-weekly-blockers.log
    kill $OLLAMA_PID 2>/dev/null
fi

# Log completion with exit code
echo "$(date): Weekly blockers job completed with exit code $EXIT_CODE" >> logs/cron-weekly-blockers.log

# Clean up caffeinate
kill $CAFFEINATE_PID 2>/dev/null

exit $EXIT_CODE

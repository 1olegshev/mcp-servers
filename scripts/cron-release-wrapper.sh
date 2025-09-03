#!/bin/bash

# Cron Wrapper for Release Status Automation
# This script ensures proper environment for running the Node.js script from cron
# Designed to work even when Mac is locked/sleeping

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

# Log start with system info and wake status
echo "$(date): Starting cron release status job (PID: $$, User: $(whoami))" >> logs/cron-auto-release.log
echo "$(date): System wake status: $(pmset -g | grep 'System-wide power settings')" >> logs/cron-auto-release.log

# Try to prevent system sleep during execution
caffeinate -i -t 300 &  # Prevent idle sleep for 5 minutes
CAFFEINATE_PID=$!

# Verify Node.js is available
if ! command -v node >/dev/null 2>&1; then
    echo "$(date): ERROR - Node.js not found in PATH" >> logs/cron-auto-release.log
    exit 1
fi

# Run the Node.js script
node scripts/release-status-auto.mjs >> logs/cron-auto-release.log 2>&1
EXIT_CODE=$?

# Log completion with exit code
echo "$(date): Cron job completed with exit code $EXIT_CODE" >> logs/cron-auto-release.log

# Clean up caffeinate
kill $CAFFEINATE_PID 2>/dev/null

exit $EXIT_CODE
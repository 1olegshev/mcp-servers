#!/bin/bash

# Caffeinate Script - Prevents Mac from sleeping during business hours
# Run this at startup or add to login items

CURRENT_HOUR=$(date +%H)
CURRENT_DAY=$(date +%u) # 1-7, Monday is 1

# Only stay awake on weekdays (1-5) during business hours (8-18)
if [[ $CURRENT_DAY -le 5 ]] && [[ $CURRENT_HOUR -ge 8 ]] && [[ $CURRENT_HOUR -lt 18 ]]; then
    echo "$(date): Preventing sleep during business hours"
    # Keep system awake (but allow display sleep)
    caffeinate -s &
    echo $! > /tmp/caffeinate.pid
else
    # Kill caffeinate if running outside business hours
    if [[ -f /tmp/caffeinate.pid ]]; then
        kill "$(cat /tmp/caffeinate.pid)" 2>/dev/null
        rm /tmp/caffeinate.pid
    fi
fi
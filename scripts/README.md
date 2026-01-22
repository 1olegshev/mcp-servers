# MCP Release Status Automation

This directory contains the automated release status reporting system for the MCP (Model Context Protocol) project.

> See root [README.md](../README.md) for project overview and server documentation links.

## Files

### `release-status-auto.mjs`
The main Node.js script that:
- Builds all MCP servers
- Calls the release coordinator to generate a comprehensive release overview
- Posts the status to Slack (#qa-release-status channel)
- Logs all activities with timestamps

### `cron-release-wrapper.sh`
Bash wrapper script for launchd/cron execution that:
- Sets up the proper Node.js environment (PATH, NODE_ENV)
- Changes to the correct working directory
- Handles DST-aware scheduling (runs at consistent UTC time year-round)
- Redirects output to log files
- Handles exit codes properly

## Scheduling

The system uses macOS `launchd` with `pmset` wake scheduling to run even when the Mac is asleep.

### Schedule Details
- **Target time:** 10:15 UTC (18:15 Philippines time) - consistent year-round
- **Winter (CET, UTC+1):** runs at 11:15 local time
- **Summer (CEST, UTC+2):** runs at 12:15 local time

This ensures the report is always sent at the same time relative to colleagues in Philippines (no DST).

### Setup Components

1. **launchd plist:** `~/Library/LaunchAgents/com.mcp.release-status.plist`
   - Triggers at both 11:15 and 12:15 on weekdays
   - Script checks DST and runs at appropriate time

2. **pmset wake schedule:** Wakes Mac at 11:10 on weekdays
   ```bash
   sudo pmset repeat wakeorpoweron MTWRF 11:10:00
   ```

### View current setup:
```bash
# Check launchd job
launchctl list | grep com.mcp.release-status

# Check wake schedule
pmset -g sched
```

### Reload launchd job:
```bash
launchctl bootout gui/$(id -u)/com.mcp.release-status
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mcp.release-status.plist
```

### Remove scheduling:
```bash
# Remove launchd job
launchctl bootout gui/$(id -u)/com.mcp.release-status
rm ~/Library/LaunchAgents/com.mcp.release-status.plist

# Remove wake schedule
sudo pmset repeat cancel
```

## Logs

All execution logs are stored in:
- `./logs/cron-auto-release.log` (relative to project root)

## Manual Testing

To test the automation manually:
```bash
# Direct Node.js execution (from project root)
node scripts/release-status-auto.mjs

# Via cron wrapper (simulates cron environment)
./scripts/cron-release-wrapper.sh
```

## Troubleshooting

### Common Issues:
1. **Node.js not found**: Ensure the Node.js path in the wrapper script matches your installation
2. **Permission denied**: Make sure the wrapper script is executable (`chmod +x`)
3. **MCP servers not built**: The script automatically builds servers before execution
4. **Slack posting fails**: Check Slack tokens in the MCP configuration

### Check logs:
```bash
# From project root
tail -f ./logs/cron-auto-release.log
```

## Success Indicators

A successful run will show:
- ✅ MCP servers built successfully
- ✅ Release status report completed successfully
- ✅ Successfully posted to Slack
- Exit code: 0

## Environment Requirements

- Node.js v22.9.0 (or compatible)
- Built MCP servers (confluence, jira, slack, release-coordinator)
- Valid Slack authentication tokens
- Jira API access
- Confluence API access
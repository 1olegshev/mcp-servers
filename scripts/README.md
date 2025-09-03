# MCP Release Status Automation

This directory contains the automated release status reporting system for the MCP (Model Context Protocol) project.

## Files

### `release-status-auto.mjs`
The main Node.js script that:
- Builds all MCP servers
- Calls the release coordinator to generate a comprehensive release overview
- Posts the status to Slack (#qa-release-status channel)
- Logs all activities with timestamps

### `cron-release-wrapper.sh`
Bash wrapper script for cron execution that:
- Sets up the proper Node.js environment (PATH, NODE_ENV)
- Changes to the correct working directory
- Redirects output to log files
- Handles exit codes properly

## Scheduling

The system is scheduled to run via cron:
```bash
# Current schedule: Every weekday at 12:05 PM
5 12 * * 1-5 /Users/olegshevchenko/Sourses/MCP/scripts/cron-release-wrapper.sh
```

### View current cron jobs:
```bash
crontab -l
```

### Edit cron jobs:
```bash
crontab -e
```

### Remove all cron jobs:
```bash
crontab -r
```

## Logs

All execution logs are stored in:
- `/Users/olegshevchenko/Sourses/MCP/logs/cron-auto-release.log`

## Manual Testing

To test the automation manually:
```bash
# Direct Node.js execution
cd /Users/olegshevchenko/Sourses/MCP
node scripts/release-status-auto.mjs

# Via cron wrapper (simulates cron environment)
/Users/olegshevchenko/Sourses/MCP/scripts/cron-release-wrapper.sh
```

## Troubleshooting

### Common Issues:
1. **Node.js not found**: Ensure the Node.js path in the wrapper script matches your installation
2. **Permission denied**: Make sure the wrapper script is executable (`chmod +x`)
3. **MCP servers not built**: The script automatically builds servers before execution
4. **Slack posting fails**: Check Slack tokens in the MCP configuration

### Check logs:
```bash
tail -f /Users/olegshevchenko/Sourses/MCP/logs/cron-auto-release.log
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
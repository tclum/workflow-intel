# Workflow Intel weekly scheduler

This directory holds the launchd agent for the Sunday 08:00 HST weekly Workflow Intel run. The job runs `scripts/weekly.sh`, which chains `pnpm ingest`, `pnpm embed`, `pnpm dedup`, `pnpm triage`, `pnpm synthesis`, and `pnpm email-digest`; if a step fails, it sends a short Resend failure notice only when `RESEND_API_KEY` is configured.

Install commands for Timothy, from `~/Desktop/Developer/workflow-intel`:

```sh
chmod +x scripts/weekly.sh
mkdir -p ~/Library/LaunchAgents
cp ops/com.workflow-intel.weekly.plist ~/Library/LaunchAgents/com.workflow-intel.weekly.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.workflow-intel.weekly.plist
launchctl enable "gui/$(id -u)/com.workflow-intel.weekly"
launchctl print "gui/$(id -u)/com.workflow-intel.weekly"
```

To remove or reload the job:

```sh
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.workflow-intel.weekly.plist
cp ops/com.workflow-intel.weekly.plist ~/Library/LaunchAgents/com.workflow-intel.weekly.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.workflow-intel.weekly.plist
```

Logs go to `/tmp/com.workflow-intel.weekly.out.log` and `/tmp/com.workflow-intel.weekly.err.log`.

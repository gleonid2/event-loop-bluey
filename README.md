# Event Loop Bluey 🐕

Your loyal Bluey fetches and runs Copilot prompts on a loop — right from VS Code.

A VS Code extension that automates command scheduling via GitHub Copilot CLI. Define tasks, set intervals, and let Bluey keep running them while you focus on other work.

---

## ✨ Features

### 📋 Commands Panel

- **Sidebar TreeView** — Manage all your commands from the Activity Bar (🐕 icon)
- **Add / Edit / Delete** — Full CRUD via toolbar buttons and right-click context menu
- **Enable / Disable** — Toggle commands on/off without deleting them
- **Visual badges** — See chain links (`🔗→#8`), linked best practices count (`📚2`), and intervals at a glance

### ⏰ Per-Command Scheduling

- Each command runs on its own independent timer (default: 10 minutes)
- Configurable per command — set different intervals for different tasks
- Start/stop the scheduler from the toolbar or status bar

### 🔗 Command Chaining

Chain commands together so one triggers another when it finishes:

- **On Complete** — Select which command to trigger next
- **Extra Prompt** — Append additional instructions to the chained command
- **Data Passing** — Use `[PASS_TO_NEXT]...[/PASS_TO_NEXT]` markers in output to pass data (URLs, IDs, etc.) to the next command automatically
- **Conditional Chaining** — Only trigger the chain if the output says to proceed:
  - The AI outputs `[CHAIN:PROCEED]` or `[CHAIN:SKIP]` based on your condition
  - Example: "Check Teams for new PR review requests" → only triggers "Review PR" if there's actually a new request
  - Configurable condition description (e.g., "there are new pull request review requests")

### 📘 Best Practices System

- **Auto-create** — Best practices files are created after the first run
- **Auto-update** — After each run, Copilot updates the file with new learnings
- **Inline editor** — Edit best practices directly in the command detail panel
- **Linked best practices** — Include best practices from other commands in your prompt (checkbox UI)
- **Post-run templates** — Customize the instructions appended for creating/updating best practices (via Settings gear icon)

### ⚙️ Settings Panel

Click the **gear icon** (⚙️) in the Commands panel header to open global settings:

- **⏱️ Terminal Timeout** — Configure how long to wait before timing out (default: 10 minutes)
- **📝 Post-Run Templates** — Edit the templates for creating and updating best practices files
- **🔤 Template Variables** — Use `{{bestPracticesPath}}`, `{{commandDescription}}`, `{{commandPrompt}}`, `{{commandId}}`

### 📤 Export / Import Commands

Share your command flows with others:

- **Export** — Save all commands + templates to a JSON file
- **Import (Merge)** — Add imported commands alongside existing ones (IDs are remapped automatically)
- **Import (Replace)** — Replace all existing commands with imported ones
- Access via the **⋯ overflow menu** in the Commands panel header

### 📜 Run History

- **Tree view** — See all past runs with status icons (✅ success, ❌ failed, 🔄 running)
- **Duration tracking** — Each run shows how long it took (e.g., `3m 42s`)
- **Click to view logs** — Full prompt + output captured in log files
- **Clear history** — One-click cleanup

### 📺 Terminal Execution

- Prompts are piped to `copilot --allow-all` in VS Code terminals
- Output is tee'd to log files for later review
- Configurable timeout (via Settings panel)

### 🐕 Status Bar

- Shows current state: **Off** / **On** / **Working**
- Live countdown to next scheduled run
- Click to start/stop the scheduler

### 📝 Logging

- **Output channel** — `Event Loop Bluey 🐕` in the Output panel for real-time logs
- **Persistent log file** — `event_loop_bluey.log` saved alongside your commands

---

## 📦 Installation

### Prerequisites

| Requirement | Check | Install |
|---|---|---|
| VS Code 1.85.0+ | — | [Download](https://code.visualstudio.com/) |
| Node.js 18+ | `node --version` | [Download](https://nodejs.org/) |
| Copilot CLI | `copilot --version` | `npm install -g @githubnext/github-copilot-cli` |
| Copilot Auth | — | `github-copilot-cli auth` |

> **Note:** You need an active GitHub Copilot subscription for the CLI to work.

### Install the Extension

**From VSIX file** (recommended):

1. Download `event-loop-bluey-0.0.1.vsix`
2. In VS Code: `Cmd+Shift+P` → **"Install from VSIX"** → select the file
3. Reload VS Code

Or from terminal:

```bash
code --install-extension event-loop-bluey-0.0.1.vsix
```

**From source:**

```bash
cd event-loop-bluey
npm install
npx tsc -p ./
npx @vscode/vsce package --allow-missing-repository
code --install-extension event-loop-bluey-0.0.1.vsix
```

### Quick Start

1. Open a workspace folder in VS Code
2. Click the **🐕 dog icon** in the Activity Bar (left sidebar)
3. Click **+ Add Command** and follow the 4-step wizard
4. Click **▶️ Start Scheduler** to begin the loop

Or **import an example flow** from the `examples/` folder in the repo to get started instantly!

---

## 📖 commands.json Format

```json
{
  "commands": [
    {
      "id": 1,
      "enabled": true,
      "description": "Check Teams for PR reviews",
      "prompt": "Open Teams, search for PR review requests...",
      "best_practices_file": "best_practices/teams_pr_check.md",
      "intervalMinutes": 15,
      "settings": {
        "autoUpdateBestPractices": true,
        "autoCreateBestPractices": true
      },
      "onComplete": {
        "commandId": 2,
        "extraPrompt": "Review the pull request link from the previous task.",
        "conditional": true,
        "chainCondition": "there are new pull request review requests"
      },
      "includeBestPracticesFrom": [3, 5]
    }
  ],
  "postRunTemplate": "After completing the task, update the best practices file at {{bestPracticesPath}}...",
  "postRunCreateTemplate": "After completing the task, create a best practices file at {{bestPracticesPath}}..."
}
```

### Command Fields

| Field | Type | Description |
|---|---|---|
| `id` | number | Unique command ID |
| `enabled` | boolean | Whether the command is active |
| `description` | string | Display name |
| `prompt` | string | The text sent to Copilot CLI |
| `best_practices_file` | string? | Path to best practices file (auto-generated if omitted) |
| `intervalMinutes` | number? | Run interval in minutes (default: 10) |
| `settings` | object? | Per-command settings overrides |
| `onComplete` | object? | Chain configuration (see below) |
| `includeBestPracticesFrom` | number[]? | IDs of commands whose best practices to include |

### OnComplete (Chaining)

| Field | Type | Description |
|---|---|---|
| `commandId` | number | ID of the command to trigger next |
| `extraPrompt` | string? | Extra text appended to the chained command's prompt |
| `conditional` | boolean? | If true, only chain when output says `[CHAIN:PROCEED]` |
| `chainCondition` | string? | Describes when to proceed (shown to AI) |

---

## ⚙️ VS Code Settings

| Setting | Default | Description |
|---|---|---|
| `eventLoopBluey.commandsFilePath` | `""` | Path to commands.json (auto-detected if empty) |
| `eventLoopBluey.terminalTimeoutMinutes` | `10` | Max minutes to wait for a terminal command |

---

## 🎮 Commands

| Command | Description |
|---|---|
| `Event Loop Bluey: Start Scheduler 🐕` | Start the interval loop |
| `Event Loop Bluey: Stop Scheduler` | Stop the scheduler |
| `Event Loop Bluey: Run All Commands Now` | One-shot run of all enabled commands |
| `Event Loop Bluey: Run Command` | Run a single command (right-click menu) |
| `Event Loop Bluey: Add Command` | Add a new command via wizard |
| `Event Loop Bluey: Edit Command` | Edit an existing command |
| `Event Loop Bluey: Delete Command` | Delete a command |
| `Event Loop Bluey: Open Commands File` | Open commands.json in editor |
| `Event Loop Bluey: Open Settings` | Open the settings panel (gear icon) |
| `Event Loop Bluey: Export Commands` | Export all commands to a JSON file |
| `Event Loop Bluey: Import Commands` | Import commands from a JSON file |
| `Event Loop Bluey: Clear History` | Clear the run history |

---

## 📁 File Structure

After running, your workspace will contain:

```
your-project/
├── commands.json                    # Your commands + templates
├── best_practices/                  # Auto-created best practices per command
│   ├── check_teams_for_pr_reviews.md
│   └── review_pull_request.md
├── run_logs/                        # Per-run output logs with timestamps
│   └── check_teams_2026-03-25T08-30-00Z.log
├── event_loop_bluey_history.json    # Run history (timestamps, durations, status)
└── event_loop_bluey.log             # Main event log file
```

---

## 🔧 Troubleshooting

| Problem | Solution |
|---|---|
| `copilot: command not found` | Run `npm install -g @githubnext/github-copilot-cli` |
| CLI returns auth error | Run `github-copilot-cli auth` to re-authenticate |
| Extension not visible in sidebar | Fully quit VS Code (`Cmd+Q`) and reopen |
| Commands not loading | Check that `commands.json` exists in workspace root or `scripts/` folder |
| Old icon showing after update | Fully quit VS Code (`Cmd+Q`), not just reload |
| Chain always triggers despite `[CHAIN:SKIP]` | Reload VS Code after installing a new VSIX |

---

## 📋 Requirements

- VS Code 1.85.0+
- Node.js 18+
- [GitHub Copilot CLI](https://github.com/github/copilot-cli) with active subscription
- macOS, Linux, or WSL (uses `/bin/zsh` for terminal execution)

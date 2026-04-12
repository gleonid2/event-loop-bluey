# 📦 Example Flows

Ready-to-import command flows to get you started with Event Loop Bluey 🐕

## How to Import

1. Open VS Code with the extension installed
2. Click the **🐕 dog icon** in the Activity Bar
3. Click the **⋯ overflow menu** → **Import Commands**
4. Select one of these JSON files
5. Choose **Merge** (add to existing) or **Replace**

## Available Examples

### 🚀 [Getting Started](./getting-started.json)
Simple flows to learn the basics. Includes:
- **Hello World** — A basic prompt that runs every 5 minutes
- **Weather Check** — Fetches weather info and learns best practices over time
- **Daily Motivation** — Generates an inspiring quote

*Best for: First-time users*

### 💻 [Code Quality](./code-quality.json)
Automated code maintenance flows. Includes:
- **Lint & Fix** — Runs linter and fixes issues automatically
- **Check TODOs** — Scans for TODO/FIXME comments and creates a summary
- **Dependency Check** — Checks for outdated npm dependencies
- **Security Audit** — Runs npm audit and reports vulnerabilities
- Chain: Security Audit → Dependency Check (conditional: only if vulnerabilities found)

*Best for: JavaScript/TypeScript projects*

### 📋 [PR Review Workflow](./pr-review-workflow.json)
Automated pull request review pipeline. Includes:
- **Check for New PRs** — Monitors a repo for new pull requests
- **Review PR** — Reviews code changes and leaves comments
- Chain: Check for New PRs → Review PR (conditional: only if new PRs exist)
- Linked best practices between commands

*Best for: Teams doing code reviews*

### 📊 [Monitoring & Reporting](./monitoring-and-reporting.json)
Keep track of project health. Includes:
- **Git Status Report** — Summarizes recent commits and branch status
- **Test Runner** — Runs test suite and tracks results
- **Build Health** — Checks if the project builds successfully
- **Generate Report** — Compiles results into a summary report
- Chain: Test Runner → Generate Report (passes test results)

*Best for: CI/CD and project monitoring*

### 💬 [Communication](./communication.json)
Automate messaging and notifications. Includes:
- **Morning Standup** — Generates a standup summary from recent git activity
- **Send Team Update** — Posts a summary to a chat channel
- Chain: Morning Standup → Send Team Update (passes the standup summary)

*Best for: Team leads and project managers*

### 🐕 [Bluey Teams Monitor](./bluey-teams-monitor.json)
AI-powered Teams chat bot for portal error investigation. Includes:
- **Bluey Monitor** — Polls a Teams monitoring chat for messages starting with "bluey"
- **Bluey Respond** — Posts Kusto query results back to the chat
- Chain: Monitor → Respond (conditional: only if a bluey command was found)
- Pre-built KQL templates for tenant lookups, error investigation, and blade failures
- [Best Practices Guide](./bluey-teams-monitor-best-practices.md) with setup, KQL templates, and troubleshooting

*Requires: Teams MCP + Kusto MCP servers*
*Best for: Portal monitoring teams investigating errors on demand*

---

## 📁 Bluey Flows

Advanced multi-step flows organized in the `bluey-flows/` directory.

### 🔍 [CP Review](./bluey-flows/cp-review.json)
AI-powered multi-persona code review for the CP (Control Plane) team. Scans 4 ADO repos, identifies the top 3 human reviewers, and creates AI reviewer personas that mimic their real review style.

**Personas:**
- **🔍 Amit AI** — Architecture & patterns. Flags structural issues, constructor logic, edge cases.
- **❓ Dan AI** — Completeness & config. Probes for missing pieces, deployment coverage.
- **📋 Lipi AI** — Technical depth & rationale. Explains the WHY behind architectural choices.

**Repos covered:** backend-api, distribution-service, shared-packages, marketplace-service

**Commands:**
1. **Scan PRs & Build Personas** — Fetches recent PR threads, identifies top reviewers, builds persona profiles
2. **AI Persona Code Review** — Reviews open PRs through each persona's lens, provides merge confidence score

- Chain: Scan → Review (conditional: only if personas were successfully built)
- [Best Practices](./bluey-flows/cp-review-best-practices.md) with persona details and review guidelines

*Requires: ADO MCP server*
*Best for: CP team code reviews with AI-simulated peer feedback*

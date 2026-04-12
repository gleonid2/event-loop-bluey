# 🐕 Bluey Flow — Best Practices

## Overview

Bluey is a **Teams chat monitor** that watches a portal monitoring chat for user commands
and executes Kusto queries on demand. It runs on Event Loop Bluey's scheduler, polling the
chat every 5 minutes.

## Flow Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Teams Monitoring Chat                  │
│                                                          │
│  🤖 [Alert] Some errors from API requests...            │
│      Request: getDeviceUsageSummary                      │
│      Affected tenants: 4 | Status: 500                  │
│      Error count: 15 | Success: 243                     │
│      Tenants: ["910c085b-...", "1f081cea-...", ...]      │
│      📊 Kusto query link                                │
│                                                          │
│  👤 bluey give me what tenant 910c085b did last 1 hr    │
│                                                          │
│  🐕 Bluey says:                                         │
│      Found 42 events for tenant 910c085b in last hour   │
│      | Time  | Action | Name    | Count |               │
│      |-------|--------|---------|-------|               │
│      | 09:15 | Load   | Blade/X |    12 |               │
│      ...                                                │
└─────────────────────────────────────────────────────────┘

         ▲ Post results                ▼ Poll for "bluey" messages
         │                             │
   ┌─────┴──────┐              ┌───────┴───────┐
   │  Command 2  │◄── chain ───│   Command 1    │
   │  Respond    │             │   Monitor      │
   │  (Teams)    │             │   (Teams+Kusto)│
   └─────────────┘              └───────────────┘
```

## Command Chain

| Step | Command | What It Does | Interval |
|------|---------|-------------|----------|
| 1 | **Bluey Monitor** | Reads Teams chat, finds "bluey" commands, runs Kusto queries | 5 min |
| 2 | **Bluey Respond** | Posts formatted results back to Teams (chained, conditional) | — |

## Supported User Commands

Users trigger Bluey by starting a message with `bluey` (case-insensitive):

| Command Pattern | What Bluey Does |
|----------------|----------------|
| `bluey give me what tenant {id} did on the last {N} hr` | Queries `ClientTelemetry` for all activity by that tenant |
| `bluey show errors for {requestName} in the last {N}h` | Queries error events filtered by request name |
| `bluey summarize tenant activity for {tenantId}` | Aggregates actions/counts for a tenant |
| `bluey blade failures for {extension} last {N}d` | Runs BladeLoadErrored query for an extension |
| `bluey run the kusto query from the alert above` | Extracts + executes the KQL from the preceding alert |

## KQL Query Templates

### Tenant Activity Lookup
```kql
ClientTelemetry
| where PreciseTimeStamp >= ago(1h)        // adjust duration
| where tenantId == "{tenantId}"
| summarize count() by action, name, bin(PreciseTimeStamp, 5m)
| order by PreciseTimeStamp desc
```

### Error Investigation by Request Name
```kql
ClientTelemetry
| where PreciseTimeStamp >= ago(24h)
| where name has "{requestName}"
| where action == "BladeLoadErrored" or action has "Error"
| summarize errorCount=count() by tenantId, name, action
| order by errorCount desc
```

### Blade Load Failures by Extension
```kql
let _endTime = now();
let _startTime = ago(1d);
ClientTelemetry
| where userTypeHint == ""
| where extension =~ "{extensionName}"
| where PreciseTimeStamp between (_startTime .. _endTime)
| where action == "BladeLoadErrored"
| parse name with *'Blade/' bladeName
| summarize FailedLoads=toint(count()) by bladeName, bin(PreciseTimeStamp, 15m)
| project PreciseTimeStamp, bladeName, FailedLoads
```

### Full Error Summary with Tenant Breakdown
```kql
ClientTelemetry
| where PreciseTimeStamp >= ago(1d)
| where action == "BladeLoadErrored"
| summarize
    errorCount = count(),
    affectedTenants = dcount(tenantId),
    tenantList = make_set(tenantId, 10)
  by name
| where errorCount > 10 and affectedTenants > 3
| order by errorCount desc
```

## Setup Requirements

### MCP Servers Needed
| MCP Server | Purpose | Config Key |
|-----------|---------|-----------|
| **Teams** | Read/write chat messages | `agency mcp teams` |
| **Kusto** | Execute KQL queries | `agency mcp kusto --service-uri ... --database ...` |

### Kusto Connection
- **Cluster:** `https://azportalpartnerrow.westus.kusto.windows.net/`
- **Database:** `AzurePortal`
- **Primary Table:** `ClientTelemetry`
- **Auth:** Azure AD (via `az login` or managed identity)

### Teams Chat
- The monitoring chat should be identifiable by topic name or members
- Bluey scans for messages starting with `bluey` (case-insensitive)
- Results are posted back as replies in the same chat

## Best Practices for Writing Bluey Commands

### ✅ Do
- Start your message with `bluey` — it's the trigger word
- Be specific about the tenant ID (copy the full GUID from the alert)
- Specify a time window (`last 1 hr`, `last 24h`, `last 7d`)
- Reference the request name from the alert when investigating errors

### ❌ Don't
- Don't write multi-line bluey commands — keep it to one message
- Don't ask bluey to write/modify data — it's read-only
- Don't forget the time window — queries without a range may be slow or timeout

## Chaining & Conditional Logic

The flow uses Event Loop Bluey's **conditional chaining**:

1. Command 1 (Monitor) outputs `[CHAIN:PROCEED]` when it finds and processes a bluey command
2. Command 1 wraps results in `[PASS_TO_NEXT]...[/PASS_TO_NEXT]` markers
3. Command 2 (Respond) receives the results and posts to Teams
4. If no bluey commands are found, Command 1 outputs `[CHAIN:SKIP]` — no reply needed

## Interval Tuning

| Setting | Recommended | Why |
|---------|------------|-----|
| Poll interval | 5 min | Balances responsiveness vs. API quota |
| Terminal timeout | 10 min | Kusto queries on large datasets may take time |
| Best practices auto-update | ON | Lets Bluey learn better KQL patterns over time |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bluey doesn't find commands | Check Teams MCP is connected (`/mcp` in Copilot CLI) |
| Kusto query fails | Verify `az login` is active and you have DB access |
| TLS certificate error | Set `UV_NATIVE_TLS=1` in environment |
| Empty results | Widen the time range or check the table/column names |
| Chain doesn't trigger | Ensure Command 1 outputs `[CHAIN:PROCEED]` marker |

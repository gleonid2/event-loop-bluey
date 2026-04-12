import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RunRecord } from './types';
import { CommandsModel } from './commandsModel';
import { slugify, formatDuration } from './utils';

const MAX_RECORDS = 50;

export class RunHistory implements vscode.Disposable {
    private records: RunRecord[] = [];
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private model: CommandsModel) {
        this.loadFromDisk();
    }

    private getFilePath(): string | undefined {
        const cmdFile = this.model.getFilePath();
        if (!cmdFile) { return undefined; }
        return path.join(path.dirname(cmdFile), 'event_loop_bluey_history.json');
    }

    /** Returns the run_logs directory (creates it if needed). */
    getLogsDir(): string | undefined {
        const cmdFile = this.model.getFilePath();
        if (!cmdFile) { return undefined; }
        const dir = path.join(path.dirname(cmdFile), 'run_logs');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    /** Create a log file path for a new run. */
    createLogFilePath(commandId: number, description: string): string | undefined {
        const dir = this.getLogsDir();
        if (!dir) { return undefined; }
        const slug = slugify(description);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        return path.join(dir, `${slug}_${ts}.log`);
    }

    private loadFromDisk(): void {
        const fp = this.getFilePath();
        if (!fp || !fs.existsSync(fp)) { return; }
        try {
            this.records = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        } catch {
            this.records = [];
        }
    }

    private saveToDisk(): void {
        const fp = this.getFilePath();
        if (!fp) { return; }
        try {
            fs.writeFileSync(fp, JSON.stringify(this.records, null, 2) + '\n', 'utf-8');
        } catch { /* non-critical */ }
    }

    addRunning(commandId: number, description: string, logFile?: string): void {
        this.records.unshift({
            commandId,
            description,
            timestamp: new Date().toISOString(),
            status: 'running',
            logFile,
        });
        if (this.records.length > MAX_RECORDS) { this.records.pop(); }
        this.saveToDisk();
        this._onDidChange.fire();
    }

    markDone(commandId: number, success: boolean, error?: string, durationMs?: number): void {
        const rec = this.records.find(r => r.commandId === commandId && r.status === 'running');
        if (rec) {
            rec.status = success ? 'success' : 'failed';
            rec.error = error;
            rec.durationMs = durationMs;
            this.saveToDisk();
            this._onDidChange.fire();
        }
    }

    getAll(): RunRecord[] {
        return [...this.records];
    }

    getForCommand(commandId: number): RunRecord[] {
        return this.records.filter(r => r.commandId === commandId);
    }

    clear(): void {
        this.records = [];
        this.saveToDisk();
        this._onDidChange.fire();
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

// --- TreeView for run history ---

class RunRecordItem extends vscode.TreeItem {
    constructor(public readonly record: RunRecord) {
        const time = new Date(record.timestamp);
        const timeStr = time.toLocaleString();
        super(record.description, vscode.TreeItemCollapsibleState.None);

        const durationStr = record.durationMs != null ? ` (${formatDuration(record.durationMs)})` : '';
        this.description = `${timeStr}${durationStr}`;

        const iconMap = {
            success: new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed')),
            failed: new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')),
            running: new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow')),
        };
        this.iconPath = iconMap[record.status];

        // Make clickable → opens the run log
        if (record.logFile) {
            this.command = {
                command: 'eventLoopBluey.showRunLog',
                title: 'Show Run Log',
                arguments: [record],
            };
        }

        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${record.description}**\n\n`);
        md.appendMarkdown(`⏱️ ${timeStr}\n\n`);
        if (record.durationMs != null) {
            md.appendMarkdown(`⏱️ Duration: **${formatDuration(record.durationMs)}**\n\n`);
        }
        md.appendMarkdown(`Status: ${record.status}\n\n`);
        if (record.logFile) {
            md.appendMarkdown(`📄 Click to view run log\n\n`);
        }
        if (record.error) {
            md.appendMarkdown(`❌ Error: ${record.error}\n`);
        }
        this.tooltip = md;
    }
}

export class RunHistoryTreeProvider implements vscode.TreeDataProvider<RunRecordItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private history: RunHistory) {
        history.onDidChange(() => this._onDidChangeTreeData.fire());
    }

    refresh(): void { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: RunRecordItem): vscode.TreeItem { return element; }

    getChildren(): RunRecordItem[] {
        return this.history.getAll().map(r => new RunRecordItem(r));
    }

    dispose(): void { this._onDidChangeTreeData.dispose(); }
}

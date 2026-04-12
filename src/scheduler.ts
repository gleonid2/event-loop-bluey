import * as vscode from 'vscode';
import * as fs from 'fs';
import { Command } from './types';
import { CommandsModel } from './commandsModel';
import { RunHistory } from './runHistory';
import { formatDuration } from './utils';
import { readOutputSection, extractPassedData, evaluateChainCondition, buildChainExtra } from './chainHandler';

const DEFAULT_INTERVAL_MINUTES = 10;

export type SchedulerState = 'stopped' | 'running' | 'executing';

export interface SchedulerEvents {
    onStateChange: vscode.Event<SchedulerState>;
    onTick: vscode.Event<{ nextRunAt: Date; commandDescription: string }>;
    onCommandStart: vscode.Event<{ id: number; index: number; total: number }>;
    onCommandFinish: vscode.Event<{ id: number; index: number; total: number }>;
    onCycleComplete: vscode.Event<void>;
}

interface CommandTimer {
    commandId: number;
    timer: ReturnType<typeof setTimeout>;
    nextRunAt: Date;
}

export class Scheduler implements vscode.Disposable {
    private _state: SchedulerState = 'stopped';
    private commandTimers: Map<number, CommandTimer> = new Map();
    private tickTimer: ReturnType<typeof setInterval> | undefined;
    private executing = false;

    private _onStateChange = new vscode.EventEmitter<SchedulerState>();
    private _onTick = new vscode.EventEmitter<{ nextRunAt: Date; commandDescription: string }>();
    private _onCommandStart = new vscode.EventEmitter<{ id: number; index: number; total: number }>();
    private _onCommandFinish = new vscode.EventEmitter<{ id: number; index: number; total: number }>();
    private _onCycleComplete = new vscode.EventEmitter<void>();

    readonly events: SchedulerEvents = {
        onStateChange: this._onStateChange.event,
        onTick: this._onTick.event,
        onCommandStart: this._onCommandStart.event,
        onCommandFinish: this._onCommandFinish.event,
        onCycleComplete: this._onCycleComplete.event,
    };

    constructor(
        private model: CommandsModel,
        private executor: (prompt: string, logFile?: string) => Promise<void>,
        private outputChannel: vscode.OutputChannel,
        private runHistory?: RunHistory,
    ) {}

    get state(): SchedulerState {
        return this._state;
    }

    get nextRunAt(): Date | undefined {
        let soonest: Date | undefined;
        for (const ct of this.commandTimers.values()) {
            if (!soonest || ct.nextRunAt < soonest) {
                soonest = ct.nextRunAt;
            }
        }
        return soonest;
    }

    private setState(s: SchedulerState): void {
        this._state = s;
        this._onStateChange.fire(s);
    }

    private getNextRunDelay(cmd: Command): number {
        const schedule = cmd.schedule;

        // No schedule or interval type: use intervalMinutes
        if (!schedule || schedule.type === 'interval') {
            const mins = cmd.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
            return Math.max(1, mins) * 60_000;
        }

        const now = new Date();
        const [hours, minutes] = (schedule.time || '08:00').split(':').map(Number);

        if (schedule.type === 'daily') {
            const target = new Date(now);
            target.setHours(hours, minutes, 0, 0);
            if (target <= now) {
                target.setDate(target.getDate() + 1); // next day
            }
            return target.getTime() - now.getTime();
        }

        if (schedule.type === 'weekly') {
            const days = schedule.daysOfWeek ?? [1]; // default Monday
            const currentDay = now.getDay();

            // Find the next matching day
            let minDelay = Infinity;
            for (const day of days) {
                let daysUntil = day - currentDay;
                if (daysUntil < 0) { daysUntil += 7; }

                const target = new Date(now);
                target.setDate(target.getDate() + daysUntil);
                target.setHours(hours, minutes, 0, 0);

                if (target <= now) {
                    target.setDate(target.getDate() + 7); // next week
                }

                const delay = target.getTime() - now.getTime();
                if (delay < minDelay) { minDelay = delay; }
            }
            return minDelay;
        }

        // Fallback
        return DEFAULT_INTERVAL_MINUTES * 60_000;
    }

    private formatScheduleInfo(cmd: Command): string {
        const schedule = cmd.schedule;
        if (!schedule || schedule.type === 'interval') {
            const mins = cmd.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
            return `every ${mins} min`;
        }
        const time = schedule.time || '08:00';
        if (schedule.type === 'daily') {
            return `daily at ${time}`;
        }
        if (schedule.type === 'weekly') {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const days = (schedule.daysOfWeek ?? [1]).map(d => dayNames[d]).join(', ');
            return `${days} at ${time}`;
        }
        return 'unknown schedule';
    }

    start(): void {
        if (this._state !== 'stopped') { return; }
        this.log('🐕 Scheduler started. Woof!');
        this.setState('running');

        const enabled = this.model.getEnabled();
        // Only run interval-based commands (not daily/weekly)
        const intervalCmds = enabled.filter(c => !c.schedule || c.schedule.type === 'interval');
        if (intervalCmds.length === 0) {
            this.log('No enabled interval commands.');
        }
        for (const cmd of intervalCmds) {
            this.executeAndSchedule(cmd);
        }

        this.tickTimer = setInterval(() => {
            const soonest = this.getSoonestTimer();
            if (soonest) {
                const cmd = this.model.getById(soonest.commandId);
                this._onTick.fire({
                    nextRunAt: soonest.nextRunAt,
                    commandDescription: cmd?.description ?? `#${soonest.commandId}`,
                });
            }
        }, 1000);
    }

    stop(): void {
        if (this._state === 'stopped') { return; }
        this.clearAllTimers();
        this._scheduledRunning = false;
        vscode.commands.executeCommand('setContext', 'eventLoopBluey.scheduledRunning', false);
        this.setState('stopped');
        this.log('🛑 Scheduler stopped.');
    }

    private _scheduledRunning = false;
    get scheduledRunning(): boolean { return this._scheduledRunning; }

    startScheduledOnly(): void {
        this._scheduledRunning = true;
        vscode.commands.executeCommand('setContext', 'eventLoopBluey.scheduledRunning', true);
        this.log('⏰ Scheduled commands started (daily/weekly only).');

        const enabled = this.model.getEnabled();
        const scheduled = enabled.filter(c => c.schedule?.type === 'daily' || c.schedule?.type === 'weekly');

        if (scheduled.length === 0) {
            this.log('No enabled daily/weekly commands found.');
            vscode.window.showInformationMessage('🐕 No daily/weekly scheduled commands found. Set a command schedule first.');
            this._scheduledRunning = false;
            vscode.commands.executeCommand('setContext', 'eventLoopBluey.scheduledRunning', false);
            return;
        }

        for (const cmd of scheduled) {
            this.scheduleCommand(cmd);
        }

        // Start tick timer if not already running
        if (!this.tickTimer) {
            this.tickTimer = setInterval(() => {
                const soonest = this.getSoonestTimer();
                if (soonest) {
                    const cmd = this.model.getById(soonest.commandId);
                    this._onTick.fire({
                        nextRunAt: soonest.nextRunAt,
                        commandDescription: cmd?.description ?? `#${soonest.commandId}`,
                    });
                }
            }, 1000);
        }
    }

    stopScheduledOnly(): void {
        this._scheduledRunning = false;
        vscode.commands.executeCommand('setContext', 'eventLoopBluey.scheduledRunning', false);
        // Only clear scheduled command timers, leave interval ones alone
        const enabled = this.model.getEnabled();
        for (const cmd of enabled) {
            if (cmd.schedule?.type === 'daily' || cmd.schedule?.type === 'weekly') {
                this.clearCommandTimer(cmd.id);
            }
        }
        this.log('⏰ Scheduled commands stopped.');
    }

    async runOnce(): Promise<void> {
        if (this.executing) {
            vscode.window.showWarningMessage('Event Loop Bluey is already running commands.');
            return;
        }
        const enabled = this.model.getEnabled();
        await this.executeCommands(enabled);
    }

    async runSingle(commandId: number): Promise<void> {
        if (this.executing) {
            vscode.window.showWarningMessage('Event Loop Bluey is already running commands.');
            return;
        }
        const cmd = this.model.getById(commandId);
        if (!cmd) { return; }
        await this.executeCommands([cmd]);
    }

    private async executeAndSchedule(cmd: Command): Promise<void> {
        await this.executeCommands([cmd]);
        if (this._state === 'stopped') { return; }
        this.scheduleCommand(cmd);
    }

    private scheduleCommand(cmd: Command): void {
        this.clearCommandTimer(cmd.id);
        const intervalMs = this.getNextRunDelay(cmd);
        const nextRunAt = new Date(Date.now() + intervalMs);

        const timer = setTimeout(() => {
            this.commandTimers.delete(cmd.id);
            if (this._state !== 'stopped') {
                const freshCmd = this.model.getById(cmd.id);
                if (freshCmd && freshCmd.enabled) {
                    this.executeAndSchedule(freshCmd);
                }
            }
        }, intervalMs);

        this.commandTimers.set(cmd.id, { commandId: cmd.id, timer, nextRunAt });
        const scheduleInfo = this.formatScheduleInfo(cmd);
        this.log(`⏳ "${cmd.description}" (${scheduleInfo}) → next at ${nextRunAt.toLocaleTimeString()}`);
    }

    private async executeCommands(cmds: Command[], extraPromptOverride?: string): Promise<void> {
        if (cmds.length === 0) { return; }
        const previousState = this._state;
        this.executing = true;
        this.setState('executing');

        for (let i = 0; i < cmds.length; i++) {
            const cmd = cmds[i];
            this._onCommandStart.fire({ id: cmd.id, index: i, total: cmds.length });
            this.log(`▶️  [${i + 1}/${cmds.length}] ${cmd.description}`);
            const logFile = this.runHistory?.createLogFilePath(cmd.id, cmd.description);
            this.runHistory?.addRunning(cmd.id, cmd.description, logFile);
            const startTime = Date.now();
            try {
                let prompt = this.model.buildPrompt(cmd);
                if (extraPromptOverride) {
                    prompt += `\n\n${extraPromptOverride}`;
                }
                await this.executor(prompt, logFile);
                const durationMs = Date.now() - startTime;
                this.log(`✅ [${i + 1}/${cmds.length}] Done. (${formatDuration(durationMs)})`);
                this.runHistory?.markDone(cmd.id, true, undefined, durationMs);

                // Append duration to log file
                if (logFile && fs.existsSync(logFile)) {
                    try { fs.appendFileSync(logFile, `\n⏱️ Duration: ${formatDuration(durationMs)}\n`); } catch { /* ignore */ }
                }

                await this.handleChaining(cmd, logFile);
            } catch (e: unknown) {
                const durationMs = Date.now() - startTime;
                const msg = e instanceof Error ? e.message : String(e);
                this.log(`❌ [${i + 1}/${cmds.length}] Failed: ${msg} (${formatDuration(durationMs)})`);
                this.runHistory?.markDone(cmd.id, false, msg, durationMs);
            }
            this._onCommandFinish.fire({ id: cmd.id, index: i, total: cmds.length });
        }

        this.executing = false;
        this._onCycleComplete.fire();
        if (this._state !== 'stopped') {
            this.setState(previousState === 'stopped' ? 'stopped' : 'running');
        }
    }

    private async handleChaining(cmd: Command, logFile?: string): Promise<void> {
        if (!cmd.onComplete) { return; }
        const nextCmd = this.model.getById(cmd.onComplete.commandId);
        if (!nextCmd) {
            this.log(`⚠️ Chain target #${cmd.onComplete.commandId} not found, skipping.`);
            return;
        }

        // Small delay to ensure log file is fully flushed from tee
        await new Promise(r => setTimeout(r, 1000));

        const outputSection = logFile ? readOutputSection(logFile) : '';
        const passedData = extractPassedData(outputSection);

        if (passedData) {
            this.log(`📦 Passing data from #${cmd.id}: ${passedData.substring(0, 100)}${passedData.length > 100 ? '...' : ''}`);
        }

        if (cmd.onComplete.conditional) {
            const decision = evaluateChainCondition(outputSection);
            this.log(`🔍 Conditional check: decision=${decision}, outputLen=${outputSection.length}`);
            if (decision === 'skip') {
                this.log(`⏭️ Chain skipped — output says no need to run "${nextCmd.description}"`);
            } else if (decision === 'proceed') {
                this.log(`🔗 Conditional chain PROCEED → "${nextCmd.description}" (from #${cmd.id})`);
                const extra = buildChainExtra(cmd, passedData);
                setTimeout(() => this.executeChained(nextCmd, extra), 100);
            } else {
                this.log(`⚠️ Chain conditional but no [CHAIN:PROCEED] or [CHAIN:SKIP] found — skipping to be safe.`);
            }
        } else {
            this.log(`🔗 Chaining → "${nextCmd.description}" (from #${cmd.id})`);
            const extra = buildChainExtra(cmd, passedData);
            setTimeout(() => this.executeChained(nextCmd, extra), 100);
        }
    }

    private async executeChained(cmd: Command, extraPrompt?: string): Promise<void> {
        await this.executeCommands([cmd], extraPrompt);
    }

    private getSoonestTimer(): CommandTimer | undefined {
        let soonest: CommandTimer | undefined;
        for (const ct of this.commandTimers.values()) {
            if (!soonest || ct.nextRunAt < soonest.nextRunAt) { soonest = ct; }
        }
        return soonest;
    }

    private clearCommandTimer(id: number): void {
        const ct = this.commandTimers.get(id);
        if (ct) { clearTimeout(ct.timer); this.commandTimers.delete(id); }
    }

    private clearAllTimers(): void {
        for (const ct of this.commandTimers.values()) { clearTimeout(ct.timer); }
        this.commandTimers.clear();
        if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = undefined; }
    }

    private log(msg: string): void {
        const ts = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`[${ts}] ${msg}`);
    }

    dispose(): void {
        this.stop();
        this._onStateChange.dispose();
        this._onTick.dispose();
        this._onCommandStart.dispose();
        this._onCommandFinish.dispose();
        this._onCycleComplete.dispose();
    }
}

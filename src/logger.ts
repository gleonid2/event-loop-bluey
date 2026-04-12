import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Scheduler } from './scheduler';
import { CommandsModel } from './commandsModel';

/**
 * Wires scheduler events to the VS Code OutputChannel and
 * persists a log file alongside commands.json (like nexus_runner.log).
 */
export class Logger implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    constructor(
        private outputChannel: vscode.OutputChannel,
        scheduler: Scheduler,
        private model: CommandsModel,
    ) {
        this.disposables.push(
            scheduler.events.onStateChange(state => {
                if (state === 'stopped') { this.persist('Scheduler stopped.'); }
                if (state === 'running') { this.persist('Scheduler started.'); }
            }),
            scheduler.events.onCommandStart(({ id, index, total }) => {
                const cmd = model.getById(id);
                const desc = cmd?.description ?? `#${id}`;
                this.persist(`Running command ${index + 1}/${total}: ${desc}`);
            }),
            scheduler.events.onCommandFinish(({ id, index, total }) => {
                const cmd = model.getById(id);
                const desc = cmd?.description ?? `#${id}`;
                this.persist(`Finished command ${index + 1}/${total}: ${desc}`);
            }),
            scheduler.events.onCycleComplete(() => {
                this.persist('Cycle complete.');
            }),
        );
    }

    /** Append a timestamped line to the log file next to commands.json. */
    private persist(message: string): void {
        const cmdFile = this.model.getFilePath();
        if (!cmdFile) { return; }

        const logPath = path.join(path.dirname(cmdFile), 'event_loop_bluey.log');
        const line = `[${new Date().toISOString()}] ${message}\n`;

        try {
            fs.appendFileSync(logPath, line, 'utf-8');
        } catch {
            // Non-critical — don't disrupt execution
        }
    }

    /** Show the output channel in the VS Code panel. */
    show(): void {
        this.outputChannel.show(true);
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}

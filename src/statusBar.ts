import * as vscode from 'vscode';
import { Scheduler, SchedulerState } from './scheduler';

export class StatusBarController implements vscode.Disposable {
    private item: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];

    constructor(private scheduler: Scheduler) {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            50,
        );

        this.disposables.push(
            scheduler.events.onStateChange(state => this.render(state)),
            scheduler.events.onTick(({ nextRunAt, commandDescription }) => this.renderCountdown(nextRunAt, commandDescription)),
            scheduler.events.onCommandStart(({ index, total }) => {
                this.item.text = `$(sync~spin) 🐕 Running ${index + 1}/${total}`;
                this.item.tooltip = 'Event Loop Bluey — executing commands...';
            }),
        );

        this.render(scheduler.state);
        this.item.show();
    }

    private render(state: SchedulerState): void {
        switch (state) {
            case 'stopped':
                this.item.text = '$(circle-outline) 🐕 Bluey: Off';
                this.item.tooltip = 'Click to start scheduler';
                this.item.command = 'eventLoopBluey.startScheduler';
                this.item.backgroundColor = undefined;
                break;
            case 'running':
                this.item.text = '$(clock) 🐕 Bluey: On';
                this.item.tooltip = 'Scheduler running — click to stop';
                this.item.command = 'eventLoopBluey.stopScheduler';
                this.item.backgroundColor = undefined;
                break;
            case 'executing':
                this.item.text = '$(sync~spin) 🐕 Bluey: Working...';
                this.item.tooltip = 'Executing commands — click to stop';
                this.item.command = 'eventLoopBluey.stopScheduler';
                this.item.backgroundColor = new vscode.ThemeColor(
                    'statusBarItem.warningBackground'
                );
                break;
        }
    }

    private renderCountdown(nextRunAt: Date, commandDescription: string): void {
        const remainMs = nextRunAt.getTime() - Date.now();
        if (remainMs <= 0) { return; }

        const totalSecs = Math.ceil(remainMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        const display = mins > 0
            ? `${mins}m ${secs.toString().padStart(2, '0')}s`
            : `${secs}s`;

        this.item.text = `$(clock) 🐕 Bluey: ${display}`;
        this.item.tooltip = `Next: ${commandDescription} at ${nextRunAt.toLocaleTimeString()} — click to stop`;
        this.item.command = 'eventLoopBluey.stopScheduler';
    }

    dispose(): void {
        this.item.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

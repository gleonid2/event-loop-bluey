import * as vscode from 'vscode';
import * as fs from 'fs';
import { CommandsModel } from './commandsModel';
import { CommandsTreeProvider, CommandTreeItem, CategoryTreeItem } from './commandsTreeProvider';
import { Scheduler } from './scheduler';
import { createCopilotExecutor } from './copilotExecutor';
import { StatusBarController } from './statusBar';
import { Logger } from './logger';
import { CommandDetailPanel } from './commandDetailPanel';
import { RunHistory, RunHistoryTreeProvider } from './runHistory';
import { SettingsPanel } from './settingsPanel';
import { CommandsFile } from './types';
import { runSetupCheck } from './setupChecker';

function registerCommands(
    model: CommandsModel,
    scheduler: Scheduler,
    runHistory: RunHistory,
    detailPanel: CommandDetailPanel,
    settingsPanel: SettingsPanel,
    treeProvider: CommandsTreeProvider,
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('eventLoopBluey.showCommandDetail', (item: CommandTreeItem) => {
            detailPanel.show(item.cmd);
        }),

        vscode.commands.registerCommand('eventLoopBluey.startScheduler', () => {
            scheduler.start();
            vscode.window.showInformationMessage('🐕 Event Loop Bluey: Scheduler started!');
        }),

        vscode.commands.registerCommand('eventLoopBluey.startScheduledOnly', () => {
            scheduler.startScheduledOnly();
        }),

        vscode.commands.registerCommand('eventLoopBluey.stopScheduledOnly', () => {
            scheduler.stopScheduledOnly();
            vscode.window.showInformationMessage('🐕 Scheduled commands stopped.');
        }),

        vscode.commands.registerCommand('eventLoopBluey.stopScheduler', () => {
            scheduler.stop();
            vscode.window.showInformationMessage('🐕 Event Loop Bluey: Scheduler stopped.');
        }),

        vscode.commands.registerCommand('eventLoopBluey.runAll', () => {
            scheduler.runOnce();
        }),

        vscode.commands.registerCommand('eventLoopBluey.runCommand', (item: CommandTreeItem) => {
            scheduler.runSingle(item.cmd.id);
        }),

        vscode.commands.registerCommand('eventLoopBluey.runScheduledCommand', (item: CommandTreeItem) => {
            scheduler.runSingle(item.cmd.id);
        }),

        vscode.commands.registerCommand('eventLoopBluey.refreshCommands', () => {
            model.load();
            treeProvider.refresh();
        }),

        vscode.commands.registerCommand('eventLoopBluey.toggleCommand', (item: CommandTreeItem) => {
            model.toggle(item.cmd.id);
        }),

        vscode.commands.registerCommand('eventLoopBluey.addCommand', async () => {
            try {
                if (!model.getFilePath()) {
                    const created = await model.initFile();
                    if (!created) {
                        vscode.window.showErrorMessage('🐕 Could not create commands.json — open a workspace folder first.');
                        return;
                    }
                    vscode.window.showInformationMessage(`🐕 Created ${created}`);
                }
                const description = await vscode.window.showInputBox({
                    title: '🐕 Add Command (Step 1/4)',
                    prompt: 'Command description',
                    placeHolder: 'e.g. Send daily standup summary',
                    ignoreFocusOut: true,
                });
                if (!description) { return; }

                const prompt = await vscode.window.showInputBox({
                    title: '🐕 Add Command (Step 2/4)',
                    prompt: 'Copilot prompt — the text to send to copilot',
                    placeHolder: 'e.g. open https://web.whatsapp.com/ and send a joke',
                    ignoreFocusOut: true,
                });
                if (!prompt) { return; }

                const bpFile = await vscode.window.showInputBox({
                    title: '🐕 Add Command (Step 3/4)',
                    prompt: 'Best practices file path (press Enter to skip)',
                    placeHolder: 'e.g. best_practices/my_task.md',
                    ignoreFocusOut: true,
                });
                if (bpFile === undefined) { return; } // Escape pressed

                const intervalStr = await vscode.window.showInputBox({
                    title: '🐕 Add Command (Step 4/4)',
                    prompt: 'Run every N minutes',
                    placeHolder: '10',
                    value: '10',
                    ignoreFocusOut: true,
                });
                if (intervalStr === undefined) { return; } // Escape pressed
                const interval = parseInt(intervalStr, 10) || 10;

                model.add(description, prompt, bpFile || undefined, interval);
                vscode.window.showInformationMessage(`🐕 Added: "${description}" (every ${interval} min)`);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`🐕 Add command failed: ${msg}`);
            }
        }),

        vscode.commands.registerCommand('eventLoopBluey.editCommand', async (item: CommandTreeItem) => {
            const cmd = item.cmd;
            const description = await vscode.window.showInputBox({
                prompt: 'Command description',
                value: cmd.description,
            });
            if (!description) { return; }

            const prompt = await vscode.window.showInputBox({
                prompt: 'Copilot prompt',
                value: cmd.prompt,
            });
            if (!prompt) { return; }

            const bpFile = await vscode.window.showInputBox({
                prompt: 'Best practices file path (optional)',
                value: cmd.best_practices_file ?? '',
            });

            model.update(cmd.id, {
                description,
                prompt,
                best_practices_file: bpFile || undefined,
            });
            vscode.window.showInformationMessage(`🐕 Updated command: ${description}`);
        }),

        vscode.commands.registerCommand('eventLoopBluey.deleteCommand', async (item: CommandTreeItem) => {
            const confirm = await vscode.window.showWarningMessage(
                `Delete command "${item.cmd.description}"?`,
                { modal: true },
                'Delete'
            );
            if (confirm === 'Delete') {
                model.remove(item.cmd.id);
            }
        }),

        vscode.commands.registerCommand('eventLoopBluey.openCommandsFile', async () => {
            const filePath = model.getFilePath();
            if (filePath) {
                const doc = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(doc);
            } else {
                vscode.window.showWarningMessage('No commands.json found.');
            }
        }),

        vscode.commands.registerCommand('eventLoopBluey.clearHistory', () => {
            runHistory.clear();
            vscode.window.showInformationMessage('🐕 Run history cleared.');
        }),

        vscode.commands.registerCommand('eventLoopBluey.showRunLog', async (record: { logFile?: string; description?: string; timestamp?: string; status?: string; error?: string }) => {
            if (!record?.logFile) {
                vscode.window.showWarningMessage('🐕 No log file for this run (run was before log capture was added).');
                return;
            }
            const logFile = record.logFile;
            if (!fs.existsSync(logFile)) {
                vscode.window.showWarningMessage(`🐕 Log file not found: ${logFile}`);
                return;
            }
            const doc = await vscode.workspace.openTextDocument(logFile);
            await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
        }),

        vscode.commands.registerCommand('eventLoopBluey.openSettings', () => {
            settingsPanel.show();
        }),

        vscode.commands.registerCommand('eventLoopBluey.exportCommands', async () => {
            const data = model.getExportData();
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('bluey-commands-export.json'),
                filters: { 'JSON': ['json'] },
                title: '🐕 Export Commands',
            });
            if (uri) {
                fs.writeFileSync(uri.fsPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
                vscode.window.showInformationMessage(`🐕 Exported ${data.commands.length} commands to ${uri.fsPath}`);
            }
        }),

        vscode.commands.registerCommand('eventLoopBluey.importCommands', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { 'JSON': ['json'] },
                title: '🐕 Import Commands',
            });
            if (!uris || uris.length === 0) { return; }
            try {
                const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
                const data: CommandsFile = JSON.parse(raw);
                if (!data.commands || !Array.isArray(data.commands)) {
                    vscode.window.showErrorMessage('🐕 Invalid file — no commands array found.');
                    return;
                }
                const mode = await vscode.window.showQuickPick(
                    [
                        { label: 'Merge', description: 'Add imported commands alongside existing ones', value: 'merge' as const },
                        { label: 'Replace', description: 'Replace all existing commands', value: 'replace' as const },
                    ],
                    { title: `🐕 Import ${data.commands.length} commands`, placeHolder: 'How should they be imported?' }
                );
                if (!mode) { return; }
                if (!model.getFilePath()) {
                    const created = await model.initFile();
                    if (!created) {
                        vscode.window.showErrorMessage('🐕 Could not create commands.json — open a workspace folder first.');
                        return;
                    }
                }
                const count = model.importCommands(data, mode.value);
                vscode.window.showInformationMessage(`🐕 Imported ${count} commands (${mode.label}).`);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`🐕 Import failed: ${msg}`);
            }
        }),

        // --- Category commands ---

        vscode.commands.registerCommand('eventLoopBluey.addCategory', async () => {
            const name = await vscode.window.showInputBox({
                prompt: '🐕 Enter category name',
                placeHolder: 'e.g., PR Reviews, Monitoring, Daily Tasks',
            });
            if (!name) { return; }
            model.addCategory(name);
            vscode.window.showInformationMessage(`🐕 Category "${name}" created. Drag commands into it!`);
        }),

        vscode.commands.registerCommand('eventLoopBluey.renameCategory', async (item: CategoryTreeItem) => {
            const newName = await vscode.window.showInputBox({
                prompt: '🐕 New category name',
                value: item.categoryName,
            });
            if (newName && newName !== item.categoryName) {
                model.renameCategory(item.categoryName, newName);
            }
        }),

        vscode.commands.registerCommand('eventLoopBluey.deleteCategory', async (item: CategoryTreeItem) => {
            const answer = await vscode.window.showWarningMessage(
                `Delete category "${item.categoryName}"? Commands will be moved to root.`,
                'Delete', 'Cancel'
            );
            if (answer === 'Delete') {
                model.deleteCategory(item.categoryName);
            }
        }),

        vscode.commands.registerCommand('eventLoopBluey.moveCategoryUp', (item: CategoryTreeItem) => {
            model.moveCategoryUp(item.categoryName);
        }),

        vscode.commands.registerCommand('eventLoopBluey.moveCategoryDown', (item: CategoryTreeItem) => {
            model.moveCategoryDown(item.categoryName);
        }),

        vscode.commands.registerCommand('eventLoopBluey.setCommandCategory', async (item: CommandTreeItem) => {
            const categories = model.getCategories();
            const pick = await vscode.window.showQuickPick(
                ['(No Category)', ...categories, '+ New Category...'],
                { placeHolder: '🐕 Select category' }
            );
            if (!pick) { return; }
            if (pick === '(No Category)') {
                model.update(item.cmd.id, { category: undefined });
            } else if (pick === '+ New Category...') {
                const name = await vscode.window.showInputBox({ prompt: 'Category name' });
                if (name) {
                    model.addCategory(name);
                    model.update(item.cmd.id, { category: name });
                }
            } else {
                model.update(item.cmd.id, { category: pick });
            }
        }),
    ];
}

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Event Loop Bluey 🐕');
    outputChannel.appendLine('🐕 Event Loop Bluey is awake! Woof!');

    // Check prerequisites (async, non-blocking)
    runSetupCheck(outputChannel);

    // --- Core components ---

    const model = new CommandsModel();
    const runHistory = new RunHistory(model);
    const executor = createCopilotExecutor(outputChannel);
    const scheduler = new Scheduler(model, executor, outputChannel, runHistory);
    const logger = new Logger(outputChannel, scheduler, model);
    const statusBar = new StatusBarController(scheduler);
    const detailPanel = new CommandDetailPanel(model);
    const settingsPanel = new SettingsPanel(model);

    // --- TreeViews ---

    const treeProvider = new CommandsTreeProvider(model);
    const treeView = vscode.window.createTreeView('eventLoopBluey.commands', {
        treeDataProvider: treeProvider,
        dragAndDropController: treeProvider,
        showCollapseAll: true,
        canSelectMany: true,
    });

    const historyTreeProvider = new RunHistoryTreeProvider(runHistory);
    const historyTreeView = vscode.window.createTreeView('eventLoopBluey.runHistory', {
        treeDataProvider: historyTreeProvider,
        showCollapseAll: false,
    });

    const updateTreeMessage = () => {
        treeView.message = model.getAll().length === 0
            ? 'No commands.json found. Use "Add Command" to get started.'
            : undefined;
    };
    updateTreeMessage();
    model.onDidChange(updateTreeMessage);

    // Update context key for conditional menu visibility
    const updateContext = () => {
        vscode.commands.executeCommand(
            'setContext',
            'eventLoopBluey.schedulerRunning',
            scheduler.state !== 'stopped',
        );
    };
    updateContext();
    scheduler.events.onStateChange(() => updateContext());

    // --- Command registrations ---

    const cmds = registerCommands(model, scheduler, runHistory, detailPanel, settingsPanel, treeProvider);

    // --- Disposables ---

    context.subscriptions.push(
        outputChannel,
        model,
        runHistory,
        treeProvider,
        treeView,
        historyTreeProvider,
        historyTreeView,
        scheduler,
        statusBar,
        logger,
        detailPanel,
        settingsPanel,
        ...cmds,
    );
}

export function deactivate() {}

import * as vscode from 'vscode';
import { CommandsModel } from './commandsModel';
import { DEFAULT_POST_RUN_TEMPLATE, DEFAULT_POST_RUN_CREATE_TEMPLATE } from './types';
import { escapeHtml } from './utils';

export class SettingsPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(private model: CommandsModel) {
        this.disposables.push(
            model.onDidChange(() => {
                if (this.panel) {
                    this.render();
                }
            })
        );
    }

    show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'eventLoopBluey.settings',
                '🐕 Event Loop Bluey — Settings',
                { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
                { enableScripts: true },
            );
            this.panel.onDidDispose(() => { this.panel = undefined; });

            this.panel.webview.onDidReceiveMessage(msg => {
                if (msg.type === 'save') {
                    this.model.updatePostRunTemplates(msg.postRunTemplate, msg.postRunCreateTemplate);
                    if (msg.terminalTimeout && msg.terminalTimeout >= 1) {
                        vscode.workspace.getConfiguration('eventLoopBluey').update('terminalTimeoutMinutes', msg.terminalTimeout, vscode.ConfigurationTarget.Global);
                    }
                    vscode.window.showInformationMessage('🐕 Settings saved!');
                } else if (msg.type === 'reset') {
                    this.model.updatePostRunTemplates(DEFAULT_POST_RUN_TEMPLATE, DEFAULT_POST_RUN_CREATE_TEMPLATE);
                    vscode.workspace.getConfiguration('eventLoopBluey').update('terminalTimeoutMinutes', undefined, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('🐕 Settings reset to defaults.');
                } else if (msg.type === 'saveCommandsPath') {
                    vscode.workspace.getConfiguration('eventLoopBluey').update('commandsFilePath', msg.path || '', vscode.ConfigurationTarget.Global).then(() => {
                        this.model.reloadFilePath();
                        this.render();
                        vscode.window.showInformationMessage('🐕 Commands file path updated!');
                    });
                } else if (msg.type === 'browseCommandsPath') {
                    this.browseForFile('commands.json', 'JSON', ['json']).then(p => {
                        if (p) {
                            vscode.workspace.getConfiguration('eventLoopBluey').update('commandsFilePath', p, vscode.ConfigurationTarget.Global).then(() => {
                                this.model.reloadFilePath();
                                this.render();
                                vscode.window.showInformationMessage('🐕 Commands file path updated!');
                            });
                        }
                    });
                } else if (msg.type === 'browseBasePath') {
                    vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        title: '🐕 Select base folder for Bluey files',
                    }).then(uris => {
                        if (uris && uris.length > 0) {
                            const basePath = uris[0].fsPath;
                            const cmdPath = require('path').join(basePath, 'commands.json');
                            vscode.workspace.getConfiguration('eventLoopBluey').update('commandsFilePath', cmdPath, vscode.ConfigurationTarget.Global).then(() => {
                                this.model.reloadFilePath();
                                this.render();
                                vscode.window.showInformationMessage(`🐕 Base path set to ${basePath}.`);
                            });
                        }
                    });
                } else if (msg.type === 'saveCliCommand') {
                    vscode.workspace.getConfiguration('eventLoopBluey').update('copilotCliCommand', msg.command || undefined, vscode.ConfigurationTarget.Global).then(() => {
                        this.render();
                        vscode.window.showInformationMessage('🐕 CLI command updated!');
                    });
                } else if (msg.type === 'openExternal') {
                    vscode.env.openExternal(vscode.Uri.parse(msg.url));
                }
            });
        }

        this.render();
    }

    private render(): void {
        if (!this.panel) { return; }

        const postRunTemplate = escapeHtml(this.model.getPostRunTemplate());
        const postRunCreateTemplate = escapeHtml(this.model.getPostRunCreateTemplate());
        const configuredPath = escapeHtml(this.getCommandsFilePath());
        const resolved = this.getResolvedPaths();

        this.panel.webview.html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 16px 24px;
            line-height: 1.6;
        }
        h1 { font-size: 1.5em; margin-bottom: 4px; }
        .title-icon {
            display: inline-block;
            animation: spin 3s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .title-bluey {
            display: inline-block;
            animation: wag 1s ease-in-out infinite;
            transform-origin: bottom center;
        }
        @keyframes wag {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(15deg); }
            75% { transform: rotate(-15deg); }
        }
        h2 {
            font-size: 1.1em;
            color: var(--vscode-textLink-foreground);
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 4px;
            margin-top: 24px;
        }
        .section { margin-bottom: 24px; }
        .desc {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
        }
        .template-editor {
            width: 100%;
            min-height: 120px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 12px 16px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: 1.5;
            resize: vertical;
            white-space: pre-wrap;
            box-sizing: border-box;
        }
        .template-editor:focus { outline: 1px solid var(--vscode-focusBorder); }
        .path-input {
            flex: 1;
            padding: 6px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }
        .path-input:focus { outline: 1px solid var(--vscode-focusBorder); }
        .path-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
        }
        .path-label {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            font-family: var(--vscode-editor-font-family);
            word-break: break-all;
        }
        .btn-small {
            padding: 4px 10px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-small:hover { opacity: 0.85; }
        .actions {
            margin-top: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .btn {
            padding: 6px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            font-weight: 500;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn:hover { opacity: 0.85; }
        .save-status {
            font-size: 0.85em;
            color: var(--vscode-testing-iconPassed);
            transition: opacity 0.5s;
        }
        .variables-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
            font-size: 0.9em;
        }
        .variables-table th, .variables-table td {
            text-align: left;
            padding: 6px 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .variables-table th {
            color: var(--vscode-descriptionForeground);
            font-weight: 600;
        }
        .variables-table code {
            background: var(--vscode-textBlockQuote-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
    </style>
</head>
<body>
    <h1><span class="title-icon">⚙️</span> Event Loop <span class="title-bluey">Bluey 🐕</span> — Settings</h1>
    <p class="desc">Global settings for all commands.</p>

    <div class="section">
        <h2>📁 File Paths</h2>
        <p class="desc">Control where Bluey stores its files. All files (history, best practices, run logs) are stored relative to the commands.json location.</p>

        <div style="margin-top: 12px;">
            <div class="desc" style="font-weight:600;">Commands file (commands.json):</div>
            <div class="path-row">
                <input id="commandsPath" class="path-input" type="text" value="${escapeHtml(configuredPath)}" placeholder="Auto-detected (leave empty)" />
                <button class="btn-small" onclick="browseCommandsPath()">📂 Browse File</button>
                <button class="btn-small" onclick="browseBasePath()">📁 Pick Folder</button>
            </div>
            <div class="path-row">
                <button class="btn-small" onclick="saveCommandsPath()">💾 Save Path</button>
                <button class="btn-small" onclick="clearCommandsPath()">🗑️ Reset to Auto</button>
                <span id="pathSaveStatus" class="save-status"></span>
            </div>
        </div>

        <div style="margin-top: 16px;">
            <div class="desc" style="font-weight:600;">Current resolved paths:</div>
            <table class="variables-table" style="margin-top:4px;">
                <tr><td>📄 Commands file</td><td class="path-label">${escapeHtml(resolved.commandsFile)}</td></tr>
                <tr><td>📁 Base directory</td><td class="path-label">${escapeHtml(resolved.baseDir)}</td></tr>
                <tr><td>📘 Best practices</td><td class="path-label">${escapeHtml(resolved.bestPracticesDir)}</td></tr>
                <tr><td>📜 Run logs</td><td class="path-label">${escapeHtml(resolved.runLogsDir)}</td></tr>
                <tr><td>📊 History file</td><td class="path-label">${escapeHtml(resolved.historyFile)}</td></tr>
            </table>
        </div>
    </div>

    <div class="section">
        <h2>⏱️ Terminal Timeout</h2>
        <p class="desc">How long to wait (in minutes) for a terminal command to finish before timing out.</p>
        <div style="display:flex;align-items:center;gap:12px;">
            <input id="terminalTimeout" type="number" min="1" value="${this.getTerminalTimeout()}"
                style="width:80px;padding:6px 10px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;font-size:1em;" />
            <span class="desc" style="margin:0;">minutes (default: 10)</span>
        </div>
    </div>

    <div class="section">
        <h2>🖥️ CLI Command</h2>
        <p class="desc">The command used to run prompts. Change this if you use an alias like <code>cc</code> or a different tool like <code>agency copilot --allow-all</code>.</p>
        <div class="path-row">
            <input id="cliCommand" class="path-input" type="text" value="${escapeHtml(this.getCliCommand())}" placeholder="copilot --allow-all" />
            <button class="btn-small" onclick="saveCliCommand()">💾 Save</button>
            <button class="btn-small" onclick="resetCliCommand()">↩️ Reset</button>
            <span id="cliSaveStatus" class="save-status"></span>
        </div>
        <div class="desc" style="margin-top:6px;">Default: <code>copilot --allow-all</code> · <a href="#" onclick="openLink('https://eng.ms/docs/coreai/devdiv/one-engineering-system-1es/1es-jacekcz/startrightgitops/agency')" style="color:var(--vscode-textLink-foreground);cursor:pointer;">📖 Agency CLI Docs</a></div>
    </div>

    <hr style="border:none;border-top:1px solid var(--vscode-widget-border);margin:24px 0;" />

    <h2 style="margin-top:0;">📝 Post-Run Templates</h2>
    <p class="desc">Control what instructions get appended to prompts after the main task. These templates apply globally to all commands.</p>

    <div class="section">
        <h2>📝 When best practices file exists (update)</h2>
        <p class="desc">Appended when a command has an existing best practices file and "Auto-update best practices" is on.</p>
        <textarea id="postRunTemplate" class="template-editor">${postRunTemplate}</textarea>
    </div>

    <div class="section">
        <h2>🆕 When best practices file is missing (create)</h2>
        <p class="desc">Appended when no best practices file exists yet and "Auto-create best practices" is on.</p>
        <textarea id="postRunCreateTemplate" class="template-editor">${postRunCreateTemplate}</textarea>
    </div>

    <div class="section">
        <h2>🔤 Available Variables</h2>
        <table class="variables-table">
            <tr><th>Variable</th><th>Description</th></tr>
            <tr><td><code>{{bestPracticesPath}}</code></td><td>Full path to the best practices file</td></tr>
            <tr><td><code>{{commandDescription}}</code></td><td>The command's description</td></tr>
            <tr><td><code>{{commandPrompt}}</code></td><td>The original prompt text</td></tr>
            <tr><td><code>{{commandId}}</code></td><td>The command's numeric ID</td></tr>
        </table>
    </div>

    <div class="actions">
        <button class="btn btn-primary" onclick="save()">💾 Save Templates</button>
        <button class="btn btn-secondary" onclick="resetDefaults()">↩️ Reset to Defaults</button>
        <span id="saveStatus" class="save-status"></span>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        function save() {
            const postRunTemplate = document.getElementById('postRunTemplate').value;
            const postRunCreateTemplate = document.getElementById('postRunCreateTemplate').value;
            const terminalTimeout = parseInt(document.getElementById('terminalTimeout').value, 10);
            vscode.postMessage({ type: 'save', postRunTemplate, postRunCreateTemplate, terminalTimeout });
            const status = document.getElementById('saveStatus');
            if (status) {
                status.textContent = '✅ Saved!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
        function resetDefaults() {
            vscode.postMessage({ type: 'reset' });
        }
        function browseCommandsPath() {
            vscode.postMessage({ type: 'browseCommandsPath' });
        }
        function browseBasePath() {
            vscode.postMessage({ type: 'browseBasePath' });
        }
        function saveCommandsPath() {
            const input = document.getElementById('commandsPath');
            vscode.postMessage({ type: 'saveCommandsPath', path: input ? input.value.trim() : '' });
            const status = document.getElementById('pathSaveStatus');
            if (status) {
                status.textContent = '✅ Saved!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
        function clearCommandsPath() {
            const input = document.getElementById('commandsPath');
            if (input) { input.value = ''; }
            vscode.postMessage({ type: 'saveCommandsPath', path: '' });
            const status = document.getElementById('pathSaveStatus');
            if (status) {
                status.textContent = '✅ Reset to auto-detect!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
        function saveCliCommand() {
            const input = document.getElementById('cliCommand');
            vscode.postMessage({ type: 'saveCliCommand', command: input ? input.value.trim() : '' });
            const status = document.getElementById('cliSaveStatus');
            if (status) {
                status.textContent = '✅ Saved!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
        function resetCliCommand() {
            const input = document.getElementById('cliCommand');
            if (input) { input.value = 'copilot --allow-all'; }
            vscode.postMessage({ type: 'saveCliCommand', command: '' });
            const status = document.getElementById('cliSaveStatus');
            if (status) {
                status.textContent = '✅ Reset to default!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
        function openLink(url) {
            vscode.postMessage({ type: 'openExternal', url });
        }
    </script>
</body>
</html>`;
    }

    private getTerminalTimeout(): number {
        return vscode.workspace.getConfiguration('eventLoopBluey').get<number>('terminalTimeoutMinutes', 10);
    }

    private getCliCommand(): string {
        return vscode.workspace.getConfiguration('eventLoopBluey').get<string>('copilotCliCommand', '') || 'copilot --allow-all';
    }

    private getCommandsFilePath(): string {
        return vscode.workspace.getConfiguration('eventLoopBluey').get<string>('commandsFilePath', '') || '';
    }

    private getResolvedPaths(): { commandsFile: string; baseDir: string; bestPracticesDir: string; runLogsDir: string; historyFile: string } {
        const filePath = this.model.getFilePath();
        if (!filePath) {
            return { commandsFile: '(not found)', baseDir: '(not found)', bestPracticesDir: '', runLogsDir: '', historyFile: '' };
        }
        const baseDir = require('path').dirname(filePath);
        return {
            commandsFile: filePath,
            baseDir,
            bestPracticesDir: require('path').join(baseDir, 'best_practices'),
            runLogsDir: require('path').join(baseDir, 'run_logs'),
            historyFile: require('path').join(baseDir, 'event_loop_bluey_history.json'),
        };
    }

    private async browseForFile(defaultName: string, filterName: string, extensions: string[]): Promise<string | undefined> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { [filterName]: extensions },
            title: `🐕 Select ${defaultName}`,
        });
        return uris?.[0]?.fsPath;
    }

    dispose(): void {
        this.panel?.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Command, DEFAULT_SETTINGS, CommandSchedule } from './types';
import { CommandsModel } from './commandsModel';
import { escapeHtml, generateBestPracticesPath } from './utils';

/**
 * Shows a detail/preview webview panel when a command is selected in the TreeView.
 * Displays the prompt, best practices content, and the final assembled prompt.
 */
export class CommandDetailPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private currentCommandId: number | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(private model: CommandsModel) {
        // Refresh panel when model changes (e.g. after editing)
        this.disposables.push(
            model.onDidChange(() => {
                if (this.currentCommandId !== undefined && this.panel) {
                    const cmd = model.getById(this.currentCommandId);
                    if (cmd) {
                        this.render(cmd);
                    }
                }
            })
        );
    }

    show(cmd: Command): void {
        this.currentCommandId = cmd.id;

        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'eventLoopBluey.commandDetail',
                `🐕 Command #${cmd.id}`,
                { viewColumn: vscode.ViewColumn.One, preserveFocus: true },
                { enableScripts: true },
            );
            this.panel.onDidDispose(() => {
                this.panel = undefined;
                this.currentCommandId = undefined;
            });

            // Handle messages from the webview
            this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
        }

        this.render(cmd);
    }

    private render(cmd: Command): void {
        if (!this.panel) { return; }
        this.panel.title = `🐕 ${cmd.description}`;

        let bestPracticesHtml = '';
        const cmdFilePath = this.model.getFilePath();
        const s = { ...DEFAULT_SETTINGS, ...cmd.settings };

        if (cmdFilePath) {
            let bpFile = cmd.best_practices_file;
            // Show auto-generated path when autoCreate is on but no explicit file
            if (!bpFile && s.autoCreateBestPractices) {
                bpFile = generateBestPracticesPath(cmd.description);
            }

            if (bpFile) {
                const bpPath = path.resolve(path.dirname(cmdFilePath), bpFile);
                if (fs.existsSync(bpPath)) {
                    const bpContent = fs.readFileSync(bpPath, 'utf-8');
                    bestPracticesHtml = `
                        <div class="section">
                            <h2>📘 Best Practices</h2>
                            <p class="file-path">${escapeHtml(bpPath)}</p>
                            <textarea id="bpEditor" class="bp-editor">${escapeHtml(bpContent)}</textarea>
                            <div class="bp-actions">
                                <button class="interval-btn" onclick="saveBestPractices()">💾 Save</button>
                                <button class="interval-btn secondary" onclick="openInEditor()">📝 Open in Editor</button>
                                <span id="bpSaveStatus" class="save-status"></span>
                            </div>
                        </div>`;
                } else {
                    const autoLabel = cmd.best_practices_file ? '' : ' (auto-generated path)';
                    bestPracticesHtml = `
                        <div class="section">
                            <h2>📘 Best Practices</h2>
                            <p class="file-path warning">⚠️ File not found: ${escapeHtml(bpPath)}${autoLabel}</p>
                            <p class="hint">It will be created after the first run (auto-create is ON).</p>
                            <textarea id="bpEditor" class="bp-editor" placeholder="Write best practices here and click Save to create the file..."></textarea>
                            <div class="bp-actions">
                                <button class="interval-btn" onclick="saveBestPractices()">💾 Create & Save</button>
                                <span id="bpSaveStatus" class="save-status"></span>
                            </div>
                        </div>`;
                }
            }
        }

        const fullPrompt = this.model.buildPrompt(cmd);

        const scheduleType = cmd.schedule?.type ?? 'interval';
        const scheduleTime = cmd.schedule?.time ?? '08:00';
        const scheduleDays = cmd.schedule?.daysOfWeek ?? [1]; // default Monday
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayCheckboxes = dayNames.map((name, i) =>
            `<label class="day-checkbox"><input type="checkbox" value="${i}" ${scheduleDays.includes(i) ? 'checked' : ''} />${name}</label>`
        ).join('');

        // Build chain options from all other commands
        const allCommands = this.model.getAll().filter(c => c.id !== cmd.id);
        const chainOptionsHtml = allCommands.map(c =>
            `<option value="${c.id}" ${cmd.onComplete?.commandId === c.id ? 'selected' : ''}>#${c.id} — ${escapeHtml(c.description)}</option>`
        ).join('\n');
        const chainExtraPrompt = cmd.onComplete?.extraPrompt ?? '';
        const chainConditional = cmd.onComplete?.conditional ?? false;
        const chainCondition = cmd.onComplete?.chainCondition ?? '';

        const chainingHtml = `
            <div class="section">
                <h2>🔗 On Complete — Chain to Command</h2>
                <p class="hint">When this command finishes successfully, trigger another command.</p>
                <div class="interval-row">
                    <span>Next command:</span>
                    <select id="chainSelect" class="chain-select">
                        <option value="">None (no chaining)</option>
                        ${chainOptionsHtml}
                    </select>
                </div>
                <div style="margin-top: 8px;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                        <input type="checkbox" id="chainConditional" ${chainConditional ? 'checked' : ''} />
                        <span>🔀 Conditional — only chain if output says to proceed</span>
                    </label>
                </div>
                <div id="chainConditionRow" style="margin-top: 8px; ${chainConditional ? '' : 'display:none;'}">
                    <div class="hint" style="margin-bottom: 4px;">Condition (describe when the chain should proceed):</div>
                    <textarea id="chainCondition" class="bp-editor" style="min-height: 60px;" placeholder="e.g. There are new messages to review">${escapeHtml(chainCondition)}</textarea>
                </div>
                <div style="margin-top: 8px;">
                    <div class="hint" style="margin-bottom: 4px;">Extra prompt to append to the next command:</div>
                    <textarea id="chainExtra" class="bp-editor" style="min-height: 80px;" placeholder="e.g. Use the output from the previous task to...">${escapeHtml(chainExtraPrompt)}</textarea>
                </div>
                <div class="bp-actions">
                    <button class="interval-btn" onclick="saveOnComplete()">💾 Save Chain</button>
                    <span id="chainSaveStatus" class="save-status"></span>
                </div>
            </div>`;

        // Build linked best practices checkboxes
        const linkedIds = cmd.includeBestPracticesFrom ?? [];
        const linkedCheckboxesHtml = allCommands.map(c =>
            `<label class="linked-bp-item">
                <input type="checkbox" value="${c.id}" ${linkedIds.includes(c.id) ? 'checked' : ''} onchange="saveLinkedBP()" />
                <span>#${c.id} — ${escapeHtml(c.description)}</span>
            </label>`
        ).join('\n');

        const linkedBpHtml = allCommands.length > 0 ? `
            <div class="section">
                <h2>📚 Include Best Practices From</h2>
                <p class="hint">Attach best practices files from other commands into this command's prompt.</p>
                <div class="linked-bp-list">
                    ${linkedCheckboxesHtml}
                </div>
                <span id="linkedBpStatus" class="save-status"></span>
            </div>` : '';

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
        h2 {
            font-size: 1.1em;
            color: var(--vscode-textLink-foreground);
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 4px;
            margin-top: 24px;
        }
        .badge {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 10px;
            font-size: 0.85em;
            font-weight: bold;
        }
        .toggle-btn {
            display: inline-block;
            padding: 4px 14px;
            border-radius: 10px;
            font-size: 0.85em;
            font-weight: bold;
            border: none;
            cursor: pointer;
            transition: background 0.2s;
        }
        .toggle-btn.enabled { background: var(--vscode-testing-iconPassed); color: #fff; }
        .toggle-btn.disabled { background: var(--vscode-disabledForeground); color: #fff; }
        .toggle-btn:hover { opacity: 0.85; }
        .enabled { background: var(--vscode-testing-iconPassed); color: #fff; }
        .disabled { background: var(--vscode-disabledForeground); color: #fff; }
        .section { margin-bottom: 20px; }
        .file-path {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            font-family: var(--vscode-editor-font-family);
        }
        .warning { color: var(--vscode-editorWarning-foreground); }
        .hint { font-style: italic; color: var(--vscode-descriptionForeground); }
        pre.content {
            background: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 12px 16px;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            max-height: 400px;
            overflow-y: auto;
        }
        details {
            margin-top: 8px;
        }
        summary {
            cursor: pointer;
            color: var(--vscode-textLink-foreground);
            font-weight: bold;
        }
        .interval-row {
            margin-top: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .interval-input {
            width: 60px;
            padding: 3px 6px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 0.95em;
        }
        .interval-btn {
            padding: 3px 10px;
            border: none;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .interval-btn:hover { opacity: 0.85; }
        .settings-section { margin-top: 20px; }
        .setting-row {
            display: flex; align-items: center; gap: 10px;
            padding: 6px 0; border-bottom: 1px solid var(--vscode-widget-border);
        }
        .setting-toggle {
            width: 40px; height: 22px; border-radius: 11px; border: none;
            cursor: pointer; position: relative; transition: background 0.2s;
        }
        .setting-toggle.on { background: var(--vscode-testing-iconPassed); }
        .setting-toggle.off { background: var(--vscode-disabledForeground); }
        .setting-toggle::after {
            content: ''; position: absolute; top: 3px;
            width: 16px; height: 16px; border-radius: 50%; background: #fff;
            transition: left 0.2s;
        }
        .setting-toggle.on::after { left: 21px; }
        .setting-toggle.off::after { left: 3px; }
        .setting-label { flex: 1; }
        .setting-desc { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
        .bp-editor {
            width: 100%;
            min-height: 200px;
            max-height: 500px;
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
        .bp-editor:focus { outline: 1px solid var(--vscode-focusBorder); }
        .chain-select {
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 0.9em;
            min-width: 250px;
        }
        .linked-bp-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 8px;
        }
        .linked-bp-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
        }
        .linked-bp-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .linked-bp-item input[type="checkbox"] {
            accent-color: var(--vscode-textLink-foreground);
        }
        .bp-actions {
            margin-top: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .interval-btn.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .save-status {
            font-size: 0.85em;
            color: var(--vscode-testing-iconPassed);
            transition: opacity 0.5s;
        }
        .schedule-section { margin-top: 12px; }
        .schedule-section h2 { font-size: 1.1em; margin-bottom: 8px; }
        .schedule-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
        }
        .days-row { flex-wrap: wrap; }
        .day-checkbox {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 2px 6px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
        }
        .day-checkbox input { margin: 0; }
    </style>
</head>
<body>
    <h1>${escapeHtml(cmd.description)}</h1>
    <button id="toggleBtn" class="toggle-btn ${cmd.enabled ? 'enabled' : 'disabled'}" onclick="toggle()">
        ${cmd.enabled ? '✅ Enabled' : '⏸️ Disabled'}
    </button>
    <span style="margin-left: 8px; color: var(--vscode-descriptionForeground);">ID: #${cmd.id}</span>

    <div class="schedule-section">
        <h2>⏱️ Schedule</h2>
        <div class="schedule-row">
            <select id="scheduleType" class="chain-select" onchange="onScheduleTypeChange()">
                <option value="interval" ${scheduleType === 'interval' ? 'selected' : ''}>Every X minutes</option>
                <option value="daily" ${scheduleType === 'daily' ? 'selected' : ''}>Daily</option>
                <option value="weekly" ${scheduleType === 'weekly' ? 'selected' : ''}>Weekly</option>
            </select>
        </div>

        <div id="intervalSection" style="display:${scheduleType === 'interval' ? 'flex' : 'none'}" class="schedule-row">
            <span>Run every</span>
            <input id="intervalInput" class="interval-input" type="number" min="1" value="${cmd.intervalMinutes ?? 10}" />
            <span>minutes</span>
        </div>

        <div id="timeSection" style="display:${scheduleType !== 'interval' ? 'flex' : 'none'}" class="schedule-row">
            <span>At time:</span>
            <input id="scheduleTime" type="time" value="${scheduleTime}" class="interval-input" style="width:100px" />
        </div>

        <div id="daysSection" style="display:${scheduleType === 'weekly' ? 'flex' : 'none'}" class="schedule-row days-row">
            <span>On days:</span>
            ${dayCheckboxes}
        </div>

        <button class="interval-btn" onclick="saveSchedule()" style="margin-top:8px">💾 Save Schedule</button>
        <span id="scheduleSaveStatus" class="save-status"></span>
    </div>

    <div class="section">
        <h2>💬 Prompt</h2>
        <textarea id="promptEditor" class="bp-editor">${escapeHtml(cmd.prompt)}</textarea>
        <div class="bp-actions">
            <button class="interval-btn" onclick="savePrompt()">💾 Save</button>
            <span id="promptSaveStatus" class="save-status"></span>
        </div>
    </div>

    ${bestPracticesHtml}

    ${linkedBpHtml}

    ${chainingHtml}

    <div class="settings-section">
        <h2>⚙️ Settings</h2>
        <div class="setting-row">
            <button class="setting-toggle ${s.autoUpdateBestPractices ? 'on' : 'off'}"
                onclick="toggleSetting('autoUpdateBestPractices')"></button>
            <div class="setting-label">
                Auto-update best practices
                <div class="setting-desc">After each run, ask Copilot to update the best practices file with new learnings</div>
            </div>
        </div>
        <div class="setting-row">
            <button class="setting-toggle ${s.autoCreateBestPractices ? 'on' : 'off'}"
                onclick="toggleSetting('autoCreateBestPractices')"></button>
            <div class="setting-label">
                Auto-create best practices
                <div class="setting-desc">If no best practices file exists, ask Copilot to create one after the run</div>
            </div>
        </div>
    </div>

    <details>
        <summary>🔧 Full Assembled Prompt (what gets sent to Copilot)</summary>
        <pre class="content">${escapeHtml(fullPrompt)}</pre>
    </details>

    <script>
        const vscode = acquireVsCodeApi();
        function toggle() {
            vscode.postMessage({ type: 'toggle' });
        }
        function onScheduleTypeChange() {
            const type = document.getElementById('scheduleType').value;
            document.getElementById('intervalSection').style.display = type === 'interval' ? 'flex' : 'none';
            document.getElementById('timeSection').style.display = type !== 'interval' ? 'flex' : 'none';
            document.getElementById('daysSection').style.display = type === 'weekly' ? 'flex' : 'none';
        }
        function saveSchedule() {
            const type = document.getElementById('scheduleType').value;
            if (type === 'interval') {
                const val = parseInt(document.getElementById('intervalInput').value, 10);
                if (val >= 1) {
                    vscode.postMessage({ type: 'setSchedule', schedule: { type: 'interval' }, minutes: val });
                }
            } else {
                const time = document.getElementById('scheduleTime').value || '08:00';
                const days = [];
                if (type === 'weekly') {
                    document.querySelectorAll('.day-checkbox input:checked').forEach(cb => {
                        days.push(parseInt(cb.value, 10));
                    });
                    if (days.length === 0) { days.push(1); } // default Monday
                }
                const schedule = { type, time };
                if (type === 'weekly') { schedule.daysOfWeek = days; }
                vscode.postMessage({ type: 'setSchedule', schedule });
            }
            const status = document.getElementById('scheduleSaveStatus');
            if (status) {
                status.textContent = '✅ Saved!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
        function toggleSetting(key) {
            vscode.postMessage({ type: 'toggleSetting', key: key });
        }
        function savePrompt() {
            const editor = document.getElementById('promptEditor');
            if (!editor) return;
            vscode.postMessage({ type: 'savePrompt', prompt: editor.value });
            const status = document.getElementById('promptSaveStatus');
            if (status) {
                status.textContent = '✅ Saved!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
        function saveBestPractices() {
            const editor = document.getElementById('bpEditor');
            if (!editor) return;
            vscode.postMessage({ type: 'saveBestPractices', content: editor.value });
            const status = document.getElementById('bpSaveStatus');
            if (status) {
                status.textContent = '✅ Saved!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
        function openInEditor() {
            vscode.postMessage({ type: 'openBestPracticesEditor' });
        }
        function saveOnComplete() {
            const select = document.getElementById('chainSelect');
            const extra = document.getElementById('chainExtra');
            const conditionalCb = document.getElementById('chainConditional');
            const conditionEl = document.getElementById('chainCondition');
            const commandId = select ? parseInt(select.value, 10) || 0 : 0;
            const extraPrompt = extra ? extra.value.trim() : '';
            const conditional = conditionalCb ? conditionalCb.checked : false;
            const chainCondition = conditionEl ? conditionEl.value.trim() : '';
            vscode.postMessage({ type: 'saveOnComplete', commandId: commandId || undefined, extraPrompt, conditional, chainCondition });
            const status = document.getElementById('chainSaveStatus');
            if (status) {
                status.textContent = '✅ Saved!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
        // Toggle condition field visibility
        (function() {
            const cb = document.getElementById('chainConditional');
            const row = document.getElementById('chainConditionRow');
            if (cb && row) {
                cb.addEventListener('change', function() { row.style.display = cb.checked ? '' : 'none'; });
            }
        })();
        function saveLinkedBP() {
            const checkboxes = document.querySelectorAll('.linked-bp-item input[type="checkbox"]');
            const ids = [];
            checkboxes.forEach(cb => { if (cb.checked) ids.push(parseInt(cb.value, 10)); });
            vscode.postMessage({ type: 'saveLinkedBP', ids });
            const status = document.getElementById('linkedBpStatus');
            if (status) {
                status.textContent = '✅ Saved!';
                setTimeout(() => { status.textContent = ''; }, 2000);
            }
        }
    </script>
</body>
</html>`;
    }

    private saveBestPractices(commandId: number, content: string): void {
        const cmd = this.model.getById(commandId);
        const cmdFilePath = this.model.getFilePath();
        if (!cmd || !cmdFilePath) { return; }

        const s = { ...DEFAULT_SETTINGS, ...cmd.settings };
        let bpFile = cmd.best_practices_file;
        if (!bpFile && s.autoCreateBestPractices) {
            bpFile = generateBestPracticesPath(cmd.description);
        }
        if (!bpFile) { return; }

        const bpPath = path.resolve(path.dirname(cmdFilePath), bpFile);
        const dir = path.dirname(bpPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(bpPath, content, 'utf-8');
        vscode.window.showInformationMessage(`🐕 Best practices saved: ${bpFile}`);
    }

    private async openBestPracticesInEditor(commandId: number): Promise<void> {
        const cmd = this.model.getById(commandId);
        const cmdFilePath = this.model.getFilePath();
        if (!cmd || !cmdFilePath) { return; }

        const s = { ...DEFAULT_SETTINGS, ...cmd.settings };
        let bpFile = cmd.best_practices_file;
        if (!bpFile && s.autoCreateBestPractices) {
            bpFile = generateBestPracticesPath(cmd.description);
        }
        if (!bpFile) { return; }

        const bpPath = path.resolve(path.dirname(cmdFilePath), bpFile);
        if (!fs.existsSync(bpPath)) {
            const dir = path.dirname(bpPath);
            if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
            fs.writeFileSync(bpPath, '', 'utf-8');
        }
        const doc = await vscode.workspace.openTextDocument(bpPath);
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    private handleMessage(msg: any): void {
        if (this.currentCommandId === undefined) { return; }
        const handlers: Record<string, () => void> = {
            'toggle': () => this.model.toggle(this.currentCommandId!),
            'setInterval': () => {
                this.model.update(this.currentCommandId!, { intervalMinutes: msg.minutes });
                vscode.window.showInformationMessage(`🐕 Interval set to ${msg.minutes} min`);
            },
            'setSchedule': () => {
                const updates: Partial<Command> = {};
                if (msg.schedule.type === 'interval') {
                    updates.schedule = undefined; // clear schedule, use intervalMinutes
                    if (msg.minutes) { updates.intervalMinutes = msg.minutes; }
                } else {
                    updates.schedule = msg.schedule;
                }
                this.model.update(this.currentCommandId!, updates);
                vscode.window.showInformationMessage('🐕 Schedule updated!');
            },
            'toggleSetting': () => {
                const cmd = this.model.getById(this.currentCommandId!);
                if (cmd) {
                    const current = { ...DEFAULT_SETTINGS, ...cmd.settings };
                    const updated = { ...cmd.settings, [msg.key]: !current[msg.key as keyof typeof current] };
                    this.model.update(this.currentCommandId!, { settings: updated });
                }
            },
            'savePrompt': () => {
                this.model.update(this.currentCommandId!, { prompt: msg.prompt });
                vscode.window.showInformationMessage('🐕 Prompt updated!');
            },
            'saveBestPractices': () => this.saveBestPractices(this.currentCommandId!, msg.content),
            'openBestPracticesEditor': () => this.openBestPracticesInEditor(this.currentCommandId!),
            'saveOnComplete': () => {
                const onComplete = msg.commandId
                    ? {
                        commandId: msg.commandId,
                        extraPrompt: msg.extraPrompt || undefined,
                        conditional: msg.conditional || false,
                        chainCondition: msg.chainCondition || undefined,
                    }
                    : undefined;
                this.model.update(this.currentCommandId!, { onComplete });
                vscode.window.showInformationMessage(
                    onComplete
                        ? `🔗 Chain set → command #${onComplete.commandId}${onComplete.conditional ? ' (conditional)' : ''}`
                        : '🔗 Chain removed'
                );
            },
            'saveLinkedBP': () => {
                const ids = (msg.ids as number[]) || [];
                this.model.update(this.currentCommandId!, {
                    includeBestPracticesFrom: ids.length > 0 ? ids : undefined,
                });
                vscode.window.showInformationMessage(
                    ids.length > 0 ? `📘 Linked ${ids.length} best practices source(s)` : '📘 Linked best practices cleared'
                );
            },
        };
        handlers[msg.type]?.();
    }

    dispose(): void {
        this.panel?.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

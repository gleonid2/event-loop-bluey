import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Command, CommandsFile, DEFAULT_SETTINGS, DEFAULT_POST_RUN_TEMPLATE, DEFAULT_POST_RUN_CREATE_TEMPLATE } from './types';
import { generateBestPracticesPath } from './utils';

export class CommandsModel {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private commands: Command[] = [];
    private categories: string[] = [];
    private postRunTemplate: string = DEFAULT_POST_RUN_TEMPLATE;
    private postRunCreateTemplate: string = DEFAULT_POST_RUN_CREATE_TEMPLATE;
    private filePath: string | undefined;
    private watcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        this.resolveFilePath();
        this.load();
        this.watchFile();
    }

    private resolveFilePath(): void {
        const config = vscode.workspace.getConfiguration('eventLoopBluey');
        const configPath = config.get<string>('commandsFilePath');

        if (configPath) {
            // Use configured path even if file doesn't exist yet (user may be setting up new location)
            this.filePath = configPath;
            return;
        }

        // Look in workspace root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const candidate = path.join(folder.uri.fsPath, 'commands.json');
                if (fs.existsSync(candidate)) {
                    this.filePath = candidate;
                    return;
                }
                // Also check scripts/ subfolder (NEXUS-7 convention)
                const scriptCandidate = path.join(folder.uri.fsPath, 'scripts', 'commands.json');
                if (fs.existsSync(scriptCandidate)) {
                    this.filePath = scriptCandidate;
                    return;
                }
            }
        }

        this.filePath = undefined;
    }

    private watchFile(): void {
        if (!this.filePath) { return; }

        const pattern = new vscode.RelativePattern(
            path.dirname(this.filePath),
            path.basename(this.filePath)
        );
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watcher.onDidChange(() => { this.load(); this._onDidChange.fire(); });
        this.watcher.onDidCreate(() => { this.resolveFilePath(); this.load(); this._onDidChange.fire(); });
        this.watcher.onDidDelete(() => { this.commands = []; this._onDidChange.fire(); });
    }

    load(): void {
        if (!this.filePath || !fs.existsSync(this.filePath)) {
            this.commands = [];
            return;
        }
        try {
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            const data: CommandsFile = JSON.parse(raw);
            this.commands = data.commands ?? [];
            this.categories = data.categories ?? [];
            this.postRunTemplate = data.postRunTemplate ?? DEFAULT_POST_RUN_TEMPLATE;
            this.postRunCreateTemplate = data.postRunCreateTemplate ?? DEFAULT_POST_RUN_CREATE_TEMPLATE;
        } catch {
            this.commands = [];
            vscode.window.showErrorMessage(`Event Loop Bluey: Failed to parse ${this.filePath}`);
        }
    }

    private save(): void {
        if (!this.filePath) { return; }
        const data: CommandsFile = {
            commands: this.commands,
            categories: this.categories.length > 0 ? this.categories : undefined,
            postRunTemplate: this.postRunTemplate,
            postRunCreateTemplate: this.postRunCreateTemplate,
        };
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        this._onDidChange.fire();
    }

    getPostRunTemplate(): string {
        return this.postRunTemplate;
    }

    getPostRunCreateTemplate(): string {
        return this.postRunCreateTemplate;
    }

    updatePostRunTemplates(postRunTemplate: string, postRunCreateTemplate: string): void {
        this.postRunTemplate = postRunTemplate;
        this.postRunCreateTemplate = postRunCreateTemplate;
        this.save();
    }

    getAll(): Command[] {
        return [...this.commands];
    }

    getExportData(): CommandsFile {
        return {
            commands: this.commands,
            categories: this.categories.length > 0 ? this.categories : undefined,
            postRunTemplate: this.postRunTemplate,
            postRunCreateTemplate: this.postRunCreateTemplate,
        };
    }

    importCommands(data: CommandsFile, mode: 'replace' | 'merge'): number {
        const incoming = data.commands ?? [];
        if (mode === 'replace') {
            this.commands = incoming;
        } else {
            // Merge: re-ID incoming commands to avoid collisions
            const maxId = this.commands.length > 0 ? Math.max(...this.commands.map(c => c.id)) : 0;
            const idMap = new Map<number, number>();
            for (let i = 0; i < incoming.length; i++) {
                const newId = maxId + 1 + i;
                idMap.set(incoming[i].id, newId);
                incoming[i].id = newId;
            }
            // Remap onComplete and includeBestPracticesFrom references
            for (const cmd of incoming) {
                if (cmd.onComplete && idMap.has(cmd.onComplete.commandId)) {
                    cmd.onComplete.commandId = idMap.get(cmd.onComplete.commandId)!;
                }
                if (cmd.includeBestPracticesFrom) {
                    cmd.includeBestPracticesFrom = cmd.includeBestPracticesFrom
                        .map(id => idMap.get(id) ?? id);
                }
            }
            this.commands.push(...incoming);
        }
        if (data.postRunTemplate) { this.postRunTemplate = data.postRunTemplate; }
        if (data.postRunCreateTemplate) { this.postRunCreateTemplate = data.postRunCreateTemplate; }
        this.save();
        return incoming.length;
    }

    getEnabled(): Command[] {
        return this.commands.filter(c => c.enabled);
    }

    getById(id: number): Command | undefined {
        return this.commands.find(c => c.id === id);
    }

    getFilePath(): string | undefined {
        return this.filePath;
    }

    /** Re-read the configured path from settings and reload data. */
    reloadFilePath(): void {
        this.resolveFilePath();
        this.load();
        this.watchFile();
    }

    private nextId(): number {
        if (this.commands.length === 0) { return 1; }
        return Math.max(...this.commands.map(c => c.id)) + 1;
    }

    add(description: string, prompt: string, bestPracticesFile?: string, intervalMinutes?: number): Command {
        const cmd: Command = {
            id: this.nextId(),
            enabled: true,
            description,
            prompt,
            best_practices_file: bestPracticesFile,
            intervalMinutes: intervalMinutes ?? 10,
        };
        this.commands.push(cmd);
        this.save();
        return cmd;
    }

    update(id: number, fields: Partial<Omit<Command, 'id'>>): boolean {
        const cmd = this.commands.find(c => c.id === id);
        if (!cmd) { return false; }
        Object.assign(cmd, fields);
        this.save();
        return true;
    }

    toggle(id: number): boolean {
        const cmd = this.commands.find(c => c.id === id);
        if (!cmd) { return false; }
        cmd.enabled = !cmd.enabled;
        this.save();
        return true;
    }

    remove(id: number): boolean {
        const idx = this.commands.findIndex(c => c.id === id);
        if (idx === -1) { return false; }
        this.commands.splice(idx, 1);
        this.save();
        return true;
    }

    /**
     * Build the full prompt for a command, prepending best-practices content
     * and appending the update instruction (same logic as nexus_runner.sh).
     */
    buildPrompt(cmd: Command): string {
        const s = { ...DEFAULT_SETTINGS, ...cmd.settings };

        if (!this.filePath) {
            return this.appendChainInstruction(cmd, cmd.prompt);
        }

        const baseDir = path.dirname(this.filePath);

        // Collect best practices from linked commands
        const linkedBpSections = this.getLinkedBestPractices(cmd, baseDir);

        // If no best_practices_file is set, auto-generate one when autoCreate is on
        let bpFile = cmd.best_practices_file;
        if (!bpFile && s.autoCreateBestPractices) {
            bpFile = generateBestPracticesPath(cmd.description);
        }

        if (!bpFile) {
            if (linkedBpSections) {
                return this.appendChainInstruction(cmd, `${linkedBpSections}\n\nTask:\n${cmd.prompt}`);
            }
            return this.appendChainInstruction(cmd, cmd.prompt);
        }

        const bpPath = path.resolve(baseDir, bpFile);

        if (fs.existsSync(bpPath)) {
            const bpContent = fs.readFileSync(bpPath, 'utf-8').trim();
            let prompt = `Best practices for this task:\n${bpContent}`;
            if (linkedBpSections) {
                prompt += `\n\n${linkedBpSections}`;
            }
            prompt += `\n\nTask:\n${cmd.prompt}`;
            if (s.autoUpdateBestPractices) {
                const postRun = this.interpolateTemplate(this.postRunTemplate, cmd, bpPath);
                prompt += `\n\n${postRun}`;
            }
            return this.appendChainInstruction(cmd, prompt);
        }

        let prompt = cmd.prompt;
        if (s.autoCreateBestPractices) {
            // Ensure the directory exists so Copilot can write the file
            const bpDir = path.dirname(bpPath);
            if (!fs.existsSync(bpDir)) {
                fs.mkdirSync(bpDir, { recursive: true });
            }
            const postRun = this.interpolateTemplate(this.postRunCreateTemplate, cmd, bpPath);
            prompt += `\n\n${postRun}`;
        }
        return this.appendChainInstruction(cmd, prompt);
    }

    private appendChainInstruction(cmd: Command, prompt: string): string {
        if (!cmd.onComplete) { return prompt; }
        const nextCmd = this.commands.find(c => c.id === cmd.onComplete!.commandId);
        const nextDesc = nextCmd ? `"${nextCmd.description}"` : `command #${cmd.onComplete.commandId}`;

        let chainInstr = `\n\nIMPORTANT: This task is chained to ${nextDesc}. If you find any data, URLs, links, or information that should be passed to the next task, you MUST wrap it in [PASS_TO_NEXT] and [/PASS_TO_NEXT] tags. For example: [PASS_TO_NEXT]https://example.com/pr/123[/PASS_TO_NEXT]. Only data inside these tags will be forwarded.`;

        if (cmd.onComplete.conditional) {
            const condition = cmd.onComplete.chainCondition
                ? `Condition: ${cmd.onComplete.chainCondition}`
                : 'Decide based on the results of this task whether the next command should run.';
            chainInstr += `\n\nCONDITIONAL CHAIN: The next command should ONLY be triggered if there is a reason to. ${condition}\nAt the END of your output, you MUST write exactly one of these markers:\n- [CHAIN:PROCEED] — if the next command should run\n- [CHAIN:SKIP] — if there is no need to run the next command\nYou MUST include one of these two markers.`;
        }

        return prompt + chainInstr;
    }

    private interpolateTemplate(template: string, cmd: Command, bpPath: string): string {
        return template
            .replace(/\{\{bestPracticesPath\}\}/g, bpPath)
            .replace(/\{\{commandDescription\}\}/g, cmd.description)
            .replace(/\{\{commandPrompt\}\}/g, cmd.prompt)
            .replace(/\{\{commandId\}\}/g, String(cmd.id));
    }

    private getLinkedBestPractices(cmd: Command, baseDir: string): string {
        if (!cmd.includeBestPracticesFrom || cmd.includeBestPracticesFrom.length === 0) {
            return '';
        }

        const sections: string[] = [];
        for (const linkedId of cmd.includeBestPracticesFrom) {
            const linkedCmd = this.commands.find(c => c.id === linkedId);
            if (!linkedCmd) { continue; }

            let bpFile = linkedCmd.best_practices_file;
            if (!bpFile) {
                const linkedSettings = { ...DEFAULT_SETTINGS, ...linkedCmd.settings };
                if (linkedSettings.autoCreateBestPractices) {
                    bpFile = generateBestPracticesPath(linkedCmd.description);
                }
            }
            if (!bpFile) { continue; }

            const bpPath = path.resolve(baseDir, bpFile);
            if (fs.existsSync(bpPath)) {
                const content = fs.readFileSync(bpPath, 'utf-8').trim();
                if (content) {
                    sections.push(`Best practices from "${linkedCmd.description}" (#${linkedCmd.id}):\n${content}`);
                }
            }
        }

        return sections.join('\n\n');
    }

    /**
     * Initialize a new commands.json in the workspace if none exists.
     */
    async initFile(): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return undefined;
        }

        const target = path.join(workspaceFolders[0].uri.fsPath, 'commands.json');
        if (fs.existsSync(target)) {
            this.filePath = target;
            this.load();
            return target;
        }

        const seed: CommandsFile = {
            commands: [
                {
                    id: 1,
                    enabled: false,
                    description: 'Example command',
                    prompt: 'echo Hello from Event Loop Bluey 🐕',
                }
            ]
        };
        fs.writeFileSync(target, JSON.stringify(seed, null, 2) + '\n', 'utf-8');
        this.filePath = target;
        this.load();
        this.watchFile();
        this._onDidChange.fire();
        return target;
    }

    /** Get all category names (from stored list + any in-use by commands). */
    getCategories(): string[] {
        // Maintain saved order, then append any new categories from commands
        const ordered: string[] = [...this.categories];
        for (const cmd of this.commands) {
            if (cmd.category && !ordered.includes(cmd.category)) {
                ordered.push(cmd.category);
            }
        }
        return ordered;
    }

    addCategory(name: string): void {
        if (!this.categories.includes(name)) {
            this.categories.push(name);
            this.save();
        }
    }

    moveCategoryBefore(name: string, beforeName: string | undefined): void {
        // Remove from current position
        this.categories = this.categories.filter(c => c !== name);
        // Ensure it exists
        if (beforeName) {
            const idx = this.categories.indexOf(beforeName);
            if (idx !== -1) {
                this.categories.splice(idx, 0, name);
            } else {
                this.categories.push(name);
            }
        } else {
            // Move to end
            this.categories.push(name);
        }
        this.save();
    }

    moveCategoryUp(name: string): void {
        const idx = this.categories.indexOf(name);
        if (idx > 0) {
            [this.categories[idx - 1], this.categories[idx]] = [this.categories[idx], this.categories[idx - 1]];
            this.save();
        }
    }

    moveCategoryDown(name: string): void {
        const idx = this.categories.indexOf(name);
        if (idx !== -1 && idx < this.categories.length - 1) {
            [this.categories[idx], this.categories[idx + 1]] = [this.categories[idx + 1], this.categories[idx]];
            this.save();
        }
    }

    renameCategory(oldName: string, newName: string): void {
        for (const cmd of this.commands) {
            if (cmd.category === oldName) {
                cmd.category = newName;
            }
        }
        const idx = this.categories.indexOf(oldName);
        if (idx !== -1) { this.categories[idx] = newName; }
        else { this.categories.push(newName); }
        this.save();
    }

    deleteCategory(name: string): void {
        for (const cmd of this.commands) {
            if (cmd.category === name) {
                cmd.category = undefined;
            }
        }
        this.categories = this.categories.filter(c => c !== name);
        this.save();
    }

    dispose(): void {
        this.watcher?.dispose();
        this._onDidChange.dispose();
    }
}

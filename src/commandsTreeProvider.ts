import * as vscode from 'vscode';
import { Command } from './types';
import { CommandsModel } from './commandsModel';

function formatScheduleShort(cmd: Command): string {
    const schedule = cmd.schedule;
    if (!schedule || schedule.type === 'interval') {
        return `${cmd.intervalMinutes ?? 10}min`;
    }
    const time = schedule.time ?? '08:00';
    if (schedule.type === 'daily') {
        return `daily@${time}`;
    }
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = (schedule.daysOfWeek ?? [1]).map(d => dayNames[d]).join(',');
    return `${days}@${time}`;
}

export type BlueyTreeItem = CategoryTreeItem | CommandTreeItem;

export class CategoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly categoryName: string,
        commandCount: number,
    ) {
        super(categoryName, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `cat-${categoryName}`;
        this.contextValue = 'category';
        this.iconPath = new vscode.ThemeIcon('folder-opened');
        this.description = `${commandCount}`;
    }
}

export class CommandTreeItem extends vscode.TreeItem {
    constructor(public readonly cmd: Command, model: CommandsModel) {
        super(cmd.description, vscode.TreeItemCollapsibleState.None);

        this.id = `cmd-${cmd.id}`;
        const scheduleDesc = formatScheduleShort(cmd);

        // Build description with chain/link indicators
        const badges: string[] = [];
        if (cmd.onComplete) {
            badges.push(`🔗→#${cmd.onComplete.commandId}`);
        }
        if (cmd.includeBestPracticesFrom && cmd.includeBestPracticesFrom.length > 0) {
            badges.push(`📚${cmd.includeBestPracticesFrom.length}`);
        }
        const badgeStr = badges.length > 0 ? ` ${badges.join(' ')}` : '';
        const enabledPrefix = cmd.enabled ? '' : '(disabled) ';
        this.description = `${enabledPrefix}${scheduleDesc}${badgeStr}`;

        this.tooltip = this.buildTooltip(model);

        // Set contextValue based on schedule type for different inline icons
        const schedType = cmd.schedule?.type;
        if (schedType === 'daily' || schedType === 'weekly') {
            this.contextValue = 'command-scheduled';
        } else {
            this.contextValue = 'command-interval';
        }

        this.iconPath = new vscode.ThemeIcon(
            cmd.enabled ? 'pass-filled' : 'circle-large-outline',
            cmd.enabled
                ? new vscode.ThemeColor('testing.iconPassed')
                : new vscode.ThemeColor('disabledForeground')
        );

        // Click to open detail preview
        this.command = {
            command: 'eventLoopBluey.showCommandDetail',
            title: 'Show Command Detail',
            arguments: [this],
        };
    }

    private buildTooltip(model: CommandsModel): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**#${this.cmd.id}** — ${this.cmd.description}\n\n`);
        md.appendMarkdown(`Status: ${this.cmd.enabled ? '✅ Enabled' : '⏸️ Disabled'}\n\n`);
        if (this.cmd.best_practices_file) {
            md.appendMarkdown(`📘 Best practices: \`${this.cmd.best_practices_file}\`\n\n`);
        }
        if (this.cmd.onComplete) {
            const target = model.getById(this.cmd.onComplete.commandId);
            const name = target ? target.description : `#${this.cmd.onComplete.commandId}`;
            md.appendMarkdown(`🔗 Chains to: **${name}**\n\n`);
        }
        if (this.cmd.includeBestPracticesFrom && this.cmd.includeBestPracticesFrom.length > 0) {
            const names = this.cmd.includeBestPracticesFrom.map(id => {
                const c = model.getById(id);
                return c ? `#${id} ${c.description}` : `#${id}`;
            });
            md.appendMarkdown(`📚 Includes best practices from: ${names.join(', ')}\n\n`);
        }
        md.appendMarkdown('---\n\n');
        md.appendCodeblock(this.cmd.prompt, 'text');
        return md;
    }
}

export class CommandsTreeProvider implements vscode.TreeDataProvider<BlueyTreeItem>, vscode.TreeDragAndDropController<BlueyTreeItem> {

    readonly dragMimeTypes = ['application/vnd.code.tree.eventloopbluey'];
    readonly dropMimeTypes = ['application/vnd.code.tree.eventloopbluey'];

    private _onDidChangeTreeData = new vscode.EventEmitter<BlueyTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private model: CommandsModel) {
        model.onDidChange(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BlueyTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: BlueyTreeItem): BlueyTreeItem[] {
        if (!element) {
            // Root level: category folders + uncategorized commands
            const commands = this.model.getAll();
            const categorized = new Map<string, Command[]>();
            const uncategorized: Command[] = [];

            for (const cmd of commands) {
                if (cmd.category) {
                    const list = categorized.get(cmd.category) || [];
                    list.push(cmd);
                    categorized.set(cmd.category, list);
                } else {
                    uncategorized.push(cmd);
                }
            }

            const items: BlueyTreeItem[] = [];

            // Include empty categories from the model
            for (const cat of this.model.getCategories()) {
                const cmds = categorized.get(cat) || [];
                items.push(new CategoryTreeItem(cat, cmds.length));
            }

            // Add uncategorized commands at root
            for (const cmd of uncategorized) {
                items.push(new CommandTreeItem(cmd, this.model));
            }

            return items;
        }

        if (element instanceof CategoryTreeItem) {
            return this.model.getAll()
                .filter(c => c.category === element.categoryName)
                .map(cmd => new CommandTreeItem(cmd, this.model));
        }

        return [];
    }

    getParent(element: BlueyTreeItem): BlueyTreeItem | undefined {
        if (element instanceof CommandTreeItem && element.cmd.category) {
            const count = this.model.getAll().filter(c => c.category === element.cmd.category).length;
            return new CategoryTreeItem(element.cmd.category, count);
        }
        return undefined;
    }

    handleDrag(source: readonly BlueyTreeItem[], dataTransfer: vscode.DataTransfer): void {
        const commandIds = source
            .filter((item): item is CommandTreeItem => item instanceof CommandTreeItem)
            .map(item => item.cmd.id);
        const categoryNames = source
            .filter((item): item is CategoryTreeItem => item instanceof CategoryTreeItem)
            .map(item => item.categoryName);

        const payload = JSON.stringify({ commandIds, categoryNames });
        dataTransfer.set('application/vnd.code.tree.eventloopbluey', new vscode.DataTransferItem(payload));
    }

    handleDrop(target: BlueyTreeItem | undefined, dataTransfer: vscode.DataTransfer): void {
        const raw = dataTransfer.get('application/vnd.code.tree.eventloopbluey');
        if (!raw) { return; }

        const { commandIds, categoryNames }: { commandIds: number[]; categoryNames: string[] } = JSON.parse(raw.value);

        // Handle category reordering (drag category onto another category)
        if (categoryNames.length > 0 && target instanceof CategoryTreeItem) {
            for (const name of categoryNames) {
                if (name !== target.categoryName) {
                    this.model.moveCategoryBefore(name, target.categoryName);
                }
            }
            return;
        }

        // Handle command drag-drop (existing logic)
        if (commandIds.length > 0) {
            let targetCategory: string | undefined;
            if (target instanceof CategoryTreeItem) {
                targetCategory = target.categoryName;
            } else if (target instanceof CommandTreeItem && target.cmd.category) {
                targetCategory = target.cmd.category;
            }

            for (const id of commandIds) {
                this.model.update(id, { category: targetCategory });
            }
        }
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

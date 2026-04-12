export interface CommandSettings {
    autoUpdateBestPractices: boolean;  // append "update best practices" to prompt
    autoCreateBestPractices: boolean;  // create best practices file if missing
}

export const DEFAULT_SETTINGS: CommandSettings = {
    autoUpdateBestPractices: true,
    autoCreateBestPractices: true,
};

export interface OnComplete {
    commandId: number;       // ID of the command to trigger next
    extraPrompt?: string;    // extra text appended to the next command's prompt
    conditional?: boolean;   // if true, chain only triggers when output says so
    chainCondition?: string; // describes when to proceed (shown to AI)
}

export interface CommandSchedule {
    type: 'interval' | 'daily' | 'weekly';
    time?: string;        // HH:MM format (24h), used for daily/weekly
    daysOfWeek?: number[]; // 0=Sun, 1=Mon, ..., 6=Sat — used for weekly
}

export interface Command {
    id: number;
    enabled: boolean;
    description: string;
    prompt: string;
    best_practices_file?: string;
    intervalMinutes?: number; // per-command interval, defaults to 10
    schedule?: CommandSchedule; // advanced scheduling; if set, intervalMinutes is ignored
    settings?: Partial<CommandSettings>;
    onComplete?: OnComplete; // chain: trigger another command when this one finishes
    includeBestPracticesFrom?: number[]; // IDs of other commands whose best practices to include
    category?: string; // category name for visual grouping
}

export interface RunRecord {
    commandId: number;
    description: string;
    timestamp: string;
    status: 'success' | 'failed' | 'running';
    error?: string;
    logFile?: string;
    durationMs?: number;
}

export const DEFAULT_POST_RUN_TEMPLATE =
    `After completing the task, update the best practices file at {{bestPracticesPath}} with any new learnings or improvements discovered.`;

export const DEFAULT_POST_RUN_CREATE_TEMPLATE =
    `After completing the task, create a best practices file at {{bestPracticesPath}} documenting what worked and what to watch out for.`;

export interface CommandsFile {
    commands: Command[];
    categories?: string[]; // persist empty categories
    postRunTemplate?: string;
    postRunCreateTemplate?: string;
}

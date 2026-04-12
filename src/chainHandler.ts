import * as fs from 'fs';
import { Command } from './types';

/** Read log file and return only the OUTPUT section (after '--- OUTPUT ---') */
export function readOutputSection(logFile: string): string {
    if (!logFile || !fs.existsSync(logFile)) { return ''; }
    try {
        const fullLog = fs.readFileSync(logFile, 'utf-8');
        return fullLog.includes('--- OUTPUT ---')
            ? fullLog.substring(fullLog.indexOf('--- OUTPUT ---'))
            : fullLog;
    } catch { return ''; }
}

/** Extract [PASS_TO_NEXT]...[/PASS_TO_NEXT] data from text */
export function extractPassedData(text: string): string {
    const regex = /\[PASS_TO_NEXT\]([\s\S]*?)\[\/PASS_TO_NEXT\]/g;
    const matches: string[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
        matches.push(m[1].trim());
    }
    return matches.join('\n');
}

/** Evaluate whether a conditional chain should proceed based on output markers */
export function evaluateChainCondition(outputSection: string): 'proceed' | 'skip' | 'none' {
    const hasSkip = outputSection.includes('[CHAIN:SKIP]');
    const hasProceed = outputSection.includes('[CHAIN:PROCEED]');
    if (hasSkip) { return 'skip'; }
    if (hasProceed) { return 'proceed'; }
    return 'none';
}

/** Build the extra prompt to pass to the chained command */
export function buildChainExtra(cmd: Command, passedData: string): string | undefined {
    const parts: string[] = [];
    if (passedData) {
        parts.push(`Data from "${cmd.description}":\n${passedData}`);
    }
    if (cmd.onComplete?.extraPrompt) {
        parts.push(cmd.onComplete.extraPrompt);
    }
    return parts.length > 0 ? parts.join('\n\n') : undefined;
}

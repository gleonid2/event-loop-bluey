import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Creates an executor function that pipes prompts to `copilot --allow-all`
 * via a VS Code terminal — the same approach as nexus_runner.sh.
 *
 * When a logFile path is provided, output is also tee'd to that file
 * so run logs can be reviewed later from the Run History panel.
 */
export function createCopilotExecutor(
    outputChannel: vscode.OutputChannel,
): (prompt: string, logFile?: string) => Promise<void> {

    return (prompt: string, logFile?: string): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            const terminalName = `🐕 Bluey Worker`;
            const config = vscode.workspace.getConfiguration('eventLoopBluey');
            const timeoutMinutes = config.get<number>('terminalTimeoutMinutes') ?? 10;
            const isWindows = process.platform === 'win32';
            const cliCommand = config.get<string>('copilotCliCommand') || 'copilot --allow-all';

            // Write prompt to a temp file to avoid shell escaping issues
            const tmpFile = path.join(os.tmpdir(), `bluey_prompt_${Date.now()}.txt`);
            fs.writeFileSync(tmpFile, prompt, 'utf-8');

            // Write log header with prompt (before running)
            if (logFile) {
                const logDir = path.dirname(logFile);
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                const header =
                    `=== Event Loop Bluey Run Log ===\n` +
                    `Time: ${new Date().toLocaleString()}\n` +
                    `\n--- PROMPT ---\n${prompt}\n\n--- OUTPUT ---\n`;
                fs.writeFileSync(logFile, header, 'utf-8');
            }

            // Build shell command based on platform
            let shellCmd: string;
            if (isWindows) {
                // PowerShell commands
                const q = (s: string) => s.replace(/\\/g, '\\\\');
                if (logFile) {
                    shellCmd = `Get-Content "${q(tmpFile)}" | ${cliCommand} 2>&1 | Tee-Object -Append -FilePath "${q(logFile)}"; Remove-Item "${q(tmpFile)}"; exit`;
                } else {
                    shellCmd = `Get-Content "${q(tmpFile)}" | ${cliCommand}; Remove-Item "${q(tmpFile)}"; exit`;
                }
            } else {
                if (logFile) {
                    shellCmd = `cat "${tmpFile}" | ${cliCommand} 2>&1 | tee -a "${logFile}" ; rm -f "${tmpFile}" ; exit`;
                } else {
                    shellCmd = `cat "${tmpFile}" | ${cliCommand} ; rm -f "${tmpFile}" ; exit`;
                }
            }

            // Create a plain terminal (uses user's default shell) and send the command
            const terminal = vscode.window.createTerminal({
                name: terminalName,
                isTransient: true,
            });

            terminal.show(true); // preserve focus = true (don't steal focus)
            terminal.sendText(shellCmd);

            outputChannel.appendLine(`  📺 Opened terminal: ${terminalName}`);

            let settled = false;

            // Safety timeout: configurable max per command
            const timeout = setTimeout(() => {
                if (settled) { return; }
                settled = true;
                closeListener.dispose();
                terminal.dispose();
                outputChannel.appendLine(`  ⚠️ Terminal timed out (${timeoutMinutes} min): ${terminalName}`);
                if (logFile) {
                    fs.appendFileSync(logFile, `\n\n⚠️ Terminal timed out (${timeoutMinutes} min)\n`);
                }
                reject(new Error(`Command timed out after ${timeoutMinutes} minutes`));
            }, timeoutMinutes * 60 * 1000);

            // Listen for terminal close to know when command finishes
            const closeListener = vscode.window.onDidCloseTerminal(t => {
                if (t !== terminal) { return; }
                if (settled) { return; }
                settled = true;
                clearTimeout(timeout);
                closeListener.dispose();
                outputChannel.appendLine(`  📺 Terminal closed: ${terminalName}`);
                if (logFile) {
                    fs.appendFileSync(logFile, `\n\n✅ Terminal closed — run complete.\n`);
                }
                resolve();
            });
        });
    };
}

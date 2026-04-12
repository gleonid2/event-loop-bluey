import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

const AGENCY_DOCS_URL = 'https://eng.ms/docs/coreai/devdiv/one-engineering-system-1es/1es-jacekcz/startrightgitops/agency';
const AGENCY_BIN_PATH = path.join(os.homedir(), '.config', 'agency', 'CurrentVersion');
const ZSHRC_PATH = path.join(os.homedir(), '.zshrc');

const ZSHRC_ALIAS = 'alias cc="cd ~/projects && agency copilot --allow-all"';
const ZSHRC_PATH_BLOCK = [
    '',
    '# Agency CLI',
    `if [[ ":\${PATH}:" != *":${AGENCY_BIN_PATH}:"* ]]; then`,
    `    export PATH="${AGENCY_BIN_PATH}:\${PATH}"`,
    'fi',
    '',
    '# Copilot CLI shortcut',
    ZSHRC_ALIAS,
].join('\n');

interface CheckResult {
    name: string;
    ok: boolean;
    message: string;
}

async function commandExists(cmd: string): Promise<boolean> {
    try {
        if (process.platform === 'win32') {
            // Try 'where' first, then check common npm global paths
            try {
                await execAsync(`where ${cmd}`);
                return true;
            } catch {
                // Check common npm global install locations on Windows
                const appData = process.env.APPDATA || '';
                const npmBin = path.join(appData, 'npm', `${cmd}.cmd`);
                if (appData && fs.existsSync(npmBin)) { return true; }
                // Also try running directly (may be in a PATH that 'where' misses)
                try {
                    await execAsync(`${cmd} --version`);
                    return true;
                } catch { return false; }
            }
        } else {
            await execAsync(`which ${cmd} || test -f ${AGENCY_BIN_PATH}/${cmd}`);
            return true;
        }
    } catch { return false; }
}

async function getVersion(cmd: string): Promise<string | undefined> {
    try {
        const { stdout } = await execAsync(`${cmd} --version`);
        return stdout.trim().split('\n')[0];
    } catch { return undefined; }
}

function zshrcHasAlias(): boolean {
    try {
        const content = fs.readFileSync(ZSHRC_PATH, 'utf-8');
        return content.includes('alias cc=') && content.includes('agency copilot');
    } catch { return false; }
}

function zshrcHasAgencyPath(): boolean {
    try {
        const content = fs.readFileSync(ZSHRC_PATH, 'utf-8');
        return content.includes('.config/agency/CurrentVersion');
    } catch { return false; }
}

async function checkPrerequisites(): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    // Check Node.js
    const nodeVersion = await getVersion('node');
    if (nodeVersion) {
        const major = parseInt(nodeVersion.replace(/^v/, ''), 10);
        results.push({
            name: 'Node.js',
            ok: major >= 18,
            message: major >= 18 ? `✅ Node.js ${nodeVersion}` : `⚠️ Node.js ${nodeVersion} — version 18+ recommended`,
        });
    } else {
        results.push({ name: 'Node.js', ok: false, message: '❌ Node.js not found' });
    }

    // Check npm
    const npmExists = await commandExists('npm');
    results.push({
        name: 'npm',
        ok: npmExists,
        message: npmExists ? '✅ npm available' : '❌ npm not found',
    });

    // Check Agency CLI
    const agencyExists = await commandExists('agency');
    if (agencyExists) {
        const ver = await getVersion('agency');
        results.push({ name: 'Agency', ok: true, message: `✅ Agency ${ver ?? 'installed'}` });
    } else {
        results.push({ name: 'Agency', ok: false, message: '❌ Agency CLI not installed' });
    }

    // Check Copilot CLI
    const copilotExists = await commandExists('copilot');
    results.push({
        name: 'Copilot CLI',
        ok: copilotExists,
        message: copilotExists ? '✅ Copilot CLI installed' : '❌ Copilot CLI not installed',
    });

    // Check shell alias (macOS/Linux only)
    if (process.platform !== 'win32') {
        const hasAlias = zshrcHasAlias();
        results.push({
            name: 'Shell Alias',
            ok: hasAlias,
            message: hasAlias ? '✅ cc alias configured in .zshrc' : '⚠️ cc alias not found in .zshrc',
        });
    }

    return results;
}

export async function runSetupCheck(outputChannel: vscode.OutputChannel): Promise<void> {
    const results = await checkPrerequisites();
    const allOk = results.every(r => r.ok);

    if (allOk) {
        outputChannel.appendLine('🐕 All prerequisites OK!');
        return;
    }

    // Log what's missing
    for (const r of results) {
        outputChannel.appendLine(`  ${r.message}`);
    }

    const missingNode = results.find(r => r.name === 'Node.js' && !r.ok);
    const missingAgency = results.find(r => r.name === 'Agency' && !r.ok);
    const missingCopilot = results.find(r => r.name === 'Copilot CLI' && !r.ok);
    const missingAlias = results.find(r => r.name === 'Shell Alias' && !r.ok);

    if (missingNode) {
        const action = await vscode.window.showWarningMessage(
            '🐕 Event Loop Bluey requires Node.js 18+. Please install it first.',
            'Open Download Page'
        );
        if (action === 'Open Download Page') {
            vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
        }
        return;
    }

    if (missingAgency) {
        const action = await vscode.window.showWarningMessage(
            '🐕 Agency CLI not found. It is required to run Copilot commands. Install it now?',
            'Install Agency',
            'Show Instructions'
        );
        if (action === 'Install Agency') {
            await installAgency(outputChannel);
        } else if (action === 'Show Instructions') {
            showSetupInstructions();
        }
        return;
    }

    if (missingCopilot) {
        const action = await vscode.window.showWarningMessage(
            '🐕 Copilot CLI not found. Event Loop Bluey needs it to run commands. Install it now?',
            'Install Copilot CLI',
            'Show Instructions'
        );
        if (action === 'Install Copilot CLI') {
            await installCopilotCli(outputChannel);
        } else if (action === 'Show Instructions') {
            showSetupInstructions();
        }
    }

    if (missingAlias) {
        const action = await vscode.window.showWarningMessage(
            '🐕 Shell alias "cc" not configured in .zshrc. Add it for quick Copilot access?',
            'Add to .zshrc',
            'Show What Will Be Added'
        );
        if (action === 'Add to .zshrc') {
            await addZshrcConfig(outputChannel);
        } else if (action === 'Show What Will Be Added') {
            showZshrcPreview();
        }
    }
}

async function addZshrcConfig(outputChannel: vscode.OutputChannel): Promise<void> {
    try {
        let content = '';
        try { content = fs.readFileSync(ZSHRC_PATH, 'utf-8'); } catch { /* file may not exist */ }

        let additions = '';

        // Add Agency PATH if missing
        if (!zshrcHasAgencyPath()) {
            additions += '\n\n# Agency CLI\n';
            additions += `if [[ ":\${PATH}:" != *":${AGENCY_BIN_PATH}:"* ]]; then\n`;
            additions += `    export PATH="${AGENCY_BIN_PATH}:\${PATH}"\n`;
            additions += 'fi';
        }

        // Add cc alias if missing
        if (!zshrcHasAlias()) {
            additions += '\n\n# Copilot CLI shortcut\n';
            additions += ZSHRC_ALIAS;
        }

        if (additions) {
            fs.writeFileSync(ZSHRC_PATH, content + additions + '\n', 'utf-8');
            outputChannel.appendLine('🐕 Updated ~/.zshrc with Agency PATH and cc alias');
            vscode.window.showInformationMessage(
                '🐕 Added Agency PATH and cc alias to ~/.zshrc. Run "source ~/.zshrc" or open a new terminal to apply.'
            );
        }
    } catch (err: any) {
        vscode.window.showErrorMessage(`🐕 Failed to update .zshrc: ${err.message}`);
    }
}

function showZshrcPreview(): void {
    const panel = vscode.window.createWebviewPanel(
        'eventLoopBluey.zshrcPreview',
        '🐕 .zshrc Changes Preview',
        vscode.ViewColumn.One,
        {},
    );

    const escapedBlock = ZSHRC_PATH_BLOCK
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    panel.webview.html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 24px 32px;
            line-height: 1.7;
        }
        h1 { font-size: 1.4em; }
        pre {
            background: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 12px 16px;
            font-family: var(--vscode-editor-font-family);
            overflow-x: auto;
            white-space: pre-wrap;
        }
        .info {
            padding: 12px 16px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 0 6px 6px 0;
            margin: 16px 0;
        }
    </style>
</head>
<body>
    <h1>🐕 The following will be appended to ~/.zshrc</h1>
    <pre>${escapedBlock}</pre>
    <div class="info">
        <strong>What this does:</strong><br>
        • Adds Agency CLI to your PATH so it's available in any terminal<br>
        • Creates the <code>cc</code> alias — type <code>cc</code> in any terminal to quickly run Copilot
    </div>
    <p>To apply manually, add the above to <code>~/.zshrc</code> and run <code>source ~/.zshrc</code>.</p>
</body>
</html>`;
}

async function installAgency(outputChannel: vscode.OutputChannel): Promise<void> {
    const isMac = process.platform === 'darwin';

    const terminal = vscode.window.createTerminal({
        name: '🐕 Bluey — Install Agency',
        isTransient: true,
    });
    terminal.show();

    outputChannel.appendLine('🐕 Installing Agency CLI...');

    if (isMac) {
        terminal.sendText('echo "🐕 Installing Agency CLI for macOS..."');
        terminal.sendText('curl -sSfL https://aka.ms/InstallTool.sh | sh -s agency && exec $SHELL -l');
    } else {
        // Windows — unlikely in VS Code terminal on mac, but included for completeness
        terminal.sendText('echo "🐕 Installing Agency CLI for Windows..."');
        terminal.sendText('iex "& { $(irm aka.ms/InstallTool.ps1)} agency"');
    }

    terminal.sendText('echo ""');
    terminal.sendText('echo "✅ Agency installed! Now log in..."');
    terminal.sendText('echo "Type /login when prompted and sign in with your GitHub account (usually your_github_username)."');
    terminal.sendText('echo ""');
    terminal.sendText('agency copilot');

    vscode.window.showInformationMessage(
        '🐕 Installing Agency in the terminal. After install, type /login to authenticate with your GitHub account.',
    );
}

async function installCopilotCli(outputChannel: vscode.OutputChannel): Promise<void> {
    const terminal = vscode.window.createTerminal({
        name: '🐕 Bluey Setup',
        isTransient: true,
    });
    terminal.show();

    outputChannel.appendLine('🐕 Installing Copilot CLI...');

    terminal.sendText('echo "🐕 Installing GitHub Copilot CLI..."');
    terminal.sendText('npm install -g @githubnext/github-copilot-cli');

    terminal.sendText('echo ""');
    terminal.sendText('echo "✅ Installation complete! Now authenticating..."');
    terminal.sendText('echo "A browser window will open — sign in with your GitHub account."');
    terminal.sendText('echo ""');
    terminal.sendText('github-copilot-cli auth');

    terminal.sendText('echo ""');
    terminal.sendText('echo "🐕 All done! You can close this terminal."');
    terminal.sendText('echo "Reload VS Code (Cmd+Shift+P → Reload Window) to start using Event Loop Bluey."');

    vscode.window.showInformationMessage(
        '🐕 Installing Copilot CLI in the terminal. Follow the prompts to authenticate.',
    );
}

function showSetupInstructions(): void {
    const panel = vscode.window.createWebviewPanel(
        'eventLoopBluey.setup',
        '🐕 Event Loop Bluey — Setup',
        vscode.ViewColumn.One,
        {},
    );

    panel.webview.html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 24px 32px;
            line-height: 1.7;
        }
        h1 { font-size: 1.5em; }
        h2 { color: var(--vscode-textLink-foreground); margin-top: 24px; }
        code {
            background: var(--vscode-textBlockQuote-background);
            padding: 2px 8px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
        }
        pre {
            background: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 12px 16px;
            font-family: var(--vscode-editor-font-family);
            overflow-x: auto;
        }
        .step {
            margin: 16px 0;
            padding: 12px 16px;
            border-left: 3px solid var(--vscode-textLink-foreground);
            background: var(--vscode-textBlockQuote-background);
            border-radius: 0 6px 6px 0;
        }
        .step-num {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        a { color: var(--vscode-textLink-foreground); }
    </style>
</head>
<body>
    <h1>🐕 Event Loop Bluey — Setup Guide</h1>
    <p>Follow these steps to get everything working:</p>

    <div class="step">
        <span class="step-num">Step 1:</span> Install Node.js (v18+)<br>
        Download from <code>https://nodejs.org/</code><br>
        Verify: <code>node --version</code>
    </div>

    <div class="step">
        <span class="step-num">Step 2:</span> Install Agency CLI<br>
        <strong>macOS:</strong>
        <pre>curl -sSfL https://aka.ms/InstallTool.sh | sh -s agency && exec $SHELL -l</pre>
        <strong>Windows (PowerShell):</strong>
        <pre>iex "&amp; { $(irm aka.ms/InstallTool.ps1)} agency"</pre>
        More info: <a href="${AGENCY_DOCS_URL}">${AGENCY_DOCS_URL}</a>
    </div>

    <div class="step">
        <span class="step-num">Step 3:</span> Login to Agency<br>
        <pre>agency copilot</pre>
        On first run, type <code>/login</code> and sign in with your GitHub account (usually <code>your_github_username</code>).<br>
        That's it — you're in an interactive AI coding session!
    </div>

    <div class="step">
        <span class="step-num">Step 4:</span> Install GitHub Copilot CLI (optional)<br>
        <pre>npm install -g @githubnext/github-copilot-cli</pre>
        Verify: <code>copilot --version</code>
    </div>

    <div class="step">
        <span class="step-num">Step 5:</span> Configure shell shortcut<br>
        Add to your <code>~/.zshrc</code>:
        <pre># Agency CLI
if [[ ":$PATH:" != *":~/.config/agency/CurrentVersion:"* ]]; then
    export PATH="~/.config/agency/CurrentVersion:$PATH"
fi

# Copilot CLI shortcut
alias cc="cd ~/projects && agency copilot --allow-all"</pre>
        Then run: <code>source ~/.zshrc</code>
    </div>

    <div class="step">
        <span class="step-num">Step 6:</span> Test it works<br>
        <pre>cc</pre>
        Then type a prompt and verify you get a Copilot response.
    </div>

    <div class="step">
        <span class="step-num">Step 7:</span> Reload VS Code<br>
        Press <code>Cmd+Shift+P</code> → <code>Reload Window</code><br>
        Then open the 🐕 sidebar and start adding commands!
    </div>

    <h2>Troubleshooting</h2>
    <ul>
        <li><code>agency: command not found</code> → Ensure <code>~/.config/agency/CurrentVersion</code> is in your PATH</li>
        <li>Login issues → Run <code>agency copilot</code> and type <code>/login</code> to re-authenticate</li>
        <li><code>copilot: command not found</code> → Make sure npm global bin is in your PATH</li>
        <li>Auth errors → Run <code>github-copilot-cli auth</code> again</li>
        <li>Need a Copilot subscription → <code>https://github.com/features/copilot</code></li>
    </ul>
</body>
</html>`;
}

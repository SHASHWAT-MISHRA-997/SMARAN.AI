/**
 * SMARAN.AI Codex.
 *
 * The editor-menu commands are not a second engine. Each one writes a sentence
 * and hands it to the same agent the panel uses, so "write tests for this
 * file" reads the file, writes the tests, runs them and fixes what fails -
 * rather than printing a suggestion the previous version left you to apply
 * yourself.
 */

import * as vscode from 'vscode';
import { AgentPanel } from './agentPanel';

export function activate(context: vscode.ExtensionContext): void {
    const panel = new AgentPanel(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(AgentPanel.viewId, panel, {
            // The transcript of a run is expensive to lose - it is the record
            // of what was changed - so it survives the panel being collapsed.
            webviewOptions: { retainContextWhenHidden: true },
        }),
    );

    const open = () => vscode.commands.executeCommand('smaran-ai.chatView.focus');

    /** The file and selection the person is looking at, named for the agent. */
    const context_ = (): { file?: string; selection?: string } => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return {};
        }
        const file = vscode.workspace.asRelativePath(editor.document.uri);
        const selected = editor.document.getText(editor.selection);
        return { file, selection: selected.trim() ? selected : undefined };
    };

    const task = async (build: (where: { file?: string; selection?: string }) => string | undefined) => {
        const where = context_();
        if (!where.file) {
            vscode.window.showInformationMessage('Open a file first.');
            return;
        }
        const sentence = build(where);
        if (sentence) {
            await panel.submit(sentence);
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('smaran.startAgent', open),

        vscode.commands.registerCommand('smaran.runTask', async () => {
            const text = await vscode.window.showInputBox({
                prompt: 'What should the agent do?',
                placeHolder: 'e.g. add a --json flag to the export command and test it',
            });
            if (text?.trim()) {
                await panel.submit(text.trim());
            }
        }),

        // Explaining changes nothing, and says so, or the agent would happily
        // "improve" the file while answering a question about it.
        vscode.commands.registerCommand('smaran.explainCode', () =>
            task(({ file, selection }) =>
                selection
                    ? `Read ${file} and explain this part of it. Do not change anything.\n\n${selection}`
                    : `Read ${file} and explain what it does. Do not change anything.`,
            ),
        ),

        vscode.commands.registerCommand('smaran.refactorCode', () =>
            task(({ file, selection }) =>
                selection
                    ? `In ${file}, refactor this code. Keep the behaviour identical, and run whatever tests cover it afterwards.\n\n${selection}`
                    : `Refactor ${file}. Keep the behaviour identical, and run whatever tests cover it afterwards.`,
            ),
        ),

        vscode.commands.registerCommand('smaran.generateTests', () =>
            task(({ file }) =>
                `Write tests for ${file}. Look at how the project's existing tests are written and match them. ` +
                `Run the tests when you are done and fix anything that fails.`,
            ),
        ),

        vscode.commands.registerCommand('smaran.fixDiagnostics', () =>
            task(({ file }) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    return undefined;
                }
                const problems = vscode.languages
                    .getDiagnostics(editor.document.uri)
                    .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning)
                    .map((d) => `line ${d.range.start.line + 1}: ${d.message}`);

                if (!problems.length) {
                    vscode.window.showInformationMessage(
                        `No errors or warnings are reported in ${file}.`,
                    );
                    return undefined;
                }
                // The real messages, not "fix the errors" - the agent should
                // be working from what the language server actually said.
                return `Fix these problems in ${file}, then check they are gone:\n\n${problems.join('\n')}`;
            }),
        ),
    );
}

export function deactivate(): void { /* nothing is left running */ }

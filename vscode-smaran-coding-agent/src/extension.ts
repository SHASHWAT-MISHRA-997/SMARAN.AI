import * as vscode from 'vscode';
import { SmaranAgentProvider } from './SmaranAgentProvider';
import { SmaranApiClient } from './apiClient';

export function activate(context: vscode.ExtensionContext) {
  console.log('⚡ SMARAN.AI is now active in your IDE!');

  const client = new SmaranApiClient();
  const provider = new SmaranAgentProvider(context.extensionUri);

  // Register Webview View
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SmaranAgentProvider.viewType,
      provider
    )
  );

  // Status Bar Item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(hubot) SMARAN.AI';
  statusBarItem.tooltip = 'SMARAN.AI (Click to open)';
  statusBarItem.command = 'smaran.startAgent';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 1. Open Console
  context.subscriptions.push(
    vscode.commands.registerCommand('smaran.startAgent', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.smaran-ai-sidebar');
    })
  );

  // 2. Generate Code from Instruction
  context.subscriptions.push(
    vscode.commands.registerCommand('smaran.generateCode', async () => {
      const prompt = await vscode.window.showInputBox({
        prompt: 'Enter prompt for SMARAN.AI...',
        placeHolder: 'e.g. Write a TypeScript debounce utility function with unit tests'
      });
      if (!prompt) return;

      const editor = vscode.window.activeTextEditor;
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'SMARAN.AI: Generating code...',
          cancellable: false
        },
        async () => {
          try {
            const result = await client.askAgent(prompt, editor ? [{
              path: vscode.workspace.asRelativePath(editor.document.uri),
              content: editor.document.getText()
            }] : []);

            if (editor) {
              const pos = editor.selection.active;
              await editor.edit(edit => edit.insert(pos, `\n${result}\n`));
            } else {
              const newDoc = await vscode.workspace.openTextDocument({ content: result, language: 'typescript' });
              await vscode.window.showTextDocument(newDoc);
            }
          } catch (e: any) {
            vscode.window.showErrorMessage(`SMARAN.AI Error: ${e.message}`);
          }
        }
      );
    })
  );

  // 3. Explain Selected Code
  context.subscriptions.push(
    vscode.commands.registerCommand('smaran.explainCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Please select a block of code to explain.');
        return;
      }

      const selectedCode = editor.document.getText(editor.selection);
      await vscode.commands.executeCommand('workbench.view.extension.smaran-coding-agent-sidebar');
      // Trigger explain prompt in webview
    })
  );

  // 4. Refactor Selection
  context.subscriptions.push(
    vscode.commands.registerCommand('smaran.refactorCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Please select code to refactor.');
        return;
      }

      const selectedText = editor.document.getText(editor.selection);
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'SMARAN.AI: Refactoring code...',
          cancellable: false
        },
        async () => {
          try {
            const prompt = `Refactor the following code to be cleaner, more performant, and type-safe. Return ONLY the refactored code without markdown:\n\n${selectedText}`;
            const refactored = await client.askAgent(prompt);
            await editor.edit(edit => edit.replace(editor.selection, refactored.trim()));
            vscode.window.showInformationMessage('⚡ SMARAN.AI: Refactoring applied!');
          } catch (e: any) {
            vscode.window.showErrorMessage(`Refactoring error: ${e.message}`);
          }
        }
      );
    })
  );

  // 5. Generate Unit Tests
  context.subscriptions.push(
    vscode.commands.registerCommand('smaran.generateTests', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const code = !editor.selection.isEmpty ? editor.document.getText(editor.selection) : editor.document.getText();
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'SMARAN.AI: Synthesizing test suite...',
          cancellable: false
        },
        async () => {
          try {
            const prompt = `Generate a comprehensive unit test suite with 100% coverage using Vitest/Jest for the following code:\n\n${code}`;
            const tests = await client.askAgent(prompt);
            const testDoc = await vscode.workspace.openTextDocument({ content: tests, language: 'typescript' });
            await vscode.window.showTextDocument(testDoc, { viewColumn: vscode.ViewColumn.Beside });
          } catch (e: any) {
            vscode.window.showErrorMessage(`Test generation failed: ${e.message}`);
          }
        }
      );
    })
  );

  // 6. Auto-Fix Diagnostic Errors
  context.subscriptions.push(
    vscode.commands.registerCommand('smaran.fixDiagnostics', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const uri = editor.document.uri;
      const diagnostics = vscode.languages.getDiagnostics(uri);
      if (diagnostics.length === 0) {
        vscode.window.showInformationMessage('No active diagnostics or lint errors found in this file! 🎉');
        return;
      }

      const errorsText = diagnostics.map(d => `Line ${d.range.start.line + 1}: ${d.message}`).join('\n');
      const prompt = `Fix the following compile/lint errors in the file:\n${errorsText}\n\nFull Source:\n${editor.document.getText()}`;

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'SMARAN.AI: Fixing errors...',
          cancellable: false
        },
        async () => {
          try {
            const fixed = await client.askAgent(prompt);
            const firstLine = editor.document.lineAt(0);
            const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
            const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
            await editor.edit(edit => edit.replace(fullRange, fixed));
            vscode.window.showInformationMessage('⚡ SMARAN.AI: Diagnostic errors repaired!');
          } catch (e: any) {
            vscode.window.showErrorMessage(`Fix failed: ${e.message}`);
          }
        }
      );
    })
  );
}

export function deactivate() {
  console.log('SMARAN.AI Coding Agent deactivated.');
}

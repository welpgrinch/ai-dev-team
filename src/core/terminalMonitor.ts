import * as vscode from 'vscode';
import { ActivityLog } from './activityLog';
import { stripAnsi } from '../tools/commandRunner';

/** Records commands the user runs in VS Code terminals (requires shell integration). */
export class TerminalMonitor implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pending = new Map<vscode.TerminalShellExecution, Promise<string>>();

  constructor(private readonly log: ActivityLog) {
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution((e) => {
        const command = e.execution.commandLine.value.trim();
        if (!command) {
          return;
        }
        this.log.append('command', 'user', command, { command, source: 'terminal', terminal: e.terminal.name });
        this.pending.set(e.execution, this.readOutput(e.execution));
      }),
      vscode.window.onDidEndTerminalShellExecution(async (e) => {
        const command = e.execution.commandLine.value.trim();
        if (!command) {
          return;
        }
        const output = (await this.pending.get(e.execution)) ?? '';
        this.pending.delete(e.execution);
        this.log.append('command-result', 'user', `exit ${e.exitCode ?? '?'}: ${command}`, {
          command,
          exitCode: e.exitCode,
          output: output.slice(0, 6000),
          source: 'terminal',
        });
        if (e.exitCode !== undefined && e.exitCode !== 0) {
          this.log.append('error', 'user', `Terminal command failed (${e.exitCode}): ${command}`, { command, exitCode: e.exitCode });
        }
      }),
    );
  }

  private async readOutput(execution: vscode.TerminalShellExecution): Promise<string> {
    let out = '';
    try {
      for await (const chunk of execution.read()) {
        out += chunk;
        if (out.length > 60_000) {
          break;
        }
      }
    } catch {
      // stream closed early
    }
    return stripAnsi(out);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

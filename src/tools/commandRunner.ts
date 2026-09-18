import { spawn } from 'child_process';
import * as vscode from 'vscode';

export interface CommandResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+["']?([\/~]|[a-z]:\\)\s*["']?(\s|$)/i,
  /\bformat(\.com)?\s+[a-z]:/i,
  /\b(rd|rmdir)\s+\/s\s+\/q\s+["']?[a-z]:\\["']?\s*$/i,
  /Remove-Item\s+["']?[a-z]:\\["']?\s+-Recurse/i,
  /\bmkfs\b/i,
  /\bshutdown\b|\breboot\b/i,
  /\bdiskpart\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

export function isCommandDenied(command: string): string | undefined {
  for (const p of DENY_PATTERNS) {
    if (p.test(command)) {
      return `Command blocked by safety policy: ${command}`;
    }
  }
  return undefined;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

export function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  token?: vscode.CancellationToken,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const chunks: string[] = [];
    let size = 0;
    let timedOut = false;
    const MAX = 200_000;

    const child = spawn(command, { cwd, shell: true, env: process.env, windowsHide: true });
    const collect = (buf: Buffer) => {
      if (size < MAX) {
        const text = buf.toString('utf8');
        chunks.push(text);
        size += text.length;
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const cancel = token?.onCancellationRequested(() => child.kill());

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      cancel?.dispose();
      resolve({ exitCode, output: stripAnsi(chunks.join('')), timedOut, durationMs: Date.now() - start });
    };
    child.on('error', (err) => {
      chunks.push(`\n[spawn error] ${err.message}`);
      finish(-1);
    });
    child.on('close', (code) => finish(code));
  });
}

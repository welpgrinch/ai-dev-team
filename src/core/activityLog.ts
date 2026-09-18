import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Actor } from '../agents/types';

export type LogEventType =
  | 'session-start'
  | 'session-end'
  | 'handoff'
  | 'decision'
  | 'approval'
  | 'agent-output'
  | 'command'
  | 'command-result'
  | 'file-created'
  | 'file-modified'
  | 'file-deleted'
  | 'test-result'
  | 'debug-action'
  | 'error'
  | 'warning'
  | 'architecture-version'
  | 'model-assignment';

export interface LogEvent {
  ts: string;
  session: string;
  type: LogEventType;
  actor: Actor;
  message: string;
  data?: Record<string, unknown>;
}

export function newSessionId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Append-only JSONL development activity log — the record of what actually happened. */
export class ActivityLog implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<LogEvent>();
  readonly onDidAppend = this.emitter.event;
  sessionId: string;

  constructor(
    private readonly logsDir: string,
    private readonly output: vscode.OutputChannel,
  ) {
    this.sessionId = newSessionId();
  }

  get file(): string {
    return path.join(this.logsDir, `${this.sessionId}.jsonl`);
  }

  append(type: LogEventType, actor: Actor, message: string, data?: Record<string, unknown>): LogEvent {
    const evt: LogEvent = { ts: new Date().toISOString(), session: this.sessionId, type, actor, message, data };
    fs.mkdirSync(this.logsDir, { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(evt) + '\n', 'utf8');
    const time = evt.ts.substring(11, 19);
    this.output.appendLine(`[${time}] ${actor.toUpperCase().padEnd(15)} ${type.padEnd(16)} ${message}`);
    this.emitter.fire(evt);
    return evt;
  }

  handoff(from: Actor, to: Actor, message: string, data?: Record<string, unknown>): LogEvent {
    return this.append('handoff', from, `→ ${to}: ${message}`, { ...data, to });
  }

  readSession(sessionId = this.sessionId): LogEvent[] {
    const file = path.join(this.logsDir, `${sessionId}.jsonl`);
    if (!fs.existsSync(file)) {
      return [];
    }
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LogEvent);
  }

  startNewSession(): string {
    this.sessionId = newSessionId();
    return this.sessionId;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

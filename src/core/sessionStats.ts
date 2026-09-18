import { LogEvent } from './activityLog';

export interface SessionStats {
  tasksAssigned: number;
  tasksCompleted: number;
  tasksRemaining: number;
  codeSegments: number;
  testsExecuted: number;
  testsPassed: number;
  testsFailed: number;
  errorsDiscovered: number;
  errorsFixed: number;
  unresolvedProblems: number;
  warnings: number;
  debuggingCycles: number;
  successfulFixes: number;
  filesCreated: number;
  filesModified: number;
  filesDeleted: number;
  commandsExecuted: number;
  gitOperations: number;
  handoffs: number;
}

/** Derives measurable session statistics from the activity log instead of from an AI's memory. */
export function computeStats(events: LogEvent[]): SessionStats {
  const s: SessionStats = {
    tasksAssigned: 0,
    tasksCompleted: 0,
    tasksRemaining: 0,
    codeSegments: 0,
    testsExecuted: 0,
    testsPassed: 0,
    testsFailed: 0,
    errorsDiscovered: 0,
    errorsFixed: 0,
    unresolvedProblems: 0,
    warnings: 0,
    debuggingCycles: 0,
    successfulFixes: 0,
    filesCreated: 0,
    filesModified: 0,
    filesDeleted: 0,
    commandsExecuted: 0,
    gitOperations: 0,
    handoffs: 0,
  };

  const created = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();
  const testsBySegment = new Map<string, { status: string; failures: number }[]>();

  for (const e of events) {
    const seg = String(e.data?.segmentId ?? '');
    switch (e.type) {
      case 'handoff':
        s.handoffs++;
        if (e.data?.to === 'coder' && e.data?.task) {
          s.tasksAssigned++;
        }
        if (e.data?.to === 'debugger') {
          s.debuggingCycles++;
        }
        break;
      case 'approval':
        if (e.data?.segmentId) {
          s.tasksCompleted++;
        }
        break;
      case 'agent-output':
        if (e.actor === 'coder') {
          s.codeSegments++;
        }
        break;
      case 'test-result': {
        s.testsExecuted++;
        const failures = Array.isArray(e.data?.failures) ? (e.data!.failures as unknown[]).length : 0;
        if (e.data?.status === 'pass') {
          s.testsPassed++;
        } else {
          s.testsFailed++;
          s.errorsDiscovered += Math.max(1, failures);
        }
        const list = testsBySegment.get(seg) ?? [];
        list.push({ status: String(e.data?.status), failures: Math.max(1, failures) });
        testsBySegment.set(seg, list);
        break;
      }
      case 'debug-action':
        if (e.data?.fixApplied !== false) {
          s.successfulFixes++;
        }
        break;
      case 'error':
        s.errorsDiscovered++;
        break;
      case 'warning':
        s.warnings++;
        break;
      case 'command':
        s.commandsExecuted++;
        if (/^\s*git\b/.test(e.message)) {
          s.gitOperations++;
        }
        break;
      case 'file-created':
        created.add(String(e.data?.path ?? e.message));
        break;
      case 'file-modified':
        modified.add(String(e.data?.path ?? e.message));
        break;
      case 'file-deleted':
        deleted.add(String(e.data?.path ?? e.message));
        break;
    }
  }

  for (const results of testsBySegment.values()) {
    const failed = results.filter((r) => r.status !== 'pass');
    if (!failed.length) {
      continue;
    }
    const last = results[results.length - 1];
    if (last.status === 'pass') {
      s.errorsFixed += failed.reduce((a, r) => a + r.failures, 0);
    } else {
      s.errorsFixed += failed.slice(0, -1).reduce((a, r) => a + r.failures, 0);
      s.unresolvedProblems += last.failures;
    }
  }

  s.filesCreated = created.size;
  s.filesModified = [...modified].filter((p) => !created.has(p)).length;
  s.filesDeleted = deleted.size;
  s.tasksRemaining = Math.max(0, s.tasksAssigned - s.tasksCompleted);
  return s;
}

export function statsToMarkdown(title: string, s: SessionStats): string {
  return [
    `**${title}**`,
    '',
    '| Metric | Count |',
    '|---|---:|',
    `| Tasks assigned | ${s.tasksAssigned} |`,
    `| Tasks completed | ${s.tasksCompleted} |`,
    `| Tasks remaining | ${s.tasksRemaining} |`,
    `| Code segments created | ${s.codeSegments} |`,
    `| Tests executed | ${s.testsExecuted} |`,
    `| Tests passed | ${s.testsPassed} |`,
    `| Tests failed | ${s.testsFailed} |`,
    `| Errors discovered | ${s.errorsDiscovered} |`,
    `| Errors fixed | ${s.errorsFixed} |`,
    `| Unresolved problems | ${s.unresolvedProblems} |`,
    `| Warnings | ${s.warnings} |`,
    `| Debugging cycles | ${s.debuggingCycles} |`,
    `| Successful fixes | ${s.successfulFixes} |`,
    `| Files created | ${s.filesCreated} |`,
    `| Files modified | ${s.filesModified} |`,
    `| Files deleted | ${s.filesDeleted} |`,
    `| Terminal commands executed | ${s.commandsExecuted} |`,
    `| Git operations | ${s.gitOperations} |`,
    `| Agent handoffs | ${s.handoffs} |`,
  ].join('\n');
}

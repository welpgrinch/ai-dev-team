import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentRole } from '../agents/types';
import { ActivityLog } from '../core/activityLog';
import { ProjectPaths } from '../core/paths';
import { RecentWrites } from '../core/recentWrites';
import { isCommandDenied, runCommand } from './commandRunner';

export interface AgentTool {
  definition: vscode.LanguageModelChatTool;
  run(input: unknown, token: vscode.CancellationToken): Promise<string>;
}

export interface ToolOptions {
  paths: ProjectPaths;
  log: ActivityLog;
  recentWrites: RecentWrites;
  actor: AgentRole;
  allowWrite: boolean;
  allowCommands: boolean;
  commandTimeoutMs: number;
  forbiddenFiles?: string[];
  segmentId?: string;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.aidevteam', '.venv', '__pycache__', 'build', '.next']);
const MAX_TOOL_OUTPUT = 14_000;

function clip(text: string, max = MAX_TOOL_OUTPUT): string {
  return text.length > max ? text.slice(0, max) + `\n…[truncated ${text.length - max} chars]` : text;
}

function str(input: unknown, key: string): string {
  const v = (input as Record<string, unknown> | undefined)?.[key];
  return typeof v === 'string' ? v : '';
}

function num(input: unknown, key: string): number | undefined {
  const v = (input as Record<string, unknown> | undefined)?.[key];
  return typeof v === 'number' ? v : undefined;
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function isForbidden(rel: string, forbidden: string[] = []): boolean {
  const n = normalizeRel(rel).toLowerCase();
  return forbidden.some((f) => {
    const fn = normalizeRel(f).toLowerCase();
    if (!fn) {
      return false;
    }
    if (fn.endsWith('/')) {
      return n.startsWith(fn);
    }
    if (fn.includes('*')) {
      const re = new RegExp('^' + fn.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      return re.test(n);
    }
    return n === fn;
  });
}

function listDir(root: string, dir: string, depth: number, out: string[], limit: number): void {
  if (out.length >= limit || depth < 0) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (out.length >= limit) {
      return;
    }
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) {
      continue;
    }
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    out.push(e.isDirectory() ? rel + '/' : rel);
    if (e.isDirectory()) {
      listDir(root, full, depth - 1, out, limit);
    }
  }
}

export function createWorkspaceTools(o: ToolOptions): AgentTool[] {
  const root = o.paths.root;
  const tools: AgentTool[] = [];

  tools.push({
    definition: {
      name: 'list_files',
      description: 'List files and folders in the workspace (relative paths). Skips node_modules, .git and build output.',
      inputSchema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory relative to workspace root. Default: root.' },
          maxDepth: { type: 'number', description: 'Recursion depth. Default 3.' },
        },
      },
    },
    async run(input) {
      const dir = o.paths.resolveInside(str(input, 'dir') || '.');
      const out: string[] = [];
      listDir(root, dir, num(input, 'maxDepth') ?? 3, out, 600);
      return out.length ? out.join('\n') : '(empty)';
    },
  });

  tools.push({
    definition: {
      name: 'read_file',
      description: 'Read a text file from the workspace. Optionally limit to a line range.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative path' },
          startLine: { type: 'number', description: '1-based first line (optional)' },
          endLine: { type: 'number', description: '1-based last line, inclusive (optional)' },
        },
        required: ['path'],
      },
    },
    async run(input) {
      const rel = str(input, 'path');
      const full = o.paths.resolveInside(rel);
      if (!fs.existsSync(full)) {
        return `File not found: ${rel}`;
      }
      if (fs.statSync(full).isDirectory()) {
        return `"${rel}" is a directory. Use list_files.`;
      }
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      const start = Math.max(1, num(input, 'startLine') ?? 1);
      const end = Math.min(lines.length, num(input, 'endLine') ?? lines.length);
      const body = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(4)}| ${l}`).join('\n');
      return clip(`${rel} (lines ${start}-${end} of ${lines.length})\n${body}`);
    },
  });

  tools.push({
    definition: {
      name: 'find_files',
      description: 'Find files by glob pattern (e.g. "src/**/*.ts"). Returns workspace-relative paths.',
      inputSchema: {
        type: 'object',
        properties: { glob: { type: 'string' } },
        required: ['glob'],
      },
    },
    async run(input, token) {
      const pattern = new vscode.RelativePattern(root, str(input, 'glob') || '**/*');
      const uris = await vscode.workspace.findFiles(pattern, '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/.aidevteam/**}', 300, token);
      return uris.length ? uris.map((u) => o.paths.toRelative(u.fsPath)).sort().join('\n') : '(no matches)';
    },
  });

  if (o.allowWrite) {
    tools.push({
      definition: {
        name: 'write_file',
        description: 'Create or overwrite a text file in the workspace with the full content. Parent folders are created automatically.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative path' },
            content: { type: 'string', description: 'Complete file content' },
          },
          required: ['path', 'content'],
        },
      },
      async run(input) {
        const rel = normalizeRel(str(input, 'path'));
        if (!rel) {
          return 'Error: path is required';
        }
        if (isForbidden(rel, o.forbiddenFiles)) {
          o.log.append('warning', o.actor, `Blocked write to protected file ${rel}`, { path: rel, segmentId: o.segmentId });
          return `Error: "${rel}" is listed as a file that must not be changed in this task.`;
        }
        const full = o.paths.resolveInside(rel);
        if (o.paths.isInternal(full)) {
          return `Error: writing inside "${rel}" is not allowed.`;
        }
        const existed = fs.existsSync(full);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        o.recentWrites.mark(full);
        fs.writeFileSync(full, str(input, 'content'), 'utf8');
        o.log.append(existed ? 'file-modified' : 'file-created', o.actor, rel, { path: rel, segmentId: o.segmentId, bytes: str(input, 'content').length });
        return `${existed ? 'Modified' : 'Created'} ${rel}`;
      },
    });

    tools.push({
      definition: {
        name: 'delete_file',
        description: 'Delete a single file in the workspace.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      async run(input) {
        const rel = normalizeRel(str(input, 'path'));
        if (isForbidden(rel, o.forbiddenFiles)) {
          return `Error: "${rel}" must not be changed in this task.`;
        }
        const full = o.paths.resolveInside(rel);
        if (o.paths.isInternal(full) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
          return `Error: cannot delete "${rel}".`;
        }
        o.recentWrites.mark(full);
        fs.unlinkSync(full);
        o.log.append('file-deleted', o.actor, rel, { path: rel, segmentId: o.segmentId });
        return `Deleted ${rel}`;
      },
    });
  }

  if (o.allowCommands) {
    tools.push({
      definition: {
        name: 'run_command',
        description:
          'Run a shell command in the workspace root (Windows: cmd.exe; otherwise /bin/sh). Use for installing dependencies, building, running tests, git. Returns exit code and combined output. Never run interactive or long-lived commands (servers, watchers).',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            cwd: { type: 'string', description: 'Optional workspace-relative working directory' },
          },
          required: ['command'],
        },
      },
      async run(input, token) {
        const command = str(input, 'command').trim();
        if (!command) {
          return 'Error: command is required';
        }
        const denied = isCommandDenied(command);
        if (denied) {
          o.log.append('warning', o.actor, denied, { command, segmentId: o.segmentId });
          return denied;
        }
        const cwd = o.paths.resolveInside(str(input, 'cwd') || '.');
        o.log.append('command', o.actor, command, { command, cwd: o.paths.toRelative(cwd) || '.', source: 'agent', segmentId: o.segmentId });
        const result = await runCommand(command, cwd, o.commandTimeoutMs, token);
        o.log.append(
          'command-result',
          o.actor,
          `exit ${result.exitCode}${result.timedOut ? ' (timed out)' : ''} after ${result.durationMs} ms: ${command}`,
          {
            command,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
            output: clip(result.output, 6000),
            segmentId: o.segmentId,
          },
        );
        if (result.exitCode !== 0) {
          o.log.append('error', o.actor, `Command failed (${result.exitCode}): ${command}`, { command, exitCode: result.exitCode, segmentId: o.segmentId });
        }
        return clip(`exit code: ${result.exitCode}${result.timedOut ? ' (TIMED OUT)' : ''}\n${result.output || '(no output)'}`);
      },
    });
  }

  return tools;
}

/** Read-only web access for the Research agent. */
export function createResearchTools(log: ActivityLog): AgentTool[] {
  return [
    {
      definition: {
        name: 'fetch_url',
        description: 'Fetch a public web page (http/https) and return its readable text content for research purposes.',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
      },
      async run(input, token) {
        const url = str(input, 'url');
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return 'Error: invalid URL';
        }
        if (!/^https?:$/.test(parsed.protocol)) {
          return 'Error: only http/https URLs are allowed';
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        const cancel = token.onCancellationRequested(() => controller.abort());
        try {
          const res = await fetch(parsed.toString(), {
            signal: controller.signal,
            headers: { 'user-agent': 'ai-dev-team-vscode/0.1 (+research)' },
            redirect: 'follow',
          });
          const type = res.headers.get('content-type') ?? '';
          if (!/text|json|xml/.test(type)) {
            return `Error: unsupported content type ${type}`;
          }
          const raw = await res.text();
          log.append('agent-output', 'research', `Fetched ${parsed.hostname}${parsed.pathname}`, { url: parsed.toString(), status: res.status });
          return clip(`${res.status} ${parsed}\n\n${htmlToText(raw)}`);
        } catch (err) {
          return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
        } finally {
          clearTimeout(timer);
          cancel.dispose();
        }
      },
    },
  ];
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

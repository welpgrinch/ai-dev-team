import { LogEvent } from '../core/activityLog';
import { SessionStats, statsToMarkdown } from '../core/sessionStats';
import { AgentContext, BaseAgent, truncate } from './base';
import { SUMMARIZER_PROMPT } from './prompts';

export interface ChapterInput {
  chapterNumber: number;
  sessionId: string;
  projectName: string;
  memoryContext: string;
  events: LogEvent[];
  stats: SessionStats;
}

export class SummarizerAgent extends BaseAgent {
  constructor() {
    super('summarizer', 'Summarizer', SUMMARIZER_PROMPT);
  }

  async summarizeRequirements(ctx: AgentContext, refined: string, research: string, review: string): Promise<string> {
    this.progress(ctx, 'writing the requirements summary for the Architect…');
    const prompt = [
      `# Refined project concept\n${truncate(refined, 25_000)}`,
      `# Research report\n${truncate(research, 25_000)}`,
      `# Collaborator review notes\n${review}`,
      'Write the Requirements Summary (Markdown, titled "# Requirements Summary", max ~900 words) for the Architect.',
    ].join('\n\n');
    const text = await this.chat(ctx, prompt);
    ctx.log.append('agent-output', this.role, 'Requirements summary produced');
    return text;
  }

  async createChapter(ctx: AgentContext, input: ChapterInput): Promise<{ title: string; markdown: string }> {
    this.progress(ctx, `writing development chapter ${input.chapterNumber}…`);
    const timeline = buildTimeline(input.events);
    const terminal = buildTerminalActivity(input.events);
    const statsMd = statsToMarkdown(`Development Session #${input.chapterNumber} — Statistics`, input.stats);
    const prompt = [
      `# Project memory\n${truncate(input.memoryContext, 10_000)}`,
      `# Session statistics (authoritative, computed by the system)\n${statsMd}`,
      `# AI activity timeline (authoritative)\n${truncate(timeline, 25_000)}`,
      `# Terminal activity\n${truncate(terminal, 12_000)}`,
      `# Detailed agent outputs\n${truncate(collectOutputs(input.events), 30_000)}`,
      `Write "Development Chapter ${String(input.chapterNumber).padStart(2, '0')}". The FIRST line must be a heading "# Chapter ${String(input.chapterNumber).padStart(2, '0')} — <short title describing this session's focus>".
Then the sections: ## Session overview, ## User requirements and requests, ## Decisions, ## Architecture progress, ## Tasks completed, ## Code created and modified, ## Tests performed, ## Errors discovered, ## Debugging performed, ## Terminal activity highlights, ## Final status, ## Next steps.
Do NOT include the statistics table or the timeline — the system appends them.`,
    ].join('\n\n');
    const narrative = await this.chat(ctx, prompt);
    const firstLine = narrative.split('\n').find((l) => l.startsWith('#')) ?? `# Chapter ${input.chapterNumber}`;
    const title = firstLine.replace(/^#+\s*/, '').trim();
    const markdown = [
      narrative.trim(),
      '',
      '## Error and debugging statistics',
      '',
      statsMd,
      '',
      '## AI activity timeline',
      '',
      timeline,
      '',
      '## Terminal activity',
      '',
      terminal,
      '',
      `---\n_Session ${input.sessionId} · generated ${new Date().toISOString()} by the Summarizer AI from the development activity log._`,
    ].join('\n');
    ctx.log.append('agent-output', this.role, `Chapter ${input.chapterNumber} written: ${title}`);
    return { title, markdown };
  }
}

function time(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function actorName(actor: string): string {
  return actor
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export function buildTimeline(events: LogEvent[]): string {
  const relevant = events.filter((e) =>
    ['handoff', 'decision', 'approval', 'agent-output', 'test-result', 'debug-action', 'architecture-version', 'session-start', 'session-end', 'error'].includes(e.type),
  );
  if (!relevant.length) {
    return '_No agent activity recorded._';
  }
  return relevant
    .map((e) => `**${time(e.ts)} — ${actorName(e.actor)}**  \n${e.type === 'handoff' ? 'Handoff ' : ''}${e.message.replace(/\n+/g, ' ').slice(0, 300)}`)
    .join('\n\n');
}

export function buildTerminalActivity(events: LogEvent[]): string {
  const commands = events.filter((e) => e.type === 'command-result');
  if (!commands.length) {
    return '_No terminal commands recorded._';
  }
  const rows = commands.map((e) => {
    const cmd = String(e.data?.command ?? e.message).replace(/\|/g, '\\|').slice(0, 90);
    const code = e.data?.exitCode ?? '?';
    return `| ${time(e.ts)} | ${actorName(e.actor)} | \`${cmd}\` | ${code} |`;
  });
  return ['| Time | Actor | Command | Exit |', '|---|---|---|---:|', ...rows].join('\n');
}

function collectOutputs(events: LogEvent[]): string {
  return events
    .filter((e) => ['agent-output', 'test-result', 'debug-action', 'decision', 'approval', 'error'].includes(e.type))
    .map((e) => {
      const data = e.data ? JSON.stringify(e.data).slice(0, 1200) : '';
      return `[${time(e.ts)}] ${e.actor} ${e.type}: ${e.message}\n${data}`;
    })
    .join('\n\n');
}

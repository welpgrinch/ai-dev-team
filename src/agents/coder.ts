import { AgentTool } from '../tools/agentTools';
import { AgentContext, asStringArray, BaseAgent, extractLastJson, stripLastJsonBlock, truncate } from './base';
import { CODER_PROMPT } from './prompts';
import { CoderReport, CodingTask } from './types';

export class CoderAgent extends BaseAgent {
  constructor() {
    super('coder', 'Coder', CODER_PROMPT);
  }

  async implement(
    ctx: AgentContext,
    task: CodingTask,
    taskMarkdown: string,
    memoryContext: string,
    tools: AgentTool[],
  ): Promise<{ report: CoderReport; markdown: string }> {
    this.progress(ctx, `implementing ${task.id} — ${task.title}…`);
    const prompt = [
      `# Coding task\n${truncate(taskMarkdown, 30_000)}`,
      `# Project memory (conventions, structure, decisions)\n${truncate(memoryContext, 8_000)}`,
      'Implement the task now using the tools. Finish with the report and JSON block.',
    ].join('\n\n');
    const text = await this.chat(ctx, prompt, { tools });
    const json = extractLastJson<Partial<CoderReport>>(text) ?? {};
    const status = json.status === 'complete' || json.status === 'partial' || json.status === 'blocked' ? json.status : 'partial';
    const report: CoderReport = {
      filesCreated: asStringArray(json.filesCreated),
      filesModified: asStringArray(json.filesModified),
      codeImplemented: json.codeImplemented ?? '',
      dependenciesAdded: asStringArray(json.dependenciesAdded),
      commandsExecuted: asStringArray(json.commandsExecuted),
      problems: asStringArray(json.problems),
      status,
      summary: json.summary ?? stripLastJsonBlock(text).slice(0, 600),
    };
    ctx.log.append('agent-output', this.role, `Segment ${task.id} ${report.status}: ${report.summary.slice(0, 200)}`, { task: task.id, report });
    return { report, markdown: stripLastJsonBlock(text) };
  }
}

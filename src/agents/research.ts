import { AgentTool } from '../tools/agentTools';
import { AgentContext, BaseAgent, truncate } from './base';
import { RESEARCH_PROMPT } from './prompts';

export class ResearchAgent extends BaseAgent {
  constructor(private readonly toolsFactory: () => AgentTool[]) {
    super('research', 'Research', RESEARCH_PROMPT);
  }

  async investigate(ctx: AgentContext, questions: string[], projectContext: string): Promise<string> {
    this.progress(ctx, `investigating ${questions.length} question(s)…`);
    const prompt = [
      `# Project context\n${truncate(projectContext, 12_000)}`,
      `# Research questions\n${questions.map((q, i) => `R${i + 1}: ${q}`).join('\n')}`,
      'Produce the Research Report now.',
    ].join('\n\n');
    const report = await this.chat(ctx, prompt, { tools: this.toolsFactory() });
    ctx.log.append('agent-output', this.role, `Research report for ${questions.length} question(s)`, { questions });
    return report;
  }
}

import { AgentTool } from '../tools/agentTools';
import { AgentContext, asStringArray, BaseAgent, extractLastJson, stripLastJsonBlock, truncate } from './base';
import { PROMPT_ENGINEER_PROMPT } from './prompts';
import { CodingTask, RoadmapItem } from './types';

export interface TaskInput {
  item: RoadmapItem;
  architecture: string;
  architectureVersion: string;
  memoryContext: string;
  previousReports: string;
}

export class PromptEngineerAgent extends BaseAgent {
  constructor(private readonly toolsFactory: () => AgentTool[]) {
    super('prompt-engineer', 'Prompt Engineer', PROMPT_ENGINEER_PROMPT);
  }

  async createTask(ctx: AgentContext, input: TaskInput): Promise<{ markdown: string; task: CodingTask }> {
    this.progress(ctx, `writing coding task for ${input.item.id} — ${input.item.title}…`);
    const prompt = [
      `# Approved architecture (v${input.architectureVersion})\n${truncate(input.architecture, 35_000)}`,
      `# Project memory\n${truncate(input.memoryContext, 8_000)}`,
      input.previousReports ? `# Reports from previous segments\n${truncate(input.previousReports, 8_000)}` : '',
      `# Roadmap segment to convert into a coding task\nID: ${input.item.id}\nTitle: ${input.item.title}\nDescription: ${input.item.description}`,
      'Inspect the workspace with the tools first, then write the coding task.',
    ]
      .filter(Boolean)
      .join('\n\n');
    const text = await this.chat(ctx, prompt, { tools: this.toolsFactory() });
    const json = extractLastJson<Partial<CodingTask>>(text) ?? {};
    const task: CodingTask = {
      id: input.item.id,
      title: json.title?.trim() || input.item.title,
      objective: json.objective ?? input.item.description,
      architectureSection: json.architectureSection ?? '',
      filesMayChange: asStringArray(json.filesMayChange),
      filesMustNotChange: asStringArray(json.filesMustNotChange),
      requiredFunctionality: asStringArray(json.requiredFunctionality),
      dependencies: asStringArray(json.dependencies),
      expectedOutput: json.expectedOutput ?? '',
      testingRequirements: asStringArray(json.testingRequirements),
      acceptanceCriteria: asStringArray(json.acceptanceCriteria),
    };
    ctx.log.append('agent-output', this.role, `Coding task ${task.id}: ${task.title}`, {
      task: task.id,
      filesMayChange: task.filesMayChange,
      filesMustNotChange: task.filesMustNotChange,
    });
    return { markdown: stripLastJsonBlock(text), task };
  }
}

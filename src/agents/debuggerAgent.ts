import { AgentTool } from '../tools/agentTools';
import { AgentContext, asStringArray, BaseAgent, extractLastJson, stripLastJsonBlock, truncate } from './base';
import { DEBUGGER_PROMPT } from './prompts';
import { CodingTask, DebugReport, TestResult } from './types';

export class DebuggerAgent extends BaseAgent {
  constructor() {
    super('debugger', 'Debugger', DEBUGGER_PROMPT);
  }

  async fix(
    ctx: AgentContext,
    task: CodingTask,
    taskMarkdown: string,
    testResult: TestResult,
    testMarkdown: string,
    tools: AgentTool[],
  ): Promise<{ report: DebugReport & { fixApplied: boolean }; markdown: string }> {
    this.progress(ctx, `investigating ${testResult.failures.length} failure(s) in ${task.id}…`);
    const prompt = [
      `# Coding task\n${truncate(taskMarkdown, 20_000)}`,
      `# Failed test report\n${truncate(testMarkdown, 15_000)}`,
      `# Structured failures\n${JSON.stringify(testResult.failures, null, 2)}`,
      'Debug and fix now using the tools. Finish with the Debug Report and JSON block.',
    ].join('\n\n');
    const text = await this.chat(ctx, prompt, { tools });
    const json = extractLastJson<Partial<DebugReport> & { fixApplied?: boolean }>(text) ?? {};
    const report = {
      rootCause: json.rootCause ?? '',
      whatWasChanged: json.whatWasChanged ?? '',
      filesModified: asStringArray(json.filesModified),
      testsRun: asStringArray(json.testsRun),
      summary: json.summary ?? stripLastJsonBlock(text).slice(0, 600),
      fixApplied: json.fixApplied !== false,
    };
    return { report, markdown: stripLastJsonBlock(text) };
  }
}

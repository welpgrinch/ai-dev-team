import { AgentTool } from '../tools/agentTools';
import { AgentContext, asStringArray, BaseAgent, extractLastJson, stripLastJsonBlock, truncate } from './base';
import { TESTER_PROMPT } from './prompts';
import { CoderReport, CodingTask, DebugReport, TestFailure, TestResult } from './types';

export class TesterAgent extends BaseAgent {
  constructor() {
    super('tester', 'Tester', TESTER_PROMPT);
  }

  async test(
    ctx: AgentContext,
    task: CodingTask,
    taskMarkdown: string,
    coderReport: CoderReport,
    tools: AgentTool[],
    debugReport?: DebugReport,
  ): Promise<{ result: TestResult; markdown: string }> {
    this.progress(ctx, debugReport ? `retesting ${task.id} after debugging…` : `testing ${task.id}…`);
    const prompt = [
      `# Coding task under test\n${truncate(taskMarkdown, 25_000)}`,
      `# Coder report\n${JSON.stringify(coderReport, null, 2)}`,
      debugReport ? `# Debugger report (retest after fix)\n${JSON.stringify(debugReport, null, 2)}` : '',
      'Verify the implementation now with the tools (read-only + run_command). Then write the Test Report and JSON block.',
    ]
      .filter(Boolean)
      .join('\n\n');
    const text = await this.chat(ctx, prompt, { tools });
    const json = extractLastJson<Partial<TestResult> & { failures?: Partial<TestFailure>[] }>(text) ?? {};
    const failures: TestFailure[] = (json.failures ?? []).map((f) => ({
      what: f.what ?? '',
      where: f.where ?? '',
      how: f.how ?? '',
      errorMessage: f.errorMessage ?? '',
      expected: f.expected ?? '',
      actual: f.actual ?? '',
      severity: f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium' || f.severity === 'low' ? f.severity : 'medium',
      reproductionSteps: asStringArray(f.reproductionSteps),
    }));
    const status: 'pass' | 'fail' = json.status === 'pass' && failures.length === 0 ? 'pass' : 'fail';
    const result: TestResult = {
      status,
      summary: json.summary ?? stripLastJsonBlock(text).slice(0, 600),
      testsRun: typeof json.testsRun === 'number' ? json.testsRun : 0,
      failures,
      warnings: asStringArray(json.warnings),
    };
    for (const w of result.warnings) {
      ctx.log.append('warning', this.role, w, { task: task.id });
    }
    return { result, markdown: stripLastJsonBlock(text) };
  }
}

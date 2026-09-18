import { AgentContext, asStringArray, BaseAgent, extractLastJson, stripLastJsonBlock, truncate } from './base';
import { IDEA_REFINER_PROMPT } from './prompts';
import { RefinedConcept } from './types';

export interface RefineInput {
  idea: string;
  research?: string;
  previousConcept?: string;
  userAnswers?: string;
}

interface RefinerJson {
  projectName?: string;
  openQuestions?: unknown;
  researchRequests?: unknown;
}

export class IdeaRefinerAgent extends BaseAgent {
  constructor() {
    super('idea-refiner', 'Idea Refiner', IDEA_REFINER_PROMPT);
  }

  async refine(ctx: AgentContext, input: RefineInput): Promise<RefinedConcept> {
    this.progress(ctx, input.research ? 'integrating research into the concept…' : input.userAnswers ? 'incorporating your answers…' : 'analysing the idea…');
    const parts = [`# Raw idea from the user\n${input.idea}`];
    if (input.previousConcept) {
      parts.push(`# Previous refined concept\n${truncate(input.previousConcept, 20_000)}`);
    }
    if (input.userAnswers) {
      parts.push(`# User answers / feedback to the open questions\n${input.userAnswers}\n\nUpdate the concept accordingly, remove answered questions and keep only questions that are still open.`);
    }
    if (input.research) {
      parts.push(`# Research report from the Research AI\n${truncate(input.research, 30_000)}\n\nIntegrate the findings; set researchRequests to [] unless something critical is still unknown.`);
    }
    const text = await this.chat(ctx, parts.join('\n\n'));
    const json = extractLastJson<RefinerJson>(text);
    const concept: RefinedConcept = {
      markdown: stripLastJsonBlock(text),
      projectName: json?.projectName,
      openQuestions: asStringArray(json?.openQuestions),
      researchRequests: input.research ? [] : asStringArray(json?.researchRequests),
    };
    ctx.log.append('agent-output', this.role, `Refined concept (${concept.openQuestions.length} open questions, ${concept.researchRequests.length} research requests)`, {
      projectName: concept.projectName,
      openQuestions: concept.openQuestions,
      researchRequests: concept.researchRequests,
    });
    return concept;
  }
}

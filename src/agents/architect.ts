import { ARCHITECTURE_SECTIONS } from '../docs/documentGuidelines';
import { AgentContext, asStringArray, BaseAgent, extractLastJson, stripLastJsonBlock, truncate } from './base';
import { ARCHITECT_META_INSTRUCTIONS, ARCHITECT_PROMPT } from './prompts';
import { ArchitectureMeta, RoadmapItem } from './types';

export interface ArchitectInput {
  projectName: string;
  requirementsSummary: string;
  refinedRequirements: string;
  research: string;
  memoryContext: string;
  /** Present when revising an existing version. */
  currentDocument?: string;
  feedback?: string;
  nextVersion: string;
}

interface MetaJson {
  roadmap?: { id?: string; title?: string; description?: string }[];
  decisions?: unknown;
  conventions?: unknown;
  constraints?: unknown;
  projectStructure?: unknown;
  changelog?: unknown;
}

export class ArchitectAgent extends BaseAgent {
  constructor() {
    super('architect', 'Architect', ARCHITECT_PROMPT);
  }

  async design(ctx: AgentContext, input: ArchitectInput): Promise<{ markdown: string; meta: ArchitectureMeta }> {
    const context = [
      `# Project: ${input.projectName}`,
      `# Requirements summary\n${truncate(input.requirementsSummary, 15_000)}`,
      `# Refined requirements\n${truncate(input.refinedRequirements, 20_000)}`,
      `# Research report\n${truncate(input.research, 20_000)}`,
      `# Project memory\n${truncate(input.memoryContext, 8_000)}`,
    ];
    if (input.currentDocument) {
      context.push(`# Current architecture document (to be revised)\n${truncate(input.currentDocument, 60_000)}`);
      context.push(`# Revision feedback from Collaborator / user\n${input.feedback ?? ''}\n\nProduce version ${input.nextVersion}. Keep everything that was not criticised; apply the feedback consistently across all sections; add a decision record describing the revision.`);
    }

    const produced: string[] = [];
    for (let i = 0; i < ARCHITECTURE_SECTIONS.length; i++) {
      const sections = ARCHITECTURE_SECTIONS[i];
      const isLast = i === ARCHITECTURE_SECTIONS.length - 1;
      this.progress(ctx, `writing part ${i + 1}/${ARCHITECTURE_SECTIONS.length} (${sections[0]} … ${sections[sections.length - 1]})`);
      const prompt = [
        ...context,
        produced.length ? `# Already written parts (for consistency — do not repeat)\n${truncate(produced.join('\n\n'), 40_000)}` : '',
        `# Your task now\nWrite part ${i + 1} of ${ARCHITECTURE_SECTIONS.length} of the architecture document version ${input.nextVersion}, containing exactly these top-level "##" sections in this order:\n${sections.map((s) => `- ${s}`).join('\n')}`,
        isLast ? ARCHITECT_META_INSTRUCTIONS : 'Do not append any JSON block in this part.',
      ]
        .filter(Boolean)
        .join('\n\n');
      const text = await this.chat(ctx, prompt);
      produced.push(text);
    }

    const full = produced.join('\n\n');
    const json = extractLastJson<MetaJson>(full);
    const markdown = stripLastJsonBlock(full);
    const roadmap: RoadmapItem[] = (json?.roadmap ?? [])
      .filter((r) => r && (r.title || r.description))
      .map((r, i) => ({
        id: r.id?.trim() || `S${String(i + 1).padStart(2, '0')}`,
        title: r.title?.trim() || `Segment ${i + 1}`,
        description: r.description?.trim() || '',
        status: 'pending' as const,
      }));
    const meta: ArchitectureMeta = {
      roadmap,
      decisions: asStringArray(json?.decisions),
      conventions: asStringArray(json?.conventions),
      constraints: asStringArray(json?.constraints),
      projectStructure: typeof json?.projectStructure === 'string' ? json.projectStructure : '',
      changelog: typeof json?.changelog === 'string' ? json.changelog : input.currentDocument ? 'Revision' : 'Initial architecture',
    };
    ctx.log.append('agent-output', this.role, `Architecture v${input.nextVersion} written (${markdown.length} chars, ${roadmap.length} roadmap segments)`, {
      version: input.nextVersion,
      roadmap: roadmap.map((r) => r.id + ' ' + r.title),
    });
    return { markdown, meta };
  }
}

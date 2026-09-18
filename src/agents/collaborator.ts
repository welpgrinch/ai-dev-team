import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActivityLog } from '../core/activityLog';
import { ModelRouter } from '../core/modelRouter';
import { ProjectPaths } from '../core/paths';
import { ProjectMemoryStore } from '../core/projectMemory';
import { RecentWrites } from '../core/recentWrites';
import { computeStats, statsToMarkdown } from '../core/sessionStats';
import { Settings } from '../core/settings';
import { PdfGenerator } from '../docs/pdfGenerator';
import { AgentTool, createWorkspaceTools } from '../tools/agentTools';
import { ArchitectAgent } from './architect';
import { AgentContext, asStringArray, BaseAgent, extractLastJson, stripLastJsonBlock, truncate } from './base';
import { CoderAgent } from './coder';
import { DebuggerAgent } from './debuggerAgent';
import { IdeaRefinerAgent } from './ideaRefiner';
import { COLLABORATOR_PROMPT } from './prompts';
import { PromptEngineerAgent } from './promptEngineer';
import { ResearchAgent } from './research';
import { SummarizerAgent } from './summarizer';
import { TesterAgent } from './tester';
import { AgentRole, ArchitectureMeta, ArchitectureVersion, CoderReport, CodingTask, DebugReport, RefinedConcept, TestResult } from './types';

export interface TeamAgents {
  ideaRefiner: IdeaRefinerAgent;
  research: ResearchAgent;
  architect: ArchitectAgent;
  promptEngineer: PromptEngineerAgent;
  coder: CoderAgent;
  tester: TesterAgent;
  debugger: DebuggerAgent;
  summarizer: SummarizerAgent;
}

export interface TeamServices {
  paths: ProjectPaths;
  memory: ProjectMemoryStore;
  log: ActivityLog;
  recentWrites: RecentWrites;
  pdf: PdfGenerator;
  models: ModelRouter;
  settings: () => Settings;
  agents: TeamAgents;
}

const APPROVAL = /^\s*[/]?(approve|approved|yes|ok|okay|looks good|lgtm|proceed|go ahead|continue|accept|next)\b/i;

export function isApproval(text: string): boolean {
  return APPROVAL.test(text);
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

function bumpVersion(current: string, major = false): string {
  if (!current) {
    return '1.0';
  }
  const [maj, min] = current.split('.').map((n) => parseInt(n, 10) || 0);
  return major ? `${maj + 1}.0` : `${maj}.${min + 1}`;
}

function writeText(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

/** The Collaborator controls the project: it routes work to the specialized agents, reviews, approves and reports. */
export class Collaborator extends BaseAgent {
  constructor(private readonly s: TeamServices) {
    super('collaborator', 'Collaborator', COLLABORATOR_PROMPT);
  }

  private get m() {
    return this.s.memory.data;
  }

  private say(ctx: AgentContext, md: string): void {
    ctx.stream?.markdown(md + '\n\n');
  }

  private anchor(ctx: AgentContext, file: string, title: string): void {
    ctx.stream?.anchor(vscode.Uri.file(file), title);
    ctx.stream?.markdown('\n');
  }

  private save(): void {
    this.s.memory.save();
  }

  // ------------------------------------------------------------------ routing

  async handleMessage(prompt: string, ctx: AgentContext): Promise<void> {
    const text = prompt.trim();
    switch (this.m.phase) {
      case 'idle':
      case 'refining':
        if (!text) {
          this.say(ctx, this.help());
          return;
        }
        await this.startProject(text, ctx);
        return;
      case 'awaiting-requirements-approval':
        if (isApproval(text)) {
          await this.startArchitecture(ctx);
        } else {
          await this.refineWithFeedback(text, ctx);
        }
        return;
      case 'architecting':
        await this.startArchitecture(ctx);
        return;
      case 'awaiting-architecture-approval':
        if (isApproval(text)) {
          await this.approveArchitecture(ctx);
        } else {
          await this.reviseArchitecture(text, ctx);
        }
        return;
      case 'developing':
        if (isApproval(text) || /^\s*[/]?(build|run)\b/i.test(text)) {
          await this.runNextSegment(ctx, /\b(all|everything|rest|remaining)\b/i.test(text));
        } else {
          await this.answer(text, ctx);
        }
        return;
    }
  }

  async handleIdeaCommand(prompt: string, ctx: AgentContext): Promise<void> {
    const text = prompt.trim();
    if (this.m.phase !== 'idle' && this.m.originalIdea) {
      const reset = /^reset:\s*/i;
      if (!reset.test(text)) {
        this.say(
          ctx,
          `A project already exists here: **${this.m.projectName || 'unnamed'}** (phase: \`${this.m.phase}\`).\n\nTo continue, just talk to me or use \`/status\`. To discard the project memory and start over, write \`/idea reset: <your new idea>\`.`,
        );
        return;
      }
      this.s.log.append('decision', 'collaborator', 'User reset the project memory to start a new project');
      this.s.memory.reset();
      await this.startProject(text.replace(reset, ''), ctx);
      return;
    }
    if (!text) {
      this.say(ctx, this.help());
      return;
    }
    await this.startProject(text, ctx);
  }

  async handleApprove(prompt: string, ctx: AgentContext): Promise<void> {
    switch (this.m.phase) {
      case 'awaiting-requirements-approval':
        return this.startArchitecture(ctx);
      case 'awaiting-architecture-approval':
        return this.approveArchitecture(ctx);
      case 'developing':
        return this.runNextSegment(ctx, /\b(all|everything|rest|remaining)\b/i.test(prompt));
      default:
        this.say(ctx, `Nothing is waiting for approval (phase: \`${this.m.phase}\`).`);
    }
  }

  async handleRevise(prompt: string, ctx: AgentContext): Promise<void> {
    const text = prompt.trim();
    if (!text) {
      this.say(ctx, 'Tell me what should change, e.g. `/revise use PostgreSQL instead of SQLite`.');
      return;
    }
    switch (this.m.phase) {
      case 'awaiting-requirements-approval':
        return this.refineWithFeedback(text, ctx);
      case 'awaiting-architecture-approval':
      case 'developing':
        return this.reviseArchitecture(text, ctx);
      default:
        this.say(ctx, `There is nothing to revise yet (phase: \`${this.m.phase}\`).`);
    }
  }

  help(): string {
    return [
      '### AI Dev Team',
      'I am the **Collaborator** — I control the project and coordinate the specialized agents.',
      '',
      '1. Describe your idea (or `/idea <idea>`) → the **Idea Refiner** and **Research** agents produce a refined concept.',
      '2. Answer the open questions or `/approve` → the **Summarizer** briefs the **Architect**, which produces the architecture document and PDF.',
      '3. `/approve` the architecture (or `/revise <feedback>`) → development starts.',
      '4. `/build` runs the next segment: **Prompt Engineer → Coder → Tester → (Debugger → Tester)**. `/build all` runs every remaining segment back-to-back without waiting for you.',
      '5. `/end` closes the session and the **Summarizer** writes a new Development Chapter.',
      '',
      'Use `/status` at any time and `/models` to see which language model each agent uses. Everything is recorded in `.aidevteam/` (memory, logs, architecture versions, tasks, chapters).',
    ].join('\n');
  }

  // ------------------------------------------------------------ refinement

  async startProject(idea: string, ctx: AgentContext): Promise<void> {
    const m = this.m;
    if (m.sessionCount === 0 && !m.originalIdea) {
      this.s.log.append('session-start', 'system', `Session ${this.s.log.sessionId} started`);
    }
    m.originalIdea = idea;
    m.phase = 'refining';
    this.save();
    this.s.log.append('decision', 'collaborator', 'Received idea from user; starting refinement', { idea: idea.slice(0, 500) });
    this.say(ctx, `Thanks — I'll have the **Idea Refiner** structure this idea and the **Research** agent verify the technical facts.`);

    this.s.log.handoff('collaborator', 'idea-refiner', 'Refine the raw idea');
    let concept = await this.s.agents.ideaRefiner.refine(ctx, { idea });
    let research = '';
    if (concept.researchRequests.length) {
      this.s.log.handoff('idea-refiner', 'research', `${concept.researchRequests.length} research request(s)`, { questions: concept.researchRequests });
      research = await this.s.agents.research.investigate(ctx, concept.researchRequests, `${idea}\n\n${concept.markdown}`);
      this.s.log.handoff('research', 'idea-refiner', 'Research report delivered');
      concept = await this.s.agents.ideaRefiner.refine(ctx, { idea, research, previousConcept: concept.markdown });
    }
    this.s.log.handoff('idea-refiner', 'collaborator', 'Refined project concept delivered');
    await this.presentConcept(concept, research, ctx);
  }

  private async refineWithFeedback(feedback: string, ctx: AgentContext): Promise<void> {
    const m = this.m;
    this.s.log.append('decision', 'collaborator', 'User provided answers/feedback on requirements; sending back to Idea Refiner', { feedback: feedback.slice(0, 500) });
    this.s.log.handoff('collaborator', 'idea-refiner', 'Incorporate user answers');
    const concept = await this.s.agents.ideaRefiner.refine(ctx, {
      idea: m.originalIdea,
      previousConcept: m.refinedRequirements,
      userAnswers: feedback,
      research: m.research || undefined,
    });
    this.s.log.handoff('idea-refiner', 'collaborator', 'Updated project concept delivered');
    await this.presentConcept(concept, m.research, ctx);
  }

  private async presentConcept(concept: RefinedConcept, research: string, ctx: AgentContext): Promise<void> {
    const m = this.m;
    const review = await this.review(ctx, 'refined project concept', concept.markdown, research);
    if (review.decision === 'revise' && review.notes.length) {
      this.s.log.handoff('collaborator', 'idea-refiner', 'Revise concept per Collaborator review', { notes: review.notes });
      concept = await this.s.agents.ideaRefiner.refine(ctx, {
        idea: m.originalIdea,
        previousConcept: concept.markdown,
        userAnswers: `Collaborator review notes (address these): \n- ${review.notes.join('\n- ')}`,
        research: research || undefined,
      });
      this.s.log.handoff('idea-refiner', 'collaborator', 'Revised project concept delivered');
    }

    m.projectName = concept.projectName?.trim() || m.projectName || 'Untitled Project';
    m.complexity = concept.complexity;
    m.refinedRequirements = concept.markdown;
    m.openQuestions = concept.openQuestions;
    m.research = research;
    m.phase = 'awaiting-requirements-approval';
    this.save();
    writeText(this.s.paths.requirementsFile, concept.markdown);
    if (research) {
      writeText(this.s.paths.researchFile, research);
    }

    this.say(ctx, `## Refined concept for **${m.projectName}**\n\n${concept.markdown}`);
    if (review.notes.length) {
      this.say(ctx, `### Collaborator review\n${review.notes.map((n) => `- ${n}`).join('\n')}`);
    }
    if (concept.openQuestions.length) {
      this.say(ctx, `### Open questions for you\n${concept.openQuestions.map((q) => `- ${q}`).join('\n')}\n\nAnswer them in your next message, or \`/approve\` to proceed with the stated assumptions.`);
    } else {
      this.say(ctx, 'No open questions remain. `/approve` to send the requirements to the Architect, or tell me what to change.');
    }
    this.anchor(ctx, this.s.paths.requirementsFile, 'requirements.md');
    if (research) {
      this.anchor(ctx, this.s.paths.researchFile, 'research.md');
    }
  }

  // ---------------------------------------------------------- architecture

  async startArchitecture(ctx: AgentContext): Promise<void> {
    const m = this.m;
    m.phase = 'architecting';
    this.save();
    this.s.log.append('approval', 'collaborator', 'Requirements approved by user; starting architecture phase');
    const review = m.openQuestions.length ? `Open questions the user did not answer (proceed with stated assumptions):\n- ${m.openQuestions.join('\n- ')}` : 'No open questions.';
    if (m.complexity === 'simple') {
      // Requirements are already short for simple projects; a separate summarization pass adds cost without value.
      this.say(ctx, `Requirements approved. This is a **simple** project, so the requirements go straight to the **Architect** (compact document, no PDF until approval).`);
      this.s.log.append('decision', 'collaborator', 'Simple project: skipping Summarizer briefing, requirements passed directly to Architect');
      m.requirementsSummary = `${m.refinedRequirements}\n\n${review}`;
    } else {
      this.say(ctx, `Requirements approved. The **Summarizer** is briefing the **Architect** now.`);
      this.s.log.handoff('collaborator', 'summarizer', 'Create requirements summary for the Architect');
      m.requirementsSummary = await this.s.agents.summarizer.summarizeRequirements(ctx, m.refinedRequirements, m.research, review);
      this.s.log.handoff('summarizer', 'collaborator', 'Requirements summary delivered');
    }
    this.save();
    this.s.log.handoff('collaborator', 'architect', 'Design the architecture from the requirements summary');
    await this.produceArchitecture(ctx, undefined);
  }

  private async reviseArchitecture(feedback: string, ctx: AgentContext): Promise<void> {
    const m = this.m;
    const wasDeveloping = m.phase === 'developing';
    m.phase = 'architecting';
    this.save();
    this.s.log.append('decision', 'collaborator', wasDeveloping ? 'Architecture change requested during development; escalating to Architect' : 'Architecture revision requested', {
      feedback: feedback.slice(0, 500),
    });
    this.say(ctx, `Sending your feedback to the **Architect** for revision${wasDeveloping ? ' (development is paused until the revision is approved)' : ''}.`);
    this.s.log.handoff('collaborator', 'architect', 'Revise architecture', { feedback: feedback.slice(0, 500) });
    await this.produceArchitecture(ctx, feedback);
  }

  private currentArchitectureMarkdown(): string {
    const v = this.m.architecture.versions.find((x) => x.version === this.m.architecture.currentVersion);
    return v && fs.existsSync(v.file) ? fs.readFileSync(v.file, 'utf8') : '';
  }

  private async produceArchitecture(ctx: AgentContext, feedback: string | undefined): Promise<void> {
    const m = this.m;
    const structural = feedback ? /\b(database|framework|language|replace|switch|instead of|migrate)\b/i.test(feedback) : false;
    const nextVersion = bumpVersion(m.architecture.currentVersion, structural);
    const { markdown, meta } = await this.s.agents.architect.design(ctx, {
      projectName: m.projectName,
      requirementsSummary: m.requirementsSummary,
      refinedRequirements: m.refinedRequirements,
      research: m.research,
      memoryContext: this.s.memory.toPromptContext(),
      complexity: m.complexity,
      currentDocument: feedback ? this.currentArchitectureMarkdown() : undefined,
      feedback,
      nextVersion,
    });

    const mdFile = path.join(this.s.paths.architectureDir, `v${nextVersion}.md`);
    writeText(mdFile, `# ${m.projectName} — Software Architecture Document v${nextVersion}\n\n${markdown}`);
    const version: ArchitectureVersion = {
      version: nextVersion,
      file: mdFile,
      approved: false,
      createdAt: new Date().toISOString(),
      changelog: meta.changelog ?? (feedback ? 'Revision' : 'Initial architecture'),
    };
    m.architecture.versions.push(version);
    m.architecture.currentVersion = nextVersion;
    this.applyMeta(meta, !!feedback);
    this.save();
    this.s.log.append('architecture-version', 'architect', `Architecture v${nextVersion} created`, { version: nextVersion, changelog: version.changelog });

    this.s.log.handoff('architect', 'collaborator', `Architecture v${nextVersion} delivered for review`);

    const review = await this.review(ctx, 'architecture document', markdown, m.requirementsSummary);
    m.phase = 'awaiting-architecture-approval';
    this.save();

    this.say(ctx, `## Architecture v${nextVersion} — ${version.changelog}`);
    this.say(ctx, '_The PDF is generated when you approve the architecture — review the Markdown draft below._');
    this.say(ctx, this.roadmapTable());
    if (review.notes.length) {
      this.say(ctx, `### Collaborator review\n${review.notes.map((n) => `- ${n}`).join('\n')}\n\n_Recommendation: **${review.decision === 'forward' ? 'approve' : 'revise'}**._`);
    }
    this.say(ctx, 'Review the document, then `/approve` to start development or `/revise <feedback>` for another version.');
    this.anchor(ctx, mdFile, `architecture v${nextVersion}.md`);
    if (version.pdf) {
      this.anchor(ctx, version.pdf, path.basename(version.pdf));
      ctx.stream?.button({ command: 'aiDevTeam.openArchitecture', title: 'Open architecture PDF' });
    }
  }

  private applyMeta(meta: ArchitectureMeta, isRevision: boolean): void {
    const m = this.m;
    const merge = (target: string[], items: string[]) => {
      for (const i of items) {
        if (!target.includes(i)) {
          target.push(i);
        }
      }
    };
    merge(m.technicalDecisions, meta.decisions);
    merge(m.codingConventions, meta.conventions);
    merge(m.constraints, meta.constraints);
    if (meta.projectStructure) {
      m.projectStructure = meta.projectStructure;
    }
    if (!meta.roadmap.length) {
      return;
    }
    if (!isRevision || !m.roadmap.length) {
      m.roadmap = meta.roadmap;
      return;
    }
    // keep progress of existing segments, adopt new/changed descriptions
    const byId = new Map(m.roadmap.map((r) => [r.id, r]));
    m.roadmap = meta.roadmap.map((r) => {
      const existing = byId.get(r.id);
      return existing ? { ...r, status: existing.status } : r;
    });
  }

  private async renderPdf(ctx: AgentContext, version: ArchitectureVersion, status: 'Draft' | 'Approved'): Promise<string> {
    const m = this.m;
    const pdfFile = path.join(this.s.paths.pdfDir, `${slug(m.projectName)}-architecture-v${version.version}.pdf`);
    try {
      ctx.stream?.progress('Architect: generating PDF…');
      const result = await this.s.pdf.generate(
        fs.readFileSync(version.file, 'utf8'),
        {
          projectName: m.projectName,
          version: version.version,
          status,
          author: 'Architect AI (AI Dev Team)',
          date: new Date().toISOString().slice(0, 10),
          revisions: m.architecture.versions.map((v) => ({
            version: v.version,
            date: v.createdAt,
            status: v.version === version.version ? status : v.approved ? 'Approved' : 'Superseded',
            changelog: v.changelog,
          })),
        },
        pdfFile,
        (msg) => ctx.stream?.progress(`Architect: ${msg}`),
      );
      version.pdf = pdfFile;
      this.save();
      const errors = result.diagramErrors.length ? `\n\n_${result.diagramErrors.length} diagram(s) could not be rendered and are included as source._` : '';
      return `PDF generated: **${result.pages} pages**, **${result.figures} figures**.${errors}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.s.log.append('error', 'architect', `PDF generation failed: ${msg}`);
      return `PDF generation failed: ${msg}. The Markdown version is available.`;
    }
  }

  async regeneratePdf(ctx: AgentContext): Promise<void> {
    const v = this.m.architecture.versions.find((x) => x.version === this.m.architecture.currentVersion);
    if (!v) {
      this.say(ctx, 'There is no architecture yet.');
      return;
    }
    const info = await this.renderPdf(ctx, v, v.approved ? 'Approved' : 'Draft');
    this.say(ctx, `Architecture v${v.version}: ${info}`);
    if (v.pdf) {
      this.anchor(ctx, v.pdf, path.basename(v.pdf));
    }
  }

  private async approveArchitecture(ctx: AgentContext): Promise<void> {
    const m = this.m;
    const v = m.architecture.versions.find((x) => x.version === m.architecture.currentVersion);
    if (!v) {
      this.say(ctx, 'There is no architecture to approve.');
      return;
    }
    v.approved = true;
    for (const other of m.architecture.versions) {
      if (other !== v) {
        other.approved = false;
      }
    }
    m.phase = 'developing';
    m.implementationStatus = `${m.roadmap.filter((r) => r.status === 'done').length}/${m.roadmap.length} segments complete`;
    this.save();
    this.s.log.append('approval', 'collaborator', `Architecture v${v.version} approved`, { version: v.version });
    const info = await this.renderPdf(ctx, v, 'Approved');
    this.say(ctx, `Architecture **v${v.version}** is approved and is now the official technical blueprint. ${info}`);
    this.say(ctx, this.roadmapTable());
    this.say(ctx, 'Run `/build` to start the first development segment — or `/build all` to build every segment in one go (I only stop if a segment gets blocked).');
  }

  private roadmapTable(): string {
    const m = this.m;
    if (!m.roadmap.length) {
      return '_The Architect did not provide a roadmap; segments will be requested on demand._';
    }
    const icon = { pending: '○', 'in-progress': '◐', done: '●', blocked: '✕' };
    return ['### Implementation roadmap', '', '| # | Segment | Status |', '|---|---|---|', ...m.roadmap.map((r) => `| ${r.id} | ${r.title} | ${icon[r.status]} ${r.status} |`)].join('\n');
  }

  // ----------------------------------------------------------- development

  private tools(actor: AgentRole, opts: { write: boolean; commands: boolean; forbidden?: string[]; segmentId?: string }): AgentTool[] {
    const settings = this.s.settings();
    return createWorkspaceTools({
      paths: this.s.paths,
      log: this.s.log,
      recentWrites: this.s.recentWrites,
      actor,
      allowWrite: opts.write,
      allowCommands: opts.commands && settings.allowCommands,
      commandTimeoutMs: settings.commandTimeoutMs,
      forbiddenFiles: opts.forbidden,
      segmentId: opts.segmentId,
    });
  }

  async runNextSegment(ctx: AgentContext, all = false): Promise<void> {
    let built = 0;
    for (;;) {
      const outcome = await this.runOneSegment(ctx);
      if (outcome === 'passed') {
        built++;
      }
      if (!all || outcome !== 'passed' || ctx.token.isCancellationRequested) {
        break;
      }
      const remaining = this.m.roadmap.filter((r) => r.status === 'pending' || r.status === 'in-progress').length;
      if (!remaining) {
        break;
      }
      this.say(ctx, `---\n\nContinuing automatically — ${remaining} segment(s) remaining.`);
    }
    if (all && built > 1) {
      this.say(ctx, `**Collaborator:** batch build finished — ${built} segment(s) completed. ${this.m.roadmap.every((r) => r.status === 'done') ? 'The roadmap is complete; run `/end` to write the development chapter.' : ''}`);
    }
  }

  private async runOneSegment(ctx: AgentContext): Promise<'passed' | 'blocked' | 'idle'> {
    const m = this.m;
    if (m.phase !== 'developing') {
      this.say(ctx, `Development has not started yet (phase: \`${m.phase}\`). ${m.phase === 'awaiting-architecture-approval' ? 'Approve the architecture first.' : ''}`);
      return 'idle';
    }
    const item = m.roadmap.find((r) => r.status === 'in-progress') ?? m.roadmap.find((r) => r.status === 'pending');
    if (!item) {
      const blocked = m.roadmap.filter((r) => r.status === 'blocked');
      this.say(ctx, blocked.length ? `All remaining segments are blocked: ${blocked.map((b) => b.title).join(', ')}. Use \`/revise <feedback>\` to escalate to the Architect, or retry with \`/build ${blocked[0].id}\`.` : 'All roadmap segments are complete. Run `/end` to write the development chapter.');
      return 'idle';
    }
    const settings = this.s.settings();
    const architecture = this.currentArchitectureMarkdown();
    const segmentId = `${this.s.log.sessionId}-${item.id}`;
    item.status = 'in-progress';
    m.currentSegmentId = item.id;
    this.save();

    this.say(ctx, `### Segment ${item.id} — ${item.title}\n${item.description}`);
    this.s.log.append('decision', 'collaborator', `Starting development segment ${item.id}: ${item.title}`, { segmentId, task: item.id });

    // Prompt Engineer
    this.s.log.handoff('collaborator', 'prompt-engineer', `Create coding task for ${item.id}`, { segmentId, task: item.id });
    const { markdown: taskMd, task } = await this.s.agents.promptEngineer.createTask(ctx, {
      item,
      architecture,
      architectureVersion: m.architecture.currentVersion,
      memoryContext: this.s.memory.toPromptContext(),
      previousReports: this.previousReports(),
    });
    const taskFile = path.join(this.s.paths.tasksDir, `${item.id}-${slug(task.title)}.md`);
    writeText(taskFile, taskMd);
    this.say(ctx, `**Prompt Engineer** produced the coding task (${task.acceptanceCriteria.length} acceptance criteria, ${task.filesMustNotChange.length} protected files).`);
    this.anchor(ctx, taskFile, path.basename(taskFile));

    // Coder
    this.s.log.handoff('prompt-engineer', 'coder', `Implement ${task.id}: ${task.title}`, { segmentId, task: task.id });
    const coderTools = this.tools('coder', { write: true, commands: true, forbidden: task.filesMustNotChange, segmentId });
    const { report: coderReport } = await this.s.agents.coder.implement(ctx, task, taskMd, this.s.memory.toPromptContext(), coderTools);
    this.say(ctx, this.coderSummary(coderReport));

    // Tester ↔ Debugger loop
    const testerTools = this.tools('tester', { write: false, commands: true, segmentId });
    const debuggerTools = this.tools('debugger', { write: true, commands: true, forbidden: task.filesMustNotChange, segmentId });
    this.s.log.handoff('coder', 'tester', `Test ${task.id}`, { segmentId, task: task.id });
    let tested = await this.s.agents.tester.test(ctx, task, taskMd, coderReport, testerTools);
    this.logTest(tested.result, segmentId, task);
    this.say(ctx, this.testSummary(tested.result, 0));

    let cycles = 0;
    let lastDebug: DebugReport | undefined;
    const fixedBugs: string[] = [];
    while (tested.result.status === 'fail' && cycles < settings.maxDebugCycles && !ctx.token.isCancellationRequested) {
      cycles++;
      this.s.log.handoff('tester', 'debugger', `${tested.result.failures.length} failure(s) in ${task.id} (cycle ${cycles})`, { segmentId, cycle: cycles, task: task.id });
      const { report: debugReport } = await this.s.agents.debugger.fix(ctx, task, taskMd, tested.result, tested.markdown, debuggerTools);
      lastDebug = debugReport;
      this.s.log.append('debug-action', 'debugger', `Cycle ${cycles}: ${debugReport.rootCause || debugReport.summary}`.slice(0, 400), {
        segmentId,
        cycle: cycles,
        fixApplied: debugReport.fixApplied,
        filesModified: debugReport.filesModified,
        whatWasChanged: debugReport.whatWasChanged,
      });
      this.say(ctx, `**Debugger** (cycle ${cycles}) — root cause: ${debugReport.rootCause || 'see report'}\n\nChange: ${debugReport.whatWasChanged || debugReport.summary}`);
      const failedBefore = tested.result.failures.map((f) => f.what);
      this.s.log.handoff('debugger', 'tester', `Retest ${task.id}`, { segmentId, cycle: cycles, task: task.id });
      tested = await this.s.agents.tester.test(ctx, task, taskMd, coderReport, testerTools, debugReport);
      this.logTest(tested.result, segmentId, task);
      this.say(ctx, this.testSummary(tested.result, cycles));
      if (tested.result.status === 'pass') {
        fixedBugs.push(...failedBefore);
      }
    }

    // Collaborator decision
    this.s.log.handoff('tester', 'collaborator', `Segment ${task.id} ${tested.result.status}`, { segmentId, task: task.id });
    const passed = tested.result.status === 'pass';
    if (passed) {
      item.status = 'done';
      if (!m.completedFeatures.includes(item.title)) {
        m.completedFeatures.push(item.title);
      }
      m.resolvedBugs.push(...fixedBugs.filter((b) => b));
      this.s.log.append('approval', 'collaborator', `Approved segment ${task.id}: ${task.title}`, { segmentId, task: task.id, debugCycles: cycles });
      this.say(ctx, `**Collaborator:** segment **${item.id}** approved${cycles ? ` after ${cycles} debugging cycle(s)` : ''}.`);
    } else {
      item.status = 'blocked';
      const issues = tested.result.failures.map((f) => `${item.id}: ${f.what} (${f.severity}) — ${f.where}`);
      m.outstandingIssues.push(...issues);
      m.knownBugs.push(...issues);
      this.s.log.append('decision', 'collaborator', `Segment ${task.id} blocked after ${cycles} debugging cycle(s)`, { segmentId, task: task.id, failures: tested.result.failures.length });
      this.say(ctx, `**Collaborator:** segment **${item.id}** is **blocked** after ${cycles} debugging cycle(s). ${lastDebug ? 'Last debugger note: ' + lastDebug.summary : ''}\n\nYou can \`/build\` again to retry, or \`/revise <feedback>\` to escalate an architecture change.`);
    }
    m.currentSegmentId = undefined;
    m.implementationStatus = `${m.roadmap.filter((r) => r.status === 'done').length}/${m.roadmap.length} segments complete`;
    this.save();
    this.say(ctx, this.roadmapTable());
    return passed ? 'passed' : 'blocked';
  }

  private logTest(result: TestResult, segmentId: string, task: CodingTask): void {
    this.s.log.append('test-result', 'tester', `${result.status.toUpperCase()} ${task.id}: ${result.summary}`.slice(0, 400), {
      segmentId,
      task: task.id,
      status: result.status,
      testsRun: result.testsRun,
      failures: result.failures,
    });
    for (const f of result.failures) {
      this.s.log.append('error', 'tester', `${f.severity}: ${f.what} @ ${f.where} — ${f.errorMessage}`.slice(0, 400), { segmentId, task: task.id, failure: f });
    }
  }

  private previousReports(): string {
    return this.s.log
      .readSession()
      .filter((e) => e.type === 'agent-output' && e.actor === 'coder')
      .slice(-3)
      .map((e) => `- ${e.message}`)
      .join('\n');
  }

  private coderSummary(r: CoderReport): string {
    const list = (xs: string[]) => (xs.length ? xs.map((x) => `\`${x}\``).join(', ') : '—');
    return [
      `**Coder** finished with status **${r.status}**.`,
      '',
      `- Files created: ${list(r.filesCreated)}`,
      `- Files modified: ${list(r.filesModified)}`,
      `- Dependencies added: ${list(r.dependenciesAdded)}`,
      `- Commands executed: ${r.commandsExecuted.length}`,
      r.problems.length ? `- Problems: ${r.problems.join('; ')}` : '',
      '',
      r.summary,
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  private testSummary(r: TestResult, cycle: number): string {
    const head = `**Tester** ${cycle ? `(retest ${cycle}) ` : ''}→ **${r.status.toUpperCase()}** (${r.testsRun} checks). ${r.summary}`;
    if (!r.failures.length) {
      return head + (r.warnings.length ? `\n\nWarnings: ${r.warnings.join('; ')}` : '');
    }
    const rows = r.failures.map((f) => `| ${f.severity} | ${f.what.replace(/\|/g, '/')} | ${f.where.replace(/\|/g, '/')} | ${(f.errorMessage || f.actual).replace(/\|/g, '/').slice(0, 120)} |`);
    return [head, '', '| Severity | What failed | Where | Error / actual |', '|---|---|---|---|', ...rows].join('\n');
  }

  // --------------------------------------------------------------- session

  async endSession(ctx: AgentContext): Promise<void> {
    const m = this.m;
    const events = this.s.log.readSession();
    if (!events.length) {
      this.say(ctx, 'Nothing happened in this session yet, so there is nothing to summarize.');
      return;
    }
    const stats = computeStats(events);
    const chapterNumber = m.developmentHistory.length + 1;
    this.s.log.append('session-end', 'system', `Session ${this.s.log.sessionId} ending`);
    this.s.log.handoff('collaborator', 'summarizer', `Create development chapter ${chapterNumber}`);
    const { title, markdown } = await this.s.agents.summarizer.createChapter(ctx, {
      chapterNumber,
      sessionId: this.s.log.sessionId,
      projectName: m.projectName,
      memoryContext: this.s.memory.toPromptContext(),
      events: this.s.log.readSession(),
      stats,
    });
    const file = path.join(this.s.paths.chaptersDir, `chapter-${String(chapterNumber).padStart(2, '0')}-${slug(title.replace(/^chapter\s*\d+\s*[—-]\s*/i, ''))}.md`);
    writeText(file, markdown);
    m.developmentHistory.push({ chapter: chapterNumber, title, file, sessionId: this.s.log.sessionId, date: new Date().toISOString() });
    m.sessionCount++;
    this.save();
    const newSession = this.s.log.startNewSession();
    this.s.log.append('session-start', 'system', `Session ${newSession} started (continuing ${m.projectName})`);

    this.say(ctx, `## ${title}\n\nChapter saved. A new session (\`${newSession}\`) has started; the project memory carries everything forward.`);
    this.say(ctx, statsToMarkdown('Session statistics', stats));
    this.anchor(ctx, file, path.basename(file));
  }

  reportStatus(ctx: AgentContext): void {
    const m = this.m;
    const stats = computeStats(this.s.log.readSession());
    const v = m.architecture.versions.find((x) => x.version === m.architecture.currentVersion);
    this.say(
      ctx,
      [
        `### ${m.projectName || 'No project yet'}`,
        `- Phase: \`${m.phase}\``,
        `- Session: \`${this.s.log.sessionId}\` (chapters written: ${m.developmentHistory.length})`,
        `- Architecture: ${v ? `v${v.version} (${v.approved ? 'approved' : 'draft'})` : '—'}`,
        `- Implementation: ${m.implementationStatus}`,
        `- Completed features: ${m.completedFeatures.length} · Known bugs: ${m.knownBugs.length} · Outstanding issues: ${m.outstandingIssues.length}`,
        m.openQuestions.length ? `- Open questions: ${m.openQuestions.length}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    if (m.roadmap.length) {
      this.say(ctx, this.roadmapTable());
    }
    this.say(ctx, statsToMarkdown('Current session statistics', stats));
    this.say(ctx, ctx.models.toMarkdown());
    if (m.developmentHistory.length) {
      this.say(ctx, '### Development history\n' + m.developmentHistory.map((c) => `- Chapter ${String(c.chapter).padStart(2, '0')}: ${c.title} (${c.date.slice(0, 10)})`).join('\n'));
    }
    this.anchor(ctx, this.s.paths.memoryFile, 'memory.json');
    if (fs.existsSync(this.s.log.file)) {
      this.anchor(ctx, this.s.log.file, 'activity log');
    }
  }

  // ------------------------------------------------------------ LM helpers

  private async review(ctx: AgentContext, subject: string, content: string, supporting: string): Promise<{ decision: 'forward' | 'revise'; notes: string[] }> {
    this.progress(ctx, `reviewing the ${subject}…`);
    const text = await this.chat(
      ctx,
      [
        `# Original idea from the user\n${this.m.originalIdea}`,
        `# ${subject} to review\n${truncate(content, 20_000)}`,
        supporting ? `# Supporting material\n${truncate(supporting, 8_000)}` : '',
        `Review the ${subject}: does it stay true to the user's idea, is it complete, consistent and realistic? Give 3–7 short review notes (strengths may be included but focus on gaps), then the decision JSON. Choose "revise" only for substantial problems.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    const json = extractLastJson<{ decision?: string; notes?: unknown }>(text);
    const decision = json?.decision === 'revise' ? 'revise' : 'forward';
    const notes = asStringArray(json?.notes);
    this.s.log.append('decision', 'collaborator', `Review of ${subject}: ${decision}`, { notes, review: stripLastJsonBlock(text).slice(0, 1500) });
    return { decision, notes };
  }

  async answer(question: string, ctx: AgentContext): Promise<void> {
    this.s.log.append('decision', 'collaborator', 'Answering user question from project memory', { question: question.slice(0, 300) });
    const text = await this.chat(
      ctx,
      [
        this.s.memory.toPromptContext({ includeArchitecture: truncate(this.currentArchitectureMarkdown(), 25_000) }),
        `# User message\n${question}`,
        'Answer as the Collaborator. If the user is requesting a change to requirements or architecture, explain that they can use `/revise <feedback>`; if they want to continue building, `/build`.',
      ].join('\n\n'),
      { onText: (t) => ctx.stream?.markdown(t) },
    );
    if (!text.trim()) {
      this.say(ctx, 'I have no answer for that yet.');
    }
    ctx.stream?.markdown('\n\n');
  }
}

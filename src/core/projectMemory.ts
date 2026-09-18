import * as fs from 'fs';
import * as path from 'path';
import { ArchitectureVersion, Phase, RoadmapItem } from '../agents/types';

export interface ChapterRecord {
  chapter: number;
  title: string;
  file: string;
  sessionId: string;
  date: string;
}

/** Persistent project knowledge so agents never have to rediscover the project. */
export interface ProjectMemory {
  projectName: string;
  createdAt: string;
  updatedAt: string;
  phase: Phase;
  sessionCount: number;
  originalIdea: string;
  refinedRequirements: string;
  openQuestions: string[];
  research: string;
  requirementsSummary: string;
  architecture: {
    currentVersion: string;
    versions: ArchitectureVersion[];
  };
  technicalDecisions: string[];
  implementationStatus: string;
  completedFeatures: string[];
  knownBugs: string[];
  resolvedBugs: string[];
  outstandingIssues: string[];
  constraints: string[];
  codingConventions: string[];
  projectStructure: string;
  roadmap: RoadmapItem[];
  developmentHistory: ChapterRecord[];
  currentSegmentId?: string;
}

function emptyMemory(): ProjectMemory {
  const now = new Date().toISOString();
  return {
    projectName: '',
    createdAt: now,
    updatedAt: now,
    phase: 'idle',
    sessionCount: 0,
    originalIdea: '',
    refinedRequirements: '',
    openQuestions: [],
    research: '',
    requirementsSummary: '',
    architecture: { currentVersion: '', versions: [] },
    technicalDecisions: [],
    implementationStatus: 'Not started',
    completedFeatures: [],
    knownBugs: [],
    resolvedBugs: [],
    outstandingIssues: [],
    constraints: [],
    codingConventions: [],
    projectStructure: '',
    roadmap: [],
    developmentHistory: [],
  };
}

export class ProjectMemoryStore {
  data: ProjectMemory;

  constructor(private readonly file: string) {
    this.data = this.load();
  }

  private load(): ProjectMemory {
    try {
      if (fs.existsSync(this.file)) {
        return { ...emptyMemory(), ...(JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ProjectMemory>) };
      }
    } catch {
      // corrupted memory: start fresh but keep a backup
      fs.copyFileSync(this.file, this.file + '.corrupt-' + Date.now());
    }
    return emptyMemory();
  }

  save(): void {
    this.data.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  reset(): void {
    this.data = emptyMemory();
    this.save();
  }

  /** Compact textual form injected into agent prompts. */
  toPromptContext(opts: { includeArchitecture?: string } = {}): string {
    const m = this.data;
    const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)');
    const roadmap = m.roadmap.length
      ? m.roadmap.map((r) => `- [${r.status}] ${r.id}: ${r.title}`).join('\n')
      : '- (none yet)';
    return [
      `# Project Memory: ${m.projectName || '(unnamed)'}`,
      `Phase: ${m.phase} | Sessions: ${m.sessionCount} | Architecture: v${m.architecture.currentVersion || '-'}`,
      `Implementation status: ${m.implementationStatus}`,
      '',
      '## Original idea',
      m.originalIdea || '(none)',
      '',
      '## Requirements summary',
      m.requirementsSummary || m.refinedRequirements || '(none)',
      '',
      '## Technical decisions',
      list(m.technicalDecisions),
      '',
      '## Constraints',
      list(m.constraints),
      '',
      '## Coding conventions',
      list(m.codingConventions),
      '',
      '## Project structure',
      m.projectStructure || '(not defined)',
      '',
      '## Roadmap / development segments',
      roadmap,
      '',
      '## Completed features',
      list(m.completedFeatures),
      '',
      '## Known bugs',
      list(m.knownBugs),
      '',
      '## Outstanding issues',
      list(m.outstandingIssues),
      opts.includeArchitecture ? `\n## Approved architecture (v${m.architecture.currentVersion})\n${opts.includeArchitecture}` : '',
    ].join('\n');
  }
}

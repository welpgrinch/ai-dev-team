export type AgentRole =
  | 'collaborator'
  | 'idea-refiner'
  | 'research'
  | 'architect'
  | 'prompt-engineer'
  | 'coder'
  | 'tester'
  | 'debugger'
  | 'summarizer';

export const AGENT_ROLES: readonly AgentRole[] = ['collaborator', 'idea-refiner', 'research', 'architect', 'prompt-engineer', 'coder', 'tester', 'debugger', 'summarizer'];

export type Actor = AgentRole | 'user' | 'system';

export type Phase =
  | 'idle'
  | 'refining'
  | 'awaiting-requirements-approval'
  | 'architecting'
  | 'awaiting-architecture-approval'
  | 'developing';

export type ProjectComplexity = 'simple' | 'standard' | 'complex';

export interface RefinedConcept {
  markdown: string;
  projectName?: string;
  openQuestions: string[];
  researchRequests: string[];
  complexity: ProjectComplexity;
}

export interface ArchitectureMeta {
  roadmap: RoadmapItem[];
  decisions: string[];
  conventions: string[];
  constraints: string[];
  projectStructure: string;
  changelog?: string;
}

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'done' | 'blocked';
}

export interface ArchitectureVersion {
  version: string;
  file: string;
  pdf?: string;
  approved: boolean;
  createdAt: string;
  changelog: string;
}

export interface CodingTask {
  id: string;
  title: string;
  objective: string;
  architectureSection: string;
  filesMayChange: string[];
  filesMustNotChange: string[];
  requiredFunctionality: string[];
  dependencies: string[];
  expectedOutput: string;
  testingRequirements: string[];
  acceptanceCriteria: string[];
}

export interface CoderReport {
  filesCreated: string[];
  filesModified: string[];
  codeImplemented: string;
  dependenciesAdded: string[];
  commandsExecuted: string[];
  problems: string[];
  status: 'complete' | 'partial' | 'blocked';
  summary: string;
}

export interface TestFailure {
  what: string;
  where: string;
  how: string;
  errorMessage: string;
  expected: string;
  actual: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  reproductionSteps: string[];
}

export interface TestResult {
  status: 'pass' | 'fail';
  summary: string;
  testsRun: number;
  failures: TestFailure[];
  warnings: string[];
}

export interface DebugReport {
  rootCause: string;
  whatWasChanged: string;
  filesModified: string[];
  testsRun: string[];
  summary: string;
}

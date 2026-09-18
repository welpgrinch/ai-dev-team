import * as path from 'path';

/** All project-local storage lives under `.aidevteam/` in the workspace root. */
export class ProjectPaths {
  constructor(readonly root: string) {}

  get dataDir(): string {
    return path.join(this.root, '.aidevteam');
  }
  get memoryFile(): string {
    return path.join(this.dataDir, 'memory.json');
  }
  get logsDir(): string {
    return path.join(this.dataDir, 'logs');
  }
  get architectureDir(): string {
    return path.join(this.dataDir, 'architecture');
  }
  get chaptersDir(): string {
    return path.join(this.dataDir, 'chapters');
  }
  get tasksDir(): string {
    return path.join(this.dataDir, 'tasks');
  }
  get requirementsFile(): string {
    return path.join(this.dataDir, 'requirements.md');
  }
  get researchFile(): string {
    return path.join(this.dataDir, 'research.md');
  }
  get pdfDir(): string {
    return path.join(this.root, 'docs', 'architecture');
  }

  /** Resolves a workspace-relative path and rejects anything escaping the root. */
  resolveInside(relative: string): string {
    const resolved = path.resolve(this.root, relative);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new Error(`Path "${relative}" is outside the workspace`);
    }
    return resolved;
  }

  toRelative(absolute: string): string {
    return path.relative(this.root, absolute).split(path.sep).join('/');
  }

  isInternal(absolute: string): boolean {
    const rel = this.toRelative(absolute);
    return (
      rel.startsWith('.aidevteam/') ||
      rel.startsWith('node_modules/') ||
      rel.startsWith('.git/') ||
      rel.startsWith('out/') ||
      rel.startsWith('dist/')
    );
  }
}

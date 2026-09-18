import * as vscode from 'vscode';
import { ActivityLog } from './activityLog';
import { ProjectPaths } from './paths';
import { RecentWrites } from './recentWrites';

/** Logs file changes made outside the agent tools (user edits, build output, git checkouts). */
export class WorkspaceFileWatcher implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly paths: ProjectPaths,
    private readonly log: ActivityLog,
    private readonly recentWrites: RecentWrites,
  ) {
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(paths.root, '**/*'));
    this.disposables.push(
      this.watcher.onDidCreate((u) => this.record('file-created', u)),
      this.watcher.onDidChange((u) => this.record('file-modified', u)),
      this.watcher.onDidDelete((u) => this.record('file-deleted', u)),
    );
  }

  private async record(type: 'file-created' | 'file-modified' | 'file-deleted', uri: vscode.Uri): Promise<void> {
    if (this.paths.isInternal(uri.fsPath) || this.recentWrites.isRecent(uri.fsPath)) {
      return;
    }
    if (type !== 'file-deleted') {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.Directory) {
          return;
        }
      } catch {
        return;
      }
    }
    const rel = this.paths.toRelative(uri.fsPath);
    this.log.append(type, 'user', rel, { path: rel, source: 'workspace' });
  }

  dispose(): void {
    this.watcher.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

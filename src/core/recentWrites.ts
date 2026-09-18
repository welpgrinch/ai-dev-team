/** Tracks files recently written by agents so the workspace watcher does not double-log them. */
export class RecentWrites {
  private readonly stamps = new Map<string, number>();

  constructor(private readonly windowMs = 3000) {}

  mark(fsPath: string): void {
    this.stamps.set(fsPath.toLowerCase(), Date.now());
  }

  isRecent(fsPath: string): boolean {
    const t = this.stamps.get(fsPath.toLowerCase());
    if (t === undefined) {
      return false;
    }
    if (Date.now() - t > this.windowMs) {
      this.stamps.delete(fsPath.toLowerCase());
      return false;
    }
    return true;
  }
}

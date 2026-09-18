import * as fs from 'fs';
import * as vscode from 'vscode';
import { ArchitectAgent } from './agents/architect';
import { CoderAgent } from './agents/coder';
import { Collaborator, TeamServices } from './agents/collaborator';
import { DebuggerAgent } from './agents/debuggerAgent';
import { IdeaRefinerAgent } from './agents/ideaRefiner';
import { PromptEngineerAgent } from './agents/promptEngineer';
import { ResearchAgent } from './agents/research';
import { SummarizerAgent } from './agents/summarizer';
import { TesterAgent } from './agents/tester';
import { registerParticipant } from './chat/participant';
import { ActivityLog } from './core/activityLog';
import { WorkspaceFileWatcher } from './core/fileWatcher';
import { ModelRouter } from './core/modelRouter';
import { ProjectPaths } from './core/paths';
import { ProjectMemoryStore } from './core/projectMemory';
import { RecentWrites } from './core/recentWrites';
import { getSettings } from './core/settings';
import { TerminalMonitor } from './core/terminalMonitor';
import { MermaidRenderer } from './docs/mermaidRenderer';
import { PdfGenerator } from './docs/pdfGenerator';
import { createResearchTools, createWorkspaceTools } from './tools/agentTools';

let teamDisposables: vscode.Disposable[] = [];

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('AI Dev Team');
  context.subscriptions.push(output);

  const setup = () => {
    teamDisposables.forEach((d) => d.dispose());
    teamDisposables = [];
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      output.appendLine('No workspace folder open — the AI Dev Team needs a folder to work in.');
      teamDisposables.push(registerPlaceholderParticipant());
      return;
    }
    teamDisposables.push(...buildTeam(context, folder.uri.fsPath, output));
  };

  setup();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(setup),
    new vscode.Disposable(() => teamDisposables.forEach((d) => d.dispose())),
    vscode.commands.registerCommand('aiDevTeam.showOutput', () => output.show(true)),
  );
}

export function deactivate(): void {
  teamDisposables.forEach((d) => d.dispose());
}

function registerPlaceholderParticipant(): vscode.Disposable {
  return vscode.chat.createChatParticipant('ai-dev-team.devteam', async (_req, _ctx, stream) => {
    stream.markdown('Open a folder (File → Open Folder) first — the AI Dev Team stores the project memory, logs and architecture inside the workspace.');
    return {};
  });
}

function buildTeam(context: vscode.ExtensionContext, root: string, output: vscode.OutputChannel): vscode.Disposable[] {
  const paths = new ProjectPaths(root);
  const log = new ActivityLog(paths.logsDir, output);
  const memory = new ProjectMemoryStore(paths.memoryFile);
  const recentWrites = new RecentWrites();
  const settings = getSettings;
  const pdf = new PdfGenerator(new MermaidRenderer(context.extensionUri));

  const readOnlyTools = () =>
    createWorkspaceTools({
      paths,
      log,
      recentWrites,
      actor: 'prompt-engineer',
      allowWrite: false,
      allowCommands: false,
      commandTimeoutMs: settings().commandTimeoutMs,
    });

  const services: TeamServices = {
    paths,
    memory,
    log,
    recentWrites,
    pdf,
    models: new ModelRouter(log, settings),
    settings,
    agents: {
      ideaRefiner: new IdeaRefinerAgent(),
      research: new ResearchAgent(() => createResearchTools(log)),
      architect: new ArchitectAgent(),
      promptEngineer: new PromptEngineerAgent(readOnlyTools),
      coder: new CoderAgent(),
      tester: new TesterAgent(),
      debugger: new DebuggerAgent(),
      summarizer: new SummarizerAgent(),
    },
  };
  const collaborator = new Collaborator(services);

  if (memory.data.originalIdea) {
    log.append('session-start', 'system', `Session ${log.sessionId} started for "${memory.data.projectName}" (phase ${memory.data.phase})`);
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'aiDevTeam.showOutput';
  const refreshStatus = () => {
    const m = memory.data;
    status.text = `$(organization) Dev Team: ${m.projectName ? `${m.projectName} · ${m.phase}` : 'idle'}`;
    status.tooltip = `AI Dev Team — ${m.implementationStatus}\nSession ${log.sessionId}`;
    status.show();
  };
  refreshStatus();

  const openFile = async (file: string | undefined, missing: string) => {
    if (!file || !fs.existsSync(file)) {
      void vscode.window.showInformationMessage(missing);
      return;
    }
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
  };

  return [
    log,
    new TerminalMonitor(log),
    new WorkspaceFileWatcher(paths, log, recentWrites),
    registerParticipant(services, collaborator),
    status,
    log.onDidAppend(refreshStatus),
    vscode.commands.registerCommand('aiDevTeam.openArchitecture', () => {
      const v = memory.data.architecture.versions.find((x) => x.version === memory.data.architecture.currentVersion);
      return openFile(v?.pdf ?? v?.file, 'No architecture document has been generated yet.');
    }),
    vscode.commands.registerCommand('aiDevTeam.openActivityLog', () => openFile(log.file, 'No activity has been logged in this session yet.')),
    vscode.commands.registerCommand('aiDevTeam.openProjectMemory', () => openFile(paths.memoryFile, 'No project memory exists yet — start with @devteam /idea.')),
    vscode.commands.registerCommand('aiDevTeam.showModels', async () => {
      const content = `# AI Dev Team — model assignment\n\n${await services.models.report()}\n`;
      const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
  ];
}

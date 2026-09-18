import * as vscode from 'vscode';
import { AgentContext } from '../agents/base';
import { Collaborator, TeamServices } from '../agents/collaborator';

export const PARTICIPANT_ID = 'ai-dev-team.devteam';

interface DevTeamResult extends vscode.ChatResult {
  metadata: { phase: string; command?: string };
}

export function registerParticipant(services: TeamServices, collaborator: Collaborator): vscode.ChatParticipant {
  const handler: vscode.ChatRequestHandler = async (request, _context, stream, token): Promise<DevTeamResult> => {
    const ctx: AgentContext = {
      models: await services.models.assign(request.model),
      token,
      log: services.log,
      stream,
      maxToolRounds: services.settings().maxToolRounds,
    };
    try {
      switch (request.command) {
        case 'idea':
          await collaborator.handleIdeaCommand(request.prompt, ctx);
          break;
        case 'approve':
          await collaborator.handleApprove(request.prompt, ctx);
          break;
        case 'revise':
          await collaborator.handleRevise(request.prompt, ctx);
          break;
        case 'build':
          await collaborator.runNextSegment(ctx, /\b(all|everything|rest|remaining)\b/i.test(request.prompt));
          break;
        case 'architecture':
          await collaborator.regeneratePdf(ctx);
          break;
        case 'status':
          collaborator.reportStatus(ctx);
          break;
        case 'models':
          stream.markdown((await services.models.report()) + '\n\n');
          break;
        case 'end':
          await collaborator.endSession(ctx);
          break;
        default:
          await collaborator.handleMessage(request.prompt, ctx);
      }
    } catch (err) {
      if (err instanceof vscode.CancellationError || token.isCancellationRequested) {
        services.log.append('warning', 'system', 'Operation cancelled by user');
        stream.markdown('\n\n_Cancelled. The project memory reflects the last completed step; use `/status` to see where we are._');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        services.log.append('error', 'system', `Unhandled error: ${message}`);
        if (err instanceof vscode.LanguageModelError) {
          stream.markdown(`\n\n**Language model error** (${err.code}): ${message}`);
        } else {
          stream.markdown(`\n\n**Error:** ${message}`);
        }
      }
    }
    return { metadata: { phase: services.memory.data.phase, command: request.command } };
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon('organization');
  participant.followupProvider = {
    provideFollowups(): vscode.ChatFollowup[] {
      const m = services.memory.data;
      switch (m.phase) {
        case 'idle':
          return [{ prompt: 'A web app that …', label: 'Describe your idea', command: 'idea' }];
        case 'awaiting-requirements-approval':
          return [
            { prompt: '', label: 'Approve requirements → Architect', command: 'approve' },
            { prompt: 'Change: ', label: 'Request changes', command: 'revise' },
          ];
        case 'awaiting-architecture-approval':
          return [
            { prompt: '', label: 'Approve architecture → start development', command: 'approve' },
            { prompt: 'Change: ', label: 'Revise architecture', command: 'revise' },
          ];
        case 'developing': {
          const next = m.roadmap.find((r) => r.status === 'in-progress') ?? m.roadmap.find((r) => r.status === 'pending');
          const list: vscode.ChatFollowup[] = [];
          if (next) {
            list.push({ prompt: '', label: `Build ${next.id} — ${next.title}`, command: 'build' });
            list.push({ prompt: 'all', label: 'Build all remaining segments', command: 'build' });
          }
          list.push({ prompt: '', label: 'Show status', command: 'status' }, { prompt: '', label: 'End session → write chapter', command: 'end' });
          return list;
        }
        default:
          return [{ prompt: '', label: 'Show status', command: 'status' }];
      }
    },
  };
  return participant;
}

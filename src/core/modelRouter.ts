import * as vscode from 'vscode';
import { AGENT_ROLES, AgentRole } from '../agents/types';
import { ActivityLog } from './activityLog';
import { Settings } from './settings';

export interface RoleModelPreference {
  /** Ordered, case-insensitive fragments matched against model id, family and name; the first fragment with an available match wins. */
  prefer: string[];
  /** Fragments that disqualify a model for this role. */
  avoid: string[];
}

const SMALL_VARIANTS = ['mini', 'nano', 'haiku', 'flash', 'lite', 'fast'];
const NOT_FOR_REASONING = [...SMALL_VARIANTS, 'codex'];

// Frontier tier first ("fable" = newest Claude Fable, "astrea" = newest GPT Astrea), older families as fallbacks.
const CLAUDE_FIRST = ['fable', 'astrea', 'claude-opus', 'claude-sonnet', 'gpt-5', 'gemini', 'gpt'];
const GPT_FIRST = ['astrea', 'fable', 'gpt-5', 'claude-opus', 'claude-sonnet', 'gemini', 'gpt'];

/**
 * Best-fit model per role. Fragments match any version, so "fable" resolves to the newest Claude Fable the user has
 * enabled and the trailing "gpt" catches future OpenAI generations. Everything except summarizing goes to the strongest
 * available model; the Tester prefers the other family than the Coder so the verifier does not share the author's blind spots.
 */
export const DEFAULT_MODEL_PREFERENCES: Record<AgentRole, RoleModelPreference> = {
  collaborator: { prefer: CLAUDE_FIRST, avoid: NOT_FOR_REASONING },
  'idea-refiner': { prefer: CLAUDE_FIRST, avoid: NOT_FOR_REASONING },
  research: { prefer: GPT_FIRST, avoid: NOT_FOR_REASONING },
  architect: { prefer: CLAUDE_FIRST, avoid: NOT_FOR_REASONING },
  'prompt-engineer': { prefer: CLAUDE_FIRST, avoid: NOT_FOR_REASONING },
  coder: { prefer: ['fable', 'astrea', 'claude-sonnet', 'gpt-5-codex', 'gpt-5', 'claude-opus', 'gemini', 'gpt'], avoid: SMALL_VARIANTS },
  tester: { prefer: ['astrea', 'fable', 'gpt-5-codex', 'gpt-5', 'claude-sonnet', 'gemini', 'gpt'], avoid: SMALL_VARIANTS },
  debugger: { prefer: ['fable', 'astrea', 'claude-sonnet', 'claude-opus', 'gpt-5', 'gpt-5-codex', 'gemini', 'gpt'], avoid: SMALL_VARIANTS },
  summarizer: { prefer: ['claude-haiku', 'gpt-5-mini', 'fable', 'astrea', 'claude-sonnet', 'gpt-4.1', 'gpt'], avoid: [] },
};

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-');
}

function keys(model: vscode.LanguageModelChat): string[] {
  return [model.id, model.family, model.name].map(norm);
}

/** Natural ordering: "claude-sonnet-4.5" > "claude-sonnet-4", "gpt-5" > "gpt-4.1". */
function naturalCompare(a: string, b: string): number {
  const ta = a.match(/\d+|\D+/g) ?? [];
  const tb = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i];
    const y = tb[i];
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d) {
        return d;
      }
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return ta.length - tb.length;
}

export interface ModelMatch {
  model: vscode.LanguageModelChat;
  /** The preference fragment that selected the model. */
  fragment: string;
}

/** Finds the newest available model matching the earliest preference fragment (exact id/family match beats substring match). */
export function matchModel(available: readonly vscode.LanguageModelChat[], pref: RoleModelPreference): ModelMatch | undefined {
  const avoid = pref.avoid.map(norm);
  const eligible = available.filter((m) => !keys(m).some((k) => avoid.some((a) => k.includes(a))));
  for (const fragment of pref.prefer.map(norm)) {
    const exact = eligible.filter((m) => keys(m).includes(fragment));
    const pool = exact.length ? exact : eligible.filter((m) => keys(m).some((k) => k.includes(fragment)));
    if (pool.length) {
      return { model: [...pool].sort((a, b) => naturalCompare(norm(b.id), norm(a.id)))[0], fragment };
    }
  }
  return undefined;
}

function roleLabel(role: AgentRole): string {
  return role
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** The models resolved for one chat request. */
export class ModelAssignment {
  constructor(
    /** The model chosen in the chat model picker — used for roles without a match and when an assigned model fails. */
    readonly fallback: vscode.LanguageModelChat,
    private readonly byRole: ReadonlyMap<AgentRole, vscode.LanguageModelChat>,
  ) {}

  forRole(role: AgentRole): vscode.LanguageModelChat {
    return this.byRole.get(role) ?? this.fallback;
  }

  signature(): string {
    return AGENT_ROLES.map((r) => `${r}=${this.forRole(r).id}`).join(';');
  }

  toMarkdown(): string {
    return ['### Model assignment', '', '| Agent | Model |', '|---|---|', ...AGENT_ROLES.map((r) => `| ${roleLabel(r)} | ${this.forRole(r).name} |`)].join('\n');
  }
}

/** Assigns the best-suited language model to each agent role from the models available in VS Code. */
export class ModelRouter {
  private lastSignature = '';

  constructor(
    private readonly log: ActivityLog,
    private readonly settings: () => Settings,
  ) {}

  /** The chat models VS Code currently exposes to extensions (empty when Copilot is unavailable). */
  async available(): Promise<vscode.LanguageModelChat[]> {
    try {
      return await vscode.lm.selectChatModels();
    } catch (err) {
      this.log.append('warning', 'system', `Could not list language models: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private preferenceFor(role: AgentRole, s: Settings): { pref: RoleModelPreference; custom: boolean } {
    const custom = s.modelPreferences[role];
    return custom ? { pref: { prefer: custom, avoid: [] }, custom: true } : { pref: DEFAULT_MODEL_PREFERENCES[role], custom: false };
  }

  async assign(fallback: vscode.LanguageModelChat): Promise<ModelAssignment> {
    const s = this.settings();
    const byRole = new Map<AgentRole, vscode.LanguageModelChat>();
    if (s.assignModelsPerAgent) {
      const available = await this.available();
      for (const role of AGENT_ROLES) {
        const match = matchModel(available, this.preferenceFor(role, s).pref);
        if (match) {
          byRole.set(role, match.model);
        }
      }
    }
    const assignment = new ModelAssignment(fallback, byRole);
    const signature = assignment.signature();
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.log.append('model-assignment', 'system', AGENT_ROLES.map((r) => `${r} → ${assignment.forRole(r).name}`).join(', '), {
        models: Object.fromEntries(AGENT_ROLES.map((r) => [r, assignment.forRole(r).id])),
      });
    }
    return assignment;
  }

  /** Markdown overview of every model VS Code exposes and which agent gets which — for `/models` and the Show Model Assignment command. */
  async report(): Promise<string> {
    const s = this.settings();
    const available = await this.available();
    const lines = ['### Available language models', ''];
    if (!available.length) {
      lines.push('_No language models are exposed to extensions. Sign in to GitHub Copilot Chat and enable the models you want in the chat model picker (Manage Models…)._');
    } else {
      lines.push('| Model | Id | Family | Vendor | Max input |', '|---|---|---|---|---|');
      for (const m of [...available].sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(`| ${m.name} | \`${m.id}\` | \`${m.family}\` | ${m.vendor} | ${m.maxInputTokens.toLocaleString()} |`);
      }
    }
    lines.push('', '### Agent → model', '');
    if (!s.assignModelsPerAgent) {
      lines.push('_`aiDevTeam.assignModelsPerAgent` is off: every agent uses the model selected in the chat model picker._');
      return lines.join('\n');
    }
    lines.push('| Agent | Model | Matched by | Preference order |', '|---|---|---|---|');
    for (const role of AGENT_ROLES) {
      const { pref, custom } = this.preferenceFor(role, s);
      const match = matchModel(available, pref);
      lines.push(`| ${roleLabel(role)} | ${match ? `**${match.model.name}**` : '_chat picker model_'} | ${match ? `\`${match.fragment}\`` : '—'} | ${pref.prefer.join(' → ')}${custom ? ' _(custom)_' : ''} |`);
    }
    lines.push('', 'Fragments match id, family and name case-insensitively and the newest matching version wins. Override a role with `aiDevTeam.models`, e.g. `{ "summarizer": ["fable"] }`.');
    return lines.join('\n');
  }
}

import * as vscode from 'vscode';
import { AGENT_ROLES, AgentRole } from '../agents/types';

export interface Settings {
  maxDebugCycles: number;
  allowCommands: boolean;
  commandTimeoutMs: number;
  maxToolRounds: number;
  assignModelsPerAgent: boolean;
  /** Per-role model preferences from `aiDevTeam.models`; roles not listed use the built-in defaults. */
  modelPreferences: Partial<Record<AgentRole, string[]>>;
}

export function getSettings(): Settings {
  const c = vscode.workspace.getConfiguration('aiDevTeam');
  return {
    maxDebugCycles: Math.max(0, c.get<number>('maxDebugCycles', 3)),
    allowCommands: c.get<boolean>('allowCommands', true),
    commandTimeoutMs: Math.max(5, c.get<number>('commandTimeoutSeconds', 180)) * 1000,
    maxToolRounds: Math.max(1, c.get<number>('maxToolRounds', 40)),
    assignModelsPerAgent: c.get<boolean>('assignModelsPerAgent', true),
    modelPreferences: readModelPreferences(c.get<unknown>('models', {})),
  };
}

function readModelPreferences(raw: unknown): Partial<Record<AgentRole, string[]>> {
  const out: Partial<Record<AgentRole, string[]>> = {};
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  for (const role of AGENT_ROLES) {
    const value = (raw as Record<string, unknown>)[role];
    const list: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    const clean = list.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
    if (clean.length) {
      out[role] = clean;
    }
  }
  return out;
}

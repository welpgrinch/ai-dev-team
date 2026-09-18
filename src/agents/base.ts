import * as vscode from 'vscode';
import { ActivityLog } from '../core/activityLog';
import { ModelAssignment } from '../core/modelRouter';
import { AgentTool } from '../tools/agentTools';
import { AgentRole } from './types';

export interface AgentContext {
  /** Per-role model assignment; `models.fallback` is the model chosen in the chat model picker. */
  models: ModelAssignment;
  token: vscode.CancellationToken;
  log: ActivityLog;
  stream?: vscode.ChatResponseStream;
  maxToolRounds: number;
}

export interface ChatOptions {
  tools?: AgentTool[];
  onText?: (chunk: string) => void;
  history?: vscode.LanguageModelChatMessage[];
}

export abstract class BaseAgent {
  constructor(
    readonly role: AgentRole,
    readonly displayName: string,
    protected readonly systemPrompt: string,
  ) {}

  protected progress(ctx: AgentContext, message: string): void {
    ctx.stream?.progress(`${this.displayName}: ${message}`);
  }

  /** Sends a request to this agent's assigned language model, transparently executing tool calls until the model produces a final answer. */
  protected async chat(ctx: AgentContext, userContent: string, opts: ChatOptions = {}): Promise<string> {
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(this.systemPrompt),
      ...(opts.history ?? []),
      vscode.LanguageModelChatMessage.User(userContent),
    ];
    const toolMap = new Map((opts.tools ?? []).map((t) => [t.definition.name, t] as const));
    const requestOptions: vscode.LanguageModelChatRequestOptions = {
      justification: `AI Dev Team — ${this.displayName}`,
    };
    if (toolMap.size) {
      requestOptions.tools = [...toolMap.values()].map((t) => t.definition);
      requestOptions.toolMode = vscode.LanguageModelChatToolMode.Auto;
    }

    const active = { model: ctx.models.forRole(this.role) };
    let finalText = '';
    for (let round = 0; ; round++) {
      if (ctx.token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      const response = await this.send(ctx, active, messages, requestOptions);
      let text = '';
      const calls: vscode.LanguageModelToolCallPart[] = [];
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          text += part.value;
          opts.onText?.(part.value);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          calls.push(part);
        }
      }
      if (text) {
        finalText += (finalText ? '\n' : '') + text;
      }
      if (!calls.length) {
        break;
      }
      if (round >= ctx.maxToolRounds) {
        finalText += '\n\n[Tool round limit reached — stopping.]';
        ctx.log.append('warning', this.role, `Tool round limit (${ctx.maxToolRounds}) reached`);
        break;
      }

      const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
      if (text) {
        assistantParts.push(new vscode.LanguageModelTextPart(text));
      }
      assistantParts.push(...calls);
      messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

      const results: vscode.LanguageModelToolResultPart[] = [];
      for (const call of calls) {
        const tool = toolMap.get(call.name);
        let output: string;
        try {
          output = tool ? await tool.run(call.input, ctx.token) : `Unknown tool: ${call.name}`;
        } catch (err) {
          output = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
        results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(output)]));
      }
      messages.push(vscode.LanguageModelChatMessage.User(results));
    }
    return finalText;
  }

  /** Sends one request; if the role's assigned model is rejected (quota, permissions, unavailable), retries once with the picker's model. */
  private async send(
    ctx: AgentContext,
    active: { model: vscode.LanguageModelChat },
    messages: vscode.LanguageModelChatMessage[],
    options: vscode.LanguageModelChatRequestOptions,
  ): Promise<vscode.LanguageModelChatResponse> {
    try {
      return await active.model.sendRequest(messages, options, ctx.token);
    } catch (err) {
      const fallback = ctx.models.fallback;
      if (active.model.id === fallback.id || !(err instanceof vscode.LanguageModelError) || ctx.token.isCancellationRequested) {
        throw err;
      }
      ctx.log.append('warning', this.role, `${active.model.name} failed (${err.code}); falling back to ${fallback.name}`);
      active.model = fallback;
      return fallback.sendRequest(messages, options, ctx.token);
    }
  }
}

/** Returns the last ```json fenced block in the text, parsed. */
export function extractLastJson<T>(text: string): T | undefined {
  const fence = /```json\s*([\s\S]*?)```/gi;
  let last: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    last = m[1];
  }
  if (!last) {
    const start = text.lastIndexOf('\n{');
    if (start >= 0) {
      last = text.slice(start + 1);
    }
  }
  if (!last) {
    return undefined;
  }
  try {
    return JSON.parse(last.trim()) as T;
  } catch {
    return undefined;
  }
}

export function stripLastJsonBlock(text: string): string {
  const fence = /```json\s*[\s\S]*?```/gi;
  let lastIndex = -1;
  let lastLength = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    lastIndex = m.index;
    lastLength = m[0].length;
  }
  if (lastIndex < 0) {
    return text.trim();
  }
  return (text.slice(0, lastIndex) + text.slice(lastIndex + lastLength)).trim();
}

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter((x) => x.length > 0);
  }
  if (typeof v === 'string' && v.trim()) {
    return [v];
  }
  return [];
}

export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + `\n…[truncated ${text.length - maxChars} chars]` : text;
}

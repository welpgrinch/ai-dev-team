# AI Dev Team — VS Code extension

An AI-powered software development organization inside VS Code. You provide the idea; a team of specialized agents refines it, researches it, designs the architecture (with a professional PDF), writes the code in controlled segments, tests it, debugs it, and records everything that happened.

```
USER → COLLABORATOR → IDEA REFINER ↔ RESEARCH → COLLABORATOR REVIEW
     → SUMMARIZER (requirements summary) → ARCHITECT → ARCHITECTURE DOCUMENT + PDF
     → COLLABORATOR APPROVAL → PROMPT ENGINEER → CODER → TESTER
        ├─ PASS → COLLABORATOR → next segment
        └─ FAIL → DEBUGGER → TESTER (loop)
     → /end → SUMMARIZER → NEW DEVELOPMENT CHAPTER
```

## Requirements

- VS Code 1.95+ and the [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) extension with a signed-in Copilot subscription. The agents use the VS Code Language Model API, so no API keys are needed — they use the models your Copilot plan provides.
- Node.js 20+ only if you build the extension from source.

## Install

**From the Marketplace** — search for *AI Dev Team* in the Extensions view (`Ctrl+Shift+X`), or run:

```bash
code --install-extension welpgrinch.ai-dev-team
```

**From a `.vsix` file** (any computer, no Marketplace needed) — download `ai-dev-team-<version>.vsix` from the
[Releases](https://github.com/welpgrinch/ai-dev-team/releases) page (or build it yourself, see below), then either

- Extensions view → `…` menu → **Install from VSIX…**, or
- `code --install-extension ai-dev-team-0.1.0.vsix`

Reload the window afterwards (`Developer: Reload Window`).

## Use it

Open the folder your new project should live in (File → Open Folder — an empty folder is fine), open Copilot Chat (`Ctrl+Alt+I`) and talk to `@devteam`:

| Step | What to type | What happens |
|---|---|---|
| 1 | `@devteam A web app that …` (or `/idea …`) | Idea Refiner structures the idea, Research verifies facts, Collaborator reviews. |
| 2 | Answer the open questions, or `/approve` | The Architect gets a brief sized to the project (simple ideas skip research and the Summarizer pass) and writes the architecture document — compact for simple projects, full-depth for complex ones. |
| 3 | `/approve` or `/revise <feedback>` | Approved version becomes the official blueprint and the PDF is generated (`docs/architecture/*.pdf`); roadmap of development segments is created. |
| 4 | `/build` | Prompt Engineer → Coder → Tester → (Debugger → Tester)* → Collaborator approval for one segment. `/build all` builds every remaining segment back-to-back and only stops if one gets blocked. |
| 5 | `/status` | Phase, roadmap, live session statistics. |
| 6 | `/models` | Which language model each agent uses, and every model VS Code exposes. |
| 7 | `/end` | Summarizer writes `Chapter NN` with narrative, statistics, AI activity timeline and terminal activity. |

The first time an agent uses a model other than the one selected in the chat model picker, VS Code asks once for permission. Come back to a project later with `@devteam /status` — the project memory restores where you were. `/idea reset: <new idea>` starts over.

## What the agents may do on your machine

The Coder, Tester and Debugger work inside the opened workspace folder only: file tools refuse paths outside it and never touch `.aidevteam/`, `.git/`, `node_modules/` or build output; the Prompt Engineer can mark files as protected per task. `run_command` executes shell commands in the workspace (installs, builds, tests) with a timeout, a deny list for destructive system commands, and full logging of every command and its output. Set `aiDevTeam.allowCommands` to `false` for a dry run where agents can only read and write files. The Research agent may fetch public `http(s)` pages read-only. Review the activity log (`AI Dev Team: Open Activity Log`) whenever you want to see exactly what happened.

## What gets recorded

Everything lives in the project workspace:

```
.aidevteam/
  memory.json            project memory (requirements, decisions, roadmap, status, bugs, history)
  requirements.md        refined project concept
  research.md            research report
  architecture/vX.Y.md   every architecture version (machine-readable source)
  tasks/S01-….md         coding tasks written by the Prompt Engineer
  logs/<session>.jsonl   development activity log (commands, output, files, handoffs, tests, decisions)
  chapters/chapter-01-….md   development chapters written by the Summarizer
docs/architecture/<project>-architecture-vX.Y.pdf
```

The activity log also captures commands you run yourself in VS Code terminals (via shell integration) and file changes made outside the agents.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `aiDevTeam.maxDebugCycles` | 3 | Tester → Debugger → Tester cycles before a segment is marked blocked |
| `aiDevTeam.allowCommands` | true | Let Coder/Tester/Debugger run terminal commands |
| `aiDevTeam.commandTimeoutSeconds` | 180 | Timeout for agent commands |
| `aiDevTeam.maxToolRounds` | 40 | Max tool-call rounds per agent task |
| `aiDevTeam.assignModelsPerAgent` | true | Give each agent the model best suited to its job (see below); off = every agent uses the chat model picker's model |
| `aiDevTeam.models` | `{}` | Per-agent override: ordered list of model id/family/name fragments, e.g. `{ "summarizer": ["fable"], "tester": ["fable"] }` |

## Which model does each agent use?

Each role is matched against the models you have enabled in Copilot; fragments match any version, so `fable` means "the newest Claude Fable available". The defaults put the frontier models first — **Claude Fable** and **GPT Astrea** — and fall back to older families (Opus, Sonnet, GPT-5, Gemini) only when those are not available. If nothing matches, or an assigned model is rejected at request time, the agent falls back to the model selected in the chat model picker.

Run `@devteam /models` (or **AI Dev Team: Show Model Assignment** from the Command Palette) to see every model VS Code exposes to extensions and which agent got which. `/status` shows the assignment too, and every change is recorded in the activity log.

| Agent | Job | Default preference (first available wins) |
|---|---|---|
| Architect | Long, structured design document with diagrams and ADRs | Claude Fable → GPT Astrea → Claude Opus → Claude Sonnet → GPT-5 |
| Coder | Agentic implementation with file and terminal tools | Claude Fable → GPT Astrea → Claude Sonnet → GPT-5-Codex → GPT-5 |
| Debugger | Root-cause analysis and minimal fixes | Claude Fable → GPT Astrea → Claude Sonnet → Claude Opus → GPT-5 |
| Tester | Builds, runs tests, verifies acceptance criteria | GPT Astrea → Claude Fable → GPT-5-Codex → GPT-5 → Claude Sonnet |
| Prompt Engineer | Precise, architecture-bound coding tasks | Claude Fable → GPT Astrea → Claude Opus → Claude Sonnet → GPT-5 |
| Collaborator | Reviews, decisions, conversation with you | Claude Fable → GPT Astrea → Claude Opus → Claude Sonnet → GPT-5 |
| Idea Refiner | Requirements analysis and clarifying questions | Claude Fable → GPT Astrea → Claude Opus → Claude Sonnet → GPT-5 |
| Research | Fact-finding with documentation fetches | GPT Astrea → Claude Fable → GPT-5 → Claude Opus → Claude Sonnet |
| Summarizer | Faithful condensation of logs and reports | Claude Haiku → GPT-5 mini → Claude Fable → GPT Astrea → Claude Sonnet |

The Tester deliberately prefers the other family than the Coder, so the verifier does not share the author's blind spots. Small/fast variants (`mini`, `haiku`, `flash`, …) are excluded for every role except the Summarizer, whose job is faithful condensation and is well served by a fast model — set `"summarizer": ["fable"]` in `aiDevTeam.models` if you want the frontier model there too.

## Source layout

```
src/
  extension.ts            activation, wiring, commands, status bar
  chat/participant.ts     @devteam chat participant and follow-ups
  agents/                 collaborator, ideaRefiner, research, architect, promptEngineer,
                          coder, tester, debuggerAgent, summarizer, prompts, base (LM + tool loop)
  core/                   activityLog, projectMemory, sessionStats, terminalMonitor, fileWatcher, paths,
                          modelRouter (best model per agent), settings
  tools/                  agentTools (read/write/find/run_command/fetch_url), commandRunner
  docs/                   markdown parser, mermaidRenderer (webview), pdfGenerator, documentGuidelines
```

[SPEC.md](SPEC.md) is the system specification the extension implements.

## Development

```bash
npm install
npm run compile     # tsc + copies the Mermaid bundle to media/ + generates media/icon.png
```

Press **F5** (*Run Extension*) to start an Extension Development Host with the extension loaded, or `npm run watch` for incremental builds.

### Package and publish

```bash
npm run package     # -> ai-dev-team-<version>.vsix (installable on any machine, see Install)
npm run publish     # publish to the Marketplace (needs a publisher + Personal Access Token, see below)
```

## License

[MIT](LICENSE)

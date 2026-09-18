# Changelog

## 0.1.1

- `/build all` builds every remaining roadmap segment back-to-back, stopping only when a segment is blocked — no more typing `/build` once per segment.
- Coder, Tester, Debugger and Prompt Engineer now know the run_command shell (cmd.exe on Windows) and avoid Unix-only commands (`grep`, `sed`, `awk`, `mktemp`, `$(…)`), which previously caused long failure/retry loops.
- The Architect scales the roadmap and document depth to the project's complexity: a simple website is 1–3 segments instead of a mandatory 6–14 with a 90+ page document.
- Token efficiency: the Idea Refiner classifies every project as simple/standard/complex. Simple projects skip research and the Summarizer briefing, and the architecture document is written in ONE model call (9 focused sections) instead of three passes over 27 sections; standard projects use two passes over 18.
- The architecture PDF is generated once on approval instead of for every draft.
- Trimmed the context sent to the Collaborator reviews and the Prompt Engineer.
- Publisher changed to `welpgrinch`.

All notable changes to the AI Dev Team extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-09-18

### Added

- `@devteam` chat participant with the full development lifecycle: Idea Refiner ↔ Research, Collaborator review,
  Summarizer requirements brief, Architect (Markdown + Mermaid diagrams + PDF), Prompt Engineer, Coder, Tester,
  Debugger loop and Summarizer development chapters.
- Slash commands: `/idea`, `/approve`, `/revise`, `/build`, `/architecture`, `/status`, `/models`, `/end`.
- Project memory, append-only activity log (agent tool calls, user terminal commands, file changes), session
  statistics and AI activity timeline stored under `.aidevteam/`.
- Per-agent language model assignment (`aiDevTeam.assignModelsPerAgent`, `aiDevTeam.models`) with automatic
  fallback to the chat model picker's model.
- Commands: Open Architecture PDF, Open Activity Log, Open Project Memory, Show Live Activity Output,
  Show Model Assignment.

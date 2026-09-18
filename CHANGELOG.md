# Changelog

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

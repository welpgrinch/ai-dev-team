# AI Development Team — System Specification

## AI-Agent Architecture

The architecture should also document how the different AI agents communicate with each other.

For example:

**User → Collaborator → Idea Refiner → Research → Collaborator → Architect → Collaborator → Prompt Engineer → Coder → Tester → Debugger → Tester → Collaborator**

---

## 1. Collaborator AI

The Collaborator is the central controller of the system and the only agent that communicates directly with the user.
It acts as the project manager and orchestrator of the AI team.

It does not write code, design the architecture, or run tests itself. It decides who does what, reviews the results, and keeps the project aligned with the user's intent.

The Collaborator should:

- Receive the user's idea, requirements, feedback, and decisions.
- Forward the idea to the Idea Refiner and Research AI.
- Review the refined concept and research results before they move forward.
- Return open questions to the user and collect answers.
- Send the approved concept and research to the Summarizer, and forward the resulting requirements summary to the Architect.
- Review the architecture document and approve, reject, or request revisions.
- Send the approved architecture to the Prompt Engineer.
- Approve each development segment after the Tester has passed it.
- Decide the next development segment.
- Escalate unresolved problems or scope changes to the user.
- Send the complete session data to the Summarizer at the end of a session.
- Read and update the Project Memory.

Every handoff passes through the Collaborator:

**User → Collaborator → Specialized AI → Collaborator**

**Sanctioned exceptions.** To keep tight loops fast, two chains run directly between specialized agents. The Collaborator starts each chain, receives its final result, and records every step of it in the handoff log:

- **Idea Refiner ↔ Research** — fact requests during refinement (sections 2–3). The refined concept returns to the Collaborator.
- **Prompt Engineer → Coder → Tester → (Debugger → Tester)\*** — one development segment (sections 6–9). The Tester's final verdict returns to the Collaborator.

Outside these chains, no agent hands work to another agent directly.

For each handoff the Collaborator records:

- Receiving agent
- Task sent
- Result returned
- Decision (approve / reject / revise)
- Reason for the decision

The Collaborator is the single source of truth for the current project state.

---

## 2. Idea Refiner AI

The Idea Refiner receives the raw idea from the Collaborator and transforms it into a clear, structured project concept.
Users often describe ideas vaguely. The Idea Refiner removes ambiguity before anything is designed or built.

It should:

- Identify the core problem the project solves.
- Identify the target users.
- Separate core features from optional features.
- Detect missing information, contradictions, and unrealistic expectations.
- Formulate clarifying questions for the user (via the Collaborator).
- Propose scope boundaries: what is in, what is out.
- Define functional and non-functional requirements.
- Define success criteria.
- Request facts from the Research AI where technical or market knowledge is needed.

**Output: Refined Project Concept**

- Problem statement
- Target users
- Core features
- Optional features
- Functional requirements
- Non-functional requirements
- Constraints
- Assumptions
- Open questions
- Out of scope
- Success criteria

The Idea Refiner and Research AI may exchange several rounds before the refined concept is returned:

**Collaborator → Idea Refiner ↔ Research → Collaborator**

---

## 3. Research AI

The Research AI provides the technical and factual foundation for the project.
It primarily supports the Idea Refiner, and can be consulted by the Collaborator on behalf of the Architect.

It should investigate:

- Existing solutions and comparable products
- Suitable technologies, frameworks, and libraries
- Library maturity, maintenance status, and licensing
- API availability and limitations
- Platform constraints (e.g. VS Code extension API limits)
- Security considerations
- Performance considerations
- Best practices and common pitfalls
- Technical feasibility of requested features

**Output: Research Report**

- Research question
- Findings
- Options considered
- Comparison table
- Recommendation
- Risks
- Sources
- Confidence level

The Research AI must clearly separate verified facts from assumptions, and mark uncertain information.
It does not make product decisions; it informs the Idea Refiner and Collaborator, who decide.

**Idea Refiner → Research → Idea Refiner**
**Architect → Collaborator → Research → Collaborator → Architect** (for architecture-level questions)

---

## 4. Architect AI

The Architect receives the requirements summary from the Collaborator and designs the complete technical solution.
It defines **what should be built** and how all parts fit together, before any code is written.

It does not write application code. Its output is the blueprint every later agent must follow.

It should:

- Analyze the refined requirements and the research results.
- Select the technology stack and justify each choice.
- Design the system architecture: frontend, backend, database, APIs, and AI-agent workflow.
- Define the folder/project structure.
- Define data models, data flow, and user flow.
- Define security, authentication, deployment, error-handling, testing, and debugging strategies.
- Split the project into development phases and an implementation roadmap.
- Record every significant architecture decision with its reasoning and the alternatives that were rejected.
- State assumptions and limitations explicitly.
- Request additional research via the Collaborator when facts are missing.
- Produce the architecture document, diagrams, and PDF according to its document-generation guidelines (see section 5).

**Output: Architecture Document**

- Professional PDF (official technical blueprint)
- Source diagrams
- Machine-readable version (e.g. Markdown with stable section IDs) so the Prompt Engineer can reference exact sections in coding tasks

Review cycle:

**Architect → Collaborator → Approve / Revise → Architect**

The Collaborator may return the document with change requests. Each revision creates a new architecture version with a change log; previous versions remain in the Project Memory.

Versioning example:

- v1.0 — Initial architecture, approved
- v1.1 — Added rate limiting to API layer
- v2.0 — Database changed from SQLite to PostgreSQL

During development:

- The Prompt Engineer works only from the currently approved version.
- The Coder must not deviate from the architecture on its own.
- If the Coder, Tester, or Debugger discovers that the architecture cannot be implemented as designed, the problem is escalated through the Collaborator to the Architect, which issues an architecture revision.

**Coder / Tester / Debugger → Collaborator → Architect → Collaborator → Prompt Engineer**

---

## 5. Architecture Document / PDF

The Architect AI must produce a professional architecture document as a PDF.
This is an important part of the system.

The PDF should not simply be a text dump. The Architect AI should have its own document-generation guidelines that determine how the architecture document is designed.

The architecture PDF should contain sections such as:

- Cover page
- Project overview
- Project objectives
- Requirements
- System architecture
- Architecture diagrams
- AI-agent workflow
- Frontend architecture
- Backend architecture
- Database architecture
- API architecture
- Data-flow diagrams
- User-flow diagrams
- AI communication architecture
- Technology stack
- Folder/project structure
- Security architecture
- Authentication architecture
- Deployment architecture
- Development workflow
- Testing strategy
- Debugging strategy
- Error-handling strategy
- Future scalability
- Development phases
- Implementation roadmap
- Architecture decisions
- Assumptions and limitations

The PDF should include charts, diagrams, flowcharts, tables, and visual representations where appropriate.

The Architect AI should also define guidelines for:

- Document structure
- Page hierarchy
- Diagram placement
- Section numbering
- Technical terminology
- Tables
- Code examples
- Versioning
- Architecture revisions
- Document metadata

The architecture document becomes the project's official technical blueprint.

---

## 6. Prompt Engineer AI

After the architecture has been approved, the Collaborator sends it to the Prompt Engineer.

The Prompt Engineer converts the architecture and requirements into precise instructions for the Builder/Coder AI.
The goal is to prevent the coding AI from drifting away from the approved project architecture.

Each coding task should have:

- Clear objective
- Relevant architecture section
- Files that may be changed
- Files that should not be changed
- Required functionality
- Dependencies
- Expected output
- Testing requirements
- Acceptance criteria

The prompt should be focused enough that the Coder understands exactly what it is supposed to build.

---

## 7. Coder / Builder AI

The Coder builds the project incrementally.
It should not attempt to build the entire application in one uncontrolled operation.

Instead:

**Architecture → Task → Prompt → Code Segment → Test**

Each segment becomes a controlled development unit.

The Coder should report:

- Files created
- Files modified
- Code implemented
- Dependencies added
- Commands executed
- Problems encountered
- Completion status

---

## 8. Tester AI

After every development segment, the Tester evaluates the implementation.

The Tester should inspect:

- Functionality
- Integration
- Errors
- Edge cases
- API behavior
- Database behavior
- UI behavior
- Security where applicable
- Regression problems

The Tester produces a structured test result.

If the segment passes:

**Tester → Collaborator**

The Collaborator approves the segment and continues the project.

If the segment fails:

**Tester → Debugger**

The Tester must clearly explain:

- What failed
- Where it failed
- How it failed
- Error message
- Expected behavior
- Actual behavior
- Severity
- Reproduction steps

---

## 9. Debugger AI

The Debugger receives failed tests and investigates the problem.

It should:

- Analyze the error.
- Locate the source.
- Determine the root cause.
- Fix the problem.
- Explain what caused the problem.
- Explain what was changed.
- Run appropriate tests.
- Return the result to the Tester.

The workflow becomes:

**Coder → Tester → Error → Debugger → Tester**

This loop continues until the Tester approves the implementation.

---

## 10. Detailed Development Logging

A major feature of the system is that it should maintain a development activity log.

The system should monitor the activities performed by the AI agents during the development process.
This includes terminal activity where technically possible.

The system should record things such as:

- Terminal commands executed
- Command results
- Build output
- Installation commands
- Test commands
- Error messages
- Stack traces
- Files created
- Files modified
- Files deleted
- Git operations
- Test results
- AI decisions
- Agent handoffs
- Debugging actions

The goal is to create a reliable history of what actually happened, rather than relying only on an AI's memory.

---

## 11. Summarizer AI — Requirements Summary and Development Session Summary

The Summarizer AI has two duties. In both it works strictly from the material it is given and never invents facts.

### 11.1 Requirements Summary (before the architecture)

After the user has approved the refined concept, the Collaborator sends the refined project concept, the research report, and its own review notes to the Summarizer.
The Summarizer condenses them into a concise brief for the Architect:

- What to build: problem statement, core features, priorities
- For whom: target users
- Functional and non-functional requirements
- Constraints and assumptions
- Research recommendations and known risks
- Open questions and the assumption that applies to each unanswered one
- Success criteria

The Requirements Summary must not add, drop, or reinterpret requirements; it only condenses and orders them.
The Collaborator forwards it to the Architect (see sections 1, 4 and 15).

### 11.2 Development Chapter (end of the session)

At the end of each development session, the Collaborator sends the complete session information to the Summarizer AI.

The Summarizer creates a new Development Chapter.

For example:

**Chapter 01 — Project Initialization**

- User requirements
- Decisions
- Architecture progress
- Tasks completed
- Code created
- Tests performed
- Errors discovered
- Debugging performed
- Terminal activity
- Final status

**Chapter 02 — Authentication System**

The same structure continues.

**Chapter 03 — Inventory System**

And so on.

This creates a chronological history of the entire project.

---

## 12. Error and Debugging Statistics

The summary should contain measurable information.

For example:

**Development Session #12**

- Tasks assigned: 8
- Tasks completed: 7
- Tasks remaining: 1
- Code segments created: 14
- Tests executed: 31
- Tests passed: 27
- Tests failed: 4
- Errors discovered: 4
- Errors fixed: 4
- Debugging cycles: 6
- Files created: 9
- Files modified: 17
- Terminal commands executed: 42

The system should distinguish between:

- Errors
- Warnings
- Failed tests
- Debugging attempts
- Successful fixes
- Unresolved problems

This gives the user a much clearer picture of the project's actual development state.

---

## 13. AI Activity Timeline

The Summarizer should also explain what each AI did during the session.

For example:

- **14:02 — Collaborator** — Assigned authentication requirements to Architect AI.
- **14:05 — Architect** — Created authentication architecture.
- **14:12 — Prompt Engineer** — Generated implementation instructions.
- **14:20 — Coder** — Implemented authentication module.
- **14:31 — Tester** — Detected authentication token validation error.
- **14:34 — Debugger** — Identified incorrect token expiration handling.
- **14:39 — Debugger** — Applied fix.
- **14:42 — Tester** — Retested implementation.
- **14:44 — Tester** — Approved segment.
- **14:46 — Collaborator** — Marked authentication module complete.

This provides a complete AI activity timeline.

---

## 14. Project Memory

The system should maintain persistent project knowledge.
The AI agents should not have to rediscover the project every time a new session starts.

Important information should be stored, including:

- Original requirements
- Refined requirements
- Approved architecture
- Architecture versions
- Technical decisions
- Current implementation status
- Completed features
- Known bugs
- Resolved bugs
- Outstanding issues
- Development history
- Important constraints
- Coding conventions
- Project structure

This allows the system to continue development across multiple sessions.

---

## 15. Overall Workflow

The complete system can be represented as:

```
USER
↓
COLLABORATOR AI
↓
IDEA REFINER AI ↔ RESEARCH AI
↓
COLLABORATOR REVIEW
↓
SUMMARIZER AI — Requirements Summary (section 11.1)
↓
COLLABORATOR — forwards the summary
↓
ARCHITECT AI
↓
ARCHITECTURE DOCUMENT + DIAGRAMS + PDF
↓
COLLABORATOR APPROVAL
↓
PROMPT ENGINEER AI
↓
CODER / BUILDER AI
↓
TESTER AI
↓
PASS → COLLABORATOR
FAIL → DEBUGGER AI → TESTER AI
↓
COLLABORATOR APPROVAL
↓
NEXT DEVELOPMENT SEGMENT
↓
FINAL SESSION DATA
↓
SUMMARIZER AI — Development Chapter (section 11.2)
↓
NEW DEVELOPMENT CHAPTER
```

---

## 16. The Main Principle

The most important design principle is:

**The Collaborator controls the project, the specialized AIs perform specialized work, and the system records everything needed to understand how the project was built.**

- The architecture document defines what should be built.
- The Prompt Engineer defines how the Coder should approach each task.
- The Coder implements it.
- The Tester verifies it.
- The Debugger fixes failures.
- The Collaborator controls and approves the process.
- The Summarizer briefs the Architect and records what actually happened.
- The Research and Idea Refiner agents help ensure that the project is useful, realistic, and technically informed.

---

## 17. Final Goal

The final product is not simply a collection of AI assistants.
It is an AI-powered software development organization inside VS Code.

The user provides the idea.
The AI team transforms the idea into a refined concept, researches it, creates a professional software architecture, generates implementation instructions, writes the software, tests it, debugs it, tracks the entire process, and produces detailed documentation of the project's evolution.

The system should make it possible to look back at the project months later and understand:

- What did we want to build?
- Why did we build it this way?
- What architecture was approved?
- Which AI made each decision?
- What code was created?
- What commands were executed?
- What errors happened?
- What did the Tester discover?
- How did the Debugger fix them?
- How many problems occurred?
- How many were resolved?
- What has been completed?
- What remains?
- What should we build next?

This creates a complete, traceable AI-driven software development lifecycle.

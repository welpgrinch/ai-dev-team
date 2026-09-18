/** Document-generation guidelines owned by the Architect AI. Shared with the LLM prompt and enforced by the PDF generator. */
export const DOCUMENT_GUIDELINES = `
DOCUMENT-GENERATION GUIDELINES (Architecture Document)

Document structure
- The document is written in Markdown and rendered to a professional PDF by the system.
- Use "## Title" for top-level sections and "### Title" for subsections. Do NOT number headings yourself; the system numbers sections (1, 1.1, 1.2 …) automatically.
- Do not include a cover page, table of contents or document metadata in the Markdown — the system generates them.
- Every top-level section starts on a new page (page hierarchy: cover → document information → table of contents → numbered sections).
- Start each section with a short introductory paragraph before lists, tables or diagrams.

Diagram placement
- Diagrams are Mermaid code blocks (\`\`\`mermaid). Place each diagram directly after the paragraph that introduces it; the system adds "Figure N" captions.
- Supported diagram types: flowchart (graph TD / LR), sequenceDiagram, erDiagram, classDiagram, stateDiagram-v2. Keep node labels short and plain text (no HTML, no "<br/>", quote labels containing special characters).
- Diagrams must be complete and syntactically valid. Aim for 6–15 nodes per diagram; split large diagrams.

Charts
- Simple charts are written as \`\`\`chart blocks containing JSON: {"type":"bar","title":"…","data":[{"label":"…","value":3}]}. Use them for phase effort, component counts, priorities etc.

Tables
- Use GitHub-flavoured Markdown tables with a header row. Keep tables to at most 6 columns. Use tables for requirement lists, API endpoints, database tables, technology comparisons, decision records and roadmaps.

Code examples
- Use fenced code blocks with a language tag. Keep examples short (< 40 lines) and illustrative (folder trees, config snippets, interface definitions), never full implementations.

Technical terminology
- Define acronyms on first use. Use consistent component names throughout the document (the same name in text, tables and diagrams).

Versioning and revisions
- The document has a semantic version (MAJOR.MINOR). Architecture revisions increase MINOR for refinements and MAJOR for structural changes (e.g. a different database or framework).
- Every revision documents its changes in the "Architecture decisions" section as a decision record (context, decision, alternatives, consequences).

Document metadata
- Metadata (project name, version, status, date, author, revision history) is supplied by the system and printed on the document information page.
`.trim();

export const ARCHITECTURE_SECTIONS: string[][] = [
  [
    'Project overview',
    'Project objectives',
    'Requirements',
    'System architecture',
    'Architecture diagrams',
    'AI-agent workflow',
    'Technology stack',
    'Folder/project structure',
  ],
  [
    'Frontend architecture',
    'Backend architecture',
    'Database architecture',
    'API architecture',
    'Data-flow diagrams',
    'User-flow diagrams',
    'AI communication architecture',
    'Security architecture',
    'Authentication architecture',
  ],
  [
    'Deployment architecture',
    'Development workflow',
    'Testing strategy',
    'Debugging strategy',
    'Error-handling strategy',
    'Future scalability',
    'Development phases',
    'Implementation roadmap',
    'Architecture decisions',
    'Assumptions and limitations',
  ],
];

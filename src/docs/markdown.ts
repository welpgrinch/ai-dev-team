export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: { text: string; depth: number }[] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'quote'; text: string }
  | { type: 'hr' };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith('|')) {
    l = l.slice(1);
  }
  if (l.endsWith('|')) {
    l = l.slice(0, -1);
  }
  return l.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** Minimal GitHub-flavoured Markdown block parser sufficient for LLM-generated documents. */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', text: para.join(' ').trim() });
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushPara();
      const lang = trimmed.slice(3).trim().split(/\s+/)[0].toLowerCase();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', lang, code: code.join('\n') });
      continue;
    }

    if (!trimmed) {
      flushPara();
      i++;
      continue;
    }

    const h = HEADING.exec(trimmed);
    if (h) {
      flushPara();
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (trimmed.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        const cells = splitRow(lines[i]);
        while (cells.length < header.length) {
          cells.push('');
        }
        rows.push(cells.slice(0, header.length));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        q.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: q.join(' ').trim() });
      continue;
    }

    const li = LIST_ITEM.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[2]);
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m) {
          items.push({ text: m[3].trim(), depth: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)) });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara();
  return blocks;
}

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/** Splits inline Markdown (bold, italic, code, links) into styled runs. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[([^\]]+)\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      runs.push({ text: text.slice(last, m.index) });
    }
    if (m[1]) {
      runs.push({ text: m[1].slice(1, -1), code: true });
    } else if (m[2] || m[3]) {
      runs.push({ text: m[0].slice(2, -2), bold: true });
    } else if (m[4] || m[5]) {
      runs.push({ text: m[0].slice(1, -1), italic: true });
    } else if (m[6]) {
      runs.push({ text: m[7] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last) });
  }
  return runs.length ? runs : [{ text }];
}

export function plainText(text: string): string {
  return parseInline(text)
    .map((r) => r.text)
    .join('');
}

import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { Block, parseInline, parseMarkdown, plainText } from './markdown';
import { MermaidRenderer } from './mermaidRenderer';

export interface RevisionEntry {
  version: string;
  date: string;
  status: string;
  changelog: string;
}

export interface PdfMetadata {
  projectName: string;
  version: string;
  status: 'Draft' | 'Approved';
  author: string;
  date: string;
  revisions: RevisionEntry[];
}

export interface PdfResult {
  file: string;
  pages: number;
  figures: number;
  diagramErrors: string[];
}

const C = {
  primary: '#1F3A5F',
  accent: '#2E86AB',
  text: '#222222',
  muted: '#6B7280',
  light: '#F2F5F9',
  border: '#C9D3DF',
  codeBg: '#F6F8FA',
  white: '#FFFFFF',
};
const F = { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', mono: 'Courier' };
const MARGIN = { top: 64, bottom: 64, left: 56, right: 56 };
const TOC_PER_PAGE = 34;

interface NumberedHeading {
  number: string;
  text: string;
  level: number;
  page: number;
}

interface ChartSpec {
  type?: string;
  title?: string;
  data?: { label: string; value: number }[];
}

function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return { width: 1200, height: 800 };
}

/** Renders the Architect's Markdown into a professional PDF following the document-generation guidelines. */
export class PdfGenerator {
  constructor(private readonly mermaid: MermaidRenderer) {}

  async generate(markdown: string, meta: PdfMetadata, outFile: string, onProgress?: (message: string) => void): Promise<PdfResult> {
    const blocks = normalize(parseMarkdown(markdown));
    const diagrams = blocks
      .map((b, i) => (b.type === 'code' && b.lang === 'mermaid' ? { id: `m${i}`, code: b.code } : undefined))
      .filter((d): d is { id: string; code: string } => !!d);
    onProgress?.(`rendering ${diagrams.length} diagram(s)…`);
    const rendered = await this.mermaid.render(diagrams);
    onProgress?.('laying out the PDF…');

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const doc = new PDFDocument({
      size: 'A4',
      margins: MARGIN,
      bufferPages: true,
      info: {
        Title: `${meta.projectName} — Software Architecture Document v${meta.version}`,
        Author: meta.author,
        Subject: 'Software architecture',
        Keywords: 'architecture, AI Dev Team, blueprint',
      },
    });
    const stream = fs.createWriteStream(outFile);
    doc.pipe(stream);

    const layout = new Layout(doc, meta, rendered.images, rendered.errors);
    layout.cover();
    layout.infoPage();
    const headings = layout.numberHeadings(blocks);
    layout.reserveToc(headings.length);
    layout.body(blocks, headings);
    layout.fillToc(headings);
    const pages = layout.decorate();
    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
    return {
      file: outFile,
      pages,
      figures: layout.figureCount,
      diagramErrors: [...rendered.errors.values()],
    };
  }
}

/** Drops a leading document title, maps stray H1s to sections and clamps deep headings. */
function normalize(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let first = true;
  for (const b of blocks) {
    if (b.type === 'heading') {
      if (first && b.level === 1) {
        first = false;
        continue;
      }
      first = false;
      out.push({ ...b, level: Math.min(4, Math.max(2, b.level)), text: b.text.replace(/^\d+(\.\d+)*\.?\s+/, '') });
    } else {
      if (b.type !== 'paragraph' || b.text) {
        first = false;
        out.push(b);
      }
    }
  }
  return out;
}

class Layout {
  private pageIndex = 0;
  private tocStart = 0;
  private tocPages = 0;
  private currentSection = '';
  figureCount = 0;

  private readonly left = MARGIN.left;
  private readonly width: number;
  private readonly bottom: number;

  constructor(
    private readonly doc: PDFKit.PDFDocument,
    private readonly meta: PdfMetadata,
    private readonly images: Map<string, Buffer>,
    private readonly errors: Map<string, string>,
  ) {
    this.width = doc.page.width - MARGIN.left - MARGIN.right;
    this.bottom = doc.page.height - MARGIN.bottom;
    doc.on('pageAdded', () => {
      this.pageIndex++;
    });
  }

  // ---------- front matter ----------

  cover(): void {
    const d = this.doc;
    d.rect(0, 0, d.page.width, 280).fill(C.primary);
    d.rect(0, 280, d.page.width, 6).fill(C.accent);
    d.fillColor(C.white).font(F.bold).fontSize(30).text(this.meta.projectName, this.left, 96, { width: this.width });
    d.font(F.regular).fontSize(16).fillColor('#DCE6F2').text('Software Architecture Document', this.left, d.y + 10, { width: this.width });
    d.fontSize(11).text('Official technical blueprint', this.left, d.y + 4, { width: this.width });

    let y = 340;
    const row = (k: string, v: string) => {
      d.font(F.bold).fontSize(11).fillColor(C.muted).text(k, this.left, y, { width: 120, lineBreak: false });
      d.font(F.regular).fillColor(C.text).text(v, this.left + 130, y, { width: this.width - 130, lineBreak: false });
      y += 22;
    };
    row('Version', this.meta.version);
    row('Status', this.meta.status);
    row('Date', this.meta.date);
    row('Author', this.meta.author);
    row('Generated by', 'AI Dev Team for Visual Studio Code');

    d.font(F.italic).fontSize(9.5).fillColor(C.muted).text(
      'This document was produced by the Architect AI from the approved requirements and defines what should be built. Coding tasks are derived from it by the Prompt Engineer AI; deviations require an architecture revision.',
      this.left,
      d.page.height - 130,
      { width: this.width, align: 'left' },
    );
  }

  infoPage(): void {
    const d = this.doc;
    d.addPage();
    this.sectionTitle('Document information');
    this.paragraph('Metadata for this architecture document. Versions follow MAJOR.MINOR semantics: MINOR for refinements, MAJOR for structural changes.');
    this.table(
      ['Property', 'Value'],
      [
        ['Project', this.meta.projectName],
        ['Document', 'Software Architecture Document'],
        ['Version', this.meta.version],
        ['Status', this.meta.status],
        ['Date', this.meta.date],
        ['Author', this.meta.author],
        ['Approver', 'Collaborator AI on behalf of the user'],
      ],
    );
    this.subTitle('Revision history');
    this.table(
      ['Version', 'Date', 'Status', 'Changes'],
      this.meta.revisions.map((r) => [r.version, r.date.slice(0, 10), r.status, r.changelog]),
    );
    this.subTitle('How to read this document');
    this.paragraph(
      'Sections are numbered hierarchically. Diagrams are numbered as figures and placed directly after the paragraph that introduces them. Tables summarise requirements, interfaces and decisions. Code examples are illustrative, not implementations. Architecture decisions record context, decision, alternatives and consequences.',
    );
  }

  numberHeadings(blocks: Block[]): NumberedHeading[] {
    const list: NumberedHeading[] = [];
    let s = 0;
    let ss = 0;
    for (const b of blocks) {
      if (b.type !== 'heading') {
        continue;
      }
      if (b.level === 2) {
        s++;
        ss = 0;
        list.push({ number: `${s}`, text: b.text, level: 2, page: 0 });
      } else if (b.level === 3) {
        ss++;
        list.push({ number: `${s}.${ss}`, text: b.text, level: 3, page: 0 });
      }
    }
    return list;
  }

  reserveToc(entries: number): void {
    this.tocPages = Math.max(1, Math.ceil(entries / TOC_PER_PAGE));
    this.doc.addPage();
    this.tocStart = this.pageIndex;
    for (let i = 1; i < this.tocPages; i++) {
      this.doc.addPage();
    }
  }

  fillToc(headings: NumberedHeading[]): void {
    const d = this.doc;
    for (let p = 0; p < this.tocPages; p++) {
      d.switchToPage(this.tocStart + p);
      d.x = this.left;
      d.y = MARGIN.top;
      if (p === 0) {
        this.sectionTitle('Contents');
      }
      const slice = headings.slice(p * TOC_PER_PAGE, (p + 1) * TOC_PER_PAGE);
      for (const h of slice) {
        const y = d.y;
        const indent = h.level === 2 ? 0 : 18;
        const label = `${h.number}  ${plainText(h.text)}`;
        d.font(h.level === 2 ? F.bold : F.regular)
          .fontSize(h.level === 2 ? 10.5 : 10)
          .fillColor(h.level === 2 ? C.primary : C.text);
        const maxW = this.width - indent - 44;
        d.text(label, this.left + indent, y, { width: maxW, height: 14, ellipsis: true, lineBreak: false });
        const labelW = Math.min(d.widthOfString(label), maxW);
        d.text(String(h.page + 1), this.left + this.width - 36, y, { width: 36, align: 'right', lineBreak: false });
        d.moveTo(this.left + indent + labelW + 5, y + 9)
          .lineTo(this.left + this.width - 40, y + 9)
          .dash(1, { space: 2 })
          .lineWidth(0.5)
          .strokeColor(C.border)
          .stroke()
          .undash();
        d.y = y + 18;
      }
    }
    d.switchToPage(this.pageIndex);
  }

  // ---------- body ----------

  body(blocks: Block[], headings: NumberedHeading[]): void {
    const d = this.doc;
    d.addPage();
    let hi = 0;
    let firstSection = true;
    let orderedCounters: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      switch (b.type) {
        case 'heading': {
          if (b.level === 2) {
            if (!firstSection) {
              d.addPage();
            }
            firstSection = false;
            const h = headings[hi++];
            h.page = this.pageIndex;
            this.currentSection = `${h.number}  ${plainText(h.text)}`;
            this.sectionTitle(this.currentSection);
          } else if (b.level === 3) {
            const h = headings[hi++];
            this.ensureSpace(48);
            h.page = this.pageIndex;
            this.subTitle(`${h.number}  ${plainText(h.text)}`);
          } else {
            this.ensureSpace(32);
            d.moveDown(0.3);
            d.font(F.bold).fontSize(11).fillColor(C.text).text(plainText(b.text), this.left, d.y, { width: this.width });
            d.moveDown(0.2);
          }
          break;
        }
        case 'paragraph':
          this.paragraph(b.text);
          break;
        case 'list':
          orderedCounters = [];
          this.list(b.items, b.ordered, orderedCounters);
          break;
        case 'quote':
          this.quote(b.text);
          break;
        case 'hr':
          this.ensureSpace(16);
          d.moveDown(0.3);
          d.moveTo(this.left, d.y).lineTo(this.left + this.width, d.y).lineWidth(0.5).strokeColor(C.border).stroke();
          d.moveDown(0.6);
          break;
        case 'table':
          this.table(b.header, b.rows);
          break;
        case 'code':
          if (b.lang === 'mermaid') {
            this.figure(`m${i}`, b.code);
          } else if (b.lang === 'chart') {
            this.chart(b.code);
          } else {
            this.code(b.code);
          }
          break;
      }
      d.x = this.left;
    }
  }

  private ensureSpace(h: number): void {
    if (this.doc.y + h > this.bottom) {
      this.doc.addPage();
    }
  }

  private sectionTitle(text: string): void {
    const d = this.doc;
    d.font(F.bold).fontSize(20).fillColor(C.primary).text(text, this.left, d.y, { width: this.width });
    d.moveTo(this.left, d.y + 4).lineTo(this.left + this.width, d.y + 4).lineWidth(1.2).strokeColor(C.accent).stroke();
    d.y += 16;
    d.x = this.left;
  }

  private subTitle(text: string): void {
    const d = this.doc;
    d.moveDown(0.5);
    d.font(F.bold).fontSize(13.5).fillColor(C.primary).text(text, this.left, d.y, { width: this.width });
    d.moveDown(0.25);
    d.x = this.left;
  }

  private rich(text: string, opts: { x: number; y?: number; width: number; size?: number; color?: string; font?: string }): void {
    const d = this.doc;
    const runs = parseInline(text);
    const size = opts.size ?? 10.5;
    runs.forEach((r, i) => {
      const font = r.code ? F.mono : r.bold ? F.bold : r.italic ? F.italic : opts.font ?? F.regular;
      d.font(font)
        .fontSize(r.code ? size - 0.5 : size)
        .fillColor(r.code ? C.primary : opts.color ?? C.text);
      const o: PDFKit.Mixins.TextOptions = { width: opts.width, continued: i < runs.length - 1, lineGap: 2.5 };
      if (i === 0) {
        d.text(r.text, opts.x, opts.y ?? d.y, o);
      } else {
        d.text(r.text, o);
      }
    });
  }

  private paragraph(text: string): void {
    this.ensureSpace(28);
    this.rich(text, { x: this.left, width: this.width });
    this.doc.moveDown(0.55);
    this.doc.x = this.left;
  }

  private quote(text: string): void {
    const d = this.doc;
    this.ensureSpace(30);
    const y = d.y;
    d.font(F.italic).fontSize(10.5);
    const h = d.heightOfString(plainText(text), { width: this.width - 24 }) + 10;
    d.rect(this.left, y, 3, h).fill(C.accent);
    this.rich(text, { x: this.left + 14, y: y + 5, width: this.width - 24, font: F.italic, color: C.muted });
    d.y = y + h + 6;
    d.x = this.left;
  }

  private list(items: { text: string; depth: number }[], ordered: boolean, counters: number[]): void {
    const d = this.doc;
    for (const item of items) {
      const indent = 16 + item.depth * 16;
      counters.length = item.depth + 1;
      counters[item.depth] = (counters[item.depth] ?? 0) + 1;
      const marker = ordered ? `${counters[item.depth]}.` : item.depth === 0 ? '•' : '–';
      this.ensureSpace(18);
      const y = d.y;
      d.font(F.regular).fontSize(10.5).fillColor(C.text).text(marker, this.left + indent - 16, y, { width: 16, lineBreak: false });
      this.rich(item.text, { x: this.left + indent, y, width: this.width - indent });
      d.y += 2;
    }
    d.moveDown(0.45);
    d.x = this.left;
  }

  private table(header: string[], rows: string[][]): void {
    const d = this.doc;
    const cols = header.length;
    if (!cols) {
      return;
    }
    const pad = 5;
    const size = 9;
    const maxLen = header.map((h, c) => Math.max(h.length, 4, ...rows.map((r) => (r[c] ?? '').length)));
    const capped = maxLen.map((l) => Math.min(l, 60));
    const total = capped.reduce((a, b) => a + b, 0);
    let widths = capped.map((l) => Math.max(52, (l / total) * this.width));
    const sum = widths.reduce((a, b) => a + b, 0);
    widths = widths.map((w) => (w * this.width) / sum);

    const rowHeight = (cells: string[], bold: boolean) => {
      d.font(bold ? F.bold : F.regular).fontSize(size);
      return Math.max(...cells.map((c, i) => d.heightOfString(plainText(c) || ' ', { width: widths[i] - 2 * pad }))) + 2 * pad;
    };
    const drawRow = (cells: string[], y: number, o: { header?: boolean; zebra?: boolean }) => {
      const h = rowHeight(cells, !!o.header);
      if (o.header) {
        d.rect(this.left, y, this.width, h).fill(C.primary);
      } else if (o.zebra) {
        d.rect(this.left, y, this.width, h).fill(C.light);
      }
      let x = this.left;
      cells.forEach((c, i) => {
        d.font(o.header ? F.bold : F.regular)
          .fontSize(size)
          .fillColor(o.header ? C.white : C.text)
          .text(plainText(c), x + pad, y + pad, { width: widths[i] - 2 * pad });
        x += widths[i];
      });
      d.lineWidth(0.5).strokeColor(C.border).rect(this.left, y, this.width, h).stroke();
      return h;
    };

    d.moveDown(0.3);
    let y = d.y;
    const headerH = rowHeight(header, true);
    if (y + headerH + rowHeight(rows[0] ?? [''], false) > this.bottom) {
      d.addPage();
      y = d.y;
    }
    y += drawRow(header, y, { header: true });
    rows.forEach((r, idx) => {
      const h = rowHeight(r, false);
      if (y + h > this.bottom) {
        d.addPage();
        y = d.y;
        y += drawRow(header, y, { header: true });
      }
      y += drawRow(r, y, { zebra: idx % 2 === 1 });
    });
    d.y = y + 12;
    d.x = this.left;
  }

  private code(code: string): void {
    const d = this.doc;
    const lines = code.split('\n').map((l) => {
      const t = l.replace(/\t/g, '  ');
      return t.length > 92 ? t.slice(0, 91) + '…' : t;
    });
    const size = 8.5;
    const lineH = 11;
    const pad = 8;
    let idx = 0;
    d.moveDown(0.3);
    while (idx < lines.length) {
      let avail = this.bottom - d.y - 2 * pad;
      if (avail < lineH * 3) {
        d.addPage();
        avail = this.bottom - d.y - 2 * pad;
      }
      const count = Math.max(1, Math.min(lines.length - idx, Math.floor(avail / lineH)));
      const chunk = lines.slice(idx, idx + count);
      const h = count * lineH + 2 * pad;
      const y = d.y;
      d.lineWidth(0.5).rect(this.left, y, this.width, h).fillAndStroke(C.codeBg, C.border);
      d.font(F.mono).fontSize(size).fillColor(C.text);
      chunk.forEach((l, i) => d.text(l || ' ', this.left + pad, y + pad + i * lineH, { width: this.width - 2 * pad, lineBreak: false }));
      d.y = y + h + 8;
      d.x = this.left;
      idx += count;
    }
  }

  private figure(id: string, source: string): void {
    const d = this.doc;
    const img = this.images.get(id);
    if (!img) {
      const err = this.errors.get(id) ?? 'not rendered';
      this.paragraph(`_Diagram could not be rendered (${err}); source shown instead._`);
      this.code(source);
      return;
    }
    this.figureCount++;
    const { width: pw, height: ph } = pngSize(img);
    const ratio = ph / pw;
    let w = Math.min(this.width, pw / 2);
    let h = w * ratio;
    const maxH = this.bottom - MARGIN.top - 60;
    if (h > maxH) {
      h = maxH;
      w = h / ratio;
    }
    this.ensureSpace(h + 34);
    const x = this.left + (this.width - w) / 2;
    d.image(img, x, d.y, { width: w, height: h });
    d.y += h + 6;
    d.font(F.italic).fontSize(9).fillColor(C.muted).text(`Figure ${this.figureCount} — ${this.currentSection.replace(/^\S+\s+/, '')}`, this.left, d.y, { width: this.width, align: 'center' });
    d.moveDown(0.8);
    d.x = this.left;
  }

  private chart(json: string): void {
    const d = this.doc;
    let spec: ChartSpec;
    try {
      spec = JSON.parse(json) as ChartSpec;
    } catch {
      this.code(json);
      return;
    }
    const data = (spec.data ?? []).filter((p) => p && typeof p.value === 'number').slice(0, 12);
    if (!data.length || (spec.type && spec.type !== 'bar')) {
      this.table(['Label', 'Value'], data.map((p) => [String(p.label), String(p.value)]));
      return;
    }
    const plotH = 140;
    const labelH = 30;
    const total = plotH + labelH + 50;
    this.ensureSpace(total);
    const top = d.y;
    if (spec.title) {
      d.font(F.bold).fontSize(10.5).fillColor(C.text).text(spec.title, this.left, top, { width: this.width, align: 'center' });
    }
    const x0 = this.left + 36;
    const plotW = this.width - 48;
    const yBase = top + 24 + plotH;
    const max = Math.max(...data.map((p) => p.value), 1);
    d.lineWidth(0.6).strokeColor(C.border);
    for (let g = 0; g <= 4; g++) {
      const gy = yBase - (plotH * g) / 4;
      d.moveTo(x0, gy).lineTo(x0 + plotW, gy).stroke();
      d.font(F.regular).fontSize(7.5).fillColor(C.muted).text(String(Math.round((max * g) / 4)), this.left, gy - 4, { width: 30, align: 'right', lineBreak: false });
    }
    const slot = plotW / data.length;
    const barW = slot * 0.62;
    data.forEach((p, i) => {
      const bh = (p.value / max) * plotH;
      const bx = x0 + i * slot + (slot - barW) / 2;
      d.rect(bx, yBase - bh, barW, bh).fill(i % 2 === 0 ? C.accent : C.primary);
      d.font(F.bold).fontSize(8).fillColor(C.text).text(String(p.value), bx - 10, yBase - bh - 11, { width: barW + 20, align: 'center', lineBreak: false });
      d.font(F.regular).fontSize(7.5).fillColor(C.muted).text(String(p.label), x0 + i * slot, yBase + 4, { width: slot, align: 'center', height: labelH, ellipsis: true });
    });
    d.y = yBase + labelH + 14;
    d.x = this.left;
    this.figureCount++;
    d.font(F.italic).fontSize(9).fillColor(C.muted).text(`Figure ${this.figureCount} — ${spec.title ?? 'Chart'}`, this.left, d.y, { width: this.width, align: 'center' });
    d.moveDown(0.8);
  }

  // ---------- headers & footers ----------

  decorate(): number {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      if (i === 0) {
        continue;
      }
      const savedBottom = d.page.margins.bottom;
      d.page.margins.bottom = 0;
      const y = d.page.height - 40;
      d.moveTo(this.left, y - 6).lineTo(this.left + this.width, y - 6).lineWidth(0.5).strokeColor(C.border).undash().stroke();
      d.font(F.regular).fontSize(8.5).fillColor(C.muted);
      d.text(`${this.meta.projectName} — Software Architecture Document v${this.meta.version} (${this.meta.status})`, this.left, y, { width: this.width * 0.7, lineBreak: false });
      d.text(`Page ${i + 1} of ${range.count}`, this.left + this.width * 0.7, y, { width: this.width * 0.3, align: 'right', lineBreak: false });
      d.text('Generated by AI Dev Team · Architect AI', this.left, 30, { width: this.width, align: 'right', lineBreak: false });
      d.page.margins.bottom = savedBottom;
    }
    return range.count;
  }
}

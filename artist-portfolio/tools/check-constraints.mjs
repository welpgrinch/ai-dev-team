#!/usr/bin/env node
// Mechanical constraint checker for artist-portfolio/index.html
// (NFR-01, NFR-02, NFR-03, NFR-04, NFR-05, NFR-10, FR-02).
// Usage: node tools/check-constraints.mjs [path/to/index.html]
// Exits 1 with a printed reason on any failure; prints OK and exits 0 otherwise.
//
// Checks:
//   a. region markers present once and in order       h. animated properties (NFR-03)
//   b. external <script src> (NFR-02)                  i. file size hard limit 150 KB (NFR-10)
//   c. non-font stylesheet links (NFR-01)              j. hot-path layout reads (NFR-05)
//   d. @import in <style> (NFR-01)                     k. static will-change (NFR-04)
//   e. forbidden API tokens                            l. ARTWORKS 9–12 / alt / id (FR-02)
//   f. inline event handler attributes                 m. rAF loop without cancel (NFR-04)
//   g. target="_blank" without rel
//
// Note for the TILT region (S05): check j covers only methods named `tick(` and handlers
// assigned to `_onMove` or registered via addEventListener("pointermove", …). The S05 `Tilt`
// module MUST name its rAF loop `tick` and its pointer handler `_onMove` to be covered.
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] ?? resolve(here, "../index.html"));

const MARKERS = [
  "==== HEAD: meta, fonts, title ====",
  "==== STYLE: TOKENS ====",
  "==== STYLE: BASE & TYPOGRAPHY ====",
  "==== STYLE: LAYOUT ====",
  "==== STYLE: CARD / GLASS ====",
  "==== STYLE: LIGHTBOX ====",
  "==== STYLE: MOTION & MEDIA QUERIES ====",
  "==== BODY: MARKUP ====",
  "==== SCRIPT ====",
  "==== DATA: ARTWORKS ====",
  "==== CAPABILITIES ====",
  "==== RENDERER ====",
  "==== TILT ====",
  "==== POINTER LIGHT ====",
  "==== REVEAL ====",
  "==== LIGHTBOX ====",
  "==== BOOTSTRAP ====",
];

const ALLOWED_ANIMATED = new Set(["transform", "opacity", "background-position", "visibility"]);
const FORBIDDEN_TOKENS = [
  "fetch(", "XMLHttpRequest", "eval(", "new Function", "localStorage", "sessionStorage",
  "document.cookie",
];
// Layout-reading APIs/properties forbidden in rAF loops and pointermove handlers (NFR-05).
const LAYOUT_READS = [
  "getBoundingClientRect", "querySelector", "getComputedStyle", "offsetWidth", "offsetHeight",
  "offsetTop", "offsetLeft", "clientWidth", "clientHeight", "scrollX", "scrollY",
  "pageXOffset", "pageYOffset", "innerWidth", "innerHeight", "scrollTop", "scrollLeft",
];
const WILL_CHANGE_ALLOWED = new Set([".pointer-light"]);
const SIZE_LIMIT = 150 * 1024;

const errors = [];
const warnings = [];
const infos = [];

let html;
try {
  html = readFileSync(target, "utf8");
} catch (err) {
  console.error(`FAIL: cannot read ${target}: ${err.message}`);
  process.exit(1);
}

// Returns the text between the opening brace at `openIndex` and its balanced closing brace.
function balancedBody(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(openIndex + 1, i);
  }
  return text.slice(openIndex + 1);
}

// a. Markers: present exactly once and in fixed order.
let lastIndex = -1;
for (const marker of MARKERS) {
  const first = html.indexOf(marker);
  if (first === -1) {
    errors.push(`marker missing: "${marker}"`);
    continue;
  }
  if (html.indexOf(marker, first + marker.length) !== -1) {
    errors.push(`marker appears more than once: "${marker}"`);
  }
  if (first < lastIndex) {
    errors.push(`marker out of order: "${marker}"`);
  }
  lastIndex = Math.max(lastIndex, first);
}

// b. External scripts (NFR-02).
if (/<script\b[^>]*\ssrc\s*=/i.test(html)) {
  errors.push("external <script src> found (NFR-02)");
}

// c. Stylesheet links other than Google Fonts (NFR-01).
for (const m of html.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi)) {
  const href = /href\s*=\s*["']([^"']*)["']/i.exec(m[0]);
  if (!href || !href[1].startsWith("https://fonts.googleapis.com")) {
    errors.push(`non-font stylesheet link found: ${m[0]} (NFR-01)`);
  }
}

// d. @import inside style blocks.
const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
for (const css of styleBlocks) {
  if (/@import\b/i.test(css)) errors.push("@import found in <style> (NFR-01)");
}

// e. Forbidden API tokens.
for (const token of FORBIDDEN_TOKENS) {
  if (html.includes(token)) errors.push(`forbidden token found: "${token}"`);
}

// f. Inline event handler attributes.
for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
  if (/\son[a-z]+\s*=/i.test(tag[0])) {
    errors.push(`inline event handler attribute found: ${tag[0]}`);
  }
}

// g. target="_blank" without rel="noopener noreferrer".
for (const tag of html.matchAll(/<a\b[^>]*>/gi)) {
  if (/target\s*=\s*["']_blank["']/i.test(tag[0]) &&
      !/rel\s*=\s*["']noopener noreferrer["']/i.test(tag[0])) {
    errors.push(`target="_blank" anchor lacks rel="noopener noreferrer": ${tag[0]}`);
  }
}

// h. Animated properties (NFR-03).
function checkTransitionValue(value, where) {
  const trimmed = value.trim();
  if (trimmed === "none") return;
  for (const part of trimmed.split(",")) {
    const first = part.trim().split(/\s+/)[0];
    if (!first) continue;
    if (first === "all") {
      errors.push(`${where}: "all" is forbidden in transitions (NFR-03)`);
    } else if (!/^(\d|\.|var\(|cubic-bezier|ease|linear|steps)/.test(first) &&
               !ALLOWED_ANIMATED.has(first)) {
      errors.push(`${where}: transition animates "${first}" (NFR-03)`);
    }
  }
}

const cleanStyleBlocks = styleBlocks.map((css) => css.replace(/\/\*[\s\S]*?\*\//g, ""));
for (const clean of cleanStyleBlocks) {
  for (const m of clean.matchAll(/(?:^|[;{\s])transition(-property)?\s*:\s*([^;}]+)/g)) {
    checkTransitionValue(m[2], m[1] ? "transition-property" : "transition");
  }
  for (const kf of clean.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const body = balancedBody(clean, kf.index + kf[0].length - 1);
    for (const decl of body.matchAll(/([a-z-]+)\s*:/gi)) {
      const prop = decl[1].toLowerCase();
      if (!ALLOWED_ANIMATED.has(prop)) {
        errors.push(`@keyframes ${kf[1]} animates "${prop}" (NFR-03)`);
      }
    }
  }
}

// i. File size hard limit (NFR-10).
const size = statSync(target).size;
const sizeKB = (size / 1024).toFixed(1);
if (size > SIZE_LIMIT) {
  errors.push(`index.html is ${sizeKB} KB (> 150 KB, NFR-10)`);
} else {
  infos.push(`index.html is ${sizeKB} KB`);
}

// j. Hot-path layout reads (NFR-05): tick() bodies, _onMove handlers, pointermove listeners.
const scriptBlocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1]);
const script = scriptBlocks.join("\n");
const scriptClean = script
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

// A token prefixed with `this.` is a cached module field (e.g. this.scrollX), not a read.
function scanHotPath(name, body) {
  for (const token of LAYOUT_READS) {
    if (new RegExp(`(?<!this\\.)\\b${token}\\b`).test(body)) {
      errors.push(`hot path "${name}" reads layout: "${token}" (NFR-05)`);
    }
  }
}

// Body of an arrow/function expression starting at `index`, or a single-expression arrow.
function functionBodyAt(text, index) {
  const brace = text.indexOf("{", index);
  const arrow = text.indexOf("=>", index);
  const lineEnd = text.indexOf("\n", index);
  if (arrow !== -1 && (brace === -1 || arrow < brace) && (lineEnd === -1 || brace > lineEnd)) {
    // Expression-bodied arrow: take the remainder of its statement.
    const semi = text.indexOf(";", arrow);
    return text.slice(arrow + 2, semi === -1 ? undefined : semi);
  }
  if (brace === -1) return "";
  return balancedBody(text, brace);
}

// Object owner (e.g. "PointerLight") for a match position, for readable messages.
function ownerAt(text, index) {
  const before = text.slice(0, index);
  const owners = [...before.matchAll(/const\s+([A-Z]\w*)\s*=\s*\{/g)];
  return owners.length ? owners[owners.length - 1][1] : "script";
}

for (const m of scriptClean.matchAll(/(?:^|[\s,{;])tick\s*\([^)]*\)\s*\{/g)) {
  const open = m.index + m[0].length - 1;
  scanHotPath(`${ownerAt(scriptClean, m.index)}.tick`, balancedBody(scriptClean, open));
}
for (const m of scriptClean.matchAll(/_onMove\s*=\s*/g)) {
  const body = functionBodyAt(scriptClean, m.index + m[0].length);
  scanHotPath(`${ownerAt(scriptClean, m.index)}._onMove`, body);
}
for (const m of scriptClean.matchAll(/addEventListener\(\s*"pointermove"\s*,\s*/g)) {
  const rest = scriptClean.slice(m.index + m[0].length);
  // Inline handler only; named references (this._onMove) are covered by the scan above.
  if (/^(\(|function\b|[\w$]+\s*=>)/.test(rest)) {
    const body = functionBodyAt(scriptClean, m.index + m[0].length);
    scanHotPath(`${ownerAt(scriptClean, m.index)} pointermove listener`, body);
  }
}

// k. Static will-change audit (NFR-04): only the single fixed .pointer-light element.
for (const clean of cleanStyleBlocks) {
  for (const m of clean.matchAll(/will-change\s*:/g)) {
    const open = clean.lastIndexOf("{", m.index);
    const prevClose = Math.max(clean.lastIndexOf("}", open), clean.lastIndexOf("{", open - 1));
    const selector = clean.slice(prevClose + 1, open).trim().replace(/\s+/g, " ");
    if (!WILL_CHANGE_ALLOWED.has(selector)) {
      errors.push(`static will-change on "${selector}" (NFR-04)`);
    }
  }
}

// l. ARTWORKS contract (FR-02): 9–12 records, non-empty alt, unique ids. Regex only, no eval.
const dataStart = html.indexOf("==== DATA: ARTWORKS ====");
const dataEnd = html.indexOf("==== CAPABILITIES ====");
if (dataStart !== -1 && dataEnd !== -1 && dataEnd > dataStart) {
  const data = html.slice(dataStart, dataEnd).replace(/\/\/[^\n]*/g, "");
  const arrOpen = data.indexOf("[");
  const arr = arrOpen === -1 ? "" : data.slice(arrOpen);
  const records = [];
  let depth = 0;
  let recStart = -1;
  for (let i = 0; i < arr.length; i++) {
    const ch = arr[i];
    if (ch === "{") {
      if (depth === 0) recStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && recStart !== -1) {
        records.push(arr.slice(recStart, i + 1));
        recStart = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  const valid = records.filter((r) => /\bid\s*:\s*"[^"]+"/.test(r));
  if (valid.length < 9 || valid.length > 12) {
    errors.push(`ARTWORKS has ${valid.length} records, expected 9–12 (FR-02)`);
  }
  infos.push(`ARTWORKS has ${valid.length} records`);
  const ids = new Set();
  for (const r of valid) {
    const id = /\bid\s*:\s*"([^"]+)"/.exec(r)[1];
    if (ids.has(id)) errors.push(`ARTWORKS duplicate id "${id}" (FR-02)`);
    ids.add(id);
    const alt = /\balt\s*:\s*"([^"]*)"/.exec(r);
    if (!alt || alt[1].trim() === "") {
      errors.push(`ARTWORKS record "${id}" has missing or empty alt (FR-02)`);
    }
  }
} else {
  errors.push("ARTWORKS region not found between DATA and CAPABILITIES markers (FR-02)");
}

// m. Idle-loop guard (NFR-04): any rAF loop must be able to self-suspend.
if (script.includes("requestAnimationFrame(") && !script.includes("cancelAnimationFrame(")) {
  errors.push("requestAnimationFrame( used without cancelAnimationFrame( (NFR-04)");
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}
for (const i of infos) console.log(`INFO: ${i}`);
console.log("OK");

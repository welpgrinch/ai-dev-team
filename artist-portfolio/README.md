# Artist Portfolio

Single self-contained `index.html` (HTML + CSS + JS). No build step, no dependencies.

## Preview

```bash
cd artist-portfolio
python -m http.server 8080
```

Open <http://localhost:8080>. Opening `index.html` directly via `file://` also works.

## Edit content

- Artworks: the `ARTWORKS` array in the `// ==== DATA: ARTWORKS ====` region of `index.html`.
- Copy: hero, about and contact sections in the `<!-- ==== BODY: MARKUP ==== -->` region.

_To be completed in S12._

## Theme switch

Set `<html data-theme="light">` (default: `dark`) in `index.html`.

## Deploy

Upload `index.html` to any static host (GitHub Pages, Netlify, S3, …). _To be completed in S12._

## Constraint check

```bash
node tools/check-constraints.mjs
```

Requires Node.js ≥ 18. Prints `INFO: index.html is N.N KB` and `OK` and exits 0 when all
constraints hold; otherwise prints one `FAIL:` line per violation and exits 1.

Enforced checks:

- Region markers: all 17 present exactly once and in fixed order.
- External resources: no `<script src>`, no non-Google-Fonts stylesheet, no `@import` (NFR-01, NFR-02).
- Forbidden APIs: `fetch`, `XMLHttpRequest`, `eval`, `new Function`, storage, cookies.
- Inline event handler attributes (`onclick=` etc.).
- `target="_blank"` anchors must carry `rel="noopener noreferrer"`.
- Animated properties: transitions/`@keyframes` limited to transform/opacity (NFR-03).
- Hot-path layout reads: no `getBoundingClientRect`, `querySelector`, `scrollX/Y`, `offset*`,
  `client*`, `inner*`, `getComputedStyle` … inside `tick()` or `_onMove`/`pointermove` handlers
  (NFR-05).
- Static `will-change`: allowed only on `.pointer-light` (NFR-04).
- `ARTWORKS`: 9–12 records, every `alt` non-empty, no duplicate `id` (FR-02).
- rAF cancel guard: `requestAnimationFrame(` requires a matching `cancelAnimationFrame(` (NFR-04).
- File size: `index.html` < 150 KB, hard failure (NFR-10).

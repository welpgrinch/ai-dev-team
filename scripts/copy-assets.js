// Copies the single Mermaid bundle the diagram webview needs into media/, so the package does not ship all of node_modules/mermaid.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const dest = path.join(root, 'media', 'mermaid.min.js');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);

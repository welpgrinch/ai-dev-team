import * as vscode from 'vscode';

export interface DiagramRequest {
  id: string;
  code: string;
}

export interface RenderOutcome {
  images: Map<string, Buffer>;
  errors: Map<string, string>;
}

/** Renders Mermaid diagrams to PNG using a temporary webview (browser engine) since the extension host has no DOM. */
export class MermaidRenderer {
  constructor(private readonly extensionUri: vscode.Uri) {}

  async render(diagrams: DiagramRequest[], timeoutMs = 60_000): Promise<RenderOutcome> {
    const outcome: RenderOutcome = { images: new Map(), errors: new Map() };
    if (!diagrams.length) {
      return outcome;
    }
    // media/mermaid.min.js is copied from node_modules by scripts/copy-assets.js during `npm run compile`.
    const distDir = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      'aiDevTeam.diagramRenderer',
      'AI Dev Team — rendering diagrams…',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [distDir] },
    );

    return new Promise<RenderOutcome>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        sub.dispose();
        panel.dispose();
        for (const d of diagrams) {
          if (!outcome.images.has(d.id) && !outcome.errors.has(d.id)) {
            outcome.errors.set(d.id, 'Rendering timed out');
          }
        }
        resolve(outcome);
      };
      const timer = setTimeout(finish, timeoutMs);
      const sub = panel.webview.onDidReceiveMessage((msg: { type: string; id?: string; png?: string; message?: string }) => {
        switch (msg.type) {
          case 'ready':
            void panel.webview.postMessage({ type: 'render', diagrams });
            break;
          case 'result':
            if (msg.id && msg.png) {
              outcome.images.set(msg.id, Buffer.from(msg.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
            }
            break;
          case 'error':
            if (msg.id) {
              outcome.errors.set(msg.id, msg.message ?? 'unknown error');
            }
            break;
          case 'done':
            finish();
            break;
        }
      });
      panel.onDidDispose(finish);
      panel.webview.html = this.html(panel.webview, distDir);
    });
  }

  private html(webview: vscode.Webview, distDir: vscode.Uri): string {
    const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(distDir, 'mermaid.min.js'));
    const nonce = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src 'unsafe-inline' ${webview.cspSource}; img-src data: blob:; font-src data:;">
<style>body{font-family:sans-serif;padding:16px;color:var(--vscode-foreground)}#work{position:absolute;left:-20000px;top:0}</style>
</head><body>
<h3>AI Dev Team</h3><p id="status">Rendering architecture diagrams…</p>
<div id="work"></div>
<script src="${mermaidUri}"></script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const status = document.getElementById('status');
mermaid.initialize({
  startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false,
  fontFamily: 'Helvetica, Arial, sans-serif',
  flowchart: { htmlLabels: false, useMaxWidth: false },
  class: { htmlLabels: false, useMaxWidth: false },
  sequence: { useMaxWidth: false }, er: { useMaxWidth: false }, state: { useMaxWidth: false }, gantt: { useMaxWidth: false }
});
function toPng(svgText) {
  return new Promise((resolve, reject) => {
    const svgEl = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
    let w = parseFloat(svgEl.getAttribute('width')), h = parseFloat(svgEl.getAttribute('height'));
    const vb = svgEl.getAttribute('viewBox');
    if (vb) { const p = vb.split(/[\\s,]+/).map(Number); if (!(w > 0)) w = p[2]; if (!(h > 0)) h = p[3]; }
    if (!(w > 0) || !(h > 0)) { w = 900; h = 600; }
    svgEl.setAttribute('width', String(w)); svgEl.setAttribute('height', String(h)); svgEl.removeAttribute('style');
    const xml = new XMLSerializer().serializeToString(svgEl);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const scale = 2, c = document.createElement('canvas');
      c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
      const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      try { resolve(c.toDataURL('image/png')); } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('SVG rasterisation failed'));
    img.src = url;
  });
}
window.addEventListener('message', async (e) => {
  const { type, diagrams } = e.data;
  if (type !== 'render') return;
  let n = 0;
  for (const d of diagrams) {
    n++; status.textContent = 'Rendering diagram ' + n + ' of ' + diagrams.length + '…';
    try {
      const { svg } = await mermaid.render('d' + String(d.id).replace(/[^a-zA-Z0-9]/g, '_'), d.code);
      vscode.postMessage({ type: 'result', id: d.id, png: await toPng(svg) });
    } catch (err) {
      vscode.postMessage({ type: 'error', id: d.id, message: String((err && err.message) || err) });
    }
  }
  vscode.postMessage({ type: 'done' });
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
  }
}

// Compila src/main.js (IIFE) y lo ensambla con el motor del rally en un único HTML.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] || path.join(root, 'dist', 'a10-sim.html');
const engine = fs.readFileSync(path.join(root, 'vendor/rally-engine.js'), 'utf8');

// nombres de three usados por nuestro código: salen del motor (una sola copia de three)
const names = new Set();
(function scan(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) scan(p);
    else if (p.endsWith('.js')) {
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]three['"]/g))
        m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((n) => names.add(n));
    }
  }
})(path.join(root, 'src'));
for (const n of ['GLTFLoader']) names.add(n);
{ const ret = engine.slice(engine.lastIndexOf('return {')); const miss = [...names].filter((n) => !new RegExp('[{, ]' + n + '[,}]').test(ret)); if (miss.length) console.warn('AVISO: nombres de three ausentes en el motor (tree-shaking):', miss.join(', ')); }
const shim = `const E = window.RallyEngine;\n` + [...names].map((n) => `export const ${n} = E.${n};`).join('\n') +
  `\nexport const __missing = ${JSON.stringify([...names])}.filter((n) => E[n] === undefined);\n`;

const res = await build({
  entryPoints: [path.join(root, 'src/main.js')], bundle: true, format: 'iife', write: false, minify: !!process.env.MIN,
  target: 'es2022', loader: { '.glb': 'base64', '.json': 'json' }, logLevel: 'warning',
  plugins: [{ name: 'three-shim', setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: 'three-shim', namespace: 'shim' }));
    b.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({ contents: shim, loader: 'js' }));
  } }],
});
const app = res.outputFiles[0].text;
const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>A-10C Thunderbolt II — simulador</title>
<style>html,body{margin:0;height:100%;background:#05080c;overflow:hidden;font-family:system-ui,sans-serif}
#view{position:absolute;inset:0}#ui{position:absolute;inset:0;pointer-events:none}#ui>*{pointer-events:auto}</style></head>
<body><div id="view"></div><div id="ui"></div>
<script>${engine.replace(/<\/script/gi, '<\\/script')}</script>
<script>${app.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('OK', out, (html.length / 1048576).toFixed(2), 'MB; three names:', names.size);

// Compila tools/cover/cover.js a una página HTML autónoma (dist/cover.html) para renderizar la portada.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const r = await build({ entryPoints: [path.join(root, 'tools/cover/cover.js')], bundle: true, format: 'esm', write: false, target: 'es2022', loader: { '.glb': 'base64', '.json': 'json' }, logLevel: 'warning' });
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/cover.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#000}</style></head><body><script type="module">${r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
console.log('OK dist/cover.html');

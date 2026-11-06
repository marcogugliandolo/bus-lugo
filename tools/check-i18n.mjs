// Comprueba que todos los textos que pasan por t() tienen traducción al gallego.
// Uso: node tools/check-i18n.mjs  (sale con error si falta alguno o sobra alguno)
import { readFileSync } from 'node:fs';
import { GL } from '../app/demo/i18n.js';

const files = ['app.js', 'pantalla.js', 'index.html', 'pantalla.html'].map((f) => `app/demo/${f}`);
const keys = new Set();
for (const file of files) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/\bt\([^'()]*\?\s*'([^']*)'\s*:\s*'([^']*)'/g)) { keys.add(m[1]); keys.add(m[2]); }
  for (const m of src.matchAll(/data-t(?:-label|-placeholder|-title)?="([^"]+)"/g)) keys.add(m[1]);
}
// Textos que llegan a t() desde datos y no como literal.
const app = readFileSync('app/demo/app.js', 'utf8');
for (const m of app.matchAll(/^\s*(?:title|body|date): '([^']+)'/gm)) keys.add(m[1]);
// De los nombres de las líneas solo se traducen los que llevan palabras, no los de sitios.
for (const m of app.matchAll(/route: '([^']+)'/g)) if (/Línea/.test(m[1])) keys.add(m[1]);
const missing = [...keys].filter((k) => !(k in GL) && !/^[\d\s·:.–-]*$/.test(k));
const unused = Object.keys(GL).filter((k) => !keys.has(k));
if (missing.length) console.log(`Sin traducir (${missing.length}):\n${missing.map((k) => `  '${k}': '',`).join('\n')}`);
if (unused.length) console.log(`Traducciones que ya no se usan (${unused.length}):\n${unused.map((k) => `  ${k}`).join('\n')}`);
console.log(`${keys.size} textos, ${Object.keys(GL).length} traducidos`);
process.exit(missing.length ? 1 : 0);

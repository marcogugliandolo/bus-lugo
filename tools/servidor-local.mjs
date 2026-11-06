// Prueba Xa Vén en el ordenador, sin Docker: sirve la web y la API como en el servidor.
//   cd server && npm ci && cd .. && node tools/servidor-local.mjs   ->  http://localhost:8080/
// Los datos (avisos, retrasos, interurbanos) se guardan en ./.datos-locales. Variables: PUERTO, OPERADOR=1.
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from '../server/push.mjs';
import { loadNetwork } from '../server/red.mjs';

const ROOT = fileURLToPath(new URL('../app/', import.meta.url));
const DATA = fileURLToPath(new URL('../.datos-locales/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

mkdirSync(DATA, { recursive: true });
const network = await loadNetwork();
const api = createService({ dataDir: DATA, ...network, coaches: { enabled: process.env.INTERURBANOS === '1' } });
setInterval(() => api.tick().catch(() => {}), 10000);
setInterval(() => api.live?.fold(), 60000);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) { api.server.emit('request', req, res); return; }
  if (url.pathname === '/') { res.writeHead(302, { Location: '/demo/' }); res.end(); return; }
  let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    if (url.pathname.startsWith('/demo/')) file = join(ROOT, 'demo', 'index.html');
    else { res.writeHead(404); res.end('no existe'); return; }
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(Number(process.env.PUERTO) || 8080, () => console.log(`Xa Vén en http://localhost:${Number(process.env.PUERTO) || 8080}/`));

// Xa Vén: «¿Algo no cuadra?». Recibe lo que la gente cuenta de una hora, una parada o un recorrido
// que no coincide, y lo guarda para leerlo en una página privada.
//
// No se guarda la IP ni nada del móvil: solo lo que la persona escribe y dónde estaba mirando en la web.
// Los mensajes se borran solos a los 180 días, o antes al marcarlos como hechos.
//
// Para leerlos: /api/reportes/ver?clave=… La clave sale en los registros del contenedor al arrancar
// (o se fija con REPORTES_CLAVE). Con NTFY_URL llega un aviso al móvil por cada mensaje nuevo,
// solo con el tipo y el sitio, sin el texto ni el contacto.
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadJSON, madrid, readJSON, reply, saveJSON } from './red.mjs';

const KEEP_DAYS = 180;
const MAX_STORED = 1000;
const MAX_BODY = 6 * 1024;
const PER_HOUR = 6;
const PER_DAY = 20;

export const KINDS = {
  hora: 'La hora no coincide',
  'no-paso': 'El bus no pasó',
  parada: 'La parada está mal o no existe',
  recorrido: 'El recorrido está mal',
  otro: 'Otra cosa',
};

const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '');

/** Lo que llega del formulario, limpio y con tope. Null si no sirve. */
export function validReport(input) {
  if (!input || typeof input !== 'object') return null;
  const kind = Object.hasOwn(KINDS, input.tipo) ? input.tipo : null;
  const message = text(input.texto, 1000);
  if (!kind && !message) return null;
  const ctx = input.contexto && typeof input.contexto === 'object' ? input.contexto : {};
  return {
    tipo: kind ?? 'otro',
    texto: message,
    contacto: text(input.contacto, 120),
    donde: text(input.donde, 160),
    contexto: {
      vista: text(ctx.vista, 20),
      parada: text(ctx.parada, 20),
      linea: text(ctx.linea, 10),
      bus: text(ctx.bus, 80),
      hora: text(ctx.hora, 5),
      simulado: ctx.simulado === true,
      idioma: ctx.idioma === 'gl' ? 'gl' : 'es',
    },
  };
}

const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function readForm(req, max) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) { resolve(null); req.destroy(); } else chunks.push(chunk);
    });
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', () => resolve(null));
  });
}

export function createReports({ dataDir, now = Date.now, key = '', notifyUrl = '', base = '', fetchImpl = fetch }) {
  const path = join(dataDir, 'reportes.json');
  const keyPath = join(dataDir, 'reportes-clave.txt');
  let secret = key && key.length >= 12 ? key : '';
  if (!secret) {
    if (!existsSync(keyPath)) writeFileSync(keyPath, crypto.randomBytes(18).toString('base64url'), { mode: 0o600 });
    secret = readFileSync(keyPath, 'utf8').trim();
  }
  let reports = loadJSON(path, []);
  if (!Array.isArray(reports)) reports = [];
  const persist = () => saveJSON(path, reports);
  const seen = new Map();
  let salt = { date: '', value: '' };

  function prune() {
    const oldest = now() - KEEP_DAYS * 86400000;
    const before = reports.length;
    reports = reports.filter((r) => Date.parse(r.at) >= oldest).slice(-MAX_STORED);
    if (reports.length !== before) persist();
  }
  prune();

  /** Cuenta los envíos de cada origen sin guardar quién es: la IP mezclada con un secreto del día. */
  function allowed(ip) {
    const day = madrid(now()).iso;
    if (salt.date !== day) { salt = { date: day, value: crypto.randomBytes(16).toString('hex') }; seen.clear(); }
    const source = crypto.createHash('sha256').update(`${salt.value}|${ip}`).digest('base64url').slice(0, 16);
    const hour = Math.floor(now() / 3600000);
    const s = seen.get(source) ?? { hour, inHour: 0, inDay: 0 };
    if (s.hour !== hour) { s.hour = hour; s.inHour = 0; }
    if (s.inHour >= PER_HOUR || s.inDay >= PER_DAY) return false;
    s.inHour += 1;
    s.inDay += 1;
    if (seen.size > 5000) seen.clear();
    seen.set(source, s);
    return true;
  }

  const rightKey = (given) => {
    const a = Buffer.from(String(given ?? ''));
    const b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  function notify(report) {
    if (!notifyUrl) return;
    const what = KINDS[report.tipo];
    const body = report.donde ? `${what} · ${report.donde}` : what;
    fetchImpl(notifyUrl, {
      method: 'POST',
      body,
      headers: { Title: 'Xa Ven: algo no cuadra', Tags: 'bus' },
      signal: AbortSignal.timeout(10000),
    }).catch((err) => console.warn(`[reportes] no se pudo avisar al móvil: ${err.message}`));
  }

  function page(res, status, body) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Xa Vén · Mensajes</title><style>
body{margin:0;padding:20px 16px 40px;font:16px/1.45 system-ui,sans-serif;background:#F0F2F0;color:#121416}main{max-width:720px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}p.sub{margin:0 0 20px;color:#4A5158}article{background:#fff;border-radius:14px;padding:14px 16px;margin:0 0 12px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.k{display:inline-block;padding:2px 10px;border-radius:10px;background:#121416;color:#fff;font-size:13px;font-weight:700}.when{color:#4A5158;font-size:14px;margin-left:8px}
.where{font-weight:700;margin:8px 0 4px}.msg{white-space:pre-wrap;margin:6px 0}.meta{color:#4A5158;font-size:13px}.meta a{color:inherit}.contact{margin:6px 0;font-size:15px}
form{margin:10px 0 0}button{min-height:40px;padding:0 16px;border:0;border-radius:10px;background:#1F5FE0;color:#fff;font:inherit;font-weight:700;cursor:pointer}
</style></head><body><main>${body}</main></body></html>`);
    return true;
  }

  function listPage(res) {
    prune();
    const items = [...reports].reverse().map((r) => {
      const when = new Date(r.at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' });
      const c = r.contexto ?? {};
      const meta = [c.hora && `veía las ${c.hora}${c.simulado ? ' (simulación)' : ''}`, c.parada && `parada ${c.parada}`, c.linea && `línea ${c.linea}`, c.bus && `bus ${c.bus}`, c.idioma === 'gl' ? 'en gallego' : ''].filter(Boolean).join(' · ');
      return `<article><span class="k">${escapeHTML(KINDS[r.tipo] ?? r.tipo)}</span><span class="when">${escapeHTML(when)}</span>
        ${r.donde ? `<p class="where">${escapeHTML(r.donde)}</p>` : ''}
        ${r.texto ? `<p class="msg">${escapeHTML(r.texto)}</p>` : ''}
        ${r.contacto ? `<p class="contact">Contacto: <strong>${escapeHTML(r.contacto)}</strong></p>` : ''}
        ${meta ? `<p class="meta">${escapeHTML(meta)}${c.parada ? ` · <a href="/demo/#${encodeURIComponent(c.parada)}">ver la parada</a>` : ''}</p>` : ''}
        <form method="post" action="/api/reportes/hecho"><input type="hidden" name="clave" value="${escapeHTML(secret)}"><input type="hidden" name="id" value="${escapeHTML(r.id)}"><button type="submit">Hecho, borrar</button></form></article>`;
    }).join('');
    const count = reports.length === 1 ? '1 mensaje' : `${reports.length} mensajes`;
    return page(res, 200, `<h1>¿Algo no cuadra?</h1><p class="sub">${count}. Se borran solos a los ${KEEP_DAYS} días.</p>${items || '<p>No hay mensajes.</p>'}`);
  }

  async function handle(req, res, path, from) {
    if (!path.startsWith('/api/reportes')) return false;
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && path === '/api/reportes') {
      const { value, tooBig } = await readJSON(req, MAX_BODY);
      if (tooBig) return reply(res, 413, { error: 'demasiado grande' });
      // Campo trampa: las personas no lo ven; los programas que rellenan todo, sí.
      if (value && typeof value.web === 'string' && value.web) return reply(res, 201, { ok: true });
      const report = validReport(value);
      if (!report) return reply(res, 400, { error: 'datos no válidos' });
      if (!allowed(from)) return reply(res, 429, { error: 'demasiados mensajes' });
      prune();
      reports.push({ id: crypto.randomUUID(), at: new Date(now()).toISOString(), ...report });
      if (reports.length > MAX_STORED) reports = reports.slice(-MAX_STORED);
      persist();
      notify(report);
      return reply(res, 201, { ok: true });
    }

    if (req.method === 'GET' && path === '/api/reportes/ver') {
      if (!rightKey(url.searchParams.get('clave'))) return page(res, 403, '<h1>Clave incorrecta</h1><p class="sub">La clave sale en los registros del contenedor bus-lugo-push al arrancar.</p>');
      return listPage(res);
    }

    if (req.method === 'POST' && path === '/api/reportes/hecho') {
      const form = await readForm(req, 2048);
      if (!form || !rightKey(form.get('clave'))) return page(res, 403, '<h1>Clave incorrecta</h1>');
      const id = form.get('id');
      const before = reports.length;
      reports = reports.filter((r) => r.id !== id);
      if (reports.length !== before) persist();
      res.writeHead(303, { Location: `/api/reportes/ver?clave=${encodeURIComponent(secret)}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end();
      return true;
    }

    return reply(res, 404, { error: 'no existe' });
  }

  return {
    handle,
    prune,
    count: () => reports.length,
    link: () => `${base.replace(/\/$/, '')}/api/reportes/ver?clave=${encodeURIComponent(secret)}`,
  };
}

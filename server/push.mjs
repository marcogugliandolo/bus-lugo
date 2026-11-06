// Xa Vén: el servidor de la web. Guarda los avisos que pide cada móvil y envía la notificación
// a su hora; además recibe la posición de quien va en el bus (vivo.mjs), lleva el historial de
// retrasos, los autobuses de la Xunta (interurbanos.mjs) y, si se activa, los minutos de las paradas
// (operador.mjs). Las claves del envío se crean aquí la primera vez y se quedan en el volumen de datos.
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import webpush from 'web-push';
import { createLive } from './vivo.mjs';
import { createStopTimes } from './operador.mjs';
import { createCoaches } from './interurbanos.mjs';
import { loadNetwork } from './red.mjs';

const MAX_PENDING = 2000;
const MAX_PER_PHONE = 10;
const MAX_BODY = 8 * 1024;
const MAX_AHEAD = 26 * 3600 * 1000;
const LATE_LIMIT = 5 * 60 * 1000;
const POSTS_PER_MINUTE = 30;

// Solo se envía a los servicios de notificaciones de los navegadores.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function validAviso(input, now = Date.now()) {
  if (!input || typeof input !== 'object') return null;
  const { id, at, subscription: sub, title, body, url } = input;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < now - 60000 || at > now + MAX_AHEAD) return null;
  if (typeof title !== 'string' || !title || title.length > 80) return null;
  if (typeof body !== 'string' || body.length > 200) return null;
  if (typeof url !== 'string' || !/^\/demo\/(#[\w-]{1,60})?$/.test(url)) return null;
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000) return null;
  if (typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') return null;
  if (sub.keys.p256dh.length > 200 || sub.keys.auth.length > 100) return null;
  let target;
  try { target = new URL(sub.endpoint); } catch { return null; }
  if (target.protocol !== 'https:' || !PUSH_HOSTS.some((host) => host.test(target.hostname))) return null;
  return { id, at, title, body, url, tries: 0, subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } };
}

function loadJSON(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function saveJSON(path, value, mode = 0o600) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode });
  renameSync(tmp, path);
}

export function createService({ dataDir, send = webpush.sendNotification.bind(webpush), subject = 'https://bus.marcogugliandolo.com', now = Date.now, net = null, sim = null, stopTimes: stopTimesOptions = {}, coaches: coachOptions = {} }) {
  mkdirSync(dataDir, { recursive: true });
  const keysPath = join(dataDir, 'claves.json');
  const avisosPath = join(dataDir, 'avisos.json');
  if (!existsSync(keysPath)) saveJSON(keysPath, webpush.generateVAPIDKeys());
  const keys = loadJSON(keysPath, null);
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  let avisos = loadJSON(avisosPath, []);
  const persist = () => saveJSON(avisosPath, avisos);
  const posts = new Map();

  async function tick() {
    const due = avisos.filter((a) => a.at <= now());
    if (!due.length) return;
    for (const aviso of due) {
      const late = now() - aviso.at > LATE_LIMIT;
      let done = late;
      if (!late) {
        try {
          const payload = JSON.stringify({ title: aviso.title, body: aviso.body, url: aviso.url, tag: aviso.id });
          await send(aviso.subscription, payload, { TTL: 300, urgency: 'high' });
          done = true;
        } catch (err) {
          aviso.tries += 1;
          done = err?.statusCode === 404 || err?.statusCode === 410 || aviso.tries >= 3;
          console.warn(`[avisos] envío fallido (${err?.statusCode ?? 'red'})`);
        }
      }
      if (done) avisos = avisos.filter((a) => a.id !== aviso.id);
    }
    persist();
  }

  const reply = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(value === undefined ? '' : JSON.stringify(value));
  };

  const live = net ? createLive({ net, sim, dataDir, now }) : null;
  const stopTimes = net ? createStopTimes({ net, now, ...stopTimesOptions }) : null;
  const coaches = net ? createCoaches({ net, sim, dataDir, now, ...coachOptions }) : null;
  const modules = [live, stopTimes, coaches].filter(Boolean);

  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && path === '/health') return reply(res, 200, { ok: true });
    const from = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress);
    try {
      for (const mod of modules) if (await mod.handle(req, res, path, from)) return undefined;
    } catch (err) {
      console.warn(`[api] ${err?.message}`);
      if (!res.headersSent) return reply(res, 500, { error: 'error interno' });
      return undefined;
    }
    if (req.method === 'GET' && path === '/api/avisos/clave') return reply(res, 200, { key: keys.publicKey });
    const del = path.match(/^\/api\/avisos\/([0-9a-f-]{36})$/i);
    if (req.method === 'DELETE' && del) {
      const before = avisos.length;
      avisos = avisos.filter((a) => a.id !== del[1]);
      if (avisos.length !== before) persist();
      return reply(res, 204);
    }
    if (req.method !== 'POST' || path !== '/api/avisos') return reply(res, 404, { error: 'no existe' });

    const ip = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress);
    const minute = Math.floor(now() / 60000);
    const seen = posts.get(ip);
    const count = seen?.minute === minute ? seen.count + 1 : 1;
    if (posts.size > 5000) posts.clear();
    posts.set(ip, { minute, count });
    if (count > POSTS_PER_MINUTE) return reply(res, 429, { error: 'demasiados avisos' });

    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        aborted = true;
        reply(res, 413, { error: 'demasiado grande' });
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, { error: 'datos no válidos' }); }
      const aviso = validAviso(input, now());
      if (!aviso) return reply(res, 400, { error: 'datos no válidos' });
      const others = avisos.filter((a) => a.id !== aviso.id);
      const mine = others.filter((a) => a.subscription.endpoint === aviso.subscription.endpoint).length;
      if (others.length >= MAX_PENDING || mine >= MAX_PER_PHONE) return reply(res, 429, { error: 'demasiados avisos' });
      avisos = [...others, aviso];
      persist();
      return reply(res, 201, { id: aviso.id });
    });
    return undefined;
  });

  return { server, tick, publicKey: keys.publicKey, pending: () => avisos.length, live, stopTimes, coaches };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let network = { net: null, sim: null };
  try {
    network = await loadNetwork();
  } catch (err) {
    console.warn(`[api] sin red de buses (${err?.message}): solo funcionan los avisos`);
  }
  const service = createService({ dataDir: process.env.DATA_DIR ?? '/data', subject: process.env.PUSH_SUBJECT ?? undefined, ...network });
  service.server.listen(3001, () => console.log(`[api] escuchando en 3001${process.env.OPERADOR === '1' ? ', con los minutos de las paradas' : ''}`));
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await service.tick(); } catch (err) { console.warn(`[avisos] ${err?.message}`); }
    busy = false;
  }, 10000);
  setInterval(() => { try { service.live?.fold(); } catch (err) { console.warn(`[vivo] ${err?.message}`); } }, 60000);
  setTimeout(() => service.coaches?.tick(), 30000);
  setInterval(() => service.coaches?.tick(), 10 * 60000);
  const stop = () => service.server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

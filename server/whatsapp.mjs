// Xa Vén: avisos por WhatsApp, con la plataforma oficial de WhatsApp Business (Cloud API de Meta).
//
// La web nunca ve el teléfono de nadie:
//   1. Al tocar «Recibirlo por WhatsApp», la web guarda aquí el aviso con un código al azar
//      (POST /api/whatsapp/pedir) y abre WhatsApp con el mensaje «Avísame del bus (código …)».
//   2. La persona lo envía al número de Xa Vén. Meta nos lo pasa (POST /api/whatsapp/webhook)
//      con su número; aquí se junta con el aviso del código y se le contesta para confirmar.
//   3. A la hora, se le manda el aviso y se borra su número.
// Como es la persona quien escribe primero, los mensajes van dentro de las 24 horas que abre
// WhatsApp para contestar, sin plantillas. Por eso no se aceptan avisos a más de 23 horas.
//
// Apagado salvo que estén WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_NUMERO, WHATSAPP_VERIFY
// y WHATSAPP_APP_SECRET. Ver README.
import crypto from 'node:crypto';
import { join } from 'node:path';
import { loadJSON, madrid, readJSON, reply, saveJSON } from './red.mjs';

const CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const CODE_IN_TEXT = /(?:^|[^A-Z0-9])([A-HJ-NP-Z2-9]{8})(?![A-Z0-9])/g;
const STOP_WORDS = /^(BORRAR|PARAR|STOP|BAIXA|BAJA|QUITAR|CANCELAR)\b/;
const MAX_AHEAD = 23 * 3600000;
const PENDING_MS = 30 * 60000;
const LATE_MS = 5 * 60000;
const MAX_PENDING = 2000;
const MAX_ALERTS = 2000;
const MAX_PER_PHONE = 5;
const ASKS_PER_HOUR = 20;
const MAX_WEBHOOK = 128 * 1024;

const TEXTS = {
  es: {
    ok: 'Hecho. Te escribo por aquí a las {time}: «{title}». Si ya no lo quieres, contesta BORRAR.',
    now: 'Ahora mismo: {title}',
    gone: 'Ese aviso ya ha pasado. Vuelve a tocar la campana en la web para pedir otro.',
    old: 'Ese código ya no vale. Vuelve a tocar la campana en la web y elige «Recibirlo por WhatsApp».',
    many: 'Ya tienes {n} avisos pendientes por aquí. Espera a que llegue alguno o contesta BORRAR para quitarlos.',
    removed: 'Hecho, he quitado tus avisos.',
    none: 'No tenías ningún aviso pendiente.',
    help: 'Hola, soy Xa Vén, la web de los buses de Lugo. Para recibir aquí un aviso, toca la campana de tu bus en la web y elige «Recibirlo por WhatsApp». {url}',
  },
  gl: {
    ok: 'Feito. Escríboche por aquí ás {time}: «{title}». Se xa non o queres, contesta BORRAR.',
    now: 'Agora mesmo: {title}',
    gone: 'Ese aviso xa pasou. Volve tocar a campá na web para pedir outro.',
    old: 'Ese código xa non vale. Volve tocar a campá na web e escolle «Recibilo por WhatsApp».',
    many: 'Xa tes {n} avisos pendentes por aquí. Agarda a que chegue algún ou contesta BORRAR para quitalos.',
    removed: 'Feito, quitei os teus avisos.',
    none: 'Non tiñas ningún aviso pendente.',
    help: 'Ola, son Xa Vén, a web dos buses de Lugo. Para recibir aquí un aviso, toca a campá do teu bus na web e escolle «Recibilo por WhatsApp». {url}',
  },
};
const say = (lang, key, vars = {}) => TEXTS[lang === 'gl' ? 'gl' : 'es'][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
const hhmm = (ms) => { const m = Math.floor(madrid(ms).minutes); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

export function whatsappConfig(env = process.env) {
  return {
    token: env.WHATSAPP_TOKEN || '',
    phoneId: env.WHATSAPP_PHONE_ID || '',
    number: String(env.WHATSAPP_NUMERO || '').replace(/\D/g, ''),
    verifyToken: env.WHATSAPP_VERIFY || '',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    apiVersion: env.WHATSAPP_API_VERSION || 'v24.0',
  };
}

/** Lo que manda la web para preparar un aviso. Null si no sirve. */
export function validAsk(input, now = Date.now()) {
  if (!input || typeof input !== 'object') return null;
  const { code, at, title, body, lang } = input;
  if (typeof code !== 'string' || !CODE.test(code)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < now - 60000 || at > now + MAX_AHEAD) return null;
  if (typeof title !== 'string' || !title.trim() || title.length > 80) return null;
  if (typeof body !== 'string' || body.length > 200) return null;
  return { code, at, title: title.trim(), body: body.trim(), lang: lang === 'gl' ? 'gl' : 'es' };
}

/** Los mensajes de texto que trae un aviso de Meta: [{ id, from, text }]. */
export function incomingMessages(payload) {
  const out = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        if (typeof m?.from !== 'string' || !/^\d{6,16}$/.test(m.from)) continue;
        out.push({ id: String(m.id ?? ''), from: m.from, text: m.type === 'text' ? String(m.text?.body ?? '') : '' });
      }
    }
  }
  return out;
}

export function createWhatsApp({ dataDir, token = '', phoneId = '', number = '', verifyToken = '', appSecret = '', apiVersion = 'v24.0', base = '', now = Date.now, fetchImpl = fetch } = {}) {
  const enabled = Boolean(token && phoneId && number && verifyToken && appSecret);
  const path = join(dataDir, 'whatsapp.json');
  const saved = enabled ? loadJSON(path, {}) : {};
  let pending = Array.isArray(saved.pending) ? saved.pending : [];
  let alerts = Array.isArray(saved.alerts) ? saved.alerts : [];
  const persist = () => saveJSON(path, { pending, alerts });
  const seenIds = new Set();
  const helped = new Map();
  const asks = new Map();
  let salt = { date: '', value: '' };
  const webUrl = `${base.replace(/\/$/, '')}/demo/`;

  function daily(value) {
    const day = madrid(now()).iso;
    if (salt.date !== day) { salt = { date: day, value: crypto.randomBytes(16).toString('hex') }; helped.clear(); asks.clear(); }
    return crypto.createHash('sha256').update(`${salt.value}|${value}`).digest('base64url').slice(0, 16);
  }

  async function send(to, body) {
    const res = await fetchImpl(`https://graph.facebook.com/${apiVersion}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: false } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      let code = '';
      try { code = (await res.json())?.error?.code ?? ''; } catch { /* sin detalle */ }
      const err = new Error(`Meta respondió ${res.status}${code ? ` (${code})` : ''}`);
      err.status = res.status;
      throw err;
    }
  }
  const answer = (to, body) => send(to, body).catch((err) => console.warn(`[whatsapp] no se pudo contestar: ${err.message}`));

  function prune() {
    const t = now();
    pending = pending.filter((p) => t - p.created < PENDING_MS && p.at > t - LATE_MS);
    alerts = alerts.filter((a) => t - a.at < LATE_MS);
  }

  async function onMessage({ id, from, text }) {
    if (id) {
      if (seenIds.has(id)) return;
      if (seenIds.size > 5000) seenIds.clear();
      seenIds.add(id);
    }
    prune();
    const upper = text.trim().toUpperCase();
    if (STOP_WORDS.test(upper)) {
      const mine = alerts.filter((a) => a.to === from);
      alerts = alerts.filter((a) => a.to !== from);
      persist();
      return answer(from, say(mine[0]?.lang, mine.length ? 'removed' : 'none'));
    }
    const codes = [...upper.matchAll(CODE_IN_TEXT)].map((m) => m[1]);
    const ask = pending.find((p) => codes.includes(p.code));
    if (!ask) {
      if (/C[OÓ]DIGO/.test(upper)) return answer(from, say(/\bDO BUS\b/.test(upper) ? 'gl' : 'es', 'old'));
      // Quien ya tiene un aviso puede dar las gracias sin recibir la explicación.
      if (alerts.some((a) => a.to === from)) return undefined;
      // A quien escribe otra cosa se le explica una vez al día, sin guardar su número.
      const who = daily(from);
      if (helped.has(who)) return undefined;
      helped.set(who, true);
      return answer(from, say(/\b(OLA|GRAZAS|AVÍSAME DO)\b/.test(upper) ? 'gl' : 'es', 'help', { url: webUrl }));
    }
    pending = pending.filter((p) => p !== ask);
    const mine = alerts.filter((a) => a.to === from).length;
    if (mine >= MAX_PER_PHONE) { persist(); return answer(from, say(ask.lang, 'many', { n: mine })); }
    if (ask.at < now() - 60000) { persist(); return answer(from, say(ask.lang, 'gone')); }
    if (ask.at <= now() + 30000) {
      persist();
      return answer(from, `${say(ask.lang, 'now', { title: ask.title })}\n${ask.body}`);
    }
    alerts = [...alerts, { code: ask.code, to: from, at: ask.at, title: ask.title, body: ask.body, lang: ask.lang, tries: 0 }].slice(-MAX_ALERTS);
    persist();
    return answer(from, say(ask.lang, 'ok', { time: hhmm(ask.at), title: ask.title }));
  }

  async function tick() {
    if (!enabled) return;
    const due = alerts.filter((a) => a.at <= now());
    if (!due.length) return;
    for (const a of due) {
      let done = now() - a.at > LATE_MS;
      if (!done) {
        try {
          await send(a.to, `${a.title}\n${a.body}`);
          done = true;
        } catch (err) {
          a.tries += 1;
          done = a.tries >= 3 || (err.status >= 400 && err.status < 500 && err.status !== 429);
          console.warn(`[whatsapp] aviso no enviado: ${err.message}`);
        }
      }
      if (done) alerts = alerts.filter((x) => x !== a);
    }
    persist();
  }

  function readRaw(req) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_WEBHOOK) { resolve(null); req.destroy(); } else chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(null));
    });
  }

  function signed(raw, header) {
    const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', appSecret).update(raw).digest('hex')}`);
    const given = Buffer.from(String(header ?? ''));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  async function handle(req, res, path, from) {
    if (!path.startsWith('/api/whatsapp')) return false;
    if (req.method === 'GET' && path === '/api/whatsapp') return reply(res, 200, enabled ? { enabled: true, number } : { enabled: false }, 300);
    if (!enabled) return reply(res, 200, { enabled: false });

    if (path === '/api/whatsapp/webhook' && req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      const ok = q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === verifyToken;
      res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(ok ? String(q.get('hub.challenge') ?? '') : 'no');
      return true;
    }

    if (path === '/api/whatsapp/webhook' && req.method === 'POST') {
      const raw = await readRaw(req);
      if (!raw) return reply(res, 413, { error: 'demasiado grande' });
      if (!signed(raw, req.headers['x-hub-signature-256'])) return reply(res, 401, { error: 'firma no válida' });
      let payload = null;
      try { payload = JSON.parse(raw.toString('utf8')); } catch { /* se responde igual */ }
      reply(res, 200, { ok: true });
      for (const message of incomingMessages(payload)) {
        try { await onMessage(message); } catch (err) { console.warn(`[whatsapp] ${err.message}`); }
      }
      return true;
    }

    if (path === '/api/whatsapp/pedir' && req.method === 'POST') {
      const { value, tooBig } = await readJSON(req, 2048);
      if (tooBig) return reply(res, 413, { error: 'demasiado grande' });
      const ask = validAsk(value, now());
      if (!ask) return reply(res, 400, { error: 'datos no válidos' });
      const who = daily(from);
      const count = (asks.get(who) ?? 0) + 1;
      if (asks.size > 5000) asks.clear();
      asks.set(who, count);
      if (count > ASKS_PER_HOUR * 24 || pending.length >= MAX_PENDING) return reply(res, 429, { error: 'demasiados avisos' });
      prune();
      pending = [...pending.filter((p) => p.code !== ask.code), { ...ask, created: now() }];
      persist();
      return reply(res, 201, { ok: true });
    }

    const del = path.match(/^\/api\/whatsapp\/aviso\/([A-Z0-9]{8})$/);
    if (del && req.method === 'DELETE') {
      const before = pending.length + alerts.length;
      pending = pending.filter((p) => p.code !== del[1]);
      alerts = alerts.filter((a) => a.code !== del[1]);
      if (pending.length + alerts.length !== before) persist();
      return reply(res, 204);
    }

    return reply(res, 404, { error: 'no existe' });
  }

  return { handle, tick, enabled, pendingCount: () => pending.length, alertCount: () => alerts.length };
}

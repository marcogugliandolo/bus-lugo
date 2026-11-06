// Xa Vén: los minutos que da el sistema de información de cada parada (el QR del poste).
//
// DESACTIVADO por defecto: solo funciona con OPERADOR=1 en el entorno. No es un servicio
// publicado para reutilizar: es la página que abre el QR de cada poste. Por eso se pide con
// mesura (solo la parada que alguien abre, guardada 20 s, como mucho 120 peticiones por minuto
// en total) y la web dice que son minutos del sistema de las paradas, sin presentarlos como medidos.
//
// La forma de leer la página deriva de Urbanos de Lugo (MIT), ver NOTICE.md.
import { reply } from './red.mjs';

const ENDPOINT = 'https://info.urbanoslugo.com/qr-demo-paradas';
const CACHE_MS = 20000;
const MAX_PER_MINUTE = 120;
const MAX_BYTES = 512 * 1024;
const BLOCK_OPEN = '<div class="sae-content-info">';

const asciiLower = (text) => text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
const plain = (html) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, ' ').trim();

/** Cada salida: desde su apertura hasta el primer `</div>` seguido de otro. Sin expresiones que se atasquen. */
function* blocks(html) {
  for (let from = 0; ;) {
    const start = html.indexOf(BLOCK_OPEN, from);
    if (start === -1) return;
    let end = -1;
    for (let at = html.indexOf('</div>', start); at !== -1 && end === -1; at = html.indexOf('</div>', at + 6)) {
      let next = at + 6;
      while (next < html.length && /\s/.test(html[next])) next++;
      if (html.startsWith('</div>', next)) end = next + 6;
    }
    if (end === -1) return;
    yield html.slice(start, end);
    from = end;
  }
}

function fieldText(block, lower, cls) {
  const at = lower.indexOf(`class="${cls}"`);
  const open = at === -1 ? -1 : lower.indexOf('<p>', at);
  const close = open === -1 ? -1 : lower.indexOf('</p>', open + 3);
  return close === -1 ? '' : plain(block.slice(open + 3, close));
}

export function parseStopPage(html) {
  const out = [];
  for (const block of blocks(html)) {
    const lower = asciiLower(block);
    const minutes = /^(\d+)/.exec(fieldText(block, lower, 'sae-content-info-time'));
    if (!minutes) continue;
    out.push({
      line: fieldText(block, lower, 'sae-content-info-line').replace(/^L(?=\d)/i, '').trim(),
      towards: fieldText(block, lower, 'sae-content-info-itinerary'),
      minutes: Number(minutes[1]),
    });
  }
  return out;
}

async function readCapped(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let seen = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = MAX_BYTES - seen;
      seen += value.byteLength;
      out += decoder.decode(value.byteLength > room ? value.subarray(0, room) : value, { stream: true });
      if (seen >= MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}

export function createStopTimes({ net, enabled = process.env.OPERADOR === '1', fetchPage = null, now = Date.now, userAgent = 'XaVen/1.0 (+https://bus.marcogugliandolo.com)' }) {
  const cache = new Map();
  const inFlight = new Map();
  let windowStart = 0;
  let spent = 0;
  const get = fetchPage ?? (async (code) => {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(code)}`, { headers: { 'User-Agent': userAgent }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`parada ${res.status}`);
    return readCapped(res);
  });

  function mayAsk() {
    const t = now();
    if (t - windowStart >= 60000 || t < windowStart) { windowStart = t; spent = 0; }
    if (spent >= MAX_PER_MINUTE) return false;
    spent += 1;
    return true;
  }

  async function timesFor(code) {
    const cached = cache.get(code);
    if (cached && now() - cached.at < CACHE_MS) return cached.value;
    if (inFlight.has(code)) return inFlight.get(code);
    if (!mayAsk()) return null;
    const read = (async () => {
      try {
        const value = { departures: parseStopPage(await get(code)), fetchedAt: new Date(now()).toISOString() };
        cache.set(code, { at: now(), value });
        if (cache.size > 1000) cache.delete(cache.keys().next().value);
        return value;
      } catch {
        return null;
      } finally {
        inFlight.delete(code);
      }
    })();
    inFlight.set(code, read);
    return read;
  }

  async function handle(req, res, path) {
    const m = path.match(/^\/api\/parada\/([\w-]{1,40})$/);
    if (!m || req.method !== 'GET') return false;
    if (!enabled) return reply(res, 200, { departures: [], off: true }, 3600);
    const stop = net.stopById.get(m[1]);
    if (!stop?.code) return reply(res, 404, { error: 'parada sin código' });
    const times = await timesFor(stop.code);
    if (!times) return reply(res, 502, { error: 'no se pudo leer' });
    return reply(res, 200, times, 15);
  }

  return { handle, timesFor };
}

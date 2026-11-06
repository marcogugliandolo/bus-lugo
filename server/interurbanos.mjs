// Xa Vén: los autobuses de la Xunta que salen a pocos pasos de una parada urbana.
//
// Una vez al día se descarga el GTFS de los autobuses de la Xunta (el que agrega la Mobility
// Database), se quedan solo las paradas a menos de 150 m de una parada urbana de Lugo y las
// salidas de los próximos ocho días, y se guarda el resultado (unos cientos de KB) en el volumen.
// Si la descarga falla, se sigue usando lo último que se construyó; si nunca se construyó, la web
// simplemente no enseña nada. Con INTERURBANOS=0 no se descarga nada.
import { createReadStream, createWriteStream, existsSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { loadJSON, madrid, reply, saveJSON } from './red.mjs';

export const DEFAULT_GTFS_URL = 'https://files.mobilitydatabase.org/mdb-2821/latest.zip';
const NEAR_METRES = 150;
const DAYS_AHEAD = 8;
const REBUILD_MS = 24 * 3600 * 1000;
const RETRY_MS = 3 * 3600 * 1000;

/** Una línea de CSV con comillas, como las escribe cualquier exportador de GTFS. */
export function csvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

/**
 * Lo que hay dentro de un zip, leyendo su índice del final (también zip64). Sin herramientas de
 * fuera: así funciona igual en el contenedor que en cualquier ordenador.
 */
export async function zipEntries(path) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557 + 20);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('no es un zip');
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    const locator = eocd - 20;
    if ((cdOffset === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) && locator >= 0 && tail.readUInt32LE(locator) === 0x07064b50) {
      const record = Buffer.alloc(56);
      await fh.read(record, 0, 56, Number(tail.readBigUInt64LE(locator + 8)));
      count = Number(record.readBigUInt64LE(32));
      cdSize = Number(record.readBigUInt64LE(40));
      cdOffset = Number(record.readBigUInt64LE(48));
    }
    if (cdOffset + cdSize > size || cdSize > 64 * 1024 * 1024) throw new Error('índice del zip no válido');
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = new Map();
    for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20);
      let usize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let local = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      const end = p + 46 + nameLen + extraLen;
      for (let e = p + 46 + nameLen; e + 4 <= end;) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (local === 0xffffffff) local = Number(cd.readBigUInt64LE(q));
        }
        e += 4 + len;
      }
      // Algunos GTFS van dentro de una carpeta: vale el nombre del fichero, y manda el de la raíz.
      const base = name.replace(/^.*\//, '');
      if (base && !(entries.has(base) && name.includes('/'))) entries.set(base, { method, csize, local });
      p = end + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

async function entryStream(path, entry) {
  const fh = await open(path, 'r');
  const head = Buffer.alloc(30);
  try { await fh.read(head, 0, 30, entry.local); } finally { await fh.close(); }
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('zip dañado');
  const start = entry.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  if (!entry.csize) return Readable.from([]);
  const raw = createReadStream(path, { start, end: start + entry.csize - 1 });
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`compresión ${entry.method} no admitida`);
  const inflate = createInflateRaw();
  raw.on('error', (err) => inflate.destroy(err));
  return raw.pipe(inflate);
}

/** Lee un fichero de dentro del zip fila a fila, como objetos. Si no está, devuelve false. */
async function eachRow(zip, entries, name, onRow) {
  const entry = entries.get(name);
  if (!entry) return false;
  const lines = createInterface({ input: await entryStream(zip, entry), crlfDelay: Infinity });
  let header = null;
  for await (const raw of lines) {
    if (!raw) continue;
    const cells = csvLine(raw);
    if (!header) { header = cells.map((h) => h.replace(/^\uFEFF/, '').trim()); continue; }
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]?.trim() ?? ''; });
    onRow(row);
  }
  return header !== null;
}

const toMinutes = (hms) => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hms ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const isoOf = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const DAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Construye el índice parada urbana -> salidas interurbanas cercanas, a partir de un zip GTFS. */
export async function buildIndex({ net, sim, zip, today }) {
  const entries = await zipEntries(zip);
  // 1. Paradas de la Xunta cerca de alguna urbana.
  const near = new Map(); // parada GTFS -> { name, urban: [{ id, metres }] }
  const hasStops = await eachRow(zip, entries, 'stops.txt', (r) => {
    if (r.location_type && r.location_type !== '0') return;
    const lat = Number(r.stop_lat);
    const lng = Number(r.stop_lon);
    if (!(lat > 42.9 && lat < 43.12 && lng > -7.75 && lng < -7.4)) return;
    const urban = [];
    for (const s of net.stops) {
      const metres = sim.distanceMetres(lat, lng, s.lat, s.lng);
      if (metres <= NEAR_METRES) urban.push({ id: s.id, metres: Math.round(metres) });
    }
    if (urban.length) near.set(r.stop_id, { name: r.stop_name, urban });
  });
  if (!hasStops) throw new Error('el zip no trae stops.txt');

  // 2. Salidas desde esas paradas, y la última parada de cada viaje para no contar llegadas.
  const lastSeq = new Map();
  const kept = [];
  await eachRow(zip, entries, 'stop_times.txt', (r) => {
    const seq = Number(r.stop_sequence);
    if (!(lastSeq.get(r.trip_id) >= seq)) lastSeq.set(r.trip_id, seq);
    if (!near.has(r.stop_id) || r.pickup_type === '1') return;
    const minutes = toMinutes(r.departure_time || r.arrival_time);
    if (minutes !== null) kept.push({ trip: r.trip_id, stop: r.stop_id, seq, minutes });
  });
  const wanted = new Set(kept.map((k) => k.trip));

  // 3. Viajes, líneas y días de servicio.
  const trips = new Map();
  await eachRow(zip, entries, 'trips.txt', (r) => { if (wanted.has(r.trip_id)) trips.set(r.trip_id, { route: r.route_id, service: r.service_id, headsign: r.trip_headsign }); });
  const routes = new Map();
  await eachRow(zip, entries, 'routes.txt', (r) => { routes.set(r.route_id, { short: r.route_short_name, long: r.route_long_name }); });
  const days = [];
  for (let i = -1; i < DAYS_AHEAD; i++) days.push(addDays(today, i));
  const active = new Map(); // servicio -> Set(fecha)
  await eachRow(zip, entries, 'calendar.txt', (r) => {
    const set = new Set();
    for (const d of days) {
      const compact = d.replace(/-/g, '');
      if (compact >= r.start_date && compact <= r.end_date && r[DAY_COLUMNS[weekdayOf(d)]] === '1') set.add(d);
    }
    active.set(r.service_id, set);
  });
  await eachRow(zip, entries, 'calendar_dates.txt', (r) => {
    const d = isoOf(r.date ?? '');
    if (!days.includes(d)) return;
    if (!active.has(r.service_id)) active.set(r.service_id, new Set());
    if (r.exception_type === '1') active.get(r.service_id).add(d);
    else if (r.exception_type === '2') active.get(r.service_id).delete(d);
  });

  // 4. Por parada urbana: hora, línea, destino y en qué días sale (las horas de más de 24:00 son del día siguiente).
  const byStop = {};
  for (const k of kept) {
    if (lastSeq.get(k.trip) === k.seq) continue;
    const trip = trips.get(k.trip);
    if (!trip) continue;
    const route = routes.get(trip.route) ?? {};
    const serviceDays = [...(active.get(trip.service) ?? [])];
    const shift = Math.floor(k.minutes / 1440);
    const dates = serviceDays.map((d) => addDays(d, shift)).filter((d) => d >= today).sort();
    if (!dates.length) continue;
    const g = near.get(k.stop);
    for (const u of g.urban) {
      (byStop[u.id] ??= []).push({ route: route.short || route.long || '', headsign: trip.headsign || route.long || '', stop: g.name, metres: u.metres, minutes: k.minutes % 1440, dates });
    }
  }
  // La misma salida vista desde dos postes cercanos se queda con el más cercano.
  for (const [id, list] of Object.entries(byStop)) {
    const best = new Map();
    for (const x of list) {
      const key = `${x.route}|${x.headsign}|${x.minutes}|${x.dates.join()}`;
      if (!best.has(key) || best.get(key).metres > x.metres) best.set(key, x);
    }
    byStop[id] = [...best.values()].sort((a, b) => a.minutes - b.minutes);
  }
  return { built: new Date().toISOString(), today, stops: byStop };
}

export function createCoaches({ net, sim, dataDir, url = process.env.GTFS_URL || DEFAULT_GTFS_URL, enabled = process.env.INTERURBANOS !== '0', now = Date.now, log = console }) {
  const path = join(dataDir, 'interurbanos.json');
  let index = loadJSON(path, null);
  let building = null;
  let lastTry = 0;

  async function download(target) {
    if (!/^https?:/.test(url)) return url; // una ruta local, para pruebas
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60000) });
    if (!res.ok || !res.body) throw new Error(`descarga ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
    return target;
  }

  async function rebuild() {
    if (building) return building;
    lastTry = now();
    building = (async () => {
      const tmp = join(dataDir, 'gtfs-xunta.zip');
      try {
        const zip = await download(tmp);
        const fresh = await buildIndex({ net, sim, zip, today: madrid(now()).iso });
        saveJSON(path, fresh, 0o644);
        index = fresh;
        log.log?.(`[interurbanos] ${Object.keys(fresh.stops).length} paradas con autobuses de la Xunta`);
      } catch (err) {
        log.warn?.(`[interurbanos] no se pudo actualizar: ${err?.message}`);
      } finally {
        if (/^https?:/.test(url) && existsSync(tmp)) rmSync(tmp, { force: true });
        building = null;
      }
    })();
    return building;
  }

  /** Se llama de vez en cuando: reconstruye si lo guardado es de otro día o tiene más de 24 h. */
  function tick() {
    if (!enabled) return;
    const age = index?.built ? now() - Date.parse(index.built) : Infinity;
    const stale = !index || index.today !== madrid(now()).iso || age > REBUILD_MS;
    if (stale && now() - lastTry > (index ? RETRY_MS : 10 * 60000)) rebuild();
  }

  function departures(stopId, at = now()) {
    const m = madrid(at);
    return (index?.stops?.[stopId] ?? [])
      .filter((x) => x.dates.includes(m.iso) && x.minutes >= m.minutes - 1 && x.minutes <= m.minutes + 180)
      .slice(0, 12)
      .map(({ route, headsign, stop, metres, minutes }) => ({ route, headsign, stop, metres, minutes }));
  }

  async function handle(req, res, path) {
    const match = path.match(/^\/api\/interurbanos\/([\w-]{1,40})$/);
    if (!match || req.method !== 'GET') return false;
    if (!net.stopById.has(match[1])) return reply(res, 404, { error: 'parada desconocida' });
    if (!index) return reply(res, 200, { departures: [] }, 600);
    return reply(res, 200, { departures: departures(match[1]) }, 60);
  }

  return { handle, tick, rebuild, departures };
}

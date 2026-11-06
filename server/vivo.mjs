// Xa Vén: el bus en directo gracias a quien va dentro, y lo que suele retrasarse cada salida.
//
// Quien pulsa «Voy en este bus» y acepta compartir envía cada 15 s la carrera y el punto
// (redondeado a unos 10 m). Aquí se comprueba que tiene sentido —que esa carrera está en
// marcha y que el punto está sobre su recorrido— y se calcula cuánto va tarde o adelantado.
// No se guarda ninguna posición: en memoria, solo el retraso, y se olvida a los dos minutos.
// De cada salida se guarda en disco un único número por día (la mediana de lo que se vio),
// que es lo que permite decir «suele ir 3 min tarde».
import crypto from 'node:crypto';
import { join } from 'node:path';
import { loadJSON, madrid, median, readJSON, reply, saveJSON } from './red.mjs';

const FRESH_MS = 2 * 60000;
const MAX_BODY = 1024;
const MIN_GAP_MS = 5000;
const MAX_PER_WINDOW = 60;
const WINDOW_MS = 10 * 60000;
const ON_ROUTE_METRES = 150;
const MAX_ACCURACY = 120;
const EARLY_LIMIT = -8;
const LATE_LIMIT = 30;
const KEEP_DAYS = 60;
const KEEP_SAMPLES = 40;
const MIN_DAYS = 3;
const BOUNDS = { minLat: 42.9, maxLat: 43.12, minLng: -7.75, maxLng: -7.4 };

export function createLive({ net, sim, dataDir, now = Date.now }) {
  const historyPath = join(dataDir, 'retrasos.json');
  let history = loadJSON(historyPath, { trips: {} });
  if (!history?.trips) history = { trips: {} };
  const reports = new Map();   // carrera -> Map(fuente -> { delay, at })
  const today = new Map();     // salida -> { date, end, sources: Map(fuente -> delay) }
  const posts = new Map();     // fuente -> { last, count, since }
  let salt = { date: '', value: '' };
  let snapshot = { at: 0, body: null };
  let usualCache = { at: 0, body: null };

  /** Quien envía, sin guardar quién es: la IP mezclada con un secreto que cambia cada día. */
  function sourceOf(ip, date) {
    if (salt.date !== date) salt = { date, value: crypto.randomBytes(16).toString('hex') };
    return crypto.createHash('sha256').update(`${salt.value}|${ip}`).digest('base64url').slice(0, 16);
  }

  function limited(source) {
    const t = now();
    const p = posts.get(source);
    if (!p || t - p.since > WINDOW_MS) {
      if (posts.size > 20000) posts.clear();
      posts.set(source, { last: t, count: 1, since: t });
      return false;
    }
    if (t - p.last < MIN_GAP_MS || p.count >= MAX_PER_WINDOW) return true;
    p.last = t;
    p.count += 1;
    return false;
  }

  /** Comprueba una posición y devuelve el retraso que supone, o el motivo para no creerla. */
  function judge(input) {
    if (!input || typeof input !== 'object') return { error: 'datos no válidos' };
    const { k, la, lo, ac } = input;
    if (typeof k !== 'string' || !/^[^|]{1,40}\|\d{1,2}\|\d{1,4}$/.test(k)) return { error: 'carrera no válida' };
    if (![la, lo].every(Number.isFinite) || la < BOUNDS.minLat || la > BOUNDS.maxLat || lo < BOUNDS.minLng || lo > BOUNDS.maxLng) return { error: 'fuera de Lugo' };
    if (ac !== undefined && (!Number.isFinite(ac) || ac < 0 || ac > MAX_ACCURACY)) return { error: 'posición poco precisa' };
    const [lineId, dirIndex, run] = k.split('|');
    const dir = net.lineById.get(lineId)?.dirs[Number(dirIndex)];
    const m = madrid(now());
    const kind = sim.dayKind(net, m.iso, m.weekday);
    const svc = dir?.svc[kind];
    if (!svc || svc.dep[Number(run)] === undefined) return { error: 'esa carrera no existe hoy' };
    const r = Number(run);
    const last = dir.stops.length - 1;
    const start = sim.passTime(svc, r, 0);
    const end = sim.passTime(svc, r, last);
    if (m.minutes < start + EARLY_LIMIT || m.minutes > end + LATE_LIMIT) return { error: 'esa carrera no está en marcha' };
    const proj = sim.projectOnPath(dir, la, lo);
    if (proj.off > ON_ROUTE_METRES) return { error: 'fuera del recorrido' };
    const delay = m.minutes - sim.scheduledTimeAt(dir, svc, r, proj.metres);
    if (delay < EARLY_LIMIT || delay > LATE_LIMIT) return { error: 'demasiado lejos de su hora' };
    return { key: k, delay, date: m.iso, end, tripId: `${lineId}|${dirIndex}|${kind}|${Math.round(svc.dep[r])}` };
  }

  function record(source, j) {
    if (!reports.has(j.key)) reports.set(j.key, new Map());
    reports.get(j.key).set(source, { delay: j.delay, at: now() });
    if (!today.has(j.tripId)) today.set(j.tripId, { date: j.date, end: j.end, sources: new Map() });
    today.get(j.tripId).sources.set(source, j.delay);
    snapshot.at = 0;
  }

  /** Lo que se sabe ahora: por carrera, el retraso (mediana de quienes van dentro), hace cuánto y cuántos. */
  function current() {
    const t = now();
    if (snapshot.body && t - snapshot.at < 5000) return snapshot.body;
    const buses = {};
    for (const [key, sources] of reports) {
      for (const [source, r] of sources) if (t - r.at > FRESH_MS) sources.delete(source);
      if (!sources.size) { reports.delete(key); continue; }
      const list = [...sources.values()];
      const newest = Math.max(...list.map((r) => r.at));
      buses[key] = { d: Math.round(median(list.map((r) => r.delay)) * 10) / 10, a: Math.round((t - newest) / 1000), n: list.length };
    }
    snapshot = { at: t, body: { now: t, buses } };
    return snapshot.body;
  }

  /** Pasa al historial las salidas de hoy que ya terminaron: un número por salida y día. */
  function fold() {
    const m = madrid(now());
    let changed = false;
    for (const [tripId, day] of today) {
      if (day.date === m.iso && m.minutes < day.end + LATE_LIMIT) continue;
      today.delete(tripId);
      const value = median(day.sources.values());
      if (value === null) continue;
      const list = (history.trips[tripId] ?? []).filter((s) => s.d !== day.date);
      list.push({ d: day.date, v: Math.round(value * 10) / 10 });
      history.trips[tripId] = list.slice(-KEEP_SAMPLES);
      changed = true;
    }
    const oldest = new Date(now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    for (const [tripId, list] of Object.entries(history.trips)) {
      const kept = list.filter((s) => s.d >= oldest);
      if (kept.length !== list.length) { changed = true; if (kept.length) history.trips[tripId] = kept; else delete history.trips[tripId]; }
    }
    if (changed) {
      saveJSON(historyPath, history, 0o644);
      usualCache.at = 0;
    }
    return changed;
  }

  /** Lo que suele retrasarse cada salida, solo con días suficientes para decirlo. */
  function usual() {
    const t = now();
    if (usualCache.body && t - usualCache.at < 10 * 60000) return usualCache.body;
    const trips = {};
    for (const [tripId, list] of Object.entries(history.trips)) {
      if (list.length < MIN_DAYS) continue;
      trips[tripId] = { v: Math.round(median(list.map((s) => s.v)) * 2) / 2, n: list.length };
    }
    usualCache = { at: t, body: { trips } };
    return usualCache.body;
  }

  async function handle(req, res, path, ip) {
    if (path === '/api/vivo' && req.method === 'GET') return reply(res, 200, current(), 5);
    if (path === '/api/retrasos' && req.method === 'GET') return reply(res, 200, usual(), 600);
    if (path !== '/api/vivo' || req.method !== 'POST') return false;
    const source = sourceOf(ip, madrid(now()).iso);
    if (limited(source)) return reply(res, 429, { error: 'demasiado seguido' });
    const { value, tooBig } = await readJSON(req, MAX_BODY);
    if (tooBig) return reply(res, 413, { error: 'demasiado grande' });
    const j = judge(value);
    if (j.error) return reply(res, j.error === 'datos no válidos' || j.error === 'carrera no válida' ? 400 : 422, { error: j.error });
    record(source, j);
    return reply(res, 202, { d: Math.round(j.delay * 10) / 10 });
  }

  return { handle, fold, current, usual, judge };
}

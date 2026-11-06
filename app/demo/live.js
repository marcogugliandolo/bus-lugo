// Xa Vén: lo que se sabe en directo. Viene del servidor y nunca sustituye al horario:
// solo corre el bus de una carrera cuando alguien que va dentro ha compartido dónde está.

const LIVE_EVERY = 20000;
const HISTORY_EVERY = 30 * 60000;
const STALE_MS = 3 * 60000;

const state = {
  buses: new Map(),     // clave de carrera -> { delay, age, n, at }
  usual: new Map(),     // línea|sentido|día|salida -> { delay, n }
  own: new Map(),       // lo que mide este móvil mientras va en el bus
  stopTimes: new Map(), // parada -> { departures, at } de las pantallas de las paradas
  coach: new Map(),     // parada -> { list, at } de los interurbanos
  ok: false,
};
let timer = 0;
let historyAt = 0;
let listeners = [];

const getJSON = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function refresh() {
  const data = await getJSON('/api/vivo');
  if (data?.buses) {
    const now = Date.now();
    state.buses = new Map(Object.entries(data.buses).map(([key, b]) => [key, { delay: b.d, age: b.a, n: b.n, at: now - b.a * 1000 }]));
    state.ok = true;
  } else if (state.ok) {
    // Sin respuesta: lo que había caduca solo, no se inventa nada.
    for (const [key, b] of state.buses) if (Date.now() - b.at > STALE_MS) state.buses.delete(key);
  }
  if (Date.now() - historyAt > HISTORY_EVERY) {
    historyAt = Date.now();
    const usual = await getJSON('/api/retrasos');
    if (usual?.trips) state.usual = new Map(Object.entries(usual.trips).map(([id, x]) => [id, { delay: x.v, n: x.n }]));
  }
  listeners.forEach((fn) => fn());
}

export function startLive(onChange) {
  if (onChange) listeners.push(onChange);
  if (timer) return;
  refresh();
  timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, LIVE_EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}

/** Retraso en directo de una carrera, en minutos (positivo = va tarde), o null si nadie lo ha visto. */
export function liveFor(key) {
  const own = state.own.get(key);
  if (own && Date.now() - own.at < 90000) return { delay: own.delay, age: Math.round((Date.now() - own.at) / 1000), n: 1, mine: true };
  const b = state.buses.get(key);
  if (!b || Date.now() - b.at > STALE_MS) return null;
  return { delay: b.delay, age: Math.round((Date.now() - b.at) / 1000), n: b.n, mine: false };
}

export const liveKeys = () => new Set([...state.buses.keys(), ...state.own.keys()]);

/** Lo que mide el propio móvil desde dentro del bus. */
export function setOwn(key, delay) {
  if (delay === null) state.own.delete(key);
  else state.own.set(key, { delay, at: Date.now() });
}

/** Cuánto suele ir tarde esa salida, si hay días suficientes para decirlo. */
export function usualFor(tripId) {
  return state.usual.get(tripId) ?? null;
}

/** Lo que marca ahora el sistema de información de la parada, si el servidor lo tiene activado. */
export async function stopTimesFor(stopId) {
  const cached = state.stopTimes.get(stopId);
  if (cached && Date.now() - cached.at < 20000) return cached.data;
  const data = await getJSON(`/api/parada/${encodeURIComponent(stopId)}`);
  state.stopTimes.set(stopId, { data, at: Date.now() });
  return data;
}

/** Autobuses interurbanos que salen a pocos pasos de la parada. */
export async function coachesFor(stopId) {
  const cached = state.coach.get(stopId);
  if (cached && Date.now() - cached.at < 5 * 60000) return cached.data;
  const data = await getJSON(`/api/interurbanos/${encodeURIComponent(stopId)}`);
  state.coach.set(stopId, { data, at: Date.now() });
  return data;
}

/** Envía la posición de quien va en el bus. Sin nombre ni identificador: solo la carrera y el punto, redondeado. */
export function sendPosition(key, lat, lng, accuracy) {
  const body = JSON.stringify({ k: key, la: Math.round(lat * 1e4) / 1e4, lo: Math.round(lng * 1e4) / 1e4, ac: Math.round(accuracy || 0) });
  return fetch('/api/vivo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
    .then((r) => r.ok)
    .catch(() => false);
}

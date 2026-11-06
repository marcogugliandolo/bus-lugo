// Xa Vén: la red de buses y el motor de horarios, los mismos ficheros que usa la web.
// En el repositorio están en app/demo; en el contenedor se copian a RED_DIR con la misma forma.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_RED_DIR = fileURLToPath(new URL('../app/demo/', import.meta.url));

export async function loadNetwork(dir = process.env.RED_DIR || DEFAULT_RED_DIR) {
  const sim = await import(pathToFileURL(join(dir, 'sim.js')).href);
  const net = sim.prepare(JSON.parse(readFileSync(join(dir, 'data', 'network.json'), 'utf8')));
  return { net, sim };
}

const madridFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const WEEK = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' });

/** La fecha y la hora de Lugo en un instante: lo que usa el horario. */
export function madrid(ms = Date.now()) {
  const when = new Date(ms);
  const p = Object.fromEntries(madridFormat.formatToParts(when).map((x) => [x.type, x.value]));
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEK[weekdayFormat.format(when)],
    minutes: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60,
  };
}

export function loadJSON(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function saveJSON(path, value, mode = 0o600) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode });
  renameSync(tmp, path);
}

export const reply = (res, status, value, maxAge = 0) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(value === undefined ? '' : JSON.stringify(value));
  return true;
};

/** Lee el cuerpo de una petición con un tope de tamaño. Devuelve null si es demasiado grande o no es JSON. */
export function readJSON(req, max) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let done = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max && !done) { done = true; resolve({ tooBig: true }); req.destroy(); } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try { resolve({ value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { resolve({ value: null }); }
    });
    req.on('error', () => { if (!done) { done = true; resolve({ value: null }); } });
  });
}

export const median = (values) => {
  const list = [...values].sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = list.length >> 1;
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
};

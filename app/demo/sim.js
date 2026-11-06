// Motor de la simulación: dónde debería estar cada bus según el horario oficial.
// Nadie publica la posición real de los buses de Lugo, así que todo esto es una estimación.
// Derivado de Urbanos de Lugo (MIT): ver NOTICE.md. Sin dependencias del navegador.

export const MINUTES_PER_DAY = 1440;
const toRad = Math.PI / 180;

// Cómo se mueve un bus entre dos paradas. La hora de cada parada es la de salida: el bus llega
// un poco antes, espera y arranca justo a su hora, así que coincide con el horario publicado.
const DWELL_MINUTES = 20 / 60; // parada de 20 s, la misma que usa el cálculo de horarios
const RAMP_MINUTES = 10 / 60;  // unos 10 s para acelerar y otros tantos para frenar
const MAX_LAYOVER_MINUTES = 20; // espera máxima en cabecera antes de la siguiente salida
const SAME_PLACE_METRES = 200;

/** Parte del tramo recorrida tras `elapsed` minutos: arranca, circula, frena y espera en la parada. */
export function legProgress(legMinutes, elapsed) {
  const dwell = Math.min(DWELL_MINUTES, legMinutes * 0.35);
  const moving = legMinutes - dwell;
  if (moving <= 0 || elapsed >= moving) return { frac: 1, stopped: true };
  const tau = Math.max(0, elapsed) / moving;
  const ramp = Math.min(0.3, RAMP_MINUTES / moving);
  const peak = 1 / (1 - ramp);
  let frac;
  if (tau < ramp) frac = (peak * tau * tau) / (2 * ramp);
  else if (tau > 1 - ramp) frac = 1 - (peak * (1 - tau) * (1 - tau)) / (2 * ramp);
  else frac = peak * (tau - ramp / 2);
  return { frac, stopped: false };
}

/** Empareja cada llegada a cabecera con la siguiente salida de esa línea desde el mismo sitio. */
function layovers(net, line, kind) {
  line.layoverCache ??= {};
  if (line.layoverCache[kind]) return line.layoverCache[kind];
  const legs = [];
  line.dirs.forEach((dir, dirIndex) => {
    const svc = dir.svc[kind];
    if (!svc) return;
    const last = svc.off.length - 1;
    svc.dep.forEach((dep, run) => {
      legs.push({
        key: `${line.id}|${dirIndex}|${run}`,
        start: dep + svc.off[0],
        end: dep + svc.off[last],
        until: svc.until[run],
        first: net.stopById.get(dir.stops[0]),
        final: net.stopById.get(dir.stops[last]),
      });
    });
  });
  const taken = new Set();
  const out = new Map();
  for (const leg of [...legs].sort((a, b) => a.end - b.end)) {
    if (leg.until < leg.end - 0.01) continue; // su siguiente vuelta ya ha salido
    let best = null;
    for (const other of legs) {
      if (other === leg || taken.has(other.key)) continue;
      if (other.start < leg.end - 0.01 || other.start - leg.end > MAX_LAYOVER_MINUTES) continue;
      if (metres(leg.final.lat, leg.final.lng, other.first.lat, other.first.lng) > SAME_PLACE_METRES) continue;
      if (!best || other.start < best.start) best = other;
    }
    if (best) {
      taken.add(best.key);
      out.set(leg.key, best.start);
    }
  }
  line.layoverCache[kind] = out;
  return out;
}

function metres(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export const distanceMetres = metres;

/** Añade índices y distancias acumuladas a la red recién cargada. */
export function prepare(net) {
  net.stopById = new Map(net.stops.map((s) => [s.id, s]));
  net.lineById = new Map(net.lines.map((l) => [l.id, l]));
  net.holidaySet = new Set(net.holidays);
  for (const line of net.lines) {
    for (const dir of line.dirs) {
      const cum = [0];
      for (let i = 1; i < dir.path.length; i++) {
        cum.push(cum[i - 1] + metres(dir.path[i - 1][0], dir.path[i - 1][1], dir.path[i][0], dir.path[i][1]));
      }
      dir.cum = cum;
    }
  }
  return net;
}

/** 'laborable' | 'sabado' | 'domingo'. Los festivos usan el horario de domingo. */
export function dayKind(net, isoDate, weekday) {
  if (weekday === 0 || net.holidaySet.has(isoDate)) return 'domingo';
  return weekday === 6 ? 'sabado' : 'laborable';
}

export function formatMinutes(total) {
  const n = ((Math.round(total) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

function vertexAt(cum, target) {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  return lo;
}

function pointAt(dir, targetMetres) {
  const { path, cum } = dir;
  const segments = path.length - 1;
  const total = cum[segments];
  const target = Math.min(Math.max(targetMetres, 0), 0.9999 * total);
  const seg = Math.min(vertexAt(cum, target), segments - 1);
  const len = cum[seg + 1] - cum[seg];
  const frac = len > 0 ? (target - cum[seg]) / len : 0;
  const [lat1, lng1] = path[seg];
  const [lat2, lng2] = path[seg + 1];
  const y = Math.sin((lng2 - lng1) * toRad) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lng2 - lng1) * toRad);
  return {
    lat: lat1 + (lat2 - lat1) * frac,
    lng: lng1 + (lng2 - lng1) * frac,
    bearing: Math.round(((Math.atan2(y, x) / toRad) + 360) % 360),
    seg,
  };
}

/** Hora de paso de una carrera por una parada del sentido. */
export const passTime = (svc, run, stopIndex) => svc.dep[run] + svc.off[stopIndex];

/** Todos los buses en ruta en el minuto `t` de un día de tipo `kind`. Con `lines`, solo los de esas líneas. */
export function busesAt(net, kind, nowMinutes, { linear = false, lines = net.lines } = {}) {
  const buses = [];
  for (const line of lines) {
    const wait = linear ? new Map() : (line.dirs.some((d) => d.svc[kind]) ? layovers(net, line, kind) : new Map());
    line.dirs.forEach((dir, dirIndex) => {
      const svc = dir.svc[kind];
      if (!svc) return;
      const last = svc.off.length - 1;
      svc.dep.forEach((dep, run) => {
        const start = dep + svc.off[0];
        const end = dep + svc.off[last];
        if (end <= start) return;
        let t = nowMinutes;
        if (start > MINUTES_PER_DAY - 1 && t < start - MINUTES_PER_DAY / 2) t += MINUTES_PER_DAY;
        const key = `${line.id}|${dirIndex}|${run}`;
        const nextDeparture = wait.get(key);
        if (nextDeparture !== undefined && t >= end && t < nextDeparture) {
          const pos = pointAt(dir, dir.cum[dir.cum.length - 1]);
          buses.push({ key, line, dir, dirIndex, run, lat: pos.lat, lng: pos.lng, bearing: pos.bearing, seg: pos.seg, nextStopIndex: last, stopped: true, parkedUntil: nextDeparture });
          return;
        }
        if (t < start || t >= svc.until[run]) return;

        let leg = 0;
        while (leg < last - 1 && dep + svc.off[leg + 1] < t) leg++;
        const legStart = dep + svc.off[leg];
        const legEnd = dep + svc.off[leg + 1];
        const motion = linear
          ? { frac: legEnd > legStart ? (t - legStart) / (legEnd - legStart) : 0, stopped: false }
          : legProgress(legEnd - legStart, t - legStart);
        const legFrac = motion.frac;
        const fromM = dir.cum[dir.pi[leg] ?? 0];
        const toM = dir.cum[dir.pi[leg + 1] ?? dir.path.length - 1];
        const pos = pointAt(dir, fromM + (toM - fromM) * legFrac);
        buses.push({
          key,
          line,
          dir,
          dirIndex,
          run,
          lat: pos.lat,
          lng: pos.lng,
          bearing: pos.bearing,
          seg: pos.seg,
          nextStopIndex: Math.min(leg + 1, last),
          stopped: motion.stopped,
          parkedUntil: null,
        });
      });
    });
  }
  return buses;
}

/** Próximos pasos por una parada, del más cercano al más lejano. */
export function arrivalsAt(net, stopId, kind, nowMinutes, { grace = 0, horizon = 120, limit = 3 } = {}) {
  const stop = net.stopById.get(stopId);
  if (!stop) return [];
  const out = [];
  for (const lineId of stop.lines) {
    const line = net.lineById.get(lineId);
    if (!line) continue;
    line.dirs.forEach((dir, dirIndex) => {
      const svc = dir.svc[kind];
      const stopIndex = dir.stops.indexOf(stopId);
      if (!svc || stopIndex === -1 || stopIndex === dir.stops.length - 1) return;
      svc.dep
        .map((dep, run) => {
          let minutes = dep + svc.off[stopIndex];
          if (minutes < nowMinutes - grace) minutes += MINUTES_PER_DAY;
          return { minutes, run };
        })
        .filter((r) => r.minutes >= nowMinutes - grace && r.minutes <= nowMinutes + horizon)
        .sort((a, b) => a.minutes - b.minutes)
        .slice(0, limit)
        .forEach(({ minutes, run }) => {
          out.push({
            key: `${line.id}|${dirIndex}|${run}`,
            line,
            dir,
            dirIndex,
            run,
            stopIndex,
            minutes,
            eta: Math.max(0, Math.round(minutes - nowMinutes)),
            time: formatMinutes(minutes),
          });
        });
    });
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

/**
 * El punto del recorrido más cercano a una posición: cuántos metros lleva recorridos
 * y a cuántos metros de la calle está. Sirve para saber si alguien va de verdad en el bus.
 */
export function projectOnPath(dir, lat, lng) {
  const kx = Math.cos(lat * toRad) * 111320;
  const ky = 110540;
  let best = { metres: 0, off: Infinity };
  for (let i = 0; i < dir.path.length - 1; i++) {
    const [aLat, aLng] = dir.path[i];
    const [bLat, bLng] = dir.path[i + 1];
    const ax = (aLng - lng) * kx;
    const ay = (aLat - lat) * ky;
    const dx = (bLng - aLng) * kx;
    const dy = (bLat - aLat) * ky;
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const off = Math.hypot(ax + dx * u, ay + dy * u);
    if (off < best.off) best = { metres: dir.cum[i] + (dir.cum[i + 1] - dir.cum[i]) * u, off };
  }
  return best;
}

/** Índice de la última parada que queda atrás tras recorrer `metres` del sentido. */
export function stopIndexAt(dir, metres) {
  let i = 0;
  while (i < dir.stops.length - 1 && dir.cum[dir.pi[i + 1]] <= metres) i++;
  return i;
}

/** A qué hora debería pasar una carrera por el punto que está a `metres` del principio del recorrido. */
export function scheduledTimeAt(dir, svc, run, metres) {
  const last = dir.stops.length - 1;
  const at = (i) => dir.cum[dir.pi[i]];
  if (metres <= at(0)) return passTime(svc, run, 0);
  if (metres >= at(last)) return passTime(svc, run, last);
  const i = stopIndexAt(dir, metres);
  const from = at(i);
  const to = at(i + 1);
  const frac = to > from ? (metres - from) / (to - from) : 0;
  return passTime(svc, run, i) + (passTime(svc, run, i + 1) - passTime(svc, run, i)) * frac;
}

/** Trozo de recorrido entre un bus y una parada de su sentido, para dibujarlo en el mapa. */
export function approachPath(bus, stopIndex) {
  const end = bus.dir.pi[stopIndex];
  if (end === undefined || end <= bus.seg) return [[bus.lat, bus.lng]];
  return [[bus.lat, bus.lng], ...bus.dir.path.slice(bus.seg + 1, end + 1)];
}

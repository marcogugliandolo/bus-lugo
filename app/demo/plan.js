// Calcula cómo ir de un punto a otro con los horarios: a pie, en un bus o con un transbordo.
// Sin dependencias del navegador, para poder comprobarlo con tools/check-plan.mjs.
import { distanceMetres } from './sim.js';

const METRES_PER_MINUTE = 75; // unos 4,5 km/h
const STREET_DETOUR = 1.25; // la calle nunca va en línea recta
const NEAR_METRES = 1000;
const FAR_METRES = 2000;
const NEAREST_STOPS = 15;
const TRANSFER_METRES = 250;
const TRANSFER_MINUTES = 2;
const MAX_WAIT = 180;
const TRANSFER_PENALTY = 6;
const WALK_PENALTY = 0.3;
const SCORE_MARGIN = 30;
const TRANSFER_SAVING = 8;
const MAX_WALK_ONLY = 40;

export const walkMinutes = (metres) => (metres * STREET_DETOUR) / METRES_PER_MINUTE;

function nearbyStops(net, point) {
  const all = net.stops
    .map((stop) => ({ stop, metres: distanceMetres(point.lat, point.lng, stop.lat, stop.lng) }))
    .sort((a, b) => a.metres - b.metres);
  const near = all.filter((x) => x.metres <= NEAR_METRES).slice(0, NEAREST_STOPS);
  return near.length ? near : all.filter((x) => x.metres <= FAR_METRES).slice(0, 5);
}

/** Dónde para cada línea y sentido, y qué paradas quedan a un paso para hacer transbordo. */
function indexOf(net) {
  if (net.planIndex) return net.planIndex;
  const visits = new Map();
  for (const line of net.lines) {
    line.dirs.forEach((dir, dirIndex) => {
      dir.stops.forEach((id, i) => {
        if (i === dir.stops.length - 1) return;
        if (!visits.has(id)) visits.set(id, []);
        visits.get(id).push({ line, dir, dirIndex, i });
      });
    });
  }
  net.planIndex = { visits, close: new Map() };
  return net.planIndex;
}

function closeStops(net, id) {
  const { close } = indexOf(net);
  if (close.has(id)) return close.get(id);
  const from = net.stopById.get(id);
  const list = net.stops
    .map((stop) => ({ id: stop.id, metres: distanceMetres(from.lat, from.lng, stop.lat, stop.lng) }))
    .filter((x) => x.metres <= TRANSFER_METRES);
  close.set(id, list);
  return list;
}

/** Primer bus de ese sentido que pasa por la parada a partir de `time`. */
function nextRun(svc, i, time) {
  let best = -1;
  let bestAt = Infinity;
  svc.dep.forEach((dep, run) => {
    const at = dep + svc.off[i];
    if (at >= time && at < bestAt && at - time <= MAX_WAIT) {
      best = run;
      bestAt = at;
    }
  });
  return best;
}

function makeLeg(visit, svc, run, j) {
  return {
    key: `${visit.line.id}|${visit.dirIndex}|${run}`,
    line: visit.line,
    dir: visit.dir,
    dirIndex: visit.dirIndex,
    run,
    i: visit.i,
    j,
    boardAt: svc.dep[run] + svc.off[visit.i],
    alightAt: svc.dep[run] + svc.off[j],
  };
}

function finishTrip(legs, start, end, gaps = []) {
  const walked = start.metres + end.metres + gaps.reduce((sum, m) => sum + m, 0);
  const leave = legs[0].boardAt - walkMinutes(start.metres);
  const arrive = legs[legs.length - 1].alightAt + walkMinutes(end.metres);
  return {
    legs,
    leave,
    arrive,
    startStop: start.stop,
    startMetres: start.metres,
    endStop: end.stop,
    endMetres: end.metres,
    gaps,
    walked,
    score: arrive + (legs.length - 1) * TRANSFER_PENALTY + walkMinutes(walked) * WALK_PENALTY,
  };
}

/**
 * Devuelve hasta `limit` formas de hacer el viaje, de mejor a peor.
 * Si conviene más ir andando, `walk` trae los minutos y `better` lo indica.
 */
export function planTrips(net, { from, to, kind, t, limit = 3 }) {
  const { visits } = indexOf(net);
  const straight = distanceMetres(from.lat, from.lng, to.lat, to.lng);
  const walk = walkMinutes(straight);
  const starts = nearbyStops(net, from);
  const ends = new Map(nearbyStops(net, to).map((x) => [x.stop.id, x]));
  const trips = [];
  const seenTransfer = new Set();

  // Por cada sentido, en qué posiciones se puede bajar cerca del destino.
  const exits = new Map();
  const exitsOf = (dir) => {
    if (!exits.has(dir)) {
      const list = [];
      dir.stops.forEach((id, j) => { if (ends.has(id)) list.push(j); });
      exits.set(dir, list);
    }
    return exits.get(dir);
  };

  for (const start of starts) {
    const atStop = t + walkMinutes(start.metres);
    for (const visit of visits.get(start.stop.id) ?? []) {
      const svc = visit.dir.svc[kind];
      if (!svc) continue;
      const run = nextRun(svc, visit.i, atStop);
      if (run < 0) continue;

      for (const j of exitsOf(visit.dir)) {
        if (j <= visit.i) continue;
        const end = ends.get(visit.dir.stops[j]);
        trips.push(finishTrip([makeLeg(visit, svc, run, j)], start, end));
      }

      for (let k = visit.i + 1; k < visit.dir.stops.length; k++) {
        const offAt = svc.dep[run] + svc.off[k];
        for (const hop of closeStops(net, visit.dir.stops[k])) {
          for (const second of visits.get(hop.id) ?? []) {
            if (second.line.number === visit.line.number) continue;
            const svc2 = second.dir.svc[kind];
            if (!svc2) continue;
            const later = exitsOf(second.dir).filter((j) => j > second.i);
            if (!later.length) continue;
            const seen = `${visit.line.id}|${visit.dirIndex}|${run}|${start.stop.id}|${k}|${second.line.id}|${second.dirIndex}|${second.i}`;
            if (seenTransfer.has(seen)) continue;
            seenTransfer.add(seen);
            const run2 = nextRun(svc2, second.i, offAt + walkMinutes(hop.metres) + TRANSFER_MINUTES);
            if (run2 < 0) continue;
            const first = makeLeg(visit, svc, run, k);
            for (const j of later) {
              trips.push(finishTrip([first, makeLeg(second, svc2, run2, j)], start, ends.get(second.dir.stops[j]), [hop.metres]));
            }
          }
        }
      }
    }
  }

  // Un transbordo solo merece la pena si ahorra tiempo de verdad frente al bus directo.
  const direct = Math.min(...trips.filter((x) => x.legs.length === 1).map((x) => x.arrive), Infinity);
  const useful = trips.filter((x) => x.legs.length === 1 || x.arrive < direct - TRANSFER_SAVING);
  useful.sort((a, b) => a.score - b.score || b.leave - a.leave);
  const bestScore = useful[0]?.score ?? Infinity;
  const chosen = [];
  const lines = new Set();
  for (const trip of useful) {
    if (trip.score > bestScore + SCORE_MARGIN) break;
    const signature = trip.legs.map((leg) => leg.line.number).join('>');
    if (lines.has(signature)) continue;
    lines.add(signature);
    chosen.push(trip);
    if (chosen.length === limit) break;
  }
  const walkArrive = t + walk;
  return {
    trips: chosen,
    walk: walk <= MAX_WALK_ONLY ? walk : null,
    better: walk <= MAX_WALK_ONLY && (!chosen.length || walkArrive <= chosen[0].arrive + 3),
    nearFrom: starts.length > 0,
    nearTo: ends.size > 0,
  };
}

/** Puntos del recorrido del bus entre dos paradas, para dibujarlo en el mapa. */
export function legPath(leg) {
  return leg.dir.path.slice(leg.dir.pi[leg.i], leg.dir.pi[leg.j] + 1);
}

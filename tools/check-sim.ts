/**
 * Comprueba que sim.js da lo mismo que el código original de Urbanos de Lugo:
 * posiciones de todos los buses y próximos pasos por todas las paradas, cada 7 minutos,
 * en un día laborable, un sábado, un domingo y un festivo. Se compila igual que build-network.ts.
 */
import { BUS_LINES, BUS_STOPS } from '@urbanos/data/transitData';
import geometry from '@urbanos/data/route-geometry.json';
import { getScheduledBuses } from '@urbanos/utils/vehicles';
import { getArrivalsForStop } from '@urbanos/utils/arrivals';
import { readFileSync } from 'fs';
import { prepare, busesAt, arrivalsAt, dayKind } from '../app/demo/sim.js';

const G = geometry as Record<string, { path: [number, number][]; stopPathIndex: number[] }>;
for (const l of BUS_LINES) {
  for (const d of l.directions) {
    d.pathCoordinates = G[`${l.id}|${d.id}`].path;
    d.stopPathIndex = G[`${l.id}|${d.id}`].stopPathIndex;
  }
}
const net = prepare(JSON.parse(readFileSync(process.argv[2] ?? 'app/demo/data/network.json', 'utf8')));
const days: [number, number, number][] = [[2026, 10, 2], [2026, 10, 7], [2026, 10, 8], [2026, 11, 8]];
let compared = 0;
let arrivalsCompared = 0;
const problems: string[] = [];
for (const [y, m, d] of days) {
  const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const kind = dayKind(net, iso, new Date(y, m, d).getDay());
  console.log(iso, kind);
  for (let t = 300; t < 1440; t += 7) {
    const when = new Date(y, m, d, Math.floor(t / 60), t % 60, 0);
    const theirs = getScheduledBuses(when);
    const mine = busesAt(net, kind, t, { linear: true });
    if (theirs.length !== mine.length) problems.push(`${iso} ${t}: ${theirs.length} buses frente a ${mine.length}`);
    const byId = new Map(mine.map((b: any) => [`${b.line.id}-${b.dir.id}-${b.run}`, b]));
    for (const b of theirs) {
      const own: any = byId.get(b.id);
      compared++;
      if (!own) { problems.push(`${iso} ${t}: falta ${b.id}`); continue; }
      const off = Math.hypot(own.lat - b.currentLat, own.lng - b.currentLng);
      if (off > 1e-4) problems.push(`${iso} ${t} ${b.id}: desvío ${off.toExponential(1)}`);
    }
    if ((t - 300) % 49 === 0) {
      for (const s of BUS_STOPS) {
        const a = getArrivalsForStop(s.id, when).arrivals.map((x) => `${x.lineId}|${x.destination}|${x.etaTime}`).sort();
        const b = arrivalsAt(net, s.id, kind, t, { grace: GRACE, horizon: HORIZON }).map((x: any) => `${x.line.id}|${x.dir.dest}|${x.time}`).sort();
        arrivalsCompared += a.length;
        if (a.join() !== b.join()) problems.push(`${iso} ${t} ${s.id}: ${a.length} pasos frente a ${b.length}`);
      }
    }
  }
}
// Con el movimiento realista, a la hora publicada de cada parada el bus tiene que estar en ella.
let onTime = 0;
for (const line of net.lines as any[]) {
  line.dirs.forEach((dir: any, dirIndex: number) => {
    const svc = dir.svc.laborable;
    if (!svc) return;
    svc.dep.forEach((dep: number, run: number) => {
      for (let i = 1; i < dir.stops.length - 1; i++) {
        const when = dep + svc.off[i] - 0.001;
        if (when >= svc.until[run] || svc.off[i] - svc.off[i - 1] < 0.05) continue;
        const bus: any = busesAt(net, 'laborable', when).find((b: any) => b.key === `${line.id}|${dirIndex}|${run}`);
        if (!bus) continue;
        const [la, lo] = dir.path[dir.pi[i]];
        onTime++;
        if (Math.hypot(bus.lat - la, bus.lng - lo) > 2e-4) problems.push(`${line.id} ${dir.id} carrera ${run} parada ${i}: no está en la parada a su hora`);
      }
    });
  });
}
console.log(`${onTime} horas de paso comprobadas con el bus en su parada`);
console.log(`${compared} posiciones y ${arrivalsCompared} pasos comparados, ${problems.length} diferencias`);
console.log(problems.slice(0, 15).join('\n'));
process.exit(problems.length ? 1 : 0);

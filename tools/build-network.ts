/**
 * Genera app/demo/data/network.json y streets.json a partir del dataset de Urbanos de Lugo
 * (https://github.com/urbanos-lugo/urbanos-lugo.github.io), que transcribe buslugo.com.
 *
 * Las horas de cada carrera se calculan aquí, una vez, con el código de ese proyecto (MIT):
 * la web solo tiene que sumar "salida + desfase" y no necesita entender la tabla de horarios.
 *
 *   URBANOS=/ruta/al/repo npx esbuild tools/build-network.ts --bundle --platform=node \
 *     --format=cjs --external:react --alias:@urbanos=$URBANOS/src --outfile=/tmp/build.cjs
 *   node /tmp/build.cjs
 */
import { BUS_LINES, BUS_STOPS } from '@urbanos/data/transitData';
import geometry from '@urbanos/data/route-geometry.json';
import walk from '@urbanos/data/walk-network.json';
import festivos from '@urbanos/data/festivos.json';
import { buildRuns, handoverMinutes } from '@urbanos/utils/schedule';
import { mkdirSync, writeFileSync } from 'fs';

const OUT = process.argv[2] ?? 'app/demo/data';
const KINDS = ['laborable', 'sabado', 'domingo'] as const;
const round = (n: number) => Math.round(n * 1000) / 1000;
const G = geometry as Record<string, { path: [number, number][]; stopPathIndex: number[] }>;

const lines = BUS_LINES.map((line) => ({
  id: line.id,
  number: line.number,
  name: line.name,
  color: line.color,
  days: line.days,
  frequency: line.frequency,
  first: line.firstDeparture,
  last: line.lastDeparture,
  dirs: line.directions.map((dir, dirIndex) => {
    const geo = G[`${line.id}|${dir.id}`];
    if (!geo || geo.stopPathIndex.length !== dir.stops.length) throw new Error(`Sin recorrido: ${line.id} ${dir.id}`);
    const svc: Record<string, { off: number[]; dep: number[]; until: number[] }> = {};
    for (const kind of KINDS) {
      const runs = buildRuns(line, dirIndex, BUS_STOPS, kind);
      if (!runs.length) continue;
      const handover = handoverMinutes(line, BUS_STOPS, kind);
      const off = runs[0].minutesByStopIndex.map((m) => round(m - runs[0].minutesByStopIndex[0]));
      for (const run of runs) {
        run.minutesByStopIndex.forEach((m, i) => {
          if (Math.abs(m - run.minutesByStopIndex[0] - off[i]) > 0.01) throw new Error(`Desfase distinto: ${line.id} ${dir.id}`);
        });
      }
      svc[kind] = {
        off,
        dep: runs.map((r) => round(r.minutesByStopIndex[0])),
        until: runs.map((r, i) => round(handover.get(`${dirIndex}|${i}`) ?? r.minutesByStopIndex[r.minutesByStopIndex.length - 1])),
      };
    }
    return { id: dir.id, origin: dir.origin, dest: dir.destination, stops: dir.stops, path: geo.path, pi: geo.stopPathIndex, svc };
  }),
}));

const stops = BUS_STOPS.map((s) => ({ id: s.id, name: s.name, code: s.officialToken || null, lat: s.lat, lng: s.lng, lines: s.lines }));
const holidays = Object.values(festivos as Record<string, { days: string[] }>).flatMap((y) => y.days);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/network.json`, JSON.stringify({ source: 'buslugo.com vía urbanos-lugo.github.io', holidays, stops, lines }));

// Calles para dibujar el mapa cuando no se pueden cargar las teselas de OpenFreeMap.
const W = walk as unknown as { scale: number; junctions: number[]; edges: number[] };
const jLat: number[] = [];
const jLng: number[] = [];
let la = 0;
let lo = 0;
for (let i = 0; i < W.junctions.length; i += 2) {
  la += W.junctions[i];
  lo += W.junctions[i + 1];
  jLat.push(la);
  jLng.push(lo);
}
const streets: number[][][] = [];
for (let i = 0; i < W.edges.length; ) {
  const [a, b, , , n] = W.edges.slice(i, i + 5);
  i += 5;
  let pLat = jLat[a];
  let pLng = jLng[a];
  const line = [[pLng / W.scale, pLat / W.scale]];
  for (let k = 0; k < n; k++) {
    pLat += W.edges[i + k * 2];
    pLng += W.edges[i + k * 2 + 1];
    line.push([pLng / W.scale, pLat / W.scale]);
  }
  i += n * 2;
  line.push([jLng[b] / W.scale, jLat[b] / W.scale]);
  streets.push(line);
}
writeFileSync(`${OUT}/streets.json`, JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: streets } }));
console.log(`${lines.length} líneas, ${stops.length} paradas, ${streets.length} calles`);

// Comprueba el cálculo de viajes con miles de pares de puntos de Lugo.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { prepare } from '../app/demo/sim.js';
import { planTrips, walkMinutes, legPath } from '../app/demo/plan.js';

const net = prepare(JSON.parse(readFileSync(new URL('../app/demo/data/network.json', import.meta.url), 'utf8')));
let seed = 7;
const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = () => net.stops[Math.floor(random() * net.stops.length)];

const stats = { pairs: 0, conBus: 0, directos: 0, transbordo: 0, andando: 0, sinBus: 0, maxMs: 0, totalMs: 0 };
for (const [kind, t] of [['laborable', 480], ['laborable', 720], ['laborable', 1290], ['sabado', 600], ['domingo', 660]]) {
  for (let n = 0; n < 300; n++) {
    const a = pick();
    const b = pick();
    const started = performance.now();
    const plan = planTrips(net, { from: a, to: b, kind, t });
    const ms = performance.now() - started;
    stats.pairs += 1;
    stats.totalMs += ms;
    stats.maxMs = Math.max(stats.maxMs, ms);
    if (plan.better) stats.andando += 1;
    if (!plan.trips.length) stats.sinBus += 1;
    else stats.conBus += 1;
    assert.ok(plan.trips.length <= 3);
    for (const trip of plan.trips) {
      if (trip.legs.length === 1) stats.directos += 1; else stats.transbordo += 1;
      assert.ok(trip.legs.length <= 2);
      assert.ok(trip.leave >= t - 1e-6, 'no se sale antes de ahora');
      assert.ok(trip.arrive >= trip.leave, 'se llega después de salir');
      let clock = trip.leave;
      trip.legs.forEach((leg, index) => {
        assert.ok(leg.j > leg.i, 'se baja después de subir');
        assert.ok(leg.boardAt >= clock - 1e-6, 'el bus se coge después de llegar a la parada');
        assert.ok(leg.alightAt > leg.boardAt - 1e-6, 'el trayecto avanza');
        assert.ok(leg.dir.svc[kind].dep[leg.run] !== undefined, 'ese viaje existe hoy');
        assert.ok(legPath(leg).length >= 1);
        clock = leg.alightAt;
        if (index < trip.legs.length - 1) clock += walkMinutes(trip.gaps[index]) + 1.99;
      });
      assert.equal(trip.legs[0].dir.stops[trip.legs[0].i], trip.startStop.id);
      assert.equal(trip.legs.at(-1).dir.stops[trip.legs.at(-1).j], trip.endStop.id);
    }
  }
}
console.log(stats, `media ${(stats.totalMs / stats.pairs).toFixed(1)} ms`);

// Un caso que se puede revisar a mano: de una parada de la línea 1.1 a otra más adelante.
const line = net.lines.find((l) => l.id === '1.1');
const dir = line.dirs[0];
const a = net.stopById.get(dir.stops[2]);
const b = net.stopById.get(dir.stops[14]);
const plan = planTrips(net, { from: a, to: b, kind: 'laborable', t: 600 });
console.log(a.name, '→', b.name);
for (const trip of plan.trips) console.log(' ', trip.legs.map((l) => `${l.line.number} ${Math.round(l.boardAt)}-${Math.round(l.alightAt)}`).join(' + '), `sale ${Math.round(trip.leave)} llega ${Math.round(trip.arrive)}`);

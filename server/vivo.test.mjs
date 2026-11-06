import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import test, { after } from 'node:test';
import { createService } from './push.mjs';
import { loadNetwork, madrid } from './red.mjs';
import { parseStopPage } from './operador.mjs';
import { buildIndex, csvLine } from './interurbanos.mjs';

const { net, sim } = await loadNetwork();

// Miércoles 4 de noviembre de 2026, laborable, a las 10:00 de Lugo (09:00 UTC).
const TEN = Date.parse('2026-11-04T09:00:00Z');
assert.equal(madrid(TEN).minutes, 600);

const open = new Set();
after(() => Promise.all([...open].map((close) => close())));

/** Una carrera que a las 10:00 va por la mitad de su recorrido (y lleva al menos `since` minutos en marcha). */
function runningAt(t, since = 6) {
  for (const line of net.lines) {
    for (const [dirIndex, dir] of line.dirs.entries()) {
      const svc = dir.svc.laborable;
      if (!svc) continue;
      for (const [run] of svc.dep.entries()) {
        const start = sim.passTime(svc, run, 0);
        const end = sim.passTime(svc, run, dir.stops.length - 1);
        if (start + since < t && end - 6 > t) return { key: `${line.id}|${dirIndex}|${run}`, line, dir, dirIndex, run };
      }
    }
  }
  throw new Error('ninguna carrera');
}

async function service(clock) {
  const dataDir = mkdtempSync(join(tmpdir(), 'xaven-'));
  const s = createService({ dataDir, now: () => clock.t, send: async () => {}, net, sim, coaches: { enabled: false } });
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.server.address().port}`;
  const post = (body, ip = '10.0.0.1') => fetch(`${base}/api/vivo`, { method: 'POST', headers: { 'X-Real-IP': ip }, body: JSON.stringify(body) });
  let closed = null;
  const close = () => (closed ??= new Promise((r) => { s.server.closeAllConnections?.(); s.server.close(() => r()); }));
  open.add(close);
  return { s, base, post, dataDir, close };
}

/** Dónde debería ir esa carrera en el minuto `t`, como la vería alguien que va dentro. */
function pointAt(trip, t) {
  const bus = sim.busesAt(net, 'laborable', t, { lines: [trip.line] }).find((b) => b.key === trip.key);
  return { k: trip.key, la: Math.round(bus.lat * 1e4) / 1e4, lo: Math.round(bus.lng * 1e4) / 1e4, ac: 15 };
}

test('una posición sobre el recorrido da el retraso del bus y se ve en directo', async () => {
  const clock = { t: TEN };
  const { base, post, close } = await service(clock);
  const trip = runningAt(600);

  const onTime = await post(pointAt(trip, 600));
  assert.equal(onTime.status, 202);
  assert.ok(Math.abs((await onTime.json()).d) <= 1, 'a su hora');

  clock.t += 6000;
  const late = await post(pointAt(trip, 595), '10.0.0.2');
  assert.equal(late.status, 202);
  const { d } = await late.json();
  assert.ok(d > 3.5 && d < 6.5, `cinco minutos tarde, no ${d}`);

  const live = await (await fetch(`${base}/api/vivo`)).json();
  assert.equal(live.buses[trip.key].n, 2, 'dos personas distintas');
  assert.ok(live.buses[trip.key].d > 1.5 && live.buses[trip.key].d < 4, 'la mediana de las dos');

  clock.t += 3 * 60000;
  const later = await (await fetch(`${base}/api/vivo`)).json();
  assert.equal(later.buses[trip.key], undefined, 'se olvida a los dos minutos');
  await close();
});

test('rechaza lo que no puede ser: fuera del recorrido, otra hora, datos raros, demasiado seguido', async () => {
  const clock = { t: TEN };
  const { post, close } = await service(clock);
  const trip = runningAt(600);
  const good = pointAt(trip, 600);

  assert.equal((await post({ ...good, la: good.la + 0.01 })).status, 422, 'a un kilómetro de la calle');
  clock.t += 6000;
  assert.equal((await post({ ...good, k: 'nada|0|0' })).status, 422, 'carrera que no existe');
  clock.t += 6000;
  assert.equal((await post({ ...good, k: '<script>' })).status, 400);
  clock.t += 6000;
  assert.equal((await post({ ...good, la: 40.4, lo: -3.7 })).status, 422, 'fuera de Lugo');
  clock.t += 6000;
  assert.equal((await post({ ...good, ac: 400 })).status, 422, 'GPS sin precisión');
  // Más de media hora tarde no es creíble: alguien en el principio del recorrido 35 min después de salir.
  const long = net.lines.flatMap((line) => line.dirs.map((dir, dirIndex) => ({ line, dir, dirIndex, run: 0, key: `${line.id}|${dirIndex}|0` })))
    .find((x) => x.dir.svc.laborable && sim.passTime(x.dir.svc.laborable, 0, x.dir.stops.length - 1) - sim.passTime(x.dir.svc.laborable, 0, 0) >= 15);
  const longStart = sim.passTime(long.dir.svc.laborable, 0, 0);
  const lateClock = { t: Date.parse('2026-11-03T23:00:00Z') + (longStart + 36) * 60000 };
  const lateOne = await service(lateClock);
  assert.equal((await lateOne.post(pointAt(long, longStart + 1))).status, 422, 'más de media hora tarde no es creíble');

  clock.t += 6000;
  assert.equal((await post(good, '10.9.9.9')).status, 202);
  assert.equal((await post(good, '10.9.9.9')).status, 429, 'una vez cada cinco segundos');
  clock.t += 5000;
  assert.equal((await post(good, '10.9.9.9')).status, 202);

  const night = { t: Date.parse('2026-11-04T02:00:00Z') };
  const other = await service(night);
  assert.equal((await other.post(good)).status, 422, 'a las tres de la mañana esa carrera no está en marcha');
  await other.close();
  await close();
});

test('con tres días vistos, dice cuánto suele ir tarde esa salida', async () => {
  const trip = runningAt(600);
  const clock = { t: TEN };
  const { base, post, dataDir, s, close } = await service(clock);
  for (let day = 0; day < 3; day++) {
    clock.t = TEN + day * 86400000;
    const res = await post(pointAt(trip, 596), `10.0.1.${day}`);
    assert.equal(res.status, 202, `día ${day}`);
    clock.t += 3 * 3600000; // ya terminó
    s.live.fold();
  }
  const saved = JSON.parse(readFileSync(join(dataDir, 'retrasos.json'), 'utf8'));
  const id = `${trip.line.id}|${trip.dirIndex}|laborable|${Math.round(trip.dir.svc.laborable.dep[trip.run])}`;
  assert.equal(saved.trips[id].length, 3, 'un número por día');
  assert.ok(!JSON.stringify(saved).includes('10.0.1'), 'sin rastro de quién lo envió');
  const usual = await (await fetch(`${base}/api/retrasos`)).json();
  assert.ok(usual.trips[id].v >= 3 && usual.trips[id].v <= 5, `suele ir unos 4 min tarde, no ${usual.trips[id].v}`);
  await close();
});

test('los minutos de la parada: desactivados salvo que se pidan, y bien leídos', async () => {
  const block = (line, itinerary, time) => `<div class="sae-content-info">
      <div class="sae-content-info-line"> <svg/> <p>${line}</p> </div>
      <div class="sae-content-info-itinerary"> <svg/> <p>${itinerary}</p> </div>
      <div class="sae-content-info-time"> <svg/> <p>${time}</p> </div>
    </div>`;
  const page = block('L4.2', 'R. MURALLA-HULA (POR GANDARAS)', '20 min') + block('5DS', 'AVENIDA AMERICAS-MAGOI-FONTIÑAS-HULA', '3 min');
  assert.deepEqual(parseStopPage(page), [
    { line: '4.2', towards: 'R. MURALLA-HULA (POR GANDARAS)', minutes: 20 },
    { line: '5DS', towards: 'AVENIDA AMERICAS-MAGOI-FONTIÑAS-HULA', minutes: 3 },
  ]);
  const started = Date.now();
  parseStopPage('<div class="sae-content-info">'.repeat(4000));
  assert.ok(Date.now() - started < 1000, 'una página rota no atasca');

  const stop = net.stops.find((s) => s.code);
  const dataDir = mkdtempSync(join(tmpdir(), 'xaven-'));
  let asked = 0;
  const off = createService({ dataDir, net, sim, coaches: { enabled: false }, stopTimes: { enabled: false } });
  const on = createService({ dataDir, net, sim, coaches: { enabled: false }, stopTimes: { enabled: true, fetchPage: async () => { asked++; return page; } } });
  for (const s of [off, on]) {
    await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
    open.add(() => new Promise((r) => { s.server.closeAllConnections?.(); s.server.close(() => r()); }));
  }
  const url = (s, id) => `http://127.0.0.1:${s.server.address().port}/api/parada/${id}`;
  const disabled = await fetch(url(off, stop.id));
  assert.equal(disabled.status, 200);
  assert.deepEqual(await disabled.json(), { departures: [], off: true }, 'desactivado: no pide nada a nadie');
  const res = await fetch(url(on, stop.id));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).departures.length, 2);
  await fetch(url(on, stop.id));
  assert.equal(asked, 1, 'se guarda 20 s y no se vuelve a pedir');
  assert.equal((await fetch(url(on, 'nada'))).status, 404, 'solo paradas conocidas');
});

/** Un zip sencillo, para no depender de herramientas en las pruebas. */
function zipOf(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc, 16); head.writeUInt32LE(packed.length, 20); head.writeUInt32LE(data.length, 24); head.writeUInt16LE(nameBuf.length, 28); head.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    central.push(head, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('los interurbanos: salidas cercanas, sus días y sin contar llegadas', async () => {
  assert.deepEqual(csvLine('a,"b, c","d ""e"""'), ['a', 'b, c', 'd "e"']);
  const urban = net.stops[0];
  const lat = (urban.lat + 0.0003).toFixed(6); // unos 30 m
  const files = {
    'stops.txt': `\uFEFFstop_id,stop_name,stop_lat,stop_lon\r\nX1,"Lugo, ${urban.name}",${lat},${urban.lng}\r\nX2,Sarria,42.78,-7.41\r\nX3,Muy lejos,43.5,-8.2\r\n`,
    'routes.txt': 'route_id,route_short_name,route_long_name\nR1,XG635,Lugo - Sarria\n',
    'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,LAB,T1,Sarria\nR1,LAB,T2,Lugo\nR1,DOM,T3,Sarria\nR1,LAB,T4,Sarria\n',
    'stop_times.txt': [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type',
      'T1,10:30:00,10:30:00,X1,1,0', 'T1,11:10:00,11:10:00,X2,2,0',
      'T2,09:20:00,09:20:00,X2,1,0', 'T2,10:00:00,10:00:00,X1,2,0',
      'T3,10:45:00,10:45:00,X1,1,0', 'T3,11:25:00,11:25:00,X2,2,0',
      'T4,24:15:00,24:15:00,X1,1,0', 'T4,24:55:00,24:55:00,X2,2,0',
    ].join('\n'),
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nLAB,1,1,1,1,1,0,0,20260101,20261231\nDOM,0,0,0,0,0,0,1,20260101,20261231\n',
    'calendar_dates.txt': 'service_id,date,exception_type\nLAB,20261105,2\n',
  };
  const dir = mkdtempSync(join(tmpdir(), 'gtfs-'));
  const zip = join(dir, 'gtfs.zip');
  writeFileSync(zip, zipOf(files));
  const index = await buildIndex({ net, sim, zip, today: '2026-11-04' });
  const list = index.stops[urban.id];
  assert.ok(list, 'la parada urbana tiene interurbanos');
  const at1030 = list.find((x) => x.minutes === 630);
  assert.equal(at1030.route, 'XG635');
  assert.equal(at1030.headsign, 'Sarria');
  assert.ok(at1030.metres > 15 && at1030.metres < 50);
  assert.ok(at1030.dates.includes('2026-11-04') && !at1030.dates.includes('2026-11-05'), 'el 5 no circula por la excepción');
  assert.ok(!at1030.dates.includes('2026-11-07'), 'ni el sábado');
  assert.ok(!list.some((x) => x.minutes === 600), 'el que termina aquí es una llegada, no una salida');
  assert.ok(list.find((x) => x.minutes === 645).dates.includes('2026-11-08'), 'el de los domingos');
  assert.ok(list.find((x) => x.minutes === 15).dates.includes('2026-11-05'), 'las 24:15 del miércoles son las 00:15 del jueves');

  const dataDir = mkdtempSync(join(tmpdir(), 'xaven-'));
  const clock = { t: TEN };
  const s = createService({ dataDir, net, sim, now: () => clock.t, coaches: { url: zip, log: {} } });
  await s.coaches.rebuild();
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
  open.add(() => new Promise((r) => { s.server.closeAllConnections?.(); s.server.close(() => r()); }));
  const res = await fetch(`http://127.0.0.1:${s.server.address().port}/api/interurbanos/${urban.id}`);
  const body = await res.json();
  assert.deepEqual(body.departures.map((x) => x.minutes), [630], 'a las 10:00 de un miércoles: la de las 10:30');
});

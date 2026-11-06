import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createService } from './push.mjs';
import { checkWorks, createWorks } from './obras.mjs';
import { validReport } from './reportes.mjs';
import { activeWorks, STALE_DAYS } from '../app/demo/obras.js';

const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

async function start(options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'reportes-'));
  const service = createService({ dataDir, ...options });
  servers.push(service.server);
  await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
  return { service, dataDir, base: `http://127.0.0.1:${service.server.address().port}` };
}

const obra = (extra = {}) => ({ lineas: ['7'], titulo: { es: 'Obras en la 7', gl: 'Obras na 7' }, texto: { es: 'Desvío', gl: 'Desvío' }, ...extra });

test('avisos de obras: lo que caduca o no ha empezado no se ve', () => {
  const list = [
    obra({ desde: '2026-11-02', actualizado: '2026-11-02' }),
    obra({ desde: '2026-12-01', titulo: { es: 'Futuro' } }),
    obra({ hasta: '2026-11-05', titulo: { es: 'Acabado' } }),
    obra({ actualizado: '2026-08-01', titulo: { es: 'Viejo sin fecha de fin' } }),
    obra({ actualizado: '2026-08-01', hasta: '2026-12-31', titulo: { es: 'Largo con fin' } }),
    { lineas: ['1'] },
    null,
  ];
  const today = activeWorks(list, '2026-11-06', 'gl');
  assert.deepEqual(today.map((w) => w.title), ['Obras na 7', 'Largo con fin']);
  assert.deepEqual(today[0].lines, ['7']);
  // Sin fecha de fin, se quita solo pasados los días de margen.
  const day = (n) => new Date(Date.parse('2026-11-02T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  assert.equal(activeWorks([list[0]], day(STALE_DAYS)).length, 1);
  assert.equal(activeWorks([list[0]], day(STALE_DAYS + 1)).length, 0);
  assert.deepEqual(activeWorks('nada', '2026-11-06'), []);
});

test('el fichero de obras del repositorio está bien escrito', () => {
  const text = readFileSync(new URL('../app/demo/data/obras.json', import.meta.url), 'utf8');
  assert.ok(checkWorks(text).length >= 0);
  assert.throws(() => checkWorks('{ "avisos": [ { "titulo": {} } ] }'), /titulo\.es/);
  assert.throws(() => checkWorks('{ "avisos": [ '), /JSON/);
  assert.throws(() => checkWorks(JSON.stringify({ avisos: [obra({ hasta: '6/11/2026' })] })), /AAAA-MM-DD/);
});

test('obras: se leen de GitHub y, si el fichero nuevo está mal, se queda el anterior', async () => {
  let body = JSON.stringify({ avisos: [obra()] });
  const asked = [];
  const works = createWorks({ repo: 'yo/bus', branch: 'main', fetchImpl: async (url, init) => { asked.push({ url, init }); return new Response(body); } });
  await works.tick();
  assert.match(asked[0].url, /api\.github\.com\/repos\/yo\/bus\/contents\/app\/demo\/data\/obras\.json\?ref=main/);
  assert.equal(asked[0].init.headers.Accept, 'application/vnd.github.raw');
  body = '{ roto';
  const warn = console.warn;
  console.warn = () => {};
  await works.tick();
  console.warn = warn;
  const { base } = await start({ works: { repo: 'yo/bus', fetchImpl: async () => new Response(JSON.stringify({ avisos: [obra({ titulo: { es: 'Desde GitHub' } })] })) } });
  const empty = await (await fetch(`${base}/api/obras`)).json();
  assert.equal(empty.avisos, null, 'sin leer todavía, la web usa su copia');
  // El servicio de la prueba es otro; se comprueba el de arriba directamente.
  const res = { status: 0, headers: {}, writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
  await works.handle({ method: 'GET' }, res, '/api/obras');
  assert.equal(res.body.avisos[0].titulo.es, 'Obras en la 7');
});

test('obras: en el ordenador se lee el fichero local en cada petición', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obras-'));
  const file = join(dir, 'obras.json');
  writeFileSync(file, JSON.stringify({ avisos: [obra()] }));
  const { base } = await start({ works: { file } });
  assert.equal((await (await fetch(`${base}/api/obras`)).json()).avisos.length, 1);
  writeFileSync(file, JSON.stringify({ avisos: [] }));
  assert.equal((await (await fetch(`${base}/api/obras`)).json()).avisos.length, 0);
});

test('¿Algo no cuadra?: valida, limita y no guarda la IP', async () => {
  assert.equal(validReport({}), null);
  assert.equal(validReport({ tipo: 'inventado' }), null);
  assert.equal(validReport({ tipo: 'hora' }).tipo, 'hora');
  assert.equal(validReport({ texto: 'algo' }).tipo, 'otro');
  assert.equal(validReport({ texto: 'x'.repeat(5000) }).texto.length, 1000);
  assert.equal(validReport({ texto: 'a\u0000b' }).texto, 'ab');

  const notes = [];
  const { base, dataDir, service } = await start({ reports: { key: 'clave-de-prueba-123', notifyUrl: 'https://ntfy.example/tema', fetchImpl: async (url, init) => { notes.push({ url, init }); return new Response('ok'); } } });
  const send = (body, ip = '203.0.113.7') => fetch(`${base}/api/reportes`, { method: 'POST', headers: { 'X-Real-IP': ip }, body: JSON.stringify(body) });

  assert.equal((await send({})).status, 400);
  const ok = await send({ tipo: 'hora', texto: 'El de las 10:15 pasó a las 10:30', contacto: 'ana@example.com', donde: 'La parada Praza Maior', contexto: { vista: 'stop', parada: '70', hora: '10:31', simulado: false, idioma: 'es' } });
  assert.equal(ok.status, 201);
  // El campo trampa: responde bien pero no guarda nada.
  assert.equal((await send({ tipo: 'hora', web: 'http://spam' })).status, 201);
  assert.equal(service.reports.count(), 1);

  const saved = JSON.parse(readFileSync(join(dataDir, 'reportes.json'), 'utf8'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].contexto.parada, '70');
  assert.doesNotMatch(JSON.stringify(saved), /203\.0\.113\.7/);

  // El aviso al móvil solo lleva el tipo y el sitio, nunca el contacto ni el texto.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].init.body, 'La hora no coincide · La parada Praza Maior');
  assert.doesNotMatch(notes[0].init.body, /ana@|10:30/);

  // Seis por hora desde el mismo sitio; otro sitio sigue pudiendo.
  for (let i = 0; i < 5; i += 1) assert.equal((await send({ tipo: 'otro' })).status, 201);
  assert.equal((await send({ tipo: 'otro' })).status, 429);
  assert.equal((await send({ tipo: 'otro' }, '198.51.100.1')).status, 201);
});

test('¿Algo no cuadra?: página privada con clave, marcar como hecho y borrado a los 180 días', async () => {
  let clock = Date.parse('2026-11-06T10:00:00Z');
  const { base, service } = await start({ now: () => clock, reports: { key: 'clave-de-prueba-123' } });
  await fetch(`${base}/api/reportes`, { method: 'POST', body: JSON.stringify({ tipo: 'parada', texto: '<script>alert(1)</script>', donde: 'La línea 5' }) });

  assert.equal((await fetch(`${base}/api/reportes/ver`)).status, 403);
  assert.equal((await fetch(`${base}/api/reportes/ver?clave=mala`)).status, 403);
  const page = await fetch(`${base}/api/reportes/ver?clave=clave-de-prueba-123`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await page.text();
  assert.match(html, /La parada está mal o no existe/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);

  const id = html.match(/name="id" value="([^"]+)"/)[1];
  const bad = await fetch(`${base}/api/reportes/hecho`, { method: 'POST', body: new URLSearchParams({ clave: 'mala', id }), redirect: 'manual' });
  assert.equal(bad.status, 403);
  const done = await fetch(`${base}/api/reportes/hecho`, { method: 'POST', body: new URLSearchParams({ clave: 'clave-de-prueba-123', id }), redirect: 'manual' });
  assert.equal(done.status, 303);
  assert.equal(service.reports.count(), 0);

  await fetch(`${base}/api/reportes`, { method: 'POST', body: JSON.stringify({ tipo: 'hora' }) });
  clock += 181 * 86400000;
  service.reports.prune();
  assert.equal(service.reports.count(), 0);
});

test('¿Algo no cuadra?: sin clave fijada se crea una y se queda para la próxima vez', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'reportes-'));
  const first = createService({ dataDir });
  const second = createService({ dataDir });
  assert.match(first.reports.link(), /\/api\/reportes\/ver\?clave=[\w-]{20,}$/);
  assert.equal(first.reports.link(), second.reports.link());
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createService } from './push.mjs';
import { incomingMessages, validAsk } from './whatsapp.mjs';

const servers = [];
after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close(); } });

const SECRET = 'secreto-de-la-app';
const CONFIG = { token: 'tok', phoneId: '123456', number: '34600000000', verifyToken: 'verifica', appSecret: SECRET, base: 'https://bus.example' };
const PHONE = '34611222333';

async function start({ clock, whatsapp = CONFIG } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'whatsapp-'));
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, ...JSON.parse(init.body) });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.x' }] }), { status: 200 });
  };
  const service = createService({ dataDir, now: () => clock.t, whatsapp: { ...whatsapp, fetchImpl } });
  servers.push(service.server);
  await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const hook = (messages, sign = true) => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messages } }] }] });
    const signature = `sha256=${crypto.createHmac('sha256', sign ? SECRET : 'otro').update(body).digest('hex')}`;
    return fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body });
  };
  const text = (body, id = crypto.randomUUID()) => ({ id, from: PHONE, type: 'text', text: { body }, timestamp: '1' });
  const ask = (extra) => fetch(`${base}/api/whatsapp/pedir`, { method: 'POST', body: JSON.stringify({ code: 'K7M2Q9XA', at: clock.t + 10 * 60000, title: 'Línea 5: llega en 5 min', body: 'Hacia Hospital. Parada Praza Maior, a las 14:20.', lang: 'es', ...extra }) });
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { service, base, sent, hook, text, ask, settle, dataDir };
}

test('apagado sin configuración: la web lo sabe y no hay nada más', async () => {
  const clock = { t: Date.now() };
  const { base } = await start({ clock, whatsapp: {} });
  assert.deepEqual(await (await fetch(`${base}/api/whatsapp`)).json(), { enabled: false });
  const res = await fetch(`${base}/api/whatsapp/pedir`, { method: 'POST', body: '{}' });
  assert.deepEqual(await res.json(), { enabled: false });
});

test('valida lo que pide la web y lee los mensajes de Meta', () => {
  const now = Date.now();
  const good = { code: 'K7M2Q9XA', at: now + 60000, title: 'Línea 5', body: 'x' };
  assert.ok(validAsk(good, now));
  assert.equal(validAsk({ ...good, code: 'k7m2q9xa' }, now), null);
  assert.equal(validAsk({ ...good, code: 'K7M2Q9X0' }, now), null, 'sin 0, O, 1 ni I, que se confunden');
  assert.equal(validAsk({ ...good, at: now + 24 * 3600000 }, now), null, 'más allá de las 24 horas de WhatsApp');
  assert.equal(validAsk({ ...good, title: '' }, now), null);
  const list = incomingMessages({ entry: [{ changes: [{ value: { messages: [{ id: 'a', from: PHONE, type: 'text', text: { body: 'hola' } }, { id: 'b', from: 'x', type: 'text' }, { id: 'c', from: PHONE, type: 'image' }] } }] }] });
  assert.deepEqual(list, [{ id: 'a', from: PHONE, text: 'hola' }, { id: 'c', from: PHONE, text: '' }]);
  assert.deepEqual(incomingMessages(null), []);
});

test('verificación del webhook y firma de Meta', async () => {
  const clock = { t: Date.now() };
  const { base, hook, text } = await start({ clock });
  assert.deepEqual(await (await fetch(`${base}/api/whatsapp`)).json(), { enabled: true, number: '34600000000' });
  const ok = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  assert.equal((await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=1`)).status, 403);
  assert.equal((await hook([text('hola')], false)).status, 401);
});

test('pedir, confirmar por WhatsApp, enviar a su hora y borrar el número', async () => {
  const clock = { t: Date.parse('2026-11-06T13:10:00Z') };
  const { service, sent, hook, text, ask, settle, dataDir } = await start({ clock });
  assert.equal((await ask()).status, 201);
  assert.equal(service.whatsapp.pendingCount(), 1);

  assert.equal((await hook([text('Avísame del bus (código K7M2Q9XA)', 'm1')])).status, 200);
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, PHONE);
  assert.equal(sent[0].url, 'https://graph.facebook.com/v24.0/123456/messages');
  assert.match(sent[0].text.body, /^Hecho\. Te escribo por aquí a las 14:20: «Línea 5: llega en 5 min»/);
  assert.equal(service.whatsapp.pendingCount(), 0);
  assert.equal(service.whatsapp.alertCount(), 1);

  // Meta repite a veces el mismo mensaje: no se contesta dos veces.
  await hook([text('Avísame del bus (código K7M2Q9XA)', 'm1')]);
  await settle();
  assert.equal(sent.length, 1);

  await service.whatsapp.tick();
  assert.equal(sent.length, 1, 'aún no es la hora');
  clock.t += 10 * 60000;
  await service.whatsapp.tick();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].text.body, 'Línea 5: llega en 5 min\nHacia Hospital. Parada Praza Maior, a las 14:20.');
  assert.equal(service.whatsapp.alertCount(), 0);
  assert.doesNotMatch(readFileSync(join(dataDir, 'whatsapp.json'), 'utf8'), new RegExp(PHONE), 'el número ya no está guardado');
});

test('BORRAR, códigos caducados, ayuda una vez al día y quitar desde la web', async () => {
  const clock = { t: Date.parse('2026-11-06T13:10:00Z') };
  const { base, service, sent, hook, text, ask, settle } = await start({ clock });
  await ask({ lang: 'gl' });
  await hook([text('Avísame do bus (código K7M2Q9XA)')]);
  await settle();
  assert.match(sent.at(-1).text.body, /^Feito\./);
  await hook([text('borrar')]);
  await settle();
  assert.equal(sent.at(-1).text.body, 'Feito, quitei os teus avisos.');
  assert.equal(service.whatsapp.alertCount(), 0);

  await hook([text('Avísame del bus (código ZZZZ2222)')]);
  await settle();
  assert.match(sent.at(-1).text.body, /^Ese código ya no vale/);

  const before = sent.length;
  await hook([text('Hola, ¿a qué hora pasa el 5?')]);
  await hook([text('¿Hola?')]);
  await settle();
  assert.equal(sent.length, before + 1, 'la ayuda solo se manda una vez');
  assert.match(sent.at(-1).text.body, /https:\/\/bus\.example\/demo\//);

  await ask({ code: 'ABCD2345' });
  assert.equal(service.whatsapp.pendingCount(), 1);
  assert.equal((await fetch(`${base}/api/whatsapp/aviso/ABCD2345`, { method: 'DELETE' })).status, 204);
  assert.equal(service.whatsapp.pendingCount(), 0);

  // Un código que no se usa caduca a la media hora.
  await ask({ code: 'ABCD2346' });
  clock.t += 31 * 60000;
  await hook([text('Avísame del bus (código ABCD2346)')]);
  await settle();
  assert.match(sent.at(-1).text.body, /^Ese código ya no vale/);
});

test('como mucho cinco avisos pendientes por teléfono', async () => {
  const clock = { t: Date.parse('2026-11-06T13:10:00Z') };
  const { service, sent, hook, text, ask, settle } = await start({ clock });
  const codes = ['AAAA2222', 'AAAA3333', 'AAAA4444', 'AAAA5555', 'AAAA6666', 'AAAA7777'];
  for (const code of codes) {
    await ask({ code });
    await hook([text(`Avísame del bus (código ${code})`)]);
  }
  await settle();
  assert.equal(service.whatsapp.alertCount(), 5);
  assert.match(sent.at(-1).text.body, /^Ya tienes 5 avisos pendientes/);
});

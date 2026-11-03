import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import webpush from 'web-push';
import { createService, validAviso } from './push.mjs';

const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
const aviso = (extra = {}) => ({ id: crypto.randomUUID(), at: Date.now() + 60000, subscription, title: 'Línea 5.1: llega en 5 min', body: 'Hacia Hospital', url: '/demo/#s70', ...extra });

test('valida los datos y solo acepta servicios de notificaciones', () => {
  assert.ok(validAviso(aviso()));
  assert.ok(validAviso(aviso({ subscription: { ...subscription, endpoint: 'https://web.push.apple.com/x' } })));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://169.254.169.254/x']) {
    assert.equal(validAviso(aviso({ subscription: { ...subscription, endpoint: bad } })), null, bad);
  }
  assert.equal(validAviso(aviso({ at: Date.now() + 30 * 3600 * 1000 })), null);
  assert.equal(validAviso(aviso({ url: 'https://evil.example' })), null);
  assert.equal(validAviso(aviso({ title: 'x'.repeat(81) })), null);
});

test('API, envío a su hora, borrado y persistencia', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'avisos-'));
  let clock = Date.now();
  const sent = [];
  const service = createService({ dataDir, now: () => clock, send: async (sub, payload, options) => {
    webpush.generateRequestDetails(sub, payload, options); // cifra de verdad con las claves del móvil
    sent.push(JSON.parse(payload));
  } });
  await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const post = (body) => fetch(`${base}/api/avisos`, { method: 'POST', body: JSON.stringify(body) });

  assert.equal((await (await fetch(`${base}/api/avisos/clave`)).json()).key, service.publicKey);
  const first = aviso();
  const second = aviso({ at: clock + 120000 });
  assert.equal((await post(first)).status, 201);
  assert.equal((await post(second)).status, 201);
  assert.equal((await post({ ...aviso(), url: 'x' })).status, 400);
  assert.equal(service.pending(), 2);

  await service.tick();
  assert.equal(sent.length, 0, 'no envía antes de hora');
  clock += 61000;
  await service.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].tag, first.id);
  assert.equal(service.pending(), 1);

  assert.equal((await fetch(`${base}/api/avisos/${second.id}`, { method: 'DELETE' })).status, 204);
  assert.equal(service.pending(), 0);
  clock += 120000;
  await service.tick();
  assert.equal(sent.length, 1, 'un aviso quitado no se envía');

  assert.equal(statSync(join(dataDir, 'claves.json')).mode & 0o077, 0, 'claves privadas');
  assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'avisos.json'), 'utf8')), []);
  const again = createService({ dataDir, send: async () => {} });
  assert.equal(again.publicKey, service.publicKey, 'mantiene las claves al reiniciar');
  await new Promise((r) => service.server.close(r));
});

test('borra el aviso si el móvil ya no acepta notificaciones', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'avisos-'));
  let clock = Date.now();
  const service = createService({ dataDir, now: () => clock, send: async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); } });
  await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${service.server.address().port}/api/avisos`, { method: 'POST', body: JSON.stringify(aviso()) });
  assert.equal(res.status, 201);
  clock += 61000;
  await service.tick();
  assert.equal(service.pending(), 0);
  await new Promise((r) => service.server.close(r));
});

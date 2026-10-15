import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { mobileOrigin, startMobileListener } from '../lib/mobile-access.mjs';
import { connectionFor, checkServeConfig } from '../setup-mobile.mjs';
import { startFixture, until } from './helpers.mjs';

const origin = 'https://desktop.tail123.ts.net';
const host = new URL(origin).host;
test('mobile origin and Tailscale setup reject unsafe addresses and existing services', () => {
  assert.equal(mobileOrigin(origin), origin);
  assert.equal(connectionFor({ BackendState: 'Running', Self: { DNSName: host + '.' } }), origin);
  assert.throws(() => connectionFor({ BackendState: 'Stopped' }));
  for (const url of ['http://' + host, origin + ':8443', origin + '/path', origin + '?a=1', 'https://127.0.0.1', 'https://user@' + host, origin + '.evil.test']) assert.throws(() => mobileOrigin(url));
  const target = 'http://127.0.0.1:18322', key = host + ':443';
  checkServeConfig({}, origin, target);
  checkServeConfig(null, origin, target);
  checkServeConfig({ Web: { [key]: { Handlers: { '/': { Proxy: target }, '/unrelated': { Text: 'preserve' } } } }, TCP: { '443': { HTTPS: true } } }, origin, target);
  for (const cfg of [
    { AllowFunnel: { [key]: true } }, { TCP: { '443': { TCPForward: 'localhost:443' } } },
    { Web: { [key]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } },
    { Web: { 'other.tail123.ts.net:443': { Handlers: {} } } },
  ]) assert.throws(() => checkServeConfig(cfg, origin, target));
  assert.throws(() => startMobileListener({ origin, port: 0 }, () => {}));
});

test('mobile gateway keeps password auth, Secure cookies, latest PC tabs, live events and dev bridge isolation', { timeout: 20000 }, async t => {
  const f = await startFixture({ mobile: { enabled: true, origin }, external: { enabled: false } });
  t.after(f.stop);
  const base = `http://127.0.0.1:${f.cfg.mobile.port}`;
  // Node fetch rewrites Host to the URL authority; model the actual reverse proxy
  // with http.request, which preserves the public Host header.
  const request = (route, options = {}) => new Promise((resolve, reject) => {
    const req = http.request(base + route, { ...options, headers: { Host: host, ...options.headers } }, res => {
      resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject); req.end(options.body?.toString());
  });
  await until(async () => (await request('/api/state')).status === 401);
  assert.equal((await fetch(base)).status, 421);
  assert.equal((await request('/')).status, 303);
  const password = fs.readFileSync(path.join(f.home, 'data/external-password.txt'), 'utf8').trim();
  assert.equal((await request('/login', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) })).status, 403);
  const login = await request('/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) });
  assert.equal(login.status, 303);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  for (const route of ['/', '/work.html', '/developer.html', '/api/conversations/developer', '/api/state']) {
    assert.equal((await request(route, { headers })).status, 200, route);
  }
  for (const route of ['/api/dev/state', '/api/dev/messages']) assert.equal((await request(route, { headers })).status, 404);
  const controller = new AbortController(); t.after(() => controller.abort());
  const stream = await request('/events', { headers, signal: controller.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader(); let events = '';
  const read = (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; events += new TextDecoder().decode(value); } } catch {} })();
  assert.equal((await request('/api/send', { method: 'POST', headers, body: JSON.stringify({ text: 'MOBILE-LIVE-CHECK' }) })).status, 200);
  await until(() => events.includes('MOBILE-LIVE-CHECK'));
  controller.abort(); await read;
  const localState = await (await f.request('/api/state')).json();
  assert.ok(localState.messages.some(m => m.text === 'MOBILE-LIVE-CHECK'));
  await request('/logout', { headers });
  assert.equal((await request('/api/state', { headers })).status, 401);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { startFixture, until, ROOT } from './helpers.mjs';

const skip = process.platform === 'win32' && 'POSIX fake CLI fixture; run on Linux/macOS';
const action = { action: 'say', messages: ['안녕'], note_add: '기억할 내용', react: { id: 2, emoji: '👍' }, reply_to: 2,
  files: [{ op: 'write', path: 'test.txt', content: 'restored' }], show: 'test.txt',
  build: [{ op: 'place', at: [2, 1, 2], block: 'stone' }], move: [2, 3],
  sticker: 'stickers/test.png', sticker_save: {}, image: 'disabled', block_define: {}, world_look: {}, world_shot: {}, open: 'private.txt',
};

test('fake Muse: room start, reply, all disabled fields dropped, notes/react/photo retained', { skip, timeout: 30000 }, async (t) => {
  const fixture = await startFixture({ imageGen: true, agents: { muse: { model: '', effort: 'low', extraArgs: ['--fixture-action', JSON.stringify(action)] } } });
  t.after(fixture.stop);
  const { request, home } = fixture;
  const initial = await (await request('/api/state')).json();
  assert.equal(initial.room.chatOnly, true);
  assert.deepEqual(initial.members.map((m) => m.id), ['claude', 'gpt', 'muse', 'gemini']);
  assert.equal(initial.members.find((m) => m.id === 'muse').model, 'default (effort low)');
  assert.ok(initial.members.every((m) => m.imageGen === false));
  fs.writeFileSync(path.join(home, 'workspace/private.txt'), 'PRIVATE-FILE-SENTINEL');
  await request('/api/room', { running: true });
  await request('/api/send', { text: '@Muse 안녕', image: { data: fs.readFileSync(path.join(ROOT, 'public/icons/icon-192.png')).toString('base64') } });
  const state = await until(async () => {
    const st = await (await request('/api/state')).json();
    return st.messages.some((m) => m.from === 'muse' && m.text === '안녕') && st;
  });
  await request('/api/room', { running: false });
  const log = fs.readFileSync(path.join(home, 'data/logs/muse.log'), 'utf8');
  assert.match(log, /chatOnly ignored: files, show, sticker, sticker_save, image, build, block_define, move, world_look, world_shot/);
  assert.match(log, /chatOnly ignored:.*open/);
  assert.equal(fs.existsSync(path.join(home, 'workspace/test.txt')), false);
  assert.deepEqual(state.files, []);
  assert.equal(state.messages.find((m) => m.from === 'muse').replyTo, 2);
  assert.deepEqual(state.messages.find((m) => m.id === 2).reactions['👍'], ['muse']);
  assert.match((await (await request('/api/notes')).json()).muse, /기억할 내용/);
  const photo = state.messages.find((m) => m.attach?.upload).attach.path;
  assert.equal((await request(`/ws/${photo}`)).status, 200);
  assert.equal((await request('/api/file?path=' + encodeURIComponent(photo))).status, 200);
  const invocation = JSON.parse(fs.readFileSync(path.join(home, 'data/cwd/muse/chat/calls.jsonl'), 'utf8').trim().split('\n')[0]);
  assert.ok(invocation.args.includes('--image'));
  assert.ok(!invocation.prompt.includes('PRIVATE-FILE-SENTINEL'));
  for (const url of ['/world.html', '/api/world', '/api/file?path=test.txt', '/ws/test.txt', '/api/dev/workspace/file']) assert.equal((await request(url)).status, 403);
  assert.equal((await request('/api/send', { sticker: 'stickers/test.png' })).status, 403);
});

test('chatOnly=false restores workspace writes, world building and routes', { skip, timeout: 25000 }, async (t) => {
  const restored = { action: 'say', messages: ['복구'], files: action.files, build: action.build };
  const f = await startFixture({ chatOnly: false, agents: { muse: { model: '', extraArgs: ['--fixture-action', JSON.stringify(restored)] } } });
  t.after(f.stop);
  await f.request('/api/room', { running: true });
  await f.request('/api/send', { text: '@Muse 복구 확인' });
  await until(() => fs.existsSync(path.join(f.home, 'workspace/test.txt')));
  await f.request('/api/room', { running: false });
  assert.equal(fs.readFileSync(path.join(f.home, 'workspace/test.txt'), 'utf8'), 'restored');
  assert.equal((await f.request('/world.html')).status, 200);
  const world = await (await f.request('/api/world')).json();
  assert.ok(JSON.stringify(world).includes('stone'));
  assert.equal((await f.request('/api/file?path=test.txt')).status, 200);
});

test('external HTTPS: LAN URL, password gate, authenticated manifest/icons, blocked dev bridge', { skip, timeout: 25000 }, async (t) => {
  const f = await startFixture({ external: { enabled: true, host: '0.0.0.0', https: true } });
  t.after(f.stop);
  assert.match(f.output(), /같은 와이파이의 폰에서: https:\/\/\d+\.\d+\.\d+\.\d+:\d+/);
  assert.match(f.output(), /<공인 IP>/);
  const cert = fs.readFileSync(path.join(f.home, 'data/tls/cert.pem'));
  // Trust only this fixture certificate, and verify its CN. No TLS bypass.
  const request = (url, { method = 'GET', body = '', cookie = '' } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port: f.cfg.external.port, servername: 'ai-chatroom', ca: cert,
      path: url, method, headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => {
      const chunks = []; res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end(body);
  });
  assert.equal((await request('/manifest.webmanifest')).status, 401);
  const password = fs.readFileSync(path.join(f.home, 'data/external-password.txt'), 'utf8').trim();
  const login = await request('/login', { method: 'POST', body: new URLSearchParams({ password }).toString() });
  assert.equal(login.status, 303);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const manifest = await request('/manifest.webmanifest', { cookie });
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers['content-type'], 'application/manifest+json');
  assert.equal(JSON.parse(manifest.body).display, 'standalone');
  for (const size of [192, 512]) {
    const icon = await request(`/icons/icon-${size}.png`, { cookie });
    assert.equal(icon.status, 200); assert.equal(icon.headers['content-type'], 'image/png');
    assert.equal(icon.body.readUInt32BE(16), size); assert.equal(icon.body.readUInt32BE(20), size);
  }
  assert.equal((await request('/api/dev/state', { cookie })).status, 404);
});

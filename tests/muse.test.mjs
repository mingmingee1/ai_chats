import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Adapters, museText, resolveBins } from '../lib/agents.mjs';
import { MEMBERS, mentions, withJosa } from '../lib/members.mjs';
import { fixtureConfig } from './helpers.mjs';

test('Muse JSONL: join deltas while ignoring user prompt echo', () => {
  const stdout = [
    { type: 'user_message', content: '{"action":"pass"}' },
    { type: 'response.output_text.delta', delta: '{"action":' },
    { type: 'tool_result', content: '{"action":"wrong"}' },
    { type: 'response.output_text.delta', delta: '"say","messages":["안녕"]}' },
  ].map(JSON.stringify).join('\n');
  assert.equal(museText(stdout), '{"action":"say","messages":["안녕"]}');
});
test('Muse JSONL: completed nested assistant content', () => {
  assert.equal(museText('{"type":"item.completed","item":{"role":"assistant","content":[{"type":"output_text","text":"{\\"action\\":\\"pass\\"}"}]}}'), '{"action":"pass"}');
});
test('Muse plain output: return unchanged', () => {
  assert.equal(museText('일반 텍스트\n그대로'), '일반 텍스트\n그대로');
});
test('Muse final action wins, nested echoes and non-content strings are ignored', () => {
  const stdout = [
    { type: 'delta', text: '{"action":"pass"}' },
    { type: 'result', item: { role: 'user', content: '{"action":"wrong"}' }, final_output: '{"action":"say","messages":["완성"]}', id: 'noise' },
    { type: 'done', text: 'finished' },
  ].map(JSON.stringify).join('\n');
  assert.equal(museText(stdout), '{"action":"say","messages":["완성"]}');
});
test('Muse aliases and Korean particles do not match metaverse', () => {
  for (const alias of ['Muse', '뮤즈', 'ミューズ', 'meta ai']) assert.equal(mentions(alias, 'muse'), true);
  assert.equal(mentions('메타버스 museum', 'muse'), false);
  assert.equal(withJosa('muse', '방장', '이/가'), 'Muse가');
  assert.equal(MEMBERS.muse.imageGen, false);
});

test('Muse adapter: safe flags, photos, boost, overrides, cleanup and failure', { skip: process.platform === 'win32' && 'POSIX executable fixture; run on Linux/macOS', timeout: 15000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-adapter-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cfg = fixtureConfig(home);
  const adapter = new Adapters(home, cfg);
  assert.equal(resolveBins(cfg.bins).muse, cfg.bins.muse);
  assert.equal(adapter.available().muse, true);
  assert.equal(adapter.canSee('muse'), true);
  const photo = path.join(home, 'photo.png'); fs.writeFileSync(photo, 'fixture');
  assert.equal((await adapter.chat('muse', 'brief', 'turn', { images: [photo] })).ok, true);
  const cwd = adapter.cwd('muse');
  const last = () => JSON.parse(fs.readFileSync(path.join(cwd, 'calls.jsonl'), 'utf8').trim().split('\n').at(-1));
  let call = last();
  assert.equal(call.prompt, 'brief\n\n=====\n\nturn');
  assert.deepEqual(call.args.slice(0, 2), ['exec', '--prompt-file']);
  for (const flag of ['--json', '--disable-write', '--disable-shell', '--no-session-log']) assert.ok(call.args.includes(flag));
  assert.equal(call.args[call.args.indexOf('--approval-mode') + 1], 'never');
  assert.equal(call.args[call.args.indexOf('--sandbox-network') + 1], 'restricted');
  assert.equal(call.args[call.args.indexOf('--reasoning-effort') + 1], 'low');
  assert.equal(call.args[call.args.indexOf('--image') + 1], photo);
  assert.equal(call.args.includes('--model'), false);
  assert.equal(fs.existsSync(path.join(cwd, 'prompt.txt')), false);
  cfg.webSearch = true;
  await adapter.chat('muse', 'brief', 'turn', { boost: true });
  call = last();
  assert.equal(call.args[call.args.indexOf('--reasoning-effort') + 1], 'high');
  assert.equal(call.args[call.args.indexOf('--sandbox-network') + 1], 'enabled');
  cfg.agents.muse = { model: 'fixture-model', maxSteps: 2, seePhotos: false, safetyArgs: ['--fixture-safe'], extraArgs: ['--fixture-fail'] };
  assert.equal((await adapter.chat('muse', 'brief', 'turn', { images: [photo] })).ok, false);
  call = last();
  assert.ok(call.args.includes('--fixture-safe'));
  assert.equal(call.args.includes('--disable-write'), false);
  assert.equal(call.args.includes('--image'), false);
  assert.equal(call.args[call.args.indexOf('--model') + 1], 'fixture-model');
  assert.equal(call.args[call.args.indexOf('--max-model-steps') + 1], '2');
  assert.equal(fs.existsSync(path.join(cwd, 'prompt.txt')), false);
  cfg.agents.muse.extraArgs = ['--yolo'];
  await assert.rejects(adapter.chat('muse', '', ''), /must not disable the sandbox/);
  cfg.agents.muse.extraArgs = ['--fixture-slow']; cfg.turnTimeoutSec = 0.1;
  assert.equal((await adapter.chat('muse', '', '')).ok, false);
  assert.equal(fs.existsSync(path.join(cwd, 'prompt.txt')), false);
});

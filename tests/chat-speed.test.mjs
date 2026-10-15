import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Adapters, museChatBinary } from '../lib/agents.mjs';

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-speed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Muse chat follows the installed version and falls back safely when unavailable', (t) => {
  const root = temporary(t);
  const launcher = path.join(root, 'muse.cmd');
  const marker = path.join(root, '.muse-version');
  fs.writeFileSync(launcher, '');
  assert.equal(museChatBinary(launcher, 'win32'), launcher);
  fs.writeFileSync(path.join(root, '.muse-launcher.ps1'), '');
  fs.writeFileSync(marker, '1.4.8-R6256.1\n');
  assert.equal(museChatBinary(launcher, 'win32'), launcher);
  const first = path.join(root, 'muse-bin-1.4.8-R6256.1.exe');
  fs.writeFileSync(first, '');
  assert.equal(museChatBinary(launcher, 'win32'), first);
  assert.equal(museChatBinary(launcher, 'linux'), launcher);
  assert.equal(museChatBinary(first, 'win32'), first);
  const next = path.join(root, 'muse-bin-1.4.9-R7000.exe');
  fs.writeFileSync(next, '');
  fs.writeFileSync(marker, '1.4.9-R7000');
  assert.equal(museChatBinary(launcher, 'win32'), next);
  fs.writeFileSync(marker, '../outside');
  assert.equal(museChatBinary(launcher, 'win32'), launcher);
});

test('Gemini sends configured effort and preserves the boost override', async (t) => {
  const root = temporary(t);
  const script = path.join(root, 'fake-agy.cjs');
  const calls = path.join(root, 'calls.jsonl');
  fs.writeFileSync(script, `#!${process.execPath}\nconst fs=require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');
console.log(JSON.stringify({status:'SUCCESS',response:'{"action":"pass"}',conversation_id:'fixture'}));\n`, { mode: 0o755 });
  let bin = script;
  if (process.platform === 'win32') {
    bin = path.join(root, 'fake-agy.cmd');
    fs.writeFileSync(bin, `@echo off\r\n"${process.execPath}" "%~dp0fake-agy.cjs" %*\r\n`);
  }
  const missing = path.join(root, 'not-installed');
  const cfg = {
    bins: { claude: missing, codex: missing, muse: missing, agy: bin },
    agents: { gemini: { model: 'fixture-medium', effort: 'low', boost: { model: 'fixture-high', effort: 'high' } } },
  };
  const adapter = new Adapters(root, cfg);
  assert.equal((await adapter.chat('gemini', 'brief', 'turn')).ok, true);
  assert.equal((await adapter.chat('gemini', 'brief', 'turn', { boost: true })).ok, true);
  delete cfg.agents.gemini.effort;
  assert.equal((await adapter.chat('gemini', 'brief', 'turn')).ok, true);
  const [normal, boost, legacy] = fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(normal[normal.indexOf('--effort') + 1], 'low');
  assert.equal(boost[boost.indexOf('--effort') + 1], 'high');
  assert.equal(boost[boost.indexOf('--model') + 1], 'fixture-high');
  assert.equal(legacy.includes('--effort'), false);
  assert.equal(legacy[legacy.indexOf('--conversation') + 1], 'fixture');
});

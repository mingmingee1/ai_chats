import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixtureConfig, ROOT } from './helpers.mjs';

test('setup phone opt-in preserves existing external and custom settings', { skip: process.platform === 'win32' && 'Interactive Windows firewall flow needs Windows', timeout: 15000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-setup-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const config = path.join(home, 'config.json');
  const initial = fixtureConfig(home, { userName: '테스트 방장', custom: { keep: true }, external: { enabled: false, port: 18399, host: '0.0.0.0', https: true } });
  fs.writeFileSync(config, JSON.stringify(initial));
  const child = spawn(process.execPath, [path.join(ROOT, 'setup.mjs')], {
    cwd: ROOT, env: { ...process.env, CHATROOM_CONFIG: config, META_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  // language; decline 3 installs; decline login; keep config; phone yes; skip test; don't start.
  child.stdin.end('1\nn\nn\nn\nn\nn\ny\nn\nn\n');
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, output);
  const result = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert.deepEqual(result.external, { ...initial.external, enabled: true });
  assert.deepEqual(result.custom, initial.custom);
  assert.deepEqual(result.bins, initial.bins);
  assert.equal(result.userName, initial.userName);
  assert.match(output, /폰에서도 접속할까/);
  assert.match(output, /인증서/);
});

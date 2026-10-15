import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (e) { last = e; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for readiness${last ? `: ${last.message}` : ''}`);
}
export function makeFakeMuse(home) {
  const bin = path.join(home, 'muse.mjs');
  fs.writeFileSync(bin, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
if (args.includes('--version')) { console.log('1.0.0-test'); process.exit(0); }
const promptFile = value('--prompt-file');
const prompt = fs.readFileSync(promptFile, 'utf8');
fs.appendFileSync(path.join(path.dirname(promptFile), 'calls.jsonl'), JSON.stringify({ args, prompt }) + '\\n');
if (args.includes('--fixture-fail')) process.exit(7);
if (args.includes('--fixture-slow')) await new Promise(resolve => setTimeout(resolve, 10000));
const action = args.includes('--fixture-action') ? JSON.parse(value('--fixture-action')) : {action:'say',messages:['안녕']};
console.log(JSON.stringify({type:'user_message',content:prompt}));
console.log(JSON.stringify({type:'item.completed',item:{role:'assistant',content:[{type:'output_text',text:JSON.stringify(action)}]}}));
`, { mode: 0o755 });
  return bin;
}
export function fixtureConfig(home, overrides = {}) {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  const missing = path.join(home, 'not-installed');
  return {
    ...example, language: 'ko', host: '127.0.0.1', speed: 'fast', boost: { mode: 'off' },
    dev: { enabled: false }, spark: { enabled: false }, usagePollSec: 3600, usagePollIdleSec: 3600,
    bins: { claude: missing, codex: missing, agy: missing, muse: makeFakeMuse(home) },
    ...overrides,
  };
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export async function startFixture(overrides = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-test-'));
  const port = await freePort();
  const cfg = fixtureConfig(home, { port, ...overrides });
  if (cfg.external?.enabled) cfg.external = { ...cfg.external, port: await freePort() };
  const config = path.join(home, 'config.json');
  fs.writeFileSync(config, JSON.stringify(cfg));
  let output = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, CHATROOM_HOME: home, CHATROOM_CONFIG: config, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const base = `http://127.0.0.1:${port}`;
  const request = async (route, body) => fetch(base + route, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const stop = async () => {
    if (child.exitCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
    fs.rmSync(home, { recursive: true, force: true });
  };
  try { await until(async () => (await request('/api/state')).ok, 10000); }
  catch (e) { await stop(); throw new Error(`${e.message}\n${output}`); }
  return { home, cfg, base, request, stop, output: () => output };
}

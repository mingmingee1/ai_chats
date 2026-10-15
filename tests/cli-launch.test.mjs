import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cliCommand, spawnCli } from '../lib/cli-launch.mjs';
import { resolveBins } from '../lib/agents.mjs';

function installation(t, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'room-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const add = (...parts) => {
    const file = path.join(home, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '@echo off\r\n');
    return file;
  };
  return { home, add, context: { platform: 'win32', home, env } };
}

test('Windows discovers Muse .cmd even when installer PATH is missing', (t) => {
  const { add, context } = installation(t);
  const muse = add('AppData', 'Local', 'Programs', 'muse', 'muse.cmd');
  assert.equal(resolveBins({}, context).muse, muse);
  const native = add('AppData', 'Local', 'Programs', 'muse', 'muse.exe');
  assert.equal(resolveBins({}, context).muse, native);
  assert.equal(resolveBins({ muse }, context).muse, muse);
});

test('Windows uses redirected local app data and quoted PATH entries', (t) => {
  const { add, home, context } = installation(t);
  const muse = add('Apps with spaces', 'Programs', 'muse', 'muse.cmd');
  context.env = { LOCALAPPDATA: path.join(home, 'Apps with spaces') };
  assert.equal(resolveBins({}, context).muse, muse);
  const portable = add('portable', 'muse.cmd');
  context.env = { Path: `"${path.dirname(portable)}"` };
  assert.equal(resolveBins({}, context).muse, portable);
});

test('Windows finds npm Codex launcher without changing user PATH', (t) => {
  const { add, context } = installation(t);
  const codex = add('AppData', 'Roaming', 'npm', 'codex.cmd');
  assert.equal(resolveBins({}, context).codex, codex);
  const native = add('AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
  assert.equal(resolveBins({}, context).codex, native);
});

test('Native executables and POSIX commands retain exact arguments without a shell', () => {
  const args = ['a b', '"quoted"', '%PATH%', 'a & b'];
  for (const [cmd, platform] of [['/tmp/muse', 'linux'], ['C:\\apps\\codex.exe', 'win32']]) {
    assert.deepEqual(cliCommand(cmd, args, { platform }), { cmd, args, options: {} });
  }
});

test('Windows batch launch escapes paths, quotes, trailing slashes and shell metacharacters', () => {
  const launch = cliCommand('C:\\My Apps\\muse.cmd', ['exec', 'a & b', '%PATH%', 'a"b', 'C:\\dir\\'], {
    platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  });
  assert.equal(launch.cmd, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(launch.args.slice(0, 4), ['/d', '/v:off', '/s', '/c']);
  assert.equal(launch.options.windowsVerbatimArguments, true);
  assert.match(launch.args[4], /My\^ Apps/);
  assert.ok(launch.args[4].includes('^&'));
  assert.ok(launch.args[4].includes('^%PATH^%'));
  assert.ok(launch.args[4].includes('a\\^"b'));
  assert.ok(launch.args[4].includes('C:\\dir\\\\^"'));
  const npm = cliCommand('C:\\app\\node_modules\\.bin\\tool.cmd', ['a&b'], { platform: 'win32', env: {} });
  assert.ok(npm.args[4].includes('a^^^&b'));
});

test('Windows batch execution preserves arguments, Unicode and stdin', {
  skip: process.platform !== 'win32' && 'Needs a real Windows cmd.exe',
}, async (t) => {
  const { add } = installation(t);
  const script = add('space & dir', 'echo.cjs');
  fs.writeFileSync(script, 'let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>console.log(JSON.stringify({args:process.argv.slice(2),input})));');
  const batch = add('space & dir', 'muse.cmd');
  fs.writeFileSync(batch, `@echo off\r\n"${process.execPath}" "%~dp0echo.cjs" %*\r\n`);
  const args = ['plain', 'with spaces', '한글', 'a&b', 'a|b', 'a"b', 'trailing\\', '%PATH%', '!name!'];
  const child = spawnCli(batch, args, { stdio: 'pipe' });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
    child.stdin.end('사진과 프롬프트\n');
  });
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { args, input: '사진과 프롬프트\n' });
});

test('CLI helper uses configured executable, forwards exit status and preserves settings', (t) => {
  const { home } = installation(t);
  const config = path.join(home, 'config.json');
  const missing = path.join(home, 'not-installed');
  const original = JSON.stringify({ bins: { claude: missing, codex: process.execPath, muse: missing, agy: missing } });
  fs.writeFileSync(config, original);
  const helper = fileURLToPath(new URL('../cli.mjs', import.meta.url));
  const options = { env: { ...process.env, CHATROOM_CONFIG: config }, encoding: 'utf8' };
  const version = spawnSync(process.execPath, [helper, 'codex', '--version'], options);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), process.version);
  const failure = spawnSync(process.execPath, [helper, 'codex', '-e', 'process.exit(7)'], options);
  assert.equal(failure.status, 7);
  const absent = spawnSync(process.execPath, [helper, 'muse', '--version'], options);
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /muse: CLI not found/);
  assert.equal(fs.readFileSync(config, 'utf8'), original);
});

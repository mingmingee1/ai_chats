#!/usr/bin/env node
// Run a member CLI using the same discovery and config.json bins as the room.
// This works even when a new installation is missing from the terminal's PATH.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBins } from './lib/agents.mjs';
import { spawnCli } from './lib/cli-launch.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const configFile = process.env.CHATROOM_CONFIG || path.join(root, 'config.json');

async function main() {
  const [name, ...args] = process.argv.slice(2);
  if (!['claude', 'codex', 'muse', 'agy'].includes(name)) {
    throw new Error('Usage: node cli.mjs <claude|codex|muse|agy> [arguments...]');
  }
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
  const bin = resolveBins(config.bins || {})[name];
  if (!bin || !fs.existsSync(bin)) {
    throw new Error(`${name}: CLI not found. Run setup.bat / setup.sh to install it, or set its full path in config.json "bins".`);
  }
  const onInterrupt = () => {}; // the attached terminal also delivers Ctrl+C to the CLI
  process.on('SIGINT', onInterrupt);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      const child = spawnCli(bin, args, { cwd: root, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 1));
    });
  } finally {
    process.off('SIGINT', onInterrupt);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });

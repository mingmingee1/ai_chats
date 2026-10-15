// Windows .cmd launchers need cmd.exe; native executables never go through a shell.
// Escaping adapted from cross-spawn 7.0.6 (MIT), lib/util/escape.js and lib/parse.js.
// See licenses/cross-spawn.txt. No runtime package dependency is required.
import { spawn } from 'node:child_process';
import path from 'node:path';

const META = /([()\][%!^"`<>&|;, *?])/g;

function escapeArgument(value, twice) {
  let arg = String(value)
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, '$1$1');
  arg = `"${arg}"`.replace(META, '^$1');
  return twice ? arg.replace(META, '^$1') : arg;
}

export function cliCommand(cmd, args, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(cmd)) return { cmd, args, options: {} };
  // npm's node_modules/.bin wrappers parse the arguments an additional time.
  const twice = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(cmd);
  const command = path.win32.normalize(cmd).replace(META, '^$1');
  const line = [command, ...args.map((arg) => escapeArgument(arg, twice))].join(' ');
  return {
    cmd: env.ComSpec || env.COMSPEC || env.comspec || 'cmd.exe',
    args: ['/d', '/v:off', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}

export function spawnCli(cmd, args, options = {}) {
  const launch = cliCommand(cmd, args, { env: options.env || process.env });
  return spawn(launch.cmd, launch.args, { ...options, ...launch.options });
}

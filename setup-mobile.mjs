import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { mobileOrigin } from './lib/mobile-access.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export function connectionFor(status) {
  if (status.BackendState !== 'Running') throw new Error('PC의 Tailscale을 먼저 연결해 주세요.');
  const host = status.Self?.DNSName?.replace(/\.$/, '');
  if (!host) throw new Error('Tailscale 기기 이름이 없습니다. MagicDNS 설정을 확인해 주세요.');
  return mobileOrigin(`https://${host}`);
}

export function checkServeConfig(config, origin, target) {
  // Older Tailscale versions print JSON null when Serve has never been configured.
  config ??= {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Tailscale Serve 설정을 읽을 수 없습니다.');
  const host = new URL(origin).host + ':443';
  if (config.AllowFunnel?.[host]) throw new Error('이 주소에 Tailscale Funnel이 켜져 있습니다. 비공개 Serve 주소를 사용하려면 먼저 Funnel 설정을 확인해 주세요.');
  const web = config.Web?.[host];
  const handler = web?.Handlers?.['/'];
  if ((handler && (handler.Proxy !== target || handler.Path || handler.Text))
    || (config.TCP?.['443'] && !config.TCP['443'].HTTPS)
    || Object.keys(config.Web || {}).some((key) => key.endsWith(':443') && key !== host)) {
    throw new Error('Tailscale 443 포트에 다른 서비스가 있습니다. 기존 서비스를 덮어쓰지 않았습니다.');
  }
}

export async function main() {
  const candidates = process.platform === 'win32' ? [
    path.win32.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
    path.win32.join(process.env.LOCALAPPDATA || '', 'Tailscale', 'tailscale.exe'),
  ] : ['/usr/bin/tailscale', '/usr/local/bin/tailscale'];
  const bin = candidates.find((p) => fs.existsSync(p)) || 'tailscale';
  const json = (args) => JSON.parse(execFileSync(bin, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 }));
  const origin = connectionFor(json(['status', '--json']));
  const configFile = process.env.CHATROOM_CONFIG ? path.resolve(process.env.CHATROOM_CONFIG) : path.join(ROOT, 'config.json');
  // Fail rather than replace a malformed configuration with defaults.
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
  const port = config.mobile?.port ?? 18322;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('config.json의 mobile.port가 올바르지 않습니다.');
  const target = `http://127.0.0.1:${port}`;
  checkServeConfig(json(['serve', 'status', '--json']), origin, target);
  console.log('\n휴대폰 앱용 HTTPS 주소를 설정합니다.');
  console.log('Tailscale이 설정 링크를 표시하면 그 링크에서 HTTPS/Serve를 활성화해 주세요.');
  console.log('같은 Tailscale 네트워크 안에서만 접속하며, 인터넷 공개(Funnel)는 사용하지 않습니다.\n');
  await new Promise((resolve, reject) => {
    const child = spawn(bin, ['serve', '--bg', '--https=443', target], { stdio: 'inherit', windowsHide: false });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Tailscale Serve 설정 실패 (${code})`)));
  });
  const served = json(['serve', 'status', '--json']);
  checkServeConfig(served, origin, target);
  if (served?.Web?.[new URL(origin).host + ':443']?.Handlers?.['/']?.Proxy !== target)
    throw new Error('Tailscale 연결 설정을 확인하지 못했습니다. config.json은 변경하지 않았습니다.');
  const home = process.env.CHATROOM_HOME ? path.resolve(process.env.CHATROOM_HOME) : ROOT;
  const data = path.join(home, 'data'); fs.mkdirSync(data, { recursive: true });
  if (fs.existsSync(configFile)) fs.copyFileSync(configFile, path.join(data, `config-before-mobile-${Date.now()}.json`));
  config.mobile = { ...config.mobile, enabled: true, port, origin };
  const temp = `${configFile}.mobile-${process.pid}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, configFile); }
  finally { fs.rmSync(temp, { force: true }); }
  const connection = { format: 'ai-chats-mobile', version: 1, url: origin };
  fs.writeFileSync(path.join(data, 'mobile-connection.json'), JSON.stringify(connection, null, 2) + '\n');
  console.log(`\n설정 완료! start.bat으로 실행 중인 서버를 종료한 뒤 다시 켜 주세요.\n\n앱에 입력할 주소: ${origin}\n`);
  console.log('또는 data/mobile-connection.json을 휴대폰으로 옮겨 앱에서 연결 파일을 열면 됩니다.');
  console.log('연결 파일에는 주소만 들어 있으며 비밀번호나 대화는 들어 있지 않습니다.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`\n모바일 연결 설정을 완료하지 못했습니다: ${e.message}`); process.exitCode = 1; });
}

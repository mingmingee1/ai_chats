import http from 'node:http';

export function mobileOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net$/i.test(url.hostname)
    || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('모바일 주소는 Tailscale의 https://기기.네트워크.ts.net 형식이어야 합니다.');
  }
  return url.origin;
}

// Tailscale terminates publicly trusted TLS and forwards only over local loopback.
// The caller supplies the SAME password gate and dev-API restrictions as external HTTPS.
export function startMobileListener(config, handler) {
  const origin = mobileOrigin(config.origin);
  const host = new URL(origin).host;
  const port = config.port ?? 18322;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('잘못된 모바일 연결 포트입니다.');
  const server = http.createServer((req, res) => {
    if (req.headers.host?.toLowerCase() !== host.toLowerCase()) {
      res.writeHead(421); res.end('Unexpected host'); return;
    }
    // Never infer security from a client-controlled forwarding header.
    handler(req, res);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { ExternalGate, createWindowsCertificate } from '../lib/external.mjs';

const windows = process.platform === 'win32';
function temporary(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'room-cert-'));
  fs.mkdirSync(path.join(home, 'data'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

// Supply a genuine PKCS#12 bundle to exercise the Windows loading path on Linux.
// Only fixture generation uses OpenSSL; the production Windows path never does.
function fixture(t) {
  const home = temporary(t);
  const key = path.join(home, 'key.pem');
  const cert = path.join(home, 'cert.pem');
  const pfx = path.join(home, 'cert.pfx');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
    '-keyout', key, '-out', cert, '-subj', '/CN=ai-chatroom',
    '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
    '-addext', 'extendedKeyUsage=serverAuth'], { stdio: 'ignore' });
  // Windows .NET Framework commonly exports PKCS#12 using these algorithms.
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', key, '-in', cert, '-out', pfx,
    '-passout', 'pass:', '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'SHA1'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert), pfx: fs.readFileSync(pfx) };
}

async function checkLogin(t, gate, credentials, cert) {
  const server = https.createServer(credentials, async (req, res) => {
    if (await gate.handle(req, res, new URL(req.url, 'https://ai-chatroom').pathname, { secure: true })) return;
    res.end('authenticated');
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = (route, { method = 'GET', body = '', cookie = '' } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port: server.address().port, servername: 'ai-chatroom', ca: cert,
      path: route, method, headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => {
      let text = '';
      res.on('data', (data) => { text += data; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const anonymous = await request('/');
  assert.equal(anonymous.status, 303);
  assert.equal(anonymous.headers.location, '/login');
  assert.equal((await request('/login')).status, 200);
  const password = fs.readFileSync(gate.pwFile, 'utf8').trim();
  const login = await request('/login', { method: 'POST', body: new URLSearchParams({ password }).toString() });
  assert.equal(login.status, 303);
  assert.match(login.headers['set-cookie'][0], /Secure/);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request('/', { cookie })).text, 'authenticated');
}

test('Windows certificate path uses encoded PowerShell and preserves HTTPS password login', { skip: windows, timeout: 15000 }, async (t) => {
  const supplied = fixture(t);
  const home = temporary(t);
  const gate = new ExternalGate(home);
  const auth = fs.readFileSync(gate.authFile);
  const calls = [];
  const execute = (command, args, options) => {
    calls.push(command);
    assert.match(command, /WindowsPowerShell\\v1\.0\\powershell\.exe$/);
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    const script = Buffer.from(args[3], 'base64').toString('utf16le');
    assert.match(script, /CertificateRequest/);
    assert.match(script, /RSACng\]::new\(2048\)/);
    assert.doesNotMatch(script, /\.KeySize\s*=/);
    assert.doesNotMatch(script, /ExecutionPolicy|New-SelfSignedCertificate|Cert:\\/);
    assert.equal(script.includes(home), false);
    fs.writeFileSync(options.env.CHATROOM_CERT_PFX, supplied.pfx);
    fs.writeFileSync(options.env.CHATROOM_CERT_PEM, supplied.cert);
  };
  const credentials = gate.tls({ platform: 'win32', createWindows: (dir) => createWindowsCertificate(dir, { execute }) });
  assert.equal(calls.length, 1);
  assert.deepEqual(credentials.pfx, supplied.pfx);
  assert.deepEqual(fs.readFileSync(gate.authFile), auth);
  await checkLogin(t, gate, credentials, supplied.cert);
  const restored = new ExternalGate(home);
  assert.deepEqual(restored.tls({ platform: 'win32', createWindows: () => assert.fail('must reuse certificate') }), credentials);
  assert.deepEqual(fs.readFileSync(restored.authFile), auth);
  assert.deepEqual(fs.readdirSync(path.join(home, 'data/tls')).sort(), ['windows-cert.pem', 'windows-cert.pfx']);
});

test('Existing PEM certificates take precedence and survive Windows updates unchanged', { skip: windows }, (t) => {
  const supplied = fixture(t);
  const home = temporary(t);
  const dir = path.join(home, 'data/tls');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'key.pem'), supplied.key);
  fs.writeFileSync(path.join(dir, 'cert.pem'), supplied.cert);
  const gate = new ExternalGate(home);
  assert.deepEqual(gate.tls({ platform: 'win32', createWindows: () => assert.fail('must not regenerate') }), {
    key: supplied.key, cert: supplied.cert,
  });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['cert.pem', 'key.pem']);
});

test('Failed or malformed certificate creation cleans temporary files without replacing existing data', (t) => {
  const home = temporary(t);
  const dir = path.join(home, 'data/tls');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'preserve');
  for (const execute of [
    () => { throw new Error('fixture PowerShell failure'); },
    (_command, _args, { env }) => {
      fs.writeFileSync(env.CHATROOM_CERT_PFX, 'invalid pfx');
      fs.writeFileSync(env.CHATROOM_CERT_PEM, 'invalid cert');
    },
  ]) {
    assert.throws(() => createWindowsCertificate(dir, { execute }), /Windows HTTPS certificate creation failed/);
    assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
    assert.equal(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'preserve');
  }
});

test('Native Windows creates a certificate and serves verified HTTPS without OpenSSL', {
  skip: !windows && 'Requires Windows PowerShell and .NET', timeout: 65000,
}, async (t) => {
  const home = temporary(t);
  const gate = new ExternalGate(home);
  const credentials = gate.tls();
  assert.ok(credentials.pfx);
  const cert = fs.readFileSync(path.join(home, 'data/tls/windows-cert.pem'));
  assert.equal(new X509Certificate(cert).publicKey.asymmetricKeyDetails.modulusLength, 2048);
  await checkLogin(t, gate, credentials, cert);
});

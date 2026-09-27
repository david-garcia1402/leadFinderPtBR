import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createApp} from './lib/app.mjs';
import {createStore} from './lib/store.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const arg = name => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const port = Number(arg('--port') || process.env.PORT || 4173);
const host = arg('--host') || process.env.HOST || '127.0.0.1';
const dataDir = process.env.DATA_DIR || root + '.data';
const store = await createStore(dataDir.replace(/\/?$/, '/') + 'accounts.json');
const ips = new WeakMap();

const app = await createApp({
  env: process.env,
  store,
  getIp: request => ips.get(request) || '',
  loadAsset: async assetPath => {
    try {
      return await readFile(root + 'public' + assetPath);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
});

async function toRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
    else headers.set(key, value);
  }
  const init = {method: req.method, headers};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    init.body = Buffer.concat(chunks);
  }
  const request = new Request(url, init);
  ips.set(request, req.socket.remoteAddress || '');
  return request;
}

async function write(res, response) {
  const headers = {};
  for (const [key, value] of response.headers) {
    if (key === 'set-cookie') continue;
    headers[key] = value;
  }
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (cookies.length) headers['set-cookie'] = cookies.length === 1 ? cookies[0] : cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  try {
    const request = await toRequest(req);
    await write(res, await app.handle(request));
  } catch {
    res.writeHead(400, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify({error: 'Não foi possível concluir a solicitação.'}));
  }
});

server.listen(port, host, () => {
  const billingState = app.billing.publicConfig();
  console.log(`cub4Studio Lead Finder running at http://${host}:${port} | ${app.live ? 'live configured' : 'live unavailable'} | billing ${billingState.provider} ${billingState.configured ? 'ready' : 'pending credentials'}`);
});

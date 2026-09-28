import http from 'node:http';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {seoLinks,robots,sitemap,publicOrigin} from './lib/seo.mjs';
import {validateSearch,demoLeads} from './lib/leads.mjs';
import {beginSearch,checkSearch} from './lib/outscraper.mjs';
import {createStore} from './lib/store.mjs';
import {createAuth,parseCookies,publicUser,sessionCookie} from './lib/auth.mjs';
import {listPlans} from './lib/plans.mjs';
import {createBilling} from './lib/billing.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const arg = name => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const port = Number(arg('--port') || process.env.PORT || 4173);
const host = arg('--host') || process.env.HOST || '127.0.0.1';
const preview = process.env.ENABLE_SAMPLE_DATA === 'true';
const live = process.env.ENABLE_LIVE_SEARCH === 'true' && !!process.env.OUTSCRAPER_API_KEY;
const dataDir = process.env.DATA_DIR || root + '.data';
const store = await createStore(dataDir.replace(/\/?$/, '/') + 'accounts.json');
const auth = createAuth(store);
const billing = createBilling(store, process.env);
const jobs = new Map();
const cache = new Map();
let busy = false;
let lastLive = 0;
const authHits = new Map();

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
};

const cookieSecure = () => String(process.env.APP_ORIGIN || '').startsWith('https://');

function send(res, status, data, extra = {}) {
  res.writeHead(status, {...headers, ...extra});
  res.end(JSON.stringify(data));
}

function sendError(res, error, fallback = 400) {
  send(res, error.status || fallback, {error: error.message || 'Não foi possível concluir a solicitação.'});
}

async function readBody(req, limit = 8192) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw Object.assign(new Error('Request too large.'), {status:413});
  }
  return text;
}

async function body(req, limit = 8192) {
  const text = await readBody(req, limit);
  if (!text) return {};
  return JSON.parse(text);
}

async function sessionUser(req, user) {
  if (!user) return null;
  await billing.claimForEmail(user.email);
  return publicUser(user, billing.statusFor(user.id));
}

function clientIp(req) {
  return req.socket.remoteAddress || '';
}

function limited(ip, key, max, windowMs) {
  const now = Date.now();
  const bucket = `${ip}:${key}`;
  const prev = (authHits.get(bucket) || []).filter(time => now - time < windowMs);
  if (prev.length >= max) return true;
  prev.push(now);
  authHits.set(bucket, prev);
  return false;
}

function requestUser(req) {
  const token = parseCookies(req.headers.cookie).lf_session;
  const found = auth.readSession(token);
  return found ? found.user : null;
}

function sessionExtra(token, clear = false) {
  return {'Set-Cookie': sessionCookie(token || '', {secure: cookieSecure(), clear})};
}

function isWebhook(url) {
  return url.pathname === '/api/billing/webhook' || url.pathname.startsWith('/api/billing/webhook/');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && !isWebhook(url)) {
      if (req.headers.origin && req.headers.origin !== (process.env.APP_ORIGIN || `http://${req.headers.host}`)) {
        return send(res, 403, {error: 'Cross-origin requests are not allowed.'});
      }
      if (req.headers['x-cub4-client'] !== 'lead-finder') return send(res, 403, {error: 'Invalid client.'});
    }

    if (url.pathname === '/robots.txt' && req.method === 'GET') {
      res.writeHead(200, {...headers, 'Content-Type': 'text/plain; charset=utf-8'});
      return res.end(robots());
    }
    if (url.pathname === '/sitemap.xml' && req.method === 'GET') {
      const xml = sitemap();
      res.writeHead(xml ? 200 : 503, {...headers, 'Content-Type': 'application/xml; charset=utf-8'});
      return res.end(xml || '<?xml version="1.0" encoding="UTF-8"?><error>PUBLIC_SITE_URL is not configured</error>');
    }

    if (url.pathname === '/api/config') {
      return send(res, 200, {live, preview, auth: true, billing: billing.publicConfig()});
    }

    if (url.pathname === '/api/plans' && req.method === 'GET') {
      return send(res, 200, {plans: listPlans(), billing: billing.publicConfig()});
    }

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      if (limited(clientIp(req), 'register', 8, 15 * 60 * 1000)) return send(res, 429, {error: 'Muitas tentativas. Aguarde alguns minutos.'});
      const payload = await body(req);
      const user = await auth.register(payload);
      const session = await auth.login({email: user.email, password: payload.password});
      return send(res, 201, {user: await sessionUser(req, session.user)}, sessionExtra(session.token));
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (limited(clientIp(req), 'login', 12, 15 * 60 * 1000)) return send(res, 429, {error: 'Muitas tentativas. Aguarde alguns minutos.'});
      const payload = await body(req);
      const session = await auth.login(payload);
      return send(res, 200, {user: await sessionUser(req, session.user)}, sessionExtra(session.token));
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      await auth.logout(parseCookies(req.headers.cookie).lf_session);
      return send(res, 200, {ok: true}, sessionExtra('', true));
    }

    if (url.pathname === '/api/me' && req.method === 'GET') {
      const user = requestUser(req);
      if (!user) return send(res, 401, {error: 'Entre na sua conta para continuar.', user: null});
      return send(res, 200, {user: await sessionUser(req, user)});
    }

    if (url.pathname === '/api/billing/checkout' && req.method === 'POST') {
      const user = requestUser(req);
      if (!user) return send(res, 401, {error: 'Entre na sua conta para assinar um plano.'});
      if (limited(clientIp(req), 'checkout', 6, 60 * 1000)) return send(res, 429, {error: 'Aguarde antes de iniciar outro checkout.'});
      const payload = await body(req);
      const checkout = await billing.startCheckout(user, payload.planId);
      return send(res, 200, checkout);
    }

    if (isWebhook(url) && req.method === 'POST') {
      const raw = await readBody(req, 65536);
      const payload = raw ? JSON.parse(raw) : {};
      const query = Object.fromEntries(url.searchParams.entries());
      const hint = url.pathname.split('/').pop();
      const result = await billing.handleWebhook({
        headers: req.headers,
        query,
        body: payload,
        raw,
        hint: hint === 'webhook' ? undefined : hint
      });
      return send(res, 200, result);
    }

    if (url.pathname === '/api/search' && req.method === 'POST') {
      const payload = await body(req);
      const search = validateSearch(payload);
      if (payload.mode === 'demo') {
        if (!preview) return send(res, 503, {error: 'Dados ilustrativos desativados. Configure a busca real ou ative os exemplos explicitamente.'});
        return send(res, 200, {leads: demoLeads(search.niche, search.location, search.limit), demo: true});
      }
      if (payload.mode !== 'live') return send(res, 400, {error: 'Selecione uma fonte de busca válida.'});
      if (!live) return send(res, 503, {error: 'Busca real ainda indisponível. Entre em contato com a cub4Studio.'});
      const user = requestUser(req);
      if (!user) return send(res, 401, {error: 'Entre na sua conta para usar a busca real.'});
      const quota = await billing.reserve(user.id, search.limit);
      const cacheKey = user.id + ':' + JSON.stringify(search).toLowerCase();
      if (cache.has(cacheKey)) return send(res, 200, {...cache.get(cacheKey), cached: true, quota});
      if (busy || Date.now() - lastLive < 10000) return send(res, 429, {error: 'Aguarde antes de iniciar outra busca.'});
      busy = true;
      lastLive = Date.now();
      try {
        const result = await beginSearch(search, process.env.OUTSCRAPER_API_KEY);
        if (result.pending) {
          const jobId = randomUUID();
          jobs.set(jobId, {providerId: result.providerId, key: cacheKey, userId: user.id, last: 0});
          return send(res, 202, {pending: true, jobId, quota});
        }
        cache.set(cacheKey, result);
        return send(res, 200, {...result, quota});
      } finally {
        busy = false;
      }
    }

    if (url.pathname.startsWith('/api/jobs/') && req.method === 'GET') {
      const user = requestUser(req);
      if (!user) return send(res, 401, {error: 'Entre na sua conta para acompanhar a busca.'});
      const jobId = url.pathname.split('/').pop();
      const job = jobs.get(jobId);
      if (!job || job.userId !== user.id) return send(res, 404, {error: 'Sessão de busca expirada. Confira o painel do provedor antes de repetir.'});
      if (Date.now() - job.last < 5000) return send(res, 202, {pending: true});
      job.last = Date.now();
      const result = await checkSearch(job.providerId, process.env.OUTSCRAPER_API_KEY);
      if (!result.pending) {
        cache.set(job.key, result);
        jobs.delete(jobId);
      }
      return send(res, result.pending ? 202 : 200, result);
    }

    const routes = {
      '/app': 'public/workspace.html',
      '/entrar': 'public/auth.html',
      '/conta': 'public/account.html',
      '/landing.css': 'public/landing.css',
      '/landing.js': 'public/landing.js',
      '/auth.js': 'public/auth.js',
      '/account.js': 'public/account.js',
      '/logo.svg': 'public/logo.svg',
      '/': 'public/index.html',
      '/app.js': 'public/app.js',
      '/style.css': 'public/style.css',
      '/leads.mjs': 'lib/leads.mjs',
      '/fonts/plus-jakarta-sans-latin-wght-normal.woff2': 'public/fonts/plus-jakarta-sans-latin-wght-normal.woff2',
      '/fonts/plus-jakarta-sans-latin-wght-italic.woff2': 'public/fonts/plus-jakarta-sans-latin-wght-italic.woff2'
    };
    if (req.method !== 'GET' || !routes[url.pathname]) return send(res, 404, {error: 'Not found'});
    let data = await readFile(root + routes[url.pathname]);
    if (url.pathname === '/') data = Buffer.from(data.toString().replace('<!-- SEO_LINKS -->', seoLinks()));
    const ext = url.pathname.split('.').pop();
    const pageHeaders = {...headers};
    const structured = url.pathname === '/' && data.toString().match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (structured) {
      const hash = createHash('sha256').update(structured[1]).digest('base64');
      pageHeaders['Content-Security-Policy'] = headers['Content-Security-Policy'].replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`);
    }
    const privatePage = url.pathname === '/app' || url.pathname === '/entrar' || url.pathname === '/conta';
    if (privatePage || (url.pathname === '/' && !publicOrigin(process.env.PUBLIC_SITE_URL))) pageHeaders['X-Robots-Tag'] = 'noindex, nofollow';
    res.writeHead(200, {
      ...pageHeaders,
      'Content-Type': ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : ext === 'css' ? 'text/css' : ext === 'woff2' ? 'font/woff2' : ext === 'js' || ext === 'mjs' ? 'text/javascript' : 'text/html; charset=utf-8'
    });
    res.end(data);
  } catch (e) {
    sendError(res, e, e.name === 'TimeoutError' ? 400 : (e.status || 400));
  }
});

server.listen(port, host, () => {
  const billingState = billing.publicConfig();
  console.log(`cub4Studio Lead Finder running at http://${host}:${port} | ${live ? 'live configured' : 'live unavailable'} | billing ${billingState.provider} ${billingState.configured ? 'ready' : 'pending credentials'}`);
});

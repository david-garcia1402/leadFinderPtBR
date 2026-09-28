import {createHash, randomUUID} from 'node:crypto';
import {seoLinks, robots, sitemap, publicOrigin} from './seo.mjs';
import {validateSearch, demoLeads} from './leads.mjs';
import {beginSearch, checkSearch} from './outscraper.mjs';
import {createAuth, parseCookies, publicUser, sessionCookie} from './auth.mjs';
import {listPlans} from './plans.mjs';
import {createBilling} from './billing.mjs';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
};

const pages = {
  '/app': '/workspace.html',
  '/entrar': '/auth.html',
  '/conta': '/account.html',
  '/landing.css': '/landing.css',
  '/landing.js': '/landing.js',
  '/auth.js': '/auth.js',
  '/account.js': '/account.js',
  '/logo.svg': '/logo.svg',
  '/': '/index.html',
  '/app.js': '/app.js',
  '/style.css': '/style.css',
  '/leads.mjs': '/leads.mjs',
  '/fonts/plus-jakarta-sans-latin-wght-normal.woff2': '/fonts/plus-jakarta-sans-latin-wght-normal.woff2',
  '/fonts/plus-jakarta-sans-latin-wght-italic.woff2': '/fonts/plus-jakarta-sans-latin-wght-italic.woff2'
};

function contentType(pathname) {
  const ext = pathname.split('.').pop();
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'png') return 'image/png';
  if (ext === 'css') return 'text/css';
  if (ext === 'woff2') return 'font/woff2';
  if (ext === 'js' || ext === 'mjs') return 'text/javascript';
  return 'text/html; charset=utf-8';
}

function headerObject(headers) {
  const out = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export async function createApp({env, store, loadAsset, getIp = () => ''}) {
  const preview = env.ENABLE_SAMPLE_DATA === 'true';
  const live = env.ENABLE_LIVE_SEARCH === 'true' && !!env.OUTSCRAPER_API_KEY;
  const auth = createAuth(store);
  const billing = createBilling(store, env);
  const jobs = new Map();
  const cache = new Map();
  const authHits = new Map();
  let busy = false;
  let lastLive = 0;

  const cookieSecure = request => {
    if (env.APP_ORIGIN) return String(env.APP_ORIGIN).startsWith('https://');
    return new URL(request.url).protocol === 'https:';
  };

  function json(status, data, extra = {}) {
    const headers = new Headers({...jsonHeaders, ...extra});
    return new Response(JSON.stringify(data), {status, headers});
  }

  function fail(error, fallback = 400) {
    const status = error.name === 'TimeoutError' ? 400 : (error.status || fallback);
    return json(status, {error: error.message || 'Não foi possível concluir a solicitação.'});
  }

  async function readBody(request, limit = 8192) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > limit) throw Object.assign(new Error('Request too large.'), {status: 413});
    return new TextDecoder().decode(bytes);
  }

  async function body(request, limit = 8192) {
    const text = await readBody(request, limit);
    if (!text) return {};
    return JSON.parse(text);
  }

  async function sessionUser(user) {
    if (!user) return null;
    await billing.claimForEmail(user.email);
    return publicUser(user, billing.statusFor(user.id));
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

  function requestUser(request) {
    const token = parseCookies(request.headers.get('cookie')).lf_session;
    const found = auth.readSession(token);
    return found ? found.user : null;
  }

  function sessionExtra(request, token, clear = false) {
    return {'Set-Cookie': sessionCookie(token || '', {secure: cookieSecure(request), clear})};
  }

  function isWebhook(url) {
    return url.pathname === '/api/billing/webhook' || url.pathname.startsWith('/api/billing/webhook/');
  }

  async function handle(request) {
    try {
      const url = new URL(request.url);
      if (request.method === 'POST' && !isWebhook(url)) {
        const origin = request.headers.get('origin');
        const expected = env.APP_ORIGIN || url.origin;
        if (origin && origin !== expected) return json(403, {error: 'Cross-origin requests are not allowed.'});
        if (request.headers.get('x-cub4-client') !== 'lead-finder') return json(403, {error: 'Invalid client.'});
      }

      if (url.pathname === '/robots.txt' && request.method === 'GET') {
        return new Response(robots(env), {status: 200, headers: {...jsonHeaders, 'Content-Type': 'text/plain; charset=utf-8'}});
      }
      if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
        const xml = sitemap(env);
        return new Response(xml || '<?xml version="1.0" encoding="UTF-8"?><error>PUBLIC_SITE_URL is not configured</error>', {
          status: xml ? 200 : 503,
          headers: {...jsonHeaders, 'Content-Type': 'application/xml; charset=utf-8'}
        });
      }

      if (url.pathname === '/api/config' && request.method === 'GET') {
        return json(200, {live, preview, auth: true, billing: billing.publicConfig()});
      }
      if (url.pathname === '/api/plans' && request.method === 'GET') {
        return json(200, {plans: listPlans(), billing: billing.publicConfig()});
      }
      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        if (limited(getIp(request), 'register', 8, 15 * 60 * 1000)) return json(429, {error: 'Muitas tentativas. Aguarde alguns minutos.'});
        const payload = await body(request);
        const user = await auth.register(payload);
        const session = await auth.login({email: user.email, password: payload.password});
        return json(201, {user: await sessionUser(session.user)}, sessionExtra(request, session.token));
      }
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        if (limited(getIp(request), 'login', 12, 15 * 60 * 1000)) return json(429, {error: 'Muitas tentativas. Aguarde alguns minutos.'});
        const payload = await body(request);
        const session = await auth.login(payload);
        return json(200, {user: await sessionUser(session.user)}, sessionExtra(request, session.token));
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        await auth.logout(parseCookies(request.headers.get('cookie')).lf_session);
        return json(200, {ok: true}, sessionExtra(request, '', true));
      }
      if (url.pathname === '/api/me' && request.method === 'GET') {
        const user = requestUser(request);
        if (!user) return json(401, {error: 'Entre na sua conta para continuar.', user: null});
        return json(200, {user: await sessionUser(user)});
      }
      if (url.pathname === '/api/billing/checkout' && request.method === 'POST') {
        const user = requestUser(request);
        if (!user) return json(401, {error: 'Entre na sua conta para assinar um plano.'});
        if (limited(getIp(request), 'checkout', 6, 60 * 1000)) return json(429, {error: 'Aguarde antes de iniciar outro checkout.'});
        const payload = await body(request);
        const checkout = await billing.startCheckout(user, payload.planId);
        return json(200, checkout);
      }
      if (isWebhook(url) && request.method === 'POST') {
        const raw = await readBody(request, 65536);
        const payload = raw ? JSON.parse(raw) : {};
        const query = Object.fromEntries(url.searchParams.entries());
        const hint = url.pathname.split('/').pop();
        const result = await billing.handleWebhook({
          headers: headerObject(request.headers),
          query,
          body: payload,
          raw,
          hint: hint === 'webhook' ? undefined : hint
        });
        return json(200, result);
      }
      if (url.pathname === '/api/search' && request.method === 'POST') {
        const payload = await body(request);
        const search = validateSearch(payload);
        if (payload.mode === 'demo') {
          if (!preview) return json(503, {error: 'Dados ilustrativos desativados. Configure a busca real ou ative os exemplos explicitamente.'});
          return json(200, {leads: demoLeads(search.niche, search.location, search.limit), demo: true});
        }
        if (payload.mode !== 'live') return json(400, {error: 'Selecione uma fonte de busca válida.'});
        if (!live) return json(503, {error: 'Busca real ainda indisponível. Entre em contato com a cub4Studio.'});
        const user = requestUser(request);
        if (!user) return json(401, {error: 'Entre na sua conta para usar a busca real.'});
        const quota = await billing.reserve(user.id, search.limit);
        const cacheKey = user.id + ':' + JSON.stringify(search).toLowerCase();
        if (cache.has(cacheKey)) return json(200, {...cache.get(cacheKey), cached: true, quota});
        if (busy || Date.now() - lastLive < 10000) return json(429, {error: 'Aguarde antes de iniciar outra busca.'});
        busy = true;
        lastLive = Date.now();
        try {
          const result = await beginSearch(search, env.OUTSCRAPER_API_KEY);
          if (result.pending) {
            const jobId = randomUUID();
            jobs.set(jobId, {providerId: result.providerId, key: cacheKey, userId: user.id, last: 0});
            return json(202, {pending: true, jobId, quota});
          }
          cache.set(cacheKey, result);
          return json(200, {...result, quota});
        } finally {
          busy = false;
        }
      }
      if (url.pathname.startsWith('/api/jobs/') && request.method === 'GET') {
        const user = requestUser(request);
        if (!user) return json(401, {error: 'Entre na sua conta para acompanhar a busca.'});
        const jobId = url.pathname.split('/').pop();
        const job = jobs.get(jobId);
        if (!job || job.userId !== user.id) return json(404, {error: 'Sessão de busca expirada. Confira o painel do provedor antes de repetir.'});
        if (Date.now() - job.last < 5000) return json(202, {pending: true});
        job.last = Date.now();
        const result = await checkSearch(job.providerId, env.OUTSCRAPER_API_KEY);
        if (!result.pending) {
          cache.set(job.key, result);
          jobs.delete(jobId);
        }
        return json(result.pending ? 202 : 200, result);
      }

      if (request.method !== 'GET' || !pages[url.pathname]) return json(404, {error: 'Not found'});
      const bytes = await loadAsset(pages[url.pathname]);
      if (!bytes) return json(404, {error: 'Not found'});
      let data = Buffer.from(bytes);
      if (url.pathname === '/') data = Buffer.from(data.toString().replace('<!-- SEO_LINKS -->', seoLinks(env)));
      const pageHeaders = {...jsonHeaders};
      const structured = url.pathname === '/' && data.toString().match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (structured) {
        const hash = createHash('sha256').update(structured[1]).digest('base64');
        pageHeaders['Content-Security-Policy'] = jsonHeaders['Content-Security-Policy'].replace("script-src 'self'", `script-src 'self' 'sha256-${hash}'`);
      }
      const privatePage = url.pathname === '/app' || url.pathname === '/entrar' || url.pathname === '/conta';
      if (privatePage || (url.pathname === '/' && !publicOrigin(env.PUBLIC_SITE_URL))) pageHeaders['X-Robots-Tag'] = 'noindex, nofollow';
      pageHeaders['Content-Type'] = contentType(url.pathname);
      return new Response(data, {status: 200, headers: pageHeaders});
    } catch (error) {
      return fail(error);
    }
  }

  return {handle, billing, live, preview};
}

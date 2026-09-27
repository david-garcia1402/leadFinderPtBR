import {createHmac,timingSafeEqual} from 'node:crypto';
import {getPlan} from './plans.mjs';

const API = 'https://api.mercadopago.com';

export function billingConfigured(env = process.env) {
  return Boolean(String(env.MP_ACCESS_TOKEN || '').trim());
}

export function webhookSecret(env = process.env) {
  return String(env.MP_WEBHOOK_SECRET || '').trim();
}

export function parseSignatureHeader(header) {
  const out = {};
  for (const part of String(header || '').split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

export function webhookManifest({dataId, requestId, ts}) {
  let manifest = '';
  if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  if (ts) manifest += `ts:${ts};`;
  return manifest;
}

export function verifyWebhookSignature({signature, requestId, dataId, secret}) {
  const key = String(secret || '').trim();
  if (!key) return false;
  const parsed = parseSignatureHeader(signature);
  if (!parsed.ts || !parsed.v1 || !/^[0-9a-f]+$/i.test(parsed.v1)) return false;
  const manifest = webhookManifest({dataId, requestId, ts: parsed.ts});
  const expected = createHmac('sha256', key).update(manifest).digest('hex');
  const actual = parsed.v1.toLowerCase();
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

export function parseWebhookPayload(body = {}, query = {}) {
  const type = String(body.type || body.topic || query.type || query.topic || '').trim();
  const dataId = String(body.data?.id || query['data.id'] || query.id || '').trim();
  return {type, dataId, liveMode: body.live_mode === true, action: String(body.action || '')};
}

async function mpRequest(path, {token, method = 'GET', body, idempotencyKey} = {}) {
  if (!token) throw new Error('Checkout Mercado Pago ainda não configurado.');
  const headers = {Authorization:`Bearer ${token}`, Accept:'application/json'};
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.message || data.error || `Mercado Pago retornou ${res.status}.`;
    throw new Error(message);
  }
  return data;
}

export function notificationUrl(origin) {
  return `${origin}/api/billing/webhook`;
}

export async function createPreapproval({token, planId, email, origin, externalReference, idempotencyKey}) {
  const plan = getPlan(planId);
  if (!plan) throw new Error('Selecione um plano válido.');
  const payload = {
    reason: `Lead Finder ${plan.name}`,
    external_reference: externalReference,
    payer_email: email,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: plan.amount,
      currency_id: plan.currency
    },
    back_url: `${origin}/conta?checkout=retorno`,
    status: 'pending',
    notification_url: notificationUrl(origin)
  };
  return mpRequest('/preapproval', {token, method:'POST', body:payload, idempotencyKey});
}

export async function fetchPayment(id, token) {
  return mpRequest(`/v1/payments/${encodeURIComponent(id)}`, {token});
}

export async function fetchPreapproval(id, token) {
  return mpRequest(`/preapproval/${encodeURIComponent(id)}`, {token});
}

export async function fetchAuthorizedPayment(id, token) {
  return mpRequest(`/authorized_payments/${encodeURIComponent(id)}`, {token});
}

export function mapPreapprovalStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'authorized') return 'authorized';
  if (value === 'paused') return 'paused';
  if (value === 'cancelled' || value === 'canceled') return 'cancelled';
  if (value === 'pending') return 'pending';
  return 'pending';
}

export function checkoutUrl(resource) {
  return resource?.init_point || resource?.sandbox_init_point || null;
}

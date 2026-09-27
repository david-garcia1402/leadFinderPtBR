import {getPlan} from './plans.mjs';
import {normalizeEmail} from './auth.mjs';

export const PROVIDERS = Object.freeze({
  kiwify: {id:'kiwify', label:'Kiwify', checkoutKind:'hosted'},
  mercadopago: {id:'mercadopago', label:'Mercado Pago', checkoutKind:'api'},
  hosted: {id:'hosted', label:'Checkout', checkoutKind:'hosted'}
});

const PLAN_IDS = ['essencial', 'profissional', 'escala'];

function envValue(env, ...keys) {
  for (const key of keys) {
    const value = String(env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

export function providerInfo(id) {
  return PROVIDERS[id] || null;
}

export function hasKiwifyCheckout(env = process.env) {
  return PLAN_IDS.some(id => checkoutUrlFor(id, env, 'kiwify'));
}

export function hasHostedCheckout(env = process.env) {
  return PLAN_IDS.some(id => envValue(env, `CHECKOUT_URL_${id.toUpperCase()}`));
}

export function resolveProvider(env = process.env) {
  const forced = String(env.BILLING_PROVIDER || '').trim().toLowerCase();
  if (PROVIDERS[forced]) return PROVIDERS[forced];
  if (hasKiwifyCheckout(env) || envValue(env, 'KIWIFY_WEBHOOK_TOKEN')) return PROVIDERS.kiwify;
  if (envValue(env, 'MP_ACCESS_TOKEN')) return PROVIDERS.mercadopago;
  if (hasHostedCheckout(env) || envValue(env, 'BILLING_WEBHOOK_SECRET')) return PROVIDERS.hosted;
  return PROVIDERS.kiwify;
}

export function providerLabel(env = process.env, provider = resolveProvider(env)) {
  return envValue(env, 'BILLING_PROVIDER_LABEL') || provider.label;
}

export function checkoutUrlFor(planId, env = process.env, providerId = resolveProvider(env).id) {
  const plan = getPlan(planId);
  if (!plan) return '';
  const key = plan.id.toUpperCase();
  if (providerId === 'kiwify') {
    return envValue(env, `KIWIFY_CHECKOUT_${key}`, `CHECKOUT_URL_${key}`);
  }
  if (providerId === 'hosted') {
    return envValue(env, `CHECKOUT_URL_${key}`, `KIWIFY_CHECKOUT_${key}`);
  }
  return '';
}

export function productPlanMap(env = process.env) {
  const map = {};
  for (const id of PLAN_IDS) {
    const key = id.toUpperCase();
    for (const value of [
      envValue(env, `KIWIFY_PRODUCT_${key}`),
      envValue(env, `BILLING_PRODUCT_${key}`)
    ]) {
      if (value) map[value.toLowerCase()] = id;
    }
  }
  return map;
}

export function planFromProduct({productId, productName, planId, env = process.env} = {}) {
  if (getPlan(planId)) return getPlan(planId).id;
  const map = productPlanMap(env);
  const id = String(productId || '').trim().toLowerCase();
  if (id && map[id]) return map[id];
  const name = String(productName || '').toLowerCase();
  if (name.includes('escala')) return 'escala';
  if (name.includes('profissional')) return 'profissional';
  if (name.includes('essencial')) return 'essencial';
  return null;
}

export function withBuyerEmail(url, email) {
  const normalized = normalizeEmail(email);
  if (!url || !normalized) return url;
  try {
    const next = new URL(url);
    if (!next.searchParams.has('email')) next.searchParams.set('email', normalized);
    return next.toString();
  } catch {
    return url;
  }
}

export function detectProvider({headers = {}, body = {}, hint} = {}) {
  if (PROVIDERS[hint]) return hint;
  if (headers['x-signature'] || ['payment','subscription_preapproval','subscription_authorized_payment'].includes(String(body.type || body.topic || ''))) {
    return 'mercadopago';
  }
  if (body.webhook_event_type || body.Product || body.Customer || body.order_id) return 'kiwify';
  if (body.event || body.planId || headers['x-billing-signature']) return 'hosted';
  return null;
}

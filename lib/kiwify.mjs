import {timingSafeEqual} from 'node:crypto';
import {normalizeEmail} from './auth.mjs';
import {planFromProduct} from './providers.mjs';

const ACTIVATE = new Set(['compra_aprovada', 'order_approved', 'subscription_renewed', 'paid']);
const DEACTIVATE = new Set(['compra_reembolsada', 'chargeback', 'subscription_canceled', 'subscription_cancelled', 'subscription_late']);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function kiwifyToken(env = process.env) {
  return String(env.KIWIFY_WEBHOOK_TOKEN || '').trim();
}

export function verifyKiwifyToken({body = {}, query = {}, secret}) {
  const expected = String(secret || '').trim();
  if (!expected) return false;
  const provided = body.token || body.webhook_token || query.token || query.signature;
  return safeEqual(provided, expected);
}

export function parseKiwifyEvent(body = {}, env = process.env) {
  const event = String(body.webhook_event_type || body.event || body.order_status || '').trim().toLowerCase();
  const email = normalizeEmail(body.Customer?.email || body.customer?.email || body.email);
  const productId = body.Product?.product_id || body.product?.product_id || body.product_id;
  const productName = body.Product?.product_name || body.product?.product_name || body.product_name;
  const planId = planFromProduct({productId, productName, planId: body.planId, env});
  const orderId = String(body.order_id || body.order_ref || body.Subscription?.id || '').trim();
  let action = 'ignore';
  if (ACTIVATE.has(event) || event === 'paid' || body.order_status === 'paid') action = event === 'subscription_renewed' ? 'renew' : 'activate';
  if (DEACTIVATE.has(event)) action = 'deactivate';
  if (action === 'ignore' && body.order_status === 'paid' && planId) action = 'activate';
  return {
    provider: 'kiwify',
    action,
    event,
    email,
    planId,
    orderId,
    productId: productId ? String(productId) : '',
    eventKey: `kiwify:${orderId || 'none'}:${event || 'unknown'}`
  };
}

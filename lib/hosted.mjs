import {createHmac,timingSafeEqual} from 'node:crypto';
import {normalizeEmail} from './auth.mjs';
import {planFromProduct} from './providers.mjs';

const ACTIVATE = new Set(['purchase.approved','compra_aprovada','approved','paid','subscription.renewed','subscription_renewed']);
const DEACTIVATE = new Set(['purchase.refunded','compra_reembolsada','chargeback','subscription.cancelled','subscription.canceled','subscription_canceled','subscription_late','refunded']);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function hostedSecret(env = process.env) {
  return String(env.BILLING_WEBHOOK_SECRET || '').trim();
}

export function verifyHostedWebhook({headers = {}, body = {}, query = {}, raw = '', secret}) {
  const expected = String(secret || '').trim();
  if (!expected) return false;
  const token = body.token || query.token;
  if (token && safeEqual(token, expected)) return true;
  const header = headers['x-billing-signature'] || headers['x-webhook-signature'];
  if (!header || !raw) return false;
  const digest = createHmac('sha256', expected).update(raw).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(String(header).replace(/^sha256=/i, ''), 'hex'));
  } catch {
    return false;
  }
}

export function parseHostedEvent(body = {}, env = process.env) {
  const event = String(body.event || body.status || body.webhook_event_type || '').trim().toLowerCase();
  const email = normalizeEmail(body.email || body.customer?.email || body.buyer?.email || body.Customer?.email);
  const planId = planFromProduct({
    planId: body.planId || body.plan_id,
    productId: body.productId || body.product_id || body.Product?.product_id,
    productName: body.productName || body.product_name || body.Product?.product_name,
    env
  });
  const orderId = String(body.orderId || body.order_id || body.id || '').trim();
  let action = 'ignore';
  if (ACTIVATE.has(event)) action = event.includes('renew') ? 'renew' : 'activate';
  if (DEACTIVATE.has(event)) action = 'deactivate';
  return {
    provider: 'hosted',
    action,
    event,
    email,
    planId,
    orderId,
    productId: String(body.productId || body.product_id || ''),
    eventKey: `hosted:${orderId || 'none'}:${event || 'unknown'}`
  };
}

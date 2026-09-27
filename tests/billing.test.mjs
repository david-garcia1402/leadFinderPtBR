import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
import {createAuth} from '../lib/auth.mjs';
import {createBilling} from '../lib/billing.mjs';
import {getPlan,listPlans} from '../lib/plans.mjs';
import {parseWebhookPayload,verifyWebhookSignature,webhookManifest} from '../lib/mercadopago.mjs';

test('catalog keeps the proposed BRL plans and quotas', () => {
  assert.equal(getPlan('Profissional').quota, 300);
  assert.deepEqual(listPlans().map(plan => [plan.id, plan.amount, plan.quota]), [
    ['essencial', 39.99, 100],
    ['profissional', 59.99, 300],
    ['escala', 89.99, 600]
  ]);
});

test('webhook signature follows the Mercado Pago manifest', () => {
  const secret = 'test-secret';
  const dataId = 'PAY123ABC';
  const requestId = 'req-1';
  const ts = '1704908010';
  const manifest = webhookManifest({dataId, requestId, ts});
  assert.equal(manifest, 'id:pay123abc;request-id:req-1;ts:1704908010;');
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  assert.equal(verifyWebhookSignature({signature:`ts=${ts},v1=${v1}`, requestId, dataId, secret}), true);
  assert.equal(verifyWebhookSignature({signature:`ts=${ts},v1=${v1}`, requestId, dataId, secret:'other'}), false);
  assert.deepEqual(parseWebhookPayload({type:'payment', data:{id:'99'}}, {}), {type:'payment', dataId:'99', liveMode:false, action:''});
});

test('subscription reserve is per user and blocks inactive accounts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lf-bill-'));
  try {
    const store = await createStore(join(dir, 'accounts.json'));
    const auth = createAuth(store);
    const billing = createBilling(store, {});
    const user = await auth.register({email:'c@example.com', password:'senha-forte'});
    assert.equal(billing.statusFor(user.id).status, 'none');
    await assert.rejects(() => billing.reserve(user.id, 10), /Assinatura inativa/);
    await billing.activateForTests(user.id, 'essencial');
    const first = await billing.reserve(user.id, 40);
    assert.equal(first.remaining, 60);
    await assert.rejects(() => billing.reserve(user.id, 80), /Franquia mensal/);
    const other = await auth.register({email:'d@example.com', password:'senha-forte'});
    await billing.activateForTests(other.id, 'profissional');
    const otherQuota = await billing.reserve(other.id, 25);
    assert.equal(otherQuota.quota, 300);
    assert.equal(billing.statusFor(user.id).remaining, 60);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('checkout stays pending until the active provider has links or credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lf-chk-'));
  try {
    const store = await createStore(join(dir, 'accounts.json'));
    const auth = createAuth(store);
    const billing = createBilling(store, {});
    const user = await auth.register({email:'e@example.com', password:'senha-forte'});
    assert.equal(billing.configured(), false);
    assert.equal(billing.publicConfig().provider, 'kiwify');
    await assert.rejects(() => billing.startCheckout(user, 'essencial'), /ainda não configurado/);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('Kiwify webhook activates by email and claims later signups', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lf-kiwify-'));
  try {
    const store = await createStore(join(dir, 'accounts.json'));
    const auth = createAuth(store);
    const env = {
      BILLING_PROVIDER: 'kiwify',
      KIWIFY_WEBHOOK_TOKEN: 'tok-kiwify',
      KIWIFY_CHECKOUT_ESSENCIAL: 'https://pay.kiwify.com.br/essencial',
      KIWIFY_PRODUCT_ESSENCIAL: 'prod-essencial'
    };
    const billing = createBilling(store, env);
    const user = await auth.register({email:'f@example.com', password:'senha-forte'});
    const started = await billing.startCheckout(user, 'essencial');
    assert.match(started.initPoint, /pay\.kiwify\.com\.br/);
    assert.match(started.initPoint, /email=f%40example.com/);
    await billing.handleWebhook({
      headers: {},
      query: {},
      body: {
        token: 'tok-kiwify',
        webhook_event_type: 'compra_aprovada',
        order_id: 'ord-1',
        order_status: 'paid',
        Product: {product_id:'prod-essencial', product_name:'Lead Finder Essencial'},
        Customer: {email:'F@example.com'}
      }
    });
    assert.equal(billing.statusFor(user.id).status, 'authorized');
    assert.equal(billing.statusFor(user.id).quota, 100);
    const later = createBilling(store, env);
    await later.handleWebhook({
      headers: {},
      query: {},
      body: {
        token: 'tok-kiwify',
        webhook_event_type: 'compra_aprovada',
        order_id: 'ord-2',
        Product: {product_id:'prod-essencial', product_name:'Essencial'},
        Customer: {email:'novo@example.com'}
      }
    });
    const created = await auth.register({email:'novo@example.com', password:'senha-forte'});
    await later.claimForEmail(created.email);
    assert.equal(later.statusFor(created.id).status, 'authorized');
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('hosted checkout webhook accepts a generic approved event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lf-hosted-'));
  try {
    const store = await createStore(join(dir, 'accounts.json'));
    const auth = createAuth(store);
    const env = {
      BILLING_PROVIDER: 'hosted',
      BILLING_WEBHOOK_SECRET: 'generic-secret',
      CHECKOUT_URL_PROFISSIONAL: 'https://pay.example/pro'
    };
    const billing = createBilling(store, env);
    const user = await auth.register({email:'g@example.com', password:'senha-forte'});
    await billing.handleWebhook({
      headers: {},
      query: {},
      body: {token:'generic-secret', event:'purchase.approved', email:'g@example.com', planId:'profissional', orderId:'h1'},
      hint: 'hosted'
    });
    assert.equal(billing.statusFor(user.id).planId, 'profissional');
    assert.equal(billing.statusFor(user.id).quota, 300);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

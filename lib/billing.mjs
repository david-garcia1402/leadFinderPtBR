import {currentMonth,getPlan,isActiveStatus,periodEnd,publicSubscription} from './plans.mjs';
import {newId,normalizeEmail} from './auth.mjs';
import {checkoutUrlFor,detectProvider,providerLabel,resolveProvider,withBuyerEmail} from './providers.mjs';
import {billingConfigured as mpConfigured,checkoutUrl,createPreapproval,fetchAuthorizedPayment,fetchPayment,fetchPreapproval,mapPreapprovalStatus,parseWebhookPayload,verifyWebhookSignature,webhookSecret} from './mercadopago.mjs';
import {kiwifyToken,parseKiwifyEvent,verifyKiwifyToken} from './kiwify.mjs';
import {hostedSecret,parseHostedEvent,verifyHostedWebhook} from './hosted.mjs';

function subscriptionFor(data, userId) {
  return data.subscriptions.find(item => item.userId === userId) || null;
}

function userByEmail(data, email) {
  const normalized = normalizeEmail(email);
  return normalized ? data.users.find(item => item.email === normalized) : null;
}

export function createBilling(store, env = process.env) {
  const token = () => String(env.MP_ACCESS_TOKEN || '').trim();
  const origin = () => String(env.APP_ORIGIN || '').replace(/\/$/, '');

  return {
    provider() {
      return resolveProvider(env);
    },

    configured() {
      const provider = resolveProvider(env);
      if (provider.id === 'mercadopago') return mpConfigured(env);
      return Boolean(checkoutUrlFor('essencial', env, provider.id) || checkoutUrlFor('profissional', env, provider.id) || checkoutUrlFor('escala', env, provider.id));
    },

    publicConfig() {
      const provider = resolveProvider(env);
      return {
        provider: provider.id,
        label: providerLabel(env, provider),
        configured: this.configured(),
        currency: 'BRL',
        checkoutKind: provider.checkoutKind
      };
    },

    statusFor(userId, now = new Date()) {
      return publicSubscription(subscriptionFor(store.snapshot(), userId), now);
    },

    async reserve(userId, limit, now = new Date()) {
      const label = providerLabel(env);
      let reserved = null;
      await store.update(data => {
        const sub = subscriptionFor(data, userId);
        const view = publicSubscription(sub, now);
        if (!isActiveStatus(view.status)) throw Object.assign(new Error(`Assinatura inativa. Conclua o checkout ${label} para liberar buscas reais.`), {status:402});
        if (view.remaining < limit) throw Object.assign(new Error('Franquia mensal do plano atingida. Aguarde a renovação ou escolha um plano maior.'), {status:402});
        const month = currentMonth(now);
        if (sub.month !== month) {
          sub.month = month;
          sub.reserved = 0;
        }
        sub.reserved += limit;
        reserved = {reserved: sub.reserved, remaining: Math.max(0, view.quota - sub.reserved), quota: view.quota, planId: sub.planId};
      });
      return reserved;
    },

    async startCheckout(user, planId) {
      const plan = getPlan(planId);
      if (!plan) throw Object.assign(new Error('Selecione um plano válido.'), {status:400});
      const provider = resolveProvider(env);
      const checkout = {
        id: newId('chk_'),
        userId: user.id,
        planId: plan.id,
        status: 'pending',
        createdAt: new Date().toISOString(),
        provider: provider.id,
        preapprovalId: null
      };
      if (provider.checkoutKind === 'hosted') {
        const url = withBuyerEmail(checkoutUrlFor(plan.id, env, provider.id), user.email);
        if (!url) throw Object.assign(new Error(`Checkout ${providerLabel(env, provider)} ainda não configurado. Defina o link do plano ${plan.name}.`), {status:503});
        await store.update(data => { data.checkouts.push({...checkout, initPoint: url}); });
        return {checkoutId: checkout.id, planId: plan.id, initPoint: url, provider: provider.id, sandbox: false};
      }
      if (!mpConfigured(env)) throw Object.assign(new Error('Checkout Mercado Pago ainda não configurado. Defina MP_ACCESS_TOKEN no servidor.'), {status:503});
      const appOrigin = origin();
      if (!/^https:\/\//.test(appOrigin)) throw Object.assign(new Error('Defina APP_ORIGIN com a origem HTTPS pública antes de iniciar o checkout.'), {status:503});
      await store.update(data => { data.checkouts.push(checkout); });
      try {
        const resource = await createPreapproval({
          token: token(),
          planId: plan.id,
          email: user.email,
          origin: appOrigin,
          externalReference: checkout.id,
          idempotencyKey: checkout.id
        });
        const url = checkoutUrl(resource);
        await store.update(data => {
          const row = data.checkouts.find(item => item.id === checkout.id);
          if (row) {
            row.preapprovalId = resource.id ? String(resource.id) : null;
            row.initPoint = url;
          }
        });
        if (!url) throw new Error('O Mercado Pago não devolveu a URL de checkout.');
        return {checkoutId: checkout.id, planId: plan.id, initPoint: url, provider: provider.id, sandbox: Boolean(resource.sandbox_init_point && !resource.init_point)};
      } catch (error) {
        await store.update(data => {
          const row = data.checkouts.find(item => item.id === checkout.id);
          if (row) row.status = 'failed';
        });
        throw error;
      }
    },

    async handleWebhook({headers, query, body, raw, hint}) {
      const detected = detectProvider({headers, body, hint}) || resolveProvider(env).id;
      if (detected === 'kiwify') return this.handleKiwifyWebhook({headers, query, body});
      if (detected === 'hosted') return this.handleHostedWebhook({headers, query, body, raw});
      return this.handleMercadoPagoWebhook({headers, query, body});
    },

    async handleKiwifyWebhook({query, body}) {
      const secret = kiwifyToken(env);
      if (!secret) throw Object.assign(new Error('Webhook Kiwify sem KIWIFY_WEBHOOK_TOKEN.'), {status:503});
      if (!verifyKiwifyToken({body, query, secret})) throw Object.assign(new Error('Token do webhook Kiwify inválido.'), {status:401});
      return this.applyNormalized(parseKiwifyEvent(body, env));
    },

    async handleHostedWebhook({headers, query, body, raw}) {
      const secret = hostedSecret(env);
      if (!secret) throw Object.assign(new Error('Webhook genérico sem BILLING_WEBHOOK_SECRET.'), {status:503});
      if (!verifyHostedWebhook({headers, body, query, raw, secret})) throw Object.assign(new Error('Assinatura do webhook inválida.'), {status:401});
      return this.applyNormalized(parseHostedEvent(body, env));
    },

    async handleMercadoPagoWebhook({headers, query, body}) {
      const secret = webhookSecret(env);
      if (!secret) throw Object.assign(new Error('Webhook Mercado Pago sem MP_WEBHOOK_SECRET.'), {status:503});
      const parsed = parseWebhookPayload(body, query);
      const valid = verifyWebhookSignature({
        signature: headers['x-signature'],
        requestId: headers['x-request-id'],
        dataId: parsed.dataId || query['data.id'] || query.id,
        secret
      });
      if (!valid) throw Object.assign(new Error('Assinatura do webhook inválida.'), {status:401});
      if (!parsed.dataId) return {ok:true, ignored:true};
      const eventKey = `${parsed.type}:${parsed.dataId}`;
      if (store.snapshot().events.some(item => item.id === eventKey)) return {ok:true, duplicate:true};
      if (!token()) {
        await store.update(data => {
          data.events.push({id:eventKey, type:parsed.type, receivedAt:new Date().toISOString(), pendingFetch:true});
        });
        return {ok:true, queued:true};
      }
      await this.applyProviderEvent(parsed);
      return {ok:true};
    },

    async applyNormalized(parsed) {
      if (!parsed.eventKey) return {ok:true, ignored:true};
      if (store.snapshot().events.some(item => item.id === parsed.eventKey)) return {ok:true, duplicate:true};
      if (parsed.action === 'ignore') {
        await store.update(data => { data.events.push({id:parsed.eventKey, type:parsed.event, receivedAt:new Date().toISOString(), ignored:true}); });
        return {ok:true, ignored:true};
      }
      if (!parsed.planId && parsed.action !== 'deactivate') {
        await store.update(data => { data.events.push({id:parsed.eventKey, type:parsed.event, receivedAt:new Date().toISOString(), unmatched:true}); });
        return {ok:true, unmatched:true};
      }
      await store.update(data => {
        data.events.push({id:parsed.eventKey, type:parsed.event, receivedAt:new Date().toISOString(), provider:parsed.provider});
        const user = userByEmail(data, parsed.email);
        if (!user) {
          if (!parsed.email) return;
          data.entitlements.push({
            email: parsed.email,
            planId: parsed.planId,
            action: parsed.action,
            provider: parsed.provider,
            orderId: parsed.orderId,
            createdAt: new Date().toISOString()
          });
          return;
        }
        applyAction(data, user.id, parsed);
      });
      return {ok:true};
    },

    async claimForEmail(email) {
      const normalized = normalizeEmail(email);
      if (!normalized) return null;
      await store.update(data => {
        const user = userByEmail(data, normalized);
        if (!user) return;
        for (const item of data.entitlements) {
          if (item.email !== normalized || item.claimed) continue;
          applyAction(data, user.id, item);
          item.claimed = true;
        }
      });
      const user = userByEmail(store.snapshot(), normalized);
      return user ? publicSubscription(subscriptionFor(store.snapshot(), user.id)) : null;
    },

    async applyProviderEvent(parsed) {
      const access = token();
      if (parsed.type === 'payment') {
        const payment = await fetchPayment(parsed.dataId, access);
        return this.applyPayment(payment, parsed);
      }
      if (parsed.type === 'subscription_preapproval') {
        const preapproval = await fetchPreapproval(parsed.dataId, access);
        return this.applyPreapproval(preapproval, parsed);
      }
      if (parsed.type === 'subscription_authorized_payment') {
        const invoice = await fetchAuthorizedPayment(parsed.dataId, access);
        return this.applyAuthorizedPayment(invoice, parsed);
      }
      await store.update(data => {
        data.events.push({id:`${parsed.type}:${parsed.dataId}`, type:parsed.type, receivedAt:new Date().toISOString(), ignored:true});
      });
      return {ignored:true};
    },

    async applyPayment(payment, parsed) {
      const reference = String(payment.external_reference || '');
      const approved = String(payment.status || '') === 'approved';
      await store.update(data => {
        rememberEvent(data, parsed);
        const checkout = data.checkouts.find(item => item.id === reference);
        if (checkout) checkout.lastPaymentId = String(payment.id || parsed.dataId);
        if (!approved || !checkout) return;
        checkout.status = 'paid';
        activateSubscription(data, checkout.userId, checkout.planId, {
          provider: 'mercadopago',
          preapprovalId: checkout.preapprovalId,
          payerId: payment.payer?.id ? String(payment.payer.id) : null
        });
      });
    },

    async applyPreapproval(preapproval, parsed) {
      const reference = String(preapproval.external_reference || '');
      const status = mapPreapprovalStatus(preapproval.status);
      await store.update(data => {
        rememberEvent(data, parsed);
        const checkout = data.checkouts.find(item => item.id === reference || item.preapprovalId === String(preapproval.id || ''));
        if (checkout) {
          checkout.preapprovalId = String(preapproval.id || checkout.preapprovalId || '');
          checkout.status = status === 'authorized' ? 'authorized' : status;
          if (status === 'authorized') {
            activateSubscription(data, checkout.userId, checkout.planId, {
              provider: 'mercadopago',
              preapprovalId: checkout.preapprovalId,
              payerId: preapproval.payer_id ? String(preapproval.payer_id) : null
            });
          } else if (status === 'paused' || status === 'cancelled') {
            const sub = subscriptionFor(data, checkout.userId);
            if (sub && sub.preapprovalId === checkout.preapprovalId) sub.status = status;
          }
        }
      });
    },

    async applyAuthorizedPayment(invoice, parsed) {
      const approved = String(invoice.payment?.status || invoice.status || '') === 'approved';
      const preapprovalId = String(invoice.preapproval_id || '');
      await store.update(data => {
        rememberEvent(data, parsed);
        if (!approved || !preapprovalId) return;
        const checkout = data.checkouts.find(item => item.preapprovalId === preapprovalId);
        const userId = checkout?.userId || data.subscriptions.find(item => item.preapprovalId === preapprovalId)?.userId;
        if (!userId) return;
        const planId = checkout?.planId || subscriptionFor(data, userId)?.planId;
        activateSubscription(data, userId, planId, {provider:'mercadopago', preapprovalId, renew:true});
      });
    },

    async activateForTests(userId, planId) {
      const plan = getPlan(planId);
      if (!plan) throw new Error('Selecione um plano válido.');
      await store.update(data => {
        activateSubscription(data, userId, plan.id, {provider:'test', preapprovalId:'test'});
      });
      return publicSubscription(subscriptionFor(store.snapshot(), userId));
    }
  };
}

function rememberEvent(data, parsed) {
  const id = `${parsed.type}:${parsed.dataId}`;
  if (!data.events.some(item => item.id === id)) {
    data.events.push({id, type:parsed.type, receivedAt:new Date().toISOString()});
  }
}

function applyAction(data, userId, parsed) {
  if (parsed.action === 'deactivate') {
    const sub = subscriptionFor(data, userId);
    if (sub) sub.status = 'cancelled';
    return;
  }
  activateSubscription(data, userId, parsed.planId, {
    provider: parsed.provider,
    preapprovalId: parsed.orderId,
    renew: parsed.action === 'renew'
  });
}

function activateSubscription(data, userId, planId, extra = {}) {
  const plan = getPlan(planId);
  if (!plan || !userId) return;
  const now = new Date();
  let sub = data.subscriptions.find(item => item.userId === userId);
  if (!sub) {
    sub = {userId, reserved:0, month:currentMonth(now)};
    data.subscriptions.push(sub);
  }
  const renew = extra.renew === true && sub.planId === plan.id && isActiveStatus(sub.status);
  sub.planId = plan.id;
  sub.status = 'authorized';
  sub.provider = extra.provider || sub.provider || null;
  sub.preapprovalId = extra.preapprovalId || sub.preapprovalId || null;
  sub.payerId = extra.payerId || sub.payerId || null;
  sub.currentPeriodStart = now.toISOString();
  sub.currentPeriodEnd = periodEnd(now);
  if (!renew) {
    sub.month = currentMonth(now);
    sub.reserved = 0;
  }
}

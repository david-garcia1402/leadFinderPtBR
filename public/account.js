const params = new URLSearchParams(location.search);
const selected = (params.get('plano') || '').toLowerCase();
const $ = id => document.getElementById(id);
const status = $('checkout-status');
const STATUS_LABELS = {authorized: 'Ativo', active: 'Ativo', pending: 'Pagamento pendente', paused: 'Pausado', cancelled: 'Cancelado', late: 'Pagamento atrasado'};
const DESCRIPTIONS = {
  essencial: 'Para quem está criando uma rotina de prospecção.',
  profissional: 'Para quem quer trabalhar mais segmentos e regiões.',
  escala: 'Para profissionais com maior volume de pesquisa.'
};
let user = null;
let billing = {configured: false, label: 'Checkout'};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const isActive = sub => sub?.status === 'authorized' || sub?.status === 'active';
const label = () => billing.label || 'checkout';

function setStatus(message, tone = '') {
  status.textContent = message;
  status.dataset.tone = tone;
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível concluir. Tente novamente.');
  return data;
}

function priceHtml(plan) {
  const [whole, cents = '00'] = Number(plan.amount).toFixed(2).split('.');
  return `R$ ${esc(whole)}<span>,${esc(cents)} / mês</span>`;
}

function renderPlans(plans) {
  const sub = user?.subscription;
  const current = isActive(sub) ? sub.planId : null;
  $('plans').innerHTML = plans.map(plan => {
    const active = current === plan.id;
    const highlight = active || selected === plan.id || (!selected && !current && plan.id === 'profissional');
    const action = !user
      ? `<a class="button ${highlight ? '' : 'outline'}" href="/entrar?plano=${esc(plan.id)}">Escolher ${esc(plan.name)} <span aria-hidden="true">↗</span></a>`
      : `<button type="button" class="button ${highlight ? '' : 'outline'}" data-plan="${esc(plan.id)}" ${billing.configured ? '' : 'disabled'}>${active ? 'Renovar plano' : current ? `Trocar para ${esc(plan.name)}` : `Assinar ${esc(plan.name)}`} <span aria-hidden="true">↗</span></button>`;
    return `<article class="plan ${highlight ? 'featured' : ''}">
      <span class="plan-type">${active ? 'SEU PLANO ATUAL' : 'PLANO MENSAL'}</span>
      <h3>${esc(plan.name)}</h3>
      <p>${esc(DESCRIPTIONS[plan.id] || '')}</p>
      <div class="price">${priceHtml(plan)}</div>
      <div class="allowance">${esc(plan.quota)} empresas por mês</div>
      ${action}
    </article>`;
  }).join('');
}

function describeSession() {
  const logged = !!user;
  $('login-link').hidden = logged;
  $('panel-link').hidden = !logged;
  $('logout').hidden = !logged;
  $('nav-login').hidden = logged;
  $('nav-logout').hidden = !logged;
  if (!logged) {
    $('session-line').textContent = 'Você ainda não entrou neste navegador.';
    $('session-plan').textContent = 'Entre ou crie sua conta gratuita para assinar um plano.';
    $('session-status').hidden = true;
    $('session-quota').hidden = true;
    $('account-lead').textContent = 'Escolha um plano abaixo. Você cria a conta (é gratuito) e segue para o pagamento.';
    return;
  }
  const sub = user.subscription || {};
  const active = isActive(sub);
  $('session-line').textContent = user.name ? `${user.name} · ${user.email}` : user.email;
  $('session-plan').textContent = sub.planName ? `Plano ${sub.planName}` : 'Nenhum plano ativo';
  const chip = $('session-status');
  chip.hidden = !STATUS_LABELS[sub.status];
  chip.textContent = STATUS_LABELS[sub.status] || '';
  chip.dataset.tone = active ? 'ok' : 'warn';
  $('session-quota').hidden = !active;
  if (active) {
    $('session-quota-bar').max = Math.max(1, sub.quota || 0);
    $('session-quota-bar').value = sub.remaining || 0;
    $('session-quota-text').textContent = `${sub.remaining || 0} de ${sub.quota || 0} empresas restantes este mês`;
  }
  if (!billing.configured) {
    $('account-lead').textContent = 'O pagamento está temporariamente indisponível. Tente novamente mais tarde ou fale com o suporte da cub4Studio.';
  } else if (active) {
    $('account-lead').textContent = 'Seu plano está ativo. Abra o painel para buscar empresas.';
  } else if (sub.status === 'pending') {
    $('account-lead').textContent = 'Estamos aguardando a confirmação do pagamento. A franquia é liberada automaticamente assim que ele for confirmado — use o mesmo e-mail desta conta no pagamento.';
  } else {
    $('account-lead').textContent = `Escolha um plano para liberar a busca. O pagamento é feito no ${label()}, com o mesmo e-mail desta conta.`;
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', {method: 'POST', headers: {'X-Cub4-Client': 'lead-finder'}});
    location.href = '/entrar';
  } catch (error) {
    setStatus(error.message, 'error');
  }
}
$('logout').addEventListener('click', logout);
$('nav-logout').addEventListener('click', logout);

async function openCheckout(planId, button) {
  setStatus(`Abrindo o pagamento no ${label()}…`);
  if (button) button.disabled = true;
  try {
    const checkout = await api('/api/billing/checkout', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Cub4-Client': 'lead-finder'},
      body: JSON.stringify({planId})
    });
    if (checkout.initPoint) location.href = checkout.initPoint;
    else setStatus('Não conseguimos abrir o pagamento agora. Tente novamente em instantes.', 'error');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

$('plans').addEventListener('click', event => {
  const button = event.target.closest('button[data-plan]');
  if (!button || button.disabled) return;
  openCheckout(button.dataset.plan, button);
});

Promise.all([
  fetch('/api/me').then(res => res.ok ? res.json() : {user: null}).catch(() => ({user: null})),
  api('/api/plans')
]).then(([session, catalog]) => {
  user = session.user || null;
  billing = catalog.billing || billing;
  describeSession();
  const plans = catalog.plans || [];
  renderPlans(plans);
  if (params.get('checkout') === 'retorno') {
    setStatus('Pagamento recebido! A franquia é liberada assim que o pagamento for confirmado — normalmente em poucos minutos. Atualize esta página para ver o status.', 'ok');
    return;
  }
  if (user && billing.configured && plans.some(plan => plan.id === selected) && !isActive(user.subscription)) openCheckout(selected);
}).catch(() => {
  $('session-line').textContent = 'Não foi possível carregar sua conta.';
  $('account-lead').textContent = 'Verifique sua conexão e atualize a página em instantes.';
});

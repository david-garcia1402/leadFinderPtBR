const params = new URLSearchParams(location.search);
const selected = (params.get('plano') || '').toLowerCase();
const status = document.getElementById('checkout-status');
const sessionLine = document.getElementById('session-line');
const lead = document.getElementById('account-lead');
const logout = document.getElementById('logout');
const plansBox = document.getElementById('plans');
let user = null;
let billing = {configured:false, label:'Checkout'};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function label() {
  return billing.label || 'Checkout';
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

function renderPlans(plans) {
  const current = user?.subscription?.planId;
  plansBox.innerHTML = plans.map(plan => {
    const active = current === plan.id;
    const highlight = selected === plan.id || (!selected && plan.id === 'profissional');
    return `<article class="plan ${highlight ? 'featured' : ''}">
      <span class="plan-type">${active ? 'SEU PLANO ATUAL' : 'PLANO MENSAL'}</span>
      <h3>${esc(plan.name)}</h3>
      <div class="price">${esc(plan.label)}</div>
      <div class="allowance">${esc(plan.quota)} empresas por mês</div>
      <button class="button ${highlight ? '' : 'outline'}" data-plan="${esc(plan.id)}" ${user && billing.configured ? '' : 'disabled'}>
        ${active ? `Renovar no ${esc(label())}` : `Assinar com ${esc(label())}`} <span>↗</span>
      </button>
    </article>`;
  }).join('');
}

function describeSession() {
  const loginLink = document.querySelector('#session-card a[href="/entrar"]');
  if (!user) {
    sessionLine.textContent = 'Nenhuma sessão ativa neste navegador.';
    logout.hidden = true;
    if (loginLink) loginLink.hidden = false;
    lead.textContent = `Crie sua conta com o mesmo e-mail da compra. A cobrança acontece no ${label()}.`;
    return;
  }
  const sub = user.subscription || {};
  logout.hidden = false;
  if (loginLink) loginLink.hidden = true;
  sessionLine.textContent = `${user.email} · ${sub.planName || 'sem plano'} · ${sub.remaining || 0}/${sub.quota || 0} empresas restantes`;
  lead.textContent = billing.configured
    ? `Checkout ${label()} disponível. A franquia só é liberada depois da confirmação do webhook.`
    : `Conta pronta. Configure os links e o webhook do ${label()} no servidor para abrir o checkout.`;
}

logout.onclick = async () => {
  try {
    await api('/api/auth/logout', {method:'POST', headers:{'X-Cub4-Client':'lead-finder'}});
    location.href = '/entrar';
  } catch (error) {
    status.textContent = error.message;
  }
};

async function openCheckout(planId) {
  status.textContent = `Abrindo o checkout ${label()}…`;
  try {
    const checkout = await api('/api/billing/checkout', {
      method:'POST',
      headers:{'Content-Type':'application/json','X-Cub4-Client':'lead-finder'},
      body: JSON.stringify({planId})
    });
    if (checkout.initPoint) location.href = checkout.initPoint;
    else status.textContent = `O ${label()} não devolveu a URL de pagamento.`;
  } catch (error) {
    status.textContent = error.message;
  }
}

plansBox.addEventListener('click', event => {
  const button = event.target.closest('button[data-plan]');
  if (!button || button.disabled) return;
  openCheckout(button.dataset.plan);
});

Promise.all([
  fetch('/api/me').then(res => res.json()).catch(() => ({user:null})),
  fetch('/api/plans').then(res => res.json())
]).then(([session, catalog]) => {
  user = session.user || null;
  billing = catalog.billing || billing;
  describeSession();
  const plans = catalog.plans || [];
  renderPlans(plans);
  if (params.get('checkout') === 'retorno') {
    status.textContent = `Retorno do ${label()} registrado. A franquia só muda depois da confirmação do webhook.`;
    return;
  }
  if (user && billing.configured && plans.some(plan => plan.id === selected)) openCheckout(selected);
}).catch(() => {
  sessionLine.textContent = 'Servidor indisponível. Reinicie npm run dev.';
});

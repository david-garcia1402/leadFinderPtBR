const status = document.getElementById('auth-status');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const params = new URLSearchParams(location.search);
const next = params.get('next') === '/conta' ? '/conta' : '/app';
const PLANS = {essencial: 'Essencial — R$ 39,99/mês', profissional: 'Profissional — R$ 59,99/mês', escala: 'Escala — R$ 89,99/mês'};
const plan = Object.hasOwn(PLANS, (params.get('plano') || '').toLowerCase()) ? params.get('plano').toLowerCase() : '';

function setStatus(message, tone = '') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function show(mode, focus = false) {
  const register = mode === 'register';
  loginForm.hidden = register;
  registerForm.hidden = !register;
  for (const [tab, active] of [[tabLogin, !register], [tabRegister, register]]) {
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  setStatus('');
  if (focus) (register ? registerForm : loginForm).querySelector('input').focus();
}

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Cub4-Client': 'lead-finder'},
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Não foi possível entrar. Tente novamente.');
  return data;
}

function destination() {
  return plan ? `/conta?plano=${encodeURIComponent(plan)}` : next;
}

async function submit(form, pending, request) {
  const button = form.querySelector('button[type="submit"]');
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = pending;
  setStatus('');
  try {
    await request();
    setStatus('Tudo certo! Redirecionando…', 'ok');
    location.href = destination();
  } catch (error) {
    setStatus(error.message, 'error');
    button.disabled = false;
    button.innerHTML = label;
  }
}

tabLogin.addEventListener('click', () => show('login', true));
tabRegister.addEventListener('click', () => show('register', true));
for (const tab of [tabLogin, tabRegister]) {
  tab.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const other = tab === tabLogin ? tabRegister : tabLogin;
    other.focus();
    other.click();
  });
}

for (const button of document.querySelectorAll('[data-reveal]')) {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.reveal);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Ocultar' : 'Mostrar';
    button.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
    button.setAttribute('aria-pressed', String(visible));
  });
}

if (plan) {
  const picked = document.getElementById('plan-picked');
  picked.hidden = false;
  picked.innerHTML = `Plano escolhido: <b></b>. Crie sua conta (ou entre) e seguimos para o pagamento. <a class="text-link" href="/#planos">Trocar plano</a>`;
  picked.querySelector('b').textContent = PLANS[plan];
  document.getElementById('auth-lead').textContent = 'Use o mesmo e-mail no pagamento: é assim que o plano é ligado à sua conta. A franquia é liberada automaticamente quando o pagamento for confirmado.';
}
if (params.get('cadastro') === '1' || plan) show('register');

loginForm.addEventListener('submit', event => {
  event.preventDefault();
  submit(loginForm, 'Entrando…', () => api('/api/auth/login', {
    email: document.getElementById('login-email').value,
    password: document.getElementById('login-password').value
  }));
});

registerForm.addEventListener('submit', event => {
  event.preventDefault();
  submit(registerForm, 'Criando sua conta…', () => api('/api/auth/register', {
    name: document.getElementById('register-name').value,
    email: document.getElementById('register-email').value,
    password: document.getElementById('register-password').value
  }));
});

fetch('/api/me').then(res => res.ok ? res.json() : null).then(data => {
  if (data?.user) location.replace(destination());
}).catch(() => {});

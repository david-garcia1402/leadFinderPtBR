import {csv} from '/leads.mjs';
import {SEGMENTS, LOCATIONS} from '/suggestions.mjs';

const $ = id => document.getElementById(id);
const KEYS = {saved: 'cub4-prospects', recent: 'lf-recent-searches', form: 'lf-search-form', results: 'lf-last-results'};
const CLIENT_HEADERS = {'Content-Type': 'application/json', 'X-Cub4-Client': 'lead-finder'};
const STATUS_LABELS = {authorized: 'Ativo', active: 'Ativo', pending: 'Pagamento pendente', paused: 'Pausado', cancelled: 'Cancelado', late: 'Pagamento atrasado'};
const SUPPORT_URL = 'https://cub4studio.com/#contato';

const state = {
  config: {live: false, preview: false},
  user: null,
  loaded: false,
  failed: false,
  results: [],
  demo: false,
  cached: false,
  query: null,
  view: 'discover',
  searching: false
};

function readJSON(storage, key, fallback) {
  try {
    return JSON.parse(storage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let saved = readJSON(localStorage, KEYS.saved, []);
if (!Array.isArray(saved)) saved = [];

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const safeUrl = value => /^https?:\/\//i.test(value || '') ? value : '';
// Folds each character separately so indexes still line up with the original text for highlighting.
const fold = value => [...String(value ?? '')].map(c => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()).join('');
const plural = (n, one, many) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
const isActive = user => ['authorized', 'active'].includes(user?.subscription?.status);
const isSaved = id => saved.some(item => item.id === id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const formatRating = rating => Number(rating).toFixed(1).replace('.', ',');

function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits.replace('+', '').length >= 8 ? `tel:${digits}` : '';
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function slug(value) {
  return fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

async function api(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Não foi possível concluir. Tente novamente.'), {status: response.status});
  return body;
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function setStatus(message, tone = 'info') {
  const el = $('status');
  el.textContent = message || '';
  el.hidden = !message;
  el.dataset.tone = tone;
}

/* ---------- Autocomplete ---------- */

function highlight(text, query) {
  const index = query ? fold(text).indexOf(query) : -1;
  if (index < 0) return esc(text);
  return `${esc(text.slice(0, index))}<mark>${esc(text.slice(index, index + query.length))}</mark>${esc(text.slice(index + query.length))}`;
}

function recentSearches() {
  const list = readJSON(localStorage, KEYS.recent, []);
  return Array.isArray(list) ? list.filter(item => item && item.niche && item.location) : [];
}

function remember(query) {
  const same = item => fold(item.niche) === fold(query.niche) && fold(item.location) === fold(query.location);
  writeJSON(localStorage, KEYS.recent, [query, ...recentSearches().filter(item => !same(item))].slice(0, 6));
}

function suggestionSource(list, field) {
  return query => {
    const matches = value => !query || fold(value).includes(query);
    const recent = [...new Set(recentSearches().map(item => item[field]))].filter(matches).slice(0, 4);
    const pool = list.filter(value => matches(value) && !recent.includes(value));
    if (query) pool.sort((a, b) => Number(!fold(a).startsWith(query)) - Number(!fold(b).startsWith(query)));
    return [
      {label: 'Buscas recentes', items: recent},
      {label: query ? 'Sugestões' : 'Mais buscados', items: pool.slice(0, query ? 8 : 6)}
    ];
  };
}

function combobox(input, source) {
  const list = document.createElement('ul');
  list.className = 'suggestions';
  list.id = `${input.id}-suggestions`;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.after(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  let options = [];
  let active = -1;

  function setActive(index) {
    active = index;
    list.querySelectorAll('[role="option"]').forEach((el, n) => el.setAttribute('aria-selected', String(n === index)));
    const current = index >= 0 ? document.getElementById(`${list.id}-${index}`) : null;
    if (current) {
      input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({block: 'nearest'});
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }

  function open() {
    const query = fold(input.value.trim());
    const groups = source(query).filter(group => group.items.length);
    options = groups.flatMap(group => group.items);
    if (!options.length || (options.length === 1 && fold(options[0]) === query)) return close();
    let n = 0;
    list.innerHTML = groups.map(group => `<li class="group" role="presentation">${esc(group.label)}</li>` +
      group.items.map(item => `<li role="option" aria-selected="false" id="${list.id}-${n++}" data-value="${esc(item)}">${highlight(item, query)}</li>`).join('')
    ).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  }

  function choose(value) {
    input.value = value;
    close();
    input.dispatchEvent(new Event('input', {bubbles: true}));
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', event => { if (event.isTrusted) open(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (list.hidden) open();
      if (list.hidden) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(active < 0 ? (step > 0 ? 0 : options.length - 1) : (active + step + options.length) % options.length);
    } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab' && !list.hidden && active >= 0) {
      choose(options[active]);
    }
  });
  list.addEventListener('mousedown', event => {
    const option = event.target.closest('[role="option"]');
    if (!option) return;
    event.preventDefault();
    choose(option.dataset.value);
  });
}

/* ---------- Access state ---------- */

function selectedMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || 'live';
}

function access() {
  if (!state.loaded) return 'loading';
  if (state.failed) return 'error';
  const {live, preview} = state.config;
  if (preview && (!live || selectedMode() === 'demo')) return 'demo';
  if (!live) return 'off';
  if (!state.user) return 'login';
  if (!isActive(state.user)) return 'plan';
  if ((state.user.subscription.remaining || 0) <= 0) return 'quota';
  return 'ready';
}

function accessCopy(kind) {
  const sub = state.user?.subscription || {};
  const copy = {
    loading: {badge: 'Carregando…', tone: 'muted', button: 'Buscar empresas'},
    error: {
      badge: 'Sem conexão', tone: 'warn', button: 'Buscar empresas',
      banner: {title: 'Não foi possível carregar o painel', text: 'Verifique sua conexão e atualize a página. Se o problema continuar, fale com o suporte.', action: ['Atualizar página', location.pathname]}
    },
    off: {
      badge: 'Busca ainda não ativada', tone: 'warn', button: 'Busca indisponível',
      banner: {
        title: 'A busca de empresas ainda não foi ativada',
        text: 'A conexão com a fonte de dados ainda não foi ligada neste servidor, por isso nenhuma busca pode ser feita agora. Você já pode criar sua conta e escolher um plano. Se já assinou, fale com o suporte para acompanhar a liberação.',
        action: ['Falar com o suporte', SUPPORT_URL]
      }
    },
    demo: {
      badge: 'Modo demonstração', tone: 'info', button: 'Ver demonstração',
      banner: {
        title: 'Você está no modo demonstração',
        text: state.config.live
          ? 'Os resultados são empresas fictícias, só para conhecer o painel. Selecione “Empresas reais” para buscar de verdade.'
          : 'Os resultados são empresas fictícias, só para conhecer o painel. Nenhuma franquia é consumida.'
      }
    },
    login: {
      badge: 'Entre para buscar', tone: 'warn', button: 'Entrar para buscar',
      banner: {title: 'Entre para buscar empresas reais', text: 'Cada busca usa a franquia mensal do seu plano. Criar a conta é gratuito e leva menos de um minuto.', action: ['Entrar ou criar conta', '/entrar']}
    },
    plan: sub.status === 'pending'
      ? {
          badge: 'Pagamento em confirmação', tone: 'warn', button: 'Ver meu plano',
          banner: {title: 'Estamos aguardando a confirmação do pagamento', text: 'Assim que o pagamento for confirmado, a franquia é liberada automaticamente. Use o mesmo e-mail da compra nesta conta.', action: ['Ver meu plano', '/conta']}
        }
      : {
          badge: 'Escolha um plano', tone: 'warn', button: 'Ver planos',
          banner: {title: 'Escolha um plano para começar a buscar', text: 'Sua conta está pronta. Assine um plano para liberar a franquia mensal de empresas.', action: ['Ver planos', '/conta']}
        },
    quota: {
      badge: 'Franquia esgotada', tone: 'warn', button: 'Ver planos',
      banner: {title: 'A franquia deste mês acabou', text: 'Ela é renovada no próximo ciclo. Se precisar de mais empresas agora, troque para um plano maior.', action: ['Ver planos', '/conta']}
    },
    ready: {badge: `${plural(sub.remaining || 0, 'empresa disponível', 'empresas disponíveis')}`, tone: 'ok', button: 'Buscar empresas'}
  };
  return copy[kind];
}

function renderAccess() {
  const kind = access();
  const copy = accessCopy(kind);
  const badge = $('mode-badge');
  badge.textContent = copy.badge;
  badge.dataset.tone = copy.tone;

  const banner = $('access-banner');
  banner.hidden = !copy.banner || state.view !== 'discover';
  if (copy.banner) {
    banner.dataset.tone = kind === 'demo' ? 'info' : 'warn';
    $('banner-title').textContent = copy.banner.title;
    $('banner-text').textContent = copy.banner.text;
    const action = $('banner-action');
    action.hidden = !copy.banner.action;
    if (copy.banner.action) {
      const [label, href] = copy.banner.action;
      action.textContent = label;
      action.href = href;
      const external = /^https?:/.test(href);
      action.target = external ? '_blank' : '';
      action.rel = external ? 'noopener' : '';
    }
  }

  const button = $('search-button');
  if (!state.searching) button.textContent = copy.button;
  const tooSmall = kind === 'ready' && Number($('limit').value) > (state.user.subscription.remaining || 0);
  button.disabled = state.searching || kind === 'loading' || kind === 'off' || kind === 'error' || tooSmall;
}

function renderPreview() {
  const el = $('query-preview');
  const niche = $('niche').value.trim();
  const place = $('location').value.trim();
  const limit = Number($('limit').value);
  const kind = access();
  if (niche.length < 2 || place.length < 2) {
    el.textContent = 'Digite um segmento e uma cidade. As sugestões aparecem enquanto você escreve.';
    return;
  }
  let html = `Prévia: <b>${esc(niche)}</b> em <b>${esc(place)}</b> · até ${limit} empresas`;
  if (kind === 'demo') html += ' · resultados fictícios';
  if (kind === 'ready') {
    const remaining = state.user.subscription.remaining || 0;
    html += remaining >= limit
      ? ` · usa até ${limit} das ${remaining} empresas restantes do seu plano`
      : ` · <span class="warn-text">restam só ${remaining} empresas no seu plano; escolha um limite menor</span>`;
  }
  el.innerHTML = html;
}

/* ---------- Account ---------- */

function renderAccount() {
  const user = state.user;
  const sub = user?.subscription || {};
  const active = isActive(user);
  $('account-email').textContent = user ? (user.name ? `${user.name} · ${user.email}` : user.email) : 'Você não entrou';
  $('account-plan').textContent = user ? (sub.planName || 'Sem plano') : 'Entre para ver seu plano';
  const chip = $('account-status');
  const label = STATUS_LABELS[sub.status];
  chip.hidden = !user || !label;
  chip.textContent = label || '';
  chip.dataset.tone = active ? 'ok' : 'warn';
  $('quota').hidden = !active;
  if (active) {
    $('quota-bar').max = Math.max(1, sub.quota || 0);
    $('quota-bar').value = sub.remaining || 0;
    $('account-quota').textContent = `${sub.remaining || 0} de ${sub.quota || 0} empresas restantes este mês`;
  }
  $('login-link').hidden = !!user;
  $('logout').hidden = !user;
  $('plan-link').textContent = active ? 'Gerenciar plano' : 'Ver planos';
  const pill = $('session-pill');
  pill.textContent = user ? user.email : 'Entrar';
  pill.href = user ? '/conta' : '/entrar';
  pill.title = user ? 'Conta e plano' : 'Entrar ou criar conta';
}

function updateQuota(quota) {
  if (!quota || !state.user?.subscription) return;
  for (const key of ['remaining', 'quota', 'reserved']) {
    if (typeof quota[key] === 'number') state.user.subscription[key] = quota[key];
  }
  renderAccount();
}

/* ---------- Results ---------- */

function filters() {
  return {
    text: fold($('filter-text').value.trim()),
    category: $('category-filter').value,
    website: $('website-filter').value,
    phone: $('phone-filter').value,
    sort: $('sort').value
  };
}

function resetFilters() {
  $('filter-text').value = '';
  $('category-filter').value = '';
  $('website-filter').value = 'all';
  $('phone-filter').value = 'all';
}

const source = () => state.view === 'saved' ? saved : state.results;

const sorters = {
  name: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
  rating: (a, b) => (b.rating || 0) - (a.rating || 0) || b.reviews - a.reviews,
  reviews: (a, b) => b.reviews - a.reviews
};

function visible() {
  const f = filters();
  return source()
    .filter(r => !f.text || fold(`${r.name} ${r.category} ${r.address}`).includes(f.text))
    .filter(r => !f.category || r.category === f.category)
    .filter(r => f.website === 'all' || (f.website === 'missing' ? !r.website : !!r.website))
    .filter(r => f.phone === 'all' || (f.phone === 'yes' ? !!r.phone : !r.phone))
    .sort(sorters[f.sort] || sorters.reviews);
}

function setOptionLabels(id, labels) {
  for (const option of $(id).options) option.textContent = labels[option.value] ?? option.textContent;
}

function renderFilterOptions(data) {
  const count = test => data.filter(test).length;
  const n = value => data.length ? ` (${value})` : '';
  setOptionLabels('website-filter', {
    all: `Site: todos${n(data.length)}`,
    missing: `Sem site listado${n(count(r => !r.website))}`,
    present: `Com site${n(count(r => r.website))}`
  });
  setOptionLabels('phone-filter', {
    all: `Telefone: todos${n(data.length)}`,
    yes: `Com telefone${n(count(r => r.phone))}`,
    no: `Sem telefone${n(count(r => !r.phone))}`
  });
  const categories = new Map();
  for (const r of data) if (r.category) categories.set(r.category, (categories.get(r.category) || 0) + 1);
  const select = $('category-filter');
  const current = select.value;
  select.innerHTML = `<option value="">Categoria: todas${n(data.length)}</option>` +
    [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
      .map(([name, total]) => `<option value="${esc(name)}">${esc(name)} (${total})</option>`).join('');
  select.value = categories.has(current) ? current : '';
  select.disabled = !categories.size;
  for (const id of ['filter-text', 'website-filter', 'phone-filter', 'sort']) $(id).disabled = !data.length;
}

function renderChips() {
  const chips = [];
  const text = $('filter-text').value.trim();
  if (text) chips.push(['text', `“${text}”`]);
  if ($('category-filter').value) chips.push(['category', $('category-filter').value]);
  if ($('website-filter').value !== 'all') chips.push(['website', $('website-filter').value === 'missing' ? 'Sem site listado' : 'Com site']);
  if ($('phone-filter').value !== 'all') chips.push(['phone', $('phone-filter').value === 'yes' ? 'Com telefone' : 'Sem telefone']);
  $('active-filters').innerHTML = chips.map(([key, label]) =>
    `<button type="button" class="chip" data-clear="${key}" aria-label="Remover filtro ${esc(label)}">${esc(label)} <span aria-hidden="true">✕</span></button>`
  ).join('') + (chips.length ? '<button type="button" class="chip-clear" data-clear="all">Limpar filtros</button>' : '');
  return chips.length;
}

function rowHtml(r) {
  const id = esc(r.id);
  const website = safeUrl(r.website);
  const tel = telHref(r.phone);
  const selected = isSaved(r.id);
  const details = [r.category, r.address].filter(Boolean).join(' · ');
  return `<tr>
    <td class="company"><button type="button" class="name" data-open="${id}">${esc(r.name)}</button>${details ? `<small>${esc(details)}</small>` : ''}</td>
    <td>${website ? `<a href="${esc(website)}" target="_blank" rel="noopener" title="${esc(website)}">${esc(hostname(website))} ↗</a>` : '<span class="tag">Sem site listado</span>'}</td>
    <td>${r.phone ? (tel ? `<a href="${esc(tel)}">${esc(r.phone)}</a>` : esc(r.phone)) : '<span class="muted">Sem telefone</span>'}</td>
    <td>${r.rating ? `<span class="rating">★ ${formatRating(r.rating)}</span>` : '<span class="muted">Sem nota</span>'}<small>${plural(Number(r.reviews) || 0, 'avaliação', 'avaliações')}</small></td>
    <td class="save-cell"><button type="button" class="save${selected ? ' selected' : ''}" data-save="${id}" aria-pressed="${selected}">${selected ? '✓ Salva' : '+ Salvar'}</button></td>
  </tr>`;
}

const skeleton = () => Array.from({length: 4}, () => '<tr class="skeleton" aria-hidden="true"><td><span></span><small><span></span></small></td><td><span></span></td><td><span></span></td><td><span></span></td><td><span></span></td></tr>').join('');

function renderEmpty(data, rows, filtered) {
  const empty = $('empty');
  const action = $('empty-action');
  empty.hidden = rows.length > 0 || (state.searching && state.view === 'discover');
  action.hidden = true;
  let title = 'Sua lista começa aqui.';
  let text = 'Escolha um segmento e uma cidade acima para ver as empresas.';
  if (state.view === 'saved' && !data.length) {
    title = 'Nenhuma empresa salva ainda';
    text = 'Use “+ Salvar” nos resultados para montar sua lista. Ela fica guardada neste navegador.';
    action.hidden = false;
    action.textContent = 'Buscar empresas';
    action.dataset.action = 'discover';
  } else if (data.length && filtered) {
    title = 'Nenhuma empresa com esses filtros';
    text = 'Remova algum filtro para ver mais resultados.';
    action.hidden = false;
    action.textContent = 'Limpar filtros';
    action.dataset.action = 'clear';
  } else if (state.query && !data.length) {
    title = 'Nenhuma empresa encontrada';
    text = 'Tente um segmento mais amplo (por exemplo, “Dentista” em vez de uma especialidade) ou uma cidade próxima.';
  } else if (access() === 'login') {
    text = 'Entre na sua conta para buscar empresas reais.';
  } else if (access() === 'off') {
    text = 'Assim que a busca for ativada, os resultados aparecem aqui.';
  }
  $('empty-title').textContent = title;
  $('empty-text').textContent = text;
}

function render() {
  const discover = state.view === 'discover';
  const data = source();
  const rows = visible();
  $('intro').hidden = !discover;
  $('search-form').hidden = !discover;
  for (const [id, current] of [['discover', discover], ['saved', !discover]]) {
    $(id).classList.toggle('active', current);
    if (current) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
  $('crumb-view').textContent = discover ? 'Buscar empresas' : 'Empresas salvas';
  $('result-label').textContent = discover ? (state.demo ? 'DEMONSTRAÇÃO · EMPRESAS FICTÍCIAS' : 'SUAS PRÓXIMAS OPORTUNIDADES') : 'SALVAS NESTE NAVEGADOR';
  $('result-title').textContent = discover ? (state.query ? `${state.query.niche} em ${state.query.location}` : 'Resultados da busca') : 'Empresas salvas';

  renderFilterOptions(data);
  const filtered = renderChips();
  $('rows').innerHTML = state.searching && discover ? skeleton() : rows.map(rowHtml).join('');
  $('count').textContent = !data.length ? '' : rows.length === data.length ? plural(data.length, 'empresa', 'empresas') : `Mostrando ${rows.length} de ${data.length}`;
  renderEmpty(data, rows, filtered);
  $('export').disabled = !rows.length || (state.searching && discover);

  $('total').textContent = state.results.length;
  $('missing').textContent = state.results.filter(r => !r.website).length;
  $('phones').textContent = state.results.filter(r => r.phone).length;
  $('saved-stat').textContent = saved.length;
  $('saved-count').textContent = saved.length;
  const f = filters();
  $('stat-missing').setAttribute('aria-pressed', String(discover && f.website === 'missing'));
  $('stat-phones').setAttribute('aria-pressed', String(discover && f.phone === 'yes'));
  $('stat-saved').setAttribute('aria-pressed', String(!discover));
  $('stat-total').setAttribute('aria-pressed', 'false');
  renderAccess();
}

function renderAll() {
  renderAccount();
  renderPreview();
  render();
}

function setView(view) {
  if (state.view !== view) resetFilters();
  state.view = view;
  if (view === 'saved') setStatus(saved.length ? 'Lista salva neste navegador. Exporte o CSV para guardar uma cópia.' : '');
  else setStatus(state.results.length ? summary() : '');
  render();
}

function summary() {
  if (state.demo) return `${plural(state.results.length, 'empresa fictícia', 'empresas fictícias')} para demonstração.`;
  if (!state.results.length) return '';
  return `${plural(state.results.length, 'empresa encontrada', 'empresas encontradas')}. “Sem site listado” significa que a fonte não informa um site — confirme antes de abordar.${state.cached ? ' Resultado de uma busca recente, sem consumir a franquia de novo.' : ''}`;
}

/* ---------- Search ---------- */

function validate() {
  let valid = true;
  for (const [id, min] of [['niche', 2], ['location', 2]]) {
    const input = $(id);
    const ok = input.value.trim().length >= min;
    input.setAttribute('aria-invalid', String(!ok));
    $(`${id}-error`).hidden = ok;
    if (!ok && valid) input.focus();
    valid &&= ok;
  }
  return valid;
}

function saveForm() {
  writeJSON(localStorage, KEYS.form, {niche: $('niche').value, location: $('location').value, limit: $('limit').value});
}

function restoreForm() {
  const form = readJSON(localStorage, KEYS.form, null);
  if (form) {
    $('niche').value = String(form.niche || '');
    $('location').value = String(form.location || '');
    if ([...$('limit').options].some(option => option.value === form.limit)) $('limit').value = form.limit;
  }
  const last = readJSON(sessionStorage, KEYS.results, null);
  if (last && Array.isArray(last.results) && last.query) {
    state.results = last.results;
    state.demo = last.demo === true;
    state.query = last.query;
  }
}

$('search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const kind = access();
  if (kind === 'login') return void (location.href = '/entrar');
  if (kind === 'plan' || kind === 'quota') return void (location.href = '/conta');
  if (!['ready', 'demo'].includes(kind) || state.searching || !validate()) return;

  const query = {niche: $('niche').value.trim(), location: $('location').value.trim(), limit: Number($('limit').value)};
  state.searching = true;
  state.view = 'discover';
  $('search-button').textContent = 'Buscando…';
  $('search-button').classList.add('loading');
  setStatus('Buscando empresas…');
  render();
  try {
    let body = await api('/api/search', {method: 'POST', headers: CLIENT_HEADERS, body: JSON.stringify({...query, mode: kind === 'demo' ? 'demo' : 'live'})});
    updateQuota(body.quota);
    const jobId = body.jobId;
    for (let i = 0; body.pending && i < 36; i++) {
      setStatus('A fonte de dados está processando a busca. Pode levar alguns minutos — mantenha esta aba aberta.');
      await sleep(5000);
      body = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    }
    if (body.pending) throw new Error('A busca ainda está em processamento. Tente novamente em alguns minutos.');
    state.results = body.leads || [];
    state.demo = body.demo === true;
    state.cached = body.cached === true;
    state.query = query;
    resetFilters();
    remember(query);
    writeJSON(sessionStorage, KEYS.results, {results: state.results, demo: state.demo, query});
    setStatus(summary() || 'Nenhuma empresa encontrada para essa busca.', state.results.length ? 'info' : 'warn');
  } catch (error) {
    setStatus(error.message, 'error');
    if (error.status === 401) state.user = null;
  } finally {
    state.searching = false;
    $('search-button').classList.remove('loading');
    renderAll();
    document.querySelector('.results').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
  }
});

for (const id of ['niche', 'location']) {
  $(id).addEventListener('input', () => {
    if ($(id).value.trim().length >= 2) {
      $(id).removeAttribute('aria-invalid');
      $(`${id}-error`).hidden = true;
    }
    saveForm();
    renderPreview();
  });
}
$('limit').addEventListener('change', () => { saveForm(); renderPreview(); renderAccess(); });
for (const input of document.querySelectorAll('input[name="mode"]')) input.addEventListener('change', renderAll);

combobox($('niche'), suggestionSource(SEGMENTS, 'niche'));
combobox($('location'), suggestionSource(LOCATIONS, 'location'));

/* ---------- Interactions ---------- */

$('filter-text').addEventListener('input', render);
for (const id of ['category-filter', 'website-filter', 'phone-filter', 'sort']) $(id).addEventListener('change', render);

$('active-filters').addEventListener('click', event => {
  const key = event.target.closest('[data-clear]')?.dataset.clear;
  if (!key) return;
  if (key === 'all') resetFilters();
  if (key === 'text') $('filter-text').value = '';
  if (key === 'category') $('category-filter').value = '';
  if (key === 'website') $('website-filter').value = 'all';
  if (key === 'phone') $('phone-filter').value = 'all';
  render();
});

$('empty-action').addEventListener('click', () => {
  if ($('empty-action').dataset.action === 'discover') setView('discover');
  else { resetFilters(); render(); }
});

document.querySelector('.stats').addEventListener('click', event => {
  const stat = event.target.closest('[data-stat]')?.dataset.stat;
  if (!stat) return;
  if (stat === 'saved') return setView('saved');
  const pressed = event.target.closest('[data-stat]').getAttribute('aria-pressed') === 'true';
  setView('discover');
  resetFilters();
  if (!pressed && stat === 'missing') $('website-filter').value = 'missing';
  if (!pressed && stat === 'phones') $('phone-filter').value = 'yes';
  render();
});

$('discover').addEventListener('click', () => setView('discover'));
$('saved').addEventListener('click', () => setView('saved'));

function toggleSave(id) {
  const lead = [...state.results, ...saved].find(item => item.id === id);
  if (!lead) return;
  const wasSaved = isSaved(id);
  const next = wasSaved ? saved.filter(item => item.id !== id) : [...saved, lead];
  if (!writeJSON(localStorage, KEYS.saved, next)) {
    toast('Não foi possível salvar neste navegador. Exporte o CSV para guardar a lista.');
    return;
  }
  saved = next;
  toast(wasSaved ? 'Empresa removida da sua lista.' : 'Empresa salva na sua lista.');
  render();
  if ($('detail').open && detailId === id) renderDetailSave();
}

$('rows').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.save) toggleSave(button.dataset.save);
  else if (button.dataset.open) openDetail(button.dataset.open);
});

let detailId = null;

function renderDetailSave() {
  const selected = isSaved(detailId);
  $('detail-save').textContent = selected ? '✓ Salva na lista' : '+ Salvar na lista';
  $('detail-save').setAttribute('aria-pressed', String(selected));
}

function draftFor(lead) {
  const me = state.user?.name?.trim() || '[seu nome]';
  const segment = (lead.category || state.query?.niche || 'empresas').toLowerCase();
  const where = state.query?.location ? ` em ${state.query.location}` : '';
  return safeUrl(lead.website)
    ? `Olá, equipe da ${lead.name}! Meu nome é ${me}. Encontrei vocês pesquisando ${segment}${where} e tenho uma ideia rápida que pode ajudar a atrair mais clientes. Posso enviar os detalhes por aqui?`
    : `Olá, equipe da ${lead.name}! Meu nome é ${me}. Encontrei vocês pesquisando ${segment}${where} e não localizei um site da empresa. Ajudo negócios como o de vocês a serem encontrados na internet. Posso enviar uma proposta rápida, sem compromisso?`;
}

function openDetail(id) {
  const lead = [...state.results, ...saved].find(item => item.id === id);
  if (!lead) return;
  detailId = id;
  const website = safeUrl(lead.website);
  const tel = telHref(lead.phone);
  const consulted = lead.retrievedAt ? new Date(lead.retrievedAt).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}) : '';
  const items = [
    ['Categoria', esc(lead.category) || '—'],
    ['Endereço', esc(lead.address) || '—'],
    ['Telefone', lead.phone ? (tel ? `<a href="${esc(tel)}">${esc(lead.phone)}</a>` : esc(lead.phone)) : 'Não informado pela fonte'],
    ['Site', website ? `<a href="${esc(website)}" target="_blank" rel="noopener">${esc(hostname(website))} ↗</a>` : 'Não listado na fonte. Confirme antes de afirmar que a empresa não tem site.'],
    ['Avaliações', `${lead.rating ? `★ ${formatRating(lead.rating)} · ` : ''}${plural(Number(lead.reviews) || 0, 'avaliação', 'avaliações')}`],
    ['Fonte', `${esc(lead.source)}${consulted ? ` · consultado em ${esc(consulted)}` : ''}`]
  ];
  $('detail-name').textContent = lead.name;
  $('detail-body').innerHTML = items.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('');
  const sourceUrl = safeUrl(lead.sourceUrl);
  $('detail-source').hidden = !sourceUrl;
  if (sourceUrl) $('detail-source').href = sourceUrl;
  renderDetailSave();
  $('draft').value = draftFor(lead);
  $('copy-draft').textContent = 'Copiar rascunho';
  $('detail').showModal();
}

$('detail-save').addEventListener('click', () => toggleSave(detailId));
$('close-detail').addEventListener('click', () => $('detail').close());
$('detail').addEventListener('click', event => {
  const box = $('detail').getBoundingClientRect();
  const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  if (event.target === $('detail') && outside) $('detail').close();
});
$('copy-draft').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('draft').value);
    $('copy-draft').textContent = '✓ Copiado';
    toast('Rascunho copiado. Revise antes de enviar.');
  } catch {
    $('draft').select();
    $('copy-draft').textContent = 'Use Ctrl+C para copiar';
  }
});

$('export').addEventListener('click', () => {
  const rows = visible();
  const name = state.view === 'saved' ? 'empresas-salvas' : ['leads', slug(state.query?.niche || ''), slug(state.query?.location || '')].filter(Boolean).join('-');
  const url = URL.createObjectURL(new Blob([csv(rows)], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`CSV exportado com ${plural(rows.length, 'empresa', 'empresas')}.`);
});

$('logout').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', {method: 'POST', headers: {'X-Cub4-Client': 'lead-finder'}});
    location.href = '/entrar';
  } catch (error) {
    toast(error.message);
  }
});

/* ---------- Boot ---------- */

restoreForm();
if (state.results.length) setStatus(`Mostrando sua última busca. ${summary()}`);
renderAll();

Promise.all([
  api('/api/config'),
  fetch('/api/me').then(response => response.ok ? response.json() : {user: null}).catch(() => ({user: null}))
]).then(([config, session]) => {
  state.config = config;
  state.user = session.user || null;
  state.loaded = true;
  if (config.live && config.preview) $('mode-switch').hidden = false;
  if (!config.live && config.preview) document.querySelector('input[name="mode"][value="demo"]').checked = true;
  renderAll();
}).catch(() => {
  state.loaded = true;
  state.failed = true;
  renderAll();
});

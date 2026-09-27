const plan = document.getElementById('interest-plan');
const service = document.getElementById('interest-service');
const market = document.getElementById('interest-market');
const brief = document.getElementById('interest-brief');
const status = document.getElementById('copy-status');
const english = document.documentElement.lang === 'en-US';
const hint = status.textContent;
function updateBrief() {
  const price = plan.selectedOptions[0].dataset.price;
  document.getElementById('interest-copy').textContent = english
    ? `${plan.value} — ${price}. Tell us what you sell and where you want to prospect. Launch interest only; no payment or reservation.`
    : `${plan.value} — ${price}. Conte o que você vende e onde deseja prospectar. Interesse no lançamento, sem cobrança ou reserva.`;
  brief.value = english
    ? `I am interested in Lead Finder: ${plan.value} (${price}). I sell: ${service.value}. Target market: ${market.value.trim() || 'To discuss'}. Please confirm launch availability and monthly allowances.`
    : `Tenho interesse no Lead Finder: ${plan.value} (${price}). Vendo: ${service.value}. Mercado desejado: ${market.value.trim() || 'A definir'}. Gostaria de confirmar a disponibilidade no lançamento e a franquia mensal.`;
  status.textContent = hint;
}
document.querySelectorAll('[data-plan]').forEach(link => link.addEventListener('click', () => {
  plan.value = link.dataset.plan;
  updateBrief();
}));
[plan, service, market].forEach(field => field.addEventListener('input', updateBrief));
document.getElementById('copy-brief').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(brief.value);
    status.textContent = english ? 'Copied. Paste your brief in the conversation with cub4Studio.' : 'Copiado. Cole o resumo na conversa com a cub4Studio.';
  } catch {
    brief.focus(); brief.select();
    status.textContent = english ? 'Select and copy the brief above, then paste it in your conversation.' : 'Selecione e copie o resumo acima, depois cole na conversa.';
  }
});
updateBrief();

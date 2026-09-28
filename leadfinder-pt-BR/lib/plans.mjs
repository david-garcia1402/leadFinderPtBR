export const PLANS = Object.freeze({
  essencial: {id:'essencial', name:'Essencial', amount:39.99, currency:'BRL', quota:100, label:'R$ 39,99 / mês'},
  profissional: {id:'profissional', name:'Profissional', amount:59.99, currency:'BRL', quota:300, label:'R$ 59,99 / mês'},
  escala: {id:'escala', name:'Escala', amount:89.99, currency:'BRL', quota:600, label:'R$ 89,99 / mês'}
});

export function getPlan(id) {
  return PLANS[String(id || '').trim().toLowerCase()] || null;
}

export function listPlans() {
  return Object.values(PLANS).map(plan => ({...plan}));
}

export function currentMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function periodEnd(from = new Date()) {
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

export function publicSubscription(sub, now = new Date()) {
  if (!sub) return {status:'none', planId:null, quota:0, reserved:0, remaining:0, periodEnd:null};
  const plan = getPlan(sub.planId);
  const month = currentMonth(now);
  const reserved = sub.month === month ? Number(sub.reserved) || 0 : 0;
  const quota = plan && isActiveStatus(sub.status) ? plan.quota : 0;
  return {
    status: sub.status,
    planId: plan ? plan.id : null,
    planName: plan ? plan.name : null,
    quota,
    reserved,
    remaining: Math.max(0, quota - reserved),
    periodEnd: sub.currentPeriodEnd || null,
    provider: sub.provider || null
  };
}

export function isActiveStatus(status) {
  return status === 'authorized' || status === 'active';
}

import {normalize} from './leads.mjs';
const base='https://api.outscraper.com';
export const LIVE_UNAVAILABLE='A busca de empresas ainda não foi ativada neste servidor. Fale com o suporte da cub4Studio.';
// A chave do provedor basta para ligar a busca; ENABLE_LIVE_SEARCH=false continua desligando explicitamente.
export const liveSearchEnabled=env=>!!String(env.OUTSCRAPER_API_KEY||'').trim()&&env.ENABLE_LIVE_SEARCH!=='false';
async function request(path, key) {
 const res=await fetch(base+path,{headers:{'X-API-KEY':key},signal:AbortSignal.timeout(45000)});
 if(res.status===204) throw new Error('O provedor não conseguiu concluir esta busca.');
 if(res.status===401||res.status===403) throw Object.assign(new Error('A chave do provedor de dados foi recusada. Fale com o suporte da cub4Studio.'),{status:502});
 if(res.status===402) throw Object.assign(new Error('O provedor de dados está sem créditos no momento. Fale com o suporte da cub4Studio.'),{status:502});
 if(!res.ok) throw Object.assign(new Error(`O provedor de dados retornou erro ${res.status}. Tente novamente em alguns minutos.`),{status:502});
 const data=await res.json();
 if(data.status==='Failure'||data.error) throw new Error('O provedor não conseguiu concluir esta busca.');
 if(data.status==='Pending'||res.status===202) return {pending:true,providerId:data.id};
 return {pending:false,leads:(data.data||[]).flat().filter(x=>x&&x.name).map(x=>normalize(x))};
}
export const beginSearch=(s,key)=>request('/google-maps-search?'+new URLSearchParams({query:`${s.niche}, ${s.location}`,limit:String(s.limit),async:'true',language:'pt',region:'BR'}),key);
export const checkSearch=(id,key)=>request('/requests/'+encodeURIComponent(id),key);

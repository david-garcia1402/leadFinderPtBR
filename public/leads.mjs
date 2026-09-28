export function normalize(raw, demo = false) {
 const website = /^https?:\/\//i.test(raw.site || '') ? raw.site : '';
 return {id:String(raw.place_id || raw.google_id || `${raw.name}|${raw.full_address}`),name:String(raw.name || 'Empresa sem nome'),category:String(raw.type || raw.category || ''),address:String(raw.full_address || ''),phone:String(raw.phone || ''),website,rating:Number(raw.rating)||null,reviews:Number(raw.reviews)||0,source:demo?'Dados ilustrativos':'Outscraper / Google Maps',sourceUrl:/^https?:\/\//i.test(raw.location_link||'')?raw.location_link:'',retrievedAt:new Date().toISOString(),demo};
}
export function demoLeads(niche, location, limit) {
 return ['Northline','Juniper','Parkside','Oak & Co.','Union','Brightway','West End','Cedar House','The Local','Brookside','Summit','Horizon'].slice(0,limit).map((n,i)=>normalize({name:`${n} ${niche} (exemplo)`,place_id:`demo-${niche}-${location}-${i}`,type:niche,full_address:`${location} · Exemplo fictício`,site:i%3===0?'':`https://example.com/business-${i}`,phone:i%4===0?'':`+1 202-555-${String(100+i).padStart(4,'0')}`,rating:4+(i%10)/10,reviews:15+i*23},true));
}
export function validateSearch(body) {
 const niche=String(body.niche||'').trim(), location=String(body.location||'').trim(), limit=Number(body.limit??10);
 if(niche.length<2||niche.length>80||location.length<2||location.length>100||!Number.isInteger(limit)||limit<1||limit>25) throw new Error('Informe segmento, localização e um limite de 1 a 25.');
 return {niche,location,limit};
}
export function csv(rows) {
 const keys=['name','category','address','phone','website','rating','reviews','source','sourceUrl','retrievedAt','demo'];
 const cell=v=>'"'+String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replaceAll('"','""')+'"';
 return '\ufeff'+[keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');
}

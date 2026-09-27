import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('launch defaults reject fictional data, support landing/workspace and respect configured HTTPS origin', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lf-launch-'));
 const proc=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4191',HOST:'127.0.0.1',DATA_DIR:dir,APP_ORIGIN:'https://leadfinder.example',PUBLIC_SITE_URL:'https://leadfinder.example',EN_SITE_URL:'https://leadfinder.example',PT_BR_SITE_URL:'https://br.example',ENABLE_SAMPLE_DATA:'false',ENABLE_LIVE_SEARCH:'false'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{proc.stdout.once('data',resolve);proc.once('error',reject);proc.once('exit',c=>reject(new Error('Exit '+c)));});
  const base='http://127.0.0.1:4191';
  assert.deepEqual(await (await fetch(base+'/api/config')).json(),{live:false,preview:false,auth:true,billing:{provider:'kiwify',label:'Kiwify',configured:false,currency:'BRL',checkoutKind:'hosted'}});
  for(const route of ['/','/app','/entrar','/conta','/logo.svg','/landing.css','/landing.js','/auth.js','/account.js'])assert.equal((await fetch(base+route)).status,200);
  for(const route of ['/fonts/plus-jakarta-sans-latin-wght-normal.woff2','/fonts/plus-jakarta-sans-latin-wght-italic.woff2']){const font=await fetch(base+route);assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/woff2');}
  assert.match(await (await fetch(base+'/robots.txt')).text(), /Sitemap: https:\/\/leadfinder.example\/sitemap.xml/);
  assert.match(await (await fetch(base+'/sitemap.xml')).text(), /<loc>https:\/\/leadfinder.example\/<\/loc>/);
  assert.equal((await fetch(base+'/app')).headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await fetch(base+'/entrar')).headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await fetch(base+'/conta')).headers.get('x-robots-tag'), 'noindex, nofollow');
  const landing = await fetch(base+'/');
  assert.match(landing.headers.get('content-security-policy'), /sha256-/);
  assert.match(await landing.text(), /rel="canonical" href="https:\/\/leadfinder.example\/"/);
  const req=mode=>fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json','X-Cub4-Client':'lead-finder',Origin:'https://leadfinder.example'},body:JSON.stringify({niche:'Dentist',location:'Austin',limit:2,mode})});
  assert.equal((await req('demo')).status,503);
  assert.equal((await req('live')).status,503);
  assert.equal((await req('invalid')).status,400);
  assert.equal((await fetch(base+'/.data/usage.json')).status,404);
 }finally{proc.kill();await rm(dir,{recursive:true,force:true});}
});

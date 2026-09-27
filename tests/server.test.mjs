import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('HTTP demo, disabled live mode and static-file boundary',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lf-http-'));
 const proc=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4189',HOST:'127.0.0.1',DATA_DIR:dir,ENABLE_LIVE_SEARCH:'false',ENABLE_SAMPLE_DATA:'true'},stdio:['ignore','pipe','pipe']});
 try{await new Promise((resolve,reject)=>{proc.stdout.once('data',resolve);proc.once('error',reject);proc.once('exit',code=>reject(new Error('Server exited '+code)));});
 const base='http://127.0.0.1:4189';
 const config=await (await fetch(base+'/api/config')).json();
 assert.equal(config.live,false);
 assert.equal(config.auth,true);
 assert.equal(config.billing.provider,'kiwify');
 assert.equal(config.billing.configured,false);
 const req=mode=>fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json','X-Cub4-Client':'lead-finder'},body:JSON.stringify({niche:'Dentist',location:'Austin',limit:2,mode})});
 const demo=await (await req('demo')).json();assert.equal(demo.leads.length,2);assert.equal(demo.demo,true);
 assert.equal((await req('live')).status,503);
 assert.equal((await fetch(base+'/.env')).status,404);
 assert.equal((await fetch(base+'/api/search',{method:'POST',headers:{'X-Cub4-Client':'lead-finder',Origin:'https://evil.example'}})).status,403);
 }finally{proc.kill();await rm(dir,{recursive:true,force:true});}
});

test('auth session, checkout gate and signed webhook',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lf-auth-http-'));
 const proc=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4193',HOST:'127.0.0.1',DATA_DIR:dir,ENABLE_LIVE_SEARCH:'true',OUTSCRAPER_API_KEY:'test-key',ENABLE_SAMPLE_DATA:'false',MP_WEBHOOK_SECRET:'whsec',APP_ORIGIN:'http://127.0.0.1:4193'},stdio:['ignore','pipe','pipe']});
 try{await new Promise((resolve,reject)=>{proc.stdout.once('data',resolve);proc.once('error',reject);proc.once('exit',code=>reject(new Error('Server exited '+code)));});
 const base='http://127.0.0.1:4193';
 const headers={'Content-Type':'application/json','X-Cub4-Client':'lead-finder',Origin:'http://127.0.0.1:4193'};
 assert.equal((await fetch(base+'/api/me')).status,401);
 const created=await fetch(base+'/api/auth/register',{method:'POST',headers,body:JSON.stringify({email:'user@example.com',password:'senha-forte',name:'User'})});
 assert.equal(created.status,201);
 const cookie=created.headers.get('set-cookie');
 assert.match(cookie,/lf_session=/);
 assert.match(cookie,/HttpOnly/);
 const me=await (await fetch(base+'/api/me',{headers:{cookie}})).json();
 assert.equal(me.user.email,'user@example.com');
 assert.equal(me.user.subscription.status,'none');
 const live=await fetch(base+'/api/search',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({niche:'Dentist',location:'Austin',limit:2,mode:'live'})});
 assert.equal(live.status,402);
 const checkout=await fetch(base+'/api/billing/checkout',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({planId:'essencial'})});
 assert.equal(checkout.status,503);
 assert.equal((await fetch(base+'/api/billing/webhook/mercadopago',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'payment',data:{id:'1'}})})).status,401);
 const plans=await (await fetch(base+'/api/plans')).json();
 assert.equal(plans.plans.length,3);
 }finally{proc.kill();await rm(dir,{recursive:true,force:true});}
});

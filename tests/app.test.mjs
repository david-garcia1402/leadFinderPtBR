import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
import {createApp} from '../lib/app.mjs';

const origin = 'https://leadfinder.example';
const headers = {'Content-Type': 'application/json', 'X-Cub4-Client': 'lead-finder', Origin: origin};

test('Worker search jobs survive a different isolate and failed provider calls release quota', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lf-app-'));
  const realFetch = globalThis.fetch;
  try {
    const store = await createStore(join(dir, 'accounts.json'));
    const env = {OUTSCRAPER_API_KEY: 'test-key', APP_ORIGIN: origin};
    const make = () => createApp({env, store, loadAsset: async () => null});
    const first = await make();
    const second = await make();
    assert.equal(first.live, true);

    const created = await first.handle(new Request(`${origin}/api/auth/register`, {method: 'POST', headers, body: JSON.stringify({email: 'w@example.com', password: 'senha-forte'})}));
    const cookie = created.headers.get('set-cookie').split(';')[0];
    const {user} = await created.json();
    await first.billing.activateForTests(user.id, 'essencial');

    const provider = [];
    globalThis.fetch = async url => {
      provider.push(String(url));
      const next = provider.length === 1
        ? {status: 202, body: {status: 'Pending', id: 'prov-1'}}
        : provider.length === 2
          ? {status: 200, body: {status: 'Success', data: [[{name: 'Clínica Real', place_id: 'p1', site: 'https://real.example'}]]}}
          : {status: 402, body: {}};
      return new Response(JSON.stringify(next.body), {status: next.status});
    };

    const search = body => first.handle(new Request(`${origin}/api/search`, {method: 'POST', headers: {...headers, cookie}, body: JSON.stringify({niche: 'Dentista', location: 'Recife, PE', limit: 10, mode: 'live', ...body})}));
    const pending = await search({});
    assert.equal(pending.status, 202);
    const {jobId, quota} = await pending.json();
    assert.equal(quota.remaining, 90);
    assert.match(provider[0], /language=pt/);
    assert.match(provider[0], /region=BR/);

    const tampered = await second.handle(new Request(`${origin}/api/jobs/${jobId.replace(/.$/, c => c === 'A' ? 'B' : 'A')}`, {headers: {cookie}}));
    assert.equal(tampered.status, 404);
    const done = await second.handle(new Request(`${origin}/api/jobs/${jobId}`, {headers: {cookie}}));
    assert.equal(done.status, 200);
    assert.equal((await done.json()).leads[0].name, 'Clínica Real');

    const realNow = Date.now;
    Date.now = () => realNow() + 11000;
    const failed = await search({niche: 'Academia'}).finally(() => { Date.now = realNow; });
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, /sem créditos/);
    assert.equal(first.billing.statusFor(user.id).remaining, 90);
  } finally {
    globalThis.fetch = realFetch;
    await rm(dir, {recursive: true, force: true});
  }
});

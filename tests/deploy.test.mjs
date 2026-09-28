import test from 'node:test';
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';

test('wrangler config points at the static site the Cloudflare deploy can see', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'leadfinder-pt-br');
  assert.equal(config.main, 'src/worker.mjs');
  assert.equal(config.assets.directory, './public');
  assert.equal(config.assets.binding, 'ASSETS');
  assert.equal(config.d1_databases[0].binding, 'DB');
  assert.equal(config.d1_databases[0].database_name, 'leadfinder-db');
  await access(new URL('../src/worker.mjs', import.meta.url));
  await access(new URL('../public/index.html', import.meta.url));
  await access(new URL('../public/_redirects', import.meta.url));
});

test('every module the Worker serves exists in the assets directory', async () => {
  const source = await readFile(new URL('../lib/app.mjs', import.meta.url), 'utf8');
  const assets = [...source.matchAll(/^\s*'[^']+': '(\/[^']+)',?$/gm)].map(match => match[1]);
  assert.ok(assets.includes('/suggestions.mjs'));
  for (const asset of assets) await access(new URL(`../public${asset}`, import.meta.url));
  assert.equal(await readFile(new URL('../public/leads.mjs', import.meta.url), 'utf8'), await readFile(new URL('../lib/leads.mjs', import.meta.url), 'utf8'));
});

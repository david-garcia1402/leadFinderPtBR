import test from 'node:test';
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';

test('wrangler configs point at the static site the Cloudflare deploy can see', async () => {
  const root = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  const nested = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(root.name, 'leadfinder-pt-br');
  assert.equal(root.main, 'leadfinder-pt-BR/src/worker.mjs');
  assert.equal(root.assets.directory, './leadfinder-pt-BR/public');
  assert.equal(root.assets.binding, 'ASSETS');
  assert.equal(root.d1_databases[0].binding, 'DB');
  assert.equal(root.d1_databases[0].database_name, 'leadfinder-db');
  assert.equal(nested.name, 'leadfinder-pt-br');
  assert.equal(nested.main, 'src/worker.mjs');
  assert.equal(nested.assets.directory, './public');
  assert.equal(nested.assets.binding, 'ASSETS');
  assert.equal(nested.d1_databases[0].database_id, root.d1_databases[0].database_id);
  await access(new URL('../public/index.html', import.meta.url));
  await access(new URL('../public/_redirects', import.meta.url));
});

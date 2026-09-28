import test from 'node:test';
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';

test('wrangler configs point at the static site the Cloudflare deploy can see', async () => {
  const root = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  const nested = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(root.name, 'leadfinder-pt-br');
  assert.equal(root.assets.directory, './leadfinder-pt-BR/public');
  assert.equal(nested.name, 'leadfinder-pt-br');
  assert.equal(nested.assets.directory, './public');
  await access(new URL('../public/index.html', import.meta.url));
  await access(new URL('../public/_redirects', import.meta.url));
});

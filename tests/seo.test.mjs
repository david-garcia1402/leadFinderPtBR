import test from 'node:test';
import assert from 'node:assert/strict';
import {seoLinks,robots,sitemap,publicOrigin} from '../lib/seo.mjs';
import {readFile} from 'node:fs/promises';
test('SEO uses configured HTTPS origins and reciprocal locale links only', () => {
  for (const value of ['javascript:alert(1)', 'https://u:p@example.com', 'https://example.com/path', 'http://localhost:4173', 'garbage']) assert.equal(publicOrigin(value), null);
  assert.equal(seoLinks({}), ''); assert.equal(sitemap({}), null);
  assert.match(robots({}), /Disallow: \/$/m);
  const env = {PUBLIC_SITE_URL:'https://en.example.com', EN_SITE_URL:'https://en.example.com', PT_BR_SITE_URL:'https://br.example.com'};
  assert.match(seoLinks(env), /hreflang="pt-BR"/);
  assert.match(seoLinks(env), /rel="canonical" href="https:\/\/en.example.com\/"/);
  assert.match(sitemap(env), /<loc>https:\/\/en.example.com\/<\/loc>/);
  assert.match(robots(env), /Disallow: \/api\//);
  assert.match(robots(env), /Disallow: \/entrar/);
  assert.match(robots(env), /Disallow: \/conta/);
  assert.doesNotMatch(seoLinks({...env, PUBLIC_SITE_URL:'https://other.example.com'}), /hreflang/);
});
test('localized pricing and plan handoff agree, without claiming active subscriptions', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const english = html.includes('lang="en-US"');
  const prices = english ? ['$9.99 USD / month', '$19.99 USD / month', '$29.99 USD / month'] : ['R$ 39,99 / mês', 'R$ 59,99 / mês', 'R$ 89,99 / mês'];
  const cards = [...html.matchAll(/<div class="price">(.*?)<\/div>/g)].map(m=>m[1].replace(/<[^>]+>/g,''));
  assert.deepEqual(cards, prices);
  for (const price of prices) assert.equal(html.split(`data-price="${price}"`).length - 1, 2);
  assert.match(html, english ? /Subscriptions are not available yet/ : /Assinaturas ainda não disponíveis/);
  const json = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(json['@type'], 'SoftwareApplication'); assert.equal(json.offers, undefined);
  assert.match(await readFile('public/workspace.html','utf8'), /noindex, nofollow/);
});

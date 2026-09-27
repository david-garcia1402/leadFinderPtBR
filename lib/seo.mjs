// Only explicit deployment configuration may supply canonical URLs; never trust Host.
export function publicOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function seoLinks(env = process.env) {
  const origin = publicOrigin(env.PUBLIC_SITE_URL);
  if (!origin) return '';
  let links = `<link rel="canonical" href="${escape(origin)}/"><meta property="og:url" content="${escape(origin)}/">`;
  const en = publicOrigin(env.EN_SITE_URL), pt = publicOrigin(env.PT_BR_SITE_URL);
  if (en && pt && en !== pt && [en, pt].includes(origin)) {
    links += `<link rel="alternate" hreflang="en-US" href="${escape(en)}/"><link rel="alternate" hreflang="pt-BR" href="${escape(pt)}/">`;
  }
  return links;
}
export function robots(env = process.env) {
  const origin = publicOrigin(env.PUBLIC_SITE_URL);
  return origin ? `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /entrar\nDisallow: /conta\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
}
export function sitemap(env = process.env) {
  const origin = publicOrigin(env.PUBLIC_SITE_URL);
  return origin ? `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(origin)}/</loc></url></urlset>` : null;
}

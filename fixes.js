/* fixes.js — copy-ready fixes for failing audit checks.
 *
 * The audit says what is wrong; this file writes the change. Every snippet is built from what the scan
 * found on the page (its real image addresses and sizes, its own title, its canonical address, the
 * scripts that block rendering) so it can be pasted rather than retyped. Anything that has to be
 * written by a person, such as alt text or a price, is a clearly marked draft.
 *
 *   fixFor(label, data)  ->  { where, code, note } or null
 *   fixBundle(issues)    ->  one text block, grouped by where each piece goes
 *
 * shell.js attaches the result to each check as `fixCode`. Checks that build their own snippet
 * (structured data, links, headers) pass `fixCode` directly and skip this table.
 */

const FIX_WHERE = {
  head: 'Add inside <head>',
  html: 'Change the <html> tag',
  body: 'Change in your HTML',
  css: 'Add to your CSS',
  robots: 'Add to robots.txt',
  json: 'Add inside <head>',
  headers: 'Set on your server'
};

/* ------------------------------------------------------------------ small helpers */
// an ampersand is only escaped where it could be read as the start of a character reference, so
// addresses with query strings stay readable (?a=1&b=2)
const fxAttr = (s) => String(s == null ? '' : s).replace(/&(?=#?\w+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fxClean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function fxTrim(s, n) {
  s = fxClean(s);
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1);
  const at = cut.lastIndexOf(' ');
  return (at > n * 0.6 ? cut.slice(0, at) : s.slice(0, n)).replace(/[\s,;:|–—-]+$/, '');
}

// the longest run of whole sentences that fits
function fxSentences(s, n) {
  s = fxClean(s);
  if (s.length <= n) return s;
  const parts = s.match(/[^.!?]+[.!?]+(\s|$)/g) || [];
  let out = '';
  for (const p of parts) { if ((out + p).trim().length > n) break; out += p; }
  return out.trim() || fxTrim(s, n);
}

function fxOrigin(d) { try { return new URL(d.meta.pageUrl).origin; } catch (e) { return ''; } }
function fxIsHome(d) { try { return new URL(d.meta.pageUrl).pathname.replace(/\/+$/, '') === ''; } catch (e) { return false; } }

function fxCanonical(d) {
  try {
    const u = new URL(d.meta.pageUrl);
    u.hash = '';
    const keep = [];
    u.searchParams.forEach((v, k) => { if (!/^(utm_|fbclid|gclid|mc_|ref$)/i.test(k)) keep.push([k, v]); });
    u.search = '';
    keep.forEach(([k, v]) => u.searchParams.append(k, v));
    return u.href;
  } catch (e) { return (d.meta && d.meta.pageUrl) || ''; }
}

function fxBrand(d) {
  const og = (d.seo && d.seo.ogSiteName) || '';
  if (og) return fxClean(og);
  try {
    const first = new URL(d.meta.pageUrl).hostname.replace(/^www\./, '').split('.')[0];
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : '';
  } catch (e) { return ''; }
}

function fxH1(d) { const h = (d.outline || []).filter(x => String(x.tag).toLowerCase() === 'h1')[0]; return h ? fxClean(h.text) : ''; }
function fxFacts(d) { return (d.insights && d.insights.facts) || {}; }
function fxImages(d) { return (d.insights && d.insights.images && d.insights.images.items) || []; }

// the page title, rewritten to fit
function fxTitle(d) {
  const brand = fxBrand(d);
  const base = fxH1(d) || fxClean(d.socialMeta && d.socialMeta.og && d.socialMeta.og.title) || fxClean(d.meta && d.meta.title) || brand;
  let t = base;
  if (brand && base.toLowerCase().indexOf(brand.toLowerCase()) < 0 && (base + ' | ' + brand).length <= 60) t = base + ' | ' + brand;
  return fxTrim(t, 60);
}

function fxDescription(d) {
  const lead = fxFacts(d).lead;
  const pool = [lead, d.socialMeta && d.socialMeta.og && d.socialMeta.og.description, d.meta && d.meta.description].filter(Boolean);
  const best = pool.filter(p => fxClean(p).length >= 100)[0] || pool[0] || '';
  return best ? fxSentences(best, 158) : '';
}

// a src that reads well in a snippet: path only for this site's own files
function fxSrc(url, d) {
  try {
    const u = new URL(url, d && d.meta && d.meta.pageUrl);
    return u.origin === fxOrigin(d || {}) ? u.pathname + u.search : u.href;
  } catch (e) { return url; }
}

function fxSplitName(src) {
  const m = String(src).match(/^(.*?)(?:\.([a-z0-9]{2,5}))?(\?.*)?$/i);
  return { base: m ? m[1] : src, ext: m && m[2] ? m[2] : 'jpg', q: m && m[3] ? m[3] : '' };
}

// "summer-sale_hero-1200x600.jpg" -> "Summer sale hero"
function fxFileAlt(url) {
  try {
    const f = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    const w = f.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_]+\d{2,4}x\d{2,4}$/i, '').replace(/[-_@]+\d?x?$/i, '').replace(/[-_.]+/g, ' ').replace(/\b\d{5,}\b/g, '').trim();
    if (!w || /^[a-f0-9\s]{12,}$/i.test(w)) return 'Describe the image';
    return w.charAt(0).toUpperCase() + w.slice(1);
  } catch (e) { return 'Describe the image'; }
}

function fxLabelText(f) {
  const t = fxClean(f.placeholder) || fxClean(String(f.name || f.id || f.type || 'Field').replace(/[\[\]_-]+/g, ' '));
  const map = { email: 'Email address', tel: 'Phone number', search: 'Search', password: 'Password', url: 'Website', number: 'Number', date: 'Date', textarea: 'Message' };
  const base = fxClean(f.placeholder) ? t : (map[f.type] || t);
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/* ------------------------------------------------------------------ structured data starters */
function fxJsonLd(d, kind) {
  const origin = fxOrigin(d), canon = fxCanonical(d), brand = fxBrand(d);
  const og = (d.socialMeta && d.socialMeta.og) || {};
  const seo = d.seo || {};
  const image = og.image || (d.images || [])[0] || '';
  const desc = fxDescription(d) || (d.meta && d.meta.description) || '';
  const title = fxH1(d) || fxClean(d.meta && d.meta.title) || brand;
  const sameAs = ((d.mediaContact && d.mediaContact.socialLinks) || []).map(s => s.url || s.href).filter(Boolean).slice(0, 6);
  const today = new Date().toISOString().slice(0, 10);

  const org = { '@type': 'Organization', '@id': origin + '/#organization', name: brand, url: origin + '/' };
  if (d.faviconUrl) org.logo = d.faviconUrl;
  if (sameAs.length) org.sameAs = sameAs;

  if (kind === 'faq') {
    const qs = (d.outline || []).filter(h => /\?\s*$/.test(h.text)).slice(0, 4).map(h => h.text);
    const list = qs.length ? qs : ['Write the first question', 'Write the second question'];
    return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: list.map(q => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: 'Write the answer exactly as it appears on the page.' } })) };
  }
  if (kind === 'entity') {
    const who = seo.author || (d.mediaContact && d.mediaContact.name);
    if (who && !fxIsHome(d)) return { '@context': 'https://schema.org', '@type': 'Person', name: who, url: canon, worksFor: { '@type': 'Organization', name: brand } };
    return Object.assign({ '@context': 'https://schema.org' }, org);
  }
  if (fxIsHome(d)) {
    return { '@context': 'https://schema.org', '@graph': [org, { '@type': 'WebSite', '@id': origin + '/#website', url: origin + '/', name: brand, publisher: { '@id': origin + '/#organization' } }] };
  }
  const ogType = String(seo.ogType || '').toLowerCase();
  if (ogType === 'article' || seo.articlePublished || seo.articleModified) {
    const a = { '@context': 'https://schema.org', '@type': 'Article', headline: fxTrim(title, 110), description: desc, mainEntityOfPage: canon };
    if (image) a.image = [image];
    a.datePublished = seo.articlePublished || today;
    a.dateModified = seo.articleModified || seo.articlePublished || today;
    a.author = { '@type': 'Person', name: seo.author || 'Author name' };
    a.publisher = { '@type': 'Organization', name: brand };
    return a;
  }
  if (ogType.indexOf('product') >= 0) {
    return { '@context': 'https://schema.org', '@type': 'Product', name: title, description: desc, image: image ? [image] : [], sku: 'REPLACE_WITH_SKU', brand: { '@type': 'Brand', name: brand }, offers: { '@type': 'Offer', url: canon, priceCurrency: 'USD', price: '0.00', availability: 'https://schema.org/InStock' } };
  }
  const page = { '@context': 'https://schema.org', '@type': 'WebPage', name: fxTrim(title, 110), description: desc, url: canon };
  const segs = (() => { try { return new URL(d.meta.pageUrl).pathname.split('/').filter(Boolean); } catch (e) { return []; } })();
  if (segs.length) {
    const crumbs = [{ '@type': 'ListItem', position: 1, name: 'Home', item: origin + '/' }];
    segs.forEach((s, i) => crumbs.push({ '@type': 'ListItem', position: i + 2, name: decodeURIComponent(s).replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()), item: origin + '/' + segs.slice(0, i + 1).join('/') }));
    page.breadcrumb = { '@type': 'BreadcrumbList', itemListElement: crumbs };
  }
  return page;
}
function fxScript(obj) { return '<script type="application/ld+json">\n' + JSON.stringify(obj, null, 2) + '\n</script>'; }

/* ------------------------------------------------------------------ the table */
const FIX_GEN = {
  'Title length is 30–60 characters': (d) => {
    const t = fxTitle(d);
    const had = fxClean(d.meta && d.meta.title);
    return { where: 'head', code: `<title>${fxAttr(t)}</title>`, note: (had ? 'Your title today: “' + had + '”. ' : '') + 'This is a draft built from your main heading. Reword it so the topic comes first.' };
  },
  'Description length is 120–160 characters': (d) => {
    const s = fxDescription(d);
    return { where: 'head', code: `<meta name="description" content="${fxAttr(s || 'Say in one or two sentences what this page offers and who it is for.')}">`, note: s ? 'Drafted from the opening text of the page. Check it reads as an invitation to click.' : 'No opening text was found, so this is a placeholder. Aim for 120 to 160 characters.' };
  },
  'Exactly one H1 on the page': (d) => {
    const h = fxFacts(d).h1s || [];
    if (h.length > 1) return { where: 'body', code: h.slice(1).map(x => `<h1>${x.t}</h1>\n→ <h2>${x.t}</h2>`).join('\n\n'), note: 'Keep the first H1 and turn the others into H2s (restyle with CSS if they must look the same).' };
    return { where: 'body', code: `<h1>${fxAttr(fxTrim(fxClean(d.meta && d.meta.title) || fxBrand(d), 70))}</h1>`, note: 'Put this at the top of the main content. It should name the topic of the page.' };
  },
  'Canonical URL is present': (d) => ({ where: 'head', code: `<link rel="canonical" href="${fxAttr(fxCanonical(d))}">`, note: 'Uses this page’s address without tracking parameters.' }),
  'Canonical matches the current URL': (d) => ({ where: 'head', code: `<link rel="canonical" href="${fxAttr(fxCanonical(d))}">`, note: 'Replace the existing canonical tag. Skip this if the other address is the one you want indexed.' }),
  'Not blocked by robots (noindex/nofollow)': () => ({ where: 'head', code: '<meta name="robots" content="index, follow">', note: 'Replace the current robots meta tag, and check that no X-Robots-Tag header sends noindex.' }),
  'Mobile viewport meta tag present': () => ({ where: 'head', code: '<meta name="viewport" content="width=device-width, initial-scale=1">' }),
  'Language attribute declared': (d) => ({ where: 'html', code: `<html lang="${fxFacts(d).langGuess || 'en'}">`, note: 'The language code is a guess from the page. Use the language the text is written in.' }),
  'Open Graph tags present': (d) => fxOgBlock(d, false),
  'Open Graph image present': (d) => fxOgBlock(d, true),
  'Structured data (JSON-LD) present': (d) => ({ where: 'json', code: fxScript(fxJsonLd(d)), note: 'A starting point filled from the page. Replace any placeholder text, then test it in Google’s Rich Results Test.' }),
  'No structured data (JSON-LD) errors': (d) => {
    const bad = ((d.structuredData && d.structuredData.blocks) || []).filter(b => b.error)[0];
    if (!bad) return null;
    let msg = '';
    try { JSON.parse(bad.raw); } catch (e) { msg = String(e.message || e); }
    const m = msg.match(/position (\d+)/);
    let excerpt = fxClean(bad.raw).slice(0, 200);
    if (m) { const p = +m[1]; excerpt = (bad.raw || '').slice(Math.max(0, p - 80), p + 40).replace(/\s+/g, ' '); excerpt = '…' + excerpt + '…'; }
    return { where: 'json', code: excerpt, note: msg ? 'The browser reports: ' + msg + '. Common causes are a trailing comma, a missing quote or an unescaped line break inside a value.' : 'The block could not be parsed.' };
  },
  'All images have alt text': (d) => {
    let list = fxImages(d).filter(i => !i.alt && !i.inline).slice(0, 6).map(i => i.url);
    if (!list.length) list = ((d.accessibility && d.accessibility.imagesMissingAlt) || []).slice(0, 6);
    if (!list.length) return null;
    return { where: 'body', code: list.map(u => `<img src="${fxAttr(fxSrc(u, d))}" alt="${fxAttr(fxFileAlt(u))}">`).join('\n'), note: 'The alt text is drafted from each file name. Describe what the image shows, or use alt="" if it is purely decoration.' };
  },
  'Heading hierarchy has no skipped levels': (d) => fxHeadingFix(d),
  'No heading hierarchy issues': (d) => fxHeadingFix(d),
  'No render-blocking scripts in <head>': (d) => {
    const s = fxFacts(d).blockingScripts || [];
    if (!s.length) return null;
    return { where: 'head', code: s.map(u => `<script src="${fxAttr(u)}" defer></script>`).join('\n'), note: 'defer keeps the scripts in order and runs them after the page is read. Use async instead for independent scripts such as analytics.' };
  },
  'All form fields have labels': (d) => {
    const f = fxFacts(d).unlabeled || [];
    if (!f.length) return null;
    const used = {};
    return {
      where: 'body', note: 'Keep the placeholder as a hint only. The label must be visible text that stays on screen.',
      code: f.slice(0, 5).map((x, i) => {
        let id = x.id || x.name || x.type || 'field-' + (i + 1);
        id = String(id).replace(/[^a-z0-9_-]/gi, '-'); if (used[id]) id += '-' + (i + 1); used[id] = 1;
        const type = x.tag === 'input' && x.type ? ` type="${fxAttr(x.type)}"` : '';
        const el = x.tag === 'textarea' ? `<textarea id="${id}"${x.name ? ` name="${fxAttr(x.name)}"` : ''}></textarea>` : x.tag === 'select' ? `<select id="${id}"${x.name ? ` name="${fxAttr(x.name)}"` : ''}>…</select>` : `<input id="${id}"${type}${x.name ? ` name="${fxAttr(x.name)}"` : ''}>`;
        return `<label for="${id}">${fxAttr(fxLabelText(x))}</label>\n${el}`;
      }).join('\n\n')
    };
  },
  'Header landmark present': () => ({ where: 'body', code: '<header>\n  <!-- logo and primary navigation -->\n</header>' }),
  'Navigation landmark present': () => ({ where: 'body', code: '<nav aria-label="Main">\n  <!-- the main menu links -->\n</nav>' }),
  'Main landmark present': () => ({ where: 'body', code: '<main id="main">\n  <!-- the primary content of the page -->\n</main>', note: 'Use one main element per page, wrapped around the content that is unique to it.' }),
  'Footer landmark present': () => ({ where: 'body', code: '<footer>\n  <!-- site footer -->\n</footer>' }),

  /* images */
  'Images are sized for where they are shown': (d) => {
    const list = fxImages(d).filter(i => i.wasted > 0 && !i.inline).sort((a, b) => b.wasted - a.wasted).slice(0, 3);
    if (!list.length) return null;
    return {
      where: 'body', note: 'Export each image at the two widths shown, then upload the files. The browser picks the smaller one it can.',
      code: list.map(i => {
        const src = fxSrc(i.url, d), n = fxSplitName(src), w1 = Math.max(100, Math.round(i.displayW)), w2 = Math.min(Math.max(w1 * 2, w1 + 1), i.naturalW || w1 * 2);
        return `<img src="${fxAttr(n.base + '-' + w1 + '.' + n.ext)}"\n     srcset="${fxAttr(n.base + '-' + w1 + '.' + n.ext)} ${w1}w, ${fxAttr(n.base + '-' + w2 + '.' + n.ext)} ${w2}w"\n     sizes="(max-width: ${w1}px) 100vw, ${w1}px"\n     width="${i.naturalW}" height="${i.naturalH}" alt="">`;
      }).join('\n\n')
    };
  },
  'Images reserve their space': (d) => {
    const list = fxImages(d).filter(i => !i.hasDims && i.loaded && !i.inline).slice(0, 6);
    if (!list.length) return null;
    return { where: 'body', note: 'The numbers are each image’s own size, so the browser can keep the right amount of room before it loads.', code: list.map(i => `<img src="${fxAttr(fxSrc(i.url, d))}" width="${i.naturalW}" height="${i.naturalH}" alt="">`).join('\n') + '\n\n/* or, in CSS */\nimg { max-width: 100%; height: auto; }' };
  },
  'Images use modern formats': (d) => {
    const list = fxImages(d).filter(i => i.formatSave > 0 && !i.inline).sort((a, b) => b.formatSave - a.formatSave).slice(0, 3);
    if (!list.length) return null;
    return {
      where: 'body', note: 'Convert the files first (Squoosh or any image tool), then use picture so older browsers still get the original.',
      code: list.map(i => {
        const n = fxSplitName(fxSrc(i.url, d));
        return `<picture>\n  <source srcset="${fxAttr(n.base + '.avif')}" type="image/avif">\n  <source srcset="${fxAttr(n.base + '.webp')}" type="image/webp">\n  <img src="${fxAttr(n.base + '.' + n.ext)}" width="${i.naturalW}" height="${i.naturalH}" alt="">\n</picture>`;
      }).join('\n\n')
    };
  },
  'Images below the fold load lazily': (d) => {
    const list = fxImages(d).filter(i => !i.aboveFold && !i.lazy && i.loaded && i.bytes > 40 * 1024 && !i.inline).slice(0, 6);
    if (!list.length) return null;
    return { where: 'body', code: list.map(i => `<img src="${fxAttr(fxSrc(i.url, d))}" loading="lazy" width="${i.naturalW}" height="${i.naturalH}" alt="">`).join('\n') };
  },
  'Main images are not lazy-loaded': (d) => {
    const list = fxImages(d).filter(i => i.aboveFold && i.lazy && i.displayW * i.displayH > 90000 && !i.inline).slice(0, 3);
    if (!list.length) return null;
    return { where: 'body', note: 'The loading="lazy" attribute is removed and the image is marked high priority.', code: list.map(i => `<img src="${fxAttr(fxSrc(i.url, d))}" fetchpriority="high" width="${i.naturalW}" height="${i.naturalH}" alt="">`).join('\n') };
  },
  'The main image loads promptly': (d) => fxLcp(d),
  'LCP is in the good range': (d) => fxLcp(d),
  'CLS is in the good range': (d) => {
    const c = d.insights && d.insights.shifts && d.insights.shifts.culprits || [];
    const top = c.filter(x => !x.gone && x.selector && x.cur)[0];
    if (!top) return null;
    const h = Math.max(1, Math.round(top.cur.h));
    return { where: 'css', note: `${top.label} was the biggest shift. This keeps its space reserved while it loads. Check the number against its final height.`, code: `${top.selector} {\n  min-height: ${h}px;\n}` };
  },
  'Content was updated within the last year': () => {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return { where: 'head', code: `<meta property="article:modified_time" content="${now}">`, note: 'Only publish a new date after the content has really been reviewed. Update dateModified in your structured data to match.' };
  },

  /* AI readiness */
  'Crawler Access': () => {
    const r = (typeof lastSiteFilesResult !== 'undefined' && lastSiteFilesResult && lastSiteFilesResult.robotsTxt) || {};
    const bots = r.blockedAiSearch && r.blockedAiSearch.length ? r.blockedAiSearch : ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User'];
    return {
      where: 'robots', note: 'These are the bots that build AI answers or fetch a page when someone asks. A group for a named bot overrides a wildcard Disallow. Training crawlers (GPTBot, ClaudeBot, CCBot) can stay blocked.',
      code: bots.map(b => `User-agent: ${b}\nAllow: /`).join('\n\n')
    };
  },
  'Schema Depth': (d) => ({ where: 'json', code: fxScript(fxJsonLd(d, 'faq')), note: 'FAQPage fits pages that answer questions. Use the page’s real questions and answers, and check the type matches the content.' }),
  'Entity Trust': (d) => ({ where: 'json', code: fxScript(fxJsonLd(d, 'entity')), note: 'Names who is behind the page. Fill in the real name, logo and profiles.' }),
  'Freshness': () => FIX_GEN['Content was updated within the last year']()
};

function fxOgBlock(d, imageOnly) {
  const og = (d.socialMeta && d.socialMeta.og) || {}, tw = (d.socialMeta && d.socialMeta.twitter) || {}, seo = d.seo || {};
  const img = og.image || (d.images || []).filter(u => !/\.(svg|gif|ico)(\?|$)/i.test(u))[0] || '';
  const lines = [];
  const m = (p, c) => lines.push(`<meta property="${p}" content="${fxAttr(c)}">`);
  if (!imageOnly) {
    if (!og.title) m('og:title', fxTrim(fxH1(d) || (d.meta && d.meta.title) || '', 70));
    if (!og.description) m('og:description', fxDescription(d) || 'A short summary of the page.');
    if (!seo.ogType) m('og:type', seo.articlePublished ? 'article' : 'website');
    if (!seo.ogUrl) m('og:url', fxCanonical(d));
    if (!seo.ogSiteName) m('og:site_name', fxBrand(d));
  }
  if (!og.image) { m('og:image', img || 'https://example.com/share-1200x630.jpg'); m('og:image:width', '1200'); m('og:image:height', '630'); }
  if (!imageOnly && !tw.card && !seo.twitterCard) lines.push('<meta name="twitter:card" content="summary_large_image">');
  if (!lines.length) return null;
  return { where: 'head', code: lines.join('\n'), note: og.image || !img ? (img ? '' : 'No suitable image was found on the page, so the image address is a placeholder. Use one at least 1200 × 630 px.') : 'The image address is the first picture found on the page. Pick one made for sharing, at least 1200 × 630 px.' };
}

function fxHeadingFix(d) {
  const out = (d.outline || []).filter(h => /^h[1-6]$/.test(h.tag));
  if (!out.length) return null;
  const lines = [];
  let prev = 0, shift = 0;
  out.forEach((h, i) => {
    const level = parseInt(h.tag.slice(1), 10);
    const eff = level - shift;
    if (prev && eff > prev + 1) {
      const want = prev + 1;
      lines.push(`<h${level}>${fxAttr(fxTrim(h.text, 60))}</h${level}>\n→ <h${want}>${fxAttr(fxTrim(h.text, 60))}</h${want}>`);
      shift = level - want;
      prev = want;
    } else prev = eff;
  });
  if (!lines.length) return null;
  return { where: 'body', code: lines.slice(0, 6).join('\n\n'), note: 'Change the tag, not the text. Restyle with a class if the size must stay the same.' };
}

function fxLcp(d) {
  const lcp = d.insights && d.insights.lcp;
  if (!lcp || !lcp.isImage || !lcp.url || /^data:/.test(lcp.url)) return null;
  const href = fxSrc(lcp.url, d);
  return { where: 'head', note: 'Also remove loading="lazy" from this image and add fetchpriority="high" to the img tag itself.', code: `<link rel="preload" as="image" href="${fxAttr(href)}" fetchpriority="high">` };
}

/* ------------------------------------------------------------------ public */
function fixFor(label, d) {
  const gen = FIX_GEN[label];
  if (!gen || !d) return null;
  try {
    const r = gen(d);
    return r && r.code ? { where: r.where || 'body', code: r.code, note: r.note || '' } : null;
  } catch (e) { return null; }
}

// every fix on a screen, grouped by where it goes, as one pasteable block
function fixBundle(issues, host) {
  const groups = {};
  const order = ['head', 'json', 'html', 'body', 'css', 'robots', 'headers', 'file', 'server', 'dns'];
  issues.forEach(i => {
    if (!i.fixCode) return;
    const w = i.fixCode.where;
    (groups[w] = groups[w] || []).push({ t: i.t, code: i.fixCode.code, path: i.fixCode.path });
  });
  const parts = [];
  order.forEach(w => {
    if (!groups[w]) return;
    const open = /^(robots|headers|css|server|dns)$/.test(w) ? '/* ' : '<!-- ', close = /^(robots|headers|css|server|dns)$/.test(w) ? ' */' : ' -->';
    parts.push(open + FIX_WHERE[w] + (host ? ' · ' + host : '') + close);
    groups[w].forEach(g => parts.push(open + g.t + (g.path ? '  →  ' + g.path : '') + close + '\n' + g.code));
    parts.push('');
  });
  return parts.join('\n').trim();
}

function fixCount(issues) { return issues.filter(i => i.fixCode).length; }

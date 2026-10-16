/* agent-geo.js — page-level AI-search and technical SEO checks, plus the copy-ready fixes.
 *
 * agent-engine.js asks the server questions. This file reads the page the way an anonymous crawler
 * gets it (the raw HTML, with no scripts run) and compares that with what the browser built, then
 * turns the findings into audit checks and writes the files and headers that fix them.
 *
 *   arAnalyzeResponse(res, url)   what the raw HTML and headers contain
 *   arProbeLlms(ctx)              /llms.txt
 *   arProbeSoft404(ctx)           does a missing page answer 404?
 *   arGeoChecks(d)                AI-search checks that join the AI readiness audit
 *   arSeoChecks(d)                technical SEO checks that join the SEO audit
 *   arAgentChecks(d)              the agent-protocol checks for the current profile
 *   arFixFor(id, d)               { where, path, code, note, variants } for one protocol
 */

/* ------------------------------------------------------------------ the raw page */
function arWords(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

function arAnalyzeResponse(r, url) {
  const out = { url: url, error: r.error || null, status: r.status || 0, finalUrl: r.finalUrl || url, redirected: !!r.redirected, ms: r.ms || 0, bytes: r.bytes || 0, truncated: !!r.truncated, ctype: r.ctype || '', headers: {}, challenge: false, raw: null };
  if (r.error) return out;
  try {
    const h = r.headers;
    out.headers = { xRobots: h.get('x-robots-tag') || '', link: h.get('link') || '', server: h.get('server') || '', cfMitigated: h.get('cf-mitigated') || '', limited: arHeadersLimited(h) };
    out.headersAll = {};
    h.forEach((v, k) => { out.headersAll[k] = v; });       // kept for the technology detector, which reads every header
  } catch (e) { /* no headers */ }
  const html = r.text || '';
  let doc = null;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { /* not HTML */ }
  if (doc && doc.body) {
    const body = doc.body.cloneNode(true);
    body.querySelectorAll('script, style, noscript, template, svg').forEach(n => n.remove());
    const meta = (sel) => { const m = doc.querySelector(sel); return m ? (m.getAttribute('content') || '') : ''; };
    const canon = doc.querySelector('link[rel="canonical"]');
    const rootEl = doc.querySelector('#root, #app, #__next, #__nuxt, [data-reactroot]');
    out.raw = {
      title: (doc.title || '').trim(), description: meta('meta[name="description"]'), canonical: canon ? canon.getAttribute('href') || '' : '',
      h1: Array.from(doc.querySelectorAll('h1')).map(x => (x.textContent || '').trim()).filter(Boolean), jsonLd: doc.querySelectorAll('script[type="application/ld+json"]').length,
      words: arWords(body.textContent), robotsMeta: meta('meta[name="robots"]'), lang: doc.documentElement.getAttribute('lang') || '',
      links: doc.querySelectorAll('a[href]').length, headings: doc.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      emptyRoot: !!(rootEl && (rootEl.textContent || '').trim().length < 40), noscriptWords: arWords(Array.from(doc.querySelectorAll('noscript')).map(n => n.textContent).join(' '))
    };
    const probe = (out.raw.title + ' ' + (body.textContent || '').slice(0, 600)).toLowerCase();
    out.challenge = !!out.headers.cfMitigated || (r.status >= 400 && /just a moment|attention required|captcha|access denied|verify you are human|checking your browser|enable javascript and cookies/.test(probe));
  }
  return out;
}

async function arProbeLlms(c) {
  const r = await c.get('/llms.txt', { max: 65536 });
  if (r.error) return { present: false, unable: true };
  const text = r.text || '';
  const present = r.status === 200 && !arLooksHtml(r) && text.trim().length > 0;
  const full = present ? await c.get('/llms-full.txt', { method: 'HEAD' }) : null;
  return {
    present: present, status: r.status, valid: present && /^#\s+\S/m.test(text), hasSummary: present && /^>\s+\S/m.test(text),
    links: present ? (text.match(/\]\((https?:\/\/|\/)[^)\s]*\)/g) || []).length : 0, bytes: r.bytes,
    full: !!(full && !full.error && full.status === 200 && !/html/.test(full.ctype || ''))
  };
}

async function arProbeSoft404(c) {
  const rnd = Math.random().toString(36).slice(2, 10);
  const r = await arFetch(c.origin + '/stylytics-check-' + rnd + '-missing', { max: 4096, timeout: 6000 });
  if (r.error) return { unable: true };
  return { status: r.status, soft: r.status >= 200 && r.status < 300 };
}

/* ------------------------------------------------------------------ WebMCP */
// sig = d.agentSignals; probe = what the page-world listener recorded ({present, tools, hasNav, hasDoc})
function arWebMcpResult(sig, probe) {
  const forms = (sig && sig.webmcpForms) || [];
  const imp = (probe && probe.present && probe.tools) || [];
  const tools = imp.map(t => ({ name: t.name, description: t.description || '', hasSchema: !!t.hasSchema, via: 'imperative' }))
    .concat(forms.map(f => ({ name: f.name, description: f.description || '', hasSchema: true, via: 'declarative' })));
  const ev = [];
  if (probe) ev.push({ label: 'Check navigator.modelContext', outcome: (probe.hasNav || probe.hasDoc) ? 'positive' : 'neutral', summary: probe.hasNav || probe.hasDoc ? 'The WebMCP API exists on this page' : 'No WebMCP API on this page' });
  ev.push({ label: 'Tools registered with the API', outcome: imp.length ? 'positive' : 'neutral', summary: probe && probe.present ? (imp.length ? imp.map(t => t.name).join(', ') : 'None registered') : 'The page listener was not running when the page loaded' });
  ev.push({ label: 'Forms with a toolname attribute', outcome: forms.length ? 'positive' : 'neutral', summary: forms.length ? forms.map(f => f.name).join(', ') : 'None' });
  if (tools.length) return { id: 'webMcp', status: 'pass', message: 'Found ' + arPlural(tools.length, 'WebMCP tool') + ': ' + tools.slice(0, 4).map(t => t.name).join(', '), details: { toolCount: tools.length, tools: tools }, evidence: ev };
  // Without the listener we cannot know what the page registered, so say that instead of "none"
  if (!probe || !probe.present) {
    if (typeof ARX !== 'undefined' && ARX.opts && ARX.opts.probe === false) return { id: 'webMcp', status: 'info', message: 'WebMCP detection is turned off in Settings', evidence: ev };
    return { id: 'webMcp', status: 'unable', message: 'Stylytics was not watching when this page loaded, so any WebMCP tools could not be seen. Reload the page to check.', evidence: ev };
  }
  return { id: 'webMcp', status: 'fail', message: 'No WebMCP tools detected on page load', evidence: ev };
}

/* ------------------------------------------------------------------ shared lookups */
function arInfo(d) {
  d = d || (typeof lastExtractedData !== 'undefined' ? lastExtractedData : null) || {};
  const url = AR.url || (d.meta && d.meta.pageUrl) || '';
  let origin = '', host = '', path = '/';
  try { const u = new URL(url); origin = u.origin; host = u.hostname.replace(/^www\./, ''); path = u.pathname; } catch (e) { /* none */ }
  const brand = (d.meta && typeof fxBrand === 'function' ? fxBrand(d) : '') || host;
  const desc = (d.meta && typeof fxDescription === 'function' ? fxDescription(d) : '') || (d.meta && d.meta.description) || '';
  return { d: d, url: url, origin: origin, host: host, path: path, home: path.replace(/\/+$/, '') === '', brand: brand, desc: desc, title: (d.meta && d.meta.title) || brand };
}
const arJsonStr = (o) => JSON.stringify(o, null, 2);
function arSchemaNodes(d) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n !== 'object') return;
    out.push(n);
    if (n['@graph']) walk(n['@graph']);
  };
  ((d.structuredData && d.structuredData.blocks) || []).forEach(b => walk(b.parsed));
  return out;
}
const arTypesOf = (n) => [].concat(n['@type'] || []).map(String);
const arHasType = (n, re) => arTypesOf(n).some(t => re.test(t));

/* ------------------------------------------------------------------ AI-search checks */
function arGeoChecks(d) {
  const A = arInfo(d), out = [], page = AR.page, raw = page && page.raw;
  const rendered = (d.meta && d.meta.wordCount) || 0;
  const open = [insOpenAction('agent', 'Open agent readiness')];
  const bad = (o) => { out.push(o); };

  // anonymous visitors must be served the page, not a challenge or a login wall
  if (page && !page.error && page.status) {
    const blocked = page.challenge || page.status === 401 || page.status === 403 || page.status === 429 || page.status === 503 || page.status === 451;
    bad({
      label: 'Anonymous visitors are served the page', pass: !blocked, sev: 'High', t: 'Let anonymous crawlers load the page',
      line: blocked ? `A request with no cookies got ${page.challenge ? 'a bot challenge' : 'HTTP ' + page.status}, while your browser loaded the page.` : 'A request with no cookies loads the page normally.',
      mean: 'AI crawlers arrive with no login and no cookies. If they meet a challenge, a login wall or an error, they leave with nothing to quote.',
      fix: 'Allow known search and AI crawlers through your bot protection, and keep public pages free of login or cookie walls.', section: 'ins:agent', actions: open
    });
  }

  if (raw && rendered >= 150 && !page.challenge) {
    const ratio = raw.words / Math.max(rendered, 1);
    const fail = ratio < 0.6;
    bad({
      label: 'The content is in the page HTML', pass: !fail, sev: ratio < 0.3 ? 'High' : 'Medium', t: 'Put the content in the HTML, not in scripts',
      line: `The HTML a crawler downloads holds about ${raw.words} words. Once scripts run the page shows ${rendered}.`,
      mean: 'Most AI crawlers (GPTBot, ClaudeBot, PerplexityBot) do not run JavaScript. Text that only appears after scripts run is invisible to them, so it can never be quoted.',
      fix: 'Render the page on the server (server-side rendering, static generation or prerendering) so the text is in the first HTML response.', section: 'ins:agent', actions: [insOpenAction('aiview', 'See what an AI sees')].concat(open)
    });
  }

  if (raw && !page.challenge) {
    const miss = [];
    if (d.meta.title && !raw.title) miss.push('title');
    if (d.meta.description && !raw.description) miss.push('meta description');
    if (d.meta.canonical && !raw.canonical) miss.push('canonical link');
    if ((d.seo && d.seo.h1Count) && !raw.h1.length) miss.push('H1');
    if (((d.structuredData && d.structuredData.blocks) || []).length && !raw.jsonLd) miss.push('structured data');
    bad({
      label: 'Key tags are in the first HTML response', pass: miss.length === 0, sev: 'Medium', t: 'Send the key tags in the HTML',
      line: `The ${miss.join(', ')} ${miss.length === 1 ? 'is' : 'are'} added by scripts and missing from the HTML crawlers download.`,
      mean: 'Search engines can wait for scripts, but AI crawlers and link-preview bots read only the first response. Tags added later are never seen.',
      fix: 'Output the title, description, canonical, H1 and JSON-LD from the server instead of adding them with JavaScript.', section: 'ins:agent', actions: open
    });
  }

  if (AR.llms && !AR.llms.unable) {
    const l = AR.llms;
    const pass = l.present && l.valid;
    bad({
      label: 'llms.txt gives AI a guide to the site', pass: pass, sev: 'Low', t: l.present ? 'Fix the llms.txt format' : 'Publish an llms.txt',
      line: !l.present ? 'There is no /llms.txt.' : 'llms.txt exists but does not start with an H1 title.',
      mean: 'llms.txt is a short Markdown page at the site root that tells AI tools what the site is and which pages matter. Not every engine reads it yet, but it costs little and agents that do use it skip the guesswork.',
      fix: 'Publish /llms.txt: an H1 with the site name, a one-line summary, then sections of links to your key pages.',
      section: 'ins:agent', actions: open, fixCode: arFixFor('llmsTxt', d)
    });
  }

  // snippet and AI-use controls
  {
    const meta = ((d.seo && d.seo.robots && d.seo.robots.raw) || '') + ' ' + (page && page.headers ? page.headers.xRobots : '');
    const found = [];
    if (/\bnosnippet\b/i.test(meta)) found.push('nosnippet');
    if (/max-snippet\s*:\s*0\b/i.test(meta)) found.push('max-snippet:0');
    if (/\bnoai\b/i.test(meta)) found.push('noai');
    if (/\bnoimageai\b/i.test(meta)) found.push('noimageai');
    bad({
      label: 'No snippet or AI-use blocks', pass: found.length === 0, sev: 'Medium', t: 'Remove tags that block AI summaries',
      line: `The page sets ${found.join(', ')}.`,
      mean: 'These directives stop search and AI products from showing or quoting your text. That can be intended, but it also removes you from AI Overviews and answer boxes.',
      fix: 'Remove nosnippet, max-snippet:0 and noai from the robots meta tag or X-Robots-Tag header unless you really want to opt out.', section: 'meta'
    });
  }

  if (A.home) {
    const nodes = arSchemaNodes(d);
    const org = nodes.find(n => arHasType(n, /^(Organization|Corporation|LocalBusiness|NGO|Person|.*Business|.*Store)$/));
    const sameAs = org ? [].concat(org.sameAs || []).filter(Boolean) : [];
    const pass = !!(org && org.name && sameAs.length >= 2);
    bad({
      label: 'The brand is identified as an entity', pass: pass, sev: 'Medium', t: 'Describe the brand with Organization markup',
      line: !org ? 'No Organization or Person markup was found on the home page.' : !org.name ? 'The Organization markup has no name.' : 'The Organization markup lists fewer than two sameAs profiles.',
      mean: 'AI systems decide who a brand is by matching it across the web. Organization markup with sameAs links to your official profiles (LinkedIn, Wikipedia, X) lets them match you with confidence.',
      fix: 'Add Organization JSON-LD to the home page with name, url, logo and at least two sameAs links.', section: 'structured-data', fixCode: arFixFor('orgSchema', d)
    });
  }

  const nodes = arSchemaNodes(d);
  const article = nodes.find(n => arHasType(n, /^(Article|NewsArticle|BlogPosting|TechArticle|ScholarlyArticle|Report)$/));
  if (article) {
    const a = [].concat(article.author || [])[0];
    const aName = a && (typeof a === 'string' ? a : a.name);
    const aUrl = a && typeof a === 'object' && (a.url || a.sameAs);
    bad({
      label: 'The article names its author in markup', pass: !!aName, sev: 'Medium', t: 'Name the author in the article markup',
      line: 'The article markup has no author name.',
      mean: 'Who wrote a page is a core trust signal for readers and for AI systems deciding what to cite.',
      fix: `Add an author Person with a name${aUrl ? '' : ' and a link to a profile page'} to the Article JSON-LD.`, section: 'structured-data', fixCode: arFixFor('articleAuthor', d)
    });
    const sig = d.agentSignals || {};
    if (d.seo && (d.seo.articlePublished || d.seo.articleModified) && sig.timeEls === 0) {
      bad({
        label: 'Dates use the time element', pass: false, sev: 'Low', t: 'Mark dates up with <time>',
        line: 'The page has dates but no <time datetime> element.',
        mean: 'A <time> element with a datetime value lets a crawler read the date without guessing the format.',
        fix: 'Wrap the published and updated dates in <time datetime="YYYY-MM-DD">.', section: 'ins:agent', actions: open,
        fixCode: { where: 'body', code: `<p>Published <time datetime="${(d.seo.articlePublished || '2025-01-01').slice(0, 10)}">${(d.seo.articlePublished || '2025-01-01').slice(0, 10)}</time>${d.seo.articleModified ? `, updated <time datetime="${d.seo.articleModified.slice(0, 10)}">${d.seo.articleModified.slice(0, 10)}</time>` : ''}</p>`, note: '' }
      });
    }
  }

  const sig = d.agentSignals;
  if (sig) {
    const t = sig.trust || {};
    const have = ['about', 'contact', 'privacy', 'terms'].filter(k => t[k]);
    const missing = ['about', 'contact', 'privacy', 'terms'].filter(k => !t[k]);
    bad({
      label: 'About, contact and policy pages are linked', pass: have.length >= 3, sev: 'Low', t: 'Link your trust pages',
      line: `No link to ${missing.join(', ')} ${missing.length === 1 ? 'page' : 'pages'} was found.`,
      mean: 'About, contact, privacy and terms pages are how people and AI systems judge whether a site is a real, accountable organisation.',
      fix: 'Link About, Contact, Privacy and Terms pages from the footer of every page.', section: 'media-contact'
    });
    if (rendered >= 500) {
      bad({
        label: 'Claims cite outside sources', pass: (sig.citations || []).length >= 2, sev: 'Low', t: 'Cite outside sources',
        line: (sig.citations || []).length ? `Only ${arPlural(sig.citations.length, 'outside source')} is linked from the text.` : 'The text links to no outside sources.',
        mean: 'Pages that point to primary sources read as more trustworthy, and AI answer engines prefer to cite pages that show where facts come from.',
        fix: 'Link the studies, data or standards you rely on from the sentence that uses them.', section: 'ins:agent', actions: open
      });
    }
    if (rendered >= 400) {
      const okLead = sig.hasSummaryBlock || (sig.leadParagraphWords >= 15 && sig.leadParagraphWords <= 70);
      bad({
        label: 'The page opens with a summary', pass: okLead, sev: 'Low', t: 'Open with a short summary',
        line: sig.leadParagraphWords > 70 ? `The first paragraph runs ${sig.leadParagraphWords} words.` : 'No short summary was found under the main heading.',
        mean: 'A two-to-three sentence summary at the top is the passage AI answer engines most often lift as the answer.',
        fix: 'Put a 30 to 60 word summary directly under the H1, or add a “Key takeaways” block.', section: 'ins:agent', actions: open
      });
    }
    const L = sig.landmarks || {};
    bad({
      label: 'The page uses semantic landmarks', pass: L.main >= 1, sev: 'Low', t: 'Wrap the content in <main>',
      line: 'There is no <main> element.',
      mean: 'Crawlers and reader modes use <main> and <article> to separate your content from menus and footers. Without them, boilerplate gets mixed into what an AI reads.',
      fix: 'Wrap the primary content in <main>, and each post or card in <article>.', section: 'accessibility'
    });
  }

  if (page && page.bytes) {
    const big = page.truncated || page.bytes > 1048576;
    bad({
      label: 'The HTML document is a sensible size', pass: !big, sev: page.truncated ? 'Medium' : 'Low', t: 'Slim down the HTML document',
      line: `The HTML alone is ${page.truncated ? 'over 1.5 MB' : (page.bytes / 1048576).toFixed(1) + ' MB'}.`,
      mean: 'Googlebot stops reading HTML after 2 MB, and other crawlers cut off sooner. Anything past the limit is never indexed or quoted.',
      fix: 'Move inline scripts, styles, base64 images and embedded JSON out of the HTML.', section: 'ins:agent', actions: open
    });
  }

  if (AR.soft404 && !AR.soft404.unable) {
    bad({
      label: 'Missing pages return a 404', pass: !AR.soft404.soft, sev: 'Medium', t: 'Return a real 404 for missing pages',
      line: `A made-up address answered HTTP ${AR.soft404.status} instead of 404.`,
      mean: 'A “soft 404” tells crawlers every address is a real page. They waste time on empty pages and may index thin duplicates.',
      fix: 'Make your server or framework send status 404 (not 200) for pages that do not exist.', section: 'ins:agent', actions: open
    });
  }
  return out;
}

/* ------------------------------------------------------------------ technical SEO checks */
function arSeoChecks(d) {
  const A = arInfo(d), out = [], page = AR.page, sig = d.agentSignals;
  const seo = d.seo || {};

  if (page && page.headers && !page.headers.limited && !page.error) {
    const x = page.headers.xRobots || '';
    const noindex = /\bnoindex\b/i.test(x);
    out.push({
      label: 'The X-Robots-Tag header allows indexing', pass: !noindex, sev: 'High', t: 'Remove noindex from the X-Robots-Tag header',
      line: `The server sends X-Robots-Tag: ${x}.`,
      mean: 'A noindex sent as an HTTP header keeps the page out of search and AI answers, and unlike a meta tag it is easy to miss because it is not in the page source.',
      fix: 'Remove noindex from the X-Robots-Tag header in your server, CDN or framework settings.', section: 'ins:agent', actions: [insOpenAction('agent', 'Open agent readiness')]
    });
  }

  if (sig) {
    const total = (d.links || []).length;
    out.push({
      label: 'Links use descriptive text', pass: sig.genericLinks <= Math.max(2, Math.round(total * 0.03)), sev: 'Low', t: 'Rewrite “click here” links',
      line: `${arPlural(sig.genericLinks, 'link')} say only “${(sig.genericLinkSamples || [])[0] || 'read more'}”.`,
      mean: 'Link text is how search engines and screen readers learn what the target is about. “Read more” says nothing.',
      fix: 'Describe where the link goes: “Read the pricing guide” instead of “Read more”.', section: 'backlinks'
    });
  }

  out.push({
    label: 'Twitter/X card tags are set', pass: !!(seo.twitterCard || (d.socialMeta && d.socialMeta.twitter && d.socialMeta.twitter.card)), sev: 'Low', t: 'Add Twitter/X card tags',
    line: 'No twitter:card tag was found.',
    mean: 'Without a card type, X shows a plain link instead of a large preview when the page is shared.',
    fix: 'Add twitter:card (summary_large_image) next to your Open Graph tags.', section: 'social',
    fixCode: { where: 'head', code: '<meta name="twitter:card" content="summary_large_image">', note: 'It reuses your Open Graph title, description and image.' }
  });

  if (seo.charset) {
    out.push({
      label: 'Text is encoded as UTF-8', pass: /utf-?8/i.test(seo.charset), sev: 'Low', t: 'Switch the page to UTF-8',
      line: `The page is encoded as ${seo.charset}.`, mean: 'Other encodings can garble accented letters, symbols and non-Latin text in search results and AI summaries.',
      fix: 'Save the files as UTF-8 and declare it first inside <head>.', section: 'meta',
      fixCode: { where: 'head', code: '<meta charset="utf-8">', note: 'Place it within the first 1024 bytes of the document.' }
    });
  }

  if (d.meta && d.meta.canonical && /^https:/i.test(A.url) && /^http:/i.test(d.meta.canonical)) {
    out.push({
      label: 'The canonical uses HTTPS', pass: false, sev: 'Medium', t: 'Point the canonical at the HTTPS address',
      line: `The canonical link is ${d.meta.canonical}.`, mean: 'A canonical on http:// tells search engines the insecure copy is the real one, which can send people to the wrong version.',
      fix: 'Change the canonical link to the https:// address.', section: 'meta',
      fixCode: { where: 'head', code: `<link rel="canonical" href="${d.meta.canonical.replace(/^http:/i, 'https:')}">`, note: '' }
    });
  }

  const hl = (seo.hreflang || []);
  if (hl.length) {
    const codes = hl.map(h => String(h.lang || ''));
    const badCode = codes.filter(c => c !== 'x-default' && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(c));
    const self = hl.some(h => { try { const u = new URL(h.href); return u.origin + u.pathname.replace(/\/$/, '') === new URL(A.url).origin + new URL(A.url).pathname.replace(/\/$/, ''); } catch (e) { return false; } });
    const issues = [];
    if (badCode.length) issues.push(`“${badCode[0]}” is not a valid language code`);
    if (!self) issues.push('no hreflang points back at this page');
    if (hl.length > 1 && codes.indexOf('x-default') < 0) issues.push('there is no x-default');
    out.push({
      label: 'hreflang tags are valid', pass: issues.length === 0, sev: 'Medium', t: 'Fix the hreflang tags', line: `${issues[0].charAt(0).toUpperCase() + issues[0].slice(1)}${issues.length > 1 ? ' (and ' + (issues.length - 1) + ' more)' : ''}.`,
      mean: 'Broken hreflang tags make search engines ignore the language versions, so people can land on the wrong one.',
      fix: 'List every language version (including this page itself) with a valid code, and add an x-default.', section: 'meta'
    });
  }

  {
    let u; try { u = new URL(A.url); } catch (e) { u = null; }
    if (u) {
      const issues = [];
      if (u.pathname.length > 115) issues.push('is very long');
      if (/[A-Z]/.test(u.pathname)) issues.push('has capital letters');
      if (/_/.test(u.pathname)) issues.push('uses underscores');
      let n = 0; u.searchParams.forEach(() => n++);
      if (n > 3) issues.push(`has ${n} query parameters`);
      if (/(sessionid|phpsessid|sid|jsessionid)=/i.test(u.search)) issues.push('carries a session id');
      out.push({
        label: 'The URL is clean and readable', pass: issues.length === 0, sev: 'Low', t: 'Tidy the page address',
        line: `The address ${issues.join(' and ')}.`, mean: 'Short, lowercase, hyphenated addresses are easier to share, easier for crawlers to deduplicate, and more likely to be trusted in a result.',
        fix: 'Use short lowercase paths with hyphens, and keep tracking and session values out of the address.', section: 'meta'
      });
    }
    const depth = A.path.split('/').filter(Boolean).length;
    if (depth >= 2) {
      const has = arSchemaNodes(d).some(n => arHasType(n, /^BreadcrumbList$/));
      out.push({
        label: 'Breadcrumb markup is present', pass: has, sev: 'Low', t: 'Add breadcrumb markup',
        line: 'This inner page has no BreadcrumbList structured data.', mean: 'Breadcrumbs show where the page sits in the site, in search results and to AI systems that map site structure.',
        fix: 'Add BreadcrumbList JSON-LD that mirrors the visible breadcrumb trail.', section: 'structured-data', fixCode: arFixFor('breadcrumb', d)
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ agent checks for the audit */
function arProfile() { return ARX.profile === 'auto' ? arAutoProfile(AR.results) : ARX.profile; }

function arIsCommerce(d) {
  d = d || {};
  const sig = d.agentSignals && d.agentSignals.commerce;
  const types = (d.structuredData && d.structuredData.types) || [];
  const shopTech = (d.techStack || []).some(t => /ecommerce/i.test(t.category || ''));
  return shopTech || types.some(t => /^(Product|Offer|OnlineStore|Store)$/.test(t)) || !!(sig && sig.cart > 0 && sig.price > 0);
}

// results for the audit list: only checks that are scored for this profile and that gave a clear answer
function arAgentChecks(d) {
  if (AR.phase !== 'done') return [];
  const prof = arProfile(), ids = arScoredIds(prof);
  const out = [];
  ids.forEach(id => {
    const r = AR.results[id], def = AR_DEF[id];
    if (!r || (r.status !== 'pass' && r.status !== 'fail')) return;
    const chk = {
      label: def.label, pass: r.status === 'pass', sev: def.sev, t: def.t, line: r.message, mean: def.mean, fix: def.fix,
      section: 'ins:agent', actions: [insOpenAction('agent', 'Open agent readiness')], agent: id
    };
    if (!chk.pass) chk.fixCode = arFixFor(id, d);
    out.push(chk);
  });
  return out;
}

/* ------------------------------------------------------------------ fixes */
function arHeaderVariants(pairs) {
  const q = (s) => String(s).replace(/"/g, '\\"');
  return [
    { id: 'raw', label: 'Headers', code: pairs.map(p => p[0] + ': ' + p[1]).join('\n') },
    { id: 'nginx', label: 'nginx', code: pairs.map(p => `add_header ${p[0]} "${q(p[1])}" always;`).join('\n') },
    { id: 'apache', label: 'Apache', code: '<IfModule mod_headers.c>\n' + pairs.map(p => `  Header always add ${p[0]} "${q(p[1])}"`).join('\n') + '\n</IfModule>' },
    { id: 'netlify', label: 'Netlify', code: '/*\n' + pairs.map(p => `  ${p[0]}: ${p[1]}`).join('\n') },
    { id: 'vercel', label: 'Vercel', code: arJsonStr({ headers: [{ source: '/(.*)', headers: pairs.map(p => ({ key: p[0], value: p[1] })) }] }) },
    { id: 'cloudflare', label: 'Cloudflare', code: 'Rules → Transform Rules → Modify Response Header → Create rule (all incoming requests)\n' + pairs.map(p => `Add  ${p[0]}  =  ${p[1]}`).join('\n') }
  ];
}

function arInternalLinks(d, max) {
  const seen = new Set(), out = [];
  ((d && d.links) || []).forEach(l => {
    if (!l.isInternal || out.length >= max) return;
    let u; try { u = new URL(l.url); } catch (e) { return; }
    const key = u.pathname.replace(/\/$/, '');
    if (!key || seen.has(key) || /\.(jpg|png|gif|svg|webp|pdf|zip)$/i.test(key)) return;
    const text = (l.text || '').replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 60 || /^(click here|read more|learn more|here|more)$/i.test(text)) return;
    seen.add(key);
    out.push({ text: text, url: u.origin + u.pathname });
  });
  return out;
}

const AR_FIX_BOTS_SEARCH = ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'ChatGPT-User', 'Claude-User', 'Perplexity-User'];
const AR_FIX_BOTS_TRAIN = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider', 'Amazonbot', 'Meta-ExternalAgent'];

function arFixFor(id, d) {
  const A = arInfo(d), o = A.origin || 'https://example.com', host = A.host || 'example.com', brand = A.brand || 'Example';
  const desc = A.desc || 'A one-sentence summary of what this site is and who it is for.';
  const F = (where, path, code, note, variants) => ({ where: where, path: path, code: code, note: note || '', variants: variants || null });
  switch (id) {
    case 'robotsTxt':
      return F('robots', '/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${o}/sitemap.xml`, 'Add Disallow lines only for private areas such as /admin/.');
    case 'sitemap': {
      const urls = Array.from(new Set([o + '/', A.url && A.url.split('#')[0]].filter(Boolean)));
      return F('file', '/sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map(u => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n  </url>`).join('\n') + '\n</urlset>', 'Most CMSs and frameworks generate this for you. This shows the format. List every public page.');
    }
    case 'linkHeaders': {
      const pairs = [];
      pairs.push(['Link', '</llms.txt>; rel="describedby"; type="text/plain"']);
      if (AR.results.apiCatalog && AR.results.apiCatalog.status === 'pass') pairs.push(['Link', '</.well-known/api-catalog>; rel="api-catalog"']);
      pairs.push(['Link', '</docs>; rel="service-doc"']);
      return F('headers', null, pairs.map(p => p[0] + ': ' + p[1]).join('\n'), 'Point each address at a file that really exists: /llms.txt is generated by the llms.txt fix, and /docs should be your documentation.', arHeaderVariants(pairs));
    }
    case 'contentSignals':
      return F('robots', '/robots.txt', 'User-agent: *\nContent-Signal: ai-train=no, search=yes, ai-input=yes\nAllow: /', 'Pick your own answers: ai-train is model training, ai-input is using pages in AI answers, search is search indexing. Put the line inside the User-agent: * group that already exists.');
    case 'robotsTxtAiRules':
      return F('robots', '/robots.txt', '# AI search and on-request fetchers: let them in so you can be cited\n' + AR_FIX_BOTS_SEARCH.map(b => `User-agent: ${b}\nAllow: /`).join('\n\n') + '\n\n# Training crawlers: your choice. Remove a block to allow it.\n' + AR_FIX_BOTS_TRAIN.slice(0, 4).map(b => `User-agent: ${b}\nDisallow: /`).join('\n\n'), 'Blocking training crawlers does not remove you from AI search. Search and training are separate bots.');
    case 'markdownNegotiation':
      return F('server', null, '// Cloudflare Worker: answer Accept: text/markdown with a Markdown copy\nexport default {\n  async fetch(request) {\n    const res = await fetch(request);\n    const wants = (request.headers.get(\'accept\') || \'\').includes(\'text/markdown\');\n    if (!wants || !(res.headers.get(\'content-type\') || \'\').includes(\'text/html\')) return res;\n    const markdown = htmlToMarkdown(await res.text()); // e.g. the turndown or node-html-markdown package\n    return new Response(markdown, { headers: {\n      \'content-type\': \'text/markdown; charset=utf-8\',\n      \'vary\': \'Accept\',\n      \'x-markdown-tokens\': String(Math.ceil(markdown.length / 4))\n    } });\n  }\n};', 'On Cloudflare you can also turn on “Markdown for Agents” for the zone and write no code. Keep HTML as the default and send Vary: Accept.', [
        { id: 'worker', label: 'Worker', code: null },
        { id: 'express', label: 'Express', code: "app.use((req, res, next) => {\n  if (!(req.get('accept') || '').includes('text/markdown')) return next();\n  res.vary('Accept');\n  res.type('text/markdown; charset=utf-8');\n  res.send(renderMarkdownFor(req.path)); // your own page-to-Markdown function\n});" },
        { id: 'nginx', label: 'nginx', code: 'map $http_accept $md_suffix { default ""; "~*text/markdown" ".md"; }\nserver {\n  types { text/markdown md; }\n  add_header Vary Accept;\n  location / { try_files $uri$md_suffix $uri $uri/index.html =404; }\n}' }
      ]);
    case 'webBotAuth':
      return F('file', '/.well-known/http-message-signatures-directory', arJsonStr({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: '<base64url public key>' }] }), 'Only needed if you run a bot or agent. Serve it with Content-Type application/http-message-signatures-directory+json and sign your outbound requests with Signature-Agent and Signature-Input.');
    case 'apiCatalog':
      return F('file', '/.well-known/api-catalog', arJsonStr({ linkset: [{ anchor: o + '/api', 'service-desc': [{ href: o + '/openapi.json', type: 'application/json' }], 'service-doc': [{ href: o + '/docs', type: 'text/html' }], status: [{ href: o + '/api/health' }] }] }), 'Serve with Content-Type: application/linkset+json. One entry per API.');
    case 'oauthDiscovery':
      return F('file', '/.well-known/oauth-authorization-server', arJsonStr({ issuer: o, authorization_endpoint: o + '/oauth/authorize', token_endpoint: o + '/oauth/token', jwks_uri: o + '/.well-known/jwks.json', grant_types_supported: ['authorization_code', 'refresh_token'], response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] }), 'Use /.well-known/openid-configuration instead if you run OpenID Connect. The issuer must match your real authorization server.');
    case 'oauthProtectedResource':
      return F('file', '/.well-known/oauth-protected-resource', arJsonStr({ resource: o, authorization_servers: [o], scopes_supported: ['read'], bearer_methods_supported: ['header'] }), 'Also send WWW-Authenticate: Bearer resource_metadata="' + o + '/.well-known/oauth-protected-resource" on 401 responses.');
    case 'authMd':
      return F('file', '/auth.md', `# ${host} auth.md\n\nHow an AI agent gets access to ${brand}.\n\n## Audience\nAgents acting for a ${brand} user.\n\n## Registration\n- Authorization server metadata: ${o}/.well-known/oauth-authorization-server\n- Registration endpoint: ${o}/oauth/register\n\n## Credentials\nSend the access token as \`Authorization: Bearer <token>\`.\n`, 'Replace the endpoints with real ones. Publish the OAuth metadata files as well.');
    case 'mcpServerCard':
      return F('file', '/.well-known/mcp/server-card.json', arJsonStr({ serverInfo: { name: brand + ' MCP', version: '1.0.0' }, description: desc, url: o + '/mcp', transport: { type: 'streamable-http', endpoint: '/mcp' }, capabilities: { tools: true, resources: false, prompts: false } }), 'Only publish this if you really run an MCP server at that address.');
    case 'a2aAgentCard':
      return F('file', '/.well-known/agent-card.json', arJsonStr({ name: brand + ' Agent', version: '1.0.0', description: desc, supportedInterfaces: [{ url: o + '/a2a', protocolBinding: 'JSONRPC' }], capabilities: { streaming: false }, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'], skills: [{ id: 'answer-questions', name: 'Answer questions', description: 'Answers questions about ' + brand + '.', tags: ['support'] }] }), 'Only publish this if you run an A2A agent at that address.');
    case 'agentSkills':
      return F('file', '/.well-known/agent-skills/index.json', arJsonStr({ $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json', skills: [{ name: 'use-' + host.replace(/[^a-z0-9]+/g, '-'), type: 'skill-md', description: 'How to find things and get answers on ' + brand + '.', url: '/.well-known/agent-skills/use-site/SKILL.md', digest: 'sha256:<run: shasum -a 256 SKILL.md>' }] }), 'Write the SKILL.md file it points to, then put its real SHA-256 digest in place of the placeholder.');
    case 'webMcp': {
      // the name goes inside a JS string and an HTML attribute, so drop characters that would end either
      const brand = (A.brand || 'Example').replace(/[\\'"<>`\r\n]/g, '');
      return F('body', null, `<script>\nif ('modelContext' in navigator) {\n  navigator.modelContext.registerTool({\n    name: 'search_site',\n    description: 'Search ${brand} and return matching pages.',\n    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for' } }, required: ['query'] },\n    async execute({ query }) {\n      const res = await fetch('/search?q=' + encodeURIComponent(query));\n      return { content: [{ type: 'text', text: await res.text() }] };\n    }\n  });\n}\n</script>\n\n<!-- or declare an existing form as a tool -->\n<form toolname="search_site" tooldescription="Search ${brand}" action="/search">\n  <input name="q" toolparamdescription="What to look for">\n</form>`, 'Register only actions that are safe for an agent to run on a person’s behalf.');
    }
    case 'ard':
      return F('file', '/.well-known/ai-catalog.json', arJsonStr({ specVersion: '1.0', host: { displayName: brand, identifier: 'did:web:' + host, documentationUrl: o + '/' }, entries: [{ identifier: 'urn:air:' + host + ':docs:llms-txt', displayName: brand + ' LLM index', type: 'text/plain', url: o + '/llms.txt', description: 'Guide to ' + brand + ' for AI systems.', representativeQueries: ['What is ' + brand + '?', 'Where are the ' + brand + ' docs?'] }] }), 'Add one entry per MCP server, agent, skill index or API you publish. Each entry has exactly one of url or data.');
    case 'dnsAid':
      return F('dns', null, `_index._agents.${host}.  300  IN  HTTPS  1 ${host}. alpn=h2\n_index._agents.${host}.  300  IN  TXT    "v=1; url=${o}/.well-known/ai-catalog.json"`, 'Sign the zone with DNSSEC so resolvers can trust the records. This is an early draft, so check the current spec for the record format.');
    case 'x402':
      return F('server', null, "import express from 'express';\nimport { paymentMiddleware } from '@x402/express';\n\nconst app = express();\napp.use(paymentMiddleware('0xYourWalletAddress', {\n  'GET /api/premium': { price: '$0.01', network: 'base' }\n}, { url: 'https://x402.org/facilitator' }));", 'Protected routes answer HTTP 402 with payment requirements that agents settle automatically.');
    case 'mpp':
      return F('file', '/openapi.json', arJsonStr({ openapi: '3.1.0', info: { title: brand + ' API', version: '1.0.0' }, 'x-service-info': { categories: ['data'] }, paths: { '/api/premium': { get: { summary: 'Premium data', 'x-payment-info': { intent: 'charge', method: 'stripe', amount: '0.01', currency: 'USD' }, responses: { 200: { description: 'OK' } } } } } }), 'Add x-payment-info to every payable operation of your existing OpenAPI document.');
    case 'ucp':
      return F('file', '/.well-known/ucp', arJsonStr({ protocol_version: '1.0', services: ['catalog', 'checkout'], capabilities: ['product_search', 'cart', 'payment'], endpoints: { catalog: o + '/api/ucp/catalog', checkout: o + '/api/ucp/checkout' } }), 'Check the UCP spec for the current field names and replace the endpoints with real ones.');
    case 'acp':
      return F('file', '/.well-known/acp.json', arJsonStr({ protocol: { name: 'acp', version: '2025-09-29' }, api_base_url: o + '/api/acp', transports: ['rest'], capabilities: { services: ['checkout'] } }), 'Replace the API base URL with your real Agentic Commerce Protocol endpoint.');
    case 'ap2':
      return F('file', '/.well-known/agent-card.json', arJsonStr({ capabilities: { extensions: [{ uri: 'https://github.com/google-agentic-commerce/ap2/v1', required: false }] } }), 'Merge this into the capabilities of your A2A agent card.');
    case 'llmsTxt': {
      const links = arInternalLinks(A.d, 12);
      const body = `# ${brand}\n\n> ${desc}\n\n## Main pages\n- [Home](${o}/): ${arShort(desc, 80)}\n` + links.map(l => `- [${l.text}](${l.url})`).join('\n') + '\n\n## Optional\n- [Sitemap](' + o + '/sitemap.xml)\n';
      return F('file', '/llms.txt', body, 'Edit the summary and add a one-line description after each link. Keep it short: it is a guide, not a copy of the site.');
    }
    case 'orgSchema':
      return { where: 'json', code: '<script type="application/ld+json">\n' + arJsonStr({ '@context': 'https://schema.org', '@type': 'Organization', name: brand, url: o + '/', logo: o + '/logo.png', sameAs: ['https://www.linkedin.com/company/your-company', 'https://x.com/your-handle', 'https://en.wikipedia.org/wiki/Your_Company'] }) + '\n</script>', note: 'Use your real profile addresses. Only list pages that are really yours.' };
    case 'articleAuthor':
      return { where: 'json', code: '<script type="application/ld+json">\n' + arJsonStr({ '@context': 'https://schema.org', '@type': 'Article', headline: A.title, author: { '@type': 'Person', name: 'Author Name', url: o + '/authors/author-name' }, publisher: { '@type': 'Organization', name: brand }, datePublished: (d.seo && d.seo.articlePublished) || new Date().toISOString().slice(0, 10) }) + '\n</script>', note: 'Merge the author into your existing Article markup rather than adding a second block.' };
    case 'breadcrumb': {
      const parts = A.path.split('/').filter(Boolean);
      const items = [{ '@type': 'ListItem', position: 1, name: 'Home', item: o + '/' }].concat(parts.map((p, i) => ({ '@type': 'ListItem', position: i + 2, name: decodeURIComponent(p).replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()), item: o + '/' + parts.slice(0, i + 1).join('/') })));
      return { where: 'json', code: '<script type="application/ld+json">\n' + arJsonStr({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items }) + '\n</script>', note: 'Rename each step to match the visible breadcrumb.' };
    }
  }
  return null;
}

// a prompt a coding agent can run: the same task, the spec and a way to verify
function arPrompt(id, d) {
  const def = AR_DEF[id] || {}, A = arInfo(d), fx = arFixFor(id, d);
  const lines = [`Task: ${def.t || id} for ${A.host || 'this site'}.`, '', `Goal: ${def.goal || ''}`, `What to do: ${def.fix || ''}`];
  if (def.path && /^\//.test(def.path)) lines.push(`Address: ${A.origin}${def.path}`);
  if (def.spec && def.spec.length) lines.push('Spec: ' + def.spec.map(s => s[1]).join(' , '));
  if (fx && (fx.code || (fx.variants && fx.variants[0] && fx.variants[0].code))) lines.push('', 'Starter content (adapt it to the real site):', fx.code || fx.variants[0].code);
  lines.push('', def.path && /^\//.test(def.path) ? `Verify: request ${A.origin}${def.path} and confirm it answers HTTP 200 with the format above.` : 'Verify: deploy, then rescan the site in Stylytics and confirm the check passes.');
  return lines.join('\n');
}

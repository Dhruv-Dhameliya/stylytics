/* site-scan.js — scan many pages of one site and answer the questions a single page cannot.
 *
 * Pages come from the sitemap (or, failing that, from the links on this page). Up to SITE_LIMIT pages
 * are scanned per run, one at a time, in a background tab that is closed again afterwards. Each page is
 * reduced to a small record; the aggregation across records finds duplicate titles and descriptions,
 * orphan pages, font, size and color sprawl, missing structured data, and which section drags scores down.
 */

const SITE_LIMIT = 10;                 // pages per run
const SITE_MAX_URLS = 3000;            // sitemap entries kept
const SITE_PAGE_TIMEOUT = 25000;       // ms to wait for a page to load
const SITE_STORE = 'site_scan';
const SITE = { host: '', origin: '', pageUrl: '', urls: [], source: '', picked: [], filter: '', phase: 'idle', progress: { done: 0, total: 0, current: '' }, results: [], at: 0, cancel: false, error: '', note: '' };

/* ------------------------------------------------------------------ url helpers */
const SITE_SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|mp4|mp3|webm|zip|gz|xml|json|txt|css|js|mjs|woff2?|ttf|docx?|xlsx?|pptx?)(\?|$)/i;

function siteNorm(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    let p = u.pathname.replace(/\/{2,}/g, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    u.pathname = p;
    return u.href;
  } catch (e) { return ''; }
}
function siteSameSite(url, host) { try { return new URL(url).hostname.replace(/^www\./, '') === host; } catch (e) { return false; } }
function sitePath(url) { try { const u = new URL(url); return (u.pathname || '/') + u.search; } catch (e) { return url; } }
function siteSection(url) {
  try { const seg = new URL(url).pathname.split('/').filter(Boolean)[0]; return seg ? '/' + seg : 'Home'; } catch (e) { return 'Home'; }
}

/* ------------------------------------------------------------------ discovery */
function siteLocs(xml) {
  const out = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s][^<\]]*?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(m[1].replace(/&amp;/g, '&'));
  return out;
}

async function siteDiscover(pageUrl, pageLinks) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch (e) { return { urls: [], source: '' }; }
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const sitemaps = [];
  const robots = await fetchWithTimeout(origin + '/robots.txt', 6000);
  if (robots && robots.ok) {
    (await robots.text()).split(/\r?\n/).forEach(l => { const m = l.match(/^\s*sitemap:\s*(\S+)/i); if (m) sitemaps.push(m[1]); });
  }
  ['/sitemap.xml', '/sitemap_index.xml'].forEach(p => { if (sitemaps.indexOf(origin + p) < 0) sitemaps.push(origin + p); });

  const found = [];
  let fetched = 0;
  const queue = sitemaps.slice(0, 6);
  while (queue.length && fetched < 12 && found.length < SITE_MAX_URLS) {
    const sm = queue.shift();
    fetched++;
    const res = await fetchWithTimeout(sm, 8000);
    if (!res || !res.ok) continue;
    const text = await res.text();
    const locs = siteLocs(text);
    if (/<sitemapindex/i.test(text)) locs.slice(0, 6).forEach(l => queue.push(l));
    else locs.forEach(l => found.push(l));
  }

  let urls = found, source = 'sitemap';
  if (!urls.length) {
    urls = (pageLinks || []).filter(l => l.isInternal).map(l => l.url);
    source = 'links';
  }
  const seen = new Set(), clean = [];
  [siteNorm(pageUrl)].concat(urls.map(siteNorm)).forEach(u => {
    if (!u || seen.has(u) || !/^https?:/.test(u) || !siteSameSite(u, host) || SITE_SKIP_EXT.test(u)) return;
    seen.add(u); clean.push(u);
  });
  return { urls: clean.slice(0, SITE_MAX_URLS), source: source };
}

// Spread the picks across sections so each template is sampled, favouring short paths (usually hubs).
function siteSpread(urls, n, first) {
  const groups = {};
  urls.forEach(u => { const g = siteSection(u); (groups[g] = groups[g] || []).push(u); });
  Object.keys(groups).forEach(g => groups[g].sort((a, b) => sitePath(a).length - sitePath(b).length));
  const order = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
  const out = [];
  if (first && urls.indexOf(first) >= 0) { out.push(first); const g = groups[siteSection(first)]; g.splice(g.indexOf(first), 1); }
  while (out.length < n && order.some(g => groups[g].length)) {
    order.forEach(g => { if (out.length < n && groups[g].length) out.push(groups[g].shift()); });
  }
  return out;
}

/* ------------------------------------------------------------------ scanning one page */
function siteTabWait(tabId) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve(ok); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish(true); };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(() => finish(false), SITE_PAGE_TIMEOUT);
    chrome.tabs.get(tabId, (t) => { if (!chrome.runtime.lastError && t && t.status === 'complete') finish(true); });
  });
}

function siteInject(tabId, files) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({ target: { tabId: tabId }, files: files }, (res) => {
      if (chrome.runtime.lastError || !res || !res[0]) resolve(null); else resolve(res[0].result || null);
    });
  });
}

// opts.anyHost: allow redirects to another site (page comparison); opts.record: build the record from the scan
async function siteScanUrl(url, opts) {
  opts = opts || {};
  const tab = await new Promise((resolve) => chrome.tabs.create({ url: url, active: false }, (t) => resolve(chrome.runtime.lastError ? null : t)));
  if (!tab) return { url: url, ok: false, error: 'Could not open a tab' };
  try { chrome.tabs.update(tab.id, { muted: true }, () => void chrome.runtime.lastError); } catch (e) { /* not essential */ }
  try {
    const loaded = await siteTabWait(tab.id);
    await new Promise(r => setTimeout(r, 900)); // let late scripts, layout shifts and paints settle
    const info = await new Promise((resolve) => chrome.tabs.get(tab.id, (t) => resolve(chrome.runtime.lastError ? null : t)));
    if (!opts.anyHost && info && info.url && !siteSameSite(info.url, SITE.host)) return { url: url, ok: false, error: 'Redirected to another site' };
    const data = await siteInject(tab.id, ['content_extractor.js']);
    if (!data) return { url: url, ok: false, error: loaded ? 'The page could not be read' : 'The page took too long to load' };
    data.insights = await siteInject(tab.id, ['content_insights.js']);
    if (data.insights && data.insights.shifts && data.insights.shifts.cls != null && data.webVitals) data.webVitals.cls = data.insights.shifts.cls;
    const rec = (opts.record || siteRecord)(url, data);
    if (info && info.url && siteNorm(info.url) !== url) rec.finalUrl = siteNorm(info.url);
    return rec;
  } catch (e) {
    return { url: url, ok: false, error: String(e && e.message || e) };
  } finally {
    chrome.tabs.remove(tab.id, () => void chrome.runtime.lastError);
  }
}

/* ------------------------------------------------------------------ one page, reduced */
function siteRecord(url, d) {
  const seo = computeSeoChecklist(d), a11y = computeA11yScore(d), dp = computeDarkPatternChecklist(d);
  const llm = computeLlmVisibilityChecklist(d, typeof lastSiteFilesResult !== 'undefined' ? lastSiteFilesResult : null);
  const cons = computeDesignConsistencyScore(d), perf = computePerformanceScore(d);
  const scores = { seo: seo.score, a11y: a11y.score, ai: llm.score, ux: dp.score, design: cons.overall, speed: perf ? perf.score : null };
  const vals = Object.keys(scores).map(k => scores[k]).filter(v => v != null);

  const issues = [];
  [['seo', seo.checks], ['a11y', a11y.checks], ['ai', llm.checks], ['ux', dp.checks]].forEach(([cat, checks]) => {
    (checks || []).filter(c => !c.pass).forEach(c => {
      const g = CHECK_GUIDE[c.label] || {};
      const sev = typeof g.sev === 'function' ? g.sev(d) : (g.sev || 'Medium');
      issues.push([cat + ':' + shSlug(c.label), sev, insShort(g.t || c.t || c.label, 60)]);
    });
  });

  const meta = d.meta || {}, seoData = d.seo || {}, ins = d.insights || {};
  const links = (d.links || []);
  const internal = Array.from(new Set(links.filter(l => l.isInternal).map(l => siteNorm(l.url)).filter(Boolean))).slice(0, 200);
  const tokens = d.designTokens || {};
  const sp = kitPxNumbers([].concat(tokens.margins || [], tokens.paddings || [], tokens.gaps || []), 200);
  const topSp = {};
  Object.keys(sp).sort((a, b) => sp[b] - sp[a]).slice(0, 24).forEach(k => { topSp[k] = sp[k]; });
  const robots = seoData.robots || {};

  return {
    url: url, ok: true,
    title: meta.title || '', desc: meta.description || '', canonical: meta.canonical || '', lang: meta.language || '',
    h1: (d.outline || []).filter(h => String(h.tag).toLowerCase() === 'h1').map(h => insShort(h.text, 80)).slice(0, 4),
    headings: (d.outline || []).length, words: meta.wordCount || 0,
    canonicalMismatch: !!seoData.canonicalMismatch, noindex: !!robots.noindex,
    og: !!(d.socialMeta && d.socialMeta.og && d.socialMeta.og.image), sd: ((d.structuredData && d.structuredData.types) || []).slice(0, 10),
    scores: scores, composite: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    fonts: Array.from(new Set((d.fonts || []).map(insFont).filter(Boolean))).slice(0, 10),
    sizes: kitFontSizes(d), colors: Array.from(new Set([].concat(d.colors || [], d.bgColors || []).map(c => String(c.hex).toUpperCase()))).slice(0, 40),
    spacing: topSp, radii: kitRadii(d),
    tech: ((d.techStack || []).map(t => t.name)).slice(0, 20),
    internal: internal, external: links.filter(l => !l.isInternal).length,
    img: ins.images ? { n: ins.images.summary.count, save: ins.images.summary.savableBytes, noAlt: ins.images.summary.missingAlt } : null,
    cls: d.webVitals ? d.webVitals.cls : null, lcp: d.webVitals ? d.webVitals.lcp : null,
    aria: ins.aria ? ins.aria.issues.length : null, unnamed: ins.names ? ins.names.filter(n => n.kind === 'missing').length : null,
    grade: ins.readability && ins.readability.reliable ? ins.readability.grade : null,
    issues: issues.slice(0, 40)
  };
}

/* ------------------------------------------------------------------ aggregation */
function siteAvg(list, pick) {
  const v = list.map(pick).filter(x => x != null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

function siteDupes(pages, key) {
  const map = {};
  pages.forEach(p => { const v = (typeof key === 'function' ? key(p) : p[key]) || ''; const k = v.trim().toLowerCase(); if (k) (map[k] = map[k] || { text: v.trim(), urls: [] }).urls.push(p.url); });
  return Object.keys(map).map(k => map[k]).filter(g => g.urls.length > 1).sort((a, b) => b.urls.length - a.urls.length);
}

function siteCluster(sortedNums, within) {
  let clusters = 0, last = null;
  sortedNums.forEach(n => { if (last == null || n - last > within) clusters++; last = n; });
  return clusters;
}

function siteAggregate(results, allUrls) {
  const pages = results.filter(r => r.ok);
  const n = pages.length;
  const agg = { pages: n, failed: results.length - n, avg: {}, sections: [], dup: {}, missing: {}, orphans: [], inbound: [], sprawl: {}, sd: {}, issues: [] };
  if (!n) return agg;
  ['seo', 'a11y', 'speed', 'ai', 'ux', 'design'].forEach(k => { agg.avg[k] = siteAvg(pages, p => p.scores[k]); });
  agg.avg.composite = siteAvg(pages, p => p.composite);

  // sections (the first path segment stands in for a template)
  const bySec = {};
  pages.forEach(p => { (bySec[siteSection(p.url)] = bySec[siteSection(p.url)] || []).push(p); });
  agg.sections = Object.keys(bySec).map(s => ({
    name: s, pages: bySec[s].length, composite: siteAvg(bySec[s], p => p.composite), seo: siteAvg(bySec[s], p => p.scores.seo),
    a11y: siteAvg(bySec[s], p => p.scores.a11y), speed: siteAvg(bySec[s], p => p.scores.speed), design: siteAvg(bySec[s], p => p.scores.design)
  })).sort((a, b) => (a.composite == null) - (b.composite == null) || a.composite - b.composite);

  // duplicates and gaps
  agg.dup.titles = siteDupes(pages, 'title');
  agg.dup.descs = siteDupes(pages, 'desc');
  agg.dup.h1 = siteDupes(pages, p => p.h1[0]);
  agg.missing.title = pages.filter(p => !p.title);
  agg.missing.desc = pages.filter(p => !p.desc);
  agg.missing.h1 = pages.filter(p => p.h1.length === 0);
  agg.missing.multiH1 = pages.filter(p => p.h1.length > 1);
  agg.missing.canonical = pages.filter(p => p.canonicalMismatch);
  agg.missing.noindex = pages.filter(p => p.noindex);
  agg.missing.og = pages.filter(p => !p.og);
  agg.missing.alt = pages.filter(p => p.img && p.img.noAlt > 0);

  // link graph from the scanned pages
  const scanned = new Set(pages.map(p => siteNorm(p.finalUrl || p.url)));
  const inbound = {};
  pages.forEach(p => p.internal.forEach(t => { if (t !== siteNorm(p.url)) inbound[t] = (inbound[t] || 0) + 1; }));
  const known = new Set(allUrls || []);
  scanned.forEach(u => known.add(u));
  agg.orphans = Array.from(known).filter(u => !inbound[u]).filter(u => !/^https?:\/\/[^/]+\/?$/.test(u)).slice(0, 60);
  agg.inbound = Object.keys(inbound).map(u => ({ url: u, n: inbound[u], scanned: scanned.has(u) })).sort((a, b) => b.n - a.n).slice(0, 12);
  agg.knownUrls = known.size;

  // design sprawl
  const fontPages = {}, colorPages = {};
  pages.forEach(p => { p.fonts.forEach(f => { (fontPages[f] = fontPages[f] || new Set()).add(p.url); }); p.colors.forEach(c => { (colorPages[c] = colorPages[c] || new Set()).add(p.url); }); });
  const sizes = Array.from(new Set([].concat.apply([], pages.map(p => p.sizes)))).sort((a, b) => a - b);
  const sizePages = {};
  pages.forEach(p => p.sizes.forEach(s => { (sizePages[s] = sizePages[s] || new Set()).add(p.url); }));
  const colors = Object.keys(colorPages);
  const colorClusters = [];
  colors.slice().sort((a, b) => colorPages[b].size - colorPages[a].size).forEach(c => {
    const home = colorClusters.filter(g => conDist(g.rep, c) <= 3)[0];
    if (home) home.members.push(c); else colorClusters.push({ rep: c, members: [c] });
  });
  const spacing = {};
  pages.forEach(p => Object.keys(p.spacing).forEach(k => { spacing[k] = (spacing[k] || 0) + p.spacing[k]; }));
  const spTotal = Object.keys(spacing).reduce((s, k) => s + spacing[k], 0) || 1;
  const on4 = Object.keys(spacing).reduce((s, k) => s + (Number(k) % 4 === 0 ? spacing[k] : 0), 0);
  agg.sprawl = {
    fonts: Object.keys(fontPages).map(f => ({ name: f, pages: fontPages[f].size })).sort((a, b) => b.pages - a.pages),
    sizes: sizes.map(s => ({ px: s, pages: sizePages[s].size })),
    sizeClusters: siteCluster(sizes, 1),
    colors: colors.length, colorClusters: colorClusters.length, nearColors: colors.length - colorClusters.length,
    colorList: colors.map(c => ({ hex: c, pages: colorPages[c].size })).sort((a, b) => b.pages - a.pages),
    onlyOnePage: colors.filter(c => colorPages[c].size === 1).length,
    spacingDistinct: Object.keys(spacing).length, spacingOn4: Math.round(on4 / spTotal * 100),
    radii: Array.from(new Set([].concat.apply([], pages.map(p => p.radii)))).length
  };

  // structured data coverage
  const types = {};
  pages.forEach(p => p.sd.forEach(t => { (types[t] = types[t] || []).push(p.url); }));
  agg.sd = { withData: pages.filter(p => p.sd.length).length, without: pages.filter(p => !p.sd.length), types: Object.keys(types).map(t => ({ type: t, pages: types[t].length })).sort((a, b) => b.pages - a.pages) };

  // issues shared by many pages
  const iss = {};
  pages.forEach(p => p.issues.forEach(i => { (iss[i[0]] = iss[i[0]] || { id: i[0], sev: i[1], t: i[2], urls: [] }).urls.push(p.url); }));
  agg.issues = Object.keys(iss).map(k => iss[k]).sort((a, b) => b.urls.length - a.urls.length || SH_SEV_RANK[a.sev] - SH_SEV_RANK[b.sev]);
  return agg;
}

/* ------------------------------------------------------------------ storage */
function siteSave() {
  chrome.storage.local.get([SITE_STORE], (res) => {
    const all = res[SITE_STORE] || {};
    all[SITE.host] = { at: SITE.at, source: SITE.source, results: SITE.results, urls: SITE.urls.slice(0, 600) };
    const keys = Object.keys(all);
    if (keys.length > 12) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 12).forEach(k => delete all[k]);
    chrome.storage.local.set({ [SITE_STORE]: all });
  });
}

function siteOnScan(url) {
  let host = '', origin = '';
  try { const u = new URL(url); host = u.hostname.replace(/^www\./, ''); origin = u.origin; } catch (e) { /* internal page */ }
  if (host !== SITE.host && SITE.phase !== 'running') {
    Object.assign(SITE, { host: host, origin: origin, urls: [], picked: [], results: [], source: '', phase: 'idle', filter: '', error: '', at: 0 });
    if (host) chrome.storage.local.get([SITE_STORE], (res) => {
      const saved = (res[SITE_STORE] || {})[host];
      if (saved && saved.results && saved.results.length && SITE.host === host) { SITE.results = saved.results; SITE.at = saved.at; SITE.source = saved.source; SITE.urls = saved.urls || []; SITE.phase = 'done'; }
    });
  }
  SITE.pageUrl = url;
}

/* ------------------------------------------------------------------ running */
async function siteStart() {
  if (SITE.phase === 'running' || !SITE.picked.length) return;
  SITE.phase = 'running'; SITE.cancel = false; SITE.error = '';
  const queue = SITE.picked.slice(0, SITE_LIMIT);
  SITE.progress = { done: 0, total: queue.length, current: '' };
  SITE.results = [];
  siteRefresh();
  for (const url of queue) {
    if (SITE.cancel) break;
    SITE.progress.current = url;
    siteRefresh();
    const rec = await siteScanUrl(url);
    SITE.results.push(rec);
    SITE.progress.done++;
    siteRefresh();
  }
  SITE.at = Date.now();
  SITE.phase = SITE.results.some(r => r.ok) ? 'done' : 'pick';
  if (!SITE.results.some(r => r.ok)) SITE.error = SITE.cancel ? 'Scan stopped before any page finished.' : 'None of the pages could be read.';
  SITE.progress.current = '';
  if (SITE.results.length) siteSave();
  siteRefresh();
}

function siteRefresh() { try { const top = SH.stack[SH.stack.length - 1]; if (top && top.pane === 'site') shRender(); } catch (e) { /* not drawn */ } }

async function siteFind() {
  if (SITE.phase === 'discovering') return;
  SITE.phase = 'discovering'; SITE.error = ''; siteRefresh();
  const d = lastExtractedData;
  const found = await siteDiscover(SITE.pageUrl, d && d.links);
  SITE.urls = found.urls; SITE.source = found.source;
  if (!found.urls.length) { SITE.phase = 'idle'; SITE.error = 'No pages were found. The site has no readable sitemap and this page links to no other pages.'; }
  else { SITE.picked = siteSpread(found.urls, SITE_LIMIT, siteNorm(SITE.pageUrl)); SITE.phase = 'pick'; }
  siteRefresh();
}

/* ------------------------------------------------------------------ screen: parts */
function siteScore(v) { const t = v == null ? ['—', 'none'] : shTier(v); return `<span class="site-sc ${t[1]}">${v == null ? '—' : v}</span>`; }
function siteLink(url, label) { return `<a class="site-a" href="${shEsc(url)}" target="_blank" rel="noopener" title="${shEsc(url)}">${shEsc(label || sitePath(url))}</a>`; }
function siteGroup(title, count, body, open) { return `<details class="site-g"${open ? ' open' : ''}><summary><span>${title}</span><em>${count}</em></summary><div class="site-gb">${body}</div></details>`; }
function siteUrlList(urls, max) { return `<div class="site-urls">${urls.slice(0, max || 6).map(u => siteLink(u)).join('')}${urls.length > (max || 6) ? `<small>+${urls.length - (max || 6)} more</small>` : ''}</div>`; }

function siteIntro() {
  return `<section class="sh-card ins-pad"><b>Scan more than one page</b>
      <p class="ins-lede">Pick up to ${SITE_LIMIT} pages and Stylytics scans them one at a time in a background tab. Then it answers what a single page cannot: duplicate titles, orphan pages, font and color sprawl, and which section drags the scores down.</p>
      <div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="site" data-v="find">Find pages on ${shEsc(SITE.host || 'this site')}</button></div>
      ${SITE.error ? `<p class="ins-note con-msg">${shEsc(SITE.error)}</p>` : ''}</section>
    <p class="ins-note">Only pages on the same site are scanned, and nothing leaves your device.</p>`;
}

function sitePickList() {
  const q = SITE.filter.trim().toLowerCase();
  const rows = SITE.urls.map((u, i) => [u, i]).filter(x => !q || x[0].toLowerCase().indexOf(q) >= 0);
  const full = SITE.picked.length >= SITE_LIMIT;
  return rows.slice(0, 150).map(([u, i]) => {
    const on = SITE.picked.indexOf(u) >= 0;
    const off = !on && full;
    return `<button type="button" class="site-pick${on ? ' on' : ''}${off ? ' off' : ''}" data-sh="site" data-v="toggle" data-i="${i}" aria-pressed="${on}" ${off ? 'disabled' : ''}><span class="site-ck">${on ? shIcon('check', 12) : ''}</span><span class="site-pt"><b>${shEsc(sitePath(u))}</b><small>${shEsc(siteSection(u))}</small></span></button>`;
  }).join('') + (rows.length > 150 ? `<p class="ins-note" style="padding:8px 12px">Showing 150 of ${rows.length}. Use the filter to narrow down.</p>` : '') + (!rows.length ? '<div class="sh-empty"><b>No pages match</b></div>' : '');
}

function sitePickView() {
  const n = SITE.picked.length;
  return `<section class="sh-card ins-pad"><b>${SITE.urls.length} page${SITE.urls.length === 1 ? '' : 's'} found</b>
      <small class="site-src">${SITE.source === 'sitemap' ? 'From the sitemap' : 'From links on this page (no sitemap found)'}</small>
      <p class="ins-lede">Choose up to ${SITE_LIMIT}. The preselected pages are spread across the site so each section is sampled.</p>
      <div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="site" data-v="start" ${n ? '' : 'disabled'}>Scan ${n} page${n === 1 ? '' : 's'}</button>
        <button type="button" class="sh-btn sm" data-sh="site" data-v="spread">Spread across the site</button><button type="button" class="sh-btn sm" data-sh="site" data-v="clear">Clear</button></div>
      ${SITE.error ? `<p class="ins-note con-msg">${shEsc(SITE.error)}</p>` : ''}</section>
    <input type="search" id="site-filter" class="search-input site-filter" placeholder="Filter pages" value="${shEsc(SITE.filter)}" autocomplete="off">
    <div class="sh-card site-pickwrap" id="site-list">${sitePickList()}</div>`;
}

function siteRunView() {
  const p = SITE.progress;
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  return `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big">${p.done}<span class="site-of"> / ${p.total}</span></span><span class="sh-tchip warn">Scanning</span></div>
      <div class="ins-bar site-bar"><i style="width:${pct}%;background:var(--accent)"></i></div>
      <p class="ins-lede site-cur">${p.current ? shEsc(sitePath(p.current)) : 'Finishing…'}</p>
      <p class="ins-note" style="margin:6px 0 10px">Pages open in a background tab one at a time and close again. You can keep using this panel.</p>
      <div class="sh-btns"><button type="button" class="sh-btn sm" data-sh="site" data-v="cancel">${SITE.cancel ? 'Stopping after this page…' : 'Stop'}</button></div></section>
    ${SITE.results.length ? `<div class="sh-sec"><span>Done so far</span></div><div class="sh-card ins-list">${SITE.results.map(siteDoneRow).join('')}</div>` : ''}`;
}

function siteDoneRow(r) {
  return `<div class="site-row"><span class="site-rt"><b>${shEsc(sitePath(r.url))}</b><small>${r.ok ? shEsc(insShort(r.title || '(no title)', 60)) : shEsc(r.error || 'Failed')}</small></span>${r.ok ? siteScore(r.composite) : '<span class="ins-chip bad">Failed</span>'}</div>`;
}

/* ------------------------------------------------------------------ screen: the report */
function siteReportView() {
  const agg = siteAggregate(SITE.results, SITE.urls);
  if (!agg.pages) return `<div class="sh-card"><div class="sh-empty"><b>No pages could be read</b>Try other pages.</div></div><div class="sh-btns ins-foot"><button type="button" class="sh-btn sm" data-sh="site" data-v="again">Choose pages</button></div>`;
  const s = agg.sprawl;
  const t = agg.avg.composite == null ? 'none' : shTier(agg.avg.composite)[1];
  let h = `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${t}">${agg.avg.composite == null ? '—' : agg.avg.composite}</span><span class="sh-tchip ${t}">Site average</span>
      <small>${insPlural(agg.pages, 'page')} scanned${agg.failed ? `, ${agg.failed} failed` : ''} · ${insAgo(SITE.at)}</small></div>
      <div class="site-avgs">${[['SEO', 'seo'], ['Design', 'design'], ['Access', 'a11y'], ['Speed', 'speed'], ['AI', 'ai'], ['UX', 'ux']].map(([l, k]) => `<span><small>${l}</small>${siteScore(agg.avg[k])}</span>`).join('')}</div></section>`;

  const dupT = agg.dup.titles.length, dupD = agg.dup.descs.length;
  h += `<div class="sh-sec"><span>Across the pages</span></div>`;
  h += `<div class="site-groups">`;
  h += siteGroup('Duplicate titles', dupT, dupT ? agg.dup.titles.slice(0, 6).map(g => `<div class="site-dup"><b>“${shEsc(insShort(g.text, 70))}”</b><small>${g.urls.length} pages</small>${siteUrlList(g.urls)}</div>`).join('') : '<p class="site-ok">Every page has its own title.</p>', dupT > 0);
  h += siteGroup('Duplicate descriptions', dupD, dupD ? agg.dup.descs.slice(0, 6).map(g => `<div class="site-dup"><b>“${shEsc(insShort(g.text, 80))}”</b><small>${g.urls.length} pages</small>${siteUrlList(g.urls)}</div>`).join('') : '<p class="site-ok">Every description is unique.</p>', dupD > 0);
  const gaps = [['No title', agg.missing.title], ['No meta description', agg.missing.desc], ['No H1', agg.missing.h1], ['More than one H1', agg.missing.multiH1], ['Canonical points elsewhere', agg.missing.canonical], ['Set to noindex', agg.missing.noindex], ['No social preview image', agg.missing.og], ['Images without alt', agg.missing.alt]].filter(g => g[1].length);
  h += siteGroup('Gaps on pages', gaps.reduce((a, g) => a + g[1].length, 0), gaps.length ? gaps.map(g => `<div class="site-dup"><b>${g[0]}</b><small>${insPlural(g[1].length, 'page')}</small>${siteUrlList(g[1].map(p => p.url), 4)}</div>`).join('') : '<p class="site-ok">No gaps found.</p>', false);
  h += siteGroup('Same problem on many pages', agg.issues.filter(i => i.urls.length > 1).length, agg.issues.filter(i => i.urls.length > 1).slice(0, 10).map(i => `<div class="site-iss"><span class="sh-sev ${shSevClass(i.sev)}">${i.sev}</span><b>${shEsc(i.t)}</b><small>${i.urls.length} of ${agg.pages}</small></div>`).join('') || '<p class="site-ok">No problem repeats across pages.</p>', true);
  h += `</div>`;

  h += `<div class="sh-sec"><span>Sections <em>lowest first</em></span></div><div class="sh-card site-table"><div class="site-th"><span>Section</span><span>All</span><span>SEO</span><span>Acc</span><span>Speed</span></div>${agg.sections.map(x => `<div class="site-tr"><span><b>${shEsc(x.name)}</b><small>${insPlural(x.pages, 'page')}</small></span>${siteScore(x.composite)}${siteScore(x.seo)}${siteScore(x.a11y)}${siteScore(x.speed)}</div>`).join('')}</div>`;

  h += `<div class="sh-sec"><span>Design sprawl <em>across ${insPlural(agg.pages, 'page')}</em></span></div><div class="sh-card ins-pad">
      <div class="ins-tiles" style="--cols:4;margin:0 0 10px"><div class="ins-tile ${s.fonts.length > 3 ? 'warn' : 'ok'}"><small>Fonts</small><b>${s.fonts.length}</b></div><div class="ins-tile ${s.sizes.length > 10 ? 'warn' : 'ok'}"><small>Sizes</small><b>${s.sizes.length}</b></div><div class="ins-tile ${s.colors > 24 ? 'warn' : 'ok'}"><small>Colors</small><b>${s.colors}</b></div><div class="ins-tile ${s.spacingOn4 < 70 ? 'warn' : 'ok'}"><small>On 4px grid</small><b>${s.spacingOn4}%</b></div></div>
      <p class="ins-lede">${s.sizes.length} font sizes between ${s.sizes[0] ? s.sizes[0].px : '–'} and ${s.sizes.length ? s.sizes[s.sizes.length - 1].px : '–'}px, but only ${s.sizeClusters} distinct steps once sizes within 1px are merged.
        ${s.colors} colors, ${s.nearColors ? `${s.nearColors} of them within 3% of another` : 'none near-duplicates'}${s.onlyOnePage ? `; ${s.onlyOnePage} appear on a single page` : ''}.</p>
      <div class="sh-sec" style="margin:12px 0 4px"><span>Fonts</span></div>
      ${s.fonts.slice(0, 6).map(f => `<div class="site-bar-row"><span>${shEsc(insShort(f.name, 28))}</span><div class="ins-share"><i style="width:${f.pages / agg.pages * 100}%"></i></div><small>${f.pages}/${agg.pages}</small></div>`).join('')}
      <div class="sh-sec" style="margin:12px 0 4px"><span>Colors <em>by pages using them</em></span></div>
      <div class="ins-sws">${s.colorList.slice(0, 28).map(c => `<i class="ins-sw" style="background:${shEsc(c.hex)};opacity:${0.4 + 0.6 * c.pages / agg.pages}" title="${shEsc(c.hex)} · ${c.pages} of ${agg.pages} pages"></i>`).join('')}</div></div>`;

  h += `<div class="sh-sec"><span>Structured data</span></div><div class="sh-card ins-pad"><p class="ins-lede" style="margin-top:0"><b>${agg.sd.withData} of ${agg.pages}</b> pages have structured data.${agg.sd.types.length ? ` Types: ${agg.sd.types.slice(0, 6).map(t => `${shEsc(t.type)} (${t.pages})`).join(', ')}.` : ''}</p>${agg.sd.without.length && agg.sd.withData ? `<p class="ins-note">Missing on: ${agg.sd.without.slice(0, 4).map(p => siteLink(p.url)).join(', ')}${agg.sd.without.length > 4 ? ` and ${agg.sd.without.length - 4} more` : ''}.</p>` : ''}</div>`;

  h += `<div class="sh-sec"><span>Internal links</span></div><div class="sh-card ins-pad">
      ${agg.inbound.length ? `<div class="sh-sec" style="margin:0 0 4px"><span>Most linked to</span></div>${agg.inbound.slice(0, 5).map(i => `<div class="site-bar-row"><span>${siteLink(i.url)}</span><div class="ins-share"><i style="width:${i.n / agg.inbound[0].n * 100}%"></i></div><small>${i.n}</small></div>`).join('')}` : ''}
      <div class="sh-sec" style="margin:12px 0 4px"><span>Possible orphans <em>${agg.orphans.length}</em></span></div>
      ${agg.orphans.length ? siteUrlList(agg.orphans, 8) : '<p class="site-ok">Every known page is linked from a scanned page.</p>'}
      <p class="ins-note">Orphans are pages (from the sitemap) that none of the ${insPlural(agg.pages, 'scanned page')} link to. Scan more pages for a fuller picture; the home page is skipped.</p></div>`;

  h += `<div class="sh-sec"><span>All pages <em>${agg.pages}</em></span></div><div class="sh-card ins-list">${SITE.results.slice().sort((a, b) => (a.composite == null) - (b.composite == null) || a.composite - b.composite).map(siteDoneRow).join('')}</div>`;
  h += `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="site" data-v="report">${shIcon('download', 13)} Export report</button><button type="button" class="sh-btn sm" data-sh="site" data-v="csv">CSV</button><button type="button" class="sh-btn sm" data-sh="site" data-v="copy">${shIcon('copy', 13)} Copy summary</button><button type="button" class="sh-btn sm" data-sh="site" data-v="again">Choose pages</button></div>`;
  return h;
}

function siteScreen() {
  if (SITE.phase === 'discovering') return '<div class="sh-card"><div class="sh-empty"><b>Looking for pages…</b>Reading robots.txt and the sitemap.</div></div>';
  if (SITE.phase === 'running') return siteRunView();
  if (SITE.phase === 'pick') return sitePickView();
  if (SITE.phase === 'done') return siteReportView();
  return siteIntro();
}

/* ------------------------------------------------------------------ actions, exports */
function siteSummaryText() {
  const agg = siteAggregate(SITE.results, SITE.urls);
  if (!agg.pages) return '';
  const L = [`Site scan of ${SITE.host}: ${insPlural(agg.pages, 'page')}, average score ${agg.avg.composite}`, ''];
  if (agg.dup.titles.length) { L.push('Duplicate titles:'); agg.dup.titles.slice(0, 8).forEach(g => L.push(`- "${g.text}" on ${g.urls.length} pages: ${g.urls.slice(0, 3).map(sitePath).join(', ')}`)); L.push(''); }
  if (agg.dup.descs.length) { L.push('Duplicate descriptions:'); agg.dup.descs.slice(0, 8).forEach(g => L.push(`- on ${g.urls.length} pages: ${g.urls.slice(0, 3).map(sitePath).join(', ')}`)); L.push(''); }
  L.push('Section scores (lowest first):'); agg.sections.forEach(x => L.push(`- ${x.name}: ${x.composite} (${insPlural(x.pages, 'page')})`)); L.push('');
  const s = agg.sprawl;
  L.push(`Design: ${s.fonts.length} fonts, ${s.sizes.length} font sizes (${s.sizeClusters} distinct steps), ${s.colors} colors (${s.nearColors} near-duplicates), ${s.spacingOn4}% of spacing on the 4px grid.`);
  if (agg.issues.length) { L.push('', 'Repeated problems:'); agg.issues.filter(i => i.urls.length > 1).slice(0, 8).forEach(i => L.push(`- ${i.t} (${i.urls.length} of ${agg.pages} pages)`)); }
  return L.join('\n');
}

function siteDownload(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type }));
  chrome.downloads.download({ url: url, filename: name }, () => { if (chrome.runtime.lastError) window.open(url, '_blank'); else showToast('Exported'); });
}

function siteCsv() {
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['url', 'status', 'section', 'title', 'title_length', 'description_length', 'h1_count', 'words', 'score', 'seo', 'design', 'accessibility', 'speed', 'ai', 'ux', 'issues'];
  const rows = SITE.results.map(r => r.ok
    ? [r.url, 'ok', siteSection(r.url), r.title, r.title.length, r.desc.length, r.h1.length, r.words, r.composite, r.scores.seo, r.scores.design, r.scores.a11y, r.scores.speed, r.scores.ai, r.scores.ux, r.issues.length]
    : [r.url, r.error || 'failed']);
  return [head].concat(rows).map(r => r.map(q).join(',')).join('\n');
}

function siteHandle(op, el) {
  const ds = el.dataset || {};
  switch (op) {
    case 'find': siteFind(); break;
    case 'toggle': {
      const u = SITE.urls[parseInt(ds.i, 10)];
      const at = SITE.picked.indexOf(u);
      if (at >= 0) SITE.picked.splice(at, 1); else if (SITE.picked.length < SITE_LIMIT) SITE.picked.push(u);
      shRender();
      break;
    }
    case 'spread': SITE.picked = siteSpread(SITE.urls, SITE_LIMIT, siteNorm(SITE.pageUrl)); shRender(); break;
    case 'clear': SITE.picked = []; shRender(); break;
    case 'start': siteStart(); break;
    case 'cancel': SITE.cancel = true; shRender(); break;
    case 'again': SITE.phase = SITE.urls.length ? 'pick' : 'idle'; SITE.picked = SITE.picked.length ? SITE.picked : siteSpread(SITE.urls, SITE_LIMIT, siteNorm(SITE.pageUrl)); shRender(); break;
    case 'copy': copyToClipboard(siteSummaryText(), 'Summary copied'); break;
    case 'csv': siteDownload(siteCsv(), `site-scan-${SITE.host}.csv`, 'text/csv'); break;
    case 'report': siteDownload(buildSiteReportHtml(SITE.host, SITE.results, siteAggregate(SITE.results, SITE.urls), SITE.at), `site-report-${SITE.host}.html`, 'text/html'); break;
  }
}

document.addEventListener('input', (e) => {
  if (!e.target || e.target.id !== 'site-filter') return;
  SITE.filter = e.target.value;
  const list = shEl('site-list');
  if (list) list.innerHTML = sitePickList();
});

SH_SCREENS.site = { title: 'Site scan', build: siteScreen };
SH_TOOLS.Page.push(['site', 'Site scan', 'globe']);
SH_TOOL_META.site = 'Scan up to ' + SITE_LIMIT + ' pages';
SH_TOOL_KEYWORDS.site = 'site crawl sitemap pages duplicate titles orphan sprawl multiple pages audit';

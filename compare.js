/* compare.js — compare this page with another page, side by side.
 *
 * Typical uses: staging against live, before against after a release, or your page against a competitor's.
 * The current page is reduced from the scan the panel already has; the other page is opened in a
 * background tab, read the same way and closed (reusing the site scanner). Both go through the same
 * scoring (`cmpAudit`), so the numbers are comparable: they leave out tests that only exist for the open
 * page (accessibility lab runs, field data, saved design tokens), which is why they can differ slightly
 * from the Audit tab.
 */

const CMP_STORE = 'cmp_recent';
const CMP = { input: '', phase: 'idle', a: null, b: null, error: '', at: 0, recent: [], swap: false, same: false, loaded: false };

/* ------------------------------------------------------------------ scoring */
function cmpAudit(d, files) {
  const seo = computeSeoChecklist(d), a11y = computeA11yScore(d), dp = computeDarkPatternChecklist(d);
  const llm = computeLlmVisibilityChecklist(d, files), cons = computeDesignConsistencyScore(d), perf = computePerformanceScore(d);
  const read = insReadabilityChecks(d), fresh = insFreshnessChecks(d), sd = sdChecks(d), img = insImageChecks(d), tp = tpChecks(d), labs = labScanChecks(d);
  const design = [
    { label: 'Color palette is compact', pass: cons.colorScore >= 80, line: `${cons.colorCount} distinct colors are in use.` },
    { label: 'Few font families', pass: cons.fontScore >= 80, line: `${cons.fontCount} font families are in use.` },
    { label: 'Spacing follows a consistent scale', pass: cons.spacingScore >= 70, line: 'Many one-off margin and padding values are in use.' }
  ];
  const raw = {
    seo: { score: insBlend(seo.score, read.concat(fresh, sd), 0.15), checks: seo.checks.concat(read, fresh, sd) },
    design: { score: cons.overall, checks: design },
    a11y: { score: insBlend(a11y.score, labs, 0.25), checks: a11y.checks.concat(labs) },
    speed: { score: insBlend(perf ? perf.score : null, img.concat(tp), 0.4), checks: img.concat(tp) },
    ai: { score: llm.score, checks: llm.checks },
    ux: { score: dp.score, checks: dp.checks }
  };
  const scores = {}, issues = [], seen = new Set();
  Object.keys(raw).forEach(cat => {
    scores[cat] = raw[cat].score;
    raw[cat].checks.forEach(c => {
      if (c.pass) return;
      const n = shNormCheck(cat, c, d);
      if (seen.has(n.t)) return;
      seen.add(n.t);
      issues.push([n.id, n.sev, insShort(n.t, 70)]);
    });
  });
  const vals = Object.keys(scores).map(k => scores[k]).filter(v => v != null);
  return { scores: scores, composite: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, issues: issues };
}

// the record a comparison works from: the site scanner's page record, re-scored and extended
function cmpRecord(url, d, files) {
  const rec = siteRecord(url, d);
  const audit = cmpAudit(d, files === undefined ? lastSiteFilesResult : files);
  const ins = d.insights || {}, v = d.webVitals || {};
  rec.scores = audit.scores; rec.composite = audit.composite;
  rec.issues = audit.issues.sort((x, y) => SH_SEV_RANK[x[1]] - SH_SEV_RANK[y[1]]).slice(0, 60);
  rec.fcp = v.fcp == null ? null : v.fcp; rec.ttfb = v.ttfb == null ? null : v.ttfb;
  rec.weight = ins.weight && ins.weight.total ? ins.weight.total : null;
  rec.imgBytes = ins.images ? ins.images.summary.totalBytes : null;
  rec.ogTitle = (d.socialMeta && d.socialMeta.og && d.socialMeta.og.title) || '';
  rec.techCat = {};
  (d.techStack || []).forEach(t => { rec.techCat[t.name] = t.category || ''; });
  rec.linkCount = (d.links || []).length;
  rec.at = Date.now();
  return rec;
}

/* ------------------------------------------------------------------ input */
function cmpResolve(text) {
  let s = String(text || '').trim();
  if (!s) return { error: 'Type the address of the other page.' };
  let base;
  try { base = new URL(SH.url || (lastExtractedData && lastExtractedData.meta.pageUrl)); } catch (e) { return { error: 'There is no page to compare yet.' }; }
  try {
    let u;
    if (s.charAt(0) === '/') u = new URL(s, base.origin);
    else {
      if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
      u = new URL(s);
      // a bare host means the same page on that host
      if (!/^https?:\/\/[^/]+\/./i.test(s) && !/[?#]/.test(s)) u = new URL(base.pathname + base.search, u.origin);
    }
    if (!/^https?:$/.test(u.protocol)) return { error: 'Only http and https pages can be compared.' };
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return { error: 'That does not look like a web address.' };
    return { url: siteNorm(u.href) };
  } catch (e) { return { error: 'That does not look like a web address.' }; }
}

function cmpSuggestions() {
  let u;
  try { u = new URL(SH.url); } catch (e) { return []; }
  const out = [];
  const tail = u.pathname + u.search;
  const host = u.hostname;
  const add = (label, hostName) => { if (hostName && hostName !== host && !out.some(o => o.host === hostName)) out.push({ label: label, host: hostName, url: u.protocol + '//' + hostName + (tail === '/' ? '' : tail) }); };
  if (/^www\./.test(host)) add('Without www', host.replace(/^www\./, '')); else if (host.split('.').length === 2) add('With www', 'www.' + host);
  const m = host.match(/^(staging|stage|dev|test|beta|preview|uat|qa|stg)[.-](.+)$/i);
  if (m) add('Live site', m[2]);
  CMP.recent.filter(r => { try { return new URL(r.url).hostname !== host; } catch (e) { return false; } }).slice(0, 3).forEach(r => { try { add('Recent', new URL(r.url).hostname); } catch (e) { /* skip */ } });
  return out.slice(0, 4);
}

function cmpLoad() {
  if (CMP.loaded) return;
  CMP.loaded = true;
  chrome.storage.local.get([CMP_STORE], (res) => { CMP.recent = res[CMP_STORE] || []; });
}
function cmpRemember(url) {
  CMP.recent = [{ url: url, at: Date.now() }].concat(CMP.recent.filter(r => r.url !== url)).slice(0, 6);
  chrome.storage.local.set({ [CMP_STORE]: CMP.recent });
}

// a new page was scanned: keep the result only when it is still about this page
function cmpOnScan(url) {
  cmpLoad();
  if (CMP.a && CMP.a.url !== siteNorm(url)) Object.assign(CMP, { phase: 'idle', a: null, b: null, error: '', swap: false });
}

/* ------------------------------------------------------------------ run */
async function cmpRun() {
  if (CMP.phase === 'running') return;
  const d = lastExtractedData;
  if (!d) return;
  const r = cmpResolve(CMP.input);
  if (r.error) { CMP.error = r.error; shRender(); return; }
  const pageUrl = siteNorm(d.meta.pageUrl);
  if (r.url === pageUrl) { CMP.error = 'That is the page you are on. Choose another address.'; shRender(); return; }
  Object.assign(CMP, { phase: 'running', error: '', a: null, b: null, swap: false });
  shRender();
  const a = cmpRecord(pageUrl, d);
  a.url = pageUrl;
  let b;
  try {
    const files = await checkSiteFiles(r.url).catch(() => null);
    b = await siteScanUrl(r.url, { anyHost: true, record: (u, data) => cmpRecord(u, data, files) });
  } catch (e) { b = { ok: false, error: String(e && e.message || e) }; }
  // the person scanned a different page while this was running: drop the result
  const now = lastExtractedData && lastExtractedData.meta && siteNorm(lastExtractedData.meta.pageUrl);
  if (now !== pageUrl) { CMP.phase = 'idle'; shRender(); return; }
  if (!b || !b.ok) { Object.assign(CMP, { phase: 'idle', error: (b && b.error) || 'The other page could not be read.' }); shRender(); return; }
  Object.assign(CMP, { phase: 'done', a: a, b: b, at: Date.now() });
  cmpRemember(r.url);
  shRender();
}

/* ------------------------------------------------------------------ comparison rows */
function cmpName(rec, other) {
  try {
    const u = new URL(rec.finalUrl || rec.url), o = new URL(other.finalUrl || other.url);
    const hostA = u.hostname.replace(/^www\./, ''), hostB = o.hostname.replace(/^www\./, '');
    if (hostA === hostB) return (u.pathname.length > 1 ? u.pathname : '/') + u.search;
    return hostA + (u.pathname.length > 1 ? insShort(u.pathname, 18) : '');
  } catch (e) { return rec.url; }
}

const CMP_SCORES = [['SEO', 'seo'], ['Design', 'design'], ['Accessibility', 'a11y'], ['Speed', 'speed'], ['AI readiness', 'ai'], ['UX', 'ux']];

function cmpDelta(x, y, lowerBetter) {
  if (x == null || y == null) return '';
  const d = y - x;
  if (d === 0) return '<span class="cmp-d eq">Same</span>';
  const better = lowerBetter ? d < 0 : d > 0;
  return `<span class="cmp-d ${better ? 'ok' : 'bad'}">${d > 0 ? '+' : ''}${Math.round(d * 100) / 100}</span>`;
}

function cmpSetDiff(a, b) {
  const sa = new Set(a), sb = new Set(b);
  return { onlyA: a.filter(x => !sb.has(x)), onlyB: b.filter(x => !sa.has(x)), both: a.filter(x => sb.has(x)) };
}

// text rows: show the two values; mark whether they match
function cmpTextRow(label, x, y, opts) {
  opts = opts || {};
  const same = String(x || '') === String(y || '');
  const fmt = (v) => v ? shEsc(insShort(v, opts.max || 90)) : '<i class="cmp-none">none</i>';
  const lenA = opts.len && x ? ` <small>${String(x).length}</small>` : '', lenB = opts.len && y ? ` <small>${String(y).length}</small>` : '';
  return { same: same, html: `<div class="cmp-tr${same ? ' same' : ''}"><span class="cmp-l">${label}${same ? '<em>same</em>' : ''}</span><span class="cmp-v">${fmt(x)}${lenA}</span><span class="cmp-v">${fmt(y)}${lenB}</span></div>` };
}

function cmpTier(metric, v) { return v == null ? 'none' : (getCwvTier(metric, v) === 'good' ? 'ok' : getCwvTier(metric, v) === 'poor' ? 'bad' : 'warn'); }

function cmpChips(list, cls, max) {
  return list.length ? `<span class="ins-chips">${list.slice(0, max || 14).map(x => `<span class="ins-chip ${cls}">${shEsc(x)}</span>`).join('')}${list.length > (max || 14) ? `<span class="ins-chip info">+${list.length - (max || 14)}</span>` : ''}</span>` : '<small class="cmp-none">none</small>';
}

function cmpSection(title, count, body, open) {
  return `<details class="site-g"${open ? ' open' : ''}><summary><span>${title}</span><em>${count}</em></summary><div class="site-gb">${body}</div></details>`;
}

/* ------------------------------------------------------------------ screen */
function cmpIntro() {
  const d = lastExtractedData;
  let here = '';
  try { const u = new URL(d.meta.pageUrl); here = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : ''); } catch (e) { /* none */ }
  const sug = cmpSuggestions();
  return `<section class="sh-card ins-pad"><b>Compare two pages</b>
      <p class="ins-lede">Put this page next to another: staging against live, before against after a release, or yours against a competitor’s. Scores, copy, speed, technology, fonts, colors and issues, side by side.</p>
      <div class="cmp-pair"><div class="cmp-end"><small>This page</small><b title="${shEsc(d.meta.pageUrl)}">${shEsc(insShort(here, 38))}</b></div><span class="cmp-vs">vs</span>
        <div class="cmp-end b"><small>Compare with</small><input type="text" id="cmp-input" class="search-input" placeholder="Domain or full address" value="${shEsc(CMP.input)}" autocomplete="off" spellcheck="false"></div></div>
      ${sug.length ? `<div class="cmp-sug">${sug.map(s => `<button type="button" class="ovf-w" data-sh="cmp" data-v="fill" data-url="${shEsc(s.url)}" title="${shEsc(s.url)}">${shEsc(s.label)} · ${shEsc(insShort(s.host, 24))}</button>`).join('')}</div>` : ''}
      <div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="cmp" data-v="run">${shIcon('layers', 13)} Compare</button></div>
      ${CMP.error ? `<p class="ins-note con-msg">${shEsc(CMP.error)}</p>` : ''}</section>
    <p class="ins-note">Type just a domain to compare the same page on it. The other page opens in a background tab, is read once and closes again. Pages that need you to be signed in will be read as signed out.</p>`;
}

function cmpRunning() {
  return `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big"><span class="site-of">Reading</span></span><span class="sh-tchip warn">Scanning</span></div>
      <div class="ins-bar site-bar"><i style="width:55%;background:var(--accent);animation:ins-pulse 1.2s ease-in-out infinite alternate"></i></div>
      <p class="ins-lede site-cur">${shEsc(CMP.input)}</p><p class="ins-note" style="margin:6px 0 0">Opening it in a background tab. This takes a few seconds.</p></section>`;
}

function cmpResult() {
  const A = CMP.swap ? CMP.b : CMP.a, B = CMP.swap ? CMP.a : CMP.b;
  const na = cmpName(A, B), nb = cmpName(B, A);
  const ca = A.composite, cb = B.composite;
  const diff = ca != null && cb != null ? cb - ca : 0;
  const head = (rec, name, side) => `<div class="cmp-h ${side}"><small title="${shEsc(rec.url)}">${shEsc(insShort(name, 22))}</small>${siteScore(rec.composite)}</div>`;
  let h = `<section class="sh-card ins-pad"><div class="cmp-top">${head(A, na, 'a')}<span class="cmp-vs">vs</span>${head(B, nb, 'b')}</div>
      <p class="ins-lede" style="margin-top:12px">${ca == null || cb == null ? 'One of the pages could not be scored.' : diff === 0 ? 'Both pages score the same overall.' : `<b>${shEsc(diff > 0 ? nb : na)}</b> scores <b>${Math.abs(diff)} point${Math.abs(diff) === 1 ? '' : 's'} higher</b> overall.`}</p>
      <div class="sh-btns"><button type="button" class="sh-btn sm" data-sh="cmp" data-v="swap">${shIcon('refresh', 13)} Swap sides</button></div></section>`;

  // scores
  h += `<div class="sh-sec"><span>Scores</span></div><div class="sh-card cmp-table"><div class="cmp-th"><span></span><span title="${shEsc(na)}">${shEsc(insShort(na, 14))}</span><span title="${shEsc(nb)}">${shEsc(insShort(nb, 14))}</span><span>Change</span></div>${CMP_SCORES.map(([l, k]) => `<div class="cmp-tr3"><span class="cmp-l">${l}</span>${siteScore(A.scores[k])}${siteScore(B.scores[k])}${cmpDelta(A.scores[k], B.scores[k])}</div>`).join('')}</div>`;

  // content
  const rows = [
    cmpTextRow('Title', A.title, B.title, { len: true }), cmpTextRow('Description', A.desc, B.desc, { len: true, max: 110 }),
    cmpTextRow('Main heading', A.h1[0], B.h1[0]), cmpTextRow('Canonical', A.canonical, B.canonical, { max: 60 }),
    cmpTextRow('Language', A.lang, B.lang), cmpTextRow('Words', A.words, B.words),
    cmpTextRow('Social image', A.og ? 'Yes' : '', B.og ? 'Yes' : ''), cmpTextRow('Indexing', A.noindex ? 'noindex' : 'Indexable', B.noindex ? 'noindex' : 'Indexable'),
    cmpTextRow('Structured data', (A.sd || []).join(', '), (B.sd || []).join(', ')), cmpTextRow('Reading grade', A.grade, B.grade)
  ];
  const diffRows = rows.filter(r => !r.same);
  h += `<div class="cmp-groups">`;
  h += cmpSection('Content and meta', diffRows.length + ' differ', `<div class="cmp-th2"><span></span><span>${shEsc(insShort(na, 16))}</span><span>${shEsc(insShort(nb, 16))}</span></div>${diffRows.map(r => r.html).join('') || '<p class="site-ok">Everything compared is identical.</p>'}${diffRows.length && rows.length > diffRows.length ? `<p class="ins-note" style="margin:8px 0 0">${rows.length - diffRows.length} more ${rows.length - diffRows.length === 1 ? 'field is' : 'fields are'} identical on both pages.</p>` : ''}`, true);

  // speed
  const sp = [['Largest paint', 'lcp', A.lcp, B.lcp, (v) => (v / 1000).toFixed(2) + 's', true, 'lcp'], ['Layout shift', 'cls', A.cls, B.cls, (v) => v.toFixed(3), true, 'cls'], ['First paint', 'fcp', A.fcp, B.fcp, (v) => (v / 1000).toFixed(2) + 's', true, 'fcp'], ['Server response', 'ttfb', A.ttfb, B.ttfb, (v) => Math.round(v) + ' ms', true, 'ttfb'],
    ['Page weight', '', A.weight, B.weight, insBytes, true, ''], ['Image bytes', '', A.imgBytes, B.imgBytes, insBytes, true, ''], ['Savable in images', '', A.img && A.img.save, B.img && B.img.save, insBytes, true, '']];
  h += cmpSection('Speed', sp.filter(r => r[2] != null && r[3] != null).length + ' measured', `<div class="cmp-th2"><span></span><span>${shEsc(insShort(na, 16))}</span><span>${shEsc(insShort(nb, 16))}</span></div>` + sp.map(r => {
    const x = r[2], y = r[3];
    const cell = (v, m, win) => `<span class="cmp-v ${win ? 'win' : ''}">${v == null ? '<i class="cmp-none">n/a</i>' : (m ? `<span class="site-sc ${cmpTier(m, v)}">${r[4](v)}</span>` : r[4](v))}</span>`;
    const aWin = x != null && y != null && x < y, bWin = x != null && y != null && y < x;
    return `<div class="cmp-tr"><span class="cmp-l">${r[0]}</span>${cell(x, r[6], aWin)}${cell(y, r[6], bWin)}</div>`;
  }).join('') + '<p class="ins-note" style="margin:8px 0 0">Measured once on each page, on this device. The winner is marked in bold.</p>', false);

  // technology
  const tech = cmpSetDiff(A.tech || [], B.tech || []);
  h += cmpSection('Technology', `${tech.onlyA.length + tech.onlyB.length} differ`, `<div class="cmp-set"><small>Only on ${shEsc(insShort(na, 22))}</small>${cmpChips(tech.onlyA, 'warn')}</div><div class="cmp-set"><small>Only on ${shEsc(insShort(nb, 22))}</small>${cmpChips(tech.onlyB, 'info')}</div><div class="cmp-set"><small>On both</small>${cmpChips(tech.both, 'ok')}</div>`, false);

  // design
  const fonts = cmpSetDiff(A.fonts || [], B.fonts || []);
  const colA = A.colors || [], colB = B.colors || [];
  const shared = colA.filter(c => colB.indexOf(c) >= 0);
  const sw = (list) => list.length ? `<div class="ins-sws">${list.slice(0, 24).map(c => `<i class="ins-sw" style="background:${shEsc(c)}" title="${shEsc(c)}"></i>`).join('')}</div>` : '<small class="cmp-none">none</small>';
  h += cmpSection('Design', `${(A.fonts || []).length} vs ${(B.fonts || []).length} fonts`,
    `<div class="ins-tiles" style="--cols:3;margin:0 0 10px"><div class="ins-tile"><small>Fonts</small><b>${(A.fonts || []).length} · ${(B.fonts || []).length}</b></div><div class="ins-tile"><small>Sizes</small><b>${(A.sizes || []).length} · ${(B.sizes || []).length}</b></div><div class="ins-tile"><small>Colors</small><b>${colA.length} · ${colB.length}</b></div></div>
     <div class="cmp-set"><small>Fonts only on ${shEsc(insShort(na, 20))}</small>${cmpChips(fonts.onlyA, 'warn')}</div><div class="cmp-set"><small>Fonts only on ${shEsc(insShort(nb, 20))}</small>${cmpChips(fonts.onlyB, 'info')}</div><div class="cmp-set"><small>Fonts on both</small>${cmpChips(fonts.both, 'ok')}</div>
     <div class="cmp-set"><small>Colors on both <b>${shared.length}</b></small>${sw(shared)}</div><div class="cmp-set"><small>Only on ${shEsc(insShort(na, 20))}</small>${sw(colA.filter(c => colB.indexOf(c) < 0))}</div><div class="cmp-set"><small>Only on ${shEsc(insShort(nb, 20))}</small>${sw(colB.filter(c => colA.indexOf(c) < 0))}</div>`, false);

  // issues
  const ia = {}, ib = {};
  (A.issues || []).forEach(i => { ia[i[0]] = i; }); (B.issues || []).forEach(i => { ib[i[0]] = i; });
  const onlyA = Object.keys(ia).filter(k => !(k in ib)).map(k => ia[k]), onlyB = Object.keys(ib).filter(k => !(k in ia)).map(k => ib[k]), both = Object.keys(ia).filter(k => k in ib).map(k => ia[k]);
  const issueList = (list) => list.length ? list.slice(0, 10).map(i => `<div class="cmp-iss"><span class="sh-dot ${shSevClass(i[1])}"></span><span>${shEsc(i[2])}</span><small>${i[1]}</small></div>`).join('') + (list.length > 10 ? `<small class="cmp-none">+${list.length - 10} more, lower priority</small>` : '') : '<small class="cmp-none">none</small>';
  h += cmpSection('Issues', `${(A.issues || []).length} vs ${(B.issues || []).length}`,
    `<div class="cmp-set"><small>Only on ${shEsc(insShort(na, 22))} <b>${onlyA.length}</b></small>${issueList(onlyA)}</div><div class="cmp-set"><small>Only on ${shEsc(insShort(nb, 22))} <b>${onlyB.length}</b></small>${issueList(onlyB)}</div><div class="cmp-set"><small>On both <b>${both.length}</b></small>${issueList(both)}</div>`, onlyA.length + onlyB.length > 0);
  h += `</div>`;

  h += `<p class="ins-note">Both pages are scored the same way, from what each page shows on its own, so tests you ran on this page (accessibility lab, field data, saved design tokens) are left out and numbers can differ a little from the Audit tab. Compared ${insAgo(CMP.at)}.</p>`;
  h += `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="cmp" data-v="report">${shIcon('download', 13)} Export report</button><button type="button" class="sh-btn sm" data-sh="cmp" data-v="copy">${shIcon('copy', 13)} Copy summary</button><button type="button" class="sh-btn sm" data-sh="cmp" data-v="again">Compare another</button></div>`;
  return h;
}

function cmpScreen(A) {
  cmpLoad();
  if (CMP.phase === 'running') return cmpRunning();
  if (CMP.phase === 'done' && CMP.a && CMP.b) return cmpResult();
  return cmpIntro();
}

/* ------------------------------------------------------------------ text export */
function cmpSummary() {
  const A = CMP.swap ? CMP.b : CMP.a, B = CMP.swap ? CMP.a : CMP.b;
  const L = [`Page comparison`, `A: ${A.url}`, `B: ${B.url}`, '', `Overall: ${A.composite} vs ${B.composite}`];
  CMP_SCORES.forEach(([l, k]) => L.push(`${l}: ${A.scores[k] == null ? '—' : A.scores[k]} vs ${B.scores[k] == null ? '—' : B.scores[k]}`));
  const diffs = [['Title', A.title, B.title], ['Description', A.desc, B.desc], ['Main heading', A.h1[0], B.h1[0]], ['Canonical', A.canonical, B.canonical]].filter(r => (r[1] || '') !== (r[2] || ''));
  if (diffs.length) { L.push('', 'Different:'); diffs.forEach(r => L.push(`- ${r[0]}: “${r[1] || ''}” vs “${r[2] || ''}”`)); }
  const t = cmpSetDiff(A.tech || [], B.tech || []);
  if (t.onlyA.length || t.onlyB.length) L.push('', `Technology only on A: ${t.onlyA.join(', ') || '—'}`, `Technology only on B: ${t.onlyB.join(', ') || '—'}`);
  if (A.lcp != null && B.lcp != null) L.push('', `Largest paint: ${(A.lcp / 1000).toFixed(2)}s vs ${(B.lcp / 1000).toFixed(2)}s`);
  return L.join('\n');
}

function cmpHandle(op, el) {
  const ds = el.dataset || {};
  if (op === 'run') { const i = shEl('cmp-input'); if (i) CMP.input = i.value; cmpRun(); }
  else if (op === 'fill') { CMP.input = ds.url; CMP.error = ''; shRender(); }
  else if (op === 'swap') { CMP.swap = !CMP.swap; shRender(); }
  else if (op === 'again') { Object.assign(CMP, { phase: 'idle', a: null, b: null, error: '', swap: false }); shRender(); }
  else if (op === 'copy') copyToClipboard(cmpSummary(), 'Summary copied');
  else if (op === 'report') {
    const A = CMP.swap ? CMP.b : CMP.a, B = CMP.swap ? CMP.a : CMP.b;
    siteDownload(buildCompareReportHtml(A, B, CMP.at), `compare-${rpHostOf(A.url)}-vs-${rpHostOf(B.url)}.html`, 'text/html');
  }
}

document.addEventListener('input', (e) => { if (e.target && e.target.id === 'cmp-input') CMP.input = e.target.value; });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'cmp-input') { CMP.input = e.target.value; cmpRun(); } });

/* ------------------------------------------------------------------ registration */
SH_SCREENS.compare = { title: 'Compare pages', build: cmpScreen };
SH_TOOLS.Page.push(['compare', 'Compare pages', 'layers']);
SH_TOOL_META.compare = 'This page against another';
SH_TOOL_KEYWORDS.compare = 'compare diff staging live production competitor before after side by side versus';

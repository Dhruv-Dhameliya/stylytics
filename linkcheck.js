/* linkcheck.js — link checker and server headers.
 *
 * Links: every link on the page (menu and footer included) is requested once, a few at a time, and
 * classified: working, redirecting, broken, server error, unreachable, or blocked (sites that refuse
 * automated requests, which is reported as "can't verify", never as broken). Fragment links that point
 * at an id that does not exist are found without any network request.
 *
 * Headers: the page and a sample of its heaviest files are requested for their response headers only
 * (the body is never read) and judged against the usual security, compression and caching advice. The
 * result joins the Audit as "Security & delivery", with the fix written for nginx, Apache or Netlify.
 *
 * The panel has host permission for every site, so responses are readable without CORS.
 */

const LNK_CAP = 150;           // links checked per run
const LNK_PARALLEL = 6;
const LNK = { url: '', phase: 'idle', total: 0, done: 0, results: [], cancel: false, at: 0, capped: 0 };
const HDR = { url: '', phase: 'idle', limited: false, doc: null, assets: [], httpRedirect: null, error: '', fmt: 'raw', at: 0 };

let lnkRunId = 0;   // a rescan or another page invalidates a run still in flight
function lnkReset() {
  lnkRunId++;
  Object.assign(LNK,{ url: '', phase: 'idle', total: 0, done: 0, results: [], cancel: false, at: 0, capped: 0 });
  Object.assign(HDR, { limited: false, url: '', phase: 'idle', doc: null, assets: [], httpRedirect: null, error: '', at: 0 });
}

/* ------------------------------------------------------------------ requests */
async function lnkRequest(url, method, ms, extra) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const t0 = performance.now();
  try {
    const res = await fetch(url, Object.assign({ method: method, redirect: 'follow', cache: 'no-store', credentials: 'omit', signal: ctrl.signal }, extra || {}));
    const out = { status: res.status, redirected: !!res.redirected, finalUrl: res.url || url, headers: res.headers, ms: Math.round(performance.now() - t0) };
    try { ctrl.abort(); } catch (e) { /* the body is not needed */ }
    return out;
  } catch (e) {
    return { error: ctrl.signal.aborted ? 'timeout' : 'network', ms: Math.round(performance.now() - t0) };
  } finally { clearTimeout(timer); }
}

// HEAD first (cheap); some servers answer HEAD with an error, so a failed HEAD is retried as a one-byte GET
async function lnkHeadOrGet(url, ms) {
  let r = await lnkRequest(url, 'HEAD', ms);
  if (r.error === 'timeout') return r;
  if (r.error || r.status >= 400 || r.status === 0) {
    const g = await lnkRequest(url, 'GET', ms, { headers: { Range: 'bytes=0-0' } });
    if (!g.error || r.error) r = g;
  }
  return r;
}

/* ------------------------------------------------------------------ links */
function lnkPlain(u) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase(); } catch (e) { return String(u).toLowerCase(); }
}

function lnkClassify(link, r) {
  const out = { u: link.u, h: link.h, t: link.t, w: link.w, ext: link.ext, status: r.status || 0, ms: r.ms || 0, kind: 'ok', final: '', sub: '' };
  if (r.error === 'timeout') { out.kind = 'slow'; return out; }
  if (r.error) { out.kind = 'unreachable'; return out; }
  const s = r.status;
  if (s === 404 || s === 410) out.kind = 'broken';
  else if (s >= 500) out.kind = 'error';
  else if (s === 401 || s === 403 || s === 429 || s === 451 || s === 999 || s === 202) out.kind = 'blocked';
  else if (s >= 400) out.kind = 'broken';
  else if (r.redirected && r.finalUrl) {
    out.kind = 'redirect'; out.final = r.finalUrl;
    if (lnkPlain(r.finalUrl) === lnkPlain(link.u)) out.sub = 'tidy';
    else {
      let orig = '', fin = '';
      try { orig = new URL(link.u).pathname; fin = new URL(r.finalUrl).pathname; } catch (e) { /* keep empty */ }
      out.sub = fin.replace(/\/+$/, '') === '' && orig.replace(/\/+$/, '') !== '' ? 'home' : 'moved';
    }
  }
  return out;
}

function lnkPlan() {
  const d = lastExtractedData || {};
  let links = fxFacts(d).links;
  if (!links) {
    // no page-side facts: fall back to the links the main scan collected (menu and footer excluded)
    const seen = new Set();
    links = (d.links || []).filter(l => /^https?:/i.test(l.url) && !seen.has(l.url) && seen.add(l.url)).map(l => ({ u: l.url, h: l.url, t: (l.text || '').slice(0, 50), w: 'content', rel: l.rel || '', ext: !l.isInternal }));
  }
  const rank = { content: 0, nav: 1, header: 1, footer: 2 };
  const all = links.slice().sort((a, b) => (rank[a.w] - rank[b.w]) || (a.ext - b.ext));
  return { list: all.slice(0, LNK_CAP), capped: Math.max(0, all.length - LNK_CAP), total: all.length };
}

async function lnkRun() {
  if (LNK.phase === 'running') return;
  const plan = lnkPlan();
  if (!plan.list.length) return;
  const id = ++lnkRunId;
  Object.assign(LNK, { phase: 'running', total: plan.list.length, done: 0, results: [], cancel: false, capped: plan.capped, url: SH.url });
  lnkRefresh();
  let next = 0, paint = 0;
  const worker = async () => {
    while (id === lnkRunId && !LNK.cancel && next < plan.list.length) {
      const link = plan.list[next++];
      const r = await lnkHeadOrGet(link.u, 10000);
      if (id !== lnkRunId) return;
      LNK.results.push(lnkClassify(link, r));
      LNK.done++;
      if (++paint % 4 === 0) lnkRefresh();
    }
  };
  await Promise.all(Array.from({ length: LNK_PARALLEL }, worker));
  if (id !== lnkRunId) return;
  LNK.phase = 'done'; LNK.at = Date.now();
  lnkRefresh(true);
}

function lnkRefresh(force) {
  try {
    const top = SH.stack[SH.stack.length - 1];
    if (force || (top && top.pane === 'linkcheck')) shRender();
  } catch (e) { /* not drawn */ }
}

const lnkBad = (r) => r.kind === 'broken' || r.kind === 'unreachable' || r.kind === 'error' || r.kind === 'slow';
const lnkSel = (h) => 'a[href="' + String(h || '').replace(/["\\]/g, '\\$&') + '"]';

function lnkChecks(d) {
  const f = fxFacts(d);
  const out = [];
  if (f.links) {
    const anchors = f.brokenAnchors || [];
    out.push({
      label: 'Links to a section on this page work', pass: anchors.length === 0, sev: 'Low',
      t: 'Fix in-page links that go nowhere',
      line: `${insPlural(anchors.length, 'link')} point${anchors.length === 1 ? 's' : ''} to an id that does not exist: ${anchors.slice(0, 3).map(a => a.h).join(', ')}.`,
      mean: 'Clicking them does nothing, which feels like a broken page. It also breaks keyboard skip links.',
      fix: 'Add the id to the section the link should reach, or correct the link.',
      section: 'links', actions: [anchors[0] ? insShowAction(lnkSel(anchors[0].h), 'Broken jump link') : null],
      fixCode: anchors.length ? { where: 'body', code: anchors.slice(0, 6).map(a => `<!-- the link "${a.t || a.h}" jumps to ${a.h} -->\n<section id="${a.h.slice(1)}">…</section>`).join('\n\n'), note: 'Put each id on the element the link should scroll to.' } : null
    });
  }
  if (LNK.phase === 'done' && LNK.results.length) {
    const bad = LNK.results.filter(lnkBad);
    const internal = bad.filter(r => !r.ext);
    const first = bad.slice().sort((a, b) => (a.ext - b.ext))[0];
    out.push({
      label: 'Links on the page work', pass: bad.length === 0, sev: internal.length ? 'High' : 'Medium',
      t: 'Fix broken links',
      line: `${insPlural(bad.length, 'link')} of ${LNK.results.length} checked did not load (${internal.length} on this site).`,
      mean: 'Dead links frustrate visitors, waste search engines’ crawl time and make a site look neglected.',
      fix: 'Update each link to the new address, or remove it if the page is gone.',
      section: 'links', actions: [first ? insShowAction(lnkSel(first.h), 'Broken link') : null, insOpenAction('linkcheck', 'Open link checker')]
    });
    const moved = LNK.results.filter(r => r.kind === 'redirect' && !r.ext && (r.sub === 'moved' || r.sub === 'home'));
    out.push({
      label: 'Internal links go straight to their page', pass: moved.length === 0, sev: 'Low',
      t: 'Update links that redirect',
      line: `${insPlural(moved.length, 'internal link')} redirect${moved.length === 1 ? 's' : ''} to another address.`,
      mean: 'Every redirect adds a round trip, and links that land on the home page usually mean the target was removed.',
      fix: 'Point each link at its final address.',
      section: 'links', actions: [moved[0] ? insShowAction(lnkSel(moved[0].h), 'Redirecting link') : null, insOpenAction('linkcheck', 'Open link checker')],
      fixCode: moved.length ? { where: 'body', code: moved.slice(0, 8).map(r => `<a href="${fxAttr(r.final)}">`).join('\n') + '\n\n' + moved.slice(0, 8).map(r => `${r.h}\n  →  ${r.final}`).join('\n'), note: 'Each link and the address it ends up at.' } : null
    });
  }
  return out;
}

/* ------------------------------------------------------------------ headers */
const hdrGet = (h, name) => { try { return (h && h.get(name)) || ''; } catch (e) { return ''; } };

// after each scan: read the headers unless the person turned that off in Settings
function hdrStart(url) {
  chrome.storage.local.get(['hdr_auto'], (r) => {
    if (r.hdr_auto === false && /^https?:/i.test(url || '')) { Object.assign(HDR, { limited: false, url: url, phase: 'off', doc: null, assets: [], httpRedirect: null, error: '', at: 0 }); shRerenderIfIdle(); }
    else hdrLoad(url);
  });
}

async function hdrLoad(url) {
  Object.assign(HDR, { limited: false, url: url, phase: 'idle', doc: null, assets: [], httpRedirect: null, error: '', at: 0 });
  if (!/^https?:/i.test(url || '')) return;
  HDR.phase = 'loading';
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { return; }
  const d = lastExtractedData;
  const ins = d && d.insights;
  const cand = [];
  ((ins && ins.weight && ins.weight.top) || []).filter(r => /^(script|style|font)$/.test(r.kind) && /^https?:/.test(r.url)).forEach(r => cand.push({ url: r.url, kind: r.kind, bytes: r.bytes }));
  ((d && d.scriptUrls) || []).forEach(u => { if (/^https?:/.test(u) && !cand.some(c => c.url === u)) cand.push({ url: u, kind: 'script', bytes: 0 }); });
  const picks = cand.sort((a, b) => ((new URL(b.url).hostname === host) - (new URL(a.url).hostname === host)) || (b.bytes - a.bytes)).slice(0, 6);

  const docReq = lnkRequest(url, 'GET', 12000);
  const assetReq = Promise.all(picks.map(async (c) => {
    const r = await lnkHeadOrGet(c.url, 8000);
    let first = false; try { first = new URL(c.url).hostname === host; } catch (e) { /* ignore */ }
    if (r.error) return { url: c.url, kind: c.kind, bytes: c.bytes, first: first, error: r.error };
    return { url: c.url, kind: c.kind, bytes: c.bytes, first: first, status: r.status, enc: hdrGet(r.headers, 'content-encoding'), cache: hdrGet(r.headers, 'cache-control'), expires: hdrGet(r.headers, 'expires'), ctype: hdrGet(r.headers, 'content-type'), len: parseInt(hdrGet(r.headers, 'content-length'), 10) || 0 };
  }));
  const httpReq = /^https:/i.test(url) ? lnkRequest('http://' + host + '/', 'HEAD', 8000) : Promise.resolve(null);

  const [doc, assets, http] = await Promise.all([docReq, assetReq, httpReq]);
  if (HDR.url !== url) return; // the page changed while this was running
  if (doc.error) { HDR.phase = 'error'; HDR.error = doc.error === 'timeout' ? 'The page did not answer in time.' : 'The page could not be requested.'; shRerenderIfIdle(); return; }
  const all = [];
  try { doc.headers.forEach((v, k) => all.push([k, v])); } catch (e) { /* none */ }
  // A browser that filters response headers (CORS) shares only the seven "safe" ones. Judging security
  // headers from that would report every one of them missing, so those checks are skipped instead.
  const SAFE = ['cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma'];
  HDR.limited = all.length > 0 && all.every(([k]) => SAFE.indexOf(k.toLowerCase()) >= 0);
  HDR.doc = { status: doc.status, finalUrl: doc.finalUrl, redirected: doc.redirected, ms: doc.ms, all: all, h: doc.headers };
  HDR.assets = assets;
  HDR.httpRedirect = http && !http.error ? /^https:/i.test(http.finalUrl || '') : null;
  HDR.phase = 'done'; HDR.at = Date.now();
  shRerenderIfIdle();
}

function hdrMaxAge(cc, expires) {
  const m = String(cc || '').match(/(?:s-maxage|max-age)=(\d+)/i);
  if (m) return parseInt(m[1], 10);
  if (/no-store|no-cache/i.test(cc || '')) return 0;
  if (expires) { const t = Date.parse(expires); if (!Number.isNaN(t)) return Math.max(0, Math.round((t - Date.now()) / 1000)); }
  return null;
}
function hdrDays(s) { return s >= 86400 ? Math.round(s / 86400) + ' days' : s >= 3600 ? Math.round(s / 3600) + ' hours' : s + ' seconds'; }

// Each rule: header/value is the fix; ok() judges the collected headers, returning null when it does not apply.
const HDR_RULES = [
  {
    id: 'https', plain: true, group: 'Security', label: 'The page is served over HTTPS', t: 'Serve the page over HTTPS', sev: 'High',
    ok: (c) => ({ pass: c.https, line: c.https ? 'The page loads over HTTPS.' : 'The page loads over plain HTTP.' }),
    mean: 'Plain HTTP lets anyone on the network read or change the page, and browsers label it “Not secure”.', fix: 'Install a certificate (most hosts offer one free) and serve every page over HTTPS.'
  },
  {
    id: 'httpredirect', plain: true, group: 'Security', label: 'HTTP requests are sent to HTTPS', t: 'Redirect HTTP to HTTPS', sev: 'Medium',
    ok: (c) => c.https && c.httpRedirect != null ? { pass: c.httpRedirect, line: c.httpRedirect ? 'The plain http:// address redirects to https://.' : 'The plain http:// address does not redirect to https://.' } : null,
    mean: 'Visitors who type or follow an old http:// link would stay on an insecure copy of the site.', fix: 'Add a site-wide permanent (301) redirect from http:// to https://.'
  },
  {
    id: 'hsts', group: 'Security', label: 'HTTPS is enforced with HSTS', t: 'Add the HSTS header', sev: 'Medium', header: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains',
    ok: (c) => { if (!c.https) return null; const v = hdrGet(c.h, 'strict-transport-security'); const age = parseInt((v.match(/max-age=(\d+)/i) || [])[1], 10) || 0; return { pass: age >= 15552000, line: v ? `HSTS is set, but for only ${hdrDays(age)}.` : 'No Strict-Transport-Security header.', value: v }; },
    mean: 'Without it, a visitor’s first request can still travel over HTTP, where it can be intercepted.', fix: 'Send Strict-Transport-Security with a max-age of at least six months, once every page works over HTTPS.'
  },
  {
    id: 'mixed', plain: true, group: 'Security', label: 'No insecure files load on the HTTPS page', t: 'Load every file over HTTPS', sev: 'High',
    ok: (c) => c.https ? { pass: !(c.facts.mixed || []).length, line: (c.facts.mixed || []).length ? `${insPlural(c.facts.mixed.length, 'file')} load over http://, such as ${insFile(c.facts.mixed[0])}.` : 'Every file loads over HTTPS.' } : null,
    mean: 'Browsers block or warn about insecure files on a secure page, and the page can break.', fix: 'Change each http:// address to https://.',
    code: (c) => (c.facts.mixed || []).slice(0, 6).map(u => `${u}\n  →  ${u.replace(/^http:/, 'https:')}`).join('\n'), where: 'body'
  },
  {
    id: 'csp', group: 'Security', label: 'A Content Security Policy is set', t: 'Add a Content Security Policy', sev: 'Medium', header: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
    ok: (c) => { const v = hdrGet(c.h, 'content-security-policy'); return { pass: !!v, line: v ? 'A Content Security Policy is set.' : 'No Content-Security-Policy header.', value: v }; },
    mean: 'A policy limits which scripts can run, which blunts most cross-site scripting attacks.', fix: 'Start with the safe policy below, then tighten script-src as you learn what the site loads. Use Content-Security-Policy-Report-Only to test.'
  },
  {
    id: 'nosniff', group: 'Security', label: 'Browsers do not guess file types', t: 'Add X-Content-Type-Options', sev: 'Low', header: 'X-Content-Type-Options', value: 'nosniff',
    ok: (c) => { const v = hdrGet(c.h, 'x-content-type-options'); return { pass: /nosniff/i.test(v), line: v ? `The value is “${v}”.` : 'No X-Content-Type-Options header.', value: v }; },
    mean: 'Without it, a browser may treat an uploaded file as a script.', fix: 'Send X-Content-Type-Options: nosniff.'
  },
  {
    id: 'frame', group: 'Security', label: 'Other sites cannot frame the page', t: 'Block framing by other sites', sev: 'Medium', header: 'X-Frame-Options', value: 'SAMEORIGIN',
    ok: (c) => { const x = hdrGet(c.h, 'x-frame-options'), csp = hdrGet(c.h, 'content-security-policy'); return { pass: !!x || /frame-ancestors/i.test(csp), line: x ? `X-Frame-Options is ${x}.` : /frame-ancestors/i.test(csp) ? 'The policy sets frame-ancestors.' : 'The page can be embedded by any site.', value: x }; },
    mean: 'A hostile site can embed the page invisibly and trick visitors into clicking on it (clickjacking).', fix: 'Send X-Frame-Options: SAMEORIGIN, or frame-ancestors in your Content Security Policy.'
  },
  {
    id: 'referrer', group: 'Security', label: 'A Referrer-Policy is set', t: 'Add a Referrer-Policy', sev: 'Low', header: 'Referrer-Policy', value: 'strict-origin-when-cross-origin',
    ok: (c) => { const v = hdrGet(c.h, 'referrer-policy'); return { pass: !!v, line: v ? `The value is “${v}”.` : 'No Referrer-Policy header.', value: v }; },
    mean: 'It controls how much of your page address is passed to other sites when visitors click a link.', fix: 'Send Referrer-Policy: strict-origin-when-cross-origin.'
  },
  {
    id: 'permissions', group: 'Security', label: 'Browser features are restricted', t: 'Add a Permissions-Policy', sev: 'Low', header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()',
    ok: (c) => { const v = hdrGet(c.h, 'permissions-policy'); return { pass: !!v, line: v ? 'A Permissions-Policy is set.' : 'No Permissions-Policy header.', value: v }; },
    mean: 'It stops embedded content from using the camera, microphone or location unless you allow it.', fix: 'List the features the site really uses, and turn the rest off.'
  },
  {
    id: 'leak', group: 'Security', label: 'The server does not announce its version', t: 'Hide server version details', sev: 'Low', special: 'leak',
    ok: (c) => { const s = hdrGet(c.h, 'server'), p = hdrGet(c.h, 'x-powered-by'); const leaks = [s && /\d/.test(s) ? s : '', p].filter(Boolean); return { pass: !leaks.length, line: leaks.length ? `The server reveals “${leaks.join(', ')}”.` : 'No version details are sent.', value: leaks.join(', ') }; },
    mean: 'Exact software versions tell an attacker which known weaknesses to try.', fix: 'Turn off the Server version and X-Powered-By headers in your server or framework settings.'
  },
  {
    id: 'compress', group: 'Speed', label: 'The page is compressed', t: 'Compress the page', sev: 'Medium', special: 'compress',
    ok: (c) => { if (!/html/i.test(hdrGet(c.h, 'content-type'))) return null; const e = hdrGet(c.h, 'content-encoding'); return { pass: /(gzip|br|zstd|deflate)/i.test(e), line: e ? `The page is sent with ${e} compression.` : 'The page is sent uncompressed.', value: e }; },
    mean: 'Compression typically cuts text files by 60 to 80 percent, so the page arrives sooner.', fix: 'Turn on Brotli or gzip at your server or CDN.'
  },
  {
    id: 'assetzip', group: 'Speed', label: 'Scripts and styles are compressed', t: 'Compress scripts and styles', sev: 'Medium', special: 'compress',
    ok: (c) => {
      const t = c.assets.filter(a => !a.error && a.status < 400 && /^(script|style)$/.test(a.kind) && !/(gzip|br|zstd|deflate)/i.test(a.enc) && (a.bytes > 1500 || a.len > 1500));
      const known = c.assets.filter(a => !a.error && /^(script|style)$/.test(a.kind));
      return known.length ? { pass: !t.length, line: t.length ? `${insPlural(t.length, 'file')} sampled came uncompressed, such as ${insFile(t[0].url)}.` : 'The sampled scripts and styles are compressed.' } : null;
    },
    mean: 'Uncompressed JavaScript and CSS are the largest avoidable cost on many pages.', fix: 'Enable Brotli or gzip for text files such as JS, CSS, JSON and SVG.'
  },
  {
    id: 'cache', group: 'Speed', label: 'Your static files are cached', t: 'Cache static files for longer', sev: 'Medium', special: 'cache',
    ok: (c) => {
      const mine = c.assets.filter(a => !a.error && a.first && a.status < 400);
      if (!mine.length) return null;
      const weak = mine.filter(a => { const age = hdrMaxAge(a.cache, a.expires); return age == null || age < 604800; });
      return { pass: !weak.length, line: weak.length ? `${insPlural(weak.length, 'of your files')} sampled ${weak.length === 1 ? 'is' : 'are'} cached for less than a week, such as ${insFile(weak[0].url)} (${weak[0].cache || 'no Cache-Control'}).` : 'The sampled files are cached for a week or more.' };
    },
    mean: 'Repeat visitors download these files again every time, which slows the page for the people most likely to return.', fix: 'Send Cache-Control with a long max-age for files whose names change when their content does (hashed file names), and a short one for the rest.'
  }
];

function hdrCtx() {
  const d = lastExtractedData || {};
  return { h: HDR.doc.h, assets: HDR.assets, https: /^https:/i.test(HDR.url), httpRedirect: HDR.httpRedirect, facts: fxFacts(d) };
}

// the rule outcomes for this page (empty until the headers have loaded)
function hdrEvaluate() {
  if (HDR.phase !== 'done' || !HDR.doc) return [];
  const c = hdrCtx();
  const out = [];
  HDR_RULES.forEach(rule => {
    if (HDR.limited && !rule.plain) return;
    let r = null;
    try { r = rule.ok(c); } catch (e) { r = null; }
    if (!r) return;
    out.push({ rule: rule, pass: !!r.pass, line: r.line, value: r.value || '' });
  });
  return out;
}

/* ------------------------------------------------------------------ server config text */
const HDR_FORMATS = [['raw', 'Headers'], ['nginx', 'nginx'], ['apache', 'Apache'], ['netlify', 'Netlify']];

function hdrConfig(items, fmt) {
  const lines = [];
  const hs = items.filter(i => i.rule.header);
  if (fmt === 'raw') hs.forEach(i => lines.push(`${i.rule.header}: ${i.rule.value}`));
  else if (fmt === 'nginx') hs.forEach(i => lines.push(`add_header ${i.rule.header} "${i.rule.value}" always;`));
  else if (fmt === 'apache') { if (hs.length) lines.push('<IfModule mod_headers.c>'); hs.forEach(i => lines.push(`  Header always set ${i.rule.header} "${i.rule.value}"`)); if (hs.length) lines.push('</IfModule>'); }
  else if (fmt === 'netlify') { if (hs.length) lines.push('/*'); hs.forEach(i => lines.push(`  ${i.rule.header}: ${i.rule.value}`)); }
  if (items.some(i => i.rule.special === 'compress')) {
    if (lines.length) lines.push('');
    if (fmt === 'nginx') lines.push('gzip on;\ngzip_comp_level 5;\ngzip_types text/css application/javascript application/json image/svg+xml;\n# brotli on;  (with the ngx_brotli module)');
    else if (fmt === 'apache') lines.push('<IfModule mod_deflate.c>\n  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml\n</IfModule>');
    else if (fmt === 'netlify') lines.push('# Netlify compresses text files automatically. If files are served uncompressed, check for a proxy in front of the site.');
    else lines.push('Content-Encoding: br   (or gzip, set by enabling compression, not by a header rule)');
  }
  if (items.some(i => i.rule.special === 'leak')) {
    if (lines.length) lines.push('');
    if (fmt === 'nginx') lines.push('server_tokens off;\nproxy_hide_header X-Powered-By;\nfastcgi_hide_header X-Powered-By;');
    else if (fmt === 'apache') lines.push('ServerTokens Prod\nServerSignature Off\nHeader always unset X-Powered-By');
    else if (fmt === 'netlify') lines.push('# Netlify does not send a version. Remove X-Powered-By in the framework or function that adds it.');
    else lines.push('# Remove: Server version numbers and X-Powered-By (set in your server or framework, not as a header rule)');
  }
  if (items.some(i => i.rule.special === 'cache')) {
    if (lines.length) lines.push('');
    if (fmt === 'nginx') lines.push('# only for files with a hash in the name, such as app.3f9a1c.js\nlocation ~* \\.(?:js|css|woff2|png|jpe?g|webp|avif|svg)$ {\n  add_header Cache-Control "public, max-age=31536000, immutable";\n}');
    else if (fmt === 'apache') lines.push('<IfModule mod_headers.c>\n  <FilesMatch "\\.(js|css|woff2|png|jpe?g|webp|avif|svg)$">\n    Header set Cache-Control "public, max-age=31536000, immutable"\n  </FilesMatch>\n</IfModule>');
    else if (fmt === 'netlify') lines.push('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
    else lines.push('Cache-Control: public, max-age=31536000, immutable   (hashed file names only)');
  }
  return lines.join('\n').trim();
}

/* ------------------------------------------------------------------ audit checks */
function hdrChecks(d) {
  const items = hdrEvaluate();
  return items.map(i => {
    const r = i.rule;
    const chk = {
      label: r.label, pass: i.pass, sev: r.sev, t: r.t, line: i.line, mean: r.mean, fix: r.fix,
      section: 'ins:headers', actions: [insOpenAction('headers', 'Open server headers')]
    };
    if (!i.pass) {
      if (r.code) chk.fixCode = { where: r.where || 'body', code: r.code(hdrCtx()), note: '' };
      else if (r.header || r.special) chk.fixCode = { where: 'headers', code: hdrConfig([i], 'raw'), note: 'The Server headers screen writes this for nginx, Apache and Netlify.' };
    }
    return chk;
  });
}

/* ------------------------------------------------------------------ screens */
const LNK_KIND = {
  ok: ['Working', 'ok'], redirect: ['Redirect', 'info'], broken: ['Broken', 'bad'], unreachable: ['Unreachable', 'bad'],
  error: ['Server error', 'bad'], slow: ['Timed out', 'warn'], blocked: ['Can’t verify', 'warn']
};

function lnkWhere(w) { return w === 'content' ? 'In the page' : w === 'nav' ? 'In the menu' : w === 'header' ? 'In the header' : 'In the footer'; }

function lnkRow(r) {
  const k = LNK_KIND[r.kind];
  const code = r.kind === 'redirect' ? r.status : (r.status || '—');
  return `<div class="lnk-row">
      <span class="lnk-st ${k[1]}">${r.kind === 'redirect' ? '→' : r.kind === 'ok' ? shEsc(code) : (r.status || '!')}</span>
      <span class="lnk-tx"><b>${shEsc(insShort(r.t || insFile(r.u), 54))}</b><small title="${shEsc(r.u)}">${shEsc(insShort(r.u.replace(/^https?:\/\//, ''), 62))}</small>
        ${r.kind === 'redirect' ? `<small class="lnk-arrow">→ ${shEsc(insShort(r.final.replace(/^https?:\/\//, ''), 56))}${r.sub === 'home' ? ' (the home page)' : r.sub === 'tidy' ? ' (cosmetic)' : ''}</small>` : ''}
        <span class="ins-chips"><span class="ins-chip ${k[1]}">${k[0]}${r.kind === 'broken' || r.kind === 'error' ? ' · ' + r.status : ''}</span><span class="ins-chip info">${r.ext ? 'Other site' : 'This site'}</span><span class="ins-chip info">${lnkWhere(r.w)}</span></span></span>
      <span class="lnk-go"><button type="button" class="ins-go" data-sh="ins" data-v="show" data-sel="${shEsc(lnkSel(r.h))}" data-lbl="${shEsc(k[0])}" title="Show on page" aria-label="Show on page">${shIcon('target', 15)}</button>
        <button type="button" class="ins-go" data-sh="copy" data-v="${shEsc(r.kind === 'redirect' ? r.final : r.u)}" title="${r.kind === 'redirect' ? 'Copy the final address' : 'Copy the address'}" aria-label="Copy the address">${shIcon('copy', 15)}</button></span>
    </div>`;
}

function lnkScreen(A) {
  const plan = lnkPlan();
  const facts = fxFacts(A.data);
  if (!plan.total && !(facts.brokenAnchors || []).length && !LNK.results.length) return insEmpty('link', 'No links to check', 'This page has no links to other pages.');

  let h = '';
  if (LNK.phase === 'running') {
    const pct = LNK.total ? Math.round(LNK.done / LNK.total * 100) : 0;
    h += `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big">${LNK.done}<span class="site-of"> / ${LNK.total}</span></span><span class="sh-tchip warn">Checking</span></div>
        <div class="ins-bar site-bar"><i style="width:${pct}%;background:var(--accent)"></i></div>
        <p class="ins-note" style="margin:8px 0 10px">Each link is requested once, six at a time. Pages that refuse automated visits are marked “can’t verify” rather than broken.</p>
        <div class="sh-btns"><button type="button" class="sh-btn sm" data-sh="lnk" data-v="cancel">${LNK.cancel ? 'Stopping…' : 'Stop'}</button></div></section>`;
  } else if (LNK.phase !== 'done') {
    h += `<section class="sh-card ins-pad"><b>${insPlural(Math.min(plan.total, LNK_CAP), 'link')} to check</b>
        <p class="ins-lede">Finds links that return “not found”, fail to load, or quietly redirect. It includes the menu and footer.${plan.capped ? ` The first ${LNK_CAP} of ${plan.total} are checked.` : ''}</p>
        <div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="lnk" data-v="run" ${plan.list.length ? '' : 'disabled'}>Check ${plan.list.length} links</button></div></section>
      <p class="ins-note">Each link is requested from your browser, so the sites you link to will see ordinary visits from you. Nothing is sent anywhere else.</p>`;
  }

  const res = LNK.results;
  if (res.length) {
    const c = { ok: 0, redirect: 0, bad: 0, blocked: 0 };
    res.forEach(r => { if (r.kind === 'ok') c.ok++; else if (r.kind === 'redirect') c.redirect++; else if (r.kind === 'blocked') c.blocked++; else c.bad++; });
    const t = c.bad ? 'bad' : c.redirect ? 'warn' : 'ok';
    if (LNK.phase === 'done') {
      h += `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${t}">${c.bad}</span><span class="sh-tchip ${t}">${c.bad ? 'Broken links' : 'No broken links'}</span><small>of ${res.length} checked · ${insAgo(LNK.at)}</small></div></section>`;
      h += insTiles([['Working', c.ok, 'ok'], ['Broken', c.bad, c.bad ? 'bad' : 'ok'], ['Redirects', c.redirect, c.redirect ? 'warn' : 'ok'], ['Can’t verify', c.blocked]]);
      if (LNK.capped) h += `<p class="ins-note">Checked the first ${LNK_CAP} links, with the page’s own content first. ${LNK.capped} more were skipped.</p>`;
    }
    const order = [['Broken or unreachable', r => lnkBad(r)], ['Redirects', r => r.kind === 'redirect' && r.sub !== 'tidy'], ['Cosmetic redirects', r => r.kind === 'redirect' && r.sub === 'tidy'], ['Can’t verify', r => r.kind === 'blocked']];
    order.forEach(([title, fn]) => {
      const rows = res.filter(fn).sort((a, b) => (a.ext - b.ext) || (a.w < b.w ? -1 : 1));
      if (rows.length) h += `<div class="sh-sec"><span>${title} <em>${rows.length}</em></span></div><div class="sh-card ins-list lnk-list">${rows.slice(0, 40).map(lnkRow).join('')}${rows.length > 40 ? `<p class="ins-note" style="padding:8px 12px">Showing 40 of ${rows.length}.</p>` : ''}</div>`;
    });
    if (LNK.phase === 'done' && res.every(r => r.kind === 'ok')) h += insEmpty('check', 'Every link works', 'All the links checked loaded without a redirect.');
  }

  const anchors = facts.brokenAnchors || [];
  if (anchors.length) {
    h += `<div class="sh-sec"><span>Jump links that go nowhere <em>${anchors.length}</em></span></div><div class="sh-card ins-list lnk-list">${anchors.map(a => `<div class="lnk-row"><span class="lnk-st warn">#</span><span class="lnk-tx"><b>${shEsc(insShort(a.t || a.h, 54))}</b><small>${shEsc(a.h)} has no matching id on the page</small></span>
        <span class="lnk-go"><button type="button" class="ins-go" data-sh="ins" data-v="show" data-sel="${shEsc(lnkSel(a.h))}" data-lbl="Dead jump link" title="Show on page" aria-label="Show on page">${shIcon('target', 15)}</button></span></div>`).join('')}</div>`;
  }

  if (LNK.phase === 'done') h += `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="lnk" data-v="copy">${shIcon('copy', 13)} Copy report</button><button type="button" class="sh-btn sm" data-sh="lnk" data-v="run">Check again</button><button type="button" class="sh-btn sm" data-sh="lnk" data-v="clear">Clear results</button></div>`;
  return h;
}

function lnkReport() {
  const bad = LNK.results.filter(lnkBad), moved = LNK.results.filter(r => r.kind === 'redirect' && r.sub !== 'tidy'), blocked = LNK.results.filter(r => r.kind === 'blocked');
  const L = [`Link check for ${SH.url}`, `${LNK.results.length} links checked, ${bad.length} broken, ${moved.length} redirecting, ${blocked.length} could not be verified`, ''];
  if (bad.length) { L.push('Broken:'); bad.forEach(r => L.push(`- ${r.u}  [${LNK_KIND[r.kind][0]}${r.status ? ' ' + r.status : ''}]  “${r.t}” (${lnkWhere(r.w).toLowerCase()})`)); L.push(''); }
  if (moved.length) { L.push('Redirects:'); moved.forEach(r => L.push(`- ${r.u}  →  ${r.final}`)); L.push(''); }
  const anchors = fxFacts(lastExtractedData || {}).brokenAnchors || [];
  if (anchors.length) { L.push('Jump links with no target:'); anchors.forEach(a => L.push(`- ${a.h}  “${a.t}”`)); }
  return L.join('\n').trim();
}

function lnkHandle(op) {
  if (op === 'run') lnkRun();
  else if (op === 'cancel') { LNK.cancel = true; lnkRefresh(true); }
  else if (op === 'copy') copyToClipboard(lnkReport(), 'Report copied');
  else if (op === 'clear') {
    // close the results (and stop a run in progress) and take the highlight off the page
    lnkRunId++;
    Object.assign(LNK, { phase: 'idle', total: 0, done: 0, results: [], cancel: false, at: 0, capped: 0 });
    if (lastActiveTabId) chrome.tabs.sendMessage(lastActiveTabId, { action: 'insight-clear' }, () => void chrome.runtime.lastError);
    shRender();
  }
}

/* ---- headers screen ---- */
function hdrRow(i) {
  const r = i.rule;
  return `<div class="hdr-row ${i.pass ? 'ok' : (r.sev === 'High' ? 'bad' : r.sev === 'Medium' ? 'warn' : 'info')}"><span class="hdr-ic">${shIcon(i.pass ? 'check' : 'alert', 13)}</span>
      <span class="hdr-tx"><b>${shEsc(i.pass ? r.label : r.t)}</b><small>${shEsc(i.line)}</small>${i.value ? `<code class="hdr-val" title="${shEsc(i.value)}">${shEsc(insShort(i.value, 96))}</code>` : ''}</span>
      ${i.pass ? '' : `<span class="sh-sev ${shSevClass(r.sev)}">${r.sev}</span>`}</div>`;
}

function hdrScreen(A) {
  if (HDR.phase === 'off') return insEmpty('shield', 'Headers are not read automatically', 'You turned this off in Settings. Read them for this page only if you like.') + `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="hdr" data-v="reload">Read the headers now</button></div>`;
  if (HDR.phase === 'idle') return insEmpty('globe', 'Nothing to read', 'Server headers are only available for web pages that load over http or https.');
  if (HDR.phase === 'loading') return `<div class="sh-card"><div class="sh-empty"><b>Reading the headers…</b>Requesting the page and a few of its files. Only headers are read.</div></div>`;
  if (HDR.phase === 'error') return insEmpty('alert', 'Could not read the headers', shEsc(HDR.error)) + `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="hdr" data-v="reload">Try again</button></div>`;
  const items = hdrEvaluate();
  const fails = items.filter(i => !i.pass);
  const pass = items.length - fails.length;
  const score = items.length ? Math.round(pass / items.length * 100) : 0;
  const limitedNote = HDR.limited ? `<div class="sh-card"><div class="sd-iss warn" style="padding:12px 14px"><span class="sd-iss-ic">${shIcon('alert', 13)}</span><span class="sd-iss-tx">The browser only shared a few of this site’s headers, so the security, compression and caching checks were skipped rather than guessed.</span></div></div>` : '';
  const t = score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'bad';
  let h = `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${t}">${pass}<span class="site-of"> / ${items.length}</span></span><span class="sh-tchip ${t}">${fails.length ? insPlural(fails.length, 'thing') + ' to fix' : 'All in order'}</span><small>${HDR.doc.status} · ${HDR.doc.ms} ms${HDR.doc.redirected ? ' · redirected' : ''}</small></div></section>${limitedNote}`;
  ['Security', 'Speed'].forEach(g => {
    const rows = items.filter(i => i.rule.group === g);
    if (rows.length) h += `<div class="sh-sec"><span>${g === 'Speed' ? 'Speed and caching' : g}</span></div><div class="sh-card hdr-list">${rows.sort((a, b) => a.pass - b.pass).map(hdrRow).join('')}</div>`;
  });

  if (fails.some(i => i.rule.header || i.rule.special)) {
    const code = hdrConfig(fails.filter(i => i.rule.header || i.rule.special), HDR.fmt);
    h += `<div class="sh-sec"><span>The fix, written for your server</span></div><div class="sh-card ins-pad">
        <div class="segmented hdr-fmt" role="group" aria-label="Server type">${HDR_FORMATS.map(f => `<button type="button" class="tag${HDR.fmt === f[0] ? ' active' : ''}" data-sh="hdr" data-v="fmt" data-f="${f[0]}">${f[1]}</button>`).join('')}</div>
        <pre class="sh-code fx-code">${shEsc(code)}</pre>
        <p class="fx-note">Add this where your server or CDN sets headers, then rescan. Test the Content-Security-Policy on a staging copy first, since a strict policy can block scripts you rely on.</p>
        <div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="copy" data-v="${shEsc(code)}">${shIcon('copy', 13)} Copy</button></div></div>`;
  }

  if (HDR.assets.length) {
    h += `<div class="sh-sec"><span>Files sampled <em>${HDR.assets.length}</em></span></div><div class="sh-card ins-list hdr-assets">${HDR.assets.map(a => {
      if (a.error) return `<div class="hdr-a"><span class="hdr-at"><b>${shEsc(insShort(insFile(a.url), 34))}</b><small>${shEsc(insHost(a.url))}</small></span><span class="ins-chip warn">Could not read</span></div>`;
      const age = hdrMaxAge(a.cache, a.expires);
      return `<div class="hdr-a"><span class="hdr-at"><b title="${shEsc(a.url)}">${shEsc(insShort(insFile(a.url), 34))}</b><small>${shEsc(insHost(a.url))}${a.bytes ? ' · ' + insBytes(a.bytes) : ''}</small></span>
        <span class="ins-chips"><span class="ins-chip ${/(gzip|br|zstd|deflate)/i.test(a.enc) ? 'ok' : (a.bytes > 1500 || a.len > 1500 ? 'warn' : 'info')}">${a.enc ? shEsc(a.enc) : 'No compression'}</span><span class="ins-chip ${age != null && age >= 604800 ? 'ok' : a.first ? 'warn' : 'info'}">${age == null ? 'No cache' : age === 0 ? 'No caching' : 'Cached ' + hdrDays(age)}</span></span></div>`;
    }).join('')}</div><p class="ins-note">The heaviest scripts, styles and fonts on this page, plus its scripts. Files from other sites are shown but not judged, because you cannot change their headers.</p>`;
  }

  h += `<details class="site-g hdr-all"><summary><span>All response headers</span><em>${HDR.doc.all.length}</em></summary><div class="site-gb"><div class="hdr-kv">${HDR.doc.all.map(([k, v]) => `<div><b>${shEsc(k)}</b><code>${shEsc(insShort(v, 160))}</code></div>`).join('')}</div></div></details>`;
  h += `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="hdr" data-v="copy">${shIcon('copy', 13)} Copy report</button><button type="button" class="sh-btn sm" data-sh="hdr" data-v="reload">Check again</button></div>`;
  return h;
}

function hdrHandle(op, el) {
  if (op === 'fmt') { HDR.fmt = el.dataset.f; shRender(); }
  else if (op === 'reload') { const u = HDR.url || SH.url; hdrLoad(u); shRender(); }
  else if (op === 'copy') {
    const items = hdrEvaluate();
    const L = [`Server headers for ${HDR.url}`, ''];
    items.forEach(i => L.push(`${i.pass ? '✓' : '✗'} ${i.rule.label} — ${i.line}`));
    const fails = items.filter(i => !i.pass && (i.rule.header || i.rule.special));
    if (fails.length) L.push('', 'Fix (raw headers):', hdrConfig(fails, 'raw'));
    copyToClipboard(L.join('\n'), 'Report copied');
  }
}

/* ------------------------------------------------------------------ registration */
SH_SCREENS.linkcheck = { title: 'Link checker', build: lnkScreen };
SH_SCREENS.headers = { title: 'Server headers', build: hdrScreen };

SH_CATS.splice(SH_CATS.findIndex(c => c.id === 'tech'), 0, {
  id: 'sec', name: 'Security & delivery', short: 'Security', lab: 'Secure', icon: 'shield', blurb: 'Headers, compression and caching your server sends.', info: true,
  explore: [['headers', 'Server headers', 'Security, compression and caching', 'shield']]
});
SH_CATS.filter(c => c.id === 'links')[0].explore = [['linkcheck', 'Link checker', 'Find broken and redirecting links', 'link']];
SH_TOOLS.Page.push(['linkcheck', 'Link checker', 'link'], ['headers', 'Server headers', 'shield']);
SH_TOOL_META.linkcheck = 'Broken and redirecting links';
SH_TOOL_META.headers = 'Security, compression, caching';
SH_TOOL_KEYWORDS.linkcheck = 'links broken 404 redirect dead link checker anchors';
SH_TOOL_KEYWORDS.headers = 'headers security hsts csp compression gzip brotli cache cache-control https server nginx apache';

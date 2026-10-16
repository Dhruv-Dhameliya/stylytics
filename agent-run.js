/* agent-run.js — runs the agent-readiness scan and keeps its state.
 *
 * Each page gets its own state object. A scan can start the moment a tab begins to load (the checks
 * that only need the network do not wait for the page), fill its own state in the background, and be
 * adopted by the panel when the page has been read. Finished origin-level results are reused for a
 * few minutes, so moving around one site does not repeat the same two dozen requests.
 *
 *   ARX            settings and screen state that outlive a page
 *   AR             the state of the page on screen (replaced, never mutated across pages)
 *   arStart(url)   start or join the scan for a page
 *   arOnScan(url)  called after each panel scan (shell.js: shAfterScan)
 */

const ARX = { opts: { auto: true, dns: true, probe: true }, profile: 'auto', open: {}, variant: {}, listeners: [], forceNext: false };
const AR_STATES = new Map();

function arNewState(key, url) {
  return {
    phase: 'idle', key: key, url: url, origin: '', results: {}, done: 0, total: 0, at: 0, page: null, llms: null, soft404: null,
    bots: null, promise: null, local: false, started: 0
  };
}
let AR = arNewState('', '');

const arPageKey = (url) => { try { const u = new URL(url); u.hash = ''; return u.href; } catch (e) { return url; } };
const AR_ORIGIN_CACHE = new Map();

function arOptsLoad(cb) {
  try {
    chrome.storage.local.get(['ar_auto', 'ar_dns', 'ar_probe', 'ar_profile'], (r) => {
      ARX.opts = { auto: r.ar_auto !== false, dns: r.ar_dns !== false, probe: r.ar_probe !== false };
      if (['auto', 'content', 'app'].indexOf(r.ar_profile) >= 0) ARX.profile = r.ar_profile;
      cb && cb();
    });
  } catch (e) { cb && cb(); }
}

// A bounded worker pool: tasks run six at a time so a scan never floods one server.
async function arPool(tasks, limit) {
  let i = 0;
  const worker = async () => { while (i < tasks.length) { const t = tasks[i++]; try { await t(); } catch (e) { /* the task leaves its check unreported */ } } };
  await Promise.all(Array.from({ length: limit }, worker));
}

function arNotify(S, final) { if (S !== AR) return; ARX.listeners.forEach(fn => { try { fn(final); } catch (e) { /* ignore */ } }); }

// Start (or join) the scan for this page. A prefetch fills a state in the background; the panel's own
// call adopts it. Returns a promise that resolves when the scan is finished, or null when nothing ran.
function arStart(url, o) {
  o = o || {};
  if (!/^https?:/i.test(url || '')) {
    if (!o.prefetch) AR = arNewState('', url || '');
    return null;
  }
  const key = arPageKey(url);
  let S = AR_STATES.get(key);
  const stillFresh = S && S.phase === 'done' && Date.now() - S.at < AR_CACHE_MS;
  if (S && !o.force && (S.phase === 'running' || stillFresh)) {
    if (!o.prefetch) AR = S;
    return S.promise;
  }
  let c;
  try { c = arMakeCtx(url, { dns: ARX.opts.dns, aiCatalogHref: null }); } catch (e) { return null; }

  S = arNewState(key, url);
  S.origin = c.origin; S.local = c.isLocal; S.phase = 'running'; S.started = Date.now();
  AR_STATES.set(key, S);
  if (AR_STATES.size > 8) AR_STATES.delete(AR_STATES.keys().next().value);
  if (!o.prefetch) AR = S;

  const cached = AR_ORIGIN_CACHE.get(c.origin);
  const fresh = !!(cached && Date.now() - cached.at < AR_CACHE_MS && !o.force);
  // what depends on the page itself is never reused from another page of the same site
  const perPage = ['linkHeaders', 'markdownNegotiation', 'webMcp'];
  if (fresh) {
    Object.keys(cached.results).forEach(id => { if (perPage.indexOf(id) < 0) S.results[id] = cached.results[id]; });
    S.llms = cached.llms; S.soft404 = cached.soft404;
  }

  const todo = AR_DEFS.filter(d => d.run && !S.results[d.id]);
  S.total = todo.length + 2;
  let paintAt = 0;
  const tick = () => { S.done++; const now = Date.now(); if (now - paintAt > 350) { paintAt = now; arNotify(S, false); } };

  const tasks = [];
  // the page first: headers, the raw HTML and the no-JavaScript view all come from this one request
  tasks.push(async () => { const r = await c.page(); S.page = arAnalyzeResponse(r, url); tick(); });
  tasks.push(async () => {
    const ro = await c.robots();
    if (ro.valid) S.bots = { path: c.pagePath, list: arAiPolicies(ro.parsed, c.pagePath), sitemaps: ro.parsed.sitemaps.length };
    S.robotsText = !ro.r.error && ro.r.status === 200 && !arLooksHtml(ro.r) ? ro.r.text : '';
    if (!S.llms) S.llms = await arProbeLlms(c);
    if (!S.soft404) S.soft404 = await arProbeSoft404(c);
    tick();
  });
  const dependants = todo.filter(d => d.dependsOn);
  todo.filter(d => !d.dependsOn).forEach(d => tasks.push(async () => {
    const t0 = Date.now();
    let r;
    try { r = await d.run(c, S.results); } catch (e) { r = { status: 'unable', message: 'The check could not run', evidence: [] }; }
    r.id = d.id; r.ms = Date.now() - t0;
    S.results[d.id] = r;
    tick();
  }));

  S.promise = (async () => {
    await arPool(tasks, 6);
    for (const d of dependants) {
      let r;
      try { r = await d.run(c, S.results); } catch (e) { r = { status: 'unable', message: 'The check could not run', evidence: [] }; }
      r.id = d.id; r.ms = 0;
      S.results[d.id] = r;
      tick();
    }
    S.phase = 'done'; S.at = Date.now();
    if (!fresh) AR_ORIGIN_CACHE.set(c.origin, { at: S.at, results: Object.assign({}, S.results), llms: S.llms, soft404: S.soft404 });
    arNotify(S, true);
  })();
  return S.promise;
}

/* ------------------------------------------------------------------ after the page is read */
// WebMCP is recorded by a small listener in the page's own world (webmcp-probe.js). Read what it saw.
function arReadProbe(tabId, cb) {
  try {
    chrome.scripting.executeScript({
      target: { tabId: tabId }, world: 'MAIN',
      func: () => {
        const p = window.__stylyticsWebMcp;
        let hasNav = false, hasDoc = false;
        try { hasNav = !!navigator.modelContext; } catch (e) { /* none */ }
        try { hasDoc = !!document.modelContext; } catch (e) { /* none */ }
        return { present: !!p, tools: p ? p.tools.slice(0, 50) : [], hasNav: hasNav, hasDoc: hasDoc };
      }
    }, (res) => {
      if (chrome.runtime.lastError || !res || !res[0]) { cb(null); return; }
      cb(res[0].result || null);
    });
  } catch (e) { cb(null); }
}

// The two checks that need the live page: WebMCP tools, and an ARD manifest named by a <link> tag.
function arAfterExtract(d, url, tabId) {
  const S = AR;
  if (!d || S.key !== arPageKey(url)) return;
  const sig = d.agentSignals || {};
  arReadProbe(tabId, (probe) => {
    if (S.key !== arPageKey(url)) return;
    S.results.webMcp = arWebMcpResult(sig, probe);
    arNotify(S, true);
  });
  if (sig.aiCatalogHref) {
    const redo = () => {
      if (S.key !== arPageKey(url) || (S.results.ard && S.results.ard.status === 'pass')) return;
      let c;
      try { c = arMakeCtx(url, { dns: ARX.opts.dns, aiCatalogHref: sig.aiCatalogHref }); } catch (e) { return; }
      AR_DEF.ard.run(c).then((r) => { r.id = 'ard'; r.ms = 0; if (S.key === arPageKey(url)) { S.results.ard = r; arNotify(S, true); } });
    };
    if (S.phase === 'done') redo(); else if (S.promise) S.promise.then(redo);
  }
}

// Called after every panel scan. Joins a scan that was already started at navigation time.
function arOnScan(url, tabId) {
  if (typeof avReset === 'function') avReset(url);
  arOptsLoad(() => {
    if (!/^https?:/i.test(url || '')) { arStart(url); arNotify(AR, true); return; }
    if (!ARX.opts.auto && !ARX.forceNext) {
      AR = arNewState(arPageKey(url), url);
      AR.phase = 'off';
      arNotify(AR, true);
      return;
    }
    const force = ARX.forceNext;
    ARX.forceNext = false;
    const p = arStart(url, { force: force });
    arAfterExtract(typeof lastExtractedData !== 'undefined' ? lastExtractedData : null, url, tabId);
    if (p) p.then(() => arAfterExtract(typeof lastExtractedData !== 'undefined' ? lastExtractedData : null, url, tabId));
    arNotify(AR, false);
  });
}

// Begin scanning as soon as the active tab starts to load, without waiting for the page to finish.
function arPrefetchInit() {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.onUpdated) return;
  arOptsLoad(() => { /* options are cached for the listener below */ });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'loading' || !info.url || !/^https?:/i.test(info.url) || !ARX.opts.auto) return;
    chrome.tabs.get(tabId, (t) => {
      if (chrome.runtime.lastError || !t || !t.active) return;
      arStart(info.url, { prefetch: true });
    });
  });
}

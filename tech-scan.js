/* tech-scan.js — the panel side of the technology detector.
 *
 * Gathers what the matcher needs from the page and the site, sends it to tech-worker.js, and merges
 * the answer with the detector that was already here:
 *
 *   in the page (its own JavaScript world)   rendered HTML, visible text, CSS rules, script URLs and
 *                                            inline scripts, meta tags, cookies, requests, the global
 *                                            variables and DOM selectors the rules ask about
 *   from the site                            response headers, robots.txt, DNS records (over HTTPS)
 *
 * The earlier heuristics keep running; anything they find that the rule set does not is kept, and
 * where both find the same technology the rule set's version and category win.
 */

const TX_DNS_TYPES = { CNAME: 5, NS: 2, MX: 15, SOA: 6, TXT: 16 };
// Wappalyzer's category names, mapped onto the names this panel already groups by
const TX_CAT_ALIAS = {
  'JavaScript frameworks': 'JavaScript Framework', 'JavaScript libraries': 'JavaScript Library', 'Web servers': 'Web Server',
  'Programming languages': 'Programming Language', 'Tag managers': 'Tag Manager', 'Reverse proxies': 'Reverse Proxy', 'Web frameworks': 'Web Framework',
  'UI frameworks': 'UI Framework', 'Font scripts': 'Font Script', 'Payment processors': 'Payment Processor', 'Live chat': 'Live Chat',
  'Static site generator': 'Static Site Generator', 'Page builders': 'Page Builder', 'Databases': 'Database', 'Marketing automation': 'Marketing Automation',
  'Cookie compliance': 'Cookie Consent', 'Search engines': 'Search Engine', 'Video players': 'Video Player'
};

const TX = {
  enabled: true, phase: 'idle', gen: 0, meta: null, error: '', progress: null, items: [], info: new Map(), legacyFront: [], legacyExtras: [], data: null,
  catPriority: new Map(), worker: null, calls: new Map(), nextId: 0, prep: null, prepVersion: 0, cache: new Map(), url: ''
};

/* ------------------------------------------------------------------ worker client */
function txWorker() {
  if (TX.worker) return TX.worker;
  const w = new Worker('tech-worker.js');
  w.onmessage = (e) => {
    const m = e.data || {};
    if (m.event === 'progress') { TX.progress = m; txStatusLine(); return; }
    if (m.event === 'updated') { TX.meta = m.meta; TX.prep = null; txStatusLine(); return; }
    const call = TX.calls.get(m.id);
    if (!call) return;
    TX.calls.delete(m.id);
    clearTimeout(call.timer);
    if (m.ok) call.resolve(m.result); else call.reject(new Error(m.error));
  };
  w.onerror = () => txKillWorker('The detection worker stopped.');
  TX.worker = w;
  return w;
}

function txKillWorker(reason) {
  try { if (TX.worker) TX.worker.terminate(); } catch (e) { /* already gone */ }
  TX.worker = null;
  TX.calls.forEach((c) => { clearTimeout(c.timer); c.reject(new Error(reason)); });
  TX.calls.clear();
}

// A page with a pathological pattern could stall the matcher: a call that overruns ends the worker.
function txCall(type, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = txWorker(); } catch (e) { reject(e); return; }
    const id = ++TX.nextId;
    const timer = setTimeout(() => { if (TX.calls.has(id)) txKillWorker('The detection took too long and was stopped.'); }, timeoutMs || 15000);
    TX.calls.set(id, { resolve: resolve, reject: reject, timer: timer });
    w.postMessage({ id: id, type: type, payload: payload });
  });
}

/* ------------------------------------------------------------------ what the page tells us */
// Runs inside the page (executeScript, MAIN world), so it must be self-contained.
/* >>> page-snapshot */
async function txPageSnapshot(chains, doms) {
  const started = performance.now();
  const out = { url: location.href, html: '', text: '', css: '', scripts: [], scriptSrc: [], meta: {}, cookies: {}, xhr: [], js: {}, dom: {} };
  const part = (fn) => { try { fn(); } catch (e) { /* leave this part empty */ } };
  const scalar = (v) => (typeof v === 'string' || typeof v === 'number' ? v : !!v);
  const own = Object.prototype.hasOwnProperty;

  part(() => { let h = document.documentElement.outerHTML; if (h.length > 3000000) h = h.slice(0, 1500000) + '\n' + h.slice(-1500000); out.html = h; });
  part(() => { out.text = ((document.body && document.body.innerText) || '').slice(0, 1000000); });
  part(() => {
    const rows = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }          // another site's stylesheet
      for (const r of Array.from(rules)) { rows.push(r.cssText); if (rows.length >= 3000) break; }
      if (rows.length >= 3000) break;
    }
    out.css = rows.join('\n');
  });
  part(() => {
    const nodes = Array.from(document.getElementsByTagName('script'));
    out.scriptSrc = nodes.filter((n) => n.src && !n.src.startsWith('data:text/javascript;')).map((n) => n.src);
    out.scripts = nodes.map((n) => n.textContent).filter(Boolean).map((s) => s.slice(0, 200000)).slice(0, 200);
    // scripts a tag manager added and then removed are still in the request log
    const seen = new Set(out.scriptSrc);
    performance.getEntriesByType('resource').forEach((e) => { if ((e.initiatorType === 'script' || /\.js(\?|$)/i.test(e.name)) && !seen.has(e.name) && out.scriptSrc.length < 400) { seen.add(e.name); out.scriptSrc.push(e.name); } });
  });
  part(() => {
    Array.from(document.querySelectorAll('meta')).forEach((m) => {
      const key = m.getAttribute('name') || m.getAttribute('property');
      if (!key) return;
      const k = key.toLowerCase();
      (out.meta[k] = out.meta[k] || []).push(m.getAttribute('content'));
    });
  });
  part(() => {
    document.cookie.split(';').forEach((c) => {
      const i = c.indexOf('=');
      const name = (i < 0 ? c : c.slice(0, i)).trim().toLowerCase();
      if (!name) return;
      let val = i < 0 ? '' : c.slice(i + 1).trim();
      try { val = decodeURIComponent(val); } catch (e) { /* keep raw */ }
      (out.cookies[name] = out.cookies[name] || []).push(val);
    });
  });
  part(() => {
    const hosts = new Set();
    performance.getEntriesByType('resource').forEach((e) => {
      if (/^(xmlhttprequest|fetch|beacon)$/.test(e.initiatorType)) { try { hosts.add(new URL(e.name).hostname); } catch (x) { /* skip */ } }
    });
    out.xhr = Array.from(hosts).slice(0, 300);
  });
  part(() => {
    // a global variable counts if every step of its path is a real property, as the official matcher does
    chains.forEach((chain) => {
      try {
        const parts = chain.split('.');
        let root = window;
        if (/^[a-z_$][a-z0-9_$]*$/i.test(parts[0])) { root = window[parts.shift()]; if (typeof root === 'undefined') return; }
        let v = root || undefined;
        if (typeof v === 'undefined') return;
        for (let i = 0; i < parts.length; i++) {
          if (v && v instanceof Object && own.call(v, parts[i])) v = v[parts[i]]; else return;
        }
        out.js[chain] = scalar(v);
      } catch (e) { /* a getter that throws */ }
    });
  });
  // The selectors run on the page's own thread. They are done in small batches with a pause between
  // them, so the page the person is looking at stays responsive, and the whole job has a time limit.
  for (let i = 0; i < doms.length; i++) {
    if (i && i % 80 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    if (performance.now() - started > 4000) break;                     // a huge page: report what has been checked
    try {
      const d = doms[i];
      let nodes;
      try { nodes = document.querySelectorAll(d.sel); } catch (e) { continue; }
      if (!nodes.length) continue;
      const r = { exists: true };
      const first = Array.from(nodes).slice(0, 25);
      if (d.text) { r.text = []; first.slice(0, 10).forEach((n) => { const t = (n.textContent || '').trim().slice(0, 5000); if (t && r.text.indexOf(t) < 0) r.text.push(t); }); }
      if (d.attrs.length) {
        r.attrs = {};
        d.attrs.forEach((a) => { const vals = []; first.forEach((n) => { if (n.hasAttribute(a)) { const v = n.getAttribute(a); if (vals.indexOf(v) < 0) vals.push(v); } }); if (vals.length) r.attrs[a] = vals; });
      }
      if (d.props.length) {
        r.props = {};
        d.props.forEach((p) => { const vals = []; first.forEach((n) => { if (own.call(n, p)) { const v = scalar(n[p]); if (vals.indexOf(v) < 0) vals.push(v); } }); if (vals.length) r.props[p] = vals; });
      }
      out.dom[d.sel] = r;
    } catch (e) { /* skip this selector */ }
  }
  return out;
}
/* <<< page-snapshot */

function txSnapshot(tabId, prep) {
  return new Promise((resolve) => {
    try {
      chrome.scripting.executeScript({ target: { tabId: tabId }, world: 'MAIN', func: txPageSnapshot, args: [prep.js, prep.dom] }, (res) => {
        if (chrome.runtime.lastError || !res || !res[0]) { resolve(null); return; }
        resolve(res[0].result || null);
      });
    } catch (e) { resolve(null); }
  });
}

/* ------------------------------------------------------------------ what the site tells us */
// a step that cannot answer in time must not hold the whole detection back
const txWithin = (promise, ms, fallback) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

async function txHeaders(url) {
  const key = 'h|' + url;
  const hit = TX.cache.get(key);
  if (hit && Date.now() - hit.at < AR_CACHE_MS) return hit.v;
  const h = {};
  const take = (pairs) => pairs.forEach(([k, v]) => { h[String(k).toLowerCase()] = [v]; });
  // the panel has often fetched this page's headers already: use them instead of asking the site again
  if (typeof HDR !== 'undefined' && HDR.phase === 'done' && HDR.url === url && HDR.doc && Array.isArray(HDR.doc.all) && HDR.doc.all.length) take(HDR.doc.all);
  else if (typeof AR !== 'undefined' && AR.page && AR.page.url === url && AR.page.headersAll) take(Object.entries(AR.page.headersAll));
  else {
    const r = await arFetch(url, { max: 2048, timeout: 7000 });
    if (!r.error && r.headers) { try { r.headers.forEach((v, k) => { h[k.toLowerCase()] = [v]; }); } catch (e) { /* none */ } }
  }
  TX.cache.set(key, { at: Date.now(), v: h });
  return h;
}

async function txRobots(origin) {
  if (typeof AR !== 'undefined' && AR.origin === origin && typeof AR.robotsText === 'string' && AR.phase === 'done') return AR.robotsText;
  const r = await arFetch(origin + '/robots.txt', { max: 100000, timeout: 5000 });
  return !r.error && r.status === 200 && !arLooksHtml(r) ? r.text : '';
}

async function txDns(host) {
  if (typeof ARX !== 'undefined' && ARX.opts && ARX.opts.dns === false) return null;
  if (/^(localhost|127\.|10\.|192\.168\.)/.test(host) || host.indexOf('.') < 0 || /\.(local|test|internal|localhost)$/.test(host)) return null;
  const key = 'd|' + host;
  const hit = TX.cache.get(key);
  if (hit && Date.now() - hit.at < AR_CACHE_MS) return hit.v;
  const apex = host.replace(/^www\./, '');
  const dot = (s) => String(s).replace(/\.$/, '');
  const ask = async (name, type) => {
    const r = await arDoh(name, type);
    return r.ok && r.json.Status === 0 && Array.isArray(r.json.Answer) ? r.json.Answer.filter((a) => a.type === TX_DNS_TYPES[type]) : [];
  };
  const [cname, ns, mx, txt, soa] = await Promise.all([ask(host, 'CNAME'), ask(apex, 'NS'), ask(apex, 'MX'), ask(apex, 'TXT'), ask(apex, 'SOA')]);
  const v = {
    cname: cname.map((a) => dot(a.data)), ns: ns.map((a) => dot(a.data)),
    mx: mx.map((a) => { const p = String(a.data).split(' '); return dot(p[1] || p[0]) + ' ' + (p[1] ? p[0] : ''); }),
    txt: txt.map((a) => String(a.data).replace(/"\s*"/g, '').replace(/^"|"$/g, '')),
    soa: soa.map((a) => String(a.data).split(' ').map(dot).join(' '))
  };
  TX.cache.set(key, { at: Date.now(), v: v });
  return v;
}

/* ------------------------------------------------------------------ the scan */
const txKey = (name) => String(name).replace(/ \(likely\)$/, '').replace(/\s+v?\d[\w.+-]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function txStart(gen, tabId, url, data) {
  TX.gen = gen; TX.url = url; TX.data = data;
  TX.legacyFront = (data && data.techStack) || []; TX.legacyExtras = [];   // the previous page's results must not linger
  await TX.ready;                                                          // the saved on/off setting is known before anything runs
  if (gen !== extractGeneration) return;
  if (!TX.enabled || !/^https?:/i.test(url || '')) { TX.phase = TX.enabled ? 'idle' : 'off'; TX.items = []; TX.info = new Map(); txRender(); return; }
  const current = () => gen === extractGeneration;
  // the rules could not be downloaded a moment ago: do not hammer the network on every scan
  if (!TX.meta && TX.failedAt && Date.now() - TX.failedAt < 5 * 60 * 1000) { TX.phase = 'error'; TX.items = []; TX.info = new Map(); txRender(); return; }
  TX.phase = TX.meta ? 'scanning' : 'loading'; TX.error = ''; TX.items = []; txStatusLine();
  try {
    if (!TX.meta) {
      // overlapping scans share one start-up, so the rules are never requested twice at once
      TX.initP = TX.initP || txCall('init', null, 120000);
      try { TX.meta = await TX.initP; TX.failedAt = 0; } catch (e) { TX.failedAt = Date.now(); throw e; } finally { TX.initP = null; }
    }
    if (!current()) return;
    TX.phase = 'scanning'; txStatusLine();
    if (!TX.prep || TX.prepVersion !== TX.meta.fetchedAt) { TX.prep = await txCall('prepare', null, 20000); TX.prepVersion = TX.meta.fetchedAt; }
    let origin = '', host = '';
    try { const u = new URL(url); origin = u.origin; host = u.hostname; } catch (e) { return; }
    const [snap, headers, robots, dns] = await Promise.all([txSnapshot(tabId, TX.prep), txWithin(txHeaders(url), 8000, {}), txWithin(txRobots(origin), 6000, ''), txWithin(txDns(host), 6000, null)]);
    if (!current()) return;
    if (!snap) throw new Error('The page could not be read for detection.');
    const items = Object.assign({}, snap, { headers: headers, robots: robots, dns: dns || undefined });
    const found = await txCall('analyze', items, 20000);
    if (!current()) return;
    TX.items = found.filter((f) => f.confidence >= 50);
    TX.items.forEach((f) => { const cat = txCategory(f); if (!TX.catPriority.has(cat)) TX.catPriority.set(cat, f.priority); });
    TX.phase = 'done';
  } catch (e) {
    if (!current()) return;
    TX.phase = 'error'; TX.error = String((e && e.message) || e);
  }
  txRender();
}

const txCategory = (f) => TX_CAT_ALIAS[f.category] || f.category;
const txDisplayName = (f) => f.name + (f.shown ? ' ' + f.shown : '') + (f.confidence < 100 ? ' (likely)' : '');
const txVersionOf = (name) => { const m = String(name).replace(/ \(likely\)$/, '').match(/\s(v?\d[\w.+-]*)$/); return m ? m[1].replace(/^v/, '') : ''; };

/* ------------------------------------------------------------------ merging and drawing */
function txOnLegacy(gen, data, extras) {
  TX.data = data;
  TX.legacyFront = (data && data.techStack) || [];
  TX.legacyExtras = extras || [];
  txRender();
}

function txRender() {
  if (!TX.data) return;
  const engine = new Set(TX.items.map((f) => txKey(f.name)));
  // one technology, one entry: the rule set wins, and anything only the earlier detector found is kept.
  // When the rules found no version but the earlier detector did, the version is kept.
  const legacyVersion = new Map();
  TX.legacyFront.concat(TX.legacyExtras).forEach((i) => { const v = txVersionOf(i.name); if (v) legacyVersion.set(txKey(i.name), v); });
  TX.info = new Map();
  TX.items.forEach((f) => { f.shown = f.version || legacyVersion.get(txKey(f.name)) || ''; f.display = txDisplayName(f); TX.info.set(f.display, f); });
  const front = TX.legacyFront.filter((i) => !engine.has(txKey(i.name)));
  const extra = TX.legacyExtras.filter((i) => !engine.has(txKey(i.name)));
  const found = TX.items.map((f) => ({ name: f.display, category: txCategory(f) }));
  renderTechStack(front, extra.concat(found));
  txStatusLine();
}

// extra categories (from the rule set) sort by their priority, then by name
function txCatSort(a, b) {
  const pa = TX.catPriority.has(a) ? TX.catPriority.get(a) : 11, pb = TX.catPriority.has(b) ? TX.catPriority.get(b) : 11;
  return pa - pb || a.localeCompare(b);
}

function txDecorateChip(chip, name) {
  const f = TX.info.get(name);
  if (!f) return;
  const lines = [];
  if (f.description) lines.push(f.description);
  lines.push(`Found in: ${f.via.map((v) => ({ headers: 'response headers', scriptSrc: 'script addresses', js: 'page variables', dom: 'page elements', meta: 'meta tags', cookies: 'cookies', html: 'page source', scripts: 'inline scripts', text: 'page text', css: 'styles', url: 'the address', xhr: 'requests', dns: 'DNS records', robots: 'robots.txt', implied: 'implied by another technology' }[v] || v)).join(', ')} · ${f.confidence}% sure`);
  if (f.categories.length > 1) lines.push('Also: ' + f.categories.filter((c) => (TX_CAT_ALIAS[c] || c) !== txCategory(f)).join(', '));
  if (f.website) lines.push('Click to open ' + f.website.replace(/^https?:\/\//, ''));
  chip.title = lines.join('\n');
  if (f.website) { chip.classList.add('tag-link'); chip.addEventListener('click', () => window.open(f.website, '_blank')); }
}

function txAgo(ts) { return ts ? (typeof insAgo === 'function' ? insAgo(ts) : new Date(ts).toLocaleDateString()) : ''; }

function txStatusLine() {
  const container = document.getElementById('tech-stack-categories');
  if (!container || !container.parentNode) return;
  let el = document.getElementById('tx-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tx-status';
    el.className = 'tx-status';
    container.parentNode.insertBefore(el, container);
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-tx]'); if (b) txHandle(b.dataset.tx); });
  }
  const m = TX.meta;
  const rules = m ? `${m.count.toLocaleString()} technologies · rules updated ${txAgo(m.fetchedAt)}` : '';
  let text = '', btn = '';
  if (TX.phase === 'off') text = 'Detection rules are turned off in Settings. The built-in detector is still used.';
  else if (TX.phase === 'loading') text = TX.progress ? `Downloading the Wappalyzer rules (${TX.progress.done} of ${TX.progress.total})…` : 'Preparing the Wappalyzer rules (first run downloads them)…';
  else if (TX.phase === 'scanning') text = 'Checking the page against ' + (m ? m.count.toLocaleString() : 'thousands of') + ' technology rules…';
  else if (TX.phase === 'error') { text = 'The rule set could not be used (' + TX.error + '). Showing the built-in detector.'; btn = '<button type="button" data-tx="retry">Try again</button>'; }
  else if (TX.phase === 'done') { text = `Matched with ${rules}`; btn = '<button type="button" data-tx="update">Update rules</button>'; }
  else text = '';
  el.innerHTML = text ? `<span>${escapeHtml(text)}</span>${btn}` : '';
  el.classList.toggle('hidden', !text);
  el.classList.toggle('bad', TX.phase === 'error');
  const sm = document.getElementById('settings-tx-meta');
  if (sm) sm.textContent = m ? `${m.count.toLocaleString()} technologies, updated ${txAgo(m.fetchedAt)}.` : 'Not downloaded yet. It downloads on the first scan.';
}

function txHandle(op) {
  if (op === 'retry') { TX.meta = null; TX.failedAt = 0; if (lastExtractedData && lastActiveTabId) txStart(extractGeneration, lastActiveTabId, TX.url, lastExtractedData); }
  else if (op === 'update') {
    showToast('Updating the technology rules…');
    TX.phase = 'loading'; TX.progress = null; txStatusLine();
    txCall('init', { force: true }, 120000).then((meta) => { TX.meta = meta; TX.prep = null; showToast('Rules updated (' + meta.count.toLocaleString() + ' technologies)'); if (lastExtractedData && lastActiveTabId) txStart(extractGeneration, lastActiveTabId, TX.url, lastExtractedData); })
      .catch((e) => { TX.phase = 'error'; TX.error = String(e.message || e); txStatusLine(); });
  }
}

/* ------------------------------------------------------------------ settings */
function txSettingsHtml() {
  return `<div class="sh-sec"><span>Technology detection</span></div><div class="sh-card">
      <div class="sh-trow"><span class="sh-ico">${shIcon('chip', 16)}</span><div class="sh-tx"><b>Use the Wappalyzer rule set</b><small>Matches the page against the open-source Wappalyzer rules (thousands of technologies). The rules are downloaded from GitHub the first time and once a week after that. Only the rules are downloaded: nothing about the pages you visit is sent.</small></div><label class="switch"><input type="checkbox" id="settings-tx-on"><span class="switch-track"></span></label></div>
      <button class="sh-row" type="button" id="settings-tx-update"><span class="sh-ico">${shIcon('refresh', 16)}</span><span class="sh-tx"><b>Update the rules now</b><small id="settings-tx-meta">Not downloaded yet.</small></span>${shChev()}</button>
    </div>`;
}

function txWireSettings() {
  const on = document.getElementById('settings-tx-on'), upd = document.getElementById('settings-tx-update');
  if (!on) return;
  chrome.storage.local.get(['tx_on'], (r) => { TX.enabled = r.tx_on !== false; on.checked = TX.enabled; });
  on.addEventListener('change', () => {
    TX.enabled = on.checked;
    chrome.storage.local.set({ tx_on: on.checked });
    showToast(on.checked ? 'Using the Wappalyzer rule set' : 'Using the built-in detector only');
    if (lastExtractedData && lastActiveTabId) txStart(extractGeneration, lastActiveTabId, TX.url, lastExtractedData);
  });
  const meta = () => { const el = document.getElementById('settings-tx-meta'); if (el) el.textContent = TX.meta ? `${TX.meta.count.toLocaleString()} technologies, updated ${txAgo(TX.meta.fetchedAt)}.` : 'Not downloaded yet. It downloads on the first scan.'; };
  meta();
  upd.addEventListener('click', () => { txHandle('update'); setTimeout(meta, 4000); });
}

// read the saved setting as soon as this file loads; the first scan waits for it
TX.ready = new Promise((resolve) => {
  try { chrome.storage.local.get(['tx_on'], (r) => { TX.enabled = r.tx_on !== false; resolve(); }); } catch (e) { resolve(); }
});

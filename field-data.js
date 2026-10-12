/* field-data.js — real-user Core Web Vitals from the Chrome UX Report (CrUX) API.
 *
 * The lab numbers on the Speed screen come from this one load, on this one device. CrUX reports what real
 * Chrome visitors experienced over the last 28 days (75th percentile). Showing both, and explaining when
 * they disagree, is the point. Needs a free API key, stored on this device only.
 */

const FIELD = { key: '', status: 'idle', error: '', data: {}, scope: '', url: '', factor: 'ALL', loaded: false };
const FIELD_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
const FIELD_METRICS = [
  { id: 'lcp', api: 'largest_contentful_paint', name: 'Largest paint', short: 'LCP' },
  { id: 'inp', api: 'interaction_to_next_paint', name: 'Responsiveness', short: 'INP' },
  { id: 'cls', api: 'cumulative_layout_shift', name: 'Layout shift', short: 'CLS' },
  { id: 'fcp', api: 'first_contentful_paint', name: 'First paint', short: 'FCP' },
  { id: 'ttfb', api: 'experimental_time_to_first_byte', name: 'Server response', short: 'TTFB' }
];

/* ------------------------------------------------------------------ request */
function fieldBody(url, factor, asOrigin) {
  const body = {};
  if (asOrigin) { try { body.origin = new URL(url).origin; } catch (e) { body.origin = url; } } else body.url = url;
  if (factor && factor !== 'ALL') body.formFactor = factor;
  body.metrics = FIELD_METRICS.map(m => m.api);
  return body;
}

// One query. Resolves { ok, record } or { ok:false, status, message, notFound }.
async function fieldQuery(key, body) {
  let res;
  try {
    res = await fetch(`${FIELD_ENDPOINT}?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    return { ok: false, status: 0, message: 'Could not reach Google. Check your connection.' };
  }
  let json = null;
  try { json = await res.json(); } catch (e) { /* no body */ }
  if (res.ok && json && json.record) return { ok: true, record: json.record };
  const err = (json && json.error) || {};
  return { ok: false, status: res.status, notFound: res.status === 404, message: err.message || `Request failed (${res.status})` };
}

// Page first; sites with too little traffic for that page fall back to the whole origin.
async function fieldFetch(key, url, factor) {
  const clean = String(url).split('#')[0];
  let r = await fieldQuery(key, fieldBody(clean, factor, false));
  if (r.ok) return { ok: true, record: r.record, scope: 'page' };
  if (!r.notFound) return r;
  r = await fieldQuery(key, fieldBody(clean, factor, true));
  if (r.ok) return { ok: true, record: r.record, scope: 'origin' };
  return r.notFound ? { ok: false, notFound: true, message: 'Chrome has not collected enough real-user data for this page or site yet.' } : r;
}

/* ------------------------------------------------------------------ reading a record */
function fieldMetric(record, m) {
  const x = record && record.metrics && record.metrics[m.api];
  if (!x || !x.percentiles || x.percentiles.p75 == null) return null;
  const hist = (x.histogram || []).map(h => Number(h.density) || 0);
  const p75 = Number(x.percentiles.p75);
  if (!Number.isFinite(p75)) return null;
  return { p75: p75, good: hist[0] || 0, ni: hist[1] || 0, poor: hist[2] || 0 };
}

function fieldRead(entry, id) {
  const m = FIELD_METRICS.filter(x => x.id === id)[0];
  return entry ? fieldMetric(entry.record, m) : null;
}

function fieldAssessment(entry) {
  const vals = ['lcp', 'inp', 'cls'].map(id => fieldRead(entry, id));
  const present = vals.filter(Boolean);
  if (!present.length) return null;
  const tiers = ['lcp', 'inp', 'cls'].map((id, i) => vals[i] ? getCwvTier(id, vals[i].p75) : null).filter(Boolean);
  return { pass: tiers.every(t => t === 'good'), poor: tiers.filter(t => t === 'poor').length, missing: vals.filter(v => !v).length };
}

/* ------------------------------------------------------------------ explanation */
// Plain words for how the lab run and the field data relate.
function fieldExplain(id, lab, field) {
  if (!field) return '';
  const ft = getCwvTier(id, field.p75);
  if (lab == null) return id === 'inp' ? 'INP needs real taps and clicks, so a single page load cannot measure it. The field number is the only one that exists.' : 'This visit did not record this metric.';
  const lt = getCwvTier(id, lab);
  const fmtF = formatCwvValue(id, field.p75), fmtL = formatCwvValue(id, lab);
  if (lt === ft) return ft === 'good' ? `Lab and field agree: ${fmtL} here, ${fmtF} for real visitors.` : `Slow in both (${fmtL} here, ${fmtF} for visitors). This is a real problem, not a fluke.`;
  const rank = { good: 0, 'needs-improvement': 1, poor: 2 };
  if (rank[ft] > rank[lt]) return `Real visitors do worse than this visit (${fmtF} against ${fmtL}). They are probably on slower phones or networks than this device, so trust the field number.`;
  return `This visit was slower than real visitors usually are (${fmtL} against ${fmtF}). A cold cache, a busy machine or an extension can cause that. Rescan before drawing conclusions.`;
}

/* ------------------------------------------------------------------ audit check */
function fieldChecks(d) {
  const e = FIELD.data.ALL;
  if (!e) return [];
  const a = fieldAssessment(e);
  if (!a) return [];
  const bad = ['lcp', 'inp', 'cls'].map(id => ({ id: id, f: fieldRead(e, id) })).filter(x => x.f && getCwvTier(x.id, x.f.p75) !== 'good');
  return [{
    label: 'Real visitors get good Core Web Vitals', pass: a.pass, sev: a.poor ? 'High' : 'Medium',
    t: 'Improve the vitals real visitors see',
    line: bad.length ? `For real Chrome users: ${bad.map(x => `${x.id.toUpperCase()} ${formatCwvValue(x.id, x.f.p75)}`).join(', ')} (75th percentile${FIELD.scope === 'origin' ? ', whole site' : ''}).` : 'Real Chrome users get good LCP, INP and CLS at the 75th percentile.',
    mean: 'Google ranks and reports on what real visitors experience over 28 days, not on one lab run. This is the number that counts.',
    fix: 'Open the field data screen to compare lab and field, then work on the slowest metric first.',
    actions: [insOpenAction('field', 'Open field data')]
  }];
}

/* ------------------------------------------------------------------ loading */
function fieldLoad(url) {
  FIELD.url = url; FIELD.data = {}; FIELD.status = 'idle'; FIELD.error = ''; FIELD.scope = ''; FIELD.factor = 'ALL';
  chrome.storage.local.get(['crux_key'], (res) => {
    FIELD.key = (res.crux_key || '').trim();
    FIELD.loaded = true;
    if (FIELD.key && /^https?:/i.test(url)) fieldRequest('ALL'); else shRerenderIfIdle();
  });
}

function fieldRequest(factor) {
  if (!FIELD.key || FIELD.data[factor] || FIELD.status === 'loading') return;
  const forUrl = FIELD.url;
  FIELD.status = 'loading'; FIELD.error = '';
  shRerenderIfIdle();
  fieldFetch(FIELD.key, forUrl, factor).then(r => {
    if (forUrl !== FIELD.url) return;           // the tab moved on
    FIELD.status = 'idle';
    if (r.ok) { FIELD.data[factor] = { record: r.record, scope: r.scope }; if (factor === 'ALL') FIELD.scope = r.scope; }
    else { FIELD.data[factor] = { none: true }; FIELD.error = r.message; if (r.status === 400 || r.status === 403) FIELD.badKey = true; }
    shRerenderIfIdle();
  });
}

/* ------------------------------------------------------------------ screen */
function fieldBar(f) {
  const pct = (n) => Math.round(n * 100);
  return `<div class="ins-bar fld-bar" role="img" aria-label="${pct(f.good)}% good, ${pct(f.ni)}% needs work, ${pct(f.poor)}% poor"><i style="width:${f.good * 100}%;background:#16a34a" title="Good ${pct(f.good)}%"></i><i style="width:${f.ni * 100}%;background:#f59e0b" title="Needs work ${pct(f.ni)}%"></i><i style="width:${f.poor * 100}%;background:#dc2626" title="Poor ${pct(f.poor)}%"></i></div>
    <div class="fld-dist"><span>${pct(f.good)}% good</span><span>${pct(f.ni)}% needs work</span><span>${pct(f.poor)}% poor</span></div>`;
}

function fieldSetup() {
  return `<section class="sh-card ins-pad"><b>See what real visitors experience</b>
      <p class="ins-lede">The Chrome UX Report holds the loading, responsiveness and layout-shift scores of real Chrome users over the last 28 days. Stylytics shows them beside this visit and explains the gap.</p>
      <ol class="fld-steps"><li>Open the Google Cloud console and enable the <b>Chrome UX Report API</b>.</li><li>Create an API key (it is free).</li><li>Paste it in <b>Settings</b>. It stays on this device.</li></ol>
      <div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="pane" data-v="settings">Open Settings</button></div></section>`;
}

function fieldScreen(A) {
  if (!FIELD.loaded) return '<div class="sh-empty"><b>Loading…</b></div>';
  if (!FIELD.key) return fieldSetup();
  if (!/^https?:/i.test(FIELD.url)) return insEmpty('globe', 'Field data needs a public page', 'Real-user data exists only for pages on the public web.');
  const factor = FIELD.factor;
  let h = `<div class="segmented fld-tabs">${[['ALL', 'All'], ['PHONE', 'Phone'], ['DESKTOP', 'Desktop']].map(f => `<button type="button" class="tag${factor === f[0] ? ' active' : ''}" data-sh="fld" data-v="factor" data-f="${f[0]}">${f[1]}</button>`).join('')}</div>`;
  const entry = FIELD.data[factor];
  if (FIELD.status === 'loading' && !entry) return h + '<div class="sh-card"><div class="sh-empty"><b>Asking Chrome UX Report…</b></div></div>';
  if (!entry) { fieldRequest(factor); return h + '<div class="sh-card"><div class="sh-empty"><b>Asking Chrome UX Report…</b></div></div>'; }
  if (entry.none) {
    const bad = FIELD.badKey;
    return h + `<div class="sh-card"><div class="sh-empty"><span class="sh-empty-ic">${shIcon('alert', 26)}</span><b>${bad ? 'Google rejected the key' : 'No field data'}</b>${shEsc(FIELD.error || 'Not enough real-user data for this page.')}</div></div>
      <div class="sh-btns ins-foot">${bad ? '<button type="button" class="sh-btn pri sm" data-sh="pane" data-v="settings">Check the key in Settings</button>' : '<button type="button" class="sh-btn sm" data-sh="fld" data-v="retry">Try again</button>'}</div>`;
  }

  const v = A.data.webVitals || {};
  const asm = fieldAssessment(entry);
  const period = entry.record.collectionPeriod;
  const when = period && period.firstDate && period.lastDate
    ? `${insDate(Date.UTC(period.firstDate.year, period.firstDate.month - 1, period.firstDate.day))} to ${insDate(Date.UTC(period.lastDate.year, period.lastDate.month - 1, period.lastDate.day))}` : 'the last 28 days';
  if (asm) {
    const t = asm.pass ? 'ok' : asm.poor ? 'bad' : 'warn';
    h += `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${t}">${asm.pass ? 'Passed' : 'Not passed'}</span><span class="sh-tchip ${t}">Core Web Vitals</span>
        <small>${entry.scope === 'origin' ? 'Whole-site data: this page has too little traffic of its own' : 'Data for this page'} · ${shEsc(when)}</small></div>
        <p class="ins-lede">${asm.pass ? 'At the 75th percentile, real Chrome visitors get a good loading, responsiveness and layout-shift score.' : 'At the 75th percentile, real Chrome visitors do not get good scores on every Core Web Vital.'}${asm.missing ? ` ${asm.missing} of the three had too little data to judge.` : ''}</p></section>`;
  }
  FIELD_METRICS.forEach(m => {
    const f = fieldMetric(entry.record, m);
    if (!f) return;
    const tier = insTier(m.id, f.p75);
    const lab = v[m.id];
    const labTier = lab != null ? insTier(m.id, lab) : null;
    h += `<div class="sh-card ins-pad fld-m"><div class="fld-row"><span class="fld-n"><b>${m.name}</b><small>${m.short}</small></span>
        <span class="fld-v"><small>Field (75th percentile)</small><b class="${tier[1]}">${shEsc(formatCwvValue(m.id, f.p75))}</b></span>
        <span class="fld-v"><small>This visit</small><b class="${labTier ? labTier[1] : 'none'}">${lab != null ? shEsc(formatCwvValue(m.id, lab)) : '—'}</b></span></div>
      ${fieldBar(f)}<p class="ins-note fld-why">${shEsc(fieldExplain(m.id, lab, f))}</p></div>`;
  });
  h += `<p class="ins-note">Field data is the 75th percentile of real Chrome page loads over 28 days. Lab data is this single load on this device. They are meant to differ.</p>
    <div class="sh-btns ins-foot"><button type="button" class="sh-btn sm" data-sh="fld" data-v="refresh">Refresh</button></div>`;
  return h;
}

function fldHandle(op, el) {
  const ds = el.dataset || {};
  switch (op) {
    case 'factor': FIELD.factor = ds.f; shRender(); break;
    case 'retry': case 'refresh': delete FIELD.data[FIELD.factor]; FIELD.error = ''; FIELD.badKey = false; fieldRequest(FIELD.factor); break;
  }
}

/* ------------------------------------------------------------------ settings control */
function fieldSettingsHtml() {
  return `<div class="sh-sec"><span>Field data</span></div><div class="sh-card ins-pad">
      <label class="fld-lbl" for="settings-crux-key"><b>Chrome UX Report API key</b><small>Shows real-user Core Web Vitals beside the lab numbers. Stored on this device only.</small></label>
      <div class="fld-keyrow"><input type="password" id="settings-crux-key" class="search-input" autocomplete="off" spellcheck="false" placeholder="Paste a key to turn it on"><button type="button" class="sh-btn sm" id="settings-crux-save">Save</button></div></div>`;
}

function fieldWireSettings() {
  const input = shEl('settings-crux-key'), save = shEl('settings-crux-save');
  if (!input || !save) return;
  chrome.storage.local.get(['crux_key'], (res) => { input.value = res.crux_key || ''; });
  save.addEventListener('click', () => {
    const key = input.value.trim();
    chrome.storage.local.set({ crux_key: key }, () => {
      showToast(key ? 'Field data key saved' : 'Field data turned off');
      if (FIELD.url) fieldLoad(FIELD.url);
    });
  });
}

SH_SCREENS.field = { title: 'Field data', build: fieldScreen };
SH_CATS.filter(c => c.id === 'speed')[0].explore.push(['field', 'Field data', 'What real Chrome users experience', 'globe']);

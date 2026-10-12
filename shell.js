/* shell.js — navigation and the redesigned Overview / Audit / Tools screens.
 *
 * Every detailed panel (typography, colors, meta, accessibility, ...) still lives in #store with
 * its original element IDs, so the scan and render code in stylytics.js is untouched. This file
 * only decides which panel is on screen, and builds the summary screens from the existing
 * compute* functions.
 *
 * Loaded after stylytics.js and check-guide.js.
 */

/* ------------------------------------------------------------------ icons */
const SH_ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.4 0-1.1.9-2 2-2h2.4c2.3 0 4.1-1.8 4.1-4.1C21.5 6 17.2 2 12 2z"/>',
  a11y: '<circle cx="12" cy="4" r="1.5"/><path d="M4 8l8 2 8-2M12 10v5m0 0l-3 7m3-7l3 7"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  chip: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>',
  user: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  chevr: '<polyline points="9 18 15 12 9 6"/>',
  chevd: '<polyline points="6 9 12 15 18 9"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>',
  pipette: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  cc: '<circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  arrowr: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  rows: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" y1="1" x2="23" y2="23"/>'
};
function shIcon(name, size) {
  const s = size || 18;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SH_ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------------ definitions */
// Audit categories. `inline` is a panel shown inside the category; `explore` are panels opened from it.
const SH_CATS = [
  { id: 'seo', name: 'SEO & content', short: 'SEO', lab: 'SEO', icon: 'file', blurb: 'How your page appears in search results.',
    explore: [['meta', 'Meta Insights', 'Title, description, Google preview, robots.txt', 'search'], ['social', 'Social preview', 'Facebook, X and LinkedIn cards', 'eye'], ['structured-data', 'Structured data', 'JSON-LD blocks and types', 'grid'], ['outline', 'Heading outline', 'All headings, reading time, copy as outline', 'file'], ['readability', 'Readability', 'Reading level, sentences, passive voice', 'book'], ['changes', 'Changes', 'What is different since your last scan', 'refresh']] },
  { id: 'design', name: 'Design consistency', short: 'Design', lab: 'Design', icon: 'palette', blurb: 'How steady the fonts, colors and spacing are.',
    explore: [['typography', 'Typography', 'Fonts and sizes in use', 'type'], ['colors', 'Colors', 'Palette, contrast and generators', 'palette'], ['tokens', 'Design tokens', 'Spacing, radius, shadows', 'grid']] },
  { id: 'a11y', name: 'Accessibility', short: 'Accessibility', lab: 'Access', icon: 'a11y', blurb: 'Whether everyone can use the page.', inline: 'accessibility' },
  { id: 'speed', name: 'Page speed', short: 'Speed', lab: 'Speed', icon: 'bolt', blurb: 'How fast the page loads on this visit.', inline: 'performance',
    explore: [['images', 'Image audit', 'Oversized, heavy and unprotected images', 'image'], ['shifts', 'Layout shifts & LCP', 'What moves and what paints last', 'target']] },
  { id: 'ai', name: 'AI readiness', short: 'AI readiness', lab: 'AI', icon: 'eye', blurb: 'How easily AI answer engines can read and quote the page.' },
  { id: 'ux', name: 'UX review', short: 'UX', lab: 'UX', icon: 'shield', blurb: 'Checks for manipulative design patterns.', inline: 'dark-patterns' },
  { id: 'links', name: 'Links', short: 'Links', lab: 'Links', icon: 'link', blurb: 'Internal, external and broken links.', inline: 'backlinks', info: true },
  { id: 'tech', name: 'Technology', short: 'Technology', lab: 'Tech', icon: 'chip', blurb: 'What this site is built with.', inline: 'tech-stack', info: true },
  { id: 'contact', name: 'Contact details', short: 'Contact', lab: 'Contact', icon: 'user', blurb: 'Emails, phones and social profiles found on the page.', inline: 'media-contact', info: true }
];
const SH_PANE_TITLES = {
  meta: 'Meta Insights', social: 'Social preview', 'structured-data': 'Structured data', outline: 'Heading outline',
  typography: 'Typography', colors: 'Colors', tokens: 'Design tokens', assets: 'Assets & images', overlays: 'Overlays & simulations',
  responsive: 'Responsive preview', screenshot: 'Capture', help: 'Help', settings: 'Settings'
};
const SH_TOOLS = {
  Design: [['typography', 'Typography', 'type'], ['colors', 'Colors', 'palette'], ['tokens', 'Design tokens', 'grid'], ['assets', 'Assets & images', 'image']],
  Page: [['inspect', 'Inspect', 'target'], ['overlays', 'Overlays', 'layers'], ['responsive', 'Responsive', 'phone'], ['screenshot', 'Capture', 'camera']]
};
const SH_PANE_TO_CAT = {
  'seo-score': 'seo', accessibility: 'a11y', performance: 'speed', backlinks: 'links', 'tech-stack': 'tech',
  'media-contact': 'contact', 'dark-patterns': 'ux', 'llm-visibility': 'ai'
};
const SH_TOOL_KEYWORDS = {
  typography: 'font fonts typeface text size sizes preview', colors: 'color colour colors palette hex contrast swatch picker wcag',
  tokens: 'spacing margin padding radius shadow z-index css variables tailwind export', assets: 'images logos icons download zip broken',
  inspect: 'element css dom box model selector picker', overlays: 'grid baseline colorblind color-blind dark mode simulate',
  responsive: 'device mobile phone tablet size viewport breakpoint', screenshot: 'capture screenshot annotate full page image pdf'
};
const SH_SEV_RANK = { High: 0, Medium: 1, Low: 2 };
const SH_TOOL_META = {};  // key -> subtitle for tools added by other scripts
const SH_SCREENS = {};   // key -> { title, build(A) }: detail screens drawn from code instead of a stored pane

/* ------------------------------------------------------------------ state */
const SH = {
  tab: 'overview',
  stack: [],            // [{ pane }] — a detail screen on top of the current tab
  catId: 'seo',
  openCheck: null,
  showPass: false,
  scope: false,         // true = main content only (exclude header & footer)
  scanAt: null,
  scanning: false,
  tabId: null,
  host: '',
  url: '',              // exact URL of the scanned page
  stale: false,         // the tab navigated after the last scan
  animate: false,
  scroll: {},
  lastKey: '',
  font: null,           // live font preview label
  searchOpen: false,
  menuOpen: false,
  view: { audit: 'list', tools: 'grid' }   // list or grid, remembered
};

const shEl = (id) => document.getElementById(id);
const shQ = (sel, root) => (root || document).querySelector(sel);
const shQA = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const shEsc = (s) => escapeHtml(s);

function shTier(score) { return score >= 80 ? ['Good', 'ok'] : score >= 50 ? ['Fair', 'warn'] : ['Needs work', 'bad']; }
function shSevClass(sev) { return sev === 'High' ? 'bad' : sev === 'Medium' ? 'warn' : 'info'; }
function shSlug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function shChev() { return `<span class="sh-chev">${shIcon('chevr', 14)}</span>`; }

/* ------------------------------------------------------------------ audit model */
function shNormCheck(catId, c, d) {
  const g = CHECK_GUIDE[c.label] || {};
  const sev = c.sev || (typeof g.sev === 'function' ? g.sev(d) : (g.sev || 'Medium'));
  const line = c.line || (typeof g.line === 'function' ? g.line(d) : (g.line || c.detail || ''));
  return {
    id: `${catId}:${shSlug(c.label)}`, catId, label: c.label, pass: !!c.pass,
    t: c.pass ? c.label : (c.t || g.t || c.label), sev, line,
    mean: c.mean || g.mean || '', fix: c.fix || g.fix || '', tag: g.tag || '',
    section: c.section || g.go || '', actions: (c.actions || []).filter(Boolean),
    fixCode: c.pass ? null : (c.fixCode || fixFor(c.label, d))
  };
}

function shSpeedChecks(d) {
  const v = d.webVitals || {};
  const META = {
    lcp: ['Largest content appears late', 'LCP', 'A good LCP is under 2.5 seconds. Large images, slow servers and blocking scripts can cause a slow one.', 'Compress the hero image, preload it, and defer scripts that are not needed for the first paint.'],
    cls: ['Content shifts while loading', 'CLS', 'Content that jumps around makes people tap the wrong thing.', 'Set width and height on images and reserve space for ads and embeds.'],
    inp: ['Page responds slowly to taps', 'INP', 'Slow responses make the page feel janky after it has loaded.', 'Break up long scripts and avoid heavy work on click handlers.'],
    fcp: ['First content appears late', 'FCP', 'Visitors see a blank screen until the first content paints.', 'Reduce render-blocking CSS and scripts.'],
    ttfb: ['Server responds slowly', 'TTFB', 'The server took a while to send the first byte, which delays everything after it.', 'Add caching or a CDN in front of the page.']
  };
  const out = [];
  ['lcp', 'cls', 'inp', 'fcp', 'ttfb'].forEach(k => {
    if (v[k] == null) return;
    const tier = getCwvTier(k, v[k]);
    const m = META[k];
    const chk = {
      label: `${m[1]} is in the good range`, pass: tier === 'good', t: m[0], sev: tier === 'poor' ? 'High' : 'Medium',
      line: `${m[1]} is ${formatCwvValue(k, v[k])}.`, mean: m[2], fix: m[3], section: 'performance'
    };
    // name the culprit, and offer to point at it on the page
    const ins = d.insights || {};
    const worst = k === 'cls' && ins.shifts && ins.shifts.culprits && ins.shifts.culprits[0];
    if (worst) {
      chk.line += ` Biggest cause: ${worst.label}.`;
      chk.actions = [worst.gone ? null : insShowAction(worst.selector, 'Biggest shift'), insOpenAction('shifts', 'Open layout & LCP')];
    }
    if (k === 'lcp' && ins.lcp && ins.lcp.selector) {
      chk.line += ` The largest element is ${insShort(ins.lcp.label || ins.lcp.tag, 32)}.`;
      chk.actions = [insShowAction(ins.lcp.selector, 'Largest element'), insOpenAction('shifts', 'Open layout & LCP')];
    }
    out.push(chk);
  });
  return out;
}

function shAudit() {
  const d = lastExtractedData;
  if (!d) return null;
  const seo = computeSeoChecklist(d);
  const a11y = computeA11yScore(d);
  const dp = computeDarkPatternChecklist(d);
  const llm = computeLlmVisibilityChecklist(d, lastSiteFilesResult);
  const cons = computeDesignConsistencyScore(d);
  const perf = computePerformanceScore(d);

  const imgChecks = insImageChecks(d), readChecks = insReadabilityChecks(d), freshChecks = insFreshnessChecks(d), schemaChecks = sdChecks(d), linkChecks = lnkChecks(d), secChecks = hdrChecks(d), perfChecks = tpChecks(d).concat(fontChecks(d));
  const designChecks = [
    { label: 'Color palette is compact', pass: cons.colorScore >= 80, line: `${cons.colorCount} distinct colors are in use.` },
    { label: 'Few font families', pass: cons.fontScore >= 80, line: `${cons.fontCount} font families are in use.` },
    { label: 'Spacing follows a consistent scale', pass: cons.spacingScore >= 70, line: 'Many one-off margin and padding values are in use.' }
  ];
  const raw = {
    seo: { score: insBlend(seo.score, readChecks.concat(freshChecks, schemaChecks), 0.15), checks: seo.checks.concat(readChecks, freshChecks, schemaChecks) },
    design: { score: insBlend(cons.overall, conChecks(d).concat(ovfChecks(d)), 0.3), checks: designChecks.concat(conChecks(d), ovfChecks(d)) },
    a11y: { score: insBlend(a11y.score, labChecks(d), 0.25), checks: a11y.checks.concat(labChecks(d)) },
    speed: { score: insBlend(perf ? perf.score : null, imgChecks.concat(fieldChecks(d), perfChecks), 0.4), checks: shSpeedChecks(d).concat(imgChecks, fieldChecks(d), perfChecks) },
    links: { score: null, checks: linkChecks },
    sec: { score: insBlend(null, secChecks, 1), checks: secChecks },
    ai: { score: llm.score, checks: llm.checks },
    ux: { score: dp.score, checks: dp.checks }
  };
  const cats = SH_CATS.map(def => {
    const r = raw[def.id] || { score: null, checks: [] };
    const checks = r.checks.map(c => shNormCheck(def.id, c, d));
    const issues = checks.filter(c => !c.pass).map((c, i) => [c, i]).sort((a, b) => (SH_SEV_RANK[a[0].sev] - SH_SEV_RANK[b[0].sev]) || (a[1] - b[1])).map(x => x[0]);
    return Object.assign({}, def, { score: r.score, checks, issues, passes: checks.filter(c => c.pass) });
  });

  // One ranked list of failing checks across every audit. The same headline can appear in two
  // audits (missing alt text is both SEO and accessibility), so keep only the first.
  const seen = new Set();
  const issues = [];
  cats.forEach((c, ci) => c.issues.forEach((it, ii) => {
    if (seen.has(it.t)) return;
    seen.add(it.t);
    issues.push(Object.assign({ catName: c.name, ci, ii }, it));
  }));
  issues.sort((a, b) => (SH_SEV_RANK[a.sev] - SH_SEV_RANK[b.sev]) || (a.ci - b.ci) || (a.ii - b.ii));

  const scored = cats.filter(c => c.score != null && !c.info);
  const composite = scored.length ? Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length) : null;
  return { cats, issues, composite, cons, data: d };
}
function shCat(A, id) { return A.cats.filter(c => c.id === id)[0]; }

/* ------------------------------------------------------------------ router */
function shSetTab(tab) {
  SH.tab = tab; SH.stack = []; SH.openCheck = null; SH.showPass = false;
  shCloseTransient();
  shRender();
  shSaveState();
}
function shOpenCat(id) { SH.tab = 'audit'; SH.catId = id; SH.stack = []; SH.openCheck = null; SH.showPass = false; shCloseTransient(); shRender(); shSaveState(); }
function shOpenPane(key, tab, catId) {
  if (tab) SH.tab = tab;
  if (catId) SH.catId = catId;
  SH.stack = [{ pane: key }];
  shCloseTransient();
  shRender();
  shSaveState();
}
function shBack() { SH.stack.pop(); shRender(); shSaveState(); }
function shCloseTransient() { shCloseSearch(true); shCloseMenu(); }

// Called by renderers in stylytics.js: failing checklist rows, global search, etc.
function jumpToToolsSection(key) {
  if (['typography', 'colors', 'tokens', 'assets', 'responsive', 'screenshot', 'overlays'].includes(key)) { shOpenPane(key); return; }
  if (key === 'inspect') { const b = shEl('inspect-btn'); if (b) b.click(); return; }
  if (SH_PANE_TO_CAT[key]) { shOpenCat(SH_PANE_TO_CAT[key]); return; }
  if (['meta', 'social', 'structured-data', 'outline'].includes(key)) shOpenPane(key, 'audit', 'seo');
}

/* ------------------------------------------------------------------ rendering: shared bits */
function shSevDot(sev) { return `<span class="sh-dot ${shSevClass(sev)}"></span>`; }

// "what it means / what to change" body shared by the list row and the grid detail card
function shCheckBody(it) {
  const copy = `${it.t}\n${it.line}\nWhat to change: ${it.fix}`;
  return `<div class="sh-chk-body">
      ${it.mean ? `<div><h4>What it means</h4><p>${shEsc(it.mean)}</p></div>` : ''}
      ${it.fix ? `<div><h4>What to change</h4><p>${shEsc(it.fix)}</p></div>` : ''}
      ${it.fixCode
        ? `<div class="fx"><div class="fx-h"><b>${shIcon('check', 12)} Copy-ready fix</b><small>${shEsc(FIX_WHERE[it.fixCode.where] || '')}</small></div><pre class="sh-code fx-code">${shEsc(it.fixCode.code)}</pre>${it.fixCode.note ? `<p class="fx-note">${shEsc(it.fixCode.note)}</p>` : ''}</div>`
        : (it.tag ? `<div class="sh-code">${shEsc(it.tag)}</div>` : '')}
      <div class="sh-btns">
        ${it.fixCode ? `<button class="sh-btn pri sm" data-sh="copy" data-v="${shEsc(it.fixCode.code)}">${shIcon('copy', 13)} Copy fix</button>` : ''}
        <button class="sh-btn${it.fixCode ? '' : ' pri'} sm" data-sh="copy" data-v="${shEsc(copy)}">${shIcon('copy', 13)} Copy guidance</button>
        ${(it.actions || []).map(a => insBtn(a.label, a.op, { sel: a.sel, lbl: a.lbl, screen: a.screen })).join('')}
        ${it.section && it.section.indexOf('ins:') !== 0 ? `<button class="sh-btn sm" data-sh="jump" data-v="${it.section}">See evidence</button>` : ''}
      </div></div>`;
}

function shCheckRow(it) {
  const open = SH.openCheck === it.id;
  return `<div class="sh-chk"><button class="sh-row" data-sh="check" data-v="${it.id}" aria-expanded="${open}">
      ${shSevDot(it.sev)}<span class="sh-tx"><b>${shEsc(it.t)}</b><small>${shEsc(it.line)}</small></span>
      <span class="sh-sev ${shSevClass(it.sev)}">${it.sev}</span><span class="sh-chev">${shIcon(open ? 'chevd' : 'chevr', 14)}</span></button>${open ? shCheckBody(it) : ''}</div>`;
}

function shCheckCard(it) {
  const open = SH.openCheck === it.id;
  return `<button class="sh-gcard${open ? ' on' : ''}" data-sh="check" data-v="${it.id}" aria-pressed="${open}">
      <span class="sh-gcard-top">${shSevDot(it.sev)}<span class="sh-sev ${shSevClass(it.sev)}">${it.sev}</span></span>
      <b>${shEsc(it.t)}</b><small>${shEsc(it.line)}</small></button>`;
}

// list / grid switch, remembered per screen type
function shViewToggle(scope) {
  const cur = SH.view[scope];
  const b = (v, icon, label) => `<button type="button" data-sh="view" data-scope="${scope}" data-v="${v}" aria-pressed="${cur === v}" aria-label="${label}" title="${label}">${shIcon(icon, 13)}</button>`;
  return `<span class="sh-vt" role="group" aria-label="View as">${b('list', 'rows', 'List view')}${b('grid', 'grid', 'Grid view')}</span>`;
}

/* ------------------------------------------------------------------ OVERVIEW */
function shPrimaryFont(d) { const f = (d.fonts || [])[0]; return f ? f.replace(/"/g, "'") : 'inherit'; }
// up to five distinct, non-gray colors from the page (falls back to any colors)
function shBrandColors(d) {
  const seen = new Set(), vivid = [], rest = [];
  [].concat(d.colors || [], d.bgColors || []).forEach(c => {
    if (!c || !c.hex || seen.has(c.hex)) return;
    seen.add(c.hex);
    const hsl = hexToHsl(c.hex);
    (hsl && hsl.s > 18 && hsl.l > 8 && hsl.l < 94 ? vivid : rest).push(c.hex);
  });
  return vivid.concat(rest).slice(0, 6);
}
function shCountUp(el) {
  const target = parseInt(el.dataset.count, 10);
  if (!Number.isFinite(target) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  const start = performance.now(), dur = 700;
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1 && el.isConnected) requestAnimationFrame(tick); else el.textContent = String(target);
  };
  requestAnimationFrame(tick);
}

function shOverview(A) {
  const d = A.data, cons = A.cons;
  const list = A.issues;
  const sc = A.composite;
  const t = sc != null ? shTier(sc) : ['—', 'warn'];
  const anim = SH.animate ? ' sh-anim' : '';

  // the six audit areas: two rows of three
  const cats = A.cats.filter(c => !c.info).map(c => {
    const tt = c.score == null ? ['Not measured', 'none'] : shTier(c.score);
    return `<button class="sh-cat ${tt[1]}" data-sh="cat" data-v="${c.id}" aria-label="${c.name}: ${c.score == null ? 'not measured' : c.score + ', ' + tt[0]}">
        <span class="sh-cat-top"><span class="sh-cat-ic">${shIcon(c.icon, 12)}</span><span class="sh-cat-l">${c.lab}</span></span>
        <span class="sh-cat-v"${c.score == null ? '' : ` data-count="${c.score}"`}>${c.score == null ? '—' : c.score}</span>
        <span class="sh-cat-bar"><i class="${anim.trim()}" style="width:${c.score == null ? 0 : Math.max(c.score, 4)}%"></i></span>
      </button>`;
  }).join('');

  const first = list[0];
  const next = list.slice(1, 4);
  const cnt = { High: 0, Medium: 0, Low: 0 };
  list.forEach(x => { cnt[x.sev]++; });
  const sevChip = (k, cls) => cnt[k] ? `<span class="sh-sevchip"><i class="sh-dot ${cls}"></i>${cnt[k]} ${k}</span>` : '';
  const summary = !list.length
    ? 'Every check passed. <b>Nothing to fix.</b>'
    : `<b>${list.length} issue${list.length === 1 ? '' : 's'}</b><span class="sh-sevs">${sevChip('High', 'bad')}${sevChip('Medium', 'warn')}${sevChip('Low', 'info')}</span>`;

  const nextBtn = first
    ? `<button class="sh-next" data-sh="check" data-v="${first.id}" data-cat="${first.catId}"><span class="sh-next-tx"><span class="sh-next-l">Next best fix</span><span class="sh-next-t">${shEsc(first.t)}</span></span><span class="sh-next-go">${shIcon('arrowr', 15)}</span></button>`
    : `<div class="sh-next sh-next--done"><span class="sh-next-tx"><span class="sh-next-l">All clear</span><span class="sh-next-t">No issues found on this page</span></span><span class="sh-next-go">${shIcon('check', 15)}</span></div>`;

  const qa = [['inspect', 'Pick element', 'target'], ['pick', 'Pick color', 'pipette'], ['screenshot', 'Capture', 'camera'], ['responsive', 'Preview size', 'phone']];
  const upNext = next.length
    ? `<div class="sh-sec"><span>Up next</span><button data-sh="tab" data-v="audit">See all ${list.length}</button></div>
       <div class="sh-card">${next.map(x => `<button class="sh-row" data-sh="check" data-v="${x.id}" data-cat="${x.catId}">${shSevDot(x.sev)}<span class="sh-tx"><b>${shEsc(x.t)}</b><small>${shEsc(x.catName)}</small></span><span class="sh-sev ${shSevClass(x.sev)}">${x.sev}</span>${shChev()}</button>`).join('')}</div>`
    : '';

  return `
    <section class="sh-hero ${t[1]}">
      <div class="sh-hero-top"><span class="sh-eyebrow">Page health</span>
        <button class="sh-scope" data-sh="scope" aria-label="Scan scope: ${SH.scope ? 'main content' : 'whole page'}. Tap to change" title="${SH.scope ? 'Header and footer are left out of the SEO checks' : 'Header and footer are included'}">${shIcon('layers', 12)}${SH.scope ? 'Main content' : 'Whole page'}</button></div>
      <div class="sh-hero-main"><span class="sh-big"${sc == null ? '' : ` data-count="${sc}"`}>${sc == null ? '—' : sc}</span><span class="sh-of">/ 100</span><span class="sh-tchip ${t[1]}">${t[0]}</span></div>
      <p class="sh-hero-sum">${summary}</p>
      <div class="sh-cats">${cats}</div>
      ${nextBtn}
    </section>
    ${insOverviewCard()}
    ${upNext}
    <div class="sh-sec"><span>Quick tools</span></div>
    <div class="sh-qrow">${qa.map(q => `<button class="sh-qt" data-sh="quick" data-v="${q[0]}"><span class="sh-qi">${shIcon(q[2], 18)}</span>${q[1]}</button>`).join('')}</div>
    <div class="sh-sec"><span>Snapshot</span></div>
    <div class="sh-card sh-grow">
      <div class="sh-stats">
        <button data-sh="pane" data-v="typography"><b>${cons.fontCount}</b><small>Fonts</small></button>
        <button data-sh="pane" data-v="colors"><b>${cons.colorCount}</b><small>Colors</small></button>
        <button data-sh="cat" data-v="links"><b>${(d.links || []).length}</b><small>Links</small></button>
        <button data-sh="pane" data-v="assets"><b>${(d.images || []).length}</b><small>Images</small></button>
      </div>
      <button class="sh-style" data-sh="pane" data-v="colors">
        <span class="sh-aa" style="font-family:${shEsc(shPrimaryFont(d))}">Aa</span>
        <span class="sh-style-tx"><b>Page style</b><small>${shEsc(computeSiteVibe(d))}</small>
          <span class="sh-swatches" aria-label="Main colors">${shBrandColors(d).map(c => `<i style="background:${c}"></i>`).join('')}</span></span>
        ${shChev()}
      </button>
    </div>`;
}

/* ------------------------------------------------------------------ AUDIT */
function shRail(A) {
  return `<div class="sh-rail" id="sh-rail" role="tablist" aria-label="Audit categories">${A.cats.map(c => {
    const dot = c.score != null ? `<i class="sh-cdot ${shTier(c.score)[1]}"></i>` : '';
    return `<button class="sh-chip${c.id === SH.catId ? ' on' : ''}" data-sh="rail" data-v="${c.id}" role="tab" aria-selected="${c.id === SH.catId}">${dot}<span>${c.lab || c.short}</span></button>`;
  }).join('')}</div>`;
}

function shAuditView(A) {
  const c = shCat(A, SH.catId) || A.cats[0];
  const grid = SH.view.audit === 'grid';
  let h = shRail(A);

  if (c.score != null || c.id === 'speed') {
    const t = c.score != null ? shTier(c.score) : ['Not measured', 'none'];
    // one tick per check: green for passed, severity color for each issue
    const ticks = c.passes.map(() => '<i class="ok"></i>').concat(c.issues.map(i => `<i class="${shSevClass(i.sev)}"></i>`)).join('');
    h += `<section class="sh-sc ${t[1]}">
        <div class="sh-sc-main"><span class="sh-big sm"${c.score == null ? '' : ` data-count="${c.score}"`}>${c.score == null ? '—' : c.score}</span>
          <div class="sh-sc-tx"><span class="sh-sc-t">${c.name}</span><span class="sh-sc-s"><span class="sh-tchip ${t[1]}">${t[0]}</span>${c.checks.length ? `${c.passes.length} of ${c.checks.length} checks passed` : 'Not measured on this visit yet'}</span></div></div>
        ${ticks ? `<div class="sh-ticks" aria-hidden="true">${ticks}</div>` : ''}
      </section>`;
  } else {
    h += `<div class="sh-chead"><span class="sh-chead-t sh-serif">${c.name}</span><span class="sh-chead-s">${c.blurb}</span></div>`;
  }

  if (c.checks.length) {
    if (c.issues.length) {
      const open = c.issues.filter(i => i.id === SH.openCheck)[0];
      const nFix = fixCount(c.issues);
      h += `<div class="sh-sec"><span>Needs attention <em>${c.issues.length} to fix</em></span>${shViewToggle('audit')}</div>`;
      if (nFix > 1) h += `<button type="button" class="sh-fixall" data-sh="fix" data-v="all" data-cat="${c.id}"><span class="sh-ico a">${shIcon('copy', 15)}</span><span class="sh-tx"><b>Copy all ${nFix} fixes</b><small>One block, grouped by where each piece goes</small></span></button>`;
      if (grid) {
        h += `<div class="sh-ggrid">${c.issues.map(shCheckCard).join('')}</div>`;
        if (open) h += `<div class="sh-card sh-gdetail"><div class="sh-gdetail-h">${shSevDot(open.sev)}<b>${shEsc(open.t)}</b><span class="sh-sev ${shSevClass(open.sev)}">${open.sev}</span></div><p class="sh-gdetail-l">${shEsc(open.line)}</p>${shCheckBody(open)}</div>`;
      } else {
        h += `<div class="sh-card">${c.issues.map(shCheckRow).join('')}</div>`;
      }
    } else {
      h += `<div class="sh-card"><div class="sh-empty"><span class="sh-empty-ic ok">${shIcon('cc', 28)}</span><b>No issues found</b>Every check in this group passed.</div></div>`;
    }
    if (c.passes.length) {
      h += `<div class="sh-card"><button class="sh-row" data-sh="passes" aria-expanded="${SH.showPass}"><span class="sh-dot ok"></span><span class="sh-tx"><b>${c.passes.length} check${c.passes.length === 1 ? '' : 's'} passed</b></span><span class="sh-chev">${shIcon(SH.showPass ? 'chevd' : 'chevr', 14)}</span></button>` +
        (SH.showPass ? c.passes.map(p => `<div class="sh-row sh-row--pass"><span class="sh-ok">${shIcon('check', 15)}</span><span class="sh-tx"><b>${shEsc(p.label)}</b></span></div>`).join('') : '') + '</div>';
    }
  }
  const inlineHtml = c.inline ? `<div class="sh-card sh-pane-card" data-pane-slot="${c.inline}"></div>` : '';
  if (c.inline && !c.explore) h += inlineHtml;
  if (c.explore) {
    h += `<div class="sh-sec"><span>Explore</span>${c.checks.length && c.issues.length ? '' : shViewToggle('audit')}</div>`;
    h += grid
      ? `<div class="sh-ggrid">${c.explore.map(e => `<button class="sh-gcard sh-gtile" data-sh="pane" data-v="${e[0]}" data-cat="${c.id}"><span class="sh-ico">${shIcon(e[3], 16)}</span><b>${e[1]}</b><small>${e[2]}</small></button>`).join('')}</div>`
      : `<div class="sh-card">${c.explore.map(e => `<button class="sh-row" data-sh="pane" data-v="${e[0]}" data-cat="${c.id}"><span class="sh-ico">${shIcon(e[3], 16)}</span><span class="sh-tx"><b>${e[1]}</b><small>${e[2]}</small></span>${shChev()}</button>`).join('')}</div>`;
  }
  if (c.inline && c.explore) h += inlineHtml;
  return h;
}

/* ------------------------------------------------------------------ TOOLS */
function shToolsView(A) {
  const d = A.data;
  const grid = SH.view.tools === 'grid';
  const meta = {
    typography: `${A.cons.fontCount} font${A.cons.fontCount === 1 ? '' : 's'} on this page`,
    colors: `${A.cons.colorCount} colors, contrast`,
    tokens: 'Spacing, radius, export',
    assets: `${(d.images || []).length} image${(d.images || []).length === 1 ? '' : 's'}, download all`,
    inspect: 'Pick any element',
    overlays: 'Grid, color-blind, dark',
    responsive: 'Phones and tablets',
    screenshot: 'Visible area or full page'
  };
  Object.assign(meta, SH_TOOL_META);
  const act = (t) => t[0] === 'inspect' ? 'quick' : 'pane';
  const tile = (t) => `<button class="sh-tile" data-sh="${act(t)}" data-v="${t[0]}"><span class="sh-ico a">${shIcon(t[2], 18)}</span><span class="sh-tile-tx"><b>${t[1]}</b><small>${meta[t[0]]}</small></span></button>`;
  const row = (t) => `<button class="sh-row" data-sh="${act(t)}" data-v="${t[0]}"><span class="sh-ico a">${shIcon(t[2], 16)}</span><span class="sh-tx"><b>${t[1]}</b><small>${meta[t[0]]}</small></span>${shChev()}</button>`;
  const groups = Object.keys(SH_TOOLS).map((g, i) => `<div class="sh-sec"><span>${g}</span>${i === 0 ? shViewToggle('tools') : ''}</div>` +
    (grid ? `<div class="sh-tgrid">${SH_TOOLS[g].map(tile).join('')}</div>` : `<div class="sh-card">${SH_TOOLS[g].map(row).join('')}</div>`)).join('');
  return groups + `<button class="sh-btn block" data-sh="export" data-v="style">${shIcon('download', 16)} Export style guide</button>`;
}

/* ------------------------------------------------------------------ top-level render */
function shScreenKey() {
  const top = SH.stack[SH.stack.length - 1];
  return SH.tab + '|' + (top ? top.pane : '') + '|' + (SH.tab === 'audit' ? SH.catId : '');
}
function shStowPanes() {
  const store = shEl('store');
  shQA('#view .pane').forEach(p => store.appendChild(p));
}
function shMountPanes() {
  shQA('#view [data-pane-slot]').forEach(slot => {
    const p = shEl('pane-' + slot.dataset.paneSlot);
    if (p) slot.appendChild(p);
  });
  const host = shQ('#view [data-pane-host]');
  if (host) { const p = shEl('pane-' + host.dataset.paneHost); if (p) host.appendChild(p); }
}

function shSubbarHtml(A) {
  const top = SH.stack[SH.stack.length - 1];
  if (top) {
    const title = (SH_SCREENS[top.pane] && SH_SCREENS[top.pane].title) || SH_PANE_TITLES[top.pane] || 'Details';
    const parent = SH.tab === 'audit' ? ((SH_CATS.filter(c => c.id === SH.catId)[0] || {}).name || 'Audit') : SH.tab === 'tools' ? 'Tools' : 'Overview';
    return `<div class="sh-sbar"><button class="sh-back" data-sh="back" aria-label="Back to ${shEsc(parent)}"><span class="sh-back-ic">${shIcon('back', 15)}</span><span class="sh-back-tx"><small>Back to ${shEsc(parent)}</small><b>${title}</b></span></button></div>`;
  }
  return '';
}

function shRender() {
  const container = shEl('container');
  const view = shEl('view');
  if (!view) return;
  if (SH.lastKey) SH.scroll[SH.lastKey] = container.scrollTop;
  shStowPanes();

  const top = SH.stack[SH.stack.length - 1];
  const A = lastExtractedData ? shAudit() : null;
  const needsData = !top || !['help', 'settings'].includes(top.pane);

  shEl('subbar').innerHTML = shSubbarHtml(A);

  if (top) {
    view.innerHTML = SH_SCREENS[top.pane] ? (A ? `<div class="ins-screen">${SH_SCREENS[top.pane].build(A)}</div>` : '') : `<div class="sh-pane-wrap" data-pane-host="${top.pane}"></div>`;
  } else if (A) {
    view.innerHTML = SH.tab === 'overview' ? shOverview(A) : SH.tab === 'audit' ? shAuditView(A) : shToolsView(A);
  } else {
    view.innerHTML = '';
  }
  shMountPanes();

  shQA('.bottom-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.bottomTab === SH.tab));
  const dot = shEl('audit-dot');
  if (dot) {
    const n = A ? A.issues.length : 0;
    dot.classList.toggle('hidden', !n);
  }

  const key = shScreenKey();
  const changed = key !== SH.lastKey;
  container.scrollTop = changed ? 0 : (SH.scroll[key] || 0);
  SH.lastKey = key;
  view.classList.remove('sh-enter');
  if (changed || SH.animate) { void view.offsetWidth; view.classList.add('sh-enter'); shQA('[data-count]', view).forEach(shCountUp); }
  SH.animate = false;

  shUpdateContentVisibility(needsData);
  shRenderLive();
}

/* Overview/Audit/Tools need scan data. Help and Settings do not, so they stay reachable while a scan
   is running or has failed. */
function shUpdateContentVisibility(needsData) {
  const loadingEl = shEl('loading');
  const contentEl = shEl('content');
  if (!loadingEl || !contentEl) return;
  const top = SH.stack[SH.stack.length - 1];
  const nd = needsData === undefined ? !(top && ['help', 'settings'].includes(top.pane)) : needsData;
  const showLoading = contentUnavailable && nd;
  loadingEl.classList.toggle('hidden', !showLoading);
  contentEl.classList.toggle('hidden', showLoading);
}
function updateContentVisibility() { shUpdateContentVisibility(); }

/* ---------- error screen (replaces the old "Oops" scene) ---------- */
const SH_ERR_ART = `<svg width="132" height="116" viewBox="0 0 160 140" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="sh-eg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fb923c"/><stop offset="1" stop-color="#ea580c"/></linearGradient>
    <radialGradient id="sh-eglow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fb923c" stop-opacity=".5"/><stop offset="1" stop-color="#fb923c" stop-opacity="0"/></radialGradient>
  </defs>
  <g transform="translate(108 88)"><circle class="error-glow-pulse" r="44" fill="url(#sh-eglow)"/></g>
  <g transform="rotate(-6 60 68)"><g class="error-page-float">
    <rect class="error-page-surface" x="18" y="20" width="84" height="98" rx="12" stroke-width="1.5"/>
    <rect class="error-line-strong" x="32" y="38" width="42" height="5" rx="2.5"/>
    <rect class="error-line" x="32" y="50" width="52" height="5" rx="2.5"/>
    <rect x="32" y="62" width="30" height="5" rx="2.5" fill="url(#sh-eg)" opacity=".85"/>
    <rect class="error-line" x="32" y="74" width="46" height="5" rx="2.5"/>
    <rect class="error-line" x="32" y="86" width="36" height="5" rx="2.5"/>
  </g></g>
  <g transform="translate(108 88)"><g class="error-shield">
    <circle class="error-shield-backing" r="32"/>
    <path d="M0 -24 L20 -16 V6 C20 18 10 25 0 28 C-10 25 -20 18 -20 6 V-16 Z" fill="url(#sh-eg)" stroke="rgba(255,255,255,.25)" stroke-width="1.2"/>
    <path d="M-7 -3 V-8 a7 7 0 0 1 14 0 V-3" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="-9" y="-3" width="18" height="15" rx="3.5" fill="#fff"/>
  </g></g>
</svg>`;

const SH_ERRORS = {
  notab: {
    tag: 'No active tab', title: 'Nothing to scan yet',
    text: 'Open a website in this window, then scan it.',
    tips: [['globe', 'Switch to a tab that shows a website'], ['refresh', 'Press the orange button to scan it']]
  },
  restricted: {
    tag: 'Protected page', title: 'This page can’t be scanned',
    text: 'Browsers don’t let extensions read their own pages, other extensions or the web store.',
    tips: [['check', 'Works on regular http and https websites'], ['x', 'Not on chrome://, edge://, extension pages or the web store']]
  },
  failed: {
    tag: 'Scan interrupted', title: 'Couldn’t read this page',
    text: 'The page blocked access or changed while it was being scanned.',
    tips: [['refresh', 'Reload the page, wait for it to finish, then try again'], ['file', 'For a local file, allow “Access to file URLs” in the extension’s settings'], ['x', 'The web store and built-in PDF viewer always block extensions']]
  }
};

function shErrorKind(message, title) {
  if (title === 'No Active Tab') return 'notab';
  if (/internal|restricted\)/i.test(message || '')) return 'restricted';
  return 'failed';
}

function showError(message, title) {
  const kind = shErrorKind(message, title);
  const info = SH_ERRORS[kind];
  document.body.classList.add('error-state');
  contentUnavailable = true;
  const el = shEl('loading');
  if (el) {
    el.innerHTML = `<div class="sh-err">
      <div class="sh-err-art">${SH_ERR_ART}</div>
      <span class="sh-err-tag">${shIcon('alert', 12)} ${info.tag}</span>
      <h2 class="sh-err-title">${info.title}</h2>
      <p class="sh-err-text">${info.text}</p>
      <div class="sh-err-actions">
        <button type="button" class="sh-btn cta" data-sh="retry">${shIcon('refresh', 14)} Try again</button>
        <button type="button" class="sh-btn" data-sh="pane" data-v="help">${shIcon('help', 14)} Help</button>
      </div>
      <ul class="sh-err-tips">${info.tips.map(t => `<li class="${t[0] === 'x' ? 'no' : t[0] === 'check' ? 'yes' : ''}"><span>${shIcon(t[0], 14)}</span>${t[1]}</li>`).join('')}</ul>
      ${kind === 'failed' && message ? `<p class="sh-err-detail">${shEsc(message)}</p>` : ''}
    </div>`;
  }
  // show the tab that failed, not the last page that scanned
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs && tabs[0];
      if (!t || !t.url) return;
      const p = shSplitUrl(t.url);
      SH.host = p.host || (kind === 'restricted' ? 'Browser page' : ''); SH.path = p.path; SH.url = t.url;
      shUpdateSiteStatus();
    });
  } catch (e) { /* header keeps its previous text */ }
  updateContentVisibility();
  shUpdateSiteStatus();
}

function getSkeletonLoadingHtml() {
  return `<div class="sh-skel">
    <div class="sh-skel-hero"><i></i><i></i><i></i></div>
    <div class="sh-skel-card"><i></i><i></i><i></i></div>
    <div class="sh-skel-grid"><i></i><i></i><i></i><i></i></div>
  </div>`;
}

/* ------------------------------------------------------------------ live page preview strip */
function shLiveItems() {
  const items = [];
  if (SH.font) items.push(`Font: ${SH.font}`);
  if (typeof activePaletteKey !== 'undefined' && activePaletteKey) items.push(`${activePaletteKey[0].toUpperCase()}${activePaletteKey.slice(1)} palette`);
  if (typeof colorblindMode !== 'undefined' && colorblindMode !== 'normal') items.push(`${colorblindMode[0].toUpperCase()}${colorblindMode.slice(1)}`);
  const dark = shEl('dark-mode-preview-toggle');
  if (dark && dark.checked) items.push('Dark mode');
  const grid = shQ('#grid-overlay-toggle .tag.active');
  if (grid && grid.dataset.mode !== 'none') items.push(grid.dataset.mode === 'baseline' ? 'Baseline grid' : 'Spacing grid');
  return items.concat(typeof labLiveItems === 'function' ? labLiveItems() : []);
}
function shRenderLive() {
  const strip = shEl('live-strip');
  if (!strip) return;
  const items = shLiveItems();
  strip.classList.toggle('hidden', !items.length);
  if (!items.length) { strip.innerHTML = ''; return; }
  strip.innerHTML = `<span class="sh-live-dot"></span><span class="sh-live-t">Previewing on page: ${shEsc(items.join(', '))}</span><button type="button" id="sh-live-reset">Reset all</button>`;
}
function shResetLive(silent) {
  const id = lastActiveTabId;
  if (id) {
    ['reset-preview', 'reset-palette-preview'].forEach(action => chrome.tabs.sendMessage(id, { action }, () => void chrome.runtime.lastError));
    chrome.tabs.sendMessage(id, { action: 'simulate-colorblind', mode: 'normal' }, () => void chrome.runtime.lastError);
    chrome.tabs.sendMessage(id, { action: 'toggle-dark-mode-preview', enabled: false }, () => void chrome.runtime.lastError);
    chrome.tabs.sendMessage(id, { action: 'toggle-grid-overlay', mode: 'none', size: 8 }, () => void chrome.runtime.lastError);
  }
  if (typeof labResetPage === 'function') labResetPage();
  SH.font = null;
  activePaletteKey = null;
  colorblindMode = 'normal';
  const dark = shEl('dark-mode-preview-toggle'); if (dark) dark.checked = false;
  shQA('#grid-overlay-toggle .tag').forEach(b => b.classList.toggle('active', b.dataset.mode === 'none'));
  const row = shEl('grid-overlay-size-row'); if (row) row.classList.add('hidden');
  shQA('#colorblind-toggle .tag').forEach(b => b.classList.toggle('active', b.dataset.mode === 'normal'));
  if (lastExtractedData) {
    renderAllColorGrids(lastExtractedData, lastActiveTabId);
    renderColorPaletteGenerator(lastExtractedData, lastActiveTabId);
  }
  shRenderLive();
  if (!silent) showToast('Page restored');
}
function shWireLive() {
  // The preview controls keep their original handlers; this only mirrors their state into the strip.
  const refresh = debounce(shRenderLive, 380);
  document.addEventListener('click', (e) => {
    const apply = e.target.closest('#theme-preview-font-apply-btn');
    if (apply) {
      const typed = (shEl('theme-preview-font-target') || {}).value;
      if (typed && typed.trim()) SH.font = typed.trim();
    }
    if (e.target.closest('#theme-preview-font-reset-btn')) SH.font = null;
    if (e.target.closest('#view') || e.target.closest('#store')) refresh();
    if (e.target.id === 'sh-live-reset') shResetLive();
  });
  document.addEventListener('change', (e) => { if (e.target.closest('#view')) refresh(); });
}

/* ------------------------------------------------------------------ header, menu, status */
function shTimeAgo() {
  if (!SH.scanAt) return '';
  const s = Math.floor((Date.now() - SH.scanAt) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
// "naction.in" in bold, "/neelam-kothari/" lighter; the full URL is in the tooltip and the copy button
function shSplitUrl(url) {
  try {
    const u = new URL(url);
    const path = (u.pathname === '/' ? '' : u.pathname) + u.search;
    return { host: u.hostname.replace(/^www\./, ''), path: path };
  } catch (e) { return { host: '', path: '' }; }
}
function shUpdateSiteStatus() {
  const host = shEl('site-host'), path = shEl('site-path'), status = shEl('site-status'), pill = shEl('site-pill');
  if (!host) return;
  const failed = document.body.classList.contains('error-state');
  host.textContent = SH.host || (SH.scanning ? 'Scanning…' : 'No page');
  if (path) path.textContent = SH.scanning ? '' : (SH.path || '');
  if (status) status.textContent = SH.scanning ? 'Scanning…' : (failed ? 'Can’t scan' : (SH.stale ? 'Page changed' : ''));
  if (pill) {
    pill.classList.toggle('busy', SH.scanning);
    pill.classList.toggle('error', failed && !SH.scanning);
    pill.title = (SH.url ? SH.url + '\n' : '') + (SH.scanning ? 'Scanning…' : (SH.scanAt && !failed ? 'Scanned ' + shTimeAgo() : ''));
  }
}
function setScanning(isScanning) {
  SH.scanning = isScanning;
  if (!isScanning && !document.body.classList.contains('error-state')) { SH.scanAt = Date.now(); SH.stale = false; }
  const btn = shEl('refresh-btn');
  if (btn) { btn.disabled = isScanning; btn.classList.toggle('spinning', isScanning); }
  shUpdateSiteStatus();
}
function setSectionCount() { /* counts are computed from scan data when each screen renders */ }
function refreshDashboardBreakdown() { /* the Overview recomputes from scan data on render */ }
function renderVibeStrip() { }

function shMenuHtml() {
  const item = (act, icon, label, v) => `<button type="button" role="menuitem" data-sh="${act}"${v ? ` data-v="${v}"` : ''}>${shIcon(icon, 16)}<span>${label}</span></button>`;
  return item('pane', 'book', 'Help & glossary', 'help') + item('pane', 'gear', 'Settings', 'settings') + '<hr>' +
    item('export', 'file', 'Export page report', 'seo') + item('export', 'palette', 'Export style guide', 'style') + item('export', 'chip', 'Export tech stack (JSON)', 'tech');
}
function shToggleMenu() {
  SH.menuOpen = !SH.menuOpen;
  const m = shEl('more-menu');
  m.innerHTML = SH.menuOpen ? shMenuHtml() : '';
  m.classList.toggle('hidden', !SH.menuOpen);
  shEl('more-btn').setAttribute('aria-expanded', String(SH.menuOpen));
}
function shCloseMenu() {
  if (!SH.menuOpen) return;
  SH.menuOpen = false;
  const m = shEl('more-menu'); if (m) { m.classList.add('hidden'); m.innerHTML = ''; }
  const b = shEl('more-btn'); if (b) b.setAttribute('aria-expanded', 'false');
}
function shExport(kind) {
  const id = kind === 'seo' ? 'export-seo-report-btn' : kind === 'style' ? 'export-style-guide-btn' : 'export-tech-stack-btn';
  const b = shEl(id);
  if (b) b.click();
}

/* ------------------------------------------------------------------ search */
function shSearchItems(A) {
  const items = [];
  if (A) A.issues.forEach(x => items.push({ k: 'Issue', t: x.t, s: `${x.catName} · ${x.line}`, i: 'alert', act: 'check', v: x.id, cat: x.catId, w: `${x.t} ${x.line} ${x.catName} ${x.mean}` }));
  SH_CATS.forEach(c => items.push({ k: 'Audit', t: c.name, s: c.blurb, i: c.icon, act: 'cat', v: c.id, w: `${c.name} ${c.blurb}` }));
  Object.keys(SH_TOOLS).forEach(g => SH_TOOLS[g].forEach(t => items.push({ k: 'Tool', t: t[1], s: g === 'Design' ? 'Design tool' : 'Page tool', i: t[2], act: t[0] === 'inspect' ? 'quick' : 'pane', v: t[0], w: `${t[1]} ${g} ${SH_TOOL_KEYWORDS[t[0]] || ''}` })));
  items.push({ k: 'Help', t: 'Help & glossary', s: 'Guides and plain-language terms', i: 'book', act: 'pane', v: 'help', w: 'help glossary guide terms tips how to' });
  items.push({ k: 'Settings', t: 'Settings', s: 'Appearance, scanning, exports', i: 'gear', act: 'pane', v: 'settings', w: 'settings theme dark light appearance scan' });
  return items;
}
function shSearchRow(r) {
  return `<button class="sh-row" data-sh="sres" data-act="${r.act}" data-v="${shEsc(r.v)}" data-cat="${r.cat || ''}" ${r.hlType ? `data-hl-type="${shEsc(r.hlType)}" data-hl-val="${shEsc(r.hlVal)}"` : ''}><span class="sh-ico">${shIcon(r.i, 16)}</span><span class="sh-tx"><b>${shEsc(r.t)}</b><small>${shEsc(r.s)}</small></span><span class="sh-kind">${r.k}</span></button>`;
}
function shSearchGroup(title, rows) {
  return rows.length ? `<div class="sh-gh">${title}</div><div class="sh-card">${rows.map(shSearchRow).join('')}</div>` : '';
}
function shRenderSearchResults(query) {
  const el = shEl('search-results');
  const q = (query || '').trim().toLowerCase();
  const A = lastExtractedData ? shAudit() : null;
  const items = shSearchItems(A);
  if (!q) {
    el.innerHTML = shSearchGroup('Fix first', items.filter(i => i.k === 'Issue').slice(0, 3)) +
      shSearchGroup('Jump to', items.filter(i => i.k === 'Tool').slice(0, 4).concat(items.filter(i => i.k === 'Audit').slice(0, 2))) +
      shSearchGroup('More', items.filter(i => i.k === 'Help' || i.k === 'Settings'));
    return;
  }
  const hit = (r) => r.w.toLowerCase().includes(q) || r.t.toLowerCase().includes(q);
  const found = items.filter(hit);
  const page = (typeof searchIndex !== 'undefined' ? searchIndex : []).filter(it => it.value.toLowerCase().includes(q) || it.sectionLabel.toLowerCase().includes(q)).slice(0, 8)
    .map(it => ({ k: 'On page', t: it.value, s: it.sectionLabel, i: 'target', act: 'jump', v: it.section, hlType: it.highlightType, hlVal: it.highlightValue }));
  const html = shSearchGroup('Issues', found.filter(r => r.k === 'Issue').slice(0, 4)) + shSearchGroup('Audit', found.filter(r => r.k === 'Audit').slice(0, 4)) +
    shSearchGroup('Tools', found.filter(r => r.k === 'Tool').slice(0, 4)) + shSearchGroup('On this page', page) + shSearchGroup('Help', found.filter(r => r.k === 'Help' || r.k === 'Settings').slice(0, 3));
  el.innerHTML = html || `<div class="sh-empty"><b>No results for "${shEsc(query.trim())}"</b>Try "font", "alt text", "contrast" or "LCP".</div>`;
}
function shOpenSearch() {
  shCloseMenu();
  SH.searchOpen = true;
  shEl('search-overlay').classList.remove('hidden');
  const input = shEl('search-input');
  input.value = '';
  shRenderSearchResults('');
  input.focus();
}
function shCloseSearch(keepFocus) {
  if (!SH.searchOpen) return;
  SH.searchOpen = false;
  shEl('search-overlay').classList.add('hidden');
}

/* ------------------------------------------------------------------ settings (applied instantly) */
const SH_SETTINGS_DEFAULTS = { version: 1, restoreLastSession: true, assetLayout: 'grid', maxItemsPerGrid: 48 };
function getDefaultSettings() { return Object.assign({}, SH_SETTINGS_DEFAULTS); }
function loadSettings(callback) {
  chrome.storage.local.get([SETTINGS_STORAGE_KEY], (res) => {
    const s = res[SETTINGS_STORAGE_KEY] || {};
    currentSettings = {
      version: SETTINGS_VERSION,
      restoreLastSession: s.restoreLastSession !== false,
      assetLayout: s.assetLayout === 'list' ? 'list' : 'grid',
      maxItemsPerGrid: s.maxItemsPerGrid ? Math.min(s.maxItemsPerGrid, MAX_ITEMS_PER_GRID_LIMIT) : DEFAULT_MAX_ITEMS_PER_GRID
    };
    callback(currentSettings);
  });
}
function saveSettingsToStorage(settings, callback) { chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings }, callback); }

function shApplyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
}
function shSetTheme(theme) {
  shApplyTheme(theme);
  chrome.storage.local.set({ themeOverride: theme });
  shQA('#theme-choice-toggle .tag').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === theme));
}
function shSetScope(on, silent) {
  SH.scope = on;
  chrome.storage.local.set({ excludeHeaderFooterAudit: on }, () => {
    if (!silent) showToast(on ? 'Scanning main content only' : 'Scanning the whole page');
    const t = shEl('settings-scope-toggle'); if (t) t.checked = on;
    shRender();
    const refreshBtn = shEl('refresh-btn'); if (refreshBtn) refreshBtn.click();
  });
}

function shBuildSettingsPane() {
  const pane = shEl('pane-settings');
  if (!pane) return;
  const row = (icon, title, desc, control) => `<div class="sh-trow"><span class="sh-ico">${shIcon(icon, 16)}</span><div class="sh-tx"><b>${title}</b><small>${desc}</small></div>${control}</div>`;
  const sw = (id) => `<label class="switch"><input type="checkbox" id="${id}"><span class="switch-track"></span></label>`;
  const link = (act, v, icon, title, desc) => `<button class="sh-row" data-sh="${act}" data-v="${v}"><span class="sh-ico">${shIcon(icon, 16)}</span><span class="sh-tx"><b>${title}</b><small>${desc}</small></span>${shChev()}</button>`;
  const version = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
  pane.innerHTML = `
    <div class="sh-sec"><span>Appearance</span></div>
    <div class="segmented" id="theme-choice-toggle">
      <button class="tag" data-theme-choice="system">System</button>
      <button class="tag" data-theme-choice="light">Light</button>
      <button class="tag" data-theme-choice="dark">Dark</button>
    </div>
    <div class="sh-sec"><span>Scanning</span></div>
    <div class="sh-card">
      ${row('layers', 'Main content only', 'Leave the header and footer out of the SEO checks.', sw('settings-scope-toggle'))}
      ${row('book', 'Remember where I left off', 'Reopen the last tab and screen for each page.', sw('settings-restore-session-toggle'))}
      ${row('refresh', 'Track changes between scans', 'Keep a compact copy of each scan on this device to show what changed.', sw('settings-track-toggle'))}
      ${row('shield', 'Read server headers', 'After each scan, request the page once more and the stylesheets that declare its fonts, to check security, caching, compression and fonts. Only headers and stylesheet text are read.', sw('settings-hdr-toggle'))}
    </div>
    <div class="sh-sec"><span>Assets</span></div>
    <div class="sh-card">
      ${row('image', 'List view for assets', 'Show images and logos as a list instead of a grid.', sw('settings-asset-list-toggle'))}
      ${row('grid', 'Items shown per grid', 'Caps colors, images and links before truncating.', '<input type="number" id="settings-max-items" class="search-input sh-num" min="8" max="200" step="4">')}
    </div>
    ${fieldSettingsHtml()}
    <div class="sh-sec"><span>Saved scans</span></div>
    <div class="sh-card">
      <button class="sh-row" data-sh="ins" data-v="forget-all"><span class="sh-ico">${shIcon('x', 16)}</span><span class="sh-tx"><b>Clear all saved scans</b><small>Removes the history kept for every page.</small></span>${shChev()}</button>
    </div>
    <div class="sh-sec"><span>Exports</span></div>
    <div class="sh-card">
      ${link('export', 'seo', 'download', 'Export page report', 'Scores, action plan and evidence as an HTML file.')}
      ${link('export', 'style', 'palette', 'Export style guide', 'Fonts, colors and spacing for handoff.')}
      ${link('export', 'tech', 'chip', 'Export tech stack', 'Detected technologies as a JSON file.')}
    </div>
    <div class="sh-sec"><span>Support</span></div>
    <div class="sh-card">
      ${link('pane', 'help', 'help', 'Help & glossary', 'Guides and plain-language terms.')}
      <div class="sh-row"><span class="sh-ico">${shIcon('info', 16)}</span><span class="sh-tx"><b>About Stylytics</b><small>Version ${shEsc(version)}</small></span></div>
    </div>
    <p class="sh-fine">Changes apply immediately. <button type="button" class="sh-linkbtn" id="settings-reset-btn">Reset to defaults</button></p>`;

  shQA('#theme-choice-toggle .tag').forEach(b => b.addEventListener('click', () => shSetTheme(b.dataset.themeChoice)));
  fieldWireSettings();

  const restore = shEl('settings-restore-session-toggle');
  const assets = shEl('settings-asset-list-toggle');
  const max = shEl('settings-max-items');
  const scope = shEl('settings-scope-toggle');
  const track = shEl('settings-track-toggle');
  const hdr = shEl('settings-hdr-toggle');
  const sync = () => {
    chrome.storage.local.get(['ins_track', 'hdr_auto'], (r) => { track.checked = r.ins_track !== false; hdr.checked = r.hdr_auto !== false; });
    restore.checked = currentSettings.restoreLastSession !== false;
    assets.checked = currentSettings.assetLayout === 'list';
    max.value = currentSettings.maxItemsPerGrid;
    scope.checked = SH.scope;
  };
  const save = (patch, rerender) => {
    currentSettings = Object.assign({}, currentSettings, patch);
    saveSettingsToStorage(currentSettings, () => { if (rerender && lastExtractedData) renderData(lastExtractedData, lastActiveTabId); });
  };
  restore.addEventListener('change', () => save({ restoreLastSession: restore.checked }));
  assets.addEventListener('change', () => save({ assetLayout: assets.checked ? 'list' : 'grid' }, true));
  max.addEventListener('change', () => {
    const n = parseInt(max.value, 10);
    const v = Number.isFinite(n) && n > 0 ? Math.min(n, MAX_ITEMS_PER_GRID_LIMIT) : DEFAULT_MAX_ITEMS_PER_GRID;
    max.value = v;
    save({ maxItemsPerGrid: v }, true);
  });
  scope.addEventListener('change', () => shSetScope(scope.checked));
  hdr.addEventListener('change', () => {
    chrome.storage.local.set({ hdr_auto: hdr.checked });
    showToast(hdr.checked ? 'Server headers are read after each scan' : 'Server headers are no longer read automatically');
    if (hdr.checked && SH.url) { if (HDR.phase === 'off') hdrLoad(SH.url); if (FNT.phase === 'off') fntLoad(SH.url); }
  });
  track.addEventListener('change', () => { INS.track = track.checked; chrome.storage.local.set({ ins_track: track.checked }); showToast(track.checked ? 'Tracking changes between scans' : 'Change tracking is off'); });
  shEl('settings-reset-btn').addEventListener('click', () => {
    currentSettings = getDefaultSettings();
    saveSettingsToStorage(currentSettings, () => { sync(); showToast('Settings reset to defaults'); if (lastExtractedData) renderData(lastExtractedData, lastActiveTabId); });
  });
  pane._sync = sync;
  sync();
  chrome.storage.local.get(['themeOverride'], (res) => {
    const theme = res.themeOverride || 'light';
    shQA('#theme-choice-toggle .tag').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === theme));
  });
}

/* ------------------------------------------------------------------ per-tab state */
function shSaveState() {
  if (!lastActiveTabId || !chrome.storage.session) return;
  const top = SH.stack[SH.stack.length - 1];
  chrome.storage.session.set({ [`sh_state_${lastActiveTabId}`]: { tab: SH.tab, catId: SH.catId, pane: top ? top.pane : null } });
}
function shAfterScan(tabId, url) {
  const changedTab = SH.tabId !== tabId;
  SH.tabId = tabId;
  const parts = shSplitUrl(url);
  SH.host = parts.host;
  SH.path = parts.path;
  SH.url = url || '';
  SH.stale = false;
  SH.animate = true;
  shResetLive(true);
  shUpdateSiteStatus();
  const finish = () => { shRender(); };
  labReset();
  lnkReset();
  ovfReset();
  tpReset();
  fntStart(url);
  hdrStart(url);
  fieldLoad(url);
  siteOnScan(url);
  cmpOnScan(url);
  annOnScan(url, lastExtractedData && lastExtractedData.meta && lastExtractedData.meta.title);
  insOnScan(url);
  conLoad(url);
  if (!changedTab) { finish(); return; }
  const restoreOn = !currentSettings || currentSettings.restoreLastSession !== false;
  const defaults = () => { SH.tab = 'overview'; SH.stack = []; SH.openCheck = null; SH.showPass = false; };
  if (!restoreOn || !chrome.storage.session) { defaults(); finish(); return; }
  chrome.storage.session.get([`sh_state_${tabId}`], (res) => {
    const s = res[`sh_state_${tabId}`];
    defaults();
    if (s) {
      SH.tab = ['overview', 'audit', 'tools'].includes(s.tab) ? s.tab : 'overview';
      if (SH_CATS.some(c => c.id === s.catId)) SH.catId = s.catId;
      if (s.pane && (shEl('pane-' + s.pane) || SH_SCREENS[s.pane]) && !['help', 'settings'].includes(s.pane)) SH.stack = [{ pane: s.pane }];
    }
    finish();
  });
}
// Called when the async robots.txt check finishes, which can change the AI readiness score.
function renderDashboard(data, siteFilesResult, isUpdate) {
  if (!lastExtractedData) return;
  const ae = document.activeElement;
  const typing = ae && ae.closest && ae.closest('#view') && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName);
  if (typing) return;
  shRender();
}

/* ------------------------------------------------------------------ events */
function shHandle(act, v, el) {
  switch (act) {
    case 'tab': shSetTab(v); break;
    case 'cat': shOpenCat(v); break;
    case 'rail': SH.catId = v; SH.openCheck = null; SH.showPass = false; shRender(); shSaveState(); break;
    case 'check': {
      const catId = el.dataset.cat || (v.split(':')[0]);
      if (SH.tab !== 'audit' || SH.catId !== catId || SH.stack.length) { SH.tab = 'audit'; SH.catId = catId; SH.stack = []; SH.showPass = false; SH.openCheck = v; }
      else SH.openCheck = SH.openCheck === v ? null : v;
      shCloseTransient();
      shRender();
      if (SH.openCheck) { const row = shQ(`[data-sh="check"][data-v="${v}"]`); if (row) row.scrollIntoView({ block: 'center' }); }
      shSaveState();
      break;
    }
    case 'passes': SH.showPass = !SH.showPass; shRender(); break;
    case 'view':
      if (el.dataset.scope && (v === 'list' || v === 'grid')) {
        SH.view[el.dataset.scope] = v;
        chrome.storage.local.set({ sh_view: SH.view });
        shRender();
      }
      break;
    case 'pane':
      // Detail screens open over whichever tab you are on, so Back always returns there.
      // Rows inside an Audit category pass data-cat so that category stays selected.
      if (el.dataset.cat) shOpenPane(v, 'audit', el.dataset.cat);
      else shOpenPane(v);
      break;
    case 'jump': jumpToToolsSection(v); break;
    case 'back': shBack(); break;
    case 'ins': insHandle(v, el); break;
    case 'con': conHandle(v, el); break;
    case 'lab': labHandle(v, el); break;
    case 'fld': fldHandle(v, el); break;
    case 'site': siteHandle(v, el); break;
    case 'ann': annHandle(v, el); break;
    case 'sd': sdHandle(v, el); break;
    case 'lnk': lnkHandle(v, el); break;
    case 'hdr': hdrHandle(v, el); break;
    case 'ovf': ovfHandle(v, el); break;
    case 'cmp': cmpHandle(v, el); break;
    case 'tp': tpHandle(v, el); break;
    case 'fnt': fntHandle(v, el); break;
    case 'fix': {
      const A = shAudit();
      const cat = A && shCat(A, el.dataset.cat);
      const text = cat ? fixBundle(cat.issues, SH.host) : '';
      if (text) copyToClipboard(text, `${fixCount(cat.issues)} fixes copied`); else showToast('No ready-made fixes here');
      break;
    }
    case 'retry': { const b = shEl('refresh-btn'); if (b && !b.disabled) b.click(); break; }
    case 'scope': shSetScope(!SH.scope); break;
    case 'quick':
      if (v === 'pick') { const b = shEl('color-picker-btn'); if (b) b.click(); }
      else if (v === 'inspect') { const b = shEl('inspect-btn'); if (b) b.click(); }
      else shOpenPane(v);
      break;
    case 'copy': {
      copyToClipboard(v, 'Copied');
      if (el && el.tagName === 'BUTTON' && el.classList.contains('sh-btn')) {
        const old = el.innerHTML;
        el.innerHTML = `${shIcon('check', 13)} Copied`;
        setTimeout(() => { if (el.isConnected) el.innerHTML = old; }, 1300);
      }
      break;
    }
    case 'export': shCloseMenu(); shExport(v); break;
    case 'sres': {
      const act2 = el.dataset.act;
      shCloseSearch();
      if (act2 === 'jump') {
        jumpToToolsSection(v);
        if (el.dataset.hlType && lastActiveTabId) sendHighlightMessage(lastActiveTabId, el.dataset.hlType, el.dataset.hlVal);
      } else if (act2 === 'check') shHandle('check', v, { dataset: { cat: el.dataset.cat } });
      else shHandle(act2, v, { dataset: { cat: el.dataset.cat } });
      break;
    }
  }
}

function shInit() {
  loadSettings((s) => { currentSettings = s; shBuildSettingsPane(); });
  chrome.storage.local.get(['sh_view'], (res) => {
    const v = res.sh_view || {};
    if (v.audit === 'grid' || v.audit === 'list') SH.view.audit = v.audit;
    if (v.tools === 'grid' || v.tools === 'list') SH.view.tools = v.tools;
    if (lastExtractedData) shRender();
  });
  chrome.storage.local.get(['themeOverride', 'excludeHeaderFooterAudit'], (res) => {
    shApplyTheme(res.themeOverride || 'light');
    SH.scope = !!res.excludeHeaderFooterAudit;
    const p = shEl('pane-settings'); if (p && p._sync) p._sync();
    if (lastExtractedData) shRender();
  });
  const loadingEl = shEl('loading');
  if (!loadingEl.innerHTML.trim()) loadingEl.innerHTML = getSkeletonLoadingHtml();

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('.bottom-nav-btn');
    if (nav) { shSetTab(nav.dataset.bottomTab); return; }
    const el = e.target.closest('[data-sh]');
    if (el) { shHandle(el.dataset.sh, el.dataset.v, el); return; }
    if (e.target.closest('#search-open-btn')) { shOpenSearch(); return; }
    if (e.target.closest('#search-close-btn')) { shCloseSearch(); return; }
    if (e.target.closest('#more-btn')) { shToggleMenu(); return; }
    if (SH.menuOpen && !e.target.closest('#more-menu')) shCloseMenu();
  });
  const input = shEl('search-input');
  input.addEventListener('input', debounce((e) => shRenderSearchResults(e.target.value), 90));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = shQ('#search-results [data-sh="sres"]'); if (first) first.click(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (SH.searchOpen) { shCloseSearch(); return; }
      if (SH.menuOpen) { shCloseMenu(); return; }
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName) || (document.activeElement && document.activeElement.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); shOpenSearch(); return; }
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); shOpenSearch(); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !typing) {
      const tab = { '1': 'overview', '2': 'audit', '3': 'tools' }[e.key];
      if (tab) { e.preventDefault(); shSetTab(tab); }
    }
  });
  const copyUrl = shEl('site-copy-btn');
  if (copyUrl) copyUrl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (SH.url) copyToClipboard(SH.url, 'Page URL copied');
  });
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (!info.url || tabId !== SH.tabId || info.url === SH.url) return;
      const p = shSplitUrl(info.url);
      SH.host = p.host; SH.path = p.path; SH.url = info.url;
      SH.stale = true;
      shUpdateSiteStatus();
    });
  }
  shWireLive();
  setInterval(shUpdateSiteStatus, 20000);
  shUpdateSiteStatus();
}
document.addEventListener('DOMContentLoaded', shInit);

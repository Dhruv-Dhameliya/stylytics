/* fonts-opt.js — font optimizer.
 *
 * content_insights.js reports the @font-face rules it can read, which families, weights and styles the
 * visible text uses, and how a stock fallback font measures against each web font. Stylesheets from other
 * sites (Google Fonts, Adobe Fonts) cannot be read from the page, so the panel fetches and parses them
 * here (it has host permission for every site).
 *
 * The analysis joins three things: what is declared, what is downloaded (resource timing), and what the
 * text actually uses. That finds fonts that are downloaded but never used, text that stays invisible while
 * a font loads, fonts discovered late, old file formats, and the layout jump when a web font swaps in.
 */

const FNT = { url: '', sheets: {}, sizes: {}, tried: {}, phase: 'idle', runId: 0 };
const FNT_ICON = /icon|awesome|material|glyph|symbol|dashicons|feather|ionicons|fontello|entypo|linearicons|\bfa[-_ ]|bootstrap-icons/i;

// after each scan: fetch the font stylesheets unless the person turned automatic reads off in Settings
function fntStart(url) {
  chrome.storage.local.get(['hdr_auto'], (r) => {
    const d = lastExtractedData;
    const need = d && d.insights && d.insights.fonts && d.insights.fonts.unreadable && d.insights.fonts.unreadable.length;
    if (r.hdr_auto === false && need) { fntReset(); FNT.url = url; FNT.phase = 'off'; shRerenderIfIdle(); }
    else fntLoad(url);
  });
}

function fntReset() { FNT.runId++; Object.assign(FNT, { url: '', sheets: {}, sizes: {}, tried: {}, phase: 'idle' }); }

/* ------------------------------------------------------------------ cross-origin stylesheets */
function fntParseCss(text, base) {
  const faces = [];
  const clean = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = clean.match(/@font-face\s*\{[^}]*\}/g) || [];
  blocks.forEach(b => {
    const get = (p) => { const m = b.match(new RegExp('[{;]\\s*' + p + '\\s*:\\s*([^;}]+)', 'i')); return m ? m[1].trim() : ''; };
    const src = [];
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)\s*(?:format\(\s*(['"]?)([^'")]+)\3\s*\))?/g;
    let m;
    while ((m = re.exec(b)) && src.length < 6) {
      if (/^data:/.test(m[2])) { src.push({ u: 'data:', f: m[4] || '' }); continue; }
      try { src.push({ u: new URL(m[2], base).href, f: (m[4] || '').toLowerCase() }); } catch (e) { /* skip */ }
    }
    faces.push({
      family: get('font-family').replace(/^["']|["']$/g, ''), weight: get('font-weight') || '400', style: get('font-style') || 'normal',
      display: get('font-display'), unicode: !!get('unicode-range'), adjust: !!(get('size-adjust') || get('ascent-override')), src: src, sheet: base
    });
  });
  return faces;
}

async function fntLoad(url) {
  fntReset();
  FNT.url = url;
  const d = lastExtractedData;
  const list = (d && d.insights && d.insights.fonts && d.insights.fonts.unreadable) || [];
  const id = FNT.runId;
  if (!list.length) { FNT.phase = 'done'; fntMeasure(id); return; }
  FNT.phase = 'loading';
  await Promise.all(list.slice(0, 4).map(async (href) => {
    const res = await fetchWithTimeout(href, 8000);
    if (!res || !res.ok) return;
    let text = '';
    try { text = await res.text(); } catch (e) { return; }
    if (id !== FNT.runId) return;
    FNT.sheets[href] = fntParseCss(text, href);
  }));
  if (id !== FNT.runId) return;
  FNT.phase = 'done';
  shRerenderIfIdle();
  fntMeasure(id);
}

// Chrome does not always list fonts pulled in by another site's stylesheet in resource timing. Fonts the page
// reports as loaded but that have no timing entry get their size from the server instead.
async function fntMeasure(id) {
  const a = fntAnalyze(lastExtractedData);
  if (!a) return;
  const todo = a.files.filter(x => x.synthetic && !x.b && !FNT.tried[x.u]).slice(0, 8);
  if (!todo.length) return;
  await Promise.all(todo.map(async (x) => {
    FNT.tried[x.u] = true;
    const r = await lnkHeadOrGet(x.u, 8000);
    if (id !== FNT.runId || !r || r.error || !r.headers) return;
    const range = String(r.headers.get('content-range') || '').match(/\/(\d+)$/);
    const len = range ? parseInt(range[1], 10) : parseInt(r.headers.get('content-length') || '0', 10);
    if (len > 0) FNT.sizes[x.u] = len;
  }));
  if (id === FNT.runId) shRerenderIfIdle();
}

/* ------------------------------------------------------------------ analysis */
// the analysis needs the other sites' font stylesheets only when the page loads some
const fntNeeds = () => !!(lastExtractedData && lastExtractedData.insights && lastExtractedData.insights.fonts && lastExtractedData.insights.fonts.unreadable.length);
const fntReady = () => !fntNeeds() || FNT.phase === 'done';

function fntRange(w) {
  w = String(w || '400').trim().toLowerCase();
  if (w === 'normal') return [400, 400];
  if (w === 'bold') return [700, 700];
  const m = w.match(/^(\d+)(?:\s+(\d+))?$/);
  return m ? [+m[1], +(m[2] || m[1])] : [400, 400];
}
const fntItalic = (s) => /italic|oblique/i.test(s || '');
const fntExt = (u) => { const m = String(u).split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i); return m ? m[1].toLowerCase() : ''; };
const fntNorm = (u) => String(u).split('#')[0];

// the weights a family offers, in the order the browser tries them for a requested weight
function fntOrder(avail, want) {
  const up = (fn) => avail.filter(fn).sort((x, y) => x - y), down = (fn) => avail.filter(fn).sort((x, y) => y - x);
  if (want < 400) return down(a => a < want).concat(up(a => a > want));
  if (want > 500) return up(a => a > want).concat(down(a => a < want));
  if (want === 400) return up(a => a > 400 && a <= 500).concat(down(a => a < 400), up(a => a > 500));
  return down(a => a >= 400 && a < 500).concat(down(a => a < 400), up(a => a > 500));
}

function fntAnalyze(d) {
  const f = d && d.insights && d.insights.fonts;
  const r = d && d.insights && d.insights.resources;
  if (!f) return null;
  let faces = f.faces.map(x => Object.assign({}, x, { remote: false }));
  Object.keys(FNT.sheets).forEach(h => { faces = faces.concat(FNT.sheets[h].map(x => Object.assign({}, x, { remote: true }))); });
  faces.forEach(x => { x.fam = x.family.toLowerCase(); x.icon = FNT_ICON.test(x.family); x.w = fntRange(x.weight); x.italic = fntItalic(x.style); x.chars = 0; x.above = 0; x.used = false; x.files = []; });

  let pageHost = '';
  try { pageHost = new URL(d.meta.pageUrl).hostname; } catch (e) { /* none */ }
  const root = tpRoot(pageHost);
  const byFam = {};
  faces.forEach(x => { (byFam[x.fam] = byFam[x.fam] || []).push(x); });

  // which declared faces the text really asks for
  const system = {};
  (f.used || []).forEach(u => {
    const fam = u.fam.filter(n => byFam[n.toLowerCase()])[0];
    if (!fam) { const n = u.fam[0] || 'default'; system[n] = (system[n] || 0) + u.chars; return; }
    const pool = byFam[fam.toLowerCase()];
    const wantItalic = fntItalic(u.style);
    let cands = pool.filter(x => x.italic === wantItalic);
    if (!cands.length) cands = pool;
    const want = parseInt(u.weight, 10) || 400;
    const inRange = cands.filter(x => x.w[0] <= want && want <= x.w[1]);
    let chosen = inRange;
    if (!chosen.length) {
      const avail = Array.from(new Set(cands.map(x => x.w[0])));
      const pick = fntOrder(avail, want)[0];
      chosen = cands.filter(x => x.w[0] === pick);
    }
    chosen.forEach(x => { x.used = true; x.chars += u.chars; x.above += u.above; });
  });

  // match downloaded font files to the face that declares them
  const files = ((r && r.items) || []).filter(i => i.k === 'font').map(i => {
    let host = '';
    try { host = new URL(i.u).hostname; } catch (e) { /* none */ }
    const face = faces.filter(x => x.src.some(s => fntNorm(s.u) === fntNorm(i.u)))[0] || null;
    const o = Object.assign({}, i, { host: host, third: !!host && tpRoot(host) !== root, face: face, ext: fntExt(i.u), b: i.b || (TP.measured[i.u] || 0) });
    if (face) face.files.push(o);
    return o;
  });

  // fonts the page reports as loaded but that resource timing did not list
  const loadedKeys = new Set((f.loaded || []).filter(x => x.status === 'loaded').map(x => x.family.toLowerCase() + '|' + fntRange(x.weight).join('-') + '|' + fntItalic(x.style)));
  const seenKey = new Set();
  faces.forEach(x => {
    const key = x.fam + '|' + x.w.join('-') + '|' + x.italic;
    if (x.files.length || !loadedKeys.has(key) || seenKey.has(key)) return;
    const src = x.src.filter(sr => sr.u !== 'data:');
    if (!src.length) return;
    seenKey.add(key);
    const pick = src.filter(sr => /woff2/.test(sr.f) || /\.woff2/.test(sr.u))[0] || src[0];
    let host = '';
    try { host = new URL(pick.u).hostname; } catch (e) { /* none */ }
    const o = { u: pick.u, k: 'font', t: 'css', s: null, d: null, e: null, b: FNT.sizes[pick.u] || 0, p: '', bl: false, cached: false, host: host, third: !!host && tpRoot(host) !== root, face: x, ext: fntExt(pick.u), synthetic: true };
    x.files.push(o); files.push(o);
  });

  const hints = (r && r.hints) || [];
  const hasHint = (rel, u, asFont) => hints.some(h => h.rel.indexOf(rel) >= 0 && (rel !== 'preload' || !asFont || h.as === 'font') && fntNorm(h.href) === fntNorm(u));
  const hasConnect = (origin) => hints.some(h => /preconnect/.test(h.rel) && (() => { try { return new URL(h.href).origin === origin; } catch (e) { return false; } })());
  const originOf = (u) => { try { return new URL(u).origin; } catch (e) { return ''; } };

  const usedFaces = faces.filter(x => x.used && !x.icon);
  const aboveFaces = usedFaces.filter(x => x.above > 0);
  const dispKey = (x) => x.family + '|' + x.w.join('-') + '|' + x.italic;
  const badDisplay = [], seenD = new Set();
  (aboveFaces.length ? aboveFaces : usedFaces).forEach(x => {
    if (/^(swap|fallback|optional)$/i.test(x.display) || seenD.has(dispKey(x))) return;
    seenD.add(dispKey(x)); badDisplay.push(x);
  });

  const critical = files.filter(x => x.face && x.face.used && x.face.above > 0);
  const needPreload = critical.filter(x => !x.third && !hasHint('preload', x.u, true)).sort((a, b) => b.face.above - a.face.above);
  const thirdOrigins = {};
  critical.filter(x => x.third).forEach(x => { const o = originOf(x.u); if (o && !hasConnect(o)) thirdOrigins[o] = 'crossorigin'; });
  // the stylesheet that declares a remote face (fonts.googleapis.com) also needs a warm connection
  Object.keys(FNT.sheets).forEach(h => { const o = originOf(h); if (o && tpRoot(new URL(h).hostname) !== root && !hasConnect(o) && critical.length) thirdOrigins[o] = thirdOrigins[o] || ''; });

  const unusedFiles = files.filter(x => x.face && !x.face.used && !x.face.icon);
  const legacy = files.filter(x => !x.third && x.ext && x.ext !== 'woff2');
  const late = critical.filter(x => x.s > 1200);
  const totalBytes = files.reduce((s, x) => s + x.b, 0);

  // fallback metrics only matter for fonts that draw above the fold and have no override of their own
  const fallback = (f.fallback || []).filter(m => {
    const pool = byFam[m.family.toLowerCase()] || [];
    return pool.length && !pool.some(x => x.adjust) && pool.some(x => x.used && x.above > 0);
  });

  // weights per family that the text uses, for trimming a Google Fonts request
  const famUse = {};
  usedFaces.forEach(x => { const e = famUse[x.fam] || (famUse[x.fam] = { name: x.family, weights: new Set(), italic: false, variable: false }); e.weights.add(x.w[0]); if (x.italic) e.italic = true; if (x.w[0] !== x.w[1]) e.variable = true; });

  return {
    faces: faces, files: files, totalBytes: totalBytes, unknownBytes: files.filter(x => !x.b).length, byFam: byFam, system: system, famUse: famUse,
    webUsed: usedFaces.length > 0 || files.length > 0, badDisplay: badDisplay, needPreload: needPreload, thirdOrigins: thirdOrigins,
    unusedFiles: unusedFiles, unusedBytes: unusedFiles.reduce((s, x) => s + x.b, 0), legacy: legacy, late: late, fallback: fallback, hints: hints, sheets: Object.keys(FNT.sheets)
  };
}

/* ------------------------------------------------------------------ fix text */
const FNT_MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject' };

function fntGoogleDisplay(href) {
  try {
    const u = new URL(href);
    if (u.hostname !== 'fonts.googleapis.com') return null;
    if (/(^|&)display=(swap|fallback|optional)/.test(u.search.slice(1))) return null;
    const rest = u.search.slice(1).split('&').filter(p => p && !/^display=/.test(p));
    return u.origin + u.pathname + '?' + rest.concat('display=swap').join('&');
  } catch (e) { return null; }
}

// a Google Fonts address that asks only for the weights the text uses
function fntGoogleTrim(a, href) {
  try {
    const u = new URL(href);
    if (u.hostname !== 'fonts.googleapis.com' || u.pathname !== '/css2') return null;
    const asked = u.search.slice(1).split('&').filter(p => /^family=/.test(p)).map(p => decodeURIComponent(p.slice(7)).split(':')[0].replace(/\+/g, ' '));
    if (!asked.length) return null;
    let trimmed = false;
    const parts = asked.map(name => {
      const use = a.famUse[name.toLowerCase()];
      const pool = a.byFam[name.toLowerCase()] || [];
      if (!use || use.variable || !pool.length) return null;
      const declared = new Set(pool.filter(x => !x.icon).map(x => x.w[0]));
      if (Array.from(declared).every(w => use.weights.has(w))) return null;
      trimmed = true;
      const ws = Array.from(use.weights).sort((x, y) => x - y);
      const enc = name.replace(/ /g, '+');
      return use.italic ? enc + ':ital,wght@' + ws.map(w => '0,' + w).concat(ws.map(w => '1,' + w)).join(';') : enc + ':wght@' + ws.join(';');
    });
    if (!trimmed) return null;
    const fam = parts.map((p, i) => 'family=' + (p || asked[i].replace(/ /g, '+')));
    return u.origin + '/css2?' + fam.join('&') + '&display=swap';
  } catch (e) { return null; }
}

function fntFallbackCss(m) {
  const sa = m.sizeAdjust;
  const pct = (v) => (Math.round(v * 1000) / 10) + '%';
  const asc = m.ascent / sa, desc = m.descent / sa;
  const stack = m.generic === 'sans-serif' ? 'sans-serif' : m.generic;
  return `@font-face {\n  font-family: "${m.family} Fallback";\n  src: local("${m.local}");\n  size-adjust: ${pct(sa)};\n  ascent-override: ${pct(asc)};\n  descent-override: ${pct(desc)};\n  line-gap-override: 0%;\n}\n\n/* then list it after the web font */\nfont-family: "${m.family}", "${m.family} Fallback", ${stack};`;
}

function fntDisplayFix(a) {
  const parts = [];
  // fonts declared in another site's stylesheet: change the request, or the service's settings
  const bySheet = {};
  a.badDisplay.filter(x => x.remote).forEach(x => { (bySheet[x.sheet] = bySheet[x.sheet] || []).push(x); });
  Object.keys(bySheet).forEach(h => {
    const g = fntGoogleDisplay(h);
    if (g) parts.push(`<link rel="stylesheet" href="${fxAttr(g)}">`);
    else parts.push(`/* ${Array.from(new Set(bySheet[h].map(x => x.family))).join(', ')} come from ${insHost(h)}. Set font-display: swap in that service's settings. */`);
  });
  // fonts declared in the page's own CSS
  const local = a.badDisplay.filter(x => !x.remote);
  Array.from(new Set(local.map(x => x.family))).forEach(fam => {
    parts.push(`/* ${fam}: ${local.filter(x => x.family === fam).map(x => x.weight + (x.italic ? ' italic' : '')).join(', ')} */\n@font-face {\n  font-family: "${fam}";\n  /* keep your existing src, font-weight and font-style */\n  font-display: swap;\n}`);
  });
  return parts.join('\n\n');
}

function fntPreloadFix(a) {
  const parts = [];
  Object.keys(a.thirdOrigins).forEach(o => parts.push(`<link rel="preconnect" href="${o}"${a.thirdOrigins[o] ? ' crossorigin' : ''}>`));
  a.needPreload.slice(0, 3).forEach(x => parts.push(`<link rel="preload" href="${fxAttr(fxSrc(x.u, lastExtractedData))}" as="font" type="${FNT_MIME[x.ext] || 'font/woff2'}" crossorigin>`));
  return parts.join('\n');
}

function fntUnusedFix(a) {
  const parts = [];
  if (a.unusedFiles.some(x => x.third)) Object.keys(FNT.sheets).forEach(h => { const g = fntGoogleTrim(a, h); if (g) parts.push(`<link rel="stylesheet" href="${fxAttr(g)}">`); });
  const handled = parts.length;
  const rest = a.unusedFiles.filter(x => !(handled && x.third && /fonts\.g/.test(x.host)));
  if (rest.length) parts.push('/* Stop loading these: delete the @font-face rule, or the weight from the font request */\n' + rest.slice(0, 8).map(x => `${x.face.family} ${x.face.weight}${x.face.italic ? ' italic' : ''}  (${insFile(x.u)}, ${x.b ? insBytes(x.b) : 'size unknown'})`).join('\n'));
  return parts.join('\n\n');
}

function fntLegacyFix(a) {
  return a.legacy.slice(0, 6).map(x => `${insFile(x.u)}  →  ${insFile(x.u).replace(/\.[a-z0-9]+$/i, '')}.woff2\nsrc: url("${fxSrc(x.u, lastExtractedData).replace(/\.[a-z0-9]+(\?.*)?$/i, '.woff2')}") format("woff2");`).join('\n\n');
}

/* ------------------------------------------------------------------ checks */
function fontChecks(d) {
  if (!fntReady()) return [];
  const a = fntAnalyze(d);
  if (!a || !a.webUsed) return [];
  const out = [];
  const only = [insOpenAction('fonts', 'Open font optimizer')];

  if (a.faces.some(x => x.used && !x.icon)) {
    const code = fntDisplayFix(a);
    out.push({
      label: 'Text stays visible while fonts load', pass: a.badDisplay.length === 0, sev: 'Medium',
      t: 'Show text while fonts load',
      line: `${insPlural(a.badDisplay.length, 'font style')} (${a.badDisplay.slice(0, 3).map(x => x.family + ' ' + x.weight).join(', ')}) ${a.badDisplay.length === 1 ? 'has' : 'have'} no font-display, so text can stay invisible for up to three seconds on a slow connection.`,
      mean: 'Until the font arrives the browser hides the text. On slow connections visitors stare at blank space where the words should be.',
      fix: 'Add font-display: swap so the text shows in a fallback font straight away and switches when the font is ready.',
      section: 'ins:fonts', actions: only,
      fixCode: code ? { where: 'css', code: code, note: 'swap shows text at once. Use optional instead if you would rather never show a late swap.' } : null
    });
  }

  if (a.files.length) {
    const code = fntPreloadFix(a);
    const gaps = a.needPreload.length + Object.keys(a.thirdOrigins).length;
    out.push({
      label: 'Fonts the page needs first load early', pass: gaps === 0 && a.late.length === 0, sev: 'Low',
      t: 'Load key fonts earlier',
      line: a.needPreload.length ? `${insPlural(a.needPreload.length, 'font file')} used in the first screen ${a.needPreload.length === 1 ? 'is' : 'are'} only found after the stylesheet loads${a.late[0] ? ` (${insFile(a.late[0].u)} was requested at ${tpMs(a.late[0].s)})` : ''}.` : `Fonts from ${Object.keys(a.thirdOrigins).map(o => o.replace(/^https?:\/\//, '')).join(', ')} are fetched without a warm connection.`,
      mean: 'The browser only learns a font exists after it has downloaded and read the CSS. A preload hint starts the download in parallel, so text reaches its final look sooner.',
      fix: 'Preload the one or two fonts the first screen uses, and preconnect to any font host.',
      section: 'ins:fonts', actions: only,
      fixCode: code ? { where: 'head', code: code, note: 'Preload only what the first screen shows. Preloading too much slows everything else down.' } : null
    });
  }

  if (a.unusedFiles.length || a.faces.some(x => x.remote)) {
    const code = fntUnusedFix(a);
    out.push({
      label: 'Only the fonts in use are downloaded', pass: a.unusedFiles.length === 0, sev: a.unusedBytes >= 50 * 1024 ? 'Medium' : 'Low',
      t: 'Stop downloading unused fonts',
      line: `${insPlural(a.unusedFiles.length, 'font file')} (${a.unusedBytes ? insBytes(a.unusedBytes) : 'size unknown'}) ${a.unusedFiles.length === 1 ? 'is' : 'are'} downloaded but no visible text uses ${a.unusedFiles.length === 1 ? 'it' : 'them'}.`,
      mean: 'Each extra weight or style is a separate file. Fonts that nothing uses still cost bandwidth and delay the ones that matter.',
      fix: 'Remove the weights and styles you do not use, or stop requesting them.',
      section: 'ins:fonts', actions: only,
      fixCode: code ? { where: 'head', code: code, note: 'Text hidden until a button is pressed (menus, tabs) is not counted, so check before removing a weight.' } : null
    });
  }

  if (a.files.length) {
    const code = fntLegacyFix(a);
    out.push({
      label: 'Fonts use the WOFF2 format', pass: a.legacy.length === 0, sev: 'Low',
      t: 'Serve fonts as WOFF2',
      line: `${insPlural(a.legacy.length, 'font file')} ${a.legacy.length === 1 ? 'is' : 'are'} not WOFF2: ${a.legacy.slice(0, 3).map(x => insFile(x.u)).join(', ')}.`,
      mean: 'WOFF2 files are around 30 percent smaller than WOFF and far smaller than TTF or OTF, and every current browser supports them.',
      fix: 'Convert the files to WOFF2 and point the @font-face src at them.',
      section: 'ins:fonts', actions: only,
      fixCode: code ? { where: 'css', code: code, note: 'Convert the files first (for example with Google’s woff2 tool or an online converter).' } : null
    });
    const heavy = a.totalBytes > 150 * 1024 || a.files.length > 6;
    out.push({
      label: 'Font files stay lean', pass: !heavy, sev: a.totalBytes > 300 * 1024 ? 'Medium' : 'Low',
      t: 'Slim down the fonts',
      line: `${insPlural(a.files.length, 'font file')} ${a.totalBytes ? 'weigh ' + insBytes(a.totalBytes) : 'load'}${a.unknownBytes ? ' (some sizes unknown)' : ''}.`,
      mean: 'Fonts are render-critical files. Past about 150 KB, or six files, they start to cost real time on a phone.',
      fix: 'Use fewer weights, a variable font in place of several static ones, and subsets that contain only the scripts you need.',
      section: 'ins:fonts', actions: only
    });
  }

  if (a.fallback.length) {
    out.push({
      label: 'The fallback font matches the web font', pass: false, sev: 'Low',
      t: 'Stop the layout jump when fonts swap',
      line: `${a.fallback.map(m => m.family).join(', ')} ${a.fallback.length === 1 ? 'is' : 'are'} wider or taller than the stock font shown first, so text moves when the web font arrives.`,
      mean: 'Showing text in a fallback and then switching reflows the page. A fallback sized to match the web font keeps the lines where they are.',
      fix: 'Declare a fallback font face with size and ascent overrides measured from the web font.',
      section: 'ins:fonts', actions: only,
      fixCode: { where: 'css', code: a.fallback.slice(0, 2).map(fntFallbackCss).join('\n\n'), note: 'Measured in this browser against ' + a.fallback[0].local + '. Test on another operating system if exact metrics matter.' }
    });
  }
  return out;
}

/* ------------------------------------------------------------------ screen */
function fntFaceRow(x, group) {
  const files = group.files;
  const bytes = files.reduce((s, f) => s + f.b, 0);
  const starts = files.map(f => f.s).filter(v => v != null);
  const first = starts.length ? Math.min.apply(null, starts) : null;
  const disp = group.display || 'auto';
  const chips = [];
  if (x.icon) chips.push('<span class="ins-chip info">Icon font</span>');
  else chips.push(group.used ? `<span class="ins-chip ok">Used · ${group.chars} chars</span>` : (files.length ? '<span class="ins-chip bad">Not used</span>' : '<span class="ins-chip">Declared, not loaded</span>'));
  chips.push(`<span class="ins-chip ${/^(swap|fallback|optional)$/i.test(disp) ? 'ok' : (group.used ? 'warn' : '')}">display: ${shEsc(disp)}</span>`);
  if (files.length) {
    const ext = Array.from(new Set(files.map(f => f.ext || '?'))).join('/');
    chips.push(`<span class="ins-chip ${ext === 'woff2' ? 'ok' : 'warn'}">${shEsc(ext)}</span>`);
  }
  return `<div class="fnt-face"><span class="fnt-w"><b>${group.w[0] === group.w[1] ? group.w[0] : group.w.join('–')}</b><small>${group.italic ? 'italic' : 'regular'}</small></span>
      <span class="fnt-tx"><span class="ins-chips" style="margin-top:0">${chips.join('')}</span>
        <small>${files.length ? insPlural(files.length, 'file') + ' · ' + (bytes ? insBytes(bytes) : 'size unknown') + (first != null ? ' · requested at ' + tpMs(first) : '') : (x.remote ? 'from ' + shEsc(insHost(x.sheet)) : '')}</small></span></div>`;
}

function fntFamilyCard(fam, a) {
  const faces = a.byFam[fam];
  const groups = {};
  faces.forEach(x => {
    const k = x.w.join('-') + '|' + x.italic;
    const g = groups[k] || (groups[k] = { w: x.w, italic: x.italic, files: [], used: false, chars: 0, display: x.display, face: x });
    x.files.forEach(f => g.files.push(f));
    if (x.used) { g.used = true; g.chars = Math.max(g.chars, x.chars); }
    if (!g.display && x.display) g.display = x.display;
  });
  const rows = Object.keys(groups).map(k => groups[k]).sort((p, q) => (p.w[0] - q.w[0]) || (p.italic - q.italic));
  const fileCount = rows.reduce((s, g) => s + g.files.length, 0), bytes = rows.reduce((s, g) => s + g.files.reduce((t, f) => t + f.b, 0), 0);
  const name = faces[0].family;
  const anyUnused = rows.some(g => !g.used && g.files.length && !faces[0].icon);
  return `<details class="site-g fnt-fam"${anyUnused ? ' open' : ''}><summary><span><b>${shEsc(name)}</b><small class="fnt-sub">${rows.length} ${rows.length === 1 ? 'style' : 'styles'}${fileCount ? ' · ' + insPlural(fileCount, 'file') + (bytes ? ' · ' + insBytes(bytes) : '') : ''}</small></span><em>${rows.filter(g => g.used).length}/${rows.length} used</em></summary>
      <div class="site-gb">${rows.map(g => fntFaceRow(g.face, g)).join('')}</div></details>`;
}

function fntScreen(A) {
  const d = A.data;
  if (!d.insights || !d.insights.fonts) return insEmpty('type', 'Fonts unavailable', 'This page did not report its fonts. Rescan after it finishes loading.');
  if (FNT.phase === 'off') return insEmpty('type', 'Font stylesheets are not read automatically', 'This page loads fonts from another site, and reading them is switched off in Settings. Read them for this page only if you like.') + `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="fnt" data-v="load">Read them now</button></div>`;
  if (!fntReady()) return `<div class="sh-card"><div class="sh-empty"><b>Reading font stylesheets…</b>Fetching the stylesheets from other sites that declare this page’s fonts.</div></div>`;
  const a = fntAnalyze(d);
  const famNames = Object.keys(a.byFam).filter(k => a.faces.some(x => x.fam === k && (x.used || x.files.length)));
  if (!a.webUsed && !Object.keys(a.system).length) return insEmpty('type', 'No web fonts', 'This page shows no text.');
  const checks = fontChecks(d);
  const fails = checks.filter(c => !c.pass);
  let h = `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${fails.some(c => c.sev === 'Medium') ? 'warn' : 'ok'}">${a.files.length}</span><span class="sh-tchip ${fails.length ? 'warn' : 'ok'}">${a.files.length === 1 ? 'font file' : 'font files'}</span><small>${a.totalBytes ? insBytes(a.totalBytes) : 'size unknown'}${a.unknownBytes ? ' (partly)' : ''}</small></div>
      <p class="ins-lede">${a.webUsed ? `${insPlural(famNames.length, 'web font family', 'web font families')} in use.` : 'This page only uses fonts already on the device.'}${fails.length ? ` <b>${insPlural(fails.length, 'thing')} to improve.</b>` : ' <b>Nothing to fix.</b>'}</p></section>`;
  h += insTiles([['Families', famNames.length], ['Files', a.files.length], ['Unused', a.unusedFiles.length, a.unusedFiles.length ? 'warn' : 'ok'], ['Not WOFF2', a.legacy.length, a.legacy.length ? 'warn' : 'ok']]);

  if (fails.length) {
    h += `<div class="sh-sec"><span>To improve <em>${fails.length}</em></span></div><div class="site-groups">${fails.map((c, idx) => {
      const it = shNormCheck('speed', Object.assign({}, c, { actions: [], section: '' }), d);
      return `<details class="site-g"${idx === 0 ? ' open' : ''}><summary><span>${shEsc(it.t)}</span><em class="${shSevClass(it.sev)}">${it.sev}</em></summary><div class="site-gb"><p class="ins-lede" style="margin:0 0 8px">${shEsc(it.line)}</p>${shCheckBody(it)}</div></details>`;
    }).join('')}</div>`;
  }

  if (famNames.length) h += `<div class="sh-sec"><span>Fonts on this page <em>${famNames.length}</em></span></div><div class="site-groups">${famNames.map(k => fntFamilyCard(k, a)).join('')}</div>`;
  const sys = Object.keys(a.system).sort((x, y) => a.system[y] - a.system[x]).slice(0, 4);
  if (sys.length) h += `<p class="ins-note">Also drawn with fonts already on the device (nothing to download): ${sys.map(shEsc).join(', ')}.</p>`;
  h += `<p class="ins-note">Usage is counted from the text visible when the page was scanned. Text that appears later, such as menus and tabs, is not counted. Icon fonts are never reported as unused.</p>`;
  h += `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="fnt" data-v="copy">${shIcon('copy', 13)} Copy report</button></div>`;
  return h;
}

function fntReport() {
  const a = fntAnalyze(lastExtractedData);
  if (!a) return '';
  const L = [`Fonts on ${SH.url}`, `${a.files.length} font files, ${a.totalBytes ? insBytes(a.totalBytes) : 'size unknown'}`, ''];
  Object.keys(a.byFam).forEach(k => {
    const fs = a.byFam[k].filter(x => x.used || x.files.length);
    if (!fs.length) return;
    L.push(a.byFam[k][0].family + ':');
    fs.forEach(x => L.push(`- ${x.weight} ${x.italic ? 'italic' : 'regular'}: ${x.used ? 'used' : 'NOT USED'}, display ${x.display || 'auto'}${x.files.length ? ', ' + x.files.map(f => insFile(f.u) + ' ' + (f.b ? insBytes(f.b) : '?')).join(', ') : ''}`));
  });
  fontChecks(lastExtractedData).filter(c => !c.pass).forEach(c => L.push('', '! ' + c.t + ': ' + c.line));
  return L.join('\n');
}

function fntHandle(op) {
  if (op === 'copy') copyToClipboard(fntReport(), 'Report copied');
  else if (op === 'load') { fntLoad(SH.url); shRender(); }
}

/* ------------------------------------------------------------------ registration */
SH_SCREENS.fonts = { title: 'Font optimizer', build: fntScreen };
SH_CATS.filter(c => c.id === 'speed')[0].explore.push(['fonts', 'Font optimizer', 'Files, weights, loading and fallbacks', 'type']);
SH_TOOLS.Design.push(['fonts', 'Font optimizer', 'type']);
SH_TOOL_META.fonts = 'Unused weights, loading, fallbacks';
SH_TOOL_KEYWORDS.fonts = 'fonts font-display swap preload woff2 variable subset google fonts typekit fout foit unused weights fallback size-adjust';

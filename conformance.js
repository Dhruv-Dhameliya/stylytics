/* conformance.js — design system conformance.
 *
 * Paste or import a token set (CSS variables, SCSS variables, a Tailwind config, or design-tokens JSON,
 * including the one the Starter Kit exports) and Stylytics compares the page against it: which colors,
 * spacing values, font sizes, radii and fonts are on the system, which are near misses (probably typed by
 * hand), and which are off it entirely.
 *
 * The parser and the comparison are plain functions of their inputs; only the screen touches the DOM.
 */

const CON_STORE = 'con_tokens';
const CON = { map: {}, set: null, scope: '', host: '', tol: 3, text: '', draft: null, msg: '', editing: false, ready: false };

const CON_GENERIC_FONTS = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial'];

/* ------------------------------------------------------------------ value parsing */
function conToPx(v) {
  const m = String(v).trim().match(/^(-?\d*\.?\d+)\s*(px|rem|em)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Math.round((m[2].toLowerCase() === 'px' ? n : n * 16) * 100) / 100;
}

// '#RRGGBB' (alpha dropped) or null
function conHex(v) {
  const s = String(v).trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    return h.length === 6 ? '#' + h.toUpperCase() : null;
  }
  m = s.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, '0')).join('').toUpperCase();
  m = s.match(/^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/i);
  if (m && typeof hslToHex === 'function') return String(hslToHex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))).toUpperCase();
  return null;
}

function conFamilies(value) {
  return String(value).split(',').map(x => x.replace(/^["'\s]+|["'\s]+$/g, '').trim()).filter(x => x && CON_GENERIC_FONTS.indexOf(x.toLowerCase()) < 0 && !/^var\(/.test(x));
}

/* ------------------------------------------------------------------ classification */
function conName(path) {
  return path.filter(p => p && !/^(theme|extend|root|colors?|colours?|palette|spacing|space|fontsize|font-size|fontfamily|font-family|borderradius|border-radius|radius|radii|dimension|tokens?|global|core)$/i.test(p)).join('-').replace(/\.+/g, '-') || path.filter(Boolean).slice(-1)[0] || 'token';
}

// path = section names plus the token's own name; hint = a $type when the file has one
function conClassify(path, value, hint) {
  const p = path.join('.').toLowerCase();
  const h = String(hint || '').toLowerCase();
  const color = conHex(value);
  if (color && !/shadow|gradient|border-?width/.test(p)) return { kind: 'color', value: color };
  if (/shadow/.test(p) || /shadow/.test(h)) return null;
  const px = conToPx(value);
  if (px != null) {
    if (/radius|radii|rounded|round/.test(p) || /radius/.test(h)) return { kind: 'radius', value: px };
    if (/font-?size|fontsizes?|text|typescale|type-scale|fs-/.test(p) || /fontsize/.test(h)) return { kind: 'size', value: px };
    if (/space|spacing|gap|margin|padding|gutter|inset/.test(p) || /spacing/.test(h)) return { kind: 'spacing', value: px };
    return null;
  }
  if (typeof value === 'string' && (/font-?famil|fontfamil|family/.test(p) || /fontfamil/.test(h) || (/(^|[.-])font($|[.-])/.test(p) && /[a-z]/i.test(value) && !/^[\d.]+$/.test(value)))) {
    const fams = conFamilies(value);
    if (fams.length) return { kind: 'font', value: fams };
  }
  return null;
}

/* ------------------------------------------------------------------ parsing */
function conEmptySet(source) { return { source: source || 'mixed', savedAt: Date.now(), colors: [], spacing: [], sizes: [], radii: [], fonts: [] }; }

function conAdd(set, path, value, hint) {
  if (/line-?height|letter-?spacing|font-?weight|leading|tracking|opacity|z-?index/i.test(String(path[path.length - 1]))) return;
  const cls = conClassify(path, value, hint);
  if (!cls) return;
  const name = conName(path);
  if (cls.kind === 'color') { if (!set.colors.some(c => c.hex === cls.value)) set.colors.push({ name: name, hex: cls.value }); }
  else if (cls.kind === 'spacing') { if (!set.spacing.some(c => c.px === cls.value)) set.spacing.push({ name: name, px: cls.value }); }
  else if (cls.kind === 'size') { if (!set.sizes.some(c => c.px === cls.value)) set.sizes.push({ name: name, px: cls.value }); }
  else if (cls.kind === 'radius') { if (!set.radii.some(c => c.px === cls.value)) set.radii.push({ name: name, px: cls.value }); }
  else if (cls.kind === 'font') { if (!set.fonts.some(c => c.name === name)) set.fonts.push({ name: name, families: cls.value }); }
}

function conWalkJson(node, path, set, hint) {
  if (node == null) return;
  if (Array.isArray(node)) {
    if (node.length && node.every(x => typeof x === 'string')) conAdd(set, path, node.join(', '), hint);
    return;
  }
  if (typeof node !== 'object') { conAdd(set, path, node, hint); return; }
  const leaf = node.$value !== undefined ? node.$value : (node.value !== undefined && typeof node.value !== 'object' ? node.value : undefined);
  if (leaf !== undefined) {
    const type = node.$type || node.type || hint;
    if (Array.isArray(leaf)) conAdd(set, path, leaf.join(', '), type); else conAdd(set, path, leaf, type);
    return;
  }
  const t = node.$type || hint;
  Object.keys(node).forEach(k => { if (k[0] !== '$') conWalkJson(node[k], path.concat(k), set, t); });
}

// CSS / SCSS variables and JS object configs (Tailwind), tracked with a small section stack
function conParseText(text, set) {
  const stack = [];
  // several declarations on one line become one per line
  const prepared = text.replace(/;\s*(?=(?:--|\$)[\w-]+\s*:)/g, ';\n');
  prepared.split(/\r?\n/).forEach(raw => {
    const line = raw.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim();
    if (!line) return;
    let m;
    const lead = (line.match(/^\}+/) || [''])[0].length;
    for (let i = 0; i < lead; i++) stack.pop();
    const body = line.slice(lead).trim();
    if (!body) return;
    if ((m = body.match(/^(?:--|\$)([\w-]+)\s*:\s*([^;]+?)\s*;?\s*$/))) { conAdd(set, stack.concat([m[1]]), m[2].replace(/!default|!important/g, '').trim()); return; }
    if ((m = body.match(/^['"]?([\w.\/-]+)['"]?\s*:\s*\{(.*)\}\s*,?$/)) && m[2].trim()) {
      // a whole object on one line: gray: { 100: '#eee', 900: '#111' }
      const base = stack.concat([m[1]]);
      const re = /['"]?([\w.\/-]+)['"]?\s*:\s*(?:\[\s*)?(['"`])(.*?)\2/g;
      let p;
      while ((p = re.exec(m[2]))) conAdd(set, base.concat([p[1]]), p[3]);
      return;
    }
    if ((m = body.match(/^['"]?([\w.\/-]+)['"]?\s*:\s*\[\s*([^\]]*?)\s*\]/))) {
      const items = m[2].split(',').map(x => x.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
      if (/font-?family|^sans$|^serif$|^mono$|^display$/i.test(stack.concat([m[1]]).join('.'))) conAdd(set, stack.concat([m[1]]), items.join(', '));
      else if (items.length && !/^[{\[]/.test(items[0])) conAdd(set, stack.concat([m[1]]), items[0]);
      return;
    }
    if ((m = body.match(/^['"]?([\w.\/-]+)['"]?\s*:\s*(['"`])(.*?)\2\s*,?\s*$/))) { conAdd(set, stack.concat([m[1]]), m[3]); return; }
    if ((m = body.match(/^['"]?([\w.\/-]+)['"]?\s*:\s*\{\s*$/))) { stack.push(m[1].toLowerCase()); return; }
    if (/\{\s*$/.test(body)) { stack.push(''); return; }
    const closes = (body.match(/\}/g) || []).length - (body.match(/\{/g) || []).length;
    for (let i = 0; i < closes; i++) stack.pop();
  });
}

function conParseTokens(text) {
  const src = String(text || '').trim();
  const set = conEmptySet();
  if (!src) return set;
  let json = null;
  try { json = JSON.parse(src); } catch (e) { /* not JSON */ }
  if (json && typeof json === 'object') { set.source = 'json'; conWalkJson(json, [], set); }
  else {
    set.source = /module\.exports|export default|theme\s*:/.test(src) ? 'tailwind' : /\$[\w-]+\s*:/.test(src) && !/--[\w-]+\s*:/.test(src) ? 'scss' : 'css';
    conParseText(src, set);
  }
  return set;
}

function conSetCount(set) { return set ? set.colors.length + set.spacing.length + set.sizes.length + set.radii.length + set.fonts.length : 0; }

/* ------------------------------------------------------------------ comparison */
function conRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function conDist(a, b) { const x = conRgb(a), y = conRgb(b); return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2) / 441.673 * 100; }

function conNearestNumber(list, v) {
  let best = null;
  list.forEach(t => { const d = Math.abs(t.px - v); if (!best || d < best.d) best = { token: t, d: d }; });
  return best;
}

// How a page lines up against a token set. tol is the color near-match threshold in percent.
function conCompare(data, set, tol) {
  const out = { cats: {}, present: [] };
  const finish = (key, label, items, weighted) => {
    const total = items.reduce((s, i) => s + (weighted ? i.count : 1), 0) || 0;
    const exact = items.filter(i => i.status === 'exact').reduce((s, i) => s + (weighted ? i.count : 1), 0);
    out.cats[key] = {
      label: label, items: items, total: total, exact: exact, pct: total ? Math.round(exact / total * 100) : 100,
      near: items.filter(i => i.status === 'near').length, off: items.filter(i => i.status === 'off').length, offAll: items.filter(i => i.status !== 'exact').length
    };
    out.present.push(key);
  };

  if (set.colors.length) {
    const items = kitUniqueColors(data).map(c => {
      let best = null;
      set.colors.forEach(t => { const d = conDist(c.hex.toUpperCase(), t.hex); if (!best || d < best.d) best = { token: t, d: d }; });
      const status = best.d < 0.05 ? 'exact' : best.d <= tol ? 'near' : 'off';
      return { hex: c.hex.toUpperCase(), raw: c.raw, status: status, token: best.token, dist: Math.round(best.d * 100) / 100 };
    });
    finish('colors', 'Colors', items, false);
  }
  const numeric = (key, label, tokens, counts, near) => {
    if (!tokens.length) return;
    const items = Object.keys(counts).map(Number).sort((a, b) => a - b).map(v => {
      const n = conNearestNumber(tokens, v);
      const status = n.d < 0.05 ? 'exact' : n.d <= near ? 'near' : 'off';
      return { px: v, count: counts[v], status: status, token: n.token, dist: Math.round(n.d * 10) / 10 };
    });
    finish(key, label, items, true);
  };
  const t = data.designTokens || {};
  numeric('spacing', 'Spacing', set.spacing, kitPxNumbers([].concat(t.margins || [], t.paddings || [], t.gaps || []), 200), 1);
  const sizeCounts = {};
  kitFontSizes(data).forEach(s => { sizeCounts[s] = 1; });
  numeric('sizes', 'Font sizes', set.sizes, sizeCounts, 1);
  const radCounts = {};
  (t.radii || []).forEach(r => { const m = String(r.value).split(/\s+/)[0].match(/^(\d+(?:\.\d+)?)px$/); if (m) { const v = parseFloat(m[1]) >= 999 ? 9999 : Math.round(parseFloat(m[1]) * 10) / 10; radCounts[v] = (radCounts[v] || 0) + (r.count || 1); } });
  numeric('radii', 'Corner radii', set.radii.map(r => ({ name: r.name, px: r.px >= 999 ? 9999 : r.px })), radCounts, 1);

  if (set.fonts.length) {
    const allowed = {};
    set.fonts.forEach(f => f.families.forEach(n => { allowed[n.toLowerCase()] = f; }));
    const items = kitFontStacks(data).map(f => ({ name: f.name, stack: f.stack, status: allowed[f.name.toLowerCase()] ? 'exact' : 'off', token: allowed[f.name.toLowerCase()] || null }));
    finish('fonts', 'Fonts', items, false);
  }

  const pcts = out.present.map(k => out.cats[k].pct);
  out.overall = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  return out;
}

/* ------------------------------------------------------------------ storage */
function conLoad(url) {
  CON.ready = false;
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* no host */ }
  CON.host = host;
  chrome.storage.local.get([CON_STORE, 'con_tol'], (res) => {
    CON.map = res[CON_STORE] || {};
    CON.tol = res.con_tol || 3;
    const own = host && CON.map[host];
    CON.set = own || CON.map['*'] || null;
    CON.scope = own ? 'site' : (CON.map['*'] ? 'all' : '');
    CON.ready = true;
    try { if (!SH.scanning) shRender(); } catch (e) { /* not ready yet */ }
  });
}
function conPersist(cb) { chrome.storage.local.set({ [CON_STORE]: CON.map }, cb); }

/* ------------------------------------------------------------------ audit hook */
let CON_CACHE = { key: '', value: null };
function conReport(d) {
  if (!CON.set) return null;
  const key = CON.tol + '|' + CON.set.savedAt + '|' + (d.meta && d.meta.pageUrl);
  if (CON_CACHE.key !== key) CON_CACHE = { key: key, value: conCompare(d, CON.set, CON.tol) };
  return CON_CACHE.value;
}

function conChecks(d) {
  const r = conReport(d);
  if (!r || r.overall == null) return [];
  const worst = r.present.map(k => r.cats[k]).filter(c => c.offAll).sort((a, b) => a.pct - b.pct)[0];
  return [{
    label: 'Page values match your design tokens', pass: r.overall >= 90, sev: r.overall < 60 ? 'High' : 'Medium',
    t: 'Bring off-system values back to your tokens',
    line: `${r.overall}% token conformance${worst ? `; ${worst.label.toLowerCase()} are furthest off (${worst.offAll} off-system)` : ''}.`,
    mean: 'Values that are close to a token but not equal to it are usually typed by hand. They make the design drift and are hard to change later.',
    fix: 'Replace each near-miss with the token variable, and decide whether the remaining values belong in the system.',
    actions: [insOpenAction('conformance', 'Open design system')]
  }];
}

/* ------------------------------------------------------------------ screen */
function conSwatch(hex) { return `<i class="ins-sw" style="background:${shEsc(hex)}" title="${shEsc(hex)}"></i>`; }

function conImportView(A) {
  const draft = CON.draft;
  const sample = ':root {\n  --color-brand: #ea580c;\n  --color-ink: #18181b;\n  --space-4: 4px;\n  --space-8: 8px;\n  --space-16: 16px;\n  --text-16: 16px;\n  --radius-8: 8px;\n  --font-sans: Inter, sans-serif;\n}';
  let h = `<section class="sh-card ins-pad con-intro"><b>Check this page against your design system</b>
      <p class="ins-lede">Paste your tokens or import a file. Stylytics flags every color, spacing value, font size, radius and font that is not in the system, and shows which ones are only a hair off.</p>
      <p class="ins-note" style="margin:6px 0 0">Works with CSS or SCSS variables, a Tailwind config, and design-tokens JSON, including the file the Starter Kit exports.</p></section>
    <div class="sh-sec"><span>Your tokens</span></div>
    <div class="sh-card ins-pad">
      <textarea id="con-text" class="con-text" spellcheck="false" placeholder="Paste CSS variables, a Tailwind config or tokens JSON here">${shEsc(CON.text)}</textarea>
      <div class="sh-btns">
        <button type="button" class="sh-btn pri sm" data-sh="con" data-v="parse">Read tokens</button>
        <label class="sh-btn sm con-file">Import file<input type="file" id="con-file" accept=".css,.scss,.sass,.json,.js,.cjs,.mjs,.ts,.txt" hidden></label>
        <button type="button" class="sh-btn sm" data-sh="con" data-v="sample" data-sample="${shEsc(sample)}">Try an example</button>
      </div>
      ${CON.msg ? `<p class="ins-note con-msg">${CON.msg}</p>` : ''}
    </div>`;
  if (draft) {
    const n = conSetCount(draft);
    h += `<div class="sh-sec"><span>Found <em>${insPlural(n, 'token')}</em></span></div><div class="sh-card ins-pad">
      <div class="ins-legend" style="margin:0 0 8px"><span>Colors <b>${draft.colors.length}</b></span><span>Spacing <b>${draft.spacing.length}</b></span><span>Font sizes <b>${draft.sizes.length}</b></span><span>Radii <b>${draft.radii.length}</b></span><span>Fonts <b>${draft.fonts.length}</b></span></div>
      ${draft.colors.length ? `<div class="ins-sws">${draft.colors.slice(0, 24).map(c => conSwatch(c.hex)).join('')}</div>` : ''}
      <div class="sh-btns" style="margin-top:12px">
        <button type="button" class="sh-btn pri sm" data-sh="con" data-v="save-site">Use for ${shEsc(CON.host || 'this site')}</button>
        <button type="button" class="sh-btn sm" data-sh="con" data-v="save-all">Use on every site</button>
      </div></div>`;
  }
  return h;
}

function conOffRows(key, cat) {
  const rows = cat.items.filter(i => i.status !== 'exact');
  if (!rows.length) return `<div class="sh-empty" style="padding:14px"><b>Everything is on the system</b></div>`;
  return rows.slice(0, 14).map(i => {
    const tag = i.status === 'near' ? '<span class="ins-chip warn">Near miss</span>' : '<span class="ins-chip bad">Off system</span>';
    if (key === 'colors') {
      return `<div class="ins-chg ${i.status === 'near' ? 'change' : 'regress'} con-row"><span class="con-pair">${conSwatch(i.hex)}<em>→</em>${conSwatch(i.token.hex)}</span>
        <span class="ins-chg-tx"><b>${shEsc(i.hex)} <small>vs ${shEsc(i.token.name)} ${shEsc(i.token.hex)}</small></b>
          <small>${i.dist}% apart${i.status === 'near' ? ', probably a hand-typed value' : ''}</small></span>${tag}
        <button type="button" class="ins-go" data-sh="con" data-v="show" data-raw="${shEsc(i.raw || '')}" aria-label="Show on page" title="Show on page">${shIcon('target', 14)}</button></div>`;
    }
    if (key === 'fonts') return `<div class="ins-chg regress con-row"><span class="ins-chg-tx"><b>${shEsc(i.name)}</b><small>Not in your font tokens</small></span>${tag}</div>`;
    const unit = (v) => v >= 9999 ? 'full' : v + 'px';
    return `<div class="ins-chg ${i.status === 'near' ? 'change' : 'regress'} con-row"><span class="ins-chg-tx"><b>${unit(i.px)}${key === 'spacing' ? ` <small>used ${i.count}×</small>` : ''}</b>
        <small>Nearest token ${shEsc(i.token.name)} (${unit(i.token.px)}), ${i.dist}px away</small></span>${tag}</div>`;
  }).join('') + (rows.length > 14 ? `<p class="ins-note" style="padding:0 12px">Showing 14 of ${rows.length}.</p>` : '');
}

function conReportView(A) {
  const r = conReport(A.data);
  if (!r || r.overall == null) {
    return `<div class="sh-card"><div class="sh-empty"><span class="sh-empty-ic">${shIcon('grid', 26)}</span><b>No usable tokens</b>That token set had no colors, spacing, sizes, radii or fonts Stylytics could read.</div></div>
      <div class="sh-btns ins-foot"><button type="button" class="sh-btn sm" data-sh="con" data-v="edit">Edit tokens</button></div>`;
  }
  const tier = r.overall >= 90 ? 'ok' : r.overall >= 70 ? 'warn' : 'bad';
  const nearTotal = r.present.reduce((s, k) => s + (k === 'colors' ? r.cats[k].near : 0), 0);
  const offColors = r.cats.colors ? r.cats.colors.offAll : 0;
  let h = `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${tier}">${r.overall}%</span><span class="sh-tchip ${tier}">Token conformance</span>
      <small>${CON.scope === 'site' ? 'Tokens saved for ' + shEsc(CON.host) : 'Tokens used on every site'} · ${insPlural(conSetCount(CON.set), 'token')}</small></div>
      ${r.cats.colors && offColors ? `<p class="ins-lede"><b>${insPlural(offColors, 'off-system color')}</b>${nearTotal ? `, ${nearTotal} of them within ${CON.tol}% of an existing token, probably typed by hand` : ''}.</p>` : (r.overall === 100 ? '<p class="ins-lede">Every value on this page is in your design system.</p>' : '')}</section>`;
  h += `<div class="ins-tiles" style="--cols:${r.present.length === 5 ? 3 : r.present.length}">${r.present.map(k => { const c = r.cats[k]; return `<div class="ins-tile ${c.pct >= 90 ? 'ok' : c.pct >= 70 ? 'warn' : 'bad'}"><small>${c.label}</small><b>${c.pct}%</b></div>`; }).join('')}</div>`;
  if (r.cats.colors) {
    h += `<div class="sh-sec"><span>Near-match tolerance</span></div><div class="segmented con-tol">${[1, 3, 5, 8].map(n => `<button type="button" class="tag${CON.tol === n ? ' active' : ''}" data-sh="con" data-v="tol" data-n="${n}">${n}%</button>`).join('')}</div>
      <p class="ins-note">How close a color must be to a token to count as a near miss rather than a different color.</p>`;
  }
  r.present.forEach(k => {
    const c = r.cats[k];
    h += `<div class="sh-sec"><span>${c.label} <em>${c.pct}% on system</em></span></div><div class="sh-card ins-chgs">${conOffRows(k, c)}</div>`;
  });
  const missing = ['colors', 'spacing', 'sizes', 'radii', 'fonts'].filter(k => r.present.indexOf(k) < 0).map(k => ({ colors: 'colors', spacing: 'spacing', sizes: 'font sizes', radii: 'radii', fonts: 'fonts' }[k]));
  if (missing.length) h += `<p class="ins-note">Not checked because your tokens do not define ${missing.join(', ')}.</p>`;
  h += `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="con" data-v="copy">${shIcon('copy', 13)} Copy drift report</button>
      <button type="button" class="sh-btn sm" data-sh="con" data-v="edit">Replace tokens</button><button type="button" class="sh-btn sm" data-sh="con" data-v="remove">Remove</button></div>`;
  return h;
}

function conScreen(A) {
  if (!CON.ready) return '<div class="sh-empty"><b>Loading…</b></div>';
  return (CON.set && !CON.editing) ? conReportView(A) : conImportView(A);
}

/* ------------------------------------------------------------------ actions */
function conDriftText(d) {
  const r = conReport(d);
  if (!r) return '';
  const L = [`Design system drift for ${(d.meta && d.meta.pageUrl) || CON.host}`, `${r.overall}% token conformance`, ''];
  r.present.forEach(k => {
    const c = r.cats[k];
    L.push(`${c.label}: ${c.pct}% on system (${c.offAll} off)`);
    c.items.filter(i => i.status !== 'exact').slice(0, 20).forEach(i => {
      if (k === 'colors') L.push(`- ${i.hex} ${i.status === 'near' ? `is ${i.dist}% from ${i.token.name} ${i.token.hex}` : `has no token (nearest ${i.token.name} ${i.token.hex}, ${i.dist}% apart)`}`);
      else if (k === 'fonts') L.push(`- ${i.name} is not in the font tokens`);
      else L.push(`- ${i.px >= 9999 ? 'full' : i.px + 'px'} ${i.status === 'near' ? 'is one step from' : 'is off'} ${i.token.name}`);
    });
    L.push('');
  });
  return L.join('\n').trim();
}

function conHandle(op, el) {
  const ds = el.dataset || {};
  const grab = () => { const ta = shEl('con-text'); if (ta) CON.text = ta.value; };
  switch (op) {
    case 'sample': { const ta = shEl('con-text'); if (ta) ta.value = ds.sample; CON.text = ds.sample; break; }
    case 'parse': {
      grab();
      CON.draft = conParseTokens(CON.text);
      CON.draft.raw = CON.text.slice(0, 60000);
      const n = conSetCount(CON.draft);
      CON.msg = n ? '' : 'No tokens found. Check that the text has variables such as <b>--space-8: 8px</b> or a tokens object.';
      if (!n) CON.draft = null;
      shRender();
      break;
    }
    case 'save-site': case 'save-all': {
      if (!CON.draft) return;
      const key = op === 'save-all' ? '*' : (CON.host || '*');
      CON.map[key] = CON.draft;
      CON.set = CON.draft; CON.scope = key === '*' ? 'all' : 'site';
      CON.draft = null; CON.editing = false; CON.msg = '';
      conPersist(() => { showToast('Design tokens saved'); shRender(); });
      break;
    }
    case 'edit': CON.editing = true; CON.msg = ''; CON.text = (CON.set && CON.set.raw) || CON.text; shRender(); break;
    case 'remove': {
      const key = CON.scope === 'all' ? '*' : CON.host;
      delete CON.map[key];
      CON.set = CON.map['*'] && key !== '*' ? CON.map['*'] : null;
      CON.scope = CON.set ? 'all' : '';
      conPersist(() => { showToast('Design tokens removed'); shRender(); });
      break;
    }
    case 'tol': CON.tol = parseInt(ds.n, 10); chrome.storage.local.set({ con_tol: CON.tol }); shRender(); break;
    case 'show': if (ds.raw) sendHighlightMessage(lastActiveTabId, 'color', ds.raw); break;
    case 'copy': copyToClipboard(conDriftText(lastExtractedData), 'Drift report copied'); break;
  }
}

document.addEventListener('change', (e) => {
  if (!e.target || e.target.id !== 'con-file') return;
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    CON.text = String(reader.result || '').slice(0, 400000);
    CON.draft = conParseTokens(CON.text);
    CON.draft.raw = CON.text.slice(0, 60000);
    CON.msg = conSetCount(CON.draft) ? '' : 'No tokens found in that file.';
    if (!conSetCount(CON.draft)) CON.draft = null;
    shRender();
  };
  reader.readAsText(f);
});

SH_SCREENS.conformance = { title: 'Design system', build: conScreen };

SH_CATS.filter(c => c.id === 'design')[0].explore.push(['conformance', 'Design system', 'Check the page against your tokens', 'layers']);
SH_TOOLS.Design.push(['conformance', 'Design system', 'shield']);
SH_TOOL_META.conformance = 'Check against your tokens';
SH_TOOL_KEYWORDS.conformance = 'tokens design system drift conformance brand tailwind variables compliance';

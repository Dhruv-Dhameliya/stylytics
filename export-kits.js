/* export-kits.js — the machine-readable exports: design-token starter kits and the tech-stack JSON.
 *
 * Tokens get meaningful names ("orange-600", "space-16", "radius-8") instead of position numbers, are
 * grouped, sorted and commented, and carry where and when they were extracted. The same helpers feed the
 * style guide report, so names match everywhere.
 */

/* ------------------------------------------------------------------ naming */
const KIT_HUES = [[15, 'red'], [45, 'orange'], [68, 'yellow'], [95, 'lime'], [160, 'green'], [195, 'teal'], [215, 'cyan'], [250, 'blue'], [275, 'indigo'], [310, 'purple'], [345, 'pink'], [361, 'red']];

function kitColorName(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl) return 'color';
  const l = hsl.l;
  if (hsl.s < 9) return l > 97 ? 'white' : l < 7 ? 'black' : `gray-${kitShade(l)}`;
  const hue = (KIT_HUES.find(h => hsl.h < h[0]) || KIT_HUES[0])[1];
  return `${hue}-${kitShade(l)}`;
}
function kitShade(l) { return l > 95 ? 50 : l > 90 ? 100 : l > 80 ? 200 : l > 70 ? 300 : l > 60 ? 400 : l > 50 ? 500 : l > 40 ? 600 : l > 30 ? 700 : l > 20 ? 800 : 900; }

// unique, 6-digit-safe colors from the scan, in scan order
function kitUniqueColors(data) {
  const seen = new Set(), out = [];
  [].concat(data.colors || [], data.bgColors || []).forEach(c => {
    if (c && c.hex && !seen.has(c.hex)) { seen.add(c.hex); out.push(c); }
  });
  return out;
}
// hex -> unique token name (duplicates get -2, -3 ...)
function kitNameColors(colors) {
  const used = {}, map = {};
  colors.forEach(c => {
    const base = kitColorName(c.hex);
    used[base] = (used[base] || 0) + 1;
    map[c.hex] = used[base] > 1 ? `${base}-${used[base]}` : base;
  });
  return map;
}

function kitFontStacks(data) {
  const seen = new Set(), out = [];
  (data.fonts || []).forEach(f => {
    const first = f.split(',')[0].replace(/['"]/g, '').trim();
    if (!first || seen.has(first.toLowerCase())) return;
    seen.add(first.toLowerCase());
    const lower = f.toLowerCase();
    const role = /mono|courier|consolas|menlo/.test(lower) ? 'mono' : /serif/.test(lower) && !/sans-serif/.test(lower) || /georgia|times|garamond|playfair|merriweather|baskerville|fraunces/.test(first.toLowerCase()) ? 'serif' : 'sans';
    out.push({ name: first, role, stack: f.trim() });
  });
  // sans, serif, mono, then extras suffixed -2 ...
  const count = {};
  return out.map(f => { count[f.role] = (count[f.role] || 0) + 1; return Object.assign(f, { key: count[f.role] > 1 ? `${f.role}-${count[f.role]}` : f.role }); });
}

function kitPxNumbers(values, max) {
  const counts = {};
  (values || []).forEach(t => {
    String(t.value).split(/\s+/).forEach(part => {
      const m = part.match(/^(-?\d+(?:\.\d+)?)px$/);
      if (!m) return;
      const n = Math.round(parseFloat(m[1]) * 10) / 10;
      if (n > 0 && n <= (max || 200)) counts[n] = (counts[n] || 0) + (t.count || 1);
    });
  });
  return counts;
}
function kitSpacing(data) {
  const t = data.designTokens || {};
  const counts = kitPxNumbers([].concat(t.margins || [], t.paddings || [], t.gaps || []), 160);
  return Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a]).slice(0, 14).sort((a, b) => a - b);
}
function kitRadii(data) {
  const t = data.designTokens || {};
  const out = new Set();
  (t.radii || []).forEach(r => {
    const first = String(r.value).split(/\s+/)[0];
    const m = first.match(/^(\d+(?:\.\d+)?)px$/);
    if (m) out.add(parseFloat(m[1]) >= 999 ? 'full' : String(Math.round(parseFloat(m[1]) * 10) / 10));
  });
  return Array.from(out).sort((a, b) => (a === 'full') - (b === 'full') || a - b);
}
function kitFontSizes(data) {
  const out = new Set();
  (data.fontSizes || []).forEach(s => { const n = parseFloat(s); if (n > 0) out.add(Math.round(n * 10) / 10); });
  return Array.from(out).sort((a, b) => a - b);
}
function kitShadows(data) { return ((data.designTokens || {}).shadows || []).map(s => s.value).slice(0, 8); }

/* ------------------------------------------------------------------ starter kits */
function kitHeader(data, comment) {
  const meta = data.meta || {};
  const src = meta.pageUrl || meta.canonical || '';
  const lines = [`Design tokens extracted by Stylytics${rpVersion() ? ' ' + rpVersion() : ''}`, src ? `Source: ${src}` : '', `Extracted: ${new Date().toISOString().slice(0, 10)}`].filter(Boolean);
  return comment === 'block' ? `/*\n${lines.map(l => ' * ' + l).join('\n')}\n */\n` : lines;
}

function buildStarterKit(data, format) {
  const colors = kitUniqueColors(data);
  const names = kitNameColors(colors);
  const fonts = kitFontStacks(data);
  const sizes = kitFontSizes(data);
  const spacing = kitSpacing(data);
  const radii = kitRadii(data);
  const shadows = kitShadows(data);
  const px = (n) => `${n}px`;
  const radiusVal = (r) => r === 'full' ? '9999px' : px(r);

  if (format === 'css') {
    const L = [kitHeader(data, 'block') + ':root {'];
    if (colors.length) { L.push('  /* Colors */'); colors.forEach(c => L.push(`  --${names[c.hex]}: ${c.hex};`)); }
    if (fonts.length) { L.push('', '  /* Font families */'); fonts.forEach(f => L.push(`  --font-${f.key}: ${f.stack};`)); }
    if (sizes.length) { L.push('', '  /* Type scale */'); sizes.forEach(s => L.push(`  --text-${String(s).replace('.', '_')}: ${px(s)};`)); }
    if (spacing.length) { L.push('', '  /* Spacing */'); spacing.forEach(s => L.push(`  --space-${String(s).replace('.', '_')}: ${px(s)};`)); }
    if (radii.length) { L.push('', '  /* Corner radius */'); radii.forEach(r => L.push(`  --radius-${r}: ${radiusVal(r)};`)); }
    if (shadows.length) { L.push('', '  /* Shadows */'); shadows.forEach((s, i) => L.push(`  --shadow-${i + 1}: ${s};`)); }
    L.push('}');
    return { text: L.join('\n'), ext: 'css' };
  }

  if (format === 'scss') {
    const L = kitHeader(data).map(l => '// ' + l);
    L.push('');
    colors.forEach(c => L.push(`$${names[c.hex]}: ${c.hex};`));
    if (fonts.length) L.push('');
    fonts.forEach(f => L.push(`$font-${f.key}: ${f.stack};`));
    if (sizes.length) L.push('');
    sizes.forEach(s => L.push(`$text-${String(s).replace('.', '_')}: ${px(s)};`));
    if (spacing.length) L.push('');
    spacing.forEach(s => L.push(`$space-${String(s).replace('.', '_')}: ${px(s)};`));
    if (radii.length) L.push('');
    radii.forEach(r => L.push(`$radius-${r}: ${radiusVal(r)};`));
    return { text: L.join('\n'), ext: 'scss' };
  }

  if (format === 'figma') {
    // W3C design-tokens format: $value / $type, grouped, importable by Tokens Studio and similar tools
    const obj = { $description: kitHeader(data).join(' · ') };
    if (colors.length) { obj.color = {}; colors.forEach(c => { obj.color[names[c.hex]] = { $value: c.hex, $type: 'color' }; }); }
    if (fonts.length) { obj.fontFamily = {}; fonts.forEach(f => { obj.fontFamily[f.key] = { $value: f.stack, $type: 'fontFamily' }; }); }
    if (sizes.length) { obj.fontSize = {}; sizes.forEach(s => { obj.fontSize[String(s).replace('.', '_')] = { $value: px(s), $type: 'dimension' }; }); }
    if (spacing.length) { obj.spacing = {}; spacing.forEach(s => { obj.spacing[String(s).replace('.', '_')] = { $value: px(s), $type: 'dimension' }; }); }
    if (radii.length) { obj.borderRadius = {}; radii.forEach(r => { obj.borderRadius[r] = { $value: radiusVal(r), $type: 'dimension' }; }); }
    if (shadows.length) { obj.shadow = {}; shadows.forEach((s, i) => { obj.shadow[String(i + 1)] = { $value: s, $type: 'shadow' }; }); }
    return { text: JSON.stringify(obj, null, 2), ext: 'json' };
  }

  // default: Tailwind config
  const q = (s) => `'${String(s).replace(/'/g, "\\'")}'`;
  const block = (entries) => entries.length ? entries.map(e => `        ${e}`).join('\n') : '';
  const parts = [];
  if (colors.length) parts.push(`      colors: {\n${block(colors.map(c => `${q(names[c.hex])}: ${q(c.hex)},`))}\n      },`);
  if (fonts.length) parts.push(`      fontFamily: {\n${block(fonts.map(f => `${q(f.key)}: [${f.stack.split(',').map(x => q(x.trim().replace(/^['"]|['"]$/g, ''))).join(', ')}],`))}\n      },`);
  if (sizes.length) parts.push(`      fontSize: {\n${block(sizes.map(s => `${q('t' + String(s).replace('.', '_'))}: ${q(px(s))},`))}\n      },`);
  if (spacing.length) parts.push(`      spacing: {\n${block(spacing.map(s => `${q('space-' + String(s).replace('.', '_'))}: ${q(px(s))},`))}\n      },`);
  if (radii.length) parts.push(`      borderRadius: {\n${block(radii.map(r => `${q('r-' + r)}: ${q(radiusVal(r))},`))}\n      },`);
  if (shadows.length) parts.push(`      boxShadow: {\n${block(shadows.map((s, i) => `${q('s-' + (i + 1))}: ${q(s)},`))}\n      },`);
  return { text: `${kitHeader(data, 'block')}/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  theme: {\n    extend: {\n${parts.join('\n')}\n    }\n  }\n};\n`, ext: 'js' };
}

// "Copy all colors" on the Colors screen
function formatColorsForExport(colorsArray, format) {
  const names = kitNameColors(colorsArray);
  const n = (c) => names[c.hex];
  if (format === 'tailwind') {
    return { label: 'Tailwind config', text: `module.exports = {\n  theme: {\n    extend: {\n      colors: {\n${colorsArray.map(c => `        '${n(c)}': '${c.hex}',`).join('\n')}\n      }\n    }\n  }\n};` };
  }
  if (format === 'scss') return { label: 'SCSS variables', text: colorsArray.map(c => `$${n(c)}: ${c.hex};`).join('\n') };
  if (format === 'json') {
    const obj = {};
    colorsArray.forEach(c => { obj[n(c)] = c.hex; });
    return { label: 'JSON', text: JSON.stringify(obj, null, 2) };
  }
  return { label: 'CSS', text: [':root {', ...colorsArray.map(c => `  --${n(c)}: ${c.hex};`), '}'].join('\n') };
}

/* ------------------------------------------------------------------ tech-stack JSON */
function buildTechStackExport() {
  const data = (typeof lastExtractedData !== 'undefined' && lastExtractedData) || {};
  const meta = data.meta || {};
  const order = (typeof TECH_CATEGORY_ORDER !== 'undefined') ? TECH_CATEGORY_ORDER : [];
  const cats = Array.from(lastTechStackGrouped.keys()).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const technologies = [];
  const byCategory = {};
  cats.forEach(cat => {
    byCategory[cat] = [];
    lastTechStackGrouped.get(cat).forEach(raw => {
      const inferred = /\s\(likely\)$/.test(raw);
      const label = raw.replace(/\s\(likely\)$/, '');
      const m = label.match(/^(.*?)\s+v?(\d+(?:\.\d+){0,3})$/);
      technologies.push({ name: m ? m[1] : label, version: m ? m[2] : null, category: cat, inferred });
      byCategory[cat].push(label);
    });
  });
  const url = meta.pageUrl || meta.canonical || '';
  return JSON.stringify({
    generator: `Stylytics${rpVersion() ? ' ' + rpVersion() : ''}`,
    exportedAt: new Date().toISOString(),
    page: { url, host: rpHostOf(url), title: meta.title || null },
    summary: { technologies: technologies.length, categories: cats.length, inferred: technologies.filter(t => t.inferred).length },
    technologies,
    byCategory,
    note: 'Detection is heuristic. Items with "inferred": true were not observed directly.'
  }, null, 2);
}

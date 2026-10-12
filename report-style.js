/* report-style.js — the downloadable Style guide.
 *
 * A shareable design reference for the scanned site: palette (with accessibility grades and good/bad
 * text pairs), font specimens, type scale, spacing analysis, shapes and shadows, CSS variables, and
 * ready-to-copy token kits. Built from the same scan data and token names as the starter-kit export.
 */

const RP_STYLE_CSS = `
.sw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px}
.sw{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:var(--shadow)}
.sw-c{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;width:100%;height:96px;padding:11px 13px;border:0;border-bottom:1px solid var(--line);cursor:pointer;text-align:left;font:inherit}
.sw-c span{font:400 30px/1 var(--serif)}.sw-c small{font:600 11px var(--mono);opacity:.9}
.sw-c:hover{filter:brightness(1.05)}
.sw-b{padding:10px 13px 12px;display:grid;gap:2px}
.sw-b b{font-size:13px}.sw-b .mono{font-size:11px;color:var(--text2)}
.sw-grades{display:flex;gap:5px;margin-top:6px;flex-wrap:wrap}
.grade{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:99px;border:1px solid var(--line)}
.grade.ok{background:var(--ok-bg);color:var(--ok-fg);border-color:transparent}.grade.warn{background:var(--warn-bg);color:var(--warn-fg);border-color:transparent}.grade.bad{background:var(--bad-bg);color:var(--bad-fg);border-color:transparent}
.brand-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.brand-sw{border-radius:20px;padding:16px 16px 14px;min-height:130px;display:flex;flex-direction:column;justify-content:space-between;cursor:pointer;border:1px solid color-mix(in srgb,var(--text) 10%,transparent);text-align:left;font:inherit}
.brand-sw span{font:400 34px/1 var(--serif)}.brand-sw div{font:600 12px var(--mono)}
.pairs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;padding:14px 16px}
.pair{border-radius:12px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--text) 10%,transparent);display:flex;justify-content:space-between;align-items:center;gap:8px}
.pair b{font:400 22px/1 var(--serif)}.pair span{font:600 11px var(--mono);background:var(--surface);color:var(--text);padding:2px 8px;border-radius:99px;border:1px solid var(--line)}
.pal-row{display:flex;height:44px;border-radius:12px;overflow:hidden;border:1px solid var(--line)}
.pal-row i{flex:1;display:block}
.pal-label{font-size:12px;font-weight:600;margin:12px 0 6px;color:var(--text2)}
.spec{padding:0}
.spec-h{display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--line)}
.spec-h small{margin-left:auto;color:var(--text3);max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spec-body{padding:18px;display:grid;grid-template-columns:130px minmax(0,1fr);gap:22px;align-items:center}
.spec-aa{font-size:96px;line-height:1;text-align:center;color:var(--accent)}
.spec-lines>div{margin:2px 0;overflow-wrap:anywhere}
.wts{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;color:var(--text2);font-size:15px}
@media (max-width:620px){.spec-body{grid-template-columns:1fr}.spec-aa{font-size:64px}}
.scale-row{display:grid;grid-template-columns:132px minmax(0,1fr);gap:16px;align-items:baseline;padding:9px 18px;border-top:1px solid var(--line)}
.scale-row:first-child{border-top:0}
.scale-row span{font:600 11.5px var(--mono);color:var(--text2)}
.scale-row div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2}
.bar-row{display:grid;grid-template-columns:64px minmax(0,1fr) 54px;gap:14px;align-items:center;padding:7px 18px;border-top:1px solid var(--line)}
.bar-row:first-child{border-top:0}
.bar-row span{font:600 12px var(--mono)}.bar-row small{text-align:right;color:var(--text3);font-variant-numeric:tabular-nums}
.bar{height:12px;border-radius:6px;background:linear-gradient(90deg,#fb923c,#ea580c);min-width:3px}
.shapes{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:16px;padding:18px}
.shape{display:grid;gap:7px;justify-items:center;text-align:center;font:600 11px var(--mono);color:var(--text2)}
.shape i{display:block;width:72px;height:72px;background:var(--inset);border:2px solid var(--accent)}
.shape.sh i{border:1px solid var(--line);background:var(--surface)}
.var-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:14px;padding:8px 18px;border-top:1px solid var(--line);align-items:center;font:12px var(--mono)}
.var-row:first-child{border-top:0}.var-row span{color:var(--text2);overflow-wrap:anywhere}
.var-row .v{display:flex;align-items:center;gap:8px;overflow-wrap:anywhere}
.var-row .v i{width:16px;height:16px;border-radius:5px;border:1px solid var(--line2);flex-shrink:0}
.meter{display:grid;gap:8px;min-width:210px}
.meter div{display:grid;grid-template-columns:62px 1fr 30px;gap:9px;align-items:center;font-size:12px;color:var(--hero-dim)}
.meter i{display:block;height:5px;border-radius:9px;background:color-mix(in srgb,var(--hero-text) 14%,transparent);overflow:hidden}
.meter i b{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#fb923c,#ea580c)}
.chip.inferred{border-style:dashed;color:var(--text2)}
.hero .chip{background:var(--hero-glass);border-color:var(--hero-line);color:var(--hero-text)}
`;

function sgGrade(ratio) {
  if (ratio >= 7) return ['AAA', 'ok'];
  if (ratio >= 4.5) return ['AA', 'ok'];
  if (ratio >= 3) return ['AA large', 'warn'];
  return ['Fail', 'bad'];
}
function sgReadable(hex) { return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, '#111111') ? '#FFFFFF' : '#111111'; }
function sgRgb(hex) { const [r, g, b] = hexToRgbTriple(hex); return `rgb(${r}, ${g}, ${b})`; }
function sgHsl(hex) { const h = hexToHsl(hex); return `hsl(${Math.round(h.h)}, ${Math.round(h.s)}%, ${Math.round(h.l)}%)`; }
function sgIsColor(v) { return /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(String(v).trim()); }

function buildStyleGuideHtml(data) {
  const meta = data.meta || {};
  const url = meta.pageUrl || meta.canonical || '';
  const host = rpHostOf(url) || rpHostOf(meta.canonical || '');
  const title = meta.title || host || 'Style guide';
  const cons = computeDesignConsistencyScore(data);
  const vibe = computeSiteVibe(data).split(',').map(s => s.trim()).filter(Boolean);

  const colors = kitUniqueColors(data);
  const names = kitNameColors(colors);
  const textHex = new Set((data.colors || []).map(c => c.hex));
  const bgHex = new Set((data.bgColors || []).map(c => c.hex));
  const fonts = kitFontStacks(data);
  const sizes = kitFontSizes(data);
  const tokens = data.designTokens || {};
  let brand = (typeof identifyPrimaryBrandColor === 'function' && colors.length) ? identifyPrimaryBrandColor(data) : null;
  // the browser's default link blue is not a brand choice; prefer the next vivid color when there is one
  if (brand && brand.toUpperCase() === '#0000EE') {
    const alt = colors.map(c => ({ hex: c.hex, hsl: hexToHsl(c.hex) }))
      .filter(c => c.hex.toUpperCase() !== '#0000EE' && c.hsl && c.hsl.s > 18 && c.hsl.l > 20 && c.hsl.l < 85)
      .sort((a, b) => b.hsl.s - a.hsl.s)[0];
    if (alt) brand = alt.hex;
  }

  /* ---------- hero ---------- */
  const tile = (label, value) => `<div class="cat none"><span class="cat-top">${rpEsc(label)}</span><span class="cat-v">${value}</span></div>`;
  const hero = `<section class="hero" id="overview">
    <span class="eyebrow">Style guide</span>
    <h1>${rpEsc(title)}</h1>
    <div class="url">${url ? `<a href="${rpEsc(url)}">${rpEsc(url)}</a>` : ''}<span>${rpEsc(rpDate())}</span></div>
    ${vibe.length ? `<div class="chips" style="margin-top:14px">${vibe.map(v => rpChip(v)).join('')}</div>` : ''}
    <div class="hero-grid">
      <div class="score-big">${rpRing(cons.overall, 120)}<div class="verdict"><strong>Design consistency</strong>
        <div class="meter"><div><span>Colors</span><i><b style="width:${cons.colorScore}%"></b></i><span>${cons.colorScore}</span></div><div><span>Fonts</span><i><b style="width:${cons.fontScore}%"></b></i><span>${cons.fontScore}</span></div><div><span>Spacing</span><i><b style="width:${cons.spacingScore}%"></b></i><span>${cons.spacingScore}</span></div></div></div></div>
      <div class="cats">${tile('Colors', colors.length)}${tile('Font families', fonts.length)}${tile('Type sizes', sizes.length)}${tile('Spacing values', kitSpacing(data).length)}${tile('Corner radii', kitRadii(data).length)}${tile('Shadows', kitShadows(data).length)}</div>
    </div></section>`;

  /* ---------- colors ---------- */
  const swatch = (c) => {
    const hex = c.hex, fg = sgReadable(hex);
    const w = contrastRatio(hex, '#FFFFFF'), k = contrastRatio(hex, '#000000');
    const gw = sgGrade(w), gk = sgGrade(k);
    return `<div class="sw"><button type="button" class="sw-c" style="background:${rpEsc(hex)};color:${fg}" data-copy="${rpEsc(hex)}" title="Click to copy"><span>Aa</span><small>${rpEsc(hex)}</small></button>
      <div class="sw-b"><b>${rpEsc(names[hex])}</b><span class="mono">${rpEsc(sgRgb(hex))}</span><span class="mono">${rpEsc(sgHsl(hex))}</span>
      <div class="sw-grades"><span class="grade ${gw[1]}" title="Contrast with white text">White ${w.toFixed(1)} · ${gw[0]}</span><span class="grade ${gk[1]}" title="Contrast with black text">Black ${k.toFixed(1)} · ${gk[0]}</span></div></div></div>`;
  };
  const vivid = colors.filter(c => { const h = hexToHsl(c.hex); return h && h.s > 18 && h.l > 8 && h.l < 94; });
  const keyColors = (brand ? [colors.filter(c => c.hex === brand)[0]].filter(Boolean) : []).concat(vivid.filter(c => c.hex !== brand)).slice(0, 5);
  const brandRow = keyColors.length ? `<div class="brand-row">${keyColors.map((c, i) => `<button type="button" class="brand-sw" style="background:${rpEsc(c.hex)};color:${sgReadable(c.hex)}" data-copy="${rpEsc(c.hex)}"><span>${i === 0 ? 'Primary' : 'Accent'}</span><div>${rpEsc(names[c.hex])}<br>${rpEsc(c.hex)}</div></button>`).join('')}</div>` : '';

  const textColors = colors.filter(c => textHex.has(c.hex));
  const bgColors = colors.filter(c => bgHex.has(c.hex) && !textHex.has(c.hex));
  const group = (label, list) => list.length ? `<h3 class="pal-label">${label} · ${list.length}</h3><div class="sw-grid">${list.map(swatch).join('')}</div>` : '';

  // text/background pairs
  const pairs = [];
  (data.colors || []).slice(0, 10).forEach(t => (data.bgColors || []).slice(0, 8).forEach(b => { if (t.hex !== b.hex) pairs.push({ t: t.hex, b: b.hex, r: contrastRatio(t.hex, b.hex) }); }));
  const good = pairs.filter(p => p.r >= 4.5).sort((a, b) => b.r - a.r).slice(0, 12);
  const bad = pairs.filter(p => p.r < 4.5).sort((a, b) => a.r - b.r).slice(0, 8);
  const pairHtml = (p) => { const g = sgGrade(p.r); return `<div class="pair" style="background:${rpEsc(p.b)};color:${rpEsc(p.t)}"><b>Aa</b><span>${p.r.toFixed(1)} · ${g[0]}</span></div>`; };
  const pairsCard = (good.length || bad.length) ? `<div class="two">
    <div class="card"><div class="card-h">${rpIcon('check', 15)} Readable combinations <small>${good.length} of ${pairs.length} pairs</small></div>${good.length ? `<div class="pairs">${good.map(pairHtml).join('')}</div>` : '<div class="empty">No pair reaches 4.5 : 1.</div>'}</div>
    <div class="card"><div class="card-h">${rpIcon('alert', 15)} Pairs to avoid <small>below 4.5 : 1</small></div>${bad.length ? `<div class="pairs">${bad.map(pairHtml).join('')}</div>` : `<div class="empty">${rpIcon('check', 16)} Every pair is readable.</div>`}</div></div>` : '';

  const hover = [].concat(data.hoverColors || [], data.hoverBgColors || []).filter(c => c && c.hex).filter((c, i, a) => a.findIndex(x => x.hex === c.hex) === i);
  const grads = (data.gradients || []).filter(g => /^(repeating-)?(linear|radial|conic)-gradient/.test(g) && !/url\(/i.test(g)).slice(0, 8);
  const harmony = brand ? (() => {
    const hsl = hexToHsl(brand);
    const row = (label, arr) => `<div class="pal-label">${label}</div><div class="pal-row">${arr.map(h => `<i style="background:${h}" title="${h}"></i>`).join('')}</div>`;
    return `<div class="card"><div class="card-h">${rpIcon('palette', 15)} Suggested palettes from ${rpEsc(brand)}</div><div class="card-pad">${row('Analogous', generateAnalogousPalette(hsl))}${row('Monochromatic', generateMonochromaticPalette(hsl))}${row('Triadic', generateTriadicPalette(hsl))}</div></div>`;
  })() : '';

  const colorsSec = rpSection('s-colors', 'Foundations', 'Color', 'Click any swatch to copy its value. Grades show how readable white or black text is on each color (WCAG).',
    (brandRow ? `<div style="margin-bottom:22px">${brandRow}</div>` : '') +
    (colors.length ? group('Text colors', textColors) + group('Backgrounds and surfaces', bgColors) : '<div class="card"><div class="empty">No colors were detected.</div></div>') +
    (pairsCard ? `<h3 class="pal-label" style="margin-top:24px">Contrast of colors used together</h3>${pairsCard}` : '') +
    (hover.length ? `<div style="margin-top:6px">${group('Hover and state colors', hover)}</div>` : '') +
    (grads.length ? `<h3 class="pal-label" style="margin-top:22px">Gradients · ${grads.length}</h3><div class="sw-grid">${grads.map((g, i) => `<div class="sw"><button type="button" class="sw-c" style="background:${rpEsc(g)};color:#fff" data-copy="${rpEsc(g)}"><span>Aa</span><small>Click to copy</small></button><div class="sw-b"><b>Gradient ${i + 1}</b><span class="mono" style="overflow-wrap:anywhere">${rpEsc(rpTrunc(g, 90))}</span></div></div>`).join('')}</div>` : '') +
    (harmony ? `<div style="margin-top:22px">${harmony}</div>` : ''));

  /* ---------- typography ---------- */
  const labelFor = { sans: 'Sans-serif', serif: 'Serif', mono: 'Monospace' };
  const specimen = (f) => `<div class="card spec"><div class="spec-h"><b>${rpEsc(f.name)}</b>${rpChip(labelFor[f.role] || f.role)}<small class="mono" title="${rpEsc(f.stack)}">${rpEsc(f.stack)}</small></div>
    <div class="spec-body"><div class="spec-aa" style="font-family:${rpEsc(f.stack)}">Aa</div>
      <div class="spec-lines" style="font-family:${rpEsc(f.stack)}"><div style="font-size:34px;line-height:1.15">The quick brown fox jumps over the lazy dog</div><div style="font-size:17px;color:var(--text2)">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz</div><div style="font-size:15px;color:var(--text2)">0123456789 &amp; ! ? @ # % ( ) — “ ”</div>
        <div class="wts">${[400, 500, 600, 700].map(w => `<span style="font-weight:${w}">${w === 400 ? 'Regular' : w === 500 ? 'Medium' : w === 600 ? 'Semibold' : 'Bold'} ${w}</span>`).join('')}</div></div></div></div>`;
  const primaryStack = fonts.length ? fonts[0].stack : 'inherit';
  const scaleRows = sizes.map(px => `<div class="scale-row"><span>${Math.round(px * 10) / 10}px ·${(px / 16).toFixed(2).replace(/\.?0+$/, '')}rem</span><div style="font-family:${rpEsc(primaryStack)};font-size:${Math.min(px, 56)}px">The quick brown fox jumps over the lazy dog</div></div>`).join('');
  const typeSec = rpSection('s-type', 'Foundations', 'Typography', 'The font families in use and the sizes they are set at.',
    (fonts.length ? fonts.map(specimen).join('') : '<div class="card"><div class="empty">No fonts were detected.</div></div>') +
    (sizes.length ? `<div class="card"><div class="card-h">${rpIcon('type', 15)} Type scale <small>${rpPlural(sizes.length, 'size')}${sizes.some(s => s > 56) ? ' · previews capped at 56px' : ''}</small></div>${scaleRows}</div>` : ''));

  /* ---------- spacing ---------- */
  const counts = kitPxNumbers([].concat(tokens.margins || [], tokens.paddings || [], tokens.gaps || []), 200);
  const topVals = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a]).slice(0, 14).sort((a, b) => a - b);
  const maxV = Math.max.apply(null, topVals.concat([1]));
  const totalC = Object.keys(counts).reduce((s, k) => s + counts[k], 0) || 1;
  const on8 = Object.keys(counts).reduce((s, k) => s + (Number(k) % 8 === 0 ? counts[k] : 0), 0) / totalC;
  const on4 = Object.keys(counts).reduce((s, k) => s + (Number(k) % 4 === 0 ? counts[k] : 0), 0) / totalC;
  const spaceSec = rpSection('s-space', 'Foundations', 'Spacing', 'The margin, padding and gap values used most, with how often each appears.',
    `<div class="card"><div class="stats">${rpStat('On an 8px grid', Math.round(on8 * 100) + '%')}${rpStat('On a 4px grid', Math.round(on4 * 100) + '%')}${rpStat('Distinct values', Object.keys(counts).length)}</div>
    ${topVals.length ? topVals.map(v => `<div class="bar-row"><span>${v}px</span><div class="bar" style="width:${Math.max(3, v / maxV * 100)}%"></div><small>${counts[v]}×</small></div>`).join('') : '<div class="empty">No spacing values were detected.</div>'}</div>
    ${Object.keys(counts).length > topVals.length ? `<p class="muted" style="margin-top:8px;font-size:12px">Showing the ${topVals.length} most used of ${Object.keys(counts).length} values.</p>` : ''}`);

  /* ---------- shapes and depth ---------- */
  const radii = (tokens.radii || []).slice(0, 10);
  const shadows = (tokens.shadows || []).slice(0, 8);
  const zs = (tokens.zIndexes || []).slice(0, 14);
  const shapeSec = rpSection('s-shape', 'Foundations', 'Shape and depth', 'Corner radii, shadows and stacking order.',
    `<div class="two"><div class="card"><div class="card-h">Corner radius <small>${radii.length}</small></div>${radii.length ? `<div class="shapes">${radii.map(r => `<div class="shape"><i style="border-radius:${rpEsc(r.value)}"></i>${rpEsc(r.value)}</div>`).join('')}</div>` : '<div class="empty">No radii detected.</div>'}</div>
      <div class="card"><div class="card-h">Shadows <small>${shadows.length}</small></div>${shadows.length ? `<div class="shapes">${shadows.map((s, i) => `<div class="shape sh"><i style="border-radius:12px;box-shadow:${rpEsc(s.value)}"></i>Shadow ${i + 1}</div>`).join('')}</div>` : '<div class="empty">No shadows detected.</div>'}</div></div>
    ${zs.length ? `<div class="card"><div class="card-h">Z-index values <small>${zs.length}</small></div><div class="card-pad"><div class="chips">${zs.map(z => rpChip(String(z.value) + (z.count > 1 ? ' ×' + z.count : ''))).join('')}</div></div></div>` : ''}`);

  /* ---------- CSS variables ---------- */
  const props = (tokens.customProperties || []).slice(0, 40).map(p => { const i = p.indexOf(':'); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; });
  const varsSec = props.length ? rpSection('s-vars', 'Reference', 'CSS custom properties', 'Variables declared on :root by the site\'s own stylesheets.',
    `<div class="card">${props.map(([k, v]) => `<div class="var-row"><span>${rpEsc(k)}</span><span class="v">${sgIsColor(v) ? `<i style="background:${rpEsc(v)}"></i>` : ''}${rpEsc(v)}</span></div>`).join('')}</div>`) : '';

  /* ---------- token kits ---------- */
  const kit = (fmt, label) => { const k = buildStarterKit(data, fmt); return rpCode(k.text, `${label} · .${k.ext}`); };
  const kitSec = rpSection('s-kit', 'Reference', 'Design tokens', 'The same palette, fonts, spacing and radii as ready-to-use code. Token names describe the value (for example orange-600 or space-16).',
    `<div class="two">${kit('css', 'CSS variables')}${kit('tailwind', 'Tailwind config')}</div><div class="two" style="margin-top:14px">${kit('figma', 'Design tokens JSON')}${kit('scss', 'SCSS variables')}</div>`);

  const nav = [['overview', 'Overview'], ['s-colors', 'Color'], ['s-type', 'Typography'], ['s-space', 'Spacing'], ['s-shape', 'Shape and depth']].concat(varsSec ? [['s-vars', 'CSS variables']] : [], [['s-kit', 'Design tokens']]);
  const headExtra = RP_STYLE_CSS ? `<style>${RP_STYLE_CSS}</style>` + (data.fontStyles || []).map(fs => {
    if (fs.type === 'link') return `<link rel="stylesheet" href="${rpEsc(fs.href)}">`;
    if (fs.type === 'style') return `<style>${String(fs.cssText || '').replace(/<\/style/gi, '<\\/style')}</style>`;
    return '';
  }).join('\n') : '';

  return rpDocument({
    kind: 'Style guide', title, host, nav, headExtra,
    note: 'Colors, fonts and spacing are read from the computed styles of the page at scan time. Token names are generated from the values.',
    body: hero + colorsSec + typeSec + spaceSec + shapeSec + varsSec + kitSec
  });
}

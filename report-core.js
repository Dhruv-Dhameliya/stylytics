/* report-core.js — shared design system for the reports Stylytics exports (page report, style guide).
 *
 * Reports are single, self-contained HTML files: they work offline, print to a clean PDF, follow the
 * viewer's light/dark preference (with a toggle), and carry a little script for copy buttons and a
 * scroll-aware table of contents. Everything here returns strings; nothing touches the panel's DOM.
 */

/* ------------------------------------------------------------------ small helpers */
const rpEsc = (s) => escapeHtml(s == null ? '' : s);
function rpVersion() { try { return chrome.runtime.getManifest().version; } catch (e) { return ''; } }
function rpDate() { return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
function rpTime() { return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
function rpHostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function rpTierOf(score) { return score == null ? 'none' : score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'bad'; }
function rpTierWord(score) { return score == null ? 'Not measured' : score >= 80 ? 'Good' : score >= 50 ? 'Fair' : 'Needs work'; }
function rpSevOf(sev) { return sev === 'High' ? 'bad' : sev === 'Medium' ? 'warn' : 'info'; }
function rpPlural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }
function rpTrunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

/* ------------------------------------------------------------------ icons (inline, stroke currentColor) */
const RP_ICONS = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.4 0-1.1.9-2 2-2h2.4c2.3 0 4.1-1.8 4.1-4.1C21.5 6 17.2 2 12 2z"/>',
  a11y: '<circle cx="12" cy="4" r="1.5"/><path d="M4 8l8 2 8-2M12 10v5m0 0l-3 7m3-7l3 7"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  chip: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>',
  mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'
};
function rpIcon(name, size) {
  const s = size || 16;
  return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RP_ICONS[name] || ''}</svg>`;
}

/* ------------------------------------------------------------------ building blocks */
// circular score gauge
function rpRing(score, size, uid) {
  const r = 36, c = 2 * Math.PI * r;
  const has = score != null;
  const pct = has ? Math.max(0, Math.min(100, score)) : 0;
  return `<svg class="ring ${rpTierOf(score)}" width="${size || 96}" height="${size || 96}" viewBox="0 0 90 90" role="img" aria-label="${has ? 'Score ' + score + ' of 100' : 'Not measured'}">
    <circle class="trk" cx="45" cy="45" r="${r}"/>
    <circle class="val" cx="45" cy="45" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 45 45)"/>
    <text x="45" y="${has ? 53 : 52}" text-anchor="middle" class="num">${has ? score : '—'}</text></svg>`;
}
// one tick per check: green for passed, severity color for an issue
function rpTicks(passCount, issues) {
  const t = [];
  for (let i = 0; i < passCount; i++) t.push('<i class="ok"></i>');
  issues.forEach(it => t.push(`<i class="${rpSevOf(it.sev)}"></i>`));
  return `<div class="ticks" aria-hidden="true">${t.join('')}</div>`;
}
function rpSevPill(sev) { return `<span class="sev ${rpSevOf(sev)}">${rpEsc(sev)}</span>`; }
function rpChip(text, cls) { return `<span class="chip${cls ? ' ' + cls : ''}">${rpEsc(text)}</span>`; }
function rpStatus(kind, text) { return `<span class="stat ${kind}">${rpEsc(text)}</span>`; }

// label / value rows. rows: [label, valueHtml, optionalStatusHtml]
function rpKV(rows) {
  return `<dl class="kv">${rows.filter(Boolean).map(r => `<div class="kv-row"><dt>${rpEsc(r[0])}</dt><dd>${r[1] == null || r[1] === '' ? '<span class="muted">Not detected</span>' : r[1]}${r[2] ? ' ' + r[2] : ''}</dd></div>`).join('')}</dl>`;
}
function rpStat(label, value, sub) {
  return `<div class="stat-cell"><b>${value}</b><span>${rpEsc(label)}</span>${sub ? `<small>${rpEsc(sub)}</small>` : ''}</div>`;
}
function rpCode(text, label, id) {
  const cid = id || 'c' + Math.random().toString(36).slice(2, 8);
  return `<div class="code"><div class="code-h"><span>${rpEsc(label || 'Code')}</span><button type="button" data-copy-target="${cid}">${rpIcon('copy', 13)} Copy</button></div><pre id="${cid}">${rpEsc(text)}</pre></div>`;
}
function rpSection(id, eyebrow, title, intro, body) {
  return `<section class="block" id="${id}">
    <header class="block-h"><span class="eyebrow">${rpEsc(eyebrow)}</span><h2>${rpEsc(title)}</h2>${intro ? `<p class="intro">${intro}</p>` : ''}</header>
    ${body}</section>`;
}

/* ------------------------------------------------------------------ stylesheet */
const RP_CSS = `
:root{
  --bg:#f6f5f3;--surface:#ffffff;--inset:#f2f1ee;--line:#e7e5e0;--line2:#d6d3cc;
  --text:#18181b;--text2:#5a5a63;--text3:#8a8a93;--accent:#ea580c;--accent-d:#c2410c;--accent-soft:#fff1e6;
  --ok:#16a34a;--warn:#d97706;--bad:#dc2626;--info:#0284c7;
  --ok-bg:#dcfce7;--ok-fg:#166534;--warn-bg:#fef3c7;--warn-fg:#92400e;--bad-bg:#fee2e2;--bad-fg:#b91c1c;--info-bg:#e0f2fe;--info-fg:#075985;
  --shadow:0 1px 2px rgba(24,24,40,.05),0 14px 30px -20px rgba(24,24,40,.3);
  --hero:radial-gradient(120% 90% at 0% 0%,rgba(249,115,22,.22),transparent 56%),radial-gradient(90% 80% at 100% 0%,rgba(219,39,119,.13),transparent 60%),linear-gradient(165deg,#ffffff,#fffaf6);
  --hero-line:var(--line);--hero-glass:rgba(255,255,255,.8);--hero-text:var(--text);--hero-dim:var(--text2);
  --serif:'Instrument Serif',Georgia,'Times New Roman',serif;--sans:'Instrument Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color-scheme:light;
}
:root[data-theme="dark"]{
  --bg:#0f0f12;--surface:#18181c;--inset:#202025;--line:#2b2b31;--line2:#3a3a42;
  --text:#f4f4f2;--text2:#a8a8b1;--text3:#74747d;--accent:#fb923c;--accent-d:#fdba74;--accent-soft:#2e1c0e;
  --ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--info:#38bdf8;
  --ok-bg:#0f2e1d;--ok-fg:#86efac;--warn-bg:#3a2a0c;--warn-fg:#fcd34d;--bad-bg:#3b1414;--bad-fg:#fca5a5;--info-bg:#0f2e42;--info-fg:#7dd3fc;
  --shadow:0 1px 2px rgba(0,0,0,.4);
  --hero:radial-gradient(120% 90% at 0% 0%,rgba(249,115,22,.4),transparent 56%),radial-gradient(90% 80% at 100% 0%,rgba(219,39,119,.22),transparent 60%),linear-gradient(165deg,#1f1f27,#121217);
  --hero-line:rgba(255,255,255,.1);--hero-glass:rgba(255,255,255,.07);--hero-text:#fff;--hero-dim:rgba(255,255,255,.72);
  color-scheme:dark;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0f0f12;--surface:#18181c;--inset:#202025;--line:#2b2b31;--line2:#3a3a42;
  --text:#f4f4f2;--text2:#a8a8b1;--text3:#74747d;--accent:#fb923c;--accent-d:#fdba74;--accent-soft:#2e1c0e;
  --ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--info:#38bdf8;
  --ok-bg:#0f2e1d;--ok-fg:#86efac;--warn-bg:#3a2a0c;--warn-fg:#fcd34d;--bad-bg:#3b1414;--bad-fg:#fca5a5;--info-bg:#0f2e42;--info-fg:#7dd3fc;
  --shadow:0 1px 2px rgba(0,0,0,.4);
  --hero:radial-gradient(120% 90% at 0% 0%,rgba(249,115,22,.4),transparent 56%),radial-gradient(90% 80% at 100% 0%,rgba(219,39,119,.22),transparent 60%),linear-gradient(165deg,#1f1f27,#121217);
  --hero-line:rgba(255,255,255,.1);--hero-glass:rgba(255,255,255,.07);--hero-text:#fff;--hero-dim:rgba(255,255,255,.72);
  color-scheme:dark;}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
a{color:var(--accent-d);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3,h4,p{margin:0}
.ic{flex-shrink:0;vertical-align:-3px}
.muted{color:var(--text3)}
.mono{font-family:var(--mono);font-size:.92em}

/* top bar + layout */
.topbar{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 86%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.topbar-in{max-width:1180px;margin:0 auto;padding:10px 22px;display:flex;align-items:center;gap:12px}
.brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:13px;color:var(--text)}
.brand svg{border-radius:8px}
.brand small{display:block;font-weight:500;color:var(--text3);font-size:11px;margin-top:-2px}
.topbar .sp{flex:1}
.tb-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border:1px solid var(--line2);border-radius:99px;background:var(--surface);color:var(--text);font:600 12px var(--sans);cursor:pointer}
.tb-btn:hover{background:var(--inset)}
.tb-btn.pri{background:linear-gradient(135deg,#ea580c,#c2410c);border-color:transparent;color:#fff}
.layout{max-width:1180px;margin:0 auto;padding:26px 22px 70px;display:grid;grid-template-columns:196px minmax(0,1fr);gap:34px}
.toc{position:sticky;top:74px;align-self:start;font-size:12.5px}
.toc b{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin:0 0 8px 10px}
.toc a{display:block;padding:6px 10px;border-radius:9px;color:var(--text2);font-weight:500}
.toc a:hover{background:var(--inset);text-decoration:none;color:var(--text)}
.toc a.on{background:var(--accent-soft);color:var(--accent-d);font-weight:600}
main{min-width:0}
@media (max-width:920px){.layout{grid-template-columns:1fr}.toc{display:none}.topbar-in{padding:10px 16px}.layout{padding:20px 16px 60px}}

/* hero */
.hero{position:relative;overflow:hidden;border:1px solid var(--hero-line);border-radius:26px;background:var(--hero);color:var(--hero-text);padding:30px 30px 26px;box-shadow:var(--shadow)}
.hero::before{content:"";position:absolute;inset:0;background-image:linear-gradient(color-mix(in srgb,var(--hero-text) 5%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--hero-text) 5%,transparent) 1px,transparent 1px);background-size:26px 26px;-webkit-mask-image:radial-gradient(110% 80% at 100% 0%,#000,transparent 70%);mask-image:radial-gradient(110% 80% at 100% 0%,#000,transparent 70%);pointer-events:none}
.hero>*{position:relative}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent-d)}
.hero .eyebrow{color:var(--hero-dim)}
.hero h1{font:400 38px/1.08 var(--serif);letter-spacing:-.015em;margin:8px 0 10px;max-width:24ch;text-wrap:balance}
.hero .url{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;color:var(--hero-dim);font-size:12.5px}
.hero .url a{color:var(--hero-text);font-weight:600}
.hero-grid{display:grid;grid-template-columns:auto minmax(0,1fr);gap:26px;align-items:center;margin-top:24px}
.score-big{display:flex;align-items:center;gap:16px}
.score-big .ring{width:132px;height:132px}
.score-big .verdict{display:flex;flex-direction:column;gap:6px}
.score-big .verdict strong{font:400 22px/1.1 var(--serif)}
.sevrow{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--hero-dim)}
.sevrow span{display:inline-flex;align-items:center;gap:6px}
.sevrow i{width:8px;height:8px;border-radius:50%}
i.bad,.dot.bad{background:var(--bad)}i.warn,.dot.warn{background:var(--warn)}i.info,.dot.info{background:var(--info)}i.ok,.dot.ok{background:var(--ok)}
.cats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.cat{display:flex;flex-direction:column;gap:7px;padding:12px 13px;border:1px solid var(--hero-line);border-radius:16px;background:var(--hero-glass);color:var(--hero-text);text-decoration:none!important}
.cat:hover{border-color:var(--accent)}
.cat-top{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--hero-dim)}
.cat-v{font:400 32px/1 var(--serif);font-variant-numeric:lining-nums}
.cat-bar{height:4px;border-radius:9px;background:color-mix(in srgb,var(--hero-text) 14%,transparent);overflow:hidden}
.cat-bar i{display:block;height:100%;border-radius:9px}
.cat.ok .cat-bar i{background:linear-gradient(90deg,#10b981,#4ade80)}.cat.warn .cat-bar i{background:linear-gradient(90deg,#f59e0b,#fbbf24)}.cat.bad .cat-bar i{background:linear-gradient(90deg,#f43f5e,#fb7185)}
.hero-foot{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:20px;padding-top:16px;border-top:1px solid var(--hero-line);font-size:12px;color:var(--hero-dim)}
@media (max-width:760px){.hero{padding:22px 18px}.hero h1{font-size:28px}.hero-grid{grid-template-columns:1fr}.cats{grid-template-columns:repeat(2,minmax(0,1fr))}}

/* sections */
.block{margin-top:44px;scroll-margin-top:76px}
.block-h{margin-bottom:16px}
.block-h h2{font:400 30px/1.1 var(--serif);letter-spacing:-.01em;margin:4px 0 6px}
.intro{color:var(--text2);max-width:68ch}
.card{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}
.card+.card,.card+.two,.two+.card,.two+.two{margin-top:14px}
.two>.card{margin-top:0}
.card-pad{padding:16px 18px}
.card-h{display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--line);font-weight:600}
.card-h small{color:var(--text3);font-weight:500;margin-left:auto}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
@media (max-width:760px){.two,.three{grid-template-columns:1fr}}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr))}
.stat-cell{padding:14px 16px;border-left:1px solid var(--line)}
.stat-cell:first-child{border-left:0}
.stat-cell b{display:block;font:400 30px/1 var(--serif);font-variant-numeric:lining-nums}
.stat-cell span{font-size:12px;color:var(--text2)}
.stat-cell small{display:block;font-size:11px;color:var(--text3)}

/* pills, chips */
.sev,.stat,.chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap}
.sev.bad,.stat.bad{background:var(--bad-bg);color:var(--bad-fg)}.sev.warn,.stat.warn{background:var(--warn-bg);color:var(--warn-fg)}
.sev.info,.stat.info{background:var(--info-bg);color:var(--info-fg)}.stat.ok{background:var(--ok-bg);color:var(--ok-fg)}.stat.none{background:var(--inset);color:var(--text2)}
.chip{background:var(--inset);color:var(--text);font-weight:500;border:1px solid var(--line)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}

/* key/value */
.kv{margin:0}
.kv-row{display:grid;grid-template-columns:170px minmax(0,1fr);gap:14px;padding:10px 18px;border-top:1px solid var(--line)}
.kv-row:first-child{border-top:0}
.kv dt{color:var(--text2);font-size:12.5px;font-weight:500}
.kv dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
@media (max-width:620px){.kv-row{grid-template-columns:1fr;gap:2px}}

/* action plan + checks */
.plan{counter-reset:p}
.plan-group{margin-top:14px}
.plan-group>h3{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:0 0 8px}
.task{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:12px;align-items:start;padding:13px 16px;border-top:1px solid var(--line)}
.task:first-child{border-top:0}
.task input{margin-top:3px;width:16px;height:16px;accent-color:var(--accent)}
.task b{display:block;font-size:13.5px}
.task small{display:block;color:var(--text2);font-size:12.5px;margin-top:1px}
.task .fix{margin-top:6px;font-size:12.5px;color:var(--text)}
.task .fix em{font-style:normal;font-weight:600;color:var(--text2)}
.task.done b{text-decoration:line-through;color:var(--text3)}
.task .meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.chk{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:12px;align-items:start;padding:11px 16px;border-top:1px solid var(--line)}
.chk:first-child{border-top:0}
.mk{display:grid;place-items:center;width:22px;height:22px;border-radius:50%}
.chk.pass .mk{background:var(--ok-bg);color:var(--ok)}.chk.fail .mk{background:var(--bad-bg);color:var(--bad)}
.chk b{display:block;font-size:13px;font-weight:600}
.chk small{display:block;color:var(--text2);font-size:12.5px}
details.chk-d{border-top:1px solid var(--line)}
details.chk-d:first-child{border-top:0}
details.chk-d>summary{list-style:none;cursor:pointer}
details.chk-d>summary::-webkit-details-marker{display:none}
details.chk-d>summary .chk{border-top:0}
details.chk-d[open]>summary{background:var(--inset)}
.chk-body{padding:4px 18px 16px 50px;display:grid;gap:10px;font-size:13px}
.chk-body h4{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:2px}
.cat-head{display:flex;align-items:center;gap:18px;padding:18px}
.cat-head .ring{width:84px;height:84px}
.cat-head h3{font:400 24px/1.1 var(--serif)}
.cat-head p{color:var(--text2);font-size:13px;margin-top:2px}
.ticks{display:flex;gap:3px;margin-top:9px;max-width:420px}
.ticks i{flex:1;height:6px;border-radius:3px}
.fold>summary{padding:12px 18px;font-weight:600;font-size:13px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;border-top:1px solid var(--line);background:var(--inset)}
.fold>summary::-webkit-details-marker{display:none}
.fold>summary::after{content:"";margin-left:auto;width:7px;height:7px;border-right:2px solid var(--text3);border-bottom:2px solid var(--text3);transform:rotate(45deg);transition:transform .15s}
.fold[open]>summary::after{transform:rotate(-135deg)}

/* gauges */
.ring .trk{fill:none;stroke:color-mix(in srgb,var(--text) 10%,transparent);stroke-width:8}
.ring .val{fill:none;stroke-width:8;stroke-linecap:round}
.ring.ok .val{stroke:var(--ok)}.ring.warn .val{stroke:var(--warn)}.ring.bad .val{stroke:var(--bad)}.ring.none .val{stroke:transparent}
.ring .num{font:400 30px var(--serif);fill:currentColor;font-variant-numeric:lining-nums}
.hero .ring .trk{stroke:color-mix(in srgb,var(--hero-text) 16%,transparent)}

/* previews */
.serp{background:#fff;color:#202124;border:1px solid #e3e3e3;border-radius:14px;padding:14px 16px;font-family:Arial,sans-serif}
.serp .u{font-size:12px;color:#4d5156}.serp .t{font-size:19px;color:#1a0dab;margin:3px 0 4px;line-height:1.25}.serp .d{font-size:13px;color:#4d5156;line-height:1.5}
.serp.m{max-width:360px}
.social{background:#fff;color:#202124;border:1px solid #e3e3e3;border-radius:14px;overflow:hidden;max-width:440px;font-family:Arial,sans-serif}
.social .img{aspect-ratio:1.91/1;background:#eceef2 center/cover no-repeat;display:grid;place-items:center;color:#8b93a1;font-size:12px}
.social .bd{padding:10px 14px;font-size:12px}.social .bd small{display:block;color:#6b7280;text-transform:uppercase;font-size:10.5px}.social .bd b{display:block;font-size:15px;margin:2px 0}
.social .bd span{color:#6b7280}

/* outline */
.outline{padding:10px 18px 14px}
.outline div{display:flex;align-items:baseline;gap:9px;padding:3px 0}
.outline em{font-style:normal;font-size:10.5px;font-weight:700;color:var(--text3);width:22px;flex-shrink:0}
.counts{display:grid;grid-template-columns:repeat(6,1fr);border-bottom:1px solid var(--line)}
.counts div{padding:10px;text-align:center;border-left:1px solid var(--line)}.counts div:first-child{border-left:0}
.counts b{display:block;font:400 24px/1 var(--serif)}.counts span{font-size:11px;color:var(--text3)}

/* vitals */
.vitals{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.vital{padding:14px 16px;border-left:1px solid var(--line);border-top:1px solid var(--line)}
.vital span{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text2)}
.vital b{display:block;font:400 28px/1.1 var(--serif);margin:4px 0 8px}
.gauge{height:5px;border-radius:9px;background:linear-gradient(90deg,var(--ok) 0 var(--g1),var(--warn) var(--g1) var(--g2),var(--bad) var(--g2) 100%);position:relative}
.gauge i{position:absolute;top:-3px;width:3px;height:11px;border-radius:2px;background:var(--text);transform:translateX(-50%)}
.vital small{display:block;margin-top:7px;color:var(--text3);font-size:11px}

/* code */
.code{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface)}
.code-h{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--inset);font-size:12px;font-weight:600;color:var(--text2)}
.code-h button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line2);background:var(--surface);color:var(--text);border-radius:99px;height:26px;padding:0 11px;font:600 11.5px var(--sans);cursor:pointer}
.code-h button.done{background:var(--ok-bg);color:var(--ok-fg);border-color:transparent}
.code pre{margin:0;padding:12px 14px;overflow:auto;max-height:340px;font:12px/1.6 var(--mono);color:var(--text)}
.snippet{font:12px/1.5 var(--mono);background:var(--inset);padding:8px 10px;border-radius:10px;overflow-wrap:anywhere}

/* lists */
.plain{list-style:none;margin:0;padding:0}
.plain li{display:flex;gap:10px;align-items:baseline;padding:8px 18px;border-top:1px solid var(--line)}
.plain li:first-child{border-top:0}
.plain li .n{margin-left:auto;color:var(--text3);font-variant-numeric:tabular-nums;font-size:12px}
.empty{padding:22px;text-align:center;color:var(--text3);font-size:13px}

footer.rp-foot{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);color:var(--text3);font-size:12px;display:grid;gap:6px}
footer.rp-foot b{color:var(--text2)}

/* print: clean, light, everything open */
@media print{
  :root:root:root{--bg:#fff;--surface:#fff;--inset:#f4f4f4;--line:#e4e4e4;--line2:#d0d0d0;--text:#111;--text2:#444;--text3:#777;--accent:#ea580c;--accent-d:#c2410c;--accent-soft:#fff1e6;
    --ok:#16a34a;--warn:#d97706;--bad:#dc2626;--info:#0284c7;--ok-bg:#dcfce7;--ok-fg:#166534;--warn-bg:#fef3c7;--warn-fg:#92400e;--bad-bg:#fee2e2;--bad-fg:#b91c1c;--info-bg:#e0f2fe;--info-fg:#075985;
    --shadow:none;--hero:linear-gradient(165deg,#fff,#fffaf6);--hero-line:#ddd;--hero-glass:#fafafa;--hero-text:#111;--hero-dim:#555;color-scheme:light}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-size:12px;background:#fff}
  .topbar,.toc,[data-print],[data-copy-target],.tb-btn{display:none!important}
  .layout{display:block;padding:0}
  .hero,.card,.cat,.serp,.social,.code{break-inside:avoid}
  .block{break-inside:auto;margin-top:26px}
  .card{box-shadow:none}
  a{color:inherit}
}
`;

/* ------------------------------------------------------------------ script (copy, theme, print, scroll-spy) */
const RP_JS = `
(function () {
  var root = document.documentElement;
  try { var t = localStorage.getItem('stylytics-report-theme'); if (t) root.setAttribute('data-theme', t); } catch (e) {}
  function copy(text, btn) {
    function done() { if (!btn) return; var old = btn.innerHTML; btn.classList.add('done'); btn.textContent = 'Copied'; setTimeout(function () { btn.classList.remove('done'); btn.innerHTML = old; }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); } else { fallback(); }
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} ta.remove(); }
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-copy-target]');
    if (el) { var pre = document.getElementById(el.getAttribute('data-copy-target')); if (pre) copy(pre.textContent, el); return; }
    el = e.target.closest('[data-copy]');
    if (el) { copy(el.getAttribute('data-copy'), el.hasAttribute('data-quiet') ? null : el); return; }
    el = e.target.closest('[data-copy-tasks]');
    if (el) {
      var lines = [].map.call(document.querySelectorAll('.task'), function (t) {
        var done = t.querySelector('input').checked ? 'x' : ' ';
        return '- [' + done + '] ' + t.getAttribute('data-md');
      });
      copy(lines.join('\\n'), el); return;
    }
    if (e.target.closest('[data-theme-toggle]')) {
      var dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
      var next = dark ? 'light' : 'dark'; root.setAttribute('data-theme', next);
      try { localStorage.setItem('stylytics-report-theme', next); } catch (err) {} return;
    }
    if (e.target.closest('[data-print]')) { window.print(); }
  });
  document.addEventListener('change', function (e) {
    var cb = e.target.closest('.task input'); if (cb) cb.closest('.task').classList.toggle('done', cb.checked);
  });
  window.addEventListener('beforeprint', function () { [].forEach.call(document.querySelectorAll('details'), function (d) { d.setAttribute('data-was', d.open ? '1' : '0'); d.open = true; }); });
  window.addEventListener('afterprint', function () { [].forEach.call(document.querySelectorAll('details[data-was]'), function (d) { d.open = d.getAttribute('data-was') === '1'; d.removeAttribute('data-was'); }); });
  var links = [].slice.call(document.querySelectorAll('.toc a'));
  if (links.length && 'IntersectionObserver' in window) {
    var map = {}; links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { var a = map[en.target.id]; if (en.isIntersecting && a) { links.forEach(function (l) { l.classList.remove('on'); }); a.classList.add('on'); } });
    }, { rootMargin: '-80px 0px -65% 0px' });
    [].forEach.call(document.querySelectorAll('section.block'), function (s) { if (map[s.id]) io.observe(s); });
  }
})();
`;

/* ------------------------------------------------------------------ the document shell */
const RP_LOGO = '<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="rpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#rpg)"/><path d="M21.5 11.2c-1-1.7-2.9-2.7-5.2-2.7-3 0-5 1.5-5 3.8 0 2.3 1.7 3.2 4.7 3.9 2.6.6 3.4 1 3.4 1.9 0 1-1 1.7-2.6 1.7-1.7 0-3-.8-3.7-2.2l-2.6 1.6c1.1 2.2 3.4 3.6 6.3 3.6 3.3 0 5.4-1.6 5.4-4.1 0-2.4-1.6-3.4-4.7-4.1-2.4-.5-3.3-.9-3.3-1.7 0-.8.8-1.4 2.1-1.4 1.3 0 2.3.6 2.9 1.6z" fill="#fff"/></svg>';

function rpDocument(o) {
  const nav = (o.nav || []).map(n => `<a href="#${n[0]}">${rpEsc(n[1])}</a>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${rpEsc(o.kind)} — ${rpEsc(o.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif&display=swap">
<style>${RP_CSS}</style>
${o.headExtra || ''}
</head>
<body>
<header class="topbar"><div class="topbar-in">
  <div class="brand">${RP_LOGO}<div>Stylytics<small>${rpEsc(o.kind)}${o.host ? ' · ' + rpEsc(o.host) : ''}</small></div></div>
  <span class="sp"></span>
  ${(o.actions || '')}
  <button class="tb-btn" type="button" data-theme-toggle aria-label="Toggle dark mode">${rpIcon('moon', 14)} Theme</button>
  <button class="tb-btn pri" type="button" data-print>${rpIcon('print', 14)} Print / PDF</button>
</div></header>
<div class="layout">
  <nav class="toc" aria-label="Contents"><b>Contents</b>${nav}</nav>
  <main>
${o.body}
    <footer class="rp-foot">
      <div><b>Generated by Stylytics${rpVersion() ? ' ' + rpEsc(rpVersion()) : ''}</b> on ${rpEsc(rpDate())} at ${rpEsc(rpTime())}.</div>
      <div>${o.note || 'Findings are automated heuristics: useful signals to review, not guarantees. Always verify important changes on the live page.'}</div>
    </footer>
  </main>
</div>
<script>${RP_JS}</script>
</body>
</html>`;
}

/* report-compare.js — the downloadable comparison of two pages (compare.js).
 * Same document shell as the other reports (report-core.js); reuses the table styles of the site report. */

const RP_CMP_CSS = `
.vs{display:grid;grid-template-columns:1fr auto 1fr;gap:20px;align-items:center}
.vs .side{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;min-width:0}
.vs .side b{font-size:15px;overflow-wrap:anywhere}.vs .side small{color:var(--hero-sub,var(--text3));overflow-wrap:anywhere}
.vs .mid{font:600 12px var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--hero-sub,var(--text3))}
.tbl td.w{font-weight:700}
.dl{font:700 12px var(--sans);font-variant-numeric:tabular-nums}.dl.ok{color:var(--ok-fg)}.dl.bad{color:var(--bad-fg)}.dl.eq{color:var(--text3)}
.cols3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.cols3 .card{margin:0}
.txt{display:block;overflow-wrap:anywhere}.txt i{color:var(--text3)}
@media(max-width:700px){.vs{grid-template-columns:1fr}.vs .mid{text-align:center}.cols3{grid-template-columns:1fr}}
`;

function rcDelta(x, y, lower, f) {
  if (x == null || y == null) return '';
  const d = y - x;
  if (d === 0) return '<span class="dl eq">same</span>';
  return `<span class="dl ${(lower ? d < 0 : d > 0) ? 'ok' : 'bad'}">${d > 0 ? '+' : '−'}${f ? f(Math.abs(d)) : Math.abs(Math.round(d * 100) / 100)}</span>`;
}

function buildCompareReportHtml(A, B, at) {
  const na = cmpName(A, B), nb = cmpName(B, A);
  const hostA = rpHostOf(A.url), hostB = rpHostOf(B.url);
  const side = (rec, name) => `<div class="side">${rpRing(rec.composite, 112, 'rc' + (name === na ? 'a' : 'b'))}<b>${rpEsc(name)}</b><small>${rpEsc(rec.url)}</small></div>`;
  const diff = A.composite != null && B.composite != null ? B.composite - A.composite : 0;
  const hero = `<section class="hero" id="overview">
    <span class="eyebrow">Page comparison</span>
    <h1>${rpEsc(hostA === hostB ? hostA : hostA + ' vs ' + hostB)}</h1>
    <div class="url"><span>${rpEsc(new Date(at || Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}</span></div>
    <div class="vs">${side(A, na)}<span class="mid">vs</span>${side(B, nb)}</div>
    <p style="margin:22px 0 0;text-align:center;opacity:.9">${diff === 0 ? 'Both pages score the same overall.' : `<b>${rpEsc(diff > 0 ? nb : na)}</b> scores ${Math.abs(diff)} point${Math.abs(diff) === 1 ? '' : 's'} higher overall.`}</p></section>`;

  const scoreRows = CMP_SCORES.map(([l, k]) => `<tr><td>${l}</td><td class="n">${rsScore(A.scores[k])}</td><td class="n">${rsScore(B.scores[k])}</td><td class="n">${rcDelta(A.scores[k], B.scores[k])}</td></tr>`).join('');
  const scores = rpSection('s-scores', 'The headline', 'Scores', 'Both pages are scored the same way, from what each shows on its own.',
    `<div class="card"><table class="tbl"><thead><tr><th>Area</th><th class="n">${rpEsc(rpTrunc(na, 24))}</th><th class="n">${rpEsc(rpTrunc(nb, 24))}</th><th class="n">Change</th></tr></thead><tbody>
      <tr><td><b>Overall</b></td><td class="n">${rsScore(A.composite)}</td><td class="n">${rsScore(B.composite)}</td><td class="n">${rcDelta(A.composite, B.composite)}</td></tr>${scoreRows}</tbody></table></div>`);

  const t = (v, n) => v ? `<span class="txt">${rpEsc(rpTrunc(v, n || 140))}</span>` : '<span class="txt"><i>none</i></span>';
  const trow = (label, x, y, n) => `<tr><td>${label}</td><td>${t(x, n)}</td><td>${t(y, n)}</td><td class="n">${String(x || '') === String(y || '') ? '<span class="dl eq">same</span>' : '<span class="dl bad">differs</span>'}</td></tr>`;
  const content = rpSection('s-content', 'What visitors and search engines read', 'Content and meta', '',
    `<div class="card"><table class="tbl"><thead><tr><th>Field</th><th>${rpEsc(rpTrunc(na, 24))}</th><th>${rpEsc(rpTrunc(nb, 24))}</th><th class="n"></th></tr></thead><tbody>
      ${trow('Title', A.title, B.title)}${trow('Description', A.desc, B.desc, 180)}${trow('Main heading', A.h1[0], B.h1[0])}${trow('Canonical', A.canonical, B.canonical, 90)}${trow('Language', A.lang, B.lang)}${trow('Words', String(A.words || ''), String(B.words || ''))}${trow('Social image', A.og ? 'Yes' : '', B.og ? 'Yes' : '')}${trow('Structured data', (A.sd || []).join(', '), (B.sd || []).join(', '))}</tbody></table></div>`);

  const sec = (v) => v == null ? '—' : (v / 1000).toFixed(2) + 's';
  const metric = (label, x, y, f, lower) => `<tr><td>${label}</td><td class="n">${x == null ? '—' : f(x)}</td><td class="n">${y == null ? '—' : f(y)}</td><td class="n">${rcDelta(x, y, lower, f)}</td></tr>`;
  const speed = rpSection('s-speed', 'Measured on one visit each', 'Speed', 'Lower is better in every row.',
    `<div class="card"><table class="tbl"><thead><tr><th>Measure</th><th class="n">${rpEsc(rpTrunc(na, 24))}</th><th class="n">${rpEsc(rpTrunc(nb, 24))}</th><th class="n">Change</th></tr></thead><tbody>
      ${metric('Largest paint (LCP)', A.lcp, B.lcp, sec, true)}${metric('Layout shift (CLS)', A.cls, B.cls, (v) => v.toFixed(3), true)}${metric('First paint (FCP)', A.fcp, B.fcp, sec, true)}${metric('Server response (TTFB)', A.ttfb, B.ttfb, (v) => Math.round(v) + ' ms', true)}${metric('Page weight', A.weight, B.weight, insBytes, true)}${metric('Image bytes', A.imgBytes, B.imgBytes, insBytes, true)}</tbody></table></div>`);

  const tech = cmpSetDiff(A.tech || [], B.tech || []);
  const chips = (l, c) => l.length ? `<div class="chips">${l.map(x => rpChip(x, c)).join('')}</div>` : '<span class="muted">None</span>';
  const techSec = rpSection('s-tech', 'What each is built with', 'Technology', '',
    `<div class="cols3"><div class="card"><div class="card-h">Only on ${rpEsc(rpTrunc(na, 22))} <small>${tech.onlyA.length}</small></div><div class="card-pad">${chips(tech.onlyA)}</div></div>
     <div class="card"><div class="card-h">Only on ${rpEsc(rpTrunc(nb, 22))} <small>${tech.onlyB.length}</small></div><div class="card-pad">${chips(tech.onlyB)}</div></div>
     <div class="card"><div class="card-h">On both <small>${tech.both.length}</small></div><div class="card-pad">${chips(tech.both)}</div></div></div>`);

  const fonts = cmpSetDiff(A.fonts || [], B.fonts || []);
  const colA = A.colors || [], colB = B.colors || [];
  const sw = (l) => l.length ? `<div class="swr" style="padding:0">${l.slice(0, 40).map(c => `<i style="background:${rpEsc(c)}" title="${rpEsc(c)}"></i>`).join('')}</div>` : '<span class="muted">None</span>';
  const design = rpSection('s-design', 'Fonts and colors', 'Design', '',
    `<div class="card"><div class="stats">${rpStat('Fonts', (A.fonts || []).length + ' · ' + (B.fonts || []).length)}${rpStat('Font sizes', (A.sizes || []).length + ' · ' + (B.sizes || []).length)}${rpStat('Colors', colA.length + ' · ' + colB.length)}${rpStat('Shared colors', colA.filter(c => colB.indexOf(c) >= 0).length)}</div></div>
     <div class="cols3"><div class="card"><div class="card-h">Fonts only on ${rpEsc(rpTrunc(na, 18))}</div><div class="card-pad">${chips(fonts.onlyA)}</div></div>
     <div class="card"><div class="card-h">Fonts only on ${rpEsc(rpTrunc(nb, 18))}</div><div class="card-pad">${chips(fonts.onlyB)}</div></div>
     <div class="card"><div class="card-h">Fonts on both</div><div class="card-pad">${chips(fonts.both)}</div></div></div>
     <div class="cols3"><div class="card"><div class="card-h">Colors only on ${rpEsc(rpTrunc(na, 18))}</div><div class="card-pad">${sw(colA.filter(c => colB.indexOf(c) < 0))}</div></div>
     <div class="card"><div class="card-h">Colors only on ${rpEsc(rpTrunc(nb, 18))}</div><div class="card-pad">${sw(colB.filter(c => colA.indexOf(c) < 0))}</div></div>
     <div class="card"><div class="card-h">Colors on both</div><div class="card-pad">${sw(colA.filter(c => colB.indexOf(c) >= 0))}</div></div></div>`);

  const ia = {}, ib = {};
  (A.issues || []).forEach(i => { ia[i[0]] = i; }); (B.issues || []).forEach(i => { ib[i[0]] = i; });
  const onlyA = Object.keys(ia).filter(k => !(k in ib)).map(k => ia[k]), onlyB = Object.keys(ib).filter(k => !(k in ia)).map(k => ib[k]), both = Object.keys(ia).filter(k => k in ib).map(k => ia[k]);
  const iss = (l) => l.length ? `<table class="tbl"><tbody>${l.map(i => `<tr><td>${rpEsc(i[2])}</td><td class="n">${rpSevPill(i[1])}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">None.</div>';
  const issues = rpSection('s-issues', 'What needs fixing', 'Issues', 'Findings that appear on one page but not the other point at what changed or what differs.',
    `<div class="card"><div class="card-h">Only on ${rpEsc(rpTrunc(na, 30))} <small>${onlyA.length}</small></div>${iss(onlyA)}</div>
     <div class="card"><div class="card-h">Only on ${rpEsc(rpTrunc(nb, 30))} <small>${onlyB.length}</small></div>${iss(onlyB)}</div>
     <div class="card"><div class="card-h">On both <small>${both.length}</small></div>${iss(both)}</div>`);

  const nav = [['overview', 'Overview'], ['s-scores', 'Scores'], ['s-content', 'Content and meta'], ['s-speed', 'Speed'], ['s-tech', 'Technology'], ['s-design', 'Design'], ['s-issues', 'Issues']];
  return rpDocument({
    kind: 'Page comparison', title: hostA === hostB ? hostA : hostA + ' vs ' + hostB, host: hostA, nav: nav, headExtra: `<style>${RP_SITE_CSS}${RP_CMP_CSS}</style>`,
    note: 'Each page was read once and scored the same way. Speed figures are single measurements on one device.',
    body: hero + scores + content + speed + techSec + design + issues
  });
}

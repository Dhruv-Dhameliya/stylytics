/* report-site.js — the downloadable Site report, built from a site scan (site-scan.js).
 * Same document shell as the page report and style guide (report-core.js). */

const RP_SITE_CSS = `
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{font:600 11px var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--text3);text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
.tbl td{padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl tr:last-child td{border-bottom:0}
.tbl td.n,.tbl th.n{text-align:right;font-variant-numeric:tabular-nums}
.tbl a{color:var(--text);font-weight:500;overflow-wrap:anywhere}
.tbl small{display:block;color:var(--text3);margin-top:2px;font-size:11.5px}
.sc{display:inline-block;min-width:34px;text-align:center;padding:2px 8px;border-radius:99px;font:600 12px var(--sans);background:var(--inset);color:var(--text2)}
.sc.ok{background:var(--ok-bg);color:var(--ok-fg)}.sc.warn{background:var(--warn-bg);color:var(--warn-fg)}.sc.bad{background:var(--bad-bg);color:var(--bad-fg)}
.grp{padding:14px 18px;border-bottom:1px solid var(--line)}.grp:last-child{border-bottom:0}
.grp b{display:block;font-size:14px;overflow-wrap:anywhere}.grp small{color:var(--text3)}
.grp ul{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}
.grp li a{color:var(--accent-d);font-size:12.5px;overflow-wrap:anywhere}
.bars{display:grid;gap:8px;padding:14px 18px}
.bar-r{display:grid;grid-template-columns:minmax(0,200px) 1fr 54px;gap:12px;align-items:center;font-size:13px}
.bar-r span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-r small{text-align:right;color:var(--text3);font-variant-numeric:tabular-nums}
.bar-t{height:10px;border-radius:6px;background:var(--inset);overflow:hidden}.bar-t i{display:block;height:100%;background:linear-gradient(90deg,#fb923c,#ea580c);border-radius:6px}
.swr{display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 18px}.swr i{width:26px;height:26px;border-radius:50%;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--text) 18%,transparent)}
.hero .chip{background:var(--hero-glass);border-color:var(--hero-line);color:var(--hero-text)}
`;

function rsScore(v) { return `<span class="sc ${rpTierOf(v)}">${v == null ? '—' : v}</span>`; }
function rsLink(url, label) { return `<a href="${rpEsc(url)}">${rpEsc(label || sitePath(url))}</a>`; }
function rsList(urls, max) { return `<ul>${urls.slice(0, max || 8).map(u => `<li>${rsLink(u)}</li>`).join('')}${urls.length > (max || 8) ? `<li><small>and ${urls.length - (max || 8)} more</small></li>` : ''}</ul>`; }

function buildSiteReportHtml(host, results, agg, at) {
  const pages = results.filter(r => r.ok);
  const s = agg.sprawl || {};
  const tile = (label, v) => `<div class="cat none"><span class="cat-top">${rpEsc(label)}</span><span class="cat-v">${v == null ? '—' : v}</span></div>`;

  const hero = `<section class="hero" id="overview">
    <span class="eyebrow">Site report</span>
    <h1>${rpEsc(host)}</h1>
    <div class="url"><span>${rpPlural(agg.pages, 'page')} scanned${agg.failed ? `, ${agg.failed} could not be read` : ''}</span><span>${rpEsc(new Date(at || Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}</span></div>
    <div class="hero-grid">
      <div class="score-big">${rpRing(agg.avg.composite, 120)}<div class="verdict"><strong>${rpTierWord(agg.avg.composite)}</strong><span>Average across the scanned pages</span></div></div>
      <div class="cats">${tile('SEO', agg.avg.seo)}${tile('Design', agg.avg.design)}${tile('Access', agg.avg.a11y)}${tile('Speed', agg.avg.speed)}${tile('AI', agg.avg.ai)}${tile('UX', agg.avg.ux)}</div>
    </div></section>`;

  // duplicates and gaps
  const dupBlock = (title, groups) => groups.length
    ? `<div class="card"><div class="card-h">${rpIcon('alert', 15)} ${title} <small>${groups.length}</small></div>${groups.slice(0, 12).map(g => `<div class="grp"><b>“${rpEsc(rpTrunc(g.text, 120))}”</b><small>${rpPlural(g.urls.length, 'page')}</small>${rsList(g.urls, 6)}</div>`).join('')}</div>`
    : `<div class="card"><div class="card-h">${rpIcon('check', 15)} ${title}</div><div class="empty">None found.</div></div>`;
  const gaps = [['No title', agg.missing.title], ['No meta description', agg.missing.desc], ['No H1', agg.missing.h1], ['More than one H1', agg.missing.multiH1], ['Canonical points to another page', agg.missing.canonical], ['Set to noindex', agg.missing.noindex], ['No social preview image', agg.missing.og], ['Images without alt text', agg.missing.alt]].filter(g => g[1].length);
  const dupSec = rpSection('s-dup', 'Across pages', 'Duplicates and gaps', 'Titles and descriptions that repeat confuse search engines about which page to show. Gaps are pages missing something the others have.',
    dupBlock('Duplicate titles', agg.dup.titles) + dupBlock('Duplicate descriptions', agg.dup.descs) +
    `<div class="card"><div class="card-h">${rpIcon('file', 15)} Gaps on pages <small>${gaps.reduce((a, g) => a + g[1].length, 0)}</small></div>${gaps.length ? gaps.map(g => `<div class="grp"><b>${g[0]}</b><small>${rpPlural(g[1].length, 'page')}</small>${rsList(g[1].map(p => p.url), 5)}</div>`).join('') : '<div class="empty">No gaps found.</div>'}</div>`);

  // repeated issues
  const rep = agg.issues.filter(i => i.urls.length > 1).slice(0, 15);
  const issSec = rpSection('s-issues', 'Fix once, fix everywhere', 'Problems that repeat', 'These appear on more than one scanned page, so a fix in a shared template or component clears several at once.',
    `<div class="card"><table class="tbl"><thead><tr><th>Problem</th><th>Priority</th><th class="n">Pages</th></tr></thead><tbody>${rep.length ? rep.map(i => `<tr><td>${rpEsc(i.t)}</td><td>${rpSevPill(i.sev)}</td><td class="n">${i.urls.length} of ${agg.pages}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No problem repeats across pages.</td></tr>'}</tbody></table></div>`);

  // sections
  const secSec = rpSection('s-sections', 'Which area needs the most work', 'Sections', 'The first part of each address stands in for a template. Lowest scores first.',
    `<div class="card"><table class="tbl"><thead><tr><th>Section</th><th class="n">Pages</th><th class="n">Overall</th><th class="n">SEO</th><th class="n">Access</th><th class="n">Speed</th><th class="n">Design</th></tr></thead><tbody>${agg.sections.map(x => `<tr><td><b>${rpEsc(x.name)}</b></td><td class="n">${x.pages}</td><td class="n">${rsScore(x.composite)}</td><td class="n">${rsScore(x.seo)}</td><td class="n">${rsScore(x.a11y)}</td><td class="n">${rsScore(x.speed)}</td><td class="n">${rsScore(x.design)}</td></tr>`).join('')}</tbody></table></div>`);

  // design sprawl
  const bar = (label, n, total) => `<div class="bar-r"><span title="${rpEsc(label)}">${rpEsc(label)}</span><div class="bar-t"><i style="width:${Math.max(3, n / total * 100)}%"></i></div><small>${n}/${total}</small></div>`;
  const sprawl = rpSection('s-sprawl', 'The part single-page tools miss', 'Design sprawl', `${s.sizes ? s.sizes.length : 0} font sizes between ${s.sizes && s.sizes[0] ? s.sizes[0].px : '–'} and ${s.sizes && s.sizes.length ? s.sizes[s.sizes.length - 1].px : '–'}px, but only ${s.sizeClusters} distinct steps once sizes within 1px are merged.`,
    `<div class="card"><div class="stats">${rpStat('Font families', s.fonts.length)}${rpStat('Font sizes', s.sizes.length, s.sizeClusters + ' distinct steps')}${rpStat('Colors', s.colors, s.nearColors + ' near-duplicates')}${rpStat('Spacing on 4px grid', s.spacingOn4 + '%')}</div></div>
     <div class="two"><div class="card"><div class="card-h">${rpIcon('type', 15)} Fonts, by pages using them</div><div class="bars">${s.fonts.slice(0, 8).map(f => bar(f.name, f.pages, agg.pages)).join('')}</div></div>
     <div class="card"><div class="card-h">${rpIcon('type', 15)} Font sizes, by pages using them</div><div class="bars">${s.sizes.slice().sort((a, b) => b.pages - a.pages).slice(0, 10).map(x => bar(x.px + 'px', x.pages, agg.pages)).join('')}</div></div></div>
     <div class="card"><div class="card-h">${rpIcon('palette', 15)} Colors <small>${s.colors}${s.onlyOnePage ? ` · ${s.onlyOnePage} on a single page` : ''}</small></div><div class="swr" style="padding-top:14px">${s.colorList.slice(0, 60).map(c => `<i style="background:${rpEsc(c.hex)};opacity:${0.4 + 0.6 * c.pages / agg.pages}" title="${rpEsc(c.hex)} · ${c.pages} of ${agg.pages} pages"></i>`).join('')}</div></div>`);

  // structured data
  const sdSec = rpSection('s-sd', 'Coverage', 'Structured data', `${agg.sd.withData} of ${agg.pages} scanned pages have structured data.`,
    `<div class="card"><div class="card-h">${rpIcon('grid', 15)} Types found</div><div class="card-pad">${agg.sd.types.length ? `<div class="chips">${agg.sd.types.map(t => rpChip(t.type + ' · ' + t.pages)).join('')}</div>` : '<span class="muted">No structured data on any scanned page.</span>'}</div></div>
     ${agg.sd.without.length && agg.sd.withData ? `<div class="card"><div class="card-h">${rpIcon('alert', 15)} Pages without it <small>${agg.sd.without.length}</small></div><div class="grp">${rsList(agg.sd.without.map(p => p.url), 10)}</div></div>` : ''}`);

  // links
  const linkSec = rpSection('s-links', 'Link graph', 'Internal links', 'Built from the links on the scanned pages. Scan more pages for a fuller picture.',
    `<div class="two"><div class="card"><div class="card-h">${rpIcon('link', 15)} Most linked to</div><div class="bars">${agg.inbound.slice(0, 8).map(i => bar(sitePath(i.url), i.n, agg.inbound[0].n)).join('') || '<span class="muted">No internal links found.</span>'}</div></div>
     <div class="card"><div class="card-h">${rpIcon('alert', 15)} Possible orphans <small>${agg.orphans.length}</small></div><div class="grp">${agg.orphans.length ? rsList(agg.orphans, 12) + '<small>Pages from the sitemap that none of the scanned pages link to.</small>' : '<span class="muted">Every known page is linked from a scanned page.</span>'}</div></div></div>`);

  // all pages
  const sorted = results.slice().sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? -1 : 1) || ((a.composite == null) - (b.composite == null)) || a.composite - b.composite);
  const pageSec = rpSection('s-pages', 'Everything scanned', 'All pages', '',
    `<div class="card"><table class="tbl"><thead><tr><th>Page</th><th class="n">Overall</th><th class="n">SEO</th><th class="n">Access</th><th class="n">Speed</th><th class="n">Words</th><th class="n">Issues</th></tr></thead><tbody>${sorted.map(r => r.ok
      ? `<tr><td>${rsLink(r.url)}<small>${rpEsc(rpTrunc(r.title || '(no title)', 80))}</small></td><td class="n">${rsScore(r.composite)}</td><td class="n">${rsScore(r.scores.seo)}</td><td class="n">${rsScore(r.scores.a11y)}</td><td class="n">${rsScore(r.scores.speed)}</td><td class="n">${r.words}</td><td class="n">${r.issues.length}</td></tr>`
      : `<tr><td>${rsLink(r.url)}<small>${rpEsc(r.error || 'Could not be read')}</small></td><td colspan="6" class="muted">Failed</td></tr>`).join('')}</tbody></table></div>`);

  const nav = [['overview', 'Overview'], ['s-dup', 'Duplicates and gaps'], ['s-issues', 'Repeated problems'], ['s-sections', 'Sections'], ['s-sprawl', 'Design sprawl'], ['s-sd', 'Structured data'], ['s-links', 'Internal links'], ['s-pages', 'All pages']];
  return rpDocument({
    kind: 'Site report', title: host, host: host, nav: nav, headExtra: `<style>${RP_SITE_CSS}</style>`,
    note: 'Each page was loaded in a background tab and read once. Scores for the same page can differ slightly between scans.',
    body: hero + dupSec + issSec + secSec + sprawl + sdSec + linkSec + pageSec
  });
}

/* report-page.js — the downloadable Page report.
 *
 * Replaces the old plain SEO checklist. It reuses the same scoring and plain-language guidance as the
 * panel (shAudit / CHECK_GUIDE), so the numbers in the report always match what the user saw, and adds
 * a prioritised action plan, per-category detail, and the underlying page data.
 */

function buildSeoAuditReportHtml(data) {
  const A = shAudit();
  const meta = data.meta || {};
  const seo = data.seo || {};
  const url = meta.pageUrl || meta.canonical || '';
  const host = rpHostOf(url) || rpHostOf(meta.canonical || '');
  const title = meta.title || host || 'Untitled page';
  const scopeLabel = (typeof SH !== 'undefined' && SH.scope) ? 'Main content only' : 'Whole page';

  const issues = A.issues;
  const totalChecks = A.cats.reduce((n, c) => n + c.checks.length, 0);
  const passedChecks = A.cats.reduce((n, c) => n + c.passes.length, 0);
  const cnt = { High: 0, Medium: 0, Low: 0 };
  issues.forEach(i => { cnt[i.sev]++; });
  const tier = rpTierOf(A.composite);
  const scored = A.cats.filter(c => !c.info);

  /* ---------- hero ---------- */
  const catTiles = scored.map(c => `<a class="cat ${rpTierOf(c.score)}" href="#cat-${c.id}">
      <span class="cat-top">${rpIcon(c.icon === 'file' ? 'file' : c.icon, 14)}${rpEsc(c.lab || c.short)}</span>
      <span class="cat-v">${c.score == null ? '—' : c.score}</span>
      <span class="cat-bar"><i style="width:${c.score == null ? 0 : Math.max(c.score, 4)}%"></i></span></a>`).join('');
  const verdict = !issues.length
    ? 'Every check passed. There is nothing to fix.'
    : `${rpPlural(issues.length, 'issue')} to review. Start with “${issues[0].t}”.`;
  const hero = `<section class="hero" id="overview">
    <span class="eyebrow">Page report</span>
    <h1>${rpEsc(title)}</h1>
    <div class="url">${url ? `<a href="${rpEsc(url)}">${rpEsc(url)}</a>` : ''}<span>${rpEsc(rpDate())}</span><span>${rpEsc(scopeLabel)}</span></div>
    <div class="hero-grid">
      <div class="score-big">${rpRing(A.composite, 132)}
        <div class="verdict"><strong>${rpTierWord(A.composite)}</strong>
          <span class="sevrow"><span><i class="bad"></i>${cnt.High} High</span><span><i class="warn"></i>${cnt.Medium} Medium</span><span><i class="info"></i>${cnt.Low} Low</span></span>
          <span style="color:var(--hero-dim);font-size:12.5px;max-width:30ch">${rpEsc(verdict)}</span></div></div>
      <div class="cats">${catTiles}</div>
    </div>
    <div class="hero-foot">
      <span><b>${passedChecks}</b> of ${totalChecks} checks passed</span>
      <span><b>${(meta.wordCount || 0).toLocaleString()}</b> words</span>
      <span><b>${(data.links || []).length}</b> links</span>
      <span><b>${(data.images || []).length}</b> images</span>
      <span><b>${(data.outline || []).length}</b> headings</span>
    </div></section>`;

  /* ---------- action plan ---------- */
  const taskHtml = (x) => {
    const md = `${x.t} (${x.catName}, ${x.sev})${x.fix ? ' — ' + x.fix : ''}`;
    return `<label class="task" data-md="${rpEsc(md)}">
      <input type="checkbox" aria-label="Mark done">
      <span><b>${rpEsc(x.t)}</b><small>${rpEsc(x.line)}</small>${x.fix ? `<span class="fix"><em>Fix:</em> ${rpEsc(x.fix)}</span>` : ''}${x.fixCode ? `<div class="snippet" style="margin-top:7px">${rpEsc(x.fixCode.code)}</div>` : (x.tag ? `<div class="snippet" style="margin-top:7px">${rpEsc(x.tag)}</div>` : '')}</span>
      <span class="meta">${rpChip(x.catName)}${rpSevPill(x.sev)}</span></label>`;
  };
  const groups = ['High', 'Medium', 'Low'].map(sev => {
    const list = issues.filter(i => i.sev === sev);
    if (!list.length) return '';
    return `<div class="plan-group"><h3><span class="dot ${rpSevOf(sev)}"></span>${sev} priority <span class="muted">· ${list.length}</span></h3><div class="card">${list.map(taskHtml).join('')}</div></div>`;
  }).join('');
  const plan = rpSection('plan', 'Start here', 'Action plan',
    issues.length ? `Every issue from the audit, most important first. Tick items as you go, or copy the list as a checklist for your tracker.` : 'No issues were found. Nice work.',
    (issues.length ? `<div style="margin-bottom:6px"><button class="tb-btn" type="button" data-copy-tasks>${rpIcon('list', 14)} Copy as checklist</button></div>` : '') +
    (groups || `<div class="card"><div class="empty">All checks passed.</div></div>`));

  /* ---------- category sections ---------- */
  const catSection = (c) => {
    const failRows = c.issues.map(i => `<details class="chk-d"><summary><div class="chk fail"><span class="mk">${rpIcon('alert', 14)}</span><span><b>${rpEsc(i.t)}</b><small>${rpEsc(i.line)}</small></span>${rpSevPill(i.sev)}</div></summary>
        <div class="chk-body">${i.mean ? `<div><h4>What it means</h4>${rpEsc(i.mean)}</div>` : ''}${i.fix ? `<div><h4>What to change</h4>${rpEsc(i.fix)}</div>` : ''}${i.fixCode ? rpCode(i.fixCode.code, 'Copy-ready fix · ' + (FIX_WHERE[i.fixCode.where] || '')) + (i.fixCode.note ? `<p class="muted" style="margin:8px 0 0;font-size:12px">${rpEsc(i.fixCode.note)}</p>` : '') : (i.tag ? `<div class="snippet">${rpEsc(i.tag)}</div>` : '')}</div></details>`).join('');
    const passRows = c.passes.map(p => `<div class="chk pass"><span class="mk">${rpIcon('check', 13)}</span><span><b>${rpEsc(p.label)}</b></span><span></span></div>`).join('');
    const t = rpTierOf(c.score);
    return `<section class="block" id="cat-${c.id}" style="margin-top:22px"><div class="card">
      <div class="cat-head">${rpRing(c.score, 84)}<div><h3>${rpEsc(c.name)}</h3><p>${rpEsc(c.blurb)} ${c.checks.length ? `<b>${c.passes.length} of ${c.checks.length}</b> checks passed.` : ''}</p>${c.checks.length ? rpTicks(c.passes.length, c.issues) : ''}</div></div>
      ${failRows ? `<div style="border-top:1px solid var(--line)">${failRows}</div>` : (c.checks.length ? `<div class="empty" style="border-top:1px solid var(--line)">${rpIcon('check', 16)} No issues in this area.</div>` : '')}
      ${passRows ? `<details class="fold"><summary>${c.passes.length} passed ${c.passes.length === 1 ? 'check' : 'checks'}</summary>${passRows}</details>` : ''}
    </div></section>`;
  };
  const categories = `<section class="block" id="categories"><header class="block-h"><span class="eyebrow">Audit</span><h2>Results by area</h2><p class="intro">Six areas, each scored out of 100. Each tick below a score is one check: green passed, orange or red needs attention.</p></header>${scored.filter(c => c.checks.length).map(catSection).join('')}</section>`;

  /* ---------- search & metadata ---------- */
  const tl = (meta.title || '').length, dl = (meta.description || '').length;
  const lenStat = (n, lo, hi) => !n ? rpStatus('bad', 'Missing') : (n >= lo && n <= hi ? rpStatus('ok', n + ' chars · good') : rpStatus('warn', n + ' chars · aim for ' + lo + '–' + hi));
  let pathCrumb = host;
  try { const u = new URL(url || meta.canonical); pathCrumb = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? ' › ' + u.pathname.split('/').filter(Boolean).join(' › ') : ''); } catch (e) { }
  const serp = (cls) => `<div class="serp ${cls || ''}"><div class="u">${rpEsc(pathCrumb)}</div><div class="t">${rpEsc(rpTrunc(meta.title || host, cls ? 56 : 62))}</div><div class="d">${rpEsc(rpTrunc(meta.description || 'No description available for this page.', cls ? 120 : 160))}</div></div>`;
  const robots = seo.robots || {};
  const searchSec = rpSection('d-search', 'Page data', 'Search appearance', 'How the page can appear in search results, and the tags behind it.',
    `<div class="two" style="margin-bottom:14px"><div><div class="muted" style="font-size:11px;margin-bottom:6px">Desktop</div>${serp('')}</div><div><div class="muted" style="font-size:11px;margin-bottom:6px">Mobile</div>${serp('m')}</div></div>
    <div class="card">${rpKV([
      ['Title', rpEsc(meta.title), lenStat(tl, 30, 60)],
      ['Description', rpEsc(meta.description), lenStat(dl, 120, 160)],
      ['Canonical URL', meta.canonical ? `<span class="mono">${rpEsc(meta.canonical)}</span>` : '', seo.canonicalMismatch ? rpStatus('warn', 'Differs from this page') : (meta.canonical ? rpStatus('ok', 'Matches') : '')],
      ['Robots', rpEsc(robots.raw || 'Not set (defaults to index, follow)'), (robots.noindex || robots.nofollow) ? rpStatus('bad', 'Blocking') : rpStatus('ok', 'Indexable')],
      ['Language', rpEsc(meta.language)],
      ['Charset', rpEsc(seo.charset)],
      ['Mobile viewport', seo.hasViewport ? 'Present' : '', seo.hasViewport ? rpStatus('ok', 'OK') : rpStatus('bad', 'Missing')],
      ['Author', rpEsc(seo.author)],
      ['Generator', rpEsc(seo.generator)],
      ['Published', rpEsc(seo.articlePublished)],
      ['Last modified', rpEsc(seo.articleModified)],
      seo.hreflang && seo.hreflang.length ? ['Hreflang', seo.hreflang.map(h => rpChip(h.lang)).join(' ')] : null
    ])}</div>`);

  /* ---------- social ---------- */
  const og = (data.socialMeta && data.socialMeta.og) || {};
  const tw = (data.socialMeta && data.socialMeta.twitter) || {};
  const socialSec = rpSection('d-social', 'Page data', 'Social sharing', 'What people see when the page is shared on Facebook, LinkedIn and X.',
    `<div class="two"><div>
      <div class="social"><div class="img"${og.image ? ` style="background-image:url('${rpEsc(og.image)}')"` : ''}>${og.image ? '' : 'No preview image'}</div>
        <div class="bd"><small>${rpEsc(host)}</small><b>${rpEsc(og.title || meta.title || '')}</b><span>${rpEsc(rpTrunc(og.description || meta.description || '', 120))}</span></div></div></div>
      <div class="card">${rpKV([
        ['og:title', rpEsc(og.title), og.title ? '' : rpStatus('warn', 'Missing')],
        ['og:description', rpEsc(og.description), og.description ? '' : rpStatus('warn', 'Missing')],
        ['og:image', og.image ? `<span class="mono">${rpEsc(og.image)}</span>` : '', og.image ? '' : rpStatus('bad', 'Missing')],
        ['og:type', rpEsc(seo.ogType)], ['og:site_name', rpEsc(seo.ogSiteName)], ['og:locale', rpEsc(seo.ogLocale)],
        ['twitter:card', rpEsc(tw.card || seo.twitterCard), (tw.card || seo.twitterCard) ? '' : rpStatus('warn', 'Missing')]
      ])}</div></div>`);

  /* ---------- structure: headings + structured data ---------- */
  const outline = data.outline || [];
  const hc = [1, 2, 3, 4, 5, 6].map(n => outline.filter(h => h.tag === 'h' + n).length);
  const headIssues = computeHeadingIssues(outline);
  const outlineHtml = outline.length
    ? `<div class="outline">${outline.slice(0, 120).map(h => { const lv = parseInt(h.tag.slice(1), 10) || 1; return `<div style="padding-left:${(lv - 1) * 18}px"><em>H${lv}</em><span>${rpEsc(h.text)}</span></div>`; }).join('')}</div>`
    : '<div class="empty">No headings found.</div>';
  const sd = data.structuredData || { blocks: [], types: [] };
  const sdBlocks = (sd.blocks || []).map((b, i) => {
    let pretty = b.raw || '';
    try { pretty = JSON.stringify(b.parsed != null ? b.parsed : JSON.parse(b.raw), null, 2); } catch (e) { /* keep raw */ }
    return `<details class="fold"><summary>Block ${i + 1}${b.error ? ' · could not be parsed' : ''}</summary><div style="padding:12px 16px">${rpCode(rpTrunc(pretty, 6000), 'JSON-LD')}</div></details>`;
  }).join('');
  const structureSec = rpSection('d-structure', 'Page data', 'Content structure', 'The heading outline and any structured data (JSON-LD) found on the page.',
    `<div class="card"><div class="counts">${hc.map((n, i) => `<div><b>${n}</b><span>H${i + 1}</span></div>`).join('')}</div>${outlineHtml}
      ${headIssues.length ? `<div style="padding:12px 18px;border-top:1px solid var(--line)">${headIssues.map(x => `<div style="margin:3px 0">${rpStatus('warn', 'Review')} ${rpEsc(x)}</div>`).join('')}</div>` : ''}</div>
    <div class="card"><div class="card-h">${rpIcon('grid', 15)} Structured data <small>${sd.types.length ? rpPlural(sd.types.length, 'type') : 'None found'}</small></div>
      ${sd.types.length ? `<div class="card-pad"><div class="chips">${sd.types.map(t => rpChip(t)).join('')}</div></div>${sdBlocks}` : '<div class="empty">No JSON-LD structured data found.</div>'}</div>`);

  /* ---------- links & images ---------- */
  const links = data.links || [];
  const ls = computeBacklinkStats(links);
  const nofollow = links.filter(l => /nofollow/i.test(l.rel || '')).length;
  const domains = {};
  links.filter(l => !l.isInternal).forEach(l => { const h = rpHostOf(l.url); if (h) domains[h] = (domains[h] || 0) + 1; });
  const topDomains = Object.keys(domains).sort((a, b) => domains[b] - domains[a]).slice(0, 8);
  const missingAlt = (data.accessibility && data.accessibility.imagesMissingAlt) || [];
  const linksSec = rpSection('d-links', 'Page data', 'Links and images', 'Link mix, outbound destinations and image health.',
    `<div class="card"><div class="stats">${rpStat('Total links', ls.total)}${rpStat('Internal', ls.internal)}${rpStat('External', ls.external)}${rpStat('Nofollow', nofollow)}${rpStat('Generic anchors', ls.generic)}${rpStat('UTM tagged', ls.utm)}</div></div>
    <div class="two">
      <div class="card"><div class="card-h">${rpIcon('globe', 15)} Top external domains</div>${topDomains.length ? `<ul class="plain">${topDomains.map(d => `<li><span>${rpEsc(d)}</span><span class="n">${domains[d]}</span></li>`).join('')}</ul>` : '<div class="empty">No external links.</div>'}</div>
      <div class="card"><div class="card-h">${rpIcon('eye', 15)} Images <small>${(data.images || []).length} found</small></div>
        ${rpKV([['Total images', String((data.images || []).length)], ['Missing alt text', String((data.accessibility || {}).imagesMissingAltCount || 0), (data.accessibility || {}).imagesMissingAltCount ? rpStatus('bad', 'Fix') : rpStatus('ok', 'None')], ['Broken images', String(data.brokenImagesCount || 0), data.brokenImagesCount ? rpStatus('bad', 'Fix') : rpStatus('ok', 'None')]])}
        ${missingAlt.length ? `<ul class="plain">${missingAlt.slice(0, 8).map(u => `<li><span class="mono">${rpEsc(rpTrunc(String(u).startsWith('data:') ? 'Inline image (data URI)' : u, 70))}</span></li>`).join('')}</ul>` : ''}</div>
    </div>`);

  /* ---------- performance ---------- */
  const vit = data.webVitals || {};
  const perf = data.performance || {};
  const VM = [['lcp', 'LCP', 'Largest contentful paint'], ['inp', 'INP', 'Interaction to next paint'], ['cls', 'CLS', 'Cumulative layout shift'], ['fcp', 'FCP', 'First contentful paint'], ['ttfb', 'TTFB', 'Time to first byte']];
  const vitalHtml = VM.map(([k, l, full]) => {
    const raw = vit[k], th = CWV_THRESHOLDS[k], t = getCwvTier(k, raw);
    const kind = t === 'good' ? 'ok' : t === 'needs-improvement' ? 'warn' : t === 'poor' ? 'bad' : 'none';
    const pos = raw == null ? null : Math.max(0, Math.min(100, raw / th.max * 100));
    return `<div class="vital"><span>${l}</span><b>${rpEsc(formatCwvValue(k, raw))}</b>
      ${pos == null ? '' : `<div class="gauge" style="--g1:${(th.good / th.max * 100).toFixed(0)}%;--g2:${(th.poor / th.max * 100).toFixed(0)}%"><i style="left:${pos}%"></i></div>`}
      <small>${rpStatus(kind, t === 'good' ? 'Good' : t === 'needs-improvement' ? 'Needs work' : t === 'poor' ? 'Poor' : 'Not available')} · ${rpEsc(full)}</small></div>`;
  }).join('');
  const perfSec = rpSection('d-perf', 'Page data', 'Performance snapshot', 'Measured in the browser on this visit. Field data from real users can differ, so confirm important numbers in PageSpeed Insights.',
    `<div class="card"><div class="vitals">${vitalHtml}</div></div>
    <div class="card">${rpKV([
      ['DOM content loaded', perf.domContentLoadedMs != null ? `${perf.domContentLoadedMs} ms` : ''],
      ['Full page load', perf.loadMs != null ? `${perf.loadMs} ms` : ''],
      ['Resources loaded', perf.resourceCount != null ? String(perf.resourceCount) : ''],
      ['Transfer size', perf.totalTransferSizeKb != null ? `${perf.totalTransferSizeKb} KB` : ''],
      ['Render-blocking scripts', perf.renderBlockingScripts != null ? String(perf.renderBlockingScripts) : '', perf.renderBlockingScripts ? rpStatus('warn', 'Review') : rpStatus('ok', 'None')]
    ])}</div>
    ${url ? `<p style="margin-top:10px"><a href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}">Open PageSpeed Insights ↗</a></p>` : ''}`);

  /* ---------- accessibility, UX, AI signals ---------- */
  const a11y = data.accessibility || {};
  const lm = a11y.landmarks || {};
  const DP = [['preCheckedOptIns', 'Pre-checked opt-in boxes'], ['confirmShaming', 'Guilt-trip decline wording'], ['scarcityUrgency', 'Fake urgency or scarcity'], ['hiddenSensitiveLinks', 'Hidden cancel or unsubscribe links'], ['confusingOptOuts', 'Confusing opt-out wording'], ['undisclosedFreeTrials', 'Undisclosed free-trial terms'], ['disguisedAds', 'Disguised advertising'], ['consentButtonDisparity', 'Lopsided consent buttons']];
  const dp = data.darkPatterns || {};
  const dpRows = DP.filter(([k]) => (dp[k + 'Count'] || 0) > 0).map(([k, l]) => `<li><span><b>${rpEsc(l)}</b><br><span class="muted">${(dp[k] || []).slice(0, 3).map(x => rpEsc(rpTrunc(x.text || x.selector || '', 80))).join(' · ')}</span></span><span class="n">${dp[k + 'Count']}</span></li>`).join('');
  const llm = data.llmSignals || {};
  const siteFiles = (typeof lastSiteFilesResult !== 'undefined') ? lastSiteFilesResult : null;
  const blocked = (siteFiles && siteFiles.robotsTxt && siteFiles.robotsTxt.blockedAiCrawlers) || [];
  const signalsSec = rpSection('d-signals', 'Page data', 'Accessibility, UX and AI signals', 'The evidence behind the Accessibility, UX review and AI readiness scores.',
    `<div class="two">
      <div class="card"><div class="card-h">${rpIcon('a11y', 15)} Accessibility</div>
        <div class="card-pad"><div class="chips">${['header', 'nav', 'main', 'footer'].map(k => `<span class="chip">${lm[k] ? '✓' : '✕'} ${k}</span>`).join('')}</div></div>
        ${rpKV([['Page language', a11y.langMissing ? '' : 'Declared', a11y.langMissing ? rpStatus('bad', 'Missing') : rpStatus('ok', 'OK')], ['Focusable elements', String(a11y.focusableCount || 0)], ['Fields without labels', String(a11y.formFieldsMissingLabelCount || 0), a11y.formFieldsMissingLabelCount ? rpStatus('warn', 'Fix') : rpStatus('ok', 'None')]])}</div>
      <div class="card"><div class="card-h">${rpIcon('shield', 15)} UX review</div>
        ${dpRows ? `<ul class="plain">${dpRows}</ul>` : `<div class="empty">${rpIcon('check', 16)} No manipulative patterns detected.</div>`}</div>
    </div>
    <div class="card"><div class="card-h">${rpIcon('eye', 15)} AI readiness signals</div>
      <div class="stats">${rpStat('Tables', llm.tableCount || 0)}${rpStat('List items', llm.listItemCount || 0)}${rpStat('Question headings', llm.conversationalHeadingCount || 0)}${rpStat('Answer-first paragraphs', llm.answerFirstParagraphCount || 0)}${rpStat('Data mentions', llm.dataEvidenceCount || 0)}</div>
      <div class="card-pad" style="border-top:1px solid var(--line)">${siteFiles ? (blocked.length ? rpStatus('bad', 'AI crawlers blocked in robots.txt: ' + blocked.join(', ')) : rpStatus('ok', 'AI crawlers are not blocked in robots.txt')) : '<span class="muted">robots.txt was not checked.</span>'}</div></div>`);

  /* ---------- technology ---------- */
  const grouped = (typeof lastTechStackGrouped !== 'undefined' && lastTechStackGrouped.size) ? lastTechStackGrouped : null;
  const techRows = grouped ? Array.from(grouped.keys()).map(cat => `<li><span style="min-width:130px;color:var(--text2)">${rpEsc(cat)}</span><span class="chips">${grouped.get(cat).map(n => rpChip(n.replace(/ \(likely\)$/, ''), / \(likely\)$/.test(n) ? 'inferred' : '')).join('')}</span></li>`).join('') : '';
  const techSec = rpSection('d-tech', 'Page data', 'Technology', 'Frameworks, platforms and services detected from the page, its scripts and response headers. Items marked “likely” are inferred.',
    `<div class="card">${techRows ? `<ul class="plain">${techRows}</ul>` : '<div class="empty">No recognizable technologies detected.</div>'}</div>`);

  /* ---------- contact, trust, site files ---------- */
  const mc = data.mediaContact || {};
  const ts = data.trustSignals || {};
  const list = (a, fn) => (a && a.length) ? a.map(fn || rpEsc).join('<br>') : '';
  const socials = (mc.socialLinks || []).map(s => `<a href="${rpEsc(s.url)}">${rpEsc(s.platform)}</a>`).join(' · ');
  const contactSec = rpSection('d-contact', 'Page data', 'Contact and trust', 'Who is behind the page, and signals that build confidence.',
    `<div class="two"><div class="card">${rpKV([['Name', rpEsc(mc.name)], ['Organization', rpEsc(mc.organization)], ['Job title', rpEsc(mc.jobTitle)], ['Emails', list(mc.emails)], ['Phones', list(mc.phones)], ['Addresses', list(mc.addresses)], ['Social profiles', socials]])}</div>
      <div class="card">${rpKV([['Trust badges', String(ts.trustBadgeCount || 0), ts.trustBadgeCount ? rpStatus('ok', 'Found') : rpStatus('none', 'None')], ['Testimonials', ts.testimonialSectionFound ? 'Section found' : '', ts.testimonialSectionFound ? rpStatus('ok', 'Found') : rpStatus('none', 'None')], ['Review markup', ts.reviewSchemaFound ? 'Present' : '', ts.reviewSchemaFound ? rpStatus('ok', 'Found') : rpStatus('none', 'None')]])}</div></div>`);

  const rt = siteFiles && siteFiles.robotsTxt, sm = siteFiles && siteFiles.sitemapXml;
  const filesSec = rpSection('d-files', 'Page data', 'Site files', 'Files that tell search engines and AI crawlers how to treat the site.',
    `<div class="card">${rpKV([
      ['robots.txt', rt && rt.present ? `Found (${rt.size} bytes)${rt.hasSitemapDirective ? ', lists a sitemap' : ''}` : (siteFiles ? 'Not found' : 'Not checked'), rt && rt.present ? rpStatus('ok', 'Found') : rpStatus('warn', 'Missing')],
      ['sitemap.xml', sm && sm.present ? `Found (${sm.urlCount} URLs listed)` : (siteFiles ? 'Not found at the standard location' : 'Not checked'), sm && sm.present ? rpStatus('ok', 'Found') : rpStatus('warn', 'Missing')]
    ])}</div>`);

  /* ---------- agent readiness ---------- */
  let agentSec = '';
  if (typeof AR !== 'undefined' && AR.phase === 'done' && typeof arSummary === 'function') {
    const s = arSummary(data);
    const rows = AR_DEFS.filter(x => AR.results[x.id]).map(x => {
      const r = AR.results[x.id];
      const kind = r.status === 'pass' ? 'ok' : r.status === 'fail' ? 'bad' : r.status === 'unable' ? 'warn' : 'none';
      return [x.label, rpEsc(r.message), rpStatus(kind, r.status === 'pass' ? 'Pass' : r.status === 'fail' ? 'Missing' : r.status === 'unable' ? 'Unverified' : 'N/A')];
    });
    agentSec = rpSection('d-agent', 'Page data', 'Agent readiness', 'Whether AI agents can find, read and use this site: robots.txt AI rules, Content Signals, Link headers, Markdown, API catalog, OAuth, MCP, skills and more. Checked anonymously, with no cookies.',
      `<div class="card"><div class="stats">${rpStat('Level', s.lv.level + ' / 5')}${rpStat('Stage', rpEsc(s.lv.name))}${rpStat('Score', s.sc.score == null ? '—' : s.sc.score)}${rpStat('Checks passed', s.sc.pass + ' of ' + s.sc.total)}</div></div>
      <div class="card">${rpKV(rows)}</div>`);
  }

  const nav = [['overview', 'Overview'], ['plan', 'Action plan'], ['categories', 'Results by area'], ['d-search', 'Search appearance'], ['d-social', 'Social sharing'], ['d-structure', 'Content structure'], ['d-links', 'Links and images'], ['d-perf', 'Performance'], ['d-signals', 'Accessibility, UX, AI']].concat(agentSec ? [['d-agent', 'Agent readiness']] : [], [['d-tech', 'Technology'], ['d-contact', 'Contact and trust'], ['d-files', 'Site files']]);
  const summaryText = `${title}\n${url}\nScore ${A.composite == null ? 'n/a' : A.composite}/100 · ${issues.length} issues (${cnt.High} high, ${cnt.Medium} medium, ${cnt.Low} low)\n` + scored.map(c => `${c.name}: ${c.score == null ? 'n/a' : c.score}`).join(' · ');
  const actions = `<button class="tb-btn" type="button" data-copy="${rpEsc(summaryText)}">${rpIcon('copy', 14)} Copy summary</button>`;

  return rpDocument({
    kind: 'Page report', title, host, nav, actions,
    body: hero + plan + categories + searchSec + socialSec + structureSec + linksSec + perfSec + signalsSec + agentSec + techSec + contactSec + filesSec
  });
}

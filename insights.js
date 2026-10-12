/* insights.js — panel side of the deeper audits.
 *
 *   1. checks     image, page-weight, LCP and readability checks that join the Speed and SEO audits
 *   2. snapshots  every scan is stored per page; the next scan is diffed against it
 *   3. screens    Image audit, Layout shifts & LCP, Readability, Changes (registered in SH_SCREENS)
 *
 * Measured data comes from content_insights.js (data.insights). Everything here is optional: when a
 * page has no insights the audits simply have fewer checks.
 */

/* ------------------------------------------------------------------ formatting */
function insBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function insPlural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
function insAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return insPlural(m, 'minute') + ' ago';
  const h = Math.floor(m / 60); if (h < 24) return insPlural(h, 'hour') + ' ago';
  const d = Math.floor(h / 24); if (d < 60) return insPlural(d, 'day') + ' ago';
  const mo = Math.floor(d / 30); if (mo < 24) return insPlural(mo, 'month') + ' ago';
  return insPlural(Math.floor(d / 365), 'year') + ' ago';
}
function insDays(ts) { return Math.floor((Date.now() - ts) / 86400000); }
function insDate(ts) { try { return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
function insShort(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function insFile(url) {
  try { const u = new URL(url); const f = u.pathname.split('/').filter(Boolean).pop() || u.hostname; return decodeURIComponent(f); } catch (e) { return String(url).slice(0, 40); }
}
function insHost(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

/* ------------------------------------------------------------------ checks */
// Where a check can point at something on the live page.
function insShowAction(selector, label) { return selector ? { label: 'Show on page', op: 'show', sel: selector, lbl: label || '' } : null; }
function insOpenAction(screen, label) { return { label: label, op: 'open', screen: screen }; }

function insImageChecks(d) {
  const ins = d.insights;
  if (!ins) return [];
  const out = [];
  const img = ins.images, s = img && img.summary;
  const items = (img && img.items) || [];
  const lcp = ins.lcp;

  if (s && s.count > 0) {
    const big = items.filter(i => i.wasted > 0).sort((a, b) => b.wasted - a.wasted);
    const bigFail = s.wastedBytes >= 50 * 1024 || s.oversized >= 3;
    out.push({
      label: 'Images are sized for where they are shown', pass: !bigFail, sev: s.wastedBytes >= 500 * 1024 ? 'High' : 'Medium',
      t: 'Resize oversized images',
      line: `${insPlural(s.oversized, 'image is', 'images are')} larger than needed, wasting about ${insBytes(s.wastedBytes)}.`,
      mean: 'A photo that is much bigger than its slot still downloads in full. It slows the page for everyone, most of all on mobile data.',
      fix: 'Export images at roughly twice their displayed width, or use srcset so each device gets a fitting size.',
      tag: '<img src="photo-800.jpg" srcset="photo-800.jpg 800w, photo-1600.jpg 1600w" sizes="(min-width: 800px) 800px, 100vw" alt="">',
      section: 'ins:images', actions: [big[0] ? insShowAction(big[0].selector, 'Largest waste') : null, insOpenAction('images', 'Open image audit')]
    });

    const nodims = items.filter(i => !i.hasDims && i.loaded);
    out.push({
      label: 'Images reserve their space', pass: nodims.length === 0, sev: 'Medium',
      t: 'Set width and height on images',
      line: `${insPlural(nodims.length, 'image has', 'images have')} no width and height, so the page jumps when they load.`,
      mean: 'Without dimensions the browser cannot hold the space, and the content below shifts when the image arrives. That is the most common cause of layout shift.',
      fix: 'Add width and height attributes that match the image, or set a CSS aspect-ratio.',
      tag: '<img src="photo.jpg" width="800" height="600" alt="">',
      section: 'ins:images', actions: [nodims[0] ? insShowAction(nodims[0].selector, 'No dimensions') : null, insOpenAction('images', 'Open image audit')]
    });

    out.push({
      label: 'Images use modern formats', pass: s.legacyFormat === 0, sev: 'Low',
      t: 'Serve images as WebP or AVIF',
      line: `${insPlural(s.legacyFormat, 'JPEG or PNG image')} could save about ${insBytes(s.formatSaveBytes)} in a modern format (estimate).`,
      mean: 'WebP and AVIF files are typically 25 to 50 percent smaller at the same quality.',
      fix: 'Convert large JPEG and PNG images to WebP or AVIF, keeping the original as a fallback with <picture>.',
      tag: '<picture><source srcset="photo.avif" type="image/avif"><source srcset="photo.webp" type="image/webp"><img src="photo.jpg" alt=""></picture>',
      section: 'ins:images', actions: [insOpenAction('images', 'Open image audit')]
    });

    if (s.offscreenEager > 0) {
      const eager = items.filter(i => !i.aboveFold && !i.lazy && i.loaded && i.bytes > 40 * 1024);
      out.push({
        label: 'Images below the fold load lazily', pass: false, sev: 'Low',
        t: 'Lazy-load images below the fold',
        line: `${insPlural(s.offscreenEager, 'large image')} below the first screen load straight away.`,
        mean: 'Images nobody can see yet compete with the content that matters for the first paint.',
        fix: 'Add loading="lazy" to images that start below the first screen.',
        tag: '<img src="photo.jpg" loading="lazy" width="800" height="600" alt="">',
        section: 'ins:images', actions: [eager[0] ? insShowAction(eager[0].selector, 'Loads early') : null]
      });
    }
    if (s.lazyAboveFold > 0) {
      const lz = items.filter(i => i.aboveFold && i.lazy && i.displayW * i.displayH > 90000);
      out.push({
        label: 'Main images are not lazy-loaded', pass: false, sev: 'High',
        t: 'Remove lazy loading from the main image',
        line: `${insPlural(s.lazyAboveFold, 'large image')} in the first screen is lazy-loaded, which delays it.`,
        mean: 'Lazy loading holds the image back until the browser has laid out the page, so the largest paint arrives late.',
        fix: 'Remove loading="lazy" from images visible on first load, and mark the main one fetchpriority="high".',
        tag: '<img src="hero.jpg" fetchpriority="high" width="1200" height="600" alt="">',
        section: 'ins:images', actions: [lz[0] ? insShowAction(lz[0].selector, 'Lazy but visible') : null]
      });
    }
  }

  if (lcp && lcp.isImage) {
    const slow = lcp.time > 2500;
    const fixable = lcp.lazy || (!lcp.preloaded && lcp.priority !== 'high');
    out.push({
      label: 'The main image loads promptly', pass: !(slow && fixable) && !lcp.lazy, sev: slow ? 'High' : 'Medium',
      t: 'Speed up the largest image',
      line: `The largest element (${insShort(lcp.label || lcp.tag, 36)}) appeared at ${(lcp.time / 1000).toFixed(2)}s${lcp.lazy ? ' and is lazy-loaded' : (lcp.preloaded ? '' : ' with no preload hint')}.`,
      mean: 'This image decides your Largest Contentful Paint, the main loading score Google reports.',
      fix: 'Preload it, mark it fetchpriority="high", never lazy-load it, and keep it as small as the layout allows.',
      tag: '<link rel="preload" as="image" href="hero.jpg" fetchpriority="high">',
      section: 'ins:shifts', actions: [insShowAction(lcp.selector, 'Largest element'), insOpenAction('shifts', 'Open layout & LCP')]
    });
  }

  const w = ins.weight;
  if (w && w.total > 0) {
    const mb = w.total / 1048576;
    out.push({
      label: 'Page weight stays under 3 MB', pass: mb <= 3, sev: mb > 6 ? 'High' : 'Medium',
      t: 'Reduce total page weight',
      line: `The page transferred about ${insBytes(w.total)}${w.unknown ? ` (${insPlural(w.unknown, 'file')} did not report a size)` : ''}.`,
      mean: 'Heavy pages take longer to load, cost visitors mobile data and rank worse on slow connections.',
      fix: 'Start with the heaviest files in the image audit, then compress scripts and defer what is not needed first.',
      section: 'ins:images', actions: [insOpenAction('images', 'Open image audit')]
    });
  }
  return out;
}

function insReadabilityChecks(d) {
  const r = d.insights && d.insights.readability;
  if (!r || !r.reliable) return [];
  const out = [];
  out.push({
    label: 'The text reads at an easy level', pass: r.grade <= 10, sev: r.grade > 13 ? 'Medium' : 'Low',
    t: 'Simplify the wording',
    line: `The text reads at grade ${r.grade} (Flesch ${r.flesch}, ${insReadingLabel(r.flesch).toLowerCase()}).`,
    mean: 'Most web readers skim. Text above grade 10 loses a large share of them, including people reading in a second language.',
    fix: 'Use shorter words and sentences. Aim for grade 7 to 9 unless the audience is specialist.',
    section: 'ins:readability', actions: [insOpenAction('readability', 'Open readability')]
  });
  out.push({
    label: 'Sentences stay a comfortable length', pass: r.avgSentenceWords <= 20 && r.longSentencePct <= 15, sev: 'Low',
    t: 'Shorten long sentences',
    line: `Sentences average ${r.avgSentenceWords} words and ${r.longSentencePct}% run past 25 words.`,
    mean: 'Long sentences make readers hold more in their head. They are the quickest readability win.',
    fix: 'Split sentences that carry more than one idea, ideally under 20 words.',
    section: 'ins:readability', actions: [insOpenAction('readability', 'Open readability')]
  });
  out.push({
    label: 'Passive voice is used sparingly', pass: r.passivePct <= 20, sev: 'Low',
    t: 'Use fewer passive sentences',
    line: `About ${r.passivePct}% of sentences look passive (a rough estimate).`,
    mean: 'Passive phrasing hides who does what and reads as distant.',
    fix: 'Rewrite “the plan was approved by the board” as “the board approved the plan”.',
    section: 'ins:readability', actions: [insOpenAction('readability', 'Open readability')]
  });
  if (r.paragraphs && r.paragraphs.count) {
    out.push({
      label: 'Paragraphs are short enough to scan', pass: r.paragraphs.long === 0 && r.paragraphs.avg <= 90, sev: 'Low',
      t: 'Break up long paragraphs',
      line: `${insPlural(r.paragraphs.long, 'paragraph')} run over 120 words; the longest is ${r.paragraphs.longest} words.`,
      mean: 'Walls of text discourage reading, especially on a phone.',
      fix: 'Keep paragraphs to two to four sentences and add subheadings.',
      section: 'ins:readability', actions: [insOpenAction('readability', 'Open readability')]
    });
  }
  return out;
}

// The page's own dates, when it publishes them: a quiet signal that content may have decayed.
function insFreshnessChecks(d) {
  const seo = d.seo || {};
  const raw = seo.articleModified || seo.articlePublished;
  if (!raw) return [];
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts) || ts > Date.now() + 86400000) return [];
  const days = insDays(ts);
  return [{
    label: 'Content was updated within the last year', pass: days <= 365, sev: 'Low',
    t: 'Refresh older content',
    line: `The page says it was last ${seo.articleModified ? 'updated' : 'published'} ${insAgo(ts)}.`,
    mean: 'Search engines and readers both trust recent content more, and old facts quietly become wrong.',
    fix: 'Review the page, update anything stale and publish a new modified date.'
  }];
}

// Blend extra checks into a category score without letting them swamp the measured one.
function insBlend(base, extra, weight) {
  if (!extra.length) return base;
  const pct = Math.round(extra.filter(c => c.pass).length / extra.length * 100);
  if (base == null) return pct;
  return Math.round(base * (1 - weight) + pct * weight);
}

/* ------------------------------------------------------------------ labels */
function insReadingLabel(f) {
  return f >= 90 ? 'Very easy' : f >= 80 ? 'Easy' : f >= 70 ? 'Fairly easy' : f >= 60 ? 'Plain English' : f >= 50 ? 'Fairly difficult' : f >= 30 ? 'Difficult' : 'Very difficult';
}
function insTier(metric, v) { const t = getCwvTier(metric, v); return t === 'good' ? ['Good', 'ok'] : t === 'poor' ? ['Poor', 'bad'] : t ? ['Needs work', 'warn'] : ['Not measured', 'none']; }

/* ------------------------------------------------------------------ snapshots */
const INS = { key: '', snaps: [], cmp: null, track: true, ready: false, saving: false };
const INS_STORE = 'ins_snaps';
const INS_MAX_PER_PAGE = 20, INS_MAX_PAGES = 80;
const INS_TRACKERS = ['Analytics', 'Advertising', 'Marketing Automation', 'Tag Manager', 'A/B Testing', 'Monitoring'];

function insKey(url) {
  try {
    const u = new URL(url);
    const keep = [];
    u.searchParams.forEach((v, k) => { if (!/^(utm_|fbclid|gclid|mc_|ref$)/i.test(k)) keep.push(k + '=' + v); });
    let p = u.pathname.replace(/\/+$/, '') || '/';
    return u.hostname.replace(/^www\./, '').toLowerCase() + p + (keep.length ? '?' + keep.join('&') : '');
  } catch (e) { return ''; }
}

function insFont(f) { return String(f || '').split(',')[0].replace(/["']/g, '').trim(); }

// A compact, diff-able subset of the scan.
function insSnapshotFrom(A) {
  const d = A.data, ins = d.insights || {};
  const seo = d.seo || {};
  const robots = (seo.robots && typeof seo.robots === 'object') ? seo.robots : {};
  const scores = {};
  A.cats.forEach(c => { if (c.score != null) scores[c.id] = c.score; });
  const tech = {};
  try { lastTechStackGrouped.forEach((names, cat) => { tech[cat] = names.map(n => n.replace(/ \(likely\)$/, '')); }); } catch (e) { }
  const v = d.webVitals || {};
  const imgs = ins.images && ins.images.summary;
  return {
    v: 1, t: Date.now(), seen: Date.now(), url: (d.meta && d.meta.pageUrl) || '',
    title: (d.meta && d.meta.title) || '', desc: (d.meta && d.meta.description) || '', canonical: (d.meta && d.meta.canonical) || '',
    h1: (d.outline || []).filter(h => String(h.tag).toLowerCase() === 'h1').map(h => insShort(h.text, 90)).slice(0, 4),
    headings: (d.outline || []).length, words: (d.meta && d.meta.wordCount) || 0,
    noindex: !!robots.noindex, ogImage: !!(d.socialMeta && d.socialMeta.og && d.socialMeta.og.image),
    modified: seo.articleModified || seo.articlePublished || '',
    sdTypes: ((d.structuredData && d.structuredData.types) || []).slice(0, 12),
    scores: scores, composite: A.composite,
    vitals: { lcp: v.lcp, cls: v.cls, fcp: v.fcp, ttfb: v.ttfb },
    fonts: Array.from(new Set((d.fonts || []).map(insFont).filter(Boolean))).slice(0, 12),
    colors: [].concat(d.colors || [], d.bgColors || []).map(c => c.hex).filter((h, i, a) => h && a.indexOf(h) === i).slice(0, 40),
    tech: tech,
    img: imgs ? { n: imgs.count, bytes: imgs.totalBytes, save: imgs.savableBytes } : null,
    tpv: (() => { try { const a = tpAnalyze(d); return a ? a.vendors.slice(0, 30).map(v => [v.vendor, v.cat, v.bytes]) : null; } catch (e) { return null; } })(),
    weight: ins.weight ? ins.weight.total : null,
    links: (d.links || []).length,
    issues: A.issues.map(i => [i.id, i.sev, insShort(i.t, 70)]).slice(0, 60)
  };
}

// The parts that describe the content itself, used to tell how long a page has stood still.
function insContentFp(s) {
  return [s.title, s.desc, s.canonical, (s.h1 || []).join('|'), s.headings, Math.round((s.words || 0) / 25)].join('¦');
}

function insLoad(url, cb) {
  const key = insKey(url);
  INS.key = key;
  chrome.storage.local.get([INS_STORE, 'ins_track'], (res) => {
    INS.track = res.ins_track !== false;
    const all = res[INS_STORE] || {};
    INS.snaps = (all[key] || []).slice();
    cb && cb(all);
  });
}

function insSave(snap, all) {
  const key = INS.key;
  let list = (all[key] || []).slice();
  const last = list[list.length - 1];
  // rescans within half an hour refresh the latest snapshot instead of adding noise
  if (last && snap.t - last.t < 30 * 60 * 1000) list[list.length - 1] = Object.assign({}, snap, { first: last.first || last.t });
  else list.push(Object.assign({}, snap, { first: snap.t }));
  list = list.slice(-INS_MAX_PER_PAGE);
  all[key] = list;
  const keys = Object.keys(all);
  if (keys.length > INS_MAX_PAGES) {
    keys.sort((a, b) => all[a][all[a].length - 1].t - all[b][all[b].length - 1].t).slice(0, keys.length - INS_MAX_PAGES).forEach(k => delete all[k]);
  }
  INS.snaps = list;
  chrome.storage.local.set({ [INS_STORE]: all });
}

// Called after every successful scan (shell.js: shAfterScan).
function insOnScan(url) {
  INS.ready = false; INS.cmp = null;
  insLoad(url, (all) => {
    INS.ready = true;
    const A = shAudit();
    // tech detection finishes a moment after the scan, so wait for it before storing
    clearTimeout(INS.timer);
    const finish = () => {
      if (!A || !INS.track || !INS.key) { shRerenderIfIdle(); return; }
      const snap = insSnapshotFrom(shAudit() || A);
      insLoad(url, (fresh) => { insSave(snap, fresh); shRerenderIfIdle(); });
    };
    shRerenderIfIdle();
    INS.timer = setTimeout(finish, 2200);
  });
}
function shRerenderIfIdle() { try { if (!SH.scanning) shRender(); } catch (e) { } }

// The snapshot being compared against and the current one.
function insPair() {
  const list = INS.snaps;
  if (list.length < 2) return null;
  const cur = list[list.length - 1];
  let idx = INS.cmp != null ? INS.cmp : list.length - 2;
  if (idx < 0 || idx >= list.length - 1) idx = list.length - 2;
  return { prev: list[idx], cur: cur, idx: idx };
}

// How long the page's content has been the same.
function insStableSince() {
  const list = INS.snaps;
  if (!list.length) return null;
  const fp = insContentFp(list[list.length - 1]);
  let ts = list[list.length - 1].first || list[list.length - 1].t;
  for (let i = list.length - 2; i >= 0; i--) { if (insContentFp(list[i]) !== fp) break; ts = list[i].first || list[i].t; }
  return ts;
}

/* ------------------------------------------------------------------ diff */
function insDiff(a, b) {
  const out = [];
  const add = (k, area, t, from, to, extra) => out.push(Object.assign({ k: k, area: area, t: t, from: from, to: to }, extra || {}));

  // content
  if (a.title !== b.title) add(b.title ? 'change' : 'regress', 'Content', b.title ? 'Title rewritten' : 'Title removed', a.title, b.title);
  if (a.desc && !b.desc) add('regress', 'Content', 'Meta description removed', a.desc, '');
  else if (!a.desc && b.desc) add('improve', 'Content', 'Meta description added', '', b.desc);
  else if (a.desc !== b.desc) add('change', 'Content', 'Meta description rewritten', a.desc, b.desc);
  if (a.h1.length && !b.h1.length) add('regress', 'Content', 'H1 removed', a.h1[0], '');
  else if (!a.h1.length && b.h1.length) add('improve', 'Content', 'H1 added', '', b.h1[0]);
  else if (a.h1[0] !== b.h1[0]) add('change', 'Content', 'Main heading changed', a.h1[0], b.h1[0]);
  if (b.h1.length > 1 && a.h1.length <= 1) add('regress', 'Content', 'Multiple H1 headings', String(a.h1.length), String(b.h1.length));
  if (a.canonical !== b.canonical) add('change', 'Content', 'Canonical URL changed', a.canonical, b.canonical);
  if (!a.noindex && b.noindex) add('regress', 'Content', 'Page is now set to noindex', 'indexable', 'noindex', { high: true });
  if (a.noindex && !b.noindex) add('improve', 'Content', 'Page is indexable again', 'noindex', 'indexable');
  if (a.words && Math.abs(b.words - a.words) >= 50 && Math.abs(b.words - a.words) / a.words >= 0.2) {
    add(b.words < a.words * 0.6 ? 'regress' : 'change', 'Content', b.words > a.words ? 'Content grew' : 'Content shrank', a.words + ' words', b.words + ' words');
  }
  const sdGone = (a.sdTypes || []).filter(x => (b.sdTypes || []).indexOf(x) < 0), sdNew = (b.sdTypes || []).filter(x => (a.sdTypes || []).indexOf(x) < 0);
  if (sdGone.length) add('regress', 'Content', 'Structured data removed', sdGone.join(', '), '');
  if (sdNew.length) add('improve', 'Content', 'Structured data added', '', sdNew.join(', '));
  if (a.ogImage && !b.ogImage) add('regress', 'Content', 'Social preview image removed', '', '');

  // scores
  const names = { seo: 'SEO', design: 'Design', a11y: 'Accessibility', speed: 'Speed', ai: 'AI readiness', ux: 'UX' };
  Object.keys(names).forEach(id => {
    const x = a.scores && a.scores[id], y = b.scores && b.scores[id];
    if (x == null || y == null || Math.abs(y - x) < 5) return;
    add(y > x ? 'improve' : 'regress', 'Scores', names[id] + ' score ' + (y > x ? 'rose' : 'fell'), String(x), String(y), { num: true });
  });

  // vitals
  const vname = { lcp: 'Largest paint (LCP)', cls: 'Layout shift (CLS)', fcp: 'First paint (FCP)', ttfb: 'Server response (TTFB)' };
  ['lcp', 'cls', 'fcp', 'ttfb'].forEach(m => {
    const x = a.vitals && a.vitals[m], y = b.vitals && b.vitals[m];
    if (x == null || y == null) return;
    const tx = getCwvTier(m, x), ty = getCwvTier(m, y);
    const rank = { good: 0, 'needs-improvement': 1, poor: 2 };
    const abs = Math.abs(y - x);
    const big = m === 'cls' ? abs >= 0.05 : (abs >= 300 && abs / Math.max(x, 1) >= 0.2);
    if (rank[ty] === rank[tx] && !big) return;
    const worse = rank[ty] > rank[tx] || (rank[ty] === rank[tx] && y > x);
    add(worse ? 'regress' : 'improve', 'Speed', vname[m] + (worse ? ' got worse' : ' improved'), formatCwvValue(m, x), formatCwvValue(m, y), { high: worse && ty === 'poor' });
  });
  if (a.weight && b.weight && Math.abs(b.weight - a.weight) / a.weight >= 0.25 && Math.abs(b.weight - a.weight) > 200 * 1024) {
    add(b.weight > a.weight ? 'regress' : 'improve', 'Speed', b.weight > a.weight ? 'Page got heavier' : 'Page got lighter', insBytes(a.weight), insBytes(b.weight));
  }
  if (a.img && b.img && b.img.save - a.img.save >= 100 * 1024) add('regress', 'Speed', 'More wasted image bytes', insBytes(a.img.save), insBytes(b.img.save));

  // technology
  const flat = (t) => { const m = {}; Object.keys(t || {}).forEach(c => t[c].forEach(n => { m[n] = c; })); return m; };
  const ta = flat(a.tech), tb = flat(b.tech);
  if (Object.keys(ta).length || Object.keys(tb).length) {
    Object.keys(tb).filter(n => !(n in ta)).forEach(n => {
      const tracker = INS_TRACKERS.indexOf(tb[n]) >= 0;
      add(tracker ? 'regress' : 'change', 'Technology', tracker ? 'New tracker: ' + n : 'New technology: ' + n, '', tb[n]);
    });
    Object.keys(ta).filter(n => !(n in tb)).forEach(n => add('change', 'Technology', 'No longer detected: ' + n, ta[n], ''));
  }

  // third-party vendors
  if (a.tpv && b.tpv) {
    const pa = {}, pb = {};
    a.tpv.forEach(v => { pa[v[0]] = v; }); b.tpv.forEach(v => { pb[v[0]] = v; });
    const watched = /^(Advertising|Analytics|Marketing|Tag manager|Testing)$/;
    Object.keys(pb).filter(n => !(n in pa)).forEach(n => add(watched.test(pb[n][1]) ? 'regress' : 'change', 'Technology', 'New third-party code: ' + n, '', pb[n][1]));
    Object.keys(pa).filter(n => !(n in pb)).forEach(n => add('change', 'Technology', 'Third-party code removed: ' + n, pa[n][1], ''));
  }

  // design
  const fa = a.fonts || [], fb = b.fonts || [];
  const fNew = fb.filter(f => fa.indexOf(f) < 0), fGone = fa.filter(f => fb.indexOf(f) < 0);
  if (fNew.length) add(fb.length > 3 ? 'regress' : 'change', 'Design', insPlural(fNew.length, 'new font') + ' in use', '', fNew.join(', '));
  if (fGone.length) add('change', 'Design', insPlural(fGone.length, 'font') + ' no longer in use', fGone.join(', '), '');
  const ca = a.colors || [], cb = b.colors || [];
  const cNew = cb.filter(c => ca.indexOf(c) < 0), cGone = ca.filter(c => cb.indexOf(c) < 0);
  if (cNew.length || cGone.length) {
    add(cNew.length - cGone.length >= 3 ? 'regress' : 'change', 'Design', cNew.length - cGone.length >= 3 ? 'Palette is growing' : 'Colors changed',
      cGone.length ? cGone.length + ' removed' : '', cNew.length ? cNew.length + ' added' : '', { swatches: { gone: cGone.slice(0, 8), added: cNew.slice(0, 8) } });
  }

  // audit findings
  const ia = {}, ib = {};
  (a.issues || []).forEach(i => { ia[i[0]] = i; }); (b.issues || []).forEach(i => { ib[i[0]] = i; });
  Object.keys(ib).filter(k => !(k in ia)).forEach(k => add('regress', 'Audit · ' + ib[k][1] + ' priority', 'New issue: ' + ib[k][2], '', '', { high: ib[k][1] === 'High' }));
  Object.keys(ia).filter(k => !(k in ib)).forEach(k => add('improve', 'Audit · was ' + ia[k][1], 'Fixed: ' + ia[k][2], '', '', {}));

  const rank = { regress: 0, improve: 2, change: 1 };
  return out.sort((x, y) => (rank[x.k] - rank[y.k]) || ((y.high ? 1 : 0) - (x.high ? 1 : 0)));
}

function insDiffSummary(list) {
  return { regress: list.filter(x => x.k === 'regress').length, improve: list.filter(x => x.k === 'improve').length, change: list.filter(x => x.k === 'change').length };
}

/* ------------------------------------------------------------------ screens: shared bits */
function insTiles(rows) {
  return `<div class="ins-tiles" style="--cols:${rows.length === 4 ? 4 : rows.length === 6 ? 3 : 2}">${rows.map(r => `<div class="ins-tile${r[2] ? ' ' + r[2] : ''}"><small>${shEsc(r[0])}</small><b>${r[1]}</b></div>`).join('')}</div>`;
}
function insBtn(label, op, attrs, cls) {
  const a = Object.keys(attrs || {}).map(k => ` data-${k}="${shEsc(attrs[k])}"`).join('');
  return `<button type="button" class="sh-btn sm${cls ? ' ' + cls : ''}" data-sh="ins" data-v="${op}"${a}>${label}</button>`;
}
function insEmpty(icon, title, text) {
  return `<div class="sh-card"><div class="sh-empty"><span class="sh-empty-ic">${shIcon(icon, 26)}</span><b>${title}</b>${text}</div></div>`;
}

/* ------------------------------------------------------------------ screen: image audit */
const INS_KIND = { image: 'Images', script: 'Scripts', style: 'Styles', font: 'Fonts', document: 'Page', data: 'Data', media: 'Video', other: 'Other' };
const INS_KIND_COLOR = { image: '#ea580c', script: '#6366f1', style: '#0ea5e9', font: '#14b8a6', document: '#64748b', data: '#a855f7', media: '#ec4899', other: '#94a3b8' };

function insImageRow(i) {
  const chips = [];
  if (i.wasted > 0) chips.push(`<span class="ins-chip bad">${i.oversize}× too large</span>`);
  if (i.undersized) chips.push('<span class="ins-chip warn">Blurry on sharp screens</span>');
  if (!i.hasDims && i.loaded) chips.push('<span class="ins-chip warn">No width/height</span>');
  if (i.formatSave > 0) chips.push(`<span class="ins-chip info">${(i.format || '').toUpperCase()} → WebP</span>`);
  if (!i.aboveFold && !i.lazy && i.bytes > 40 * 1024) chips.push('<span class="ins-chip info">Not lazy</span>');
  if (!i.alt) chips.push('<span class="ins-chip warn">No alt</span>');
  const thumb = i.inline ? '' : `<img class="ins-thumb" src="${shEsc(i.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  const save = (i.wasted || 0) + (i.formatSave || 0);
  return `<div class="ins-img">
      ${thumb ? `<span class="ins-thumbwrap">${thumb}</span>` : `<span class="ins-thumbwrap ins-thumb-ph">${shIcon('image', 16)}</span>`}
      <span class="ins-img-tx"><b>${shEsc(i.inline ? (i.label || 'Inline image') : insFile(i.url))}</b>
        <small>Shown ${i.displayW}×${i.displayH} · file ${i.naturalW}×${i.naturalH}${i.format ? ' · ' + i.format.toUpperCase() : ''}</small>
        ${chips.length ? `<span class="ins-chips">${chips.join('')}</span>` : ''}</span>
      <span class="ins-img-size"><b>${insBytes(i.bytes)}</b>${save > 0 ? `<small class="ok">save ~${insBytes(save)}</small>` : ''}</span>
      <button type="button" class="ins-go" data-sh="ins" data-v="show" data-sel="${shEsc(i.selector)}" data-lbl="${shEsc(insBytes(i.bytes))}" aria-label="Show on page" title="Show on page">${shIcon('target', 15)}</button>
    </div>`;
}

function insImagesScreen(A) {
  const ins = A.data.insights;
  const img = ins && ins.images, w = ins && ins.weight;
  if (!img || !img.items.length) return insEmpty('image', 'No images measured', 'This page has no images that could be measured.');
  const s = img.summary;
  let h = insTiles([
    ['Images', s.count], ['Transferred', insBytes(s.totalBytes)],
    ['Could save', insBytes(s.savableBytes), s.savableBytes > 100 * 1024 ? 'bad' : s.savableBytes > 0 ? 'warn' : 'ok'],
    ['Oversized', s.oversized, s.oversized ? 'warn' : 'ok']
  ]);
  h += `<p class="ins-note">Sizes use the browser’s own resource timing. Savings are estimates: resizing is measured against the space each image fills on this screen; modern formats assume about 30% smaller.${s.unknownBytes ? ` ${insPlural(s.unknownBytes, 'image')} did not report a file size (other servers can hide it).` : ''}</p>`;

  if (w && w.total > 0) {
    const kinds = Object.keys(w.byType).sort((a, b) => w.byType[b] - w.byType[a]);
    h += `<div class="sh-sec"><span>Page weight <em>${insBytes(w.total)}</em></span></div><div class="sh-card ins-pad">
      <div class="ins-bar" role="img" aria-label="Page weight by type">${kinds.map(k => `<i style="width:${Math.max(2, w.byType[k] / w.total * 100)}%;background:${INS_KIND_COLOR[k] || '#94a3b8'}" title="${INS_KIND[k] || k}: ${insBytes(w.byType[k])}"></i>`).join('')}</div>
      <div class="ins-legend">${kinds.map(k => `<span><i style="background:${INS_KIND_COLOR[k] || '#94a3b8'}"></i>${INS_KIND[k] || k} <b>${insBytes(w.byType[k])}</b></span>`).join('')}</div>
      ${w.top.length ? `<div class="ins-heavy">${w.top.slice(0, 5).map(r => `<div><span title="${shEsc(r.url)}">${shEsc(insShort(insFile(r.url), 34))}<small>${shEsc(insHost(r.url))}</small></span><b>${insBytes(r.bytes)}</b></div>`).join('')}</div>` : ''}
    </div>`;
  }

  const ranked = img.items.slice().sort((a, b) => ((b.wasted + b.formatSave) - (a.wasted + a.formatSave)) || ((b.bytes || 0) - (a.bytes || 0)));
  h += `<div class="sh-sec"><span>Images, worst first <em>${img.items.length}</em></span></div><div class="sh-card ins-list">${ranked.slice(0, 30).map(insImageRow).join('')}</div>`;
  if (ranked.length > 30) h += `<p class="ins-note">Showing the 30 worst of ${ranked.length}.</p>`;
  h += `<div class="sh-btns ins-foot">${insBtn(shIcon('copy', 13) + ' Copy list', 'copy-images')}${insBtn('Clear highlight', 'clear')}</div>`;
  return h;
}

/* ------------------------------------------------------------------ screen: layout shifts and LCP */
function insShiftsScreen(A) {
  const ins = A.data.insights || {};
  const sh = ins.shifts, lcp = ins.lcp;
  const v = A.data.webVitals || {};
  let h = '';
  const cls = sh ? sh.cls : v.cls;
  const ct = insTier('cls', cls);
  h += `<div class="sh-sec"><span>Layout shift <em>CLS</em></span></div><div class="sh-card ins-pad">
      <div class="ins-metric"><span class="ins-big ${ct[1]}">${cls == null ? '—' : cls.toFixed(3)}</span><span class="sh-tchip ${ct[1]}">${ct[0]}</span><small>Good is 0.1 or less</small></div>`;
  if (sh && sh.culprits.length) {
    const top = sh.culprits[0];
    h += `<p class="ins-lede"><b>${shEsc(insShort(top.label, 40))}</b> caused ${Math.round(top.value / Math.max(sh.total, 0.001) * 100)}% of the shifting.</p>
      <div class="ins-culprits">${sh.culprits.map((c, i) => {
        const share = Math.round(c.value / Math.max(sh.total, 0.001) * 100);
        return `<div class="ins-cul"><span class="ins-cul-n">${i + 1}</span>
          <span class="ins-cul-tx"><b>${shEsc(insShort(c.label, 44))}</b><small>${c.gone ? 'Removed from the page after it shifted' : shEsc(insShort(c.selector, 56))}</small>
            <span class="ins-share"><i style="width:${Math.max(3, share)}%"></i></span></span>
          <span class="ins-cul-v"><b>${c.value.toFixed(3)}</b><small>${share}%</small></span>
          <span class="ins-cul-a">${c.gone ? '' : `<button type="button" class="ins-go" data-sh="ins" data-v="show" data-sel="${shEsc(c.selector)}" data-lbl="${c.value.toFixed(3)}" title="Show on page" aria-label="Show on page">${shIcon('target', 15)}</button>`}
            <button type="button" class="ins-go" data-sh="ins" data-v="replay" data-prev='${shEsc(JSON.stringify(c.prev))}' data-cur='${shEsc(JSON.stringify(c.cur))}' data-lbl="${shEsc(insShort(c.label, 20))}" title="Replay the shift" aria-label="Replay the shift">${shIcon('refresh', 15)}</button></span></div>`;
      }).join('')}</div>`;
  } else if (sh) {
    h += `<p class="ins-lede">No layout shifts were recorded during this visit. Shifts that happen later, for example when you scroll, appear after a rescan.</p>`;
  } else {
    h += `<p class="ins-lede">Layout shift sources are not available on this page.</p>`;
  }
  h += `</div>`;

  const lt = insTier('lcp', lcp ? lcp.time : v.lcp);
  h += `<div class="sh-sec"><span>Largest paint <em>LCP</em></span></div><div class="sh-card ins-pad">
      <div class="ins-metric"><span class="ins-big ${lt[1]}">${lcp ? (lcp.time / 1000).toFixed(2) + 's' : (v.lcp != null ? (v.lcp / 1000).toFixed(2) + 's' : '—')}</span><span class="sh-tchip ${lt[1]}">${lt[0]}</span><small>Good is 2.5 seconds or less</small></div>`;
  if (lcp) {
    const flags = [];
    if (lcp.isImage) flags.push(lcp.lazy ? '<span class="ins-chip bad">Lazy-loaded</span>' : '<span class="ins-chip ok">Not lazy</span>');
    if (lcp.isImage) flags.push(lcp.preloaded ? '<span class="ins-chip ok">Preloaded</span>' : '<span class="ins-chip warn">No preload</span>');
    if (lcp.isImage) flags.push(lcp.priority === 'high' ? '<span class="ins-chip ok">High priority</span>' : '<span class="ins-chip info">Default priority</span>');
    h += `<div class="ins-lcp"><span class="ins-lcp-tx"><b>${shEsc(insShort(lcp.label || '<' + lcp.tag + '>', 44))}</b><small>${shEsc(lcp.tag ? '<' + lcp.tag + '>' : '')}${lcp.url && !/^data:/.test(lcp.url) ? ' · ' + shEsc(insShort(insFile(lcp.url), 34)) : ''}</small>
        <span class="ins-chips">${flags.join('')}</span></span>
        ${lcp.selector ? `<button type="button" class="ins-go" data-sh="ins" data-v="show" data-sel="${shEsc(lcp.selector)}" data-lbl="LCP" title="Show on page" aria-label="Show on page">${shIcon('target', 15)}</button>` : ''}</div>`;
  } else {
    h += `<p class="ins-lede">The browser has not reported a largest element for this page yet.</p>`;
  }
  h += `</div><p class="ins-note">Measured on this visit, on this device. Rescan after the page settles for the final numbers.</p>`;
  h += `<div class="sh-btns ins-foot">${insBtn('Clear highlight', 'clear')}</div>`;
  return h;
}

/* ------------------------------------------------------------------ screen: readability */
function insReadabilityScreen(A) {
  const r = A.data.insights && A.data.insights.readability;
  if (!r) return insEmpty('file', 'Readability unavailable', 'This page has no readable text to analyse.');
  if (!r.english) return insEmpty('file', 'English text only', 'Readability formulas here are written for English. This page declares another language.');
  if (!r.reliable) return insEmpty('file', 'Not enough text yet', `Only ${r.words} words were found. At least 100 words are needed for a trustworthy reading.`);
  const t = r.flesch >= 60 ? 'ok' : r.flesch >= 30 ? 'warn' : 'bad';
  const p = r.paragraphs || { count: 0, short: 0, medium: 0, long: 0 };
  const tot = Math.max(1, p.short + p.medium + p.long);
  let h = `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${t}">${r.flesch}</span><span class="sh-tchip ${t}">${insReadingLabel(r.flesch)}</span><small>Flesch reading ease, 0 to 100</small></div>
      <p class="ins-lede">Reads at <b>grade ${r.grade}</b>. ${r.grade <= 9 ? 'That suits most adults.' : r.grade <= 12 ? 'That is harder than most web readers like.' : 'That is college-level writing.'}</p></section>`;
  h += insTiles([
    ['Avg sentence', r.avgSentenceWords + ' words', r.avgSentenceWords > 20 ? 'warn' : 'ok'],
    ['Long sentences', r.longSentencePct + '%', r.longSentencePct > 15 ? 'warn' : 'ok'],
    ['Passive voice', r.passivePct + '%', r.passivePct > 20 ? 'warn' : 'ok'],
    ['Complex words', r.complexWordPct + '%', r.complexWordPct > 18 ? 'warn' : 'ok'],
    ['Words', r.words], ['Sentences', r.sentences]
  ]);
  h += `<div class="sh-sec"><span>Paragraph length <em>${insPlural(p.count, 'paragraph')}</em></span></div><div class="sh-card ins-pad">
      <div class="ins-bar" role="img" aria-label="Paragraph length distribution"><i style="width:${p.short / tot * 100}%;background:#16a34a"></i><i style="width:${p.medium / tot * 100}%;background:#f59e0b"></i><i style="width:${p.long / tot * 100}%;background:#dc2626"></i></div>
      <div class="ins-legend"><span><i style="background:#16a34a"></i>Short (up to 40 words) <b>${p.short}</b></span><span><i style="background:#f59e0b"></i>Medium <b>${p.medium}</b></span><span><i style="background:#dc2626"></i>Long (over 120) <b>${p.long}</b></span></div>
      <p class="ins-note" style="margin:10px 0 0">Longest paragraph: ${p.longest} words. Average: ${p.avg} words.</p></div>`;
  h += `<p class="ins-note">Estimated from the main text of the page (menus, headers and footers are skipped). Syllables and passive voice are counted with simple rules, so treat the numbers as a guide, not a verdict.</p>`;
  return h;
}

/* ------------------------------------------------------------------ screen: changes */
function insChangeRow(c) {
  const icon = c.k === 'regress' ? 'alert' : c.k === 'improve' ? 'check' : 'refresh';
  let val = '';
  if (c.swatches) {
    const sw = (arr, cls) => arr.map(h => `<i class="ins-sw ${cls}" style="background:${shEsc(h)}" title="${shEsc(h)}"></i>`).join('');
    val = `<span class="ins-sws">${sw(c.swatches.gone, 'gone')}${c.swatches.gone.length && c.swatches.added.length ? '<em>→</em>' : ''}${sw(c.swatches.added, 'add')}</span>`;
  } else if (c.from || c.to) {
    const f = insShort(c.from, 70), t = insShort(c.to, 70);
    val = c.num || (f && t && f.length < 16 && t.length < 16)
      ? `<span class="ins-ft"><s>${shEsc(f)}</s><em>→</em><b>${shEsc(t)}</b></span>`
      : `<span class="ins-ft v">${f ? `<s>${shEsc(f)}</s>` : ''}${t ? `<b>${shEsc(t)}</b>` : ''}</span>`;
  }
  return `<div class="ins-chg ${c.k}"><span class="ins-chg-ic">${shIcon(icon, 13)}</span><span class="ins-chg-tx"><b>${shEsc(c.t)}</b><small>${shEsc(c.area)}</small>${val}</span></div>`;
}

function insHistoryBars() {
  const list = INS.snaps;
  if (list.length < 2) return '';
  const pair = insPair();
  return `<div class="sh-sec"><span>History <em>${list.length} scans</em></span></div><div class="sh-card ins-pad">
      <div class="ins-spark">${list.map((s, i) => {
        const sc = s.composite == null ? 0 : s.composite;
        const on = pair && i === pair.idx, cur = i === list.length - 1;
        return `<button type="button" class="ins-spark-b${on ? ' on' : ''}${cur ? ' cur' : ''}" data-sh="ins" data-v="cmp" data-i="${i}" ${cur ? 'disabled' : ''} title="${shEsc(insDate(s.t) + ' · score ' + (s.composite == null ? '—' : s.composite))}" aria-label="Compare with ${shEsc(insDate(s.t))}"><i style="height:${Math.max(6, sc)}%"></i><small>${s.composite == null ? '' : s.composite}</small></button>`;
      }).join('')}</div>
      <p class="ins-note" style="margin:8px 0 0">Tap a bar to compare the latest scan with that date.</p></div>`;
}

function insChangesScreen(A) {
  const pair = insPair();
  const stable = insStableSince();
  if (!INS.track) {
    return insEmpty('eye', 'Change tracking is off', 'Turn on “Track changes between scans” in Settings to compare scans of the same page.');
  }
  if (!pair) {
    return `<div class="sh-card"><div class="sh-empty"><span class="sh-empty-ic ok">${shIcon('check', 26)}</span><b>First scan saved</b>Stylytics now remembers this page. Scan it again later to see what changed: titles, headings, trackers, fonts, speed and new issues.</div></div>
      <p class="ins-note">Scans are kept on this device only, up to ${INS_MAX_PER_PAGE} per page.</p>
      <div class="sh-btns ins-foot">${insBtn('Clear saved scans for this page', 'forget')}</div>`;
  }
  const diff = insDiff(pair.prev, pair.cur);
  const sum = insDiffSummary(diff);
  const groups = [['regress', 'Got worse'], ['improve', 'Got better'], ['change', 'Changed']];
  let h = `<section class="sh-card ins-pad"><div class="ins-cmp"><span><small>Compared with</small><b>${shEsc(insDate(pair.prev.t))}</b><small>${insAgo(pair.prev.t)}</small></span>
      <span class="ins-cmp-sc"><small>Score</small><b>${pair.prev.composite == null ? '—' : pair.prev.composite}<em>→</em>${pair.cur.composite == null ? '—' : pair.cur.composite}</b></span></div>
      <div class="ins-sumchips"><span class="ins-chip bad">${sum.regress} worse</span><span class="ins-chip ok">${sum.improve} better</span><span class="ins-chip info">${sum.change} changed</span></div></section>`;
  if (!diff.length) h += insEmpty('check', 'No changes detected', `Nothing measurable changed since ${insDate(pair.prev.t)}.`);
  groups.forEach(g => {
    const rows = diff.filter(x => x.k === g[0]);
    if (rows.length) h += `<div class="sh-sec"><span>${g[1]} <em>${rows.length}</em></span></div><div class="sh-card ins-chgs">${rows.map(insChangeRow).join('')}</div>`;
  });
  h += insHistoryBars();
  if (stable && insDays(stable) >= 30) {
    h += `<p class="ins-note ins-decay">${shIcon('alert', 12)} The content of this page has not changed since ${insDate(stable)} (${insPlural(insDays(stable), 'day')}). Stale pages slowly lose trust and traffic.</p>`;
  }
  h += `<div class="sh-btns ins-foot">${insBtn(shIcon('copy', 13) + ' Copy changes', 'copy-changes', {}, 'pri')}${insBtn('Clear saved scans', 'forget')}</div>`;
  return h;
}

/* ------------------------------------------------------------------ overview card */
function insOverviewCard() {
  if (!INS.ready) return '';
  if (!INS.track) return '';
  const pair = insPair();
  if (!pair) {
    return `<div class="sh-sec"><span>Changes</span></div><div class="sh-card"><button class="sh-row" data-sh="pane" data-v="changes"><span class="sh-ico">${shIcon('refresh', 16)}</span><span class="sh-tx"><b>Tracking this page</b><small>Scan it again later to see what changed</small></span>${shChev()}</button></div>`;
  }
  const diff = insDiff(pair.prev, pair.cur);
  const sum = insDiffSummary(diff);
  const stable = insStableSince();
  const top = diff.filter(x => x.k === 'regress').slice(0, 2);
  const chips = `<span class="ins-sumchips">${sum.regress ? `<span class="ins-chip bad">${sum.regress} worse</span>` : ''}${sum.improve ? `<span class="ins-chip ok">${sum.improve} better</span>` : ''}${sum.change ? `<span class="ins-chip info">${sum.change} changed</span>` : ''}${!diff.length ? '<span class="ins-chip ok">No changes</span>' : ''}</span>`;
  return `<div class="sh-sec"><span>Since ${insAgo(pair.prev.t)}</span><button data-sh="pane" data-v="changes">See all</button></div>
    <div class="sh-card ins-ov">
      <button class="sh-row" data-sh="pane" data-v="changes"><span class="sh-ico">${shIcon('refresh', 16)}</span><span class="sh-tx"><b>${diff.length ? insPlural(diff.length, 'change') + ' on this page' : 'Nothing changed'}</b><small>${diff.length ? '' : (stable && insDays(stable) >= 30 ? 'Content unchanged for ' + insPlural(insDays(stable), 'day') : 'Compared with ' + insDate(pair.prev.t))}</small>${chips}</span>${shChev()}</button>
      ${top.map(c => `<button class="sh-row ins-ovrow" data-sh="pane" data-v="changes">${shSevDot(c.high ? 'High' : 'Medium')}<span class="sh-tx"><b>${shEsc(c.t)}</b><small>${shEsc(c.area)}${c.from && c.to ? ' · ' + shEsc(insShort(c.from, 18)) + ' → ' + shEsc(insShort(c.to, 18)) : ''}</small></span>${shChev()}</button>`).join('')}
    </div>`;
}

/* ------------------------------------------------------------------ actions */
function insSend(msg, cb) {
  if (!lastActiveTabId) { showToast('No page to point at'); return; }
  chrome.tabs.sendMessage(lastActiveTabId, msg, (res) => {
    if (chrome.runtime.lastError) { showToast('Could not reach the page. Rescan and try again.'); return; }
    cb && cb(res);
  });
}

function insHandle(op, el) {
  const ds = el.dataset || {};
  switch (op) {
    case 'show':
      insSend({ action: 'insight-highlight', selector: ds.sel, label: ds.lbl || '', color: '#ea580c' }, (res) => { if (res && res.found === false) showToast('That element is no longer on the page'); });
      break;
    case 'replay':
      try { insSend({ action: 'insight-replay-shift', prev: JSON.parse(ds.prev), cur: JSON.parse(ds.cur), label: ds.lbl || 'Shifted' }); } catch (e) { }
      break;
    case 'clear': insSend({ action: 'insight-clear' }); break;
    case 'open': shOpenPane(ds.screen); break;
    case 'forget-all':
      chrome.storage.local.remove([INS_STORE], () => { INS.snaps = []; INS.cmp = null; showToast('All saved scans cleared'); shRender(); });
      break;
    case 'cmp': INS.cmp = parseInt(ds.i, 10); shRender(); break;
    case 'forget':
      chrome.storage.local.get([INS_STORE], (res) => {
        const all = res[INS_STORE] || {};
        delete all[INS.key];
        chrome.storage.local.set({ [INS_STORE]: all }, () => { INS.snaps = []; INS.cmp = null; showToast('Saved scans cleared for this page'); shRender(); });
      });
      break;
    case 'copy-changes': {
      const pair = insPair();
      if (!pair) return;
      const diff = insDiff(pair.prev, pair.cur);
      const lines = [`Changes on ${INS.key} since ${insDate(pair.prev.t)}`, ''];
      [['regress', 'Got worse'], ['improve', 'Got better'], ['change', 'Changed']].forEach(g => {
        const rows = diff.filter(x => x.k === g[0]);
        if (!rows.length) return;
        lines.push(g[1] + ':');
        rows.forEach(c => lines.push('- ' + c.t + (c.from || c.to ? ` (${c.from || '—'} → ${c.to || '—'})` : '')));
        lines.push('');
      });
      copyToClipboard(lines.join('\n').trim(), 'Changes copied');
      break;
    }
    case 'copy-images': {
      const img = lastExtractedData && lastExtractedData.insights && lastExtractedData.insights.images;
      if (!img) return;
      const lines = img.items.map(i => `${i.inline ? '(inline image)' : i.url}\t${i.displayW}x${i.displayH} shown\t${i.naturalW}x${i.naturalH} file\t${insBytes(i.bytes)}`);
      copyToClipboard(lines.join('\n'), 'Image list copied');
      break;
    }
  }
}

/* ------------------------------------------------------------------ registration */
SH_SCREENS.images = { title: 'Image audit', build: insImagesScreen };
SH_SCREENS.shifts = { title: 'Layout shifts & LCP', build: insShiftsScreen };
SH_SCREENS.readability = { title: 'Readability', build: insReadabilityScreen };
SH_SCREENS.changes = { title: 'Changes', build: insChangesScreen };

SH_TOOLS.Design.push(['images', 'Image audit', 'image']);
SH_TOOL_META.images = 'Size, weight and savings';
SH_TOOL_KEYWORDS.images = 'images audit oversized weight webp lazy savings performance';

SH_TOOLS.Page.push(['shifts', 'Layout & LCP', 'bolt']);
SH_TOOL_META.shifts = 'What shifts, what paints last';
SH_TOOL_KEYWORDS.shifts = 'cls layout shift lcp largest paint web vitals jank';

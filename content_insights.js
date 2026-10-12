// content_insights.js
// Injected after content_extractor.js on every scan. Adds the deeper, measured insights (image audit,
// readability, layout-shift culprits, LCP element) and the on-page tools that point at them.
// Returns one plain object; the panel stores it as data.insights.
(() => {
  const NS = '__stylyticsInsights';
  const excludeHeaderFooter = !!window.__stylyticsExcludeHeaderFooter;

  /* ------------------------------------------------------------------ helpers */
  function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

  // A short selector that still resolves to the element: id when unique, otherwise a tag/class path.
  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && document.querySelectorAll('#' + cssEscape(el.id)).length === 1) return '#' + cssEscape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id && document.querySelectorAll('#' + cssEscape(node.id)).length === 1) { parts.unshift('#' + cssEscape(node.id)); break; }
      const classes = Array.from(node.classList || []).filter(c => c && !/\d{3,}/.test(c) && c.length < 28).slice(0, 2);
      if (classes.length) part += '.' + classes.map(cssEscape).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch (e) { }
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    const alt = el.getAttribute && (el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title'));
    const text = alt || (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    return (text ? text.slice(0, 48) : '') || ('<' + tag + '>');
  }

  function docRect(r) {
    return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function extOf(url) {
    try {
      if (/^data:image\/([a-z0-9.+-]+)/i.test(url)) return RegExp.$1.toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const m = new URL(url, document.baseURI).pathname.match(/\.([a-z0-9]{2,5})$/i);
      return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : '';
    } catch (e) { return ''; }
  }

  /* ------------------------------------------------------------------ resource weight */
  function resourceKind(r) {
    const t = r.initiatorType;
    const ext = extOf(r.name);
    if (t === 'img' || /^(png|jpg|gif|webp|avif|svg|ico|bmp)$/.test(ext)) return 'image';
    if (t === 'script' || ext === 'js' || ext === 'mjs') return 'script';
    if (t === 'css' && /^(woff2?|ttf|otf|eot)$/.test(ext)) return 'font';
    if (/^(woff2?|ttf|otf|eot)$/.test(ext)) return 'font';
    if (ext === 'css' || (t === 'link' && /css/.test(r.name))) return 'style';
    if (t === 'fetch' || t === 'xmlhttprequest' || ext === 'json') return 'data';
    if (/^(mp4|webm|mov|m4v)$/.test(ext) || t === 'video') return 'media';
    return 'other';
  }

  function auditWeight() {
    const out = { total: 0, unknown: 0, count: 0, byType: {}, top: [] };
    let resources = [];
    try { resources = performance.getEntriesByType('resource') || []; } catch (e) { }
    const nav = (performance.getEntriesByType('navigation') || [])[0];
    const rows = [];
    resources.forEach(r => {
      const bytes = r.encodedBodySize || r.transferSize || 0;
      const kind = resourceKind(r);
      out.count++;
      if (!bytes) { out.unknown++; return; }
      out.total += bytes;
      out.byType[kind] = (out.byType[kind] || 0) + bytes;
      rows.push({ url: r.name, kind: kind, bytes: bytes });
    });
    if (nav && nav.encodedBodySize) { out.total += nav.encodedBodySize; out.byType.document = nav.encodedBodySize; }
    out.top = rows.sort((a, b) => b.bytes - a.bytes).slice(0, 8);
    return out;
  }

  /* ------------------------------------------------------------------ image audit */
  function auditImages() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vh = window.innerHeight || 800;
    const byUrl = new Map();
    try { (performance.getEntriesByType('resource') || []).forEach(r => byUrl.set(r.name, r)); } catch (e) { }

    const items = [];
    const seen = new Set();
    document.querySelectorAll('img').forEach(img => {
      const src = img.currentSrc || img.src;
      if (!src) return;
      const nw = img.naturalWidth, nh = img.naturalHeight;
      if (nw > 0 && nw <= 2 && nh <= 2) return; // tracking pixel
      const rect = img.getBoundingClientRect();
      const dw = Math.round(rect.width), dh = Math.round(rect.height);
      const key = src + '|' + dw + 'x' + dh;
      if (seen.has(key)) return;
      seen.add(key);

      const res = byUrl.get(src);
      let bytes = res ? (res.encodedBodySize || res.transferSize || 0) : 0;
      if (!bytes && src.startsWith('data:')) bytes = Math.round(src.length * 0.75);
      const ext = extOf(src);
      const isSvg = ext === 'svg';

      let oversize = null, wasted = 0, undersized = false;
      if (!isSvg && nw > 0 && dw > 0) {
        const needW = dw * dpr;
        oversize = nw / needW;
        if (oversize >= 1.4 && nw >= 200) {
          const area = (needW * Math.max(1, dh * dpr)) / (nw * nh);
          wasted = bytes ? Math.round(bytes * (1 - Math.min(1, area))) : 0;
        } else if (oversize < 0.7) undersized = true;
      }
      const legacy = /^(jpg|png|gif|bmp)$/.test(ext);
      const afterResize = bytes - wasted;
      const formatSave = legacy && afterResize > 30 * 1024 ? Math.round(afterResize * 0.3) : 0;
      const cs = getComputedStyle(img);
      const hasDims = (img.hasAttribute('width') && img.hasAttribute('height')) || (cs.aspectRatio && cs.aspectRatio !== 'auto');
      const aboveFold = rect.top < vh && rect.bottom > 0;

      items.push({
        url: src.startsWith('data:') ? src.slice(0, 32) + '…' : src, inline: src.startsWith('data:'), selector: selectorFor(img), label: describe(img),
        displayW: dw, displayH: dh, naturalW: nw, naturalH: nh,
        bytes: bytes || null, format: ext || null, legacy: legacy,
        oversize: oversize ? Math.round(oversize * 100) / 100 : null, undersized: undersized,
        wasted: wasted, formatSave: formatSave,
        hasDims: !!hasDims, lazy: img.loading === 'lazy', aboveFold: aboveFold,
        priority: img.getAttribute('fetchpriority') || null,
        alt: img.hasAttribute('alt'), responsive: !!(img.srcset || (img.parentElement && img.parentElement.tagName === 'PICTURE')),
        loaded: nw > 0
      });
    });

    items.sort((a, b) => ((b.bytes || 0) - (a.bytes || 0)) || ((b.naturalW * b.naturalH) - (a.naturalW * a.naturalH)));
    const known = items.filter(i => i.bytes);
    const summary = {
      count: items.length,
      totalBytes: known.reduce((s, i) => s + i.bytes, 0),
      unknownBytes: items.length - known.length,
      oversized: items.filter(i => i.wasted > 0).length,
      wastedBytes: items.reduce((s, i) => s + i.wasted, 0),
      formatSaveBytes: items.reduce((s, i) => s + i.formatSave, 0),
      legacyFormat: items.filter(i => i.formatSave > 0).length,
      missingDims: items.filter(i => !i.hasDims && i.loaded).length,
      undersized: items.filter(i => i.undersized).length,
      offscreenEager: items.filter(i => !i.aboveFold && !i.lazy && i.loaded && i.displayH > 0 && i.bytes && i.bytes > 40 * 1024).length,
      lazyAboveFold: items.filter(i => i.aboveFold && i.lazy && i.displayW * i.displayH > 90000).length,
      missingAlt: items.filter(i => !i.alt).length
    };
    summary.savableBytes = summary.wastedBytes + summary.formatSaveBytes;
    return { summary: summary, items: items.slice(0, 80) };
  }

  /* ------------------------------------------------------------------ readability */
  function syllables(word) {
    let w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const m = w.match(/[aeiouy]{1,2}/g);
    return Math.max(1, m ? m.length : 1);
  }

  const PASSIVE_RE = /\b(?:is|are|was|were|be|been|being|am)\s+(?:\w+ly\s+)?(?:\w{3,}ed|known|made|done|given|shown|seen|taken|built|written|found|held|kept|set|sent|told|born)\b(?!\s+(?:to|of)\s+(?:be)\b)/i;

  function auditReadability() {
    const lang = (document.documentElement.lang || '').toLowerCase();
    const root = document.querySelector('main, [role="main"], article') || document.body;
    if (!root) return null;
    const skip = 'nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], script, style, noscript';
    const paras = [];
    root.querySelectorAll('p, li, blockquote, dd').forEach(el => {
      if (el.closest(skip) && el.closest(skip) !== root) return;
      if (el.querySelector('p, li')) return; // count only the innermost block
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const words = text.split(' ').filter(Boolean).length;
      if (words >= 4) paras.push({ text: text, words: words, isLi: el.tagName === 'LI' });
    });

    let words = 0, sentences = 0, syl = 0, complex = 0, passive = 0, longSentences = 0;
    paras.forEach(p => {
      const parts = p.text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/).filter(s => s.trim());
      (parts.length ? parts : [p.text]).forEach(s => {
        const ws = s.split(' ').filter(Boolean);
        if (ws.length < 2) return;
        sentences++;
        words += ws.length;
        if (ws.length > 25) longSentences++;
        if (PASSIVE_RE.test(s)) passive++;
        ws.forEach(w => { const n = syllables(w); syl += n; if (n >= 3) complex++; });
      });
    });

    const english = !lang || lang.indexOf('en') === 0;
    const out = { words: words, sentences: sentences, english: english, reliable: english && words >= 100 };
    if (!words || !sentences) return out;
    const wps = words / sentences, spw = syl / words;
    out.avgSentenceWords = Math.round(wps * 10) / 10;
    out.flesch = Math.max(0, Math.min(100, Math.round(206.835 - 1.015 * wps - 84.6 * spw)));
    out.grade = Math.max(0, Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10);
    out.passivePct = Math.round(passive / sentences * 100);
    out.longSentencePct = Math.round(longSentences / sentences * 100);
    out.complexWordPct = Math.round(complex / words * 100);
    const pw = paras.filter(p => !p.isLi).map(p => p.words).sort((a, b) => a - b);
    out.paragraphs = {
      count: pw.length,
      avg: pw.length ? Math.round(pw.reduce((s, n) => s + n, 0) / pw.length) : 0,
      longest: pw.length ? pw[pw.length - 1] : 0,
      long: pw.filter(n => n > 120).length,
      short: pw.filter(n => n <= 40).length,
      medium: pw.filter(n => n > 40 && n <= 120).length
    };
    return out;
  }

  /* ------------------------------------------------------------------ layout shifts and LCP */
  function auditShifts() {
    let entries = [];
    try {
      const obs = new PerformanceObserver(() => { });
      obs.observe({ type: 'layout-shift', buffered: true });
      entries = obs.takeRecords();
      obs.disconnect();
    } catch (e) { return null; }

    // CLS is the worst "session window": shifts less than 1s apart, windows no longer than 5s
    let windowValue = 0, windowStart = 0, lastTime = 0, worst = 0, total = 0;
    const counted = [];
    entries.forEach(e => {
      if (e.hadRecentInput) return;
      total += e.value;
      if (windowValue && (e.startTime - lastTime > 1000 || e.startTime - windowStart > 5000)) windowValue = 0;
      if (!windowValue) windowStart = e.startTime;
      windowValue += e.value; lastTime = e.startTime;
      worst = Math.max(worst, windowValue);
      counted.push(e);
    });

    // blame each shift on the elements that moved, weighted by how much area moved
    const map = new Map();
    counted.forEach(e => {
      const srcs = (e.sources || []).filter(s => s.previousRect && s.currentRect);
      const areas = srcs.map(s => Math.max(1, s.previousRect.width * s.previousRect.height + s.currentRect.width * s.currentRect.height));
      const sum = areas.reduce((a, b) => a + b, 0) || 1;
      srcs.forEach((s, i) => {
        const node = s.node && s.node.isConnected ? s.node : null;
        const key = node || ('gone:' + Math.round(s.previousRect.top) + ':' + Math.round(s.previousRect.left));
        let row = map.get(key);
        if (!row) {
          row = {
            selector: node ? selectorFor(node) : '', tag: node ? node.tagName.toLowerCase() : 'removed',
            label: node ? describe(node) : 'Element removed from the page', gone: !node, value: 0, count: 0,
            prev: docRect({ left: s.previousRect.left, top: s.previousRect.top, width: s.previousRect.width, height: s.previousRect.height }),
            cur: docRect({ left: s.currentRect.left, top: s.currentRect.top, width: s.currentRect.width, height: s.currentRect.height })
          };
          map.set(key, row);
        }
        row.value += e.value * (areas[i] / sum);
        row.count++;
        row.cur = docRect({ left: s.currentRect.left, top: s.currentRect.top, width: s.currentRect.width, height: s.currentRect.height });
      });
    });
    const culprits = Array.from(map.values()).sort((a, b) => b.value - a.value).slice(0, 8)
      .map(r => Object.assign(r, { value: Math.round(r.value * 1000) / 1000 }));
    return { cls: Math.round(worst * 1000) / 1000, total: Math.round(total * 1000) / 1000, shifts: counted.length, culprits: culprits };
  }

  function auditLcp() {
    let last = null;
    try {
      const obs = new PerformanceObserver(() => { });
      obs.observe({ type: 'largest-contentful-paint', buffered: true });
      const list = obs.takeRecords();
      obs.disconnect();
      last = list[list.length - 1];
    } catch (e) { return null; }
    if (!last) return null;
    const el = last.element && last.element.isConnected ? last.element : null;
    const url = last.url || '';
    let preloaded = false;
    if (url) preloaded = !!document.querySelector('link[rel~="preload"][as="image"][href="' + url.replace(/"/g, '') + '"], link[rel~="preload"][as="image"][imagesrcset]');
    return {
      time: Math.round(last.startTime), size: last.size, url: url,
      tag: el ? el.tagName.toLowerCase() : '', selector: el ? selectorFor(el) : '', label: el ? describe(el) : '',
      isImage: !!(el && (el.tagName === 'IMG' || url)),
      lazy: !!(el && el.loading === 'lazy'), preloaded: preloaded,
      priority: el && el.getAttribute ? el.getAttribute('fetchpriority') : null,
      loadTime: Math.round(last.loadTime || 0), renderTime: Math.round(last.renderTime || last.startTime)
    };
  }

  /* ------------------------------------------------------------------ on-page overlay */
  function clearOverlay() {
    const old = document.getElementById(NS + '-overlay');
    if (old) old.remove();
    if (window[NS + 'Timer']) { clearTimeout(window[NS + 'Timer']); window[NS + 'Timer'] = null; }
  }

  function overlayRoot(ms) {
    clearOverlay();
    const root = document.createElement('div');
    root.id = NS + '-overlay';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none';
    document.documentElement.appendChild(root);
    window[NS + 'Timer'] = setTimeout(clearOverlay, ms || 9000);
    return root;
  }

  function box(root, rect, color, label, extra) {
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;box-sizing:border-box;border:3px solid ' + color + ';border-radius:6px;background:' + color + '22;' +
      'left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + Math.max(rect.w, 6) + 'px;height:' + Math.max(rect.h, 6) + 'px;' + (extra || '');
    if (label) {
      const t = document.createElement('span');
      t.textContent = label;
      t.style.cssText = 'position:absolute;left:-3px;top:-24px;white-space:nowrap;font:600 11px/1 system-ui,sans-serif;color:#fff;background:' + color + ';padding:5px 8px;border-radius:6px';
      b.appendChild(t);
    }
    root.appendChild(b);
    return b;
  }

  function highlightSelector(selector, label, color) {
    let el = null;
    try { el = document.querySelector(selector); } catch (e) { }
    if (!el) return { success: true, found: false };
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    const root = overlayRoot();
    const draw = () => { root.textContent = ''; box(root, docRect(el.getBoundingClientRect()), color || '#ea580c', label || ''); };
    draw();
    setTimeout(draw, 450); // after the smooth scroll settles
    return { success: true, found: true };
  }

  function replayShift(prev, cur, label) {
    const root = overlayRoot();
    window.scrollTo({ top: Math.max(0, Math.min(prev.y, cur.y) - 120), behavior: 'smooth' });
    const ghost = box(root, prev, '#94a3b8', 'Before', 'border-style:dashed;background:transparent');
    const mover = box(root, prev, '#dc2626', label || 'Shifted', 'transition:left .7s ease,top .7s ease,width .7s ease,height .7s ease');
    box(root, cur, '#16a34a', 'After', 'background:transparent');
    let n = 0;
    const step = () => {
      if (!document.getElementById(NS + '-overlay') || n >= 3) return;
      const to = n % 2 === 0 ? cur : prev;
      mover.style.left = to.x + 'px'; mover.style.top = to.y + 'px'; mover.style.width = Math.max(to.w, 6) + 'px'; mover.style.height = Math.max(to.h, 6) + 'px';
      n++;
      setTimeout(step, 1100);
    };
    setTimeout(step, 700);
    void ghost;
    return { success: true, found: true };
  }

  /* ------------------------------------------------------------------ accessibility lab */
  const FOCUSABLE_SEL = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, audio[controls], video[controls], [tabindex], [contenteditable]:not([contenteditable="false"])';

  function visibleBox(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.visibility !== 'collapse' && cs.display !== 'none';
  }

  // Elements the Tab key reaches, in the order it reaches them: positive tabindex first, then document order.
  function tabbables() {
    const all = Array.from(document.querySelectorAll(FOCUSABLE_SEL)).filter(el =>
      !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && visibleBox(el) &&
      !(el.closest('details:not([open])') && el.tagName !== 'SUMMARY' && !el.closest('summary')));
    const positive = all.filter(e => e.tabIndex > 0).map((e, i) => [e, i]).sort((a, b) => (a[0].tabIndex - b[0].tabIndex) || (a[1] - b[1])).map(x => x[0]);
    return positive.concat(all.filter(e => e.tabIndex === 0));
  }

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // Text a person using a screen reader hears for an element's content.
  function contentName(el, depth) {
    if (depth > 6) return '';
    let out = '';
    el.childNodes.forEach(n => {
      if (n.nodeType === 3) out += ' ' + n.nodeValue;
      else if (n.nodeType === 1) {
        if (n.getAttribute('aria-hidden') === 'true' || n.hidden) return;
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        if (n.tagName === 'IMG') out += ' ' + (n.getAttribute('alt') || '');
        else if (n.tagName === 'SVG' || n.tagName === 'svg') { const t = n.querySelector('title'); out += ' ' + (n.getAttribute('aria-label') || (t ? t.textContent : '')); }
        else out += ' ' + (n.getAttribute('aria-label') || contentName(n, depth + 1));
      }
    });
    return clean(out);
  }

  // Simplified accessible-name computation: aria-labelledby, aria-label, native label, content, then title.
  function accName(el) {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = clean(lb.split(/\s+/).map(id => { const n = document.getElementById(id); return n ? (n.getAttribute('aria-label') || n.textContent) : ''; }).join(' '));
      if (t) return { name: t, source: 'aria-labelledby' };
    }
    const al = clean(el.getAttribute('aria-label'));
    if (al) return { name: al, source: 'aria-label' };
    const tag = el.tagName;
    if (tag === 'IMG') return { name: clean(el.getAttribute('alt')), source: 'alt', hasAlt: el.hasAttribute('alt') };
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'image') return { name: clean(el.getAttribute('alt')), source: 'alt' };
      if (type === 'button' || type === 'submit' || type === 'reset') return { name: clean(el.value) || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : ''), source: 'value' };
      let t = '';
      if (el.labels) Array.from(el.labels).forEach(l => { t += ' ' + contentName(l, 0); });
      t = clean(t);
      if (t) return { name: t, source: 'label' };
      const ti = clean(el.getAttribute('title'));
      if (ti) return { name: ti, source: 'title' };
      const ph = clean(el.getAttribute('placeholder'));
      return { name: ph, source: ph ? 'placeholder' : '', weak: !!ph };
    }
    const c = contentName(el, 0);
    if (c) return { name: c, source: 'content' };
    const ti = clean(el.getAttribute('title'));
    return { name: ti, source: ti ? 'title' : '' };
  }

  const ROLE_BY_TAG = { A: 'link', BUTTON: 'button', SUMMARY: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', UL: 'list', OL: 'list', LI: 'listitem', TABLE: 'table', DIALOG: 'dialog', FORM: 'form', IMG: 'img', FIELDSET: 'group', IFRAME: 'frame', DETAILS: 'group' };
  const INPUT_ROLE = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox', number: 'spinbutton' };

  function roleOf(el) {
    const explicit = clean(el.getAttribute('role')).split(' ')[0].toLowerCase();
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'INPUT') { const t = (el.getAttribute('type') || 'text').toLowerCase(); return t === 'hidden' ? '' : (INPUT_ROLE[t] || 'textbox'); }
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : '';
    if (tag === 'IMG') return el.getAttribute('alt') === '' ? 'presentation' : 'img';
    if (tag === 'HEADER') return el.closest('article, section, aside, nav, main') ? '' : 'banner';
    if (tag === 'FOOTER') return el.closest('article, section, aside, nav, main') ? '' : 'contentinfo';
    if (tag === 'SECTION') return (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) ? 'region' : '';
    if (tag === 'FORM') return (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) ? 'form' : '';
    return ROLE_BY_TAG[tag] || '';
  }

  const NAMED_ROLES = { link: 1, button: 1, checkbox: 1, radio: 1, textbox: 1, searchbox: 1, combobox: 1, listbox: 1, slider: 1, spinbutton: 1, switch: 1, tab: 1, menuitem: 1, menuitemcheckbox: 1, menuitemradio: 1, option: 1, img: 1, heading: 1, dialog: 1, region: 1, form: 1 };
  const SHOWN_ROLES = Object.assign({ navigation: 1, main: 1, banner: 1, contentinfo: 1, complementary: 1, search: 1, list: 1, listitem: 1, table: 1, group: 1, tablist: 1, tabpanel: 1, alert: 1, status: 1, menu: 1, toolbar: 1, tree: 1 }, NAMED_ROLES);
  const VAGUE_LINK = /^(click here|here|read more|more|learn more|link|this|details|continue|go|read)$/i;

  /* ---- accessibility tree ---- */
  function auditTree() {
    const nodes = [];
    let truncated = false;
    const issuesFor = (el, role, n) => {
      const out = [];
      const interactive = { link: 1, button: 1, checkbox: 1, radio: 1, textbox: 1, searchbox: 1, combobox: 1, slider: 1, spinbutton: 1, switch: 1, tab: 1, menuitem: 1, option: 1 };
      if (interactive[role] && !n.name) out.push({ sev: 'High', t: 'No accessible name' });
      if (role === 'img' && n.hasAlt === false) out.push({ sev: 'High', t: 'Image has no alt attribute' });
      if (role === 'link' && n.name && VAGUE_LINK.test(n.name)) out.push({ sev: 'Medium', t: 'Vague link text' });
      if (n.weak) out.push({ sev: 'Medium', t: 'Named only by its placeholder' });
      if (role === 'heading' && !n.name) out.push({ sev: 'Medium', t: 'Empty heading' });
      return out;
    };
    const walk = (el, depth) => {
      if (nodes.length >= 500) { truncated = true; return; }
      if (el.nodeType !== 1 || el === document.getElementById(NS + '-overlay')) return;
      if (el.getAttribute('aria-hidden') === 'true' || el.hidden || el.closest('[inert]')) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') { if (cs.display === 'none') return; }
      const role = roleOf(el);
      let nextDepth = depth;
      if (role && role !== 'presentation' && role !== 'none' && SHOWN_ROLES[role]) {
        const nm = (NAMED_ROLES[role] || el.hasAttribute('aria-label')) ? accName(el) : { name: '' };
        const n = {
          role: role, name: nm.name, source: nm.source || '', tag: el.tagName.toLowerCase(), depth: depth, selector: '', weak: !!nm.weak, hasAlt: nm.hasAlt
        };
        if (role === 'heading') n.level = parseInt(el.getAttribute('aria-level') || (/^H[1-6]$/.test(el.tagName) ? el.tagName[1] : '2'), 10);
        const st = [];
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') st.push('disabled');
        if (el.getAttribute('aria-expanded')) st.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
        if (el.checked || el.getAttribute('aria-checked') === 'true') st.push('checked');
        if (el.required || el.getAttribute('aria-required') === 'true') st.push('required');
        if (el.getAttribute('aria-current')) st.push('current');
        n.states = st;
        n.issues = issuesFor(el, role, n);
        n.selector = (n.issues.length || NAMED_ROLES[role]) ? selectorFor(el) : '';
        n.name = n.name.length > 70 ? n.name.slice(0, 69) + '…' : n.name;
        delete n.hasAlt; delete n.weak;
        nodes.push(n);
        if (role === 'img' || role === 'button' || role === 'link' || role === 'checkbox' || role === 'radio' || role === 'textbox') return; // name already covers the content
        nextDepth = depth + 1;
      }
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) walk(c, nextDepth);
    };
    walk(document.body, 0);
    const bad = nodes.filter(n => n.issues.length);
    return {
      nodes: nodes, truncated: truncated,
      summary: { nodes: nodes.length, issues: bad.length, unnamed: nodes.filter(n => n.issues.some(i => i.t === 'No accessible name')).length, landmarks: nodes.filter(n => /^(banner|main|navigation|contentinfo|complementary|search|region)$/.test(n.role)).length }
    };
  }

  /* ---- ARIA validity (cheap, runs on every scan) ---- */
  const ARIA_ROLES = new Set('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem'.split(' '));
  const ARIA_ATTRS = new Set('activedescendant atomic autocomplete braillelabel brailleroledescription busy checked colcount colindex colindextext colspan controls current describedby description details disabled dropeffect errormessage expanded flowto grabbed haspopup hidden invalid keyshortcuts label labelledby level live modal multiline multiselectable orientation owns placeholder posinset pressed readonly relevant required roledescription rowcount rowindex rowindextext rowspan selected setsize sort valuemax valuemin valuenow valuetext'.split(' '));
  const ARIA_REQUIRED = { checkbox: ['aria-checked'], radio: ['aria-checked'], switch: ['aria-checked'], menuitemcheckbox: ['aria-checked'], menuitemradio: ['aria-checked'], slider: ['aria-valuenow'], scrollbar: ['aria-valuenow', 'aria-controls'], meter: ['aria-valuenow'], heading: ['aria-level'], combobox: ['aria-expanded', 'aria-controls'] };
  const ID_REFS = { 'aria-labelledby': 'High', 'aria-describedby': 'Medium', 'aria-activedescendant': 'Medium', 'aria-errormessage': 'Medium', 'aria-details': 'Low', 'aria-controls': 'Low', 'aria-owns': 'Medium', 'aria-flowto': 'Low' };
  const NATIVE_SUPPLIES = { checkbox: 'INPUT', radio: 'INPUT', slider: 'INPUT', heading: 'H1,H2,H3,H4,H5,H6' };

  function auditAria() {
    const issues = [];
    const push = (el, type, sev, detail) => { if (issues.length < 80) issues.push({ type: type, sev: sev, selector: selectorFor(el), label: describe(el), detail: detail }); };
    const els = Array.from(document.querySelectorAll('[role], [aria-hidden="true"], [aria-labelledby], [aria-describedby], [aria-controls], [aria-owns], [aria-activedescendant], [aria-errormessage], [aria-flowto], [aria-details]'));
    let checked = 0;
    els.slice(0, 1500).forEach(el => {
      checked++;
      const role = clean(el.getAttribute('role')).split(' ')[0].toLowerCase();
      if (role && !ARIA_ROLES.has(role) && !/^(doc|graphics)-/.test(role)) push(el, 'invalid-role', 'High', 'role="' + role + '" is not a valid ARIA role');
      if (role && ARIA_REQUIRED[role] && !(NATIVE_SUPPLIES[role] && el.matches(NATIVE_SUPPLIES[role]))) {
        const missing = ARIA_REQUIRED[role].filter(a => !el.hasAttribute(a));
        if (missing.length) push(el, 'missing-required', 'High', 'role="' + role + '" needs ' + missing.join(', '));
      }
      Array.from(el.attributes).forEach(a => {
        if (a.name.indexOf('aria-') !== 0) return;
        const key = a.name.slice(5);
        if (!ARIA_ATTRS.has(key)) { push(el, 'unknown-attribute', 'Medium', a.name + ' is not an ARIA attribute'); return; }
        if (ID_REFS[a.name]) {
          const ids = a.value.split(/\s+/).filter(Boolean);
          const gone = ids.filter(id => !document.getElementById(id));
          if (gone.length) push(el, 'missing-reference', ID_REFS[a.name], a.name + ' points to ' + (gone.length === 1 ? 'an id that does not exist' : 'ids that do not exist') + ': ' + gone.slice(0, 3).join(', '));
          else ids.forEach(id => { if (document.querySelectorAll('[id="' + id.replace(/"/g, '') + '"]').length > 1) push(el, 'duplicate-id', 'Low', a.name + ' uses the id "' + id + '", which appears more than once'); });
        }
      });
      if (el.getAttribute('aria-hidden') === 'true') {
        const focusable = el.matches(FOCUSABLE_SEL) && el.tabIndex >= 0 && !el.disabled ? el : Array.from(el.querySelectorAll(FOCUSABLE_SEL)).find(f => f.tabIndex >= 0 && !f.disabled && visibleBox(f));
        if (focusable) push(el, 'hidden-focusable', 'High', 'aria-hidden hides ' + (focusable === el ? 'this' : 'a') + ' focusable element, so keyboard users land on something screen readers cannot see');
      }
    });
    const byType = {};
    issues.forEach(i => { byType[i.type] = (byType[i.type] || 0) + 1; });
    return { checked: checked, issues: issues, byType: byType };
  }

  // Names that are missing on controls (cheap enough to run on every scan; the full tree is on demand)
  function auditNames() {
    const out = [];
    document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"]').forEach(el => {
      if (out.length >= 60 || !visibleBox(el) || el.getAttribute('aria-hidden') === 'true') return;
      const nm = accName(el);
      const role = roleOf(el);
      if (!nm.name) out.push({ role: role, tag: el.tagName.toLowerCase(), selector: selectorFor(el), label: describe(el), kind: 'missing' });
      else if (role === 'link' && VAGUE_LINK.test(nm.name)) out.push({ role: role, tag: 'a', selector: selectorFor(el), label: nm.name, kind: 'vague' });
    });
    return out;
  }

  /* ---- overlays for the tools ---- */
  function svgPath(root, pts, bad) {
    if (pts.length < 2) return;
    const w = Math.max(document.documentElement.scrollWidth, window.innerWidth), h = Math.max(document.documentElement.scrollHeight, window.innerHeight);
    const NSV = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NSV, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:visible';
    for (let i = 1; i < pts.length; i++) {
      const line = document.createElementNS(NSV, 'line');
      line.setAttribute('x1', pts[i - 1].x); line.setAttribute('y1', pts[i - 1].y); line.setAttribute('x2', pts[i].x); line.setAttribute('y2', pts[i].y);
      const isBad = bad && bad[i];
      line.setAttribute('stroke', isBad ? '#dc2626' : '#ea580c');
      line.setAttribute('stroke-width', isBad ? '3' : '2');
      line.setAttribute('stroke-opacity', isBad ? '0.95' : '0.65');
      if (isBad) line.setAttribute('stroke-dasharray', '7 5');
      svg.appendChild(line);
    }
    root.appendChild(svg);
  }

  function badge(root, x, y, text, color) {
    const b = document.createElement('div');
    b.textContent = text;
    b.style.cssText = 'position:absolute;left:' + (x - 11) + 'px;top:' + (y - 11) + 'px;min-width:22px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:11px;background:' + color +
      ';color:#fff;font:700 11px/22px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.35)';
    root.appendChild(b);
  }

  function orderOverlay(els, bad, color) {
    const root = overlayRoot(60000);
    const pts = els.map(el => { const r = docRect(el.getBoundingClientRect()); return { x: r.x + Math.min(14, r.w / 2), y: r.y + Math.min(14, r.h / 2), r: r }; });
    svgPath(root, pts, bad);
    els.forEach((el, i) => {
      const p = pts[i];
      const b = document.createElement('div');
      b.style.cssText = 'position:absolute;box-sizing:border-box;left:' + p.r.x + 'px;top:' + p.r.y + 'px;width:' + p.r.w + 'px;height:' + p.r.h + 'px;border:2px solid ' + (bad && bad[i] ? '#dc2626' : color) + '66;border-radius:4px';
      root.appendChild(b);
      badge(root, p.x, p.y, String(i + 1), bad && bad[i] ? '#dc2626' : color);
    });
  }

  /* ---- tab order ---- */
  function runTabOrder() {
    const els = tabbables();
    // a backwards jump: the next stop sits clearly above the previous one
    const bad = {};
    const jumps = [];
    for (let i = 1; i < els.length; i++) {
      const a = els[i - 1].getBoundingClientRect(), b = els[i].getBoundingClientRect();
      if (b.top < a.top - 40 && b.left <= a.left + 40) { bad[i] = true; if (jumps.length < 10) jumps.push({ from: i, to: i + 1 }); }
    }
    orderOverlay(els.slice(0, 200), bad, '#ea580c');
    return {
      count: els.length, backJumps: Object.keys(bad).length, positive: els.filter(e => e.tabIndex > 0).length,
      items: els.slice(0, 120).map((el, i) => ({ n: i + 1, tag: el.tagName.toLowerCase(), role: roleOf(el), name: insShortText(accName(el).name || describe(el), 40), selector: selectorFor(el), jump: !!bad[i] })),
      jumps: jumps
    };
  }
  function insShortText(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---- focus visibility ----
   * Chrome only applies :focus styles while the page itself has focus, and while this runs the side panel
   * has it. So nothing is focused. Instead the page's :focus, :focus-visible and :focus-within rules are
   * copied onto marker classes, the marker is put on each control, and the computed styles are compared
   * before and after. The browser's own default focus ring is emulated at the lowest priority so that
   * "outline: none" in the site's CSS removes it, exactly as it would for real. */
  function focusSnapshot(el) {
    const cs = getComputedStyle(el);
    const transparent = /^(transparent|rgba\([^)]*,\s*0\))$/.test(cs.outlineColor.replace(/\s+/g, ' '));
    const ring = cs.outlineStyle !== 'none' && cs.outlineStyle !== 'hidden' && parseFloat(cs.outlineWidth) > 0 && !transparent;
    return {
      ring: ring ? cs.outlineStyle + cs.outlineWidth + cs.outlineColor + cs.outlineOffset : '',
      shadow: cs.boxShadow, border: cs.borderTopColor + cs.borderTopWidth + cs.borderBottomColor + cs.borderLeftColor + cs.borderRightColor,
      bg: cs.backgroundColor + cs.backgroundImage, color: cs.color, deco: cs.textDecorationLine + cs.textDecorationColor + cs.textDecorationThickness,
      opacity: cs.opacity, filter: cs.filter
    };
  }

  function splitSelectorList(sel) {
    const out = [];
    let depth = 0, cur = '';
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  function buildFocusSheets() {
    const css = [];
    let unreadable = 0;
    const convert = (p) => p.replace(/:focus-visible/g, '.__sfx').replace(/:focus-within/g, '.__sfw').replace(/:focus(?![-\w])/g, '.__sfx');
    const visit = (rule, depth) => {
      if (depth > 6) return;
      if (rule.selectorText !== undefined && rule.style) {
        if (rule.selectorText.indexOf(':focus') < 0) return;
        const parts = splitSelectorList(rule.selectorText).filter(p => p.indexOf(':focus') >= 0).map(convert);
        if (parts.length) css.push(parts.join(',') + '{' + rule.style.cssText + '}');
        return;
      }
      const kind = rule.constructor && rule.constructor.name;
      if (kind === 'CSSContainerRule') return;
      if (rule.media) { let ok = true; try { ok = matchMedia(rule.media.mediaText).matches; } catch (e) { /* keep */ } if (!ok) return; }
      else if (kind === 'CSSSupportsRule') { let ok = true; try { ok = CSS.supports(rule.conditionText); } catch (e) { /* keep */ } if (!ok) return; }
      if (rule.cssRules) Array.from(rule.cssRules).forEach(r => visit(r, depth + 1));
    };
    Array.from(document.styleSheets).forEach(sheet => {
      try { Array.from(sheet.cssRules).forEach(r => visit(r, 0)); } catch (e) { unreadable++; }
    });
    // lowest priority first in <head>: any rule from the site, whatever its specificity, beats it
    const ua = document.createElement('style');
    ua.id = NS + '-focus-ua';
    ua.textContent = ':where(.__sfx){outline:-webkit-focus-ring-color auto 1px}';
    const own = document.createElement('style');
    own.id = NS + '-focus-rules';
    own.textContent = css.join('\n') + '\n.__sfx,.__sfx *,.__sfw{transition:none !important;animation:none !important}';
    document.head.insertBefore(ua, document.head.firstChild);
    document.head.appendChild(own);
    return { remove: () => { ua.remove(); own.remove(); }, rules: css.length, unreadable: unreadable };
  }

  function runFocusAudit() {
    const els = tabbables().filter(el => el.tagName !== 'IFRAME' && el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO').slice(0, 200);
    const sheets = buildFocusSheets();
    const failed = [], passed = [];
    const neighbours = (el) => {
      const set = [el, el.parentElement, el.nextElementSibling, el.previousElementSibling];
      if (el.labels) Array.from(el.labels).forEach(l => set.push(l));
      return set.filter(Boolean);
    };
    try {
      els.forEach(el => {
        const group = neighbours(el);
        const chain = [];
        for (let a = el.parentElement, i = 0; a && i < 4; a = a.parentElement, i++) chain.push(a);
        const before = group.map(focusSnapshot);
        el.classList.add('__sfx');
        chain.forEach(a => a.classList.add('__sfw'));
        void el.offsetWidth;
        let how = '';
        group.forEach((g, i) => {
          if (how) return;
          const after = focusSnapshot(g);
          const changed = Object.keys(after).filter(k => after[k] !== before[i][k]);
          if (changed.length) how = changed[0];
          else if (g === el && after.ring) how = 'outline';
        });
        el.classList.remove('__sfx');
        chain.forEach(a => a.classList.remove('__sfw'));
        (how ? passed : failed).push({ el: el, how: how });
      });
    } finally { sheets.remove(); }

    const root = overlayRoot(60000);
    failed.forEach(f => box(root, docRect(f.el.getBoundingClientRect()), '#dc2626', 'No visible focus', 'border-style:dashed'));
    return {
      tested: els.length, passed: passed.length, failed: failed.length, unreadable: sheets.unreadable,
      items: failed.slice(0, 40).map(f => ({ tag: f.el.tagName.toLowerCase(), role: roleOf(f.el), name: insShortText(accName(f.el).name || describe(f.el), 40), selector: selectorFor(f.el) }))
    };
  }

  /* ---- reading order against visual order ---- */
  function runReadingOrder() {
    const sel = 'h1,h2,h3,h4,h5,h6,p,a[href],button,input:not([type="hidden"]),select,textarea,img,li,[role="button"]';
    let els = Array.from(document.querySelectorAll(sel)).filter(el => visibleBox(el) && !el.closest('[aria-hidden="true"]'));
    // keep the innermost items: a paragraph that holds a link is represented by the link
    const set = new Set(els);
    els = els.filter(el => !Array.from(el.querySelectorAll(sel)).some(c => set.has(c)));
    els = els.slice(0, 400);
    const rects = els.map(el => el.getBoundingClientRect());
    const bad = {};
    const found = [];
    for (let i = 1; i < els.length; i++) {
      const a = rects[i - 1], b = rects[i];
      const up = b.top < a.top - 30 && b.left <= a.left + 30;                              // jumps back up the page
      const reverse = Math.abs(b.top - a.top) < 20 && b.left < a.left - 30 && b.right <= a.left + 4; // right to left on one row
      if (up || reverse) {
        bad[i] = true;
        if (found.length < 12) found.push({ kind: up ? 'up' : 'reverse', from: { n: i, label: insShortText(describe(els[i - 1]), 32), selector: selectorFor(els[i - 1]) }, to: { n: i + 1, label: insShortText(describe(els[i]), 32), selector: selectorFor(els[i]) } });
      }
    }
    let reordered = 0, reversed = 0;
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.order !== '0' && (cs.display.indexOf('flex') >= 0 || cs.display.indexOf('grid') >= 0 || (el.parentElement && /flex|grid/.test(getComputedStyle(el.parentElement).display)))) reordered++;
      if (/reverse/.test(cs.flexDirection) && cs.display.indexOf('flex') >= 0) reversed++;
    });
    // draw only the stretch around problems to keep the page readable
    const show = els.slice(0, 120);
    orderOverlay(show, bad, '#6366f1');
    return { items: els.length, jumps: Object.keys(bad).length, found: found, reordered: reordered, reversed: reversed };
  }

  /* ---- text spacing (WCAG 1.4.12) ---- */
  function clippedSet() {
    const out = new Map();
    document.querySelectorAll('body *').forEach(el => {
      if (out.size > 300) return;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      const cs = getComputedStyle(el);
      const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip', clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (!clipX && !clipY) return;
      if (!clean(el.textContent)) return;
      const overY = clipY && el.scrollHeight > el.clientHeight + 2, overX = clipX && el.scrollWidth > el.clientWidth + 2;
      if (overY || overX) out.set(el, { over: overY ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth, axis: overY ? 'height' : 'width' });
    });
    return out;
  }

  function setTextSpacing(on) {
    const id = NS + '-spacing';
    const old = document.getElementById(id);
    if (old) old.remove();
    if (!on) { clearOverlay(); return { applied: false }; }
    const baseline = clippedSet();
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important}p{margin-bottom:2em !important}';
    document.head.appendChild(style);
    void document.body.offsetHeight;
    const after = clippedSet();
    const fresh = [];
    after.forEach((v, el) => { if (!baseline.has(el) || v.over > baseline.get(el).over + 4) fresh.push({ el: el, v: v }); });
    const root = overlayRoot(60000);
    fresh.slice(0, 40).forEach(f => box(root, docRect(f.el.getBoundingClientRect()), '#dc2626', 'Text clipped', 'border-style:dashed'));
    return {
      applied: true, clipped: fresh.length, baseline: baseline.size,
      pageOverflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      items: fresh.slice(0, 20).map(f => ({ tag: f.el.tagName.toLowerCase(), label: insShortText(describe(f.el), 44), selector: selectorFor(f.el), over: Math.round(f.v.over), axis: f.v.axis }))
    };
  }

  /* ---- reflow at high zoom (WCAG 1.4.10) ---- */
  function runReflow() {
    const w = window.innerWidth, sw = document.documentElement.scrollWidth;
    const wide = [];
    document.querySelectorAll('body *').forEach(el => {
      if (wide.length >= 12) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 2 && visibleBox(el) && !el.closest('[style*="overflow"]')) wide.push({ tag: el.tagName.toLowerCase(), label: insShortText(describe(el), 40), selector: selectorFor(el), over: Math.round(r.right - w) });
    });
    // widest first, drop containers whose children are already listed
    wide.sort((a, b) => b.over - a.over);
    return { width: w, scrollWidth: sw, overflowX: sw > w + 2, dpr: window.devicePixelRatio, items: wide.slice(0, 8) };
  }

  /* ------------------------------------------------------------------ resources
   * Every request the page made, with when it started, how long it took, how big it was, and whether it
   * blocked rendering. The panel groups them by vendor (third-party cost) and draws the waterfall.
   * Resource timing keeps only the first 250 entries, and cross-origin files that do not send
   * Timing-Allow-Origin report no size, so those are marked unknown (b = 0) rather than guessed. */
  function auditResources() {
    const out = { items: [], hints: [], nav: null, fcp: null, truncated: false };
    let res = [];
    try { res = performance.getEntriesByType('resource') || []; } catch (e) { }
    out.truncated = res.length >= 250;

    // browsers without renderBlockingStatus: work it out from the head
    const supports = res.length > 0 && 'renderBlockingStatus' in res[0];
    const blockSet = new Set();
    if (!supports) {
      document.querySelectorAll('head script[src]:not([async]):not([defer]):not([type="module"])').forEach(s => blockSet.add(s.src));
      document.querySelectorAll('head link[rel~="stylesheet"]').forEach(l => { if (l.href && !l.disabled && (!l.media || l.media === 'all' || /screen/.test(l.media))) blockSet.add(l.href); });
    }

    res.slice(0, 400).forEach(r => {
      if (/^data:|^blob:/.test(r.name)) return;
      const tb = r.transferSize || 0, eb = r.encodedBodySize || 0;
      out.items.push({
        u: r.name.length > 320 ? r.name.slice(0, 320) : r.name, t: r.initiatorType, k: resourceKind(r),
        s: Math.round(r.startTime), d: Math.round(r.duration), e: Math.round(r.responseEnd),
        b: eb || tb, p: r.nextHopProtocol || '', bl: supports ? r.renderBlockingStatus === 'blocking' : blockSet.has(r.name),
        cached: tb === 0 && eb > 0
      });
    });

    try {
      const nav = (performance.getEntriesByType('navigation') || [])[0];
      if (nav) out.nav = { ttfb: Math.round(nav.responseStart), end: Math.round(nav.responseEnd), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd || 0), bytes: nav.encodedBodySize || 0 };
      const fcp = (performance.getEntriesByType('paint') || []).filter(p => p.name === 'first-contentful-paint')[0];
      if (fcp) out.fcp = Math.round(fcp.startTime);
    } catch (e) { }

    document.querySelectorAll('link[rel~="preconnect"], link[rel~="dns-prefetch"], link[rel~="preload"], link[rel~="prefetch"], link[rel~="modulepreload"]').forEach(l => {
      if (out.hints.length >= 40 || !l.href) return;
      out.hints.push({ rel: (l.getAttribute('rel') || '').toLowerCase(), href: l.href, as: l.getAttribute('as') || '', cross: l.hasAttribute('crossorigin') });
    });
    return out;
  }

  /* ------------------------------------------------------------------ fonts
   * What the page declares (@font-face rules from every readable stylesheet), which families and weights
   * its text really uses, and how the browser would sit a fallback font next to each web font. Stylesheets
   * from other sites (Google Fonts and the like) cannot be read from the page; their addresses are
   * returned so the panel can fetch and parse them. */
  function unquote(s) { return String(s || '').trim().replace(/^["']|["']$/g, ''); }
  function familyList(v) { return String(v || '').split(',').map(unquote).filter(Boolean); }

  function auditFonts() {
    const out = { faces: [], unreadable: [], used: [], loaded: [], fallback: [] };
    const seen = new Set();
    const FONT_URL = /url\(\s*(['"]?)(.*?)\1\s*\)\s*(?:format\(\s*(['"]?)([^'")]+)\3\s*\))?/g;

    function addFace(rule, base, sheetName) {
      if (out.faces.length >= 80) return;
      const st = rule.style;
      const src = st.getPropertyValue('src') || '';
      const urls = [];
      let m;
      FONT_URL.lastIndex = 0;
      while ((m = FONT_URL.exec(src)) && urls.length < 6) {
        let u = m[2];
        if (/^data:/.test(u)) { urls.push({ u: 'data:', f: m[4] || '' }); continue; }
        try { u = new URL(u, base).href; } catch (e) { continue; }
        urls.push({ u: u, f: (m[4] || '').toLowerCase() });
      }
      out.faces.push({
        family: unquote(st.getPropertyValue('font-family')), weight: (st.getPropertyValue('font-weight') || '400').trim(), style: (st.getPropertyValue('font-style') || 'normal').trim(),
        display: (st.getPropertyValue('font-display') || '').trim(), unicode: !!st.getPropertyValue('unicode-range'),
        adjust: !!(st.getPropertyValue('size-adjust') || st.getPropertyValue('ascent-override')), src: urls, sheet: sheetName
      });
    }

    function walk(rule, base, name) {
      if (rule.type === CSSRule.FONT_FACE_RULE) addFace(rule, base, name);
      else if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) readSheet(rule.styleSheet, base);
      else if (rule.cssRules) Array.from(rule.cssRules).forEach(r => walk(r, base, name));
    }
    function readSheet(sheet, base) {
      if (!sheet || seen.has(sheet)) return;
      seen.add(sheet);
      let rules;
      try { rules = sheet.cssRules; } catch (e) { if (sheet.href && out.unreadable.indexOf(sheet.href) < 0 && out.unreadable.length < 6) out.unreadable.push(sheet.href); return; }
      const b = sheet.href || base || document.baseURI;
      Array.from(rules).forEach(r => walk(r, b, sheet.href || 'inline'));
    }
    Array.from(document.styleSheets).concat(Array.from(document.adoptedStyleSheets || [])).forEach(s => readSheet(s, document.baseURI));

    // which families, weights and styles the visible text asks for
    const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|META|LINK|TITLE|SVG|PATH)$/;
    const vh = window.innerHeight || 800;
    const used = new Map();
    const els = document.body ? document.body.querySelectorAll('*') : [];
    for (let i = 0; i < Math.min(els.length, 4000); i++) {
      const el = els[i];
      if (SKIP.test(el.tagName.toUpperCase())) continue;
      let chars = 0;
      for (const n of el.childNodes) if (n.nodeType === 3) chars += n.nodeValue.trim().length;
      if (!chars) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const fam = familyList(cs.fontFamily);
      const style = /italic|oblique/.test(cs.fontStyle) ? 'italic' : 'normal';
      const key = fam.join('|') + '#' + cs.fontWeight + '#' + style;
      const e = used.get(key) || { fam: fam.slice(0, 5), weight: cs.fontWeight, style: style, n: 0, chars: 0, above: 0 };
      e.n++; e.chars += chars;
      if (r.top < vh && r.bottom > 0) e.above += chars;
      used.set(key, e);
      if (used.size > 60) break;
    }
    out.used = Array.from(used.values()).sort((a, b) => b.chars - a.chars).slice(0, 40);

    try { document.fonts.forEach(f => { if (out.loaded.length < 80) out.loaded.push({ family: unquote(f.family), weight: f.weight, style: f.style, status: f.status }); }); } catch (e) { }

    // How wide and tall each loaded web font runs next to a stock fallback, measured here in the browser.
    // The panel turns this into size-adjust and ascent/descent overrides that stop the swap from jumping.
    const declared = new Set(out.faces.map(f => f.family.toLowerCase()));
    let ctx = null;
    try { ctx = document.createElement('canvas').getContext('2d'); } catch (e) { }
    const sample = 'The quick brown fox jumps over the lazy dog 0123456789';
    const done = new Set();
    out.used.slice(0, 12).forEach(u => {
      if (!ctx || out.fallback.length >= 4) return;
      const family = u.fam.filter(f => declared.has(f.toLowerCase()))[0];
      if (!family || done.has(family.toLowerCase())) return;
      const generic = u.fam.some(f => /^monospace$/i.test(f)) ? 'monospace' : (u.fam.some(f => /^(serif)$/i.test(f)) && !u.fam.some(f => /sans-serif/i.test(f))) ? 'serif' : 'sans-serif';
      const fb = generic === 'serif' ? '"Times New Roman"' : generic === 'monospace' ? '"Courier New"' : 'Arial';
      const spec = (f) => u.style + ' ' + u.weight + ' 100px ' + f;
      try {
        if (!document.fonts.check(spec('"' + family + '"'), 'a')) return;
        ctx.font = spec('"' + family + '"');
        const w1 = ctx.measureText(sample).width, mm = ctx.measureText('Hxgp');
        ctx.font = spec(fb);
        const w2 = ctx.measureText(sample).width;
        if (!w1 || !w2 || typeof mm.fontBoundingBoxAscent !== 'number') return;
        done.add(family.toLowerCase());
        out.fallback.push({ family: family, weight: u.weight, style: u.style, generic: generic, local: generic === 'serif' ? 'Times New Roman' : generic === 'monospace' ? 'Courier New' : 'Arial',
          sizeAdjust: w1 / w2, ascent: mm.fontBoundingBoxAscent / 100, descent: mm.fontBoundingBoxDescent / 100 });
      } catch (e) { }
    });
    return out;
  }

  /* ------------------------------------------------------------------ facts
   * Small page details the fix generator, the link checker and the structured-data validator need:
   * every link (including the menu and footer), fragment links that point nowhere, blocking scripts,
   * unlabeled fields, the opening paragraph, extra H1s and insecure resources. */
  function auditFacts() {
    const out = { links: [], brokenAnchors: [], blockingScripts: [], unlabeled: [], h1s: [], mixed: [], lead: '', langGuess: 'en' };
    const seen = new Set();
    document.querySelectorAll('a[href]').forEach(a => {
      const raw = (a.getAttribute('href') || '').trim();
      if (!raw || /^(mailto:|tel:|javascript:|sms:|data:|blob:|#)/i.test(raw)) return;
      let u;
      try { u = new URL(a.href); } catch (e) { return; }
      if (!/^https?:$/.test(u.protocol)) return;
      u.hash = '';
      if (seen.has(u.href) || out.links.length >= 500) return;
      seen.add(u.href);
      const img = a.querySelector('img');
      const where = a.closest('nav,[role="navigation"]') ? 'nav' : a.closest('header,[role="banner"]') ? 'header' : a.closest('footer,[role="contentinfo"]') ? 'footer' : 'content';
      out.links.push({ u: u.href, h: raw, t: insShortText(clean(a.textContent) || a.getAttribute('aria-label') || (img && img.getAttribute('alt')) || '', 50), w: where, rel: a.getAttribute('rel') || '', ext: u.origin !== location.origin });
    });

    document.querySelectorAll('a[href^="#"]').forEach(a => {
      const raw = a.getAttribute('href') || '';
      if (raw.length < 2 || raw === '#!' || /^#(top|\/)/i.test(raw) || out.brokenAnchors.length >= 20) return;
      let id = raw.slice(1);
      try { id = decodeURIComponent(id); } catch (e) { }
      if (document.getElementById(id) || document.getElementsByName(id).length) return;
      if (out.brokenAnchors.some(x => x.h === raw)) return;
      out.brokenAnchors.push({ h: raw, t: insShortText(clean(a.textContent) || a.getAttribute('aria-label') || '', 40) });
    });

    document.querySelectorAll('head script[src]').forEach(s => {
      if (s.async || s.defer || (s.getAttribute('type') || '').toLowerCase() === 'module' || out.blockingScripts.length >= 12) return;
      out.blockingScripts.push(s.getAttribute('src'));
    });

    document.querySelectorAll('input, select, textarea').forEach(f => {
      const type = (f.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].indexOf(type) >= 0 || out.unlabeled.length >= 10) return;
      const named = (f.getAttribute('aria-label') || '').trim() || (f.getAttribute('aria-labelledby') || '').trim() || f.closest('label');
      let forLabel = false;
      if (f.id) { try { forLabel = !!document.querySelector('label[for="' + cssEscape(f.id) + '"]'); } catch (e) { } }
      if (named || forLabel) return;
      out.unlabeled.push({ tag: f.tagName.toLowerCase(), type: type || (f.tagName === 'TEXTAREA' ? 'textarea' : ''), name: f.getAttribute('name') || '', id: f.id || '', placeholder: f.getAttribute('placeholder') || '', autocomplete: f.getAttribute('autocomplete') || '' });
    });

    document.querySelectorAll('h1').forEach(h => { const t = clean(h.textContent); if (t && out.h1s.length < 6) out.h1s.push({ t: insShortText(t, 90), tag: h.tagName.toLowerCase() }); });

    const scope = document.querySelector('main, article, [role="main"]') || document.body;
    const para = Array.from(scope.querySelectorAll('p')).find(p => {
      if (p.closest('header, nav, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]')) return false;
      const t = clean(p.textContent);
      return t.length >= 80 && visibleBox(p);
    });
    if (para) out.lead = clean(para.textContent).slice(0, 420);

    if (location.protocol === 'https:') {
      try { (performance.getEntriesByType('resource') || []).forEach(r => { if (/^http:\/\//i.test(r.name) && out.mixed.length < 8) out.mixed.push(r.name); }); } catch (e) { }
    }
    const loc = (document.querySelector('meta[property="og:locale"]') || {}).content || '';
    out.langGuess = (loc.split(/[_-]/)[0] || (navigator.language || 'en').split('-')[0] || 'en').toLowerCase();
    return out;
  }

  /* ------------------------------------------------------------------ messages */
  if (window[NS + 'Listener']) chrome.runtime.onMessage.removeListener(window[NS + 'Listener']);
  window[NS + 'Listener'] = (request, sender, sendResponse) => {
    if (request.action === 'insight-highlight') {
      sendResponse(highlightSelector(request.selector, request.label, request.color));
      return true;
    }
    if (request.action === 'insight-replay-shift') {
      sendResponse(replayShift(request.prev, request.cur, request.label));
      return true;
    }
    const lab = { 'a11y-taborder': runTabOrder, 'a11y-focus': runFocusAudit, 'a11y-reading': runReadingOrder, 'a11y-tree': auditTree, 'a11y-reflow': runReflow };
    if (lab[request.action]) {
      let out = null;
      try { out = lab[request.action](); } catch (e) { out = { error: String(e && e.message || e) }; }
      sendResponse(out);
      return true;
    }
    if (request.action === 'a11y-spacing') {
      let out = null;
      try { out = setTextSpacing(!!request.on); } catch (e) { out = { error: String(e && e.message || e) }; }
      sendResponse(out);
      return true;
    }
    if (request.action === 'insight-clear') {
      clearOverlay();
      sendResponse({ success: true });
      return true;
    }
    return undefined;
  };
  chrome.runtime.onMessage.addListener(window[NS + 'Listener']);
  clearOverlay();

  /* ------------------------------------------------------------------ result */
  const safe = (fn) => { try { return fn(); } catch (e) { return null; } };
  return {
    version: 3,
    facts: safe(auditFacts),
    resources: safe(auditResources),
    fonts: safe(auditFonts),
    images: safe(auditImages),
    weight: safe(auditWeight),
    readability: safe(auditReadability),
    shifts: safe(auditShifts),
    lcp: safe(auditLcp),
    aria: safe(auditAria),
    names: safe(auditNames),
    excludeHeaderFooter: excludeHeaderFooter
  };
})();

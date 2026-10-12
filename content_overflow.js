// content_overflow.js
// Injected by the Overflow finder (once per tested width, in a temporary window). Measures horizontal
// overflow at the width the page has right now and returns the elements that cause it. It changes
// nothing on the page.
//
// A page scrolls sideways when something sticks out past the viewport and no ancestor clips it. The
// element to fix is the one that introduces the overflow: it sticks out while its parent still fits.
(() => {
  const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

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

  function label(el) {
    const tag = el.tagName.toLowerCase();
    const t = el.getAttribute('aria-label') || el.getAttribute('alt') || clean(el.innerText || el.textContent);
    return t ? short(t, 40) : '<' + tag + '>';
  }

  const vw = document.documentElement.clientWidth;
  const sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const SKIP = /^(SCRIPT|STYLE|LINK|META|HEAD|TITLE|NOSCRIPT|BR|WBR|TEMPLATE|PATH|G|DEFS|USE|STOP|CIRCLE|RECT|LINE|POLYGON|POLYLINE|TSPAN)$/;

  // an ancestor that clips sideways keeps the overflow off the page
  const clips = (el, cache) => {
    if (cache.has(el)) return cache.get(el);
    let v = false;
    const p = el.parentElement;
    if (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      v = (cs.overflowX !== 'visible') || clips(p, cache);
    }
    cache.set(el, v);
    return v;
  };

  const cache = new Map();
  const found = [];
  const fixedWide = [];
  const all = document.body ? document.body.querySelectorAll('*') : [];
  const limit = Math.min(all.length, 8000);
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    if (SKIP.test(el.tagName.toUpperCase())) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right <= vw + 1) {
      // a box that fits but holds text that cannot break (a long address or word) still pushes the page wider
      if (el.scrollWidth > el.clientWidth + 1 && r.left + el.scrollWidth > vw + 1 && found.length < 40) {
        const cs0 = getComputedStyle(el);
        if (cs0.overflowX === 'visible' && cs0.display !== 'inline' && cs0.position !== 'fixed' && !clips(el, cache) &&
            clean(el.textContent) && Array.prototype.every.call(el.children, (c) => c.getBoundingClientRect().right <= vw + 1)) {
          found.push({
            selector: selectorFor(el), label: label(el), tag: el.tagName.toLowerCase(), reason: 'longword', fix: 'overflow-wrap: anywhere;',
            width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.left + el.scrollWidth), over: Math.round(r.left + el.scrollWidth - vw), minWidth: 0
          });
        }
      }
      continue;
    }
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position === 'fixed') {
      if (r.width > vw + 1 && fixedWide.length < 6) fixedWide.push({ selector: selectorFor(el), label: label(el), tag: el.tagName.toLowerCase(), width: Math.round(r.width), over: Math.round(r.width - vw) });
      continue;
    }
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    if (clips(el, cache)) continue;
    // fixed ancestors do not scroll the page either
    let fixedAnc = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).position === 'fixed') { fixedAnc = true; break; } }
    if (fixedAnc) continue;
    // not the introducer when the parent already sticks out the same way
    const p = el.parentElement;
    if (p && p !== document.body && p !== document.documentElement) {
      const pr = p.getBoundingClientRect();
      if (pr.right > vw + 1 && pr.width > 0 && getComputedStyle(p).position !== 'fixed' && !clips(p, cache) && getComputedStyle(p).overflowX === 'visible') continue;
    }

    const tag = el.tagName.toLowerCase();
    const minW = parseFloat(cs.minWidth) || 0;
    const text = clean(el.textContent);
    const longWord = text && !/\s/.test(text.slice(0, 60)) && text.length > 24;
    let reason = 'wide', fix = 'max-width: 100%;';
    if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'svg' || tag === 'picture') { reason = 'media'; fix = 'max-width: 100%;\nheight: auto;'; }
    else if (tag === 'iframe' || tag === 'embed' || tag === 'object') { reason = 'embed'; fix = 'max-width: 100%;'; }
    else if (tag === 'table') { reason = 'table'; fix = 'display: block;\noverflow-x: auto;\nmax-width: 100%;'; }
    else if (tag === 'pre' || tag === 'code') { reason = 'code'; fix = 'overflow-x: auto;\nmax-width: 100%;'; }
    else if (/^(pre|nowrap)/.test(cs.whiteSpace) && text) { reason = 'nowrap'; fix = 'white-space: normal;'; }
    else if (longWord) { reason = 'longword'; fix = 'overflow-wrap: anywhere;'; }
    else if (minW > vw) { reason = 'minwidth'; fix = 'min-width: 0;\nmax-width: 100%;'; }
    else if (r.width > vw + 1) { reason = 'fixedwidth'; fix = 'width: 100%;\nmax-width: 600px; /* keep your desktop limit */'; }
    else if (/flex|grid/.test(getComputedStyle(p || document.body).display)) { reason = 'flexchild'; fix = 'min-width: 0;'; }
    found.push({
      selector: selectorFor(el), label: label(el), tag: tag, reason: reason, fix: fix,
      width: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), over: Math.round(r.right - vw),
      minWidth: minW > 0 ? Math.round(minW) : 0
    });
  }
  found.sort((a, b) => b.over - a.over);

  return {
    vw: vw, iw: window.innerWidth, dpr: window.devicePixelRatio || 1,
    scrollWidth: sw, overflowX: sw > vw + 1, over: Math.max(0, sw - vw),
    viewportMeta: !!document.querySelector('meta[name="viewport"]'),
    culprits: found.slice(0, 12), total: found.length, fixedWide: fixedWide
  };
})();

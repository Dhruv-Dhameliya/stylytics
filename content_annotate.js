// content_annotate.js
// Injected on demand by the Review pins screen. Lets someone point at an element on the live page and
// draws numbered markers for the saved pins. Pins are anchored to a CSS selector, so they follow the
// element when the layout moves; if the element is gone the marker stays where it was.
(() => {
  if (window.__stylyticsAnnotate && window.__stylyticsAnnotate.version >= 1) return window.__stylyticsAnnotate.version;

  const NS = '__stylyticsAnn';
  const COLORS = { design: '#ea580c', content: '#2563eb', bug: '#dc2626', a11y: '#7c3aed', question: '#0891b2' };
  const state = { pins: [], visible: true, picking: false, hover: null };
  let root = null, hoverBox = null, banner = null, timer = null, observer = null;

  /* ---------------------------------------------------------------- helpers */
  const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  const ours = (el) => !!(el && el.closest && el.closest('#' + NS + '-root, #' + NS + '-hover, #' + NS + '-banner'));

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && document.querySelectorAll('#' + cssEscape(el.id)).length === 1) return '#' + cssEscape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 7) {
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
      try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch (e) { /* keep climbing */ }
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const t = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return (t ? t.slice(0, 60) : '') || ('<' + tag + '>');
  }

  const docRect = (r) => ({ x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) });

  function find(selector) { try { return selector ? document.querySelector(selector) : null; } catch (e) { return null; } }

  /* ---------------------------------------------------------------- overlay */
  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = document.createElement('div');
    root.id = NS + '-root';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none';
    document.documentElement.appendChild(root);
    return root;
  }

  function layout() {
    const r = ensureRoot();
    r.textContent = '';
    if (!state.visible) return;
    const docW = Math.max(document.documentElement.scrollWidth, window.innerWidth);
    state.pins.forEach(pin => {
      const el = find(pin.selector);
      const rect = el ? docRect(el.getBoundingClientRect()) : pin.rect;
      if (!rect) return;
      const color = pin.resolved ? '#94a3b8' : (COLORS[pin.kind] || COLORS.design);
      const missing = !el;
      const frame = document.createElement('div');
      frame.style.cssText = 'position:absolute;box-sizing:border-box;border:2px ' + (missing ? 'dashed' : 'solid') + ' ' + color + ';border-radius:4px;background:' + color + '14;' +
        'left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + Math.max(rect.w, 8) + 'px;height:' + Math.max(rect.h, 8) + 'px;' + (pin.resolved ? 'opacity:.45;' : '');
      r.appendChild(frame);
      const x = Math.min(Math.max(2, rect.x + Math.max(rect.w, 8) - 11), docW - 26);
      const y = Math.max(2, rect.y - 11);
      const m = document.createElement('button');
      m.type = 'button';
      m.textContent = pin.resolved ? '✓' : String(pin.n);
      m.title = (missing ? 'Element not found. ' : '') + (pin.comment || '');
      m.dataset.pin = pin.id;
      m.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;min-width:24px;height:24px;padding:0 6px;box-sizing:border-box;border:2px solid #fff;border-radius:12px;background:' + color +
        ';color:#fff;font:700 12px/20px system-ui,sans-serif;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.4)';
      m.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); chrome.runtime.sendMessage({ action: 'annotate-open-pin', id: pin.id }); });
      r.appendChild(m);
    });
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(layout, 120); }

  function watch() {
    if (observer) return;
    window.addEventListener('resize', schedule);
    window.addEventListener('load', schedule);
    observer = new MutationObserver((muts) => { if (muts.some(m => !ours(m.target))) schedule(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    setInterval(() => { if (state.pins.length && state.visible && !state.picking) layout(); }, 2500);
  }

  /* ---------------------------------------------------------------- picking */
  function showBanner(text) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = NS + '-banner';
      banner.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#18181b;color:#fff;font:600 13px/1.3 system-ui,sans-serif;padding:10px 16px;border-radius:99px;box-shadow:0 8px 28px rgba(0,0,0,.45);pointer-events:none;white-space:nowrap';
      document.documentElement.appendChild(banner);
    }
    banner.textContent = text;
  }

  function drawHover(el) {
    if (!hoverBox) {
      hoverBox = document.createElement('div');
      hoverBox.id = NS + '-hover';
      hoverBox.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;border:2px solid #ea580c;background:rgba(234,88,12,.12);border-radius:4px;transition:all .06s';
      document.documentElement.appendChild(hoverBox);
    }
    if (!el) { hoverBox.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    hoverBox.style.display = 'block';
    hoverBox.style.left = r.left + 'px'; hoverBox.style.top = r.top + 'px'; hoverBox.style.width = r.width + 'px'; hoverBox.style.height = r.height + 'px';
  }

  const swallow = (e) => { if (ours(e.target)) return; e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const onMove = (e) => { const el = document.elementFromPoint(e.clientX, e.clientY); state.hover = ours(el) ? null : el; drawHover(state.hover); };
  const onKey = (e) => { if (e.key === 'Escape') { stopPicking(); chrome.runtime.sendMessage({ action: 'annotate-cancelled' }); } };

  function onPick(e) {
    if (ours(e.target)) return;
    swallow(e);
    // what is under the pointer now, never a leftover hover from an earlier pick
    const under = (typeof e.clientX === 'number' && (e.clientX || e.clientY)) ? document.elementFromPoint(e.clientX, e.clientY) : null;
    const el = under && !ours(under) ? under : e.target;
    if (!el || el === document.documentElement || ours(el)) return;
    const r = el.getBoundingClientRect();
    stopPicking();
    chrome.runtime.sendMessage({
      action: 'annotate-picked', selector: selectorFor(el), label: describe(el), tag: el.tagName.toLowerCase(),
      rect: docRect(r), view: { x: r.left, y: r.top, w: r.width, h: r.height }
    });
  }

  function startPicking() {
    if (state.picking) return;
    state.picking = true;
    state.hover = null;
    document.documentElement.style.cursor = 'crosshair';
    showBanner('Click the element to pin · Esc to cancel');
    document.addEventListener('mousemove', onMove, true);
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu'].forEach(t => document.addEventListener(t, t === 'click' ? onPick : swallow, true));
    document.addEventListener('keydown', onKey, true);
  }

  function stopPicking() {
    if (!state.picking) return;
    state.picking = false;
    document.documentElement.style.cursor = '';
    document.removeEventListener('mousemove', onMove, true);
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu'].forEach(t => document.removeEventListener(t, t === 'click' ? onPick : swallow, true));
    document.removeEventListener('keydown', onKey, true);
    drawHover(null);
    if (banner) { banner.remove(); banner = null; }
    if (hoverBox) { hoverBox.remove(); hoverBox = null; }
  }

  /* ---------------------------------------------------------------- messages */
  function reveal(pin) {
    const el = find(pin.selector);
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    else if (pin.rect) window.scrollTo({ top: Math.max(0, pin.rect.y - 200), behavior: 'smooth' });
    // a short pulse so the eye lands on it
    setTimeout(() => {
      const m = root && root.querySelector('[data-pin="' + pin.id + '"]');
      if (m && m.animate) m.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 700, iterations: 2 });
    }, 450);
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (!req || typeof req.action !== 'string' || req.action.indexOf('annotate-') !== 0) return undefined;
    if (req.action === 'annotate-mode') { if (req.on) startPicking(); else stopPicking(); sendResponse({ success: true }); }
    else if (req.action === 'annotate-render') { state.pins = req.pins || []; state.visible = req.visible !== false; watch(); layout(); sendResponse({ success: true, found: state.pins.filter(p => find(p.selector)).length }); }
    else if (req.action === 'annotate-show') { const pin = state.pins.filter(p => p.id === req.id)[0]; if (pin) reveal(pin); sendResponse({ success: !!pin, found: !!(pin && find(pin.selector)) }); }
    else if (req.action === 'annotate-prepare-capture') {
      // bring the element into view, hide our markers, and report where it is in the viewport
      const el = find(req.selector);
      if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
      else if (req.rect) window.scrollTo(0, Math.max(0, req.rect.y - window.innerHeight / 2));
      if (root) root.style.visibility = 'hidden';
      setTimeout(() => {
        const r = el ? el.getBoundingClientRect() : { left: req.rect.x - window.scrollX, top: req.rect.y - window.scrollY, width: req.rect.w, height: req.rect.h };
        sendResponse({ success: true, found: !!el, view: { x: r.left, y: r.top, w: r.width, h: r.height }, vw: window.innerWidth, vh: window.innerHeight });
      }, 350);
      return true;
    }
    else if (req.action === 'annotate-after-capture') { if (root) root.style.visibility = ''; sendResponse({ success: true }); }
    else if (req.action === 'annotate-clear') { state.pins = []; if (root) root.textContent = ''; sendResponse({ success: true }); }
    return true;
  });

  window.__stylyticsAnnotate = { version: 1 };
  return 1;
})();

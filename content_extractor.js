// content_extractor.js
(() => {
  // when enabled from the Overview toggle, headings/links/word count are scoped to the
  // main page content only, ignoring boilerplate nav/header/footer for a cleaner SEO audit
  const excludeHeaderFooter = !!window.__stylyticsExcludeHeaderFooter;
  const HEADER_FOOTER_SELECTOR = 'header, [role="banner"], nav, [role="navigation"], footer, [role="contentinfo"]';
  const isInHeaderOrFooter = (el) => excludeHeaderFooter && !!el.closest(HEADER_FOOTER_SELECTOR);

  // highlighting
  window.highlightedElements = window.highlightedElements || [];

  function removeHighlights() {
    window.highlightedElements.forEach(el => {
      if (el && el.style) {
        el.style.outline = el.dataset.originalOutline || '';
        el.style.outlineOffset = el.dataset.originalOutlineOffset || '';
        el.style.transition = el.dataset.originalTransition || '';
      }
    });
    window.highlightedElements = [];
  }

  function applyHighlight(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      el.dataset.originalOutline = el.style.outline;
      el.dataset.originalOutlineOffset = el.style.outlineOffset;
      el.dataset.originalTransition = el.style.transition;

      el.style.outline = '4px solid #ef4444';
      el.style.outlineOffset = '2px';
      el.style.transition = 'outline 0.2s ease-in-out';

      window.highlightedElements.push(el);
    }
  }

  function highlightMatches(type, value) {
    removeHighlights();
    const elements = document.querySelectorAll('body *');

    elements.forEach(el => {
      const style = window.getComputedStyle(el);
      let match = false;

      if (type === 'fontFamily' && style.fontFamily.includes(value)) match = true;
      if (type === 'fontSize' && style.fontSize === value) match = true;

      if (type === 'color' && (style.color === value || style.backgroundColor === value)) match = true;

      if (match) applyHighlight(el);
    });
  }

  // hover color highlighting
  function highlightHoverMatches(value) {
    removeHighlights();
    const matchedElements = new Set();

    for (let sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (let rule of rules) {
        if (!rule.selectorText || !rule.selectorText.includes(':hover')) continue;
        if (rule.style.color !== value && rule.style.backgroundColor !== value) continue;

        const baseSelector = rule.selectorText.replace(/:hover/g, '').trim();
        if (!baseSelector) continue;
        try {
          document.querySelectorAll(baseSelector).forEach(el => matchedElements.add(el));
        } catch (e) { }
      }
    }

    matchedElements.forEach(applyHighlight);
  }

  // inspect mode
  window.myInspectState = window.myInspectState || { active: false, hoverEl: null, listeners: null };

  function removeInspectHoverHighlight() {
    const state = window.myInspectState;
    if (state.hoverEl) {
      state.hoverEl.style.outline = state.hoverEl.dataset.inspectOriginalOutline || '';
      state.hoverEl.style.outlineOffset = state.hoverEl.dataset.inspectOriginalOutlineOffset || '';
      delete state.hoverEl.dataset.inspectOriginalOutline;
      delete state.hoverEl.dataset.inspectOriginalOutlineOffset;
      state.hoverEl = null;
    }
  }

  function stopInspectMode() {
    const state = window.myInspectState;
    if (state.listeners) {
      document.removeEventListener('mouseover', state.listeners.onMouseOver, true);
      document.removeEventListener('click', state.listeners.onClick, true);
      document.removeEventListener('keydown', state.listeners.onKeyDown, true);
      state.listeners = null;
    }
    removeInspectHoverHighlight();
    state.active = false;
    document.documentElement.style.cursor = '';
    if (window.myInspectBanner) {
      window.myInspectBanner.remove();
      window.myInspectBanner = null;
    }
  }

  function computeSpecificity(selector) {
    const ids = (selector.match(/#[\w-]+/g) || []).length;
    const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
    const tags = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
    return [ids, classes, tags];
  }

  function getAncestorChain(el) {
    const chain = [];
    let node = el.parentElement;
    let depth = 0;
    while (node && node.tagName !== 'HTML' && depth < 8) {
      chain.push({
        tagName: node.tagName.toLowerCase(),
        id: node.id || null,
        classes: (node.className && typeof node.className === 'string') ? node.className.trim() : null
      });
      node = node.parentElement;
      depth++;
    }
    return chain;
  }

  function getMatchedCssRules(el) {
    const matched = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of rules) {
        if (!rule.selectorText) continue;
        const parts = rule.selectorText.split(',').map(s => s.trim());
        for (const part of parts) {
          try {
            if (el.matches(part)) {
              matched.push({ selector: part, specificity: computeSpecificity(part) });
              break;
            }
          } catch (e) { }
        }
      }
    }
    matched.sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (b.specificity[i] !== a.specificity[i]) return b.specificity[i] - a.specificity[i];
      }
      return 0;
    });
    return matched.slice(0, 12);
  }

  function buildStyleCategories(style) {
    const categories = [
      {
        name: 'Layout', items: [
          ['Display', style.display], ['Position', style.position],
          ['Top', style.top], ['Right', style.right], ['Bottom', style.bottom], ['Left', style.left],
          ['Z-Index', style.zIndex], ['Overflow', style.overflow], ['Float', style.float], ['Visibility', style.visibility]
        ]
      },
      {
        name: 'Box', items: [
          ['Width', style.width], ['Height', style.height], ['Box Sizing', style.boxSizing],
          ['Margin', style.margin], ['Padding', style.padding], ['Border', style.border],
          ['Border Radius', style.borderRadius], ['Outline', style.outline]
        ]
      },
      {
        name: 'Typography', items: [
          ['Font Family', style.fontFamily], ['Font Size', style.fontSize], ['Font Weight', style.fontWeight],
          ['Font Style', style.fontStyle], ['Line Height', style.lineHeight], ['Letter Spacing', style.letterSpacing],
          ['Text Align', style.textAlign], ['Text Decoration', style.textDecoration], ['Text Transform', style.textTransform],
          ['White Space', style.whiteSpace], ['Color', style.color]
        ]
      },
      {
        name: 'Visual', items: [
          ['Background Color', style.backgroundColor], ['Background Image', style.backgroundImage],
          ['Box Shadow', style.boxShadow], ['Opacity', style.opacity], ['Cursor', style.cursor],
          ['Transform', style.transform], ['Transition', style.transition]
        ]
      }
    ];
    if (/flex/.test(style.display)) {
      categories.push({
        name: 'Flexbox', items: [
          ['Flex Direction', style.flexDirection], ['Flex Wrap', style.flexWrap],
          ['Justify Content', style.justifyContent], ['Align Items', style.alignItems],
          ['Align Content', style.alignContent], ['Gap', style.gap]
        ]
      });
    }
    if (/grid/.test(style.display)) {
      categories.push({
        name: 'Grid', items: [
          ['Grid Template Columns', style.gridTemplateColumns], ['Grid Template Rows', style.gridTemplateRows],
          ['Grid Column', style.gridColumn], ['Grid Row', style.gridRow], ['Gap', style.gap]
        ]
      });
    }
    return categories
      .map(c => ({ name: c.name, items: c.items.filter(([, v]) => !!v) }))
      .filter(c => c.items.length);
  }

  function buildInspectInfo(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const num = (v) => parseFloat(v) || 0;

    const marginTop = num(style.marginTop), marginRight = num(style.marginRight), marginBottom = num(style.marginBottom), marginLeft = num(style.marginLeft);
    const borderTop = num(style.borderTopWidth), borderRight = num(style.borderRightWidth), borderBottom = num(style.borderBottomWidth), borderLeft = num(style.borderLeftWidth);
    const paddingTop = num(style.paddingTop), paddingRight = num(style.paddingRight), paddingBottom = num(style.paddingBottom), paddingLeft = num(style.paddingLeft);
    const boxModel = {
      margin: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
      border: { top: borderTop, right: borderRight, bottom: borderBottom, left: borderLeft },
      padding: { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft },
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      contentWidth: Math.max(0, Math.round(rect.width - paddingLeft - paddingRight - borderLeft - borderRight)),
      contentHeight: Math.max(0, Math.round(rect.height - paddingTop - paddingBottom - borderTop - borderBottom))
    };

    const attributes = Array.from(el.attributes || []).map(a => ({ name: a.name, value: a.value }));

    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: (el.className && typeof el.className === 'string') ? el.className.trim() : null,
      attributes: attributes,
      rect: { width: Math.round(rect.width), height: Math.round(rect.height) },
      boxModel: boxModel,
      ancestors: getAncestorChain(el),
      matchedRules: getMatchedCssRules(el),
      styleCategories: buildStyleCategories(style),
      styles: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textAlign: style.textAlign,
        margin: style.margin,
        padding: style.padding,
        border: style.border,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        display: style.display,
        position: style.position,
        gap: style.gap
      }
    };
  }

  function startInspectMode() {
    stopInspectMode();
    const state = window.myInspectState;
    state.active = true;

    const onMouseOver = (e) => {
      removeInspectHoverHighlight();
      const el = e.target;
      if (el === window.myInspectBanner) return;
      el.dataset.inspectOriginalOutline = el.style.outline || '';
      el.dataset.inspectOriginalOutlineOffset = el.style.outlineOffset || '';
      el.style.outline = '2px dashed #3b82f6';
      el.style.outlineOffset = '1px';
      state.hoverEl = el;
    };

    const onClick = (e) => {
      if (e.target === window.myInspectBanner) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      const info = buildInspectInfo(el);
      stopInspectMode();
      try { chrome.runtime.sendMessage({ action: 'element-inspected', info }); } catch (err) { }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        stopInspectMode();
        try { chrome.runtime.sendMessage({ action: 'inspect-cancelled' }); } catch (err) { }
      }
    };

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    state.listeners = { onMouseOver, onClick, onKeyDown };
    document.documentElement.style.cursor = 'crosshair';

    const banner = document.createElement('div');
    banner.textContent = 'Inspect mode — click an element to select it, or press Esc to cancel';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111827;color:#fff;' +
      'padding:8px 12px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.35);pointer-events:none;';
    document.documentElement.appendChild(banner);
    window.myInspectBanner = banner;
  }

  // dom tree
  const domTreeNodes = new Map();
  let domTreeIdCounter = 0;

  function registerTreeNode(el) {
    const id = 'n' + (domTreeIdCounter++);
    domTreeNodes.set(id, el);
    return id;
  }

  const TREE_LANDMARK_TAGS = new Set(['HEADER', 'NAV', 'MAIN', 'FOOTER', 'SECTION', 'ARTICLE', 'ASIDE', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

  function collectLandmarkChildren(el, depthGuard) {
    const out = [];
    if ((depthGuard || 0) > 60) return out;
    for (const child of el.children) {
      if (TREE_LANDMARK_TAGS.has(child.tagName)) out.push(child);
      else out.push(...collectLandmarkChildren(child, (depthGuard || 0) + 1));
    }
    return out;
  }

  function getTreeChildElements(el, mode) {
    return mode === 'simplified' ? collectLandmarkChildren(el) : Array.from(el.children);
  }

  function getTreeTextPreview(el) {
    if (el.children.length > 0) return null;
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!text) return null;
    return text.length > 60 ? text.slice(0, 60) + '…' : text;
  }

  function serializeTreeNode(el, mode) {
    return {
      nodeId: registerTreeNode(el),
      tag: el.tagName.toLowerCase(),
      idAttr: el.id || null,
      classAttr: (el.className && typeof el.className === 'string') ? el.className.trim() : null,
      textPreview: getTreeTextPreview(el),
      hasChildren: getTreeChildElements(el, mode).length > 0
    };
  }

  function highlightTreeNode(el) {
    removeHighlights();
    applyHighlight(el);
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
  }

  window.myTreeHoverEl = window.myTreeHoverEl || null;
  function clearTreeHover() {
    const el = window.myTreeHoverEl;
    if (el && el.style) {
      el.style.outline = el.dataset.treeHoverOriginalOutline || '';
      el.style.outlineOffset = el.dataset.treeHoverOriginalOutlineOffset || '';
      delete el.dataset.treeHoverOriginalOutline;
      delete el.dataset.treeHoverOriginalOutlineOffset;
    }
    window.myTreeHoverEl = null;
  }

  function applyTreeHover(el) {
    clearTreeHover();
    el.dataset.treeHoverOriginalOutline = el.style.outline || '';
    el.dataset.treeHoverOriginalOutlineOffset = el.style.outlineOffset || '';
    el.style.outline = '2px dashed #3b82f6';
    el.style.outlineOffset = '1px';
    window.myTreeHoverEl = el;
  }

  function searchTreeNodes(query, limit) {
    const q = (query || '').trim();
    if (!q) return [];
    let matches = [];
    try { matches = Array.from(document.querySelectorAll(q)); } catch (e) { matches = []; }
    if (!matches.length) {
      const qLower = q.toLowerCase();
      matches = elementsArray.filter(el => {
        const hay = `${el.tagName.toLowerCase()} ${el.id || ''} ${(el.className && typeof el.className === 'string') ? el.className : ''}`.toLowerCase();
        return hay.includes(qLower);
      });
    }
    return matches.slice(0, limit || 30).map(el => ({
      nodeId: registerTreeNode(el),
      tag: el.tagName.toLowerCase(),
      idAttr: el.id || null,
      classAttr: (el.className && typeof el.className === 'string') ? el.className.trim() : null,
      breadcrumb: getAncestorChain(el).slice().reverse()
    }));
  }

  // font preview
  window.themePreviewElements = window.themePreviewElements || [];

  function resetThemePreview() {
    window.themePreviewElements.forEach(({ el, prop, original }) => {
      if (el && el.style) el.style[prop] = original;
    });
    window.themePreviewElements = [];
    document.querySelectorAll('link[data-stylytics-preview-font]').forEach(link => link.remove());
  }

  // any typed font that isn't a system/web-safe name is fetched from Google Fonts so the
  // preview actually renders instead of silently falling back to the browser default
  const WEB_SAFE_FONTS = new Set([
    'arial', 'georgia', 'times new roman', 'verdana', 'trebuchet ms', 'courier new',
    'sans-serif', 'serif', 'monospace', 'system-ui', 'inherit', 'initial'
  ]);

  function ensureGoogleFont(familyName) {
    if (!familyName || WEB_SAFE_FONTS.has(familyName.toLowerCase())) return;
    window.__stylyticsLoadedGoogleFonts = window.__stylyticsLoadedGoogleFonts || new Set();
    const key = familyName.toLowerCase();
    if (window.__stylyticsLoadedGoogleFonts.has(key)) return;
    window.__stylyticsLoadedGoogleFonts.add(key);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(familyName).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`;
    link.setAttribute('data-stylytics-preview-font', 'true');
    document.head.appendChild(link);
  }

  function previewFont(fromValue, toFont) {
    if (!fromValue || !toFont) return 0;
    const primaryFamily = toFont.split(',')[0].replace(/['"]/g, '').trim();
    ensureGoogleFont(primaryFamily);
    let count = 0;
    document.querySelectorAll('body *').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.fontFamily.includes(fromValue)) {
        window.themePreviewElements.push({ el, prop: 'fontFamily', original: el.style.fontFamily });
        el.style.fontFamily = toFont;
        count++;
      }
    });
    return count;
  }

  // palette preview
  window.palettePreviewElements = window.palettePreviewElements || [];

  function resetPalettePreview() {
    window.palettePreviewElements.forEach(({ el, prop, original }) => {
      if (el && el.style) el.style[prop] = original;
    });
    window.palettePreviewElements = [];
  }

  function previewPalette(mapping) {
    resetPalettePreview();
    if (!mapping || !Object.keys(mapping).length) return 0;
    let count = 0;
    document.querySelectorAll('body *').forEach(el => {
      const style = window.getComputedStyle(el);
      const color = rgbToHex(style.color);
      const bg = rgbToHex(style.backgroundColor);
      if (color && mapping[color]) {
        window.palettePreviewElements.push({ el, prop: 'color', original: el.style.color });
        el.style.color = mapping[color];
        count++;
      }
      if (bg && mapping[bg]) {
        window.palettePreviewElements.push({ el, prop: 'backgroundColor', original: el.style.backgroundColor });
        el.style.backgroundColor = mapping[bg];
        count++;
      }
    });
    return count;
  }

  // colorblind simulation
  const COLORBLIND_SVG_MATRICES = {
    protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
    deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
    tritanopia: '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
    monochrome: '0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0'
  };

  function removeColorblindSimulation() {
    document.documentElement.style.filter = '';
    if (window.myColorblindSvg) {
      window.myColorblindSvg.remove();
      window.myColorblindSvg = null;
    }
  }

  function applyColorblindSimulation(mode) {
    removeColorblindSimulation();
    const matrix = COLORBLIND_SVG_MATRICES[mode];
    if (!matrix) return;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.pointerEvents = 'none';
    const filterId = 'stylytics-colorblind-filter';
    svg.innerHTML = `<defs><filter id="${filterId}"><feColorMatrix type="matrix" values="${matrix}"/></filter></defs>`;
    document.documentElement.appendChild(svg);
    window.myColorblindSvg = svg;
    document.documentElement.style.filter = `url(#${filterId})`;
  }

  // dark mode preview
  const DARK_MODE_SKIP_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'PICTURE', 'IFRAME', 'EMBED', 'OBJECT']);

  function parseRgbComponents(rgbStr) {
    if (!rgbStr) return null;
    const m = rgbStr.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!m) return null;
    return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10), a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  }

  function rgbToHslComponents(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0, s = 0;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  function hslToRgbComponents(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255)
    };
  }

  function invertColorForDarkMode(rgbStr) {
    const rgba = parseRgbComponents(rgbStr);
    if (!rgba || rgba.a === 0) return null;
    const hsl = rgbToHslComponents(rgba.r, rgba.g, rgba.b);
    const { r, g, b } = hslToRgbComponents(hsl.h, hsl.s, 100 - hsl.l);
    return rgba.a < 1 ? `rgba(${r}, ${g}, ${b}, ${rgba.a})` : `rgb(${r}, ${g}, ${b})`;
  }

  window.darkModePreviewElements = window.darkModePreviewElements || [];

  function removeDarkModePreview() {
    window.darkModePreviewElements.forEach(({ el, prop, original }) => {
      if (el && el.style) el.style[prop] = original;
    });
    window.darkModePreviewElements = [];
  }

  function applyDarkModePreview() {
    removeDarkModePreview();
    const targets = [document.documentElement, document.body, ...document.body.querySelectorAll('*')];

    const snapshots = [];
    targets.forEach(el => {
      if (!el || DARK_MODE_SKIP_TAGS.has(el.tagName) || SKIP_TAGS.has(el.tagName)) return;
      const style = window.getComputedStyle(el);
      snapshots.push({ el, color: style.color, backgroundColor: style.backgroundColor });
    });

    snapshots.forEach(({ el, color, backgroundColor }) => {
      const newColor = invertColorForDarkMode(color);
      if (newColor) {
        window.darkModePreviewElements.push({ el, prop: 'color', original: el.style.color });
        el.style.color = newColor;
      }

      const newBg = invertColorForDarkMode(backgroundColor);
      if (newBg) {
        window.darkModePreviewElements.push({ el, prop: 'backgroundColor', original: el.style.backgroundColor });
        el.style.backgroundColor = newBg;
      }
    });
  }

  // spacing/baseline grid overlay — a fixed, viewport-locked layer (not part of page
  // layout) so it never shifts the content it's measuring
  window.gridOverlayEl = window.gridOverlayEl || null;

  function removeGridOverlay() {
    if (window.gridOverlayEl) {
      window.gridOverlayEl.remove();
      window.gridOverlayEl = null;
    }
  }

  function applyGridOverlay(mode, size) {
    removeGridOverlay();
    if (mode !== 'grid' && mode !== 'baseline') return;
    const px = Math.max(2, Math.min(500, parseInt(size, 10) || (mode === 'baseline' ? 24 : 8)));
    const el = document.createElement('div');
    el.id = '__stylytics_grid_overlay__';
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '2147483647';
    if (mode === 'grid') {
      el.style.backgroundImage =
        'linear-gradient(to right, rgba(236, 72, 153, 0.3) 1px, transparent 1px), ' +
        'linear-gradient(to bottom, rgba(236, 72, 153, 0.3) 1px, transparent 1px)';
      el.style.backgroundSize = `${px}px ${px}px`;
    } else {
      el.style.backgroundImage = 'linear-gradient(to bottom, rgba(236, 72, 153, 0.4) 1px, transparent 1px)';
      el.style.backgroundSize = `100% ${px}px`;
    }
    document.documentElement.appendChild(el);
    window.gridOverlayEl = el;
  }

  window.scrollbarHideStyleEl = window.scrollbarHideStyleEl || null;
  window.fixedCaptureElements = window.fixedCaptureElements || [];

  function hideScrollbarForCapture() {
    if (window.scrollbarHideStyleEl) return;
    const style = document.createElement('style');
    style.textContent = `
      html { scrollbar-width: none !important; -ms-overflow-style: none !important; }
      html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
    `;
    document.documentElement.appendChild(style);
    window.scrollbarHideStyleEl = style;
  }

  function restoreScrollbarAfterCapture() {
    if (window.scrollbarHideStyleEl) {
      window.scrollbarHideStyleEl.remove();
      window.scrollbarHideStyleEl = null;
    }
  }

  // fixed element hiding
  function findFixedElements() {
    const found = [];
    const els = document.body ? document.body.querySelectorAll('*') : [];
    const max = Math.min(els.length, 12000);
    for (let i = 0; i < max; i++) {
      const el = els[i];
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (window.getComputedStyle(el).position !== 'fixed') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      found.push(el);
    }
    return found;
  }

  function restoreFixedElements() {
    window.fixedCaptureElements.forEach(({ el, originalVisibility }) => {
      if (el && el.style) el.style.visibility = originalVisibility;
    });
    window.fixedCaptureElements = [];
  }

  stopInspectMode();
  resetThemePreview();
  removeDarkModePreview();
  resetPalettePreview();
  removeHighlights();
  // also clear the toggle-tracking vars the message handler uses to decide "click
  // again = turn off" — otherwise the first highlight click after a rescan gets
  // misread as that same toggle-off, since window.lastAction survives reinjection
  window.lastAction = null;
  window.lastType = null;
  window.lastValue = null;
  removeGridOverlay();
  removeColorblindSimulation();
  restoreFixedElements();
  restoreScrollbarAfterCapture();

  // message listener
  if (window.myExtractorListener) {
    chrome.runtime.onMessage.removeListener(window.myExtractorListener);
  }

  window.myExtractorListener = (request, sender, sendResponse) => {
    // inspect actions
    if (request.action === 'start-inspect') {
      startInspectMode();
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'stop-inspect') {
      stopInspectMode();
      sendResponse({ success: true });
      return;
    }

    // dom tree actions
    if (request.action === 'dom-tree-root') {
      const root = document.body;
      if (!root) { sendResponse({ success: false, node: null }); return; }
      const node = serializeTreeNode(root, request.mode);
      node.textPreview = null;
      sendResponse({ success: true, node });
      return;
    }
    if (request.action === 'dom-tree-children') {
      const el = domTreeNodes.get(request.nodeId);
      if (!el) { sendResponse({ success: false, children: [] }); return; }
      const children = getTreeChildElements(el, request.mode).map(child => serializeTreeNode(child, request.mode));
      sendResponse({ success: true, children });
      return;
    }
    if (request.action === 'dom-tree-select') {
      const el = domTreeNodes.get(request.nodeId);
      if (!el) { sendResponse({ success: false }); return; }
      const info = buildInspectInfo(el);
      highlightTreeNode(el);
      sendResponse({ success: true, info });
      return;
    }
    if (request.action === 'dom-tree-hover') {
      const el = domTreeNodes.get(request.nodeId);
      if (el) applyTreeHover(el);
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'dom-tree-hover-clear') {
      clearTreeHover();
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'dom-tree-search') {
      const results = searchTreeNodes(request.query, 30);
      sendResponse({ success: true, results });
      return;
    }

    // full-page screenshot
    if (request.action === 'get-page-dimensions') {
      sendResponse({
        scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      });
      return;
    }
    if (request.action === 'scroll-to') {
      window.scrollTo({ top: request.y || 0, left: 0, behavior: 'instant' });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          sendResponse({ success: true, scrollY: window.scrollY });
        });
      });
      return true;
    }

    if (request.action === 'get-safe-break-points') {
      const REPLACED_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME', 'PICTURE']);
      const scrollY = window.scrollY;
      const intervals = [];
      const els = document.body ? document.body.querySelectorAll('*') : [];
      const max = Math.min(els.length, 12000);
      for (let i = 0; i < max; i++) {
        const el = els[i];
        if (SKIP_TAGS.has(el.tagName)) continue;
        let isAtomic = REPLACED_TAGS.has(el.tagName);
        if (!isAtomic) {
          for (const child of el.childNodes) {
            if (child.nodeType === 3 && child.textContent.trim().length > 0) { isAtomic = true; break; }
          }
        }
        if (!isAtomic) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        intervals.push([rect.top + scrollY, rect.bottom + scrollY]);
      }
      intervals.sort((a, b) => a[0] - b[0]);
      sendResponse({ intervals });
      return;
    }

    // scrollbar hiding
    if (request.action === 'hide-scrollbar') {
      hideScrollbarForCapture();
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'restore-scrollbar') {
      restoreScrollbarAfterCapture();
      sendResponse({ success: true });
      return;
    }
    // fixed elements
    if (request.action === 'prepare-fullpage-capture') {
      hideScrollbarForCapture();
      restoreFixedElements();
      window.fixedCaptureElements = findFixedElements().map(el => ({ el, originalVisibility: el.style.visibility }));
      sendResponse({ success: true, fixedCount: window.fixedCaptureElements.length });
      return;
    }
    if (request.action === 'hide-fixed-elements') {
      window.fixedCaptureElements.forEach(({ el }) => { if (el && el.style) el.style.visibility = 'hidden'; });
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'restore-after-fullpage-capture') {
      restoreFixedElements();
      restoreScrollbarAfterCapture();
      sendResponse({ success: true });
      return;
    }

    // font preview
    if (request.action === 'preview-font') {
      const count = previewFont(request.from, request.to);
      sendResponse({ success: true, count });
      return;
    }
    if (request.action === 'reset-preview') {
      resetThemePreview();
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'simulate-colorblind') {
      applyColorblindSimulation(request.mode);
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'toggle-dark-mode-preview') {
      if (request.enabled) applyDarkModePreview(); else removeDarkModePreview();
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'toggle-grid-overlay') {
      applyGridOverlay(request.mode, request.size);
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'preview-palette') {
      const count = previewPalette(request.mapping);
      sendResponse({ success: true, count });
      return;
    }
    if (request.action === 'reset-palette-preview') {
      resetPalettePreview();
      sendResponse({ success: true });
      return;
    }

    // handle toggle
    if (window.lastAction === request.action && window.lastType === request.type && window.lastValue === request.value) {
      removeHighlights();
      window.lastAction = null;
      window.lastType = null;
      window.lastValue = null;
      sendResponse({ success: true, count: 0, removed: true });
      return;
    }

    window.lastAction = request.action;
    window.lastType = request.type;
    window.lastValue = request.value;

    if (request.action === 'highlight') {
      if (request.type === 'hoverColor') {
        highlightHoverMatches(request.value);
      } else {
        highlightMatches(request.type, request.value);
      }
      sendResponse({ success: true, count: window.highlightedElements.length });
    }
    else if (request.action === 'highlight-dofollow') {
      removeHighlights();
      const links = document.querySelectorAll('a[href]:not([rel~="nofollow"])');
      const linkData = [];
      links.forEach(el => {
        el.dataset.originalOutline = el.style.outline;
        el.dataset.originalOutlineOffset = el.style.outlineOffset;
        el.dataset.originalTransition = el.style.transition;
        el.style.outline = '3px solid #34c759';
        el.style.outlineOffset = '2px';
        el.style.transition = 'outline 0.2s ease-in-out';
        window.highlightedElements.push(el);
        linkData.push({ text: el.innerText.trim() || el.textContent.trim() || '[No Text]', url: el.href });
      });
      sendResponse({ success: true, count: window.highlightedElements.length, links: linkData });
    }
    else if (request.action === 'highlight-nofollow') {
      removeHighlights();
      const links = document.querySelectorAll('a[href][rel~="nofollow"]');
      const linkData = [];
      links.forEach(el => {
        el.dataset.originalOutline = el.style.outline;
        el.dataset.originalOutlineOffset = el.style.outlineOffset;
        el.dataset.originalTransition = el.style.transition;
        el.style.outline = '3px solid #ef4444';
        el.style.outlineOffset = '2px';
        el.style.transition = 'outline 0.2s ease-in-out';
        window.highlightedElements.push(el);
        linkData.push({ text: el.innerText.trim() || el.textContent.trim() || '[No Text]', url: el.href });
      });
      sendResponse({ success: true, count: window.highlightedElements.length, links: linkData });
    }
    else if (request.action === 'highlight-internal') {
      removeHighlights();
      const currentHost = location.hostname;
      const links = Array.from(document.querySelectorAll('a[href]')).filter(el => {
        try { return new URL(el.href).hostname === currentHost; } catch (e) { return false; }
      });
      const linkData = [];
      links.forEach(el => {
        el.dataset.originalOutline = el.style.outline;
        el.dataset.originalOutlineOffset = el.style.outlineOffset;
        el.dataset.originalTransition = el.style.transition;
        el.style.outline = '3px solid #3b82f6';
        el.style.outlineOffset = '2px';
        el.style.transition = 'outline 0.2s ease-in-out';
        window.highlightedElements.push(el);
        linkData.push({ text: el.innerText.trim() || el.textContent.trim() || '[No Text]', url: el.href });
      });
      sendResponse({ success: true, count: window.highlightedElements.length, links: linkData });
    }
    else if (request.action === 'highlight-external') {
      removeHighlights();
      const currentHost = location.hostname;
      const links = Array.from(document.querySelectorAll('a[href]')).filter(el => {
        try { return new URL(el.href).hostname !== currentHost; } catch (e) { return false; }
      });
      const linkData = [];
      links.forEach(el => {
        el.dataset.originalOutline = el.style.outline;
        el.dataset.originalOutlineOffset = el.style.outlineOffset;
        el.dataset.originalTransition = el.style.transition;
        el.style.outline = '3px solid #f59e0b';
        el.style.outlineOffset = '2px';
        el.style.transition = 'outline 0.2s ease-in-out';
        window.highlightedElements.push(el);
        linkData.push({ text: el.innerText.trim() || el.textContent.trim() || '[No Text]', url: el.href });
      });
      sendResponse({ success: true, count: window.highlightedElements.length, links: linkData });
    }
    else if (request.action === 'removeHighlights') {
      removeHighlights();
      window.lastAction = null;
      sendResponse({ success: true });
    }
    return true;
  };

  chrome.runtime.onMessage.addListener(window.myExtractorListener);

  // data extraction
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'BASE']);
  const isLikelyTrackingPixel = (url) => /(?:^|[/_-])(1x1|pixel|spacer|blank)\.(?:gif|png|jpg|jpeg)(?:[?#]|$)/i.test(url) || /\/(?:pixel|beacon)\//i.test(url);
  const GRADIENT_RE = /(?:linear|radial|conic)-gradient\(/i;
  const BG_URL_RE = /url\(['"]?(.*?)['"]?\)/;
  const elements = document.body ? document.body.querySelectorAll('*') : document.querySelectorAll('*');
  const elementsArray = Array.from(elements);
  const fonts = new Set();
  const fontSizes = new Set();
  const colors = new Set();
  const bgColors = new Set();

  const imageUrls = new Set();
  const gradients = new Set();

  const marginCounts = new Map();
  const paddingCounts = new Map();
  const gapCounts = new Map();
  const radiusCounts = new Map();
  const shadowCounts = new Map();
  const zIndexCounts = new Map();

  function bumpTokenCount(map, value) {
    if (!value) return;
    map.set(value, (map.get(value) || 0) + 1);
  }

  for (let el of elements) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    const style = window.getComputedStyle(el);
    if (style.fontFamily) {
      fonts.add(style.fontFamily);
    }
    if (style.fontSize) fontSizes.add(style.fontSize);

    const color = style.color;
    if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') colors.add(color);

    const bgColor = style.backgroundColor;
    if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') bgColors.add(bgColor);

    const bgImg = style.backgroundImage;
    if (bgImg && bgImg !== 'none') {
      if (GRADIENT_RE.test(bgImg)) {
        gradients.add(bgImg);
      }
      const match = bgImg.match(BG_URL_RE);
      if (match && match[1] && !match[1].startsWith('data:')) {
        try { imageUrls.add(new URL(match[1], document.baseURI).href); } catch (e) { }
      }
    }

    const lazyBg = el.getAttribute('data-bg') || el.getAttribute('data-background') || el.getAttribute('data-background-image');
    if (lazyBg && !lazyBg.startsWith('data:')) {
      try { imageUrls.add(new URL(lazyBg, document.baseURI).href); } catch (e) { }
    }

    if (style.margin && style.margin !== '0px') bumpTokenCount(marginCounts, style.margin);
    if (style.padding && style.padding !== '0px') bumpTokenCount(paddingCounts, style.padding);
    if (style.gap && style.gap !== 'normal' && style.gap !== '0px') bumpTokenCount(gapCounts, style.gap);
    if (style.borderRadius && style.borderRadius !== '0px') bumpTokenCount(radiusCounts, style.borderRadius);
    if (style.boxShadow && style.boxShadow !== 'none') bumpTokenCount(shadowCounts, style.boxShadow);
    if (style.zIndex && style.zIndex !== 'auto') bumpTokenCount(zIndexCounts, style.zIndex);
  }

  function topTokenEntries(map, limit) {
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
  }

  const customProperties = new Set();
  try {
    for (let sheet of document.styleSheets) {
      try {
        for (let rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes(':root') && rule.style) {
            for (let i = 0; i < rule.style.length; i++) {
              const prop = rule.style[i];
              if (prop.startsWith('--')) {
                customProperties.add(`${prop}: ${rule.style.getPropertyValue(prop).trim()}`);
              }
            }
          }
        }
      } catch (e) { }
    }
  } catch (e) { }

  const designTokens = {
    margins: topTokenEntries(marginCounts, 10),
    paddings: topTokenEntries(paddingCounts, 10),
    gaps: topTokenEntries(gapCounts, 8),
    radii: topTokenEntries(radiusCounts, 10),
    shadows: topTokenEntries(shadowCounts, 6),
    zIndexes: topTokenEntries(zIndexCounts, 8),
    customProperties: Array.from(customProperties).slice(0, 40)
  };

  function rgbToHex(rgb) {
    if (!rgb) return null;
    const rgbaMatch = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!rgbaMatch) return rgb;
    const r = parseInt(rgbaMatch[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgbaMatch[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgbaMatch[3]).toString(16).padStart(2, '0');
    const a = rgbaMatch[4] ? Math.round(parseFloat(rgbaMatch[4]) * 255).toString(16).padStart(2, '0') : '';
    return `#${r}${g}${b}${a}`.toUpperCase();
  }

  const processedColors = [];
  const seenColorHexes = new Set();
  colors.forEach(c => {
    const hex = rgbToHex(c);
    if (hex && hex.startsWith('#') && !seenColorHexes.has(hex)) {
      seenColorHexes.add(hex);
      processedColors.push({ hex, raw: c });
    }
  });

  const processedBgColors = [];
  const seenBgColorHexes = new Set();
  bgColors.forEach(c => {
    const hex = rgbToHex(c);
    if (hex && hex.startsWith('#') && !seenBgColorHexes.has(hex)) {
      seenBgColorHexes.add(hex);
      processedBgColors.push({ hex, raw: c });
    }
  });

  const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const headings = Array.from(headingEls).filter(h => !isInHeaderOrFooter(h)).map(h => {
    let text = h.innerText.trim() || h.textContent.trim();
    text = text.replace(/[#¶]$/, '').trim();
    return {
      tag: h.tagName.toLowerCase(),
      text: text,
      id: h.id || null
    };
  }).filter(h => h.text.length > 0);

  // backlinks
  const currentHost = location.hostname;
  const links = Array.from(document.querySelectorAll('a[href]')).filter(a => !isInHeaderOrFooter(a)).map(a => {
    let isInternal = false;
    try { isInternal = new URL(a.href).hostname === currentHost; } catch (e) { }
    return {
      text: (a.innerText || a.textContent || '').trim(),
      url: a.href,
      rel: a.getAttribute('rel') || '',
      isInternal
    };
  }).filter(l => l.url && !l.url.startsWith('javascript:'));

  // structured data
  const structuredDataBlocks = [];
  const structuredDataTypes = new Set();

  function collectStructuredDataTypes(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(collectStructuredDataTypes);
      return;
    }
    if (typeof node !== 'object') return;
    if (node['@type']) {
      if (Array.isArray(node['@type'])) node['@type'].forEach(t => structuredDataTypes.add(t));
      else structuredDataTypes.add(node['@type']);
    }
    if (node['@graph']) collectStructuredDataTypes(node['@graph']);
  }

  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    const raw = s.textContent;
    let parsed = null;
    let error = false;
    try {
      parsed = JSON.parse(raw);
      collectStructuredDataTypes(parsed);
    } catch (e) {
      error = true;
    }
    structuredDataBlocks.push({ raw, parsed, error });
  });

  // accessibility audit
  const imgEls = document.querySelectorAll('img');
  // alt="" is the correct, recommended markup for a decorative image (screen readers
  // skip it) — only a genuinely absent alt attribute is an accessibility defect.
  const imagesMissingAlt = Array.from(imgEls)
    .filter(img => !img.hasAttribute('alt'))
    .map(img => img.currentSrc || img.src || img.getAttribute('src') || '')
    .filter(Boolean);

  const formFieldsMissingLabel = [];
  document.querySelectorAll('input, select, textarea').forEach(field => {
    const type = (field.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;

    const hasAriaLabel = field.hasAttribute('aria-label') && field.getAttribute('aria-label').trim();
    const hasAriaLabelledby = field.hasAttribute('aria-labelledby') && field.getAttribute('aria-labelledby').trim();
    const id = field.id;
    let hasLabelFor = false;
    if (id) {
      try { hasLabelFor = !!document.querySelector(`label[for="${CSS.escape(id)}"]`); } catch (e) { }
    }
    const hasWrappingLabel = !!field.closest('label');

    if (!hasAriaLabel && !hasAriaLabelledby && !hasLabelFor && !hasWrappingLabel) {
      formFieldsMissingLabel.push({
        tag: field.tagName.toLowerCase(),
        type: type || null,
        name: field.getAttribute('name') || null
      });
    }
  });

  const landmarks = {
    header: !!document.querySelector('header, [role="banner"]'),
    nav: !!document.querySelector('nav, [role="navigation"]'),
    main: !!document.querySelector('main, [role="main"]'),
    footer: !!document.querySelector('footer, [role="contentinfo"]')
  };

  const focusableCount = document.querySelectorAll(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ).length;

  const langMissing = !document.documentElement.lang || !document.documentElement.lang.trim();

  const accessibility = {
    imagesMissingAlt: imagesMissingAlt.slice(0, 50),
    imagesMissingAltCount: imagesMissingAlt.length,
    formFieldsMissingLabel: formFieldsMissingLabel.slice(0, 50),
    formFieldsMissingLabelCount: formFieldsMissingLabel.length,
    landmarks,
    focusableCount,
    langMissing
  };

  // dark pattern detection — manipulative UX heuristics (FTC/EU deceptive-design rules
  // are the backdrop here). These are best-effort text/DOM signals, not a legal
  // determination — each hit is "worth a human look", not proof of intent.
  function dedupeInstances(arr, limit) {
    const map = new Map();
    arr.forEach(item => {
      const key = item.text.toLowerCase();
      const existing = map.get(key);
      if (existing) existing.count++;
      else map.set(key, Object.assign({}, item, { count: 1 }));
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, limit || 30);
  }

  function dpElementText(el) {
    return (el.innerText || el.textContent || el.value || '').trim().replace(/\s+/g, ' ');
  }

  function dpLabelTextFor(input) {
    if (input.id) {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (lbl) return dpElementText(lbl);
      } catch (e) { }
    }
    const wrapping = input.closest('label');
    if (wrapping) return dpElementText(wrapping);
    if (input.parentElement) return dpElementText(input.parentElement).slice(0, 150);
    return '';
  }

  function isNearInvisibleTextColor(el) {
    const style = window.getComputedStyle(el);
    const fg = parseRgbComponents(style.color);
    if (!fg || fg.a === 0) return false;
    let bgEl = el, bg = null;
    while (bgEl && bgEl !== document.documentElement) {
      const parsed = parseRgbComponents(window.getComputedStyle(bgEl).backgroundColor);
      if (parsed && parsed.a > 0) { bg = parsed; break; }
      bgEl = bgEl.parentElement;
    }
    if (!bg) bg = { r: 255, g: 255, b: 255, a: 1 };
    const diff = Math.abs(fg.r - bg.r) + Math.abs(fg.g - bg.g) + Math.abs(fg.b - bg.b);
    return diff < 30;
  }

  function isSuspiciouslyHidden(el) {
    const style = window.getComputedStyle(el);
    if (parseFloat(style.opacity) <= 0.05) return true;
    const fontSize = parseFloat(style.fontSize);
    if (fontSize && fontSize < 9) return true;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 && rect.height <= 1) return true;
    if (rect.left <= -500 || rect.top <= -500) return true;
    return isNearInvisibleTextColor(el);
  }

  // 1. pre-checked opt-in checkboxes (default consent)
  const BENIGN_PRECHECKED = /remember me|keep me (signed|logged) in|stay (signed|logged) in/i;
  const preCheckedOptInsRaw = [];
  document.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    const labelText = dpLabelTextFor(cb);
    if (BENIGN_PRECHECKED.test(labelText)) return;
    preCheckedOptInsRaw.push({ text: labelText || '[Checkbox with no associated label text]' });
  });
  const preCheckedOptIns = dedupeInstances(preCheckedOptInsRaw, 30);

  // 2. confirm-shaming decline copy ("No thanks, I hate saving money")
  const CONFIRM_SHAME_PATTERNS = [
    /no,?\s+i (don'?t|do not|dont)\s+(want|like|need|love)/i,
    /no thanks,?\s+i (hate|dislike)/i,
    /i('ll| will) (pass|skip)( on)? (saving|savings|discounts?|deals?|free)/i,
    /i (don'?t|do not) (want|like) to (save|win)/i,
    /i (prefer|choose) to (pay full price|overpay|miss out)/i,
    /i('m| am) (not interested|ok with|fine with) (paying more|missing out|losing)/i,
    /no,? i('d| would) rather/i
  ];
  const confirmShamingRaw = [];
  document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]').forEach(el => {
    const text = dpElementText(el);
    if (!text || text.length > 200) return;
    if (CONFIRM_SHAME_PATTERNS.some(re => re.test(text))) confirmShamingRaw.push({ text: text.slice(0, 150) });
  });
  const confirmShaming = dedupeInstances(confirmShamingRaw, 30);

  // 5. confusing double-negative opt-out phrasing on checkboxes
  const DOUBLE_NEGATIVE_PATTERN = /\b(uncheck|un-check|deselect)\b.{0,40}\b(if|to)\b.{0,40}\b(do not|don'?t|no longer)\b/i;
  const confusingOptOutsRaw = [];
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    const labelText = dpLabelTextFor(cb);
    if (labelText && DOUBLE_NEGATIVE_PATTERN.test(labelText)) confusingOptOutsRaw.push({ text: labelText.slice(0, 150) });
  });
  const confusingOptOuts = dedupeInstances(confusingOptOutsRaw, 30);

  // 3, 6, 7: scarcity/urgency text, undisclosed free-trial billing terms, and disguised ad
  // labels all scan the same leaf text nodes, so one DOM pass covers all three
  const SCARCITY_PATTERNS = [
    /only\s+\d+\s+(left|remain(ing)?|in stock|available)/i,
    /\d+\s+(people|users|viewers|shoppers)\s+(are\s+)?(viewing|looking at|bought|purchased|have this)/i,
    /(hurry|act now|don'?t miss out|last chance|almost gone|selling fast|going fast)/i,
    /(limited time|limited stock|limited availability|while (supplies|stocks) last)/i,
    /(offer|sale|deal|discount)\s+ends?\s+(in|today|soon|tonight)/i,
    /\b\d{1,2}:\d{2}:\d{2}\b/,
    /flash sale/i
  ];
  const FREE_TRIAL_PATTERN = /free trial/i;
  const BILLING_CONTEXT_PATTERN = /(cancel anytime|no commitment|\$\s?\d|€\s?\d|£\s?\d|per (month|year)|\/\s?(mo|month|yr|year)|billed|charge|auto-renew|renews automatically)/i;
  const AD_LABEL_PATTERN = /^(ad|advertisement|sponsored|promoted)$/i;

  const scarcityRaw = [];
  const undisclosedFreeTrialsRaw = [];
  const disguisedAdsRaw = [];
  document.querySelectorAll('body *').forEach(el => {
    if (SKIP_TAGS.has(el.tagName) || el.children.length > 0) return;
    const text = dpElementText(el);
    if (!text) return;

    if (text.length <= 150 && SCARCITY_PATTERNS.some(re => re.test(text))) {
      scarcityRaw.push({ text });
    }
    if (text.length <= 20 && AD_LABEL_PATTERN.test(text) && isSuspiciouslyHidden(el)) {
      disguisedAdsRaw.push({ text });
    }
    if (FREE_TRIAL_PATTERN.test(text)) {
      const container = el.closest('section, article, div, form') || el.parentElement || el;
      const contextText = dpElementText(container).slice(0, 600);
      if (!BILLING_CONTEXT_PATTERN.test(contextText)) undisclosedFreeTrialsRaw.push({ text: text.slice(0, 150) });
    }
  });
  const scarcityUrgency = dedupeInstances(scarcityRaw, 30);
  const undisclosedFreeTrials = dedupeInstances(undisclosedFreeTrialsRaw, 30);
  const disguisedAds = dedupeInstances(disguisedAdsRaw, 30);

  // 4. hidden or obscured cancel/unsubscribe/delete-account links
  const SENSITIVE_ACTION_PATTERN = /unsubscribe|cancel (my )?(subscription|membership|plan)|delete (my )?account|close (my )?account|opt.?out/i;
  const hiddenSensitiveLinksRaw = [];
  document.querySelectorAll('a, button, [role="button"]').forEach(el => {
    const text = dpElementText(el);
    if (!text || text.length > 100 || !SENSITIVE_ACTION_PATTERN.test(text)) return;
    if (isSuspiciouslyHidden(el)) hiddenSensitiveLinksRaw.push({ text: text.slice(0, 150) });
  });
  const hiddenSensitiveLinks = dedupeInstances(hiddenSensitiveLinksRaw, 30);

  // 8. consent banners where "Accept" is a filled button and "Reject/Manage" is a bare link
  const CONSENT_ACCEPT_PATTERN = /^(accept|allow|agree|got it|i agree|accept all|allow all)$/i;
  const CONSENT_DECLINE_PATTERN = /^(reject|decline|manage (preferences|cookies)|necessary only|do not sell|opt.?out|deny)/i;
  const consentDisparityRaw = [];
  document.querySelectorAll('button, a, [role="button"]').forEach(el => {
    const text = dpElementText(el);
    if (!text || text.length > 40 || !CONSENT_ACCEPT_PATTERN.test(text)) return;
    const scope = el.closest('div, section, aside, form') || el.parentElement;
    if (!scope) return;
    const declineEl = Array.from(scope.querySelectorAll('button, a, [role="button"]'))
      .find(cand => cand !== el && CONSENT_DECLINE_PATTERN.test(dpElementText(cand)));
    if (!declineEl) return;
    const acceptBg = parseRgbComponents(window.getComputedStyle(el).backgroundColor);
    const declineBg = parseRgbComponents(window.getComputedStyle(declineEl).backgroundColor);
    if (acceptBg && acceptBg.a > 0 && (!declineBg || declineBg.a === 0)) {
      consentDisparityRaw.push({ text: `"${text}" is styled as a filled button while "${dpElementText(declineEl)}" is a plain link` });
    }
  });
  const consentButtonDisparity = dedupeInstances(consentDisparityRaw, 30);

  const sumCounts = arr => arr.reduce((s, i) => s + i.count, 0);
  const darkPatterns = {
    preCheckedOptIns, preCheckedOptInsCount: sumCounts(preCheckedOptIns),
    confirmShaming, confirmShamingCount: sumCounts(confirmShaming),
    scarcityUrgency, scarcityUrgencyCount: sumCounts(scarcityUrgency),
    hiddenSensitiveLinks, hiddenSensitiveLinksCount: sumCounts(hiddenSensitiveLinks),
    confusingOptOuts, confusingOptOutsCount: sumCounts(confusingOptOuts),
    undisclosedFreeTrials, undisclosedFreeTrialsCount: sumCounts(undisclosedFreeTrials),
    disguisedAds, disguisedAdsCount: sumCounts(disguisedAds),
    consentButtonDisparity, consentButtonDisparityCount: sumCounts(consentButtonDisparity)
  };

  // performance snapshot
  const perfSnapshot = {
    domContentLoadedMs: null,
    loadMs: null,
    resourceCount: 0,
    totalTransferSizeKb: 0,
    renderBlockingScripts: 0
  };

  try {
    const navEntries = performance.getEntriesByType('navigation');
    const nav = navEntries && navEntries[0];
    if (nav) {
      perfSnapshot.domContentLoadedMs = Math.round(nav.domContentLoadedEventEnd);
      perfSnapshot.loadMs = Math.round(nav.loadEventEnd);
    }
    const resources = performance.getEntriesByType('resource') || [];
    perfSnapshot.resourceCount = resources.length;
    const totalBytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
    perfSnapshot.totalTransferSizeKb = Math.round(totalBytes / 1024);
  } catch (e) { }

  try {
    perfSnapshot.renderBlockingScripts = Array.from(document.querySelectorAll('head script[src]'))
      .filter(s => !s.async && !s.defer && s.getAttribute('type') !== 'module').length;
  } catch (e) { }

  const sortedSizes = Array.from(fontSizes).sort((a, b) => parseFloat(a) - parseFloat(b));

  // hover colors
  const rawHoverColors = new Set();
  const rawHoverBgColors = new Set();
  try {
    for (let sheet of document.styleSheets) {
      try {
        for (let rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes(':hover')) {
            if (rule.style.color) rawHoverColors.add(rule.style.color);
            if (rule.style.backgroundColor) rawHoverBgColors.add(rule.style.backgroundColor);
          }
        }
      } catch (e) { }
    }
  } catch (e) { }

  const hoverColorsProcessed = [];
  rawHoverColors.forEach(c => {
    const hex = rgbToHex(c);
    if (hex && hex.startsWith('#') && !hoverColorsProcessed.find(pc => pc.hex === hex)) {
      hoverColorsProcessed.push({ hex, raw: c });
    }
  });

  const hoverBgColorsProcessed = [];
  rawHoverBgColors.forEach(c => {
    const hex = rgbToHex(c);
    if (hex && hex.startsWith('#') && !hoverBgColorsProcessed.find(pc => pc.hex === hex)) {
      hoverBgColorsProcessed.push({ hex, raw: c });
    }
  });

  // images
  const getBestSrcset = (srcsetString) => {
    if (!srcsetString) return null;
    const sources = srcsetString.split(',').map(s => {
      const parts = s.trim().split(/\s+/);
      return { url: parts[0], width: parts[1] ? parseInt(parts[1]) : 0 };
    });
    sources.sort((a, b) => b.width - a.width);
    return sources[0] ? sources[0].url : null;
  };

  const processUrl = (url) => {
    if (!url || url.startsWith('data:')) return;
    try {
      const absoluteUrl = new URL(url, document.baseURI).href;
      imageUrls.add(absoluteUrl);
    } catch (e) { }
  };

  // broken images
  const brokenImages = [];
  window.reportedBrokenImages = window.reportedBrokenImages || new Set();

  function reportBrokenImage(url) {
    if (!url || window.reportedBrokenImages.has(url)) return;
    window.reportedBrokenImages.add(url);
    try { chrome.runtime.sendMessage({ action: 'broken_image', url }); } catch (e) { }
  }

  function attachBrokenImageWatcher(img, url) {
    if (!url) return;
    if (img.complete) {
      if (img.naturalWidth === 0) {
        brokenImages.push(url);
        reportBrokenImage(url);
      }
    } else {
      img.addEventListener('error', () => reportBrokenImage(url), { once: true });
      img.addEventListener('load', () => {
        if (img.naturalWidth === 0) reportBrokenImage(url);
      }, { once: true });
    }
  }

  imgEls.forEach(img => {
    let bestUrl = getBestSrcset(img.srcset) ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-highres') ||
      img.src ||
      img.getAttribute('src');
    if (!bestUrl) return;
    processUrl(bestUrl);
    try { attachBrokenImageWatcher(img, new URL(bestUrl, document.baseURI).href); } catch (e) { }
  });

  document.querySelectorAll('picture source').forEach(source => {
    processUrl(getBestSrcset(source.srcset) || source.getAttribute('data-srcset'));
  });

  document.querySelectorAll('svg image').forEach(img => {
    processUrl(img.getAttribute('href') || img.getAttribute('xlink:href'));
  });

  // image observer
  window.sentImagesSet = window.sentImagesSet || new Set();
  imageUrls.forEach(u => window.sentImagesSet.add(u));

  if (window.myImageObserver) {
    window.myImageObserver.disconnect();
  }

  const checkEl = (el, newlyFound) => {
    if (el.tagName === 'IMG') {
      let bestUrl = getBestSrcset(el.srcset) || el.getAttribute('data-src') || el.src || el.getAttribute('src');
      if (bestUrl && !bestUrl.startsWith('data:')) {
        try {
          const absoluteUrl = new URL(bestUrl, document.baseURI).href;
          if (!isLikelyTrackingPixel(absoluteUrl)) newlyFound.add(absoluteUrl);
          attachBrokenImageWatcher(el, absoluteUrl);
        } catch (e) { }
      }
    } else {
      try {
        const style = window.getComputedStyle(el);
        const bgImg = style.backgroundImage;
        if (bgImg && bgImg !== 'none') {
          const match = bgImg.match(BG_URL_RE);
          if (match && match[1] && !match[1].startsWith('data:')) {
            const absoluteUrl = new URL(match[1], document.baseURI).href;
            if (!isLikelyTrackingPixel(absoluteUrl)) newlyFound.add(absoluteUrl);
          }
        }
      } catch (e) { }
    }
  };

  let pendingMutations = [];
  let mutationScanScheduled = false;

  function processPendingMutations() {
    mutationScanScheduled = false;
    const mutations = pendingMutations;
    pendingMutations = [];

    let newlyFound = new Set();
    mutations.forEach(m => {
      if (m.type === 'childList') {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            checkEl(node, newlyFound);
            node.querySelectorAll('*').forEach(el => checkEl(el, newlyFound));
          }
        });
      } else if (m.type === 'attributes') {
        if (m.target.nodeType === 1) checkEl(m.target, newlyFound);
      }
    });

    newlyFound.forEach(url => {
      if (!window.sentImagesSet.has(url)) {
        window.sentImagesSet.add(url);
        try {
          chrome.runtime.sendMessage({ action: 'new_image', url: url });
        } catch (e) { }
      }
    });
  }

  window.myImageObserver = new MutationObserver((mutations) => {
    pendingMutations.push(...mutations);
    if (!mutationScanScheduled) {
      mutationScanScheduled = true;
      requestAnimationFrame(processPendingMutations);
    }
  });

  window.myImageObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-src', 'srcset', 'style', 'class']
  });

  // meta
  const metaDescElement = document.querySelector('meta[name="description"]');
  const canonicalElement = document.querySelector('link[rel="canonical"]');

  let wordCount = 0;
  if (document.body) {
    if (excludeHeaderFooter) {
      const excludedEls = Array.from(document.querySelectorAll(HEADER_FOOTER_SELECTOR));
      const prevDisplay = excludedEls.map(el => el.style.display);
      excludedEls.forEach(el => { el.style.display = 'none'; });
      wordCount = document.body.innerText.trim().split(/\s+/).filter(Boolean).length;
      excludedEls.forEach((el, i) => { el.style.display = prevDisplay[i]; });
    } else {
      wordCount = document.body.innerText.trim().split(/\s+/).filter(Boolean).length;
    }
  }

  const getMetaContent = (selectors) => {
    for (let selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.content) return el.content;
    }
    return null;
  };

  const socialMeta = {
    og: {
      title: getMetaContent(['meta[property="og:title"]']),
      description: getMetaContent(['meta[property="og:description"]']),
      image: getMetaContent(['meta[property="og:image"]'])
    },
    twitter: {
      card: getMetaContent(['meta[name="twitter:card"]']),
      title: getMetaContent(['meta[name="twitter:title"]']),
      description: getMetaContent(['meta[name="twitter:description"]']),
      image: getMetaContent(['meta[name="twitter:image"]'])
    }
  };

  // media contact
  const SOCIAL_DOMAINS = {
    'facebook.com': 'Facebook',
    'twitter.com': 'Twitter/X',
    'x.com': 'Twitter/X',
    'instagram.com': 'Instagram',
    'linkedin.com': 'LinkedIn',
    'youtube.com': 'YouTube',
    'tiktok.com': 'TikTok',
    'pinterest.com': 'Pinterest',
    'threads.net': 'Threads',
    'github.com': 'GitHub',
    'reddit.com': 'Reddit',
    't.me': 'Telegram',
    'wa.me': 'WhatsApp',
    'snapchat.com': 'Snapchat',
    'mastodon.social': 'Mastodon'
  };

  function getSocialPlatform(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      for (const domain in SOCIAL_DOMAINS) {
        if (hostname === domain || hostname.endsWith('.' + domain)) return SOCIAL_DOMAINS[domain];
      }
    } catch (e) { }
    return null;
  }

  const contactEmails = new Set();
  const contactPhones = new Set();
  const socialLinksMap = new Map();

  links.forEach(l => {
    if (l.url.startsWith('mailto:')) {
      const email = l.url.replace('mailto:', '').split('?')[0].trim();
      if (email) contactEmails.add(email);
    } else if (l.url.startsWith('tel:')) {
      const phone = l.url.replace('tel:', '').trim();
      if (phone) contactPhones.add(phone);
    } else {
      const platform = getSocialPlatform(l.url);
      if (platform && !socialLinksMap.has(l.url)) socialLinksMap.set(l.url, { platform, url: l.url });
    }
  });

  document.querySelectorAll('a[rel~="me"], link[rel="me"]').forEach(el => {
    const url = el.href;
    if (!url) return;
    const platform = getSocialPlatform(url) || 'Other';
    if (!socialLinksMap.has(url)) socialLinksMap.set(url, { platform, url });
  });

  let contactName = null;
  let contactOrg = null;
  let contactJobTitle = null;
  const contactAddresses = [];

  function formatAddress(addr) {
    if (!addr || typeof addr !== 'object') return null;
    const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry]
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }

  function walkContact(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walkContact);
      return;
    }
    if (typeof node !== 'object') return;

    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    const isContactish = types.some(t => t && /Organization|Person|LocalBusiness|NewsMediaOrganization|ContactPoint/i.test(t));

    if (isContactish) {
      if (!contactName && typeof node.name === 'string') contactName = node.name;
      if (!contactOrg && typeof node.name === 'string' &&
        types.some(t => t && /Organization|LocalBusiness|NewsMediaOrganization/i.test(t))) {
        contactOrg = node.name;
      }
      if (!contactJobTitle && typeof node.jobTitle === 'string') contactJobTitle = node.jobTitle;
      if (typeof node.email === 'string') contactEmails.add(node.email.replace('mailto:', '').trim());
      if (typeof node.telephone === 'string') contactPhones.add(node.telephone.trim());

      if (node.address) {
        const addrList = Array.isArray(node.address) ? node.address : [node.address];
        addrList.forEach(addr => {
          const formatted = formatAddress(addr);
          if (formatted && !contactAddresses.some(a => a.formatted === formatted)) {
            contactAddresses.push({
              streetAddress: addr.streetAddress || null,
              addressLocality: addr.addressLocality || null,
              addressRegion: addr.addressRegion || null,
              postalCode: addr.postalCode || null,
              addressCountry: addr.addressCountry || null,
              formatted
            });
          }
        });
      }

      if (node.contactPoint) {
        const points = Array.isArray(node.contactPoint) ? node.contactPoint : [node.contactPoint];
        points.forEach(cp => {
          if (cp && typeof cp.email === 'string') contactEmails.add(cp.email.replace('mailto:', '').trim());
          if (cp && typeof cp.telephone === 'string') contactPhones.add(cp.telephone.trim());
        });
      }

      if (node.sameAs) {
        const sameAsList = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
        sameAsList.forEach(url => {
          if (typeof url !== 'string') return;
          const platform = getSocialPlatform(url) || 'Other';
          if (!socialLinksMap.has(url)) socialLinksMap.set(url, { platform, url });
        });
      }
    }

    if (node['@graph']) walkContact(node['@graph']);
  }

  structuredDataBlocks.forEach(b => walkContact(b.parsed));

  try {
    const contactRegion = document.querySelector(
      'footer, [class*="contact" i], [id*="contact" i], [class*="press" i], [id*="press" i], [class*="media-contact" i]'
    );
    if (contactRegion) {
      const text = contactRegion.innerText || '';
      const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      emailMatches.slice(0, 5).forEach(e => contactEmails.add(e));
      const phoneMatches = text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];
      phoneMatches.slice(0, 5).forEach(p => contactPhones.add(p.trim()));
    }
  } catch (e) { }

  const geoPlacename = getMetaContent(['meta[name="geo.placename"]']);
  const geoRegion = getMetaContent(['meta[name="geo.region"]']);
  const geoPosition = getMetaContent(['meta[name="geo.position"]', 'meta[name="ICBM"]']);

  let contactLocation = [geoPlacename, geoRegion].filter(Boolean).join(', ') || null;
  if (!contactLocation && contactAddresses.length) {
    contactLocation = [contactAddresses[0].addressLocality, contactAddresses[0].addressRegion, contactAddresses[0].addressCountry]
      .filter(Boolean).join(', ') || null;
  }

  const mediaContact = {
    name: contactName,
    organization: contactOrg,
    jobTitle: contactJobTitle,
    emails: Array.from(contactEmails).slice(0, 10),
    phones: Array.from(contactPhones).slice(0, 10),
    addresses: contactAddresses.slice(0, 5),
    location: contactLocation,
    geoPosition: geoPosition || null,
    socialLinks: Array.from(socialLinksMap.values()).slice(0, 20)
  };

  // core web vitals
  const webVitals = { lcp: null, cls: null, fcp: null, ttfb: null, inp: null };
  try {
    const lcpObserver = new PerformanceObserver(() => { });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    const lcpEntries = lcpObserver.takeRecords();
    if (lcpEntries.length) webVitals.lcp = lcpEntries[lcpEntries.length - 1].startTime;
  } catch (e) { }
  try {
    const clsObserver = new PerformanceObserver(() => { });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
    const clsEntries = clsObserver.takeRecords();
    webVitals.cls = clsEntries.reduce((sum, entry) => sum + (entry.hadRecentInput ? 0 : entry.value), 0);
  } catch (e) { }
  try {
    const fcpEntry = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint');
    if (fcpEntry) webVitals.fcp = fcpEntry.startTime;
  } catch (e) { }
  try {
    const navEntry = performance.getEntriesByType('navigation')[0];
    if (navEntry) webVitals.ttfb = navEntry.responseStart;
  } catch (e) { }

  // llm visibility signals
  const llmSignals = {
    tableCount: document.querySelectorAll('table').length,
    listItemCount: document.querySelectorAll('ul li, ol li').length,
    dataEvidenceCount: (() => {
      const text = (document.body && document.body.innerText) || '';
      const matches = text.match(/\d+(\.\d+)?%|\$\d[\d,.]*|\b\d{1,3}(,\d{3})+\b|\b\d+(\.\d+)?\s?(million|billion|thousand)\b/gi);
      return matches ? matches.length : 0;
    })(),
    conversationalHeadingCount: headings.filter(h => /\?\s*$/.test(h.text) || /^(how|what|why|when|where|who|which|can|does|do|is|are|should|will)\b/i.test(h.text.trim())).length,
    answerFirstParagraphCount: (() => {
      let count = 0;
      for (let i = 0; i < headingEls.length && i < 100; i++) {
        let sib = headingEls[i].nextElementSibling;
        while (sib && sib.tagName !== 'P' && !/^H[1-6]$/.test(sib.tagName)) sib = sib.nextElementSibling;
        if (sib && sib.tagName === 'P') {
          const words = (sib.innerText || '').trim().split(/\s+/).filter(Boolean).length;
          if (words > 0 && words <= 40) count++;
        }
      }
      return count;
    })()
  };

  // tech stack detection
  function detectTechStack() {
    const found = [];
    const seenNames = new Set();
    const add = (name, category) => {
      if (seenNames.has(name)) return;
      seenNames.add(name);
      found.push({ name, category });
    };
    const w = window;
    const hasScript = (substr) => !!document.querySelector(`script[src*="${substr}"]`);
    const hasLink = (substr) => !!document.querySelector(`link[href*="${substr}"]`);

    const generatorMeta = document.querySelector('meta[name="generator"]');
    const generatorContent = (generatorMeta && generatorMeta.content) || '';
    const versionedName = (label, text) => {
      const m = text.match(new RegExp(label + '!?\\s+v?([\\d.]+)', 'i'));
      return m ? `${label} ${m[1]}` : label;
    };

    // cms
    if (/wordpress/i.test(generatorContent) ||
      document.querySelector('link[href*="/wp-content/"], script[src*="/wp-content/"], link[href*="/wp-includes/"]')) {
      add(versionedName('WordPress', generatorContent), 'CMS');
    }
    if (document.querySelector('[data-wf-page], [data-wf-site], .w-webflow-badge')) add('Webflow', 'CMS');
    if (w.wixBiSession || hasScript('static.wixstatic.com')) add('Wix', 'CMS');
    if (w.Squarespace || hasScript('squarespace.com') || hasLink('squarespace.com')) add('Squarespace', 'CMS');
    if (/ghost/i.test(generatorContent) || hasLink('ghost.io')) add('Ghost', 'CMS');
    if (/drupal/i.test(generatorContent)) add(versionedName('Drupal', generatorContent), 'CMS');
    if (/joomla/i.test(generatorContent)) add(versionedName('Joomla', generatorContent), 'CMS');
    if (/hugo/i.test(generatorContent)) add('Hugo', 'Static Site Generator');
    if (/gatsby/i.test(generatorContent)) add('Gatsby', 'Static Site Generator');
    if (/prestashop/i.test(generatorContent)) add(versionedName('PrestaShop', generatorContent), 'Ecommerce');
    if (/magento/i.test(generatorContent)) add(versionedName('Magento', generatorContent), 'Ecommerce');
    if (/symfony/i.test(generatorContent)) { add('Symfony', 'Web Framework'); add('PHP', 'Programming Language'); }
    if (/laravel/i.test(generatorContent)) { add('Laravel', 'Web Framework'); add('PHP', 'Programming Language'); }

    // wordpress plugins
    if (/elementor/i.test(generatorContent) || hasScript('/wp-content/plugins/elementor/') || hasLink('/wp-content/plugins/elementor/') || document.querySelector('.elementor-widget, [data-elementor-type]')) {
      add(versionedName('Elementor', generatorContent), 'Page Builder');
    }
    if (hasScript('/wp-content/plugins/wordpress-seo/') || hasLink('/wp-content/plugins/wordpress-seo/')) {
      add('Yoast SEO', 'SEO');
    }

    // ecommerce
    if (w.Shopify || hasLink('cdn.shopify.com') || hasScript('cdn.shopify.com')) add('Shopify', 'Ecommerce');
    if (document.body && document.body.className.includes('woocommerce')) add('WooCommerce', 'Ecommerce');
    if (w.Mage || hasScript('/skin/frontend/') || hasScript('/static/frontend/')) add('Magento', 'Ecommerce');
    if (hasScript('bigcommerce.com')) add('BigCommerce', 'Ecommerce');

    // javascript frameworks
    if (w.__NEXT_DATA__) add('Next.js', 'JavaScript Framework');
    else if (w.React || document.querySelector('[data-reactroot], #__next')) add('React', 'JavaScript Framework');
    if (w.__NUXT__) add('Nuxt.js', 'JavaScript Framework');
    if (w.Vue || document.querySelector('[data-v-app]') ||
      elementsArray.slice(0, 500).some(el => el.attributes && Array.from(el.attributes).some(a => a.name.startsWith('data-v-')))) add('Vue.js', 'JavaScript Framework');
    if (w.ng || document.querySelector('[ng-version]')) add('Angular', 'JavaScript Framework');
    if (w.Ember) add('Ember.js', 'JavaScript Framework');
    if (w.Alpine || document.querySelector('[x-data]')) add('Alpine.js', 'JavaScript Framework');
    if (w.preact) add('Preact', 'JavaScript Framework');
    if (elementsArray.slice(0, 500).some(el => el.className && typeof el.className === 'string' && /\bsvelte-[a-z0-9]+\b/i.test(el.className))) add('Svelte', 'JavaScript Framework');

    // backend web frameworks
    if (document.querySelector('input[name="csrfmiddlewaretoken"]')) { add('Django', 'Web Framework'); add('Python', 'Programming Language'); }
    if (document.querySelector('meta[name="csrf-param"]')) { add('Ruby on Rails', 'Web Framework'); add('Ruby', 'Programming Language'); }
    if (document.querySelector('input[name="__RequestVerificationToken"]')) add('ASP.NET', 'Web Framework');

    // javascript libraries
    const findScriptUrl = (substr) => {
      const el = document.querySelector(`script[src*="${substr}"]`);
      return el ? el.getAttribute('src') : null;
    };
    const extractVersionFromUrl = (url) => {
      if (!url) return null;
      const verParam = url.match(/[?&]ver=([\d.]+)/);
      if (verParam) return verParam[1];
      const inline = url.match(/[-.](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js/);
      return inline ? inline[1] : null;
    };

    const jqueryScriptUrl = findScriptUrl('jquery.min.js') || findScriptUrl('jquery.js');
    if (w.jQuery || (w.$ && w.$.fn) || jqueryScriptUrl) {
      const version = (w.jQuery && w.jQuery.fn && w.jQuery.fn.jquery) || extractVersionFromUrl(jqueryScriptUrl);
      add(version ? `jQuery ${version}` : 'jQuery', 'JavaScript Library');
    }
    const jqueryMigrateUrl = findScriptUrl('jquery-migrate') || findScriptUrl('jquery.migrate');
    if ((w.jQuery && w.jQuery.migrateVersion) || jqueryMigrateUrl) {
      const version = (w.jQuery && w.jQuery.migrateVersion) || extractVersionFromUrl(jqueryMigrateUrl);
      add(version ? `jQuery Migrate ${version}` : 'jQuery Migrate', 'JavaScript Library');
    }
    if (w._ && typeof w._.VERSION === 'string') add(typeof w._.zipWith === 'function' ? 'Lodash' : 'Underscore.js', 'JavaScript Library');
    if (w.moment) add('Moment.js', 'JavaScript Library');
    if (w.gsap) add('GSAP', 'JavaScript Library');
    if (w.d3) add('D3.js', 'JavaScript Library');
    if (w.THREE) add('Three.js', 'JavaScript Library');
    if (w.axios) add('Axios', 'JavaScript Library');
    if (w.Swiper || hasScript('swiper-bundle') || hasScript('swiper.min.js') || document.querySelector('.swiper-container, .swiper')) add('Swiper', 'JavaScript Library');
    if (w.Modernizr || hasScript('modernizr')) add('Modernizr', 'JavaScript Library');
    if (w.lazySizes || hasScript('lazysizes')) add('LazySizes', 'JavaScript Library');

    // css frameworks
    const classTokens = [];
    const sampleEls = elementsArray;
    for (let i = 0; i < sampleEls.length && i < 1500; i++) {
      if (sampleEls[i].classList) classTokens.push(...sampleEls[i].classList);
    }
    const tailwindPattern = /^(flex|grid|px-|py-|mx-|my-|w-|h-|text-|bg-|rounded|border-|gap-|space-x-|space-y-|justify-|items-)/;
    const tailwindMatches = classTokens.filter(c => tailwindPattern.test(c)).length;
    if (classTokens.length > 20 && tailwindMatches / classTokens.length > 0.12) add('Tailwind CSS', 'CSS Framework');
    if (classTokens.includes('container') && (classTokens.some(c => /^col-/.test(c)) || classTokens.some(c => /^btn-/.test(c)))) add('Bootstrap', 'CSS Framework');
    if (hasLink('bulma')) add('Bulma', 'CSS Framework');
    if (hasLink('foundation')) add('Foundation', 'CSS Framework');
    if (classTokens.some(c => c.startsWith('Mui'))) add('Material UI', 'UI Framework');
    if (classTokens.some(c => c.startsWith('ant-'))) add('Ant Design', 'UI Framework');
    if (document.querySelector('[data-styled]')) add('styled-components', 'JavaScript Library');

    // database
    if (w.firebase || hasScript('firebaseio.com') || hasScript('firestore.googleapis.com') || hasScript('gstatic.com/firebasejs')) add('Firebase', 'Database');
    if (w.supabase || hasScript('supabase.co') || hasScript('supabase.io')) add('Supabase', 'Database');
    if (w.faunadb || hasScript('fauna.com')) add('Fauna', 'Database');

    // search engine
    if (w.algoliasearch || hasScript('algolia.net') || hasScript('algoliasearch')) add('Algolia', 'Search Engine');

    // analytics
    if (w.ga || w.gtag || hasScript('google-analytics.com') || hasScript('googletagmanager.com/gtag')) {
      const gtagSrc = (document.querySelector('script[src*="googletagmanager.com/gtag/js"]') || {}).src || '';
      const inlineScriptText = Array.from(document.scripts).filter(s => !s.src).map(s => s.textContent).join(' ');
      const gaHay = gtagSrc + ' ' + inlineScriptText;
      if (/G-[A-Z0-9]{6,}/.test(gaHay)) add('Google Analytics (GA4)', 'Analytics');
      else if (/UA-\d+-\d+/.test(gaHay)) add('Google Analytics (Universal)', 'Analytics');
      else add('Google Analytics', 'Analytics');
    }
    if (w.fbq || hasScript('connect.facebook.net')) add('Meta Pixel', 'Analytics');
    if (w.hj || hasScript('static.hotjar.com')) add('Hotjar', 'Analytics');
    if (w.mixpanel) add('Mixpanel', 'Analytics');
    if (w.analytics && w.analytics.SNIPPET_VERSION) add('Segment', 'Analytics');
    if (w.amplitude) add('Amplitude', 'Analytics');
    if (w.clarity || hasScript('clarity.ms')) add('Microsoft Clarity', 'Analytics');
    if (w.posthog) add('PostHog', 'Analytics');
    if (w.plausible || hasScript('plausible.io')) add('Plausible', 'Analytics');
    if (hasScript('cdn.usefathom.com') || hasScript('cdn.simpleanalyticscdn.com')) add('Fathom / Simple Analytics', 'Analytics');
    if (w._paq || hasScript('matomo.js') || hasScript('piwik.js')) add('Matomo', 'Analytics');
    if ((w.s && w.s.t) || hasScript('AppMeasurement.js') || hasScript('sc.omtrdc.net') || hasScript('2o7.net')) add('Adobe Analytics', 'Analytics');
    if (w.heap || hasScript('cdn.heapanalytics.com')) add('Heap', 'Analytics');
    if (w.ym || hasScript('mc.yandex.ru')) add('Yandex Metrica', 'Analytics');
    if (w.sc_project || hasScript('statcounter.com')) add('StatCounter', 'Analytics');

    // ab testing
    if (w.optimizely || hasScript('cdn.optimizely.com')) add('Optimizely', 'A/B Testing');
    if (w.VWO || w._vwo_code || hasScript('dev.visualwebsiteoptimizer.com')) add('VWO', 'A/B Testing');
    if (w.google_optimize || hasScript('googleoptimize.com')) add('Google Optimize', 'A/B Testing');
    if (w.ABTasty || hasScript('try.abtasty.com')) add('AB Tasty', 'A/B Testing');

    // monitoring
    if (w.Sentry || hasScript('browser.sentry-cdn.com') || hasScript('js.sentry-cdn.com')) add('Sentry', 'Monitoring');
    if (w.newrelic || hasScript('js-agent.newrelic.com')) add('New Relic', 'Monitoring');
    if (w.DD_RUM || hasScript('datadoghq-browser-agent.com')) add('Datadog', 'Monitoring');
    if (w.LogRocket || hasScript('cdn.logrocket.io')) add('LogRocket', 'Monitoring');
    if (w.FS && w.FS.identify || hasScript('fullstory.com/s/fs.js')) add('FullStory', 'Monitoring');
    if (w.Bugsnag || hasScript('d2wy8f7a9ursnm.cloudfront.net')) add('Bugsnag', 'Monitoring');
    if (w.Rollbar || hasScript('cdn.rollbar.com')) add('Rollbar', 'Monitoring');

    // tag managers
    if (w.google_tag_manager || hasScript('googletagmanager.com/gtm.js')) add('Google Tag Manager', 'Tag Manager');
    if (hasScript('assets.adobedtm.com')) add('Adobe Experience Platform Launch', 'Tag Manager');
    if (w.utag || hasScript('tags.tiqcdn.com')) add('Tealium', 'Tag Manager');

    // advertising
    if (document.querySelector('ins.adsbygoogle') || hasScript('adsbygoogle.js')) add('Google AdSense', 'Advertising');
    if (hasScript('googleadservices.com')) add('Google Ads', 'Advertising');
    if (hasScript('amazon-adsystem.com')) add('Amazon Advertising', 'Advertising');
    if (hasScript('criteo.com') || hasScript('criteo.net')) add('Criteo', 'Advertising');
    if (hasScript('taboola.com')) add('Taboola', 'Advertising');
    if (hasScript('outbrain.com')) add('Outbrain', 'Advertising');

    // font scripts
    if (hasLink('fonts.googleapis.com') || hasLink('fonts.gstatic.com')) add('Google Fonts', 'Font Script');
    if (hasLink('font-awesome') || hasLink('fontawesome') || classTokens.some(c => /^fa-/.test(c))) add('Font Awesome', 'Font Script');
    if (hasLink('use.typekit.net')) add('Adobe Fonts', 'Font Script');

    // payment processors
    if (w.Stripe || hasScript('js.stripe.com')) add('Stripe', 'Payment Processor');
    if (hasScript('paypal.com/sdk/js') || hasScript('paypalobjects.com')) add('PayPal', 'Payment Processor');
    if (hasScript('squareup.com')) add('Square', 'Payment Processor');

    // live chat
    if (w.Intercom || hasScript('widget.intercom.io')) add('Intercom', 'Live Chat');
    if (w.drift || hasScript('js.driftt.com')) add('Drift', 'Live Chat');
    if (w.zE || hasScript('static.zdassets.com')) add('Zendesk', 'Live Chat');
    if (w.Tawk_API || hasScript('embed.tawk.to')) add('Tawk.to', 'Live Chat');
    if (w.$crisp || hasScript('client.crisp.chat')) add('Crisp', 'Live Chat');
    if (w._hsq || hasScript('js.hs-scripts.com') || hasScript('js.hsforms.net')) add('HubSpot', 'Marketing Automation');
    if (w.Munchkin || hasScript('munchkin.marketo.net')) add('Marketo', 'Marketing Automation');
    if (hasScript('pi.pardot.com') || hasScript('go.pardot.com')) add('Pardot', 'Marketing Automation');
    if (w.vgo || hasScript('trackcmp.net') || hasScript('activehosted.com')) add('ActiveCampaign', 'Marketing Automation');
    if (hasScript('chimpstatic.com') || hasScript('list-manage.com')) add('Mailchimp', 'Marketing Automation');
    if (w.klaviyo || w._klOnsite || hasScript('static.klaviyo.com')) add('Klaviyo', 'Marketing Automation');

    // cookie consent
    if (w.OnetrustActiveGroups !== undefined || hasScript('cdn.cookielaw.org') || document.getElementById('onetrust-consent-sdk')) add('OneTrust', 'Cookie Consent');
    if (w.Cookiebot || hasScript('consent.cookiebot.com')) add('Cookiebot', 'Cookie Consent');
    if (w.truste || hasScript('consent.trustarc.com')) add('TrustArc', 'Cookie Consent');
    if (w.Osano || hasScript('cmp.osano.com')) add('Osano', 'Cookie Consent');
    if (w.Didomi || hasScript('sdk.privacy-center.org')) add('Didomi', 'Cookie Consent');

    // widgets
    if (w.DISQUS || hasScript('disqus.com/embed.js') || document.getElementById('disqus_thread')) add('Disqus', 'Widgets');
    if (document.querySelector('.fb-comments, div[class*="fb-comments"]')) add('Facebook Comments', 'Widgets');
    if (w.addthis || hasScript('addthis.com')) add('AddThis', 'Widgets');
    if (w.__sharethis__ || hasScript('sharethis.com')) add('ShareThis', 'Widgets');

    // maps
    if (hasScript('maps.googleapis.com') || hasScript('maps.google.com')) add('Google Maps', 'Maps');
    if (w.mapboxgl || hasScript('api.mapbox.com')) add('Mapbox', 'Maps');
    if (w.L && w.L.map) add('Leaflet', 'Maps');

    // video players
    if (document.querySelector('iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com"]')) add('YouTube', 'Video Player');
    if (document.querySelector('iframe[src*="player.vimeo.com"]')) add('Vimeo', 'Video Player');
    if (w.Wistia || hasScript('fast.wistia.com')) add('Wistia', 'Video Player');

    // security
    if (w.grecaptcha || hasScript('google.com/recaptcha')) add('reCAPTCHA', 'Security');
    if (w.hcaptcha || hasScript('hcaptcha.com')) add('hCaptcha', 'Security');
    if (w.turnstile || hasScript('challenges.cloudflare.com/turnstile')) add('Cloudflare Turnstile', 'Security');

    // miscellaneous
    if (document.querySelector('meta[property^="og:"]')) add('Open Graph', 'Miscellaneous');
    if (document.querySelector('meta[name^="twitter:"]')) add('Twitter Cards', 'Miscellaneous');
    if (document.querySelector('link[rel="manifest"]')) add('PWA', 'Miscellaneous');
    if (navigator.serviceWorker && navigator.serviceWorker.controller) add('Service Worker', 'Miscellaneous');
    if (document.documentElement.hasAttribute('amp') || document.documentElement.hasAttribute('⚡')) add('AMP', 'Miscellaneous');
    if (document.querySelector('link[type="application/rss+xml"], link[type="application/atom+xml"]')) add('RSS', 'Miscellaneous');

    if (document.querySelector('[fetchpriority]')) add('Priority Hints', 'Performance');

    // performance
    try {
      const navEntry = performance.getEntriesByType('navigation')[0];
      if (navEntry && navEntry.nextHopProtocol === 'h3') add('HTTP/3', 'Performance');
      else if (navEntry && navEntry.nextHopProtocol === 'h2') add('HTTP/2', 'Performance');
    } catch (e) { }

    // inferred technologies
    const hasConfirmed = (label) => {
      for (const n of seenNames) {
        if (n === label || n.startsWith(label + ' ')) return true;
      }
      return false;
    };
    const INFERENCE_RULES = [
      { impliedBy: ['WordPress', 'Elementor', 'Yoast SEO', 'WooCommerce'], name: 'PHP', category: 'Programming Language' },
      { impliedBy: ['WordPress', 'WooCommerce'], name: 'MySQL', category: 'Database' },
      { impliedBy: ['Drupal'], name: 'PHP', category: 'Programming Language' },
      { impliedBy: ['Drupal'], name: 'MySQL', category: 'Database' },
      { impliedBy: ['Joomla'], name: 'PHP', category: 'Programming Language' },
      { impliedBy: ['Joomla'], name: 'MySQL', category: 'Database' },
      { impliedBy: ['Magento'], name: 'PHP', category: 'Programming Language' },
      { impliedBy: ['Magento'], name: 'MySQL', category: 'Database' },
      { impliedBy: ['PrestaShop'], name: 'PHP', category: 'Programming Language' },
      { impliedBy: ['PrestaShop'], name: 'MySQL', category: 'Database' },
      { impliedBy: ['Ghost'], name: 'Node.js', category: 'Programming Language' },
      { impliedBy: ['Next.js', 'Nuxt.js', 'Gatsby'], name: 'Node.js', category: 'Programming Language' }
    ];
    INFERENCE_RULES.forEach(rule => {
      if (hasConfirmed(rule.name)) return;
      if (rule.impliedBy.some(dep => hasConfirmed(dep))) add(`${rule.name} (likely)`, rule.category);
    });

    return found;
  }
  const techStack = detectTechStack();
  const scriptUrls = Array.from(document.querySelectorAll('script[src]'))
    .map(s => s.src)
    .filter(src => src && !src.startsWith('data:'))
    .slice(0, 25);

  // trust signal audit
  function detectTrustSignals() {
    const keywords = ['ssl', 'secure', 'verified', 'certified', 'guarantee', 'norton', 'mcafee', 'bbb', 'trustpilot', 'trusted', 'accredited'];
    let trustBadgeCount = 0;
    const matchedKeywords = new Set();
    const imgs = document.querySelectorAll('img[alt], img[src]');
    for (let i = 0; i < imgs.length && i < 800; i++) {
      const img = imgs[i];
      const hay = `${img.alt || ''} ${img.src || ''}`.toLowerCase();
      const matchedForThisImage = keywords.filter(k => hay.includes(k));
      if (matchedForThisImage.length) {
        trustBadgeCount++;
        matchedForThisImage.forEach(k => matchedKeywords.add(k));
      }
    }
    const testimonialSectionFound = !!document.querySelector('[class*="testimonial" i], [id*="testimonial" i], [class*="review" i], [id*="review" i]');
    const reviewSchemaFound = structuredDataTypes.has('Review') || structuredDataTypes.has('AggregateRating');
    return {
      trustBadgeCount,
      matchedKeywords: Array.from(matchedKeywords).slice(0, 8),
      testimonialSectionFound,
      reviewSchemaFound
    };
  }
  const trustSignals = detectTrustSignals();

  const faviconLink = document.querySelector('link[rel~="icon"]');
  const faviconUrl = faviconLink && faviconLink.href ? faviconLink.href : (location.origin + '/favicon.ico');

  // seo fundamentals
  const robotsContent = getMetaContent(['meta[name="robots"]']);
  const robots = {
    raw: robotsContent,
    noindex: robotsContent ? /noindex/i.test(robotsContent) : false,
    nofollow: robotsContent ? /nofollow/i.test(robotsContent) : false
  };

  const hreflangLinks = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map(l => ({
    lang: l.getAttribute('hreflang'),
    href: l.href
  }));

  const h1Count = headings.filter(h => h.tag === 'h1').length;

  let canonicalMismatch = false;
  if (canonicalElement && canonicalElement.href) {
    try {
      const canonicalUrl = new URL(canonicalElement.href);
      const currentUrl = new URL(location.href);
      const normalizePath = (p) => p.replace(/\/$/, '') || '/';
      canonicalMismatch = canonicalUrl.hostname !== currentUrl.hostname ||
        normalizePath(canonicalUrl.pathname) !== normalizePath(currentUrl.pathname);
    } catch (e) { }
  }

  function findStructuredDataDate(key) {
    let found = null;
    function walk(node) {
      if (found || !node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== 'object') return;
      if (typeof node[key] === 'string' && node[key]) {
        found = node[key];
        return;
      }
      if (node['@graph']) walk(node['@graph']);
    }
    structuredDataBlocks.forEach(b => walk(b.parsed));
    return found;
  }

  const seo = {
    robots,
    ogType: getMetaContent(['meta[property="og:type"]']),
    ogUrl: getMetaContent(['meta[property="og:url"]']),
    ogSiteName: getMetaContent(['meta[property="og:site_name"]']),
    ogLocale: getMetaContent(['meta[property="og:locale"]']),
    twitterCard: getMetaContent(['meta[name="twitter:card"]']),
    hreflang: hreflangLinks,
    articlePublished: getMetaContent([
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[itemprop="datePublished"]',
      'meta[name="publish-date"]',
      'meta[name="publishdate"]',
      'meta[name="date"]',
      'meta[name="sailthru.date"]',
      'meta[name="parsely-pub-date"]'
    ]) || findStructuredDataDate('datePublished'),
    articleModified: getMetaContent([
      'meta[property="article:modified_time"]',
      'meta[name="article:modified_time"]',
      'meta[itemprop="dateModified"]',
      'meta[property="og:updated_time"]',
      'meta[name="last-modified"]'
    ]) || findStructuredDataDate('dateModified'),
    author: getMetaContent(['meta[name="author"]']),
    generator: getMetaContent(['meta[name="generator"]']),
    hasViewport: !!document.querySelector('meta[name="viewport"]'),
    charset: document.characterSet || null,
    h1Count,
    canonicalMismatch
  };

  // font stylesheets
  const ALLOWED_FONT_HOSTS = ['fonts.googleapis.com', 'fonts.bunny.net', 'typekit.net'];
  function isAllowedFontHost(hostname) {
    return ALLOWED_FONT_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
  }

  const fontStyles = [];
  try {
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      if (!link.href) return;
      let hostname;
      try { hostname = new URL(link.href, document.baseURI).hostname; } catch (e) { return; }
      if (isAllowedFontHost(hostname)) {
        let cleanHref = link.href.replace(/,+(&|$)/g, '$1');
        fontStyles.push({ type: 'link', href: cleanHref });
      }
    });
    for (let sheet of document.styleSheets) {
      try {
        for (let rule of sheet.cssRules) {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            let cssText = rule.cssText;
            cssText = cssText.replace(/url\(['"]?(.*?)['"]?\)/g, (match, url) => {
              if (url.startsWith('data:')) return match;
              try {
                return `url('${new URL(url, document.baseURI).href}')`;
              } catch (e) {
                return match;
              }
            });
            fontStyles.push({ type: 'style', cssText: cssText });
          }
        }
      } catch (e) { }
    }
  } catch (e) { }

  return {
    fonts: Array.from(fonts).slice(0, 15),
    fontStyles: fontStyles,
    fontSizes: sortedSizes.slice(0, 20),
    colors: processedColors.slice(0, 24),
    bgColors: processedBgColors.slice(0, 24),
    hoverColors: hoverColorsProcessed.slice(0, 12),
    hoverBgColors: hoverBgColorsProcessed.slice(0, 12),
    gradients: Array.from(gradients).slice(0, 20),
    images: Array.from(imageUrls).filter(u => !isLikelyTrackingPixel(u)),
    outline: headings,
    links: links.slice(0, 1000),
    structuredData: {
      blocks: structuredDataBlocks.slice(0, 10),
      types: Array.from(structuredDataTypes)
    },
    accessibility: accessibility,
    darkPatterns: darkPatterns,
    performance: perfSnapshot,
    designTokens: designTokens,
    brokenImagesCount: brokenImages.length,
    meta: {
      title: document.title,
      description: metaDescElement ? metaDescElement.content : null,
      canonical: canonicalElement ? canonicalElement.href : null,
      pageUrl: location.href,
      language: document.documentElement.lang || 'Not specified',
      wordCount: wordCount
    },
    socialMeta: socialMeta,
    mediaContact: mediaContact,
    webVitals: webVitals,
    llmSignals: llmSignals,
    seo: seo,
    techStack: techStack,
    scriptUrls: scriptUrls,
    trustSignals: trustSignals,
    faviconUrl: faviconUrl
  };
})();

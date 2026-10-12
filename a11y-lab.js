/* a11y-lab.js — the Accessibility lab.
 *
 * Static checks list what is wrong in the markup. These tests behave like a person: they walk the
 * keyboard path, move focus to every control, compare reading order with what is on screen, read the page
 * the way a screen reader does, stress the layout with the WCAG text-spacing rules and zoom in.
 *
 * The measuring happens in the page (content_insights.js). This file runs the tests, remembers the latest
 * result for the current scan, draws the screen, and turns results into audit checks.
 */

const LAB = { tab: null, focus: null, reading: null, tree: null, spacing: null, reflow: null, busy: '', treeAll: false, zoom: 0, overlay: '' };

function labReset() {
  LAB.tab = LAB.focus = LAB.reading = LAB.tree = LAB.spacing = LAB.reflow = null;
  LAB.busy = ''; LAB.overlay = ''; LAB.zoom = 0;
}

/* ------------------------------------------------------------------ checks */
function labShow(sel, lbl) { return insShowAction(sel, lbl); }
function labOpen(label) { return insOpenAction('a11ylab', label || 'Open accessibility lab'); }

// From the scan itself: names and ARIA
function labScanChecks(d) {
  const ins = d.insights;
  if (!ins) return [];
  const out = [];
  if (ins.names) {
    const missing = ins.names.filter(n => n.kind === 'missing');
    const vague = ins.names.filter(n => n.kind === 'vague');
    out.push({
      label: 'Buttons, links and fields have accessible names', pass: missing.length === 0, sev: 'High',
      t: 'Give every control an accessible name',
      line: `${insPlural(missing.length, 'control has', 'controls have')} no name a screen reader can announce (${missing.slice(0, 3).map(m => m.role || m.tag).join(', ')}).`,
      mean: 'A button announced only as “button” cannot be used by someone who cannot see it. Icon-only buttons are the usual cause.',
      fix: 'Add visible text, an aria-label, or a <label> connected to the field.',
      tag: '<button aria-label="Close dialog"><svg aria-hidden="true">…</svg></button>',
      actions: [missing[0] ? labShow(missing[0].selector, 'No name') : null, labOpen()]
    });
    if (vague.length) {
      out.push({
        label: 'Link text says where the link goes', pass: false, sev: 'Medium',
        t: 'Replace vague link text',
        line: `${insPlural(vague.length, 'link')} read “${vague[0].label}” or similar, which means nothing out of context.`,
        mean: 'Screen reader users often jump through a list of links. “Click here” repeated ten times is useless in that list.',
        fix: 'Describe the destination: “Download the 2024 report” instead of “Click here”.',
        actions: [labShow(vague[0].selector, 'Vague link')]
      });
    }
  }
  if (ins.aria) {
    const bad = ins.aria.issues.filter(i => i.sev !== 'Low');
    const first = bad[0];
    out.push({
      label: 'ARIA roles and references are valid', pass: bad.length === 0, sev: bad.some(i => i.sev === 'High') ? 'High' : 'Medium',
      t: 'Fix invalid ARIA',
      line: `${insPlural(bad.length, 'ARIA problem')}${first ? `. First: ${first.detail}` : ''}.`,
      mean: 'Broken ARIA is worse than none: it makes assistive technology announce things that are wrong, or hides content from it.',
      fix: 'Use real HTML elements where you can. Where you use ARIA, check the role is valid, its required attributes are present and every referenced id exists.',
      actions: [first ? labShow(first.selector, 'ARIA problem') : null, labOpen()]
    });
  }
  return out;
}

// From tests the person has run on this scan
function labRunChecks() {
  const out = [];
  if (LAB.focus && !LAB.focus.error) {
    const f = LAB.focus;
    out.push({
      label: 'Keyboard focus is always visible', pass: f.failed === 0, sev: 'High',
      t: 'Show where keyboard focus is',
      line: `${insPlural(f.failed, 'control')} of ${f.tested} show nothing when focused.`,
      mean: 'People who use the keyboard cannot tell where they are on the page when the focus ring is removed.',
      fix: 'Never remove the outline without a clear replacement. A 2px outline with offset works everywhere.',
      tag: ':focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }',
      actions: [f.items[0] ? labShow(f.items[0].selector, 'No focus style') : null, labOpen()]
    });
  }
  if (LAB.tab && !LAB.tab.error) {
    const t = LAB.tab;
    out.push({
      label: 'Tab order follows the layout', pass: t.backJumps === 0 && t.positive === 0, sev: 'Medium',
      t: 'Fix the keyboard tab order',
      line: `${t.count} stops${t.backJumps ? `, ${insPlural(t.backJumps, 'backward jump')}` : ''}${t.positive ? `, ${insPlural(t.positive, 'positive tabindex value')}` : ''}.`,
      mean: 'When Tab jumps around the page, keyboard users lose their place and screen reader users hear content out of order.',
      fix: 'Remove positive tabindex values and reorder the HTML so the order in the code matches the order on screen.',
      actions: [labOpen()]
    });
  }
  if (LAB.reading && !LAB.reading.error) {
    const r = LAB.reading;
    out.push({
      label: 'Reading order matches the visual order', pass: r.jumps === 0, sev: 'Medium',
      t: 'Match the code order to the visual order',
      line: `${insPlural(r.jumps, 'place')} where the code order and the screen order disagree${r.reversed ? `; ${insPlural(r.reversed, 'row')} use a reversed flex direction` : ''}.`,
      mean: 'Screen readers follow the code, not the screen. CSS grid and flex order can show one sequence while announcing another.',
      fix: 'Reorder the HTML instead of using order, row-reverse or grid placement to rearrange content.',
      actions: [r.found[0] ? labShow(r.found[0].to.selector, 'Out of order') : null, labOpen()]
    });
  }
  if (LAB.spacing && LAB.spacing.applied && !LAB.spacing.error) {
    const s = LAB.spacing;
    out.push({
      label: 'Layout survives increased text spacing', pass: s.clipped === 0 && !s.pageOverflowX, sev: 'Medium',
      t: 'Stop text clipping when spacing grows',
      line: `${insPlural(s.clipped, 'element')} cut off text when line, word and letter spacing increase${s.pageOverflowX ? '; the page also scrolls sideways' : ''}.`,
      mean: 'People with dyslexia or low vision override text spacing. Fixed-height boxes then hide their words.',
      fix: 'Use min-height instead of height on text containers and let them grow.',
      actions: [s.items[0] ? labShow(s.items[0].selector, 'Clipped') : null, labOpen()]
    });
  }
  if (LAB.reflow && !LAB.reflow.error) {
    const r = LAB.reflow;
    out.push({
      label: 'Content reflows at high zoom', pass: !r.overflowX, sev: 'Medium',
      t: 'Make the page reflow when zoomed',
      line: `At ${Math.round(r.zoom * 100)}% zoom the viewport is ${r.width}px wide and the page ${r.overflowX ? `scrolls sideways (${r.scrollWidth}px)` : 'fits'}.`,
      mean: 'People with low vision zoom in. Content that needs sideways scrolling at 320px wide is very hard to read.',
      fix: 'Use flexible widths, wrap long content and avoid fixed-width containers.',
      actions: [r.items[0] ? labShow(r.items[0].selector, 'Too wide') : null, labOpen()]
    });
  }
  return out;
}

function labChecks(d) { return labScanChecks(d).concat(labRunChecks()); }

/* ------------------------------------------------------------------ running tests */
function labCall(key, msg, done) {
  if (!lastActiveTabId) { showToast('No page to test'); return; }
  LAB.busy = key; shRender();
  // a page that never answers (navigated away, still loading) must not leave the card stuck on "Running…"
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; if (LAB.busy === key) { LAB.busy = ''; showToast('The page did not answer. Rescan and try again.'); shRender(); } }, 20000);
  chrome.tabs.sendMessage(lastActiveTabId, msg, (res) => {
    clearTimeout(timer);
    if (timedOut) return;
    LAB.busy = '';
    if (chrome.runtime.lastError || !res) { showToast('Could not reach the page. Rescan and try again.'); shRender(); return; }
    done(res);
    shRender();
  });
}

function labZoom(factor) {
  if (!lastActiveTabId) return;
  chrome.tabs.setZoom(lastActiveTabId, factor, () => {
    if (chrome.runtime.lastError) { showToast('Could not change the zoom'); return; }
    LAB.zoom = factor;
    if (!factor) { LAB.reflow = null; shRender(); return; }
    LAB.busy = 'reflow'; shRender();
    setTimeout(() => {
      chrome.tabs.sendMessage(lastActiveTabId, { action: 'a11y-reflow' }, (res) => {
        LAB.busy = '';
        if (chrome.runtime.lastError || !res) { showToast('Could not measure the page'); shRender(); return; }
        LAB.reflow = Object.assign({ zoom: factor }, res);
        shRender();
      });
    }, 700);
  });
}

function labHandle(op, el) {
  const ds = el.dataset || {};
  switch (op) {
    case 'tab': labCall('tab', { action: 'a11y-taborder' }, (r) => { LAB.tab = r; LAB.overlay = 'Tab order'; }); break;
    case 'focus': labCall('focus', { action: 'a11y-focus' }, (r) => { LAB.focus = r; LAB.overlay = 'Focus check'; }); break;
    case 'reading': labCall('reading', { action: 'a11y-reading' }, (r) => { LAB.reading = r; LAB.overlay = 'Reading order'; }); break;
    case 'tree': labCall('tree', { action: 'a11y-tree' }, (r) => { LAB.tree = r; }); break;
    case 'spacing-on': labCall('spacing', { action: 'a11y-spacing', on: true }, (r) => { LAB.spacing = r; LAB.overlay = 'Text spacing'; }); break;
    case 'spacing-off': insSend({ action: 'a11y-spacing', on: false }); LAB.spacing = null; LAB.overlay = ''; shRender(); break;
    case 'zoom': labZoom(parseFloat(ds.z)); break;
    case 'tree-filter': LAB.treeAll = !LAB.treeAll; shRender(); break;
    case 'clear': {
      // Clear removes the markers from the page and closes that test's results, so the card shrinks back
      insSend({ action: 'insight-clear' });
      const k = ds.k;
      if (k === 'tab') LAB.tab = null;
      else if (k === 'focus') LAB.focus = null;
      else if (k === 'reading') LAB.reading = null;
      else if (k === 'tree') LAB.tree = null;
      LAB.overlay = '';
      shRender();
      break;
    }
  }
}

// Called by Reset all: undo everything the lab changed on the page
function labResetPage() {
  if (!lastActiveTabId) return;
  if (LAB.spacing && LAB.spacing.applied) chrome.tabs.sendMessage(lastActiveTabId, { action: 'a11y-spacing', on: false }, () => void chrome.runtime.lastError);
  chrome.tabs.sendMessage(lastActiveTabId, { action: 'insight-clear' }, () => void chrome.runtime.lastError);
  if (LAB.zoom) chrome.tabs.setZoom(lastActiveTabId, 0, () => void chrome.runtime.lastError);
  LAB.spacing = null; LAB.zoom = 0; LAB.reflow = null; LAB.overlay = '';
}

function labLiveItems() {
  const out = [];
  if (LAB.overlay) out.push(LAB.overlay);
  if (LAB.zoom) out.push('Zoom ' + Math.round(LAB.zoom * 100) + '%');
  return out;
}

/* ------------------------------------------------------------------ screen */
function labCard(key, icon, title, desc, buttons, body) {
  const busy = LAB.busy === key;
  return `<section class="sh-card lab-card"><div class="lab-head"><span class="sh-ico a">${shIcon(icon, 16)}</span><span class="lab-t"><b>${title}</b><small>${desc}</small></span></div>
    <div class="sh-btns lab-btns">${busy ? '<span class="lab-busy">Running…</span>' : buttons}</div>${body && !busy ? `<div class="lab-body">${body}</div>` : ''}</section>`;
}
function labBtn(label, op, attrs, cls) { return insBtn(label, op, attrs, cls).replace('data-sh="ins"', 'data-sh="lab"'); }
function labStat(ok, text) { return `<div class="lab-stat ${ok ? 'ok' : 'bad'}"><span class="lab-si">${shIcon(ok ? 'check' : 'alert', 13)}</span><span class="lab-stx">${text}</span></div>`; }
function labJump(sel, lbl) { return sel ? `<button type="button" class="ins-go" data-sh="ins" data-v="show" data-sel="${shEsc(sel)}" data-lbl="${shEsc(lbl || '')}" title="Show on page" aria-label="Show on page">${shIcon('target', 14)}</button>` : ''; }

function labTabBody() {
  const t = LAB.tab;
  if (!t) return '';
  if (t.error) return `<p class="ins-note">${shEsc(t.error)}</p>`;
  let h = labStat(!t.backJumps && !t.positive, `${insPlural(t.count, 'stop')} in the tab order${t.backJumps ? `, <b>${insPlural(t.backJumps, 'backward jump')}</b> (dashed red on the page)` : ''}${t.positive ? `, <b>${insPlural(t.positive, 'positive tabindex')}</b>` : ''}`);
  h += `<div class="lab-list">${t.items.slice(0, 40).map(i => `<div class="lab-item${i.jump ? ' jump' : ''}"><span class="lab-n">${i.n}</span><span class="lab-tx"><b>${shEsc(i.name || '(no name)')}</b><small>${shEsc(i.role || i.tag)}</small></span>${labJump(i.selector, '#' + i.n)}</div>`).join('')}</div>`;
  if (t.items.length > 40) h += `<p class="ins-note">First 40 of ${t.count} shown; all are numbered on the page.</p>`;
  return h;
}

function labFocusBody() {
  const f = LAB.focus;
  if (!f) return '';
  if (f.error) return `<p class="ins-note">${shEsc(f.error)}</p>`;
  let h = labStat(f.failed === 0, `${f.passed} of ${f.tested} controls show a visible change when focused${f.failed ? `, <b>${f.failed} show nothing</b>` : ''}`);
  if (f.items.length) h += `<div class="lab-list">${f.items.map(i => `<div class="lab-item jump"><span class="lab-n">!</span><span class="lab-tx"><b>${shEsc(i.name || '(no name)')}</b><small>${shEsc(i.role || i.tag)}${i.notFocusable ? ' · could not be focused' : ''}</small></span>${labJump(i.selector, 'No focus style')}</div>`).join('')}</div>`;
  return h;
}

function labReadingBody() {
  const r = LAB.reading;
  if (!r) return '';
  if (r.error) return `<p class="ins-note">${shEsc(r.error)}</p>`;
  let h = labStat(r.jumps === 0, `${r.jumps ? `<b>${insPlural(r.jumps, 'place')}</b> where code order and screen order disagree` : `Code order matches the screen across ${r.items} items`}`);
  if (r.reordered || r.reversed) h += `<p class="ins-note">${r.reordered ? `${r.reordered === 1 ? '1 element uses' : r.reordered + ' elements use'} CSS <b>order</b>. ` : ''}${r.reversed ? `${r.reversed === 1 ? '1 container uses' : r.reversed + ' containers use'} a reversed flex direction.` : ''}</p>`;
  if (r.found.length) h += `<div class="lab-list">${r.found.map(f => `<div class="lab-item jump"><span class="lab-n">${f.to.n}</span><span class="lab-tx"><b>“${shEsc(f.from.label)}” then “${shEsc(f.to.label)}”</b><small>${f.kind === 'up' ? 'The next item is higher up the page' : 'The next item is to the left on the same row'}</small></span>${labJump(f.to.selector, 'Out of order')}</div>`).join('')}</div>`;
  return h;
}

function labTreeBody() {
  const t = LAB.tree;
  if (!t) return '';
  if (t.error) return `<p class="ins-note">${shEsc(t.error)}</p>`;
  const s = t.summary;
  let h = labStat(s.issues === 0, `${s.nodes} items announced, ${s.landmarks} landmarks${s.issues ? `, <b>${insPlural(s.issues, 'problem')}</b>` : ''}`);
  const rows = (LAB.treeAll || !s.issues ? t.nodes : t.nodes.filter(n => n.issues.length)).slice(0, 160);
  h += `<div class="sh-btns lab-btns" style="margin-top:6px">${s.issues ? labBtn(LAB.treeAll ? 'Show problems only' : 'Show the whole tree', 'tree-filter') : ''}</div>`;
  h += `<div class="lab-tree">${rows.map(n => {
    const ind = LAB.treeAll ? Math.min(n.depth, 6) * 12 : 0;
    const name = n.name ? `“${shEsc(n.name)}”` : '<em class="lab-noname">no name</em>';
    const lvl = n.level ? ` <span class="lab-st">level ${n.level}</span>` : '';
    return `<div class="lab-node${n.issues.length ? ' bad' : ''}" style="padding-left:${10 + ind}px"><span class="lab-role">${shEsc(n.role)}</span><span class="lab-name">${name}${lvl}${n.states.map(x => ` <span class="lab-st">${shEsc(x)}</span>`).join('')}${n.issues.map(i => ` <span class="ins-chip ${i.sev === 'High' ? 'bad' : 'warn'}">${shEsc(i.t)}</span>`).join('')}</span>${labJump(n.selector, n.role)}</div>`;
  }).join('')}</div>`;
  if (t.truncated) h += '<p class="ins-note">Large page: only the first 500 items were read.</p>';
  return h;
}

function labSpacingBody() {
  const s = LAB.spacing;
  if (!s) return '';
  if (s.error) return `<p class="ins-note">${shEsc(s.error)}</p>`;
  let h = labStat(s.clipped === 0 && !s.pageOverflowX, s.clipped ? `<b>${insPlural(s.clipped, 'element')} clip their text</b> with the WCAG spacing applied` : 'No text was clipped with the WCAG spacing applied') +
    (s.pageOverflowX ? labStat(false, 'The page now scrolls sideways') : '');
  if (s.items.length) h += `<div class="lab-list">${s.items.map(i => `<div class="lab-item jump"><span class="lab-n">!</span><span class="lab-tx"><b>${shEsc(i.label)}</b><small>${i.over}px of ${i.axis} hidden</small></span>${labJump(i.selector, 'Clipped')}</div>`).join('')}</div>`;
  h += '<p class="ins-note">Applied: line height 1.5, paragraph spacing 2×, letter spacing 0.12em, word spacing 0.16em. Press Restore to undo.</p>';
  return h;
}

function labReflowBody() {
  const r = LAB.reflow;
  if (!r) return '';
  let h = labStat(!r.overflowX, `At ${Math.round(r.zoom * 100)}% the viewport is <b>${r.width}px</b> wide; ${r.overflowX ? `the page needs <b>${r.scrollWidth}px</b>, so it scrolls sideways` : 'the page fits without sideways scrolling'}`);
  if (r.items.length) h += `<div class="lab-list">${r.items.map(i => `<div class="lab-item jump"><span class="lab-n">!</span><span class="lab-tx"><b>${shEsc(i.label)}</b><small>${i.over}px too wide</small></span>${labJump(i.selector, 'Too wide')}</div>`).join('')}</div>`;
  h += '<p class="ins-note">WCAG asks for no sideways scrolling at 320px wide, which is a 1280px window at 400%. Press Reset zoom when you are done.</p>';
  return h;
}

function labAriaBody(d) {
  const a = d.insights && d.insights.aria;
  if (!a) return '';
  const labels = { 'invalid-role': 'Invalid role', 'missing-required': 'Missing required attribute', 'missing-reference': 'Points to a missing id', 'unknown-attribute': 'Unknown ARIA attribute', 'duplicate-id': 'Duplicate id', 'hidden-focusable': 'Hidden but focusable' };
  if (!a.issues.length) return labStat(true, `No ARIA problems found in ${insPlural(a.checked, 'element')}`);
  return labStat(false, `<b>${insPlural(a.issues.length, 'ARIA problem')}</b> in ${insPlural(a.checked, 'element')} that use ARIA`) +
    `<div class="lab-list">${a.issues.slice(0, 25).map(i => `<div class="lab-item jump"><span class="lab-n">${i.sev === 'High' ? '!' : '·'}</span><span class="lab-tx"><b>${shEsc(labels[i.type] || i.type)}</b><small>${shEsc(i.detail)}</small></span>${labJump(i.selector, 'ARIA')}</div>`).join('')}</div>`;
}

function labScreen(A) {
  const d = A.data, ins = d.insights || {};
  const missing = (ins.names || []).filter(n => n.kind === 'missing').length;
  let h = insTiles([['Unnamed controls', missing, missing ? 'bad' : 'ok'], ['ARIA problems', ins.aria ? ins.aria.issues.length : '—', ins.aria && ins.aria.issues.length ? 'warn' : 'ok'], ['Landmarks', LAB.tree ? LAB.tree.summary.landmarks : '—']]);
  h += `<p class="ins-note">These tests run on the live page and show their results on it. They change nothing permanently. Results join the Accessibility audit once you run them.</p>`;
  const on = (k) => LAB[k] ? ' ' : '';
  h += labCard('tab', 'rows', 'Keyboard tab order', 'Numbers every Tab stop and joins them with a path. A path that zigzags is a problem.',
    labBtn(LAB.tab ? 'Run again' : 'Show tab order', 'tab', {}, 'pri') + (LAB.tab ? labBtn('Clear', 'clear', { k: 'tab' }) : ''), labTabBody());
  h += labCard('focus', 'target', 'Focus visibility', 'Moves focus to every control and checks that something visibly changes.',
    labBtn(LAB.focus ? 'Run again' : 'Test focus', 'focus', {}, 'pri') + (LAB.focus ? labBtn('Clear', 'clear', { k: 'focus' }) : ''), labFocusBody());
  h += labCard('reading', 'book', 'Reading order', 'Compares the order in the code, which screen readers follow, with the order on screen.',
    labBtn(LAB.reading ? 'Run again' : 'Check order', 'reading', {}, 'pri') + (LAB.reading ? labBtn('Clear', 'clear', { k: 'reading' }) : ''), labReadingBody());
  h += labCard('tree', 'layers', 'Accessibility tree', 'What a screen reader announces: role and name for every landmark, heading, link, button and field.',
    labBtn(LAB.tree ? 'Read again' : 'Read the page', 'tree', {}, 'pri') + (LAB.tree ? labBtn('Clear', 'clear', { k: 'tree' }) : ''), labTreeBody());
  h += labCard('spacing', 'type', 'Text spacing', 'Applies the WCAG 1.4.12 spacing overrides and flags text that gets cut off.',
    (LAB.spacing && LAB.spacing.applied ? labBtn('Restore page', 'spacing-off', {}, 'pri') + labBtn('Run again', 'spacing-on') : labBtn('Apply spacing', 'spacing-on', {}, 'pri')), labSpacingBody());
  h += labCard('reflow', 'phone', 'Zoom and reflow', 'Zooms the tab and checks that content reflows instead of scrolling sideways.',
    labBtn('200%', 'zoom', { z: 2 }, LAB.zoom === 2 ? 'pri' : '') + labBtn('400%', 'zoom', { z: 4 }, LAB.zoom === 4 ? 'pri' : '') + (LAB.zoom ? labBtn('Reset zoom', 'zoom', { z: 0 }) : ''), labReflowBody());
  h += `<div class="sh-sec"><span>ARIA validity <em>from the scan</em></span></div><div class="sh-card lab-card"><div class="lab-body" style="border-top:0;margin-top:0">${labAriaBody(d)}</div></div>`;
  return h;
}

/* ------------------------------------------------------------------ registration */
SH_SCREENS.a11ylab = { title: 'Accessibility lab', build: labScreen };
SH_CATS.filter(c => c.id === 'a11y')[0].explore = [['a11ylab', 'Accessibility lab', 'Keyboard, focus and screen-reader tests', 'a11y']];
SH_TOOLS.Page.push(['a11ylab', 'Accessibility lab', 'a11y']);
SH_TOOL_META.a11ylab = 'Keyboard, focus, screen reader';
SH_TOOL_KEYWORDS.a11ylab = 'accessibility a11y keyboard tab order focus screen reader aria zoom reflow text spacing wcag';

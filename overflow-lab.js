/* overflow-lab.js — finds what makes a page scroll sideways, and at which screen widths.
 *
 * The page is opened in a temporary popup window (the same kind the Responsive tool uses), resized to each
 * chosen width, and measured with content_overflow.js. The popup is closed afterwards. For each width the
 * script reports whether the page scrolls sideways and which element introduces the overflow: the one that
 * sticks out while its parent still fits. Culprits are merged across widths with a suggested CSS fix.
 *
 * A "this window" check measures the open tab at its current width, with no popup.
 */

const OVF_PRESETS = [320, 360, 375, 414, 480, 600, 768, 1024, 1280, 1440, 1920];
const OVF_HEIGHT = 900;
const OVF = { widths: [320, 375, 768, 1024, 1280, 1440], phase: 'idle', results: [], current: 0, cancel: false, at: 0, error: '', url: '', here: null, note: '', custom: '' };

let ovfRunId = 0;   // a rescan or another page invalidates a run still in flight
function ovfReset() {
  ovfRunId++;
  Object.assign(OVF,{ phase: 'idle', results: [], current: 0, cancel: false, at: 0, error: '', url: '', here: null, note: '' });
}

/* ------------------------------------------------------------------ measuring */
function ovfInject(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content_overflow.js'] }, (res) => {
      if (chrome.runtime.lastError || !res || !res[0]) resolve(null); else resolve(res[0].result || null);
    });
  });
}

const ovfWait = (ms) => new Promise(r => setTimeout(r, ms));
const ovfWin = (o) => new Promise((resolve) => chrome.windows.create(o, (w) => resolve(chrome.runtime.lastError ? null : w)));
const ovfUpdate = (id, o) => new Promise((resolve) => chrome.windows.update(id, o, () => resolve(!chrome.runtime.lastError)));
const ovfTabUrl = (id) => new Promise((resolve) => chrome.tabs.get(id, (t) => resolve(chrome.runtime.lastError || !t ? '' : (t.url || ''))));

async function ovfHere() {
  if (!lastActiveTabId) return;
  const r = await ovfInject(lastActiveTabId);
  if (!r) { showToast('Could not measure this page. Rescan and try again.'); return; }
  OVF.here = r;
  shRender();
}

async function ovfRun() {
  if (OVF.phase === 'running' || !lastActiveTabId) return;
  const url = await ovfTabUrl(lastActiveTabId);
  if (!/^https?:/i.test(url)) { OVF.error = 'Only web pages can be tested.'; shRender(); return; }
  const widths = OVF.widths.slice().sort((a, b) => a - b);
  const id = ++ovfRunId;
  Object.assign(OVF, { phase: 'running', results: [], current: 0, cancel: false, error: '', note: '', url: url });
  shRender();

  let off = typeof RESPONSIVE_WINDOW_CHROME_OFFSET !== 'undefined' ? RESPONSIVE_WINDOW_CHROME_OFFSET.width : 16;
  const win = await ovfWin({ url: url, type: 'popup', width: widths[0] + off, height: OVF_HEIGHT, focused: false });
  if (!win || !win.tabs || !win.tabs[0]) { if (id === ovfRunId) { OVF.phase = 'idle'; OVF.error = 'Could not open a test window.'; shRender(); } return; }
  const tabId = win.tabs[0].id;
  try {
    await siteTabWait(tabId);
    await ovfWait(900);
    for (let i = 0; i < widths.length && !OVF.cancel && id === ovfRunId; i++) {
      const w = widths[i];
      OVF.current = i; shRender();
      let r = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        await ovfUpdate(win.id, { width: w + off, height: OVF_HEIGHT });
        await ovfWait(attempt ? 500 : 750);
        r = await ovfInject(tabId);
        if (!r) break;
        if (Math.abs(r.vw - w) <= 1) break;
        // the window chrome is wider or narrower than assumed: correct for it once
        if (attempt === 0) off += (r.vw - w) * -1;
      }
      const finalUrl = await ovfTabUrl(tabId);
      if (id !== ovfRunId) break;
      if (r) OVF.results.push(Object.assign({ w: w, finalUrl: finalUrl, clamped: Math.abs(r.vw - w) > 1 }, r));
      else OVF.results.push({ w: w, failed: true });
    }
  } finally {
    chrome.windows.remove(win.id, () => void chrome.runtime.lastError);
  }
  if (id !== ovfRunId) return;
  OVF.phase =OVF.results.some(r => !r.failed) ? 'done' : 'idle';
  if (OVF.phase !== 'done') OVF.error = 'The test window could not be read.';
  OVF.at = Date.now();
  const moved = OVF.results.filter(r => r.finalUrl && r.finalUrl.split('#')[0] !== url.split('#')[0] && !r.failed)[0];
  if (moved) { try { if (new URL(moved.finalUrl).hostname !== new URL(url).hostname) OVF.note = `At ${moved.w}px the site sent the browser to ${new URL(moved.finalUrl).hostname}, so the results there describe that page.`; } catch (e) { /* ignore */ } }
  shRender();
}

/* ------------------------------------------------------------------ results */
function ovfMerge() {
  const map = {};
  OVF.results.filter(r => !r.failed).forEach(r => {
    r.culprits.forEach(c => {
      const m = map[c.selector] || (map[c.selector] = { selector: c.selector, label: c.label, tag: c.tag, reason: c.reason, fix: c.fix, widths: [], max: 0, minWidth: c.minWidth });
      m.widths.push({ w: r.w, over: c.over });
      if (c.over > m.max) { m.max = c.over; m.reason = c.reason; m.fix = c.fix; }
    });
  });
  return Object.keys(map).map(k => map[k]).sort((a, b) => (b.widths.length - a.widths.length) || (b.max - a.max));
}

const OVF_REASON = {
  media: 'Image or video wider than its space', embed: 'Embed wider than its space', table: 'Table wider than the screen', code: 'Code block that does not scroll',
  nowrap: 'Text that will not wrap', longword: 'A long word or address that cannot break', minwidth: 'A minimum width wider than the screen',
  fixedwidth: 'A fixed width wider than the screen', flexchild: 'A flex or grid item that will not shrink', wide: 'Wider than its container'
};

function ovfBreaks(results) {
  const ok = results.filter(r => !r.failed);
  const bad = ok.filter(r => r.overflowX);
  if (!bad.length) return null;
  const widest = bad.reduce((m, r) => Math.max(m, r.w), 0);
  const worst = bad.reduce((m, r) => r.over > m.over ? r : m, bad[0]);
  return { widest: widest, worst: worst, widths: bad.map(r => r.w) };
}

function ovfChecks(d) {
  if (OVF.phase !== 'done') return [];
  const ok = OVF.results.filter(r => !r.failed);
  const br = ovfBreaks(ok);
  const merged = ovfMerge();
  const top = merged[0];
  return [{
    label: 'The page fits every screen width', pass: !br, sev: br && br.widest <= 480 ? 'Medium' : 'High',
    t: 'Fix horizontal scrolling',
    line: br ? `The page scrolls sideways at ${br.widths.join(', ')}px${top ? `. Main cause: ${top.label}` : ''}.` : '',
    mean: 'Pages that scroll sideways on a phone feel broken, and content past the edge is easy to miss. Search engines also flag it as a mobile usability problem.',
    fix: 'Find the element that is wider than the screen and let it shrink, wrap or scroll inside its own box.',
    section: 'ins:overflow', actions: [top ? insShowAction(top.selector, 'Widest culprit') : null, insOpenAction('overflow', 'Open overflow finder')],
    fixCode: top ? { where: 'css', code: ovfCss(merged.slice(0, 4)), note: 'Test each rule at the widths listed on the Overflow finder screen.' } : null
  }];
}

function ovfCss(list) { return list.map(m => `/* ${OVF_REASON[m.reason] || 'Wider than its container'}: overflows by ${m.max}px at ${m.widths.map(w => w.w).join(', ')}px */\n${m.selector} {\n  ${m.fix.replace(/\n/g, '\n  ')}\n}`).join('\n\n'); }

/* ------------------------------------------------------------------ screen */
function ovfChips() {
  return `<div class="ovf-widths" role="group" aria-label="Widths to test">${OVF_PRESETS.concat(OVF.widths.filter(w => OVF_PRESETS.indexOf(w) < 0)).sort((a, b) => a - b).map(w => `<button type="button" class="ovf-w${OVF.widths.indexOf(w) >= 0 ? ' on' : ''}" data-sh="ovf" data-v="width" data-w="${w}" aria-pressed="${OVF.widths.indexOf(w) >= 0}">${w}</button>`).join('')}
      <span class="ovf-add"><input type="number" id="ovf-custom" class="search-input" min="240" max="3000" placeholder="Other" value="${shEsc(OVF.custom)}" aria-label="Another width in pixels"><button type="button" class="sh-btn sm" data-sh="ovf" data-v="add">Add</button></span></div>`;
}

function ovfTimeline(results) {
  return `<div class="ovf-line">${results.map(r => {
    if (r.failed) return `<span class="ovf-t none"><b>${r.w}</b><small>failed</small></span>`;
    const t = r.overflowX ? 'bad' : 'ok';
    return `<span class="ovf-t ${t}" title="${r.overflowX ? 'Scrolls sideways by ' + r.over + 'px' : 'Fits'}${r.clamped ? ' (the browser would not go this narrow: measured at ' + r.vw + 'px)' : ''}"><b>${r.w}${r.clamped ? '*' : ''}</b><small>${r.overflowX ? '+' + r.over + 'px' : 'fits'}</small></span>`;
  }).join('')}</div>`;
}

function ovfCulprit(m) {
  const css = ovfCss([m]);
  return `<div class="ovf-c"><div class="ovf-c-top"><span class="ovf-c-tx"><b>${shEsc(insShort(m.label, 44))}</b><small title="${shEsc(m.selector)}">${shEsc(insShort(m.selector, 62))}</small>
        <span class="ins-chips"><span class="ins-chip bad">${m.max}px too wide</span><span class="ins-chip info">${shEsc(OVF_REASON[m.reason] || '')}</span></span></span>
        <button type="button" class="ins-go" data-sh="ins" data-v="show" data-sel="${shEsc(m.selector)}" data-lbl="${m.max}px over" title="Show on page" aria-label="Show on page">${shIcon('target', 15)}</button></div>
      <small class="ovf-c-w">Overflows at ${m.widths.map(w => w.w + 'px').join(' · ')}</small>
      <pre class="sh-code fx-code">${shEsc(m.fix)}</pre>
      <div class="sh-btns"><button type="button" class="sh-btn sm" data-sh="copy" data-v="${shEsc(css)}">${shIcon('copy', 13)} Copy CSS</button></div></div>`;
}

function ovfScreen(A) {
  let h = '';
  if (OVF.phase === 'running') {
    const n = OVF.widths.length;
    h += `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big">${Math.min(OVF.current + 1, n)}<span class="site-of"> / ${n}</span></span><span class="sh-tchip warn">Testing</span></div>
        <div class="ins-bar site-bar"><i style="width:${OVF.results.length / n * 100}%;background:var(--accent)"></i></div>
        <p class="ins-lede site-cur">${OVF.widths.slice().sort((a, b) => a - b)[Math.min(OVF.current, n - 1)]}px wide</p>
        ${ovfTimeline(OVF.results)}
        <p class="ins-note" style="margin:8px 0 10px">A small test window opens, resizes itself and closes. Please leave it alone for a few seconds.</p>
        <div class="sh-btns"><button type="button" class="sh-btn sm" data-sh="ovf" data-v="cancel">${OVF.cancel ? 'Stopping…' : 'Stop'}</button></div></section>`;
    return h;
  }

  const ok = OVF.results.filter(r => !r.failed);
  if (OVF.phase === 'done' && ok.length) {
    const br = ovfBreaks(ok), merged = ovfMerge();
    const t = br ? 'bad' : 'ok';
    h += `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${t}">${br ? br.widths.length : 0}</span><span class="sh-tchip ${t}">${br ? 'Widths that break' : 'Fits at every width'}</span><small>of ${ok.length} tested · ${insAgo(OVF.at)}</small></div>
        ${ovfTimeline(OVF.results)}
        <p class="ins-lede">${br ? `The page scrolls sideways at <b>${br.widest}px and narrower</b>, by up to <b>${br.worst.over}px</b> at ${br.worst.w}px.` : 'Nothing sticks out past the edge at any width tested.'}${OVF.results.some(r => r.clamped) ? ' <small>* The browser would not make the window that narrow.</small>' : ''}</p>
        ${OVF.note ? `<p class="ins-note con-msg" style="margin:0">${shEsc(OVF.note)}</p>` : ''}</section>`;
    const fixed = [];
    ok.forEach(r => (r.fixedWide || []).forEach(f => { if (!fixed.some(x => x.selector === f.selector)) fixed.push(Object.assign({ w: r.w }, f)); }));
    if (!ok.some(r => r.viewportMeta)) h += `<p class="ins-note ins-decay">${shIcon('alert', 12)} This page has no viewport meta tag, so phones show it as a shrunken desktop page. That alone can look like overflow.</p>`;
    if (merged.length) h += `<div class="sh-sec"><span>What sticks out <em>${merged.length}</em></span></div><div class="ovf-list">${merged.slice(0, 8).map(ovfCulprit).join('')}</div>`;
    else if (br) h += insEmpty('alert', 'The cause was not isolated', 'The page scrolls sideways, but no single element could be blamed. Look for negative margins or transforms on the page.');
    if (fixed.length) h += `<div class="sh-sec"><span>Fixed elements wider than the screen <em>${fixed.length}</em></span></div><div class="sh-card ins-list">${fixed.map(f => `<div class="ins-img"><span class="ins-img-tx"><b>${shEsc(insShort(f.label, 40))}</b><small>${shEsc(insShort(f.selector, 56))} · ${f.width}px wide at ${f.w}px</small></span><button type="button" class="ins-go" data-sh="ins" data-v="show" data-sel="${shEsc(f.selector)}" data-lbl="Too wide" aria-label="Show on page">${shIcon('target', 15)}</button></div>`).join('')}</div>`;
  } else {
    h += `<section class="sh-card ins-pad"><b>Where does this page break?</b>
        <p class="ins-lede">Opens the page in a small test window at each width, then names the elements that make it scroll sideways, with a CSS fix for each.</p></section>`;
  }

  h += `<div class="sh-sec"><span>Widths to test <em>${OVF.widths.length}</em></span></div><div class="sh-card ins-pad">${ovfChips()}
      <div class="sh-btns" style="margin-top:12px"><button type="button" class="sh-btn pri sm" data-sh="ovf" data-v="run" ${OVF.widths.length ? '' : 'disabled'}>${OVF.phase === 'done' ? 'Test again' : `Test ${OVF.widths.length} widths`}</button><button type="button" class="sh-btn sm" data-sh="ovf" data-v="here">Check this window only</button></div>
      ${OVF.error ? `<p class="ins-note con-msg">${shEsc(OVF.error)}</p>` : ''}</div>`;

  if (OVF.here) {
    const r = OVF.here;
    h += `<div class="sh-sec"><span>This window <em>${r.vw}px</em></span><button data-sh="ovf" data-v="clear-here">Clear</button></div><div class="sh-card ins-pad"><p class="ins-lede" style="margin-top:0">${r.overflowX ? `Scrolls sideways by <b>${r.over}px</b>.` : 'No horizontal scroll at this width.'}</p>
        ${r.culprits.length ? `<div class="ovf-list" style="margin-top:10px">${r.culprits.slice(0, 4).map(c => ovfCulprit({ selector: c.selector, label: c.label, tag: c.tag, reason: c.reason, fix: c.fix, max: c.over, widths: [{ w: r.vw, over: c.over }] })).join('')}</div>` : ''}</div>`;
  }
  h += `<p class="ins-note">Real windows have a minimum width, so very narrow tests may be measured slightly wider and are marked with *. Page content is only read, never changed.</p>`;
  if (OVF.phase === 'done' && ok.length) h += `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="ovf" data-v="copy">${shIcon('copy', 13)} Copy report</button><button type="button" class="sh-btn sm" data-sh="ovf" data-v="clear">Clear results</button></div>`;
  return h;
}

function ovfReport() {
  const ok = OVF.results.filter(r => !r.failed);
  const br = ovfBreaks(ok), merged = ovfMerge();
  const L = [`Overflow check for ${OVF.url}`, ok.map(r => `${r.w}px: ${r.overflowX ? 'scrolls sideways by ' + r.over + 'px' : 'fits'}`).join('\n'), ''];
  if (br) L.push(`The page scrolls sideways at ${br.widest}px and narrower.`, '');
  merged.slice(0, 8).forEach(m => L.push(`${m.label} (${m.selector})\n  ${OVF_REASON[m.reason] || 'wider than its container'}, ${m.max}px over at ${m.widths.map(w => w.w).join(', ')}px\n  suggested: ${m.fix.replace(/\n/g, ' ')}`));
  return L.join('\n').trim();
}

function ovfHandle(op, el) {
  const ds = el.dataset || {};
  if (op === 'run') ovfRun();
  else if (op === 'here') ovfHere();
  else if (op === 'cancel') { OVF.cancel = true; shRender(); }
  else if (op === 'width') {
    const w = parseInt(ds.w, 10);
    const i = OVF.widths.indexOf(w);
    if (i >= 0) OVF.widths.splice(i, 1); else if (OVF.widths.length < 10) OVF.widths.push(w);
    shRender();
  } else if (op === 'add') {
    const input = shEl('ovf-custom');
    const w = parseInt(input && input.value, 10);
    if (!Number.isFinite(w) || w < 240 || w > 3000) { showToast('Enter a width between 240 and 3000'); return; }
    if (OVF.widths.indexOf(w) < 0 && OVF.widths.length < 10) OVF.widths.push(w);
    OVF.custom = '';
    shRender();
  } else if (op === 'copy') copyToClipboard(ovfReport(), 'Report copied');
  else if (op === 'clear' || op === 'clear-here') {
    if (OVF.phase === 'running') return;
    if (op === 'clear') Object.assign(OVF, { phase: 'idle', results: [], here: null, note: '', error: '', at: 0 }); else OVF.here = null;
    if (lastActiveTabId) chrome.tabs.sendMessage(lastActiveTabId, { action: 'insight-clear' }, () => void chrome.runtime.lastError);
    shRender();
  }
}

document.addEventListener('input', (e) => { if (e.target && e.target.id === 'ovf-custom') OVF.custom = e.target.value; });

/* ------------------------------------------------------------------ registration */
SH_SCREENS.overflow = { title: 'Overflow finder', build: ovfScreen };
SH_CATS.filter(c => c.id === 'design')[0].explore.push(['overflow', 'Overflow finder', 'What breaks at narrow widths', 'phone']);
SH_TOOLS.Page.push(['overflow', 'Overflow finder', 'phone']);
SH_TOOL_META.overflow = 'Why it scrolls sideways';
SH_TOOL_KEYWORDS.overflow = 'overflow horizontal scroll responsive mobile width breakpoint wider than screen sideways';

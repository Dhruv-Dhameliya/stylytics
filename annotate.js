/* annotate.js — Review pins: comment on the live page and export a numbered punch list.
 *
 * Pick an element, write what is wrong, and a numbered marker stays on the page. Each pin keeps a small
 * screenshot of the element. Pins are saved per page on this device and can be exported as a punch list
 * (HTML with the screenshots) or copied as text for a ticket or a chat.
 *
 * The on-page part is content_annotate.js; this file is the screen, storage and export.
 */

const ANN_STORE = 'ann_pins';
const ANN_MAX = 40;
const ANN_KINDS = [['design', 'Design', '#ea580c'], ['content', 'Content', '#2563eb'], ['bug', 'Bug', '#dc2626'], ['a11y', 'Access', '#7c3aed'], ['question', 'Question', '#0891b2']];
const ANN = { key: '', url: '', title: '', pins: [], picking: false, draft: null, visible: true, filter: 'open', editId: '', focusId: '', saving: false, injected: false, ready: false };

const annKind = (k) => ANN_KINDS.filter(x => x[0] === k)[0] || ANN_KINDS[0];

/* ------------------------------------------------------------------ storage */
function annPersist() {
  chrome.storage.local.get([ANN_STORE], (res) => {
    const all = res[ANN_STORE] || {};
    if (ANN.pins.length) all[ANN.key] = ANN.pins; else delete all[ANN.key];
    chrome.storage.local.set({ [ANN_STORE]: all });
  });
}

function annOnScan(url, title) {
  ANN.key = insKey(url); ANN.url = url; ANN.title = title || ''; ANN.ready = false; ANN.injected = false; ANN.picking = false; ANN.draft = null; ANN.editId = '';
  chrome.storage.local.get([ANN_STORE], (res) => {
    ANN.pins = ((res[ANN_STORE] || {})[ANN.key] || []).slice();
    ANN.ready = true;
    if (ANN.pins.length) annSync();
    try { if (!SH.scanning) shRender(); } catch (e) { /* not drawn yet */ }
  });
}

/* ------------------------------------------------------------------ talking to the page */
function annEnsure(cb) {
  if (!lastActiveTabId) { showToast('No page to annotate'); return; }
  if (ANN.injected) { cb(); return; }
  chrome.scripting.executeScript({ target: { tabId: lastActiveTabId }, files: ['content_annotate.js'] }, () => {
    if (chrome.runtime.lastError) { showToast('This page cannot be annotated'); return; }
    ANN.injected = true;
    cb();
  });
}

function annSend(msg, cb) {
  chrome.tabs.sendMessage(lastActiveTabId, msg, (res) => {
    if (chrome.runtime.lastError) { ANN.injected = false; cb && cb(null); return; }
    cb && cb(res);
  });
}

// Push the saved pins to the page so the markers match the list.
function annSync() {
  annEnsure(() => annSend({ action: 'annotate-render', pins: ANN.pins.map(p => ({ id: p.id, n: p.n, selector: p.selector, rect: p.rect, kind: p.kind, comment: p.comment, resolved: p.resolved })), visible: ANN.visible }));
}

/* ------------------------------------------------------------------ messages from the page */
chrome.runtime.onMessage.addListener((req, sender) => {
  if (!req || typeof req.action !== 'string' || req.action.indexOf('annotate-') !== 0) return;
  if (!sender || !sender.tab || sender.tab.id !== lastActiveTabId) return;
  if (req.action === 'annotate-picked') {
    ANN.picking = false;
    ANN.draft = { selector: req.selector, label: req.label, tag: req.tag, rect: req.rect, view: req.view, kind: 'design', comment: '' };
    shOpenPane('annotate');
  } else if (req.action === 'annotate-cancelled') {
    ANN.picking = false; shRender();
  } else if (req.action === 'annotate-open-pin') {
    ANN.focusId = req.id; ANN.filter = 'all';
    shOpenPane('annotate');
    setTimeout(() => { const el = document.querySelector('.ann-pin[data-id="' + req.id + '"]'); if (el) el.scrollIntoView({ block: 'center' }); }, 80);
  }
});

/* ------------------------------------------------------------------ screenshot of one pin */
function annLoadImage(src) { return new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; }); }

// Crop the visible-tab capture to the element plus some context, outline it and number it.
async function annCrop(dataUrl, view, vw, number, color) {
  const img = await annLoadImage(dataUrl);
  if (!img) return null;
  const scale = img.width / vw;
  const pad = 36;
  let x = Math.max(0, view.x - pad), y = Math.max(0, view.y - pad);
  let w = Math.min(vw - x, view.w + pad * 2), h = Math.min(img.height / scale - y, view.h + pad * 2);
  const minW = 260, minH = 120;
  if (w < minW) { x = Math.max(0, x - (minW - w) / 2); w = Math.min(vw - x, minW); }
  if (h < minH) { y = Math.max(0, y - (minH - h) / 2); h = Math.min(img.height / scale - y, minH); }
  const maxW = 760;
  const k = Math.min(1, maxW / (w * scale));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale * k)); c.height = Math.max(1, Math.round(h * scale * k));
  const g = c.getContext('2d');
  g.drawImage(img, x * scale, y * scale, w * scale, h * scale, 0, 0, c.width, c.height);
  const ex = (view.x - x) * scale * k, ey = (view.y - y) * scale * k, ew = view.w * scale * k, eh = view.h * scale * k;
  g.lineWidth = 3; g.strokeStyle = color; g.strokeRect(ex, ey, Math.max(ew, 6), Math.max(eh, 6));
  const r = 13, bx = Math.min(c.width - r - 2, ex + Math.max(ew, 6)), by = Math.max(r + 2, ey);
  g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fillStyle = color; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
  g.fillStyle = '#fff'; g.font = '700 14px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(number), bx, by + 1);
  return { data: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
}

// A screenshot is a nicety: if the page does not answer or the capture stalls, the pin saves without one.
function annShoot(draft, number, color) {
  return new Promise((resolve) => {
    let finished = false;
    const done = (shot) => { if (finished) return; finished = true; clearTimeout(guard); annSend({ action: 'annotate-after-capture' }, () => { }); resolve(shot); };
    const guard = setTimeout(() => done(null), 8000);
    annSend({ action: 'annotate-prepare-capture', selector: draft.selector, rect: draft.rect }, async (info) => {
      if (!info || !info.success) { done(null); return; }
      let shot = null;
      try {
        const dataUrl = await captureVisibleTabAsync();
        if (dataUrl) shot = await annCrop(dataUrl, info.view, info.vw, number, color);
      } catch (e) { /* save the pin without an image */ }
      done(shot);
    });
  });
}

/* ------------------------------------------------------------------ actions */
async function annSave() {
  const d = ANN.draft;
  if (!d || ANN.saving) return;
  const ta = shEl('ann-comment');
  const comment = ta ? ta.value.trim() : d.comment;
  if (!comment) { showToast('Write what needs to change'); if (ta) ta.focus(); return; }
  if (ANN.pins.length >= ANN_MAX) { showToast(`Up to ${ANN_MAX} pins per page`); return; }
  ANN.saving = true; shRender();
  try {
  const n = ANN.pins.reduce((m, p) => Math.max(m, p.n), 0) + 1;
  const color = annKind(d.kind)[2];
  const shot = await annShoot(d, n, color);
  ANN.pins.push({
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), n: n, selector: d.selector, label: d.label, tag: d.tag, rect: d.rect,
    kind: d.kind, comment: comment, resolved: false, createdAt: Date.now(), shot: shot ? shot.data : null, shotW: shot ? shot.w : 0, shotH: shot ? shot.h : 0
  });
  ANN.draft = null; ANN.filter = 'open';
  annPersist(); annSync();
  showToast('Pin ' + n + ' saved');
  } finally { ANN.saving = false; shRender(); }
}

function annPick() {
  annEnsure(() => {
    annSend({ action: 'annotate-mode', on: true }, (res) => {
      if (!res) { showToast('Reload the page and try again'); return; }
      ANN.picking = true; ANN.draft = null; shRender();
    });
  });
}

function annMarkdown() {
  const L = [`# Review of ${ANN.title || ANN.key}`, ANN.url, ''];
  const open = ANN.pins.filter(p => !p.resolved), done = ANN.pins.filter(p => p.resolved);
  const line = (p) => `${p.n}. [${annKind(p.kind)[1]}] ${p.comment}\n   Element: ${p.label} (\`${p.selector}\`)`;
  if (open.length) { L.push('## To do', ''); open.forEach(p => L.push(line(p))); L.push(''); }
  if (done.length) { L.push('## Done', ''); done.forEach(p => L.push(line(p))); }
  return L.join('\n').trim();
}

function annHandle(op, el) {
  const ds = el.dataset || {};
  const pin = ANN.pins.filter(p => p.id === ds.id)[0];
  switch (op) {
    case 'pick': annPick(); break;
    case 'cancel-pick': annSend({ action: 'annotate-mode', on: false }); ANN.picking = false; ANN.draft = null; shRender(); break;
    case 'kind': if (ANN.draft) { const ta = shEl('ann-comment'); if (ta) ANN.draft.comment = ta.value; ANN.draft.kind = ds.k; shRender(); } break;
    case 'save': annSave(); break;
    case 'discard': ANN.draft = null; shRender(); break;
    case 'show': if (pin) annEnsure(() => annSend({ action: 'annotate-show', id: pin.id }, (r) => { if (r && r.success && !r.found) showToast('That element is no longer on the page'); })); break;
    case 'toggle': if (pin) { pin.resolved = !pin.resolved; annPersist(); annSync(); shRender(); } break;
    case 'delete': if (pin) { ANN.pins = ANN.pins.filter(p => p.id !== pin.id); annPersist(); annSync(); shRender(); } break;
    case 'edit': ANN.editId = ds.id; shRender(); break;
    case 'edit-save': { const ta = shEl('ann-edit'); if (pin && ta && ta.value.trim()) { pin.comment = ta.value.trim(); annPersist(); annSync(); } ANN.editId = ''; shRender(); break; }
    case 'edit-cancel': ANN.editId = ''; shRender(); break;
    case 'filter': ANN.filter = ds.f; shRender(); break;
    case 'visible': ANN.visible = !ANN.visible; annSync(); shRender(); break;
    case 'clear-all':
      if (!ANN.pins.length) break;
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to delete all'; break; }
      ANN.pins = []; annPersist(); annEnsure(() => annSend({ action: 'annotate-clear' })); shRender();
      break;
    case 'copy': copyToClipboard(annMarkdown(), 'Punch list copied'); break;
    case 'export': siteDownload(buildPunchListHtml(), `punch-list-${rpHostOf(ANN.url) || 'page'}.html`, 'text/html'); break;
  }
}

/* ------------------------------------------------------------------ screen */
function annKindChips(current, op) {
  return `<div class="ann-kinds" role="group" aria-label="Type of note">${ANN_KINDS.map(k => `<button type="button" class="ann-kind${current === k[0] ? ' on' : ''}" style="--k:${k[2]}" data-sh="ann" data-v="${op}" data-k="${k[0]}" aria-pressed="${current === k[0]}">${k[1]}</button>`).join('')}</div>`;
}

function annDraftView() {
  const d = ANN.draft;
  const k = annKind(d.kind);
  return `<section class="sh-card ins-pad ann-form" style="--k:${k[2]}"><div class="ann-form-h"><span class="ann-n" style="background:${k[2]}">${ANN.pins.reduce((m, p) => Math.max(m, p.n), 0) + 1}</span><span class="lab-tx"><b>New pin</b><small>${shEsc(insShort(d.label, 56))}</small></span></div>
      ${annKindChips(d.kind, 'kind')}
      <textarea id="ann-comment" class="con-text ann-text" placeholder="What needs to change here?" ${ANN.saving ? 'disabled' : ''}>${shEsc(d.comment)}</textarea>
      <p class="ins-note" style="margin:0 0 8px">${shEsc(insShort(d.selector, 80))}</p>
      <div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="ann" data-v="save" ${ANN.saving ? 'disabled' : ''}>${ANN.saving ? 'Saving…' : 'Save pin'}</button><button type="button" class="sh-btn sm" data-sh="ann" data-v="discard" ${ANN.saving ? 'disabled' : ''}>Cancel</button></div></section>`;
}

function annPinCard(p) {
  const k = annKind(p.kind);
  if (ANN.editId === p.id) {
    return `<div class="ann-pin editing" data-id="${p.id}"><span class="ann-n" style="background:${k[2]}">${p.n}</span><div class="ann-body"><textarea id="ann-edit" class="con-text ann-text">${shEsc(p.comment)}</textarea>
      <div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="ann" data-v="edit-save" data-id="${p.id}">Save</button><button type="button" class="sh-btn sm" data-sh="ann" data-v="edit-cancel">Cancel</button></div></div></div>`;
  }
  return `<div class="ann-pin${p.resolved ? ' done' : ''}${ANN.focusId === p.id ? ' focus' : ''}" data-id="${p.id}">
      <span class="ann-n" style="background:${p.resolved ? '#94a3b8' : k[2]}">${p.resolved ? shIcon('check', 13) : p.n}</span>
      <div class="ann-body"><div class="ann-c">${shEsc(p.comment)}</div>
        <small class="ann-meta"><span class="ins-chip" style="background:${k[2]}22;color:${k[2]}">${k[1]}</span> ${shEsc(insShort(p.label, 36))}</small>
        ${p.shot ? `<img class="ann-shot" src="${p.shot}" alt="Screenshot of pin ${p.n}">` : ''}
        <div class="ann-acts"><button type="button" class="ins-go" data-sh="ann" data-v="show" data-id="${p.id}" title="Show on page" aria-label="Show on page">${shIcon('target', 14)}</button>
          <button type="button" class="ann-link" data-sh="ann" data-v="toggle" data-id="${p.id}">${p.resolved ? 'Reopen' : 'Mark done'}</button>
          <button type="button" class="ann-link" data-sh="ann" data-v="edit" data-id="${p.id}">Edit</button>
          <button type="button" class="ann-link bad" data-sh="ann" data-v="delete" data-id="${p.id}">Delete</button></div></div></div>`;
}

function annScreen() {
  if (!ANN.ready) return '<div class="sh-empty"><b>Loading…</b></div>';
  const open = ANN.pins.filter(p => !p.resolved).length, done = ANN.pins.length - open;
  let h = '';
  if (ANN.draft) h += annDraftView();
  else if (ANN.picking) h += `<section class="sh-card ins-pad"><div class="ins-metric"><span class="sh-tchip warn">Picking</span></div><p class="ins-lede">Click an element on the page to pin a note to it. Press Esc on the page to cancel.</p><div class="sh-btns" style="margin-top:10px"><button type="button" class="sh-btn sm" data-sh="ann" data-v="cancel-pick">Cancel</button></div></section>`;
  else h += `<section class="sh-card ins-pad"><b>Review this page</b><p class="ins-lede">Point at anything on the page, write what is wrong, and a numbered marker stays there. Export the list as a punch list with screenshots.</p>
      <div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="ann" data-v="pick">${shIcon('target', 13)} Add a pin</button>${ANN.pins.length ? `<button type="button" class="sh-btn sm" data-sh="ann" data-v="visible">${ANN.visible ? 'Hide pins on page' : 'Show pins on page'}</button>` : ''}</div></section>`;

  if (ANN.pins.length) {
    h += `<div class="sh-sec"><span>Pins <em>${open} open${done ? `, ${done} done` : ''}</em></span></div>
      <div class="segmented ann-filter">${[['open', 'Open'], ['all', 'All'], ['done', 'Done']].map(f => `<button type="button" class="tag${ANN.filter === f[0] ? ' active' : ''}" data-sh="ann" data-v="filter" data-f="${f[0]}">${f[1]}</button>`).join('')}</div>`;
    const list = ANN.pins.filter(p => ANN.filter === 'all' || (ANN.filter === 'open' ? !p.resolved : p.resolved));
    h += `<div class="sh-card ann-list">${list.length ? list.map(annPinCard).join('') : `<div class="sh-empty"><b>${ANN.filter === 'open' ? 'Nothing left to do' : 'Nothing done yet'}</b></div>`}</div>
      <div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="ann" data-v="export">${shIcon('download', 13)} Export punch list</button><button type="button" class="sh-btn sm" data-sh="ann" data-v="copy">${shIcon('copy', 13)} Copy</button><button type="button" class="sh-btn sm" data-sh="ann" data-v="clear-all">Clear all</button></div>
      <p class="ins-note">Pins are saved on this device for this page. They follow their element if the layout moves.</p>`;
  }
  return h;
}

/* ------------------------------------------------------------------ export */
function buildPunchListHtml() {
  const host = rpHostOf(ANN.url);
  const open = ANN.pins.filter(p => !p.resolved), done = ANN.pins.filter(p => p.resolved);
  const card = (p) => {
    const k = annKind(p.kind);
    return `<article class="card pin${p.resolved ? ' done' : ''}"><div class="pin-h"><span class="pin-n" style="background:${p.resolved ? '#94a3b8' : k[2]}">${p.n}</span><div><b>${rpEsc(p.comment).replace(/\n/g, '<br>')}</b><small>${rpEsc(k[1])} · ${rpEsc(p.label)} · <span class="mono">${rpEsc(p.selector)}</span> · ${rpEsc(new Date(p.createdAt).toLocaleDateString())}</small></div>${p.resolved ? '<span class="stat ok">Done</span>' : ''}</div>${p.shot ? `<img src="${p.shot}" alt="Pin ${p.n}">` : ''}</article>`;
  };
  const css = '.pin{padding:16px 18px;margin-bottom:14px;break-inside:avoid}.pin-h{display:flex;gap:14px;align-items:flex-start}.pin-h b{display:block;font-size:15px;line-height:1.45;margin-bottom:4px}.pin-h small{color:var(--text3);font-size:12px;overflow-wrap:anywhere}.pin-h .stat{margin-left:auto}.pin-n{flex-shrink:0;min-width:30px;height:30px;border-radius:15px;color:#fff;font:700 14px/30px var(--sans);text-align:center;padding:0 8px}.pin img{display:block;max-width:100%;margin-top:14px;border-radius:12px;border:1px solid var(--line)}.pin.done{opacity:.7}';
  const body = `<section class="hero" id="overview"><span class="eyebrow">Review punch list</span><h1>${rpEsc(ANN.title || host || 'Page review')}</h1>
      <div class="url">${ANN.url ? `<a href="${rpEsc(ANN.url)}">${rpEsc(ANN.url)}</a>` : ''}<span>${rpEsc(rpDate())}</span></div>
      <div class="chips" style="margin-top:16px">${rpChip(open.length + ' to do')}${rpChip(done.length + ' done')}</div></section>` +
    rpSection('s-todo', 'To do', 'Open items', 'Numbers match the markers that were on the page when the notes were written.', open.length ? open.map(card).join('') : '<div class="card"><div class="empty">Nothing left to do.</div></div>') +
    (done.length ? rpSection('s-done', 'Finished', 'Done', '', done.map(card).join('')) : '');
  return rpDocument({ kind: 'Review punch list', title: ANN.title || host, host: host, nav: [['overview', 'Overview'], ['s-todo', 'Open items']].concat(done.length ? [['s-done', 'Done']] : []), headExtra: `<style>${css}</style>`, note: 'Screenshots were taken when each note was saved and show the page as it was then.', body: body });
}

/* ------------------------------------------------------------------ registration */
SH_ICONS.pin = '<path d="M12 2a6 6 0 0 0-6 6c0 4.5 6 12 6 12s6-7.5 6-12a6 6 0 0 0-6-6z"/><circle cx="12" cy="8" r="2"/>';
SH_SCREENS.annotate = { title: 'Review pins', build: annScreen };
SH_TOOLS.Page.push(['annotate', 'Review pins', 'pin']);
SH_TOOL_META.annotate = 'Pin notes to the live page';
SH_TOOL_KEYWORDS.annotate = 'annotate comment pin review feedback punch list note markup design review';

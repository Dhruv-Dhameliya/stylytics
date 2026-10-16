/* agent-ui.js — the Agent readiness screen, its summary in the AI audit, and its settings.
 *
 *   arScreen(A)        the detail screen (registered in SH_SCREENS.agent)
 *   arCatCard()        the summary row at the top of the AI readiness audit
 *   arAiScore(...)     how the agent checks and the new AI-search checks fold into the AI score
 *   arSettingsHtml()   the Settings rows
 *
 * The scan itself lives in agent-engine.js / agent-run.js and the page-level checks in agent-geo.js.
 */

const AR_STATUS = {
  pass: ['Passed', 'ok', 'check'], fail: ['Not found', 'bad', 'alert'], unable: ['Could not check', 'warn', 'alert'], info: ['Not applicable', 'info', 'info']
};

/* ------------------------------------------------------------------ score */
// The AI score blends three things: the page's own content checks, the new AI-search checks, and the
// agent-protocol checks. The protocol checks only count once their scan has finished, so the score
// does not jump around while requests are still in flight.
function arAiScore(base, geo, agent) {
  let s = insBlend(base, geo, 0.4);
  s = insBlend(s, agent, 0.3);
  return s;
}

function arSummary(d) {
  const prof = arProfile();
  const sc = arScore(AR.results, prof);
  const lv = arLevel(AR.results);
  return { prof: prof, sc: sc, lv: lv };
}

/* ------------------------------------------------------------------ small views */
function arRing(score, tier) {
  const C = 2 * Math.PI * 42;
  const off = score == null ? C : C * (1 - score / 100);
  return `<svg class="ar-ring ${tier}" viewBox="0 0 100 100" aria-hidden="true"><circle class="ar-ring-bg" cx="50" cy="50" r="42"/><circle class="ar-ring-fg" cx="50" cy="50" r="42" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>
    <span class="ar-ring-v">${score == null ? '—' : score}</span>`;
}

function arLadder(level) {
  return `<div class="ar-ladder" role="img" aria-label="Level ${level} of 5">${AR_LEVELS.map((n, i) => `<span class="ar-step${i <= level ? ' on' : ''}${i === level ? ' cur' : ''}" title="Level ${i}: ${shEsc(n)}"><i></i><small>${i}</small></span>`).join('')}</div>`;
}

function arAgo(ts) { return typeof insAgo === 'function' ? insAgo(ts) : ''; }

function arEvRow(e) {
  const st = e.status ? `<span class="ar-ev-st ${e.status >= 400 || e.error ? 'bad' : 'ok'}">${e.error ? '!' : e.status}</span>` : '<span class="ar-ev-st">·</span>';
  return `<div class="ar-ev ${e.outcome || 'neutral'}">${st}<span class="ar-ev-tx"><b>${shEsc(e.label)}</b><small>${shEsc(e.summary || (e.error === 'timeout' ? 'Timed out' : e.error ? 'Request failed' : ''))}</small></span></div>`;
}

function arVariantCode(fx, id) {
  if (!fx) return '';
  const vs = fx.variants || [];
  const cur = ARX.variant[id] || (vs[0] && vs[0].id);
  const v = vs.filter(x => x.id === cur)[0];
  return v && v.code != null ? v.code : fx.code;
}

function arCheckBody(def, r, d) {
  const fx = r.status === 'pass' ? null : arFixFor(def.id, d);
  const cur = fx && fx.variants ? (ARX.variant[def.id] || fx.variants[0].id) : '';
  const code = fx ? arVariantCode(fx, def.id) : '';
  const scored = arScoredIds(arProfile()).indexOf(def.id) >= 0;
  let h = `<div class="ar-body">
      <div><h4>What it is</h4><p>${shEsc(def.goal)}</p></div>
      <div><h4>Why it matters</h4><p>${shEsc(def.mean)}</p></div>`;
  if (r.status !== 'pass') h += `<div><h4>How to fix it</h4><p>${shEsc(def.fix)}</p></div>`;
  if (r.details && r.details.issues && r.details.issues.length) h += `<div><h4>Spec problems</h4><p>${r.details.issues.slice(0, 4).map(shEsc).join('<br>')}</p></div>`;
  if (r.details && r.details.missingRecommended && r.details.missingRecommended.length) h += `<div><h4>Recommended fields missing</h4><p>${r.details.missingRecommended.map(shEsc).join(', ')}</p></div>`;
  if (r.details && r.details.tools && r.details.tools.length) h += `<div><h4>Tools found</h4><p>${r.details.tools.slice(0, 8).map(t => `<b>${shEsc(t.name)}</b>${t.description ? ' — ' + shEsc(arShort(t.description, 90)) : ''}`).join('<br>')}</p></div>`;
  if (r.details && r.details.relationsFound && r.details.relationsFound.length) h += `<div><h4>Link relations found</h4><p>${r.details.relationsFound.map(x => `<code>${shEsc(x.rel)}</code> → ${shEsc(x.href)}`).join('<br>')}</p></div>`;
  if (fx && code) {
    h += `<div class="fx"><div class="fx-h"><b>${shIcon('check', 12)} Copy-ready fix</b><small>${shEsc(FIX_WHERE[fx.where] || '')}${fx.path ? ' · ' + shEsc(fx.path) : ''}</small></div>`;
    if (fx.variants && fx.variants.length) h += `<div class="segmented ar-var" role="group" aria-label="Format">${fx.variants.map(v => `<button type="button" class="tag${v.id === cur ? ' active' : ''}" data-sh="ar" data-v="variant" data-id="${def.id}" data-vid="${v.id}">${shEsc(v.label)}</button>`).join('')}</div>`;
    h += `<pre class="sh-code fx-code">${shEsc(code)}</pre>${fx.note ? `<p class="fx-note">${shEsc(fx.note)}</p>` : ''}</div>`;
  }
  h += `<div class="sh-btns">
      ${fx && code ? `<button type="button" class="sh-btn pri sm" data-sh="copy" data-v="${shEsc(code)}">${shIcon('copy', 13)} Copy fix</button>` : ''}
      ${r.status !== 'pass' ? `<button type="button" class="sh-btn${fx && code ? '' : ' pri'} sm" data-sh="copy" data-v="${shEsc(arPrompt(def.id, d))}">${shIcon('copy', 13)} Copy agent prompt</button>` : ''}
      ${def.path && /^\//.test(def.path) && AR.origin ? `<button type="button" class="sh-btn sm" data-sh="ar" data-v="open-url" data-url="${shEsc(AR.origin + def.path)}">${shIcon('link', 13)} Open file</button>` : ''}
      ${(def.spec || []).map(s => `<button type="button" class="sh-btn sm" data-sh="ar" data-v="open-url" data-url="${shEsc(s[1])}">${shEsc(s[0])}</button>`).join('')}
    </div>`;
  if (r.evidence && r.evidence.length) h += `<div class="ar-evs"><h4>What was requested${r.ms ? ' · ' + r.ms + ' ms' : ''}</h4>${r.evidence.map(arEvRow).join('')}</div>`;
  h += `<p class="ar-scorednote">${scored ? 'Counts toward the score.' : 'Shown for reference. It does not change the score for this site type.'}</p></div>`;
  return h;
}

function arCheckRow(def, r, d, scoredIds) {
  const open = !!ARX.open[def.id];
  const st = AR_STATUS[r.status] || AR_STATUS.fail;
  const scored = scoredIds.indexOf(def.id) >= 0;
  return `<div class="ar-chk ${st[1]}${open ? ' open' : ''}" id="ar-${def.id}">
      <button type="button" class="ar-row" data-sh="ar" data-v="toggle" data-id="${def.id}" aria-expanded="${open}">
        <span class="ar-ic ${st[1]}">${shIcon(st[2], 13)}</span>
        <span class="ar-tx"><b>${shEsc(r.status === 'pass' ? def.label : def.t)}</b><small>${shEsc(r.message)}</small></span>
        ${scored ? '' : '<span class="ins-chip info">Not scored</span>'}
        <span class="sh-chev">${shIcon(open ? 'chevd' : 'chevr', 14)}</span>
      </button>${open ? arCheckBody(def, r, d) : ''}</div>`;
}

function arBotsBlock() {
  const b = AR.bots;
  if (!b) return '';
  const blocked = b.list.filter(x => !x.allowed);
  const open = !!ARX.open.__bots;
  const kinds = ['search', 'user', 'training'];
  const body = kinds.map(k => {
    const rows = b.list.filter(x => x.kind === k);
    return `<div class="ar-botk"><span class="ar-botk-h">${shEsc({ search: 'AI search and answers', user: 'Fetching on a person’s request', training: 'Model training' }[k])}</span>
        ${rows.map(x => `<span class="ar-bot ${x.allowed ? 'ok' : 'bad'}" title="${shEsc(x.vendor + ' · ' + (x.rule || (x.source === 'default' ? 'no rule' : 'no matching rule')))}"><i></i>${shEsc(x.id)}</span>`).join('')}</div>`;
  }).join('');
  const searchBlocked = blocked.filter(x => x.kind !== 'training').length;
  return `<div class="sh-sec"><span>AI crawler access <em>${blocked.length ? blocked.length + ' blocked' : 'all allowed'}</em></span></div>
    <div class="sh-card ar-bots"><button type="button" class="sh-row" data-sh="ar" data-v="toggle" data-id="__bots" aria-expanded="${open}">
      <span class="sh-ico">${shIcon('eye', 16)}</span><span class="sh-tx"><b>${blocked.length ? arPlural(blocked.length, 'crawler') + ' blocked on this page' : 'No AI crawler is blocked on this page'}</b><small>${searchBlocked ? 'Blocking AI search bots removes you from AI answers.' : blocked.length ? 'Only training crawlers are blocked. You stay visible in AI search.' : 'Judged from robots.txt for ' + shEsc(b.path)}</small></span>
      <span class="sh-chev">${shIcon(open ? 'chevd' : 'chevr', 14)}</span></button>${open ? `<div class="ar-botbody">${body}</div>` : ''}</div>`;
}

/* ------------------------------------------------------------------ the screen */
function arScreen(A) {
  const d = A.data;
  if (AR.phase === 'idle') return insEmpty('globe', 'Nothing to scan', 'Agent readiness is checked for web pages that load over http or https.');
  if (AR.phase === 'off') return insEmpty('eye', 'Agent checks are paused', 'They are turned off in Settings. Run them for this page only if you like.') + `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="ar" data-v="rescan">Run the agent checks now</button></div>`;

  const { prof, sc, lv } = arSummary(d);
  const running = AR.phase === 'running';
  const tier = sc.score == null ? 'none' : sc.score >= 80 ? 'ok' : sc.score >= 50 ? 'warn' : 'bad';
  const pct = AR.total ? Math.min(100, Math.round(AR.done / AR.total * 100)) : 0;
  const unable = Object.keys(AR.results).filter(id => AR.results[id].status === 'unable' && sc.ids.indexOf(id) >= 0);

  let h = `<section class="sh-card ar-hero ${tier}">
      <div class="ar-hero-top"><span class="ar-ringwrap">${arRing(sc.score, tier)}</span>
        <div class="ar-hero-tx"><span class="ar-eyebrow">Agent readiness</span><b class="ar-level">Level ${lv.level}</b><span class="sh-tchip ${lv.level >= 3 ? 'ok' : lv.level >= 1 ? 'warn' : 'bad'}">${shEsc(lv.name)}</span>
          <small>${sc.total ? `${sc.pass} of ${sc.total} scored checks passed` : 'Checking…'}${AR.at ? ' · ' + arAgo(AR.at) : ''}</small></div></div>
      ${arLadder(lv.level)}
      ${running ? `<div class="ins-bar site-bar"><i style="width:${pct}%;background:var(--accent)"></i></div><p class="ins-note" style="margin:6px 0 0">Checking ${AR.done} of ${AR.total}… the score settles when every request is back.</p>` : ''}
      ${unable.length ? `<p class="ins-note ar-warn" style="margin:8px 0 0">${arPlural(unable.length, 'check')} could not be verified and ${unable.length === 1 ? 'is' : 'are'} left out of the score. <button type="button" class="sh-linkbtn" data-sh="ar" data-v="rescan">Try again</button></p>` : ''}
    </section>`;

  // what kind of site is being judged
  const label = prof === 'content' ? 'a content site (blog, docs, marketing)' : 'an API or app';
  h += `<div class="sh-sec"><span>Site type</span></div><div class="sh-card ins-pad">
      <div class="segmented ar-prof" role="group" aria-label="Site type">${AR_PROFILES.map(p => `<button type="button" class="tag${ARX.profile === p[0] ? ' active' : ''}" data-sh="ar" data-v="profile" data-p="${p[0]}">${p[1]}</button>`).join('')}</div>
      <p class="ins-note" style="margin:8px 0 0">${ARX.profile === 'auto' ? 'Auto: ' : ''}Judged as ${label}, on ${sc.ids.length} checks.${ARX.profile === 'auto' && prof === 'content' ? ' Building an API or app? Choose “API & app” to score MCP, OAuth and skills too.' : ''}</p></div>`;

  // what the next level needs
  if (!running && lv.next) {
    const seen = new Set();
    const reqs = lv.next.requirements.filter(r => !seen.has(r.check) && seen.add(r.check));
    h += `<div class="sh-sec"><span>To reach Level ${lv.next.target} <em>${shEsc(lv.next.name)}</em></span></div><div class="sh-card">${reqs.slice(0, 6).map(r => {
      const def = AR_DEF[r.check];
      return `<button type="button" class="sh-row" data-sh="ar" data-v="goto" data-id="${r.check}"><span class="ar-ic bad">${shIcon('target', 13)}</span><span class="sh-tx"><b>${shEsc(def.t)}</b><small>${shEsc(r.why)}</small></span>${shChev()}</button>`;
    }).join('')}</div>`;
  } else if (!running && lv.level === 5) {
    h += `<div class="sh-card"><div class="sh-empty"><span class="sh-empty-ic ok">${shIcon('cc', 28)}</span><b>Agent-Native</b>This site meets every level requirement.</div></div>`;
  }

  // score by area
  const gs = AR_GROUPS.filter(g => g.id !== 'commerce');
  h += insTiles(gs.map(g => { const x = sc.groups[g.id]; return [g.name, x.score == null ? '—' : x.score, x.score == null ? '' : x.score >= 80 ? 'ok' : x.score >= 50 ? 'warn' : 'bad']; }));

  // the checks, by area
  AR_GROUPS.forEach(g => {
    const defs = AR_DEFS.filter(x => x.group === g.id && AR.results[x.id]);
    if (!defs.length) return;
    const fails = defs.filter(x => AR.results[x.id].status === 'fail').length;
    h += `<div class="sh-sec"><span>${shEsc(g.name)} <em>${g.id === 'commerce' ? 'optional' : (fails ? fails + ' to fix' : 'all good')}</em></span></div>`;
    const order = { fail: 0, unable: 1, pass: 2, info: 3 };
    const rows = defs.slice().sort((a, b) => (order[AR.results[a.id].status] - order[AR.results[b.id].status]) || (AR_DEFS.indexOf(a) - AR_DEFS.indexOf(b)));
    h += `<div class="sh-card ar-list">${rows.map(x => arCheckRow(x, AR.results[x.id], d, sc.ids)).join('')}</div>`;
  });

  h += arBotsBlock();

  // llms.txt and friends, outside the protocol score
  if (AR.llms && !AR.llms.unable) {
    const l = AR.llms;
    h += `<div class="sh-sec"><span>llms.txt</span></div><div class="sh-card"><div class="ar-llms ${l.present && l.valid ? 'ok' : 'warn'}"><span class="ar-ic ${l.present && l.valid ? 'ok' : 'warn'}">${shIcon(l.present && l.valid ? 'check' : 'alert', 13)}</span>
        <span class="ar-tx"><b>${l.present ? (l.valid ? 'llms.txt is published' : 'llms.txt has the wrong format') : 'No llms.txt'}</b><small>${l.present ? `${l.links} links${l.hasSummary ? ', with a summary' : ', no summary line'}${l.full ? ', plus llms-full.txt' : ''}.` : 'A short Markdown guide to your site for AI tools. It is not part of the score, but the AI readiness audit checks it.'}</small></span></div></div>`;
  }

  h += `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="ar" data-v="copy-report">${shIcon('copy', 13)} Copy report</button>
      <button type="button" class="sh-btn sm" data-sh="ar" data-v="copy-fixes">${shIcon('copy', 13)} Copy all fixes</button>
      <button type="button" class="sh-btn sm" data-sh="av" data-v="fixpack">${shIcon('download', 13)} Fix pack (.zip)</button>
      <button type="button" class="sh-btn sm" data-sh="ar" data-v="rescan">${shIcon('refresh', 13)} Scan again</button></div>
    <p class="ins-note">Every file is requested from your browser with no cookies, so this is what an anonymous crawler gets. Nothing is sent anywhere but the site being checked${ARX.opts.dns ? ' and Cloudflare’s DNS-over-HTTPS service, which answers the DNS record lookups' : ''}.</p>`;
  return h;
}

/* ------------------------------------------------------------------ summary in the AI audit */
function arCatCard() {
  if (AR.phase === 'idle') return '';
  let tx, sub, chip = '';
  if (AR.phase === 'off') { tx = 'Agent readiness'; sub = 'Turned off in Settings. Tap to run it for this page.'; }
  else if (AR.phase === 'running') { tx = 'Checking agent standards…'; sub = `${AR.done} of ${AR.total} requests back`; chip = '<span class="sh-tchip warn">Scanning</span>'; }
  else {
    const s = arSummary(lastExtractedData || {});
    tx = `Agent readiness · Level ${s.lv.level}`;
    sub = `${s.lv.name}${s.sc.total ? ` · ${s.sc.pass} of ${s.sc.total} protocol checks passed` : ''}`;
    chip = s.sc.score == null ? '' : `<span class="sh-tchip ${shTier(s.sc.score)[1]}">${s.sc.score}</span>`;
  }
  return `<div class="sh-card ar-cat"><button type="button" class="sh-row" data-sh="pane" data-v="agent" data-cat="ai"><span class="sh-ico a">${shIcon('eye', 16)}</span><span class="sh-tx"><b>${shEsc(tx)}</b><small>${shEsc(sub)}</small></span>${chip}${shChev()}</button></div>`;
}

/* ------------------------------------------------------------------ report */
function arReport() {
  const d = lastExtractedData || {};
  const { prof, sc, lv } = arSummary(d);
  const L = [`Agent readiness for ${AR.url}`, `Level ${lv.level} (${lv.name}) · score ${sc.score == null ? 'n/a' : sc.score + '/100'} · judged as ${prof === 'content' ? 'a content site' : 'an API or app'}`, ''];
  AR_GROUPS.forEach(g => {
    const defs = AR_DEFS.filter(x => x.group === g.id && AR.results[x.id]);
    if (!defs.length) return;
    L.push(g.name + (g.id === 'commerce' ? ' (optional)' : ''));
    defs.forEach(x => { const r = AR.results[x.id]; L.push(`  ${r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : r.status === 'unable' ? '?' : '–'} ${x.label} — ${r.message}`); });
    L.push('');
  });
  if (lv.next && lv.next.requirements.length) { L.push(`To reach Level ${lv.next.target} (${lv.next.name}):`); Array.from(new Set(lv.next.requirements.map(r => r.check))).forEach(id => L.push('  - ' + AR_DEF[id].t)); }
  return L.join('\n').trim();
}

function arAllFixes() {
  const d = lastExtractedData || {}, prof = arProfile(), ids = arScoredIds(prof);
  const parts = [];
  ids.forEach(id => {
    const r = AR.results[id];
    if (!r || r.status !== 'fail') return;
    const fx = arFixFor(id, d);
    if (!fx) return;
    const code = fx.code || (fx.variants && fx.variants[0] && fx.variants[0].code) || '';
    parts.push(`### ${AR_DEF[id].t}${fx.path ? '  →  ' + fx.path : ''}\n${code}`);
  });
  return parts.join('\n\n');
}

/* ------------------------------------------------------------------ events */
// While requests are still coming back, only redraw a screen that shows them; redraw everything once at the end.
function arRepaint(final) {
  try {
    const top = SH.stack[SH.stack.length - 1];
    const onAgent = !!top && top.pane === 'agent';
    const onAi = SH.tab === 'audit' && SH.catId === 'ai' && !top;
    if (final || onAgent || onAi) shRerenderIfIdle();
  } catch (e) { /* not drawn yet */ }
}

function arHandle(op, el) {
  const ds = el.dataset || {};
  switch (op) {
    case 'toggle': ARX.open[ds.id] = !ARX.open[ds.id]; shRender(); break;
    case 'goto': { ARX.open[ds.id] = true; shRender(); const row = document.getElementById('ar-' + ds.id); if (row) row.scrollIntoView({ block: 'center' }); break; }
    case 'variant': ARX.variant[ds.id] = ds.vid; shRender(); break;
    case 'profile':
      ARX.profile = ds.p;
      chrome.storage.local.set({ ar_profile: ds.p });
      shRender();
      break;
    case 'open-url': if (ds.url) window.open(ds.url, '_blank'); break;
    case 'rescan': ARX.forceNext = true; arOnScan(SH.url, lastActiveTabId); showToast('Scanning agent standards…'); break;
    case 'copy-report': copyToClipboard(arReport(), 'Report copied'); break;
    case 'copy-fixes': { const t = arAllFixes(); if (t) copyToClipboard(t, 'Fixes copied'); else showToast('Nothing to fix here'); break; }
  }
}

/* ------------------------------------------------------------------ settings */
function arSettingsHtml() {
  const sw = (id) => `<label class="switch"><input type="checkbox" id="${id}"><span class="switch-track"></span></label>`;
  const row = (icon, title, desc, id) => `<div class="sh-trow"><span class="sh-ico">${shIcon(icon, 16)}</span><div class="sh-tx"><b>${title}</b><small>${desc}</small></div>${sw(id)}</div>`;
  return `<div class="sh-sec"><span>Agent readiness</span></div><div class="sh-card">
      ${row('eye', 'Check agent standards automatically', 'Starts as a page begins to load. Requests robots.txt, the sitemap, llms.txt and the well-known files for the site, with no cookies. Results are kept for ten minutes.', 'settings-ar-auto')}
      ${row('globe', 'Look up DNS records', 'Asks Cloudflare’s DNS-over-HTTPS service for the site’s _agents records (DNS-AID, ARD). The domain you are viewing is sent to Cloudflare to answer this.', 'settings-ar-dns')}
      ${row('chip', 'Detect WebMCP tools', 'Adds a tiny listener to pages you open that notes the tools a page registers. It changes nothing on the page.', 'settings-ar-probe')}
    </div>`;
}

function arWireSettings() {
  const map = [['settings-ar-auto', 'ar_auto', 'Agent checks run automatically', 'Agent checks are paused'], ['settings-ar-dns', 'ar_dns', 'DNS record lookups are on', 'DNS record lookups are off'], ['settings-ar-probe', 'ar_probe', 'Detecting WebMCP tools', 'No longer detecting WebMCP tools']];
  chrome.storage.local.get(map.map(m => m[1]), (r) => {
    map.forEach(m => {
      const el = document.getElementById(m[0]);
      if (!el) return;
      el.checked = r[m[1]] !== false;
      el.addEventListener('change', () => {
        chrome.storage.local.set({ [m[1]]: el.checked });
        ARX.opts = Object.assign({}, ARX.opts, { auto: m[1] === 'ar_auto' ? el.checked : ARX.opts.auto, dns: m[1] === 'ar_dns' ? el.checked : ARX.opts.dns, probe: m[1] === 'ar_probe' ? el.checked : ARX.opts.probe });
        showToast(el.checked ? m[2] : m[3]);
        if (el.checked && m[1] !== 'ar_probe' && SH.url) { ARX.forceNext = true; arOnScan(SH.url, lastActiveTabId); }
      });
    });
  });
}

/* ------------------------------------------------------------------ registration */
SH_SCREENS.agent = { title: 'Agent readiness', build: arScreen };
SH_TOOLS.Page.push(['agent', 'Agent readiness', 'eye']);
SH_TOOL_META.agent = 'MCP, llms.txt, robots, skills';
SH_TOOL_KEYWORDS.agent = 'agent ai readiness mcp llms.txt robots gptbot claudebot oauth skills webmcp markdown content signals a2a ard x402 crawler';

if (typeof FIX_WHERE !== 'undefined') Object.assign(FIX_WHERE, { file: 'Create this file', server: 'Add to your server code', dns: 'Add to your DNS' });

ARX.listeners.push((final) => arRepaint(!!final));
document.addEventListener('DOMContentLoaded', () => {
  arOptsLoad();
  arPrefetchInit();
  // a manual rescan starts the agent checks over too
  const rb = document.getElementById('refresh-btn');
  if (rb) rb.addEventListener('click', () => { ARX.forceNext = true; }, true);
});

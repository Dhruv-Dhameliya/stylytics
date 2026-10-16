/* agent-view.js — "What an AI sees" and the fix pack.
 *
 *   What an AI sees   the page converted to Markdown twice: as an anonymous crawler downloads it (the
 *                     raw HTML, no scripts run) and as the browser built it. Blocks that exist only
 *                     after scripts run are marked, with the token cost of each version.
 *   Fix pack          one ZIP holding every ready-made fix from the audit, filed by where it goes:
 *                     a merged robots.txt, the files to publish, server and header config, HTML
 *                     snippets, and a README. Files that describe services a site may not run go in
 *                     optional/ so nobody publishes a claim that is not true.
 *
 * Uses arFetch / arInfo / arFixFor (agent-*.js), shAudit (shell.js) and createZip (stylytics.js).
 */

/* ------------------------------------------------------------------ HTML to Markdown */
const AV_DROP = 'script, style, noscript, template, svg, canvas, iframe, object, embed, link, meta, head, select, option, button, input, textarea, dialog, audio, video';
const AV_CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"]';
const AV_HIDDEN = '[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"]';
const AV_BLOCKS = /^(p|div|section|article|main|ul|ol|li|h[1-6]|table|blockquote|pre|hr|figure|figcaption|details|summary|dl|dt|dd|form|fieldset|address|body|tr|thead|tbody|tfoot)$/;

function avWords(s) { return String(s || '').replace(/\]\([^)]*\)/g, '').replace(/[#*`>|\[\]!_~-]+/g, ' ').trim().split(/\s+/).filter(Boolean).length; }
const avTokens = (chars) => Math.ceil(chars / 4);
const avNorm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function avPickRoot(doc) {
  let best = null, len = 0;
  doc.querySelectorAll('main, [role="main"], article').forEach(el => { const l = (el.textContent || '').trim().length; if (l > len) { best = el; len = l; } });
  return best && len >= 200 ? best : doc.body;
}

// Converts a parsed document to Markdown blocks. Navigation, headers, footers and sidebars are left
// out when the whole body is used, because that is boilerplate an extractor would drop too.
function avToMarkdown(doc, base) {
  if (!doc || !doc.body) return { md: '', blocks: [], words: 0, headings: 0, links: 0 };
  doc.querySelectorAll(AV_DROP).forEach(n => n.remove());
  doc.querySelectorAll(AV_HIDDEN).forEach(n => n.remove());
  const root = avPickRoot(doc);
  if (root === doc.body) doc.querySelectorAll(AV_CHROME).forEach(n => n.remove());

  const abs = (h) => { try { return new URL(h, base).href; } catch (e) { return ''; } };
  const clean = (s) => s.replace(/\s+/g, ' ');
  const inline = (node) => {
    let out = '';
    node.childNodes.forEach(c => {
      if (c.nodeType === 3) { out += clean(c.nodeValue); return; }
      if (c.nodeType !== 1) return;
      const t = c.tagName.toLowerCase();
      if (t === 'br') { out += ' '; return; }
      if (t === 'img') { const alt = (c.getAttribute('alt') || '').trim(); if (alt) out += '![' + alt + '](' + abs(c.getAttribute('src') || '') + ')'; return; }
      if (AV_BLOCKS.test(t)) { out += ' ' + inline(c) + ' '; return; }
      const inner = inline(c);
      if (!inner.trim()) return;
      if (t === 'a') { const h = c.getAttribute('href') || ''; out += /^(#|javascript:|mailto:|tel:)/i.test(h) || !h ? inner : '[' + inner.trim() + '](' + abs(h) + ')'; }
      else if (t === 'strong' || t === 'b') out += '**' + inner.trim() + '**';
      else if (t === 'em' || t === 'i') out += '*' + inner.trim() + '*';
      else if (t === 'code') out += '`' + inner.trim() + '`';
      else out += inner;
    });
    return out;
  };

  const blocks = [];
  const push = (s) => { s = s.replace(/[ \t]+\n/g, '\n').trim(); if (s && blocks[blocks.length - 1] !== s) blocks.push(s); };
  const listLines = (list, depth) => {
    const lines = [];
    let n = 0;
    Array.from(list.children).forEach(li => {
      if (li.tagName.toLowerCase() !== 'li') return;
      n++;
      const clone = li.cloneNode(true);
      const nested = Array.from(clone.children).filter(x => /^(ul|ol)$/i.test(x.tagName));
      nested.forEach(x => x.remove());
      const text = inline(clone).trim();
      if (text) lines.push('  '.repeat(depth) + (list.tagName.toLowerCase() === 'ol' ? n + '. ' : '- ') + text);
      Array.from(li.children).filter(x => /^(ul|ol)$/i.test(x.tagName)).forEach(x => lines.push(...listLines(x, depth + 1)));
    });
    return lines;
  };
  const tableMd = (t) => {
    const rows = Array.from(t.querySelectorAll('tr')).map(tr => Array.from(tr.children).filter(c => /^(td|th)$/i.test(c.tagName)).map(c => inline(c).trim().replace(/\|/g, '\\|')));
    const w = Math.max.apply(null, rows.map(r => r.length).concat(0));
    if (!w || !rows.length) return '';
    const pad = (r) => '| ' + Array.from({ length: w }, (x, i) => r[i] || '').join(' | ') + ' |';
    return [pad(rows[0]), '|' + ' --- |'.repeat(w)].concat(rows.slice(1).map(pad)).join('\n');
  };

  const walk = (el) => {
    let buf = '';
    const flush = () => { push(buf); buf = ''; };
    el.childNodes.forEach(c => {
      if (c.nodeType === 3) { buf += clean(c.nodeValue); return; }
      if (c.nodeType !== 1) return;
      const t = c.tagName.toLowerCase();
      if (!AV_BLOCKS.test(t)) { buf += inline({ childNodes: [c] }); return; }
      flush();
      if (/^h[1-6]$/.test(t)) push('#'.repeat(+t[1]) + ' ' + inline(c).trim());
      else if (t === 'p' || t === 'dt' || t === 'dd' || t === 'figcaption' || t === 'summary') push(inline(c));
      else if (t === 'ul' || t === 'ol') push(listLines(c, 0).join('\n'));
      else if (t === 'table') push(tableMd(c));
      else if (t === 'pre') push('```\n' + (c.textContent || '').replace(/\s+$/, '') + '\n```');
      else if (t === 'hr') push('---');
      else if (t === 'blockquote') push(quote(c).split('\n').map(l => '> ' + l).join('\n'));
      else walk(c);
    });
    flush();
  };
  // a quote is walked with the same rules, then its blocks are lifted out and indented
  const quote = (el) => { const save = blocks.length; walk(el); return blocks.splice(save).join('\n\n'); };

  walk(root);
  const md = blocks.join('\n\n');
  return { md: md, blocks: blocks, words: avWords(md), headings: blocks.filter(b => /^#{1,6} /.test(b)).length, links: (md.match(/\]\(/g) || []).length, root: root === doc.body ? 'body' : root.tagName.toLowerCase() };
}

/* ------------------------------------------------------------------ what an AI sees: state and load */
const AV = { phase: 'idle', url: '', view: 'crawler', raw: null, rendered: null, rawHtmlBytes: 0, renderedHtmlBytes: 0, jsOnly: [], error: '', status: 0 };

function avReset(url) { Object.assign(AV, { phase: 'idle', url: url || '', raw: null, rendered: null, jsOnly: [], error: '', status: 0, rawHtmlBytes: 0, renderedHtmlBytes: 0 }); }

function avReadRendered(tabId, cb) {
  try {
    chrome.scripting.executeScript({ target: { tabId: tabId }, func: () => document.documentElement.outerHTML.slice(0, 3000000) }, (res) => {
      if (chrome.runtime.lastError || !res || !res[0] || typeof res[0].result !== 'string') { cb(null); return; }
      cb(res[0].result);
    });
  } catch (e) { cb(null); }
}

async function avLoad() {
  const url = SH.url;
  if (AV.phase === 'loading' || !/^https?:/i.test(url || '')) return;
  AV.phase = 'loading'; AV.url = url;
  const [rawRes, renderedHtml] = await Promise.all([
    arFetch(url, { headers: { Accept: 'text/html,application/xhtml+xml' }, max: 1572864, timeout: 12000 }),
    new Promise(res => avReadRendered(lastActiveTabId, res))
  ]);
  if (AV.url !== url) return;
  if (renderedHtml == null) { AV.phase = 'error'; AV.error = 'The page could not be read. Rescan and try again.'; shRerenderIfIdle(); return; }
  const parse = (h) => new DOMParser().parseFromString(h, 'text/html');
  AV.rendered = avToMarkdown(parse(renderedHtml), url);
  AV.renderedHtmlBytes = renderedHtml.length;
  if (rawRes.error || rawRes.status >= 400 || !rawRes.text) {
    AV.raw = { md: '', blocks: [], words: 0, headings: 0, links: 0 };
    AV.status = rawRes.status || 0;
    AV.error = rawRes.error ? 'The server did not answer an anonymous request.' : 'An anonymous request got HTTP ' + rawRes.status + ' instead of the page.';
  } else {
    AV.raw = avToMarkdown(parse(rawRes.text), rawRes.finalUrl || url);
    AV.rawHtmlBytes = rawRes.text.length;
    AV.status = rawRes.status;
  }
  // a block is "only after scripts" when its text is nowhere in what the crawler downloaded
  const rawText = avNorm(AV.raw.blocks.join(' '));
  AV.jsOnly = AV.rendered.blocks.map(b => {
    const k = avNorm(b);
    if (k.length < 4) return false;
    return !(rawText.indexOf(k) >= 0 || (k.length > 80 && rawText.indexOf(k.slice(0, 60)) >= 0));
  });
  AV.phase = 'done';
  shRerenderIfIdle();
}

/* ------------------------------------------------------------------ the screen */
function avBlockHtml(text, js) {
  return `<div class="av-b${js ? ' js' : ''}">${shEsc(text.length > 700 ? text.slice(0, 700) + '…' : text)}</div>`;
}

function avScreen(A) {
  if (!/^https?:/i.test(SH.url || '')) return insEmpty('globe', 'Nothing to read', 'This view works for web pages that load over http or https.');
  if (AV.phase === 'idle' || AV.url !== SH.url) { avReset(SH.url); setTimeout(avLoad, 0); AV.phase = 'idle'; }
  if (AV.phase === 'idle' || AV.phase === 'loading') return `<div class="sh-card"><div class="sh-empty"><b>Reading the page twice…</b>Once as a crawler downloads it, once as your browser built it.</div></div>`;
  if (AV.phase === 'error' && !AV.rendered) return insEmpty('alert', 'Could not read the page', shEsc(AV.error)) + `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="av" data-v="reload">Try again</button></div>`;

  const raw = AV.raw, ren = AV.rendered;
  const jsBlocks = ren.blocks.filter((b, i) => AV.jsOnly[i]);
  const jsWords = jsBlocks.reduce((n, b) => n + avWords(b), 0);
  const share = ren.words ? Math.round(jsWords / ren.words * 100) : 0;
  const crawlerEmpty = raw.words < 30 && ren.words >= 100;
  const tier = AV.error ? 'bad' : crawlerEmpty || share > 50 ? 'bad' : share > 10 ? 'warn' : 'ok';
  const headline = AV.error ? 'Crawlers did not get this page'
    : crawlerEmpty ? 'Crawlers get an almost empty page'
      : share > 50 ? 'Most of the text only appears after scripts run'
        : share > 10 ? 'Part of the text only appears after scripts run'
          : 'Crawlers see the same text you do';
  const sub = AV.error ? AV.error : `A crawler downloads about ${raw.words.toLocaleString()} words. Your browser shows ${ren.words.toLocaleString()}.${share > 10 ? ' Most AI crawlers do not run JavaScript, so the missing text can never be quoted.' : ''}`;

  const htmlTok = avTokens(AV.rawHtmlBytes || AV.renderedHtmlBytes), mdTok = avTokens((raw.md || ren.md).length);
  const saved = htmlTok ? Math.max(0, Math.round((1 - mdTok / htmlTok) * 100)) : 0;
  const mdn = AR.results && AR.results.markdownNegotiation && AR.results.markdownNegotiation.status === 'pass' ? AR.results.markdownNegotiation.details.tokens : null;

  let h = `<section class="sh-card ar-hero ${tier}"><div class="av-verdict"><span class="ar-ic ${tier}">${shIcon(tier === 'ok' ? 'check' : 'alert', 14)}</span><div><b>${shEsc(headline)}</b><small>${shEsc(sub)}</small></div></div></section>`;
  h += insTiles([['Crawler sees', raw.words.toLocaleString() + ' words', raw.words >= ren.words * 0.9 ? 'ok' : tier], ['Browser shows', ren.words.toLocaleString() + ' words'], ['Only after scripts', jsWords.toLocaleString() + ' (' + share + '%)', share > 10 ? tier : 'ok'], ['Markdown vs HTML', saved + '% fewer tokens', saved >= 50 ? 'ok' : '']]);
  h += `<p class="ins-note" style="margin:0 0 8px">The HTML is about ${htmlTok.toLocaleString()} tokens; the same text as Markdown is about ${mdTok.toLocaleString()}.${mdn ? ` Your server’s own Markdown version reports ${Number(mdn).toLocaleString()}.` : ''} Token counts are estimates (four characters each).</p>`;

  const views = [['crawler', 'What crawlers get'], ['browser', 'What browsers show'], ['missing', 'Missing for AI']];
  h += `<div class="segmented av-views" role="group" aria-label="View">${views.map(v => `<button type="button" class="tag${AV.view === v[0] ? ' active' : ''}" data-sh="av" data-v="view" data-w="${v[0]}">${v[1]}${v[0] === 'missing' ? ` <em>${jsBlocks.length}</em>` : ''}</button>`).join('')}</div>`;

  let rows, total;
  if (AV.view === 'crawler') { rows = raw.blocks.map(b => [b, false]); total = raw.blocks.length; }
  else if (AV.view === 'browser') { rows = ren.blocks.map((b, i) => [b, AV.jsOnly[i]]); total = ren.blocks.length; }
  else { rows = jsBlocks.map(b => [b, true]); total = jsBlocks.length; }
  const CAP = 200;
  // a long page is cut at CAP blocks, but a block that scripts add must never fall off the end
  const shown = rows.slice(0, CAP).concat(rows.slice(CAP).filter(r => r[1]));
  if (!rows.length) h += `<div class="sh-card"><div class="sh-empty"><b>${AV.view === 'missing' ? 'Nothing is missing' : 'No readable text'}</b>${AV.view === 'missing' ? 'Every block of text in the browser view is also in the HTML crawlers download.' : 'No text was found in this view.'}</div></div>`;
  else h += `<div class="sh-card av-doc">${shown.map(r => avBlockHtml(r[0], r[1])).join('')}${total > shown.length ? `<p class="ins-note" style="padding:8px 12px">Showing ${shown.length} of ${total} blocks, including every block that only appears after scripts run. Copy the Markdown for the rest.</p>` : ''}</div>`;
  if (AV.view === 'browser' && jsBlocks.length) h += `<p class="ins-note">Highlighted blocks are in the browser view but not in the HTML crawlers download.</p>`;

  h += `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="av" data-v="copy">${shIcon('copy', 13)} Copy Markdown</button>
      <button type="button" class="sh-btn sm" data-sh="av" data-v="download">${shIcon('download', 13)} Save .md</button>
      <button type="button" class="sh-btn sm" data-sh="av" data-v="reload">${shIcon('refresh', 13)} Read again</button></div>
    <p class="ins-note">The crawler view is one anonymous request: no cookies and no scripts run. Menus, headers, footers and sidebars are left out of both views, as a content extractor would.</p>`;
  return h;
}

function avCurrentMd() {
  if (AV.view === 'crawler') return AV.raw.md;
  if (AV.view === 'browser') return AV.rendered.md;
  return AV.rendered.blocks.filter((b, i) => AV.jsOnly[i]).join('\n\n');
}

function avDownload(blob, filename, message) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url: url, filename: filename }, () => {
    if (chrome.runtime.lastError) window.open(url, '_blank'); else showToast(message);
  });
}

function avHandle(op, el) {
  const ds = el.dataset || {};
  switch (op) {
    case 'view': AV.view = ds.w; shRender(); break;
    case 'reload': avReset(SH.url); shRender(); break;
    case 'copy': if (AV.raw) copyToClipboard(avCurrentMd(), 'Markdown copied'); break;
    case 'download': {
      if (!AV.raw) break;
      let host = 'page'; try { host = new URL(SH.url).hostname; } catch (e) { /* default */ }
      avDownload(new Blob([avCurrentMd()], { type: 'text/markdown' }), `${host}-${AV.view}.md`, 'Markdown saved');
      break;
    }
    case 'fixpack': avFixPack(); break;
  }
}

/* ------------------------------------------------------------------ fix pack */
const avEnc = (s) => new TextEncoder().encode(s);
const AV_SAFE_FILES = ['/sitemap.xml', '/llms.txt'];

// robots.txt with the fixes merged into the file that is live now, instead of loose lines to place by hand
function avMergeRobots(existing, d, issues) {
  const info = arInfo(d), o = info.origin || 'https://example.com';
  const failed = (id) => AR.results[id] && AR.results[id].status === 'fail';
  const changes = [];
  const valid = !!existing && /^\s*user-agent\s*:/im.test(existing);
  const kept = existing ? existing.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n') : [];
  let lines = valid ? kept : ['User-agent: *', 'Allow: /'].concat(kept.length ? [''].concat(kept) : []);
  if (!valid) changes.push(existing ? 'Added a User-agent group, which the existing file was missing' : 'Created a basic robots.txt (none was found)');
  const hasGroup = (bot) => lines.some(l => new RegExp('^\\s*user-agent\\s*:\\s*' + bot.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '\\s*$', 'i').test(l));

  if (failed('contentSignals')) {
    const sig = 'Content-Signal: ai-train=no, search=yes, ai-input=yes';
    const at = lines.findIndex(l => /^\s*user-agent\s*:\s*\*\s*$/i.test(l));
    if (at >= 0) { let j = at; while (j + 1 < lines.length && /^\s*user-agent\s*:/i.test(lines[j + 1])) j++; lines.splice(j + 1, 0, sig); }
    else lines.push('', 'User-agent: *', sig, 'Allow: /');
    changes.push('Added a Content-Signal line (ai-train=no, search=yes, ai-input=yes). Change the answers to match your policy.');
  }

  const rt = (typeof lastSiteFilesResult !== 'undefined' && lastSiteFilesResult && lastSiteFilesResult.robotsTxt) || {};
  const allow = issues.some(i => i.label === 'Crawler Access') ? (rt.blockedAiSearch || []).slice() : [];
  if (!valid || failed('robotsTxtAiRules')) ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'ChatGPT-User', 'Claude-User', 'Perplexity-User'].forEach(b => { if (!hasGroup(b) && allow.indexOf(b) < 0) allow.push(b); });
  if (allow.length) {
    lines.push('', '# AI search and on-request fetchers: allowed so the site can be cited in AI answers');
    allow.forEach(b => lines.push('User-agent: ' + b, 'Allow: /', ''));
    lines.pop();
    changes.push('Allowed ' + allow.join(', ') + ' (these bots build AI answers or fetch a page when someone asks)');
  }
  if (!valid || failed('robotsTxtAiRules')) {
    lines.push('', '# AI training crawlers: your choice. Remove the # to opt out of model training.');
    ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot'].filter(b => !hasGroup(b)).forEach(b => lines.push('# User-agent: ' + b, '# Disallow: /', ''));
    lines.pop();
    changes.push('Added the main training crawlers as commented-out blocks for you to switch on');
  }
  if (!lines.some(l => /^\s*sitemap\s*:/i.test(l))) {
    const sm = AR.results.sitemap && AR.results.sitemap.status === 'pass' && AR.results.sitemap.details && AR.results.sitemap.details.url;
    lines.push('', 'Sitemap: ' + (sm || o + '/sitemap.xml'));
    changes.push('Added a Sitemap line');
  }
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n', changes: changes };
}

const AV_HEADER_OK = /^(Link|Strict-Transport-Security|Content-Security-Policy|X-Content-Type-Options|X-Frame-Options|Referrer-Policy|Permissions-Policy)$/i;

function avHeaderPairs(withFix) {
  const pairs = [];
  withFix.filter(i => i.fixCode.where === 'headers').forEach(i => {
    i.fixCode.code.split('\n').forEach(line => {
      const m = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s+(.+?)\s*$/);
      if (!m || !AV_HEADER_OK.test(m[1]) || /\(.*(only|set by)/i.test(m[2])) return;
      if (/^link$/i.test(m[1]) && /<\/docs>/.test(m[2])) return;      // a placeholder address, not a real page
      if (!pairs.some(p => p[0] === m[1] && p[1] === m[2])) pairs.push([m[1], m[2]]);
    });
  });
  return pairs;
}

async function avFixPack() {
  if (!lastExtractedData) { showToast('Scan a page first'); return; }
  const A = shAudit();
  if (!A) { showToast('Scan a page first'); return; }
  const d = A.data, info = arInfo(d), host = info.host || 'site';
  const seen = new Set(), issues = [];
  A.cats.forEach(c => c.issues.forEach(i => { if (!seen.has(i.t)) { seen.add(i.t); issues.push(i); } }));
  const withFix = issues.filter(i => i.fixCode && i.fixCode.code);
  const files = [], manifest = [];
  const add = (name, text, purpose, fixes) => { if (files.some(f => f.name === name)) return; files.push({ name: name, data: avEnc(text) }); manifest.push({ name: name, purpose: purpose, fixes: fixes || [] }); };

  // robots.txt: merged into the live file
  const rtext = AR.robotsText || '';
  const rob = avMergeRobots(rtext, d, issues);
  const robotsFixes = withFix.filter(i => i.fixCode.where === 'robots').map(i => i.t);
  if (rob.changes.length) add('site/robots.txt', rob.text, 'Your robots.txt with the changes merged in. Review it, then replace the live file.', robotsFixes);

  // files to publish, split into safe ones and ones that describe a service the site may not run
  withFix.filter(i => i.fixCode.where === 'file' && i.fixCode.path).forEach(i => {
    const p = i.fixCode.path, safe = AV_SAFE_FILES.indexOf(p) >= 0;
    add((safe ? 'site' : 'optional/site') + p, i.fixCode.code + '\n', safe ? 'Publish at ' + info.origin + p : 'Only publish if it is true for your site. ' + (i.fixCode.note || ''), [i.t]);
  });

  // headers in every common format
  const pairs = avHeaderPairs(withFix);
  if (pairs.length) {
    const names = { raw: 'headers.txt', nginx: 'nginx-headers.conf', apache: 'apache.htaccess', netlify: '_headers', vercel: 'vercel-headers.json', cloudflare: 'cloudflare-transform-rule.txt' };
    arHeaderVariants(pairs).forEach(v => add('server/headers/' + names[v.id], v.code + '\n', (v.id === 'raw' ? 'The response headers as plain lines' : 'The response headers as ' + v.label + ' config') + '. Test the Content-Security-Policy on a staging copy first.', withFix.filter(i => i.fixCode.where === 'headers').map(i => i.t)));
  }

  // server code, DNS and HTML snippets
  withFix.filter(i => i.fixCode.where === 'server').forEach(i => {
    const def = AR_DEFS.filter(x => x.t === i.t)[0];
    if (!def) return;
    const fx = arFixFor(def.id, d);
    const vs = fx && fx.variants && fx.variants.length ? fx.variants : [{ id: 'code', label: 'Code', code: i.fixCode.code }];
    const ext = { worker: 'worker.js', express: 'express.js', nginx: 'nginx.conf', code: 'js' };
    const dir = def.group === 'commerce' ? 'optional/server/' : 'server/';
    vs.forEach(v => add(dir + def.id + '-' + (ext[v.id] || v.id), (v.code != null ? v.code : fx.code) + '\n', i.t + ' (' + v.label + ')', [i.t]));
  });
  withFix.filter(i => i.fixCode.where === 'dns').forEach(i => add('optional/dns/' + i.t.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.txt', i.fixCode.code + '\n', 'DNS records. Sign the zone with DNSSEC.', [i.t]));

  const SNIP = { head: ['snippets/head.html', 'Paste inside <head>'], json: ['snippets/structured-data.html', 'Paste inside <head> (structured data)'], html: ['snippets/html-tag.txt', 'Change the <html> tag'], body: ['snippets/body-changes.html', 'Changes to make in your page HTML'], css: ['snippets/styles.css', 'Add to your stylesheet'] };
  Object.keys(SNIP).forEach(w => {
    const items = withFix.filter(i => i.fixCode.where === w);
    if (!items.length) return;
    const cm = w === 'css' ? ['/* ', ' */'] : w === 'html' ? ['# ', ''] : ['<!-- ', ' -->'];
    add(SNIP[w][0], items.map(i => cm[0] + i.t + cm[1] + '\n' + i.fixCode.code).join('\n\n') + '\n', SNIP[w][1], items.map(i => i.t));
  });

  // one prompt for a coding agent covering the failing agent-standard checks
  const failing = arScoredIds(arProfile()).filter(id => AR.results[id] && AR.results[id].status === 'fail');
  if (failing.length) add('AGENT-PROMPT.md', `# Make ${host} agent-ready\n\nHand this to a coding agent. Each task is independent. Skip any that describe a service the site does not offer.\n\n` + failing.map(id => '## ' + AR_DEF[id].t + '\n\n' + arPrompt(id, d)).join('\n\n---\n\n') + '\n', 'A prompt for a coding agent covering the failing agent-readiness checks.', failing.map(id => AR_DEF[id].t));

  if (!files.length) { showToast('Nothing to fix: no ready-made fixes were found'); return; }

  const lv = arLevel(AR.results), sc = arScore(AR.results, arProfile());
  const aiCat = A.cats.filter(c => c.id === 'ai')[0];
  const readme = [`# Fix pack for ${host}`, '', `Made by Stylytics on ${new Date().toISOString().slice(0, 10)} from ${info.url}`,
    `Page health ${A.composite == null ? 'n/a' : A.composite}/100 · AI readiness ${aiCat && aiCat.score != null ? aiCat.score : 'n/a'} · Agent level ${lv.level} (${lv.name})${sc.score == null ? '' : ', agent score ' + sc.score}`, '',
    '## Read this first', '',
    '- These are drafts built from what the scan found. Names, addresses and wording that need a person are marked with <angle brackets> or placeholders.',
    '- `site/` holds files that are safe to publish as they are. `optional/` holds files that describe services you may not run (an MCP server, OAuth, an A2A agent, payments). **Publish one only if it is true.**',
    '- Test header changes, especially Content-Security-Policy and HSTS, on a staging copy first.', '', '## What is inside', '',
    ...manifest.map(m => `- \`${m.name}\` — ${m.purpose}${m.fixes.length ? ' _(fixes: ' + m.fixes.join('; ') + ')_' : ''}`), ''];
  if (rob.changes.length) readme.push('## robots.txt changes', '', ...rob.changes.map(c => '- ' + c), '');
  readme.push('## After you deploy', '', 'Open the page in Stylytics and press rescan. The agent readiness screen re-checks every file and shows the new level.', '');
  add('README.md', readme.join('\n'), 'This file.', []);
  // the README goes first in the archive
  files.unshift(files.pop());

  avDownload(createZip(files), `fix-pack-${host}.zip`, `Fix pack saved (${files.length} files)`);
}

/* ------------------------------------------------------------------ registration */
SH_SCREENS.aiview = { title: 'What an AI sees', build: avScreen };
SH_CATS.filter(c => c.id === 'ai')[0].explore = [['aiview', 'What an AI sees', 'The page as a model reads it, with what scripts hide', 'eye']];
SH_TOOLS.Page.push(['aiview', 'What AI sees', 'eye']);
SH_TOOL_META.aiview = 'Markdown view, tokens, JS-only text';
SH_TOOL_KEYWORDS.aiview = 'ai sees crawler markdown tokens javascript rendering ssr llm view raw html gptbot';

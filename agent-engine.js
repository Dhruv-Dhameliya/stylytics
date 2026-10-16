/* agent-engine.js — the agent-readiness scanner.
 *
 * Checks whether a site speaks the emerging standards AI agents look for (robots.txt AI rules,
 * Content Signals, Link headers, Markdown negotiation, API catalog, OAuth metadata, MCP server card,
 * A2A agent card, Agent Skills, WebMCP, ARD, DNS-AID and the agentic-commerce protocols), then works
 * out an agent-readiness level (0-5) and a 0-100 score.
 *
 * The rules follow what isitagentready.com publishes: the same well-known paths, the same fallbacks,
 * the same pass conditions and the same level ladder. Every request is made from this browser with
 * no cookies, so what is judged is what an anonymous crawler gets.
 *
 * This file has no screen code. agent-geo.js adds the page-level AI and SEO checks, agent-ui.js draws
 * everything. Anything here that touches the page or the panel is guarded so the parsers can also be
 * run from Node for testing.
 */

/* ------------------------------------------------------------------ constants */
const AR_LEVELS = ['Not Ready', 'Basic Web Presence', 'Bot-Aware', 'Agent-Readable', 'Agent-Integrated', 'Agent-Native'];
const AR_GROUPS = [
  { id: 'discoverability', name: 'Discoverability', blurb: 'Can agents find your pages?' },
  { id: 'content', name: 'Content', blurb: 'Can agents read them cheaply?' },
  { id: 'bots', name: 'Bot access control', blurb: 'Do you say what AI may do with your content?' },
  { id: 'discovery', name: 'APIs, auth, MCP & skills', blurb: 'Can agents find and use your tools?' },
  { id: 'commerce', name: 'Commerce', blurb: 'Can agents pay you? Optional, never part of the score.' }
];
// the scanner's "Content Site" and "API / Application" presets
const AR_CONTENT_IDS = ['robotsTxt', 'sitemap', 'linkHeaders', 'dnsAid', 'markdownNegotiation', 'robotsTxtAiRules', 'contentSignals'];
const AR_APP_IDS = AR_CONTENT_IDS.concat(['webBotAuth', 'apiCatalog', 'oauthDiscovery', 'oauthProtectedResource', 'authMd', 'mcpServerCard', 'agentSkills', 'webMcp', 'ard']);
const AR_PROFILES = [['auto', 'Auto'], ['content', 'Content site'], ['app', 'API & app']];
const AR_CACHE_MS = 10 * 60 * 1000;

// kind: training = collects pages to train models; search = builds the index answer engines cite;
// user = fetches a page when a person asks about it
const AR_BOTS = [
  { id: 'GPTBot', vendor: 'OpenAI', kind: 'training' }, { id: 'OAI-SearchBot', vendor: 'OpenAI', kind: 'search' }, { id: 'ChatGPT-User', vendor: 'OpenAI', kind: 'user' },
  { id: 'ClaudeBot', vendor: 'Anthropic', kind: 'training' }, { id: 'Claude-SearchBot', vendor: 'Anthropic', kind: 'search' }, { id: 'Claude-User', vendor: 'Anthropic', kind: 'user' },
  { id: 'anthropic-ai', vendor: 'Anthropic', kind: 'training' }, { id: 'Claude-Web', vendor: 'Anthropic', kind: 'user' },
  { id: 'Google-Extended', vendor: 'Google', kind: 'training' }, { id: 'Googlebot', vendor: 'Google', kind: 'search' },
  { id: 'PerplexityBot', vendor: 'Perplexity', kind: 'search' }, { id: 'Perplexity-User', vendor: 'Perplexity', kind: 'user' },
  { id: 'Bingbot', vendor: 'Microsoft', kind: 'search' },
  { id: 'Applebot', vendor: 'Apple', kind: 'search' }, { id: 'Applebot-Extended', vendor: 'Apple', kind: 'training' },
  { id: 'Meta-ExternalAgent', vendor: 'Meta', kind: 'training' }, { id: 'Meta-ExternalFetcher', vendor: 'Meta', kind: 'user' },
  { id: 'Amazonbot', vendor: 'Amazon', kind: 'training' }, { id: 'CCBot', vendor: 'Common Crawl', kind: 'training' },
  { id: 'Bytespider', vendor: 'ByteDance', kind: 'training' }, { id: 'cohere-ai', vendor: 'Cohere', kind: 'training' },
  { id: 'MistralAI-User', vendor: 'Mistral', kind: 'user' }, { id: 'DuckAssistBot', vendor: 'DuckDuckGo', kind: 'user' },
  { id: 'YouBot', vendor: 'You.com', kind: 'search' }, { id: 'Diffbot', vendor: 'Diffbot', kind: 'training' }
];
const AR_KIND_LABEL = { training: 'Training', search: 'AI search', user: 'On request' };
const AR_USEFUL_LINK_RELS = ['api-catalog', 'service-desc', 'service-doc', 'describedby'];

/* ------------------------------------------------------------------ fetching */
async function arReadText(res, max) {
  try {
    if (!res.body || !res.body.getReader) { const t = await res.text(); return { text: t.slice(0, max), truncated: t.length > max, bytes: t.length }; }
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let out = '', n = 0, truncated = false;
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      out += dec.decode(value, { stream: true });
      if (n >= max) { truncated = true; try { reader.cancel(); } catch (e) { /* done */ } break; }
    }
    return { text: out, truncated, bytes: n };
  } catch (e) { return { text: '', truncated: false, bytes: 0, readError: true }; }
}

// One anonymous request. Never throws. `error` is 'timeout' or 'network' when there is no response.
async function arFetch(url, opt) {
  opt = opt || {};
  const ctrl = new AbortController();
  const t0 = Date.now();
  const timer = setTimeout(() => ctrl.abort(), opt.timeout || 8000);
  try {
    const res = await fetch(url, { method: opt.method || 'GET', headers: opt.headers || {}, signal: ctrl.signal, redirect: 'follow', credentials: 'omit', cache: 'no-store' });
    const r = {
      url: url, finalUrl: res.url || url, redirected: !!res.redirected, status: res.status, ok: res.ok, headers: res.headers,
      ctype: (res.headers.get('content-type') || '').toLowerCase(), text: '', truncated: false, bytes: 0, ms: 0
    };
    if ((opt.method || 'GET') !== 'HEAD') {
      const body = await arReadText(res, opt.max || 262144);
      r.text = body.text; r.truncated = body.truncated; r.bytes = body.bytes;
    }
    r.ms = Date.now() - t0;
    return r;
  } catch (e) {
    return { url: url, error: ctrl.signal.aborted ? 'timeout' : 'network', status: 0, ms: Date.now() - t0, headers: null, ctype: '', text: '' };
  } finally { clearTimeout(timer); }
}

const arLooksHtml = (r) => !!r && (/html/.test(r.ctype || '') || /^\s*(<!doctype html|<html|<head|<body)/i.test(r.text || ''));
function arParseJson(r) {
  if (!r || r.error || !r.text) return null;
  try { const v = JSON.parse(r.text.replace(/^﻿/, '')); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}
// Servers that expose only the seven "safe" headers (a CORS-filtered response) cannot be judged on headers.
function arHeadersLimited(h) {
  if (!h) return true;
  const SAFE = ['cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma'];
  let n = 0, other = 0;
  try { h.forEach((v, k) => { n++; if (SAFE.indexOf(k.toLowerCase()) < 0) other++; }); } catch (e) { return true; }
  return n > 0 && other === 0;
}
const arPath = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch (e) { return u; } };
const arShort = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const arPlural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

// an evidence row: what was requested and what came back
function arEv(label, r, outcome, summary) {
  const e = { label: label, outcome: outcome || 'neutral', summary: summary || '' };
  if (r) { e.url = r.url; if (r.error) e.error = r.error; else { e.status = r.status; if (r.ctype) e.ctype = r.ctype.split(';')[0]; } }
  return e;
}

/* ------------------------------------------------------------------ robots.txt (RFC 9309) */
function arParseRobots(text) {
  const out = { groups: [], sitemaps: [], signals: [], agentmaps: [], rules: 0, agentLines: 0 };
  let cur = null, lastWasAgent = false;
  String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const i = line.indexOf(':');
    if (i < 1) return;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      out.agentLines++;
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], signals: null }; out.groups.push(cur); }
      cur.agents.push(val);
      lastWasAgent = true;
      return;
    }
    lastWasAgent = false;
    if (key === 'sitemap') { if (val) out.sitemaps.push(val); return; }
    if (key === 'agentmap' || key === 'ai-catalog' || key === 'ard') { if (val) out.agentmaps.push(val); return; }
    if (key === 'content-signal' || key === 'content-signals') {
      const sig = { userAgent: cur ? cur.agents.join(', ') : '*', raw: val, aiTrain: null, search: null, aiInput: null, valid: false };
      val.split(',').forEach((part) => {
        const m = part.trim().toLowerCase().match(/^(ai-train|search|ai-input)\s*=\s*(yes|no)$/);
        if (!m) return;
        sig[m[1] === 'ai-train' ? 'aiTrain' : m[1] === 'ai-input' ? 'aiInput' : 'search'] = m[2];
        sig.valid = true;
      });
      out.signals.push(sig);
      if (cur) cur.signals = sig;
      return;
    }
    if ((key === 'allow' || key === 'disallow') && cur) { cur.rules.push({ type: key, path: val }); out.rules++; }
  });
  return out;
}

function arPatternRe(pat) {
  let anchored = false;
  if (pat.slice(-1) === '$') { anchored = true; pat = pat.slice(0, -1); }
  return new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : ''));
}

// Whether `agent` may fetch `path` (path plus query). The most specific user-agent group wins, the
// longest matching rule wins inside it, and allow beats disallow on a tie.
function arRobotsAccess(parsed, agent, path) {
  path = path || '/';
  const lc = String(agent).toLowerCase();
  let groups = parsed.groups.filter(g => g.agents.some(a => a.toLowerCase() === lc));
  let source = 'explicit';
  if (!groups.length) { groups = parsed.groups.filter(g => g.agents.indexOf('*') >= 0); source = 'wildcard'; }
  if (!groups.length) return { allowed: true, source: 'default', rule: null };
  let best = null;
  groups.forEach(g => g.rules.forEach(r => {
    if (!r.path) return;               // an empty Disallow allows everything
    let re; try { re = arPatternRe(r.path); } catch (e) { return; }
    if (!re.test(path)) return;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.type === 'allow' && best.type !== 'allow')) best = { len: len, type: r.type, path: r.path };
  }));
  return { allowed: !best || best.type === 'allow', source: source, rule: best ? best.type + ': ' + best.path : null };
}

function arAiPolicies(parsed, path) {
  return AR_BOTS.map(b => {
    const a = arRobotsAccess(parsed, b.id, path);
    return { id: b.id, vendor: b.vendor, kind: b.kind, allowed: a.allowed, source: a.source, rule: a.rule };
  });
}

/* ------------------------------------------------------------------ other parsers */
function arParseLinkHeader(h) {
  const out = [];
  if (!h) return out;
  const entry = /<([^>]*)>((?:\s*;\s*[\w*-]+\s*(?:=\s*(?:"[^"]*"|[^;,\s]*))?\s*)*)/g;
  let m;
  while ((m = entry.exec(h))) {
    const params = {};
    const pr = /;\s*([\w*-]+)\s*(?:=\s*(?:"([^"]*)"|([^;,\s]*)))?/g;
    let p;
    while ((p = pr.exec(m[2]))) params[p[1].toLowerCase()] = p[2] != null ? p[2] : (p[3] || '');
    out.push({ href: m[1], rels: String(params.rel || '').toLowerCase().split(/\s+/).filter(Boolean), type: params.type || '', params: params });
  }
  return out;
}

function arParseSitemap(r) {
  const t = r.text || '';
  if (/<urlset[\s>]/i.test(t) || /<sitemapindex[\s>]/i.test(t)) {
    const locs = (t.match(/<loc>/gi) || []).length;
    return { format: 'xml', index: /<sitemapindex/i.test(t), urls: locs, partial: r.truncated };
  }
  if (/gzip|x-gzip/.test(r.ctype || '') || /\.gz(\?|$)/i.test(r.url)) return { format: 'gz', index: false, urls: 0, partial: false };
  const lines = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length && !arLooksHtml(r) && lines.slice(0, 20).every(l => /^https?:\/\//i.test(l))) return { format: 'txt', index: false, urls: lines.length, partial: r.truncated };
  return null;
}

/* ------------------------------------------------------------------ scan context */
// One scan of one page: shared requests are made once and reused by every check that needs them.
function arMakeCtx(pageUrl, opts) {
  const u = new URL(pageUrl);
  const memo = {};
  const once = (k, fn) => (memo[k] = memo[k] || fn());
  const c = {
    url: pageUrl, origin: u.origin, host: u.hostname, pagePath: u.pathname + u.search, opts: opts || {},
    isLocal: /^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) || u.hostname.indexOf('.') < 0 || /\.(local|test|internal|localhost)$/.test(u.hostname),
    get: (path, o) => once('GET ' + path + '|' + JSON.stringify((o && o.headers) || {}), () => arFetch(c.origin + path, o)),
    json: async (path, o) => { const r = await c.get(path, o); return { r: r, json: arParseJson(r) }; },
    robots: () => once('robots', async () => {
      const r = await c.get('/robots.txt');
      const ok = !r.error && r.status === 200 && !arLooksHtml(r);
      const parsed = ok ? arParseRobots(r.text) : null;
      return { r: r, parsed: parsed, valid: !!(parsed && parsed.agentLines > 0) };
    }),
    page: () => once('page', () => arFetch(pageUrl, { headers: { Accept: 'text/html,application/xhtml+xml' }, max: 1572864, timeout: 12000 }))
  };
  return c;
}

// why a well-known file failed, in the words a person would use
function arWhy(r, json) {
  if (r.error) return r.error === 'timeout' ? 'The request timed out' : 'The request failed';
  if (r.status === 404 || r.status === 410) return 'Not found (HTTP ' + r.status + ')';
  if (r.status >= 400) return 'The server answered HTTP ' + r.status;
  if (arLooksHtml(r)) return 'The address returns a web page, not data (the site answers every path with HTML)';
  if (!json) return 'The response is not valid JSON';
  return 'The response is not in the expected format';
}
const arUnable = (r) => !!r && !!r.error;

async function arGetJsonFile(c, paths, ev) {
  // first path that returns usable JSON; remembers the last response for the explanation
  let last = null, anyOk = false, errors = 0;
  for (const p of paths) {
    const { r, json } = await c.json(p);
    last = { r: r, json: json, path: p };
    if (r.error) { errors++; ev.push(arEv('GET ' + p, r, 'negative', r.error === 'timeout' ? 'Timed out' : 'Network error')); continue; }
    if (json) { ev.push(arEv('GET ' + p, r, 'positive', 'Valid JSON (HTTP ' + r.status + ')')); anyOk = true; return { hit: last, errors: errors, all: errors === paths.length }; }
    ev.push(arEv('GET ' + p, r, 'negative', arWhy(r, json)));
  }
  return { hit: null, last: last, errors: errors, all: errors === paths.length };
}

/* ------------------------------------------------------------------ DNS over HTTPS */
async function arDoh(name, type) {
  const bases = [['https://cloudflare-dns.com/dns-query?name=', '&do=1'], ['https://dns.google/resolve?name=', '']];
  for (const b of bases) {
    const r = await arFetch(b[0] + encodeURIComponent(name) + '&type=' + type + b[1], { headers: { Accept: 'application/dns-json' }, timeout: 5000, max: 65536 });
    if (!r.error && r.status === 200) { const j = arParseJson(r); if (j) return { ok: true, json: j }; }
  }
  return { ok: false };
}
const AR_DNS_TYPES = { SVCB: 64, HTTPS: 65, TXT: 16, SRV: 33 };
const arDnsAnswers = (res, type) => (res.ok && res.json.Status === 0 && Array.isArray(res.json.Answer)) ? res.json.Answer.filter(a => a.type === AR_DNS_TYPES[type]) : [];

/* ------------------------------------------------------------------ check definitions */
// run(c) returns { status: pass|fail|unable|info, message, details, evidence }. Fixes are written per
// check in agent-geo.js. `optional` checks are shown but never change the score (see arScoredIds).
const AR_DEFS = [
  {
    id: 'robotsTxt', group: 'discoverability', label: 'robots.txt is published', t: 'Publish a robots.txt', sev: 'High', path: '/robots.txt',
    goal: 'Tell crawlers what they may fetch and where your sitemap is.',
    mean: 'robots.txt is the first file every crawler and agent asks for. Without a valid one, bots guess, and some assume they may take everything.',
    fix: 'Serve a plain-text robots.txt at the site root with at least one User-agent group and a Sitemap line.',
    spec: [['RFC 9309', 'https://www.rfc-editor.org/rfc/rfc9309']],
    async run(c) {
      const ev = [], ro = await c.robots(), r = ro.r;
      if (r.error) return { status: 'unable', message: 'Could not fetch robots.txt: ' + arWhy(r), evidence: [arEv('GET /robots.txt', r, 'negative', arWhy(r))] };
      if (r.status !== 200) return { status: 'fail', message: 'robots.txt not found (HTTP ' + r.status + ')', evidence: [arEv('GET /robots.txt', r, 'negative', 'HTTP ' + r.status)] };
      if (arLooksHtml(r)) return { status: 'fail', message: 'robots.txt returns a web page instead of text', evidence: [arEv('GET /robots.txt', r, 'negative', 'Content-Type ' + (r.ctype || 'unknown'))] };
      ev.push(arEv('GET /robots.txt', r, 'positive', 'Received robots.txt (' + r.bytes + ' bytes)'));
      if (!ro.valid) return { status: 'fail', message: 'robots.txt has no User-agent directive', evidence: ev.concat(arEv('Validate structure', null, 'negative', 'No User-agent line found')) };
      ev.push(arEv('Validate structure', null, 'positive', arPlural(ro.parsed.groups.length, 'group') + ', ' + arPlural(ro.parsed.rules, 'rule')));
      return { status: 'pass', message: 'robots.txt exists with valid format', details: { groups: ro.parsed.groups.length, rules: ro.parsed.rules, sitemaps: ro.parsed.sitemaps.length }, evidence: ev };
    }
  },
  {
    id: 'sitemap', group: 'discoverability', label: 'A sitemap is published', t: 'Publish a sitemap', sev: 'Medium', path: '/sitemap.xml',
    goal: 'List the canonical URLs you want found.',
    mean: 'A sitemap hands crawlers and agents your full list of pages instead of making them follow links.',
    fix: 'Publish /sitemap.xml (or a sitemap index) and reference it from robots.txt with a Sitemap line.',
    spec: [['Sitemaps protocol', 'https://www.sitemaps.org/protocol.html']],
    async run(c) {
      const ev = [], ro = await c.robots();
      const fromRobots = ro.valid ? ro.parsed.sitemaps.slice(0, 3) : [];
      if (fromRobots.length) ev.push(arEv('Read Sitemap lines in robots.txt', null, 'positive', arPlural(fromRobots.length, 'Sitemap line') + ' found'));
      const cand = fromRobots.map(u => ({ url: u, robots: true })).concat(['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'].map(p => ({ url: c.origin + p, robots: false })));
      const seen = new Set();
      let errors = 0, tried = 0;
      for (const cd of cand) {
        if (seen.has(cd.url)) continue;
        seen.add(cd.url);
        if (!cd.robots && fromRobots.length && tried >= fromRobots.length + 1) break;
        tried++;
        const r = await arFetch(cd.url, { timeout: 8000, max: 524288 });
        const label = 'GET ' + arPath(cd.url);
        if (r.error) { errors++; ev.push(arEv(label, r, 'negative', 'Network error')); continue; }
        const sm = r.status === 200 ? arParseSitemap(r) : null;
        if (sm) {
          ev.push(arEv(label, r, 'positive', 'Valid ' + sm.format + ' sitemap' + (sm.urls ? ' with ' + (sm.partial ? 'at least ' : '') + arPlural(sm.urls, 'URL') : '')));
          return { status: 'pass', message: 'sitemap exists with valid structure', details: { url: cd.url, fromRobotsTxt: cd.robots, format: sm.format, index: sm.index, urls: sm.urls }, evidence: ev };
        }
        ev.push(arEv(label, r, 'negative', r.status !== 200 ? 'HTTP ' + r.status : (arLooksHtml(r) ? 'Returns a web page' : 'Not a sitemap')));
      }
      if (errors && errors === tried) return { status: 'unable', message: 'Could not fetch a sitemap: the requests failed', evidence: ev };
      return { status: 'fail', message: 'No sitemap found', evidence: ev };
    }
  },
  {
    id: 'linkHeaders', group: 'discoverability', label: 'Link headers point agents to resources', t: 'Add Link response headers', sev: 'Medium', path: 'Response headers',
    goal: 'Advertise machine-readable resources in the HTTP response of your pages.',
    mean: 'Agents read response headers before the page. A Link header can point straight at your API catalog, docs, or an llms.txt without any HTML parsing.',
    fix: 'Send Link headers with the relation types api-catalog, service-desc, service-doc or describedby (or alternate for a Markdown copy).',
    spec: [['RFC 8288', 'https://www.rfc-editor.org/rfc/rfc8288'], ['RFC 9727', 'https://www.rfc-editor.org/rfc/rfc9727']],
    async run(c) {
      const r = await c.page();
      if (r.error) return { status: 'unable', message: 'Could not request the page: ' + arWhy(r), evidence: [arEv('GET ' + c.pagePath, r, 'negative', arWhy(r))] };
      if (arHeadersLimited(r.headers)) return { status: 'unable', message: 'The browser only shares a few response headers for this site, so Link headers cannot be read', evidence: [arEv('GET ' + c.pagePath, r, 'neutral', 'Response headers are filtered')] };
      const links = arParseLinkHeader(r.headers.get('link') || '');
      const useful = [];
      links.forEach(l => {
        const rel = l.rels.find(x => AR_USEFUL_LINK_RELS.indexOf(x) >= 0) || (l.rels.indexOf('alternate') >= 0 && /markdown|text\/plain|json/i.test(l.type) ? 'alternate' : null);
        if (rel) useful.push({ rel: rel, href: l.href, type: l.type });
      });
      const ev = [arEv('GET ' + c.pagePath, r, useful.length ? 'positive' : 'negative', links.length ? arPlural(links.length, 'Link header entry', 'Link header entries') + ' found' : 'No Link header')];
      if (useful.length) return { status: 'pass', message: 'Found agent-useful Link relations: ' + Array.from(new Set(useful.map(x => x.rel))).join(', '), details: { relationsFound: useful, totalLinks: links.length }, evidence: ev };
      return { status: 'fail', message: links.length ? 'Link headers are present but none point to agent resources' : 'No Link header on the page response', details: { totalLinks: links.length, all: links.map(l => ({ rel: l.rels.join(' '), href: l.href })) }, evidence: ev };
    }
  },
  {
    id: 'dnsAid', group: 'discoverability', label: 'DNS advertises agent endpoints', t: 'Publish DNS-AID records', sev: 'Low', path: '_agents DNS records',
    goal: 'Let agents find your endpoints from DNS alone.',
    mean: 'DNS for AI Discovery publishes SVCB or HTTPS records under _agents.yourdomain so agents can find services before they load any page. It is an early draft, so it only counts for API and app sites.',
    fix: 'Add SVCB or HTTPS records at _index._agents (and _a2a._agents or _mcp._agents for those protocols), and sign the zone with DNSSEC.',
    spec: [['DNS-AID draft', 'https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/']],
    async run(c) {
      if (c.isLocal) return { status: 'info', message: 'DNS records are not checked for local or private addresses', evidence: [] };
      if (c.opts.dns === false) return { status: 'info', message: 'DNS lookups are turned off in Settings', evidence: [] };
      const hosts = Array.from(new Set([c.host.replace(/^www\./, ''), c.host]));
      const ev = [];
      let ok = 0, found = [];
      for (const host of hosts.slice(0, 2)) {
        const qs = [['SVCB', '_index._agents.'], ['HTTPS', '_index._agents.'], ['SVCB', '_a2a._agents.'], ['HTTPS', '_a2a._agents.'], ['SVCB', '_mcp._agents.'], ['HTTPS', '_mcp._agents.'], ['TXT', '_index._agents.']];
        const res = await Promise.all(qs.map(q => arDoh(q[1] + host, q[0])));
        res.forEach((x, i) => {
          const name = qs[i][1] + host;
          if (!x.ok) { ev.push(arEv('DoH ' + qs[i][0] + ' ' + name, null, 'neutral', 'No answer from the resolver')); return; }
          ok++;
          const ans = arDnsAnswers(x, qs[i][0]);
          if (ans.length) { found.push({ name: name, type: qs[i][0], data: ans.map(a => a.data) }); ev.push(arEv('DoH ' + qs[i][0] + ' ' + name, null, 'positive', arPlural(ans.length, 'record') + ': ' + arShort(ans[0].data, 80))); }
          else ev.push(arEv('DoH ' + qs[i][0] + ' ' + name, null, 'neutral', x.json.Status === 3 ? 'No records (NXDOMAIN)' : 'No records'));
        });
        if (found.length) break;
      }
      if (found.length) return { status: 'pass', message: 'DNS-AID records found at ' + Array.from(new Set(found.map(f => f.name))).join(', '), details: { records: found }, evidence: ev };
      if (!ok) return { status: 'unable', message: 'Could not query DNS over HTTPS', evidence: ev };
      return { status: 'fail', message: 'DNS-AID entrypoint records not found', evidence: ev };
    }
  },
  {
    id: 'markdownNegotiation', group: 'content', label: 'Pages can be served as Markdown', t: 'Serve Markdown to agents', sev: 'Medium', path: 'Accept: text/markdown',
    goal: 'Return a Markdown copy of the page when an agent asks for it.',
    mean: 'Markdown is far cheaper for a model to read than HTML: the same page can cost a fifth of the tokens, with no menus or scripts mixed in.',
    fix: 'When a request has Accept: text/markdown, answer with the page as Markdown and Content-Type: text/markdown. Keep HTML as the default.',
    spec: [['Cloudflare: Markdown for Agents', 'https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/']],
    async run(c) {
      const r = await c.get(c.pagePath, { headers: { Accept: 'text/markdown' }, max: 8192 });
      // c.get is origin-relative, so the page path (with query) is requested with the Markdown Accept header
      if (r.error) return { status: 'unable', message: 'Could not request the page: ' + arWhy(r), evidence: [arEv('GET ' + c.pagePath + ' (Accept: text/markdown)', r, 'negative', arWhy(r))] };
      const ct = (r.ctype || '').split(';')[0].trim();
      const md = /^text\/(x-)?markdown$/.test(ct);
      const tokens = r.headers && r.headers.get('x-markdown-tokens');
      const ev = [arEv('GET ' + c.pagePath + ' (Accept: text/markdown)', r, md ? 'positive' : 'negative', md ? 'Content-Type is ' + ct : 'Content-Type is ' + (ct || 'unknown') + ', not text/markdown')];
      return md
        ? { status: 'pass', message: 'Site supports Markdown for Agents', details: { contentType: r.ctype, tokens: tokens ? parseInt(tokens, 10) : null }, evidence: ev }
        : { status: 'fail', message: 'Site does not support Markdown for Agents', details: { contentType: r.ctype }, evidence: ev };
    }
  },
  {
    id: 'robotsTxtAiRules', group: 'bots', label: 'robots.txt covers AI bots', t: 'Add AI bot rules to robots.txt', sev: 'Medium', path: '/robots.txt',
    goal: 'Give search, training and on-request AI crawlers separate rules.',
    mean: 'AI companies run separate bots for search, training and fetching on a person’s request. One wildcard rule treats them all alike; separate groups let you stay visible in AI answers while opting out of training.',
    fix: 'Add User-agent groups for the AI crawlers you care about (OAI-SearchBot, Claude-SearchBot, PerplexityBot, GPTBot, ClaudeBot, Google-Extended, CCBot) with the Allow or Disallow rules you want.',
    spec: [['RFC 9309', 'https://www.rfc-editor.org/rfc/rfc9309'], ['Cloudflare AI Crawl Control', 'https://developers.cloudflare.com/ai-crawl-control/']],
    async run(c) {
      const ro = await c.robots();
      if (ro.r.error) return { status: 'unable', message: 'Could not fetch robots.txt', evidence: [arEv('GET /robots.txt', ro.r, 'negative', arWhy(ro.r))] };
      if (!ro.valid) return { status: 'fail', message: 'No valid robots.txt, so no AI bot rules can be read', evidence: [arEv('GET /robots.txt', ro.r, 'negative', arWhy(ro.r))] };
      const pol = arAiPolicies(ro.parsed, '/');
      const explicit = pol.filter(p => p.source === 'explicit');
      const ev = [arEv('GET /robots.txt', ro.r, 'positive', 'Valid robots.txt'), arEv('Scan for AI bot User-agent groups', null, explicit.length ? 'positive' : 'neutral', explicit.length ? 'Rules for ' + explicit.map(p => p.id).join(', ') : 'No AI-specific groups; the wildcard group applies')];
      return {
        status: 'pass',
        message: explicit.length ? 'Found rules for AI bots: ' + explicit.map(p => p.id).join(', ') : 'No AI-specific bot rules; wildcard rules apply to all crawlers including AI bots',
        details: { explicit: explicit.length, policies: pol }, evidence: ev
      };
    }
  },
  {
    id: 'contentSignals', group: 'bots', label: 'Content Signals state AI-use preferences', t: 'Declare Content Signals', sev: 'Medium', path: '/robots.txt',
    goal: 'Say whether your content may be used for AI training, AI answers and search.',
    mean: 'Content Signals are a machine-readable way to say yes or no to AI training (ai-train), using pages as input to answers (ai-input) and search indexing (search). Without them, nobody can tell what you intended.',
    fix: 'Add a Content-Signal line to robots.txt under the User-agent group it applies to.',
    spec: [['contentsignals.org', 'https://contentsignals.org/'], ['IETF draft', 'https://datatracker.ietf.org/doc/draft-romm-aipref-contentsignals/']],
    async run(c) {
      const ro = await c.robots();
      if (ro.r.error) return { status: 'unable', message: 'Could not fetch robots.txt', evidence: [arEv('GET /robots.txt', ro.r, 'negative', arWhy(ro.r))] };
      if (!ro.valid) return { status: 'fail', message: 'No valid robots.txt, so no Content Signals can be read', evidence: [arEv('GET /robots.txt', ro.r, 'negative', arWhy(ro.r))] };
      const sigs = ro.parsed.signals.filter(s => s.valid);
      const ev = [arEv('GET /robots.txt', ro.r, 'positive', 'Valid robots.txt'), arEv('Parse Content-Signal directives', null, sigs.length ? 'positive' : 'negative', sigs.length ? arPlural(sigs.length, 'directive') + ': ' + sigs.map(s => s.raw).join(' | ') : 'No Content-Signal directive found')];
      return sigs.length
        ? { status: 'pass', message: 'Content Signals found in robots.txt', details: { signals: sigs, signalCount: sigs.length }, evidence: ev }
        : { status: 'fail', message: 'No Content Signals found in robots.txt', evidence: ev };
    }
  },
  {
    id: 'webBotAuth', group: 'bots', label: 'Web Bot Auth keys are published', t: 'Publish Web Bot Auth keys', sev: 'Low', path: '/.well-known/http-message-signatures-directory',
    goal: 'Let sites verify requests that your own bot or agent sends.',
    mean: 'Only matters if you run a crawler or agent. You publish public keys, sign your requests, and other sites can tell your bot from an impostor.',
    fix: 'Publish a JSON Web Key Set at /.well-known/http-message-signatures-directory and sign outbound requests with Signature-Agent and Signature-Input headers.',
    spec: [['Web Bot Auth', 'https://blog.cloudflare.com/web-bot-auth/']],
    async run(c) {
      const p = '/.well-known/http-message-signatures-directory';
      const { r, json } = await c.json(p);
      if (r.error) return { status: 'unable', message: 'Could not fetch the Web Bot Auth directory', evidence: [arEv('GET ' + p, r, 'negative', arWhy(r))] };
      const keys = json && Array.isArray(json.keys) ? json.keys : [];
      if (r.status === 200 && keys.length) return { status: 'pass', message: 'Web Bot Auth directory lists ' + arPlural(keys.length, 'key'), details: { keys: keys.length }, evidence: [arEv('GET ' + p, r, 'positive', arPlural(keys.length, 'public key'))] };
      return { status: 'info', message: 'Web Bot Auth directory not found (informational only)', evidence: [arEv('GET ' + p, r, 'negative', arWhy(r, json))] };
    }
  },
  {
    id: 'apiCatalog', group: 'discovery', label: 'An API catalog is published', t: 'Publish an API catalog', sev: 'Medium', path: '/.well-known/api-catalog',
    goal: 'List your APIs, with links to their specs and docs, in one place.',
    mean: 'An API catalog lets an agent discover your APIs and read their OpenAPI specs without guessing URLs.',
    fix: 'Serve a linkset JSON document at /.well-known/api-catalog with Content-Type application/linkset+json, one entry per API.',
    spec: [['RFC 9727', 'https://www.rfc-editor.org/rfc/rfc9727']],
    async run(c) {
      const p = '/.well-known/api-catalog', { r, json } = await c.json(p);
      if (r.error) return { status: 'unable', message: 'Could not fetch the API catalog: ' + arWhy(r), evidence: [arEv('GET ' + p, r, 'negative', arWhy(r))] };
      const ls = json && Array.isArray(json.linkset) ? json.linkset : null;
      if (r.status === 200 && ls && ls.length) {
        const ct = /linkset\+json/.test(r.ctype);
        return { status: 'pass', message: 'API Catalog found with ' + arPlural(ls.length, 'API') + ' listed', details: { apiCount: ls.length, correctContentType: ct }, evidence: [arEv('GET ' + p, r, 'positive', arPlural(ls.length, 'linkset entry', 'linkset entries') + (ct ? '' : ' (Content-Type should be application/linkset+json)'))] };
      }
      return { status: 'fail', message: r.status === 200 && json ? 'The API catalog has no linkset entries' : 'API Catalog not found', evidence: [arEv('GET ' + p, r, 'negative', arWhy(r, json))] };
    }
  },
  {
    id: 'oauthDiscovery', group: 'discovery', label: 'OAuth / OIDC discovery metadata is published', t: 'Publish OAuth discovery metadata', sev: 'Medium', path: '/.well-known/openid-configuration',
    goal: 'Describe your authorization server so agents can sign in.',
    mean: 'Agents that need to act for a user must know where to authenticate. Discovery metadata gives them the issuer, endpoints and supported flows without a human reading docs.',
    fix: 'Serve /.well-known/openid-configuration (OIDC) or /.well-known/oauth-authorization-server (OAuth 2.0) with issuer, authorization_endpoint, token_endpoint, jwks_uri and the supported grant and response types.',
    spec: [['RFC 8414', 'https://www.rfc-editor.org/rfc/rfc8414'], ['OpenID Connect Discovery', 'https://openid.net/specs/openid-connect-discovery-1_0.html']],
    async run(c) {
      const ev = [], paths = ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'];
      const g = await arGetJsonFile(c, paths, ev);
      if (g.all) return { status: 'unable', message: 'Could not fetch OAuth discovery metadata', evidence: ev };
      const j = g.hit && g.hit.json;
      if (j && typeof j.issuer === 'string' && (j.authorization_endpoint || j.token_endpoint || j.jwks_uri)) {
        const miss = ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'grant_types_supported', 'response_types_supported'].filter(k => !j[k]);
        return { status: 'pass', message: 'OAuth/OIDC discovery metadata found at ' + g.hit.path, details: { path: g.hit.path, issuer: j.issuer, missingRecommended: miss }, evidence: ev };
      }
      if (j) return { status: 'fail', message: 'Discovery metadata found but it has no issuer and endpoints', evidence: ev };
      return { status: 'fail', message: 'No OAuth/OIDC discovery metadata found', evidence: ev };
    }
  },
  {
    id: 'oauthProtectedResource', group: 'discovery', label: 'Protected-resource metadata is published', t: 'Publish OAuth protected-resource metadata', sev: 'Medium', path: '/.well-known/oauth-protected-resource',
    goal: 'Point agents from your API to the authorization server that guards it.',
    mean: 'It tells an agent which authorization servers can issue tokens for this resource, so it can find the right sign-in without asking.',
    fix: 'Serve /.well-known/oauth-protected-resource with a resource and an authorization_servers list. On 401 responses add WWW-Authenticate with resource_metadata.',
    spec: [['RFC 9728', 'https://www.rfc-editor.org/rfc/rfc9728']],
    async run(c) {
      const ev = [], p = '/.well-known/oauth-protected-resource';
      let { r, json } = await c.json(p);
      if (r.error) return { status: 'unable', message: 'Could not fetch protected-resource metadata', evidence: [arEv('GET ' + p, r, 'negative', arWhy(r))] };
      // a 401 on the home page can name the metadata address in WWW-Authenticate
      const home = await c.get('/');
      let pointer = '';
      if (!home.error && home.status === 401 && home.headers) {
        const wa = home.headers.get('www-authenticate') || '';
        const m = wa.match(/resource_metadata="?([^",\s]+)"?/i);
        if (m) pointer = m[1];
        ev.push(arEv('GET /', home, pointer ? 'positive' : 'neutral', pointer ? 'WWW-Authenticate points at ' + arShort(pointer, 60) : 'HTTP 401 without a resource_metadata pointer'));
      } else if (!home.error) ev.push(arEv('GET /', home, 'neutral', 'HTTP ' + home.status + ' (no WWW-Authenticate challenge)'));
      if (pointer && (!json || r.status !== 200)) { const pr = await arFetch(pointer, { max: 65536 }); const pj = arParseJson(pr); ev.push(arEv('GET ' + arPath(pointer), pr, pj ? 'positive' : 'negative', pj ? 'Valid JSON' : arWhy(pr, pj))); if (pj) { r = pr; json = pj; } }
      else ev.push(arEv('GET ' + p, r, json && r.status === 200 ? 'positive' : 'negative', json && r.status === 200 ? 'Valid JSON' : arWhy(r, json)));
      if (json && typeof json.resource === 'string' && Array.isArray(json.authorization_servers) && json.authorization_servers.length)
        return { status: 'pass', message: 'OAuth Protected Resource Metadata found', details: { resource: json.resource, authorizationServers: json.authorization_servers, scopes: json.scopes_supported || null }, evidence: ev };
      if (json && json.resource) return { status: 'fail', message: 'Protected-resource metadata is missing authorization_servers', evidence: ev };
      return { status: 'fail', message: 'No OAuth Protected Resource Metadata found', evidence: ev };
    }
  },
  {
    id: 'authMd', group: 'discovery', label: 'auth.md describes agent sign-up', t: 'Publish auth.md', sev: 'Low', path: '/auth.md',
    goal: 'Describe how an agent registers or gets credentials.',
    mean: 'auth.md is a plain Markdown page that tells an agent how to get access: which flows exist, where to register and how credentials are used.',
    fix: 'Serve /auth.md as Markdown with an H1 that includes “auth.md”, then document the registration flows. Publish OAuth metadata too if you can.',
    spec: [['Auth.md', 'https://workos.com/auth-md']],
    async run(c) {
      const p = '/auth.md', r = await c.get(p);
      if (r.error) return { status: 'unable', message: 'Could not fetch auth.md', evidence: [arEv('GET ' + p, r, 'negative', arWhy(r))] };
      if (r.status !== 200 || arLooksHtml(r)) return { status: 'fail', message: 'auth.md not found', evidence: [arEv('GET ' + p, r, 'negative', r.status !== 200 ? 'HTTP ' + r.status : 'Returns a web page')] };
      if (!/^#\s+.*auth\.md/im.test(r.text)) return { status: 'fail', message: 'auth.md exists but is missing the expected Auth.md heading', evidence: [arEv('GET ' + p, r, 'negative', 'No H1 containing “auth.md”')] };
      return { status: 'pass', message: 'auth.md found with the expected heading', details: { bytes: r.bytes }, evidence: [arEv('GET ' + p, r, 'positive', 'Markdown with an Auth.md heading')] };
    }
  },
  {
    id: 'mcpServerCard', group: 'discovery', label: 'An MCP server card is published', t: 'Publish an MCP server card', sev: 'Medium', path: '/.well-known/mcp/server-card.json',
    goal: 'Let agents discover your MCP server and how to connect.',
    mean: 'If you run an MCP server, a server card at a well-known address lets any client find its endpoint, transport and capabilities before connecting.',
    fix: 'Serve /.well-known/mcp/server-card.json with serverInfo (name and version), the transport endpoint and the capabilities you offer.',
    spec: [['MCP', 'https://modelcontextprotocol.io/'], ['SEP-1649', 'https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127']],
    async run(c) {
      const ev = [], paths = ['/.well-known/mcp/server-cards.json', '/.well-known/mcp/server-card.json', '/.well-known/mcp.json'];
      const g = await arGetJsonFile(c, paths, ev);
      if (g.all) return { status: 'unable', message: 'Could not fetch an MCP server card', evidence: ev };
      const j = g.hit && g.hit.json;
      if (j) {
        const one = (x) => {
          if (!x || typeof x !== 'object') return null;
          if (x.serverInfo && x.serverInfo.name) return { format: 'sep', name: x.serverInfo.name, hasVersion: !!x.serverInfo.version, hasTransport: !!(x.transport || x.url || x.endpoint), hasCapabilities: !!x.capabilities };
          if (x.name && (Array.isArray(x.remotes) || Array.isArray(x.packages))) return { format: 'registry', name: x.name, hasVersion: !!x.version, hasTransport: !!(x.remotes && x.remotes.length), hasCapabilities: !!x.capabilities, remotes: (x.remotes || []).map(m => m.url).filter(Boolean) };
          return null;
        };
        let card = one(j), n = 1;
        if (!card) {
          const arr = Array.isArray(j) ? j : (j.cards || j.servers || j.serverCards || []);
          if (Array.isArray(arr) && arr.length) { n = arr.length; card = arr.map(one).find(Boolean) || null; }
        }
        if (card) return { status: 'pass', message: 'MCP Server Card found at ' + g.hit.path, details: Object.assign({ path: g.hit.path, cards: n }, card), evidence: ev };
        return { status: 'fail', message: 'MCP server card found but it has no serverInfo name or remotes', evidence: ev };
      }
      return { status: 'fail', message: 'MCP Server Card not found at any candidate path', evidence: ev };
    }
  },
  {
    id: 'a2aAgentCard', group: 'discovery', label: 'An A2A agent card is published', t: 'Publish an A2A agent card', sev: 'Low', path: '/.well-known/agent-card.json',
    goal: 'Let other agents find yours and see what it can do.',
    mean: 'If you run an agent, an A2A agent card at a well-known address tells other agents its name, interfaces and skills so they can delegate work to it.',
    fix: 'Serve /.well-known/agent-card.json with name, version, description, supportedInterfaces, capabilities and a list of skills (id, name, description).',
    spec: [['A2A protocol', 'https://a2a-protocol.org/']],
    async run(c) {
      const ev = [], g = await arGetJsonFile(c, ['/.well-known/agent-card.json', '/.well-known/agent.json'], ev);
      if (g.all) return { status: 'unable', message: 'Could not fetch an A2A agent card', evidence: ev };
      const j = g.hit && g.hit.json;
      if (j && typeof j.name === 'string' && (Array.isArray(j.supportedInterfaces) || Array.isArray(j.interfaces) || j.url)) {
        return { status: 'pass', message: 'A2A Agent Card found at ' + g.hit.path, details: { path: g.hit.path, name: j.name, version: j.version || null, skills: Array.isArray(j.skills) ? j.skills.length : 0, card: j }, evidence: ev };
      }
      if (j) return { status: 'fail', message: 'Agent card found but it is missing a name or interfaces', evidence: ev };
      return { status: 'fail', message: 'A2A Agent Card not found', evidence: ev };
    }
  },
  {
    id: 'agentSkills', group: 'discovery', label: 'An Agent Skills index is published', t: 'Publish an Agent Skills index', sev: 'Medium', path: '/.well-known/agent-skills/index.json',
    goal: 'List the skills (instructions) agents can load to use your site well.',
    mean: 'A skills index is how you hand agents ready-made instructions, such as how to search your docs or use your API, instead of hoping they work it out.',
    fix: 'Serve /.well-known/agent-skills/index.json listing each skill with name, type, description, url and a sha256 digest.',
    spec: [['Agent Skills', 'https://agentskills.io/home']],
    async run(c) {
      const ev = [], g = await arGetJsonFile(c, ['/.well-known/agent-skills/index.json', '/.well-known/skills/index.json'], ev);
      if (g.all) return { status: 'unable', message: 'Could not fetch an Agent Skills index', evidence: ev };
      const j = g.hit && g.hit.json;
      const skills = j && Array.isArray(j.skills) ? j.skills : null;
      if (skills && skills.length) {
        const valid = skills.every(s => s && s.name && s.type && s.url && /^sha256:/i.test(s.digest || ''));
        return { status: 'pass', message: 'Agent Skills index exists with ' + arPlural(skills.length, 'skill'), details: { path: g.hit.path, skillCount: skills.length, specVersion: /0\.2\.0/.test(j.$schema || '') ? '0.2.0' : (j.$schema || null), validEntries: valid, legacyPath: g.hit.path !== '/.well-known/agent-skills/index.json' }, evidence: ev };
      }
      if (j) return { status: 'fail', message: 'Agent Skills index has no skills listed', evidence: ev };
      return { status: 'fail', message: 'Agent Skills index not found', evidence: ev };
    }
  },
  {
    id: 'webMcp', group: 'discovery', label: 'The page exposes WebMCP tools', t: 'Expose tools with WebMCP', sev: 'Low', path: 'navigator.modelContext', page: true,
    goal: 'Let a browsing agent call your site’s actions as tools.',
    mean: 'WebMCP lets a page register tools (search, add to cart, book) that an in-browser agent can call directly, instead of clicking through the interface.',
    fix: 'Register tools with navigator.modelContext.registerTool() on page load, or add toolname and tooldescription to your forms.',
    spec: [['WebMCP', 'https://webmcp.org/']],
    run: null   // judged from the live page after the extraction (agent-geo.js: arWebMcpResult)
  },
  {
    id: 'ard', group: 'discovery', label: 'An ARD capability manifest is published', t: 'Publish an ARD manifest', sev: 'Low', path: '/.well-known/ai-catalog.json',
    goal: 'One manifest of every MCP server, agent, skill and API you offer.',
    mean: 'Agentic Resource Discovery gathers your agent-facing resources into one catalog, with example queries so registries can match agents to the right one.',
    fix: 'Serve /.well-known/ai-catalog.json with a specVersion, a host object and entries (identifier, displayName, type and either url or data).',
    spec: [['ARD', 'https://agenticresourcediscovery.org/']],
    async run(c) {
      const ev = [], mech = [];
      const ro = await c.robots();
      const am = ro.valid ? ro.parsed.agentmaps : [];
      ev.push(arEv('Read Agentmap lines in robots.txt', null, am.length ? 'positive' : 'neutral', am.length ? arPlural(am.length, 'line') : 'None'));
      if (am.length) mech.push('robots.txt');
      const link = c.opts.aiCatalogHref || null;
      ev.push(arEv('Read <link rel="ai-catalog"> in the page head', null, link ? 'positive' : 'neutral', link ? arShort(link, 70) : 'None'));
      if (link) mech.push('link tag');
      const g = await arGetJsonFile(c, ['/.well-known/ai-catalog.json', '/.well-known/ard.json'], ev);
      let j = g.hit && g.hit.json, from = g.hit && g.hit.path;
      if (!j && (am[0] || link)) {
        const u = am[0] || link;
        const r = await arFetch(new URL(u, c.origin).href, { max: 262144 });
        const pj = arParseJson(r);
        ev.push(arEv('GET ' + arPath(u), r, pj ? 'positive' : 'negative', pj ? 'Valid JSON' : arWhy(r, pj)));
        if (pj) { j = pj; from = arPath(u); }
      }
      if (g.hit) mech.push('well-known');
      if (g.all && !j) return { status: 'unable', message: 'Could not fetch an ARD manifest', evidence: ev };
      if (j) {
        const entries = Array.isArray(j.entries) ? j.entries : [];
        const issues = [];
        if (!j.specVersion) issues.push('specVersion is missing');
        if (!j.host || !j.host.displayName || !j.host.identifier) issues.push('host needs a displayName and identifier');
        let valid = 0, urn = 0, queries = 0;
        entries.forEach((e, i) => {
          const hasOne = !!e.url !== !!e.data;
          if (e.identifier && e.displayName && e.type && hasOne) valid++; else if (issues.length < 6) issues.push('entry ' + (i + 1) + ' needs identifier, displayName, type and exactly one of url or data');
          if (/^urn:air:/.test(e.identifier || '')) urn++;
          if (Array.isArray(e.representativeQueries) && e.representativeQueries.length >= 2 && e.representativeQueries.length <= 5) queries++;
        });
        if (j.specVersion && entries.length) return { status: 'pass', message: 'ARD capability manifest found with ' + arPlural(entries.length, 'agentic resource'), details: { path: from, specVersion: j.specVersion, entryCount: entries.length, validEntryCount: valid, urnConformantCount: urn, withRepresentativeQueries: queries, issues: issues, discoveryMechanisms: mech }, evidence: ev };
        return { status: 'fail', message: 'ARD manifest found but ' + (entries.length ? 'it has no specVersion' : 'it lists no entries'), details: { issues: issues }, evidence: ev };
      }
      return { status: 'fail', message: 'ARD capability manifest not found', evidence: ev };
    }
  },
  {
    id: 'x402', group: 'commerce', label: 'x402 payments are supported', t: 'Support x402 payments', sev: 'Low', path: 'HTTP 402', optional: true,
    goal: 'Let agents pay for access with HTTP 402 Payment Required.',
    mean: 'x402 turns HTTP 402 into a real payment flow: an agent gets the price in the response, pays, and retries, with no account or checkout page.',
    fix: 'Add x402 middleware to your paid API routes and set a facilitator URL and wallet address.',
    spec: [['x402', 'https://www.x402.org/']],
    async run(c) {
      const ev = [], paths = ['/', '/api', '/api/v1'];
      let errors = 0;
      for (const p of paths) {
        const r = await c.get(p, { headers: { Accept: 'application/json' }, max: 32768 });
        if (r.error) { errors++; ev.push(arEv('GET ' + p, r, 'negative', 'Network error')); continue; }
        const j = arParseJson(r);
        const pay = r.status === 402 && (j && (j.x402Version != null || Array.isArray(j.accepts)) || (r.headers && (r.headers.get('payment-required') || r.headers.get('x-payment'))));
        ev.push(arEv('GET ' + p, r, pay ? 'positive' : 'neutral', pay ? 'HTTP 402 with payment requirements' : 'HTTP ' + r.status));
        if (pay) return { status: 'pass', message: 'x402 payment requirements found at ' + p, details: { path: p }, evidence: ev };
      }
      if (errors === paths.length) return { status: 'unable', message: 'Could not check x402 support', evidence: ev };
      return { status: 'fail', message: 'x402 payment protocol not detected', evidence: ev };
    }
  },
  {
    id: 'mpp', group: 'commerce', label: 'MPP payment discovery is published', t: 'Publish MPP payment info', sev: 'Low', path: '/openapi.json', optional: true,
    goal: 'Describe payable endpoints in your OpenAPI document.',
    mean: 'The Machine Payment Protocol marks which API operations cost money and how to pay, so agents can budget before calling.',
    fix: 'Serve /openapi.json and add an x-payment-info extension (intent, method, amount) to each payable operation.',
    spec: [['MPP', 'https://mpp.dev']],
    async run(c) {
      const p = '/openapi.json', { r, json } = await c.json(p, { max: 1048576 });
      if (r.error) return { status: 'unable', message: 'Could not fetch /openapi.json', evidence: [arEv('GET ' + p, r, 'negative', arWhy(r))] };
      let n = 0;
      if (json && json.paths) Object.keys(json.paths).forEach(k => Object.keys(json.paths[k] || {}).forEach(m => { const x = json.paths[k][m] && json.paths[k][m]['x-payment-info']; if (x && /^(charge|session)$/.test(x.intent || '') && x.method && x.amount != null) n++; }));
      return n
        ? { status: 'pass', message: 'MPP payment info found on ' + arPlural(n, 'operation'), details: { operations: n }, evidence: [arEv('GET ' + p, r, 'positive', arPlural(n, 'payable operation'))] }
        : { status: 'fail', message: 'MPP payment discovery not detected', evidence: [arEv('GET ' + p, r, 'negative', json ? 'No x-payment-info found' : arWhy(r, json))] };
    }
  },
  {
    id: 'ucp', group: 'commerce', label: 'A UCP profile is published', t: 'Publish a UCP profile', sev: 'Low', path: '/.well-known/ucp', optional: true,
    goal: 'Describe your store to agents with the Universal Commerce Protocol.',
    mean: 'A UCP profile lists the commerce services, capabilities and endpoints your store supports, so shopping agents can browse and buy.',
    fix: 'Serve /.well-known/ucp as JSON with protocol_version, services, capabilities and endpoints.',
    spec: [['UCP', 'https://ucp.dev/']],
    async run(c) {
      const p = '/.well-known/ucp', { r, json } = await c.json(p);
      if (r.error) return { status: 'unable', message: 'Could not fetch the UCP profile', evidence: [arEv('GET ' + p, r, 'negative', arWhy(r))] };
      const ok = json && json.protocol_version && (json.services || json.capabilities);
      return ok
        ? { status: 'pass', message: 'UCP profile found (protocol ' + json.protocol_version + ')', details: { version: json.protocol_version }, evidence: [arEv('GET ' + p, r, 'positive', 'Valid UCP profile')] }
        : { status: 'fail', message: 'UCP profile not found', evidence: [arEv('GET ' + p, r, 'negative', arWhy(r, json))] };
    }
  },
  {
    id: 'acp', group: 'commerce', label: 'An ACP discovery document is published', t: 'Publish an ACP discovery document', sev: 'Low', path: '/.well-known/acp.json', optional: true,
    goal: 'Let agents find your Agentic Commerce Protocol API.',
    mean: 'The ACP document says where your commerce API lives and what it supports, so an agent can start a checkout without custom integration.',
    fix: 'Serve /.well-known/acp.json with protocol.name “acp”, protocol.version, api_base_url, transports and capabilities.services.',
    spec: [['ACP', 'https://agenticcommerce.dev']],
    async run(c) {
      const p = '/.well-known/acp.json', { r, json } = await c.json(p);
      if (r.error) return { status: 'unable', message: 'Could not fetch the ACP document', evidence: [arEv('GET ' + p, r, 'negative', arWhy(r))] };
      const ok = json && json.protocol && json.protocol.name === 'acp' && json.protocol.version && /^https?:\/\//.test(json.api_base_url || '') && Array.isArray(json.transports) && json.transports.length && json.capabilities && Array.isArray(json.capabilities.services) && json.capabilities.services.length;
      return ok
        ? { status: 'pass', message: 'ACP discovery document found', details: { version: json.protocol.version }, evidence: [arEv('GET ' + p, r, 'positive', 'Valid ACP document')] }
        : { status: 'fail', message: 'ACP discovery document not found', evidence: [arEv('GET ' + p, r, 'negative', json ? 'Missing required fields' : arWhy(r, json))] };
    }
  },
  {
    id: 'ap2', group: 'commerce', label: 'AP2 is declared on the agent card', t: 'Declare AP2 on your agent card', sev: 'Low', path: 'A2A agent card extension', optional: true, dependsOn: 'a2aAgentCard',
    goal: 'Show agents you accept Agent Payments Protocol mandates.',
    mean: 'AP2 lets a user authorize an agent to pay. You advertise support as an extension on your A2A agent card.',
    fix: 'Publish an A2A agent card and list the AP2 extension in capabilities.extensions.',
    spec: [['AP2', 'https://ap2-protocol.org/']],
    async run(c, done) {
      const a2a = done && done.a2aAgentCard;
      if (!a2a || a2a.status !== 'pass') return { status: a2a && a2a.status === 'unable' ? 'unable' : 'fail', message: a2a && a2a.status === 'unable' ? 'Could not check AP2: the agent card check failed' : 'AP2 not detected (no A2A agent card)', evidence: [] };
      const ext = (a2a.details.card && a2a.details.card.capabilities && a2a.details.card.capabilities.extensions) || [];
      const has = ext.some(e => /ap2/i.test(typeof e === 'string' ? e : (e && (e.uri || e.name)) || ''));
      return has ? { status: 'pass', message: 'AP2 extension declared on the agent card', evidence: [] } : { status: 'fail', message: 'The agent card does not declare the AP2 extension', evidence: [] };
    }
  }
];
const AR_DEF = {};
AR_DEFS.forEach(d => { AR_DEF[d.id] = d; });

/* ------------------------------------------------------------------ level and score */
function arLevel(results) {
  const st = (id) => results[id] && results[id].status;
  const p = (id) => st(id) === 'pass';
  const blockedByUnable = [];
  let level = 0;
  const disc = ['robotsTxt', 'sitemap', 'linkHeaders'];
  const next = [];
  const need = (id, why) => { next.push({ check: id, why: why }); };
  const lacking = (ids, why) => { ids.filter(id => !p(id)).forEach(id => need(id, why)); };

  if (disc.filter(p).length >= 2) level = 1;
  else { lacking(disc, 'Two of robots.txt, a sitemap and Link headers'); return { level: 0, name: AR_LEVELS[0], next: { target: 1, name: AR_LEVELS[1], requirements: next }, unable: disc.filter(id => st(id) === 'unable') }; }

  if (p('robotsTxtAiRules') && p('contentSignals')) level = 2;
  else { lacking(['robotsTxtAiRules', 'contentSignals'], 'AI bot rules and Content Signals'); }
  if (level === 2) { if (p('markdownNegotiation')) level = 3; else need('markdownNegotiation', 'Markdown content negotiation'); }
  if (level === 3) { if (['mcpServerCard', 'a2aAgentCard', 'agentSkills', 'apiCatalog'].some(p)) level = 4; else ['mcpServerCard', 'a2aAgentCard', 'agentSkills', 'apiCatalog'].forEach(id => need(id, 'At least one of an MCP server card, A2A agent card, agent skills or API catalog')); }
  if (level === 4) {
    const all = ['mcpServerCard', 'a2aAgentCard', 'agentSkills', 'apiCatalog'].every(p);
    const auth = p('oauthDiscovery') || p('oauthProtectedResource') || p('authMd');
    if ([p('webBotAuth'), all, auth].filter(Boolean).length >= 2) level = 5;
    else {
      if (!p('webBotAuth')) need('webBotAuth', 'Two of: Web Bot Auth, every integration published, auth metadata');
      if (!all) ['mcpServerCard', 'a2aAgentCard', 'agentSkills', 'apiCatalog'].filter(id => !p(id)).forEach(id => need(id, 'Two of: Web Bot Auth, every integration published, auth metadata'));
      if (!auth) ['oauthDiscovery', 'oauthProtectedResource', 'authMd'].forEach(id => need(id, 'Two of: Web Bot Auth, every integration published, auth metadata'));
    }
  }
  const unable = Object.keys(results).filter(id => st(id) === 'unable');
  return { level: level, name: AR_LEVELS[level], next: level < 5 ? { target: level + 1, name: AR_LEVELS[level + 1], requirements: next } : null, unable: unable };
}

// Which checks are scored, exactly as isitagentready.com's presets define them: a content site is
// judged on seven, an API or app on sixteen. The A2A card, AP2 and the four commerce checks are
// shown but never counted. A check that answers "info" (not applicable) drops out of the sum.
function arScoredIds(profile) {
  return profile === 'content' ? AR_CONTENT_IDS.slice() : AR_APP_IDS.slice();
}

function arScore(results, profile) {
  const ids = arScoredIds(profile);
  const groups = {};
  AR_GROUPS.forEach(g => { groups[g.id] = { pass: 0, total: 0, score: null }; });
  let pass = 0, total = 0;
  ids.forEach(id => {
    const r = results[id];
    if (!r || (r.status !== 'pass' && r.status !== 'fail')) return;
    const g = groups[AR_DEF[id].group];
    g.total++; total++;
    if (r.status === 'pass') { g.pass++; pass++; }
  });
  Object.keys(groups).forEach(k => { groups[k].score = groups[k].total ? Math.round(groups[k].pass / groups[k].total * 100) : null; });
  return { score: total ? Math.round(pass / total * 100) : null, pass: pass, total: total, groups: groups, ids: ids };
}

// Auto: judge a site as a content site unless it already publishes API or app discovery files
function arAutoProfile(results) {
  const app = ['apiCatalog', 'oauthDiscovery', 'oauthProtectedResource', 'authMd', 'mcpServerCard', 'a2aAgentCard', 'agentSkills', 'ard', 'webMcp', 'dnsAid'];
  return app.some(id => results[id] && results[id].status === 'pass') ? 'app' : 'content';
}


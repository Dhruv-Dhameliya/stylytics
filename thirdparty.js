/* thirdparty.js — what other people's code costs this page, and when everything loads.
 *
 * content_insights.js returns every request the page made (data.insights.resources). This file
 *   1. sorts them into first-party and third-party, and names the vendor from a built-in list
 *   2. ranks vendors by what they cost: bytes, requests, time, and whether they block rendering
 *   3. draws a waterfall of the requests against the page's first paint and load
 *   4. adds the audit checks (blocking third parties, budget, slow files, missing preconnect)
 *
 * Cross-origin files that do not send Timing-Allow-Origin report no size. Those stay "unknown" until
 * the person presses "Measure missing sizes", which asks each server for the file's length.
 */

/* ------------------------------------------------------------------ vendors */
// suffix | vendor | category. The longest matching suffix wins, so a specific host beats its parent.
const TP_DB = `
google-analytics.com|Google Analytics|Analytics
analytics.google.com|Google Analytics|Analytics
googletagmanager.com|Google Tag Manager|Tag manager
googletagservices.com|Google Ad Manager|Advertising
doubleclick.net|Google Ads|Advertising
googlesyndication.com|Google Ads|Advertising
googleadservices.com|Google Ads|Advertising
fonts.googleapis.com|Google Fonts|Fonts
fonts.gstatic.com|Google Fonts|Fonts
ajax.googleapis.com|Google Hosted Libraries|Libraries
maps.googleapis.com|Google Maps|Maps
maps.gstatic.com|Google Maps|Maps
google.com|Google services|Other
gstatic.com|Google static files|Other
youtube.com|YouTube|Video
youtube-nocookie.com|YouTube|Video
ytimg.com|YouTube|Video
vimeo.com|Vimeo|Video
vimeocdn.com|Vimeo|Video
wistia.com|Wistia|Video
wistia.net|Wistia|Video
brightcove.net|Brightcove|Video
jwpcdn.com|JW Player|Video
facebook.net|Meta (Facebook)|Advertising
facebook.com|Meta (Facebook)|Social
fbcdn.net|Meta (Facebook)|Social
instagram.com|Instagram|Social
twitter.com|X (Twitter)|Social
twimg.com|X (Twitter)|Social
x.com|X (Twitter)|Social
ads-twitter.com|X Ads|Advertising
linkedin.com|LinkedIn|Social
licdn.com|LinkedIn|Social
pinterest.com|Pinterest|Social
pinimg.com|Pinterest|Social
tiktok.com|TikTok|Advertising
snapchat.com|Snapchat|Advertising
sc-static.net|Snapchat|Advertising
reddit.com|Reddit|Social
redditstatic.com|Reddit|Social
bing.com|Microsoft Advertising|Advertising
clarity.ms|Microsoft Clarity|Analytics
hotjar.com|Hotjar|Analytics
hotjar.io|Hotjar|Analytics
fullstory.com|FullStory|Analytics
logrocket.com|LogRocket|Monitoring
logr-ingest.com|LogRocket|Monitoring
mouseflow.com|Mouseflow|Analytics
crazyegg.com|Crazy Egg|Analytics
luckyorange.com|Lucky Orange|Analytics
segment.com|Segment|Analytics
segment.io|Segment|Analytics
mixpanel.com|Mixpanel|Analytics
amplitude.com|Amplitude|Analytics
heap.io|Heap|Analytics
heapanalytics.com|Heap|Analytics
plausible.io|Plausible|Analytics
matomo.cloud|Matomo|Analytics
posthog.com|PostHog|Analytics
statcounter.com|StatCounter|Analytics
scorecardresearch.com|Comscore|Analytics
quantserve.com|Quantcast|Advertising
quantcount.com|Quantcast|Analytics
chartbeat.com|Chartbeat|Analytics
chartbeat.net|Chartbeat|Analytics
parsely.com|Parse.ly|Analytics
sentry.io|Sentry|Monitoring
sentry-cdn.com|Sentry|Monitoring
datadoghq.com|Datadog|Monitoring
datadoghq-browser-agent.com|Datadog|Monitoring
newrelic.com|New Relic|Monitoring
nr-data.net|New Relic|Monitoring
bugsnag.com|Bugsnag|Monitoring
rollbar.com|Rollbar|Monitoring
trackjs.com|TrackJS|Monitoring
cloudflareinsights.com|Cloudflare Analytics|Analytics
cdnjs.cloudflare.com|cdnjs|Libraries
cloudflare.com|Cloudflare|CDN
jsdelivr.net|jsDelivr|Libraries
unpkg.com|unpkg|Libraries
code.jquery.com|jQuery CDN|Libraries
bootstrapcdn.com|BootstrapCDN|Libraries
fontawesome.com|Font Awesome|Fonts
use.typekit.net|Adobe Fonts|Fonts
typekit.net|Adobe Fonts|Fonts
fonts.bunny.net|Bunny Fonts|Fonts
cloud.typography.com|Cloud.typography|Fonts
fast.fonts.net|Fonts.com|Fonts
intercom.io|Intercom|Support
intercomcdn.com|Intercom|Support
drift.com|Drift|Support
driftt.com|Drift|Support
zendesk.com|Zendesk|Support
zdassets.com|Zendesk|Support
freshchat.com|Freshchat|Support
freshdesk.com|Freshdesk|Support
crisp.chat|Crisp|Support
tawk.to|Tawk.to|Support
livechatinc.com|LiveChat|Support
tidio.co|Tidio|Support
olark.com|Olark|Support
helpscout.net|Help Scout|Support
hubspot.com|HubSpot|Marketing
hs-scripts.com|HubSpot|Marketing
hs-analytics.net|HubSpot|Marketing
hsforms.net|HubSpot|Marketing
hsforms.com|HubSpot|Marketing
hubspotusercontent.com|HubSpot|Marketing
hs-banner.com|HubSpot|Consent
salesforce.com|Salesforce|Marketing
pardot.com|Pardot|Marketing
marketo.net|Marketo|Marketing
mktoresp.com|Marketo|Marketing
mailchimp.com|Mailchimp|Marketing
chimpstatic.com|Mailchimp|Marketing
list-manage.com|Mailchimp|Marketing
klaviyo.com|Klaviyo|Marketing
convertkit.com|ConvertKit|Marketing
activehosted.com|ActiveCampaign|Marketing
sendinblue.com|Brevo|Marketing
optimizely.com|Optimizely|Testing
vwo.com|VWO|Testing
visualwebsiteoptimizer.com|VWO|Testing
abtasty.com|AB Tasty|Testing
launchdarkly.com|LaunchDarkly|Testing
onetrust.com|OneTrust|Consent
cookielaw.org|OneTrust|Consent
cookiebot.com|Cookiebot|Consent
trustarc.com|TrustArc|Consent
osano.com|Osano|Consent
usercentrics.eu|Usercentrics|Consent
iubenda.com|iubenda|Consent
termly.io|Termly|Consent
cookiepro.com|OneTrust|Consent
stripe.com|Stripe|Payments
stripe.network|Stripe|Payments
paypal.com|PayPal|Payments
paypalobjects.com|PayPal|Payments
braintreegateway.com|Braintree|Payments
squareup.com|Square|Payments
klarna.com|Klarna|Payments
afterpay.com|Afterpay|Payments
adyen.com|Adyen|Payments
cdn.shopify.com|Shopify|Platform
shopifycdn.com|Shopify|Platform
shopify.com|Shopify|Platform
wp.com|WordPress.com|Platform
wordpress.com|WordPress.com|Platform
gravatar.com|Gravatar|Media
cloudinary.com|Cloudinary|Media
imgix.net|imgix|Media
ctfassets.net|Contentful|Media
sanity.io|Sanity|Media
akamaihd.net|Akamai|CDN
akamaized.net|Akamai|CDN
fastly.net|Fastly|CDN
cloudfront.net|Amazon CloudFront|CDN
amazonaws.com|Amazon Web Services|CDN
azureedge.net|Azure CDN|CDN
criteo.com|Criteo|Advertising
criteo.net|Criteo|Advertising
taboola.com|Taboola|Advertising
outbrain.com|Outbrain|Advertising
adroll.com|AdRoll|Advertising
adsrvr.org|The Trade Desk|Advertising
amazon-adsystem.com|Amazon Ads|Advertising
rubiconproject.com|Magnite|Advertising
pubmatic.com|PubMatic|Advertising
openx.net|OpenX|Advertising
casalemedia.com|Index Exchange|Advertising
adnxs.com|Xandr|Advertising
3lift.com|TripleLift|Advertising
bidswitch.net|BidSwitch|Advertising
addthis.com|AddThis|Social
sharethis.com|ShareThis|Social
disqus.com|Disqus|Social
disquscdn.com|Disqus|Social
typeform.com|Typeform|Forms
calendly.com|Calendly|Forms
jotform.com|Jotform|Forms
recaptcha.net|reCAPTCHA|Security
hcaptcha.com|hCaptcha|Security
challenges.cloudflare.com|Cloudflare Turnstile|Security
algolia.net|Algolia|Search
algolianet.com|Algolia|Search
mapbox.com|Mapbox|Maps
openstreetmap.org|OpenStreetMap|Maps
leafletjs.com|Leaflet|Maps
`.trim().split('\n').map(l => l.split('|')).filter(p => p.length === 3).sort((a, b) => b[0].length - a[0].length);

function tpVendor(host) {
  host = String(host || '').toLowerCase();
  for (let i = 0; i < TP_DB.length; i++) {
    const s = TP_DB[i][0];
    if (host === s || host.endsWith('.' + s)) return { vendor: TP_DB[i][1], cat: TP_DB[i][2] };
  }
  return null;
}

// the part of a host that identifies who owns it (a small stand-in for the public-suffix list)
function tpRoot(host) {
  host = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost') return host;
  const p = host.split('.');
  if (p.length <= 2) return host;
  if (p[p.length - 1].length === 2 && /^(co|com|org|net|gov|ac|edu|or|ne|go|gob)$/.test(p[p.length - 2])) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

/* ------------------------------------------------------------------ state */
const TP = { tab: 'vendors', filter: 'all', measured: {}, tried: {}, measuring: false, runId: 0 };

function tpReset() { TP.runId++; Object.assign(TP, { tab: 'vendors', filter: 'all', measured: {}, tried: {}, measuring: false }); }

/* ------------------------------------------------------------------ analysis */
const tpMs = (ms) => ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms';
const tpName = (u) => { try { const x = new URL(u); const f = x.pathname.split('/').filter(Boolean).pop(); return f ? decodeURIComponent(f) : x.hostname; } catch (e) { return String(u).slice(0, 40); } };

function tpAnalyze(d) {
  const r = d && d.insights && d.insights.resources;
  if (!r || !r.items || !r.items.length) return null;
  let pageHost = '';
  try { pageHost = new URL(d.meta.pageUrl).hostname; } catch (e) { /* keep empty */ }
  const root = tpRoot(pageHost);

  const items = r.items.map(i => {
    let host = '';
    try { host = new URL(i.u).hostname; } catch (e) { /* keep empty */ }
    const third = !!host && tpRoot(host) !== root;
    const v = third ? tpVendor(host) : null;
    const m = TP.measured[i.u];
    const b = i.b || (m > 0 ? m : 0);
    return Object.assign({}, i, {
      host: host, third: third, vendor: third ? (v ? v.vendor : tpRoot(host)) : 'This site', cat: third ? (v ? v.cat : 'Other') : 'First-party',
      named: !!v, b: b, est: !i.b && m > 0, unknown: !b && !i.cached && i.k !== 'document'
    });
  });

  const byVendor = {};
  items.filter(i => i.third).forEach(i => {
    const v = byVendor[i.vendor] || (byVendor[i.vendor] = { vendor: i.vendor, cat: i.cat, req: 0, bytes: 0, unknown: 0, dur: 0, first: Infinity, last: 0, bl: 0, hosts: {}, items: [] });
    v.req++; v.bytes += i.b; if (i.unknown) v.unknown++; v.dur += i.d; v.first = Math.min(v.first, i.s); v.last = Math.max(v.last, i.e);
    if (i.bl) v.bl++;
    v.hosts[i.host] = 1; v.items.push(i);
  });
  const total = items.reduce((s, i) => s + i.b, 0) + ((r.nav && r.nav.bytes) || 0);
  const vendors = Object.keys(byVendor).map(k => byVendor[k]).map(v => {
    v.span = Math.max(0, v.last - v.first);
    v.impact = v.bl * 3 + v.bytes / 51200 + v.req / 6 + v.dur / 2500;
    v.level = v.bl > 0 || v.bytes >= 300 * 1024 ? 'High' : (v.bytes >= 100 * 1024 || v.dur >= 2500) ? 'Medium' : 'Low';
    v.share = total ? v.bytes / total : 0;
    v.items.sort((a, b) => (b.bl - a.bl) || (b.b - a.b) || (b.d - a.d));
    return v;
  }).sort((a, b) => b.impact - a.impact);

  const third = items.filter(i => i.third), first = items.filter(i => !i.third);
  const end = Math.max(1000, (r.nav && r.nav.load) || 0, items.reduce((m, i) => Math.max(m, i.e), 0));
  return {
    items: items, vendors: vendors, total: total, end: end, nav: r.nav, fcp: r.fcp, hints: r.hints || [], truncated: r.truncated,
    first: { req: first.length, bytes: first.reduce((s, i) => s + i.b, 0) },
    third: { req: third.length, bytes: third.reduce((s, i) => s + i.b, 0), unknown: third.filter(i => i.unknown).length, blocking: third.filter(i => i.bl), vendors: vendors.length,
      scriptBytes: third.filter(i => i.k === 'script').reduce((s, i) => s + i.b, 0) }
  };
}

/* ------------------------------------------------------------------ checks */
function tpHasHint(a, rel, origin) {
  return a.hints.some(h => h.rel.indexOf(rel) >= 0 && (() => { try { return new URL(h.href).origin === origin; } catch (e) { return false; } })());
}

function tpChecks(d) {
  const a = tpAnalyze(d);
  if (!a || !a.third.req) return [];
  const out = [];
  const open = [insOpenAction('thirdparty', 'Open third-party cost')];
  const top = a.vendors[0];

  const blocking = a.third.blocking;
  {
    const names = Array.from(new Set(blocking.map(i => i.vendor))).slice(0, 3).join(', ');
    out.push({
      label: 'No third-party file blocks rendering', pass: blocking.length === 0, sev: blocking.some(i => i.k === 'script') ? 'High' : 'Medium',
      t: 'Stop third-party files from blocking the page',
      line: `${insPlural(blocking.length, 'third-party file')} must finish before the page can show anything${names ? ` (${names})` : ''}.`,
      mean: 'The browser waits for these files before painting. If their server is slow or down, your page is blank for as long.',
      fix: 'Load scripts with defer or async, load styles without blocking, or move the file to your own server.',
      section: 'ins:thirdparty', actions: open,
      fixCode: blocking.length ? {
        where: 'head', note: 'Only defer scripts that do not have to run before the page is drawn. For styles, inline whatever the first screen needs, or self-host the file.',
        code: blocking.slice(0, 6).map(i => i.k === 'style'
          ? `<link rel="preload" href="${fxAttr(i.u)}" as="style" onload="this.onload=null;this.rel='stylesheet'">\n<noscript><link rel="stylesheet" href="${fxAttr(i.u)}"></noscript>`
          : `<script src="${fxAttr(i.u)}" defer></script>`).join('\n\n')
      } : null
    });
  }

  const tooMany = a.third.req > 20 || a.third.scriptBytes > 250 * 1024;
  out.push({
    label: 'Third-party code stays within budget', pass: !tooMany, sev: a.third.req > 40 || a.third.scriptBytes > 600 * 1024 ? 'High' : 'Medium',
    t: 'Cut back third-party code',
    line: `${insPlural(a.third.req, 'third-party request')} from ${insPlural(a.third.vendors, 'vendor')}${a.third.bytes ? `, about ${insBytes(a.third.bytes)}${a.third.unknown ? ' known' : ''}` : ''}${top ? `. Heaviest: ${top.vendor}` : ''}.`,
    mean: 'Every tag, widget and tracker is code you do not control, running on your visitors’ devices. Together they are usually the biggest reason a page feels slow.',
    fix: 'Remove what nobody looks at, load the rest after the page is usable, and ask whether each vendor still earns its place.',
    section: 'ins:thirdparty', actions: open
  });

  const slow = a.items.filter(i => i.third && i.d > 1500 && /^(script|style|font|data|other)$/.test(i.k));
  out.push({
    label: 'Third-party files respond quickly', pass: slow.length === 0, sev: 'Low',
    t: 'Look at slow third-party files',
    line: `${insPlural(slow.length, 'third-party file')} took over 1.5 seconds${slow[0] ? `, such as ${tpName(slow[0].u)} from ${slow[0].vendor}` : ''}.`,
    mean: 'A slow vendor holds up whatever waits for it, and you cannot speed up their server.',
    fix: 'Load the slow one later, replace it with a lighter alternative, or drop it.',
    section: 'ins:thirdparty', actions: open
  });

  // early third-party origins the browser has to discover the hard way
  const origins = {};
  a.items.filter(i => i.third && (i.bl || i.k === 'font' || i.k === 'style') && i.s < 2500).forEach(i => {
    try {
      const o = new URL(i.u).origin;
      const e = origins[o] || (origins[o] = { origin: o, font: false, bytes: 0 });
      e.bytes += i.b; if (i.k === 'font') e.font = true;
    } catch (x) { /* skip */ }
  });
  const missing = Object.keys(origins).map(k => origins[k]).filter(o => !tpHasHint(a, 'preconnect', o.origin)).sort((x, y) => y.bytes - x.bytes).slice(0, 3);
  if (Object.keys(origins).length) {
    out.push({
      label: 'Early third-party connections are warmed up', pass: missing.length === 0, sev: 'Low',
      t: 'Preconnect to key third-party hosts',
      line: `${insPlural(missing.length, 'host')} that the first screen depends on ${missing.length === 1 ? 'has' : 'have'} no preconnect hint: ${missing.map(m => m.origin.replace(/^https?:\/\//, '')).join(', ')}.`,
      mean: 'Opening a connection to another site takes a few round trips. A preconnect hint starts that early, so the file arrives sooner.',
      fix: 'Add a preconnect link for each host the first screen needs. Keep it to the two or three that matter.',
      section: 'ins:thirdparty', actions: open,
      fixCode: missing.length ? { where: 'head', code: missing.map(m => `<link rel="preconnect" href="${m.origin}"${m.font ? ' crossorigin' : ''}>`).join('\n'), note: 'Fonts need crossorigin even when the file is not from another site.' } : null
    });
  }
  return out;
}

/* ------------------------------------------------------------------ measuring missing sizes */
async function tpMeasure() {
  const a = tpAnalyze(lastExtractedData);
  if (!a || TP.measuring) return;
  const targets = a.items.filter(i => i.third && i.unknown && !TP.tried[i.u] && /^(script|style|font|image|other)$/.test(i.k)).slice(0, 60);
  if (!targets.length) return;
  const id = TP.runId;
  TP.measuring = true; shRender();
  let next = 0;
  const worker = async () => {
    while (id === TP.runId && next < targets.length) {
      const t = targets[next++];
      TP.tried[t.u] = true;
      const r = await lnkHeadOrGet(t.u, 8000);
      if (id !== TP.runId) return;
      if (r && !r.error && r.headers) {
        const range = String(r.headers.get('content-range') || '').match(/\/(\d+)$/);
        const len = range ? parseInt(range[1], 10) : parseInt(r.headers.get('content-length') || '0', 10);
        if (len > 0) TP.measured[t.u] = len;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (id !== TP.runId) return;
  TP.measuring = false;
  shRender();
}

/* ------------------------------------------------------------------ screen: by vendor */
const TP_CAT_CLASS = { Analytics: 'info', Advertising: 'bad', 'Tag manager': 'warn', Social: 'info', Support: 'info', Fonts: 'ok', Libraries: 'ok', Video: 'warn', Payments: 'ok', Testing: 'warn', Consent: 'ok', Monitoring: 'info', Marketing: 'info', CDN: 'ok', Media: 'ok', Maps: 'info', Security: 'ok', Search: 'ok', Forms: 'info', Platform: 'ok', Other: '' };

function tpRequestRow(i) {
  return `<div class="tp-req"><span class="tp-rn"><b title="${shEsc(i.u)}">${shEsc(insShort(tpName(i.u), 34))}</b><small>${shEsc(i.k)}${i.bl ? ' · blocks rendering' : ''}</small></span>
      <span class="tp-rs">${i.b ? (i.est ? '~' : '') + insBytes(i.b) : '<i class="cmp-none">size unknown</i>'}<small>${tpMs(i.d)}</small></span></div>`;
}

function tpVendorRow(v, a) {
  const chips = [`<span class="ins-chip ${TP_CAT_CLASS[v.cat] || ''}">${shEsc(v.cat)}</span>`];
  if (v.bl) chips.push(`<span class="ins-chip bad">${v.bl} blocking</span>`);
  if (v.level === 'High' && !v.bl) chips.push('<span class="ins-chip bad">Heavy</span>');
  const sizeTxt = v.bytes ? (v.unknown ? '≥ ' : '') + insBytes(v.bytes) : 'size unknown';
  return `<details class="tp-v"><summary>
      <span class="tp-vn"><b>${shEsc(v.vendor)}</b><small>${insPlural(v.req, 'request')} · ${tpMs(v.span || v.dur)} span</small><span class="ins-chips">${chips.join('')}</span></span>
      <span class="tp-vs"><b>${sizeTxt}</b><small>${v.share >= 0.005 ? Math.round(v.share * 100) + '% of the page' : ''}</small></span></summary>
    <div class="tp-body">${v.items.slice(0, 8).map(tpRequestRow).join('')}${v.items.length > 8 ? `<p class="ins-note" style="margin:6px 0 0">and ${v.items.length - 8} more</p>` : ''}
      <p class="ins-note" style="margin:8px 0 0">Without ${shEsc(v.vendor)} this page would make ${insPlural(v.req, 'request')} fewer${v.bytes ? ` and carry about ${insBytes(v.bytes)} less` : ''}.${v.hosts && Object.keys(v.hosts).length > 1 ? ` It uses ${Object.keys(v.hosts).length} hosts.` : ''}</p></div></details>`;
}

function tpVendorsView(a) {
  const t = a.third;
  const known = a.first.bytes + t.bytes;
  const pct = known ? Math.round(t.bytes / known * 100) : 0;
  const slowest = a.items.filter(i => i.third && i.k !== 'media').sort((x, y) => y.d - x.d)[0];
  let h = `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${t.blocking.length ? 'bad' : t.req > 20 ? 'warn' : 'ok'}">${t.req}</span><span class="sh-tchip ${t.blocking.length ? 'bad' : t.req > 20 ? 'warn' : 'ok'}">third-party requests</span><small>of ${a.items.length} · ${insPlural(t.vendors, 'vendor')}</small></div>
      <div class="ins-bar" style="margin-top:12px" role="img" aria-label="Page weight: first-party ${100 - pct}%, third-party ${pct}%"><i style="width:${100 - pct}%;background:var(--text-primary)" title="This site"></i><i style="width:${Math.max(pct, t.bytes ? 1 : 0)}%;background:var(--accent)" title="Third-party"></i></div>
      <div class="ins-legend"><span><i style="background:var(--text-primary)"></i>This site <b>${insBytes(a.first.bytes)}</b></span><span><i style="background:var(--accent)"></i>Third-party <b>${t.bytes ? insBytes(t.bytes) : 'unknown'}</b>${t.unknown ? ' (partly)' : ''}</span></div></section>`;
  h += insTiles([['Vendors', t.vendors], ['Blocking', t.blocking.length, t.blocking.length ? 'bad' : 'ok'], ['Scripts', t.scriptBytes ? insBytes(t.scriptBytes) : '—', t.scriptBytes > 250 * 1024 ? 'warn' : ''], ['Slowest', slowest ? tpMs(slowest.d) : '—', slowest && slowest.d > 1500 ? 'warn' : '']]);
  if (t.unknown) {
    h += `<div class="sh-card ins-pad"><b style="font-size:12.5px">${insPlural(t.unknown, 'file')} report no size</b><p class="ins-lede" style="margin:4px 0 8px">Other sites hide file sizes from the page unless they opt in. Ask each server for the length instead.</p>
        <div class="sh-btns"><button type="button" class="sh-btn sm" data-sh="tp" data-v="measure" ${TP.measuring ? 'disabled' : ''}>${TP.measuring ? 'Measuring…' : 'Measure missing sizes'}</button></div></div>`;
  }
  h += `<div class="sh-sec"><span>Vendors, costliest first <em>${a.vendors.length}</em></span></div><div class="tp-list">${a.vendors.map(v => tpVendorRow(v, a)).join('')}</div>`;
  if (!a.vendors.length) h += insEmpty('check', 'No third-party requests', 'Everything on this page comes from its own site.');
  return h;
}

/* ------------------------------------------------------------------ screen: waterfall */
function tpWaterfallRows(a, filter) {
  let list = a.items.slice();
  if (filter === 'third') list = list.filter(i => i.third);
  else if (filter === 'blocking') list = list.filter(i => i.bl);
  else if (filter === 'slow') list = list.sort((x, y) => y.d - x.d).slice(0, 20).sort((x, y) => x.s - y.s);
  const shown = list.slice(0, 60);
  const end = a.end;
  const pos = (v) => Math.min(100, Math.max(0, v / end * 100));
  const fcp = a.fcp != null ? pos(a.fcp) : null, load = a.nav && a.nav.load ? pos(a.nav.load) : null;
  const style = `--fcp:${fcp == null ? -5 : fcp.toFixed(2)}%;--load:${load == null ? -5 : load.toFixed(2)}%`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => `<span style="left:${f * 100}%">${tpMs(end * f)}</span>`).join('');
  const rows = shown.map(i => `<details class="wf-r${i.third ? ' third' : ''}"><summary>
        <span class="wf-n"><i class="wf-dot${i.third ? ' t' : ''}"></i><b>${shEsc(insShort(tpName(i.u), 26))}</b></span>
        <span class="wf-track" style="${style}"><i class="wf-bar${i.bl ? ' bl' : ''}" style="left:${pos(i.s).toFixed(2)}%;width:${Math.max(0.8, (i.e - i.s) / end * 100).toFixed(2)}%;background:${INS_KIND_COLOR[i.k] || '#94a3b8'}"></i></span>
        <span class="wf-t">${tpMs(i.d)}</span></summary>
      <div class="wf-body"><div class="wf-url">${shEsc(i.u)}</div>
        <div class="wf-kv"><span>Type<b>${shEsc(INS_KIND[i.k] || i.k)}</b></span><span>Starts<b>${tpMs(i.s)}</b></span><span>Takes<b>${tpMs(i.d)}</b></span><span>Size<b>${i.b ? (i.est ? '~' : '') + insBytes(i.b) : 'unknown'}</b></span><span>From<b>${shEsc(i.vendor)}</b></span><span>Protocol<b>${shEsc(i.p || '—')}</b></span></div>
        ${i.bl ? '<p class="ins-note ins-decay" style="margin:6px 0 0">This file blocks rendering: the page cannot be drawn until it has loaded.</p>' : ''}
        <div class="sh-btns"><button type="button" class="sh-btn sm" data-sh="copy" data-v="${shEsc(i.u)}">${shIcon('copy', 13)} Copy address</button></div></div></details>`).join('');
  return `<div class="wf" style="${style}"><div class="wf-axis"><span class="wf-n"></span><span class="wf-ticks">${ticks}</span><span class="wf-t"></span></div>${rows || '<p class="ins-note" style="padding:12px">Nothing matches this filter.</p>'}</div>
    ${list.length > 60 ? `<p class="ins-note">Showing the first 60 of ${list.length}.</p>` : ''}
    <div class="ins-legend wf-legend">${fcp != null ? '<span><i style="background:#16a34a"></i>First paint ' + tpMs(a.fcp) + '</span>' : ''}${load != null ? '<span><i style="background:#2563eb"></i>Page loaded ' + tpMs(a.nav.load) + '</span>' : ''}<span><i class="wf-dot t" style="background:var(--accent)"></i>Third-party</span><span><i style="background:transparent;box-shadow:inset 0 0 0 2px #dc2626"></i>Blocks rendering</span></div>`;
}

function tpWaterfallView(a) {
  const f = (k, l) => `<button type="button" class="tag${TP.filter === k ? ' active' : ''}" data-sh="tp" data-v="filter" data-f="${k}">${l}</button>`;
  const blocking = a.items.filter(i => i.bl).length;
  return `<div class="segmented" role="group" aria-label="Filter requests">${f('all', 'All')}${f('third', 'Third-party')}${f('blocking', 'Blocking ' + blocking)}${f('slow', 'Slowest')}</div>
    <div class="sh-card wf-card">${tpWaterfallRows(a, TP.filter)}</div>
    ${a.truncated ? '<p class="ins-note">The browser keeps only the first 250 requests, so a very busy page can have later ones missing.</p>' : ''}
    <p class="ins-note">Tap a row for its address, size and timing. Measured on this visit, on this device.</p>`;
}

function tpScreen(A) {
  const a = tpAnalyze(A.data);
  if (!a) return insEmpty('bolt', 'No request data', 'This page did not report its network requests. Rescan after it finishes loading.');
  const seg = (k, l) => `<button type="button" class="tag${TP.tab === k ? ' active' : ''}" data-sh="tp" data-v="tab" data-t="${k}">${l}</button>`;
  return `<div class="segmented" role="tablist" aria-label="View">${seg('vendors', 'By vendor')}${seg('waterfall', 'Waterfall')}</div>` +
    (TP.tab === 'waterfall' ? tpWaterfallView(a) : tpVendorsView(a)) +
    `<div class="sh-btns ins-foot"><button type="button" class="sh-btn pri sm" data-sh="tp" data-v="copy">${shIcon('copy', 13)} Copy summary</button></div>`;
}

function tpSummary() {
  const a = tpAnalyze(lastExtractedData);
  if (!a) return '';
  const L = [`Third-party cost for ${SH.url}`, `${a.third.req} third-party requests from ${a.third.vendors} vendors, ${a.third.bytes ? insBytes(a.third.bytes) + (a.third.unknown ? ' (partly unknown)' : '') : 'size unknown'}; ${a.third.blocking.length} block rendering`, ''];
  a.vendors.slice(0, 15).forEach(v => L.push(`- ${v.vendor} (${v.cat}): ${v.req} requests, ${v.bytes ? insBytes(v.bytes) : 'unknown size'}, ${tpMs(v.span || v.dur)}${v.bl ? ', ' + v.bl + ' blocking' : ''}`));
  return L.join('\n');
}

function tpHandle(op, el) {
  const ds = el.dataset || {};
  if (op === 'tab') { TP.tab = ds.t; shRender(); }
  else if (op === 'filter') { TP.filter = ds.f; shRender(); }
  else if (op === 'measure') tpMeasure();
  else if (op === 'copy') copyToClipboard(tpSummary(), 'Summary copied');
}

/* ------------------------------------------------------------------ registration */
SH_SCREENS.thirdparty = { title: 'Third-party cost', build: tpScreen };
SH_CATS.filter(c => c.id === 'speed')[0].explore.push(['thirdparty', 'Third-party cost', 'Who loads what, and the waterfall', 'layers']);
SH_TOOLS.Page.push(['thirdparty', 'Third-party cost', 'layers']);
SH_TOOL_META.thirdparty = 'Vendors, weight and waterfall';
SH_TOOL_KEYWORDS.thirdparty = 'third party vendors tracking scripts tags analytics ads waterfall requests network blocking render timeline weight cost';

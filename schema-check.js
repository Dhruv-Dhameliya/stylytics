/* schema-check.js — validates the page's JSON-LD against what search engines need.
 *
 * The scan already finds the JSON-LD blocks. This file checks each entity (Article, Product, FAQ,
 * Breadcrumb, Organization and so on) for missing required properties, malformed values (dates, prices,
 * ratings, relative addresses, leftover placeholders) and for markup that disagrees with the page, then
 * draws a preview of how a result might look. Rules follow Google's structured data guidelines in
 * simplified form: "required" means the markup is not useful without it, "suggested" means it
 * unlocks richer results.
 *
 *   sdAnalyze(data)  ->  { entities, errors, warns, tips, blocks, parseErrors }
 *   sdChecks(data)   ->  audit checks that join the SEO score
 *   screen `schema`  ->  results, previews and copy-ready property stubs
 */

const SD_BIZ = /^(LocalBusiness|Restaurant|CafeOrCoffeeShop|BarOrPub|Bakery|FoodEstablishment|Store|\w+Store|Dentist|Physician|Hotel|Motel|LodgingBusiness|HealthAndBeautyBusiness|BeautySalon|HairSalon|AutoRepair|AutoDealer|AutomotiveBusiness|LegalService|Attorney|RealEstateAgent|TravelAgency|FinancialService|ProfessionalService|MedicalBusiness|GymOrHealthClub|SportsActivityLocation|EntertainmentBusiness|HomeAndConstructionBusiness|Library|ChildCare|SelfStorage|EmergencyService)$/;
const SD_ORG = /^(Organization|Corporation|NGO|OnlineStore|OnlineBusiness|EducationalOrganization|CollegeOrUniversity|School|GovernmentOrganization|NewsMediaOrganization|SportsOrganization|MedicalOrganization|Airline|Consortium|PerformingGroup)$/;
const SD_AVAIL = /(^|\/)(InStock|OutOfStock|PreOrder|BackOrder|Discontinued|LimitedAvailability|SoldOut|OnlineOnly|InStoreOnly|PreSale)$/;
const SD_PLACEHOLDER = /REPLACE_|Author name|Write the |Describe the|YYYY-MM|lorem ipsum|your[ -]?(name|company)|share-1200x630|Venue$/i;

const SD_SPEC = {
  Article: { req: ['headline', 'image', 'datePublished', 'author'], rec: ['dateModified', 'publisher', 'description', 'mainEntityOfPage'], nested: { author: 'Person|Organization', publisher: 'Organization' } },
  Product: { req: ['name', 'image'], rec: ['description', 'sku', 'brand'], nested: { offers: 'Offer', aggregateRating: 'AggregateRating', review: 'Review', brand: 'Brand' } },
  Offer: { req: ['price', 'priceCurrency'], rec: ['availability', 'url'] },
  AggregateRating: { req: ['ratingValue'], rec: [] },
  Review: { req: ['author', 'reviewRating'], rec: ['datePublished', 'reviewBody'], nested: { author: 'Person|Organization', reviewRating: 'Rating' } },
  Rating: { req: ['ratingValue'], rec: ['bestRating'] },
  FAQPage: { req: ['mainEntity'], rec: [], nested: { mainEntity: 'Question' } },
  Question: { req: ['name', 'acceptedAnswer'], rec: [], nested: { acceptedAnswer: 'Answer' } },
  Answer: { req: ['text'], rec: [] },
  BreadcrumbList: { req: ['itemListElement'], rec: [], nested: { itemListElement: 'ListItem' } },
  ListItem: { req: ['position', 'name'], rec: ['item'] },
  Organization: { req: ['name'], rec: ['url', 'logo', 'sameAs', 'contactPoint', 'address'] },
  LocalBusiness: { req: ['name', 'address'], rec: ['telephone', 'openingHours', 'geo', 'image', 'url', 'priceRange'], nested: { address: 'PostalAddress' } },
  PostalAddress: { req: [], rec: ['streetAddress', 'addressLocality', 'addressCountry'] },
  WebSite: { req: ['url'], rec: ['name', 'potentialAction'] },
  WebPage: { req: [], rec: ['name', 'description'] },
  Person: { req: ['name'], rec: ['url', 'sameAs', 'jobTitle'] },
  Recipe: { req: ['name', 'image'], rec: ['author', 'datePublished', 'description', 'prepTime', 'cookTime', 'recipeIngredient', 'recipeInstructions', 'recipeYield', 'aggregateRating'], nested: { aggregateRating: 'AggregateRating' } },
  Event: { req: ['name', 'startDate', 'location'], rec: ['description', 'endDate', 'image', 'offers', 'organizer', 'eventStatus'], nested: { offers: 'Offer' } },
  VideoObject: { req: ['name', 'thumbnailUrl', 'uploadDate'], rec: ['description', 'contentUrl', 'duration'] },
  JobPosting: { req: ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation'], rec: ['validThrough', 'employmentType', 'baseSalary'] },
  HowTo: { req: ['name', 'step'], rec: ['image', 'totalTime'] },
  ItemList: { req: ['itemListElement'], rec: [] },
  SoftwareApplication: { req: ['name'], rec: ['offers', 'aggregateRating', 'applicationCategory', 'operatingSystem'], nested: { offers: 'Offer', aggregateRating: 'AggregateRating' } },
  Course: { req: ['name', 'description'], rec: ['provider'] },
  ImageObject: { req: ['contentUrl'], rec: ['name', 'caption'] }
};

function sdBaseType(t) {
  if (SD_SPEC[t]) return t;
  if (/^(NewsArticle|BlogPosting|TechArticle|Report|ScholarlyArticle|SocialMediaPosting)$/.test(t)) return 'Article';
  if (/^(ProductGroup|IndividualProduct|Vehicle|Car)$/.test(t)) return 'Product';
  if (/^(MobileApplication|WebApplication|VideoGame)$/.test(t)) return 'SoftwareApplication';
  if (SD_BIZ.test(t)) return 'LocalBusiness';
  if (SD_ORG.test(t)) return 'Organization';
  if (/^(CollectionPage|ProfilePage|AboutPage|ContactPage|FAQPage|ItemPage|SearchResultsPage|CheckoutPage|QAPage)$/.test(t) && t !== 'FAQPage') return 'WebPage';
  return null;
}

/* ------------------------------------------------------------------ small checks */
const sdIs = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).filter(k => k !== '@type').length === 0);
const sdText = (v) => { if (v == null) return ''; if (typeof v === 'string' || typeof v === 'number') return String(v); if (Array.isArray(v)) return sdText(v[0]); return sdText(v.name || v.text || v['@id'] || v.url || ''); };
const sdAbs = (u) => /^https?:\/\//i.test(String(u || '').trim());
const sdTypes = (n) => { const t = n['@type']; return Array.isArray(t) ? t.map(String) : (t ? [String(t)] : []); };
function sdFixPrice(v) {
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return '';
  if (/,/.test(s) && /\./.test(s)) s = s.replace(/,/g, '');
  else if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  return s;
}
function sdFixCurrency(v) {
  const m = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR' };
  const s = String(v).trim();
  return m[s] || (/^[a-z]{3}$/i.test(s) ? s.toUpperCase() : '');
}
function sdFixAvail(v) {
  const s = String(v);
  const k = /pre.?order/i.test(s) ? 'PreOrder' : /back.?order/i.test(s) ? 'BackOrder' : /out.?of.?stock|sold.?out/i.test(s) ? 'OutOfStock' : /in.?stock|available/i.test(s) ? 'InStock' : '';
  return k ? 'https://schema.org/' + k : '';
}
function sdFixDate(v) {
  const s = String(v).trim();
  if (/^\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}$/.test(s)) return '';   // day and month order cannot be known
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}
const sdNorm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function sdIsoDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}([T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return false;
  return !Number.isNaN(Date.parse(s));
}

// what to write for a missing property, taken from the page when it knows
function sdStub(prop, d, at) {
  const seo = d.seo || {}, og = (d.socialMeta && d.socialMeta.og) || {};
  const today = new Date().toISOString().slice(0, 10);
  const img = og.image || (d.images || [])[0] || 'https://example.com/image.jpg';
  const brand = fxBrand(d);
  const map = {
    headline: () => fxTrim(fxH1(d) || (d.meta && d.meta.title) || 'Headline', 110),
    name: () => fxH1(d) || fxClean(d.meta && d.meta.title) || brand || 'Name',
    title: () => fxH1(d) || 'Title',
    description: () => fxDescription(d) || 'Describe the page in one or two sentences.',
    image: () => [img], thumbnailUrl: () => img, contentUrl: () => img, logo: () => d.faviconUrl || 'https://example.com/logo.png',
    datePublished: () => seo.articlePublished || today, dateModified: () => seo.articleModified || seo.articlePublished || today, datePosted: () => today, uploadDate: () => today, startDate: () => today,
    author: () => ({ '@type': 'Person', name: seo.author || 'Author name' }),
    publisher: () => ({ '@type': 'Organization', name: brand, logo: { '@type': 'ImageObject', url: d.faviconUrl || 'https://example.com/logo.png' } }),
    mainEntityOfPage: () => fxCanonical(d), url: () => fxCanonical(d),
    offers: () => ({ '@type': 'Offer', url: fxCanonical(d), priceCurrency: 'USD', price: '0.00', availability: 'https://schema.org/InStock' }),
    price: () => '0.00', priceCurrency: () => 'USD', availability: () => 'https://schema.org/InStock',
    sku: () => 'REPLACE_WITH_SKU', brand: () => ({ '@type': 'Brand', name: brand }),
    aggregateRating: () => ({ '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: '10' }),
    review: () => ({ '@type': 'Review', author: { '@type': 'Person', name: 'Author name' }, reviewRating: { '@type': 'Rating', ratingValue: '5' } }),
    reviewRating: () => ({ '@type': 'Rating', ratingValue: '5' }), ratingValue: () => '4.5', reviewCount: () => '10',
    address: () => ({ '@type': 'PostalAddress', streetAddress: 'Street address', addressLocality: 'City', addressCountry: 'US' }),
    telephone: () => (d.mediaContact && d.mediaContact.phones && d.mediaContact.phones[0]) || '+1-000-000-0000',
    location: () => ({ '@type': 'Place', name: 'Venue', address: 'Venue address' }),
    sameAs: () => ((d.mediaContact && d.mediaContact.socialLinks) || []).map(s => s.url || s.href).filter(Boolean).slice(0, 5),
    mainEntity: () => [{ '@type': 'Question', name: 'Write the question', acceptedAnswer: { '@type': 'Answer', text: 'Write the answer exactly as it appears on the page.' } }],
    acceptedAnswer: () => ({ '@type': 'Answer', text: 'Write the answer exactly as it appears on the page.' }),
    text: () => 'Write the answer exactly as it appears on the page.',
    itemListElement: () => [{ '@type': 'ListItem', position: 1, name: 'Home', item: fxOrigin(d) + '/' }],
    position: () => 1, item: () => fxCanonical(d), hiringOrganization: () => ({ '@type': 'Organization', name: brand }),
    jobLocation: () => ({ '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'City', addressCountry: 'US' } }),
    step: () => [{ '@type': 'HowToStep', text: 'Describe the first step.' }]
  };
  if (prop === 'name' && /author$|Person$/.test(at || '')) return seo.author || 'Author name';
  if (prop === 'name' && /publisher$|Organization$/.test(at || '')) return brand;
  return map[prop] ? map[prop]() : 'REPLACE_WITH_' + prop.toUpperCase();
}

/* ------------------------------------------------------------------ validation of one entity */
function sdCheckEntity(node, ctx) {
  const types = sdTypes(node);
  const type = types[0] || '';
  const baseName = types.map(sdBaseType).filter(Boolean)[0] || null;
  const spec = baseName ? SD_SPEC[baseName] : null;
  const issues = [];
  const at = ctx.path;
  const add = (lv, prop, t, extra) => issues.push(Object.assign({ lv: lv, prop: prop || '', at: at, t: t }, extra || {}));

  if (!types.length) { add('error', '@type', 'This object has no @type, so search engines cannot tell what it describes.'); return { issues: issues, type: '', base: null }; }
  if (!spec) { add('tip', '@type', `“${type}” has no built-in rules here, so only the basics were checked.`); }

  const keys = Object.keys(node).filter(k => k.charAt(0) !== '@');
  keys.forEach(k => {
    const v = node[k];
    if (typeof v === 'string' && SD_PLACEHOLDER.test(v)) add('warn', k, `“${k}” still holds placeholder text: “${v.slice(0, 40)}”.`, { kind: 'placeholder' });
  });

  if (spec) {
    spec.req.forEach(p => { if (!sdIs(node[p])) add('error', p, `Missing “${p}”, which ${baseName === type ? type : type + ' (' + baseName + ')'} needs.`, { kind: 'missing', stub: true }); });
    if (!(ctx.nested && baseName === 'Person')) spec.rec.forEach(p => { if (!sdIs(node[p])) add('tip', p, `Suggested: add “${p}”.`, { kind: 'suggest', stub: true }); });
  }

  /* values */
  ['url', 'logo', 'image', 'thumbnailUrl', 'contentUrl', 'mainEntityOfPage', 'item'].forEach(p => {
    const raw = node[p];
    const list = Array.isArray(raw) ? raw : [raw];
    list.forEach(v => {
      const u = typeof v === 'string' ? v : (v && typeof v === 'object' ? (v.url || v.contentUrl || '') : '');
      if (u && typeof u === 'string' && !sdAbs(u) && !/^data:/.test(u)) { let abs = ''; try { abs = new URL(u, ctx.d && ctx.d.meta && ctx.d.meta.pageUrl).href; } catch (e) { /* none */ } add('warn', p, `“${p}” should be a full address (starting https://), not “${u.slice(0, 40)}”.`, { kind: 'url', from: u, to: abs }); }
    });
  });
  ['datePublished', 'dateModified', 'datePosted', 'uploadDate', 'startDate', 'endDate', 'validThrough'].forEach(p => {
    if (sdIs(node[p]) && typeof node[p] === 'string' && !sdIsoDate(node[p]) && !SD_PLACEHOLDER.test(node[p])) add('warn', p, `“${p}” is not a valid ISO 8601 date: “${String(node[p]).slice(0, 30)}”. Use 2025-03-18 or 2025-03-18T09:30:00+00:00.`, { kind: 'date', from: String(node[p]), to: sdFixDate(node[p]) });
  });
  if (sdIs(node.datePublished) && sdIs(node.dateModified) && sdIsoDate(node.datePublished) && sdIsoDate(node.dateModified) && Date.parse(node.dateModified) < Date.parse(node.datePublished) - 86400000) add('warn', 'dateModified', '“dateModified” is earlier than “datePublished”.', { kind: 'date' });

  if (baseName === 'Article') {
    const h = sdText(node.headline);
    if (h.length > 110) add('warn', 'headline', `The headline is ${h.length} characters. Google may cut it off after 110.`, { kind: 'length' });
    const page = [fxH1(d_ctx(ctx)), d_ctx(ctx).meta && d_ctx(ctx).meta.title].map(sdNorm).filter(Boolean);
    const hn = sdNorm(h);
    if (hn && page.length && !page.some(p => p.indexOf(hn) >= 0 || hn.indexOf(p) >= 0)) add('warn', 'headline', 'The headline does not match the page’s main heading or title. Markup should describe what visitors see.', { kind: 'match' });
    if (sdIs(node.author) && typeof node.author === 'object') { const a = Array.isArray(node.author) ? node.author[0] : node.author; if (a && !sdIs(a.name) && !a['@id']) add('error', 'author', 'The author has no name.', { kind: 'missing' }); }
  }
  if (baseName === 'Product') {
    const hasAny = sdIs(node.offers) || sdIs(node.review) || sdIs(node.aggregateRating);
    if (!hasAny) add('error', 'offers', 'A product needs at least one of offers, review or aggregateRating to qualify for rich results.', { kind: 'missing', stub: true, prop2: 'offers' });
    const page = [fxH1(d_ctx(ctx)), d_ctx(ctx).meta && d_ctx(ctx).meta.title].map(sdNorm).filter(Boolean);
    const nn = sdNorm(sdText(node.name));
    if (nn && page.length && !page.some(p => p.indexOf(nn) >= 0 || nn.indexOf(p) >= 0)) add('warn', 'name', 'The product name does not appear in the page’s heading or title.', { kind: 'match' });
  }
  if (baseName === 'Offer') {
    if (sdIs(node.price) && !/^\d+([.,]\d+)?$/.test(String(node.price).replace(/\s/g, ''))) add('warn', 'price', `“price” should be a plain number such as 19.99, not “${String(node.price).slice(0, 20)}”.`, { kind: 'price', from: String(node.price), to: sdFixPrice(node.price) });
    else if (/,/.test(String(node.price || ''))) add('warn', 'price', '“price” uses a comma. Use a dot for decimals (19.99).', { kind: 'price' });
    if (sdIs(node.priceCurrency) && !/^[A-Z]{3}$/.test(String(node.priceCurrency))) add('warn', 'priceCurrency', `“priceCurrency” should be a three-letter code such as USD, not “${String(node.priceCurrency).slice(0, 12)}”.`, { kind: 'price', from: String(node.priceCurrency), to: sdFixCurrency(node.priceCurrency) });
    if (sdIs(node.availability) && !SD_AVAIL.test(sdText(node.availability))) add('warn', 'availability', `“availability” should be a schema.org value such as https://schema.org/InStock, not “${sdText(node.availability).slice(0, 24)}”.`, { kind: 'enum', from: sdText(node.availability), to: sdFixAvail(sdText(node.availability)) });
  }
  if (baseName === 'AggregateRating' || baseName === 'Rating') {
    const rv = parseFloat(node.ratingValue), best = parseFloat(node.bestRating) || 5, worst = parseFloat(node.worstRating) || 1;
    if (sdIs(node.ratingValue) && (Number.isNaN(rv) || rv > best || rv < worst)) add('warn', 'ratingValue', `“ratingValue” (${String(node.ratingValue).slice(0, 8)}) is outside the ${worst} to ${best} scale.`, { kind: 'rating' });
    if (baseName === 'AggregateRating' && !sdIs(node.reviewCount) && !sdIs(node.ratingCount)) add('error', 'reviewCount', 'An aggregateRating needs reviewCount or ratingCount.', { kind: 'missing', stub: true });
  }
  if (baseName === 'BreadcrumbList' && Array.isArray(node.itemListElement)) {
    const pos = node.itemListElement.map(x => parseInt(x && x.position, 10));
    if (pos.some((p, i) => p !== i + 1)) add('warn', 'itemListElement', 'Breadcrumb positions should count up from 1 with no gaps.', { kind: 'order' });
  }
  if (baseName === 'FAQPage' && Array.isArray(node.mainEntity) && node.mainEntity.length < 2) add('tip', 'mainEntity', 'An FAQ page usually lists two or more questions.', { kind: 'suggest' });
  if (baseName === 'LocalBusiness' && sdIs(node.address) && typeof node.address === 'object' && !node.address.streetAddress && !node.address.addressLocality) add('warn', 'address', 'The address has no street or city.', { kind: 'missing' });

  /* nested entities */
  if (spec && spec.nested) {
    Object.keys(spec.nested).forEach(p => {
      let v = node[p];
      if (v == null) return;
      if (!Array.isArray(v)) v = [v];
      const allowed = spec.nested[p].split('|');
      v.slice(0, p === 'mainEntity' || p === 'itemListElement' ? 4 : 2).forEach((child, i) => {
        if (!child || typeof child !== 'object') return;
        if (Object.keys(child).length === 1 && child['@id']) return; // a reference to another node
        const copy = child['@type'] ? child : Object.assign({ '@type': allowed[0] }, child);
        const sub = sdCheckEntity(copy, { path: at + ' › ' + p + (v.length > 1 ? ' ' + (i + 1) : ''), d: ctx.d, graph: ctx.graph, nested: true });
        sub.issues.forEach(x => issues.push(x));
      });
    });
  }
  return { issues: issues, type: type, base: baseName };
}
function d_ctx(ctx) { return ctx.d || {}; }

/* ------------------------------------------------------------------ whole page */
function sdAnalyze(d) {
  const out = { entities: [], errors: 0, warns: 0, tips: 0, blocks: 0, parseErrors: 0, types: [] };
  const blocks = (d.structuredData && d.structuredData.blocks) || [];
  out.blocks = blocks.length;
  const ctxOk = (parsed) => { const c = parsed && parsed['@context']; return !c || /schema\.org/i.test(typeof c === 'string' ? c : JSON.stringify(c)); };
  blocks.forEach((b, bi) => {
    if (b.error || !b.parsed) { out.parseErrors++; return; }
    let roots = [];
    const top = b.parsed;
    const graphAll = [];
    const collect = (n) => {
      if (Array.isArray(n)) { n.forEach(collect); return; }
      if (!n || typeof n !== 'object') return;
      if (n['@graph']) { collect(n['@graph']); return; }
      roots.push(n); graphAll.push(n);
    };
    collect(top);
    const ctxBad = !ctxOk(top);
    roots.forEach((n, ri) => {
      const label = sdTypes(n)[0] || 'Item';
      const r = sdCheckEntity(n, { path: label, d: d, graph: graphAll });
      if (ctxBad && ri === 0) r.issues.unshift({ lv: 'error', prop: '@context', at: label, t: 'The @context is not https://schema.org, so search engines may ignore this block.', kind: 'context' });
      r.issues.forEach(i => { if (i.lv === 'error') out.errors++; else if (i.lv === 'warn') out.warns++; else out.tips++; });
      out.entities.push({ block: bi, type: r.type || label, base: r.base, name: sdText(n.headline || n.name || n.title || ''), issues: r.issues, node: n });
      if (r.type && out.types.indexOf(r.type) < 0) out.types.push(r.type);
    });
  });
  return out;
}

/* ------------------------------------------------------------------ fixes (property stubs) */
// one JSON fragment of the missing properties for an entity (top-level and nested)
function sdEntityFix(ent, d, levels) {
  const groups = {};
  ent.issues.filter(i => levels.indexOf(i.lv) >= 0 && i.stub && i.kind !== 'placeholder').forEach(i => { (groups[i.at] = groups[i.at] || []).push(i.prop2 || i.prop); });
  const parts = [];
  Object.keys(groups).forEach(at => {
    const o = {};
    groups[at].forEach(p => { if (!(p in o)) o[p] = sdStub(p, d, at); });
    const body = JSON.stringify(o, null, 2).replace(/^\{\n?/, '').replace(/\n?\}$/, '');
    parts.push('// In the ' + at.replace(/ › /g, ' › ') + ' object:\n' + body.replace(/^ {2}/gm, ''));
  });
  return parts.join('\n\n');
}

function sdFixCode(an, d, levels, filter) {
  const parts = [];
  an.entities.forEach(e => {
    const f = sdEntityFix(e, d, levels);
    if (f && (!filter || filter(e))) parts.push(f);
  });
  return parts.join('\n\n');
}

/* ------------------------------------------------------------------ audit checks */
function sdChecks(d) {
  const an = sdAnalyze(d);
  if (!an.entities.length) return [];
  const errs = [], warns = [];
  an.entities.forEach(e => e.issues.forEach(i => { if (i.lv === 'error') errs.push(i); else if (i.lv === 'warn') warns.push(i); }));
  const out = [];
  const code = sdFixCode(an, d, ['error']);
  out.push({
    label: 'Structured data has its required properties', pass: errs.length === 0, sev: 'Medium',
    t: 'Complete the structured data',
    line: `${insPlural(errs.length, 'required property is', 'required properties are')} missing: ${Array.from(new Set(errs.map(i => i.prop))).slice(0, 4).join(', ')}.`,
    mean: 'Search engines skip markup that is missing what they need, so the rich result you wrote it for never appears.',
    fix: 'Add each missing property with the real value from the page. The structured data check lists them.',
    section: 'ins:schema', actions: [insOpenAction('schema', 'Open schema check')],
    fixCode: code ? { where: 'json', code: code, note: 'Merge these properties into the objects named in the comments, then replace every placeholder with the real value.' } : null
  });
  out.push({
    label: 'Structured data values are valid', pass: warns.length === 0, sev: 'Low',
    t: 'Correct the structured data values',
    line: `${insPlural(warns.length, 'value')} ${warns.length === 1 ? 'looks' : 'look'} wrong or ${warns.length === 1 ? 'does' : 'do'} not match the page.`,
    mean: 'Wrong dates, prices and addresses are ignored or, when they disagree with the page, can lead to a manual action.',
    fix: 'Fix each value so it uses the correct format and describes what the page really shows.',
    section: 'ins:schema', actions: [insOpenAction('schema', 'Open schema check')],
    fixCode: (() => {
      const lines = [];
      an.entities.forEach(e => e.issues.forEach(i => { if (i.lv === 'warn' && i.to && i.from !== i.to) lines.push(`${i.at} › ${i.prop}:  "${i.from}"  →  "${i.to}"`); }));
      return lines.length ? { where: 'json', code: lines.slice(0, 10).join('\n'), note: 'Suggested corrections for values that are in the wrong format. Check each one against the page, and write dates in year-month-day order.' } : null;
    })()
  });
  return out;
}

/* ------------------------------------------------------------------ previews */
function sdStars(v) {
  const n = Math.max(0, Math.min(5, parseFloat(v) || 0));
  return `<span class="sd-stars" aria-label="${n} out of 5"><i style="width:${n / 5 * 100}%">★★★★★</i>★★★★★</span>`;
}
function sdImg(v) { const u = sdText(Array.isArray(v) ? v[0] : v); return sdAbs(u) ? `<img class="sd-img" src="${shEsc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''; }
function sdWhen(v) { const t = Date.parse(v); return Number.isNaN(t) ? sdText(v) : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }

function sdPreview(ent, d) {
  const n = ent.node, b = ent.base, host = fxBrand(d) || insHost(d.meta && d.meta.pageUrl) || '';
  const url = fxCanonical(d);
  const crumb = (() => { try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + u.pathname.split('/').filter(Boolean).map(s => ' › ' + decodeURIComponent(s)).join('').slice(0, 60); } catch (e) { return host; } })();
  const serp = (title, desc, extra, img) => `<div class="sd-serp"><div class="sd-serp-tx"><span class="sd-site">${shEsc(crumb)}</span><span class="sd-title">${shEsc(insShort(title || '(no title)', 70))}</span>${extra || ''}${desc ? `<span class="sd-desc">${shEsc(insShort(desc, 150))}</span>` : ''}</div>${img || ''}</div>`;
  if (b === 'Article') {
    const au = sdText(n.author);
    return serp(n.headline || n.name, n.description || (d.meta && d.meta.description), `<span class="sd-meta">${[au, n.datePublished ? sdWhen(n.datePublished) : ''].filter(Boolean).map(shEsc).join(' · ')}</span>`, sdImg(n.image));
  }
  if (b === 'Product') {
    const offer = Array.isArray(n.offers) ? n.offers[0] : n.offers;
    const r = n.aggregateRating;
    const price = offer && sdIs(offer.price) ? `${shEsc(sdText(offer.priceCurrency))} ${shEsc(sdText(offer.price))}` : '';
    const stock = offer && offer.availability ? (/InStock/i.test(sdText(offer.availability)) ? 'In stock' : /OutOfStock|SoldOut/i.test(sdText(offer.availability)) ? 'Out of stock' : sdText(offer.availability).split('/').pop()) : '';
    const meta = `<span class="sd-meta">${r && r.ratingValue ? sdStars(r.ratingValue) + ' ' + shEsc(sdText(r.ratingValue)) + (r.reviewCount || r.ratingCount ? ' (' + shEsc(sdText(r.reviewCount || r.ratingCount)) + ')' : '') + ' · ' : ''}${price ? '<b>' + price + '</b>' : ''}${stock ? ' · ' + shEsc(stock) : ''}</span>`;
    return serp(n.name, n.description, meta, sdImg(n.image));
  }
  if (b === 'FAQPage') {
    const qs = (Array.isArray(n.mainEntity) ? n.mainEntity : [n.mainEntity]).filter(q => q && q.name).slice(0, 4);
    return serp(fxClean(d.meta && d.meta.title), '', '') + `<div class="sd-faq">${qs.map(q => `<details><summary>${shEsc(insShort(q.name, 90))}</summary><p>${shEsc(insShort(sdText(q.acceptedAnswer && q.acceptedAnswer.text), 220))}</p></details>`).join('')}</div>`;
  }
  if (b === 'BreadcrumbList') {
    const items = (Array.isArray(n.itemListElement) ? n.itemListElement : []).map(i => sdText(i && (i.name || (i.item && i.item.name)))).filter(Boolean);
    return `<div class="sd-crumbs">${items.map(shEsc).join('<em> › </em>') || '<small>No items</small>'}</div>`;
  }
  if (b === 'Recipe') {
    const r = n.aggregateRating;
    return serp(n.name, n.description, `<span class="sd-meta">${r && r.ratingValue ? sdStars(r.ratingValue) + ' ' + shEsc(sdText(r.ratingValue)) + ' · ' : ''}${[n.totalTime || n.cookTime, n.recipeYield ? sdText(n.recipeYield) + ' servings' : ''].filter(Boolean).map(x => shEsc(sdText(x))).join(' · ')}</span>`, sdImg(n.image));
  }
  if (b === 'Event') {
    return serp(n.name, n.description, `<span class="sd-meta">${[n.startDate ? sdWhen(n.startDate) : '', sdText(n.location && n.location.name)].filter(Boolean).map(shEsc).join(' · ')}</span>`, sdImg(n.image));
  }
  if (b === 'VideoObject') return serp(n.name, n.description, `<span class="sd-meta">${shEsc(sdText(n.duration))} ${n.uploadDate ? '· ' + shEsc(sdWhen(n.uploadDate)) : ''}</span>`, sdImg(n.thumbnailUrl) ? `<span class="sd-vid">${sdImg(n.thumbnailUrl)}</span>` : '');
  if (b === 'JobPosting') return serp(n.title, n.description ? n.description.replace(/<[^>]+>/g, ' ') : '', `<span class="sd-meta">${[sdText(n.hiringOrganization && n.hiringOrganization.name), sdText(n.jobLocation && n.jobLocation.address && (n.jobLocation.address.addressLocality || '')), n.employmentType].filter(Boolean).map(x => shEsc(sdText(x))).join(' · ')}</span>`);
  if (b === 'Organization' || b === 'LocalBusiness') {
    const a = n.address && typeof n.address === 'object' ? [n.address.streetAddress, n.address.addressLocality, n.address.addressCountry].filter(Boolean).join(', ') : sdText(n.address);
    return `<div class="sd-kp">${sdImg(n.logo || n.image)}<span><b>${shEsc(sdText(n.name))}</b>${a ? `<small>${shEsc(a)}</small>` : ''}${n.telephone ? `<small>${shEsc(sdText(n.telephone))}</small>` : ''}${n.url ? `<small>${shEsc(insShort(sdText(n.url), 40))}</small>` : ''}</span></div>`;
  }
  if (b === 'WebSite') return serp(sdText(n.name) || host, '', n.potentialAction ? '<span class="sd-meta">Includes a search box</span>' : '');
  return '';
}

/* ------------------------------------------------------------------ screen */
const SD_LV = { error: ['Missing', 'bad', 'alert'], warn: ['Check', 'warn', 'alert'], tip: ['Suggested', 'info', 'info'] };

function sdIssueRow(i) {
  const m = SD_LV[i.lv];
  return `<div class="sd-iss ${m[1]}"><span class="sd-iss-ic">${shIcon(m[2], 13)}</span><span class="sd-iss-tx">${shEsc(i.t)}<small>${shEsc(i.at)}${i.prop ? ' · ' + shEsc(i.prop) : ''}</small></span></div>`;
}

function sdEntityCard(e, idx, d) {
  const errs = e.issues.filter(i => i.lv === 'error').length, warns = e.issues.filter(i => i.lv === 'warn').length, tips = e.issues.filter(i => i.lv === 'tip').length;
  const status = errs ? ['bad', (errs + warns) + ' to fix'] : warns ? ['warn', warns + ' to check'] : ['ok', 'Valid'];
  const order = { error: 0, warn: 1, tip: 2 };
  const rows = e.issues.slice().sort((a, b) => order[a.lv] - order[b.lv]);
  const prev = sdPreview(e, d);
  const fix = sdEntityFix(e, d, ['error', 'tip']);
  return `<details class="sd-card"${errs || warns ? ' open' : ''}><summary><span class="sd-type">${shEsc(e.type)}</span><span class="sd-name">${shEsc(insShort(e.name, 44))}</span><span class="sh-tchip ${status[0]}">${status[1]}</span></summary>
      <div class="sd-body">${prev ? `<div class="sd-prev"><small class="sd-cap">Possible appearance</small>${prev}</div>` : ''}
        ${rows.length ? `<div class="sd-iss-list">${rows.map(sdIssueRow).join('')}</div>` : '<p class="ins-note" style="margin:0">Everything checked is in order.</p>'}
        <div class="sh-btns">${fix ? `<button type="button" class="sh-btn pri sm" data-sh="sd" data-v="copy-fix" data-i="${idx}">${shIcon('copy', 13)} Copy missing properties</button>` : ''}<button type="button" class="sh-btn sm" data-sh="sd" data-v="copy-json" data-i="${idx}">Copy JSON</button></div>
        ${tips && !errs && !warns ? `<p class="ins-note" style="margin:8px 0 0">${insPlural(tips, 'optional improvement')} could earn richer results.</p>` : ''}</div></details>`;
}

function sdScreen(A) {
  const d = A.data;
  const an = sdAnalyze(d);
  const blocks = (d.structuredData && d.structuredData.blocks) || [];
  if (!blocks.length) {
    const code = fixFor('Structured data (JSON-LD) present', d);
    return insEmpty('grid', 'No structured data on this page', 'Structured data tells search engines what a page is, which can earn rich results such as ratings, prices and FAQs.') +
      (code ? `<div class="sh-sec"><span>A starting point</span></div><div class="sh-card ins-pad"><pre class="sh-code fx-code">${shEsc(code.code)}</pre><p class="fx-note">${shEsc(code.note)}</p><div class="sh-btns"><button type="button" class="sh-btn pri sm" data-sh="copy" data-v="${shEsc(code.code)}">${shIcon('copy', 13)} Copy starter</button></div></div>` : '');
  }
  const t = an.errors ? 'bad' : an.warns ? 'warn' : 'ok';
  let h = `<section class="sh-card ins-pad"><div class="ins-metric"><span class="ins-big ${t}">${an.errors + an.warns}</span><span class="sh-tchip ${t}">${an.errors ? 'Needs fixing' : an.warns ? 'Check values' : 'Looks good'}</span><small>problems found</small></div>
      <p class="ins-lede">${insPlural(an.entities.length, 'item')} in ${insPlural(an.blocks, 'block')}${an.parseErrors ? `, <b>${insPlural(an.parseErrors, 'block')} could not be read</b>` : ''}. Checked against Google’s structured data guidelines.</p></section>`;
  h += insTiles([['Items', an.entities.length], ['Missing', an.errors, an.errors ? 'bad' : 'ok'], ['To check', an.warns, an.warns ? 'warn' : 'ok'], ['Suggested', an.tips]]);
  if (an.parseErrors) h += `<div class="sh-card"><div class="sd-iss bad" style="padding:12px 14px"><span class="sd-iss-ic">${shIcon('alert', 13)}</span><span class="sd-iss-tx">${insPlural(an.parseErrors, 'block')} ${an.parseErrors === 1 ? 'contains' : 'contain'} invalid JSON and ${an.parseErrors === 1 ? 'is' : 'are'} ignored by search engines. The failing check in the SEO audit shows where.</span></div></div>`;
  h += `<div class="sh-sec"><span>Items <em>${an.entities.length}</em></span></div><div class="sd-cards">${an.entities.map((e, i) => sdEntityCard(e, i, d)).join('')}</div>`;
  const all = sdFixCode(an, d, ['error']);
  h += `<p class="ins-note">Previews are an approximation. Search engines decide what to show, and only for content that is visible on the page. Only JSON-LD is read; microdata and RDFa are not checked.</p>`;
  h += `<div class="sh-btns ins-foot">${all ? `<button type="button" class="sh-btn pri sm" data-sh="sd" data-v="copy-all">${shIcon('copy', 13)} Copy all required fixes</button>` : ''}<button type="button" class="sh-btn sm" data-sh="sd" data-v="test">Open Google’s Rich Results Test</button></div>`;
  return h;
}

function sdHandle(op, el) {
  const d = lastExtractedData;
  if (!d) return;
  const an = sdAnalyze(d);
  const ds = el.dataset || {};
  const e = an.entities[parseInt(ds.i, 10)];
  if (op === 'copy-fix' && e) { const f = sdEntityFix(e, d, ['error', 'tip']); if (f) copyToClipboard(f, 'Properties copied'); }
  else if (op === 'copy-json' && e) copyToClipboard(JSON.stringify(e.node, null, 2), 'JSON copied');
  else if (op === 'copy-all') { const f = sdFixCode(an, d, ['error']); if (f) copyToClipboard(f, 'Fixes copied'); }
  else if (op === 'test') window.open('https://search.google.com/test/rich-results?url=' + encodeURIComponent(d.meta.pageUrl), '_blank', 'noopener');
}

SH_SCREENS.schema = { title: 'Schema check', build: sdScreen };
SH_CATS.filter(c => c.id === 'seo')[0].explore.splice(3, 0, ['schema', 'Schema check', 'Required properties, values and previews', 'check']);
SH_TOOL_KEYWORDS.schema = 'structured data schema json-ld validate rich results product article faq breadcrumb';
SH_TOOL_META.schema = 'Validate JSON-LD, preview results';

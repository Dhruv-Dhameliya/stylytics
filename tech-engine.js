/* tech-engine.js — technology fingerprint matching.
 *
 * Reads the Wappalyzer fingerprint format (the community-maintained set at enthec/webappanalyzer:
 * one JSON object per technology with patterns for headers, cookies, meta tags, script URLs, page
 * globals, DOM selectors, DNS records and more) and decides which technologies a page uses.
 *
 * This is an independent implementation of the documented matching rules, checked against the
 * official wappalyzer-core on identical input. It has no browser dependencies, so it runs inside
 * the Web Worker (tech-worker.js) and under Node for testing.
 *
 *   TXE.build(raw)           raw = { technologies, categories } from the JSON files  ->  db
 *   TXE.prepare(db)          what the page must be asked: JS chains and DOM selectors
 *   TXE.analyze(db, items)   items collected from the page  ->  [{ name, version, confidence, ... }]
 *
 * The rules, in short:
 *   - every pattern is a case-insensitive regex with optional tags: \;confidence:N  \;version:\1
 *   - `+` and `*` are capped at 250 repeats so one bad page cannot hang the matcher
 *   - a technology's confidence is the sum of its matches, capped at 100
 *   - its version is the longest short version any match produced
 *   - excludes remove technologies, implies add them (at the lower of the two confidences)
 *   - a technology with `requires` is only checked once the technology it requires has been found
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- patterns */
  function regexSource(src) {
    return src
      .replace(/\//g, '\\/')
      .replace(/\\\+/g, '__escapedPlus__')
      .replace(/\+/g, '{1,250}')
      .replace(/\*/g, '{0,250}')
      .replace(/__escapedPlus__/g, '\\+');
  }

  function parsePattern(value) {
    const parts = String(value).split('\\;');
    const p = { src: parts[0], confidence: 100, version: '', re: undefined };
    for (let i = 1; i < parts.length; i++) {
      const kv = parts[i].split(':');
      if (kv.length < 2) continue;
      const key = kv.shift(), val = kv.join(':');
      if (key === 'confidence') { const c = parseInt(val || 100, 10); p.confidence = isNaN(c) ? 100 : c; }
      else if (key === 'version') p.version = val;
    }
    return p;
  }

  function regexOf(p) {
    if (p.re === undefined) {
      try { p.re = new RegExp(regexSource(p.src), 'i'); } catch (e) { p.re = null; }   // a bad pattern never matches
    }
    return p.re;
  }

  // \1 inserts a capture group, \1?a:b is a ternary on whether the group matched
  function resolveVersion(template, m) {
    let resolved = template;
    if (template && m) {
      m.forEach((match, index) => {
        if (String(match).length > 10) return;
        const ternary = new RegExp('\\\\' + index + '\\?([^:]+):(.*)$').exec(template);
        if (ternary && ternary.length === 3) resolved = template.replace(ternary[0], match ? ternary[1] : ternary[2]);
        resolved = resolved.trim().replace(new RegExp('\\\\' + index, 'g'), match || '');
      });
      resolved = resolved.replace(/\\\d/, '');
    }
    return resolved;
  }

  const toList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const patterns = (v) => toList(v).map(parsePattern);

  /* ---------------------------------------------------------------- database */
  function build(raw) {
    const db = {
      techs: [], byName: new Map(), cats: new Map(), requiresBy: new Map(), requiresCatBy: new Map(),
      lists: { url: [], html: [], text: [], css: [], robots: [], scripts: [], scriptSrc: [], xhr: [], certIssuer: [] },
      idx: { headers: new Map(), cookies: new Map(), meta: new Map(), js: new Map(), dns: new Map(), dom: new Map() },
      version: raw.fetchedAt || 0
    };
    Object.keys(raw.categories || {}).forEach((id) => {
      const c = raw.categories[id];
      db.cats.set(parseInt(id, 10), { id: parseInt(id, 10), name: c.name, priority: c.priority == null ? 10 : c.priority, groups: c.groups || [] });
    });

    const addIdx = (map, key, tech, pats) => { let a = map.get(key); if (!a) { a = []; map.set(key, a); } a.push({ tech: tech, patterns: pats }); };

    Object.keys(raw.technologies || {}).forEach((name) => {
      const t = raw.technologies[name];
      const tech = {
        name: name, cats: t.cats || [], website: t.website || '', description: t.description || '', icon: t.icon || '', cpe: t.cpe || '',
        saas: !!t.saas, oss: !!t.oss, pricing: t.pricing || [],
        implies: toList(t.implies).map((s) => { const p = parsePattern(s); return { name: p.src, confidence: p.confidence, version: p.version }; }),
        excludes: toList(t.excludes).map((s) => parsePattern(s).src),
        requires: toList(t.requires).map((s) => parsePattern(s).src),
        requiresCategory: toList(t.requiresCategory).map((x) => parseInt(x, 10)),
        gated: false, p: {}
      };
      tech.gated = tech.requires.length > 0 || tech.requiresCategory.length > 0;
      db.techs.push(tech);
      db.byName.set(name, tech);

      Object.keys(db.lists).forEach((type) => {
        const ps = patterns(t[type]);
        if (ps.length) { tech.p[type] = ps; db.lists[type].push(tech); }
      });
      ['headers', 'cookies', 'meta', 'dns'].forEach((type) => {
        const o = t[type];
        if (!o || typeof o !== 'object') return;
        Object.keys(o).forEach((k) => addIdx(db.idx[type], k.toLowerCase(), tech, patterns(o[k])));
      });
      if (t.js && typeof t.js === 'object') {
        Object.keys(t.js).forEach((chain) => addIdx(db.idx.js, chain.replace(/\[([^\]]+)\]/g, '.$1'), tech, patterns(t.js[chain])));
      }
      if (t.dom) {
        const specs = (typeof t.dom === 'string' || Array.isArray(t.dom))
          ? toList(t.dom).map((sel) => [sel, [{ exists: '' }]])
          : Object.keys(t.dom).map((sel) => [sel, toList(t.dom[sel])]);
        specs.forEach(([sel, list]) => {
          let entry = db.idx.dom.get(sel);
          if (!entry) { entry = { sel: sel, text: false, attrs: new Set(), props: new Set(), entries: [] }; db.idx.dom.set(sel, entry); }
          list.forEach((s) => {
            const spec = { exists: s.exists != null ? patterns(s.exists) : null, text: s.text != null ? patterns(s.text) : null, attributes: {}, properties: {} };
            if (spec.text) entry.text = true;
            Object.keys(s.attributes || {}).forEach((a) => { spec.attributes[a] = patterns(s.attributes[a]); entry.attrs.add(a); });
            Object.keys(s.properties || {}).forEach((a) => { spec.properties[a] = patterns(s.properties[a]); entry.props.add(a); });
            entry.entries.push({ tech: tech, spec: spec });
          });
        });
      }
    });

    db.techs.forEach((tech) => {
      tech.requires.forEach((n) => { let a = db.requiresBy.get(n); if (!a) { a = []; db.requiresBy.set(n, a); } a.push(tech); });
      tech.requiresCategory.forEach((id) => { let a = db.requiresCatBy.get(id); if (!a) { a = []; db.requiresCatBy.set(id, a); } a.push(tech); });
    });
    return db;
  }

  // what the page has to be asked: global variable paths and DOM selectors to look up
  function prepare(db) {
    return {
      version: db.version,
      js: Array.from(db.idx.js.keys()),
      dom: Array.from(db.idx.dom.values()).map((e) => ({ sel: e.sel, text: e.text, attrs: Array.from(e.attrs), props: Array.from(e.props) }))
    };
  }

  /* ---------------------------------------------------------------- matching */
  function matchAll(db, items, allow) {
    const out = [];
    const hit = (tech, type, p, value) => {
      const re = regexOf(p);
      if (!re) return;
      const m = re.exec(value);
      if (m) out.push({ tech: tech, type: type, confidence: p.confidence, version: resolveVersion(p.version, m) });
    };
    const one = (type, value) => {
      if (value == null || value === '') return;
      db.lists[type].forEach((tech) => { if (allow(tech)) tech.p[type].forEach((p) => hit(tech, type, p, value)); });
    };
    one('url', items.url); one('html', items.html); one('text', items.text); one('css', items.css);
    one('robots', items.robots); one('certIssuer', items.certIssuer);
    // inline script code is matched as one block, as the official matcher does
    if (items.scripts && items.scripts.length) one('scripts', items.scripts.join('\n'));
    const many = (type, values) => {
      if (!values || !values.length) return;
      db.lists[type].forEach((tech) => {
        if (!allow(tech)) return;
        tech.p[type].forEach((p) => values.forEach((v) => hit(tech, type, p, v)));
      });
    };
    many('scriptSrc', items.scriptSrc); many('xhr', items.xhr);

    const keyed = (type, obj) => {
      if (!obj) return;
      Object.keys(obj).forEach((k) => {
        const list = db.idx[type].get(k.toLowerCase());
        if (!list) return;
        const values = toList(obj[k]);
        list.forEach((e) => { if (allow(e.tech)) e.patterns.forEach((p) => values.forEach((v) => hit(e.tech, type, p, v == null ? '' : String(v)))); });
      });
    };
    keyed('headers', items.headers); keyed('cookies', items.cookies); keyed('meta', items.meta); keyed('dns', items.dns);

    if (items.js) {
      Object.keys(items.js).forEach((chain) => {
        const list = db.idx.js.get(chain);
        if (!list) return;
        const v = String(items.js[chain]);
        list.forEach((e) => { if (allow(e.tech)) e.patterns.forEach((p) => hit(e.tech, 'js', p, v)); });
      });
    }
    if (items.dom) {
      Object.keys(items.dom).forEach((sel) => {
        const entry = db.idx.dom.get(sel), found = items.dom[sel];
        if (!entry || !found) return;
        entry.entries.forEach((e) => {
          if (!allow(e.tech)) return;
          const s = e.spec;
          if (s.exists && found.exists) s.exists.forEach((p) => hit(e.tech, 'dom', p, ''));
          if (s.text) (found.text || []).forEach((txt) => s.text.forEach((p) => hit(e.tech, 'dom', p, txt)));
          Object.keys(s.attributes).forEach((a) => ((found.attrs || {})[a] || []).forEach((v) => s.attributes[a].forEach((p) => hit(e.tech, 'dom', p, v))));
          Object.keys(s.properties).forEach((a) => ((found.props || {})[a] || []).forEach((v) => s.properties[a].forEach((p) => hit(e.tech, 'dom', p, v))));
        });
      });
    }
    return out;
  }

  /* ---------------------------------------------------------------- resolving */
  function resolve(db, detections) {
    const byName = new Map();
    detections.forEach((d) => {
      let r = byName.get(d.tech.name);
      if (!r) { r = { tech: d.tech, confidence: 0, version: '', via: new Set(), implied: false }; byName.set(d.tech.name, r); }
      r.confidence = Math.min(100, r.confidence + d.confidence);
      const v = d.version || '';
      if (v.length > r.version.length && v.length <= 15 && (parseInt(v, 10) || 0) < 10000) r.version = v;   // long numbers are timestamps
      r.via.add(d.type);
    });
    const resolved = Array.from(byName.values());

    for (let i = 0; i < resolved.length; i++) {
      resolved[i].tech.excludes.forEach((name) => {
        for (let j = resolved.length - 1; j >= 0; j--) {
          if (resolved[j].tech.name !== name) continue;
          resolved.splice(j, 1);
          if (j <= i) i--;
        }
      });
    }

    let done;
    do {
      done = true;
      resolved.slice().forEach((r) => {
        r.tech.implies.forEach((imp) => {
          const implied = db.byName.get(imp.name);
          if (!implied || resolved.some((x) => x.tech === implied)) return;
          resolved.push({ tech: implied, confidence: Math.min(r.confidence, imp.confidence), version: imp.version || '', via: new Set(['implied']), implied: true });
          done = false;
        });
      });
    } while (!done);
    return resolved;
  }

  function primaryCategory(db, tech) {
    let best = null;
    tech.cats.forEach((id) => {
      const c = db.cats.get(id);
      if (c && (!best || c.priority < best.priority)) best = c;
    });
    return best;
  }

  function analyze(db, items) {
    let detections = matchAll(db, items, (t) => !t.gated);
    const done = new Set();
    for (let round = 0; round < 6; round++) {
      const resolved = resolve(db, detections.slice());
      const run = new Set();
      resolved.forEach((r) => {
        (db.requiresBy.get(r.tech.name) || []).forEach((t) => { if (!done.has(t)) run.add(t); });
        r.tech.cats.forEach((id) => (db.requiresCatBy.get(id) || []).forEach((t) => { if (!done.has(t)) run.add(t); }));
      });
      if (!run.size) break;
      run.forEach((t) => done.add(t));
      detections = detections.concat(matchAll(db, items, (t) => run.has(t)));
    }
    const final = resolve(db, detections);
    return final.map((r) => {
      const primary = primaryCategory(db, r.tech);
      return {
        name: r.tech.name, version: r.version, confidence: r.confidence, implied: r.implied, via: Array.from(r.via),
        cats: r.tech.cats, categories: r.tech.cats.map((id) => (db.cats.get(id) || { name: String(id) }).name),
        category: primary ? primary.name : 'Miscellaneous', priority: primary ? primary.priority : 10,
        website: r.tech.website, description: r.tech.description, icon: r.tech.icon, cpe: r.tech.cpe, saas: r.tech.saas, oss: r.tech.oss, pricing: r.tech.pricing
      };
    }).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }

  root.TXE = { build: build, prepare: prepare, analyze: analyze, parsePattern: parsePattern, resolveVersion: resolveVersion, regexSource: regexSource };
})(typeof self !== 'undefined' ? self : globalThis);

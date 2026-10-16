/* tech-worker.js — owns the technology fingerprint database and runs the matching off the UI thread.
 *
 * The rules are the community-maintained Wappalyzer set (enthec/webappanalyzer, GPL-3.0). They are not
 * bundled with the extension: this worker downloads them from the project's own repository the first
 * time they are needed, keeps them in IndexedDB, and refreshes them once a week, so the rules stay
 * current. An optional tech-db/db.json next to the extension (see tools/update-tech-db.js) is used
 * for the first run when the network is unavailable.
 *
 * Messages in:  { id, type: 'init' | 'prepare' | 'analyze' | 'status', payload }
 * Messages out: { id, ok, result | error }   and   { event: 'progress' | 'updated', ... }
 * A page with a pathological regex could stall a match, so the panel terminates this worker if it
 * does not answer in time and starts a new one.
 */
importScripts('tech-engine.js');

const TX_BASE = 'https://raw.githubusercontent.com/enthec/webappanalyzer/main/src/';
const TX_FILES = '_abcdefghijklmnopqrstuvwxyz'.split('');
const TX_MAX_AGE = 7 * 24 * 3600 * 1000;
const TX_MIN_TECHS = 5000;

let db = null, prep = null, meta = { count: 0, fetchedAt: 0, source: '' }, ready = null, refreshing = null;

/* ---------------------------------------------------------------- storage */
function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('stylytics-techdb', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  const d = await idbOpen();
  return new Promise((resolve, reject) => { const q = d.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
}
async function idbSet(key, value) {
  const d = await idbOpen();
  return new Promise((resolve, reject) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); });
}

/* ---------------------------------------------------------------- download */
async function download() {
  const getJson = async (path) => {
    const r = await fetch(TX_BASE + path, { cache: 'no-store' });
    if (!r.ok) throw new Error(path + ' answered HTTP ' + r.status);
    return r.json();
  };
  const technologies = {};
  let done = 0;
  const total = TX_FILES.length + 1;
  const tick = () => { done++; postMessage({ event: 'progress', done: done, total: total }); };
  const queue = TX_FILES.map((f) => 'technologies/' + f + '.json');
  const worker = async () => {
    while (queue.length) {
      const path = queue.shift();
      Object.assign(technologies, await getJson(path));
      tick();
    }
  };
  const categories = await getJson('categories.json');
  tick();
  await Promise.all(Array.from({ length: 6 }, worker));
  if (Object.keys(technologies).length < TX_MIN_TECHS) throw new Error('The downloaded rule set looks incomplete');
  return { technologies: technologies, categories: categories, fetchedAt: Date.now(), source: 'enthec/webappanalyzer' };
}

function use(raw) {
  db = TXE.build(raw);
  prep = TXE.prepare(db);
  meta = { count: db.techs.length, categories: db.cats.size, fetchedAt: raw.fetchedAt || 0, source: raw.source || '' };
}

// background refresh: keeps serving the old rules until the new ones are built
function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const raw = await download();
      await idbSet('db', raw);
      use(raw);
      postMessage({ event: 'updated', meta: meta });
    } finally { refreshing = null; }
  })();
  return refreshing;
}

async function load() {
  let raw = null;
  try { raw = await idbGet('db'); } catch (e) { /* no storage: fall through */ }
  if (!raw) {
    try {
      const r = await fetch('tech-db/db.json');
      if (r.ok) { const j = await r.json(); if (j && j.technologies && Object.keys(j.technologies).length >= TX_MIN_TECHS) raw = j; }
    } catch (e) { /* no bundled copy */ }
  }
  if (raw) {
    use(raw);
    if (Date.now() - (raw.fetchedAt || 0) > TX_MAX_AGE) refresh().catch(() => { /* try again next time */ });
    return;
  }
  const fresh = await download();
  try { await idbSet('db', fresh); } catch (e) { /* analysis still works without a cache */ }
  use(fresh);
}

const ensure = () => (ready = ready || load().catch((e) => { ready = null; throw e; }));

/* ---------------------------------------------------------------- messages */
self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  try {
    let result;
    if (type === 'init') { if (payload && payload.force) { await refresh(); } else await ensure(); result = meta; }
    else if (type === 'status') result = { meta: meta, loaded: !!db, refreshing: !!refreshing };
    else if (type === 'prepare') { await ensure(); result = prep; }
    else if (type === 'analyze') { await ensure(); result = TXE.analyze(db, payload); }
    else throw new Error('Unknown request ' + type);
    postMessage({ id: id, ok: true, result: result });
  } catch (err) {
    postMessage({ id: id, ok: false, error: String((err && err.message) || err) });
  }
};

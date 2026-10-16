#!/usr/bin/env node
/* Optional: bundle a snapshot of the technology rules so the extension works on its first run without
 * network access to GitHub.
 *
 *   node tools/update-tech-db.js
 *
 * Writes tech-db/db.json (and a copy of the upstream license) next to manifest.json. tech-worker.js uses
 * it only when nothing is cached yet; the weekly refresh from GitHub still replaces it.
 *
 * The rules (https://github.com/enthec/webappanalyzer) are licensed GPL-3.0. Bundling them into a copy
 * of the extension you distribute means that copy is distributed with GPL-licensed data: see
 * THIRD_PARTY_NOTICES.md. By default the extension does not bundle them and downloads them on demand.
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/enthec/webappanalyzer/main/';
const FILES = '_abcdefghijklmnopqrstuvwxyz'.split('');

async function getJson(p) {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(p + ' answered HTTP ' + r.status);
  return r.json();
}

(async () => {
  const technologies = {};
  const categories = await getJson('src/categories.json');
  for (const f of FILES) {
    Object.assign(technologies, await getJson('src/technologies/' + f + '.json'));
    process.stdout.write('.');
  }
  const count = Object.keys(technologies).length;
  if (count < 5000) throw new Error('Only ' + count + ' technologies were downloaded');
  const dir = path.join(__dirname, '..', 'tech-db');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ technologies, categories, fetchedAt: Date.now(), source: 'enthec/webappanalyzer' }));
  const license = await (await fetch(BASE + 'LICENSE')).text();
  fs.writeFileSync(path.join(dir, 'LICENSE'), license);
  console.log('\nWrote tech-db/db.json with ' + count + ' technologies and the upstream LICENSE.');
})().catch((e) => { console.error('\nFailed: ' + e.message); process.exit(1); });

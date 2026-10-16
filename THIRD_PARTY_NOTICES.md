# Third-party notices

## Technology detection rules (Wappalyzer fingerprints)

Stylytics detects the technologies a site uses by matching the page against the community-maintained
Wappalyzer rule set, **enthec/webappanalyzer** (https://github.com/enthec/webappanalyzer), a continuation
of the open-source Wappalyzer fingerprints.

- **License of the rules:** GNU General Public License v3.0 (https://www.gnu.org/licenses/gpl-3.0.html).
- **Not bundled by default.** The extension downloads the rules from the project's own repository the
  first time they are needed and once a week afterwards, and keeps them in the browser's IndexedDB.
  Only the rules are downloaded; nothing about the pages you visit is sent. No rule data is stored in
  this repository.
- **The matching code is separate.** `tech-engine.js` is original code that implements the documented
  fingerprint format. It does not contain any of the rules.
- **If you bundle the rules.** `tools/update-tech-db.js` can write a snapshot to `tech-db/db.json` so the
  extension works offline on first run. A copy of the extension that includes that snapshot is
  distributed together with GPL-3.0 data, so check what that means for how you license and share it
  before publishing such a copy (for example to a browser extension store).

Wappalyzer is a trademark of its owners. Stylytics is not affiliated with or endorsed by Wappalyzer or Enthec.

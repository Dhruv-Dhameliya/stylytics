# Stylytics

**Stylytics** is a browser extension (Chrome / Edge, Manifest V3) that opens in the browser's side panel and tells you almost everything about the web page you are looking at: its **design** (fonts, colors, spacing), **SEO**, **accessibility**, **performance**, and the **technology** it is built with.

Think of it as a "page X-ray" for designers, developers, SEO people and marketers. Click the icon, and within a second or two you get a dashboard of scores, lists and tools for the current page.

Current version: **2.2**

---

## What can it do?

The panel has three tabs on a floating bar at the bottom: **Overview**, **Audit** and **Tools**. The header shows the scanned site with a **search** button, a **rescan** button and a **⋯ menu** (Help, Settings, exports). Detail screens open over the current tab with a back button. A dark strip under the header appears whenever a live preview (font, palette, grid, color-blind, dark mode) is changing the real page, with **Reset all**.

### Overview
- A dark **hero card** with one overall score (the average of the category scores), the six audit areas as tappable tiles in two rows of three, and a **Next best fix** button.
- **Since your last scan** (once a page has been scanned before): what got worse, better or changed. See *Across time* below.
- **Up next** ranks the following issues across every audit by severity.
- **Quick tools** (pick element, pick color, capture, preview size) and a **Snapshot** of fonts, colors, links, images and the page style.
- A **Main content / Whole page** pill that excludes the header and footer from the scan (also in Settings).

### Audit tab
A scrolling rail of categories: **SEO & content**, **Design consistency**, **Accessibility**, **Page speed**, **AI readiness**, **UX review**, **Links**, **Security & delivery**, **Technology** and **Contact details**. Each scored category lists what needs attention first; tap an issue for **what it means**, **what to change**, a **copy-ready fix** (see below), copyable guidance and a shortcut to the evidence. Passed checks are folded away. A **list / grid** switch changes how issues and the Explore items are shown (Tools has the same switch), and your choice is remembered. Every screen stretches to fill the panel. The panels below are the detail behind those categories:

| Section | What it shows |
|---|---|
| **Meta Insights** | Title, description, canonical URL, robots, language, word count, and a Google **search-result preview** (desktop / mobile). Also checks `robots.txt` and `sitemap.xml`, and shows trust signals (badges, testimonials, review markup). |
| **Media Contact** | Emails, phone numbers, addresses and social links found on the page or in its structured data. |
| **Structured Data** | Reads JSON-LD (schema.org) blocks, shows detected types, and displays them as a tree or raw text. |
| **SEO Score** | A checklist (title length, one H1, meta description, viewport, etc.) turned into a score. |
| **Social Preview** | How the page will look when shared on Facebook, Twitter/X and LinkedIn (from Open Graph / Twitter Card tags). |
| **Outline** | All headings (H1–H6), counts per level, reading time, and "copy as outline / table of contents". |
| **Accessibility** | Images missing `alt`, form fields missing labels, heading-order problems, landmarks, missing `lang`. |
| **Backlinks** | Counts of do-follow / no-follow / internal / external links (click a button to highlight them on the page), plus a shortcut to the **Link checker** (see below). |
| **Tech Stack** | Detects CMS, frameworks, libraries, analytics, ads, payment tools, chat widgets, cookie banners, CDNs/servers and more. Exports as JSON with name, version, category and an `inferred` flag for each item. |
| **Performance & CWV** | Core Web Vitals (LCP, CLS, FCP, TTFB, INP) with good / needs-work / poor colors, page load stats, and a link to PageSpeed Insights. |
| **LLM Visibility** | How "friendly" the page is to AI search/answer engines (tables, lists, question-style headings, short answer paragraphs, data, and whether AI crawlers like GPTBot or ClaudeBot are blocked in `robots.txt`). |
| **Dark Patterns** | Best-effort checks for manipulative design: pre-ticked opt-in boxes, "confirm-shaming" button text, fake urgency/scarcity, hidden unsubscribe links, confusing opt-outs, undisclosed free-trial terms, disguised ads, and lopsided cookie-consent buttons. Hits are "worth a look", not proof. |

The **page report** (⋯ menu or Settings) downloads as one self-contained HTML file: overall and per-area scores, an **action plan** ordered by severity with tick-boxes and a copy-as-checklist button, a "what it means / how to fix it" note and code snippet for every issue, then the evidence behind each score (search appearance, social cards, headings, links, performance, accessibility, technology, contact and trust, site files). It works offline, has light/dark themes and prints cleanly to PDF.

### Tools tab
| Tool | What it does |
|---|---|
| **Inspect** | Browse the page's DOM as a tree (simplified or full), or click any element to see its box model, computed CSS, matched rules and attributes. Copy it as CSS or an approximate Tailwind snippet. History is kept per tab. |
| **Typography** | Lists every font family and font size; click one to highlight where it is used. A **live font preview** lets you swap a font on the page (Google Fonts are loaded automatically if needed) without changing the real site. |
| **Colors** | Text, background, hover and gradient colors. Includes an eyedropper-style color picker, **color-blindness simulation** (protanopia, deuteranopia, tritanopia, monochrome), **dark-mode preview**, a **palette generator** (monochromatic / analogous / triadic) that previews on the live page, a **WCAG contrast checker**, and export as CSS variables, Tailwind, SCSS or JSON. |
| **Responsive Simulator** | Opens the page in a popup window sized like popular phones/tablets, or any custom width × height. |
| **Design Tokens** | Most-used margins, paddings, gaps, border radii, shadows, z-indexes and CSS custom properties. Has an **8px grid / baseline overlay** for checking alignment and a **Starter Kit export** (Tailwind config, CSS variables, SCSS variables, or design-tokens JSON, with named and grouped tokens). |
| **Assets & Images** | Finds images (including CSS backgrounds and lazy-loaded ones), separates logos, flags broken images, downloads single files or **everything as a ZIP**. New images that load later are picked up automatically. |
| **Overlays & simulations** | The temporary page previews in one place: 8px grid / baseline overlay, **color-blindness simulation** and **dark-mode preview**. |
| **Screenshot & Annotate** | Capture the visible area or the **full page**, then annotate it in the full-tab editor and download (PNG / JPG / PDF) or copy to the clipboard. |

The **search** button (or Ctrl+K) finds issues, tools, settings, glossary terms and the fonts, colors, headings and links on the page. A **Style Guide** export (Tools, or the ⋯ menu) downloads a shareable design reference of the page: a consistency score, named color swatches with WCAG grades for white and black text, readable and failing text/background pairs, font specimens, the type scale, spacing usage with an 8px-grid check, radii, shadows, CSS custom properties, and copy-ready token code (CSS, Tailwind, design-tokens JSON, SCSS).

### Deeper audits
These sit inside the Audit and Tools tabs.

| Feature | What it does |
|---|---|
| **Image audit** (Audit › Page speed) | Compares each image's file size with the space it fills on screen. Flags oversized images, missing width and height, legacy formats and lazy-loading mistakes, ranks them worst first with an estimated saving, and breaks page weight down by file type. |
| **Layout shifts & LCP** (Audit › Page speed) | Names the elements that caused layout shift (each with its share), points at them on the page, and **replays** the shift. Shows which element painted last and whether it is lazy-loaded or preloaded. |
| **Field data** (Audit › Page speed) | Real-user Core Web Vitals from the Chrome UX Report next to this visit's lab numbers, with a plain explanation when they disagree. Needs a free API key (Settings). |
| **Readability** (Audit › SEO) | Flesch reading ease and grade level, sentence length, passive voice, complex words and paragraph length. English only. |
| **Accessibility lab** (Audit › Accessibility, or Tools) | Numbered **tab-order path** drawn on the page, a **focus-visibility** check, **reading order** against screen order, the **accessibility tree**, WCAG **text spacing** and **zoom/reflow** stress tests, and **ARIA validation**. Results join the audit once run. |
| **Design system** (Tools) | Paste or import tokens (CSS/SCSS variables, a Tailwind config, or design-tokens JSON, including the Starter Kit export) and see the page's **token conformance**: exact matches, near misses (probably hand-typed) and off-system values. |
| **Site scan** (Tools) | Scans up to 10 pages from the sitemap, one at a time in a background tab. Reports duplicate titles and descriptions, gaps, orphan pages, **font, size and color sprawl**, structured-data coverage, repeated problems and the lowest-scoring sections. Exports an HTML report and a CSV. |
| **Review pins** (Tools) | Point at any element on the live page and write a note. A numbered marker stays on the page with a screenshot of the element. Export a **punch list** (HTML) or copy it as text. |
| **Copy-ready fixes** (every failing check) | The audit writes the change, not just the advice: the missing title, description, canonical, viewport or Open Graph tags filled from the page, `width` and `height` for the images that lack them, a preload for the largest image, the scripts to defer, labels for unlabeled fields, a JSON-LD starter, and more. **Copy all** gathers a category's fixes into one block grouped by where each piece goes. Wording that needs a person (alt text, a description) is marked as a draft. Fixes also appear in the page report. |
| **Schema check** (Audit › SEO) | Validates each JSON-LD block (Article, Product, FAQ, Breadcrumb, Organization, LocalBusiness, Recipe, Event, Video, JobPosting and more) for missing required properties, malformed dates, prices and addresses, placeholder text and markup that contradicts the page. Shows a **possible search appearance** and writes the missing properties. |
| **Link checker** (Audit › Links, or Tools) | Requests every link on the page, menu and footer included, and sorts them into working, redirecting (cosmetic, moved, or sent to the home page), broken, server error, and *can't verify* (sites that refuse automated requests are never called broken). Also finds jump links to ids that do not exist. |
| **Server headers** (Audit › Security & delivery) | Reads the headers of the page and a sample of its heaviest files (never the content) and checks HTTPS, HSTS, Content-Security-Policy, framing, `nosniff`, referrer and permissions policy, version leaks, compression and caching. The fix is written for raw headers, nginx, Apache or Netlify. |
| **Overflow finder** (Audit › Design, or Tools) | Opens the page in a temporary window at several widths (you choose them) and finds what makes it scroll sideways at each: the element that introduces the overflow, why, and a CSS fix. Points at it on the page. |
| **Third-party cost** (Audit › Page speed, or Tools) | Names the vendors behind every request (analytics, ads, tag managers, chat, fonts, and about 200 others from a built-in list) and ranks them by weight, requests, time and whether they **block rendering**. A **waterfall** shows every request against first paint and page load, filterable to third-party, blocking or slowest. Sizes that other sites hide can be filled in on request. Adds checks for blocking third-party files, a budget, slow files and missing preconnect, each with the fix. |
| **Font optimizer** (Audit › Page speed, or Tools) | Joins what the page declares, what it downloads and what its text really uses: fonts loaded but never used, text hidden while a font loads (`font-display`), fonts found late, old formats, total weight, and the layout jump when a web font swaps in, with a **measured fallback font face** (`size-adjust` and ascent/descent overrides) to stop it. Reads Google Fonts and Adobe Fonts stylesheets too and writes the trimmed request. |
| **Compare pages** (Tools) | Puts this page next to another (staging against live, before against after, or a competitor): scores, title and description, speed, technology, fonts, colors and which issues are only on one side. Type just a domain to compare the same page on it. Exports an HTML report. |

**Across time.** Every scan is saved on this device as a compact snapshot (up to 20 per page). The next scan is compared with the previous one: title and description changes, H1 removed, new trackers, new fonts, slower vitals, new issues. It also reports how long a page's content has stood still. Turn it off, or clear it, in Settings.

### Screenshot editor
A full-tab editor (`editor.html`) opened from the screenshot panel, with a labelled tool rail on the left. Tools: select/move, arrow, line, rectangle, ellipse, freehand pen, highlight, text, blur/redact, crop (with drag handles), and an eyedropper. Includes undo/redo, stroke width and color. PDF export is built in by hand (no external library), and tries not to cut text or images in half when splitting a long page across A4 pages.

### Help
Open it from the ⋯ menu. Built-in help: a "How to use" guide and a **glossary** explaining terms such as Core Web Vitals, contrast ratio, canonical URL, etc., with good/bad thresholds. It is searchable.

### Settings
- System / light / dark theme.
- Scan main content only.
- "Remember where I left off" (restores your tab and screen per page).
- List view for assets and the max items shown per grid.
- **Track changes between scans**, and **Clear all saved scans**.
- A **Chrome UX Report API key** to show real-user data.

All settings apply immediately; there is no Save button.

---

## Installing (for development / testing)

There is no build step — it is plain HTML, CSS and JavaScript.

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
4. Pin the extension and click its icon — the side panel opens.
5. Open any normal web page and press the refresh button in the panel to scan it.

> Stylytics cannot scan browser-internal pages such as `chrome://…` or other extensions' pages.

---

## How it works (simple version)

1. You click the extension icon. `background.js` opens the **side panel** (`stylytics.html`).
2. The panel's script (`stylytics.js`) asks Chrome for the active tab and **injects** `content_extractor.js` into that page.
3. The injected script walks through the page's DOM and CSS, collects all the data (fonts, colors, headings, links, structured data, tech clues, dark-pattern signals, performance numbers…), and returns one big object.
4. `stylytics.js` takes that object and **draws** every tab, score and checklist from it.
5. When you use a live tool (highlight, inspect, font/palette preview, color-blind filter, grid overlay, full-page capture), the panel sends a **message** to the injected script, which changes the page temporarily and can undo it again.
6. Some checks need the network and are done from the panel itself: `robots.txt`, `sitemap.xml`, broken links, server headers (for backend tech detection) and scanning a few script files for library signatures.
7. The panel re-scans automatically when you switch tabs or a page finishes loading.

Screenshots: the panel captures the tab (`chrome.tabs.captureVisibleTab`). For a full-page shot it scrolls the page piece by piece, hides scrollbars and fixed elements (sticky headers) so they don't repeat, and stitches the pieces together. The result is handed to the editor tab through `chrome.storage`.

---

## Project structure

```
Stylytic/
├── manifest.json          Extension config: permissions, side panel, icons
├── background.js          Service worker: opens the side panel, cleans saved data when a tab closes
├── stylytics.html         The side panel shell, plus a hidden store of detail panels (each keeps its element IDs)
├── stylytics.css          Styles: tokens, squircle corners, shell, and the detail-panel components (light/dark)
├── stylytics.js           Scanning, rendering of every detail panel, scoring, tools, exports
├── shell.js               Navigation, header, search, Overview / Audit / Tools screens, live-preview strip, Settings
├── check-guide.js         Plain-language "what it means / what to change" text for every audit check
├── report-core.js         Shared page for downloadable reports (styles, theme toggle, copy, print, helpers)
├── report-page.js         Builds the page report
├── report-style.js        Builds the style guide
├── export-kits.js         Token naming, starter kits (CSS, SCSS, Tailwind, JSON) and the tech stack JSON
├── report-site.js         Builds the site report
├── insights.js            Image, layout-shift and readability checks; saved scans and the diff between them
├── conformance.js         Design token import and conformance against the page
├── a11y-lab.js            The Accessibility lab screen and the audit checks it adds
├── field-data.js          Chrome UX Report (CrUX) field data
├── site-scan.js           Multi-page scan: discovery, crawling, aggregation, screen
├── annotate.js            Review pins: screen, storage, punch-list export
├── fixes.js               Copy-ready fix snippets for failing checks, built from the scan
├── schema-check.js        JSON-LD validator, rich-result previews and the audit checks it adds
├── linkcheck.js           Link checker and server header analysis ("Security & delivery")
├── overflow-lab.js        Overflow finder: test window, widths, culprits, CSS fixes
├── thirdparty.js          Third-party cost: vendor list, ranking, waterfall, audit checks
├── fonts-opt.js           Font optimizer: declared against downloaded against used, fixes and fallback metrics
├── compare.js             Compare two pages
├── report-compare.js      Builds the comparison report
├── content_overflow.js    Injected into a temporary test window: measures horizontal overflow
├── content_extractor.js   Injected into the web page: collects data and runs live page tools
├── content_insights.js    Injected after it: image audit, readability, layout-shift sources, accessibility tests
├── content_annotate.js    Injected on demand: element picking and numbered pin markers
├── screenshot-shared.js   Shared canvas/annotation/PDF/export helpers (used by panel and editor)
├── editor.html / .css / .js   Full-tab screenshot editor
├── icon/                  Extension icons (16, 48, 128 px)
└── .claude/settings.json  Local Claude Code permission settings (not part of the extension)
```

---

## Permissions and why they are needed

| Permission | Why |
|---|---|
| `activeTab`, `tabs` | Know which page is open and its URL. |
| `scripting` | Inject `content_extractor.js` into the page. |
| `sidePanel` | Show the UI in the browser side panel. |
| `downloads` | Save images, ZIPs, screenshots, reports and exports. |
| `storage`, `unlimitedStorage` | Save settings, picked colors, inspect history and screenshots handed to the editor. |
| `windows` | Open the responsive-simulator popup and the overflow finder's temporary test window. |
| `<all_urls>` (host permission) | Scan any site and fetch `robots.txt`, `sitemap.xml`, links and script files for checks. |

---

## Privacy notes

- There is no server, account or analytics code in this project. Page analysis happens locally in your browser.
- The extension does make requests from your browser when you use some features: to the site being scanned (`robots.txt`, `sitemap.xml`, the page itself for server headers, its scripts, and links during a broken-link check), and to **Google Fonts** when you preview a font that is not a standard system font. The "Check CWV in PageSpeed Insights" button only opens a link.
- Saved scans, design tokens, site-scan results, review pins (with their screenshots) and an optional Chrome UX Report key are kept in `chrome.storage.local` on this device. If you add a Chrome UX Report key, the page URL is sent to Google's Chrome UX Report API to fetch real-user data; nothing is sent without a key.
- Site scan opens the pages you choose in a background tab, one at a time, and closes each one afterwards. Compare pages does the same for the one other page you type in, and the overflow finder opens the current page in a small temporary window.
- After every scan the extension requests the page once more, plus a few of its heaviest files and the plain `http://` address, to read their response headers for the Security & delivery checks. Only headers are read, and the stylesheets of other sites that declare this page's fonts (such as the Google Fonts CSS) are fetched to read their `@font-face` rules. You can turn both off in Settings (*Read server headers*). *Measure missing sizes* in Third-party cost asks each listed server for its file length when you press it. The Link checker requests each link on the page when you press the button, so the sites you link to see ordinary visits from your browser.
- Settings are kept in `chrome.storage.local`; per-tab UI state is kept in `chrome.storage.session`. Per-tab data (picked colors, inspect history) is deleted when the tab is closed.

---

## Tech used

Plain JavaScript (no framework, no build tools), HTML5 Canvas for the screenshot editor, Chrome Extension APIs (Manifest V3: side panel, scripting, tabs, storage, downloads, windows), and a hand-written ZIP and PDF writer.

## Known limits

- Tech-stack detection, dark-pattern checks and the LLM-visibility score are **heuristics** — useful hints, not guarantees.
- Site scan reads up to 10 pages per run and only pages on the same site. Orphan detection is relative to the pages scanned, so scan more pages for a fuller picture.
- The Link checker follows redirects but cannot see how many hops there were, checks up to 150 links per run (page content first) and sees pages as a signed-out visitor. Server headers are read from a normal request, so a CDN may send different headers to other visitors; the Content-Security-Policy suggestion is a safe starting point, not a finished policy.
- Third-party cost uses the browser's resource timing, which keeps only the first 250 requests and hides the size of other sites' files unless they opt in (sizes marked with `~` or `≥` are estimates). Chrome does not always list fonts pulled in by another site's stylesheet, so those are sized from the server instead and are missing from the waterfall. Vendor names come from a built-in list; unknown hosts are shown by domain.
- The Font optimizer counts only text visible at scan time, so a weight used only in a menu or tab can look unused: check before removing it. Icon fonts are never reported as unused. The fallback metrics are measured in this browser against a stock font, not read from the font file.
- Copy-ready fixes are drafts: they use the page's own values, but wording (alt text, descriptions) and anything that needs a decision (prices, ratings) must be checked by a person. The Schema check reads JSON-LD only, not microdata or RDFa, and its rules are a simplified version of Google's guidelines.
- The Overflow finder depends on the browser's minimum window width (very narrow tests may be measured slightly wider and are marked), and sites that redirect small screens to a mobile address are tested on that address.
- The focus-visibility test reads the page's `:focus` and `:focus-visible` rules; stylesheets from other domains that the browser will not let it read are not included.
- Readability formulas are written for English and use simple rules for syllables and passive voice.
- Some stylesheets from other domains cannot be read by the browser (CORS), so hover colors, CSS variables and matched rules from them may be missing.
- Very large pages are sampled (for example, a cap of roughly 12,000 elements for some scans) to stay fast.

# Stylytics

**Stylytics** is a browser extension (Chrome / Edge, Manifest V3) that opens in the browser's side panel and tells you almost everything about the web page you are looking at: its **design** (fonts, colors, spacing), **SEO**, **accessibility**, **performance**, and the **technology** it is built with.

Think of it as a "page X-ray" for designers, developers, SEO people and marketers. Click the icon, and within a second or two you get a dashboard of scores, lists and tools for the current page.

Current version: **2.2**

---

## What can it do?

The panel has four tabs at the bottom: **Overview**, **SEO**, **Tools** and **Tips**. There is also a **Settings** page (gear icon at the top) and a refresh button to re-scan the page.

### Overview
- A quick snapshot of the page with score rings (SEO, accessibility, performance, LLM visibility, etc.).
- An "Issue Breakdown" listing what needs fixing.
- A short "vibe" description of the site and a **design consistency score** (fewer colors/fonts and steadier spacing = higher score).
- A switch to **exclude header & footer** from the SEO scan, so only the main content is judged.

### SEO tab
Split into two groups: **Meta** and **Performance**.

| Section | What it shows |
|---|---|
| **Meta Insights** | Title, description, canonical URL, robots, language, word count, and a Google **search-result preview** (desktop / mobile). Also checks `robots.txt` and `sitemap.xml`, and shows trust signals (badges, testimonials, review markup). |
| **Media Contact** | Emails, phone numbers, addresses and social links found on the page or in its structured data. |
| **Structured Data** | Reads JSON-LD (schema.org) blocks, shows detected types, and displays them as a tree or raw text. |
| **SEO Score** | A checklist (title length, one H1, meta description, viewport, etc.) turned into a score. |
| **Social Preview** | How the page will look when shared on Facebook, Twitter/X and LinkedIn (from Open Graph / Twitter Card tags). |
| **Outline** | All headings (H1–H6), counts per level, reading time, and "copy as outline / table of contents". |
| **Accessibility** | Images missing `alt`, form fields missing labels, heading-order problems, landmarks, missing `lang`. |
| **Backlinks** | Counts of do-follow / no-follow / internal / external links (click a button to highlight them on the page), plus a **broken link checker**. |
| **Tech Stack** | Detects CMS, frameworks, libraries, analytics, ads, payment tools, chat widgets, cookie banners, CDNs/servers and more. Can be exported as JSON. |
| **Performance & CWV** | Core Web Vitals (LCP, CLS, FCP, TTFB, INP) with good / needs-work / poor colors, page load stats, and a link to PageSpeed Insights. |
| **LLM Visibility** | How "friendly" the page is to AI search/answer engines (tables, lists, question-style headings, short answer paragraphs, data, and whether AI crawlers like GPTBot or ClaudeBot are blocked in `robots.txt`). |
| **Dark Patterns** | Best-effort checks for manipulative design: pre-ticked opt-in boxes, "confirm-shaming" button text, fake urgency/scarcity, hidden unsubscribe links, confusing opt-outs, undisclosed free-trial terms, disguised ads, and lopsided cookie-consent buttons. Hits are "worth a look", not proof. |

You can export a full **SEO Report** from the bottom of this tab.

### Tools tab
| Tool | What it does |
|---|---|
| **Inspect** | Browse the page's DOM as a tree (simplified or full), or click any element to see its box model, computed CSS, matched rules and attributes. Copy it as CSS or an approximate Tailwind snippet. History is kept per tab. |
| **Typography** | Lists every font family and font size; click one to highlight where it is used. A **live font preview** lets you swap a font on the page (Google Fonts are loaded automatically if needed) without changing the real site. |
| **Colors** | Text, background, hover and gradient colors. Includes an eyedropper-style color picker, **color-blindness simulation** (protanopia, deuteranopia, tritanopia, monochrome), **dark-mode preview**, a **palette generator** (monochromatic / analogous / triadic) that previews on the live page, a **WCAG contrast checker**, and export as CSS variables, Tailwind, SCSS or JSON. |
| **Responsive Simulator** | Opens the page in a popup window sized like popular phones/tablets, or any custom width × height. |
| **Design Tokens** | Most-used margins, paddings, gaps, border radii, shadows, z-indexes and CSS custom properties. Has an **8px grid / baseline overlay** for checking alignment and a **Starter Kit export** (Tailwind config, CSS variables, or design-tokens JSON). |
| **Assets & Images** | Finds images (including CSS backgrounds and lazy-loaded ones), separates logos, flags broken images, downloads single files or **everything as a ZIP**. New images that load later are picked up automatically. |
| **Screenshot & Annotate** | Capture the visible area or the **full page**, annotate it, then download (PNG / JPG / PDF) or copy to the clipboard. |

There is also a global **search box** (fonts, colors, links, headings…) and a **Style Guide** export — a polished, shareable design style guide of the page.

### Screenshot editor
A full-tab editor (`editor.html`) opened from the screenshot panel. Tools: select/move, arrow, line, rectangle, ellipse, freehand pen, highlight, text, blur/redact, crop (with drag handles), and an eyedropper. Includes undo/redo, stroke width and color. PDF export is built in by hand (no external library), and tries not to cut text or images in half when splitting a long page across A4 pages.

### Tips tab
Built-in help: a "How to use" guide and a **glossary** explaining terms such as Core Web Vitals, contrast ratio, canonical URL, etc., with good/bad thresholds. It is searchable.

### Settings
- Light / dark theme.
- "Continue where you left off" (remembers your tab and section per page).
- Grid or list layout for tiles, and a "Modern Look" for the SEO tab.
- Show, hide and reorder any tool section.
- Default expanded section, max items shown per grid, list/grid view for assets.

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
├── stylytics.html         The side panel UI (all tabs, tiles, overlays)
├── stylytics.css          Styles for the side panel (light/dark themes)
├── stylytics.js           Main panel logic: scanning, rendering, scoring, tools, settings, exports
├── content_extractor.js   Injected into the web page: collects data and runs live page tools
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
| `windows` | Open the responsive-simulator popup. |
| `<all_urls>` (host permission) | Scan any site and fetch `robots.txt`, `sitemap.xml`, links and script files for checks. |

---

## Privacy notes

- There is no server, account or analytics code in this project. Page analysis happens locally in your browser.
- The extension does make requests from your browser when you use some features: to the site being scanned (`robots.txt`, `sitemap.xml`, the page itself for server headers, its scripts, and links during a broken-link check), and to **Google Fonts** when you preview a font that is not a standard system font. The "Check CWV in PageSpeed Insights" button only opens a link.
- Settings are kept in `chrome.storage.local`; per-tab UI state is kept in `chrome.storage.session`. Per-tab data (picked colors, inspect history) is deleted when the tab is closed.

---

## Tech used

Plain JavaScript (no framework, no build tools), HTML5 Canvas for the screenshot editor, Chrome Extension APIs (Manifest V3: side panel, scripting, tabs, storage, downloads, windows), and a hand-written ZIP and PDF writer.

## Known limits

- Tech-stack detection, dark-pattern checks and the LLM-visibility score are **heuristics** — useful hints, not guarantees.
- Some stylesheets from other domains cannot be read by the browser (CORS), so hover colors, CSS variables and matched rules from them may be missing.
- Very large pages are sampled (for example, a cap of roughly 12,000 elements for some scans) to stay fast.

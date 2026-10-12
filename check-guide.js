/* Plain-language guidance for every audit check.
 *
 * Keys are the check labels produced by computeSeoChecklist / computeA11yScore /
 * computeDarkPatternChecklist / computeLlmVisibilityChecklist in stylytics.js, plus the few
 * checks shell.js builds itself (design consistency, page speed).
 *
 *   t     headline shown when the check fails (an action, not a statement)
 *   sev   'High' | 'Medium' | 'Low', or a function of the scan data
 *   line  one-line description of what was found; a string or a function of the scan data
 *   mean  what the problem means for the page's audience
 *   fix   what to change
 *   tag   optional code example
 */
const CHECK_GUIDE = {
  /* ---------- SEO & content ---------- */
  'Title length is 30–60 characters': {
    t: 'Adjust the page title length', sev: 'Medium',
    line: (d) => { const n = ((d.meta && d.meta.title) || '').length; return n ? `The title is ${n} characters.` : 'The page has no title.'; },
    mean: 'Very short titles waste space in search results, and long ones get cut off.',
    fix: 'Aim for 30 to 60 characters with your main topic first.'
  },
  'Description length is 120–160 characters': {
    t: 'Add or tidy the page description',
    sev: (d) => ((d.meta && d.meta.description) ? 'Medium' : 'High'),
    line: (d) => { const n = ((d.meta && d.meta.description) || '').length; return n ? `The description is ${n} characters.` : 'The meta description is missing.'; },
    mean: 'Search engines may pick random text from the page for your snippet, which can lower clicks.',
    fix: 'Write a description of 120 to 160 characters that says what the page offers.',
    tag: '<meta name="description" content="A short summary of this page.">'
  },
  'Exactly one H1 on the page': {
    t: 'Use exactly one H1', sev: 'Medium',
    line: (d) => { const n = (d.seo && d.seo.h1Count) || 0; return n === 0 ? 'No H1 heading was found.' : `${n} H1 headings were found.`; },
    mean: 'Search engines and screen readers expect one main heading that names the page topic.',
    fix: 'Keep one H1 for the page topic and turn the others into H2s.'
  },
  'Canonical URL is present': {
    t: 'Add a canonical URL', sev: 'Medium', line: 'No canonical link was found.',
    mean: 'Without it, search engines may treat duplicate addresses of this page as separate pages.',
    fix: 'Add a canonical link pointing to the preferred address.',
    tag: '<link rel="canonical" href="https://example.com/page">'
  },
  'Canonical matches the current URL': {
    t: 'Check the canonical URL', sev: 'Medium', line: 'The canonical points to a different address.',
    mean: 'Search engines may index the other address and ignore this page.',
    fix: 'Point the canonical at this page, unless the other address is intentional.'
  },
  'Not blocked by robots (noindex/nofollow)': {
    t: 'Remove noindex or nofollow', sev: 'High', line: 'A robots tag asks search engines to stay away.',
    mean: 'A noindex tag removes the page from search results with no warning.',
    fix: 'Remove noindex or nofollow from the robots meta tag if the page should be found.'
  },
  'Mobile viewport meta tag present': {
    t: 'Add a viewport tag', sev: 'High', line: 'The viewport meta tag is missing.',
    mean: 'Phones will show a shrunken desktop layout, which hurts usability and mobile search ranking.',
    fix: 'Add the standard viewport tag to the page head.',
    tag: '<meta name="viewport" content="width=device-width, initial-scale=1">'
  },
  'Language attribute declared': {
    t: 'Declare the page language', sev: 'Medium', line: 'The html element has no lang attribute.',
    mean: 'Screen readers may read the page in the wrong accent, and search engines guess the language.',
    fix: 'Add a lang attribute to the html element.', tag: '<html lang="en">'
  },
  'Open Graph tags present': {
    t: 'Add Open Graph tags', sev: 'Medium', line: 'No og:title, og:description or og:image found.',
    mean: 'Links shared on social media will look plain or show the wrong text.',
    fix: 'Add og:title, og:description and og:image to the page head.', go: 'social'
  },
  'Structured data (JSON-LD) present': {
    t: 'Add structured data', sev: 'Low', line: 'No JSON-LD found.',
    mean: 'Structured data can unlock rich results such as ratings, prices and opening hours.',
    fix: 'Add a JSON-LD block that matches the page, for example Article, Product or LocalBusiness.'
  },
  'All images have alt text': {
    t: 'Add alt text to images', sev: 'High',
    line: (d) => { const n = (d.accessibility && d.accessibility.imagesMissingAltCount) || 0; return `${n} image${n === 1 ? ' is' : 's are'} missing alt text.`; },
    mean: 'People using a screen reader hear nothing where the image should be, and search engines cannot read it.',
    fix: 'Add a short description in alt, or alt="" for purely decorative images.'
  },
  'No broken images detected': {
    t: 'Fix broken images', sev: 'Medium',
    line: (d) => { const n = d.brokenImagesCount || 0; return `${n} image${n === 1 ? '' : 's'} failed to load.`; },
    mean: 'Broken images make the page look unfinished and waste visitors\' time.',
    fix: 'Fix the image address or remove the image.'
  },
  'Heading hierarchy has no skipped levels': {
    t: 'Fix skipped heading levels', sev: 'Low', line: 'Heading levels skip, for example H2 straight to H4.',
    mean: 'Skipped levels make the page structure confusing for screen readers and search engines.',
    fix: 'Use the next level down, for example H3 after H2.'
  },
  'Sufficient content length (300+ words)': {
    t: 'Add more content', sev: 'Low',
    line: (d) => `The page has ${(d.meta && d.meta.wordCount) || 0} words.`,
    mean: 'Very short pages often struggle to rank for competitive search terms.',
    fix: 'Cover the topic in more depth, aiming for at least 300 words of useful content.'
  },
  'Page loads in a reasonable time': {
    t: 'Speed up the page load', sev: 'Medium',
    line: (d) => { const ms = d.performance && d.performance.loadMs; return ms != null ? `The page took ${(ms / 1000).toFixed(1)} s to load.` : 'The page loaded slowly.'; },
    mean: 'Slow pages lose visitors and rank lower.',
    fix: 'Compress images, remove unused scripts and use caching or a CDN.'
  },
  'No structured data (JSON-LD) errors': {
    t: 'Fix structured data errors', sev: 'Medium', line: 'A JSON-LD block could not be read.',
    mean: 'Broken structured data is ignored, so you lose the rich results it was meant to earn.',
    fix: 'Validate the JSON-LD and fix the syntax error.', go: 'structured-data'
  },
  'Author or organization info present': {
    t: 'Show who is behind the page', sev: 'Low', line: 'No author or organization was found.',
    mean: 'Clear authorship builds trust with readers and search engines.',
    fix: 'Add an author or organization in the page or its structured data.', go: 'media-contact'
  },
  'Open Graph image present': {
    t: 'Add a social preview image', sev: 'Medium', line: 'The og:image tag is missing.',
    mean: 'Links shared on social media will show no picture, so they get fewer clicks.',
    fix: 'Add an image of at least 1200 × 630 px.',
    tag: '<meta property="og:image" content="https://example.com/share.jpg">', go: 'social'
  },
  'No render-blocking scripts in <head>': {
    t: 'Defer render-blocking scripts', sev: 'Medium',
    line: (d) => { const n = (d.performance && d.performance.renderBlockingScripts) || 0; return `${n} script${n === 1 ? ' blocks' : 's block'} rendering in the head.`; },
    mean: 'The browser must download and run these before it can show anything.',
    fix: 'Add defer or async to scripts that are not needed for the first paint.'
  },
  'Page has internal links': {
    t: 'Add internal links', sev: 'Low', line: 'No links to other pages on this site.',
    mean: 'Internal links help visitors and search engines discover your other pages.',
    fix: 'Link to related pages on your site.'
  },

  /* ---------- Accessibility ---------- */
  'All form fields have labels': {
    t: 'Label your form fields', sev: 'Medium',
    line: (d) => { const n = (d.accessibility && d.accessibility.formFieldsMissingLabelCount) || 0; return `${n} form field${n === 1 ? ' has' : 's have'} no label.`; },
    mean: 'Without a label, a screen reader announces "edit text" and nobody knows what to type.',
    fix: 'Connect a visible label with for and id, or add aria-label.'
  },
  'Header landmark present': {
    t: 'Add a header landmark', sev: 'Low', line: 'No header element or banner role found.',
    mean: 'Landmarks let screen reader users jump between page regions.', fix: 'Wrap the site header in a header element.'
  },
  'Navigation landmark present': {
    t: 'Add a navigation landmark', sev: 'Low', line: 'No nav element found.',
    mean: 'Landmarks let screen reader users jump straight to the menu.', fix: 'Wrap the main menu in a nav element.'
  },
  'Main landmark present': {
    t: 'Add a main landmark', sev: 'Medium', line: 'No main element found.',
    mean: 'Screen reader users cannot skip to the page content.', fix: 'Wrap the primary content in a main element.'
  },
  'Footer landmark present': {
    t: 'Add a footer landmark', sev: 'Low', line: 'No footer element found.',
    mean: 'Landmarks let screen reader users jump to the end of the page.', fix: 'Wrap the site footer in a footer element.'
  },
  'No heading hierarchy issues': {
    t: 'Fix heading hierarchy', sev: 'Low',
    line: (d) => { const n = computeHeadingIssues(d.outline).length; return `${n} heading issue${n === 1 ? '' : 's'} found.`; },
    mean: 'A clean heading order lets screen reader users skim the page.',
    fix: 'Start with one H1 and avoid skipping levels.', go: 'outline'
  },

  /* ---------- UX review (dark patterns) ---------- */
  'No pre-checked opt-in checkboxes': {
    t: 'Untick pre-ticked opt-ins', sev: 'High', line: 'Opt-in boxes are already ticked.',
    mean: 'Visitors can agree to marketing or extras without meaning to.',
    fix: 'Leave opt-in boxes unticked so people choose for themselves.'
  },
  'No confirm-shaming decline copy': {
    t: 'Reword guilt-trip buttons', sev: 'Medium', line: 'Decline buttons use guilt-trip wording.',
    mean: 'Wording like "No thanks, I hate saving money" pressures people instead of informing them.',
    fix: 'Use neutral wording such as "No thanks".'
  },
  'No fake urgency/scarcity language': {
    t: 'Check urgency and scarcity claims', sev: 'Medium', line: 'Urgency or scarcity wording was found.',
    mean: 'Countdowns and "only 2 left" claims are deceptive when they are not true.',
    fix: 'Keep these only when they are accurate.'
  },
  'No hidden or obscured cancel/unsubscribe links': {
    t: 'Make cancel links easy to find', sev: 'High', line: 'A cancel or unsubscribe link is hard to see.',
    mean: 'Hiding the way out traps people in subscriptions and lists.',
    fix: 'Give cancel and unsubscribe links normal size and contrast.'
  },
  'No confusing double-negative opt-outs': {
    t: 'Simplify opt-out wording', sev: 'Medium', line: 'Opt-out wording uses double negatives.',
    mean: 'Wording such as "Uncheck to not stop receiving emails" confuses people.',
    fix: 'Say plainly what ticking the box does.'
  },
  'No undisclosed free-trial billing terms': {
    t: 'Show free-trial billing terms', sev: 'High', line: 'A free trial is offered with no billing terms nearby.',
    mean: 'People can be charged without realizing it.',
    fix: 'Show the price and billing date next to the trial offer.'
  },
  'No disguised or mislabeled advertising': {
    t: 'Label advertising clearly', sev: 'Medium', line: 'Ads may look like page content.',
    mean: 'Readers should be able to tell an ad from editorial content.',
    fix: 'Add a clear "Ad" or "Sponsored" label.'
  },
  'No accept/decline button styling disparity': {
    t: 'Balance accept and decline buttons', sev: 'Medium', line: 'Accept looks far more prominent than decline.',
    mean: 'Lopsided consent buttons push people into accepting.',
    fix: 'Give both choices similar size and contrast.'
  },

  /* ---------- AI readiness ---------- */
  'Crawler Access': {
    t: 'Let AI crawlers in', sev: 'High',
    mean: 'If robots.txt blocks AI crawlers, answer engines cannot read or cite the page.',
    fix: 'Allow the AI crawlers you want in robots.txt.'
  },
  'Content Depth': {
    t: 'Add more depth', sev: 'Medium',
    mean: 'Thin pages give AI tools little to quote.', fix: 'Aim for 800 or more words of useful content.'
  },
  'Data Structure': {
    t: 'Add a table for key facts', sev: 'Low',
    mean: 'Tables are easy for AI tools to extract accurately.', fix: 'Put specs, prices or comparisons in a table.'
  },
  'Bullet Lists': {
    t: 'Add bulleted lists', sev: 'Low',
    mean: 'Lists are easy for AI tools to retrieve and quote.', fix: 'Turn steps and key points into lists.'
  },
  'Answer-First Paragraphs': {
    t: 'Write short answer paragraphs', sev: 'Medium',
    mean: 'AI answer engines often quote the short paragraph right under a heading.', fix: 'Open each section with a two-sentence answer.'
  },
  'Heading Flow': {
    t: 'Fix heading flow', sev: 'Low',
    mean: 'Skipped heading levels blur the page structure.', fix: 'Use heading levels in order.', go: 'outline'
  },
  'Heading Intent': {
    t: 'Use question-style headings', sev: 'Medium',
    mean: 'Headings phrased as questions match how people ask AI tools.', fix: 'Phrase some headings as questions.'
  },
  'Data Evidence': {
    t: 'Back claims with data', sev: 'Low',
    mean: 'Numbers and sources make a page more citable.', fix: 'Add specific figures and name your sources.'
  },
  'Schema Depth': {
    t: 'Add high-value structured data', sev: 'Medium',
    mean: 'Types such as FAQPage, Article and Product tell AI tools exactly what the page is.', fix: 'Add a matching JSON-LD type.', go: 'structured-data'
  },
  'Entity Trust': {
    t: 'Show an author or publisher', sev: 'Low',
    mean: 'Clear authorship builds trust with readers and AI tools.', fix: 'Add an author or publisher name.', go: 'media-contact'
  },
  'Freshness': {
    t: 'Refresh the content', sev: 'Low',
    mean: 'Outdated content is less likely to be cited.', fix: 'Update the page and show a last-updated date.'
  },

  /* ---------- Design consistency (built in shell.js) ---------- */
  'Color palette is compact': {
    t: 'Reduce the number of colors', sev: 'Medium',
    mean: 'More than about 8 colors usually means near-duplicate shades crept in.',
    fix: 'Merge similar shades into one small palette.', go: 'colors'
  },
  'Few font families': {
    t: 'Use fewer font families', sev: 'Low',
    mean: 'Two or three families keep a page feeling consistent.',
    fix: 'Replace extra families with your primary fonts.', go: 'typography'
  },
  'Spacing follows a consistent scale': {
    t: 'Tighten the spacing scale', sev: 'Low',
    mean: 'Many one-off margin and padding values make a layout feel uneven.',
    fix: 'Choose a spacing scale, for example multiples of 8px, and reuse it.', go: 'tokens'
  }
};

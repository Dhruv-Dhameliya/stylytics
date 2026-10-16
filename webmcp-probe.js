/* webmcp-probe.js — records WebMCP tool registrations.
 *
 * Registered by background.js to run in the page's own world at document_start. It changes nothing
 * about the page: if navigator.modelContext (or document.modelContext) exists it notes the name and
 * description of each tool the page registers, and passes the call straight through. The panel reads
 * the note when it scans (agent-run.js: arReadProbe). If the setting is off, this is not registered.
 */
(() => {
  try {
    if (window.__stylyticsWebMcp) return;
    const rec = { tools: [] };
    Object.defineProperty(window, '__stylyticsWebMcp', { value: rec, enumerable: false, configurable: true });

    const add = (t) => {
      if (!t || typeof t !== 'object' || !t.name) return;
      const name = String(t.name);
      rec.tools = rec.tools.filter(x => x.name !== name);
      rec.tools.push({ name: name, description: String(t.description || '').slice(0, 300), hasSchema: !!t.inputSchema });
    };
    const wrapped = new WeakSet();
    const wrap = (mc) => {
      if (!mc || typeof mc !== 'object' || wrapped.has(mc)) return;
      wrapped.add(mc);
      const patch = (name, note) => {
        const orig = mc[name];
        if (typeof orig !== 'function') return;
        try {
          mc[name] = function () {
            try { note.apply(null, arguments); } catch (e) { /* never break the page */ }
            return orig.apply(this, arguments);
          };
        } catch (e) { /* frozen object: leave it alone */ }
      };
      patch('registerTool', add);
      patch('addTool', add);
      patch('provideContext', (ctx) => { rec.tools = []; ((ctx && ctx.tools) || []).forEach(add); });
      patch('unregisterTool', (n) => { const name = typeof n === 'string' ? n : (n && n.name); rec.tools = rec.tools.filter(x => x.name !== name); });
      patch('clearContext', () => { rec.tools = []; });
    };
    const look = () => {
      try { wrap(navigator.modelContext); } catch (e) { /* none */ }
      try { wrap(document.modelContext); } catch (e) { /* none */ }
    };
    look();
    // polyfills install the API after the page starts, so look again a few times as it loads
    [0, 50, 200, 600, 1500, 3500].forEach(ms => setTimeout(look, ms));
    document.addEventListener('DOMContentLoaded', look);
    window.addEventListener('load', look);
  } catch (e) { /* never break the page */ }
})();

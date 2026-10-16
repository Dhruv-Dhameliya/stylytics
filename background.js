chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove([`picked_colors_${tabId}`, `inspected_elements_${tabId}`]);
  if (chrome.storage.session) {
    chrome.storage.session.remove([`ui_state_${tabId}`]);
  }
});

// The WebMCP listener (webmcp-probe.js) runs in pages' own world so it can see tools a page registers.
// It is registered only while the "Detect WebMCP tools" setting is on.
const PROBE_ID = 'stylytics-webmcp-probe';

async function syncWebMcpProbe() {
  try {
    const { ar_probe } = await chrome.storage.local.get(['ar_probe']);
    const want = ar_probe !== false;
    const have = (await chrome.scripting.getRegisteredContentScripts({ ids: [PROBE_ID] })).length > 0;
    if (want && !have) {
      await chrome.scripting.registerContentScripts([{
        id: PROBE_ID, js: ['webmcp-probe.js'], matches: ['http://*/*', 'https://*/*'], runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: true
      }]);
    } else if (!want && have) {
      await chrome.scripting.unregisterContentScripts({ ids: [PROBE_ID] });
    }
  } catch (error) { console.error(error); }
}

chrome.runtime.onInstalled.addListener(syncWebMcpProbe);
chrome.runtime.onStartup.addListener(syncWebMcpProbe);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.ar_probe) syncWebMcpProbe(); });
syncWebMcpProbe();

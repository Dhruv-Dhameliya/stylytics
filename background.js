chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove([`picked_colors_${tabId}`, `inspected_elements_${tabId}`]);
  if (chrome.storage.session) {
    chrome.storage.session.remove([`ui_state_${tabId}`]);
  }
});

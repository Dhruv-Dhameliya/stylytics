let lastExtractedData = null;
let lastActiveTabId = null;
let currentSettings = null;
let brokenImageUrls = [];
let inspectModeActive = false;
let inspectedElementsHistory = [];
let inspectCopyFormat = 'css';
let lastSiteFilesResult = null;
let inspectPanelMode = 'structure';
let treeMode = 'simplified';
let domTreeStale = true;
let lastHoveredTreeNodeId = null;
let selectedTreeNodeId = null;
let lastTechStackGrouped = new Map();
let activeBottomTab = 'overview';
let lastContrastResult = null;
let searchIndex = [];
let activePaletteKey = null;
let extractGeneration = 0;
let contentUnavailable = true;

function getSkeletonLoadingHtml() {
  const tiles = Array(6).fill(`
    <div class="skeleton-tile">
      <div class="skeleton-tile-icon"></div>
      <div class="skeleton-tile-bar"></div>
      <div class="skeleton-tile-bar skeleton-tile-bar-sm"></div>
    </div>
  `).join('');
  return `<div class="skeleton-grid">${tiles}</div>`;
}

// The Settings tab's Save bar sticks just above the always-visible bottom nav rather
// than at the raw viewport edge, so it needs that nav's real rendered height (font
// metrics/line-height make it unsafe to hardcode).
function syncBottomNavHeightVar() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  document.documentElement.style.setProperty('--bottom-nav-height', nav.offsetHeight + 'px');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings((settings) => {
    applySettings(settings);
    renderSettingsForm(settings);
  });
  setupSections();
  setupTheme();
  setupBottomNav();
  setupSeoGroupToggle();
  setupSerpDeviceToggle();
  syncBottomNavHeightVar();
  window.addEventListener('load', syncBottomNavHeightVar);
  window.addEventListener('resize', syncBottomNavHeightVar);
  setupInfoTab();
  setupGlobalSearch();
  setupKeyboardNav();
  setupColorblindToggle();
  setupDarkModePreviewToggle();
  setupGridOverlayToggle();
  setupSettingsPanel();
  setupInspectPanel();
  setupResponsiveSimulator();
  setupScreenshotPanel();
  setupExcludeHeaderFooterToggle();

  function extractData() {
    if (inspectModeActive) closeInspectOverlay();
    document.body.classList.remove('error-state');
    const loadingEl = document.getElementById('loading');
    loadingEl.innerHTML = getSkeletonLoadingHtml();
    contentUnavailable = true;
    updateContentVisibility();
    setScanning(true);

    const myGeneration = ++extractGeneration;
    const isCurrent = () => myGeneration === extractGeneration;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!isCurrent()) return;
      const activeTab = tabs[0];
      if (!activeTab) {
        showError("Cannot find active tab.", "No Active Tab");
        setScanning(false);
        return;
      }

      const url = activeTab.url || '';
      if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('chrome-extension://') || url.startsWith('edge-extension://')) {
        showError("Cannot extract styles from internal or other extensions' pages.");
        setScanning(false);
        return;
      }

      try {
        chrome.storage.local.get(['excludeHeaderFooterAudit'], (settingRes) => {
          if (!isCurrent()) return;
          const excludeHeaderFooter = !!settingRes.excludeHeaderFooterAudit;
          chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: (val) => { window.__stylyticsExcludeHeaderFooter = val; },
            args: [excludeHeaderFooter]
          }, () => {
            if (!isCurrent()) return;
            if (chrome.runtime.lastError) {
              setScanning(false);
              showError("Failed to extract page data. Ensure this isn't a restricted page.");
              return;
            }
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content_extractor.js']
            }, (results) => {
              if (!isCurrent()) return;
              setScanning(false);
              if (chrome.runtime.lastError || !results || !results.length || !results[0].result) {
                showError("Failed to extract page data. Ensure this isn't a restricted page.", "Extraction Failed");
                return;
              }
              const data = results[0].result;
              lastExtractedData = data;
              lastActiveTabId = activeTab.id;
              brokenImageUrls = [];
              domTreeStale = true;
              const inspectOverlayOpen = !document.getElementById('inspect-overlay').classList.contains('hidden');
              if (inspectOverlayOpen && inspectPanelMode === 'structure') {
                domTreeStale = false;
                ensureDomTreeLoaded();
              }

              contentUnavailable = false;
              updateContentVisibility();

              activePaletteKey = null;
              renderData(data, activeTab.id);

              const darkModeToggle = document.getElementById('dark-mode-preview-toggle');
              if (darkModeToggle) darkModeToggle.checked = false;

              const gridOverlayToggle = document.getElementById('grid-overlay-toggle');
              if (gridOverlayToggle) {
                gridOverlayToggle.querySelectorAll('.tag').forEach(b => b.classList.toggle('active', b.dataset.mode === 'none'));
                const gridOverlaySizeRow = document.getElementById('grid-overlay-size-row');
                if (gridOverlaySizeRow) gridOverlaySizeRow.classList.add('hidden');
              }

              const colorblindToggleReset = document.getElementById('colorblind-toggle');
              if (colorblindToggleReset) {
                colorblindToggleReset.querySelectorAll('.tag').forEach(b => b.classList.toggle('active', b.dataset.mode === 'normal'));
              }
              colorblindMode = 'normal';

              // Do-Follow/No-Follow/Internal/External highlight the live page — a
              // rescan re-injects the content script (which now clears that highlight,
              // see removeHighlights() in content_extractor.js's init), so the button
              // that claimed to be "active" would otherwise keep glowing over nothing.
              const linkFilterButtonsReset = ['btn-dofollow', 'btn-nofollow', 'btn-internal', 'btn-external']
                .map(id => document.getElementById(id))
                .filter(Boolean);
              linkFilterButtonsReset.forEach(b => b.classList.toggle('active', b.id === 'btn-dofollow'));
              const linksContainerReset = document.getElementById('links-container');
              if (linksContainerReset) linksContainerReset.classList.add('hidden');

              restoreUiState(activeTab.id, (savedState) => {
                if (!isCurrent()) return;
                const restoreEnabled = !currentSettings || currentSettings.restoreLastSession !== false;
                const effectiveState = restoreEnabled ? savedState : null;

                const toolsPanel = document.getElementById('tab-panel-tools');
                if (toolsPanel) toolsPanel.classList.remove('hidden');

                const applied = effectiveState && effectiveState.expandedTab && applyExpandedTab(effectiveState.expandedTab);
                if (!applied) {
                  const expandedCard = document.querySelector('#section-board .section-card.expanded');
                  if (expandedCard) expandCardBody(expandedCard);
                }
                if (effectiveState && typeof effectiveState.scrollY === 'number' && effectiveState.scrollY > 0) {
                  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, effectiveState.scrollY)));
                }

                switchBottomTab((effectiveState && effectiveState.activeBottomTab) || 'overview');
              });

              const storageKey = `picked_colors_${activeTab.id}`;
              chrome.storage.local.get([storageKey], (res) => {
                if (!isCurrent()) return;
                renderPickedColors(res[storageKey] || [], activeTab.id);
              });

              const historyStorageKey = `inspected_elements_${activeTab.id}`;
              chrome.storage.local.get([historyStorageKey], (res) => {
                if (!isCurrent()) return;
                inspectedElementsHistory = res[historyStorageKey] || [];
              });

              renderSiteFilesCheck(activeTab.url, data, myGeneration);
              renderCoreWebVitals(data, activeTab.url);

              Promise.all([
                detectBackendTechStack(activeTab.url),
                scanScriptSignatures(data.scriptUrls)
              ]).then(([backendItems, scriptItems]) => {
                if (myGeneration !== extractGeneration) return;
                renderTechStack(data.techStack, [...(backendItems || []), ...(scriptItems || [])]);
              });
            });
          });
        });
      } catch (err) {
        showError("Cannot extract styles from this page (Restricted).");
        setScanning(false);
        console.error(err);
      }
    });
  }

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      extractData();
    });
  }

  const exportStyleGuideBtn = document.getElementById('export-style-guide-btn');
  if (exportStyleGuideBtn) {
    exportStyleGuideBtn.addEventListener('click', () => {
      if (!lastExtractedData) {
        showToast('Nothing to export yet');
        return;
      }
      const html = buildStyleGuideHtml(lastExtractedData);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      let filename = 'style-guide.html';
      try {
        const host = lastExtractedData.meta && lastExtractedData.meta.canonical
          ? new URL(lastExtractedData.meta.canonical).hostname
          : null;
        if (host) filename = `style-guide-${host}.html`;
      } catch (e) { }

      chrome.downloads.download({ url, filename }, (downloadId) => {
        if (chrome.runtime.lastError) {
          window.open(url, '_blank');
        } else {
          showToast('Style guide exported');
        }
      });
    });
  }

  const exportSeoReportBtn = document.getElementById('export-seo-report-btn');
  if (exportSeoReportBtn) {
    exportSeoReportBtn.addEventListener('click', () => {
      if (!lastExtractedData) {
        showToast('Nothing to export yet');
        return;
      }
      const html = buildSeoAuditReportHtml(lastExtractedData);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      let filename = 'seo-audit-report.html';
      try {
        const host = lastExtractedData.meta && lastExtractedData.meta.canonical
          ? new URL(lastExtractedData.meta.canonical).hostname
          : null;
        if (host) filename = `seo-audit-report-${host}.html`;
      } catch (e) { }

      chrome.downloads.download({ url, filename }, (downloadId) => {
        if (chrome.runtime.lastError) {
          window.open(url, '_blank');
        } else {
          showToast('SEO audit report exported');
        }
      });
    });
  }

  const exportTechStackBtn = document.getElementById('export-tech-stack-btn');
  if (exportTechStackBtn) {
    exportTechStackBtn.addEventListener('click', () => {
      if (!lastTechStackGrouped.size) {
        showToast('Nothing to export yet');
        return;
      }
      const asObject = {};
      lastTechStackGrouped.forEach((names, category) => { asObject[category] = names; });
      const json = JSON.stringify(asObject, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      let filename = 'tech-stack.json';
      try {
        const host = lastExtractedData && lastExtractedData.meta && lastExtractedData.meta.canonical
          ? new URL(lastExtractedData.meta.canonical).hostname
          : null;
        if (host) filename = `tech-stack-${host}.json`;
      } catch (e) { }

      chrome.downloads.download({ url, filename }, (downloadId) => {
        if (chrome.runtime.lastError) {
          window.open(url, '_blank');
        } else {
          showToast('Tech stack exported');
        }
      });
    });
  }

  const linkFilterBtns = ['btn-dofollow', 'btn-nofollow', 'btn-internal', 'btn-external']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  linkFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      linkFilterBtns.forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  extractData();

  let extractDebounceTimer = null;
  function scheduleExtract() {
    clearTimeout(extractDebounceTimer);
    extractDebounceTimer = setTimeout(extractData, 150);
  }

  chrome.tabs.onActivated.addListener(() => scheduleExtract());

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
      scheduleExtract();
    }
  });

  chrome.runtime.onMessage.addListener((request, sender) => {
    if (!sender || !sender.tab || sender.tab.id !== lastActiveTabId) return;

    if (request.action === 'new_image' && request.url) {
      const logosGrid = document.getElementById('assets-grid-logos');
      const imagesGrid = document.getElementById('assets-grid-images');
      const assetsToggleContainer = document.getElementById('assets-toggle-container');

      const isSvg = request.url.toLowerCase().endsWith('.svg') || request.url.toLowerCase().includes('.svg?');
      const targetGrid = isSvg ? logosGrid : imagesGrid;

      if (targetGrid) {
        const emptyState = targetGrid.querySelector('.empty-state');
        if (emptyState) targetGrid.removeChild(emptyState);

        createAssetItem(request.url, targetGrid, lastExtractedData && lastExtractedData.meta && lastExtractedData.meta.canonical);
        if (assetsToggleContainer) assetsToggleContainer.style.display = 'flex';
        setSectionCount('assets', logosGrid.children.length + imagesGrid.children.length);

        if (imagesGrid.querySelector('.empty-state') && logosGrid.querySelector('.empty-state')) {
          if (isSvg) {
            imagesGrid.classList.add('hidden');
            logosGrid.classList.remove('hidden');
          } else {
            logosGrid.classList.add('hidden');
            imagesGrid.classList.remove('hidden');
          }
        }
      }
    } else if (request.action === 'broken_image' && request.url) {
      brokenImageUrls.push(request.url);
      renderBrokenImagesList();
    } else if (request.action === 'element-inspected' && request.info) {
      inspectModeActive = false;
      renderInspectResult(request.info);
    } else if (request.action === 'inspect-cancelled') {
      inspectModeActive = false;
      showToast('Inspect cancelled');
    }
  });

  const colorPickerBtn = document.getElementById('color-picker-btn');
  if (colorPickerBtn) {
    colorPickerBtn.addEventListener('click', async () => {
      if (!window.EyeDropper) {
        showToast("EyeDropper not supported in this browser");
        return;
      }

      let activeTabId = null;
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs[0]) activeTabId = tabs[0].id;
      } catch (e) {
        console.warn("Could not get active tab", e);
      }

      if (!activeTabId) return;

      try {
        const eyeDropper = new EyeDropper();
        const result = await eyeDropper.open();
        const hex = result.sRGBHex.toUpperCase();

        const storageKey = `picked_colors_${activeTabId}`;
        chrome.storage.local.get([storageKey], (res) => {
          const colors = res[storageKey] || [];
          if (!colors.includes(hex)) {
            colors.push(hex);
            chrome.storage.local.set({ [storageKey]: colors }, () => {
              renderPickedColors(colors, activeTabId);
              showToast(`Picked ${hex}`);
            });
          } else {
            showToast(`${hex} already picked`);
          }
        });
      } catch (err) {
        console.log("EyeDropper cancelled or failed", err);
      }
    });
  }
});

function getCardBodyEl(card) {
  if (card.dataset.tab) {
    return document.querySelector(`.section-card-body[data-owner-tab="${card.dataset.tab}"]`) || card.querySelector('.section-card-body');
  }
  return card.querySelector('.section-card-body');
}

function expandCardBody(card) {
  const body = getCardBodyEl(card);
  if (!body) return;
  body._collapseToken = (body._collapseToken || 0) + 1;
  const inner = body.querySelector('.section-card-body-inner');
  body.style.height = inner.scrollHeight + 'px';
}

function collapseCardBody(card) {
  const body = getCardBodyEl(card);
  if (!body) return;
  const current = body.getBoundingClientRect().height;
  body.style.height = current + 'px';
  body.getBoundingClientRect();
  body.style.height = '0px';
}

const SECTION_GRID_COLUMNS = 4;

function setBoardLayoutMode(board, mode) {
  if (!board) return;
  const newMode = mode === 'grid' ? 'grid' : 'list';
  const wasGrid = board.classList.contains('grid-mode');
  if ((newMode === 'grid') !== wasGrid) {
    const expanded = board.querySelector('.section-card.expanded');
    if (expanded) closeSectionTile(expanded);
  }
  board.classList.toggle('grid-mode', newMode === 'grid');
}

function setSectionLayoutMode(mode) {
  setBoardLayoutMode(document.getElementById('section-board'), mode);
}

function getGridRowTiles(card, allCards) {
  const visible = allCards.filter(c => c.dataset.tab && !c.classList.contains('hidden'));
  const idx = visible.indexOf(card);
  if (idx === -1) return [card];
  const rowStart = Math.floor(idx / SECTION_GRID_COLUMNS) * SECTION_GRID_COLUMNS;
  const rowEnd = Math.min(rowStart + SECTION_GRID_COLUMNS, visible.length);
  return visible.slice(rowStart, rowEnd);
}

function restoreBodyToOwner(card) {
  const body = getCardBodyEl(card);
  if (body && body.parentElement !== card) card.appendChild(body);
  if (body) body.style.removeProperty('--tile-accent');
}

function collapseAndRestore(card) {
  const board = card.closest('.section-board');
  const wasGrid = !!(board && board.classList.contains('grid-mode'));
  const body = getCardBodyEl(card);
  collapseCardBody(card);
  if (!wasGrid || !body) return;

  const token = (body._collapseToken = (body._collapseToken || 0) + 1);
  let finished = false;
  const finish = () => {
    if (finished || body._collapseToken !== token) return;
    finished = true;
    body.removeEventListener('transitionend', onTransitionEnd);
    restoreBodyToOwner(card);
  };
  const onTransitionEnd = (e) => { if (e.propertyName === 'height') finish(); };
  body.addEventListener('transitionend', onTransitionEnd);
  setTimeout(finish, 320);
}

function openSectionTile(card) {
  const board = card.closest('.section-board');
  if (!board) return;
  const cards = Array.from(board.querySelectorAll('.section-card'));

  cards.forEach(c => {
    if (c !== card && c.classList.contains('expanded')) {
      collapseAndRestore(c);
    }
    c.classList.remove('expanded', 'dimmed');
  });

  card.classList.add('expanded');

  if (board.classList.contains('grid-mode')) {
    const body = getCardBodyEl(card);
    const rowTiles = getGridRowTiles(card, cards);
    const lastInRow = rowTiles[rowTiles.length - 1];
    if (body && lastInRow && lastInRow.nextSibling !== body) {
      lastInRow.insertAdjacentElement('afterend', body);
    }
    if (body) body.style.setProperty('--tile-accent', card.style.getPropertyValue('--tile-accent'));
  }

  expandCardBody(card);
  cards.forEach(c => { if (c !== card) c.classList.add('dimmed'); });
  syncSeoPillsForBoard(board);
}

function closeSectionTile(card) {
  const board = card.closest('.section-board');
  collapseAndRestore(card);
  card.classList.remove('expanded', 'dimmed');
  if (board) board.querySelectorAll('.section-card').forEach(c => c.classList.remove('dimmed'));
  syncSeoPillsForBoard(board);
}

// keeps the Modern Look pill bar's active state in sync no matter how a card was
// expanded/collapsed (pill click, header click, checklist jump, settings restore, ...)
function syncSeoPillsForBoard(board) {
  if (!board) return;
  if (board.id === 'seo-meta-board') syncSeoPillActiveStates('seo-meta-board', 'seo-meta-pills');
  else if (board.id === 'seo-performance-board') syncSeoPillActiveStates('seo-performance-board', 'seo-performance-pills');
}

function saveUiState() {
  if (!lastActiveTabId || !chrome.storage.session) return;
  const board = document.getElementById('section-board');
  const expandedCard = board && board.querySelector('.section-card.expanded');
  chrome.storage.session.set({
    [`ui_state_${lastActiveTabId}`]: {
      expandedTab: expandedCard ? expandedCard.dataset.tab : null,
      scrollY: window.scrollY,
      activeBottomTab
    }
  });
}

function restoreUiState(tabId, callback) {
  if (!tabId || !chrome.storage.session) { callback(null); return; }
  chrome.storage.session.get([`ui_state_${tabId}`], (res) => {
    callback(res[`ui_state_${tabId}`] || null);
  });
}

function applyExpandedTab(tabKey) {
  const target = document.querySelector(`.section-card[data-tab="${tabKey}"]`);
  if (!target || target.classList.contains('hidden')) return false;
  openSectionTile(target);
  return true;
}

let scrollSaveDebounceTimer = null;
window.addEventListener('scroll', () => {
  clearTimeout(scrollSaveDebounceTimer);
  scrollSaveDebounceTimer = setTimeout(saveUiState, 200);
}, { passive: true });

// Overview/SEO/Tools depend on data extracted from the active page; Settings/Info don't,
// so they stay reachable even while extraction is loading or has failed.
function updateContentVisibility() {
  const loadingEl = document.getElementById('loading');
  const contentEl = document.getElementById('content');
  const onDataTab = activeBottomTab === 'overview' || activeBottomTab === 'seo' || activeBottomTab === 'tools';
  const showLoading = contentUnavailable && onDataTab;
  loadingEl.classList.toggle('hidden', !showLoading);
  contentEl.classList.toggle('hidden', showLoading);
}

let lastNonSettingsTab = 'overview';

function switchBottomTab(tabKey) {
  const key = ['overview', 'seo', 'tools', 'settings', 'info'].includes(tabKey) ? tabKey : 'overview';
  if (activeBottomTab !== 'settings') lastNonSettingsTab = activeBottomTab;
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tab-panel-${key}`);
  });
  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bottomTab === key);
  });
  const settingsHeaderBtn = document.getElementById('settings-header-btn');
  if (settingsHeaderBtn) settingsHeaderBtn.classList.toggle('active', key === 'settings');
  activeBottomTab = key;
  updateContentVisibility();
  saveUiState();
}

function jumpToToolsSection(sectionKey) {
  const card = document.querySelector(`.section-card[data-tab="${sectionKey}"]`);
  const panel = card && card.closest('.tab-panel');
  const tabKey = panel ? panel.id.replace('tab-panel-', '') : 'tools';
  switchBottomTab(tabKey);

  // In Modern Look, Meta and Performance are two separate group panels and only one
  // is shown at a time — jumping to a card in the OTHER group needs to flip that
  // switcher first, or the now-expanded card stays invisible behind the hidden panel.
  const groupPanel = card && card.closest('.seo-group-panel');
  if (groupPanel) {
    const seoPanelEl = document.getElementById('tab-panel-seo');
    if (seoPanelEl && seoPanelEl.classList.contains('modern-look')) {
      showSeoGroup(groupPanel.dataset.group);
    }
  }

  applyExpandedTab(sectionKey);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const BOTTOM_NAV_SHORTCUT_KEYS = { '1': 'overview', '2': 'seo', '3': 'tools', '4': 'info' };

function setupBottomNav() {
  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchBottomTab(btn.dataset.bottomTab));
  });

  const settingsHeaderBtn = document.getElementById('settings-header-btn');
  if (settingsHeaderBtn) {
    settingsHeaderBtn.addEventListener('click', () => switchBottomTab('settings'));
  }

  const settingsBackBtn = document.getElementById('settings-back-btn');
  if (settingsBackBtn) {
    settingsBackBtn.addEventListener('click', () => switchBottomTab(lastNonSettingsTab));
  }

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const tabKey = BOTTOM_NAV_SHORTCUT_KEYS[e.key];
    if (!tabKey) return;
    const active = document.activeElement;
    const isTyping = active && (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.tagName === 'SELECT' ||
      active.isContentEditable
    );
    if (isTyping) return;
    e.preventDefault();
    switchBottomTab(tabKey);
  });
}

// info tab — static reference content, independent of any scan. Category colors reuse
// the same --c-* accents the matching section-cards already use, so the glossary/guide
// visually ties back to the actual UI instead of introducing a new color language.
const INFO_QUICKSTART_STEPS = [
  'Click <strong>Refresh</strong> (top right) to scan the current tab.',
  'Check <strong>Overview</strong> for the big picture — health score, category rings, quick stats.',
  'Open <strong>Tools</strong> and expand any card for the full detail behind a number.',
  'Use the export buttons at the bottom of Tools to share a report with your team.'
];

const HOWTO_GUIDE = [
  {
    category: 'Getting Started', color: 'var(--accent)',
    items: [
      { title: 'Scanning a page', desc: 'Stylytics analyzes the active tab automatically when opened, and again any time you click Refresh. Results populate the Overview and Tools tabs.' },
      { title: 'Overview dashboard', desc: 'A snapshot of the current page: an SEO health score, category rings (Design Consistency, LLM Visibility, Accessibility, Performance, Dark Patterns), quick stats, and an Issue Breakdown bar.' },
      { title: 'Exclude header & footer', desc: 'Toggle at the bottom of Overview. When on, word count, headings, and links used for the SEO audit ignore header/nav/footer boilerplate so scores reflect the main content only.' }
    ]
  },
  {
    category: 'Design', color: 'var(--c-colors)',
    items: [
      { title: 'Typography', desc: 'Lists every font family and size in use, plus a Live Font Preview — type any font name (including ones not on the page) to preview it swapped in on the live page without touching the source.' },
      { title: 'Colors', desc: 'Text/background/hover color palettes, a Color Palette Generator, a WCAG contrast checker for text-on-background pairs, and a Pick Color eyedropper for sampling colors directly off the page.' },
      { title: 'Outline', desc: 'The page\'s heading hierarchy (H1–H6) with hierarchy-skip detection, plus a copyable table of contents. Click any heading in the list to highlight the matching element on the live page.' },
      { title: 'Design Tokens & Grid Overlay', desc: 'Detected spacing, radius, shadow, and z-index values actually used on the page. The Grid Overlay control here paints a fixed 8px or baseline grid over the live page to check spacing/alignment visually.' },
      { title: 'Vibe strip & Consistency badge', desc: 'A one-line aesthetic summary ("Warm, minimal, vibrant...") plus a badge scoring how consistent the fonts/colors/spacing are — shown at the top of the Tools tab.' }
    ]
  },
  {
    category: 'Content & SEO', color: 'var(--c-meta)',
    items: [
      { title: 'Meta Insights', desc: 'Title, description, canonical URL, a mocked search-result preview, a robots.txt/sitemap.xml check, and trust signals like author/HTTPS.' },
      { title: 'Backlinks', desc: 'Every link on the page, classified internal vs. external, with anchor-text quality flags (e.g. generic "click here" text) and an on-demand broken-link checker.' },
      { title: 'Structured Data', desc: 'Detected JSON-LD blocks and their schema types (Article, Product, FAQPage, ...), with parse-error checking.' },
      { title: 'SEO Score', desc: 'A 20-point pass/fail checklist. Failing items are clickable — tap one to jump straight to the section that shows the actual evidence.' },
      { title: 'LLM Visibility (GEO)', desc: 'Checks how easily AI answer engines (ChatGPT, Perplexity, Google AI Overviews) can parse and cite the page — a separate discipline from classic SEO.' },
      { title: 'Social Preview', desc: 'Mocked Facebook, X/Twitter, and LinkedIn share cards built from the page\'s Open Graph and Twitter Card tags, with warnings if the preview image is missing or undersized.' }
    ]
  },
  {
    category: 'Trust & Compliance', color: 'var(--c-accessibility)',
    items: [
      { title: 'Accessibility', desc: 'Missing alt text, unlabeled form fields, missing ARIA landmarks, and heading-hierarchy issues — the same data source as several SEO checks.' },
      { title: 'Dark Patterns', desc: 'Scans for manipulative UX: pre-checked opt-in boxes, confirm-shaming decline copy, fake urgency/scarcity claims, hidden cancel/unsubscribe links, and more. These are heuristics — a hit is worth a human look, not proof of intent.' },
      { title: 'Media Contact', desc: 'Detected author, organization, contact info, and social profile links, used as E-E-A-T (experience/expertise/authority/trust) signals.' }
    ]
  },
  {
    category: 'Performance', color: 'var(--c-performance)',
    items: [
      { title: 'Performance', desc: 'Page load time and a count of render-blocking scripts in <head>.' },
      { title: 'Core Web Vitals', desc: 'Google\'s LCP, CLS, and INP scores for the page, with a direct link to check the live score in PageSpeed Insights.' },
      { title: 'Tech Stack', desc: 'Frameworks, analytics, and CMS platforms detected from scripts and response headers.' }
    ]
  },
  {
    category: 'Utilities', color: 'var(--c-tokens)',
    items: [
      { title: 'Global search', desc: 'The search box at the top of Tools searches fonts, colors, links, and headings across everything already extracted from the page — no need to open each card individually.' },
      { title: 'Inspect Mode', desc: 'Click any element on the live page to see its exact computed styles, box-model spacing, and position in the DOM tree.' },
      { title: 'Dark Mode Preview', desc: 'Simulates a dark theme on the live page by inverting computed colors — a quick check, not a real dark-mode implementation.' },
      { title: 'Colorblind Simulation', desc: 'Previews the live page under protanopia, deuteranopia, tritanopia, or monochrome vision.' },
      { title: 'Screenshot & Annotate', desc: 'Capture the visible viewport or the full page, then crop, arrow, blur, or text-annotate it in the built-in editor before exporting as PNG, JPG, or PDF.' },
      { title: 'Responsive Simulator', desc: 'Preview the page at common device breakpoints without resizing your actual browser window.' },
      { title: 'Assets & Images', desc: 'Every detected image and logo, with broken-image detection and a one-click "download all as ZIP".' },
      { title: 'Export Style Guide', desc: 'Downloads a standalone HTML style guide of the page\'s fonts, colors, and spacing — handy to hand to a designer or client.' },
      { title: 'Export SEO & GEO Report', desc: 'Downloads the SEO Score and LLM Visibility checklists as a shareable HTML report.' },
      { title: 'Export Starter Kit', desc: 'Turns the detected Design Tokens into a ready-to-use Tailwind config, CSS variables, or SCSS file.' }
    ]
  },
  {
    category: 'Settings', color: 'var(--text-tertiary)',
    items: [
      { title: 'Theme', desc: 'Switches Stylytics\' own light/dark appearance — this is cosmetic for the panel itself and separate from "Dark Mode Preview," which affects the live page.' },
      { title: 'Sections (show, hide, reorder)', desc: 'Controls which cards appear in the Tools tab and in what order — new features you haven\'t hidden appear automatically.' },
      { title: 'Restore Last Session', desc: 'When on, reopening the panel returns you to the tab/section you were last viewing instead of always starting on Overview.' },
      { title: 'Grid Layout / List View', desc: 'Display-density options for the Tools section tiles and the Assets grid.' },
      { title: 'Default Expanded Section & Max Items Per Grid', desc: 'Pick which card opens automatically, and cap how many items (colors, images, links) each grid shows before truncating.' }
    ]
  }
];

const GLOSSARY_TERMS = [
  {
    category: 'SEO', color: 'var(--c-meta)',
    terms: [
      { term: 'Title Tag', what: 'The clickable headline shown for a page in search results.', why: 'The single biggest factor in whether someone clicks your result.', thresholds: [{ label: 'Good', range: '30–60 chars', color: 'var(--success)' }, { label: 'Too short/long', range: 'outside that', color: 'var(--danger)' }] },
      { term: 'Meta Description', what: 'The ~150-character summary shown under a search result.', why: 'Doesn\'t directly affect ranking, but a good one drives click-through rate; a missing one lets Google pick a random snippet instead.', thresholds: [{ label: 'Good', range: '120–160 chars', color: 'var(--success)' }, { label: 'Too short/long', range: 'outside that', color: 'var(--danger)' }] },
      { term: 'Canonical URL', what: 'The "official" version of a page that search engines should index when duplicate or near-duplicate URLs exist.', why: 'Prevents duplicate-content SEO penalties and makes sure the right page ranks — a wrong canonical can point search engines at the wrong page entirely.' },
      { term: 'Robots Meta Tag (noindex / nofollow)', what: 'An instruction telling search engines not to index a page, or not to follow its links.', why: 'An accidental noindex silently removes a page from search results with no error or warning.' },
      { term: 'Hreflang', what: 'Tags telling search engines which language/region version of a page to serve.', why: 'Without it, the wrong-language version of a page can rank in a given country\'s search results.' },
      { term: 'Structured Data (JSON-LD)', what: 'Machine-readable markup describing what a page is about (Article, Product, FAQPage, Recipe, ...).', why: 'Powers rich results in search — star ratings, FAQ dropdowns, product prices — that plain HTML can\'t get.' },
      { term: 'Open Graph / Twitter Card', what: 'Meta tags controlling how a link looks when shared on social media.', why: 'A missing og:image usually means the shared link shows no thumbnail at all.' },
      { term: 'H1 / Heading Hierarchy', what: 'The page\'s single main heading and its nested subheadings (H2, H3, ...).', why: 'Search engines and screen readers use it to understand page structure; skipping a level (H2 straight to H4) confuses both.' },
      { term: 'Word Count', what: 'Total visible body text length.', why: 'Thin content (under ~300 words) often struggles to rank for competitive search terms.', thresholds: [{ label: 'Thin', range: '< 300 words', color: 'var(--danger)' }, { label: 'Sufficient', range: '300+ words', color: 'var(--success)' }] },
      { term: 'Internal vs. External Links', what: 'Links to the same site vs. links to another site.', why: 'Internal links spread SEO authority across a site; too few can leave pages "orphaned" with no path for search engines to find them.' },
      { term: 'E-E-A-T', what: 'Google\'s framework for judging whether content and its author can be trusted — Experience, Expertise, Authoritativeness, Trust.', why: 'Pages with clear authorship, credentials, and contact info tend to be trusted more by both Google and readers, especially for medical, financial, or legal topics.' }
    ]
  },
  {
    category: 'Accessibility', color: 'var(--c-accessibility)',
    terms: [
      { term: 'WCAG', what: 'The Web Content Accessibility Guidelines — the international standard for accessible web content, with conformance levels A, AA, AAA.', why: 'Most legal accessibility requirements (ADA, EN 301 549, etc.) point directly to WCAG AA as the bar to meet.' },
      { term: 'Alt Text', what: 'A text description of an image, read aloud by screen readers.', why: 'Required for legal compliance in many jurisdictions (ADA/WCAG); without it, a blind user gets nothing where an image should be.' },
      { term: 'ARIA Landmark', what: 'A region role (banner, navigation, main, contentinfo) that assistive tech uses to jump around a page.', why: 'Missing landmarks make screen-reader navigation dramatically slower and more frustrating.' },
      { term: 'Contrast Ratio', what: 'The luminance difference between text and its background, expressed as a ratio like 4.5:1.', why: 'Low contrast is unreadable for users with low vision, and fails accessibility audits.', thresholds: [{ label: 'AAA', range: '≥ 7:1', color: 'var(--success)' }, { label: 'AA', range: '≥ 4.5:1', color: 'var(--success)' }, { label: 'Fail', range: '< 4.5:1', color: 'var(--danger)' }] },
      { term: 'Focusable Element', what: 'Anything a keyboard Tab key can reach — links, buttons, form fields.', why: 'Keyboard-only users (including many with motor disabilities) simply cannot use a control that isn\'t focusable.' },
      { term: 'Form Label', what: 'Text explicitly associated with an input field via <label>, aria-label, or aria-labelledby.', why: 'Without one, a screen reader announces "edit text" with no indication of what the field is for.' }
    ]
  },
  {
    category: 'Performance', color: 'var(--c-performance)',
    terms: [
      { term: 'Core Web Vitals', what: 'Google\'s three official page-experience metrics: LCP, CLS, and INP.', why: 'A confirmed Google ranking factor — the Core Web Vitals card links straight to PageSpeed Insights for the live score.' },
      { term: 'LCP (Largest Contentful Paint)', what: 'Time until the largest visible element on the page has rendered.', why: 'Slower LCP correlates with higher bounce rates and is a direct ranking signal.', thresholds: [{ label: 'Good', range: '< 2.5s', color: 'var(--success)' }, { label: 'Needs work', range: '2.5s–4s', color: '#d97706' }, { label: 'Poor', range: '> 4s', color: 'var(--danger)' }] },
      { term: 'CLS (Cumulative Layout Shift)', what: 'How much visible content unexpectedly shifts position while the page loads.', why: 'High CLS is a common source of user frustration — think a button moving right as you tap it.', thresholds: [{ label: 'Good', range: '< 0.1', color: 'var(--success)' }, { label: 'Needs work', range: '0.1–0.25', color: '#d97706' }, { label: 'Poor', range: '> 0.25', color: 'var(--danger)' }] },
      { term: 'INP (Interaction to Next Paint)', what: 'How quickly the page visually responds to a click or tap.', why: 'Replaced FID as a Core Web Vital in 2024; sluggish INP is what makes a page feel "janky" even after it has loaded.', thresholds: [{ label: 'Good', range: '< 200ms', color: 'var(--success)' }, { label: 'Needs work', range: '200–500ms', color: '#d97706' }, { label: 'Poor', range: '> 500ms', color: 'var(--danger)' }] },
      { term: 'Render-Blocking Scripts', what: 'Scripts placed in <head> that must fully load and execute before the browser can paint anything.', why: 'Each one adds pure delay before a user sees any content at all.' },
      { term: 'TTFB (Time to First Byte)', what: 'How long the server takes to send back the first byte of the response.', why: 'A slow TTFB delays everything downstream, no matter how optimized the frontend is.' }
    ]
  },
  {
    category: 'Design', color: 'var(--c-colors)',
    terms: [
      { term: 'Design Tokens', what: 'The raw spacing, color, radius, and shadow values a page actually uses, extracted from computed styles.', why: 'A wide spread of near-duplicate values (8px, 9px, 10px margins used almost interchangeably) signals an inconsistent, hard-to-maintain design system.' },
      { term: 'Design Consistency Score', what: 'A score based on how many distinct fonts, colors, and spacing values are in active use.', why: 'Fewer, more consistently repeated values usually means a more polished, deliberately systemized UI.' }
    ]
  },
  {
    category: 'Dark Patterns', color: 'var(--c-dark-patterns)',
    terms: [
      { term: 'Confirm-Shaming', what: 'Decline copy worded to guilt the user into not declining, e.g. "No thanks, I hate saving money."', why: 'Manipulates through emotion rather than informed choice, and is increasingly targeted by consumer-protection regulators.' },
      { term: 'Scarcity / Urgency Claims', what: 'Messaging like "Only 2 left!" or a countdown timer pushing a fast decision.', why: 'Legitimate when true, deceptive when fabricated purely to rush a purchase.' },
      { term: 'Roach Motel', what: 'A pattern that\'s easy to get into (sign up) but deliberately hard to get out of (cancel).', why: 'Our detector flags one concrete version of this: cancel/unsubscribe links that are hidden, tiny, or near-invisible against their background.' },
      { term: 'Forced Continuity', what: 'A "free trial" that quietly converts to a paid subscription with no clear billing terms shown nearby.', why: 'Users sign up expecting free access and get charged with no warning — a frequent target of FTC enforcement.' }
    ]
  },
  {
    category: 'LLM Visibility (GEO)', color: 'var(--c-llm-visibility)',
    terms: [
      { term: 'GEO (Generative Engine Optimization)', what: 'Optimizing content so AI answer engines (ChatGPT, Perplexity, Google AI Overviews) can parse, quote, and cite it correctly.', why: 'A growing share of search-like queries are answered directly by an AI engine and never reach a traditional results page at all.' }
    ]
  }
];

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildInfoThresholdsHtml(thresholds) {
  if (!thresholds || !thresholds.length) return '';
  return `<div class="info-threshold-row">${thresholds.map(t => `
    <span class="info-threshold-pill" style="--pill-color: ${t.color};">${escapeHtml(t.label)}: ${escapeHtml(t.range)}</span>
  `).join('')}</div>`;
}

function buildInfoCategoryHtml(groups, mode, cardsHtmlFor) {
  return groups.map(group => {
    const slug = slugify(group.category);
    const items = cardsHtmlFor(group);
    return `
      <div class="info-category" style="--cat-color: ${group.color};">
        <div class="info-category-header" id="info-cat-${mode}-${slug}">
          <span class="info-category-dot"></span>
          <span class="info-category-name">${escapeHtml(group.category)}</span>
          <span class="info-category-count">${items.count}</span>
        </div>
        ${items.html}
      </div>
    `;
  }).join('');
}

function buildInfoHowtoHtml() {
  return `
    <div class="info-quickstart">
      <div class="info-quickstart-title">New here? Start in 4 steps</div>
      ${INFO_QUICKSTART_STEPS.map((step, i) => `
        <div class="info-quickstart-step"><span class="info-quickstart-num">${i + 1}</span><span>${step}</span></div>
      `).join('')}
    </div>
    ${buildInfoCategoryHtml(HOWTO_GUIDE, 'howto', group => ({
    count: group.items.length,
    html: group.items.map(item => `
        <div class="info-card" data-info-search="${escapeHtml((item.title + ' ' + item.desc).toLowerCase())}">
          <div class="info-card-title">${escapeHtml(item.title)}</div>
          <div class="info-card-desc">${escapeHtml(item.desc)}</div>
        </div>
      `).join('')
  }))}
  `;
}

function buildInfoGlossaryHtml() {
  return buildInfoCategoryHtml(GLOSSARY_TERMS, 'glossary', group => ({
    count: group.terms.length,
    html: group.terms.map(t => `
      <div class="info-card" data-info-search="${escapeHtml((t.term + ' ' + t.what + ' ' + t.why).toLowerCase())}">
        <div class="info-card-title">${escapeHtml(t.term)}</div>
        <div class="info-card-desc"><strong>What it is:</strong> ${escapeHtml(t.what)}</div>
        <div class="info-card-desc"><strong>Why it matters:</strong> ${escapeHtml(t.why)}</div>
        ${buildInfoThresholdsHtml(t.thresholds)}
      </div>
    `).join('')
  }));
}

function buildInfoCategoryNavHtml(groups, mode) {
  return groups.map(group => `
    <button class="info-category-chip" data-jump-target="info-cat-${mode}-${slugify(group.category)}" style="--cat-color: ${group.color};">${escapeHtml(group.category)}</button>
  `).join('');
}

function setupInfoTab() {
  const howtoEl = document.getElementById('info-howto-content');
  const glossaryEl = document.getElementById('info-glossary-content');
  const modeToggle = document.getElementById('info-mode-toggle');
  const searchInput = document.getElementById('info-search-input');
  const emptyState = document.getElementById('info-empty-state');
  const navEl = document.getElementById('info-category-nav');
  if (!howtoEl || !glossaryEl || !modeToggle) return;

  howtoEl.innerHTML = buildInfoHowtoHtml();
  glossaryEl.innerHTML = buildInfoGlossaryHtml();

  const applyFilter = () => {
    const query = (searchInput.value || '').trim().toLowerCase();
    const activeMode = modeToggle.querySelector('.tag.active').dataset.mode;
    const activeContainer = activeMode === 'glossary' ? glossaryEl : howtoEl;
    let visibleCount = 0;

    [howtoEl, glossaryEl].forEach(container => {
      container.classList.toggle('hidden', container !== activeContainer);
    });

    if (navEl) {
      navEl.innerHTML = buildInfoCategoryNavHtml(activeMode === 'glossary' ? GLOSSARY_TERMS : HOWTO_GUIDE, activeMode);
      navEl.querySelectorAll('.info-category-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const target = document.getElementById(chip.dataset.jumpTarget);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    }

    const quickstart = activeContainer.querySelector('.info-quickstart');
    if (quickstart) quickstart.classList.toggle('hidden', !!query);

    activeContainer.querySelectorAll('.info-card').forEach(card => {
      const match = !query || card.dataset.infoSearch.includes(query);
      card.classList.toggle('hidden', !match);
      if (match) visibleCount++;
    });
    activeContainer.querySelectorAll('.info-category').forEach(cat => {
      const hasVisibleCard = Array.from(cat.querySelectorAll('.info-card')).some(c => !c.classList.contains('hidden'));
      cat.classList.toggle('hidden', !hasVisibleCard);
    });
    if (navEl) {
      navEl.querySelectorAll('.info-category-chip').forEach(chip => {
        const cat = document.getElementById(chip.dataset.jumpTarget);
        const catBlock = cat ? cat.closest('.info-category') : null;
        chip.classList.toggle('hidden', !!catBlock && catBlock.classList.contains('hidden'));
      });
    }

    if (emptyState) emptyState.classList.toggle('hidden', visibleCount !== 0 || !query);
  };

  modeToggle.querySelectorAll('.tag').forEach(btn => {
    btn.addEventListener('click', () => {
      modeToggle.querySelectorAll('.tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilter();
    });
  });

  if (searchInput) searchInput.addEventListener('input', applyFilter);

  applyFilter();
}

function wireCardBodyAutoHeight(card, body) {
  body.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'height' && card.classList.contains('expanded')) {
      body.style.height = 'auto';
    }
  });
}

function setupSections() {
  const cards = document.querySelectorAll('.section-board .section-card');

  cards.forEach(card => {
    const header = card.querySelector('.section-card-header');
    const body = card.querySelector('.section-card-body');
    if (!header || !body) return;

    // Tag the body with its owning card's tab key so getCardBodyEl() can find it again
    // even after grid mode reparents it onto #section-board to span the full row width.
    if (card.dataset.tab) body.dataset.ownerTab = card.dataset.tab;

    wireCardBodyAutoHeight(card, body);

    header.addEventListener('click', () => {
      if (card.classList.contains('expanded')) {
        // In Modern Look this card is the only one rendered at all (every other
        // card in the board is display:none) — closing it would leave a blank
        // panel with nothing to fall back to, so its own header can't collapse it.
        // Switching sections is the pill bar's job there.
        if (isSoleModernLookCard(card)) return;
        closeSectionTile(card);
      } else {
        openSectionTile(card);
      }
      saveUiState();
    });
  });
}

function setupKeyboardNav() {
  const board = document.getElementById('section-board');
  if (!board) return;

  board.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

    const headers = Array.from(board.querySelectorAll('.section-card-header'))
      .filter(h => h.offsetParent !== null);
    const currentIndex = headers.indexOf(document.activeElement);
    if (currentIndex === -1) return;

    e.preventDefault();
    const nextIndex = e.key === 'ArrowDown'
      ? Math.min(currentIndex + 1, headers.length - 1)
      : Math.max(currentIndex - 1, 0);
    headers[nextIndex].focus();
  });
}

// Shared by the global search box and the DOM-tree search input — both previously kept
// their own module-level timer variable for the exact same clearTimeout/setTimeout shape.
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildStyleGuideHtml(data) {
  const title = escapeHtml((data.meta && data.meta.title) || 'Style Guide');
  const generatedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const vibe = escapeHtml(computeSiteVibe(data));

  const uniqueColors = [];
  const seenStyleGuideColorHexes = new Set();
  [...(data.colors || []), ...(data.bgColors || [])].forEach(c => {
    if (!seenStyleGuideColorHexes.has(c.hex)) {
      seenStyleGuideColorHexes.add(c.hex);
      uniqueColors.push(c);
    }
  });

  const uniqueFonts = [...new Set((data.fonts || []).map(f => f.trim()))];
  const sizes = data.fontSizes || [];
  const tokens = data.designTokens || { margins: [], paddings: [], radii: [], shadows: [] };
  const spacingValues = [...new Set([...(tokens.margins || []), ...(tokens.paddings || [])].map(t => t.value))].slice(0, 12);
  const gradients = data.gradients || [];

  const fontLinks = (data.fontStyles || []).map(fs => {
    if (fs.type === 'link') return `<link rel="stylesheet" href="${escapeHtml(fs.href)}">`;
    // cssText is raw page-controlled CSS placed inside a <style> tag — HTML-escaping it
    // would break legitimate CSS, so just neutralize the one sequence that could close the tag early.
    if (fs.type === 'style') return `<style>${String(fs.cssText || '').replace(/<\/style/gi, '<\\/style')}</style>`;
    return '';
  }).join('\n');

  const colorSwatches = uniqueColors.map(c => `
    <div class="swatch">
      <div class="swatch-color" style="background:${escapeHtml(c.hex)};"></div>
      <div class="swatch-label">${escapeHtml(c.hex)}</div>
    </div>`).join('');

  const gradientSwatches = gradients.map(g => `
    <div class="swatch">
      <div class="swatch-color" style="background-image:${escapeHtml(g)};"></div>
      <div class="swatch-label">${escapeHtml(g.split('(')[0])}</div>
    </div>`).join('');

  const fontSamples = uniqueFonts.map(f => {
    const clean = f.split(',')[0].replace(/['"]/g, '').trim();
    return `
    <div class="font-sample">
      <div class="font-name">${escapeHtml(clean)}</div>
      <div class="font-preview" style="font-family: ${escapeHtml(f)};">The quick brown fox jumps over the lazy dog</div>
    </div>`;
  }).join('');

  const sizeScale = sizes.map(s => `
    <div class="size-row">
      <span class="size-label">${escapeHtml(s)}</span>
      <span class="size-preview" style="font-size:${escapeHtml(s)};">Aa</span>
    </div>`).join('');

  const spacingScale = spacingValues.map(s => `
    <div class="spacing-row">
      <span class="spacing-label">${escapeHtml(s)}</span>
      <span class="spacing-bar" style="width:${escapeHtml(s)};"></span>
    </div>`).join('');

  const radiusSamples = (tokens.radii || []).slice(0, 6).map(r => `
    <div class="radius-sample">
      <div class="radius-box" style="border-radius:${escapeHtml(r.value)};"></div>
      <div class="swatch-label">${escapeHtml(r.value)}</div>
    </div>`).join('');

  const shadowSamples = (tokens.shadows || []).slice(0, 4).map(s => `
    <div class="shadow-sample">
      <div class="shadow-box" style="box-shadow:${escapeHtml(s.value)};"></div>
      <div class="swatch-label">Shadow</div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Style Guide — ${title}</title>
${fontLinks}
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 56px 64px; background: #fcfcfd; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #18181b; }
  .report-header { border-bottom: 1px solid #e4e4e7; padding-bottom: 22px; margin-bottom: 36px; }
  .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #ea580c; font-weight: 700; margin-bottom: 8px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.3px; }
  .subtitle { color: #71717a; font-size: 13px; }
  .vibe-tag { display: inline-block; margin-top: 10px; background: #fff1e6; color: #c2410c; border-radius: 20px; padding: 5px 12px; font-size: 11.5px; font-weight: 600; }
  h2 { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.8px; color: #71717a; font-weight: 700; border-bottom: 1px solid #e4e4e7; padding-bottom: 10px; margin: 46px 0 20px; }
  .swatches { display: flex; flex-wrap: wrap; gap: 16px; }
  .swatch { width: 104px; }
  .swatch-color { width: 104px; height: 74px; border-radius: 10px; border: 1px solid rgba(0,0,0,0.08); background-size: cover; }
  .swatch-label { margin-top: 7px; font-size: 11px; font-family: 'SFMono-Regular', Consolas, monospace; color: #3f3f46; }
  .font-sample { margin-bottom: 26px; padding-bottom: 22px; border-bottom: 1px dashed #e4e4e7; }
  .font-sample:last-child { border-bottom: none; }
  .font-name { font-size: 12px; color: #71717a; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.4px; }
  .font-preview { font-size: 28px; color: #18181b; }
  .size-row, .spacing-row { display: flex; align-items: center; gap: 16px; margin-bottom: 11px; }
  .size-label, .spacing-label { width: 64px; flex-shrink: 0; color: #71717a; font-size: 12px; font-family: 'SFMono-Regular', Consolas, monospace; }
  .size-preview { font-size: 18px; }
  .spacing-bar { height: 12px; background: linear-gradient(90deg, #ea580c, #fb923c); border-radius: 3px; max-width: 320px; }
  .radius-sample, .shadow-sample { text-align: center; }
  .radius-box, .shadow-box { width: 72px; height: 72px; background: #fff; border: 1px solid #e4e4e7; }
  .empty { color: #a1a1aa; font-size: 13px; }
  .footer-note { margin-top: 56px; padding-top: 18px; border-top: 1px solid #e4e4e7; color: #a1a1aa; font-size: 11.5px; }
</style>
</head>
<body>
  <div class="report-header">
    <div class="eyebrow">Design Style Guide</div>
    <h1>${title}</h1>
    <div class="subtitle">Generated by Stylytics &middot; ${generatedOn}</div>
    <div class="vibe-tag">${vibe}</div>
  </div>

  <h2>Colors</h2>
  <div class="swatches">${colorSwatches || '<p class="empty">No colors detected</p>'}</div>

  ${gradients.length ? `
  <h2>Gradients</h2>
  <div class="swatches">${gradientSwatches}</div>` : ''}

  <h2>Typography</h2>
  ${fontSamples || '<p class="empty">No fonts detected</p>'}

  <h2>Type Scale</h2>
  ${sizeScale || '<p class="empty">No sizes detected</p>'}

  ${spacingValues.length ? `
  <h2>Spacing Scale</h2>
  ${spacingScale}` : ''}

  ${(tokens.radii || []).length ? `
  <h2>Border Radius</h2>
  <div class="swatches">${radiusSamples}</div>` : ''}

  ${(tokens.shadows || []).length ? `
  <h2>Shadows</h2>
  <div class="swatches">${shadowSamples}</div>` : ''}

  <div class="footer-note">Design style guide generated with Stylytics.</div>
</body>
</html>`;
}

function buildSeoAuditReportHtml(data) {
  const title = escapeHtml((data.meta && data.meta.title) || 'Untitled Page');
  const url = (data.meta && data.meta.canonical) || '';
  const escapedUrl = escapeHtml(url);
  const generatedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const seo = computeSeoChecklist(data);
  const llm = computeLlmVisibilityChecklist(data, lastSiteFilesResult);
  const trust = data.trustSignals || { trustBadgeCount: 0, testimonialSectionFound: false, reviewSchemaFound: false };
  const contact = data.mediaContact || {};
  const a11y = data.accessibility || {};
  const perf = data.performance || {};
  const vitals = data.webVitals || {};
  const seoData = data.seo || {};
  const linkStats = computeBacklinkStats(data.links || []);
  const structuredTypes = (data.structuredData && data.structuredData.types) || [];

  const scoreCard = (label, score, passCount, total) => {
    const color = score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#ef4444';
    return `
      <div class="score-card">
        <div class="score-ring" style="border-color: ${color}; color: ${color};">${score}</div>
        <div>
          <div class="score-card-label">${escapeHtml(label)}</div>
          <div class="score-card-sub">${passCount} of ${total} checks passed</div>
        </div>
      </div>`;
  };

  const checklistHtml = (checks) => checks.map(c => `
    <div class="check-row">
      <span class="check-icon" style="color: ${c.pass ? '#16a34a' : '#ef4444'};">${c.pass ? '✓' : '✕'}</span>
      <span>${escapeHtml(c.label)}${c.detail ? `<span class="check-detail">${escapeHtml(c.detail)}</span>` : ''}</span>
    </div>`).join('');

  let displayUrl = url;
  try { if (url) displayUrl = new URL(url).hostname + new URL(url).pathname.replace(/\/$/, ''); } catch (e) { /* keep raw url */ }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SEO Audit Report — ${title}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 56px; background: #fafafa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #18181b; }
  .report-header { border-bottom: 2px solid #ea580c; padding-bottom: 18px; margin-bottom: 30px; }
  .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #ea580c; font-weight: 700; margin-bottom: 8px; }
  .report-header h1 { font-size: 23px; margin: 0 0 6px; letter-spacing: -0.2px; }
  .report-meta { color: #71717a; font-size: 12.5px; }
  .report-meta a { color: #ea580c; text-decoration: none; }
  h2 { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.8px; color: #71717a; font-weight: 700; border-bottom: 1px solid #e4e4e7; padding-bottom: 9px; margin: 38px 0 18px; }
  .score-row { display: flex; gap: 28px; flex-wrap: wrap; }
  .score-card { display: flex; align-items: center; gap: 12px; }
  .score-ring { width: 50px; height: 50px; border-radius: 50%; border: 3px solid; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; flex-shrink: 0; }
  .score-card-label { font-size: 13px; font-weight: 700; }
  .score-card-sub { font-size: 11.5px; color: #71717a; }
  .check-row { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; margin-bottom: 9px; line-height: 1.4; }
  .check-icon { font-weight: 700; flex-shrink: 0; margin-top: 1px; }
  .check-detail { display: block; font-size: 11px; color: #a1a1aa; margin-top: 1px; }
  .serp-card { border: 1px solid #e4e4e7; border-radius: 10px; padding: 14px 16px; background: #fff; max-width: 520px; }
  .serp-url { font-size: 12px; color: #202124; margin-bottom: 3px; }
  .serp-title { font-size: 18px; color: #1a0dab; margin-bottom: 3px; }
  .serp-desc { font-size: 13px; color: #4d5156; line-height: 1.4; }
  .kv-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 24px; font-size: 12.5px; }
  .kv-grid div span { color: #71717a; }
  .pill { display: inline-block; background: #fff1e6; color: #c2410c; border-radius: 20px; padding: 4px 10px; font-size: 11.5px; margin: 0 6px 6px 0; }
  .empty { color: #a1a1aa; font-size: 13px; }
  .footer-note { margin-top: 50px; padding-top: 16px; border-top: 1px solid #e4e4e7; color: #a1a1aa; font-size: 11.5px; }
</style>
</head>
<body>
  <div class="report-header">
    <div class="eyebrow">SEO &amp; AI Visibility Audit</div>
    <h1>${title}</h1>
    <div class="report-meta">
      ${url ? `<a href="${escapedUrl}">${escapedUrl}</a> &middot; ` : ''}Generated ${escapeHtml(generatedOn)}
    </div>
  </div>

  <h2>Scores</h2>
  <div class="score-row">
    ${scoreCard('SEO Score', seo.score, seo.passCount, seo.checks.length)}
    ${scoreCard('AI Answer Engine (GEO)', llm.score, llm.passCount, llm.checks.length)}
  </div>

  <h2>Search Engine Preview</h2>
  <div class="serp-card">
    <div class="serp-url">${escapeHtml(displayUrl || 'example.com')}</div>
    <div class="serp-title">${escapeHtml((data.meta && data.meta.title) || 'Untitled page')}</div>
    <div class="serp-desc">${escapeHtml((data.meta && data.meta.description) || 'No description available for this page.')}</div>
  </div>

  <h2>SEO Checklist</h2>
  ${checklistHtml(seo.checks)}

  <h2>AI Answer Engine (GEO) Checklist</h2>
  ${checklistHtml(llm.checks)}

  <h2>Meta Fundamentals</h2>
  <div class="kv-grid">
    <div><span>Title length:</span> ${((data.meta && data.meta.title) || '').length} characters</div>
    <div><span>Description length:</span> ${((data.meta && data.meta.description) || '').length} characters</div>
    <div><span>Canonical URL:</span> ${(data.meta && data.meta.canonical) ? 'Present' : 'Missing'}</div>
    <div><span>Robots directive:</span> ${(seoData.robots && seoData.robots.raw) || 'Not set'}</div>
    <div><span>Mobile viewport:</span> ${seoData.hasViewport ? 'Present' : 'Missing'}</div>
    <div><span>H1 count:</span> ${seoData.h1Count != null ? seoData.h1Count : '—'}</div>
  </div>

  <h2>Structured Data</h2>
  <div>${structuredTypes.length ? structuredTypes.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join('') : '<p class="empty">No JSON-LD structured data found</p>'}</div>

  <h2>Backlinks Overview</h2>
  <div class="kv-grid">
    <div><span>Total links:</span> ${linkStats.total}</div>
    <div><span>Internal / External:</span> ${linkStats.internal} / ${linkStats.external}</div>
    <div><span>Generic anchor text:</span> ${linkStats.generic}</div>
    <div><span>UTM tagged:</span> ${linkStats.utm}</div>
  </div>

  <h2>Accessibility Snapshot</h2>
  <div class="kv-grid">
    <div><span>Images missing alt text:</span> ${a11y.imagesMissingAltCount || 0}</div>
    <div><span>Form fields missing labels:</span> ${a11y.formFieldsMissingLabelCount || 0}</div>
    <div><span>HTML lang attribute:</span> ${a11y.langMissing ? 'Missing' : 'Present'}</div>
    <div><span>Broken images:</span> ${data.brokenImagesCount || 0}</div>
  </div>

  <h2>Performance &amp; Core Web Vitals</h2>
  <div class="kv-grid">
    <div><span>Full Page Load:</span> ${perf.loadMs != null ? perf.loadMs + ' ms' : '—'}</div>
    <div><span>Render-Blocking Scripts:</span> ${perf.renderBlockingScripts != null ? perf.renderBlockingScripts : '—'}</div>
    <div><span>LCP:</span> ${vitals.lcp != null ? formatCwvValue('lcp', vitals.lcp) : '—'}</div>
    <div><span>CLS:</span> ${vitals.cls != null ? formatCwvValue('cls', vitals.cls) : '—'}</div>
    <div><span>FCP:</span> ${vitals.fcp != null ? formatCwvValue('fcp', vitals.fcp) : '—'}</div>
    <div><span>TTFB:</span> ${vitals.ttfb != null ? formatCwvValue('ttfb', vitals.ttfb) : '—'}</div>
  </div>

  <h2>Trust &amp; Credibility (E-E-A-T)</h2>
  <div class="kv-grid">
    <div><span>Trust badge indicators:</span> ${trust.trustBadgeCount || 0}</div>
    <div><span>Testimonials / reviews section:</span> ${trust.testimonialSectionFound ? 'Found' : 'Not found'}</div>
    <div><span>Review schema:</span> ${trust.reviewSchemaFound ? 'Found' : 'Not found'}</div>
    ${contact.name ? `<div><span>Author / Contact:</span> ${escapeHtml(contact.name)}</div>` : ''}
    ${contact.organization ? `<div><span>Organization:</span> ${escapeHtml(contact.organization)}</div>` : ''}
  </div>

  <div class="footer-note">SEO audit report generated with Stylytics.</div>
</body>
</html>`;
}

const GENERIC_ANCHOR_PHRASES = new Set(['click here', 'read more', 'here', 'this link', 'learn more', 'more', 'click', 'this', 'link', 'this page']);

function computeBacklinkStats(links) {
  let internal = 0, external = 0, generic = 0, utm = 0;
  links.forEach(l => {
    if (l.isInternal) internal++; else external++;

    const text = (l.text || '').trim().toLowerCase();
    if (text && GENERIC_ANCHOR_PHRASES.has(text)) generic++;

    try {
      const parsed = new URL(l.url);
      if (Array.from(parsed.searchParams.keys()).some(k => k.toLowerCase().startsWith('utm_'))) utm++;
    } catch (e) { }
  });
  return { total: links.length, internal, external, generic, utm };
}

const BROKEN_LINK_CONCURRENCY = 4;
const BROKEN_LINK_TIMEOUT_MS = 7000;

async function checkLinksBatch(links, onProgress) {
  const results = new Map();
  let index = 0;

  async function worker() {
    while (index < links.length) {
      const link = links[index++];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), BROKEN_LINK_TIMEOUT_MS);
      try {
        const res = await fetch(link.url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
        results.set(link.url, { ok: res.ok, status: res.status });
      } catch (e) {
        results.set(link.url, { ok: false, status: 'No response' });
      } finally {
        clearTimeout(timer);
      }
      if (onProgress) onProgress(results.size, links.length);
    }
  }

  const workerCount = Math.min(BROKEN_LINK_CONCURRENCY, links.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function runBrokenLinkCheck(allLinks) {
  const btn = document.getElementById('check-broken-links-btn');
  const clearBtn = document.getElementById('clear-broken-links-btn');
  const resultsEl = document.getElementById('broken-link-results');
  if (!resultsEl) return;

  // A check can take several seconds; guard against its results landing after
  // the user has navigated/refreshed to a different page in the meantime.
  const myGeneration = extractGeneration;
  const isStale = () => myGeneration !== extractGeneration;

  const uniqueByUrl = [];
  const seenUrls = new Set();
  allLinks.forEach(l => {
    if (!seenUrls.has(l.url)) {
      seenUrls.add(l.url);
      uniqueByUrl.push(l);
    }
  });
  if (!uniqueByUrl.length) {
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = '<div class="empty-state">No links to check.</div>';
    return;
  }

  const originalLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.textContent = `Checking 0/${uniqueByUrl.length}...`;
  }
  if (clearBtn) clearBtn.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML = '<div class="empty-state">Checking links…</div>';

  try {
    const results = await checkLinksBatch(uniqueByUrl, (done, total) => {
      if (isStale()) return;
      if (btn) btn.textContent = `Checking ${done}/${total}...`;
    });

    if (isStale()) return;

    const broken = uniqueByUrl.filter(l => {
      const r = results.get(l.url);
      return r && !r.ok;
    });

    resultsEl.innerHTML = '';
    const summary = document.createElement('div');
    summary.className = 'outline-item';
    summary.innerHTML = `<strong>${uniqueByUrl.length - broken.length} / ${uniqueByUrl.length}</strong> checked links responded OK.`;
    resultsEl.appendChild(summary);

    broken.forEach(l => {
      const r = results.get(l.url);
      const row = document.createElement('div');
      row.className = 'outline-item';
      row.innerHTML = `<span style="color: var(--danger); font-weight: 700;">${r.status}</span> — <span style="word-break: break-all;"></span>`;
      row.querySelector('span:last-child').textContent = l.url;
      resultsEl.appendChild(row);
    });
  } catch (e) {
    if (!isStale()) resultsEl.innerHTML = '<div class="empty-state">Could not complete the check.</div>';
    console.error(e);
  } finally {
    if (!isStale()) {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.innerHTML = originalLabel;
      }
      if (clearBtn) clearBtn.classList.remove('hidden');
    }
  }
}

// ---------- Minimal hand-rolled ZIP writer (STORE method, no compression) ----------
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach(file => {
    const nameBytes = new TextEncoder().encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const size = data.length;

    const localHeader = new ArrayBuffer(30);
    const lv = new DataView(localHeader);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);

    localParts.push(new Uint8Array(localHeader), nameBytes, data);

    const centralHeader = new ArrayBuffer(46);
    const cv = new DataView(centralHeader);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);

    centralParts.push(new Uint8Array(centralHeader), nameBytes);

    offset += localHeader.byteLength + nameBytes.length + size;
  });

  const centralDirOffset = offset;
  const centralDirSize = centralParts.reduce((sum, p) => sum + p.length, 0);

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirOffset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, new Uint8Array(eocd)], { type: 'application/zip' });
}

function filenameForZipEntry(url, index, usedNames) {
  let name;
  try {
    const u = new URL(url);
    name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  } catch (e) {
    name = '';
  }
  if (!name) name = `image-${index}`;
  name = name.replace(/[^a-zA-Z0-9._-]/g, '_');

  let finalName = name;
  let suffix = 1;
  while (usedNames.has(finalName)) {
    const dot = name.lastIndexOf('.');
    finalName = dot > 0 ? `${name.slice(0, dot)}-${suffix}${name.slice(dot)}` : `${name}-${suffix}`;
    suffix++;
  }
  usedNames.add(finalName);
  return finalName;
}

function isLogoUrl(imgUrl, canonicalUrl) {
  try {
    const urlObj = new URL(imgUrl, canonicalUrl || 'https://example.com');
    return urlObj.pathname.toLowerCase().endsWith('.svg') || urlObj.href.toLowerCase().includes('.svg?');
  } catch (e) {
    return false;
  }
}

function resolveAssetUrl(imgUrl, canonicalUrl) {
  let finalUrl = imgUrl;
  if (finalUrl.startsWith('//')) {
    finalUrl = 'https:' + finalUrl;
  } else if (finalUrl.startsWith('/')) {
    finalUrl = new URL(finalUrl, canonicalUrl || 'https://example.com').href;
  }
  return finalUrl;
}

const ASSET_ICON_DOWNLOAD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
const ASSET_ICON_COPY_IMAGE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
const ASSET_ICON_COPY_URL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const ASSET_ICON_OPEN_URL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';

function makeAssetActionBtn(className, title, svg, onClick) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.title = title;
  btn.innerHTML = svg;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// asset tiles
function createAssetItem(imgUrl, grid, canonicalUrl) {
  const isListMode = currentSettings && currentSettings.assetLayout === 'list';
  return isListMode
    ? createAssetListRow(imgUrl, grid, canonicalUrl)
    : createAssetGridTile(imgUrl, grid, canonicalUrl);
}

function createAssetGridTile(imgUrl, grid, canonicalUrl) {
  const assetItem = document.createElement('div');
  assetItem.className = 'asset-item';
  const img = document.createElement('img');
  img.src = imgUrl;
  img.loading = 'lazy';
  assetItem.appendChild(img);

  const downloadBtn = makeAssetActionBtn('asset-item-icon-btn asset-item-download-btn', 'Download image', ASSET_ICON_DOWNLOAD_SVG, () => {
    const finalUrl = resolveAssetUrl(imgUrl, canonicalUrl);
    chrome.downloads.download({ url: finalUrl }, (downloadId) => {
      if (chrome.runtime.lastError) window.open(finalUrl, '_blank');
    });
  });
  assetItem.appendChild(downloadBtn);

  const bottomActions = document.createElement('div');
  bottomActions.className = 'asset-item-bottom-actions';
  bottomActions.appendChild(makeAssetActionBtn('asset-item-icon-btn', 'Copy image', ASSET_ICON_COPY_IMAGE_SVG, () => {
    copyImageToClipboard(resolveAssetUrl(imgUrl, canonicalUrl));
  }));
  bottomActions.appendChild(makeAssetActionBtn('asset-item-icon-btn', 'Copy image URL', ASSET_ICON_COPY_URL_SVG, () => {
    copyToClipboard(resolveAssetUrl(imgUrl, canonicalUrl), 'Image URL copied!');
  }));
  bottomActions.appendChild(makeAssetActionBtn('asset-item-icon-btn', 'Open image URL', ASSET_ICON_OPEN_URL_SVG, () => {
    window.open(resolveAssetUrl(imgUrl, canonicalUrl), '_blank');
  }));
  assetItem.appendChild(bottomActions);

  grid.appendChild(assetItem);
  return assetItem;
}

function createAssetListRow(imgUrl, grid, canonicalUrl) {
  const row = document.createElement('div');
  row.className = 'asset-list-row';

  const thumb = document.createElement('div');
  thumb.className = 'asset-list-thumb';
  const img = document.createElement('img');
  img.src = imgUrl;
  img.loading = 'lazy';
  thumb.appendChild(img);
  row.appendChild(thumb);

  const nameEl = document.createElement('div');
  nameEl.className = 'asset-list-name';
  let displayName = imgUrl;
  try {
    displayName = decodeURIComponent(imgUrl.split('/').pop().split('?')[0]) || imgUrl;
  } catch (e) { /* keep raw URL if decoding fails */ }
  nameEl.textContent = displayName;
  nameEl.title = imgUrl;
  row.appendChild(nameEl);

  const actions = document.createElement('div');
  actions.className = 'asset-list-actions';
  actions.appendChild(makeAssetActionBtn('asset-item-icon-btn', 'Download image', ASSET_ICON_DOWNLOAD_SVG, () => {
    const finalUrl = resolveAssetUrl(imgUrl, canonicalUrl);
    chrome.downloads.download({ url: finalUrl }, (downloadId) => {
      if (chrome.runtime.lastError) window.open(finalUrl, '_blank');
    });
  }));
  actions.appendChild(makeAssetActionBtn('asset-item-icon-btn', 'Copy image', ASSET_ICON_COPY_IMAGE_SVG, () => {
    copyImageToClipboard(resolveAssetUrl(imgUrl, canonicalUrl));
  }));
  actions.appendChild(makeAssetActionBtn('asset-item-icon-btn', 'Copy image URL', ASSET_ICON_COPY_URL_SVG, () => {
    copyToClipboard(resolveAssetUrl(imgUrl, canonicalUrl), 'Image URL copied!');
  }));
  actions.appendChild(makeAssetActionBtn('asset-item-icon-btn', 'Open image URL', ASSET_ICON_OPEN_URL_SVG, () => {
    window.open(resolveAssetUrl(imgUrl, canonicalUrl), '_blank');
  }));
  row.appendChild(actions);

  grid.appendChild(row);
  return row;
}

const ASSET_ZIP_CONCURRENCY = 6;
const ASSET_ZIP_WARN_THRESHOLD = 150;

async function fetchImagesForZip(urls, onProgress) {
  const results = [];
  let index = 0;
  let completed = 0;

  async function worker() {
    while (index < urls.length) {
      const url = urls[index++];
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          results.push({ url, data: new Uint8Array(buf) });
        }
      } catch (e) { /* skip failed images */ }
      completed++;
      if (onProgress) onProgress(completed, urls.length);
    }
  }

  const workerCount = Math.min(ASSET_ZIP_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function downloadAllAssetsAsZip(logoUrls, imageUrls) {
  const btn = document.getElementById('download-all-zip-btn');
  const urls = [...(logoUrls || []), ...(imageUrls || [])];
  if (!urls.length) {
    showToast('No assets to download');
    return;
  }
  if (urls.length > ASSET_ZIP_WARN_THRESHOLD) {
    showToast(`Fetching ${urls.length} images — this may take a while and use significant memory`);
  }

  const originalLabel = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.textContent = `Fetching 0/${urls.length}...`;
  }

  try {
    const fetched = await fetchImagesForZip(urls, (done, total) => {
      if (btn) btn.textContent = `Fetching ${done}/${total}...`;
    });

    if (!fetched.length) {
      showToast('Could not fetch any assets');
      return;
    }

    const logoUrlSet = new Set(logoUrls || []);
    const usedLogoNames = new Set();
    const usedImageNames = new Set();
    const files = fetched.map((f, i) => {
      const isLogo = logoUrlSet.has(f.url);
      const name = filenameForZipEntry(f.url, i, isLogo ? usedLogoNames : usedImageNames);
      return { name: `${isLogo ? 'logos' : 'images'}/${name}`, data: f.data };
    });

    const blob = createZip(files);
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'assets.zip' }, (downloadId) => {
      if (chrome.runtime.lastError) {
        window.open(url, '_blank');
      } else {
        showToast(`Downloaded ${files.length} of ${urls.length} assets as zip`);
      }
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.innerHTML = originalLabel;
    }
  }
}

function setSectionCount(sectionKey, count) {
  const card = document.querySelector(`.section-card[data-tab="${sectionKey}"]`);
  if (!card) return;
  const badge = card.querySelector('.tile-count');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function setScanning(isScanning) {
  const refreshBtn = document.getElementById('refresh-btn');
  if (!refreshBtn) return;
  refreshBtn.disabled = isScanning;
  refreshBtn.classList.toggle('spinning', isScanning);
}

function setupTheme() {
  const lightBtn = document.getElementById('theme-light-btn');
  const darkBtn = document.getElementById('theme-dark-btn');
  if (!lightBtn || !darkBtn) return;

  const applyActive = (theme) => {
    lightBtn.classList.toggle('active', theme !== 'dark');
    darkBtn.classList.toggle('active', theme === 'dark');
  };

  const setTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    chrome.storage.local.set({ themeOverride: theme });
    applyActive(theme);
  };

  chrome.storage.local.get(['themeOverride'], (res) => {
    const theme = res.themeOverride || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    if (!res.themeOverride) {
      chrome.storage.local.set({ themeOverride: theme });
    }
    applyActive(theme);
  });

  lightBtn.addEventListener('click', () => setTheme('light'));
  darkBtn.addEventListener('click', () => setTheme('dark'));
}

function showError(message, title = 'Oops..!') {
  document.body.classList.add('error-state');
  contentUnavailable = true;
  const loadingEl = document.getElementById('loading');
  loadingEl.innerHTML = `
    <div class="error-scene">
      <div class="error-illustration">
        <svg class="error-svg" width="160" height="140" viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="error-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#f97316" />
              <stop offset="100%" stop-color="#ec4899" />
            </linearGradient>
            <radialGradient id="error-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#ec4899" stop-opacity="0.55" />
              <stop offset="100%" stop-color="#ec4899" stop-opacity="0" />
            </radialGradient>
          </defs>

          <g transform="translate(108 88)">
            <circle class="error-glow-pulse" r="42" fill="url(#error-glow)"></circle>
          </g>

          <g transform="rotate(-6 60 68)">
            <g class="error-page-float">
              <rect class="error-page-surface" x="18" y="20" width="84" height="98" rx="12" stroke-width="1.5"></rect>
              <rect class="error-line-strong" x="32" y="38" width="42" height="5" rx="2.5"></rect>
              <rect class="error-line" x="32" y="50" width="52" height="5" rx="2.5"></rect>
              <rect x="32" y="62" width="30" height="5" rx="2.5" fill="url(#error-grad)" opacity="0.85"></rect>
              <rect class="error-line" x="32" y="74" width="46" height="5" rx="2.5"></rect>
              <rect class="error-line" x="32" y="86" width="36" height="5" rx="2.5"></rect>
            </g>
          </g>

          <g transform="translate(4 -2) rotate(-38 34 30)">
            <g class="error-tool-recoil">
              <rect x="28" y="8" width="12" height="30" rx="4" fill="#3f3f46" stroke="rgba(255,255,255,0.15)" stroke-width="1"></rect>
              <rect x="31" y="14" width="3" height="18" rx="1.5" fill="rgba(255,255,255,0.14)"></rect>
              <path d="M28 38 L34 50 L40 38 Z" fill="#52525b"></path>
              <circle cx="34" cy="8" r="7" fill="url(#error-grad)"></circle>
            </g>
          </g>

          <g class="error-spark">
            <path d="M74 58 L79 53 M77 63 L85 63 M75 69 L80 74" stroke="url(#error-grad)" stroke-width="2.2" stroke-linecap="round"></path>
          </g>

          <g transform="translate(108 88)">
            <g class="error-shield">
              <circle class="error-shield-backing" r="32"></circle>
              <path d="M0 -24 L20 -16 V6 C20 18 10 25 0 28 C-10 25 -20 18 -20 6 V-16 Z" fill="url(#error-grad)" stroke="rgba(255,255,255,0.2)" stroke-width="1.2"></path>
              <path d="M-7 -3 V-8 a7 7 0 0 1 14 0 V-3" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"></path>
              <rect x="-9" y="-3" width="18" height="15" rx="3.5" fill="#fff"></rect>
              <circle cx="0" cy="4" r="2" fill="url(#error-grad)"></circle>
            </g>
          </g>
        </svg>
      </div>
      <div class="error-copy">
        <h3 class="error-title">${title}</h3>
        <p class="error-text">${message}</p>
      </div>
    </div>
  `;
  updateContentVisibility();
}

function showToast(message) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = document.createElement('span');
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const label = document.createElement('span');
  label.textContent = message;
  toast.appendChild(icon.firstChild);
  toast.appendChild(label);
  stack.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 200);
  }, 1600);
}

function copyToClipboard(text, message) {
  navigator.clipboard.writeText(text).then(
    () => showToast(message),
    () => showToast('Could not copy — check clipboard permission')
  );
}

function convertBlobToPngBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1;
      canvas.height = img.naturalHeight || 1;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error('canvas.toBlob failed'));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('image decode failed'));
    };
    img.src = objectUrl;
  });
}

async function copyImageToClipboard(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const pngBlob = blob.type === 'image/png' ? blob : await convertBlobToPngBlob(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    showToast('Image copied!');
  } catch (e) {
    showToast('Could not copy image — try downloading instead');
  }
}

function sendHighlightMessage(tabId, type, value) {
  chrome.tabs.sendMessage(tabId, { action: 'highlight', type, value }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Could not send highlight message", chrome.runtime.lastError);
    }
  });
}

// search index
function buildSearchIndex(data) {
  const index = [];
  const push = (section, sectionLabel, value, highlightType, highlightValue) => {
    if (value === null || value === undefined || value === '') return;
    index.push({
      section, sectionLabel, value: String(value),
      highlightType: highlightType || null,
      highlightValue: highlightValue != null ? highlightValue : null
    });
  };

  (data.fonts || []).forEach(f => {
    const clean = f.split(',')[0].replace(/['"]/g, '').trim();
    push('typography', 'Typography', clean, 'fontFamily', clean);
  });
  (data.fontSizes || []).forEach(sz => push('typography', 'Typography', sz, 'fontSize', sz));

  (data.colors || []).forEach(c => push('colors', 'Colors', c.hex, 'color', c.raw));
  (data.bgColors || []).forEach(c => push('colors', 'Colors', c.hex, 'color', c.raw));
  [...(data.hoverColors || []), ...(data.hoverBgColors || [])].forEach(c => push('colors', 'Colors', c.hex, 'hoverColor', c.raw));

  (data.outline || []).forEach(h => push('outline', 'Outline', h.text, null, null));
  (data.links || []).forEach(l => push('backlinks', 'Backlinks', l.text || l.url, null, null));

  if (data.meta) {
    push('meta', 'Meta Insights', data.meta.title, null, null);
    push('meta', 'Meta Insights', data.meta.description, null, null);
  }

  ((data.structuredData && data.structuredData.types) || []).forEach(t => push('structured-data', 'Structured Data', t, null, null));
  (data.techStack || []).forEach(t => push('tech-stack', 'Tech Stack', t.name, null, null));

  const tokens = data.designTokens || {};
  ['margins', 'paddings', 'gaps', 'radii', 'shadows', 'zIndexes'].forEach(key => {
    (tokens[key] || []).forEach(entry => push('tokens', 'Design Tokens', entry.value, null, null));
  });

  const contact = data.mediaContact || {};
  push('media-contact', 'Media Contact', contact.name, null, null);
  push('media-contact', 'Media Contact', contact.organization, null, null);
  (contact.socialLinks || []).forEach(s => push('media-contact', 'Media Contact', s.platform, null, null));

  return index;
}

const GLOBAL_SEARCH_MAX_RESULTS = 30;

function renderSearchResults(query) {
  const resultsEl = document.getElementById('global-search-results');
  if (!resultsEl) return;
  const q = query.trim().toLowerCase();
  if (!q) {
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
    return;
  }

  const matches = searchIndex.filter(item =>
    item.value.toLowerCase().includes(q) || item.sectionLabel.toLowerCase().includes(q)
  );
  resultsEl.innerHTML = '';
  if (!matches.length) {
    resultsEl.innerHTML = '<div class="global-search-empty">No matches found</div>';
    resultsEl.classList.remove('hidden');
    return;
  }

  matches.slice(0, GLOBAL_SEARCH_MAX_RESULTS).forEach(item => {
    const row = document.createElement('div');
    row.className = 'global-search-result-row';
    row.innerHTML = '<span class="global-search-result-section"></span><span class="global-search-result-value"></span>';
    row.querySelector('.global-search-result-section').textContent = item.sectionLabel;
    row.querySelector('.global-search-result-value').textContent = item.value;
    row.addEventListener('click', () => {
      jumpToToolsSection(item.section);
      if (item.highlightType && lastActiveTabId) {
        sendHighlightMessage(lastActiveTabId, item.highlightType, item.highlightValue);
      }
      resultsEl.classList.add('hidden');
    });
    resultsEl.appendChild(row);
  });

  if (matches.length > GLOBAL_SEARCH_MAX_RESULTS) {
    const more = document.createElement('div');
    more.className = 'global-search-more';
    more.textContent = `+${matches.length - GLOBAL_SEARCH_MAX_RESULTS} more matches — refine your search`;
    resultsEl.appendChild(more);
  }

  resultsEl.classList.remove('hidden');
}

function setupGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const resultsEl = document.getElementById('global-search-results');
  if (!input || !resultsEl) return;

  const debouncedRenderSearchResults = debounce(renderSearchResults, 150);
  input.addEventListener('input', (e) => debouncedRenderSearchResults(e.target.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      input.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search-wrap')) {
      resultsEl.classList.add('hidden');
    }
  });
}

function renderData(data, tabId) {
  const clearContainer = (id) => { const el = document.getElementById(id); if (el) el.innerHTML = ''; };
  searchIndex = buildSearchIndex(data);
  lastContrastResult = null;
  ['font-families', 'font-sizes', 'color-palette', 'bg-palette', 'hover-palette', 'assets-grid-logos', 'assets-grid-images', 'article-outline', 'meta-info', 'social-preview-container', 'link-list', 'picked-palette', 'broken-images-list', 'media-contact-info', 'media-contact-social-list'].forEach(clearContainer);

  // renderData can run repeatedly against the same cached data (Settings Save/Reset
  // re-render, refresh, etc.) — clear previously injected font tags first so they
  // don't pile up in <head> and refetch the same stylesheet on every call.
  document.querySelectorAll('[data-stylytics-font-preview]').forEach(el => el.remove());
  if (data.fontStyles && data.fontStyles.length) {
    data.fontStyles.forEach(styleInfo => {
      if (styleInfo.type === 'link') {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleInfo.href;
        link.dataset.stylyticsFontPreview = 'true';
        document.head.appendChild(link);
      } else if (styleInfo.type === 'style') {
        const style = document.createElement('style');
        style.textContent = styleInfo.cssText;
        style.dataset.stylyticsFontPreview = 'true';
        document.head.appendChild(style);
      }
    });
  }

  const fontPreviewInput = document.getElementById('font-preview-input');
  if (fontPreviewInput) {
    fontPreviewInput.value = '';
    fontPreviewInput.oninput = (e) => {
      const text = e.target.value || '';
      document.querySelectorAll('#font-families li').forEach(li => {
        li.textContent = text || li.getAttribute('data-font');
      });
    };
  }

  const uniqueFonts = data.fonts.length
    ? [...new Set(data.fonts.map(f => f.trim()).filter(Boolean))].filter((value, index, self) => {
      return self.findIndex(f => f.toLowerCase() === value.toLowerCase()) === index;
    })
    : [];

  const fontsList = document.getElementById('font-families');
  if (uniqueFonts.length) {
    uniqueFonts.forEach(fullFont => {
      const cleanName = fullFont.split(',')[0].replace(/['"]/g, '').trim();
      const li = document.createElement('li');
      li.style.fontFamily = fullFont;
      li.textContent = cleanName;
      li.setAttribute('data-font', cleanName);
      li.title = `Click to highlight elements using this font\n${fullFont}`;
      li.addEventListener('click', () => sendHighlightMessage(tabId, 'fontFamily', cleanName));
      fontsList.appendChild(li);
    });
  } else {
    fontsList.innerHTML = '<li class="empty-state">No fonts detected</li>';
  }

  const copyFontsBtn = document.getElementById('copy-fonts-btn');
  if (copyFontsBtn) {
    copyFontsBtn.onclick = () => {
      if (!uniqueFonts.length) return;
      const names = uniqueFonts.map(f => f.split(',')[0].replace(/['"]/g, '').trim());
      copyToClipboard(names.join(', '), `Copied ${names.length} font families`);
    };
  }

  const sizesContainer = document.getElementById('font-sizes');
  if (data.fontSizes.length) {
    data.fontSizes.forEach(size => {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = size;
      tag.title = "Click to highlight elements using this size";
      tag.addEventListener('click', () => sendHighlightMessage(tabId, 'fontSize', size));
      sizesContainer.appendChild(tag);
    });
  } else {
    sizesContainer.innerHTML = '<div class="empty-state">No sizes detected</div>';
  }

  renderAllColorGrids(data, tabId);
  renderColorPaletteGenerator(data, tabId);

  const allSwatchColors = [...data.colors, ...data.bgColors];
  const uniqueSwatchColors = [];
  const seenSwatchColorHexes = new Set();
  allSwatchColors.forEach(c => {
    if (!seenSwatchColorHexes.has(c.hex)) {
      seenSwatchColorHexes.add(c.hex);
      uniqueSwatchColors.push(c);
    }
  });
  setSectionCount('colors', uniqueSwatchColors.length);

  const copyColorsBtn = document.getElementById('copy-colors-btn');
  const formatSelect = document.getElementById('color-export-format');
  if (copyColorsBtn) {
    copyColorsBtn.onclick = () => {
      if (!uniqueSwatchColors.length) return;
      const format = formatSelect ? formatSelect.value : 'css';
      const { text, label } = formatColorsForExport(uniqueSwatchColors, format);
      copyToClipboard(text, `Copied ${uniqueSwatchColors.length} colors as ${label}`);
    };
  }

  const gradientListEl = document.getElementById('gradient-list');
  const gradientTitleEl = document.getElementById('gradients-title');
  if (gradientListEl) {
    gradientListEl.innerHTML = '';
    if (data.gradients && data.gradients.length) {
      if (gradientTitleEl) gradientTitleEl.classList.remove('hidden');
      gradientListEl.classList.remove('hidden');
      data.gradients.forEach(g => {
        const wrapper = document.createElement('div');
        wrapper.className = 'color-swatch-container';
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundImage = g;
        swatch.title = `Click to copy\n${g}`;
        swatch.addEventListener('click', () => copyToClipboard(g, 'Copied gradient'));
        const label = document.createElement('div');
        label.className = 'color-hex';
        label.textContent = g.split('(')[0];
        wrapper.appendChild(swatch);
        wrapper.appendChild(label);
        gradientListEl.appendChild(wrapper);
      });
    } else {
      if (gradientTitleEl) gradientTitleEl.classList.add('hidden');
      gradientListEl.classList.add('hidden');
    }
  }

  const contrastBtn = document.getElementById('check-contrast-btn');
  const clearContrastBtn = document.getElementById('clear-contrast-btn');
  const contrastResults = document.getElementById('contrast-results');
  if (contrastBtn) {
    contrastBtn.onclick = () => {
      renderContrastResults(data);
      if (clearContrastBtn) clearContrastBtn.classList.remove('hidden');
      refreshDashboardBreakdown(data, lastSiteFilesResult);
    };
  }
  if (clearContrastBtn) {
    clearContrastBtn.onclick = () => {
      if (contrastResults) {
        contrastResults.classList.add('hidden');
        contrastResults.innerHTML = '';
      }
      clearContrastBtn.classList.add('hidden');
    };
  }
  const contrastResultsEl = document.getElementById('contrast-results');
  if (contrastResultsEl) contrastResultsEl.classList.add('hidden');

  const backlinkStats = computeBacklinkStats(data.links || []);
  setSectionCount('backlinks', backlinkStats.total);
  const backlinkStatsEl = document.getElementById('backlink-stats');
  if (backlinkStatsEl) {
    backlinkStatsEl.innerHTML = '';
    const rows = [
      { label: 'Total Links', value: backlinkStats.total },
      { label: 'Internal', value: backlinkStats.internal },
      { label: 'External', value: backlinkStats.external },
      { label: 'Generic Anchor Text', value: backlinkStats.generic },
      { label: 'UTM Tagged', value: backlinkStats.utm }
    ];
    rows.forEach(r => {
      const div = document.createElement('div');
      div.className = 'meta-item';
      div.innerHTML = `<div class="meta-label">${r.label}</div><div class="meta-value"></div>`;
      div.querySelector('.meta-value').textContent = r.value;
      backlinkStatsEl.appendChild(div);
    });
  }

  const checkBrokenLinksBtn = document.getElementById('check-broken-links-btn');
  const clearBrokenLinksBtn = document.getElementById('clear-broken-links-btn');
  const brokenLinkResultsEl = document.getElementById('broken-link-results');
  if (brokenLinkResultsEl) brokenLinkResultsEl.classList.add('hidden');
  if (checkBrokenLinksBtn) {
    checkBrokenLinksBtn.onclick = () => runBrokenLinkCheck(data.links || []);
  }
  if (clearBrokenLinksBtn) {
    clearBrokenLinksBtn.onclick = () => {
      if (brokenLinkResultsEl) {
        brokenLinkResultsEl.innerHTML = '';
        brokenLinkResultsEl.classList.add('hidden');
      }
      clearBrokenLinksBtn.classList.add('hidden');
    };
  }

  let currentLinks = [];
  window.currentHighlightColor = '';

  function renderLinkList(links, highlightColor) {
    const listEl = document.getElementById('link-list');
    listEl.innerHTML = '';
    if (!links.length) {
      listEl.innerHTML = '<li class="empty-state" style="cursor: default;">No matching links</li>';
      return;
    }
    links.forEach(l => {
      const li = document.createElement('li');
      li.style.flexDirection = 'column';
      li.style.alignItems = 'flex-start';
      li.style.gap = '2px';

      const textSpan = document.createElement('span');
      textSpan.textContent = l.text;
      textSpan.style.fontWeight = '600';
      textSpan.style.color = highlightColor;

      const urlSpan = document.createElement('span');
      urlSpan.textContent = l.url;
      urlSpan.style.fontSize = '0.7rem';
      urlSpan.style.color = 'var(--text-secondary)';
      urlSpan.style.wordBreak = 'break-all';

      li.appendChild(textSpan);
      li.appendChild(urlSpan);
      li.addEventListener('click', () => window.open(l.url, '_blank'));
      listEl.appendChild(li);
    });
  }

  const btnDofollowEl = document.getElementById('btn-dofollow');
  if (btnDofollowEl) {
    btnDofollowEl.onclick = () => {
      chrome.tabs.sendMessage(tabId, { action: 'highlight-dofollow' }, (response) => {
        if (chrome.runtime.lastError) {
          showToast('Could not highlight links — try rescanning the page');
          return;
        }
        const container = document.getElementById('links-container');
        const header = document.getElementById('link-results-header');
        if (response && response.removed) {
          container.classList.add('hidden');
        } else if (response && response.links) {
          container.classList.remove('hidden');
          header.textContent = `Found ${response.count} do-follow links`;
          header.style.color = 'var(--success)';
          currentLinks = response.links;
          window.currentHighlightColor = 'var(--success)';
          const searchEl = document.getElementById('link-search');
          if (searchEl) searchEl.value = '';
          renderLinkList(currentLinks, window.currentHighlightColor);
        }
      });
    };
  }

  const btnNofollowEl = document.getElementById('btn-nofollow');
  if (btnNofollowEl) {
    btnNofollowEl.onclick = () => {
      chrome.tabs.sendMessage(tabId, { action: 'highlight-nofollow' }, (response) => {
        if (chrome.runtime.lastError) {
          showToast('Could not highlight links — try rescanning the page');
          return;
        }
        const container = document.getElementById('links-container');
        const header = document.getElementById('link-results-header');
        if (response && response.removed) {
          container.classList.add('hidden');
        } else if (response && response.links) {
          container.classList.remove('hidden');
          header.textContent = `Found ${response.count} no-follow links`;
          header.style.color = 'var(--danger)';
          currentLinks = response.links;
          window.currentHighlightColor = 'var(--danger)';
          const searchEl = document.getElementById('link-search');
          if (searchEl) searchEl.value = '';
          renderLinkList(currentLinks, window.currentHighlightColor);
        }
      });
    };
  }

  const btnInternalEl = document.getElementById('btn-internal');
  if (btnInternalEl) {
    btnInternalEl.onclick = () => {
      chrome.tabs.sendMessage(tabId, { action: 'highlight-internal' }, (response) => {
        if (chrome.runtime.lastError) {
          showToast('Could not highlight links — try rescanning the page');
          return;
        }
        const container = document.getElementById('links-container');
        const header = document.getElementById('link-results-header');
        if (response && response.removed) {
          container.classList.add('hidden');
        } else if (response && response.links) {
          container.classList.remove('hidden');
          header.textContent = `Found ${response.count} internal links`;
          header.style.color = '#3b82f6';
          currentLinks = response.links;
          window.currentHighlightColor = '#3b82f6';
          const searchEl = document.getElementById('link-search');
          if (searchEl) searchEl.value = '';
          renderLinkList(currentLinks, window.currentHighlightColor);
        }
      });
    };
  }

  const btnExternalEl = document.getElementById('btn-external');
  if (btnExternalEl) {
    btnExternalEl.onclick = () => {
      chrome.tabs.sendMessage(tabId, { action: 'highlight-external' }, (response) => {
        if (chrome.runtime.lastError) {
          showToast('Could not highlight links — try rescanning the page');
          return;
        }
        const container = document.getElementById('links-container');
        const header = document.getElementById('link-results-header');
        if (response && response.removed) {
          container.classList.add('hidden');
        } else if (response && response.links) {
          container.classList.remove('hidden');
          header.textContent = `Found ${response.count} external links`;
          header.style.color = '#f59e0b';
          currentLinks = response.links;
          window.currentHighlightColor = '#f59e0b';
          const searchEl = document.getElementById('link-search');
          if (searchEl) searchEl.value = '';
          renderLinkList(currentLinks, window.currentHighlightColor);
        }
      });
    };
  }

  let linkSearchDebounceTimer = null;
  const linkSearchEl = document.getElementById('link-search');
  if (linkSearchEl) {
    linkSearchEl.oninput = (e) => {
      const q = e.target.value.toLowerCase();
      clearTimeout(linkSearchDebounceTimer);
      linkSearchDebounceTimer = setTimeout(() => {
        const filtered = currentLinks.filter(l => l.text.toLowerCase().includes(q) || l.url.toLowerCase().includes(q));
        renderLinkList(filtered, window.currentHighlightColor);
      }, 120);
    };
  }

  const outlineContainer = document.getElementById('article-outline');
  setSectionCount('outline', data.outline.length);

  const headingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  data.outline.forEach(h => {
    const level = parseInt(h.tag.replace('h', ''), 10);
    if (headingCounts[level] !== undefined) headingCounts[level]++;
  });
  document.querySelectorAll('#heading-counts .heading-count-value').forEach(el => {
    const count = headingCounts[parseInt(el.dataset.level, 10)] || 0;
    el.textContent = count;
    el.classList.toggle('zero', count === 0);
  });

  const readingTimeBadge = document.getElementById('reading-time-badge');
  if (readingTimeBadge) {
    const wordCount = data.meta && data.meta.wordCount;
    if (wordCount) {
      const minutes = Math.max(1, Math.ceil(wordCount / 200));
      readingTimeBadge.textContent = `~${minutes} min read`;
      readingTimeBadge.classList.remove('hidden');
    } else {
      readingTimeBadge.classList.add('hidden');
    }
  }

  if (data.outline.length) {
    data.outline.forEach(heading => {
      const item = document.createElement('div');
      item.className = `outline-item ${heading.tag}-tag`;
      const tagSpan = document.createElement('span');
      tagSpan.style.opacity = '0.5';
      tagSpan.style.marginRight = '6px';
      tagSpan.style.fontSize = '0.7em';
      tagSpan.textContent = heading.tag.toUpperCase();
      item.appendChild(tagSpan);
      item.appendChild(document.createTextNode(heading.text));
      outlineContainer.appendChild(item);
    });

    const copyBtn = document.getElementById('copy-outline-btn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const textLines = [];
        const htmlLines = [];
        data.outline.forEach(h => {
          const level = parseInt(h.tag.replace('h', ''), 10) || 1;
          textLines.push(`${'#'.repeat(level)} ${h.text}`);
          htmlLines.push(`<${h.tag}>${h.text}</${h.tag}>`);
        });
        const text = textLines.join('\n\n');
        const html = htmlLines.join('');

        try {
          const item = new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' })
          });
          navigator.clipboard.write([item]).then(() => {
            showToast('Outline copied');
          }).catch(() => {
            copyToClipboard(text, 'Outline copied as Markdown');
          });
        } catch (e) {
          copyToClipboard(text, 'Outline copied as Markdown');
        }
      };
    }

    const copyTocBtn = document.getElementById('copy-toc-btn');
    if (copyTocBtn) {
      copyTocBtn.onclick = () => {
        const toc = data.outline.map(h => {
          const indent = '  '.repeat(Math.max(0, parseInt(h.tag.replace('h', ''), 10) - 1));
          return `${indent}- ${h.text}`;
        }).join('\n');
        copyToClipboard(toc, 'Table of contents copied');
      };
    }
  } else {
    outlineContainer.innerHTML = '<div class="empty-state">No headings found.</div>';
  }

  const metaContainer = document.getElementById('meta-info');
  metaContainer.innerHTML = '';

  const createMetaItem = (item) => {
    const div = document.createElement('div');
    div.className = 'meta-item';
    let displayLabel = item.label;
    if (item.label === 'Title' && typeof item.value === 'string') {
      const len = item.value.length;
      const color = (len >= 30 && len <= 60) ? 'var(--success)' : 'var(--danger)';
      displayLabel = `Title (<span style="color: ${color};">${len}</span>)`;
    } else if (item.label === 'Description' && typeof item.value === 'string') {
      const len = item.value.length;
      const color = (len >= 120 && len <= 160) ? 'var(--success)' : 'var(--danger)';
      displayLabel = `Description (<span style="color: ${color};">${len}</span>)`;
    }
    const copyBtnHtml = item.copyable ? `
      <button class="meta-copy-btn" title="Copy ${escapeHtml(item.label)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      </button>` : '';
    div.innerHTML = `
      <div class="meta-item-header">
        <div class="meta-label">${displayLabel}</div>
        ${copyBtnHtml}
      </div>
      <div class="meta-value"></div>`;
    div.querySelector('.meta-value').textContent = item.value;
    if (item.copyable) {
      div.querySelector('.meta-copy-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(String(item.value), `${item.label} copied`);
      });
    }
    return div;
  };

  [
    { label: 'Title', value: data.meta.title, copyable: true },
    { label: 'Description', value: data.meta.description, copyable: true },
    { label: 'Canonical URL', value: data.meta.canonical, copyable: true }
  ].forEach(item => {
    if (item.value) metaContainer.appendChild(createMetaItem(item));
  });

  const metaGrid = document.createElement('div');
  metaGrid.className = 'grid-2-col';
  metaGrid.style.marginTop = '12px';
  [
    { label: 'Word Count', value: data.meta.wordCount },
    { label: 'Language', value: data.meta.language }
  ].forEach(item => {
    if (item.value) metaGrid.appendChild(createMetaItem(item));
  });
  if (metaGrid.childNodes.length) metaContainer.appendChild(metaGrid);

  const seoData = data.seo || {};

  const formatDateDisplay = (value) => {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  const dateGrid = document.createElement('div');
  dateGrid.className = 'grid-2-col';
  dateGrid.style.marginTop = '12px';
  [
    { label: 'Published', value: seoData.articlePublished },
    { label: 'Last Modified', value: seoData.articleModified }
  ].forEach(item => {
    const el = createMetaItem({ label: item.label, value: item.value ? formatDateDisplay(item.value) : 'Not detected' });
    if (!item.value) el.querySelector('.meta-value').style.color = 'var(--text-tertiary)';
    dateGrid.appendChild(el);
  });
  metaContainer.appendChild(dateGrid);

  const diagnostics = [];
  if (seoData.robots && seoData.robots.noindex) diagnostics.push('Page is set to noindex — it will not appear in search results.');
  if (seoData.robots && seoData.robots.nofollow) diagnostics.push('Page is set to nofollow — outgoing links pass no authority.');
  if (seoData.canonicalMismatch) diagnostics.push('Canonical URL points to a different page than the one currently loaded.');
  if (seoData.h1Count === 0) diagnostics.push('No H1 heading found on this page.');
  else if (seoData.h1Count > 1) diagnostics.push(`Multiple H1 headings found (${seoData.h1Count}) — there should typically be exactly one.`);
  if (seoData.hasViewport === false) diagnostics.push('No mobile viewport meta tag — page may not be mobile-friendly.');

  const diagTitle = document.createElement('div');
  diagTitle.className = 'section-title';
  diagTitle.textContent = 'Diagnostics';
  metaContainer.appendChild(diagTitle);

  if (diagnostics.length) {
    diagnostics.forEach(text => {
      const div = document.createElement('div');
      div.className = 'meta-item';
      div.innerHTML = '<div class="meta-label" style="background: var(--badge-orange-bg); color: var(--danger);">Issue</div><div class="meta-value"></div>';
      div.querySelector('.meta-value').textContent = text;
      metaContainer.appendChild(div);
    });
  } else {
    const div = document.createElement('div');
    div.className = 'meta-item';
    div.innerHTML = '<div class="meta-label" style="background: var(--badge-green-bg); color: var(--success);">All good</div><div class="meta-value">No major SEO issues detected.</div>';
    metaContainer.appendChild(div);
  }

  const seoTitle = document.createElement('div');
  seoTitle.className = 'section-title';
  seoTitle.textContent = 'SEO Fundamentals';
  metaContainer.appendChild(seoTitle);

  const seoGrid = document.createElement('div');
  seoGrid.className = 'grid-2-col';
  seoGrid.style.marginTop = '12px';
  const seoGridRows = [
    { label: 'Mobile Viewport', value: typeof seoData.hasViewport === 'boolean' ? (seoData.hasViewport ? 'Present' : 'Missing') : null },
    { label: 'Open Graph Type', value: seoData.ogType },
    { label: 'Open Graph Locale', value: seoData.ogLocale },
    { label: 'Twitter Card', value: seoData.twitterCard },
    { label: 'Charset', value: seoData.charset }
  ];
  seoGridRows.forEach(item => {
    if (item.value) seoGrid.appendChild(createMetaItem(item));
  });
  if (seoGrid.childNodes.length) metaContainer.appendChild(seoGrid);

  const seoFullRows = [
    { label: 'Robots', value: seoData.robots && seoData.robots.raw },
    { label: 'Open Graph URL', value: seoData.ogUrl },
    { label: 'Open Graph Site Name', value: seoData.ogSiteName },
    { label: 'Author', value: seoData.author },
    { label: 'Generator', value: seoData.generator },
    { label: 'Hreflang Alternates', value: seoData.hreflang && seoData.hreflang.length ? seoData.hreflang.map(h => h.lang).join(', ') : null }
  ];
  seoFullRows.forEach(item => {
    if (item.value) metaContainer.appendChild(createMetaItem(item));
  });

  renderStructuredData(data);
  renderMediaContact(data);
  renderAccessibilityAudit(data);
  renderDarkPatternAudit(data);
  renderPerformanceSnapshot(data);
  renderDesignTokens(data);
  renderSeoScore(data);
  renderVibeStrip(data);
  renderSerpPreview(data);
  renderTechStack(data.techStack, null);
  renderTrustSignals(data);
  setupThemePreviewControls(data, tabId);

  const socialToggle = document.getElementById('social-platform-toggle');
  if (socialToggle) {
    socialToggle.querySelectorAll('.tag').forEach(btn => {
      btn.onclick = () => {
        socialToggle.querySelectorAll('.tag').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderSocialPreview(data, btn.dataset.platform);
      };
    });
    const activeBtn = socialToggle.querySelector('.tag.active') || socialToggle.querySelector('.tag');
    renderSocialPreview(data, activeBtn ? activeBtn.dataset.platform : 'facebook');
  }

  const logosGrid = document.getElementById('assets-grid-logos');
  const imagesGrid = document.getElementById('assets-grid-images');
  const assetsToggleContainer = document.getElementById('assets-toggle-container');
  const btnShowLogos = document.getElementById('btn-show-logos');
  const btnShowImages = document.getElementById('btn-show-images');

  const assetsListMode = currentSettings && currentSettings.assetLayout === 'list';
  if (logosGrid) logosGrid.classList.toggle('list-mode', assetsListMode);
  if (imagesGrid) imagesGrid.classList.toggle('list-mode', assetsListMode);

  const downloadAllZipBtn = document.getElementById('download-all-zip-btn');
  if (downloadAllZipBtn) {
    downloadAllZipBtn.onclick = () => {
      const logoUrls = [];
      const imageUrls = [];
      (data.images || []).forEach(imgUrl => {
        (isLogoUrl(imgUrl, data.meta.canonical) ? logoUrls : imageUrls).push(imgUrl);
      });
      downloadAllAssetsAsZip(logoUrls, imageUrls);
    };
  }

  if (data.images && data.images.length) {
    setSectionCount('assets', data.images.length);
    const logos = [];
    const images = [];

    data.images.forEach(imgUrl => {
      (isLogoUrl(imgUrl, data.meta.canonical) ? logos : images).push(imgUrl);
    });

    const maxItems = (currentSettings && currentSettings.maxItemsPerGrid) || DEFAULT_MAX_ITEMS_PER_GRID;
    if (logos.length > 0) logos.slice(0, maxItems).forEach(url => createAssetItem(url, logosGrid, data.meta.canonical));
    if (images.length > 0) images.slice(0, maxItems).forEach(url => createAssetItem(url, imagesGrid, data.meta.canonical));

    if (assetsToggleContainer) {
      assetsToggleContainer.style.display = 'flex';

      const showLogos = () => {
        btnShowLogos.classList.add('active');
        btnShowImages.classList.remove('active');
        logosGrid.classList.remove('hidden');
        imagesGrid.classList.add('hidden');
      };

      const showImages = () => {
        btnShowImages.classList.add('active');
        btnShowLogos.classList.remove('active');
        imagesGrid.classList.remove('hidden');
        logosGrid.classList.add('hidden');
      };

      btnShowLogos.onclick = showLogos;
      btnShowImages.onclick = showImages;

      if (images.length > 0) {
        showImages();
      } else {
        showLogos();
      }
    }
  } else {
    setSectionCount('assets', 0);
    if (assetsToggleContainer) assetsToggleContainer.style.display = 'none';
    if (imagesGrid) {
      imagesGrid.classList.remove('hidden');
      imagesGrid.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">No assets detected</div>';
    }
  }

  renderBrokenImagesList();
}

let colorblindMode = 'normal';

const COLORBLIND_MATRICES = {
  protanopia: [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  tritanopia: [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]],
  monochrome: [[0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722], [0.2126, 0.7152, 0.0722]]
};

function hexToRgbTriple(hex) {
  const clean = hex.replace('#', '').slice(0, 6).padEnd(6, '0');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbTripleToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hexToHsl(hex) {
  const [r, g, b] = hexToRgbTriple(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return rgbTripleToHex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
}

function simulateColorblind(hex, mode) {
  const matrix = COLORBLIND_MATRICES[mode];
  if (!matrix) return hex;
  const [r, g, b] = hexToRgbTriple(hex);
  const nr = matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b;
  const ng = matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b;
  const nb = matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b;
  return rgbTripleToHex(nr, ng, nb);
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgbTriple(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function formatColorsForExport(colorsArray, format) {
  if (format === 'tailwind') {
    const entries = colorsArray.map((c, i) => `        'color-${i + 1}': '${c.hex}',`).join('\n');
    return {
      label: 'Tailwind config',
      text: `module.exports = {\n  theme: {\n    extend: {\n      colors: {\n${entries}\n      }\n    }\n  }\n}`
    };
  }
  if (format === 'scss') {
    return {
      label: 'SCSS variables',
      text: colorsArray.map((c, i) => `$color-${i + 1}: ${c.hex};`).join('\n')
    };
  }
  if (format === 'json') {
    const obj = {};
    colorsArray.forEach((c, i) => { obj[`color-${i + 1}`] = c.hex; });
    return { label: 'JSON', text: JSON.stringify(obj, null, 2) };
  }
  return {
    label: 'CSS',
    text: [':root {', ...colorsArray.map((c, i) => `  --color-${i + 1}: ${c.hex};`), '}'].join('\n')
  };
}

// responsive presets
const RESPONSIVE_DEVICE_PRESETS = [
  { name: 'iPhone 16 Pro Max', width: 440, height: 956 },
  { name: 'Galaxy S24 Ultra', width: 384, height: 824 },
  { name: 'Pixel 9 Pro', width: 412, height: 919 },
  { name: 'iPad Mini', width: 768, height: 1024 },
  { name: 'iPad Pro', width: 1024, height: 1366 },
  { name: 'Desktop', width: 1440, height: 900 }
];

const RESPONSIVE_WINDOW_CHROME_OFFSET = { width: 16, height: 88 };

function openResponsivePreview(width, height) {
  if (!lastActiveTabId) {
    showToast('No active tab to preview');
    return;
  }
  chrome.tabs.get(lastActiveTabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) {
      showToast('Could not read the current page URL');
      return;
    }
    chrome.windows.create({
      url: tab.url,
      type: 'popup',
      width: width + RESPONSIVE_WINDOW_CHROME_OFFSET.width,
      height: height + RESPONSIVE_WINDOW_CHROME_OFFSET.height
    }, () => {
      if (chrome.runtime.lastError) showToast('Could not open preview window');
    });
  });
}

function setupResponsiveSimulator() {
  const grid = document.getElementById('device-grid');
  if (grid) {
    RESPONSIVE_DEVICE_PRESETS.forEach(preset => {
      const card = document.createElement('div');
      card.className = 'device-card';
      card.innerHTML = '<div class="device-card-name"></div><div class="device-card-dims"></div>';
      card.querySelector('.device-card-name').textContent = preset.name;
      card.querySelector('.device-card-dims').textContent = `${preset.width} × ${preset.height}`;
      card.addEventListener('click', () => openResponsivePreview(preset.width, preset.height));
      grid.appendChild(card);
    });
  }

  const customBtn = document.getElementById('open-custom-device-btn');
  if (customBtn) {
    customBtn.addEventListener('click', () => {
      const w = parseInt(document.getElementById('custom-device-width').value, 10);
      const h = parseInt(document.getElementById('custom-device-height').value, 10);
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 100 || h < 100) {
        showToast('Enter a valid width and height');
        return;
      }
      openResponsivePreview(w, h);
    });
  }
}

// screenshot
const { loadImageAsync, redrawCanvas, downloadBlob, copyCanvasToClipboard, exportCanvas } = ScreenshotShared;

let screenshotState = null; // { baseImage: HTMLImageElement, ops: [] }
const MAX_FULLPAGE_SLICES = 120;

function sendGenericMessage(tabId, action, payload) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { action, ...(payload || {}) }, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

function captureVisibleTabAsync() {
  return new Promise(resolve => {
    chrome.tabs.captureVisibleTab(undefined, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(dataUrl);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showScreenshotOverlayLoading() {
  const overlay = document.getElementById('screenshot-overlay');
  const emptyEl = document.getElementById('screenshot-empty');
  const editorEl = document.getElementById('screenshot-editor');
  if (overlay) overlay.classList.remove('hidden');
  if (editorEl) editorEl.classList.add('hidden');
  if (emptyEl) emptyEl.classList.remove('hidden');
}

function showScreenshotStatus(text) {
  const el = document.getElementById('screenshot-status-text');
  if (el) el.textContent = text;
}

function closeScreenshotOverlay() {
  const overlay = document.getElementById('screenshot-overlay');
  const emptyEl = document.getElementById('screenshot-empty');
  const editorEl = document.getElementById('screenshot-editor');
  if (overlay) overlay.classList.add('hidden');
  if (editorEl) editorEl.classList.add('hidden');
  if (emptyEl) emptyEl.classList.remove('hidden');
  screenshotState = null;
}

function redrawScreenshotCanvas(precomputedScale) {
  if (!screenshotState) return;
  const canvas = document.getElementById('screenshot-canvas');
  redrawCanvas(canvas, screenshotState, precomputedScale);
}

function openScreenshotEditor(dataUrl, breakData) {
  loadImageAsync(dataUrl).then(img => {
    const emptyEl = document.getElementById('screenshot-empty');
    const editorEl = document.getElementById('screenshot-editor');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (editorEl) editorEl.classList.remove('hidden');

    const canvas = document.getElementById('screenshot-canvas');
    canvas.width = img.width;
    canvas.height = img.height;

    screenshotState = {
      baseImage: img,
      baseImageDataUrl: dataUrl,
      ops: [],
      domIntervals: (breakData && breakData.intervals) || null,
      dpr: (breakData && breakData.dpr) || 1
    };
    redrawScreenshotCanvas();
  }).catch(() => {
    showToast('Could not load the captured image');
    closeScreenshotOverlay();
  });
}

async function captureVisibleAreaAndOpen() {
  showScreenshotOverlayLoading();
  showScreenshotStatus('Capturing visible area…');
  if (lastActiveTabId) await sendGenericMessage(lastActiveTabId, 'hide-scrollbar');
  const dataUrl = await captureVisibleTabAsync();
  if (lastActiveTabId) sendGenericMessage(lastActiveTabId, 'restore-scrollbar');
  if (!dataUrl) {
    showToast('Could not capture screenshot');
    closeScreenshotOverlay();
    return;
  }
  let breakData = null;
  if (lastActiveTabId) {
    const [dims, safeBreaks] = await Promise.all([
      sendGenericMessage(lastActiveTabId, 'get-page-dimensions'),
      sendGenericMessage(lastActiveTabId, 'get-safe-break-points')
    ]);
    breakData = {
      intervals: safeBreaks && safeBreaks.intervals,
      dpr: dims ? dims.dpr : (window.devicePixelRatio || 1)
    };
  }
  openScreenshotEditor(dataUrl, breakData);
}

async function captureFullPageAndOpen() {
  if (!lastActiveTabId) {
    showToast('No active tab to capture');
    return;
  }
  const tabId = lastActiveTabId;
  showScreenshotOverlayLoading();
  showScreenshotStatus('Measuring page…');

  const [dims] = await Promise.all([
    sendGenericMessage(tabId, 'get-page-dimensions'),
    sendGenericMessage(tabId, 'prepare-fullpage-capture')
  ]);
  if (!dims) {
    showToast('Could not measure the page');
    sendGenericMessage(tabId, 'restore-after-fullpage-capture');
    closeScreenshotOverlay();
    return;
  }

  const { viewportWidth, viewportHeight, dpr } = dims;
  let totalSlices = Math.max(1, Math.ceil(dims.scrollHeight / viewportHeight));
  let capped = false;
  if (totalSlices > MAX_FULLPAGE_SLICES) {
    totalSlices = MAX_FULLPAGE_SLICES;
    capped = true;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewportWidth * dpr);
  canvas.height = Math.round(dims.scrollHeight * dpr);
  const ctx = canvas.getContext('2d');

  let lastActualY = -1;
  let capturedBottomPx = 0;
  let reachedBottom = false;

  for (let i = 0; i < totalSlices; i++) {
    const targetY = i * viewportHeight;
    showScreenshotStatus(`Capturing section ${i + 1} of ${totalSlices}…`);
    const scrollResult = await sendGenericMessage(tabId, 'scroll-to', { y: targetY });
    const actualY = (scrollResult && typeof scrollResult.scrollY === 'number') ? scrollResult.scrollY : targetY;

    if (i > 0 && actualY === lastActualY) {
      reachedBottom = true;
      break;
    }
    lastActualY = actualY;

    await sleep(300); // let lazy-loaded content/network settle after the confirmed scroll+paint
    const dataUrl = await captureVisibleTabAsync();
    if (dataUrl) {
      try {
        const img = await loadImageAsync(dataUrl);
        const sliceHeightCss = Math.min(viewportHeight, dims.scrollHeight - actualY);
        const sliceHeightPx = Math.round(sliceHeightCss * dpr);
        const destY = Math.round(actualY * dpr);
        ctx.drawImage(img, 0, 0, img.width, sliceHeightPx, 0, destY, canvas.width, sliceHeightPx);
        capturedBottomPx = Math.max(capturedBottomPx, destY + sliceHeightPx);
      } catch (e) { /* skip this slice */ }
    }
    if (i === 0) await sendGenericMessage(tabId, 'hide-fixed-elements');
    if (actualY + viewportHeight >= dims.scrollHeight) {
      reachedBottom = true;
      break;
    }
    await sleep(350); // stay under captureVisibleTab's per-second rate limit
  }

  const safeBreaks = await sendGenericMessage(tabId, 'get-safe-break-points');
  await sendGenericMessage(tabId, 'scroll-to', { y: 0 });
  await sendGenericMessage(tabId, 'restore-after-fullpage-capture');

  let finalCanvas = canvas;
  if (capturedBottomPx > 0 && capturedBottomPx < canvas.height) {
    finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvas.width;
    finalCanvas.height = capturedBottomPx;
    finalCanvas.getContext('2d').drawImage(canvas, 0, 0);
  }

  if (capped && !reachedBottom) {
    showToast(`Very long page — captured the first ${MAX_FULLPAGE_SLICES} screens`);
  }
  openScreenshotEditor(finalCanvas.toDataURL('image/png'), {
    intervals: safeBreaks && safeBreaks.intervals,
    dpr
  });
}

function setupScreenshotPanel() {
  const captureVisibleBtn = document.getElementById('capture-visible-btn');
  const captureFullpageBtn = document.getElementById('capture-fullpage-btn');
  const backBtn = document.getElementById('screenshot-back-btn');
  const editBtn = document.getElementById('screenshot-edit-btn');
  const downloadBtn = document.getElementById('download-screenshot-btn');
  const copyBtn = document.getElementById('copy-screenshot-btn');

  if (captureVisibleBtn) captureVisibleBtn.addEventListener('click', captureVisibleAreaAndOpen);
  if (captureFullpageBtn) captureFullpageBtn.addEventListener('click', captureFullPageAndOpen);
  if (backBtn) backBtn.addEventListener('click', closeScreenshotOverlay);
  if (editBtn) editBtn.addEventListener('click', openFullScreenshotEditor);
  if (downloadBtn) downloadBtn.addEventListener('click', () => downloadScreenshot());
  if (copyBtn) copyBtn.addEventListener('click', () => copyScreenshotToClipboard());
}

function screenshotFilenameBase() {
  try {
    const host = lastExtractedData && lastExtractedData.meta && lastExtractedData.meta.canonical
      ? new URL(lastExtractedData.meta.canonical).hostname
      : null;
    return host ? `screenshot-${host}-${Date.now()}` : `screenshot-${Date.now()}`;
  } catch (e) {
    return `screenshot-${Date.now()}`;
  }
}

async function copyScreenshotToClipboard() {
  const canvas = document.getElementById('screenshot-canvas');
  if (!canvas) return;
  try {
    await copyCanvasToClipboard(canvas);
    showToast('Screenshot copied to clipboard');
  } catch (e) {
    showToast('Could not copy screenshot');
  }
}

function openFullScreenshotEditor() {
  if (!screenshotState || !screenshotState.baseImageDataUrl) return;
  const payload = {
    imageDataUrl: screenshotState.baseImageDataUrl,
    ops: screenshotState.ops,
    domIntervals: screenshotState.domIntervals,
    dpr: screenshotState.dpr,
    filenameBase: screenshotFilenameBase()
  };
  chrome.storage.local.set({ [ScreenshotShared.HANDOFF_STORAGE_KEY]: payload }, () => {
    if (chrome.runtime.lastError) {
      showToast('Could not open the full editor');
      return;
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') }, () => {
      window.close();
    });
  });
}

function downloadScreenshot() {
  const canvas = document.getElementById('screenshot-canvas');
  if (!canvas) return;
  const formatSelect = document.getElementById('screenshot-download-format');
  const format = formatSelect ? formatSelect.value : 'png';
  const base = screenshotFilenameBase();
  const domIntervals = screenshotState ? screenshotState.domIntervals : null;
  const dpr = screenshotState ? screenshotState.dpr : 1;

  if (format === 'pdf') showToast('Building PDF…');
  exportCanvas(canvas, format, domIntervals, dpr).then(blob => {
    downloadBlob(blob, `${base}.${format}`);
    showToast('Screenshot downloaded');
  }).catch(() => showToast(format === 'pdf' ? 'Could not build PDF' : 'Could not export image'));
}

function setupColorblindToggle() {
  const toggle = document.getElementById('colorblind-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('button[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      toggle.querySelectorAll('button[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      colorblindMode = btn.dataset.mode;
      if (lastExtractedData) renderAllColorGrids(lastExtractedData, lastActiveTabId);

      if (lastActiveTabId) {
        chrome.tabs.sendMessage(lastActiveTabId, { action: 'simulate-colorblind', mode: colorblindMode }, (response) => {
          if (chrome.runtime.lastError) return;
          showToast(colorblindMode === 'normal' ? 'Colorblind simulation removed from the live page' : `Simulating ${colorblindMode} on the live page`);
        });
      }
    });
  });
}

// overview: exclude header/footer from the SEO audit
function setupExcludeHeaderFooterToggle() {
  const toggle = document.getElementById('exclude-header-footer-toggle');
  if (!toggle) return;
  chrome.storage.local.get(['excludeHeaderFooterAudit'], (res) => {
    toggle.checked = !!res.excludeHeaderFooterAudit;
  });
  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ excludeHeaderFooterAudit: enabled }, () => {
      showToast(enabled ? 'Excluding header & footer from the SEO audit' : 'Including header & footer in the SEO audit');
      const refreshBtn = document.getElementById('refresh-btn');
      if (refreshBtn) refreshBtn.click();
    });
  });
}

// dark mode toggle
function setupDarkModePreviewToggle() {
  const toggle = document.getElementById('dark-mode-preview-toggle');
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    if (!lastActiveTabId) { toggle.checked = false; return; }
    const enabled = toggle.checked;
    chrome.tabs.sendMessage(lastActiveTabId, { action: 'toggle-dark-mode-preview', enabled }, (response) => {
      if (chrome.runtime.lastError) {
        showToast('Could not preview dark mode on this page');
        toggle.checked = !enabled;
        return;
      }
      showToast(enabled ? 'Simulating dark mode on the live page' : 'Dark mode preview removed');
    });
  });
}

// spacing/baseline grid overlay
function setupGridOverlayToggle() {
  const toggle = document.getElementById('grid-overlay-toggle');
  const sizeRow = document.getElementById('grid-overlay-size-row');
  const sizeInput = document.getElementById('grid-overlay-size-input');
  if (!toggle) return;

  const applyGridOverlay = (mode) => {
    if (!lastActiveTabId) return;
    const size = parseInt(sizeInput.value, 10) || (mode === 'baseline' ? 24 : 8);
    chrome.tabs.sendMessage(lastActiveTabId, { action: 'toggle-grid-overlay', mode, size }, (response) => {
      if (chrome.runtime.lastError) {
        showToast('Could not show the grid overlay on this page');
        return;
      }
      if (mode === 'none') showToast('Grid overlay removed');
      else showToast(`Showing a ${size}px ${mode === 'baseline' ? 'baseline' : 'spacing'} grid on the live page`);
    });
  };

  toggle.querySelectorAll('.tag').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      toggle.querySelectorAll('.tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (sizeRow) sizeRow.classList.toggle('hidden', mode === 'none');
      if (sizeInput && !sizeInput.dataset.userSet) sizeInput.value = mode === 'baseline' ? 24 : 8;
      applyGridOverlay(mode);
    });
  });

  if (sizeInput) {
    sizeInput.addEventListener('input', () => {
      sizeInput.dataset.userSet = 'true';
      const activeBtn = toggle.querySelector('.tag.active');
      if (activeBtn && activeBtn.dataset.mode !== 'none') applyGridOverlay(activeBtn.dataset.mode);
    });
  }
}

const SETTINGS_STORAGE_KEY = 'stylytics_settings';
const SETTINGS_VERSION = 1;
const DEFAULT_MAX_ITEMS_PER_GRID = 48;
const MAX_ITEMS_PER_GRID_LIMIT = 200; // matches #settings-max-items's max="200"

function getSectionMeta(boardId) {
  const board = document.getElementById(boardId || 'section-board');
  const cards = board ? Array.from(board.querySelectorAll('.section-card')) : [];
  return cards.map(c => ({
    key: c.dataset.tab,
    label: (c.querySelector('.tile-label') && c.querySelector('.tile-label').textContent) || c.dataset.tab
  }));
}

// getSectionMeta() reads the live DOM order, which applySettings() reorders in place —
// so the section order must be captured once, before the first reorder ever happens,
// or "reset to defaults" would just reapply whatever order is currently on screen.
let cachedDefaultSectionOrder = null;
let cachedDefaultSeoMetaOrder = null;
let cachedDefaultSeoPerformanceOrder = null;

function getDefaultSettings() {
  const sections = getSectionMeta('section-board');
  if (!cachedDefaultSectionOrder) {
    cachedDefaultSectionOrder = sections.map(s => s.key);
  }
  const knownKeys = sections.map(s => s.key);
  const sectionOrder = cachedDefaultSectionOrder.filter(k => knownKeys.includes(k));
  knownKeys.forEach(k => { if (!sectionOrder.includes(k)) sectionOrder.push(k); });

  const sectionVisibility = {};
  sections.forEach(s => { sectionVisibility[s.key] = true; });

  const metaSections = getSectionMeta('seo-meta-board');
  if (!cachedDefaultSeoMetaOrder) cachedDefaultSeoMetaOrder = metaSections.map(s => s.key);
  const metaKnownKeys = metaSections.map(s => s.key);
  const seoMetaOrder = cachedDefaultSeoMetaOrder.filter(k => metaKnownKeys.includes(k));
  metaKnownKeys.forEach(k => { if (!seoMetaOrder.includes(k)) seoMetaOrder.push(k); });

  const perfSections = getSectionMeta('seo-performance-board');
  if (!cachedDefaultSeoPerformanceOrder) cachedDefaultSeoPerformanceOrder = perfSections.map(s => s.key);
  const perfKnownKeys = perfSections.map(s => s.key);
  const seoPerformanceOrder = cachedDefaultSeoPerformanceOrder.filter(k => perfKnownKeys.includes(k));
  perfKnownKeys.forEach(k => { if (!seoPerformanceOrder.includes(k)) seoPerformanceOrder.push(k); });

  const seoSectionVisibility = {};
  metaSections.concat(perfSections).forEach(s => { seoSectionVisibility[s.key] = true; });

  return {
    version: SETTINGS_VERSION,
    sectionOrder,
    sectionVisibility,
    defaultExpanded: null,
    maxItemsPerGrid: DEFAULT_MAX_ITEMS_PER_GRID,
    sectionLayout: 'list',
    assetLayout: 'grid',
    restoreLastSession: true,
    seoMetaOrder,
    seoPerformanceOrder,
    seoSectionVisibility,
    modernLook: false
  };
}

function loadSettings(callback) {
  chrome.storage.local.get([SETTINGS_STORAGE_KEY], (res) => {
    const stored = res[SETTINGS_STORAGE_KEY];
    const defaults = getDefaultSettings();
    if (!stored || stored.version !== SETTINGS_VERSION) {
      currentSettings = defaults;
    } else {
      const validKeys = defaults.sectionOrder;
      const storedOrder = (stored.sectionOrder || []).filter(k => validKeys.includes(k));
      const missing = validKeys.filter(k => !storedOrder.includes(k));

      const validMetaKeys = defaults.seoMetaOrder;
      const storedMetaOrder = (stored.seoMetaOrder || []).filter(k => validMetaKeys.includes(k));
      const missingMeta = validMetaKeys.filter(k => !storedMetaOrder.includes(k));

      const validPerfKeys = defaults.seoPerformanceOrder;
      const storedPerfOrder = (stored.seoPerformanceOrder || []).filter(k => validPerfKeys.includes(k));
      const missingPerf = validPerfKeys.filter(k => !storedPerfOrder.includes(k));

      currentSettings = {
        version: SETTINGS_VERSION,
        sectionOrder: [...storedOrder, ...missing],
        sectionVisibility: { ...defaults.sectionVisibility, ...(stored.sectionVisibility || {}) },
        defaultExpanded: stored.defaultExpanded || null,
        maxItemsPerGrid: stored.maxItemsPerGrid ? Math.min(stored.maxItemsPerGrid, MAX_ITEMS_PER_GRID_LIMIT) : DEFAULT_MAX_ITEMS_PER_GRID,
        sectionLayout: stored.sectionLayout === 'grid' ? 'grid' : 'list',
        assetLayout: stored.assetLayout === 'list' ? 'list' : 'grid',
        restoreLastSession: stored.restoreLastSession !== false,
        seoMetaOrder: [...storedMetaOrder, ...missingMeta],
        seoPerformanceOrder: [...storedPerfOrder, ...missingPerf],
        seoSectionVisibility: { ...defaults.seoSectionVisibility, ...(stored.seoSectionVisibility || {}) },
        modernLook: stored.modernLook === true
      };
    }
    callback(currentSettings);
  });
}

function saveSettingsToStorage(settings, callback) {
  chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings }, callback);
}

function applyBoardSettings(boardId, order, visibility, layout, defaultExpanded) {
  const board = document.getElementById(boardId);
  if (!board) return;

  const expandedBeforeReorder = board.querySelector('.section-card.expanded');
  if (expandedBeforeReorder) closeSectionTile(expandedBeforeReorder);

  setBoardLayoutMode(board, layout || 'list');

  order.forEach(key => {
    const card = board.querySelector(`.section-card[data-tab="${key}"]`);
    if (card) board.appendChild(card);
  });

  board.querySelectorAll('.section-card').forEach(card => {
    const key = card.dataset.tab;
    const visible = visibility[key] !== false;
    card.classList.toggle('hidden', !visible);
  });

  if (defaultExpanded) {
    const alreadyExpanded = board.querySelector('.section-card.expanded');
    if (!alreadyExpanded) {
      const target = board.querySelector(`.section-card[data-tab="${defaultExpanded}"]`);
      if (target && !target.classList.contains('hidden')) {
        openSectionTile(target);
      }
    }
  }
}

function applySettings(settings) {
  applyBoardSettings('section-board', settings.sectionOrder, settings.sectionVisibility, settings.sectionLayout, settings.defaultExpanded);
  applyBoardSettings('seo-meta-board', settings.seoMetaOrder || [], settings.seoSectionVisibility || {}, settings.sectionLayout, null);
  applyBoardSettings('seo-performance-board', settings.seoPerformanceOrder || [], settings.seoSectionVisibility || {}, settings.sectionLayout, null);
  applyModernLook(settings.modernLook === true);
}

// "Modern Look" turns the SEO tab's Meta/Performance boards into a tabbed property
// sheet: the tab strip reuses the same .segmented/.tag pill component used elsewhere
// in the app (theme choice, colorblind modes, ...), just wrapping to a second line
// when a group has more tabs than fit in one row. Via the .modern-look CSS rule, only
// the one card with .expanded ever renders below it, so the panel's height tracks just
// that section's content instead of the whole stacked list. openSectionTile already
// guarantees at most one .expanded card per board, so tabs just drive that same state.
function renderSeoPillBar(boardId, pillsId) {
  const board = document.getElementById(boardId);
  const pillsEl = document.getElementById(pillsId);
  if (!board || !pillsEl) return;

  const cards = Array.from(board.querySelectorAll('.section-card')).filter(c => !c.classList.contains('hidden'));
  pillsEl.innerHTML = '';
  if (!cards.length) {
    // every tool in this group is hidden via Arrangement — say so instead of a
    // silent blank panel with no pills and no card
    pillsEl.innerHTML = '<div class="empty-state" style="padding: 4px 0;">All tools in this group are hidden — enable some in Settings › Arrangement</div>';
    return;
  }
  cards.forEach((card, index) => {
    if (index > 0) {
      const divider = document.createElement('span');
      divider.className = 'seo-tab-divider';
      divider.textContent = '|';
      divider.setAttribute('aria-hidden', 'true');
      pillsEl.appendChild(divider);
    }

    const labelEl = card.querySelector('.tile-label');
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tag';
    tab.textContent = labelEl ? labelEl.textContent : (card.dataset.tab || '');
    tab.dataset.key = card.dataset.tab;
    // carry the card's own accent color (--c-meta, --c-seo-score, ...) onto its pill,
    // so the active tab picks up that same color instead of a flat neutral highlight
    tab.style.setProperty('--tile-accent', card.style.getPropertyValue('--tile-accent'));
    if (card.classList.contains('expanded')) tab.classList.add('active');
    tab.addEventListener('click', () => {
      if (!card.classList.contains('expanded')) openSectionTile(card);
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    pillsEl.appendChild(tab);
  });
}

function syncSeoPillActiveStates(boardId, pillsId) {
  const board = document.getElementById(boardId);
  const pillsEl = document.getElementById(pillsId);
  if (!board || !pillsEl) return;
  pillsEl.querySelectorAll('.tag').forEach(tab => {
    const card = board.querySelector(`.section-card[data-tab="${tab.dataset.key}"]`);
    tab.classList.toggle('active', !!(card && card.classList.contains('expanded')));
  });
}

function renderAllSeoPillBars() {
  renderSeoPillBar('seo-meta-board', 'seo-meta-pills');
  renderSeoPillBar('seo-performance-board', 'seo-performance-pills');
}

// True for a card that is the ONLY thing Modern Look renders in its board right now —
// closing it via its own header (rather than switching tabs) would leave a blank panel
// with nothing to fall back to.
function isSoleModernLookCard(card) {
  const seoPanel = document.getElementById('tab-panel-seo');
  if (!seoPanel || !seoPanel.classList.contains('modern-look')) return false;
  const board = card.closest('.section-board');
  return !!(board && (board.id === 'seo-meta-board' || board.id === 'seo-performance-board'));
}

// Turning Modern Look on needs exactly one visible card expanded so the tab strip
// never lands on a blank panel. This runs from applySettings — long before the SEO
// tab is ever shown or the page has been scanned — so it must NOT go through
// openSectionTile/expandCardBody: those measure scrollHeight, which reads 0 on a
// display:none ancestor and would permanently wedge the body at 0px. Setting
// height:auto directly sidesteps that; a real (visible, scanned) pill click later
// still goes through the normal measured-height path.
function ensureModernActiveCard(boardId) {
  const board = document.getElementById(boardId);
  if (!board) return;
  const visibleCards = Array.from(board.querySelectorAll('.section-card')).filter(c => !c.classList.contains('hidden'));
  if (!visibleCards.length) return;
  if (visibleCards.some(c => c.classList.contains('expanded'))) return;

  const card = visibleCards[0];
  const body = getCardBodyEl(card);
  card.classList.add('expanded');
  if (body) {
    body.dataset.ownerTab = card.dataset.tab;
    body.style.height = 'auto';
  }
}

// Modern Look shows one whole group (Meta or Performance) at a time, picked via the
// small "Meta | Performance" switcher above them — so the two never require scrolling
// past one to reach the other. Only meaningful while Modern Look is on; when it's off
// both groups are just the plain stacked list and are always shown together.
let activeSeoGroup = 'meta';

function showSeoGroup(group) {
  activeSeoGroup = group === 'performance' ? 'performance' : 'meta';
  const metaPanel = document.getElementById('seo-group-meta');
  const perfPanel = document.getElementById('seo-group-performance');
  if (metaPanel) metaPanel.classList.toggle('hidden', activeSeoGroup !== 'meta');
  if (perfPanel) perfPanel.classList.toggle('hidden', activeSeoGroup !== 'performance');

  const toggle = document.getElementById('seo-group-toggle');
  if (toggle) {
    toggle.querySelectorAll('.tag').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.group === activeSeoGroup);
    });
  }
}

function setupSeoGroupToggle() {
  const toggle = document.getElementById('seo-group-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('.tag').forEach(btn => {
    btn.addEventListener('click', () => showSeoGroup(btn.dataset.group));
  });
}

function applyModernLook(enabled) {
  const seoPanel = document.getElementById('tab-panel-seo');
  if (seoPanel) seoPanel.classList.toggle('modern-look', !!enabled);

  const metaPills = document.getElementById('seo-meta-pills');
  const perfPills = document.getElementById('seo-performance-pills');
  if (metaPills) metaPills.classList.toggle('hidden', !enabled);
  if (perfPills) perfPills.classList.toggle('hidden', !enabled);

  const groupToggle = document.getElementById('seo-group-toggle');
  const groupDivider = document.getElementById('seo-group-toggle-divider');
  if (groupToggle) groupToggle.classList.toggle('hidden', !enabled);
  if (groupDivider) groupDivider.classList.toggle('hidden', !enabled);

  if (enabled) {
    ensureModernActiveCard('seo-meta-board');
    ensureModernActiveCard('seo-performance-board');
    renderAllSeoPillBars();
    showSeoGroup(activeSeoGroup);
  } else {
    const metaPanel = document.getElementById('seo-group-meta');
    const perfPanel = document.getElementById('seo-group-performance');
    if (metaPanel) metaPanel.classList.remove('hidden');
    if (perfPanel) perfPanel.classList.remove('hidden');
  }
}

// shared by the Tools "Sections" list and the SEO tab's Meta/Performance lists —
// same drag-to-reorder + show/hide row markup, just pointed at a different order/visibility source
function renderSectionListRows(listEl, order, visibilityMap, sectionLabels) {
  if (!listEl) return;
  listEl.innerHTML = '';
  let draggedRow = null;

  order.forEach((key) => {
    const sourceCard = document.querySelector(`.section-card[data-tab="${key}"]`);
    const iconHtml = sourceCard ? sourceCard.querySelector('.tile-icon-wrap').outerHTML : '';
    const accentStyle = sourceCard ? sourceCard.getAttribute('style') || '' : '';

    const row = document.createElement('div');
    row.className = 'settings-row';
    row.dataset.key = key;
    row.draggable = true;
    if (accentStyle) row.style.cssText = accentStyle;
    row.innerHTML = `
      <span class="settings-row-drag" title="Drag to reorder">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <circle cx="8" cy="5" r="1.5"></circle><circle cx="8" cy="12" r="1.5"></circle><circle cx="8" cy="19" r="1.5"></circle>
          <circle cx="16" cy="5" r="1.5"></circle><circle cx="16" cy="12" r="1.5"></circle><circle cx="16" cy="19" r="1.5"></circle>
        </svg>
      </span>
      ${iconHtml}
      <span class="settings-row-label"></span>
      <label class="switch">
        <input type="checkbox" class="settings-row-visible">
        <span class="switch-track"></span>
      </label>
    `;
    row.querySelector('.settings-row-visible').checked = visibilityMap[key] !== false;
    row.querySelector('.settings-row-label').textContent = sectionLabels[key] || key;

    row.addEventListener('dragstart', (e) => {
      draggedRow = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      draggedRow = null;
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedRow || draggedRow === row) return;
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      listEl.insertBefore(draggedRow, before ? row : row.nextSibling);
    });

    listEl.appendChild(row);
  });

  listEl.addEventListener('dragover', (e) => e.preventDefault());
  listEl.addEventListener('drop', (e) => e.preventDefault());
}

function readSectionListRows(listEl) {
  const rows = listEl ? Array.from(listEl.querySelectorAll('.settings-row')) : [];
  const order = rows.map(r => r.dataset.key);
  const visibility = {};
  rows.forEach(r => { visibility[r.dataset.key] = r.querySelector('.settings-row-visible').checked; });
  return { order, visibility };
}

function renderSettingsForm(settings) {
  const sectionLabels = {};
  getSectionMeta('section-board').forEach(s => { sectionLabels[s.key] = s.label; });
  renderSectionListRows(document.getElementById('settings-section-list'), settings.sectionOrder, settings.sectionVisibility, sectionLabels);

  const seoLabels = {};
  getSectionMeta('seo-meta-board').forEach(s => { seoLabels[s.key] = s.label; });
  getSectionMeta('seo-performance-board').forEach(s => { seoLabels[s.key] = s.label; });
  renderSectionListRows(document.getElementById('settings-seo-meta-list'), settings.seoMetaOrder || [], settings.seoSectionVisibility || {}, seoLabels);
  renderSectionListRows(document.getElementById('settings-seo-performance-list'), settings.seoPerformanceOrder || [], settings.seoSectionVisibility || {}, seoLabels);

  const defaultSelect = document.getElementById('settings-default-section');
  if (defaultSelect) {
    defaultSelect.innerHTML = '<option value="">None</option>';
    settings.sectionOrder.forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = sectionLabels[key] || key;
      if (key === settings.defaultExpanded) opt.selected = true;
      defaultSelect.appendChild(opt);
    });
  }

  const maxItemsInput = document.getElementById('settings-max-items');
  if (maxItemsInput) maxItemsInput.value = settings.maxItemsPerGrid;

  const sectionGridToggle = document.getElementById('settings-section-grid-toggle');
  if (sectionGridToggle) sectionGridToggle.checked = (settings.sectionLayout || 'list') === 'grid';

  const modernLookToggle = document.getElementById('settings-modern-look-toggle');
  if (modernLookToggle) modernLookToggle.checked = settings.modernLook === true;

  const assetListToggle = document.getElementById('settings-asset-list-toggle');
  if (assetListToggle) assetListToggle.checked = (settings.assetLayout || 'grid') === 'list';

  const restoreSessionToggle = document.getElementById('settings-restore-session-toggle');
  if (restoreSessionToggle) restoreSessionToggle.checked = settings.restoreLastSession !== false;
}

function readSettingsForm() {
  const { order: sectionOrder, visibility: sectionVisibility } = readSectionListRows(document.getElementById('settings-section-list'));

  const metaList = readSectionListRows(document.getElementById('settings-seo-meta-list'));
  const perfList = readSectionListRows(document.getElementById('settings-seo-performance-list'));
  const seoSectionVisibility = { ...metaList.visibility, ...perfList.visibility };

  const defaultSelect = document.getElementById('settings-default-section');
  const maxItemsInput = document.getElementById('settings-max-items');
  const maxItems = maxItemsInput ? parseInt(maxItemsInput.value, 10) : DEFAULT_MAX_ITEMS_PER_GRID;

  const sectionGridToggle = document.getElementById('settings-section-grid-toggle');
  const modernLookToggle = document.getElementById('settings-modern-look-toggle');
  const assetListToggle = document.getElementById('settings-asset-list-toggle');
  const restoreSessionToggle = document.getElementById('settings-restore-session-toggle');

  return {
    version: SETTINGS_VERSION,
    sectionOrder,
    sectionVisibility,
    defaultExpanded: defaultSelect && defaultSelect.value ? defaultSelect.value : null,
    maxItemsPerGrid: (Number.isFinite(maxItems) && maxItems > 0) ? Math.min(maxItems, MAX_ITEMS_PER_GRID_LIMIT) : DEFAULT_MAX_ITEMS_PER_GRID,
    sectionLayout: (sectionGridToggle && sectionGridToggle.checked) ? 'grid' : 'list',
    assetLayout: (assetListToggle && assetListToggle.checked) ? 'list' : 'grid',
    restoreLastSession: !restoreSessionToggle || restoreSessionToggle.checked,
    seoMetaOrder: metaList.order,
    seoPerformanceOrder: perfList.order,
    seoSectionVisibility,
    modernLook: !!(modernLookToggle && modernLookToggle.checked)
  };
}

// settings save
function setupSettingsPanel() {
  const saveBtn = document.getElementById('settings-save-btn');
  const resetBtn = document.getElementById('settings-reset-btn');

  // These two toggles live outside the collapsible "Settings" section, so they
  // save themselves immediately instead of waiting on the Save Settings button.
  const restoreSessionToggle = document.getElementById('settings-restore-session-toggle');
  if (restoreSessionToggle) {
    restoreSessionToggle.addEventListener('change', () => {
      const settings = { ...(currentSettings || getDefaultSettings()), restoreLastSession: restoreSessionToggle.checked };
      currentSettings = settings;
      saveSettingsToStorage(settings);
    });
  }

  const sectionGridToggle = document.getElementById('settings-section-grid-toggle');
  if (sectionGridToggle) {
    sectionGridToggle.addEventListener('change', () => {
      const settings = { ...(currentSettings || getDefaultSettings()), sectionLayout: sectionGridToggle.checked ? 'grid' : 'list' };
      currentSettings = settings;
      setSectionLayoutMode(settings.sectionLayout);
      setBoardLayoutMode(document.getElementById('seo-meta-board'), settings.sectionLayout);
      setBoardLayoutMode(document.getElementById('seo-performance-board'), settings.sectionLayout);
      saveSettingsToStorage(settings);
    });
  }

  const modernLookToggle = document.getElementById('settings-modern-look-toggle');
  if (modernLookToggle) {
    modernLookToggle.addEventListener('change', () => {
      const settings = { ...(currentSettings || getDefaultSettings()), modernLook: modernLookToggle.checked };
      currentSettings = settings;
      applyModernLook(settings.modernLook);
      saveSettingsToStorage(settings);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const settings = getDefaultSettings();
      renderSettingsForm(settings);
      saveSettingsToStorage(settings, () => {
        currentSettings = settings;
        applySettings(settings);
        showToast('Settings reset to defaults');
        if (lastExtractedData) renderData(lastExtractedData, lastActiveTabId);
      });
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const settings = readSettingsForm();
      saveSettingsToStorage(settings, () => {
        currentSettings = settings;
        applySettings(settings);
        showToast('Settings saved');
        if (lastExtractedData) renderData(lastExtractedData, lastActiveTabId);
      });
    });
  }
}

function sendInspectMessage(tabId, action, onError) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { action }, () => {
    if (chrome.runtime.lastError) {
      if (onError) onError();
    }
  });
}

function openInspectOverlay() {
  if (!lastActiveTabId) {
    showToast('Scan a page first');
    return;
  }
  const inspectBtn = document.getElementById('inspect-btn');
  const overlay = document.getElementById('inspect-overlay');
  if (inspectBtn) inspectBtn.classList.add('active');
  if (overlay) overlay.classList.remove('hidden');

  const modeToggle = document.getElementById('inspect-mode-toggle');
  if (modeToggle) {
    modeToggle.querySelectorAll('.tag').forEach(b => b.classList.toggle('active', b.dataset.inspectMode === 'structure'));
  }
  setInspectPanelMode('structure');
}

function startInspectOnActiveTab() {
  if (!lastActiveTabId) {
    showToast('Scan a page first');
    return;
  }
  inspectModeActive = true;

  const overlay = document.getElementById('inspect-overlay');
  const emptyEl = document.getElementById('inspect-empty');
  const historyContainer = document.getElementById('inspect-history-container');
  if (overlay) overlay.classList.remove('hidden');

  sendInspectMessage(lastActiveTabId, 'start-inspect', () => {
    inspectModeActive = false;
    showToast('Could not start inspecting — try rescanning the page');
  });

  if (inspectedElementsHistory.length === 0) {
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (historyContainer) historyContainer.classList.add('hidden');
  } else {
    if (emptyEl) emptyEl.classList.add('hidden');
    if (historyContainer) historyContainer.classList.remove('hidden');
    renderInspectHistory();
  }
}

function stopInspectOnActiveTab() {
  if (inspectModeActive && lastActiveTabId) {
    sendInspectMessage(lastActiveTabId, 'stop-inspect');
  }
  inspectModeActive = false;
}

function closeInspectOverlay() {
  stopInspectOnActiveTab();
  sendTreeMessage('dom-tree-hover-clear', {}, () => { });
  const overlay = document.getElementById('inspect-overlay');
  const inspectBtn = document.getElementById('inspect-btn');
  if (overlay) overlay.classList.add('hidden');
  if (inspectBtn) inspectBtn.classList.remove('active');
}

function setInspectPanelMode(mode) {
  inspectPanelMode = mode;
  const structurePanel = document.getElementById('inspect-structure-panel');
  const clickPanel = document.getElementById('inspect-click-panel');
  if (mode === 'structure') {
    if (structurePanel) structurePanel.classList.remove('hidden');
    if (clickPanel) clickPanel.classList.add('hidden');
    if (inspectModeActive) stopInspectOnActiveTab();
    if (domTreeStale) {
      domTreeStale = false;
      ensureDomTreeLoaded();
    }
  } else {
    if (structurePanel) structurePanel.classList.add('hidden');
    if (clickPanel) clickPanel.classList.remove('hidden');
    sendTreeMessage('dom-tree-hover-clear', {}, () => { });
    if (!inspectModeActive) startInspectOnActiveTab();
  }
}

// dom tree
function sendTreeMessage(action, payload, callback) {
  if (!lastActiveTabId) { callback(null); return; }
  chrome.tabs.sendMessage(lastActiveTabId, Object.assign({ action }, payload), (response) => {
    if (chrome.runtime.lastError || !response) { callback(null); return; }
    callback(response);
  });
}

function ensureDomTreeLoaded() {
  const container = document.getElementById('dom-tree-container');
  if (!container) return;
  selectedTreeNodeId = null;
  renderTreeSelectedDetail(null);
  if (!lastActiveTabId) {
    container.innerHTML = '<div class="empty-state">Scan a page first</div>';
    return;
  }
  container.innerHTML = '<div class="empty-state">Loading page structure…</div>';
  sendTreeMessage('dom-tree-root', { mode: treeMode }, (response) => {
    if (!response || !response.success) {
      container.innerHTML = '<div class="empty-state">Could not load page structure — try rescanning the page</div>';
      return;
    }
    container.innerHTML = '';
    container.appendChild(createTreeNode(response.node, 0, true));
  });
}

function createTreeNode(nodeData, depth, autoExpand) {
  const wrapper = document.createElement('div');
  wrapper.className = 'dom-tree-node';

  const row = document.createElement('div');
  row.className = 'dom-tree-row';
  row.style.paddingLeft = (depth * 14 + 4) + 'px';

  const caret = document.createElement('span');
  caret.className = 'dom-tree-caret' + (nodeData.hasChildren ? '' : ' dom-tree-caret-empty');
  if (nodeData.hasChildren) {
    caret.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>';
  }
  row.appendChild(caret);
  row.appendChild(buildTreeNodeLabel(nodeData));

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'dom-tree-children hidden';

  let expanded = false;
  let loaded = false;

  const loadChildren = () => {
    loaded = true;
    childrenContainer.innerHTML = '<div class="dom-tree-loading">Loading…</div>';
    sendTreeMessage('dom-tree-children', { nodeId: nodeData.nodeId, mode: treeMode }, (response) => {
      childrenContainer.innerHTML = '';
      if (response && response.success && response.children.length) {
        response.children.forEach(child => childrenContainer.appendChild(createTreeNode(child, depth + 1, false)));
      } else {
        const none = document.createElement('div');
        none.className = 'dom-tree-empty-children';
        none.style.paddingLeft = ((depth + 1) * 14 + 4) + 'px';
        none.textContent = 'No child elements';
        childrenContainer.appendChild(none);
      }
    });
  };

  const toggleExpand = () => {
    if (!nodeData.hasChildren) return;
    expanded = !expanded;
    caret.classList.toggle('expanded', expanded);
    childrenContainer.classList.toggle('hidden', !expanded);
    if (expanded && !loaded) loadChildren();
  };

  caret.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand();
  });
  row.addEventListener('click', () => selectTreeNode(nodeData.nodeId, row));
  row.addEventListener('mouseenter', () => {
    if (lastHoveredTreeNodeId === nodeData.nodeId) return;
    lastHoveredTreeNodeId = nodeData.nodeId;
    sendTreeMessage('dom-tree-hover', { nodeId: nodeData.nodeId }, () => { });
  });
  row.addEventListener('mouseleave', () => {
    lastHoveredTreeNodeId = null;
    sendTreeMessage('dom-tree-hover-clear', {}, () => { });
  });

  wrapper.appendChild(row);
  wrapper.appendChild(childrenContainer);

  if (autoExpand && nodeData.hasChildren) toggleExpand();

  return wrapper;
}

function buildTreeNodeLabel(nodeData) {
  const label = document.createElement('span');
  label.className = 'dom-tree-label';

  const tagEl = document.createElement('span');
  tagEl.className = 'dom-tree-tag';
  tagEl.textContent = `<${nodeData.tag}>`;
  label.appendChild(tagEl);

  if (nodeData.idAttr) {
    const idEl = document.createElement('span');
    idEl.className = 'dom-tree-id';
    idEl.textContent = `#${nodeData.idAttr}`;
    label.appendChild(idEl);
  }
  if (nodeData.classAttr) {
    const clsEl = document.createElement('span');
    clsEl.className = 'dom-tree-class';
    clsEl.textContent = '.' + nodeData.classAttr.split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    clsEl.title = nodeData.classAttr;
    label.appendChild(clsEl);
  }
  if (nodeData.textPreview) {
    const textEl = document.createElement('span');
    textEl.className = 'dom-tree-text-preview';
    textEl.textContent = nodeData.textPreview;
    label.appendChild(textEl);
  }
  return label;
}

function selectTreeNode(nodeId, rowEl) {
  document.querySelectorAll('.dom-tree-row.selected').forEach(r => r.classList.remove('selected'));
  rowEl.classList.add('selected');
  selectedTreeNodeId = nodeId;
  sendTreeMessage('dom-tree-select', { nodeId }, (response) => {
    if (response && response.success) renderTreeSelectedDetail(response.info);
  });
}

function renderTreeSelectedDetail(info) {
  const container = document.getElementById('tree-selected-detail');
  if (!container) return;
  container.innerHTML = '';
  if (!info) return;
  const card = document.createElement('div');
  card.className = 'tree-detail-card';
  card.appendChild(buildElementDetailContent(info));
  container.appendChild(card);
}

function runTreeSearch(query) {
  const container = document.getElementById('dom-tree-container');
  if (!container) return;
  if (!query || !query.trim()) {
    ensureDomTreeLoaded();
    return;
  }
  container.innerHTML = '<div class="empty-state">Searching…</div>';
  sendTreeMessage('dom-tree-search', { query }, (response) => {
    container.innerHTML = '';
    if (!response || !response.success || !response.results.length) {
      container.innerHTML = '<div class="empty-state">No matching elements</div>';
      return;
    }
    response.results.forEach(result => {
      const wrapper = document.createElement('div');
      wrapper.className = 'dom-tree-search-result';

      const breadcrumb = document.createElement('div');
      breadcrumb.className = 'dom-tree-search-breadcrumb';
      breadcrumb.textContent = result.breadcrumb.length ? result.breadcrumb.map(a => a.tagName).join(' › ') : 'body';

      const row = document.createElement('div');
      row.className = 'dom-tree-row';
      row.style.paddingLeft = '4px';
      row.appendChild(buildTreeNodeLabel({ tag: result.tag, idAttr: result.idAttr, classAttr: result.classAttr, textPreview: null }));

      row.addEventListener('click', () => selectTreeNode(result.nodeId, row));
      row.addEventListener('mouseenter', () => {
        if (lastHoveredTreeNodeId === result.nodeId) return;
        lastHoveredTreeNodeId = result.nodeId;
        sendTreeMessage('dom-tree-hover', { nodeId: result.nodeId }, () => { });
      });
      row.addEventListener('mouseleave', () => {
        lastHoveredTreeNodeId = null;
        sendTreeMessage('dom-tree-hover-clear', {}, () => { });
      });

      wrapper.appendChild(breadcrumb);
      wrapper.appendChild(row);
      container.appendChild(wrapper);
    });
  });
}

function buildInspectSelector(info) {
  if (info.id) return `#${info.id}`;
  if (info.classes) {
    const firstClass = info.classes.split(/\s+/)[0];
    if (firstClass) return `${info.tagName}.${firstClass}`;
  }
  return info.tagName;
}

function buildCssSnippetFromInspectInfo(info) {
  const s = info.styles;
  const selector = buildInspectSelector(info);
  const lines = [
    `color: ${s.color};`,
    `background-color: ${s.backgroundColor};`,
    `font-family: ${s.fontFamily};`,
    `font-size: ${s.fontSize};`,
    `font-weight: ${s.fontWeight};`,
    `line-height: ${s.lineHeight};`,
    `letter-spacing: ${s.letterSpacing};`,
    `text-align: ${s.textAlign};`,
    `margin: ${s.margin};`,
    `padding: ${s.padding};`,
    `border: ${s.border};`,
    `border-radius: ${s.borderRadius};`,
    `box-shadow: ${s.boxShadow};`,
    `display: ${s.display};`,
    `position: ${s.position};`
  ];
  return `${selector} {\n  ${lines.join('\n  ')}\n}`;
}

const TAILWIND_FONT_WEIGHT_MAP = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
const TAILWIND_DISPLAY_MAP = { block: 'block', 'inline-block': 'inline-block', inline: 'inline', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', none: 'hidden' };
const TAILWIND_TEXT_ALIGN_MAP = { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify' };

function buildTailwindApproxFromInspectInfo(info) {
  const s = info.styles;
  const classes = [];
  if (TAILWIND_DISPLAY_MAP[s.display]) classes.push(TAILWIND_DISPLAY_MAP[s.display]);
  if (TAILWIND_TEXT_ALIGN_MAP[s.textAlign]) classes.push(TAILWIND_TEXT_ALIGN_MAP[s.textAlign]);
  const weightName = TAILWIND_FONT_WEIGHT_MAP[parseInt(s.fontWeight, 10)];
  if (weightName) classes.push(`font-${weightName}`);
  if (s.fontSize) classes.push(`text-[${s.fontSize}]`);
  if (s.color) classes.push(`text-[${s.color.replace(/\s+/g, '_')}]`);
  if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') {
    classes.push(`bg-[${s.backgroundColor.replace(/\s+/g, '_')}]`);
  }
  if (s.padding && s.padding !== '0px') classes.push(`p-[${s.padding.replace(/\s+/g, '_')}]`);
  if (s.margin && s.margin !== '0px') classes.push(`m-[${s.margin.replace(/\s+/g, '_')}]`);
  if (s.borderRadius && s.borderRadius !== '0px') classes.push(`rounded-[${s.borderRadius}]`);
  if (s.boxShadow && s.boxShadow !== 'none') classes.push(`shadow-[${s.boxShadow.replace(/\s+/g, '_')}]`);

  const selector = buildInspectSelector(info);
  return `<!-- Approximate Tailwind for ${selector} — a best-effort guess, verify against your config -->\n<div class="${classes.join(' ')}"></div>`;
}

function renderInspectResult(info) {
  const overlay = document.getElementById('inspect-overlay');
  const emptyEl = document.getElementById('inspect-empty');
  const historyContainer = document.getElementById('inspect-history-container');
  if (!overlay || !emptyEl || !historyContainer) return;

  inspectedElementsHistory.unshift(info);
  if (lastActiveTabId) {
    chrome.storage.local.set({ [`inspected_elements_${lastActiveTabId}`]: inspectedElementsHistory });
  }

  emptyEl.classList.add('hidden');
  historyContainer.classList.remove('hidden');
  overlay.classList.remove('hidden');

  renderInspectHistory();
}

function getHumanReadableName(info) {
  const t = info.tagName.toLowerCase();
  const c = (info.classes || '').toLowerCase();

  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(t)) return 'Heading';
  if (t === 'p') return 'Paragraph';
  if (t === 'a') return 'Link';
  if (t === 'img' || t === 'svg' || t === 'path') return 'Image / Icon';
  if (t === 'button') return 'Button';
  if (['ul', 'ol', 'li'].includes(t)) return 'List Item';
  if (t === 'span') return 'Text Span';
  if (['input', 'textarea', 'select'].includes(t)) return 'Input Field';
  if (t === 'nav' || c.includes('nav') || c.includes('menu')) return 'Navigation';
  if (t === 'header' || c.includes('header')) return 'Header';
  if (t === 'footer' || c.includes('footer')) return 'Footer';
  if (t === 'section') return 'Section';
  return 'Container Element';
}

// element detail
function buildBoxModelDiagram(boxModel) {
  const edgeSpan = (cls, value) => {
    const s = document.createElement('span');
    s.className = `box-model-edge ${cls}`;
    s.textContent = Math.round(value);
    return s;
  };
  const layer = (cls, label, box) => {
    const el = document.createElement('div');
    el.className = `box-model-layer ${cls}`;
    const tag = document.createElement('span');
    tag.className = 'box-model-tag';
    tag.textContent = label;
    el.appendChild(tag);
    el.appendChild(edgeSpan('top', box.top));
    el.appendChild(edgeSpan('right', box.right));
    el.appendChild(edgeSpan('bottom', box.bottom));
    el.appendChild(edgeSpan('left', box.left));
    return el;
  };

  const marginLayer = layer('box-model-margin', 'margin', boxModel.margin);
  const borderLayer = layer('box-model-border', 'border', boxModel.border);
  const paddingLayer = layer('box-model-padding', 'padding', boxModel.padding);
  const contentBox = document.createElement('div');
  contentBox.className = 'box-model-content';
  contentBox.textContent = `${boxModel.contentWidth} × ${boxModel.contentHeight}`;

  paddingLayer.appendChild(contentBox);
  borderLayer.appendChild(paddingLayer);
  marginLayer.appendChild(borderLayer);

  const wrap = document.createElement('div');
  wrap.className = 'box-model';
  wrap.appendChild(marginLayer);
  return wrap;
}

function buildElementDetailContent(info) {
  let selectorText = info.tagName;
  if (info.id) selectorText += `#${info.id}`;
  if (info.classes) selectorText += '.' + info.classes.split(/\s+/).filter(Boolean).join('.');

  const content = document.createElement('div');
  content.className = 'section-card-body-content';

  const tagLine = document.createElement('div');
  tagLine.className = 'inspect-tag-line';
  tagLine.textContent = selectorText;
  tagLine.title = 'Click to copy selector';
  tagLine.addEventListener('click', () => copyToClipboard(selectorText, 'Copied selector'));
  content.appendChild(tagLine);

  if (info.ancestors && info.ancestors.length) {
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'inspect-breadcrumb';
    const chain = info.ancestors.slice().reverse();
    chain.forEach((a, idx) => {
      const chip = document.createElement('span');
      chip.className = 'inspect-breadcrumb-chip';
      let label = a.tagName;
      if (a.id) label += `#${a.id}`;
      else if (a.classes) label += '.' + a.classes.split(/\s+/).filter(Boolean)[0];
      chip.textContent = label;
      chip.title = label;
      breadcrumb.appendChild(chip);
      if (idx < chain.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'inspect-breadcrumb-sep';
        sep.textContent = '›';
        breadcrumb.appendChild(sep);
      }
    });
    content.appendChild(breadcrumb);
  }

  const buildDetailsSection = (title, bodyEl, openByDefault) => {
    const details = document.createElement('details');
    details.className = 'inspect-details';
    if (openByDefault) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'inspect-details-body';
    body.appendChild(bodyEl);
    details.appendChild(body);
    return details;
  };

  const buildKeyValueList = (rows) => {
    const list = document.createElement('div');
    rows.forEach(([label, value]) => {
      const div = document.createElement('div');
      div.className = 'meta-item';
      div.innerHTML = `<div class="meta-label">${label}</div><div class="meta-value"></div>`;
      div.querySelector('.meta-value').textContent = value;
      list.appendChild(div);
    });
    return list;
  };

  if (info.boxModel) {
    content.appendChild(buildDetailsSection(
      `Box Model — ${info.boxModel.width} × ${info.boxModel.height}`,
      buildBoxModelDiagram(info.boxModel),
      true
    ));
  }

  if (info.attributes && info.attributes.length) {
    const attrsList = document.createElement('div');
    attrsList.className = 'outline-container';
    info.attributes.forEach(a => {
      const row = document.createElement('div');
      row.className = 'inspect-rule-row';
      const name = document.createElement('span');
      name.className = 'inspect-rule-selector';
      name.textContent = a.name;
      name.title = a.name;
      const value = document.createElement('span');
      value.className = 'inspect-rule-specificity';
      const displayValue = a.value || '(empty)';
      value.textContent = displayValue.length > 40 ? displayValue.slice(0, 40) + '…' : displayValue;
      value.title = a.value;
      row.appendChild(name);
      row.appendChild(value);
      attrsList.appendChild(row);
    });
    content.appendChild(buildDetailsSection(`Attributes (${info.attributes.length})`, attrsList, true));
  }

  if (info.styleCategories && info.styleCategories.length) {
    info.styleCategories.forEach((cat, idx) => {
      const rows = cat.items.map(([label, value]) => [label, value]);
      content.appendChild(buildDetailsSection(cat.name, buildKeyValueList(rows), idx === 0));
    });
  } else {
    const rows = [
      ['Color', info.styles.color],
      ['Background', info.styles.backgroundColor],
      ['Font', info.styles.fontFamily],
      ['Font Size', info.styles.fontSize],
      ['Font Weight', info.styles.fontWeight],
      ['Line Height', info.styles.lineHeight],
      ['Letter Spacing', info.styles.letterSpacing],
      ['Text Align', info.styles.textAlign],
      ['Margin', info.styles.margin],
      ['Padding', info.styles.padding],
      ['Border', info.styles.border],
      ['Border Radius', info.styles.borderRadius],
      ['Box Shadow', info.styles.boxShadow],
      ['Display', info.styles.display],
      ['Position', info.styles.position]
    ];
    content.appendChild(buildDetailsSection('Computed Styles', buildKeyValueList(rows), true));
  }

  if (info.matchedRules && info.matchedRules.length) {
    const rulesList = document.createElement('div');
    rulesList.className = 'outline-container';
    info.matchedRules.forEach(r => {
      const row = document.createElement('div');
      row.className = 'inspect-rule-row';
      const sel = document.createElement('span');
      sel.className = 'inspect-rule-selector';
      sel.textContent = r.selector;
      sel.title = r.selector;
      const spec = document.createElement('span');
      spec.className = 'inspect-rule-specificity';
      spec.textContent = r.specificity.join(',');
      spec.title = 'Specificity (ids, classes, tags)';
      row.appendChild(sel);
      row.appendChild(spec);
      rulesList.appendChild(row);
    });
    content.appendChild(buildDetailsSection(`Matched CSS Rules (${info.matchedRules.length})`, rulesList, false));
  }

  const copySection = document.createElement('div');
  copySection.style.marginTop = '12px';
  copySection.style.display = 'flex';
  copySection.style.alignItems = 'center';
  copySection.style.justifyContent = 'space-between';
  copySection.style.gap = '8px';

  const segmented = document.createElement('div');
  segmented.className = 'segmented';
  segmented.style.marginBottom = '0';
  segmented.innerHTML = `
    <button class="tag active" data-copy-format="css">CSS</button>
    <button class="tag" data-copy-format="tailwind">Tailwind</button>
  `;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'mini-action';
  copyBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 12px; height: 12px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    Copy Code
  `;

  let currentFormat = 'css';
  segmented.querySelectorAll('.tag').forEach(btn => {
    btn.addEventListener('click', () => {
      segmented.querySelectorAll('.tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFormat = btn.dataset.copyFormat;
    });
  });

  copyBtn.addEventListener('click', () => {
    const code = currentFormat === 'tailwind'
      ? buildTailwindApproxFromInspectInfo(info)
      : buildCssSnippetFromInspectInfo(info);
    copyToClipboard(code, 'Copied to clipboard');
  });

  copySection.appendChild(segmented);
  copySection.appendChild(copyBtn);

  content.appendChild(copySection);

  return content;
}

function renderInspectHistory() {
  const board = document.getElementById('inspect-history-board');
  if (!board) return;
  board.innerHTML = '';

  inspectedElementsHistory.forEach((info, index) => {
    let selectorText = info.tagName;
    if (info.id) selectorText += `#${info.id}`;
    if (info.classes) selectorText += '.' + info.classes.split(/\s+/).filter(Boolean).join('.');

    let readableName = getHumanReadableName(info);

    const card = document.createElement('div');
    card.className = 'section-card';
    if (index === 0) card.classList.add('expanded');
    else card.classList.add('dimmed');

    card.style.setProperty('--tile-accent', 'var(--c-outline)');

    const header = document.createElement('button');
    header.className = 'section-card-header';
    header.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 2px;">
        <span class="tile-label" style="font-weight: 600;"></span>
        <span class="inspect-selector-text" style="font-family: 'SFMono-Regular', Consolas, monospace; font-size: 10px; color: var(--text-tertiary); max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>
      </div>
      <span class="tile-count"></span>
      <svg class="card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    header.querySelector('.tile-label').textContent = readableName;
    const selectorEl = header.querySelector('.inspect-selector-text');
    selectorEl.textContent = selectorText;
    selectorEl.title = selectorText;
    header.querySelector('.tile-count').textContent = `${info.rect.width}×${info.rect.height}`;

    const body = document.createElement('div');
    body.className = 'section-card-body';

    const inner = document.createElement('div');
    inner.className = 'section-card-body-inner';

    const content = buildElementDetailContent(info);

    inner.appendChild(content);
    body.appendChild(inner);
    card.appendChild(header);
    card.appendChild(body);
    board.appendChild(card);

    body.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'height' && card.classList.contains('expanded')) {
        body.style.height = 'auto';
      }
    });
    content.querySelectorAll('.inspect-details').forEach(details => {
      details.addEventListener('toggle', () => {
        if (card.classList.contains('expanded') && body.style.height !== 'auto') {
          expandCardBody(card);
        }
      });
    });

    header.addEventListener('click', () => {
      const wasExpanded = card.classList.contains('expanded');

      Array.from(board.querySelectorAll('.section-card')).forEach(c => {
        if (c !== card && c.classList.contains('expanded')) {
          collapseCardBody(c);
        }
        c.classList.remove('expanded', 'dimmed');
      });

      if (!wasExpanded) {
        card.classList.add('expanded');
        expandCardBody(card);
        Array.from(board.querySelectorAll('.section-card')).forEach(c => { if (c !== card) c.classList.add('dimmed'); });
      } else {
        collapseCardBody(card);
      }
    });

    if (index === 0) {
      setTimeout(() => expandCardBody(card), 10);
    }
  });
}

function setupInspectPanel() {
  const inspectBtn = document.getElementById('inspect-btn');
  const overlay = document.getElementById('inspect-overlay');
  const backBtn = document.getElementById('inspect-back-btn');
  const startBtn = document.getElementById('inspect-start-btn');
  const againBtn = document.getElementById('inspect-again-btn');
  const clearBtn = document.getElementById('inspect-clear-btn');
  const confirmOverlay = document.getElementById('clear-confirm-overlay');
  const confirmBtn = document.getElementById('clear-confirm-btn');
  const cancelBtn = document.getElementById('clear-cancel-btn');

  if (!inspectBtn || !overlay) return;

  inspectBtn.addEventListener('click', () => {
    if (!overlay.classList.contains('hidden')) {
      closeInspectOverlay();
    } else {
      openInspectOverlay();
    }
  });

  const inspectModeToggle = document.getElementById('inspect-mode-toggle');
  if (inspectModeToggle) {
    inspectModeToggle.querySelectorAll('.tag').forEach(btn => {
      btn.addEventListener('click', () => {
        inspectModeToggle.querySelectorAll('.tag').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setInspectPanelMode(btn.dataset.inspectMode);
      });
    });
  }

  const treeDepthToggle = document.getElementById('tree-depth-toggle');
  if (treeDepthToggle) {
    treeDepthToggle.querySelectorAll('.tag').forEach(btn => {
      btn.addEventListener('click', () => {
        treeDepthToggle.querySelectorAll('.tag').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        treeMode = btn.dataset.treeMode;
        const searchInput = document.getElementById('tree-search-input');
        if (searchInput) searchInput.value = '';
        ensureDomTreeLoaded();
      });
    });
  }

  const treeSearchInput = document.getElementById('tree-search-input');
  if (treeSearchInput) {
    const debouncedRunTreeSearch = debounce(runTreeSearch, 150);
    treeSearchInput.addEventListener('input', (e) => debouncedRunTreeSearch(e.target.value));
  }

  if (backBtn) backBtn.addEventListener('click', () => closeInspectOverlay());
  if (startBtn) startBtn.addEventListener('click', () => startInspectOnActiveTab());

  if (againBtn) {
    againBtn.addEventListener('click', () => {
      startInspectOnActiveTab();
    });
  }

  if (clearBtn && confirmOverlay) {
    clearBtn.addEventListener('click', () => {
      confirmOverlay.classList.remove('hidden');
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      confirmOverlay.classList.add('hidden');
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      inspectedElementsHistory = [];
      if (lastActiveTabId) {
        chrome.storage.local.set({ [`inspected_elements_${lastActiveTabId}`]: inspectedElementsHistory });
      }
      const historyContainer = document.getElementById('inspect-history-container');
      const emptyEl = document.getElementById('inspect-empty');
      if (historyContainer) historyContainer.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      confirmOverlay.classList.add('hidden');
    });
  }
}

// color palette
function identifyPrimaryBrandColor(data) {
  const candidates = [...(data.colors || []), ...(data.bgColors || [])];
  let best = null, bestScore = -1;
  candidates.forEach(c => {
    const hsl = hexToHsl(c.hex);
    if (!hsl) return;
    if (hsl.s < 15 || hsl.l < 8 || hsl.l > 92) return;
    if (hsl.s > bestScore) { bestScore = hsl.s; best = c.hex; }
  });
  return best || (candidates[0] && candidates[0].hex) || '#EA580C';
}

function generateMonochromaticPalette(baseHsl) {
  return [20, 35, 50, 65, 80].map(l => hslToHex(baseHsl.h, baseHsl.s, l));
}

function generateAnalogousPalette(baseHsl) {
  return [-40, -20, 0, 20, 40].map(offset => hslToHex(baseHsl.h + offset, baseHsl.s, baseHsl.l));
}

function generateTriadicPalette(baseHsl) {
  return [
    hslToHex(baseHsl.h, baseHsl.s, Math.max(20, baseHsl.l - 15)),
    hslToHex(baseHsl.h, baseHsl.s, baseHsl.l),
    hslToHex(baseHsl.h + 120, baseHsl.s, baseHsl.l),
    hslToHex(baseHsl.h + 240, baseHsl.s, baseHsl.l),
    hslToHex(baseHsl.h, Math.max(10, baseHsl.s - 30), Math.min(90, baseHsl.l + 20))
  ];
}

function buildPaletteMapping(data, newPalette) {
  const oldColors = [...new Set([...(data.colors || []).map(c => c.hex), ...(data.bgColors || []).map(c => c.hex)])];
  if (!oldColors.length) return {};
  const sortedOld = [...oldColors].sort((a, b) => hexToHsl(a).l - hexToHsl(b).l);
  const sortedNew = [...newPalette].sort((a, b) => hexToHsl(a).l - hexToHsl(b).l);
  const mapping = {};
  sortedOld.forEach((hex, i) => {
    const newIdx = Math.min(sortedNew.length - 1, Math.floor((i / sortedOld.length) * sortedNew.length));
    mapping[hex] = sortedNew[newIdx];
  });
  return mapping;
}

function buildPaletteSwatchesHtml(palette) {
  return palette.map(hex => `<span class="palette-swatch" style="background:${hex};" data-hex="${hex}" title="Click to copy ${hex}"></span>`).join('');
}

function renderColorPaletteGenerator(data, tabId) {
  const container = document.getElementById('palette-generator');
  if (!container) return;

  const brandColor = identifyPrimaryBrandColor(data);
  const baseHsl = hexToHsl(brandColor);

  const palettes = [
    { key: 'analogous', label: 'Analogous', colors: generateAnalogousPalette(baseHsl) },
    { key: 'monochromatic', label: 'Monochromatic', colors: generateMonochromaticPalette(baseHsl) },
    { key: 'triadic', label: 'Triadic', colors: generateTriadicPalette(baseHsl) }
  ];

  container.innerHTML = `
    <div class="palette-brand-row">
      <span class="palette-swatch palette-swatch-lg" style="background:${brandColor};" data-hex="${brandColor}" title="Click to copy ${brandColor}"></span>
      <div class="palette-brand-text">
        <div class="palette-brand-label">Primary Brand Color</div>
        <div class="palette-brand-hex">${brandColor}</div>
      </div>
    </div>
    ${palettes.map(p => `
      <div class="palette-row" data-palette-key="${p.key}">
        <div class="palette-row-header">
          <span class="palette-row-label">${escapeHtml(p.label)}</span>
          <button class="mini-action palette-apply-btn" data-palette-key="${p.key}" type="button">Preview</button>
        </div>
        <div class="palette-swatches">${buildPaletteSwatchesHtml(p.colors)}</div>
      </div>
    `).join('')}
    <div class="palette-reset-row">
      <button class="mini-action hidden" id="palette-reset-btn" type="button">Reset Live Preview</button>
    </div>
  `;

  container.querySelectorAll('.palette-swatch[data-hex]').forEach(sw => {
    sw.addEventListener('click', () => copyToClipboard(sw.dataset.hex, `Copied ${sw.dataset.hex}`));
  });

  const resetBtn = document.getElementById('palette-reset-btn');
  const setActivePalette = (key) => {
    activePaletteKey = key || null;
    container.querySelectorAll('.palette-apply-btn').forEach(btn => {
      const isActive = !!key && btn.dataset.paletteKey === key;
      btn.classList.toggle('active', isActive);
      btn.textContent = isActive ? 'Applied ✓' : 'Preview';
    });
    if (resetBtn) resetBtn.classList.toggle('hidden', !key);
  };
  setActivePalette(activePaletteKey);

  container.querySelectorAll('.palette-apply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!tabId) { showToast('No active tab to preview on'); return; }
      const key = btn.dataset.paletteKey;

      if (btn.classList.contains('active')) {
        chrome.tabs.sendMessage(tabId, { action: 'reset-palette-preview' }, () => {
          if (chrome.runtime.lastError) {
            showToast('Could not reset the live preview on this page');
            return;
          }
          setActivePalette(null);
          showToast('Live palette preview reset');
        });
        return;
      }

      const palette = palettes.find(p => p.key === key);
      const mapping = buildPaletteMapping(data, palette.colors);
      if (!Object.keys(mapping).length) {
        showToast('Not enough color data on this page to preview a palette');
        return;
      }
      chrome.tabs.sendMessage(tabId, { action: 'preview-palette', mapping }, (response) => {
        if (chrome.runtime.lastError) {
          showToast('Could not preview this palette on the page');
          return;
        }
        setActivePalette(key);
        showToast(`Previewing ${palette.label} palette on the live page (${(response && response.count) || 0} elements)`);
      });
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!tabId) return;
      chrome.tabs.sendMessage(tabId, { action: 'reset-palette-preview' }, () => {
        if (chrome.runtime.lastError) {
          showToast('Could not reset the live preview on this page');
          return;
        }
        setActivePalette(null);
        showToast('Live palette preview reset');
      });
    });
  }
}

function renderAllColorGrids(data, tabId) {
  ['color-palette', 'bg-palette', 'hover-palette'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  renderColors('color-palette', data.colors, tabId);
  renderColors('bg-palette', data.bgColors, tabId);

  const allHoverColors = [...(data.hoverColors || []), ...(data.hoverBgColors || [])];
  const uniqueHoverColors = [];
  const seenHoverColorHexes = new Set();
  allHoverColors.forEach(c => {
    if (!seenHoverColorHexes.has(c.hex)) {
      seenHoverColorHexes.add(c.hex);
      uniqueHoverColors.push(c);
    }
  });
  renderColors('hover-palette', uniqueHoverColors, tabId, 'hoverColor');
}

function renderContrastResults(data) {
  const container = document.getElementById('contrast-results');
  if (!container) return;
  container.classList.remove('hidden');

  const textColors = (data.colors || []).slice(0, 8);
  const bgColors = (data.bgColors || []).slice(0, 6);

  if (!textColors.length || !bgColors.length) {
    container.innerHTML = '<div class="empty-state">Not enough color data to check contrast.</div>';
    return;
  }

  const pairs = [];
  textColors.forEach(t => {
    bgColors.forEach(bg => {
      if (t.hex === bg.hex) return;
      const ratio = contrastRatio(t.hex, bg.hex);
      pairs.push({ text: t.hex, bg: bg.hex, ratio });
    });
  });

  pairs.sort((a, b) => a.ratio - b.ratio);

  const failing = pairs.filter(p => p.ratio < 4.5);
  const passing = pairs.length - failing.length;
  lastContrastResult = { pairs, failing, passing };

  container.innerHTML = '';
  const summary = document.createElement('div');
  summary.className = 'outline-item';
  summary.innerHTML = `<strong>${passing} / ${pairs.length}</strong> pairs pass WCAG AA (4.5:1) for normal text.`;
  container.appendChild(summary);

  const shown = failing.length ? failing.slice(0, 10) : pairs.slice(0, 5);
  shown.forEach(p => {
    const row = document.createElement('div');
    row.className = 'outline-item';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    const passesAA = p.ratio >= 4.5;
    const passesAAA = p.ratio >= 7;
    const badgeColor = passesAAA ? 'var(--success)' : passesAA ? 'var(--success)' : 'var(--danger)';
    const badgeText = passesAAA ? 'AAA' : passesAA ? 'AA' : 'Fail';
    row.innerHTML = `
      <span style="display:inline-block; width:16px; height:16px; border-radius:4px; background:${p.text}; border:1px solid rgba(127,127,127,0.3); flex-shrink:0;"></span>
      <span style="display:inline-block; width:16px; height:16px; border-radius:4px; background:${p.bg}; border:1px solid rgba(127,127,127,0.3); flex-shrink:0;"></span>
      <span style="flex:1; font-size:12px; color: var(--text-secondary);">${p.text} on ${p.bg}</span>
      <span style="font-size:11px; font-weight:700; color:${badgeColor};">${badgeText} (${p.ratio.toFixed(2)}:1)</span>
    `;
    container.appendChild(row);
  });
}

function renderBrokenImagesList() {
  const el = document.getElementById('broken-images-list');
  const titleEl = document.getElementById('broken-images-title');
  if (!el) return;
  if (brokenImageUrls.length) {
    if (titleEl) titleEl.classList.remove('hidden');
    el.classList.remove('hidden');
    el.innerHTML = '';
    const summary = document.createElement('div');
    summary.className = 'outline-item';
    summary.innerHTML = `<strong>${brokenImageUrls.length}</strong> broken image${brokenImageUrls.length === 1 ? '' : 's'} detected`;
    el.appendChild(summary);
    brokenImageUrls.slice(0, 20).forEach(url => {
      const div = document.createElement('div');
      div.className = 'outline-item';
      div.style.fontSize = '11px';
      div.style.color = 'var(--text-secondary)';
      div.style.whiteSpace = 'nowrap';
      div.style.overflow = 'hidden';
      div.style.textOverflow = 'ellipsis';
      div.textContent = url;
      div.title = url;
      el.appendChild(div);
    });
  } else {
    if (titleEl) titleEl.classList.add('hidden');
    el.classList.add('hidden');
  }
}

function renderColors(containerId, colorsArray, tabId, highlightType = 'color') {
  const container = document.getElementById(containerId);
  const maxItems = (currentSettings && currentSettings.maxItemsPerGrid) || DEFAULT_MAX_ITEMS_PER_GRID;
  if (colorsArray && colorsArray.length) {
    colorsArray.slice(0, maxItems).forEach(colorObj => {
      const wrapper = document.createElement('div');
      wrapper.className = 'color-swatch-container';

      const displayHex = simulateColorblind(colorObj.hex, colorblindMode);

      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = displayHex;
      swatch.title = `Click to copy HEX & highlight on page\n${colorObj.hex}`;

      swatch.addEventListener('click', () => {
        copyToClipboard(colorObj.hex, `Copied ${colorObj.hex}`);
        sendHighlightMessage(tabId, highlightType, colorObj.raw);
      });

      const label = document.createElement('div');
      label.className = 'color-hex';
      label.textContent = colorObj.hex;

      wrapper.appendChild(swatch);
      wrapper.appendChild(label);
      container.appendChild(wrapper);
    });
  } else {
    container.innerHTML = '<div class="empty-state">No colors detected</div>';
  }
}

function renderPickedColors(colorsArray, tabId) {
  const container = document.getElementById('picked-palette');
  if (!container) return;

  if (colorsArray && colorsArray.length) {
    container.classList.remove('hidden');
    container.innerHTML = '';
    colorsArray.forEach(hex => {
      const wrapper = document.createElement('div');
      wrapper.className = 'color-swatch-container';

      const swatch = document.createElement('div');
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = hex;
      swatch.title = `Click to copy HEX\n${hex}`;

      swatch.addEventListener('click', () => copyToClipboard(hex, `Copied ${hex}`));

      const label = document.createElement('div');
      label.className = 'color-hex';
      label.textContent = hex;

      wrapper.appendChild(swatch);
      wrapper.appendChild(label);
      container.appendChild(wrapper);
    });
  } else {
    container.classList.add('hidden');
    container.innerHTML = '';
  }
}

const JSON_TREE_MAX_DEPTH = 40;

function renderJsonTreeNode(key, value, depth) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object' && !isArray;

  if ((isObject || isArray) && depth >= JSON_TREE_MAX_DEPTH) {
    const line = document.createElement('div');
    line.className = 'json-tree-row json-tree-leaf';
    if (key !== null) {
      const keyEl = document.createElement('span');
      keyEl.className = 'json-tree-key';
      keyEl.textContent = key;
      line.appendChild(keyEl);
    }
    const valEl = document.createElement('span');
    valEl.className = 'json-tree-value type-string';
    valEl.textContent = '(too deeply nested to display)';
    line.appendChild(valEl);
    return line;
  }

  if (isObject || isArray) {
    const wrap = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'json-tree-row json-tree-parent';

    const toggle = document.createElement('span');
    toggle.className = 'json-tree-toggle';
    toggle.textContent = '▾';
    header.appendChild(toggle);

    if (key !== null) {
      const keyEl = document.createElement('span');
      keyEl.className = 'json-tree-key';
      keyEl.textContent = key;
      header.appendChild(keyEl);
    }

    const summary = document.createElement('span');
    summary.className = 'json-tree-summary';
    if (isArray) {
      summary.textContent = `[${value.length} item${value.length === 1 ? '' : 's'}]`;
    } else {
      const typeVal = value['@type'];
      summary.textContent = typeVal ? `{${Array.isArray(typeVal) ? typeVal.join(', ') : typeVal}}` : '{…}';
    }
    header.appendChild(summary);

    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'json-tree-children';
    const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
    entries.forEach(([k, v]) => childrenWrap.appendChild(renderJsonTreeNode(String(k), v, depth + 1)));

    header.addEventListener('click', () => {
      const collapsed = childrenWrap.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▸' : '▾';
    });

    wrap.appendChild(header);
    wrap.appendChild(childrenWrap);
    return wrap;
  }

  const line = document.createElement('div');
  line.className = 'json-tree-row json-tree-leaf';
  if (key !== null) {
    const keyEl = document.createElement('span');
    keyEl.className = 'json-tree-key';
    keyEl.textContent = key;
    line.appendChild(keyEl);
  }
  const valEl = document.createElement('span');
  const t = value === null ? 'null' : typeof value;
  valEl.className = `json-tree-value type-${t}`;
  valEl.textContent = value === null ? 'null' : (t === 'string' ? `"${value}"` : String(value));
  line.appendChild(valEl);
  return line;
}

function renderStructuredData(data) {
  const sd = data.structuredData || { blocks: [], types: [] };
  setSectionCount('structured-data', sd.blocks.length);

  const typesEl = document.getElementById('structured-data-types');
  if (typesEl) {
    typesEl.innerHTML = '';
    if (sd.types.length) {
      sd.types.forEach(t => {
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.textContent = t;
        typesEl.appendChild(tag);
      });
    } else {
      typesEl.innerHTML = '<div class="empty-state">No schema.org types detected</div>';
    }
  }

  const treeEl = document.getElementById('structured-data-tree');
  if (treeEl) {
    treeEl.innerHTML = '';
    if (sd.blocks.length) {
      sd.blocks.forEach(block => {
        const card = document.createElement('div');
        card.className = 'json-tree-card';
        if (block.error) {
          card.innerHTML = '<div class="empty-state">Could not parse this block as JSON</div>';
        } else {
          card.appendChild(renderJsonTreeNode(null, block.parsed, 0));
        }
        treeEl.appendChild(card);
      });
    } else {
      treeEl.innerHTML = '<div class="empty-state">No JSON-LD structured data found on this page</div>';
    }
  }

  const blocksEl = document.getElementById('structured-data-blocks');
  if (blocksEl) {
    blocksEl.innerHTML = '';
    if (sd.blocks.length) {
      sd.blocks.forEach(block => {
        const wrap = document.createElement('div');
        wrap.className = 'json-block' + (block.error ? ' has-error' : '');
        const pre = document.createElement('pre');
        pre.textContent = block.error
          ? `Could not parse this block as JSON:\n${block.raw}`
          : JSON.stringify(block.parsed, null, 2);
        wrap.appendChild(pre);
        blocksEl.appendChild(wrap);
      });
    } else {
      blocksEl.innerHTML = '<div class="empty-state">No JSON-LD structured data found on this page</div>';
    }
  }

  const viewToggle = document.getElementById('structured-data-view-toggle');
  if (viewToggle) {
    viewToggle.querySelectorAll('.tag').forEach(btn => {
      btn.onclick = () => {
        viewToggle.querySelectorAll('.tag').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const showTree = btn.dataset.view === 'tree';
        if (treeEl) treeEl.classList.toggle('hidden', !showTree);
        if (blocksEl) blocksEl.classList.toggle('hidden', showTree);
      };
    });
  }

  const copyBtn = document.getElementById('copy-structured-data-btn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      if (!sd.blocks.length) return;
      const combined = sd.blocks.map(b => b.error ? b.raw : JSON.stringify(b.parsed, null, 2)).join('\n\n');
      copyToClipboard(combined, `Copied ${sd.blocks.length} structured data block${sd.blocks.length === 1 ? '' : 's'}`);
    };
  }
}

function computeHeadingIssues(outline) {
  const issues = [];
  if (!outline || !outline.length) return issues;

  let prevLevel = 0;
  outline.forEach((h, i) => {
    const level = parseInt(h.tag.replace('h', ''), 10) || 1;
    if (i === 0 && level !== 1) {
      issues.push(`Page does not start with an H1 (starts with ${h.tag.toUpperCase()}).`);
    }
    if (prevLevel && level > prevLevel + 1) {
      issues.push(`Heading level skips from H${prevLevel} to H${level} at "${h.text.slice(0, 40)}".`);
    }
    prevLevel = level;
  });

  const h1Count = outline.filter(h => h.tag === 'h1').length;
  if (h1Count === 0) issues.unshift('No H1 heading found on this page.');
  else if (h1Count > 1) issues.unshift(`Multiple H1 headings found (${h1Count}).`);

  return issues;
}

// accessibility score
function computeA11yScore(data) {
  const a11y = data.accessibility || {};
  const landmarks = a11y.landmarks || {};
  const headingIssues = computeHeadingIssues(data.outline);

  const checks = [
    { label: 'All images have alt text', pass: (a11y.imagesMissingAltCount || 0) === 0 },
    { label: 'All form fields have labels', pass: (a11y.formFieldsMissingLabelCount || 0) === 0 },
    { label: 'Language attribute declared', pass: !a11y.langMissing },
    { label: 'Header landmark present', pass: !!landmarks.header },
    { label: 'Navigation landmark present', pass: !!landmarks.nav },
    { label: 'Main landmark present', pass: !!landmarks.main },
    { label: 'Footer landmark present', pass: !!landmarks.footer },
    { label: 'No heading hierarchy issues', pass: headingIssues.length === 0 }
  ];

  const passCount = checks.filter(c => c.pass).length;
  const score = Math.round((passCount / checks.length) * 100);
  return { checks, score, passCount };
}

function renderMediaContact(data) {
  const contact = data.mediaContact || {
    name: null, organization: null, jobTitle: null,
    emails: [], phones: [], addresses: [], location: null, geoPosition: null, socialLinks: []
  };

  const totalItems = contact.emails.length + contact.phones.length + contact.addresses.length +
    contact.socialLinks.length + (contact.name ? 1 : 0);
  setSectionCount('media-contact', totalItems);

  const infoEl = document.getElementById('media-contact-info');
  if (infoEl) {
    infoEl.innerHTML = '';

    const createContactItem = (label, value) => {
      const div = document.createElement('div');
      div.className = 'meta-item';
      div.innerHTML = `<div class="meta-label">${label}</div><div class="meta-value"></div>`;
      div.querySelector('.meta-value').textContent = value;
      return div;
    };

    const rows = [
      { label: 'Name', value: contact.name },
      { label: 'Organization', value: contact.organization },
      { label: 'Job Title', value: contact.jobTitle },
      { label: 'Email', value: contact.emails.join(', ') },
      { label: 'Phone', value: contact.phones.join(', ') },
      { label: 'Location', value: contact.location },
      { label: 'Address', value: contact.addresses.map(a => a.formatted).join(' | ') }
    ];
    rows.forEach(row => {
      if (row.value) infoEl.appendChild(createContactItem(row.label, row.value));
    });

    if (!infoEl.childNodes.length) {
      infoEl.innerHTML = '<div class="empty-state">No contact details detected on this page.</div>';
    }
  }

  const socialListEl = document.getElementById('media-contact-social-list');
  if (socialListEl) {
    socialListEl.innerHTML = '';
    if (!contact.socialLinks.length) {
      socialListEl.innerHTML = '<li class="empty-state" style="cursor: default;">No social links detected</li>';
    } else {
      contact.socialLinks.forEach(link => {
        const li = document.createElement('li');
        li.style.flexDirection = 'column';
        li.style.alignItems = 'flex-start';
        li.style.gap = '2px';

        const platformSpan = document.createElement('span');
        platformSpan.textContent = link.platform;
        platformSpan.style.fontWeight = '600';

        const urlSpan = document.createElement('span');
        urlSpan.textContent = link.url;
        urlSpan.style.fontSize = '0.7rem';
        urlSpan.style.color = 'var(--text-secondary)';
        urlSpan.style.wordBreak = 'break-all';

        li.appendChild(platformSpan);
        li.appendChild(urlSpan);
        li.addEventListener('click', () => window.open(link.url, '_blank'));
        socialListEl.appendChild(li);
      });
    }
  }
}

function renderAccessibilityAudit(data) {
  const a11y = data.accessibility || {
    imagesMissingAlt: [], imagesMissingAltCount: 0,
    formFieldsMissingLabel: [], formFieldsMissingLabelCount: 0,
    landmarks: {}, focusableCount: 0, langMissing: false
  };

  const totalIssues = a11y.imagesMissingAltCount + a11y.formFieldsMissingLabelCount +
    (a11y.langMissing ? 1 : 0) + computeHeadingIssues(data.outline).length;
  setSectionCount('accessibility', totalIssues);

  const overviewEl = document.getElementById('a11y-overview');
  if (overviewEl) {
    overviewEl.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'grid-2-col';

    const landmarkNames = { header: 'Header', nav: 'Navigation', main: 'Main', footer: 'Footer' };
    Object.keys(landmarkNames).forEach(key => {
      const present = !!(a11y.landmarks && a11y.landmarks[key]);
      const div = document.createElement('div');
      div.className = 'meta-item';
      const color = present ? 'var(--success)' : 'var(--danger)';
      div.innerHTML = `<div class="meta-label">${landmarkNames[key]}</div><div class="meta-value" style="color: ${color};"></div>`;
      div.querySelector('.meta-value').textContent = present ? 'Present' : 'Missing';
      grid.appendChild(div);
    });

    const langDiv = document.createElement('div');
    langDiv.className = 'meta-item';
    const langColor = a11y.langMissing ? 'var(--danger)' : 'var(--success)';
    langDiv.innerHTML = `<div class="meta-label">HTML lang</div><div class="meta-value" style="color: ${langColor};"></div>`;
    langDiv.querySelector('.meta-value').textContent = a11y.langMissing ? 'Missing' : 'Present';
    grid.appendChild(langDiv);

    const focusDiv = document.createElement('div');
    focusDiv.className = 'meta-item';
    focusDiv.innerHTML = '<div class="meta-label">Focusable</div><div class="meta-value"></div>';
    focusDiv.querySelector('.meta-value').textContent = a11y.focusableCount;
    grid.appendChild(focusDiv);

    overviewEl.appendChild(grid);
  }

  const altEl = document.getElementById('a11y-missing-alt');
  if (altEl) {
    if (a11y.imagesMissingAltCount) {
      altEl.innerHTML = `<div class="outline-item"><strong>${a11y.imagesMissingAltCount}</strong> image${a11y.imagesMissingAltCount === 1 ? '' : 's'} missing alt text</div>`;
      a11y.imagesMissingAlt.slice(0, 10).forEach(src => {
        const div = document.createElement('div');
        div.className = 'outline-item';
        div.style.fontSize = '11px';
        div.style.color = 'var(--text-secondary)';
        div.style.wordBreak = 'break-all';
        div.textContent = src;
        altEl.appendChild(div);
      });
    } else {
      altEl.innerHTML = '<div class="empty-state">All images have alt text</div>';
    }
  }

  const labelsEl = document.getElementById('a11y-missing-labels');
  if (labelsEl) {
    if (a11y.formFieldsMissingLabelCount) {
      labelsEl.innerHTML = '';
      a11y.formFieldsMissingLabel.slice(0, 10).forEach(f => {
        const div = document.createElement('div');
        div.className = 'outline-item';
        div.textContent = `<${f.tag}${f.type ? ` type="${f.type}"` : ''}${f.name ? ` name="${f.name}"` : ''}>`;
        labelsEl.appendChild(div);
      });
    } else {
      labelsEl.innerHTML = '<div class="empty-state">All form fields have labels</div>';
    }
  }

  const headingIssuesEl = document.getElementById('a11y-heading-issues');
  if (headingIssuesEl) {
    const issues = computeHeadingIssues(data.outline);
    if (issues.length) {
      headingIssuesEl.innerHTML = '';
      issues.forEach(text => {
        const div = document.createElement('div');
        div.className = 'outline-item';
        div.style.color = 'var(--danger)';
        div.textContent = text;
        headingIssuesEl.appendChild(div);
      });
    } else {
      headingIssuesEl.innerHTML = '<div class="empty-state">No heading hierarchy issues found</div>';
    }
  }
}

function renderPerformanceSnapshot(data) {
  const container = document.getElementById('performance-stats');
  if (!container) return;
  const perf = data.performance || {};
  container.innerHTML = '';

  const rows = [
    { label: 'DOM Content Loaded', value: perf.domContentLoadedMs != null ? `${perf.domContentLoadedMs} ms (${(perf.domContentLoadedMs / 1000).toFixed(2)} s)` : 'Not available' },
    { label: 'Full Page Load', value: perf.loadMs != null ? `${perf.loadMs} ms (${(perf.loadMs / 1000).toFixed(2)} s)` : 'Not available' },
    { label: 'Resources Loaded', value: perf.resourceCount != null ? perf.resourceCount : '—' },
    { label: 'Total Transfer Size', value: perf.totalTransferSizeKb != null ? `${perf.totalTransferSizeKb} KB` : '—' },
    { label: 'Render-Blocking Scripts', value: perf.renderBlockingScripts != null ? perf.renderBlockingScripts : '—' }
  ];

  const grid = document.createElement('div');
  grid.className = 'grid-2-col';

  rows.forEach(r => {
    const div = document.createElement('div');
    div.className = 'meta-item';
    div.innerHTML = `<div class="meta-label">${r.label}</div><div class="meta-value"></div>`;
    div.querySelector('.meta-value').textContent = r.value;
    grid.appendChild(div);
  });

  container.appendChild(grid);
}

function renderTokenTagList(containerId, entries) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (entries && entries.length) {
    entries.forEach(entry => {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.title = `Used ${entry.count} time${entry.count === 1 ? '' : 's'}`;
      tag.textContent = entry.value;
      container.appendChild(tag);
    });
  } else {
    container.innerHTML = '<div class="empty-state">None detected</div>';
  }
}

function buildStarterKit(data, format) {
  const uniqueColors = [];
  const seenStarterKitColorHexes = new Set();
  [...(data.colors || []), ...(data.bgColors || [])].forEach(c => {
    if (!seenStarterKitColorHexes.has(c.hex)) {
      seenStarterKitColorHexes.add(c.hex);
      uniqueColors.push(c);
    }
  });
  const uniqueFonts = data.fonts && data.fonts.length
    ? [...new Set(data.fonts.map(f => f.split(',')[0].replace(/['"]/g, '').trim()).filter(Boolean))]
    : [];
  const tokens = data.designTokens || { paddings: [], radii: [], shadows: [] };
  const spacing = (tokens.paddings || []).map(t => t.value);
  const radii = (tokens.radii || []).map(t => t.value);
  const shadows = (tokens.shadows || []).map(t => t.value);

  if (format === 'css') {
    const lines = [':root {'];
    uniqueColors.forEach((c, i) => lines.push(`  --color-${i + 1}: ${c.hex};`));
    uniqueFonts.forEach((f, i) => lines.push(`  --font-${i + 1}: '${f}';`));
    spacing.forEach((s, i) => lines.push(`  --space-${i + 1}: ${s};`));
    radii.forEach((r, i) => lines.push(`  --radius-${i + 1}: ${r};`));
    lines.push('}');
    return { text: lines.join('\n'), ext: 'css' };
  }

  if (format === 'figma') {
    const obj = { color: {}, font: {}, spacing: {}, borderRadius: {} };
    uniqueColors.forEach((c, i) => { obj.color[`color-${i + 1}`] = { value: c.hex, type: 'color' }; });
    uniqueFonts.forEach((f, i) => { obj.font[`font-${i + 1}`] = { value: f, type: 'fontFamily' }; });
    spacing.forEach((s, i) => { obj.spacing[`space-${i + 1}`] = { value: s, type: 'spacing' }; });
    radii.forEach((r, i) => { obj.borderRadius[`radius-${i + 1}`] = { value: r, type: 'borderRadius' }; });
    return { text: JSON.stringify(obj, null, 2), ext: 'json' };
  }

  // Default: Tailwind config
  const colorEntries = uniqueColors.map((c, i) => `        'color-${i + 1}': '${c.hex}',`).join('\n');
  const fontEntries = uniqueFonts.map((f, i) => `        'font-${i + 1}': ['${f}', 'sans-serif'],`).join('\n');
  const spacingEntries = spacing.map((s, i) => `        'space-${i + 1}': '${s}',`).join('\n');
  const radiusEntries = radii.map((r, i) => `        'radius-${i + 1}': '${r}',`).join('\n');
  return {
    text: `module.exports = {\n  theme: {\n    extend: {\n      colors: {\n${colorEntries}\n      },\n      fontFamily: {\n${fontEntries}\n      },\n      spacing: {\n${spacingEntries}\n      },\n      borderRadius: {\n${radiusEntries}\n      }\n    }\n  }\n}`,
    ext: 'js'
  };
}

function renderDesignTokens(data) {
  const tokens = data.designTokens || {
    margins: [], paddings: [], gaps: [], radii: [], shadows: [], zIndexes: [], customProperties: []
  };

  renderTokenTagList('tokens-margins', tokens.margins);
  renderTokenTagList('tokens-paddings', tokens.paddings);
  renderTokenTagList('tokens-gaps', tokens.gaps);
  renderTokenTagList('tokens-radii', tokens.radii);
  renderTokenTagList('tokens-shadows', tokens.shadows.map(s => ({ ...s, value: s.value.length > 40 ? s.value.slice(0, 40) + '…' : s.value })));
  renderTokenTagList('tokens-zindex', tokens.zIndexes);

  const customPropsEl = document.getElementById('tokens-custom-props');
  if (customPropsEl) {
    if (tokens.customProperties && tokens.customProperties.length) {
      customPropsEl.innerHTML = '';
      tokens.customProperties.forEach(line => {
        const div = document.createElement('div');
        div.className = 'outline-item';
        div.style.fontFamily = "'SFMono-Regular', Consolas, monospace";
        div.style.fontSize = '11px';
        div.textContent = line;
        customPropsEl.appendChild(div);
      });
    } else {
      customPropsEl.innerHTML = '<div class="empty-state">No CSS custom properties found on :root</div>';
    }
  }

  const copyBtn = document.getElementById('copy-tokens-btn');
  if (copyBtn) {
    copyBtn.onclick = () => {
      if (!tokens.customProperties || !tokens.customProperties.length) return;
      const css = [':root {', ...tokens.customProperties.map(p => `  ${p};`), '}'].join('\n');
      copyToClipboard(css, `Copied ${tokens.customProperties.length} custom properties`);
    };
  }

  const starterKitBtn = document.getElementById('export-starter-kit-btn');
  const starterKitFormatSelect = document.getElementById('starter-kit-format');
  if (starterKitBtn) {
    starterKitBtn.onclick = () => {
      const format = starterKitFormatSelect ? starterKitFormatSelect.value : 'tailwind';
      const { text, ext } = buildStarterKit(data, format);
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      let filename = `starter-kit.${ext}`;
      try {
        const host = data.meta && data.meta.canonical ? new URL(data.meta.canonical).hostname : null;
        if (host) filename = `starter-kit-${host}.${ext}`;
      } catch (e) { /* keep default filename */ }
      chrome.downloads.download({ url, filename }, (downloadId) => {
        if (chrome.runtime.lastError) window.open(url, '_blank');
        else showToast('Starter kit exported');
      });
    };
  }
}

function computeSeoChecklist(data) {
  const title = (data.meta && data.meta.title) || '';
  const desc = (data.meta && data.meta.description) || '';
  const seo = data.seo || {};
  const a11y = data.accessibility || {};
  const perf = data.performance || {};
  const structuredDataBlocks = (data.structuredData && data.structuredData.blocks) || [];
  const contact = data.mediaContact || {};

  // `section` names the section-card (data-tab) that explains a failing check, so the
  // checklist row can jump straight to the evidence instead of just saying pass/fail
  const checks = [
    { label: 'Title length is 30–60 characters', pass: title.length >= 30 && title.length <= 60, section: 'meta' },
    { label: 'Description length is 120–160 characters', pass: desc.length >= 120 && desc.length <= 160, section: 'meta' },
    { label: 'Exactly one H1 on the page', pass: seo.h1Count === 1, section: 'outline' },
    { label: 'Canonical URL is present', pass: !!(data.meta && data.meta.canonical), section: 'meta' },
    { label: 'Canonical matches the current URL', pass: !seo.canonicalMismatch, section: 'meta' },
    { label: 'Not blocked by robots (noindex/nofollow)', pass: !(seo.robots && (seo.robots.noindex || seo.robots.nofollow)), section: 'meta' },
    { label: 'Mobile viewport meta tag present', pass: !!seo.hasViewport, section: 'meta' },
    { label: 'Language attribute declared', pass: !a11y.langMissing, section: 'accessibility' },
    { label: 'Open Graph tags present', pass: !!(data.socialMeta && data.socialMeta.og && (data.socialMeta.og.title || data.socialMeta.og.description || data.socialMeta.og.image)), section: 'social' },
    { label: 'Structured data (JSON-LD) present', pass: !!(data.structuredData && data.structuredData.types.length), section: 'structured-data' },
    { label: 'All images have alt text', pass: (a11y.imagesMissingAltCount || 0) === 0, section: 'accessibility' },
    { label: 'No broken images detected', pass: (data.brokenImagesCount || 0) === 0, section: 'assets' },
    { label: 'Heading hierarchy has no skipped levels', pass: computeHeadingIssues(data.outline).length === 0, section: 'accessibility' },
    { label: 'Sufficient content length (300+ words)', pass: (data.meta && data.meta.wordCount || 0) >= 300, section: 'meta' },
    { label: 'Page loads in a reasonable time', pass: perf.loadMs == null || perf.loadMs <= 3000, section: 'performance' },
    { label: 'No structured data (JSON-LD) errors', pass: !structuredDataBlocks.some(b => b.error), section: 'structured-data' },
    { label: 'Author or organization info present', pass: !!(seo.author || contact.name || contact.organization), section: 'media-contact' },
    { label: 'Open Graph image present', pass: !!(data.socialMeta && data.socialMeta.og && data.socialMeta.og.image), section: 'social' },
    { label: 'No render-blocking scripts in <head>', pass: (perf.renderBlockingScripts || 0) === 0, section: 'performance' },
    { label: 'Page has internal links', pass: (data.links || []).some(l => l.isInternal), section: 'backlinks' }
  ];

  const passCount = checks.filter(c => c.pass).length;
  const score = Math.round((passCount / checks.length) * 100);
  return { checks, score, passCount };
}

function countDarkPatternInstances(data) {
  const dp = data.darkPatterns || {};
  return ['preCheckedOptIns', 'confirmShaming', 'scarcityUrgency', 'hiddenSensitiveLinks',
    'confusingOptOuts', 'undisclosedFreeTrials', 'disguisedAds', 'consentButtonDisparity']
    .reduce((sum, key) => sum + (dp[`${key}Count`] || 0), 0);
}

function computeDarkPatternChecklist(data) {
  const dp = data.darkPatterns || {};
  const checks = [
    { label: 'No pre-checked opt-in checkboxes', pass: (dp.preCheckedOptInsCount || 0) === 0, section: 'dark-patterns' },
    { label: 'No confirm-shaming decline copy', pass: (dp.confirmShamingCount || 0) === 0, section: 'dark-patterns' },
    { label: 'No fake urgency/scarcity language', pass: (dp.scarcityUrgencyCount || 0) === 0, section: 'dark-patterns' },
    { label: 'No hidden or obscured cancel/unsubscribe links', pass: (dp.hiddenSensitiveLinksCount || 0) === 0, section: 'dark-patterns' },
    { label: 'No confusing double-negative opt-outs', pass: (dp.confusingOptOutsCount || 0) === 0, section: 'dark-patterns' },
    { label: 'No undisclosed free-trial billing terms', pass: (dp.undisclosedFreeTrialsCount || 0) === 0, section: 'dark-patterns' },
    { label: 'No disguised or mislabeled advertising', pass: (dp.disguisedAdsCount || 0) === 0, section: 'dark-patterns' },
    { label: 'No accept/decline button styling disparity', pass: (dp.consentButtonDisparityCount || 0) === 0, section: 'dark-patterns' }
  ];
  const passCount = checks.filter(c => c.pass).length;
  const failedCount = checks.length - passCount;
  // unlike SEO/Accessibility, "mostly clean" isn't good enough here — a single confirmed
  // dark pattern should immediately drop the score out of the green tier (>=80), not just
  // nudge a proportional percentage that can stay green until 2+ categories fail
  const score = failedCount === 0 ? 100 : Math.max(0, 70 - (failedCount - 1) * 15);
  return { checks, score, passCount };
}

function renderSeoScore(data) {
  const { checks, score, passCount } = computeSeoChecklist(data);
  setSectionCount('seo-score', checks.length - passCount);

  const scoreEl = document.getElementById('seo-score-display');
  if (scoreEl) {
    const tierColor = score >= 80 ? 'var(--success)' : score >= 50 ? '#d97706' : 'var(--danger)';
    scoreEl.innerHTML = `
      <div class="score-ring" style="border-color: ${tierColor}; color: ${tierColor};"></div>
      <div class="score-details">
        <div class="score-title"></div>
        <div class="score-subtitle"></div>
      </div>
    `;
    scoreEl.querySelector('.score-ring').textContent = score;
    scoreEl.querySelector('.score-title').textContent = score >= 80 ? 'Looking good' : score >= 50 ? 'Needs some work' : 'Needs attention';
    scoreEl.querySelector('.score-subtitle').textContent = `${passCount} of ${checks.length} checks passed`;
  }

  renderChecklistRows(document.getElementById('seo-checklist'), checks);
}

// shared by every pass/fail checklist (SEO, Dark Patterns, ...) — failing rows with a
// `section` jump straight to the section-card that explains the reason
function renderChecklistRows(checklistEl, checks) {
  if (!checklistEl) return;
  checklistEl.innerHTML = '';
  checks.forEach(c => {
    const row = document.createElement('div');
    row.className = 'outline-item';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    const color = c.pass ? 'var(--success)' : 'var(--danger)';
    const canJump = !c.pass && c.section;
    row.innerHTML = `<span style="color: ${color}; font-weight: 700; flex-shrink: 0;">${c.pass ? '✓' : '✕'}</span><span style="flex: 1;"></span>${canJump ? '<span class="checklist-jump-hint">See why ›</span>' : ''}`;
    row.querySelector('span:nth-child(2)').textContent = c.label;
    if (canJump) {
      row.classList.add('outline-item-clickable');
      row.title = `See the ${c.section.replace(/-/g, ' ')} section for details`;
      row.addEventListener('click', () => jumpToToolsSection(c.section));
    }
    checklistEl.appendChild(row);
  });
}

const DARK_PATTERN_INSTANCE_LISTS = [
  { key: 'preCheckedOptIns', elId: 'dp-precheck-list', groupElId: 'dp-precheck-group' },
  { key: 'confirmShaming', elId: 'dp-shaming-list', groupElId: 'dp-shaming-group' },
  { key: 'scarcityUrgency', elId: 'dp-scarcity-list', groupElId: 'dp-scarcity-group' },
  { key: 'hiddenSensitiveLinks', elId: 'dp-hidden-links-list', groupElId: 'dp-hidden-links-group' },
  { key: 'confusingOptOuts', elId: 'dp-confusing-optout-list', groupElId: 'dp-confusing-optout-group' },
  { key: 'undisclosedFreeTrials', elId: 'dp-free-trial-list', groupElId: 'dp-free-trial-group' },
  { key: 'disguisedAds', elId: 'dp-disguised-ads-list', groupElId: 'dp-disguised-ads-group' },
  { key: 'consentButtonDisparity', elId: 'dp-consent-disparity-list', groupElId: 'dp-consent-disparity-group' }
];

function renderDarkPatternAudit(data) {
  const dp = data.darkPatterns || {};
  const { checks, score, passCount } = computeDarkPatternChecklist(data);
  setSectionCount('dark-patterns', checks.length - passCount);

  const scoreEl = document.getElementById('dark-pattern-score-display');
  if (scoreEl) {
    const tierColor = score >= 80 ? 'var(--success)' : score >= 50 ? '#d97706' : 'var(--danger)';
    scoreEl.innerHTML = `
      <div class="score-ring" style="border-color: ${tierColor}; color: ${tierColor};"></div>
      <div class="score-details">
        <div class="score-title"></div>
        <div class="score-subtitle"></div>
      </div>
    `;
    scoreEl.querySelector('.score-ring').textContent = score;
    scoreEl.querySelector('.score-title').textContent = score >= 80 ? 'Looking clean' : score >= 50 ? 'A few concerns' : 'Needs attention';
    scoreEl.querySelector('.score-subtitle').textContent = `${passCount} of ${checks.length} checks passed`;
  }

  renderChecklistRows(document.getElementById('dark-pattern-checklist'), checks);

  let anyDetected = false;
  DARK_PATTERN_INSTANCE_LISTS.forEach(({ key, elId, groupElId }) => {
    const el = document.getElementById(elId);
    const groupEl = document.getElementById(groupElId);
    const instances = dp[key] || [];
    if (!instances.length) {
      if (groupEl) groupEl.classList.add('hidden');
      return;
    }
    anyDetected = true;
    if (groupEl) groupEl.classList.remove('hidden');
    if (!el) return;
    el.innerHTML = '';
    instances.forEach(item => {
      const row = document.createElement('div');
      row.className = 'outline-item';
      row.textContent = item.count > 1 ? `${item.text} (×${item.count})` : item.text;
      el.appendChild(row);
    });
  });

  const allClearEl = document.getElementById('dp-all-clear');
  if (allClearEl) allClearEl.classList.toggle('hidden', anyDetected);
}

// Desktop truncates the title/description to one line each; mobile Google commonly
// wraps the title onto a second line and shows a longer snippet, so both the pixel
// budget (for the JS ellipsis fallback) and the line-clamp (for real wrapping) differ.
const SERP_DEVICE_PRESETS = {
  desktop: { titleMaxPx: 600, descMaxPx: 920 },
  mobile: { titleMaxPx: 1080, descMaxPx: 1380 }
};
let serpDeviceMode = 'desktop';

function renderSerpPreview(data, device) {
  if (device) serpDeviceMode = device;
  const container = document.getElementById('serp-preview');
  if (!container) return;
  const title = (data.meta && data.meta.title) || '';
  const desc = (data.meta && data.meta.description) || '';
  if (!title && !desc) {
    container.innerHTML = '<div class="empty-state">No title or description to preview</div>';
    return;
  }

  let displayUrl = 'example.com';
  try {
    if (data.meta && data.meta.canonical) {
      const u = new URL(data.meta.canonical);
      displayUrl = u.hostname + (u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '');
    }
  } catch (e) { /* keep default */ }

  const measure = (text, maxPx, font) => {
    if (!measure.canvas) measure.canvas = document.createElement('canvas');
    const ctx = measure.canvas.getContext('2d');
    ctx.font = font;
    if (!text || ctx.measureText(text).width <= maxPx) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxPx) lo = mid;
      else hi = mid - 1;
    }
    return text.slice(0, lo) + '…';
  };

  const preset = SERP_DEVICE_PRESETS[serpDeviceMode] || SERP_DEVICE_PRESETS.desktop;
  const truncatedTitle = measure(title, preset.titleMaxPx, '20px arial') || 'Untitled page';
  const truncatedDesc = measure(desc, preset.descMaxPx, '14px arial') || 'No description available for this page.';

  container.classList.toggle('serp-mobile', serpDeviceMode === 'mobile');
  container.innerHTML = '';
  const urlRow = document.createElement('div');
  urlRow.className = 'serp-url-row';
  const favicon = document.createElement('img');
  favicon.className = 'serp-favicon';
  favicon.onerror = () => { favicon.style.visibility = 'hidden'; };
  favicon.src = data.faviconUrl || '';
  const urlText = document.createElement('span');
  urlText.className = 'serp-url-text';
  urlText.textContent = displayUrl;
  urlRow.appendChild(favicon);
  urlRow.appendChild(urlText);

  const titleEl = document.createElement('div');
  titleEl.className = 'serp-title';
  titleEl.textContent = truncatedTitle;
  titleEl.title = title;

  const descEl = document.createElement('div');
  descEl.className = 'serp-desc';
  descEl.textContent = truncatedDesc;
  descEl.title = desc;

  container.appendChild(urlRow);
  container.appendChild(titleEl);
  container.appendChild(descEl);
}

function setupSerpDeviceToggle() {
  const toggle = document.getElementById('serp-device-toggle');
  if (!toggle) return;
  toggle.querySelectorAll('.tag').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!lastExtractedData) return;
      toggle.querySelectorAll('.tag').forEach(b => b.classList.toggle('active', b === btn));
      renderSerpPreview(lastExtractedData, btn.dataset.device);
    });
  });
}

// tech stack headers
function parseBackendHeaders(headers) {
  const found = [];
  const seen = new Set();
  const add = (name, category) => {
    if (seen.has(name)) return;
    seen.add(name);
    found.push({ name, category });
  };
  const get = (h) => (headers.get(h) || '').toLowerCase();
  const has = (h) => headers.has(h);

  const server = get('server');
  if (server.includes('cloudflare')) add('Cloudflare', 'CDN');
  if (server.includes('nginx')) add('Nginx', 'Web Server');
  if (server.includes('apache traffic server') || server === 'ats') add('Apache Traffic Server', 'Web Server');
  else if (server.includes('apache')) add('Apache', 'Web Server');
  if (server.includes('microsoft-iis')) { add('IIS', 'Web Server'); add('ASP.NET', 'Programming Language'); }
  if (server.includes('kestrel')) add('Kestrel (ASP.NET Core)', 'Web Server');
  if (server.includes('openresty')) add('OpenResty', 'Web Server');
  if (server.includes('litespeed')) add('LiteSpeed', 'Web Server');
  if (server.includes('caddy')) add('Caddy', 'Web Server');
  if (server.includes('traefik')) add('Traefik', 'Reverse Proxy');
  if (server.includes('envoy')) add('Envoy', 'Reverse Proxy');
  if (server.includes('kong')) add('Kong', 'Reverse Proxy');
  if (server.includes('akamaighost')) add('Akamai', 'CDN');
  if (server.includes('gws')) add('Google Web Server', 'Web Server');
  if (server.includes('gunicorn') || server.includes('waitress') || server.includes('uvicorn') || server.includes('hypercorn') || server.includes('tornado') || server.includes('werkzeug')) add('Python', 'Programming Language');
  if (server.includes('puma') || server.includes('unicorn')) add('Ruby', 'Programming Language');
  if (server.includes('passenger')) add('Phusion Passenger', 'Web Server');
  if (server.includes('jetty') || server.includes('tomcat') || server.includes('coyote') || server.includes('undertow')) add('Java', 'Programming Language');
  if (server.includes('cowboy')) add('Elixir (Phoenix)', 'Web Framework');
  if (server.includes('vercel') || server.includes(' now')) add('Vercel', 'PaaS');
  if (server.includes('netlify')) add('Netlify', 'PaaS');
  if (server.includes('firebase hosting')) add('Firebase Hosting', 'PaaS');
  if (server.includes('amazons3')) add('Amazon S3', 'CDN');
  if (server.includes('awselb')) add('AWS Elastic Load Balancer', 'PaaS');
  if (server === 'server') add('Amazon Web Services', 'PaaS');
  if (server.includes('deno')) add('Deno', 'Programming Language');
  if (server.includes('github.com')) add('GitHub Pages', 'PaaS');

  const poweredBy = get('x-powered-by');
  if (poweredBy.includes('php')) {
    const phpVersion = poweredBy.match(/php\/([\d.]+)/);
    add(phpVersion ? `PHP ${phpVersion[1]}` : 'PHP', 'Programming Language');
  }
  if (poweredBy.includes('express')) { add('Express', 'Web Framework'); add('Node.js', 'Programming Language'); }
  if (poweredBy.includes('asp.net')) add('ASP.NET', 'Programming Language');
  if (poweredBy.includes('next.js')) add('Next.js', 'JavaScript Framework');
  if (poweredBy.includes('phusion passenger')) add('Phusion Passenger', 'Web Server');
  if (poweredBy.includes('jsp') || poweredBy.includes('servlet')) add('Java', 'Programming Language');
  if (poweredBy.includes('w3 total cache')) add('W3 Total Cache', 'Caching');
  if (poweredBy.includes('wp engine')) add('WP Engine', 'PaaS');

  const generator = get('x-generator');
  if (generator.includes('drupal')) add('Drupal', 'CMS');
  if (generator.includes('wordpress')) add('WordPress', 'CMS');

  if (has('cf-ray') || has('cf-cache-status')) add('Cloudflare', 'CDN');
  if (has('x-vercel-id') || has('x-vercel-cache')) add('Vercel', 'PaaS');
  if (has('x-nf-request-id')) add('Netlify', 'PaaS');
  if (has('x-amz-cf-id') || has('x-amz-cf-pop')) add('Amazon CloudFront', 'CDN');
  if (has('x-fastly-request-id') || has('x-timer') || get('x-served-by').includes('cache-')) add('Fastly', 'CDN');
  if (has('x-sucuri-id') || has('x-sucuri-cache')) add('Sucuri', 'Security');
  if (has('x-drupal-cache') || has('x-drupal-dynamic-cache')) add('Drupal', 'CMS');
  if (has('x-litespeed-cache')) add('LiteSpeed Cache', 'Caching');
  if (has('x-cache-enabler')) add('WP Cache Enabler', 'Caching');
  if (get('x-turbo-charged-by').includes('litespeed')) add('LiteSpeed', 'Web Server');
  if (has('x-aspnet-version') || has('x-aspnetmvc-version')) add('ASP.NET', 'Programming Language');
  if (has('x-runtime')) add('Ruby on Rails', 'Web Framework');
  if (has('x-varnish') || get('via').includes('varnish') || get('x-cache').includes('varnish')) add('Varnish', 'Caching');
  if (get('x-cache').includes('akamai') || Array.from(headers.keys()).some(k => k.startsWith('x-akamai-'))) add('Akamai', 'CDN');
  if (has('x-envoy-upstream-service-time')) add('Envoy', 'Reverse Proxy');
  if (has('x-iinfo') || get('x-cdn').includes('incapsula')) add('Imperva', 'Security');
  if (get('via').includes('heroku') || has('x-heroku-dynos-in-use')) add('Heroku', 'PaaS');
  if (has('x-render-origin-server')) add('Render', 'PaaS');
  if (has('x-github-request-id')) add('GitHub Pages', 'PaaS');
  if (has('fly-request-id')) add('Fly.io', 'PaaS');
  if (has('x-azure-ref') || has('x-ms-request-id')) add('Microsoft Azure', 'PaaS');
  if (has('x-pingback') || get('link').includes('api.w.org')) add('WordPress', 'CMS');

  const csp = get('content-security-policy');
  if (csp) {
    if (csp.includes('sentry.io') || csp.includes('ingest.sentry')) add('Sentry', 'Monitoring');
    if (csp.includes('newrelic.com') || csp.includes('nr-data.net')) add('New Relic', 'Monitoring');
    if (csp.includes('datadoghq.com')) add('Datadog', 'Monitoring');
    if (csp.includes('cloudflareinsights.com')) add('Cloudflare', 'CDN');
  }

  if (get('alt-svc').includes('h3=')) add('HTTP/3', 'Performance');

  if (seen.has('Amazon S3') || seen.has('AWS Elastic Load Balancer') || seen.has('Amazon CloudFront')) {
    add('Amazon Web Services', 'PaaS');
  }

  return found;
}

async function detectBackendTechStack(pageUrl) {
  if (!pageUrl || pageUrl.startsWith('chrome://') || pageUrl.startsWith('edge://') || pageUrl.startsWith('chrome-extension://') || pageUrl.startsWith('edge-extension://')) return [];
  const res = await fetchWithTimeout(pageUrl, 6000);
  if (!res) return [];
  try {
    return parseBackendHeaders(res.headers);
  } catch (e) {
    return [];
  }
}

// bundled libraries
const SCRIPT_LIBRARY_SIGNATURES = [
  { name: 'Lodash', category: 'JavaScript Library', test: /Lodash\s*<https:\/\/lodash\.com/i, versionRegex: /Lodash[^\d]{0,20}(\d+\.\d+\.\d+)/i },
  { name: 'core-js', category: 'JavaScript Library', test: /zloirock\/core-js/i, versionRegex: /core-js[@/](\d+\.\d+\.\d+)/i },
  { name: 'jQuery', category: 'JavaScript Library', test: /jQuery JavaScript Library/i, versionRegex: /jQuery JavaScript Library v?(\d+\.\d+\.\d+)/i },
  { name: 'Redux', category: 'State Management', test: /@@redux\/(?:INIT|PROBE_UNKNOWN_ACTION)/, versionRegex: null },
  { name: 'MobX', category: 'State Management', test: /\[mobx\]/i, versionRegex: null }
];

const SCRIPT_SCAN_CONCURRENCY = 4;
const SCRIPT_SCAN_TIMEOUT_MS = 4000;
const SCRIPT_SCAN_MAX_SCRIPTS = 10;
const SCRIPT_SCAN_MAX_CHARS = 150000;

async function scanScriptSignatures(scriptUrls) {
  if (!scriptUrls || !scriptUrls.length) return [];
  const urls = scriptUrls.slice(0, SCRIPT_SCAN_MAX_SCRIPTS);
  const matchedNames = new Set();
  const found = [];
  let index = 0;

  async function worker() {
    while (index < urls.length) {
      const url = urls[index++];
      if (matchedNames.size === SCRIPT_LIBRARY_SIGNATURES.length) return;
      const res = await fetchWithTimeout(url, SCRIPT_SCAN_TIMEOUT_MS);
      if (!res || !res.ok) continue;
      let text;
      try { text = await res.text(); } catch (e) { continue; }
      const sample = text.length > SCRIPT_SCAN_MAX_CHARS ? text.slice(0, SCRIPT_SCAN_MAX_CHARS) : text;
      SCRIPT_LIBRARY_SIGNATURES.forEach(sig => {
        if (matchedNames.has(sig.name) || !sig.test.test(sample)) return;
        matchedNames.add(sig.name);
        let name = sig.name;
        const m = sig.versionRegex && sample.match(sig.versionRegex);
        if (m && m[1]) name = `${sig.name} ${m[1]}`;
        found.push({ name, category: sig.category });
      });
    }
  }

  const workerCount = Math.min(SCRIPT_SCAN_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return found;
}

const TECH_CATEGORY_ORDER = [
  'CMS', 'Page Builder', 'Ecommerce', 'Static Site Generator', 'JavaScript Framework', 'JavaScript Library', 'State Management', 'CSS Framework', 'UI Framework', 'Web Framework',
  'Programming Language', 'Database', 'Web Server', 'Reverse Proxy', 'CDN', 'PaaS', 'Caching', 'Search Engine',
  'Analytics', 'Monitoring', 'Tag Manager', 'A/B Testing', 'Advertising', 'Marketing Automation', 'SEO',
  'Font Script', 'Payment Processor', 'Live Chat', 'Widgets', 'Maps', 'Video Player', 'Security', 'Cookie Consent', 'Miscellaneous', 'Performance'
];

const LIKELY_SUFFIX = ' (likely)';

function groupTechStackByCategory(items) {
  const map = new Map();
  const seenNames = new Set();
  const confirmedNames = items.filter(i => !i.name.endsWith(LIKELY_SUFFIX)).map(i => i.name);
  const hasConfirmedMatch = (baseName) => confirmedNames.some(n => n === baseName || n.startsWith(baseName + ' '));

  items.forEach(({ name, category }) => {
    if (name.endsWith(LIKELY_SUFFIX)) {
      const baseName = name.slice(0, -LIKELY_SUFFIX.length);
      if (hasConfirmedMatch(baseName)) return;
    }
    if (seenNames.has(name)) return;
    seenNames.add(name);
    if (!map.has(category)) map.set(category, []);
    map.get(category).push(name);
  });
  return map;
}

function renderTechStack(frontendItems, backendItems) {
  const container = document.getElementById('tech-stack-categories');
  if (!container) return;
  const merged = [...(frontendItems || []), ...(backendItems || [])];
  const grouped = groupTechStackByCategory(merged);
  lastTechStackGrouped = grouped;
  const totalCount = Array.from(grouped.values()).reduce((sum, names) => sum + names.length, 0);
  setSectionCount('tech-stack', totalCount);

  container.innerHTML = '';
  if (!totalCount) {
    container.innerHTML = '<div class="empty-state">No recognizable technologies detected</div>';
    return;
  }

  const orderedCategories = [
    ...TECH_CATEGORY_ORDER.filter(c => grouped.has(c)),
    ...Array.from(grouped.keys()).filter(c => !TECH_CATEGORY_ORDER.includes(c)).sort()
  ];

  orderedCategories.forEach((category, index) => {
    const titleEl = document.createElement('div');
    titleEl.className = 'section-title';
    if (index === 0) titleEl.style.marginTop = '0';
    titleEl.textContent = category;
    container.appendChild(titleEl);

    const tagsEl = document.createElement('div');
    tagsEl.className = 'tags';
    grouped.get(category).forEach(name => {
      const chip = document.createElement('div');
      chip.className = 'tag static';
      if (name.endsWith(LIKELY_SUFFIX)) {
        chip.classList.add('tag-inferred');
        chip.title = 'Inferred from other detected technology, not directly observed';
      }
      chip.textContent = name;
      tagsEl.appendChild(chip);
    });
    container.appendChild(tagsEl);
  });
}

function renderTrustSignals(data) {
  const container = document.getElementById('trust-signals-list');
  if (!container) return;
  const trust = data.trustSignals || { trustBadgeCount: 0, testimonialSectionFound: false, reviewSchemaFound: false };
  const checks = [
    { label: trust.trustBadgeCount > 0 ? `${trust.trustBadgeCount} trust badge indicator(s) found` : 'No trust badges detected', pass: trust.trustBadgeCount > 0 },
    { label: trust.testimonialSectionFound ? 'Testimonials / reviews section found' : 'No testimonials or reviews section found', pass: trust.testimonialSectionFound },
    { label: trust.reviewSchemaFound ? 'Review / AggregateRating schema found' : 'No review structured data found', pass: trust.reviewSchemaFound }
  ];
  container.innerHTML = '';
  checks.forEach(c => {
    const row = document.createElement('div');
    row.className = 'outline-item';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    const color = c.pass ? 'var(--success)' : 'var(--text-tertiary)';
    row.innerHTML = `<span style="color: ${color}; font-weight: 700; flex-shrink: 0;">${c.pass ? '✓' : '–'}</span><span></span>`;
    row.querySelector('span:last-child').textContent = c.label;
    container.appendChild(row);
  });
}

function sendThemePreviewMessage(tabId, action, payload, cb) {
  if (!tabId) { if (cb) cb(null); return; }
  chrome.tabs.sendMessage(tabId, { action, ...payload }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('Could not send theme preview message', chrome.runtime.lastError);
      if (cb) cb(null);
      return;
    }
    if (cb) cb(response);
  });
}

function setupThemePreviewControls(data, tabId) {
  const resetAll = () => {
    sendThemePreviewMessage(tabId, 'reset-preview', {}, (res) => {
      if (res && res.success) showToast('Live preview reset');
    });
  };

  const fontSelect = document.getElementById('theme-preview-font-select');
  const fontTarget = document.getElementById('theme-preview-font-target');
  const fontApplyBtn = document.getElementById('theme-preview-font-apply-btn');
  const fontResetBtn = document.getElementById('theme-preview-font-reset-btn');

  if (fontSelect) {
    const uniqueFonts = data.fonts && data.fonts.length ? [...new Set(data.fonts.map(f => f.trim()).filter(Boolean))] : [];
    fontSelect.innerHTML = '';
    if (uniqueFonts.length) {
      uniqueFonts.forEach(f => {
        const cleanName = f.split(',')[0].replace(/['"]/g, '').trim();
        const opt = document.createElement('option');
        opt.value = cleanName;
        opt.textContent = cleanName;
        fontSelect.appendChild(opt);
      });
    } else {
      const opt = document.createElement('option');
      opt.textContent = 'No fonts detected';
      fontSelect.appendChild(opt);
    }
  }

  if (fontApplyBtn) {
    fontApplyBtn.onclick = () => {
      if (!fontSelect || !fontSelect.value) return;
      const typed = (fontTarget && fontTarget.value || '').trim();
      if (!typed) { showToast('Type a font name to preview'); return; }
      const to = typed.includes(',') ? typed : `${typed}, sans-serif`;
      sendThemePreviewMessage(tabId, 'preview-font', { from: fontSelect.value, to }, (res) => {
        if (res && res.success) showToast(res.count ? `Previewing "${typed}" on ${res.count} element(s)` : 'No matching elements found');
      });
    };
  }
  if (fontResetBtn) fontResetBtn.onclick = resetAll;
}

const HIGH_VALUE_SCHEMA_TYPES = ['FAQPage', 'Article', 'NewsArticle', 'BlogPosting', 'Product', 'HowTo', 'Review', 'QAPage'];

function computeLlmVisibilityChecklist(data, siteFilesResult) {
  const seo = data.seo || {};
  const contact = data.mediaContact || {};
  const llm = data.llmSignals || {};
  const wordCount = (data.meta && data.meta.wordCount) || 0;
  const headingIssues = computeHeadingIssues(data.outline);
  const types = (data.structuredData && data.structuredData.types) || [];
  const hasHighValueSchema = types.some(t => HIGH_VALUE_SCHEMA_TYPES.includes(t));
  const authorName = seo.author || contact.name || contact.organization;

  const freshDateStr = seo.articleModified || seo.articlePublished;
  let isFresh = null;
  if (freshDateStr) {
    const parsed = new Date(freshDateStr);
    if (!isNaN(parsed.getTime())) {
      const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
      isFresh = (Date.now() - parsed.getTime()) <= ONE_YEAR_MS;
    }
  }

  const crawlerAccessChecked = !!siteFilesResult;
  const blockedAgents = (siteFilesResult && siteFilesResult.robotsTxt && siteFilesResult.robotsTxt.blockedAiCrawlers) || [];

  const checks = [
    {
      label: 'Crawler Access',
      pass: blockedAgents.length === 0,
      detail: !crawlerAccessChecked
        ? 'Checking robots.txt for AI crawler restrictions…'
        : blockedAgents.length
          ? `Blocked for: ${blockedAgents.join(', ')}.`
          : 'No AI crawler restrictions found in robots.txt.'
    },
    {
      label: 'Content Depth',
      pass: wordCount >= 800,
      detail: wordCount >= 800
        ? `Sufficient depth (${wordCount} words) for LLM context.`
        : `Thin content (${wordCount} words). Aim for 800+ words to give LLMs optimal article context.`
    },
    {
      label: 'Data Structure',
      pass: (llm.tableCount || 0) > 0,
      detail: (llm.tableCount || 0) > 0
        ? `${llm.tableCount} table(s) found for comparative data.`
        : 'No tables found. AI models prioritize comparative data displayed in tables.'
    },
    {
      label: 'Bullet Lists',
      pass: (llm.listItemCount || 0) > 0,
      detail: (llm.listItemCount || 0) > 0
        ? 'Bulleted or numbered structures found for easy retrieval.'
        : 'No bulleted or numbered lists found for easy retrieval.'
    },
    {
      label: 'Answer-First Paragraphs',
      pass: (llm.answerFirstParagraphCount || 0) > 0,
      detail: (llm.answerFirstParagraphCount || 0) > 0
        ? `${llm.answerFirstParagraphCount} section(s) lead with a short, quotable answer — favored by AI answer engines (GEO).`
        : 'No sections lead with a concise answer paragraph. AI answer engines favor content that states the answer immediately after a heading.'
    },
    {
      label: 'Heading Flow',
      pass: headingIssues.length === 0,
      detail: headingIssues.length === 0
        ? 'Heading levels flow logically.'
        : 'Heading levels are skipped (e.g., H1 to H3). Review this to ensure semantic flow.'
    },
    {
      label: 'Heading Intent',
      pass: (llm.conversationalHeadingCount || 0) > 0,
      detail: (llm.conversationalHeadingCount || 0) > 0
        ? 'Headings use conversational Q&A styling.'
        : 'Headings could use more conversational, question-style phrasing.'
    },
    {
      label: 'Data Evidence',
      pass: (llm.dataEvidenceCount || 0) >= 3,
      detail: (llm.dataEvidenceCount || 0) >= 3
        ? 'Explicit data or metrics found to back up claims.'
        : 'No explicit data or metrics found. Back up claims with data.'
    },
    {
      label: 'Schema Depth',
      pass: hasHighValueSchema,
      detail: hasHighValueSchema
        ? 'High-value structured data types found for AI summary matching.'
        : 'Missing high-value structured Schema types (FAQPage, Article, Product, etc.) for AI summary matching.'
    },
    {
      label: 'Entity Trust',
      pass: !!authorName,
      detail: authorName
        ? `Verified publisher credentials found: ${authorName}.`
        : 'No author or publisher credentials found.'
    },
    {
      label: 'Freshness',
      pass: isFresh !== false,
      detail: isFresh === true
        ? 'Content validated as recently published or updated.'
        : isFresh === false
          ? 'Content appears outdated — consider refreshing it.'
          : 'No publish or modified date found to verify freshness.'
    }
  ];

  const passCount = checks.filter(c => c.pass).length;
  const score = Math.round((passCount / checks.length) * 100);
  return { checks, score, passCount };
}

function renderLlmVisibility(data, siteFilesResult) {
  const { checks, score, passCount } = computeLlmVisibilityChecklist(data, siteFilesResult);
  setSectionCount('llm-visibility', checks.length - passCount);

  const scoreEl = document.getElementById('llm-visibility-score-display');
  if (scoreEl) {
    const tierColor = score >= 80 ? 'var(--success)' : score >= 50 ? '#d97706' : 'var(--danger)';
    scoreEl.innerHTML = `
      <div class="score-ring" style="border-color: ${tierColor}; color: ${tierColor};"></div>
      <div class="score-details">
        <div class="score-title"></div>
        <div class="score-subtitle"></div>
      </div>
    `;
    scoreEl.querySelector('.score-ring').textContent = score;
    scoreEl.querySelector('.score-title').textContent = score >= 80 ? 'Highly visible to AI' : score >= 50 ? 'Partially visible to AI' : 'Low AI visibility';
    scoreEl.querySelector('.score-subtitle').textContent = `${passCount} of ${checks.length} checks passed`;
  }

  const checklistEl = document.getElementById('llm-visibility-checklist');
  if (checklistEl) {
    checklistEl.innerHTML = '';
    checks.forEach(c => {
      const row = document.createElement('div');
      row.className = 'outline-item';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '2px';
      const color = c.pass ? 'var(--success)' : 'var(--danger)';
      row.innerHTML = `
        <span style="display: flex; align-items: center; gap: 6px;">
          <span style="color: ${color}; font-weight: 700; flex-shrink: 0;">${c.pass ? '✓' : '✕'}</span>
          <span class="llm-check-title" style="font-weight: 600;"></span>
        </span>
        <span class="llm-check-detail" style="font-size: 11px; color: var(--text-tertiary); padding-left: 18px;"></span>
      `;
      row.querySelector('.llm-check-title').textContent = c.label;
      row.querySelector('.llm-check-detail').textContent = c.detail;
      checklistEl.appendChild(row);
    });
  }
}

const CWV_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000, max: 6000, decimals: 2, divisor: 1000, unit: 's' },
  inp: { good: 200, poor: 500, max: 800, decimals: 0, divisor: 1, unit: 'ms' },
  cls: { good: 0.1, poor: 0.25, max: 0.4, decimals: 3, divisor: 1, unit: '' },
  fcp: { good: 1800, poor: 3000, max: 4500, decimals: 2, divisor: 1000, unit: 's' },
  ttfb: { good: 800, poor: 1800, max: 2600, decimals: 0, divisor: 1, unit: 'ms' }
};

function getCwvTier(metric, rawValue) {
  if (rawValue == null) return null;
  const t = CWV_THRESHOLDS[metric];
  if (rawValue <= t.good) return 'good';
  if (rawValue <= t.poor) return 'needs-improvement';
  return 'poor';
}

function formatCwvValue(metric, rawValue) {
  if (rawValue == null) return 'N/A';
  const t = CWV_THRESHOLDS[metric];
  return `${(rawValue / t.divisor).toFixed(t.decimals)}${t.unit}`;
}

// performance score
function computePerformanceScore(data) {
  const vitals = data.webVitals || {};
  const points = ['lcp', 'cls', 'inp'].map(m => {
    const tier = getCwvTier(m, vitals[m]);
    if (tier === 'good') return 100;
    if (tier === 'needs-improvement') return 50;
    if (tier === 'poor') return 0;
    return null;
  }).filter(p => p !== null);
  if (!points.length) return null;
  return { score: Math.round(points.reduce((a, b) => a + b, 0) / points.length) };
}

function renderCoreWebVitals(data, pageUrl) {
  const vitals = data.webVitals || {};
  const METRICS = [
    { key: 'lcp', label: 'LCP', full: 'Largest Contentful Paint — time until the biggest visible element renders.' },
    { key: 'inp', label: 'INP', full: 'Interaction to Next Paint — responsiveness to user input.' },
    { key: 'cls', label: 'CLS', full: 'Cumulative Layout Shift — how much content unexpectedly moves.' },
    { key: 'fcp', label: 'FCP', full: 'First Contentful Paint — time until the first content renders.' },
    { key: 'ttfb', label: 'TTFB', full: 'Time to First Byte — server response latency.' }
  ];

  const gridEl = document.getElementById('cwv-grid');
  if (gridEl) {
    gridEl.innerHTML = '';
    METRICS.forEach(m => {
      const raw = vitals[m.key];
      const tier = getCwvTier(m.key, raw);
      const color = tier === 'good' ? 'var(--success)' : tier === 'needs-improvement' ? '#d97706' : tier === 'poor' ? 'var(--danger)' : 'var(--text-tertiary)';
      const t = CWV_THRESHOLDS[m.key];
      const pct = raw == null ? null : Math.max(0, Math.min(100, (raw / t.max) * 100));
      const goodPct = (t.good / t.max) * 100;
      const poorPct = (t.poor / t.max) * 100;

      const tile = document.createElement('div');
      tile.className = 'cwv-tile';
      tile.innerHTML = `
        <div class="cwv-tile-label" title="${m.full}">${m.label}</div>
        <div class="cwv-tile-value" style="color: ${color};"></div>
        <div class="cwv-gauge">
          <div class="cwv-gauge-track" style="background: linear-gradient(to right, var(--success) 0% ${goodPct}%, #d97706 ${goodPct}% ${poorPct}%, var(--danger) ${poorPct}% 100%);"></div>
          ${pct != null ? `<div class="cwv-gauge-marker" style="left: ${pct}%;"></div>` : ''}
        </div>
      `;
      tile.querySelector('.cwv-tile-value').textContent = formatCwvValue(m.key, raw);
      gridEl.appendChild(tile);
    });
  }

  const statusEl = document.getElementById('cwv-overall-status');
  if (statusEl) {
    const coreTiers = ['lcp', 'cls', 'inp'].map(k => getCwvTier(k, vitals[k])).filter(Boolean);
    const passed = coreTiers.length > 0 && coreTiers.every(t => t === 'good');
    statusEl.textContent = passed ? 'PASSED' : 'NEEDS IMPROVEMENT';
    statusEl.style.background = passed ? 'var(--badge-green-bg)' : 'var(--badge-orange-bg)';
    statusEl.style.color = passed ? 'var(--badge-green-text)' : 'var(--badge-orange-text)';
  }

  const linkBtn = document.getElementById('cwv-psi-link');
  if (linkBtn) {
    linkBtn.onclick = () => {
      if (pageUrl) window.open(`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(pageUrl)}`, '_blank');
    };
  }
}

function computeSiteVibe(data) {
  const fonts = (data.fonts || []).map(f => f.toLowerCase());
  const isSerif = fonts.some(f => /georgia|times|serif|merriweather|playfair|garamond|baskerville/.test(f));
  const isMono = fonts.some(f => /mono|courier|consolas/.test(f));
  const fontTag = isSerif ? 'serif-heavy' : isMono ? 'monospace-flavored' : 'sans-serif';

  const colors = [...(data.colors || []), ...(data.bgColors || [])];
  let warmCount = 0, coolCount = 0, totalSat = 0, n = 0;
  colors.forEach(c => {
    const hsl = hexToHsl(c.hex);
    if (!hsl) return;
    n++;
    totalSat += hsl.s;
    if (hsl.h < 90 || hsl.h > 300) warmCount++;
    else if (hsl.h > 150 && hsl.h < 270) coolCount++;
  });
  const avgSat = n ? totalSat / n : 0;
  const tempTag = warmCount > coolCount ? 'Warm' : coolCount > warmCount ? 'Cool' : 'Balanced';
  const vibrancyTag = avgSat > 50 ? 'vibrant' : avgSat > 20 ? 'moderate' : 'muted';

  const paletteSize = new Set(colors.map(c => c.hex)).size;
  const paletteTag = paletteSize <= 6 ? 'minimal' : paletteSize <= 14 ? 'balanced' : 'colorful';

  return `${tempTag}, ${paletteTag}, ${vibrancyTag}, ${fontTag}`;
}

function computeDesignConsistencyScore(data) {
  const colorCount = new Set([...(data.colors || []), ...(data.bgColors || [])].map(c => c.hex)).size;
  const fontCount = new Set((data.fonts || []).map(f => f.split(',')[0].trim().toLowerCase())).size;

  const colorScore = Math.max(0, 100 - Math.max(0, colorCount - 8) * 4);
  const fontScore = Math.max(0, 100 - Math.max(0, fontCount - 2) * 20);

  let spacingScore = 100;
  const tokens = data.designTokens;
  if (tokens) {
    const allEntries = [...(tokens.margins || []), ...(tokens.paddings || [])];
    const totalUsage = allEntries.reduce((sum, e) => sum + e.count, 0);
    if (totalUsage > 0 && allEntries.length > 0) {
      const sorted = [...allEntries].sort((a, b) => b.count - a.count);
      const top5 = sorted.slice(0, 5).reduce((sum, e) => sum + e.count, 0);
      spacingScore = Math.round((top5 / totalUsage) * 100);
    }
  }

  const overall = Math.round((colorScore + fontScore + spacingScore) / 3);
  return { overall, colorScore, fontScore, spacingScore, colorCount, fontCount };
}

function renderVibeStrip(data) {
  const vibeTextEl = document.getElementById('vibe-text');
  const badgeEl = document.getElementById('consistency-badge');
  if (vibeTextEl) vibeTextEl.textContent = computeSiteVibe(data);
  if (badgeEl) {
    const consistency = computeDesignConsistencyScore(data);
    const tierColor = consistency.overall >= 80 ? 'var(--success)' : consistency.overall >= 50 ? '#d97706' : 'var(--danger)';
    badgeEl.style.color = tierColor;
    badgeEl.style.background = `color-mix(in srgb, ${tierColor} 16%, transparent)`;
    badgeEl.textContent = `${consistency.overall} consistency`;
  }
}

// dashboard
function tierColorFor(score) {
  if (score == null) return 'var(--text-tertiary)';
  return score >= 80 ? 'var(--success)' : score >= 50 ? '#d97706' : 'var(--danger)';
}

function tierClassFor(score) {
  if (score == null) return 'tier-unknown';
  return score >= 80 ? 'tier-good' : score >= 50 ? 'tier-warn' : 'tier-critical';
}

const DASHBOARD_RING_ICONS = {
  'consistency': '<circle cx="13.5" cy="6.5" r="0.5"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.4 0-1.1.9-2 2-2h2.4c2.3 0 4.1-1.8 4.1-4.1C21.5 6 17.2 2 12 2z"></path>',
  'llm-visibility': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
  'accessibility': '<circle cx="12" cy="4" r="1.5"></circle><path d="M4 8l8 2 8-2M12 10v5m0 0l-3 7m3-7l3 7"></path>',
  'performance': '<polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polyline>',
  'dark-patterns': '<path d="M12 9v4"></path><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z"></path><path d="M12 17h.01"></path>'
};

const DASHBOARD_RING_CIRCUMFERENCE = 2 * Math.PI * 28;

function buildRingHtml(key, label, score) {
  const color = tierColorFor(score);
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const targetOffset = DASHBOARD_RING_CIRCUMFERENCE * (1 - pct / 100);
  const iconPaths = DASHBOARD_RING_ICONS[key] || '';
  const iconHtml = iconPaths
    ? `<span class="dashboard-ring-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPaths}</svg></span>`
    : '';
  return `
    <button class="dashboard-ring ${tierClassFor(score)}" data-ring-key="${key}" type="button" style="--ring-color:${color};">
      ${iconHtml}
      <div class="dashboard-ring-svg-wrap">
        <svg class="dashboard-ring-svg" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" class="dashboard-ring-track"></circle>
          <circle cx="32" cy="32" r="28" class="dashboard-ring-progress" data-offset="${targetOffset}"
            style="stroke:${color}; stroke-dasharray:${DASHBOARD_RING_CIRCUMFERENCE}; stroke-dashoffset:${DASHBOARD_RING_CIRCUMFERENCE};"></circle>
        </svg>
        <div class="dashboard-ring-value" style="color:${color};" data-count-target="${score == null ? '' : score}">${score == null ? '—' : '0'}</div>
      </div>
      <div class="dashboard-ring-label">${escapeHtml(label)}</div>
    </button>
  `;
}

const DASHBOARD_HERO_RING_CIRCUMFERENCE = 2 * Math.PI * 36;

function buildHeroHtml(seoRes) {
  const color = tierColorFor(seoRes.score);
  const pct = Math.max(0, Math.min(100, seoRes.score));
  const targetOffset = DASHBOARD_HERO_RING_CIRCUMFERENCE * (1 - pct / 100);
  const tierLabel = seoRes.score >= 80 ? 'Looking good' : seoRes.score >= 50 ? 'Needs some work' : 'Needs attention';

  const allFailing = seoRes.checks.filter(c => !c.pass);
  const shownFailing = allFailing.slice(0, 3);
  const moreCount = allFailing.length - shownFailing.length;

  const issuesHtml = shownFailing.length
    ? shownFailing.map(c => `
        <div class="dashboard-hero-issue">
          <span class="dashboard-hero-issue-dot"></span>${escapeHtml(c.label)}
        </div>
      `).join('') + (moreCount > 0 ? `<div class="dashboard-hero-issue-more">+${moreCount} more</div>` : '')
    : `<div class="dashboard-hero-issue dashboard-hero-issue-ok"><span class="dashboard-hero-issue-dot"></span>All checks passing</div>`;

  return `
    <button class="dashboard-hero ${tierClassFor(seoRes.score)}" id="dashboard-hero-btn" type="button" style="--ring-color:${color};">
      <div class="dashboard-hero-ring-wrap">
        <svg class="dashboard-hero-ring-svg" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r="36" class="dashboard-ring-track"></circle>
          <circle cx="42" cy="42" r="36" class="dashboard-ring-progress" data-offset="${targetOffset}"
            style="stroke:${color}; stroke-width:7; stroke-dasharray:${DASHBOARD_HERO_RING_CIRCUMFERENCE}; stroke-dashoffset:${DASHBOARD_HERO_RING_CIRCUMFERENCE};"></circle>
        </svg>
        <div class="dashboard-hero-value" style="color:${color};" data-count-target="${seoRes.score}">0</div>
      </div>
      <div class="dashboard-hero-text">
        <div class="dashboard-hero-title">SEO Health — ${escapeHtml(tierLabel)}</div>
        <div class="dashboard-hero-desc">${seoRes.passCount} of ${seoRes.checks.length} checks passed. Tap for the full checklist.</div>
        <div class="dashboard-hero-issues">${issuesHtml}</div>
      </div>
    </button>
  `;
}

const DASHBOARD_STAT_ICONS = {
  fonts: '<polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line>',
  colors: '<circle cx="13.5" cy="6.5" r="0.5"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.9-.5-1.4 0-1.1.9-2 2-2h2.4c2.3 0 4.1-1.8 4.1-4.1C21.5 6 17.2 2 12 2z"></path>',
  outline: '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>',
  backlinks: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
  assets: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>',
  'tech-stack': '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line>',
  wordcount: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>',
  'structured-data': '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>',
  'dark-patterns': '<path d="M12 9v4"></path><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z"></path><path d="M12 17h.01"></path>'
};

function buildQuickStatsHtml(data, consistency) {
  const stats = [
    { key: 'fonts', section: 'typography', label: 'Fonts', value: consistency.fontCount },
    { key: 'colors', section: 'colors', label: 'Colors', value: consistency.colorCount },
    { key: 'outline', section: 'outline', label: 'Headings', value: (data.outline || []).length },
    { key: 'backlinks', section: 'backlinks', label: 'Links', value: (data.links || []).length },
    { key: 'assets', section: 'assets', label: 'Images', value: (data.images || []).length },
    { key: 'tech-stack', section: 'tech-stack', label: 'Tech Detected', value: (data.techStack || []).length },
    { key: 'wordcount', section: 'meta', label: 'Words', value: (data.meta && data.meta.wordCount) || 0 },
    { key: 'structured-data', section: 'structured-data', label: 'Schema Types', value: ((data.structuredData && data.structuredData.types) || []).length },
    { key: 'dark-patterns', section: 'dark-patterns', label: 'Dark Patterns', value: countDarkPatternInstances(data) }
  ];
  return stats.map(s => `
    <button class="dashboard-stat-chip" data-stat-section="${s.section}" type="button">
      <span class="dashboard-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${DASHBOARD_STAT_ICONS[s.key] || ''}</svg></span>
      <span class="dashboard-stat-value" data-count-target="${s.value}">0</span>
      <span class="dashboard-stat-label">${escapeHtml(s.label)}</span>
    </button>
  `).join('');
}

function computeIssueRollup(data, siteFilesResult, precomputed) {
  const seoRes = (precomputed && precomputed.seoRes) || computeSeoChecklist(data);
  const llmRes = (precomputed && precomputed.llmRes) || computeLlmVisibilityChecklist(data, siteFilesResult);
  const a11yRes = (precomputed && precomputed.a11yRes) || computeA11yScore(data);
  const dpRes = (precomputed && precomputed.dpRes) || computeDarkPatternChecklist(data);

  let passed = 0, critical = 0, warning = 0;
  [seoRes, llmRes, a11yRes, dpRes].forEach(res => {
    passed += res.passCount;
    critical += (res.checks.length - res.passCount);
  });

  if (lastContrastResult) {
    passed += lastContrastResult.passing;
    warning += lastContrastResult.failing.length;
  }

  return { passed, warning, critical, total: passed + warning + critical };
}

function renderDashboardBreakdown(rollup, instant) {
  const el = document.getElementById('dashboard-breakdown');
  if (!el) return;
  if (!rollup.total) {
    el.innerHTML = '<div class="empty-state">No checks available yet</div>';
    return;
  }
  const pct = n => (n / rollup.total) * 100;
  el.innerHTML = `
    <div class="dashboard-breakdown-bar">
      ${rollup.passed ? `<div class="dashboard-breakdown-segment" data-target-width="${pct(rollup.passed)}" style="width:0%; background:var(--success);" title="Passed: ${rollup.passed}"></div>` : ''}
      ${rollup.warning ? `<div class="dashboard-breakdown-segment" data-target-width="${pct(rollup.warning)}" style="width:0%; background:#d97706;" title="Warnings: ${rollup.warning}"></div>` : ''}
      ${rollup.critical ? `<div class="dashboard-breakdown-segment" data-target-width="${pct(rollup.critical)}" style="width:0%; background:var(--danger);" title="Critical: ${rollup.critical}"></div>` : ''}
    </div>
    <div class="dashboard-breakdown-legend">
      <span><span class="dashboard-legend-dot" style="background:var(--success);"></span>Passed (${rollup.passed})</span>
      <span><span class="dashboard-legend-dot" style="background:#d97706;"></span>Warnings (${rollup.warning})</span>
      <span><span class="dashboard-legend-dot" style="background:var(--danger);"></span>Critical (${rollup.critical})</span>
    </div>
    ${!lastContrastResult ? '<div class="dashboard-breakdown-hint">Run the Contrast Check in Colors for a fuller picture.</div>' : ''}
  `;
  animateDashboardBreakdownFill(el, instant);
}

function refreshDashboardBreakdown(data, siteFilesResult, instant, precomputed) {
  renderDashboardBreakdown(computeIssueRollup(data, siteFilesResult != null ? siteFilesResult : lastSiteFilesResult, precomputed), instant);
}

function showConsistencyPopover(anchorBtn, consistency) {
  const popover = document.getElementById('consistency-popover');
  const wrap = document.querySelector('#tab-panel-overview .dashboard-content');
  if (!popover || !wrap) return;

  const rows = [
    { label: 'Colors', score: consistency.colorScore, detail: `${consistency.colorCount} distinct colors` },
    { label: 'Fonts', score: consistency.fontScore, detail: `${consistency.fontCount} distinct font families` },
    { label: 'Spacing', score: consistency.spacingScore, detail: 'Concentration of margin/padding values' }
  ];

  popover.innerHTML = `
    <div class="dashboard-popover-title">Design Consistency Breakdown</div>
    ${rows.map(r => `
      <div class="dashboard-popover-row">
        <span class="dashboard-popover-row-label">${escapeHtml(r.label)}</span>
        <span class="dashboard-popover-row-score" style="color:${tierColorFor(r.score)};">${r.score}</span>
      </div>
      <div class="dashboard-popover-row-detail">${escapeHtml(r.detail)}</div>
    `).join('')}
  `;

  const rect = anchorBtn.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  popover.style.top = (rect.bottom - wrapRect.top + 6) + 'px';
  popover.style.left = Math.max(0, rect.left - wrapRect.left - 20) + 'px';
  popover.classList.remove('hidden');

  const closeHandler = (e) => {
    if (!popover.contains(e.target) && !anchorBtn.contains(e.target)) closePopover();
  };
  const escHandler = (e) => { if (e.key === 'Escape') closePopover(); };
  function closePopover() {
    popover.classList.add('hidden');
    document.removeEventListener('click', closeHandler, true);
    document.removeEventListener('keydown', escHandler);
  }
  setTimeout(() => {
    document.addEventListener('click', closeHandler, true);
    document.addEventListener('keydown', escHandler);
  }, 0);
}

function animateCountUp(el, target, duration) {
  const token = (el._countUpToken = (el._countUpToken || 0) + 1);
  const startTime = performance.now();
  function tick(now) {
    if (el._countUpToken !== token) return;
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(target * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function animateDashboardBreakdownFill(container, instant) {
  const segments = container.querySelectorAll('.dashboard-breakdown-segment[data-target-width]');
  if (!segments.length) return;
  const reduceMotion = instant || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduceMotion) {
    segments.forEach(seg => { seg.style.width = seg.dataset.targetWidth + '%'; });
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      segments.forEach(seg => { seg.style.width = seg.dataset.targetWidth + '%'; });
    });
  });
}

function animateDashboardEntrance() {
  const overview = document.getElementById('tab-panel-overview');
  if (!overview) return;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const circles = overview.querySelectorAll('.dashboard-ring-progress[data-offset]');
  if (reduceMotion) {
    circles.forEach(c => { c.style.strokeDashoffset = c.dataset.offset; });
  } else {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        circles.forEach(c => { c.style.strokeDashoffset = c.dataset.offset; });
      });
    });
  }

  overview.querySelectorAll('[data-count-target]').forEach(el => {
    const raw = el.dataset.countTarget;
    if (raw === '') { el.textContent = '—'; return; }
    const target = parseInt(raw, 10);
    if (reduceMotion) { el.textContent = target; return; }
    animateCountUp(el, target, 700);
  });
}

function renderDashboard(data, siteFilesResult, isUpdate) {
  const heroEl = document.getElementById('dashboard-hero');
  const ringsEl = document.getElementById('dashboard-rings');
  const statsEl = document.getElementById('dashboard-quick-stats');
  if (!ringsEl) return;

  const seoRes = computeSeoChecklist(data);
  const llmRes = computeLlmVisibilityChecklist(data, siteFilesResult);
  const a11yRes = computeA11yScore(data);
  const dpRes = computeDarkPatternChecklist(data);

  if (isUpdate) {
    updateLlmVisibilityRing(llmRes.score);
  } else {
    const consistency = computeDesignConsistencyScore(data);
    const perfRes = computePerformanceScore(data);

    if (heroEl) {
      heroEl.innerHTML = buildHeroHtml(seoRes);
      const heroBtn = document.getElementById('dashboard-hero-btn');
      if (heroBtn) heroBtn.addEventListener('click', () => jumpToToolsSection('seo-score'));
    }

    const rings = [
      { key: 'consistency', label: 'Design Consistency', score: consistency.overall },
      { key: 'llm-visibility', label: 'LLM Visibility', score: llmRes.score },
      { key: 'accessibility', label: 'Accessibility', score: a11yRes.score },
      { key: 'performance', label: 'Performance', score: perfRes ? perfRes.score : null },
      { key: 'dark-patterns', label: 'Dark Patterns', score: dpRes.score }
    ];

    ringsEl.innerHTML = rings.map(r => buildRingHtml(r.key, r.label, r.score)).join('');
    ringsEl.querySelectorAll('.dashboard-ring').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.ringKey;
        if (key === 'consistency') { showConsistencyPopover(btn, consistency); return; }
        jumpToToolsSection(key);
      });
    });

    if (statsEl) {
      statsEl.innerHTML = buildQuickStatsHtml(data, consistency);
      statsEl.querySelectorAll('.dashboard-stat-chip').forEach(btn => {
        btn.addEventListener('click', () => jumpToToolsSection(btn.dataset.statSection));
      });
    }

    const subtitleEl = document.getElementById('dashboard-subtitle');
    if (subtitleEl) {
      const pageUrl = (data.meta && (data.meta.pageUrl || data.meta.canonical)) || '';
      subtitleEl.textContent = pageUrl ? `Snapshot of ${pageUrl}` : 'Snapshot for this page';
      subtitleEl.title = pageUrl;
    }
  }

  refreshDashboardBreakdown(data, siteFilesResult, isUpdate, { seoRes, llmRes, a11yRes, dpRes });
  if (!isUpdate) animateDashboardEntrance();
}

function updateLlmVisibilityRing(score) {
  const btn = document.querySelector('#dashboard-rings .dashboard-ring[data-ring-key="llm-visibility"]');
  if (!btn) return;

  const color = tierColorFor(score);
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const offset = DASHBOARD_RING_CIRCUMFERENCE * (1 - pct / 100);

  btn.style.setProperty('--ring-color', color);
  btn.classList.remove('tier-good', 'tier-warn', 'tier-critical', 'tier-unknown');
  btn.classList.add(tierClassFor(score));

  const circle = btn.querySelector('.dashboard-ring-progress');
  if (circle) {
    circle.dataset.offset = offset;
    circle.style.stroke = color;
    circle.style.strokeDashoffset = offset;
  }

  const valueEl = btn.querySelector('.dashboard-ring-value');
  if (valueEl) {
    valueEl.style.color = color;
    valueEl.dataset.countTarget = score == null ? '' : score;
    valueEl._countUpToken = (valueEl._countUpToken || 0) + 1;
    valueEl.textContent = score == null ? '—' : String(score);
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const AI_CRAWLER_AGENTS = [
  'GPTBot', 'ChatGPT-User', 'CCBot', 'Google-Extended', 'anthropic-ai', 'ClaudeBot',
  'Claude-Web', 'PerplexityBot', 'Applebot-Extended', 'Bytespider', 'Amazonbot', 'Meta-ExternalAgent'
];

function parseRobotsGroups(text) {
  const groups = [];
  let current = null;
  text.split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.split('#')[0].trim();
    if (!line) { current = null; return; }
    const sepIndex = line.indexOf(':');
    if (sepIndex === -1) return;
    const key = line.slice(0, sepIndex).trim().toLowerCase();
    const value = line.slice(sepIndex + 1).trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value);
    } else if ((key === 'disallow' || key === 'allow') && current) {
      current.rules.push({ type: key, path: value });
    }
  });
  return groups;
}

function findBlockedAiCrawlers(robotsTxt) {
  if (!robotsTxt) return [];
  const groups = parseRobotsGroups(robotsTxt);
  const blocked = [];
  AI_CRAWLER_AGENTS.forEach(agent => {
    const matchingGroups = groups.filter(g => g.agents.some(a => a.toLowerCase() === agent.toLowerCase()));
    const isBlocked = matchingGroups.some(g => g.rules.some(r => r.type === 'disallow' && (r.path === '/' || r.path === '')));
    if (isBlocked) blocked.push(agent);
  });
  return blocked;
}

async function checkSiteFiles(pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch (e) { return null; }

  const result = { robotsTxt: { present: false }, sitemapXml: { present: false } };

  const robotsRes = await fetchWithTimeout(`${origin}/robots.txt`, 6000);
  if (robotsRes && robotsRes.ok) {
    const text = await robotsRes.text();
    result.robotsTxt = {
      present: true,
      size: text.length,
      hasSitemapDirective: /sitemap:/i.test(text),
      blockedAiCrawlers: findBlockedAiCrawlers(text)
    };
  }

  const sitemapRes = await fetchWithTimeout(`${origin}/sitemap.xml`, 6000);
  if (sitemapRes && sitemapRes.ok) {
    const text = await sitemapRes.text();
    const urlCount = (text.match(/<loc>/gi) || []).length;
    result.sitemapXml = { present: true, size: text.length, urlCount };
  }

  return result;
}

function renderSiteFilesCheck(pageUrl, data, generation) {
  // Clear the shared global immediately so anything reading it directly while this
  // page's check is still in flight sees "unknown" instead of the previous page's result.
  lastSiteFilesResult = null;
  renderLlmVisibility(data, null);
  renderDashboard(data, null);

  const container = document.getElementById('site-files-info');
  if (!container) return;
  container.innerHTML = '<div class="meta-item"><div class="meta-value" style="color: var(--text-tertiary);">Checking robots.txt and sitemap.xml…</div></div>';

  checkSiteFiles(pageUrl).then(result => {
    if (generation !== undefined && generation !== extractGeneration) return;
    lastSiteFilesResult = result;
    renderLlmVisibility(data, result);
    renderDashboard(data, result, true);

    if (!result) {
      container.innerHTML = '<div class="empty-state">Could not determine site origin</div>';
      return;
    }
    container.innerHTML = '';

    const robotsDiv = document.createElement('div');
    robotsDiv.className = 'meta-item';
    const robotsColor = result.robotsTxt.present ? 'var(--success)' : 'var(--text-tertiary)';
    const robotsTitleWrap = document.createElement('div');
    robotsTitleWrap.style.display = 'flex';
    robotsTitleWrap.style.alignItems = 'center';
    robotsTitleWrap.style.gap = '8px';
    robotsTitleWrap.style.marginBottom = '6px';

    const robotsLabel = document.createElement('div');
    robotsLabel.className = 'meta-label';
    robotsLabel.style.marginBottom = '0';
    robotsLabel.textContent = 'robots.txt';
    robotsTitleWrap.appendChild(robotsLabel);

    if (result.robotsTxt.present) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'mini-action';
      viewBtn.style.padding = '1px 6px';
      viewBtn.textContent = 'View';
      let origin;
      try { origin = new URL(pageUrl).origin; } catch (e) { }
      viewBtn.onclick = () => window.open(`${origin}/robots.txt`, '_blank');
      robotsTitleWrap.appendChild(viewBtn);
    }

    const robotsValue = document.createElement('div');
    robotsValue.className = 'meta-value';
    robotsValue.style.color = robotsColor;
    robotsValue.textContent = result.robotsTxt.present
      ? `Present (${result.robotsTxt.size} bytes)${result.robotsTxt.hasSitemapDirective ? ', references a sitemap' : ''}`
      : 'Not found';

    robotsDiv.appendChild(robotsTitleWrap);
    robotsDiv.appendChild(robotsValue);
    container.appendChild(robotsDiv);

    const sitemapDiv = document.createElement('div');
    sitemapDiv.className = 'meta-item';
    const sitemapColor = result.sitemapXml.present ? 'var(--success)' : 'var(--text-tertiary)';

    const sitemapTitleWrap = document.createElement('div');
    sitemapTitleWrap.style.display = 'flex';
    sitemapTitleWrap.style.alignItems = 'center';
    sitemapTitleWrap.style.gap = '8px';
    sitemapTitleWrap.style.marginBottom = '6px';

    const sitemapLabel = document.createElement('div');
    sitemapLabel.className = 'meta-label';
    sitemapLabel.style.marginBottom = '0';
    sitemapLabel.textContent = 'sitemap.xml';
    sitemapTitleWrap.appendChild(sitemapLabel);

    if (result.sitemapXml.present) {
      const viewBtn = document.createElement('button');
      viewBtn.className = 'mini-action';
      viewBtn.style.padding = '1px 6px';
      viewBtn.textContent = 'View';
      let origin;
      try { origin = new URL(pageUrl).origin; } catch (e) { }
      viewBtn.onclick = () => window.open(`${origin}/sitemap.xml`, '_blank');
      sitemapTitleWrap.appendChild(viewBtn);
    }

    const sitemapValue = document.createElement('div');
    sitemapValue.className = 'meta-value';
    sitemapValue.style.color = sitemapColor;
    sitemapValue.textContent = result.sitemapXml.present
      ? `Present (${result.sitemapXml.urlCount} URLs listed)`
      : 'Not found at the standard location';

    sitemapDiv.appendChild(sitemapTitleWrap);
    sitemapDiv.appendChild(sitemapValue);
    container.appendChild(sitemapDiv);
  }).catch(() => {
    if (generation !== undefined && generation !== extractGeneration) return;
    container.innerHTML = '<div class="empty-state">Could not check site files</div>';
    const fallbackResult = { robotsTxt: { blockedAiCrawlers: [] } };
    lastSiteFilesResult = fallbackResult;
    renderLlmVisibility(data, fallbackResult);
    renderDashboard(data, fallbackResult, true);
  });
}

const SOCIAL_PLATFORM_META = {
  facebook: { label: 'Facebook', color: '#1877F2' },
  twitter: { label: 'X (Twitter)', color: '#000000' },
  linkedin: { label: 'LinkedIn', color: '#0A66C2' }
};

function buildPlatformBadgeHtml(platform) {
  const meta = SOCIAL_PLATFORM_META[platform];
  if (!meta) return '';
  let noteHtml = '';
  if (platform === 'facebook' || platform === 'linkedin') {
    noteHtml = '<div class="social-platform-note">Facebook and LinkedIn read the same Open Graph tags, so previews look identical by default.</div>';
  }
  return `
    <div class="social-platform-badge" style="--platform-color: ${meta.color};">
      <span class="social-platform-dot"></span>${escapeHtml(meta.label)} preview
    </div>
    ${noteHtml}
  `;
}

function renderSocialPreview(data, platform) {
  const container = document.getElementById('social-preview-container');
  const warningEl = document.getElementById('social-image-warning');
  if (!container) return;

  const og = (data.socialMeta && data.socialMeta.og) || {};
  const twitter = (data.socialMeta && data.socialMeta.twitter) || {};
  const badgeHtml = buildPlatformBadgeHtml(platform);

  let title, desc, image, isSmallCard = false;
  if (platform === 'twitter') {
    title = twitter.title || og.title || data.meta.title || '';
    desc = twitter.description || og.description || data.meta.description || '';
    image = twitter.image || og.image || '';
    isSmallCard = twitter.card === 'summary';
  } else {
    title = og.title || data.meta.title || '';
    desc = og.description || data.meta.description || '';
    image = og.image || '';
  }

  if (warningEl) warningEl.classList.add('hidden');

  if (!title && !desc) {
    container.innerHTML = `${badgeHtml}<div class="empty-state">No social meta tags found for this platform</div>`;
    return;
  }

  // og:image/twitter:image is frequently a site-relative path — resolve it against the
  // scanned page's own origin, not the extension's, or the preview image is always broken.
  if (image) image = resolveAssetUrl(image, data.meta.canonical);

  let domain = 'website.com';
  try { domain = data.meta.canonical ? new URL(data.meta.canonical).hostname : 'website.com'; } catch (e) { }

  container.innerHTML = badgeHtml;
  const card = document.createElement('div');
  card.className = `social-card social-card-${platform}`;
  if (isSmallCard) card.style.display = 'flex';

  if (image) {
    const imgDiv = document.createElement('div');
    imgDiv.className = 'social-card-img';
    imgDiv.style.backgroundImage = `url('${image}')`;
    if (isSmallCard) {
      imgDiv.style.width = '90px';
      imgDiv.style.height = '90px';
      imgDiv.style.flexShrink = '0';
      imgDiv.style.borderBottom = 'none';
      imgDiv.style.borderRight = '1px solid var(--border-color)';
    }
    card.appendChild(imgDiv);
  }

  const content = document.createElement('div');
  content.className = 'social-card-content';
  content.innerHTML = `
    <div class="social-card-domain"></div>
    <div class="social-card-title"></div>
    <div class="social-card-desc"></div>
  `;
  content.querySelector('.social-card-domain').textContent = domain;
  content.querySelector('.social-card-title').textContent = title;
  content.querySelector('.social-card-title').title = title;
  content.querySelector('.social-card-desc').textContent = desc;
  card.appendChild(content);
  container.appendChild(card);

  if (!image) {
    if (warningEl) {
      warningEl.textContent = `No ${platform === 'twitter' ? 'twitter:image' : 'og:image'} found — this link may show without a preview image when shared.`;
      warningEl.classList.remove('hidden');
    }
    return;
  }

  const minSize = isSmallCard ? { w: 144, h: 144 } : { w: 1200, h: 630 };
  const probe = new Image();
  probe.onload = () => {
    if (warningEl && (probe.naturalWidth < minSize.w || probe.naturalHeight < minSize.h)) {
      warningEl.textContent = `Preview image is ${probe.naturalWidth}×${probe.naturalHeight}px — recommended size is at least ${minSize.w}×${minSize.h}px.`;
      warningEl.classList.remove('hidden');
    }
  };
  probe.onerror = () => {
    if (warningEl) {
      warningEl.textContent = 'Preview image failed to load — check the URL is publicly accessible.';
      warningEl.classList.remove('hidden');
    }
  };
  probe.src = image;
}

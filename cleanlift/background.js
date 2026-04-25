const DEFAULT_SETTINGS = {
  outputFormat: 'markdown',
  includeFrontmatter: true,
  includeLinks: true,
  includeImages: true,
  customStripSelectors: '',
  customKeepSelectors: '',
  filenameTemplate: '{title}_{domain}_{date}'
};

const RESTRICTED_PROTOCOLS = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'view-source:', 'devtools:', 'chrome-search:'];

function isRestricted(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    if (RESTRICTED_PROTOCOLS.includes(u.protocol)) return true;
    if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return true;
    return false;
  } catch (_e) {
    return true;
  }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return Object.assign({}, DEFAULT_SETTINGS, stored);
}

async function ensureContentLoaded(tabId) {
  const [{ result: ready }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => !!(window.cleanlift && window.cleanlift.extract)
  });
  if (!ready) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['libs/turndown.js', 'content.js']
    });
  }
}

async function runExtractionInTab(tabId, settings) {
  await ensureContentLoaded(tabId);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (s) => window.cleanlift.extract(s),
    args: [settings]
  });
  return result;
}

async function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    // conflictAction: 'uniquify' — when two pages share a title+date the
    // second download saves as `name (1).md` instead of overwriting the first.
    // This matters for the PRD's 200-page corpus workflow.
    const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
    return id;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function setBadge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#4B46DC', tabId });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
    await chrome.action.setBadgeText({ text: text || '', tabId });
  } catch (_e) {
    // Some Chrome versions don't support setBadgeTextColor; fall back silently
    try { await chrome.action.setBadgeText({ text: text || '', tabId }); } catch (_e2) {}
  }
}

async function handleShortcut() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (isRestricted(tab.url)) {
    await chrome.action.setBadgeText({ text: '!', tabId: tab.id });
    await chrome.action.setBadgeBackgroundColor({ color: '#B91C1C', tabId: tab.id });
    return;
  }

  const settings = await getSettings();
  let result;
  try {
    result = await runExtractionInTab(tab.id, settings);
  } catch (err) {
    console.warn('CleanLift extraction failed', err);
    await chrome.action.setBadgeText({ text: 'ERR', tabId: tab.id });
    await chrome.action.setBadgeBackgroundColor({ color: '#B91C1C', tabId: tab.id });
    return;
  }
  if (!result || result.error) {
    await chrome.action.setBadgeText({ text: 'ERR', tabId: tab.id });
    return;
  }

  // Fail-closed: skip the download for whichever format produced no payload.
  // Mirror the warning state on the badge so the user sees something is off
  // without having to open the popup.
  let wroteAny = false;
  if (settings.outputFormat === 'json' || settings.outputFormat === 'both') {
    if (result.json) {
      await downloadText(result.json, result.filenameJson, 'application/json');
      wroteAny = true;
    }
  }
  if (settings.outputFormat === 'markdown' || settings.outputFormat === 'both') {
    if (result.markdown) {
      await downloadText(result.markdown, result.filenameMd, 'text/markdown');
      wroteAny = true;
    }
  }

  const hasWarning = (result.meta.warnings || []).length > 0
    || (result.meta.readyState && result.meta.readyState !== 'complete')
    || result.meta.lazyAccordionsSuspected;

  if (!wroteAny) {
    await setBadgeError(tab.id, 'ERR');
    return;
  }

  if (hasWarning) {
    // Amber badge so the user knows to open the popup before trusting the file.
    await setBadgeWarn(tab.id, result.meta.tokenBadge || '!');
  } else {
    await setBadge(tab.id, result.meta.tokenBadge);
  }
}

async function setBadgeError(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#B91C1C', tabId });
    await chrome.action.setBadgeText({ text: text || 'ERR', tabId });
  } catch (_e) {}
}

async function setBadgeWarn(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#D97706', tabId });
    await chrome.action.setBadgeText({ text: text || '!', tabId });
  } catch (_e) {}
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'extract-and-download') {
    handleShortcut();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'cleanlift:setBadge') {
    const tabId = msg.tabId || (sender.tab && sender.tab.id);
    setBadge(tabId, msg.text || '').then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'cleanlift:download') {
    downloadText(msg.text, msg.filename, msg.mime || 'text/markdown')
      .then((id) => sendResponse({ ok: true, id }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (current) => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, current);
    chrome.storage.sync.set(merged);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Clear stale token-count badge as soon as the user navigates away from
  // the page that produced it. Only fire on URL change, not every status tick.
  if (changeInfo.url) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});

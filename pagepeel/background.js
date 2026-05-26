const DEFAULT_SETTINGS = {
  outputFormat: 'markdown',
  includeFrontmatter: true,
  includeLinks: true,
  includeImages: true,
  theme: 'auto',
  customStripSelectors: '',
  customKeepSelectors: '',
  perDomainRules: '',
  filenameTemplate: '{title}_{domain}_{date}_{hash}'
};

const RESTRICTED_PROTOCOLS = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'view-source:', 'devtools:', 'chrome-search:'];

const LOG_KEY = 'pagepeel:extractionLog';
const LOG_CAP = 500;

// Per-tab caps for batch extraction. EXTRACT_TIMEOUT_MS bounds a single tab's
// extraction so one hung page can't stall the whole run (and freeze the popup);
// LOAD_WAIT_MS bounds how long we wait for a woken/loading tab to finish before
// extracting anyway. Both are generous for real pages but fail fast on a stuck
// one. (Chrome's 5-min cap is per API call, not per loop, so these are about UX
// and progress, not service-worker survival.)
const EXTRACT_TIMEOUT_MS = 20000;
const LOAD_WAIT_MS = 15000;

function isRestricted(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    if (RESTRICTED_PROTOCOLS.includes(u.protocol)) return true;
    if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return true;
    if (u.hostname === 'chromewebstore.google.com') return true;
    return false;
  } catch (_e) {
    return true;
  }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  // Defensive shape coercion: a corrupt synced record (string→array, etc.)
  // would crash extract() in the page context. Coerce to expected types.
  const merged = Object.assign({}, DEFAULT_SETTINGS, stored);
  for (const key of ['customStripSelectors', 'customKeepSelectors', 'perDomainRules', 'filenameTemplate']) {
    if (typeof merged[key] !== 'string') merged[key] = DEFAULT_SETTINGS[key];
  }
  for (const key of ['includeFrontmatter', 'includeLinks', 'includeImages']) {
    if (typeof merged[key] !== 'boolean') merged[key] = DEFAULT_SETTINGS[key];
  }
  if (!['markdown', 'json', 'both'].includes(merged.outputFormat)) {
    merged.outputFormat = 'markdown';
  }
  if (!['auto', 'light', 'dark'].includes(merged.theme)) {
    merged.theme = 'auto';
  }
  return merged;
}

async function ensureContentLoaded(tabId) {
  const [{ result: ready }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => !!(window.pagepeel && window.pagepeel.extract)
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
    func: (s) => window.pagepeel.extract(s),
    args: [settings]
  });
  return result;
}

// Reject `promise` if it hasn't settled within `ms`. Used so a single hung tab
// (an executeScript that never resolves) fails fast instead of stalling the
// whole batch. The underlying promise is left to settle on its own — we can't
// cancel executeScript — but its result is ignored after the timeout.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error((label || 'operation') + ' timed out after ' + ms + 'ms')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Resolve once tab `tabId` reports status 'complete', or after `timeoutMs`
// (best-effort — never rejects). Handles the case where 'complete' already
// fired before we attached the listener via an immediate chrome.tabs.get check.
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch (_e) {}
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, changeInfo) => {
      if (id === tabId && changeInfo && changeInfo.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      chrome.tabs.onUpdated.addListener(onUpdated);
    } catch (_e) { finish(); return; }
    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === 'complete') finish();
    }).catch(() => {});
  });
}

// Memory Saver discards background tabs once many are open; a discarded tab's
// DOM is gone until reloaded, and executeScript on it has no guarantee of
// running against the finished document. So wake + wait for load before
// extracting. Only *discarded* tabs are reloaded — their live state was already
// evicted by Chrome, so the reload loses nothing the user could still see;
// merely-loading tabs are waited on without a reload. Bounded by LOAD_WAIT_MS;
// on timeout we extract anyway and the page-not-ready gate in runBatchLoop
// catches a still-loading page rather than saving a half-rendered snapshot.
// Returns true if it reloaded a discarded tab (the caller re-asserts the
// in-progress badge in that case, since the reload navigation can trip the
// badge-clear listener).
async function ensureTabAwake(tabId) {
  let t;
  try {
    t = await chrome.tabs.get(tabId);
  } catch (_e) {
    return false; // tab vanished mid-run; the extraction attempt will fail and be logged
  }
  if (!t) return false;
  if (t.discarded) {
    let reloaded = false;
    try { await chrome.tabs.reload(tabId); reloaded = true; } catch (_e) {}
    // Only wait if the reload actually started — otherwise no 'complete' is
    // coming and we'd dead-wait the full LOAD_WAIT_MS for nothing.
    if (reloaded) await waitForTabComplete(tabId, LOAD_WAIT_MS);
    return reloaded;
  }
  if (t.status && t.status !== 'complete') {
    await waitForTabComplete(tabId, LOAD_WAIT_MS);
  }
  return false;
}

// MV3 service workers do not have URL.createObjectURL — it only exists in
// window contexts (the popup has its own downloadText that still uses blobs).
// Encode content as a data URI instead: TextEncoder → UTF-8 bytes → base64.
// Works for the text content PagePeel produces (Markdown, JSON). Practical
// size limit ~2 MB per data URI; a 400 000-word markdown would be needed to
// hit that, well beyond any single course page.
async function downloadText(text, filename, mime) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const url = 'data:' + mime + ';charset=utf-8;base64,' + btoa(binary);
  const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  return id;
}

async function setBadge(tabId, text) {
  try {
    // Brand pink (#eb548e) on the toolbar badge so the success state aligns
    // with the popup's primary action colour.
    await chrome.action.setBadgeBackgroundColor({ color: '#EB548E', tabId });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
    await chrome.action.setBadgeText({ text: text || '', tabId });
  } catch (_e) {
    try { await chrome.action.setBadgeText({ text: text || '', tabId }); } catch (_e2) {}
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
    // Brand-pink-derived wine, slightly darker than the success-badge pink
    // so warn and ok states stay visually distinct without using orange.
    await chrome.action.setBadgeBackgroundColor({ color: '#A8245E', tabId });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
    await chrome.action.setBadgeText({ text: text || '!', tabId });
  } catch (_e) {
    try { await chrome.action.setBadgeText({ text: text || '!', tabId }); } catch (_e2) {}
  }
}

// Append an entry to the extraction-history ring buffer in chrome.storage.local
// so a researcher running 200 extractions can audit "did all 200 succeed?".
async function appendToLog(entry) {
  try {
    const stored = await chrome.storage.local.get(LOG_KEY);
    const log = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
    log.push(entry);
    if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
    await chrome.storage.local.set({ [LOG_KEY]: log });
  } catch (e) {
    console.warn('PagePeel: log append failed', e);
  }
}

function buildLogEntry(tab, source, settings, result) {
  return {
    ts: new Date().toISOString(),
    source, // 'shortcut' | 'batch' (popup builds its own log entry inline)
    tabId: tab && tab.id,
    url: tab && tab.url,
    title: result && result.meta && result.meta.title,
    ok: !!(result && !result.error),
    error: (result && result.error) || null,
    formats: settings.outputFormat,
    filenameMd: result && result.filenameMd,
    filenameJson: result && result.filenameJson,
    charCount: result && result.meta && result.meta.charCount,
    tokens: result && result.meta && result.meta.tokens,
    hash: result && result.meta && result.meta.hash,
    warnings: (result && result.meta && result.meta.warnings) || [],
    readyState: result && result.meta && result.meta.readyState,
    collapsedCount: result && result.meta && result.meta.collapsedCount
  };
}

async function handleShortcut() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (isRestricted(tab.url)) {
    await setBadgeError(tab.id, '!');
    await appendToLog({
      ts: new Date().toISOString(), source: 'shortcut',
      tabId: tab.id, url: tab.url, ok: false, error: 'restricted-url'
    });
    return;
  }

  const settings = await getSettings();
  let result;
  try {
    result = await runExtractionInTab(tab.id, settings);
  } catch (err) {
    console.warn('PagePeel extraction failed', err);
    await setBadgeError(tab.id, 'ERR');
    await appendToLog({
      ts: new Date().toISOString(), source: 'shortcut',
      tabId: tab.id, url: tab.url, ok: false, error: String(err && err.message || err)
    });
    return;
  }

  if (!result || result.error) {
    await setBadgeError(tab.id, 'ERR');
    await appendToLog(buildLogEntry(tab, 'shortcut', settings, result || { error: 'no-result' }));
    return;
  }

  // Readyness gate: shortcut path now refuses to write a download when the
  // page is still loading, so a fast Alt+Shift+E through tabs doesn't
  // silently capture pre-DOMContentLoaded snapshots.
  if (result.meta.readyState && result.meta.readyState !== 'complete') {
    await setBadgeWarn(tab.id, 'WAIT');
    await appendToLog(buildLogEntry(tab, 'shortcut', settings, Object.assign({}, result, {
      error: 'page-not-ready', meta: result.meta
    })));
    return;
  }

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
    || result.meta.lazyAccordionsSuspected;

  if (!wroteAny) {
    await setBadgeError(tab.id, 'ERR');
    await appendToLog(buildLogEntry(tab, 'shortcut', settings, Object.assign({}, result, { error: 'no-output' })));
    return;
  }

  if (hasWarning) {
    await setBadgeWarn(tab.id, result.meta.tokenBadge || '!');
  } else {
    await setBadge(tab.id, result.meta.tokenBadge);
  }
  await appendToLog(buildLogEntry(tab, 'shortcut', settings, result));
}

// Only one batch run at a time. Both the keyboard shortcut and the popup
// button funnel through startBatch(), which claims this lock; a second
// trigger while a run is active is rejected with reason 'busy'.
let batchInFlight = false;

async function collectExtractableTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.filter(t => !isRestricted(t.url));
}

// Broadcast batch progress to the popup. chrome.runtime.sendMessage rejects
// with "Receiving end does not exist" when the popup is closed — that's the
// normal headless case (the batch keeps running regardless), so swallow it.
function emitBatchEvent(message) {
  try {
    const p = chrome.runtime.sendMessage(message);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_e) {}
}

// Extract + download a single tab. Returns 'ok' | 'failed' | 'not-ready'.
// 'not-ready' means the page hadn't finished loading (a just-woken discarded
// tab on a slow server is the usual cause); runBatchLoop gives those one more
// try at the end rather than dropping them.
async function processTab(tab, settings) {
  try {
    await setBadge(tab.id, '…');
    const woke = await ensureTabAwake(tab.id);
    // Waking a discarded tab navigates it, which can clear the in-progress
    // badge via the onUpdated listener below — re-assert it after the wake.
    if (woke) await setBadge(tab.id, '…');
    const result = await withTimeout(runExtractionInTab(tab.id, settings), EXTRACT_TIMEOUT_MS, 'extraction');

    if (!result || result.error) {
      await setBadgeError(tab.id, 'ERR');
      await appendToLog(buildLogEntry(tab, 'batch', settings, result || { error: 'no-result' }));
      return 'failed';
    }
    if (result.meta.readyState && result.meta.readyState !== 'complete') {
      await setBadgeWarn(tab.id, 'WAIT');
      await appendToLog(buildLogEntry(tab, 'batch', settings, Object.assign({}, result, { error: 'page-not-ready' })));
      return 'not-ready';
    }

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

    if (wroteAny) {
      // Token-count badge (not a bare ✓) so the marker is informative AND
      // auto-clears on tab switch via onActivated below, matching the
      // single-tab path. Failures keep ERR/WAIT (sticky) so they stay visible.
      await setBadge(tab.id, result.meta.tokenBadge || '✓');
    } else {
      await setBadgeError(tab.id, 'ERR');
    }
    await appendToLog(buildLogEntry(tab, 'batch', settings, result));
    return wroteAny ? 'ok' : 'failed';
  } catch (err) {
    console.warn('PagePeel batch: tab failed', tab.url, err);
    await setBadgeError(tab.id, 'ERR');
    await appendToLog({
      ts: new Date().toISOString(), source: 'batch',
      tabId: tab.id, url: tab.url, ok: false, error: String(err && err.message || err)
    });
    return 'failed';
  }
}

async function runBatchLoop(extractable) {
  const settings = await getSettings();
  const total = extractable.length;
  let succeeded = 0;
  let failed = 0;
  let done = 0;
  const retry = [];

  for (const tab of extractable) {
    const outcome = await processTab(tab, settings);
    if (outcome === 'ok') succeeded++;
    else if (outcome === 'not-ready') retry.push(tab);
    else failed++;
    done++;
    emitBatchEvent({ type: 'pagepeel:batchProgress', done, total, succeeded, failed });
  }

  // One retry pass for tabs that were still loading when first reached: by now
  // the rest of the batch has given a slow-waking tab time to finish, so a
  // second extraction usually succeeds. This avoids forcing a full re-run to
  // recover them — which would re-download every earlier success as a
  // uniquified duplicate. Bounded: each tab is retried at most once; one still
  // not ready is finally counted failed. No progress events — done == total.
  for (const tab of retry) {
    const outcome = await processTab(tab, settings);
    if (outcome === 'ok') succeeded++;
    else failed++;
  }

  emitBatchEvent({ type: 'pagepeel:batchDone', total, succeeded, failed });
  console.log(`PagePeel batch complete: ${succeeded} succeeded, ${failed} failed out of ${total} tabs`);
  return { total, succeeded, failed };
}

// Shared entry point for the keyboard shortcut and the popup button. The
// guard check and the lock assignment span no await, so two near-simultaneous
// triggers cannot both pass. The loop is started without awaiting it so the
// caller gets an immediate ack carrying the tab count for live progress.
async function startBatch() {
  if (batchInFlight) return { ok: false, reason: 'busy' };
  batchInFlight = true;
  let extractable;
  try {
    extractable = await collectExtractableTabs();
  } catch (_err) {
    batchInFlight = false;
    return { ok: false, reason: 'query-failed' };
  }
  if (!extractable.length) {
    batchInFlight = false;
    return { ok: false, reason: 'no-tabs' };
  }
  runBatchLoop(extractable)
    .catch((err) => {
      // The only await outside runBatchLoop's per-tab try/catch is getSettings();
      // if it rejects the loop ends before emitting anything. Send a terminal
      // event so an open popup recovers instead of hanging on "Saving 0 of N…".
      console.warn('PagePeel batch loop crashed:', err);
      emitBatchEvent({ type: 'pagepeel:batchDone', total: extractable.length, succeeded: 0, failed: extractable.length });
    })
    .finally(() => { batchInFlight = false; });
  return { ok: true, total: extractable.length };
}

async function handleBatchExtract() {
  const ack = await startBatch();
  if (!ack.ok) console.warn('PagePeel batch (shortcut) not started:', ack.reason);
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'extract-and-download') {
    handleShortcut();
  }
  if (command === 'extract-all-tabs') {
    handleBatchExtract();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  // Only accept messages from this extension's own contexts (popup, options,
  // content scripts the extension itself injected). Cross-extension messages
  // are received via onMessageExternal, which we don't register.
  if (sender && sender.id && sender.id !== chrome.runtime.id) return;

  if (msg.type === 'pagepeel:batchExtract') {
    // Ack resolves with { ok, total } once the run has started (or a reason
    // why it didn't); progress then streams back via pagepeel:batchProgress.
    startBatch().then(sendResponse);
    return true;
  }
  if (msg.type === 'pagepeel:setBadge') {
    // Only allow the sender's own tab to be badged; ignore arbitrary tabId.
    const tabId = (sender.tab && sender.tab.id) || msg.tabId;
    if (typeof tabId !== 'number') return;
    setBadge(tabId, String(msg.text || '').slice(0, 8)).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'pagepeel:logExtraction') {
    if (!msg.entry || typeof msg.entry !== 'object') return;
    appendToLog(msg.entry).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'pagepeel:getLog') {
    chrome.storage.local.get(LOG_KEY).then(s => {
      sendResponse({ ok: true, log: s[LOG_KEY] || [] });
    });
    return true;
  }
  if (msg.type === 'pagepeel:clearLog') {
    chrome.storage.local.remove(LOG_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (current) => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, current);
    chrome.storage.sync.set(merged);
  });
  // First-run: open options page so the user sees the welcome card and
  // discovers the keyboard shortcut + per-domain settings.
  if (details && details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});

// Tab switch — clear badge so the count from a previous extraction doesn't
// linger on a different tab. Mitigates SPA-navigation badge staleness when
// the user moves between tabs as part of a 200-page workflow.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.action.getBadgeText({ tabId }).then(text => {
    // Only clear if it looks like a token-count badge (digits or 'k');
    // leave warning/error badges in place so they remain visible.
    if (text && /^\d|k$/.test(text)) {
      chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    }
  }).catch(() => {});
});

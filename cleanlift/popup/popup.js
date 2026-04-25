const DEFAULT_SETTINGS = {
  outputFormat: 'markdown',
  includeFrontmatter: true,
  includeLinks: true,
  includeImages: true,
  customStripSelectors: '',
  customKeepSelectors: '',
  perDomainRules: '',
  filenameTemplate: '{title}_{domain}_{date}_{hash}'
};

const RESTRICTED_PROTOCOLS = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'view-source:', 'devtools:', 'chrome-search:'];

// Restricted-URL check matches background.js so the popup and shortcut paths
// agree on which tabs CleanLift refuses to run in.
function isRestrictedUrl(url) {
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

const $ = (id) => document.getElementById(id);

const els = {
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  meta: $('meta-row'),
  words: $('m-words'),
  chars: $('m-chars'),
  tokens: $('m-tokens'),
  preview: $('preview'),
  warning: $('warning-row'),
  btnMd: $('btn-md'),
  btnJson: $('btn-json'),
  btnCopy: $('btn-copy'),
  openOptions: $('open-options'),
  shortcutLink: $('shortcut-link'),
  strippedDisclosure: $('stripped-disclosure'),
  strippedList: $('stripped-list'),
  strippedSummary: $('stripped-summary')
};

const STRIPPED_LABELS = {
  hidden: 'Hidden elements',
  tagsAlways: 'Scripts / iframes',
  tagsOutsideContent: 'Header / footer / nav (outside article)',
  ariaRoles: 'Navigation / banner / contentinfo roles',
  patternMatched: 'Class/id boilerplate matches',
  customSelectors: 'Custom strip selectors',
  figures: 'Images / figures'
};

function renderStripped(stripped) {
  if (!stripped || !els.strippedDisclosure) return;
  const total = Object.values(stripped).reduce((a, b) => a + (b || 0), 0);
  if (!total) {
    els.strippedDisclosure.hidden = true;
    return;
  }
  els.strippedDisclosure.hidden = false;
  if (els.strippedSummary) els.strippedSummary.textContent = total + ' elements removed';
  const list = els.strippedList;
  if (!list) return;
  list.textContent = '';
  for (const key of Object.keys(STRIPPED_LABELS)) {
    const n = stripped[key] || 0;
    if (!n) continue;
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = STRIPPED_LABELS[key];
    const right = document.createElement('span');
    right.textContent = String(n);
    li.append(left, right);
    list.appendChild(li);
  }
}

let extracted = null;

function setStatus(state, text) {
  els.statusDot.dataset.state = state;
  els.statusText.textContent = text;
  // Mirror state to <body> so the brand-edge stripe colour reflects success/
  // warn/error at a glance.
  document.body.dataset.state = state;
}

function showWarning(text, kind) {
  if (!text) {
    els.warning.hidden = true;
    els.warning.textContent = '';
    delete els.warning.dataset.kind;
    return;
  }
  els.warning.hidden = false;
  els.warning.textContent = text;
  if (kind) els.warning.dataset.kind = kind;
  else delete els.warning.dataset.kind;
}

function clearActionTooltips() {
  for (const btn of [els.btnMd, els.btnJson, els.btnCopy]) {
    if (btn.disabled) {
      btn.title = btn.dataset.disabledReason || 'Unavailable for this extraction.';
    } else {
      btn.title = '';
    }
  }
}

// Kept as a thin alias for legacy callers below.
function isRestricted(url) { return isRestrictedUrl(url); }

function formatNumber(n) {
  return n.toLocaleString();
}

function formatTokens(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function previewText(markdown) {
  const max = 600;
  if (!markdown) return '';
  const noFrontmatter = markdown.replace(/^---[\s\S]*?---\n*/, '');
  if (noFrontmatter.length <= max) return noFrontmatter;
  return noFrontmatter.slice(0, max) + '…';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return Object.assign({}, DEFAULT_SETTINGS, stored);
}

async function runExtraction(tabId, settings) {
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
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (s) => window.cleanlift.extract(s),
    args: [settings]
  });
  return result;
}

async function setBadge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#4B46DC', tabId });
    await chrome.action.setBadgeText({ text: text || '', tabId });
  } catch (_e) {}
}

async function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  let id;
  try {
    id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  // Revoke when the download finishes so the blob doesn't linger in
  // extension-origin memory longer than necessary.
  const onChange = (delta) => {
    if (delta.id === id && delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
      URL.revokeObjectURL(url);
      try { chrome.downloads.onChanged.removeListener(onChange); } catch (_e) {}
    }
  };
  try { chrome.downloads.onChanged.addListener(onChange); } catch (_e) {
    URL.revokeObjectURL(url);
  }
  setTimeout(() => {
    try { chrome.downloads.onChanged.removeListener(onChange); } catch (_e) {}
    URL.revokeObjectURL(url);
  }, 30_000);
  return id;
}

function logExtraction(entry) {
  try {
    chrome.runtime.sendMessage({ type: 'cleanlift:logExtraction', entry });
  } catch (_e) {}
}

function flashButton(btn, label) {
  // Preserve the button's primary/secondary affordance: don't repaint to
  // green. We stamp a small ✓ icon and a 1px success border, then revert.
  const cls = 'cl-btn-success';
  const span = document.createElement('span');
  const tick = document.createElement('span');
  tick.className = 'cl-btn-icon';
  tick.textContent = '✓';
  span.append(tick, document.createTextNode(' ' + label));
  const original = btn.innerHTML;
  btn.innerHTML = '';
  btn.appendChild(span);
  btn.classList.add(cls);
  setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove(cls);
  }, 1400);
}

async function init() {
  const tab = await getActiveTab();
  if (!tab) {
    setStatus('error', 'No active tab.');
    return;
  }
  if (isRestricted(tab.url)) {
    setStatus('error', 'CleanLift can\'t run on this page.');
    showWarning('Browser-internal pages (chrome://, extension pages, the Web Store) cannot be extracted. Try a regular https:// page.', 'error');
    return;
  }

  const settings = await getSettings();
  setStatus('loading', 'Extracting…');

  let result;
  try {
    result = await runExtraction(tab.id, settings);
  } catch (err) {
    console.warn('CleanLift extraction error', err);
    setStatus('error', 'Extraction failed.');
    showWarning(String(err && err.message ? err.message : err), 'error');
    return;
  }

  if (!result || result.error) {
    setStatus('error', 'Extraction failed.');
    showWarning(result && result.error ? result.error : 'Unknown error.', 'error');
    return;
  }

  extracted = { ...result, tabId: tab.id };

  const warnings = [];
  let statusState = 'ok';
  let statusText = 'Ready.';

  if (result.meta.readyState && result.meta.readyState !== 'complete') {
    statusState = 'warn';
    statusText = 'Page still loading.';
    warnings.push('The page reports readyState=' + result.meta.readyState + '. Some content may not be in the DOM yet — wait for full load and re-extract.');
  }
  if (result.meta.lazyAccordionsSuspected) {
    if (statusState === 'ok') { statusState = 'warn'; statusText = 'Collapsed sections detected.'; }
    warnings.push('This page has collapsed accordions/details. Expand them in the page before re-extracting if their content is missing.');
  }
  if (Array.isArray(result.meta.warnings)) {
    for (const w of result.meta.warnings) warnings.push(w.message || String(w));
    if (result.meta.warnings.some(w => w.kind === 'markdown-error' || w.kind === 'json-error')) {
      statusState = 'warn';
      statusText = 'Extraction had errors.';
    }
  }

  setStatus(statusState, statusText);
  els.meta.hidden = false;
  els.words.textContent = formatNumber(result.meta.wordCount);
  els.chars.textContent = formatNumber(result.meta.charCount);
  els.tokens.textContent = '~' + formatTokens(result.meta.tokens);
  els.preview.textContent = result.markdown ? previewText(result.markdown) : '(markdown unavailable — see warning above)';

  els.btnMd.disabled = !result.markdown;
  els.btnJson.disabled = !result.json;
  els.btnCopy.disabled = !result.markdown;

  if (!result.markdown) els.btnMd.dataset.disabledReason = 'Markdown conversion failed for this page.';
  if (!result.json) els.btnJson.dataset.disabledReason = 'JSON build failed for this page.';
  if (!result.markdown) els.btnCopy.dataset.disabledReason = 'Nothing to copy — markdown unavailable.';
  clearActionTooltips();

  if (warnings.length) showWarning(warnings.join(' '));
  renderStripped(result.meta.stripped);

  // Focus the primary action button so Enter triggers Download .md without
  // tabbing past the gear icon. (When btnMd is disabled, focus the next
  // available button.)
  const focusTarget = !els.btnMd.disabled ? els.btnMd
    : !els.btnJson.disabled ? els.btnJson
    : !els.btnCopy.disabled ? els.btnCopy
    : els.openOptions;
  try { focusTarget.focus(); } catch (_e) {}

  await setBadge(tab.id, result.meta.tokenBadge || '');

  logExtraction({
    ts: new Date().toISOString(),
    source: 'popup',
    tabId: tab.id,
    url: tab.url,
    title: result.meta.title,
    ok: true,
    formats: settings.outputFormat,
    filenameMd: result.filenameMd,
    filenameJson: result.filenameJson,
    charCount: result.meta.charCount,
    tokens: result.meta.tokens,
    hash: result.meta.hash,
    warnings: result.meta.warnings || [],
    readyState: result.meta.readyState,
    collapsedCount: result.meta.collapsedCount
  });
}

els.btnMd.addEventListener('click', async () => {
  if (!extracted) return;
  els.btnMd.disabled = true;
  try {
    await downloadText(extracted.markdown, extracted.filenameMd, 'text/markdown');
    flashButton(els.btnMd, 'Saved ✓');
  } catch (err) {
    showWarning('Download failed: ' + (err && err.message ? err.message : err));
  } finally {
    setTimeout(() => { els.btnMd.disabled = false; }, 800);
  }
});

els.btnJson.addEventListener('click', async () => {
  if (!extracted) return;
  els.btnJson.disabled = true;
  try {
    await downloadText(extracted.json, extracted.filenameJson, 'application/json');
    flashButton(els.btnJson, 'Saved ✓');
  } catch (err) {
    showWarning('Download failed: ' + (err && err.message ? err.message : err));
  } finally {
    setTimeout(() => { els.btnJson.disabled = false; }, 800);
  }
});

els.btnCopy.addEventListener('click', async () => {
  if (!extracted) return;
  els.btnCopy.disabled = true;
  try {
    await navigator.clipboard.writeText(extracted.markdown);
    flashButton(els.btnCopy, 'Copied ✓');
  } catch (err) {
    showWarning('Copy failed: ' + (err && err.message ? err.message : err));
  } finally {
    setTimeout(() => { els.btnCopy.disabled = false; }, 800);
  }
});

els.openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

els.shortcutLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

init();

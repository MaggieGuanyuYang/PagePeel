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

const FIELDS = [
  'outputFormat',
  'includeFrontmatter',
  'includeLinks',
  'includeImages',
  'customStripSelectors',
  'customKeepSelectors',
  'perDomainRules',
  'filenameTemplate'
];

const WELCOME_KEY = 'cleanlift:welcomeDismissed';

const $ = (id) => document.getElementById(id);

let dirty = false;
let lastSavedSnapshot = null;

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('cl-status-saved', kind === 'saved');
  el.classList.toggle('cl-status-dirty', kind === 'dirty');
  if (kind === 'saved') {
    setTimeout(() => {
      // Only clear if no further edits happened in the meantime.
      if (!dirty) {
        el.textContent = '';
        el.classList.remove('cl-status-saved');
      }
    }, 2000);
  }
}

function getValue(field) {
  const el = $(field);
  if (!el) return DEFAULT_SETTINGS[field];
  if (el.type === 'checkbox') return el.checked;
  return el.value;
}

function setValue(field, value) {
  const el = $(field);
  if (!el) return;
  if (el.type === 'checkbox') {
    el.checked = !!value;
  } else {
    el.value = value == null ? '' : value;
  }
}

function snapshot() {
  const data = {};
  FIELDS.forEach(f => { data[f] = getValue(f); });
  return JSON.stringify(data);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const merged = Object.assign({}, DEFAULT_SETTINGS, stored);
  FIELDS.forEach(f => setValue(f, merged[f]));
  lastSavedSnapshot = snapshot();
  dirty = false;
}

async function saveSettings() {
  const data = {};
  FIELDS.forEach(f => { data[f] = getValue(f); });
  if (typeof data.filenameTemplate !== 'string' || !data.filenameTemplate.trim()) {
    data.filenameTemplate = DEFAULT_SETTINGS.filenameTemplate;
    setValue('filenameTemplate', data.filenameTemplate);
  }
  await chrome.storage.sync.set(data);
  lastSavedSnapshot = JSON.stringify(data);
  dirty = false;
  setStatus('Saved.', 'saved');
}

async function resetSettings() {
  // Confirm before discarding non-default settings.
  const current = snapshot();
  if (current !== JSON.stringify(DEFAULT_SETTINGS)) {
    const ok = confirm('Reset all settings to defaults? Unsaved changes will be lost.');
    if (!ok) return;
  }
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  FIELDS.forEach(f => setValue(f, DEFAULT_SETTINGS[f]));
  lastSavedSnapshot = snapshot();
  dirty = false;
  setStatus('Reset to defaults.', 'saved');
}

function markDirtyIfChanged() {
  const current = snapshot();
  if (current !== lastSavedSnapshot) {
    dirty = true;
    setStatus('Unsaved changes — they auto-save when you click outside the field.', 'dirty');
  } else {
    dirty = false;
    setStatus('', null);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await maybeShowWelcome();
  $('save').addEventListener('click', saveSettings);
  $('reset').addEventListener('click', resetSettings);
  $('shortcut-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  for (const f of FIELDS) {
    const el = $(f);
    if (!el) continue;
    el.addEventListener('input', () => {
      markDirtyIfChanged();
      validateSelectorField(f);
    });
    el.addEventListener('change', markDirtyIfChanged);
    el.addEventListener('blur', () => {
      if (dirty) saveSettings();
    });
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveSettings();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const viewLog = $('view-log');
  if (viewLog) viewLog.addEventListener('click', openLogViewer);

  const testBtn = $('test-selectors');
  if (testBtn) testBtn.addEventListener('click', testOnCurrentTab);

  const dismiss = $('welcome-dismiss');
  if (dismiss) dismiss.addEventListener('click', dismissWelcome);

  // Initial validation pass for fields with stored content.
  for (const f of ['customStripSelectors', 'customKeepSelectors', 'perDomainRules']) {
    validateSelectorField(f);
  }
});

async function maybeShowWelcome() {
  try {
    const stored = await chrome.storage.local.get(WELCOME_KEY);
    if (stored[WELCOME_KEY]) return;
    const card = $('welcome-card');
    if (card) card.hidden = false;
  } catch (_e) {}
}

async function dismissWelcome() {
  const card = $('welcome-card');
  if (card) card.hidden = true;
  try { await chrome.storage.local.set({ [WELCOME_KEY]: true }); } catch (_e) {}
}

// Validates each line of a selector field. Custom strip/keep accept either
// CSS selectors or class/id name fragments; per-domain rules require
// "hostname: selectors". Surfaces the first invalid line in red help text
// without preventing save (the strip pipeline gracefully skips invalid
// entries thanks to per-selector try/catch).
function validateSelectorField(field) {
  const errEl = $(field + '-error');
  if (!errEl) return;
  const value = getValue(field);
  const errors = [];

  if (field === 'customStripSelectors' || field === 'customKeepSelectors') {
    const lines = String(value || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('.') || line.startsWith('#') || line.startsWith('[') || /[\s>+~]/.test(line)) {
        try { document.querySelector(line); }
        catch (_e) { errors.push(line); }
      }
    }
  } else if (field === 'perDomainRules') {
    const lines = String(value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('#')) continue;
      const idx = line.indexOf(':');
      if (idx < 0) {
        errors.push('Line missing ":" — ' + line.slice(0, 60));
        continue;
      }
      const sels = line.slice(idx + 1).trim();
      try { document.querySelector(sels); }
      catch (_e) { errors.push('Invalid selector — ' + line.slice(0, 80)); }
    }
  }

  if (errors.length) {
    errEl.hidden = false;
    errEl.textContent = 'Issue: ' + errors[0] + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' more)' : '');
  } else {
    errEl.hidden = true;
    errEl.textContent = '';
  }
}

// Runs the strip pipeline against the active tab and reports counts so the
// researcher can verify their selectors hit something before committing to a
// 200-page batch.
async function testOnCurrentTab() {
  const result = $('test-result');
  if (result) result.textContent = 'Running…';
  // Save first so the test runs against the latest selectors.
  if (dirty) await saveSettings();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) { if (result) result.textContent = 'No active tab.'; return; }

    const ready = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!(window.cleanlift && window.cleanlift.extract)
    });
    if (!ready[0] || !ready[0].result) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['libs/turndown.js', 'content.js']
      });
    }

    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const merged = Object.assign({}, DEFAULT_SETTINGS, settings);
    const [{ result: out }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (s) => window.cleanlift.extract(s),
      args: [merged]
    });

    if (!out || out.error) {
      if (result) result.textContent = 'Test failed: ' + ((out && out.error) || 'unknown error');
      return;
    }
    const stripped = out.meta && out.meta.stripped || {};
    const total = Object.values(stripped).reduce((a, b) => a + (b || 0), 0);
    const customCount = stripped.customSelectors || 0;
    if (result) {
      result.textContent = 'Stripped ' + total + ' total elements (' + customCount + ' from your custom selectors). ' +
        out.meta.wordCount + ' words, ~' + out.meta.tokens + ' tokens.';
    }
  } catch (e) {
    if (result) result.textContent = 'Test failed: ' + (e && e.message || e);
  }
}

// Renders the extraction log into a hidden modal-like region inside the
// options page. Read-only; researcher uses it to audit batch completeness.
async function openLogViewer() {
  const region = $('log-region');
  const body = $('log-body');
  if (!region || !body) return;
  region.hidden = false;
  body.textContent = 'Loading…';

  let log = [];
  try {
    const resp = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: 'cleanlift:getLog' }, resolve)
    );
    log = (resp && resp.log) || [];
  } catch (e) {
    body.textContent = 'Failed to load log: ' + (e && e.message || e);
    return;
  }

  if (!log.length) {
    body.textContent = 'No extractions logged yet.';
    return;
  }

  const ok = log.filter(e => e.ok).length;
  const fail = log.length - ok;
  const summary = log.length + ' extractions logged: ' + ok + ' ok, ' + fail + ' failed.';
  $('log-summary').textContent = summary;

  body.textContent = '';
  const table = document.createElement('table');
  table.className = 'cl-log-table';
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Time</th><th>URL</th><th>Status</th><th>Tokens</th><th>Notes</th></tr>';
  table.appendChild(head);
  const tbody = document.createElement('tbody');
  for (const e of log.slice().reverse()) {
    const tr = document.createElement('tr');
    const ts = document.createElement('td');
    ts.textContent = e.ts ? e.ts.replace('T', ' ').slice(0, 19) : '';
    const url = document.createElement('td');
    url.textContent = e.url || '';
    url.title = e.url || '';
    url.className = 'cl-log-url';
    const st = document.createElement('td');
    st.textContent = e.ok ? '✓' : (e.error ? '✗ ' + e.error : '✗');
    st.className = e.ok ? 'cl-log-ok' : 'cl-log-fail';
    const tk = document.createElement('td');
    tk.textContent = e.tokens != null ? String(e.tokens) : '';
    const notes = document.createElement('td');
    const w = (e.warnings || []).map(w => w.kind || '').filter(Boolean).join(', ');
    notes.textContent = [e.collapsedCount ? e.collapsedCount + ' collapsed' : '', w].filter(Boolean).join('; ');
    tr.append(ts, url, st, tk, notes);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);

  const closeBtn = $('log-close');
  if (closeBtn) closeBtn.onclick = () => { region.hidden = true; };

  const exportBtn = $('log-export');
  if (exportBtn) exportBtn.onclick = () => {
    const jsonl = log.map(e => JSON.stringify(e)).join('\n');
    const blob = new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = 'cleanlift-log-' + new Date().toISOString().slice(0, 10) + '.jsonl';
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  };

  const clearBtn = $('log-clear');
  if (clearBtn) clearBtn.onclick = async () => {
    if (!confirm('Clear all logged extractions? This cannot be undone.')) return;
    await new Promise(r => chrome.runtime.sendMessage({ type: 'cleanlift:clearLog' }, r));
    body.textContent = 'Log cleared.';
    $('log-summary').textContent = '';
  };
}

const DEFAULT_SETTINGS = {
  outputFormat: 'markdown',
  includeFrontmatter: true,
  includeLinks: true,
  includeImages: true,
  customStripSelectors: '',
  customKeepSelectors: '',
  filenameTemplate: '{title}_{domain}_{date}'
};

const FIELDS = [
  'outputFormat',
  'includeFrontmatter',
  'includeLinks',
  'includeImages',
  'customStripSelectors',
  'customKeepSelectors',
  'filenameTemplate'
];

const $ = (id) => document.getElementById(id);

function setStatus(text, saved) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('cl-status-saved', !!saved);
  if (saved) {
    setTimeout(() => {
      el.textContent = '';
      el.classList.remove('cl-status-saved');
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

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const merged = Object.assign({}, DEFAULT_SETTINGS, stored);
  FIELDS.forEach(f => setValue(f, merged[f]));
}

async function saveSettings() {
  const data = {};
  FIELDS.forEach(f => { data[f] = getValue(f); });
  if (!data.filenameTemplate || !data.filenameTemplate.trim()) {
    data.filenameTemplate = DEFAULT_SETTINGS.filenameTemplate;
    setValue('filenameTemplate', data.filenameTemplate);
  }
  await chrome.storage.sync.set(data);
  setStatus('Saved.', true);
}

async function resetSettings() {
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  FIELDS.forEach(f => setValue(f, DEFAULT_SETTINGS[f]));
  setStatus('Reset to defaults.', true);
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  $('save').addEventListener('click', saveSettings);
  $('reset').addEventListener('click', resetSettings);
  $('shortcut-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // Save on Enter inside text inputs
  document.querySelectorAll('input[type="text"]').forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveSettings();
    });
  });
});

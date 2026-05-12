'use strict';

// ─── State ─────────────────────────────────────────────────────────────────────

let state = {
  screen: 'main', // 'setup' | 'main' | 'result' | 'settings'
  apiKey: null,
  result: null,    // { shortUrl, destination }
};

// ─── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const screens = {
  setup:    $('screen-setup'),
  main:     $('screen-main'),
  result:   $('screen-result'),
  settings: $('screen-settings'),
};

// ─── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await fillActiveTab();
  renderScreen();
  wireEvents();
  if (state.screen === 'main') loadRecent();
});

async function loadSettings() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  state.apiKey = apiKey || null;
  // First-ever open → show setup; afterwards go straight to main
  const { setupDone } = await chrome.storage.local.get('setupDone');
  state.screen = setupDone ? 'main' : 'setup';
}

async function fillActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
      $('input-url').value = tab.url;
    }
  } catch { /* activeTab not granted yet */ }
}

// ─── Render ────────────────────────────────────────────────────────────────────

function renderScreen() {
  Object.entries(screens).forEach(([name, el]) => {
    el.classList.toggle('hidden', name !== state.screen);
  });

  if (state.screen === 'main') {
    // Show/hide connected badge
    $('account-badge').classList.toggle('hidden', !state.apiKey);
    // Show/hide slug input (only available with API key)
    $('slug-row').classList.toggle('hidden', !state.apiKey);
  }

  if (state.screen === 'result' && state.result) {
    const { shortUrl, destination } = state.result;
    $('result-url').textContent = shortUrl;
    $('result-url').href = shortUrl;
    $('result-destination').textContent = destination;
  }

  if (state.screen === 'settings') {
    $('settings-connected').classList.toggle('hidden', !state.apiKey);
    $('settings-disconnected').classList.toggle('hidden', !!state.apiKey);
  }
}

// ─── Wire events ───────────────────────────────────────────────────────────────

function wireEvents() {
  // ── Setup screen ────────────────────────────────────────────────────────────
  $('btn-toggle-key').addEventListener('click', () => {
    const input = $('input-apikey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('icon-eye').classList.toggle('hidden', show);
    $('icon-eye-off').classList.toggle('hidden', !show);
  });

  $('form-setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('input-apikey').value.trim();
    if (!key) return showError('setup-error', 'Please enter an API key.');

    $('btn-connect').disabled = true;
    hideError('setup-error');

    try {
      await validateAndSaveKey(key);
      state.apiKey = key;
      state.screen = 'main';
      await chrome.storage.local.set({ setupDone: true });
      renderScreen();
      loadRecent();
    } catch (err) {
      showError('setup-error', err.message);
    } finally {
      $('btn-connect').disabled = false;
    }
  });

  $('btn-guest').addEventListener('click', async () => {
    await chrome.storage.local.set({ setupDone: true });
    state.screen = 'main';
    renderScreen();
    loadRecent();
  });

  // ── Main screen ─────────────────────────────────────────────────────────────
  $('btn-settings').addEventListener('click', () => {
    state.screen = 'settings';
    renderScreen();
  });

  $('form-shorten').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url  = $('input-url').value.trim();
    const slug = $('input-slug').value.trim();

    if (!url) return showError('shorten-error', 'Please enter a URL.');
    if (!isValidUrl(url)) return showError('shorten-error', 'Please enter a valid http(s) URL.');

    hideError('shorten-error');
    setShortenLoading(true);

    try {
      const shortUrl = await chrome.runtime.sendMessageAsync({ type: 'SHORTEN', url, slug });
      if (!shortUrl.ok) throw new Error(shortUrl.error);
      state.result = { shortUrl: shortUrl.shortUrl, destination: url };
      state.screen = 'result';
      renderScreen();
      // Auto-copy
      copyToClipboard(shortUrl.shortUrl, $('btn-copy-result'), $('copy-label'));
    } catch (err) {
      showError('shorten-error', err.message || 'Could not shorten the URL. Please try again.');
    } finally {
      setShortenLoading(false);
    }
  });

  // ── Result screen ────────────────────────────────────────────────────────────
  $('btn-back').addEventListener('click', () => {
    state.screen = 'main';
    renderScreen();
    loadRecent();
  });

  $('btn-copy-result').addEventListener('click', () => {
    if (!state.result) return;
    copyToClipboard(state.result.shortUrl, $('btn-copy-result'), $('copy-label'));
  });

  $('btn-shorten-another').addEventListener('click', () => {
    state.result = null;
    state.screen = 'main';
    $('input-url').value = '';
    $('input-slug').value = '';
    renderScreen();
    loadRecent();
    // Re-fill from active tab
    fillActiveTab();
  });

  // ── Settings screen ──────────────────────────────────────────────────────────
  $('btn-settings-back').addEventListener('click', () => {
    state.screen = 'main';
    renderScreen();
  });

  $('btn-disconnect').addEventListener('click', async () => {
    await chrome.storage.local.remove('apiKey');
    state.apiKey = null;
    state.screen = 'main';
    renderScreen();
  });

  $('btn-connect-from-settings').addEventListener('click', () => {
    state.screen = 'setup';
    renderScreen();
  });
}

// ─── API helpers ───────────────────────────────────────────────────────────────

async function validateAndSaveKey(key) {
  // Make a lightweight authenticated request to confirm the key works
  const res = await fetch('https://alias.live/api/v1/links?limit=1', {
    headers: { 'X-Api-Key': key },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('Invalid API key. Please check and try again.');
  }
  if (!res.ok) {
    throw new Error(`Could not verify key (HTTP ${res.status}). Try again.`);
  }
  await chrome.storage.local.set({ apiKey: key });
}

// ─── Recent links ───────────────────────────────────────────────────────────────

async function loadRecent() {
  const response = await sendMessage({ type: 'GET_RECENT' });
  const recent = response?.recent || [];

  const section = $('recent-section');
  const list = $('recent-list');
  list.innerHTML = '';

  if (!recent.length) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  recent.slice(0, 5).forEach(({ shortUrl, destination }) => {
    const li = document.createElement('li');
    li.className = 'recent-item';

    const slug = shortUrl.replace('https://alias.live/', '');

    li.innerHTML = `
      <a href="${escapeHtml(shortUrl)}" target="_blank" rel="noopener" class="recent-short" title="${escapeHtml(shortUrl)}">
        ${escapeHtml(slug)}
      </a>
      <span class="recent-dest" title="${escapeHtml(destination)}">${escapeHtml(destination)}</span>
      <button class="icon-btn recent-copy-btn" title="Copy">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      </button>`;

    li.querySelector('.recent-copy-btn').addEventListener('click', (e) => {
      copyToClipboard(shortUrl, e.currentTarget, null);
    });

    list.appendChild(li);
  });
}

// ─── Clipboard ─────────────────────────────────────────────────────────────────

async function copyToClipboard(text, btn, labelEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      btn.classList.add('copied');
      if (labelEl) labelEl.textContent = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        if (labelEl) labelEl.textContent = 'Copy';
      }, 2000);
    }
  } catch {
    // Fallback: ask service worker
    await sendMessage({ type: 'COPY', text });
  }
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

function setShortenLoading(loading) {
  $('btn-shorten').disabled = loading;
  $('btn-shorten-text').classList.toggle('hidden', loading);
  $('btn-shorten-spinner').classList.toggle('hidden', !loading);
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(id) {
  $(id).classList.add('hidden');
}

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Message passing ───────────────────────────────────────────────────────────

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

// Promisify chrome.runtime.sendMessage for SHORTEN (needs response handling)
chrome.runtime.sendMessageAsync = (msg) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────────

const DOMAIN_OPTIONS = ['2shr.ink', 'alias.live'];
const DEFAULT_DOMAIN = '2shr.ink';
const API_BASE = 'https://alias.live/api/v1';
const SITE_URL = 'https://aliasurlshortener.com';

/** Relative expiry presets → an absolute ISO timestamp the API accepts. */
const EXPIRY_MS = { '1h': 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };

const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

// ─── State ─────────────────────────────────────────────────────────────────────

let state = {
  screen: 'main', // 'setup' | 'main' | 'result' | 'settings' | 'limit' | 'expand'
  apiKey: null,
  domain: DEFAULT_DOMAIN,
  result: null,    // { shortUrl, destination }
  expansion: null, // { final_url, hops[] }
};

// ─── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const screens = {
  setup:    $('screen-setup'),
  main:     $('screen-main'),
  result:   $('screen-result'),
  settings: $('screen-settings'),
  limit:    $('screen-limit'),
  expand:   $('screen-expand'),
};

/**
 * Swap every marked node for its translation.
 *
 * The markup keeps its English text so the file still reads as a page, and
 * this replaces it on load. A missing message falls back to the key, which is
 * visible in review rather than silently blank.
 */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.documentElement.lang = chrome.i18n.getUILanguage?.().split('-')[0] || 'en';
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  await loadSettings();
  await fillActiveTab();
  renderScreen();
  wireEvents();
  if (state.screen === 'main') loadRecent();
});

async function loadSettings() {
  const { apiKey, shortDomain, setupDone } = await chrome.storage.local.get(['apiKey', 'shortDomain', 'setupDone']);
  state.apiKey = apiKey || null;
  state.domain = DOMAIN_OPTIONS.includes(shortDomain) ? shortDomain : DEFAULT_DOMAIN;
  // First-ever open → show setup; afterwards go straight to main
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
    // Slug, password and expiry all need an account.
    $('slug-row').classList.toggle('hidden', !state.apiKey);
    $('advanced-row').classList.toggle('hidden', !state.apiKey);
    // Keep slug prefix in sync with chosen domain
    $('slug-prefix-text').textContent = `${state.domain}/`;
  }

  if (state.screen === 'result' && state.result) {
    const { shortUrl, destination } = state.result;
    $('result-url').textContent = shortUrl;
    $('result-url').href = shortUrl;
    $('result-destination').textContent = destination;
  }

  if (state.screen === 'expand' && state.expansion) {
    renderExpansion(state.expansion);
  }

  if (state.screen === 'settings') {
    $('settings-connected').classList.toggle('hidden', !state.apiKey);
    $('settings-disconnected').classList.toggle('hidden', !!state.apiKey);
    renderDomainPicker();
  }
}

function renderDomainPicker() {
  document.querySelectorAll('#domain-picker .domain-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.domain === state.domain);
  });
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
    if (!key) return showError('setup-error', t('enterKey'));

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

  $('btn-advanced').addEventListener('click', () => {
    $('advanced-fields').classList.toggle('hidden');
  });

  $('btn-expand').addEventListener('click', async () => {
    const url = $('input-url').value.trim();
    if (!url) return showError('shorten-error', t('enterUrl'));
    if (!isValidUrl(url)) return showError('shorten-error', t('invalidUrl'));

    hideError('shorten-error');
    $('btn-expand').disabled = true;
    $('btn-expand').textContent = t('expandInProgress');
    try {
      await expandCurrentUrl(url);
    } catch (err) {
      showError('shorten-error', err.message || t('expandFailed'));
    } finally {
      $('btn-expand').disabled = false;
      $('btn-expand').textContent = t('expandTitle');
    }
  });

  $('form-shorten').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('input-url').value.trim();

    if (!url) return showError('shorten-error', t('enterUrl'));
    if (!isValidUrl(url)) return showError('shorten-error', t('invalidUrl'));

    hideError('shorten-error');
    setShortenLoading(true);

    try {
      const res = await sendMessage({
        type: 'SHORTEN',
        destination: url,
        slug: $('input-slug').value.trim(),
        password: $('input-password').value.trim(),
        expiresAt: expiresAtFromPreset($('select-expiry').value),
        domain: state.domain,
      });
      if (!res?.ok) {
        // A guest out of links gets the offer, not an error they cannot act on.
        if (res?.code === 'RATE_LIMITED' && !state.apiKey) {
          state.screen = 'limit';
          renderScreen();
          return;
        }
        throw new Error(res?.error || t('shortenFailed'));
      }
      state.result = { shortUrl: res.shortUrl, destination: url };
      state.screen = 'result';
      renderScreen();
      // Auto-copy
      copyToClipboard(res.shortUrl, $('btn-copy-result'), $('copy-label'));
    } catch (err) {
      showError('shorten-error', err.message || t('shortenFailed'));
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
    $('input-password').value = '';
    $('select-expiry').value = '';
    renderScreen();
    loadRecent();
    // Re-fill from active tab
    fillActiveTab();
  });

  // ── Domain picker ────────────────────────────────────────────────────────────
  document.querySelectorAll('#domain-picker .domain-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const chosen = btn.dataset.domain;
      if (chosen === state.domain) return;
      state.domain = chosen;
      await chrome.storage.local.set({ shortDomain: chosen });
      renderDomainPicker();
      // Also update slug prefix if user goes back to main
      $('slug-prefix-text').textContent = `${state.domain}/`;
    });
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

  // ── Guest-limit upsell ───────────────────────────────────────────────────────
  $('btn-limit-dismiss').addEventListener('click', () => {
    state.screen = 'main';
    renderScreen();
  });
  $('btn-limit-cta').href = `${SITE_URL}/register`;

  // ── Expander ─────────────────────────────────────────────────────────────────
  $('btn-expand-back').addEventListener('click', () => {
    state.expansion = null;
    state.screen = 'main';
    renderScreen();
    loadRecent();
  });
}

// ─── Expander ──────────────────────────────────────────────────────────────────

function renderExpansion({ final_url, hops = [] }) {
  $('expand-final').textContent = final_url;
  $('expand-final').href = final_url;

  const list = $('expand-hops');
  list.innerHTML = '';
  hops.forEach(({ url, status, ms }) => {
    const li = document.createElement('li');
    li.className = 'expand-hop';

    const a = document.createElement('span');
    a.className = 'expand-hop-url';
    a.textContent = url;
    a.title = url;

    const meta = document.createElement('span');
    meta.className = 'expand-hop-meta';
    // ms is absent for a hop that was never fetched — showing 0 there would
    // claim a speed nobody measured.
    meta.textContent = ms === undefined ? String(status) : `${status} · ${t('expandTook', [String(ms)])}`;

    li.append(a, meta);
    list.appendChild(li);
  });
}

/** Ask the service worker to resolve a short link's redirect chain. */
async function expandCurrentUrl(url) {
  const res = await sendMessage({ type: 'EXPAND', url });
  if (!res?.ok) throw new Error(res?.error || t('expandFailed'));
  state.expansion = res.result;
  state.screen = 'expand';
  renderScreen();
}

/** A preset like '7d' → the absolute ISO timestamp the API wants. */
function expiresAtFromPreset(preset) {
  const ms = EXPIRY_MS[preset];
  return ms ? new Date(Date.now() + ms).toISOString() : undefined;
}

// ─── API helpers ───────────────────────────────────────────────────────────────

async function validateAndSaveKey(key) {
  // Make a lightweight authenticated request to confirm the key works
  const res = await fetch(`${API_BASE}/links?limit=1`, {
    headers: { 'X-Api-Key': key },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(t('keyInvalid'));
  }
  if (!res.ok) {
    throw new Error(t('keyUnverified', [String(res.status)]));
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

  // Say when the list is the account's history rather than this browser's.
  $('recent-synced').classList.toggle('hidden', !recent.some(r => r.synced));

  if (!recent.length) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  recent.slice(0, 5).forEach(({ shortUrl, destination }) => {
    const li = document.createElement('li');
    li.className = 'recent-item';

    const slug = shortUrl.replace(/^https?:\/\/[^/]+\//, '');

    li.innerHTML = `
      <a href="${escapeHtml(shortUrl)}" target="_blank" rel="noopener" class="recent-short" title="${escapeHtml(shortUrl)}">
        ${escapeHtml(slug)}
      </a>
      <span class="recent-dest" title="${escapeHtml(destination)}">${escapeHtml(destination)}</span>
      <button class="icon-btn recent-copy-btn" title="${escapeHtml(t('copy'))}">
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
      if (labelEl) labelEl.textContent = t('copied');
      setTimeout(() => {
        btn.classList.remove('copied');
        if (labelEl) labelEl.textContent = t('copy');
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
    chrome.runtime.sendMessage(msg, (response) => {
      // A dead port resolves undefined rather than throwing at the call site.
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}


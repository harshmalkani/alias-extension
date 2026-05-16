'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_HOST   = 'alias.live'; // backend always reachable via alias.live
const API_BASE   = `https://${API_HOST}/api/v1`;
const RECENT_MAX = 20;

// ─── Install — create context menus ───────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'alias-shorten-page',
    title: 'Shorten this page URL',
    contexts: ['page', 'frame'],
  });
  chrome.contextMenus.create({
    id: 'alias-shorten-link',
    title: 'Shorten this link',
    contexts: ['link'],
  });
});

// ─── Context menu handler ──────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info) => {
  const url = info.menuItemId === 'alias-shorten-link'
    ? info.linkUrl
    : info.pageUrl;

  if (!url) return;

  try {
    const { shortDomain } = await chrome.storage.local.get('shortDomain');
    const shortUrl = await shortenUrl(url, null, shortDomain);
    await saveToRecent(shortUrl, url);
    await copyViaOffscreen(shortUrl);
    notify('Copied!', shortUrl, 'success');
  } catch (err) {
    notify('Could not shorten', err.message || 'An error occurred', 'error');
  }
});

// ─── Message bus (popup → service worker) ─────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SHORTEN') {
    shortenUrl(message.url, message.slug, message.domain)
      .then(shortUrl => saveToRecent(shortUrl, message.url).then(() => sendResponse({ ok: true, shortUrl })))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep port open for async response
  }

  if (message.type === 'COPY') {
    copyViaOffscreen(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_RECENT') {
    chrome.storage.local.get('recent')
      .then(({ recent = [] }) => sendResponse({ ok: true, recent }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ─── Core API ─────────────────────────────────────────────────────────────────

async function shortenUrl(destination, slug, domain = '2shr.ink') {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  // Validate domain — fall back to default if somehow invalid
  const shortDomain = ['2shr.ink', 'alias.live'].includes(domain) ? domain : '2shr.ink';
  const shortBase = `https://${shortDomain}`;

  if (apiKey) {
    // Authenticated: supports custom slug, links saved to account
    const body = { destination, domain: shortDomain };
    if (slug && slug.trim()) body.slug = slug.trim();

    const res = await fetch(`${API_BASE}/customShort`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return `${shortBase}/${data.data.slug}`;
  } else {
    // Guest: random slug, not tied to any account
    const res = await fetch(`https://${API_HOST}/randomShort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination, domain: shortDomain }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return `${shortBase}/${data.data.slug}`;
  }
}

// ─── Storage helpers ───────────────────────────────────────────────────────────

async function saveToRecent(shortUrl, destination) {
  const { recent = [] } = await chrome.storage.local.get('recent');
  // Deduplicate by destination
  const filtered = recent.filter(r => r.destination !== destination);
  const updated = [{ shortUrl, destination, ts: Date.now() }, ...filtered].slice(0, RECENT_MAX);
  await chrome.storage.local.set({ recent: updated });
}

// ─── Clipboard via offscreen document ─────────────────────────────────────────

async function copyViaOffscreen(text) {
  // chrome.offscreen.hasDocument() is Chrome 116+; fall back to try/catch.
  let hasDoc = false;
  if (typeof chrome.offscreen?.hasDocument === 'function') {
    hasDoc = await chrome.offscreen.hasDocument();
  }

  if (!hasDoc) {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['CLIPBOARD'],
        justification: 'Copy shortened URL to clipboard',
      });
    } catch (e) {
      if (!e.message?.includes('Only a single offscreen')) throw e;
    }
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Clipboard timeout')), 3000);
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_COPY', text }, (response) => {
      clearTimeout(timeout);
      if (response?.ok) resolve();
      else reject(new Error(response?.error || 'Clipboard write failed'));
    });
  });
}

// ─── Notifications ─────────────────────────────────────────────────────────────

function notify(title, message, type) {
  chrome.notifications.create(`alias-${Date.now()}`, {
    type: 'basic',
    iconUrl: type === 'error' ? '../icons/icon48.png' : '../icons/icon48.png',
    title,
    message,
    priority: 1,
  });
}

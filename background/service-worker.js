'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_HOST   = 'alias.live'; // backend always reachable via alias.live
const API_BASE   = `https://${API_HOST}/api/v1`;
const SITE_URL   = 'https://aliasurlshortener.com';
const RECENT_MAX = 20;
const SHORT_DOMAINS = ['2shr.ink', 'alias.live'];
const DEFAULT_DOMAIN = '2shr.ink';

const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

// ─── Install — create context menus ───────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'alias-shorten-page',
    title: t('menuShortenPage'),
    contexts: ['page', 'frame'],
  });
  chrome.contextMenus.create({
    id: 'alias-shorten-link',
    title: t('menuShortenLink'),
    contexts: ['link'],
  });
  // The website's URL expander, reachable where you actually meet a short link:
  // on someone else's page, before you click it.
  chrome.contextMenus.create({
    id: 'alias-expand-link',
    title: t('menuExpandLink'),
    contexts: ['link'],
  });
});

// ─── Context menu handler ──────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'alias-expand-link') {
    if (!info.linkUrl) return;
    try {
      const result = await expandUrl(info.linkUrl);
      notify(t('notifExpandTitle'), result.final_url);
    } catch (err) {
      notify(t('notifExpandFailed'), err.message || t('errorGeneric'));
    }
    return;
  }

  const url = info.menuItemId === 'alias-shorten-link'
    ? info.linkUrl
    : info.pageUrl;

  if (!url) return;

  try {
    const { shortDomain } = await chrome.storage.local.get('shortDomain');
    const shortUrl = await shortenUrl({ destination: url, domain: shortDomain });
    await saveToRecent(shortUrl, url);
    await copyViaOffscreen(shortUrl);
    notify(t('notifCopied'), shortUrl);
  } catch (err) {
    // A guest who has run out gets the same offer the website makes, rather
    // than a raw API string they cannot act on.
    if (err.code === 'RATE_LIMITED' && !(await hasApiKey())) {
      notify(t('notifLimitTitle'), t('notifLimitBody'));
      return;
    }
    notify(t('notifShortenFailed'), err.message || t('errorGeneric'));
  }
});

// ─── Message bus (popup → service worker) ─────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SHORTEN') {
    shortenUrl(message)
      .then(shortUrl => saveToRecent(shortUrl, message.destination).then(() => sendResponse({ ok: true, shortUrl })))
      .catch(err => sendResponse({ ok: false, error: err.message, code: err.code }));
    return true; // keep port open for async response
  }

  if (message.type === 'EXPAND') {
    expandUrl(message.url)
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'COPY') {
    copyViaOffscreen(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_RECENT') {
    getRecent()
      .then(recent => sendResponse({ ok: true, recent }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ─── Core API ─────────────────────────────────────────────────────────────────

/** An API failure that carries the server's error code, so callers can branch. */
function apiError(data, status) {
  const err = new Error(data?.error?.message || `HTTP ${status}`);
  err.code = data?.error?.code;
  return err;
}

async function hasApiKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  return !!apiKey;
}

async function shortenUrl({ destination, slug, domain, password, expiresAt }) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  // Validate domain — fall back to default if somehow invalid
  const shortDomain = SHORT_DOMAINS.includes(domain) ? domain : DEFAULT_DOMAIN;
  const shortBase = `https://${shortDomain}`;

  if (apiKey) {
    // Authenticated: custom slug, password and expiry, links saved to account
    const body = { destination, domain: shortDomain };
    if (slug && slug.trim()) body.slug = slug.trim();
    if (password && password.trim()) body.password = password.trim();
    if (expiresAt) body.expires_at = expiresAt;

    const res = await fetch(`${API_BASE}/customShort`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw apiError(data, res.status);
    return `${shortBase}/${data.data.slug}`;
  } else {
    // Guest: random slug, not tied to any account
    const res = await fetch(`https://${API_HOST}/randomShort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination, domain: shortDomain }),
    });
    const data = await res.json();
    if (!res.ok) throw apiError(data, res.status);
    return `${shortBase}/${data.data.slug}`;
  }
}

/** Resolve a short link's redirect chain. Public endpoint — no key needed. */
async function expandUrl(url) {
  const res = await fetch(`${API_BASE}/expand?url=${encodeURIComponent(url)}`);
  const data = await res.json();
  if (!res.ok) throw apiError(data, res.status);
  return data.data;
}

// ─── Recent links ──────────────────────────────────────────────────────────────

/**
 * The popup's recent list.
 *
 * With a key connected this is the account's real history, which is what the
 * website promises the extension does; the locally-stored list is the fallback
 * for guests and for when the request fails. Merging rather than replacing
 * keeps a link created seconds ago visible before the account list catches up.
 */
async function getRecent() {
  const { recent = [], apiKey } = await chrome.storage.local.get(['recent', 'apiKey']);
  if (!apiKey) return recent;

  try {
    const res = await fetch(`${API_BASE}/links?limit=10&sort=newest`, {
      headers: { 'X-Api-Key': apiKey },
    });
    if (!res.ok) return recent;
    const data = await res.json();
    const rows = data?.data?.result ?? [];

    const fromAccount = rows.map(row => ({
      shortUrl: `https://${SHORT_DOMAINS.includes(row.domain) ? row.domain : DEFAULT_DOMAIN}/${row.slug}`,
      destination: row.destination,
      ts: row.created_at ? Date.parse(row.created_at) : 0,
      synced: true,
    }));

    const seen = new Set(fromAccount.map(r => r.shortUrl));
    const merged = [...fromAccount, ...recent.filter(r => !seen.has(r.shortUrl))];
    return merged.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, RECENT_MAX);
  } catch {
    return recent;
  }
}

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

function notify(title, message) {
  chrome.notifications.create(`alias-${Date.now()}`, {
    type: 'basic',
    // An absolute extension URL: a relative path here is resolved against the
    // extension root, not this script, so '../icons/…' pointed outside the
    // package and the notification rendered without its icon.
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title,
    message,
    priority: 1,
  });
}

// Exposed for the popup's "create a free account" link.
self.ALIAS_SITE_URL = SITE_URL;

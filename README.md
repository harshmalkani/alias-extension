# Alias Browser Extension

A Manifest V3 extension for Chrome and Edge that shortens any URL with
[Alias](https://aliasurlshortener.com) in one click.

## Features

- **Popup** — shorten the current tab's URL; paste any URL manually
- **Custom slug, password and expiry** — when you connect an account (requires API key)
- **Right-click menu** — shorten any page or link without opening the popup
- **URL expander** — right-click a short link, or paste one in the popup, to see
  the full redirect chain and where it really lands before you click it
- **Auto-copy** — shortened URL is copied to clipboard automatically
- **Recent links** — your account's latest links when connected, this browser's
  when not
- **Guest mode** — works without an account (random slugs, no sign-in needed)
- **English and Spanish** — follows the browser's UI language

## Setup

### 1. Build the icons

No npm install needed — uses pure Node.js:

```bash
node icons/build-icons.js
```

### 2. Load in Chrome or Edge

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `alias-extension/` folder

### 3. Connect your account (optional)

- Click the extension icon → the setup screen appears on first open
- Enter your API key from [aliasurlshortener.com/account](https://aliasurlshortener.com/account) → API Keys
- Click **Connect Account**

Without an API key the extension works in guest mode: random slugs, 5 links a
day. A free account raises that to 1,000 a day and unlocks custom slugs,
passwords, expiry and click analytics.

## Checks

No test runner and no dependencies — one script reads the files and verifies
that every reference between them resolves (element ids used by the popup
script, translation keys used by markup and code, message types the popup sends
to the worker):

```bash
node tools/check.js
```

Run it before packaging. Each of those failures is silent at runtime: a null
element, a blank string, a callback that never fires.

## Translations

UI strings live in `_locales/<lang>/messages.json` and are referenced by
`data-i18n` attributes in the markup and `chrome.i18n.getMessage` in code.
Chrome picks the bundle from the browser's UI language and falls back to `en`.
To add a language, copy `_locales/en/messages.json`, translate the `message`
values, and leave the keys alone — `tools/check.js` will tell you if one is
missing.

## Publishing

For Chrome Web Store: zip the `alias-extension/` folder (excluding this README if you prefer) and upload via the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

For Edge Add-ons: same zip, uploaded via [Microsoft Partner Center](https://partner.microsoft.com/en-us/dashboard/microsoftedge).

## Project structure

```
alias-extension/
├── manifest.json               MV3 manifest
├── _locales/
│   ├── en/messages.json        UI strings
│   └── es/messages.json
├── background/
│   └── service-worker.js       Context menus, clipboard, message bus
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── offscreen/
│   ├── offscreen.html          Thin HTML page for clipboard access
│   └── offscreen.js
├── tools/
│   └── check.js                Cross-file consistency check (no npm deps)
├── icons/
│   ├── build-icons.js          Pure-Node icon generator (no npm deps)
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

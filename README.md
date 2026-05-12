# Alias Browser Extension

A Manifest V3 extension for Chrome and Edge that lets you shorten any URL with [alias.live](https://alias.live) in one click.

## Features

- **Popup** — shorten the current tab's URL; paste any URL manually
- **Custom slug** — available when you connect an account (requires API key)
- **Right-click menu** — shorten any page or link without opening the popup
- **Auto-copy** — shortened URL is copied to clipboard automatically
- **Recent links** — last 5 shortened links shown in the popup
- **Guest mode** — works without an account (random slugs, no sign-in needed)

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

Without an API key the extension works in guest mode (random slugs, 5/day limit).

## Publishing

For Chrome Web Store: zip the `alias-extension/` folder (excluding this README if you prefer) and upload via the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

For Edge Add-ons: same zip, uploaded via [Microsoft Partner Center](https://partner.microsoft.com/en-us/dashboard/microsoftedge).

## Project structure

```
alias-extension/
├── manifest.json               MV3 manifest
├── background/
│   └── service-worker.js       Context menus, clipboard, message bus
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── offscreen/
│   ├── offscreen.html          Thin HTML page for clipboard access
│   └── offscreen.js
├── icons/
│   ├── build-icons.js          Pure-Node icon generator (no npm deps)
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

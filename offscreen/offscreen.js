'use strict';

// Relay clipboard writes on behalf of the service worker, which has no DOM.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'OFFSCREEN_COPY') return;
  navigator.clipboard.writeText(message.text)
    .then(() => sendResponse({ ok: true }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true; // async response
});

/**
 * Cross-file consistency check. Run with: node tools/check.js
 *
 * An extension has no compiler and no test runner, so the failures that reach
 * users are the boring ones: a $('id') that no longer exists in the markup, a
 * t('key') with no entry in the bundles, a message the popup sends that the
 * worker never learned to handle. Each is invisible in review and silent at
 * runtime — the element is null, the string is blank, the callback never fires.
 *
 * This reads the four files and asks whether every reference between them
 * actually resolves, and whether the store-facing strings fit the limits the
 * Chrome Web Store enforces on every locale. Pure Node, no dependencies, in
 * keeping with the rest of the repo.
 */
const fs = require('fs');
const path = require('path');

// Run from anywhere.
process.chdir(path.join(__dirname, '..'));

const html = fs.readFileSync('popup/popup.html', 'utf8');
const js   = fs.readFileSync('popup/popup.js', 'utf8');
const sw   = fs.readFileSync('background/service-worker.js', 'utf8');
const en   = JSON.parse(fs.readFileSync('_locales/en/messages.json', 'utf8'));
const es   = JSON.parse(fs.readFileSync('_locales/es/messages.json', 'utf8'));
const mf   = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
let bad = 0;
const fail = (m) => { console.log('  x ' + m); bad++; };

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const jsIds   = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
console.log('HTML ids: ' + htmlIds.size + '   referenced in JS: ' + jsIds.size);
for (const id of jsIds) if (!htmlIds.has(id)) fail('popup.js uses #' + id + ', not in popup.html');

const attrKeys = [...html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)].map(m => m[1]);
const jsKeys   = [...js.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]);
const swKeys   = [...sw.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]);
const allKeys  = new Set([].concat(attrKeys, jsKeys, swKeys));
console.log('i18n keys used: ' + allKeys.size + '  (markup ' + new Set(attrKeys).size + ', code ' + new Set([].concat(jsKeys, swKeys)).size + ')');
for (const k of allKeys) {
  if (!en[k]) fail('key "' + k + '" missing from _locales/en');
  if (!es[k]) fail('key "' + k + '" missing from _locales/es');
}

const mfStr = JSON.stringify(mf);
for (const m of mfStr.matchAll(/__MSG_([a-zA-Z]+)__/g)) {
  if (!en[m[1]]) fail('manifest __MSG_' + m[1] + '__ missing from _locales/en');
  if (!es[m[1]]) fail('manifest __MSG_' + m[1] + '__ missing from _locales/es');
}

const sent    = new Set([...js.matchAll(/type:\s*'([A-Z_]+)'/g)].map(m => m[1]));
const handled = new Set([...sw.matchAll(/message\.type === '([A-Z_]+)'/g)].map(m => m[1]));
console.log('message types sent by popup: ' + [...sent].join(', '));
console.log('handled by worker:           ' + [...handled].join(', '));
for (const type of sent) if (!handled.has(type)) fail('popup sends ' + type + ', worker does not handle it');

// Chrome Web Store caps the fields the manifest supplies, and it applies the
// cap to EVERY locale — a translation that runs long is rejected or truncated
// at upload, which is the worst place to find out. Spanish shipped at 153.
const STORE_CAPS = { extName: 75, extShortName: 12, extDescription: 132 };
for (const [locale, bundle] of [['en', en], ['es', es]]) {
  for (const [key, cap] of Object.entries(STORE_CAPS)) {
    const len = bundle[key] ? bundle[key].message.length : 0;
    if (len > cap) fail(locale + '.' + key + ' is ' + len + ' chars, store cap is ' + cap);
  }
}

const unused = Object.keys(en).filter(k => !allKeys.has(k) && !mfStr.includes('__MSG_' + k + '__'));
if (unused.length) console.log('  (unused message keys: ' + unused.join(', ') + ')');

console.log(bad === 0 ? '\nAll cross-file references resolve.' : '\n' + bad + ' problem(s).');
process.exit(bad ? 1 : 0);

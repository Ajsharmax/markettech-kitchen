/**
 * Guards the storefront and admin scripts against broken element references.
 *
 * Why this exists: public/app.js and public/admin.js are single IIFEs. One
 * `$('#typo')` that returns null throws at load time and stops the rest of the
 * file from running — which previously meant the storefront never called
 * `loadStore()`, so no product ever appeared on the website (products added in
 * Admin → Products included).
 *
 * These checks are dependency-free so they run anywhere Node 18+ is available.
 * Run with: npm run test:storefront
 */

import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

const failures = [];
let checks = 0;

function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}

function equal(actual, expected, message) {
  checks++;
  if (actual !== expected) failures.push(`${message} (expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)})`);
}

/* ------------------------------ Helpers --------------------------------- */

const idsInHtml = html => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));

// IDs the script creates itself (e.g. inside innerHTML templates). Both plain
// `id="x"` and escaped `id=\"x\"` forms are used across the code base.
const idsCreatedByScript = source => new Set(
  [...source.matchAll(/id=\\?"([A-Za-z0-9_-]+)\\?"/g)].map(match => match[1])
);

// Element lookups of the form $('#some-id').
const singleLookups = source => [...source.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(match => match[1]);

function danglingLookups(jsPath, htmlPath, label, optionalIds = new Set()) {
  const source = read(jsPath);
  const htmlIds = idsInHtml(read(htmlPath));
  const required = new Set([...htmlIds, ...idsCreatedByScript(source)]);
  const missing = [...new Set(singleLookups(source))].filter(id => !required.has(id) && !optionalIds.has(id));
  check(missing.length === 0, `${label}: $('#id') lookups with no matching element: ${missing.map(id => `#${id}`).join(', ')}`);
  // An allowlisted optional element must really be absent from the page and
  // must never be used directly (it has to be guarded first).
  for (const id of optionalIds) {
    check(!htmlIds.has(id), `${label}: #${id} is present in the markup, so it must not stay on the optional list`);
    check(!new RegExp(`\\$\\('#${id}'\\)\\.(addEventListener|forEach)`).test(source), `${label}: #${id} is optional and must be guarded before use`);
  }
  return missing;
}

/* ---------------------------- Storefront page ---------------------------- */

const indexHtml = read('public/index.html');
const appJs = read('public/app.js');
const indexIds = idsInHtml(indexHtml);

// The newsletter block is optional: a published storefront may leave it out.
// app.js must guard these lookups so the catalogue still loads without it.
const OPTIONAL_STOREFRONT_IDS = new Set(['newsletter-form', 'newsletter-email', 'newsletter-message']);

danglingLookups('public/app.js', 'public/index.html', 'Storefront (public/app.js → public/index.html)', OPTIONAL_STOREFRONT_IDS);

// The product grid the storefront renders into must exist, and the script must
// actually run the catalogue load.
check(indexIds.has('product-grid'), 'Storefront: #product-grid must exist for products to render');
check(indexIds.has('empty-products'), 'Storefront: #empty-products must exist');
check(/loadStore\(\);/.test(appJs), 'Storefront: app.js must call loadStore() on start-up');
check(/api\('\/api\/products'\)/.test(appJs), 'Storefront: loadStore() must fetch /api/products');
check(/renderProducts\(\);/.test(appJs), 'Storefront: loadStore() must call renderProducts()');

// Customer-visible delivery totals must follow the same server-provided settings
// as the authoritative order total; a stale PIN-code quote must not be added.
check(/function deliveryCharge\(subtotal\)/.test(appJs), 'Storefront: checkout must calculate delivery from the configured fee and threshold');
check(/return fee > 0 && threshold > 0 && subtotal < threshold \? fee : 0;/.test(appJs), 'Storefront: zero threshold must mean free delivery on every order');
check(/const shipping = deliveryCharge\(subtotal\);/.test(appJs), 'Storefront: checkout total must use the configured delivery charge');
check(!/api\('\/api\/shipping-rate/.test(appJs), 'Storefront: checkout must not show a location quote that differs from configured delivery pricing');
check(indexHtml.includes('Free delivery on every order'), 'Storefront: cart delivery fallback must match the free-delivery default');

// Regression: the product modal body is #product-modal-body. Referencing a
// non-existent #modal-product-body used to crash the whole storefront script.
check(indexIds.has('product-modal-body'), 'Storefront: #product-modal-body must exist in index.html');
check(/renderProducts\(\);/.test(appJs) && /\$\('#product-modal-body'\)/.test(appJs), 'Storefront: app.js must wire the change handler to #product-modal-body');
check(!/\$\('#modal-product-body'\)/.test(appJs), 'Storefront: app.js must not reference the non-existent #modal-product-body');

// A missing optional section (for example the newsletter) must never stop the
// catalogue from loading, so the newsletter wiring is guarded.
const newsletterBlock = appJs.split('const newsletterForm = ')[1] || '';
check(newsletterBlock.includes('if (newsletterForm && newsletterEmail && newsletterMessage)'), 'Storefront: the newsletter handler must be guarded so a missing section cannot abort the script');

// Settings must not be able to blank the catalogue after it has been rendered.
const settingsBlock = appJs.split('// Settings only decorate the catalogue.')[1] || '';
check(settingsBlock.includes('try { applyStorefrontSettings(); }'), 'Storefront: applyStorefrontSettings() must be wrapped so it cannot hide the products');

/* ------------------------------ Admin page ------------------------------- */

const adminHtml = read('public/admin.html');
const adminJs = read('public/admin.js');
const adminIds = idsInHtml(adminHtml);

danglingLookups('public/admin.js', 'public/admin.html', 'Admin (public/admin.js → public/admin.html)');

// The admin product table must exist, and the admin must refresh it from
// /api/admin/products so newly added products show up.
check(adminIds.has('product-rows'), 'Admin: #product-rows must exist');
check(adminIds.has('empty-products-admin'), 'Admin: #empty-products-admin must exist');
check(/api\('\/api\/admin\/products'\)/.test(adminJs), 'Admin: refreshAll() must fetch /api/admin/products');
check(/renderProducts\(\);/.test(adminJs), 'Admin: refreshAll() must call renderProducts()');
check(/await refreshAll\(\);/.test(adminJs), 'Admin: saving a product must refresh the admin lists');

// Admin orders multi-select, bulk status update, and order delete controls must exist.
for (const orderControlId of ['orders-bulk-bar', 'orders-selected-count', 'orders-clear-selection', 'orders-bulk-status', 'orders-bulk-status-apply', 'orders-bulk-delete', 'orders-select-all']) {
  check(adminIds.has(orderControlId), `Admin: #${orderControlId} must exist in admin.html`);
}
check(/\/api\/admin\/orders\/bulk-status/.test(adminJs), 'Admin: admin.js must call /api/admin/orders/bulk-status');
check(/\/api\/admin\/orders\/bulk-delete/.test(adminJs), 'Admin: admin.js must call /api/admin/orders/bulk-delete');
check(/data-action="delete-order"/.test(adminJs), 'Admin: order rows must render a delete action button');

// Nothing may look up a single element and then loop over it as a list.
// ($$(...) is the list version and is expected — the lookbehind excludes it.)
for (const [label, source] of [['Storefront', appJs], ['Admin', adminJs]]) {
  const misuse = [...source.matchAll(/(?<!\$)\$\('([^']+)'\)\.forEach/g)].map(match => match[1]);
  check(misuse.length === 0, `${label}: querySelector().forEach() is invalid (use $$): ${misuse.join(', ')}`);
}

/* -------------------------------- Report -------------------------------- */

if (failures.length) {
  console.error(`\n✕ ${failures.length} of ${checks} checks failed:\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
console.log(`\n✓ Storefront/admin element references: all ${checks} checks passed.`);

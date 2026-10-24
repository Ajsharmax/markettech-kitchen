import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../public/account-nav.js', import.meta.url), 'utf8');
async function check(customer, status = 200) {
  const link = { textContent: 'Sign in / Register', setAttribute() {} };
  const events = {};
  runInNewContext(source, {
    document: { querySelectorAll: () => [link] },
    location: { pathname: '/applications/merge-pdf.html', search: '', hash: '' },
    window: { addEventListener: (name, callback) => { events[name] = callback; } },
    fetch: async () => ({ ok: status === 200, json: async () => ({ customer }) })
  });
  await new Promise(resolve => setImmediate(resolve));
  return { link, events };
}
let { link, events } = await check({ id: 'test-user' });
assert.equal(link.textContent, 'My account');
assert.equal(link.href, '/?account=login');
assert.equal(typeof events.pageshow, 'function');
assert.equal(typeof events.focus, 'function');
({ link } = await check(null));
assert.equal(link.textContent, 'Sign in / Register');
assert.ok(link.href.endsWith(encodeURIComponent('/applications/merge-pdf.html')));
({ link } = await check(null, 503));
assert.ok(link.href.startsWith('/?account=login&returnTo='));
console.log('Account links: signed-in state, signed-out return path and unavailable API passed.');

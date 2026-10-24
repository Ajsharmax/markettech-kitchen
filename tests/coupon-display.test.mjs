import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const functionSource = name => {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end);
};
const box = {};
const state = {
  $: () => box, cartSubtotal: () => 0,
  publicCoupons: [{ code: 'SAVE10', minOrder: 100, discountType: 'fixed', discountValue: 10 }, { code: 'SAVE50', minOrder: 500, discountType: 'fixed', discountValue: 50 }],
  formatMoney: String, escapeHtml: String, renderAvailableCoupons: () => {}
};
runInNewContext(functionSource('couponDiscountPreview') + '\n' + functionSource('renderLivePromoMessage') + '\nrenderLivePromoMessage(0);', state);
assert.match(box.innerHTML, /SAVE10/);
runInNewContext('renderLivePromoMessage(150)', state);
assert.match(box.innerHTML, /SAVE50/);
assert.match(box.innerHTML, /350/);
runInNewContext('renderLivePromoMessage(600)', state);
assert.match(box.innerHTML, /Best available saving/);
state.publicCoupons = [];
runInNewContext('renderLivePromoMessage(0)', state);
assert.equal(box.hidden, true);
console.log('Coupon display: locked, eligible, best and empty offer states passed.');

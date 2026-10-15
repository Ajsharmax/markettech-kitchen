const encoder = new TextEncoder();
const DEFAULT_SHIPPING_FEE = 99;
const DEFAULT_FREE_SHIPPING_AT = 1999;
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const CUSTOMER_SESSION_MS = 14 * 24 * 60 * 60 * 1000;
// Keep this work factor within Cloudflare Workers Free CPU limits. The used count is stored per account.
const PASSWORD_ITERATIONS = 20000;
const MAX_PASSWORD_ITERATIONS = 100000;

const DEFAULT_SETTINGS = {
  site: {
    storeName: 'MarketTech Kitchen',
    announcement: 'Thoughtful tools for everyday cooking',
    heroEyebrow: 'THE KITCHEN EDIT · NO. 01',
    heroLine1: 'Good things',
    heroLine2: 'happen in here.',
    heroSubtitle: 'Thoughtful tools, honest materials and little details that make everyday cooking feel like your favourite part of the day.',
    storyTitle1: 'Buy less.',
    storyTitle2: 'Love it longer.',
    storyText1: 'We believe the best kitchen is not the one with the most things. It is the one with the right things — pieces that work hard, feel good in your hands and earn their place on your counter.',
    storyText2: 'So we look for honest materials, considered design and the kind of quality you notice every time you reach for it.',
    categoryEyebrow: 'FIND YOUR GOOD STUFF',
    categoryTitle1: 'A place for every',
    categoryTitle2: 'little ritual.',
    categoryDescription: 'From the first cup of chai to the last plate at dinner, find the piece that makes it yours.',
    shopEyebrow: 'THE GOOD STUFF',
    shopTitle1: 'Everyday',
    shopTitle2: 'favourites.',
    newsletterEyebrow: 'A LITTLE NOTE FROM US',
    newsletterTitle1: 'Good things,',
    newsletterTitle2: 'in your inbox.',
    newsletterDescription: 'Fresh finds, thoughtful tips and the occasional very good recipe. No clutter, promise.',
    quoteLine1: 'It’s the little things that turn making dinner into',
    quoteEm: 'making a day.',
    quoteAttribution: 'THE MARKETTECH WAY',
    heroPrimaryCta: 'Shop the collection',
    heroSecondaryCta: 'A little about us',
    storyCta: 'Meet your new favourite',
    contactEmail: 'hello@markettech.in',
    contactPhone: '',
    contactAddress: 'Delhi · India',
    upiVpa: '',
    upiQrImage: '',
    shippingFee: DEFAULT_SHIPPING_FEE,
    freeShippingAt: DEFAULT_FREE_SHIPPING_AT,
    lowStockThreshold: 8,
    seoTitle: 'MarketTech Kitchen — Good things happen in the kitchen',
    seoDescription: 'Thoughtful kitchen tools for the rituals you return to. Shop considered cookware, prep tools, tableware and everyday essentials.'
  },
  policies: {
    shipping: 'We currently deliver across India. Delivery is ₹49 in Delhi NCR, ₹99 for locations within 500 km of Delhi, and ₹149 elsewhere in India. Orders are packed with care and usually dispatched within 2–4 business days.',
    returns: 'If something is not quite right, contact us within 7 days of delivery. Products must be unused and in their original packaging. We will help arrange a return or exchange. Contact hello@markettech.in to get started.',
    privacy: 'We use the details you share only to fulfil orders, provide support and send updates you have requested. We do not sell your personal information. Contact hello@markettech.in with privacy questions.',
    terms: 'Product descriptions, prices and availability may change. Orders are subject to stock confirmation. Cash-on-delivery orders are payable at the time of delivery. Please contact hello@markettech.in for help.'
  },
  marketing: {
    promoBanner: '',
    couponCode: '',
    discountPercent: 0,
    metaPixelId: '',
    googleAnalyticsId: '',
    googleAdsId: '',
    googleAdsConversionLabel: '',
    googleTagManagerId: '',
    whatsappNumber: ''
  }
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(status, payload, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  for (const [key, value] of new Headers(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(payload), { status, headers });
}

function normalizeSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    site: { ...DEFAULT_SETTINGS.site, ...(source.site && typeof source.site === 'object' ? source.site : {}) },
    policies: { ...DEFAULT_SETTINGS.policies, ...(source.policies && typeof source.policies === 'object' ? source.policies : {}) },
    marketing: { ...DEFAULT_SETTINGS.marketing, ...(source.marketing && typeof source.marketing === 'object' ? source.marketing : {}) },
    developer: { textOverrides: {}, ...(source.developer && typeof source.developer === 'object' ? source.developer : {}) }
  };
}

function cookieValue(request, key) {
  for (const item of (request.headers.get('Cookie') || '').split(';')) {
    const [name, ...rest] = item.trim().split('=');
    if (name === key) {
      try { return decodeURIComponent(rest.join('=')); } catch { return rest.join('='); }
    }
  }
  return '';
}

function bearerToken(request) {
  return String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function getToken(request, cookieName) {
  return bearerToken(request) || cookieValue(request, cookieName);
}

function sessionCookie(name, token, maxAge) {
  return `${name}=${encodeURIComponent(token)}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))));
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function readJson(request, maxBytes = 1_000_000) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > maxBytes) throw new HttpError(413, 'Request is too large.');
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) throw new HttpError(413, 'Request is too large.');
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new HttpError(400, 'Please send valid JSON.'); }
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizePhone(value) {
  return String(value || '').replace(/[^+\d\s()-]/g, '').trim().slice(0, 24);
}

function safeCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    createdAt: row.created_at || row.createdAt || ''
  };
}

async function hashPassword(password, saltBytes = crypto.getRandomValues(new Uint8Array(16)), iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256);
  return { salt: base64Url(saltBytes), hash: base64Url(new Uint8Array(bits)), iterations };
}

async function verifyPassword(password, customer) {
  try {
    const salt = fromBase64Url(customer.password_salt || '');
    const iterations = Number(customer.password_iterations) || PASSWORD_ITERATIONS;
    if (!Number.isInteger(iterations) || iterations < 10000 || iterations > MAX_PASSWORD_ITERATIONS) return false;
    const result = await hashPassword(password, salt, iterations);
    return constantTimeEqual(result.hash, customer.password_hash || '');
  } catch {
    return false;
  }
}

async function createSession(env, kind, userId) {
  const token = randomToken();
  const now = Date.now();
  const ttl = kind === 'admin' ? ADMIN_SESSION_MS : CUSTOMER_SESSION_MS;
  await env.DB.prepare('INSERT INTO sessions (token_hash, kind, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), kind, userId, now + ttl, now).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  return token;
}

async function sessionUser(request, env, kind) {
  const token = getToken(request, kind === 'admin' ? 'mt_admin' : 'mt_customer');
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?')
    .bind(tokenHash, kind, now).first();
  if (!row) return null;
  const ttl = kind === 'admin' ? ADMIN_SESSION_MS : CUSTOMER_SESSION_MS;
  await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + ttl, tokenHash).run();
  return row.user_id;
}

function clientAddress(request) {
  return request.headers.get('CF-Connecting-IP') || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() || 'unknown';
}

async function rateKey(request, kind) {
  return sha256(`${kind}:${clientAddress(request)}`);
}

async function isRateLimited(env, request, kind, maxAttempts, windowMs) {
  const key = await rateKey(request, kind);
  const row = await env.DB.prepare('SELECT attempts, window_started_at FROM login_attempts WHERE key_hash = ? AND kind = ?')
    .bind(key, kind).first();
  return Boolean(row && Date.now() - Number(row.window_started_at) < windowMs && Number(row.attempts) >= maxAttempts);
}

async function recordLoginFailure(env, request, kind, windowMs) {
  const key = await rateKey(request, kind);
  const now = Date.now();
  const row = await env.DB.prepare('SELECT attempts, window_started_at FROM login_attempts WHERE key_hash = ? AND kind = ?')
    .bind(key, kind).first();
  if (!row || now - Number(row.window_started_at) >= windowMs) {
    await env.DB.prepare(`INSERT INTO login_attempts (key_hash, kind, attempts, window_started_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(key_hash, kind) DO UPDATE SET attempts = 1, window_started_at = excluded.window_started_at`)
      .bind(key, kind, now).run();
  } else {
    await env.DB.prepare('UPDATE login_attempts SET attempts = attempts + 1 WHERE key_hash = ? AND kind = ?').bind(key, kind).run();
  }
}

async function clearLoginFailures(env, request, kind) {
  const key = await rateKey(request, kind);
  await env.DB.prepare('DELETE FROM login_attempts WHERE key_hash = ? AND kind = ?').bind(key, kind).run();
}

function parseProduct(row) {
  let product = {};
  try { product = JSON.parse(row.data || '{}'); } catch { /* malformed product rows are ignored by repair */ }

  // Temporary storefront price correction for the i Phone 19 Pro Max.
  // Keep this override until the D1 catalogue record is updated through the admin/database workflow.
  if (row.id === 'i-phone-19-pro-max-35f5') {
    product.price = 700000;
    product.compareAt = null;
  }

  return { ...product, id: row.id, stock: Number(row.stock) || 0 };
}

function parseOrder(row) {
  let order = {};
  try { order = JSON.parse(row.data || '{}'); } catch { /* malformed order rows are surfaced with safe columns */ }
  return {
    ...order,
    id: row.id,
    status: row.status || order.status || 'New',
    paymentStatus: row.payment_status || order.paymentStatus || 'Pending',
    total: Number(row.total ?? order.total) || 0,
    createdAt: row.created_at || order.createdAt || ''
  };
}

async function getSettings(env) {
  const row = await env.DB.prepare("SELECT data FROM store_settings WHERE id = 'default'").first();
  let settings;
  if (!row) settings = normalizeSettings(DEFAULT_SETTINGS);
  else {
    try { settings = normalizeSettings(JSON.parse(row.data)); }
    catch { settings = normalizeSettings(DEFAULT_SETTINGS); }
  }
  // Storefront pricing uses free delivery for customers. The margin/pricing pool
  // is intended to absorb delivery rather than adding a delivery charge at checkout.
  settings.site.shippingFee = 0;
  settings.site.freeShippingAt = 0;
  return settings;
}

async function listProducts(env) {
  const result = await env.DB.prepare('SELECT id, stock, data FROM products ORDER BY rowid').all();
  return (result.results || []).map(parseProduct);
}

async function productsByIds(env, ids) {
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const result = await env.DB.prepare(`SELECT id, stock, data FROM products WHERE id IN (${marks})`).bind(...ids).all();
  return (result.results || []).map(parseProduct);
}

function publicProduct(product) {
  const gallery = [...new Set([product.image, ...(Array.isArray(product.images) ? product.images : [])].filter(Boolean))].slice(0, 8);
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    compareAt: product.compareAt,
    image: product.image,
    images: gallery.length ? gallery : [product.image],
    tag: product.tag,
    rating: product.rating,
    reviews: product.reviews,
    stock: product.stock,
    featured: product.featured,
    description: product.description,
    brand: String(product.brand || '').trim(),
    colors: Array.isArray(product.colors) ? product.colors : [],
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    minOrderQty: Math.max(1, Number(product.minOrderQty) || 1),
    quantityDiscountPercent: Math.max(0, Number(product.quantityDiscountPercent) || 0)
  };
}

function normaliseList(value, fallback = []) {
  if (Array.isArray(value)) return value;
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.split(',').map(item => item.trim()).filter(Boolean);
}

function productPayload(input, existing = {}) {
  const name = String(input.name || '').trim().slice(0, 100);
  const category = String(input.category || '').trim().slice(0, 40);
  const price = Number(input.price);
  const rawStock = Number(input.stock);
  const stock = Math.floor(rawStock);
  const description = String(input.description || '').trim().slice(0, 1200);
  if (!name || !category || !Number.isFinite(price) || price < 1 || !Number.isInteger(rawStock) || stock < 0) {
    throw new HttpError(400, 'Add a product name, category, valid price and stock quantity.');
  }
  const image = String(input.image || existing.image || '/images/product-pan.jpg').trim();
  const validImagePath = value => (value.startsWith('/images/') || value.startsWith('/uploads/')) && !value.includes('..') && !value.includes('\\');
  if (!validImagePath(image)) throw new HttpError(400, 'Please choose a valid product image path.');
  let galleryInput = Object.hasOwn(input, 'images') ? input.images : existing.images;
  if (typeof galleryInput === 'string') {
    try { galleryInput = JSON.parse(galleryInput); }
    catch { throw new HttpError(400, 'Product photos must be a valid image list.'); }
  }
  if (galleryInput == null) galleryInput = [];
  if (!Array.isArray(galleryInput)) throw new HttpError(400, 'Product photos must be a list of image paths.');
  const images = [...new Set([image, ...galleryInput.map(value => String(value || '').trim()).filter(Boolean)])];
  if (images.length > 8) throw new HttpError(400, 'A product can have up to 8 photos.');
  if (images.some(value => !validImagePath(value))) throw new HttpError(400, 'One of the product photos has an invalid image path.');
  const sku = (Object.hasOwn(input, 'sku') ? String(input.sku ?? '') : String(existing.sku ?? '')).trim().slice(0, 64);
  const colors = [...new Set(normaliseList(Object.hasOwn(input, 'colors') ? input.colors : existing.colors).map(item => String(item).trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
  const sizes = [...new Set(normaliseList(Object.hasOwn(input, 'sizes') ? input.sizes : existing.sizes).map(item => String(item).trim().slice(0, 24)).filter(Boolean))].slice(0, 12);
  const rawMinQty = Object.hasOwn(input, 'minOrderQty') ? Number(input.minOrderQty) : Number(existing.minOrderQty || 1);
  const minOrderQty = Number.isInteger(rawMinQty) ? Math.min(99, Math.max(1, rawMinQty)) : 1;
  const quantityDiscountPercent = 5;
  const brand = String(Object.hasOwn(input, 'brand') ? input.brand ?? '' : existing.brand ?? '').trim().slice(0, 64);
  const requestedStatus = Object.hasOwn(input, 'status') ? String(input.status || '').trim().toLowerCase() : String(existing.status || 'active').trim().toLowerCase();
  const status = requestedStatus === 'inactive' ? 'inactive' : 'active';
  const product = {
    ...existing,
    name,
    category,
    status,
    price: Math.round(price),
    compareAt: Number.isFinite(Number(input.compareAt)) && Number(input.compareAt) > price ? Math.round(Number(input.compareAt)) : null,
    stock,
    description,
    image,
    images,
    colors,
    sizes,
    minOrderQty,
    quantityDiscountPercent,
    brand,
    tag: String(input.tag || '').trim().slice(0, 32),
    featured: Boolean(input.featured),
    rating: Number(existing.rating || 4.8),
    reviews: Number(existing.reviews || 0)
  };
  if (sku) product.sku = sku;
  else delete product.sku;
  return product;
}

function quantityDiscountPercentForCart(totalQuantity) {
  return Math.min(20, Math.max(0, (Math.max(0, Number(totalQuantity) - 1)) * 5));
}

function updateSettings(current, input) {
  const body = input && typeof input === 'object' ? input : {};
  const settings = normalizeSettings(current);
  const clean = (value, max) => String(value ?? '').trim().slice(0, max);
  const siteTextLimits = {
    storeName: 80, announcement: 180, heroEyebrow: 80, heroLine1: 90, heroLine2: 90,
    heroSubtitle: 500, storyTitle1: 90, storyTitle2: 90, storyText1: 1200, storyText2: 1200,
    categoryEyebrow: 80, categoryTitle1: 90, categoryTitle2: 90, categoryDescription: 500,
    shopEyebrow: 80, shopTitle1: 90, shopTitle2: 90, newsletterEyebrow: 80, newsletterTitle1: 90, newsletterTitle2: 90,
    newsletterDescription: 500, quoteLine1: 180, quoteEm: 90, quoteAttribution: 80,
    heroPrimaryCta: 60, heroSecondaryCta: 60, storyCta: 60,
    contactEmail: 254, contactPhone: 32, contactAddress: 180, upiVpa: 120, upiQrImage: 260, seoTitle: 140, seoDescription: 320
  };
  for (const [key, max] of Object.entries(siteTextLimits)) {
    if (Object.hasOwn(body.site || {}, key)) settings.site[key] = clean(body.site[key], max);
  }
  if (settings.site.contactEmail && !cleanEmail(settings.site.contactEmail)) throw new HttpError(400, 'Enter a valid store contact email.');
  if (settings.site.upiVpa && !/^[\w.-]{2,100}@[\w.-]{2,30}$/.test(settings.site.upiVpa)) throw new HttpError(400, 'Enter a valid UPI ID, such as name@bank.');
  if (settings.site.upiQrImage && (!(settings.site.upiQrImage.startsWith('/uploads/') || settings.site.upiQrImage.startsWith('/images/')) || settings.site.upiQrImage.includes('..'))) throw new HttpError(400, 'Upload a valid UPI QR image.');
  const numberRules = { shippingFee: [0, 50000], freeShippingAt: [0, 1000000], lowStockThreshold: [0, 100000] };
  for (const [key, [min, max]] of Object.entries(numberRules)) {
    if (Object.hasOwn(body.site || {}, key)) {
      const value = Number(body.site[key]);
      if (!Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `Enter a valid ${key.replace(/[A-Z]/g, match => ` ${match.toLowerCase()}`)}.`);
      settings.site[key] = value;
    }
  }
  const policyLimits = { shipping: 8000, returns: 8000, privacy: 10000, terms: 10000 };
  for (const [key, max] of Object.entries(policyLimits)) {
    if (Object.hasOwn(body.policies || {}, key)) settings.policies[key] = clean(body.policies[key], max);
  }
  const marketingLimits = { promoBanner: 180, couponCode: 40, metaPixelId: 40, googleAnalyticsId: 40, googleAdsId: 60, googleAdsConversionLabel: 100, googleTagManagerId: 40, whatsappNumber: 24 };
  const textOverrides = body.developer?.textOverrides && typeof body.developer.textOverrides === 'object' ? body.developer.textOverrides : null;
  if (textOverrides) {
    settings.developer.textOverrides = Object.fromEntries(Object.entries(textOverrides).slice(0, 200).map(([key, value]) => [String(key).slice(0, 80), clean(value, 240)]));
  }
  for (const [key, max] of Object.entries(marketingLimits)) {
    if (Object.hasOwn(body.marketing || {}, key)) settings.marketing[key] = clean(body.marketing[key], max);
  }
  if (Object.hasOwn(body.marketing || {}, 'discountPercent')) {
    const discountPercent = Number(body.marketing.discountPercent);
    if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 90) throw new HttpError(400, 'Coupon discount must be between 0 and 90 percent.');
    settings.marketing.discountPercent = discountPercent;
  }
  if (settings.marketing.metaPixelId && !/^\d{5,20}$/.test(settings.marketing.metaPixelId)) throw new HttpError(400, 'Meta Pixel ID should be a number (5–20 digits).');
  if (settings.marketing.googleAnalyticsId && !/^G-[A-Z0-9]{4,20}$/i.test(settings.marketing.googleAnalyticsId)) throw new HttpError(400, 'Google Analytics ID should look like G-XXXXXXXXXX.');
  if (settings.marketing.googleTagManagerId && !/^GTM-[A-Z0-9]{4,20}$/i.test(settings.marketing.googleTagManagerId)) throw new HttpError(400, 'Google Tag Manager ID should look like GTM-XXXXXXX.');
  if (settings.marketing.googleAdsId && !/^AW-[0-9-]{4,30}$/i.test(settings.marketing.googleAdsId)) throw new HttpError(400, 'Google Ads ID should look like AW-123456789.');
  if (settings.marketing.whatsappNumber && !/^\+?[\d\s()-]{8,24}$/.test(settings.marketing.whatsappNumber)) throw new HttpError(400, 'Enter a valid WhatsApp contact number.');
  return settings;
}

function validateImageBytes(bytes, mime) {
  if (mime === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    return bytes.length > 8 && signature.every((value, index) => bytes[index] === value);
  }
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/webp') {
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    return bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  }
  return false;
}

function encodeBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function createRazorpayOrder(order, env) {
  const key = env.RAZORPAY_KEY_ID;
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) throw new HttpError(400, 'Online payment is not configured yet.');
  const credentials = encodeBase64(encoder.encode(`${key}:${secret}`));
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(order.total * 100), currency: 'INR', receipt: order.id, notes: { store_order_id: order.id } }),
    signal: AbortSignal.timeout(12000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new HttpError(502, result.error?.description || 'Payment gateway could not start checkout. Please try COD or UPI.');
  return result;
}

async function razorpaySignature(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

async function getCustomer(request, env) {
  const id = await sessionUser(request, env, 'customer');
  if (!id) return null;
  const row = await env.DB.prepare('SELECT id, name, email, phone, created_at FROM customers WHERE id = ?').bind(id).first();
  return row ? safeCustomer(row) : null;
}

async function saveProduct(env, product) {
  if (await ensureProductSkuColumn(env)) {
    await env.DB.prepare(`INSERT INTO products (id, sku, stock, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET sku = excluded.sku, stock = excluded.stock, data = excluded.data`)
      .bind(product.id, product.sku || null, product.stock, JSON.stringify(product)).run();
    return;
  }
  await env.DB.prepare(`INSERT INTO products (id, stock, data) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET stock = excluded.stock, data = excluded.data`)
    .bind(product.id, product.stock, JSON.stringify(product)).run();
}

async function saveProductSafely(env, product) {
  try {
    await saveProduct(env, product);
  } catch (error) {
    if (/unique|constraint/i.test(String(error?.message || ''))) throw new HttpError(409, 'Another product already uses that SKU. Choose a different SKU.');
    throw error;
  }
}

/* ---------------------------------------------------------------------------
   Bulk product import (Admin → Products → Import Products).

   Reads .xlsx (ZIP + SpreadsheetML) and .csv uploads inside the Pages
   Function, validates every row, previews the outcome and then upserts into
   the existing `products` table with SKU as the unique key.

   No extra dependencies: the workbook reader uses the runtime's own
   DecompressionStream plus small XML/ZIP scanners.
--------------------------------------------------------------------------- */

const MAX_IMPORT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;
const MAX_IMPORT_PREVIEW_ROWS = 2000;
const IMPORT_WRITE_CHUNK = 20;
const DEFAULT_PRODUCT_IMAGE = '/images/product-pan.jpg';

// Column names accepted in the uploaded file. The canonical name is always first.
const IMPORT_COLUMN_ALIASES = {
  sku: ['sku', 'sku_code', 'product_sku', 'item_code', 'product_code', 'article_code'],
  product_name: ['product_name', 'name', 'product', 'title', 'product_title'],
  slug: ['slug', 'url_slug', 'handle', 'permalink'],
  category: ['category', 'product_category', 'category_name'],
  mrp: ['mrp', 'mrp_price', 'maximum_retail_price', 'max_retail_price', 'list_price', 'compare_at_price'],
  selling_price: ['selling_price', 'sellingprice', 'selling_price_inr', 'price', 'sale_price', 'final_price', 'offer_price'],
  stock_quantity: ['stock_quantity', 'stock_qty', 'stock', 'quantity', 'qty', 'inventory_quantity', 'inventory'],
  hsn_code: ['hsn_code', 'hsn', 'hsn_no', 'hsncode'],
  gst: ['gst', 'gst_rate', 'gst_percent', 'gst_percentage', 'tax_rate'],
  description: ['description', 'product_description', 'long_description', 'details'],
  status: ['status', 'product_status', 'visibility'],
  featured: ['featured', 'is_featured', 'featured_product', 'highlight'],
  package_length_cm: ['package_length_cm', 'length_cm', 'package_length'],
  package_breadth_cm: ['package_breadth_cm', 'breadth_cm', 'width_cm', 'package_width_cm', 'package_breadth', 'package_width'],
  package_height_cm: ['package_height_cm', 'height_cm', 'package_height'],
  package_weight_kg: ['package_weight_kg', 'weight_kg', 'package_weight', 'shipping_weight_kg']
};

const IMPORT_FIELDS = Object.keys(IMPORT_COLUMN_ALIASES);
const IMPORT_REQUIRED_FIELDS = ['sku', 'product_name', 'category', 'selling_price', 'stock_quantity'];
const IMPORT_OPTIONAL_FIELDS = ['slug', 'mrp', 'hsn_code', 'gst', 'description', 'status', 'featured', 'package_length_cm', 'package_breadth_cm', 'package_height_cm', 'package_weight_kg'];
const IMPORT_PACKAGE_FIELDS = [
  ['package_length_cm', 'lengthCm'],
  ['package_breadth_cm', 'breadthCm'],
  ['package_height_cm', 'heightCm'],
  ['package_weight_kg', 'weightKg']
];

const IMPORT_FIELD_LABELS = {
  sku: 'SKU', product_name: 'Product name', slug: 'Slug', category: 'Category', mrp: 'MRP',
  selling_price: 'Selling price', stock_quantity: 'Stock quantity', hsn_code: 'HSN code', gst: 'GST',
  description: 'Description', status: 'Status', featured: 'Featured',
  package_length_cm: 'Package length (cm)', package_breadth_cm: 'Package breadth (cm)',
  package_height_cm: 'Package height (cm)', package_weight_kg: 'Package weight (kg)'
};

const IMPORT_STATUS_VALUES = {
  active: 'active', enabled: 'active', publish: 'active', published: 'active', live: 'active', visible: 'active',
  'in stock': 'active', '1': 'active', yes: 'active', true: 'active', t: 'active', y: 'active',
  inactive: 'inactive', disabled: 'inactive', draft: 'inactive', hidden: 'inactive', unpublished: 'inactive',
  archived: 'inactive', offline: 'inactive', '0': 'inactive', no: 'inactive', false: 'inactive', f: 'inactive', n: 'inactive'
};

const IMPORT_BOOLEAN_VALUES = {
  '1': true, yes: true, true: true, y: true, t: true, on: true, active: true, featured: true,
  '0': false, no: false, false: false, n: false, f: false, off: false, inactive: false, normal: false
};

const IMPORT_HEADER_LOOKUP = (() => {
  const lookup = {};
  for (const [field, aliases] of Object.entries(IMPORT_COLUMN_ALIASES)) {
    for (const alias of aliases) if (!lookup[alias]) lookup[alias] = field;
  }
  return lookup;
})();

// The SKU column is optional in D1: when it exists the importer keeps it in
// step so the SKU can be queried directly. Matching always falls back to the
// product JSON, so the importer works with or without it.
let productSkuColumnPromise = null;

function ensureProductSkuColumn(env) {
  if (!productSkuColumnPromise) {
    productSkuColumnPromise = (async () => {
      try {
        await env.DB.prepare('SELECT sku FROM products LIMIT 1').first();
        return true;
      } catch { /* column not present yet — add it below */ }
      try {
        await env.DB.prepare('ALTER TABLE products ADD COLUMN sku TEXT').run();
        try {
          await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS products_sku_idx ON products (sku) WHERE sku IS NOT NULL AND sku <> ''").run();
        } catch (error) {
          console.error('MarketTech SKU index was not created:', error?.message || error);
        }
        return true;
      } catch (error) {
        console.error('MarketTech SKU column is unavailable:', error?.message || error);
        return false;
      }
    })().catch(() => false);
  }
  return productSkuColumnPromise;
}

function importFieldLabel(field) {
  return IMPORT_FIELD_LABELS[field] || field;
}

function clip(value, max = 40) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function importNumber(value) {
  const text = String(value ?? '').replace(/[\u20b9$\u20ac\u00a3,%\s]/g, '').trim();
  if (!text) return NaN;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

function importEnum(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
}

function importSlug(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function normalizeImportHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeSkuKey(value) {
  return String(value ?? '').trim().toUpperCase();
}

function decodeBase64Bytes(value) {
  try {
    const binary = atob(String(value || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new HttpError(400, 'The uploaded file could not be decoded. Please choose the file again and retry.');
  }
}

function importSizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/* --------------------------------- ZIP ---------------------------------- */

async function inflateRawBytes(bytes) {
  try {
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); }
    }).pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new HttpError(400, 'That Excel file could not be unpacked. Save it again as .xlsx or .csv and upload it once more.');
  }
}

async function openWorkbookArchive(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOfCentralDirectory = -1;
  const lowestOffset = Math.max(0, bytes.length - 66000);
  for (let offset = bytes.length - 22; offset >= lowestOffset; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { endOfCentralDirectory = offset; break; }
  }
  if (endOfCentralDirectory < 0) throw new HttpError(400, 'That file is not a readable Excel workbook. Save it again as .xlsx or .csv and upload it once more.');
  const entryCount = view.getUint16(endOfCentralDirectory + 10, true);
  let pointer = view.getUint32(endOfCentralDirectory + 16, true);
  const entries = new Map();
  const textDecoder = new TextDecoder();
  for (let index = 0; index < entryCount; index++) {
    if (pointer + 46 > bytes.length || view.getUint32(pointer, true) !== 0x02014b50) break;
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = textDecoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    if ((method === 0 || method === 8) && name) entries.set(name, { method, compressedSize, localOffset });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  if (!entries.size) throw new HttpError(400, 'That Excel file does not contain any readable parts.');
  return {
    has: name => entries.has(name),
    names: () => [...entries.keys()],
    read: async name => {
      const entry = entries.get(name);
      if (!entry) return '';
      const headerOffset = entry.localOffset;
      if (headerOffset + 30 > bytes.length || view.getUint32(headerOffset, true) !== 0x04034b50) {
        throw new HttpError(400, 'That Excel file looks damaged. Save it again and retry.');
      }
      const nameLength = view.getUint16(headerOffset + 26, true);
      const extraLength = view.getUint16(headerOffset + 28, true);
      const start = headerOffset + 30 + nameLength + extraLength;
      const stored = bytes.subarray(start, start + entry.compressedSize);
      const data = entry.method === 8 ? await inflateRawBytes(stored) : stored;
      if (data.length > 48 * 1024 * 1024) throw new HttpError(413, 'That Excel file is too large for the importer to read.');
      return textDecoder.decode(data);
    }
  };
}

/* ------------------------------ Worksheet ------------------------------- */

function decodeXmlText(value) {
  const codePoint = code => {
    try { return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; }
    catch { return ''; }
  };
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => codePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => codePoint(Number(code)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlAttribute(source, name) {
  const value = String(source || '');
  const doubleQuoted = value.match(new RegExp(`\\b${name}="([^"]*)"`));
  if (doubleQuoted) return doubleQuoted[1];
  const singleQuoted = value.match(new RegExp(`\\b${name}='([^']*)'`));
  return singleQuoted ? singleQuoted[1] : '';
}

function columnIndexFromReference(reference) {
  const letters = String(reference || '').toUpperCase().replace(/[^A-Z]/g, '');
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function parseSharedStrings(xml) {
  const strings = [];
  const blocks = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let block;
  while ((block = blocks.exec(xml))) {
    let text = '';
    const runs = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let run;
    while ((run = runs.exec(block[1]))) text += decodeXmlText(run[1]);
    strings.push(text);
  }
  return strings;
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  const rowPattern = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch;
  let autoRowNumber = 0;
  while ((rowMatch = rowPattern.exec(xml))) {
    autoRowNumber++;
    const rowNumber = Number(xmlAttribute(rowMatch[1], 'r')) || autoRowNumber;
    const inner = rowMatch[2] || '';
    const cells = [];
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    let autoColumn = 0;
    while ((cellMatch = cellPattern.exec(inner))) {
      const attributes = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const reference = xmlAttribute(attributes, 'r');
      const type = xmlAttribute(attributes, 't');
      const columnIndex = reference ? columnIndexFromReference(reference) : autoColumn;
      autoColumn = columnIndex + 1;
      let value = '';
      const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      if (type === 'inlineStr' && inline) {
        const runs = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let run;
        while ((run = runs.exec(inline[1]))) value += decodeXmlText(run[1]);
      } else {
        const raw = (body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || ['', ''])[1];
        if (type === 's') value = sharedStrings[Number(raw)] ?? '';
        else if (type === 'b') value = raw === '1' ? 'true' : 'false';
        else if (type === 'e') value = '';
        else value = decodeXmlText(raw);
      }
      if (columnIndex >= 0 && columnIndex < 200) cells[columnIndex] = value;
    }
    while (cells.length && String(cells[cells.length - 1] ?? '') === '') cells.pop();
    rows.push({ number: rowNumber, cells: cells.map(cell => (cell == null ? '' : String(cell))) });
  }
  return rows;
}

function workbookSheetPath(target) {
  const clean = String(target || '').replace(/^\.\//, '').replace(/^\//, '');
  if (!clean) return '';
  return clean.startsWith('xl/') ? clean : `xl/${clean}`;
}

async function readXlsxGrid(bytes) {
  const archive = await openWorkbookArchive(bytes);
  const workbookXml = await archive.read('xl/workbook.xml');
  const relationshipsXml = await archive.read('xl/_rels/workbook.xml.rels');
  let sheetPath = '';
  let sheetName = '';
  if (workbookXml) {
    const relationships = new Map();
    const relationshipPattern = /<Relationship\b[^>]*>/g;
    let relationship;
    while ((relationship = relationshipPattern.exec(relationshipsXml))) {
      const id = xmlAttribute(relationship[0], 'Id');
      if (id) relationships.set(id, xmlAttribute(relationship[0], 'Target'));
    }
    const sheetPattern = /<sheet\b[^>]*>/g;
    let sheet;
    while ((sheet = sheetPattern.exec(workbookXml))) {
      if (/\bstate="hidden"/.test(sheet[0])) continue;
      const path = workbookSheetPath(relationships.get(xmlAttribute(sheet[0], 'r:id')) || '');
      if (path && archive.has(path)) { sheetPath = path; sheetName = decodeXmlText(xmlAttribute(sheet[0], 'name')); break; }
    }
  }
  if (!sheetPath) {
    sheetPath = archive.names().filter(name => /^xl\/worksheets\/[^/]+\.xml$/i.test(name)).sort()[0] || '';
  }
  if (!sheetPath) throw new HttpError(400, 'That Excel file does not contain a worksheet the importer can read.');
  const sharedStrings = archive.has('xl/sharedStrings.xml') ? parseSharedStrings(await archive.read('xl/sharedStrings.xml')) : [];
  return { format: 'xlsx', sheetName, rows: parseWorksheetRows(await archive.read(sheetPath), sharedStrings) };
}

/* --------------------------------- CSV ---------------------------------- */

function detectCsvDelimiter(line) {
  const candidates = [',', ';', '\t', '|'].map(delimiter => ({ delimiter, count: line.split(delimiter).length }));
  candidates.sort((left, right) => right.count - left.count);
  return candidates[0].count > 1 ? candidates[0].delimiter : ',';
}

function readCsvGrid(text) {
  let content = String(text || '').replace(/^\uFEFF/, '');
  const directive = content.match(/^sep=(.)\r?\n/i);
  let delimiter = directive ? directive[1] : detectCsvDelimiter(content.split(/\r?\n/).find(line => line.trim()) || '');
  if (directive) content = content.slice(directive[0].length);
  const rows = [];
  let cells = [];
  let field = '';
  let quoted = false;
  let lineNumber = 1;
  let rowLine = 1;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') { field += '"'; index++; }
        else quoted = false;
      } else {
        if (character === '\n') lineNumber++;
        field += character;
      }
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === delimiter) { cells.push(field); field = ''; continue; }
    if (character === '\r') continue;
    if (character === '\n') {
      cells.push(field);
      rows.push({ number: rowLine, cells });
      cells = [];
      field = '';
      lineNumber++;
      rowLine = lineNumber;
      continue;
    }
    field += character;
  }
  if (field !== '' || cells.length) {
    cells.push(field);
    rows.push({ number: rowLine, cells });
  }
  return { format: 'csv', sheetName: '', rows };
}

async function readSpreadsheetGrid(filename, bytes) {
  const name = String(filename || '').toLowerCase();
  if (bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsxGrid(bytes);
  if (bytes.length > 3 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new HttpError(400, 'That looks like an old .xls workbook. Open it in Excel and save it as .xlsx or .csv, then upload it again.');
  }
  if (name.endsWith('.xlsx')) throw new HttpError(400, 'That file is named .xlsx but it is not a valid Excel workbook. Save it again as .xlsx or .csv and retry.');
  if (bytes.includes(0)) throw new HttpError(400, 'That file does not look like a spreadsheet. Upload the .xlsx or .csv export of your products.');
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) throw new HttpError(400, 'That file is empty.');
  return readCsvGrid(text);
}

/* --------------------------- Rows and columns ---------------------------- */

function buildImportDataset(gridRows) {
  const rows = gridRows.filter(row => Array.isArray(row.cells));
  const headerIndex = rows.findIndex(row => row.cells.filter(cell => String(cell ?? '').trim()).length >= 2);
  if (headerIndex < 0) {
    throw new HttpError(400, 'That file has no header row. The first row must contain the column names such as sku, product_name and category.');
  }
  const headerRow = rows[headerIndex];
  const candidates = new Map();
  const ignoredColumns = [];
  headerRow.cells.forEach((cell, index) => {
    const header = String(cell ?? '').trim();
    if (!header) return;
    const field = IMPORT_HEADER_LOOKUP[normalizeImportHeader(header)];
    if (!field) { ignoredColumns.push(header); return; }
    if (!candidates.has(field)) candidates.set(field, []);
    candidates.get(field).push({ header, normalized: normalizeImportHeader(header), index });
  });
  const columns = {};
  const mappedHeaders = {};
  for (const [field, list] of candidates) {
    const chosen = list.find(entry => entry.normalized === field) || list[0];
    columns[field] = chosen.index;
    mappedHeaders[field] = chosen.header;
    for (const entry of list) if (entry !== chosen) ignoredColumns.push(entry.header);
  }
  const missingRequired = IMPORT_REQUIRED_FIELDS.filter(field => columns[field] == null);
  if (missingRequired.length) {
    throw new HttpError(400, `Your file is missing the required column${missingRequired.length === 1 ? '' : 's'}: ${missingRequired.map(importFieldLabel).join(', ')}. Download the template to see the expected layout.`);
  }
  const records = [];
  let blankRows = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    let hasContent = false;
    const values = {};
    for (const [field, index] of Object.entries(columns)) {
      const text = String(row.cells[index] ?? '');
      values[field] = text;
      if (text.trim()) hasContent = true;
    }
    if (!hasContent) { blankRows++; continue; }
    records.push({ rowNumber: row.number, values });
  }
  return {
    records,
    blankRows,
    headerRowNumber: headerRow.number,
    columns: {
      mapped: mappedHeaders,
      ignored: ignoredColumns,
      missingOptional: IMPORT_OPTIONAL_FIELDS.filter(field => columns[field] == null)
    }
  };
}

function validateImportRecord(record) {
  const errors = [];
  const warnings = [];
  const values = record.values || {};
  const cell = field => String(values[field] ?? '').trim();

  const sku = cell('sku').slice(0, 64);
  if (!sku) errors.push('SKU is missing.');
  else if (/[\u0000-\u001f\u007f]/.test(sku)) errors.push('SKU contains characters that are not allowed.');

  const rawName = cell('product_name');
  if (!rawName) errors.push('Product name is missing.');
  const name = rawName.slice(0, 100);
  if (rawName.length > 100) warnings.push('Product name was shortened to 100 characters.');

  const rawCategory = cell('category');
  if (!rawCategory) errors.push('Category is missing.');
  const category = rawCategory.slice(0, 40);
  if (rawCategory.length > 40) warnings.push('Category was shortened to 40 characters.');

  const rawPrice = cell('selling_price');
  const priceNumber = importNumber(rawPrice);
  let sellingPrice = null;
  if (!rawPrice) errors.push('Selling price is missing.');
  else if (!Number.isFinite(priceNumber)) errors.push(`Selling price “${clip(rawPrice)}” is not a valid number.`);
  else if (priceNumber < 1) errors.push('Selling price must be at least ₹1.');
  else sellingPrice = Math.round(priceNumber);

  const rawStock = cell('stock_quantity');
  const stockNumber = importNumber(rawStock);
  let stock = null;
  if (!rawStock) errors.push('Stock quantity is missing.');
  else if (!Number.isFinite(stockNumber)) errors.push(`Stock quantity “${clip(rawStock)}” is not a valid number.`);
  else if (stockNumber < 0) errors.push('Stock quantity cannot be negative.');
  else stock = Math.floor(stockNumber);

  const rawMrp = cell('mrp');
  const mrpNumber = importNumber(rawMrp);
  let mrp = null;
  if (!rawMrp) warnings.push('MRP is missing — no compare-at price will be set.');
  else if (!Number.isFinite(mrpNumber)) errors.push(`MRP “${clip(rawMrp)}” is not a valid number.`);
  else if (mrpNumber < 0) errors.push('MRP cannot be negative.');
  else mrp = Math.round(mrpNumber);

  const rawGst = cell('gst');
  const gstNumber = importNumber(rawGst);
  let gst = null;
  if (!rawGst) warnings.push('GST is missing — 0% will be used for a new product.');
  else if (!Number.isFinite(gstNumber)) errors.push(`GST “${clip(rawGst)}” is not a valid number.`);
  else if (gstNumber < 0 || gstNumber > 100) errors.push('GST must be a percentage between 0 and 100.');
  else gst = Math.round(gstNumber * 100) / 100;

  const rawStatus = cell('status');
  let status = null;
  if (!rawStatus) warnings.push('Status is missing — a new product will be active.');
  else {
    status = IMPORT_STATUS_VALUES[importEnum(rawStatus)] || null;
    if (!status) errors.push(`Status “${clip(rawStatus)}” is not valid. Use active or inactive.`);
  }

  const rawFeatured = cell('featured');
  let featured = null;
  if (rawFeatured) {
    const key = importEnum(rawFeatured);
    if (!Object.hasOwn(IMPORT_BOOLEAN_VALUES, key)) errors.push(`Featured “${clip(rawFeatured)}” is not valid. Use yes or no.`);
    else featured = IMPORT_BOOLEAN_VALUES[key];
  }

  const packageValues = {};
  for (const [field, key] of IMPORT_PACKAGE_FIELDS) {
    const raw = cell(field);
    if (!raw) continue;
    const number = importNumber(raw);
    if (!Number.isFinite(number)) errors.push(`${importFieldLabel(field)} “${clip(raw)}” is not a valid number.`);
    else if (number <= 0) errors.push(`${importFieldLabel(field)} must be greater than zero.`);
    else packageValues[key] = Math.round(number * 1000) / 1000;
  }

  let description = cell('description');
  if (description.length > 1200) {
    description = description.slice(0, 1200);
    warnings.push('Description was shortened to 1,200 characters.');
  }

  const rawSlug = cell('slug');
  let slug = importSlug(rawSlug);
  if (!slug) {
    slug = importSlug(rawName) || 'item';
    warnings.push(`Slug is missing — “${slug}” will be generated from the product name.`);
  } else if (rawSlug.toLowerCase() !== slug) {
    warnings.push(`Slug was normalised to “${slug}”.`);
  }

  const hsnCode = cell('hsn_code').slice(0, 16);

  return {
    rowNumber: record.rowNumber,
    sku,
    name,
    category,
    slug,
    sellingPrice,
    mrp,
    mrpProvided: Boolean(rawMrp),
    stock,
    hsnCode,
    gst,
    status,
    featured,
    description,
    package: packageValues,
    errors,
    warnings
  };
}

/* ------------------------- Products and analysis ------------------------- */

function uniqueImportProductId(slug, takenIds) {
  const base = (slug || 'item').slice(0, 42) || 'item';
  if (!takenIds.has(base)) { takenIds.add(base); return base; }
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${base}-${hex(crypto.getRandomValues(new Uint8Array(2)))}`;
    if (!takenIds.has(candidate)) { takenIds.add(candidate); return candidate; }
  }
  const fallback = `${base}-${Date.now().toString(36)}`;
  takenIds.add(fallback);
  return fallback;
}

function buildImportProduct(row, existing, takenIds) {
  const input = {
    name: row.name,
    category: row.category,
    price: row.sellingPrice,
    compareAt: row.mrpProvided ? (Number.isFinite(row.mrp) && row.mrp > row.sellingPrice ? row.mrp : null) : (existing?.compareAt ?? null),
    stock: row.stock,
    description: row.description || existing?.description || '',
    tag: existing?.tag || '',
    featured: row.featured != null ? row.featured : Boolean(existing?.featured),
    image: existing?.image || DEFAULT_PRODUCT_IMAGE,
    images: existing?.images || [DEFAULT_PRODUCT_IMAGE]
  };
  const product = productPayload(input, existing ? { ...existing } : {});
  if (existing) product.id = existing.id;
  else {
    product.id = uniqueImportProductId(row.slug, takenIds);
    product.rating = 0;
    product.reviews = 0;
  }
  product.sku = row.sku;
  product.slug = row.slug;
  product.status = row.status || existing?.status || 'active';
  if (row.gst != null) product.gst = row.gst;
  else if (existing?.gst == null) product.gst = 0;
  if (row.hsnCode) product.hsnCode = row.hsnCode;
  const packageValues = {};
  for (const [field, key] of IMPORT_PACKAGE_FIELDS) {
    const value = row.package?.[key] ?? existing?.package?.[key];
    if (value != null && Number.isFinite(Number(value))) packageValues[key] = Number(value);
  }
  if (Object.keys(packageValues).length) product.package = packageValues;
  return product;
}

async function analyzeImportUpload(env, body) {
  const filename = String(body?.filename || 'products.xlsx').slice(0, 160);
  const base64 = String(body?.data || '');
  if (!base64) throw new HttpError(400, 'Choose a .xlsx or .csv file to import.');
  const bytes = decodeBase64Bytes(base64);
  if (!bytes.length) throw new HttpError(400, 'That file is empty.');
  if (bytes.length > MAX_IMPORT_FILE_BYTES) {
    throw new HttpError(413, `That file is ${importSizeLabel(bytes.length)}. The importer accepts files up to 4 MB.`);
  }
  const grid = await readSpreadsheetGrid(filename, bytes);
  const dataset = buildImportDataset(grid.rows);
  if (!dataset.records.length) throw new HttpError(400, 'No product rows were found under the header row.');
  if (dataset.records.length > MAX_IMPORT_ROWS) {
    throw new HttpError(413, `That file has ${dataset.records.length} product rows. The importer accepts up to ${MAX_IMPORT_ROWS} rows per upload.`);
  }

  const existingProducts = await listProducts(env);
  const existingBySku = new Map();
  for (const product of existingProducts) {
    const key = normalizeSkuKey(product.sku);
    if (key && !existingBySku.has(key)) existingBySku.set(key, product);
  }
  const takenIds = new Set(existingProducts.map(product => product.id));
  const seenSkus = new Map();
  const rows = [];
  const writes = [];

  for (const record of dataset.records) {
    const validated = validateImportRecord(record);
    const publicRow = {
      rowNumber: validated.rowNumber,
      sku: validated.sku,
      name: validated.name,
      category: validated.category,
      mrp: validated.mrp,
      mrpProvided: validated.mrpProvided,
      sellingPrice: validated.sellingPrice,
      stock: validated.stock,
      slug: validated.slug,
      status: validated.status || '',
      errors: validated.errors,
      warnings: validated.warnings
    };
    if (validated.errors.length) { rows.push({ ...publicRow, action: 'ERROR' }); continue; }
    const key = normalizeSkuKey(validated.sku);
    if (seenSkus.has(key)) {
      rows.push({ ...publicRow, action: 'SKIP', skipReason: `Repeated SKU — the same SKU was already used on row ${seenSkus.get(key)}.` });
      continue;
    }
    seenSkus.set(key, validated.rowNumber);
    const existing = existingBySku.get(key);
    try {
      const product = buildImportProduct(validated, existing, takenIds);
      writes.push({ rowNumber: validated.rowNumber, action: existing ? 'UPDATE' : 'NEW', product });
      rows.push({ ...publicRow, action: existing ? 'UPDATE' : 'NEW', productId: product.id });
    } catch (error) {
      const message = error instanceof HttpError ? error.message : 'This row could not be prepared for import.';
      rows.push({ ...publicRow, action: 'ERROR', errors: [...validated.errors, message] });
    }
  }

  const count = action => rows.filter(row => row.action === action).length;
  return {
    file: {
      name: filename,
      format: grid.format,
      sizeBytes: bytes.length,
      sheetName: grid.sheetName || '',
      headerRowNumber: dataset.headerRowNumber,
      blankRows: dataset.blankRows,
      rowCount: dataset.records.length
    },
    columns: dataset.columns,
    summary: {
      total: rows.length,
      create: count('NEW'),
      update: count('UPDATE'),
      skip: count('SKIP'),
      error: count('ERROR'),
      warning: rows.filter(row => (row.warnings || []).length > 0).length
    },
    rows,
    writes
  };
}

function publicImportPreview(analysis) {
  return {
    file: analysis.file,
    columns: analysis.columns,
    summary: analysis.summary,
    rows: analysis.rows.slice(0, MAX_IMPORT_PREVIEW_ROWS),
    truncated: analysis.rows.length > MAX_IMPORT_PREVIEW_ROWS
  };
}

function importWriteErrorMessage(error) {
  const message = String(error?.message || '');
  if (/unique|constraint/i.test(message)) {
    return /sku/i.test(message) ? 'Another product already uses this SKU.' : 'The database rejected this row because it would duplicate an existing record.';
  }
  if (/too (large|big|many)/i.test(message)) return 'This row is too large for the database.';
  return 'The database could not save this row. Please run the import again.';
}

async function executeImport(env, analysis) {
  const skuColumn = await ensureProductSkuColumn(env);
  const statementFor = product => (skuColumn
    ? env.DB.prepare(`INSERT INTO products (id, sku, stock, data) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET sku = excluded.sku, stock = excluded.stock, data = excluded.data`)
      .bind(product.id, product.sku || null, product.stock, JSON.stringify(product))
    : env.DB.prepare(`INSERT INTO products (id, stock, data) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET stock = excluded.stock, data = excluded.data`)
      .bind(product.id, product.stock, JSON.stringify(product)));
  const outcomes = new Map();

  for (let index = 0; index < analysis.writes.length; index += IMPORT_WRITE_CHUNK) {
    const chunk = analysis.writes.slice(index, index + IMPORT_WRITE_CHUNK);
    try {
      const results = await env.DB.batch(chunk.map(entry => statementFor(entry.product)));
      chunk.forEach((entry, position) => {
        const changes = Number(results?.[position]?.meta?.changes ?? 1);
        outcomes.set(entry.rowNumber, changes > 0
          ? { status: entry.action === 'NEW' ? 'created' : 'updated' }
          : { status: 'failed', error: 'The database did not save this row.' });
      });
    } catch (error) {
      // One failed statement fails the whole batch, so retry this chunk row by
      // row to keep the good rows moving and report the exact failing rows.
      console.error('MarketTech import batch failed:', error?.message || error);
      for (const entry of chunk) {
        try {
          await statementFor(entry.product).run();
          outcomes.set(entry.rowNumber, { status: entry.action === 'NEW' ? 'created' : 'updated' });
        } catch (rowError) {
          console.error('MarketTech import row failed:', rowError?.message || rowError);
          outcomes.set(entry.rowNumber, { status: 'failed', error: importWriteErrorMessage(rowError) });
        }
      }
    }
  }

  const rows = analysis.rows.map(row => {
    if (row.action === 'ERROR') return { ...row, status: 'error' };
    if (row.action === 'SKIP') return { ...row, status: 'skipped' };
    const outcome = outcomes.get(row.rowNumber) || { status: 'failed', error: 'This row was not written to the database.' };
    return { ...row, status: outcome.status, error: outcome.error || '' };
  });
  const count = status => rows.filter(row => row.status === status).length;

  return {
    file: analysis.file,
    completedAt: new Date().toISOString(),
    summary: {
      total: rows.length,
      created: count('created'),
      updated: count('updated'),
      skipped: count('skipped'),
      errors: count('error') + count('failed'),
      warnings: rows.filter(row => (row.warnings || []).length > 0).length
    },
    rows: rows.slice(0, MAX_IMPORT_PREVIEW_ROWS),
    truncated: rows.length > MAX_IMPORT_PREVIEW_ROWS
  };
}


function parseRowJson(value, fallback = {}) {
  try { return JSON.parse(value || '{}'); } catch { return fallback; }
}
function parseTags(value) {
  try { return Array.isArray(JSON.parse(value || '[]')) ? JSON.parse(value || '[]') : []; } catch { return []; }
}
function parseCouponRow(row) {
  return { id: row.id, code: row.code, discountType: row.discount_type, discountValue: Number(row.discount_value || 0), minOrder: Number(row.min_order || 0), maxDiscount: Number(row.max_discount || 0), usageLimit: Number(row.usage_limit || 0), usedCount: Number(row.used_count || 0), perCustomerLimit: Number(row.per_customer_limit || 0), startsAt: row.starts_at, endsAt: row.ends_at || '', scopeType: row.scope_type, scopeValue: row.scope_value || '', customerEmail: row.customer_email || '', active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}
function parseOfferRow(row) {
  return { id: row.id, name: row.name, type: row.type, value: Number(row.value || 0), scopeType: row.scope_type, scopeValue: row.scope_value || '', startsAt: row.starts_at, endsAt: row.ends_at, banner: row.banner || '', active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}
function marketingPayload(input, existing = {}, kind = 'coupon') {
  const now = new Date().toISOString();
  const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);
  if (kind === 'coupon') {
    const code = cleanText(input.code ?? existing.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const discountType = String(input.discountType ?? existing.discountType ?? 'percent') === 'fixed' ? 'fixed' : 'percent';
    const discountValue = Math.max(0, Math.min(discountType === 'percent' ? 100 : 1000000, Math.floor(Number(input.discountValue ?? existing.discountValue ?? 0))));
    const minOrder = Math.max(0, Math.min(1000000, Math.floor(Number(input.minOrder ?? existing.minOrder ?? 0))));
    const maxDiscount = Math.max(0, Math.min(1000000, Math.floor(Number(input.maxDiscount ?? existing.maxDiscount ?? 0))));
    const usageLimit = Math.max(0, Math.min(100000000, Math.floor(Number(input.usageLimit ?? existing.usageLimit ?? 0))));
    const perCustomerLimit = Math.max(0, Math.min(1000000, Math.floor(Number(input.perCustomerLimit ?? existing.perCustomerLimit ?? 0))));
    const startsAt = cleanText(input.startsAt ?? existing.startsAt ?? now, 40);
    const endsAt = cleanText(input.endsAt ?? existing.endsAt ?? '', 40);
    const scopeType = ['all','product','category'].includes(input.scopeType ?? existing.scopeType) ? (input.scopeType ?? existing.scopeType) : 'all';
    const scopeValue = cleanText(input.scopeValue ?? existing.scopeValue ?? '', 160);
    const customerEmail = cleanText(input.customerEmail ?? existing.customerEmail ?? '', 254).toLowerCase();
    const active = input.active === undefined ? existing.active !== false : Boolean(input.active);
    if (!code || discountValue < 1) throw new HttpError(400, 'Enter a coupon code and a discount value.');
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) throw new HttpError(400, 'Coupon end time must be after the start time.');
    return { id: existing.id || crypto.randomUUID(), code, discountType, discountValue, minOrder, maxDiscount, usageLimit, usedCount: Number(existing.usedCount || 0), perCustomerLimit, startsAt, endsAt, scopeType, scopeValue, customerEmail, active, createdAt: existing.createdAt || now, updatedAt: now };
  }
  const name = cleanText(input.name ?? existing.name, 100);
  const type = String(input.type ?? existing.type ?? 'percent') === 'fixed' ? 'fixed' : 'percent';
  const value = Math.max(0, Math.min(type === 'percent' ? 90 : 1000000, Math.floor(Number(input.value ?? existing.value ?? 0))));
  const scopeType = ['all','product','category'].includes(input.scopeType ?? existing.scopeType) ? (input.scopeType ?? existing.scopeType) : 'all';
  const scopeValue = cleanText(input.scopeValue ?? existing.scopeValue ?? '', 160);
  const startsAt = cleanText(input.startsAt ?? existing.startsAt ?? now, 40);
  const endsAt = cleanText(input.endsAt ?? existing.endsAt ?? '', 40);
  const banner = cleanText(input.banner ?? existing.banner ?? '', 180);
  const active = input.active === undefined ? existing.active !== false : Boolean(input.active);
  if (!name || value < 1 || !endsAt) throw new HttpError(400, 'Enter an offer name, discount, and end time.');
  if (new Date(endsAt) <= new Date(startsAt)) throw new HttpError(400, 'Offer end time must be after the start time.');
  return { id: existing.id || crypto.randomUUID(), name, type, value, scopeType, scopeValue, startsAt, endsAt, banner, active, createdAt: existing.createdAt || now, updatedAt: now };
}
function offerMatches(offer, product) {
  if (!offer.active) return false;
  const now = Date.now();
  if (new Date(offer.startsAt).getTime() > now || new Date(offer.endsAt).getTime() < now) return false;
  if (offer.scopeType === 'product') return String(product.id) === String(offer.scopeValue);
  if (offer.scopeType === 'category') return String(product.category).toLowerCase() === String(offer.scopeValue).toLowerCase();
  return true;
}
function shippingDistanceKm(lat, lon) {
  const toRad = value => Number(value) * Math.PI / 180;
  const dLat = toRad(Number(lat) - 28.6139);
  const dLon = toRad(Number(lon) - 77.2090);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(28.6139)) * Math.cos(toRad(Number(lat))) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
const NCR_DISTRICTS = new Set(['delhi','new delhi','gurugram','gurgaon','faridabad','noida','greater noida','ghaziabad','meerut','hapur','baghpat','bulandshahr','bulandshahar','muzaffarnagar','shamli','gautam buddha nagar','gautambuddha nagar','rohtak','sonipat','sonepat','rewari','jhajjar','nuh','mewat','palwal','panipat','mahendragarh','bhiwani','charkhi dadri','jind','karnal','alwar','bharatpur','bahadurgarh']);
async function resolveShippingFee(state, pincode) {
  const cleanPin = String(pincode || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(cleanPin)) return 149;
  try {
    const response = await fetch('https://api.zippopotam.us/IN/' + cleanPin, { headers: { 'Accept': 'application/json' } });
    if (response.ok) {
      const data = await response.json();
      const place = data?.places?.[0] || {};
      const district = String(place['place name'] || '').toLowerCase();
      const stateName = String(place.state || state || '').toLowerCase();
      const lat = Number(place.latitude);
      const lon = Number(place.longitude);
      if (stateName === 'delhi' || NCR_DISTRICTS.has(district)) return 49;
      if (Number.isFinite(lat) && Number.isFinite(lon) && shippingDistanceKm(lat, lon) <= 500) return 99;
      if (stateName === 'haryana' || stateName === 'uttar pradesh') return 99;
    }
  } catch {}
  const stateName = String(state || '').trim().toLowerCase();
  if (stateName === 'delhi') return 49;
  if (stateName === 'haryana' || stateName === 'uttar pradesh') return 99;
  return 149;
}

function offerDiscountForLines(offers, lines, products) {
  let best = { discount: 0, offer: null };
  for (const offer of offers) {
    let eligibleSubtotal = 0;
    for (const line of lines) {
      const product = products.get(line.id);
      if (product && offerMatches(offer, product)) eligibleSubtotal += Number(product.price) * line.quantity;
    }
    if (!eligibleSubtotal) continue;
    const discount = offer.type === 'fixed' ? Math.min(eligibleSubtotal, Number(offer.value || 0)) : Math.min(eligibleSubtotal, Math.round(eligibleSubtotal * Number(offer.value || 0) / 100));
    if (discount > best.discount) best = { discount, offer };
  }
  return best;
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const route = url.pathname;
  const method = request.method.toUpperCase();

  if (route === '/api/health' && method === 'GET') return json(200, { ok: true, service: 'MarketTech Kitchen', storage: 'Cloudflare D1 and R2' });

  if (route === '/api/config' && method === 'GET') {
    const settings = await getSettings(env);
    return json(200, {
      storeName: settings.site.storeName,
      currency: 'INR',
      shippingFee: Number.isFinite(Number(settings.site.shippingFee)) ? Number(settings.site.shippingFee) : DEFAULT_SHIPPING_FEE,
      freeShippingAt: Number.isFinite(Number(settings.site.freeShippingAt)) ? Number(settings.site.freeShippingAt) : DEFAULT_FREE_SHIPPING_AT,
      demoAdmin: false,
      previewAuth: false,
      paymentOptions: {
        cashOnDelivery: true,
        upi: Boolean(settings.site.upiVpa),
        razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
        razorpayKeyId: env.RAZORPAY_KEY_ID || ''
      }
    });
  }

  if (route === '/api/public-coupons' && method === 'GET') {
    const nowIso = new Date().toISOString();
    const customer = await getCustomer(request, env);
    const result = await env.DB.prepare('SELECT code, discount_type, discount_value, min_order, max_discount, starts_at, ends_at, scope_type, scope_value, customer_email FROM coupons WHERE active = 1 AND starts_at <= ? AND (ends_at IS NULL OR ends_at >= ?) ORDER BY min_order ASC, discount_value DESC').bind(nowIso, nowIso).all().catch(() => ({ results: [] }));
    return json(200, (result.results || []).filter(row => !row.customer_email || (customer?.email && row.customer_email.toLowerCase() === customer.email.toLowerCase())).map(row => ({
      code: String(row.code || ''),
      discountType: row.discount_type === 'fixed' ? 'fixed' : 'percent',
      discountValue: Number(row.discount_value || 0),
      minOrder: Number(row.min_order || 0),
      maxDiscount: Number(row.max_discount || 0),
      scopeType: row.scope_type || 'all',
      scopeValue: row.scope_value || '',
      customerEmail: row.customer_email || '',
      startsAt: row.starts_at || '',
      endsAt: row.ends_at || ''
    })));
  }

  if (route === '/api/shipping-rate' && method === 'GET') {
    const pincode = String(url.searchParams.get('pincode') || '').replace(/\D/g, '');
    const state = String(url.searchParams.get('state') || '').trim().slice(0, 80);
    const fee = await resolveShippingFee(state, pincode);
    return json(200, { fee, currency: 'INR' });
  }

  if (route === '/api/storefront-settings' && method === 'GET') {
    const settings = await getSettings(env);
    const offers = await env.DB.prepare('SELECT * FROM offers WHERE active = 1 AND starts_at <= ? AND ends_at >= ? ORDER BY starts_at DESC').bind(new Date().toISOString(), new Date().toISOString()).all().catch(() => ({ results: [] }));
    return json(200, { site: settings.site, policies: settings.policies, marketing: settings.marketing, developer: settings.developer, offers: (offers.results || []).map(parseOfferRow) });
  }

  if (route === '/api/auth/register' && method === 'POST') {
    const body = await readJson(request);
    const name = String(body.name || '').trim().slice(0, 100);
    const email = cleanEmail(body.email);
    const phone = normalizePhone(body.phone);
    const phoneDigits = phone.replace(/\D/g, '');
    const password = String(body.password || '');
    const passwordValid = password.length >= 4 && password.length <= 128
      && /[A-Z]/.test(password)
      && /[a-z]/.test(password)
      && /\d/.test(password)
      && /[^A-Za-z0-9]/.test(password);
    if (!name || !email || phoneDigits.length < 10 || phoneDigits.length > 15 || !passwordValid) {
      return json(400, { error: 'Use a password with 1 capital letter, 1 small letter, 1 number and 1 symbol. It can be short.' });
    }
    const existing = await env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first();
    if (existing) return json(409, { error: 'An account with that email already exists. Sign in instead.' });
    const credential = await hashPassword(password);
    const customer = { id: crypto.randomUUID(), name, email, phone, passwordSalt: credential.salt, passwordHash: credential.hash, createdAt: new Date().toISOString() };
    try {
      await env.DB.prepare(`INSERT INTO customers (id, email, name, phone, password_salt, password_hash, password_iterations, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(customer.id, email, name, phone, credential.salt, credential.hash, credential.iterations, customer.createdAt).run();
    } catch (error) {
      const duplicate = await env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first();
      if (duplicate) return json(409, { error: 'An account with that email already exists. Sign in instead.' });
      throw error;
    }
    const token = await createSession(env, 'customer', customer.id);
    return json(201, { ok: true, customer: { id: customer.id, name, email, phone, createdAt: customer.createdAt } }, {
      'Set-Cookie': sessionCookie('mt_customer', token, Math.floor(CUSTOMER_SESSION_MS / 1000))
    });
  }

  if (route === '/api/auth/login' && method === 'POST') {
    const windowMs = 15 * 60 * 1000;
    if (await isRateLimited(env, request, 'customer', 8, windowMs)) return json(429, { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    const password = String(body.password || '');
    const customer = email ? await env.DB.prepare('SELECT id, email, name, phone, password_salt, password_hash, password_iterations, created_at FROM customers WHERE email = ?').bind(email).first() : null;
    let matches = false;
    if (password.length <= 128) {
      if (customer) matches = await verifyPassword(password, customer);
      else await hashPassword(password, new Uint8Array(16), PASSWORD_ITERATIONS);
    }
    if (!matches) {
      await recordLoginFailure(env, request, 'customer', windowMs);
      return json(401, { error: 'That email and password don’t match.' });
    }
    await clearLoginFailures(env, request, 'customer');
    const token = await createSession(env, 'customer', customer.id);
    return json(200, { ok: true, customer: safeCustomer(customer) }, {
      'Set-Cookie': sessionCookie('mt_customer', token, Math.floor(CUSTOMER_SESSION_MS / 1000))
    });
  }

  if (route === '/api/auth/logout' && method === 'POST') {
    const token = getToken(request, 'mt_customer');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ? AND kind = ?').bind(await sha256(token), 'customer').run();
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('mt_customer', '', 0) });
  }

  if (route === '/api/auth/me' && method === 'GET') return json(200, { customer: await getCustomer(request, env) });

  if (route === '/api/account/orders' && method === 'GET') {
    const customer = await getCustomer(request, env);
    if (!customer) return json(401, { error: 'Please sign in to view your account.' });
    const result = await env.DB.prepare('SELECT id, status, payment_status, total, created_at, data FROM orders WHERE customer_id = ? ORDER BY created_at DESC').bind(customer.id).all();
    return json(200, (result.results || []).map(parseOrder).map(order => ({
      id: order.id,
      createdAt: order.createdAt,
      status: order.status,
      total: order.total,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      items: order.items,
      subtotal: order.subtotal,
      discount: order.discount,
      shipping: order.shipping
    })));
  }

  if (route === '/api/order-tracking' && method === 'POST') {
    const body = await readJson(request);
    const orderId = String(body.orderId || '').trim().toUpperCase().slice(0, 80);
    const phone = normalizePhone(body.phone || '');
    const email = cleanEmail(body.email || '');
    if (!orderId || (!phone && !email)) return json(400, { error: 'Enter your order number and the phone number or email used for the order.' });
    const row = await env.DB.prepare('SELECT id, status, payment_status, total, created_at, data FROM orders WHERE id = ?').bind(orderId).first();
    if (!row) return json(404, { error: 'We could not find that order. Please check the order number and try again.' });
    const order = parseOrder(row);
    const orderPhone = normalizePhone(order.customer?.phone || '');
    const orderEmail = cleanEmail(order.customer?.email || '');
    const phoneMatches = phone && orderPhone && phone.replace(/\D/g, '') === orderPhone.replace(/\D/g, '');
    const emailMatches = email && orderEmail && email === orderEmail;
    if (!phoneMatches && !emailMatches) return json(404, { error: 'The order number does not match the contact details provided.' });
    return json(200, {
      ok: true,
      order: {
        id: order.id,
        createdAt: order.createdAt,
        status: order.status,
        paymentStatus: order.paymentStatus,
        total: order.total,
        items: (order.items || []).map(item => ({ name: item.name, quantity: Number(item.quantity) || 1, image: item.image || '' })),
        customerName: order.customer?.name || ''
      }
    });
  }

  if (route === '/api/products' && method === 'GET') {
    return json(200, (await listProducts(env))
      .filter(product => String(product.status || 'active').toLowerCase() !== 'inactive')
      .map(publicProduct));
  }

  if (route === '/api/newsletter' && method === 'POST') {
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    if (!email) return json(400, { error: 'Enter a valid email address.' });
    await env.DB.prepare('INSERT OR IGNORE INTO subscribers (email, created_at) VALUES (?, ?)').bind(email, new Date().toISOString()).run();
    return json(201, { ok: true, message: 'You’re on the list. Watch your inbox for a little kitchen inspiration.' });
  }

  if (route === '/api/orders' && method === 'POST') {
    const body = await readJson(request);
    const customerInput = body.customer && typeof body.customer === 'object' ? body.customer : {};
    const signedInCustomer = await getCustomer(request, env);
    const name = String(customerInput.name || signedInCustomer?.name || '').trim().slice(0, 100);
    const phone = normalizePhone(customerInput.phone || signedInCustomer?.phone || '');
    const email = signedInCustomer?.email || (customerInput.email ? cleanEmail(customerInput.email) : '');
    const address = String(customerInput.address || '').trim().slice(0, 220);
    const city = String(customerInput.city || '').trim().slice(0, 80);
    const state = String(customerInput.state || '').trim().slice(0, 80);
    const pincode = String(customerInput.pincode || '').trim().slice(0, 10);
    if (!name || phone.replace(/\D/g, '').length < 10 || !address || !city || !state || !/^\d{6}$/.test(pincode)) {
      return json(400, { error: 'Please complete your name, phone, delivery address, city, state and six-digit PIN code.' });
    }
    if (customerInput.email && !email) return json(400, { error: 'Enter a valid email address, or leave it blank.' });

    const inputItems = Array.isArray(body.items) ? body.items : [];
    if (!inputItems.length || inputItems.length > 50) return json(400, { error: 'Your bag is empty.' });
    const quantities = new Map();
    const requestedLines = [];
    for (const item of inputItems) {
      const id = String(item.id || '');
      const quantity = Number(item.quantity);
      const color = String(item.color || '').trim().slice(0, 40);
      const size = String(item.size || '').trim().slice(0, 24);
      if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return json(400, { error: 'One of the items in your bag is no longer available. Please refresh and try again.' });
      }
      requestedLines.push({ id, quantity, color, size });
      const combined = (quantities.get(id) || 0) + quantity;
      if (combined > 99) return json(400, { error: 'Please reduce the quantity of one of the items in your bag.' });
      quantities.set(id, combined);
    }

    const productList = await productsByIds(env, [...quantities.keys()]);
    if (productList.length !== quantities.size) return json(400, { error: 'One of the items in your bag is no longer available. Please refresh and try again.' });
    const products = new Map(productList
      .filter(product => String(product.status || 'active').toLowerCase() !== 'inactive')
      .map(product => [product.id, product]));
    if (products.size !== quantities.size) return json(400, { error: 'One of the items in your bag is no longer available. Please refresh and try again.' });
    const orderItems = [];
    let subtotal = 0;
    for (const line of requestedLines) {
      const product = products.get(line.id);
      const lineSubtotal = Number(product.price) * line.quantity;
      orderItems.push({
        id: product.id, name: product.name, price: product.price, image: product.image, quantity: line.quantity,
        color: line.color, size: line.size, quantityDiscountPercent: 0, lineDiscount: 0
      });
      subtotal += lineSubtotal;
    }
    const totalQuantity = requestedLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    const quantityDiscountPercent = quantityDiscountPercentForCart(totalQuantity);
    const quantityDiscount = Math.round(subtotal * quantityDiscountPercent / 100);
    if (quantityDiscount) {
      for (const item of orderItems) {
        const lineSubtotal = Number(item.price) * Number(item.quantity);
        item.quantityDiscountPercent = quantityDiscountPercent;
        item.lineDiscount = Math.round(quantityDiscount * (lineSubtotal / subtotal));
      }
    }

    const settings = await getSettings(env);
    const freeShippingAt = Number.isFinite(Number(settings.site.freeShippingAt)) ? Number(settings.site.freeShippingAt) : DEFAULT_FREE_SHIPPING_AT;
    const shippingFee = Number.isFinite(Number(settings.site.shippingFee)) ? Number(settings.site.shippingFee) : DEFAULT_SHIPPING_FEE;
    const shipping = await resolveShippingFee(state, pincode);
    const nowIso = new Date().toISOString();
    const activeOffersRows = await env.DB.prepare('SELECT * FROM offers WHERE active = 1 AND starts_at <= ? AND ends_at >= ?').bind(nowIso, nowIso).all().catch(() => ({ results: [] }));
    const activeOffers = (activeOffersRows.results || []).map(parseOfferRow);
    const offerResult = offerDiscountForLines(activeOffers, requestedLines, products);
    const offerDiscount = offerResult.discount;
    const requestedCoupon = String(body.couponCode || '').trim().toUpperCase();
    let discount = 0;
    let couponRecord = null;
    if (requestedCoupon) {
      const couponRow = await env.DB.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1').bind(requestedCoupon).first();
      if (!couponRow) return json(400, { error: 'That promo code is not active.' });
      if (couponRow.customer_email && (!signedInCustomer?.email || couponRow.customer_email.toLowerCase() !== signedInCustomer.email.toLowerCase())) return json(403, { error: 'This promo code is reserved for a specific customer account.' });
      couponRecord = parseCouponRow(couponRow);
      if (new Date(couponRecord.startsAt) > new Date(nowIso) || (couponRecord.endsAt && new Date(couponRecord.endsAt) < new Date(nowIso))) return json(400, { error: 'That promo code is outside its active dates.' });
      if (couponRecord.usageLimit && couponRecord.usedCount >= couponRecord.usageLimit) return json(400, { error: 'That promo code has reached its usage limit.' });
      if (couponRecord.perCustomerLimit && signedInCustomer?.id) {
        const used = await env.DB.prepare('SELECT COUNT(*) AS count FROM orders WHERE customer_id = ? AND data LIKE ?').bind(signedInCustomer.id, '%"discountCode":"' + requestedCoupon.replaceAll('"','') + '"%').first();
        if (Number(used?.count || 0) >= couponRecord.perCustomerLimit) return json(400, { error: 'This coupon has reached its limit for your account.' });
      }
      if (subtotal < couponRecord.minOrder) return json(400, { error: `Add ₹${couponRecord.minOrder - subtotal} more to use this code.` });
      const eligibleSubtotal = couponRecord.scopeType === 'all' ? subtotal : requestedLines.reduce((sum, line) => {
        const p = products.get(line.id); if (!p) return sum;
        const eligible = couponRecord.scopeType === 'product' ? p.id === couponRecord.scopeValue : String(p.category).toLowerCase() === couponRecord.scopeValue.toLowerCase();
        return sum + (eligible ? Number(p.price) * line.quantity : 0);
      }, 0);
      if (!eligibleSubtotal) return json(400, { error: 'This coupon does not apply to the items in your bag.' });
      discount = couponRecord.discountType === 'fixed' ? Math.min(eligibleSubtotal, couponRecord.discountValue) : Math.min(couponRecord.maxDiscount || Infinity, Math.round(eligibleSubtotal * couponRecord.discountValue / 100));
    } else {
      discount = 0;
    }
    const promotionDiscount = Math.min(subtotal - quantityDiscount, Math.max(0, offerDiscount));
    discount += promotionDiscount;

    const requestedPayment = String(body.paymentMethod || 'cod').toLowerCase();
    if (!['cod', 'upi', 'razorpay'].includes(requestedPayment)) return json(400, { error: 'Choose a valid payment option.' });
    if (requestedPayment === 'upi' && !settings.site.upiVpa) return json(400, { error: 'UPI is not configured yet. Please choose another payment option.' });
    if (requestedPayment === 'razorpay' && (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)) return json(400, { error: 'Online payment is not connected yet. Please choose COD or UPI.' });

    const order = {
      id: `MT-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${hex(crypto.getRandomValues(new Uint8Array(2))).toUpperCase()}`,
      createdAt: new Date().toISOString(),
      customerId: signedInCustomer?.id || '',
      customer: {
        name,
        phone,
        email,
        address,
        city,
        state,
        pincode,
        note: String(customerInput.note || '').trim().slice(0, 300)
      },
      items: orderItems,
      subtotal,
      discount,
      discountCode: couponRecord ? requestedCoupon : '',
      offerId: offerResult.offer?.id || '',
      offerName: offerResult.offer?.name || '',
      offerDiscount: promotionDiscount,
      shipping,
      quantityDiscount,
      total: subtotal - discount - quantityDiscount + shipping,
      paymentMethod: requestedPayment === 'cod' ? 'Cash on Delivery' : requestedPayment === 'upi' ? 'UPI' : 'Razorpay',
      paymentStatus: requestedPayment === 'cod' ? 'Due on delivery' : 'Pending',
      status: 'New'
    };

    let razorpayOrder = null;
    if (requestedPayment === 'razorpay') {
      razorpayOrder = await createRazorpayOrder(order, env);
      order.gatewayOrderId = razorpayOrder.id;
    }

    // One conditional D1 update reserves every item or none. The following INSERT uses
    // SQLite changes() inside the same D1 batch so an order is not saved if stock moved.
    const quantityJson = JSON.stringify(Object.fromEntries(quantities));
    const stockUpdate = `UPDATE products
      SET stock = stock - CAST((SELECT value FROM json_each(?) WHERE key = products.id) AS INTEGER)
      WHERE id IN (SELECT key FROM json_each(?))
      AND (SELECT COUNT(*) FROM products AS p JOIN json_each(?) AS q ON p.id = q.key
           WHERE p.stock >= CAST(q.value AS INTEGER)) = (SELECT COUNT(*) FROM json_each(?))`;
    const orderInsert = `INSERT INTO orders (id, customer_id, status, payment_status, total, created_at, data)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = ?`;
    const batch = await env.DB.batch([
      env.DB.prepare(stockUpdate).bind(quantityJson, quantityJson, quantityJson, quantityJson),
      env.DB.prepare(orderInsert).bind(order.id, order.customerId, order.status, order.paymentStatus, order.total, order.createdAt, JSON.stringify(order), quantities.size)
    ]);
    if (!batch?.[1]?.meta?.changes) return json(409, { error: 'Stock changed while you were checking out. Please refresh your bag and try again.' });
    if (couponRecord) {
      const claimed = await env.DB.prepare('UPDATE coupons SET used_count = used_count + 1, updated_at = ? WHERE id = ? AND (usage_limit = 0 OR used_count < usage_limit)').bind(new Date().toISOString(), couponRecord.id).run();
      // The order is already committed; keep the purchase intact if another checkout won the last usage slot.
    }

    const responseOrder = { id: order.id, total: order.total, status: order.status, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus };
    if (requestedPayment === 'upi') {
      const params = new URLSearchParams({ pa: settings.site.upiVpa, pn: settings.site.storeName, am: String(order.total), cu: 'INR', tn: order.id });
      responseOrder.upiLink = `upi://pay?${params.toString()}`;
      responseOrder.upiVpa = settings.site.upiVpa;
      responseOrder.upiQrImage = settings.site.upiQrImage || '';
    }
    if (requestedPayment === 'razorpay' && razorpayOrder) {
      responseOrder.razorpay = {
        keyId: env.RAZORPAY_KEY_ID,
        orderId: razorpayOrder.id,
        amount: Math.round(order.total * 100),
        currency: 'INR'
      };
    }
    return json(201, { ok: true, order: responseOrder });
  }

  if (route === '/api/payment/razorpay/verify' && method === 'POST') {
    if (!env.RAZORPAY_KEY_SECRET) return json(503, { error: 'Payment verification is not configured.' });
    const body = await readJson(request);
    const orderRow = await env.DB.prepare('SELECT id, status, payment_status, total, created_at, data FROM orders WHERE id = ?')
      .bind(String(body.orderId || '')).first();
    const order = orderRow ? parseOrder(orderRow) : null;
    if (!order || order.gatewayOrderId !== String(body.razorpay_order_id || '')) return json(404, { error: 'The order for this payment could not be found.' });
    const paymentId = String(body.razorpay_payment_id || '');
    const signature = String(body.razorpay_signature || '');
    const expected = await razorpaySignature(env.RAZORPAY_KEY_SECRET, `${order.gatewayOrderId}|${paymentId}`);
    if (!paymentId || !constantTimeEqual(expected, signature)) return json(400, { error: 'Payment signature could not be verified.' });
    order.paymentStatus = 'Paid';
    order.gatewayPaymentId = paymentId;
    order.updatedAt = new Date().toISOString();
    await env.DB.prepare('UPDATE orders SET payment_status = ?, data = ? WHERE id = ?')
      .bind(order.paymentStatus, JSON.stringify(order), order.id).run();
    return json(200, { ok: true, order: { id: order.id, total: order.total, status: order.status, paymentStatus: order.paymentStatus } });
  }

  if (route === '/api/admin/login' && method === 'POST') {
    const windowMs = 15 * 60 * 1000;
    if (await isRateLimited(env, request, 'admin', 10, windowMs)) return json(429, { error: 'Too many attempts. Please wait a little and try again.' });
    const body = await readJson(request);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const expectedEmail = String(env.ADMIN_EMAIL || 'admin@markettech.in').trim().toLowerCase();
    const expectedPassword = String(env.ADMIN_PASSWORD || '');
    if (!expectedPassword) return json(503, { error: 'Admin sign-in is not configured yet. Add ADMIN_PASSWORD in Cloudflare Pages settings.' });
    if (!constantTimeEqual(email, expectedEmail) || !constantTimeEqual(password, expectedPassword)) {
      await recordLoginFailure(env, request, 'admin', windowMs);
      return json(401, { error: 'That email and password don’t match.' });
    }
    await clearLoginFailures(env, request, 'admin');
    const token = await createSession(env, 'admin', 'owner');
    return json(200, { ok: true, email: expectedEmail }, {
      'Set-Cookie': sessionCookie('mt_admin', token, Math.floor(ADMIN_SESSION_MS / 1000))
    });
  }

  if (route === '/api/admin/logout' && method === 'POST') {
    const token = getToken(request, 'mt_admin');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ? AND kind = ?').bind(await sha256(token), 'admin').run();
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('mt_admin', '', 0) });
  }

  if (route === '/api/admin/me' && method === 'GET') {
    if (!await sessionUser(request, env, 'admin')) return json(401, { error: 'Please sign in to continue.' });
    return json(200, { email: String(env.ADMIN_EMAIL || 'admin@markettech.in').trim().toLowerCase() });
  }

  if (route.startsWith('/api/admin/')) {
    if (!await sessionUser(request, env, 'admin')) return json(401, { error: 'Please sign in to continue.' });

    if (route === '/api/admin/flipkart/status' && method === 'GET') {
      return json(200, {
        ok: true,
        authenticated: true,
        credentialsConfigured: Boolean(String(env.FLIPKART_APP_ID || '').trim() && String(env.FLIPKART_APP_SECRET || '')),
        authEndpoint: 'https://api.flipkart.net/oauth-service/oauth/token',
        testMethod: 'POST'
      });
    }

    if (route === '/api/admin/flipkart/test' && method === 'GET' && url.searchParams.get('run') === 'network') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      try {
        const probe = await fetch('https://api.flipkart.net/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        return json(200, {
          ok: true,
          diagnosticCode: 'FLIPKART_NETWORK_REACHABLE',
          providerStatus: probe.status,
          message: 'The Flipkart host responded to a request without credentials; no credentials or token were sent.'
        });
      } catch (error) {
        return json(502, {
          ok: false,
          diagnosticCode: controller.signal.aborted ? 'FLIPKART_NETWORK_TIMEOUT' : 'FLIPKART_NETWORK_FAILED',
          error: controller.signal.aborted ? 'The Flipkart host did not respond within 4 seconds.' : 'The server could not reach the Flipkart host.'
        });
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (route === '/api/admin/flipkart/test' && method === 'GET' && url.searchParams.get('run') === 'oauth-state') {
      const diagnosticRow = await env.DB.prepare("SELECT data FROM store_settings WHERE id = 'flipkart_oauth_diagnostic'").first();
      if (!diagnosticRow?.data) return json(200, { ok: true, diagnosticCode: 'NO_OAUTH_DIAGNOSTIC', message: 'No OAuth runtime checkpoint has been recorded yet.' });
      try {
        return json(200, { ok: true, diagnostic: JSON.parse(diagnosticRow.data) });
      } catch {
        return json(200, { ok: true, diagnostic: { stage: 'stored_record_unreadable' } });
      }
    }

    if (route === '/api/admin/flipkart/test' && method === 'GET' && url.searchParams.get('run') !== 'oauth') {
      return json(200, {
        ok: true,
        diagnosticCode: 'FLIPKART_TEST_ROUTE_REACHED',
        message: 'The authenticated test route is running. Add ?run=oauth to perform the read-only authentication test.'
      });
    }

    if (route === '/api/admin/flipkart/test' && (method === 'POST' || (method === 'GET' && url.searchParams.get('run') === 'oauth'))) {
      const clientId = String(env.FLIPKART_APP_ID || '').trim();
      const clientSecret = String(env.FLIPKART_APP_SECRET || '');
      if (!clientId || !clientSecret) {
        return json(503, { ok: false, error: 'Flipkart credentials are not configured in this environment.', diagnosticCode: 'CREDENTIALS_MISSING' });
      }

      const writeOAuthDiagnostic = async (stage, details = {}) => {
        const record = { stage, updatedAt: new Date().toISOString(), ...details };
        try {
          await env.DB.prepare("INSERT INTO store_settings (id, data) VALUES ('flipkart_oauth_diagnostic', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
            .bind(JSON.stringify(record)).run();
        } catch (diagnosticError) {
          console.error('Flipkart OAuth diagnostic checkpoint failed:', diagnosticError?.name || 'DatabaseError');
        }
      };
      await writeOAuthDiagnostic('credentials_loaded', {
        appIdConfigured: Boolean(clientId),
        secretConfigured: Boolean(clientSecret),
        appIdLength: clientId.length,
        secretLength: clientSecret.length
      });

      const tokenUrl = new URL('https://api.flipkart.net/oauth-service/oauth/token');
      tokenUrl.searchParams.set('grant_type', 'client_credentials');
      tokenUrl.searchParams.set('scope', 'Seller_Api');

      let response;
      try {
        const credentialBytes = new TextEncoder().encode(clientId + ':' + clientSecret);
        let credentialBinary = '';
        for (const byte of credentialBytes) credentialBinary += String.fromCharCode(byte);
        const authorization = 'Basic ' + btoa(credentialBinary);
        await writeOAuthDiagnostic('before_fetch', {
          authEndpoint: tokenUrl.origin + tokenUrl.pathname,
          scope: 'Seller_Api'
        });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          response = await fetch(tokenUrl.toString(), {
            method: 'GET',
            headers: {
              Authorization: authorization,
              Accept: 'application/json'
            },
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        console.error('Flipkart OAuth request failed:', error?.name || 'FetchError');
        await writeOAuthDiagnostic('fetch_error', {
          errorName: String(error?.name || 'FetchError'),
          timedOut: error?.name === 'TimeoutError' || error?.name === 'AbortError'
        });
        return json(502, {
          ok: false,
          error: error?.message === 'FLIPKART_TIMEOUT' || error?.name === 'TimeoutError' || error?.name === 'AbortError'
            ? 'Flipkart authentication request timed out.'
            : 'Could not reach Flipkart authentication service.',
          diagnosticCode: error?.name === 'TimeoutError' || error?.name === 'AbortError'
            ? 'FLIPKART_TIMEOUT'
            : 'FLIPKART_FETCH_FAILED'
        });
      }

      await writeOAuthDiagnostic('response_received', {
        providerStatus: response.status,
        providerOk: response.ok
      });
      let tokenData = {};
      try {
        tokenData = await response.json();
      } catch (error) {
        console.error('Flipkart OAuth response could not be read:', error?.name || 'ResponseReadError');
        return json(502, {
          ok: false,
          error: 'Flipkart responded, but its authentication response could not be read.',
          diagnosticCode: 'FLIPKART_RESPONSE_READ_FAILED',
          providerStatus: response.status
        });
      }
      await writeOAuthDiagnostic('response_parsed', {
        providerStatus: response.status,
        providerOk: response.ok,
        tokenPresent: Boolean(tokenData.access_token),
        providerErrorCode: String(tokenData.error || '').slice(0, 80)
      });
      if (!response.ok || !tokenData.access_token) {
        return json(502, {
          ok: false,
          error: 'Flipkart authentication failed.',
          diagnosticCode: 'FLIPKART_AUTH_REJECTED',
          providerStatus: response.status,
          providerError: String(tokenData.error || tokenData.error_description || 'No access token returned').slice(0, 240)
        });
      }

      await writeOAuthDiagnostic('authenticated', {
        providerStatus: response.status,
        tokenPresent: true
      });
      return json(200, {
        ok: true,
        connected: true,
        message: 'Flipkart authentication succeeded. The access token was not returned to the browser.',
        tokenType: String(tokenData.token_type || 'bearer'),
        expiresIn: Number(tokenData.expires_in || 0),
        scope: String(tokenData.scope || 'Seller_Api')
      });
    }

    if (route === '/api/admin/settings' && method === 'GET') return json(200, await getSettings(env));
    if (route === '/api/admin/settings' && method === 'PUT') {
      const body = await readJson(request);
      const current = await getSettings(env);
      const settings = updateSettings(current, body);
      await env.DB.prepare("INSERT INTO store_settings (id, data) VALUES ('default', ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
        .bind(JSON.stringify(settings)).run();
      return json(200, settings);
    }

    if (route === '/api/admin/integrations' && method === 'GET') {
      const settings = await getSettings(env);
      return json(200, {
        razorpay: { configured: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET), mode: env.RAZORPAY_MODE || 'test', keyId: env.RAZORPAY_KEY_ID || '' },
        upi: { configured: Boolean(settings.site.upiVpa), vpa: settings.site.upiVpa || '' },
        analytics: {
          googleAnalytics: Boolean(settings.marketing.googleAnalyticsId),
          googleAds: Boolean(settings.marketing.googleAdsId),
          googleTagManager: Boolean(settings.marketing.googleTagManagerId),
          metaPixel: Boolean(settings.marketing.metaPixelId)
        },
        emailProvider: { configured: Boolean(env.RESEND_API_KEY || env.SENDGRID_API_KEY) },
        imageStorage: { configured: Boolean(env.UPLOADS) }
      });
    }


    if (route === '/api/admin/coupons' && method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
      return json(200, (result.results || []).map(parseCouponRow));
    }
    if (route === '/api/admin/coupons' && method === 'POST') {
      const body = await readJson(request);
      const coupon = marketingPayload(body, {}, 'coupon');
      try {
        await env.DB.prepare(`INSERT INTO coupons (id, code, discount_type, discount_value, min_order, max_discount, usage_limit, used_count, per_customer_limit, starts_at, ends_at, scope_type, scope_value, active, created_at, updated_at, customer_email)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(coupon.id, coupon.code, coupon.discountType, coupon.discountValue, coupon.minOrder, coupon.maxDiscount, coupon.usageLimit, 0, coupon.perCustomerLimit, coupon.startsAt, coupon.endsAt || null, coupon.scopeType, coupon.scopeValue, coupon.active ? 1 : 0, coupon.createdAt, coupon.updatedAt, coupon.customerEmail).run();
      } catch (error) {
        if (String(error?.message || '').toLowerCase().includes('unique')) return json(409, { error: 'That coupon code already exists.' });
        throw error;
      }
      return json(201, coupon);
    }
    const couponMatch = route.match(/^\/api\/admin\/coupons\/([^/]+)$/);
    if (couponMatch && (method === 'PATCH' || method === 'DELETE')) {
      const id = decodeURIComponent(couponMatch[1]);
      const row = await env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(id).first();
      if (!row) return json(404, { error: 'Coupon not found.' });
      if (method === 'DELETE') { await env.DB.prepare('DELETE FROM coupons WHERE id = ?').bind(id).run(); return json(200, { ok: true }); }
      const current = parseCouponRow(row);
      const coupon = marketingPayload(await readJson(request), current, 'coupon');
      try {
        await env.DB.prepare(`UPDATE coupons SET code=?, discount_type=?, discount_value=?, min_order=?, max_discount=?, usage_limit=?, per_customer_limit=?, starts_at=?, ends_at=?, scope_type=?, scope_value=?, active=?, updated_at=?, customer_email=? WHERE id=?`)
          .bind(coupon.code, coupon.discountType, coupon.discountValue, coupon.minOrder, coupon.maxDiscount, coupon.usageLimit, coupon.perCustomerLimit, coupon.startsAt, coupon.endsAt || null, coupon.scopeType, coupon.scopeValue, coupon.active ? 1 : 0, coupon.updatedAt, coupon.customerEmail, id).run();
      } catch (error) {
        if (String(error?.message || '').toLowerCase().includes('unique')) return json(409, { error: 'That coupon code already exists.' });
        throw error;
      }
      return json(200, coupon);
    }

    if (route === '/api/admin/offers' && method === 'GET') {
      const result = await env.DB.prepare('SELECT * FROM offers ORDER BY starts_at DESC').all();
      return json(200, (result.results || []).map(parseOfferRow));
    }
    if (route === '/api/admin/offers' && method === 'POST') {
      const offer = marketingPayload(await readJson(request), {}, 'offer');
      await env.DB.prepare(`INSERT INTO offers (id,name,type,value,scope_type,scope_value,starts_at,ends_at,banner,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(offer.id, offer.name, offer.type, offer.value, offer.scopeType, offer.scopeValue, offer.startsAt, offer.endsAt, offer.banner, offer.active ? 1 : 0, offer.createdAt, offer.updatedAt).run();
      return json(201, offer);
    }
    const offerMatch = route.match(/^\/api\/admin\/offers\/([^/]+)$/);
    if (offerMatch && (method === 'PATCH' || method === 'DELETE')) {
      const id = decodeURIComponent(offerMatch[1]);
      const row = await env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
      if (!row) return json(404, { error: 'Offer not found.' });
      if (method === 'DELETE') { await env.DB.prepare('DELETE FROM offers WHERE id = ?').bind(id).run(); return json(200, { ok: true }); }
      const offer = marketingPayload(await readJson(request), parseOfferRow(row), 'offer');
      await env.DB.prepare(`UPDATE offers SET name=?,type=?,value=?,scope_type=?,scope_value=?,starts_at=?,ends_at=?,banner=?,active=?,updated_at=? WHERE id=?`)
        .bind(offer.name, offer.type, offer.value, offer.scopeType, offer.scopeValue, offer.startsAt, offer.endsAt, offer.banner, offer.active ? 1 : 0, offer.updatedAt, id).run();
      return json(200, offer);
    }

    if (route === '/api/admin/crm/segments' && method === 'GET') {
      const customersResult = await env.DB.prepare('SELECT id, name, email, phone, created_at FROM customers ORDER BY created_at DESC').all();
      const metaResult = await env.DB.prepare('SELECT * FROM crm_customer_meta').all();
      const ordersResult = await env.DB.prepare('SELECT customer_id,total,status,created_at FROM orders WHERE customer_id <> ""').all();
      const meta = new Map((metaResult.results || []).map(row => [row.customer_id, { tags: parseTags(row.tags), segment: row.segment || 'General', note: row.note || '' }]));
      const agg = new Map();
      for (const row of ordersResult.results || []) {
        const x = agg.get(row.customer_id) || { orders: 0, spend: 0, lastOrder: '' };
        if (row.status !== 'Cancelled') x.spend += Number(row.total || 0);
        x.orders += 1; if (!x.lastOrder || row.created_at > x.lastOrder) x.lastOrder = row.created_at; agg.set(row.customer_id, x);
      }
      return json(200, (customersResult.results || []).map(row => ({ ...safeCustomer(row), ...(agg.get(row.id) || { orders: 0, spend: 0, lastOrder: '' }), ...(meta.get(row.id) || { tags: [], segment: 'General', note: '' }) })));
    }

    const crmCustomerMatch = route.match(/^\/api\/admin\/crm\/customers\/([^/]+)$/);
    if (crmCustomerMatch && method === 'GET') {
      const id = decodeURIComponent(crmCustomerMatch[1]);
      const customer = await env.DB.prepare('SELECT id,name,email,phone,created_at FROM customers WHERE id=?').bind(id).first();
      if (!customer) return json(404, { error: 'Customer not found.' });
      const [meta, notes, orders] = await Promise.all([
        env.DB.prepare('SELECT * FROM crm_customer_meta WHERE customer_id=?').bind(id).first(),
        env.DB.prepare('SELECT id,body,created_at FROM crm_notes WHERE customer_id=? ORDER BY created_at DESC').bind(id).all(),
        env.DB.prepare('SELECT id,status,payment_status,total,created_at,data FROM orders WHERE customer_id=? ORDER BY created_at DESC').bind(id).all()
      ]);
      return json(200, { customer: safeCustomer(customer), meta: meta ? { tags: parseTags(meta.tags), segment: meta.segment, note: meta.note } : { tags: [], segment: 'General', note: '' }, notes: notes.results || [], orders: (orders.results || []).map(parseOrder) });
    }

    if (crmCustomerMatch && method === 'PATCH') {
      const id = decodeURIComponent(crmCustomerMatch[1]);
      const body = await readJson(request);
      const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map(v => String(v).trim().slice(0, 32)).filter(Boolean))].slice(0, 20) : [];
      const segment = String(body.segment || 'General').trim().slice(0, 40) || 'General';
      const note = String(body.note || '').trim().slice(0, 2000);
      await env.DB.prepare(`INSERT INTO crm_customer_meta(customer_id,tags,segment,note,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET tags=excluded.tags,segment=excluded.segment,note=excluded.note,updated_at=excluded.updated_at`)
        .bind(id, JSON.stringify(tags), segment, note, new Date().toISOString()).run();
      return json(200, { ok: true, tags, segment, note });
    }

    if (route === '/api/admin/crm/notes' && method === 'POST') {
      const body = await readJson(request);
      const customerId = String(body.customerId || '');
      const note = String(body.body || '').trim().slice(0, 2000);
      if (!customerId || !note) return json(400, { error: 'Write a customer note first.' });
      const customer = await env.DB.prepare('SELECT id FROM customers WHERE id=?').bind(customerId).first();
      if (!customer) return json(404, { error: 'Customer not found.' });
      const row = { id: crypto.randomUUID(), customerId, body: note, createdAt: new Date().toISOString() };
      await env.DB.prepare('INSERT INTO crm_notes(id,customer_id,body,created_at) VALUES(?,?,?,?)').bind(row.id,row.customerId,row.body,row.createdAt).run();
      return json(201, row);
    }

    if (route === '/api/admin/uploads' && method === 'POST') {
      if (!env.UPLOADS) return json(503, { error: 'Image storage is not connected. Add the R2 bucket binding named UPLOADS in Cloudflare Pages settings, then redeploy.' });
      const body = await readJson(request, 7_000_000);
      const match = String(body.dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
      if (!match) return json(400, { error: 'Choose a PNG, JPG or WebP image.' });
      const mime = match[1].toLowerCase();
      let bytes;
      try {
        const binary = atob(match[2].replace(/\s/g, ''));
        bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      } catch { return json(400, { error: 'That image file could not be read. Try another PNG, JPG or WebP.' }); }
      if (bytes.length > 5 * 1024 * 1024) return json(413, { error: 'Image is too large. Please use a file under 5 MB.' });
      if (!validateImageBytes(bytes, mime)) return json(400, { error: 'That image file could not be verified. Try another PNG, JPG or WebP.' });
      const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
      const key = `${Date.now()}-${hex(crypto.getRandomValues(new Uint8Array(8)))}.${extension}`;
      await env.UPLOADS.put(key, bytes, { httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' } });
      return json(201, { ok: true, url: `/uploads/${key}` });
    }
    if (route === '/api/admin/uploads/batch' && method === 'POST') {
      if (!env.UPLOADS) return json(503, { error: 'Image storage is not connected. Add the R2 bucket binding named UPLOADS in Cloudflare Pages settings, then redeploy.' });
      const form = await request.formData();
      const files = form.getAll('files').filter(value => value && typeof value.arrayBuffer === 'function').slice(0, 20);
      if (!files.length) return json(400, { error: 'No images were included in this upload batch.' });
      const uploaded = [];
      for (const file of files) {
        const type = String(file.type || '').toLowerCase();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) continue;
        const bytes = await file.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) continue;
        const extension = type === 'image/jpeg' ? 'jpg' : type.slice('image/'.length);
        const safeName = String(file.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100);
        const key = `catalog/${Date.now()}-${hex(crypto.getRandomValues(new Uint8Array(4)))}-${safeName}.${extension}`;
        await env.UPLOADS.put(key, bytes, {
          httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' }
        });
        uploaded.push({ name: String(file.name || ''), url: `/uploads/${key}` });
      }
      return json(200, { ok: true, uploaded });
    }


    if (route === '/api/admin/subscribers' && method === 'GET') {
      const result = await env.DB.prepare('SELECT email FROM subscribers ORDER BY created_at DESC').all();
      return json(200, (result.results || []).map(row => row.email));
    }

    if (route === '/api/admin/summary' && method === 'GET') {
      const [ordersResult, products, subscribersResult, customersResult, settings] = await Promise.all([
        env.DB.prepare('SELECT id, status, total FROM orders').all(),
        listProducts(env),
        env.DB.prepare('SELECT COUNT(*) AS count FROM subscribers').first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM customers').first(),
        getSettings(env)
      ]);
      const orders = ordersResult.results || [];
      const revenue = orders.filter(order => order.status !== 'Cancelled').reduce((sum, order) => sum + Number(order.total || 0), 0);
      const pending = orders.filter(order => order.status === 'New' || order.status === 'Processing').length;
      const threshold = Number.isFinite(Number(settings.site.lowStockThreshold)) ? Number(settings.site.lowStockThreshold) : 8;
      const lowStock = products.filter(product => Number(product.stock) <= threshold).length;
      return json(200, { orders: orders.length, revenue, pending, lowStock, subscribers: Number(subscribersResult?.count || 0), customers: Number(customersResult?.count || 0) });
    }

    if (route === '/api/admin/customers' && method === 'GET') {
      const [customersResult, ordersResult] = await Promise.all([
        env.DB.prepare('SELECT id, name, email, phone, created_at FROM customers ORDER BY created_at DESC').all(),
        env.DB.prepare("SELECT customer_id, total, status FROM orders WHERE customer_id <> ''").all()
      ]);
      const aggregates = new Map();
      for (const order of ordersResult.results || []) {
        const entry = aggregates.get(order.customer_id) || { orderCount: 0, spend: 0 };
        entry.orderCount += 1;
        if (order.status !== 'Cancelled') entry.spend += Number(order.total || 0);
        aggregates.set(order.customer_id, entry);
      }
      return json(200, (customersResult.results || []).map(row => ({ ...safeCustomer(row), ...(aggregates.get(row.id) || { orderCount: 0, spend: 0 }) })));
    }

    if (route === '/api/admin/orders' && method === 'GET') {
      const result = await env.DB.prepare('SELECT id, status, payment_status, total, created_at, data FROM orders ORDER BY created_at DESC').all();
      return json(200, (result.results || []).map(parseOrder));
    }

    const orderMatch = route.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (orderMatch && method === 'PATCH') {
      let orderId;
      try { orderId = decodeURIComponent(orderMatch[1]); } catch { return json(400, { error: 'Invalid order ID.' }); }
      const orderRow = await env.DB.prepare('SELECT id, status, payment_status, total, created_at, data FROM orders WHERE id = ?').bind(orderId).first();
      if (!orderRow) return json(404, { error: 'Order not found.' });
      const order = parseOrder(orderRow);
      const body = await readJson(request);
      const allowedStatuses = ['New', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
      const allowedPayments = ['Pending', 'Paid', 'Due on delivery', 'Failed'];
      if (Object.hasOwn(body, 'status') && !allowedStatuses.includes(body.status)) return json(400, { error: 'Choose a valid order status.' });
      if (Object.hasOwn(body, 'paymentStatus') && !allowedPayments.includes(body.paymentStatus)) return json(400, { error: 'Choose a valid payment status.' });
      if (!Object.hasOwn(body, 'status') && !Object.hasOwn(body, 'paymentStatus')) return json(400, { error: 'Nothing to update.' });

      const nextStatus = body.status || order.status;
      const nextPaymentStatus = body.paymentStatus || order.paymentStatus;
      const wasCancelled = order.status === 'Cancelled';
      const isCancelled = nextStatus === 'Cancelled';
      const quantities = new Map();
      for (const item of Array.isArray(order.items) ? order.items : []) {
        const quantity = Number(item.quantity) || 0;
        if (item.id && quantity > 0) quantities.set(item.id, (quantities.get(item.id) || 0) + quantity);
      }
      const quantityJson = JSON.stringify(Object.fromEntries(quantities));
      const updatedOrder = { ...order, status: nextStatus, paymentStatus: nextPaymentStatus, updatedAt: new Date().toISOString() };
      const data = JSON.stringify(updatedOrder);
      const changesStatus = wasCancelled !== isCancelled;

      if (changesStatus && isCancelled) {
        const restock = `UPDATE products
          SET stock = stock + CAST((SELECT value FROM json_each(?) WHERE key = products.id) AS INTEGER)
          WHERE id IN (SELECT key FROM json_each(?))
          AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status <> 'Cancelled')`;
        await env.DB.batch([
          env.DB.prepare(restock).bind(quantityJson, quantityJson, orderId),
          env.DB.prepare(`UPDATE orders SET status = ?, payment_status = ?, data = ? WHERE id = ? AND status <> 'Cancelled'`)
            .bind(nextStatus, nextPaymentStatus, data, orderId)
        ]);
      } else if (changesStatus && wasCancelled && !isCancelled) {
        const reserve = `UPDATE products
          SET stock = stock - CAST((SELECT value FROM json_each(?) WHERE key = products.id) AS INTEGER)
          WHERE id IN (SELECT key FROM json_each(?))
          AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'Cancelled')
          AND (SELECT COUNT(*) FROM products AS p JOIN json_each(?) AS q ON p.id = q.key
               WHERE p.stock >= CAST(q.value AS INTEGER)) = (SELECT COUNT(*) FROM json_each(?))`;
        const updateOrder = `UPDATE orders SET status = ?, payment_status = ?, data = ?
          WHERE id = ? AND status = 'Cancelled' AND changes() = (SELECT COUNT(*) FROM json_each(?))`;
        const result = await env.DB.batch([
          env.DB.prepare(reserve).bind(quantityJson, quantityJson, orderId, quantityJson, quantityJson),
          env.DB.prepare(updateOrder).bind(nextStatus, nextPaymentStatus, data, orderId, quantityJson)
        ]);
        if (!result?.[1]?.meta?.changes) {
          const current = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first();
          if (current?.status === 'Cancelled') return json(409, { error: 'Not enough stock to reopen this order. Restock the missing products first.' });
        }
      } else {
        await env.DB.prepare('UPDATE orders SET status = ?, payment_status = ?, data = ? WHERE id = ?')
          .bind(nextStatus, nextPaymentStatus, data, orderId).run();
      }
      const refreshed = await env.DB.prepare('SELECT id, status, payment_status, total, created_at, data FROM orders WHERE id = ?').bind(orderId).first();
      return json(200, refreshed ? parseOrder(refreshed) : updatedOrder);
    }

    if (route === '/api/admin/products' && method === 'GET') return json(200, await listProducts(env));

    if (route === '/api/admin/catalog/import-products' && method === 'POST') {
      const body = await readJson(request, 1_500_000);
      const incoming = Array.isArray(body.products) ? body.products.slice(0, 60) : [];
      if (!incoming.length) return json(400, { error: 'No products were included in this batch.' });
      let created = 0;
      let updated = 0;
      const errors = [];
      for (const input of incoming) {
        try {
          const id = String(input.id || '').trim().slice(0, 120);
          if (!id) throw new Error('Product ID is missing.');
          const currentRow = await env.DB.prepare('SELECT id, stock, data FROM products WHERE id = ?').bind(id).first();
          const product = productPayload({ ...input, id }, currentRow ? parseProduct(currentRow) : {});
          product.id = id;
          product.sourceCost = Number(input.sourceCost) || 0;
          product.supplierMoq = Number(input.supplierMoq) || 0;
          product.sourcePage = Number(input.sourcePage) || 0;
          await saveProductSafely(env, product);
          if (currentRow) updated += 1; else created += 1;
        } catch (error) {
          errors.push({ id: String(input.id || ''), error: error?.message || 'Could not save product.' });
        }
      }
      return json(200, { ok: true, created, updated, errors });
    }

    if (route === '/api/admin/catalog/load-market-products' && method === 'POST') {
      const catalog = [
        {
          id: 'water-bottle-15l',
          name: '1.5 L Pump Water Bottle',
          category: 'Water Bottles',
          price: 198,
          compareAt: null,
          image: '/images/product-bottle.svg',
          images: ['/images/product-bottle.svg'],
          stock: 100,
          colors: ['Black', 'Transparent'],
          sizes: ['1.5 L'],
          minOrderQty: 1,
          quantityDiscountPercent: 5,
          tag: '1.5 L',
          description: 'Reusable 1.5 litre water bottle with a convenient pump-style lid, carry-friendly design and easy everyday handling.',
          featured: true
        },
        {
          id: 'silicone-bath-belt',
          name: 'Silicone Bath Belt & Back Scrubber',
          category: 'Bath & Personal Care',
          price: 129,
          compareAt: null,
          image: '/images/product-bath-belt.svg',
          images: ['/images/product-bath-belt.svg'],
          stock: 100,
          colors: ['Pink', 'Blue', 'Purple'],
          sizes: ['Standard'],
          minOrderQty: 1,
          quantityDiscountPercent: 5,
          tag: 'Easy clean',
          description: 'Flexible silicone bath belt designed to help clean hard-to-reach areas with a textured surface and easy-grip ends.',
          featured: true
        },
        {
          id: 'silicone-cleaning-gloves',
          name: 'Reusable Silicone Cleaning Gloves',
          category: 'Cleaning Essentials',
          price: 129,
          compareAt: null,
          image: '/images/product-gloves.svg',
          images: ['/images/product-gloves.svg'],
          stock: 100,
          colors: ['Purple', 'Blue'],
          sizes: ['M', 'L', 'XL'],
          minOrderQty: 1,
          quantityDiscountPercent: 5,
          tag: 'Reusable',
          description: 'Reusable waterproof silicone cleaning gloves with textured palms for everyday dishwashing and household cleaning.',
          featured: true
        },
        {
          id: 'large-plastic-tumbler',
          name: 'Large Plastic Tumbler with Straw & Handle',
          category: 'Tumblers',
          price: 199,
          compareAt: null,
          image: '/images/product-tumbler.svg',
          images: ['/images/product-tumbler.svg'],
          stock: 100,
          colors: ['Green', 'Pink'],
          sizes: ['Standard'],
          minOrderQty: 1,
          quantityDiscountPercent: 5,
          tag: 'Everyday tumbler',
          description: 'Reusable plastic tumbler with a comfortable handle and straw-style lid for convenient everyday drinking.',
          featured: true
        },
        {
          id: 'nice-water-bottle',
          name: 'Premium Everyday Water Bottle',
          category: 'Water Bottles',
          price: 99,
          compareAt: null,
          image: '/images/product-nice-bottle.svg',
          images: ['/images/product-nice-bottle.svg'],
          stock: 100,
          colors: ['Blue', 'Pink'],
          sizes: ['Standard'],
          minOrderQty: 2,
          quantityDiscountPercent: 5,
          tag: 'Minimum 2',
          description: 'Reusable everyday water bottle with a compact shape and secure lid, suited to home, office and daily travel.',
          featured: true
        },
        {
          id: 'multicolor-sipper-bottle',
          name: 'Multicolor Sipper Bottle',
          category: 'Water Bottles',
          price: 150,
          compareAt: null,
          image: '/images/product-sipper.svg',
          images: ['/images/product-sipper.svg'],
          stock: 100,
          colors: ['Pink', 'Blue', 'Green', 'White'],
          sizes: ['Standard'],
          minOrderQty: 1,
          quantityDiscountPercent: 5,
          tag: 'Assorted colours',
          description: 'Lightweight reusable sipper bottle available in assorted colours for school, office, travel and everyday use.',
          featured: true
        }
      ];
      const existingRows = await env.DB.prepare('SELECT id FROM products').all();
      const existing = new Set((existingRows.results || []).map(row => row.id));
      const added = [];
      const updated = [];
      for (const product of catalog) {
        // Deliberately use only the original D1 columns here so this loader
        // works whether the optional SKU column has been added or not.
        await env.DB.prepare(
          'INSERT INTO products (id, stock, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET stock = excluded.stock, data = excluded.data'
        ).bind(product.id, product.stock, JSON.stringify(product)).run();
        (existing.has(product.id) ? updated : added).push(product.id);
      }
      return json(200, { ok: true, added, updated, count: added.length + updated.length });
    }



    // Bulk import: preview validates and reports, the import route writes to D1.
    if (route === '/api/admin/products/import/preview' && method === 'POST') {
      const body = await readJson(request, 8_000_000);
      const analysis = await analyzeImportUpload(env, body);
      return json(200, { ok: true, preview: publicImportPreview(analysis) });
    }

    if (route === '/api/admin/products/import' && method === 'POST') {
      const body = await readJson(request, 8_000_000);
      const analysis = await analyzeImportUpload(env, body);
      if (analysis.summary.create + analysis.summary.update === 0) {
        return json(400, { error: 'There are no valid new or updated products to import. Fix the rows listed in the preview and try again.' });
      }
      const result = await executeImport(env, analysis);
      return json(200, { ok: true, result });
    }

    if (route === '/api/admin/products' && method === 'POST') {
      const body = await readJson(request);
      const product = productPayload(body);
      const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'item';
      product.id = `${slug}-${hex(crypto.getRandomValues(new Uint8Array(2)))}`;
      product.rating = 0;
      product.reviews = 0;
      await saveProductSafely(env, product);
      return json(201, product);
    }

    const productMatch = route.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (productMatch && method === 'PATCH') {
      let productId;
      try { productId = decodeURIComponent(productMatch[1]); } catch { return json(400, { error: 'Invalid product ID.' }); }
      const currentRow = await env.DB.prepare('SELECT id, stock, data FROM products WHERE id = ?').bind(productId).first();
      if (!currentRow) return json(404, { error: 'Product not found.' });
      const body = await readJson(request);
      const product = productPayload(body, parseProduct(currentRow));
      product.id = productId;
      await saveProductSafely(env, product);
      return json(200, product);
    }

    if (productMatch && method === 'DELETE') {
      let productId;
      try { productId = decodeURIComponent(productMatch[1]); } catch { return json(400, { error: 'Invalid product ID.' }); }
      const result = await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(productId).run();
      if (!result.meta?.changes) return json(404, { error: 'Product not found.' });
      return json(200, { ok: true });
    }

    return json(404, { error: 'Admin endpoint not found.' });
  }

  return json(404, { error: 'Not found.' });
}

export async function onRequest({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return json(403, { error: 'Cross-site request blocked.' });
    } catch { return json(403, { error: 'Invalid request origin.' }); }
  }
  if (!env?.DB) return json(503, { error: 'The D1 database binding is missing. Add a D1 binding named DB in Cloudflare Pages settings and redeploy.' });
  try {
    return await handleApi(request, env);
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    console.error('MarketTech API error:', error?.message || error);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}

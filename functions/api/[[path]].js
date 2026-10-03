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
    shipping: 'We currently deliver across India. Orders are packed with care and usually dispatched within 2–4 business days. Free shipping applies to orders above ₹1,999; other orders have a flat ₹99 delivery fee.',
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
    marketing: { ...DEFAULT_SETTINGS.marketing, ...(source.marketing && typeof source.marketing === 'object' ? source.marketing : {}) }
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
  if (!row) return normalizeSettings(DEFAULT_SETTINGS);
  try { return normalizeSettings(JSON.parse(row.data)); }
  catch { return normalizeSettings(DEFAULT_SETTINGS); }
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
    description: product.description
  };
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
  return {
    ...existing,
    name,
    category,
    price: Math.round(price),
    compareAt: Number.isFinite(Number(input.compareAt)) && Number(input.compareAt) > price ? Math.round(Number(input.compareAt)) : null,
    stock,
    description,
    image,
    images,
    tag: String(input.tag || '').trim().slice(0, 32),
    featured: Boolean(input.featured),
    rating: Number(existing.rating || 4.8),
    reviews: Number(existing.reviews || 0)
  };
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
  await env.DB.prepare(`INSERT INTO products (id, stock, data) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET stock = excluded.stock, data = excluded.data`)
    .bind(product.id, product.stock, JSON.stringify(product)).run();
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

  if (route === '/api/storefront-settings' && method === 'GET') {
    const settings = await getSettings(env);
    return json(200, { site: settings.site, policies: settings.policies, marketing: settings.marketing });
  }

  if (route === '/api/auth/register' && method === 'POST') {
    const body = await readJson(request);
    const name = String(body.name || '').trim().slice(0, 100);
    const email = cleanEmail(body.email);
    const phone = normalizePhone(body.phone);
    const phoneDigits = phone.replace(/\D/g, '');
    const password = String(body.password || '');
    if (!name || !email || phoneDigits.length < 10 || phoneDigits.length > 15 || password.length < 10 || password.length > 128) {
      return json(400, { error: 'Enter your name, a valid email, a 10–15 digit phone number and a password of 10–128 characters.' });
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

  if (route === '/api/products' && method === 'GET') {
    return json(200, (await listProducts(env)).map(publicProduct));
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
    for (const item of inputItems) {
      const id = String(item.id || '');
      const quantity = Number(item.quantity);
      if (!id || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return json(400, { error: 'One of the items in your bag is no longer available. Please refresh and try again.' });
      }
      const combined = (quantities.get(id) || 0) + quantity;
      if (combined > 99) return json(400, { error: 'Please reduce the quantity of one of the items in your bag.' });
      quantities.set(id, combined);
    }

    const productList = await productsByIds(env, [...quantities.keys()]);
    if (productList.length !== quantities.size) return json(400, { error: 'One of the items in your bag is no longer available. Please refresh and try again.' });
    const products = new Map(productList.map(product => [product.id, product]));
    const orderItems = [];
    let subtotal = 0;
    for (const [id, quantity] of quantities) {
      const product = products.get(id);
      if (!product) return json(400, { error: 'One of the items in your bag is no longer available. Please refresh and try again.' });
      if (product.stock < quantity) return json(409, { error: `Only ${product.stock} left in stock for ${product.name}. Please update your bag.` });
      orderItems.push({ id: product.id, name: product.name, price: product.price, image: product.image, quantity });
      subtotal += Number(product.price) * quantity;
    }

    const settings = await getSettings(env);
    const freeShippingAt = Number.isFinite(Number(settings.site.freeShippingAt)) ? Number(settings.site.freeShippingAt) : DEFAULT_FREE_SHIPPING_AT;
    const shippingFee = Number.isFinite(Number(settings.site.shippingFee)) ? Number(settings.site.shippingFee) : DEFAULT_SHIPPING_FEE;
    const shipping = subtotal >= freeShippingAt ? 0 : shippingFee;
    const requestedCoupon = String(body.couponCode || '').trim();
    let discount = 0;
    if (requestedCoupon) {
      const expectedCoupon = String(settings.marketing.couponCode || '');
      const percent = Number(settings.marketing.discountPercent) || 0;
      if (!expectedCoupon || requestedCoupon.toUpperCase() !== expectedCoupon.toUpperCase() || percent < 1) return json(400, { error: 'That promo code is not active.' });
      discount = Math.round(subtotal * percent / 100);
    }

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
      discountCode: discount ? requestedCoupon : '',
      shipping,
      total: subtotal - discount + shipping,
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

    if (route === '/api/admin/products' && method === 'POST') {
      const body = await readJson(request);
      const product = productPayload(body);
      const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'item';
      product.id = `${slug}-${hex(crypto.getRandomValues(new Uint8Array(2)))}`;
      product.rating = 0;
      product.reviews = 0;
      await saveProduct(env, product);
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
      await saveProduct(env, product);
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

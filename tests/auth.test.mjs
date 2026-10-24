import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../server/auth.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const sqlite = new DatabaseSync(':memory:');
class Statement {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.sql, params); }
  async all() {
    const stmt = sqlite.prepare(this.sql);
    const results = stmt.all(...this.params);
    return { results, success: true, meta: {} };
  }
  async first(column) { const row = sqlite.prepare(this.sql).get(...this.params); return row ? (column ? row[column] : row) : null; }
  async run() { const r = sqlite.prepare(this.sql).run(...this.params); return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
}
const DB = { prepare: sql => new Statement(sql), exec: sql => sqlite.exec(sql), batch: stmts => Promise.all(stmts.map(s => s.all())) };
const env = { DB, BETTER_AUTH_SECRET: 'test-only-secret-that-is-longer-than-32-characters' };
sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
const salt = Buffer.alloc(16, 4);
const legacyPassword = 'Old@1'; // Existing short passwords must still work.
const hash = pbkdf2Sync(legacyPassword, salt, 20000, 32, 'sha256').toString('base64url');
sqlite.prepare('INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('existing-id', 'existing@example.com', 'Existing Customer', '9876543210', salt.toString('base64url'), hash, 20000, '2026-01-01T00:00:00.000Z');
sqlite.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?)').run('old-order', 'existing-id', 'pending', 'pending', 500, '2026-01-02', JSON.stringify({id: 'old-order', total: 500, items: []}));
const migration = readFileSync(new URL('../migrations/0003_better_auth.sql', import.meta.url), 'utf8');
sqlite.exec(migration);
sqlite.exec(migration); // Safe to retry; never overwrite an upgraded password.
const schema = await getMigrations(authOptions(env, new Request('https://store.example.com')));
assert.equal(schema.toBeCreated.length, 0);
assert.equal(schema.toBeAdded.length, 0);
assert.equal(schema.schemaProblems.length, 0);

const base = 'https://store.example.com';
async function call(path, { method = 'GET', body, cookie, origin = base, ip = '192.0.2.1' } = {}) {
  const headers = new Headers({ 'CF-Connecting-IP': ip });
  if (cookie) headers.set('Cookie', cookie);
  if (method !== 'GET') { headers.set('Origin', origin); headers.set('Content-Type', 'application/json'); }
  return onRequest({ request: new Request(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }), env });
}
const cookies = r => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const credentials = { name: 'New Customer', email: 'new@example.com', phone: '9876543210', password: 'A-long-password1!' };
let r = await call('/api/auth/register', { method: 'POST', body: { ...credentials, password: 'Ab@1' } });
assert.equal(r.status, 400);
r = await call('/api/auth/register', { method: 'POST', body: credentials });
assert.equal(r.status, 201, await r.clone().text());
const user = (await r.json()).customer;
const cookie = cookies(r);
assert.match(cookie, /mt_auth/);
assert.ok(r.headers.getSetCookie().some(c => /HttpOnly/i.test(c) && /Secure/i.test(c) && /SameSite=Lax/i.test(c)));
assert.equal(sqlite.prepare('SELECT id FROM customers WHERE email=?').get(credentials.email).id, user.id);
assert.equal((await (await call('/api/auth/me', { cookie })).json()).customer.id, user.id);
assert.equal((await (await call('/api/auth/me', { cookie: cookie + 'tampered' })).json()).customer, null);
assert.equal((await call('/api/account/orders')).status, 401);
assert.equal((await call('/api/account/orders', { cookie })).status, 200);
assert.equal((await call('/api/admin/customers', { cookie })).status, 401, 'Customer cookie cannot grant admin access');
assert.equal((await call('/api/auth/update-user', { method: 'POST', cookie, body: { email: 'other@example.com' } })).status, 404);
assert.equal((await call('/api/auth/login', { method: 'POST', body: credentials, origin: 'https://evil.example' })).status, 403);
assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: credentials.email, password: 'wrong' } })).status, 401);
r = await call('/api/auth/logout', { method: 'POST', cookie });
assert.equal(r.status, 200);
assert.ok(r.headers.getSetCookie().some(c => c.startsWith('mt_customer=') && c.includes('Max-Age=0')));
assert.equal((await (await call('/api/auth/me', { cookie })).json()).customer, null, 'Logged-out session revoked server-side');
r = await call('/api/auth/login', { method: 'POST', body: { email: 'existing@example.com', password: legacyPassword } });
assert.equal(r.status, 200, await r.clone().text());
assert.equal((await r.json()).customer.id, 'existing-id');
const oldCookie = cookies(r);
assert.ok(!sqlite.prepare('SELECT password FROM mt_auth_account WHERE userId=?').get('existing-id').password.startsWith('legacy-'));
assert.equal((await (await call('/api/account/orders', { cookie: oldCookie })).json())[0].id, 'old-order');
assert.equal(sqlite.prepare('SELECT emailVerified FROM mt_auth_user WHERE id=?').get('existing-id').emailVerified, 0);
r = await call('/api/auth/login', { method: 'POST', body: { email: 'existing@example.com', password: legacyPassword } });
assert.equal(r.status, 200, 'Upgraded password still works');
sqlite.exec(migration);
assert.ok(!sqlite.prepare('SELECT password FROM mt_auth_account WHERE userId=?').get('existing-id').password.startsWith('legacy-'));
for (let i = 0; i < 9; i++) r = await call('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'wrong' }, ip: '192.0.2.55' });
assert.equal(r.status, 429, 'Rate limits survive across independent auth instances');
console.log('Auth integration passed: signup, cookies, session revocation, order access, origin checks, admin isolation, legacy migration, scrypt upgrade and D1 rate limits.');

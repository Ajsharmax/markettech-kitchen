import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(root + '/package.json');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'auth-test', modules: true, scriptPath: root+'/.wrangler/auth-build/index.js', compatibilityDate:'2026-10-24', compatibilityFlags:['nodejs_compat'], d1Databases:['DB'], bindings:{BETTER_AUTH_SECRET:'local-test-secret-longer-than-32-characters'} }], cf:false }));
try {
 const db=await mf.getD1Database('DB');
 for (const file of ['0001_init.sql','0003_better_auth.sql']) {
  const sql=readFileSync(root+'/migrations/'+file,'utf8').split('-- Starter copy')[0].replace(/^--.*$/gm,'');
  for (const statement of sql.split(';').filter(s=>s.trim())) await db.prepare(statement).run();
 }
 const body={name:'Runtime Test',email:'runtime@example.com',phone:'9876543210',password:'runtime-Test-123!'};
 const r=await mf.dispatchFetch('https://www.markettech.in/api/auth/register',{method:'POST',headers:{Origin:'https://www.markettech.in','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(body)});
 assert.equal(r.status,201,await r.clone().text());
 const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const me=await mf.dispatchFetch('https://www.markettech.in/api/auth/me',{headers:{Cookie:cookie}});
 assert.equal((await me.json()).customer.email,body.email);
 const salt = Buffer.alloc(16, 4).toString('base64url');
 const legacyHash = pbkdf2Sync('Old@1', Buffer.alloc(16, 4), 20000, 32, 'sha256').toString('base64url');
 await db.prepare("INSERT INTO customers VALUES ('legacy-test','legacy@example.com','Legacy test','0000000000',?,?,20000,?)").bind(salt,legacyHash,new Date().toISOString()).run();
 await db.prepare("INSERT INTO mt_auth_user (id,name,email,phone,emailVerified,createdAt,updatedAt) VALUES ('legacy-test','Legacy test','legacy@example.com','0000000000',0,?,?)").bind(Date.now(),Date.now()).run();
 await db.prepare("INSERT INTO mt_auth_account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES ('legacy-test','legacy-test','credential','legacy-test',?,?,?)").bind('legacy-pbkdf2$20000$'+salt+'$'+legacyHash,Date.now(),Date.now()).run();
 const legacyResponse=await mf.dispatchFetch('https://www.markettech.in/api/auth/login',{method:'POST',headers:{Origin:'https://www.markettech.in','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.2'},body:JSON.stringify({email:'legacy@example.com',password:'Old@1'})});
 assert.equal(legacyResponse.status,200,await legacyResponse.clone().text());
 const legacyCookie=legacyResponse.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const legacyMe=await mf.dispatchFetch('https://www.markettech.in/api/auth/me',{headers:{Cookie:legacyCookie}});
 assert.equal((await legacyMe.json()).customer.id,'legacy-test');
 console.log('Cloudflare runtime legacy password migration and session check passed.');
 console.log('Cloudflare workerd runtime: signup, native scrypt, D1 and session lookup passed.');
} finally { await mf.dispose(); }

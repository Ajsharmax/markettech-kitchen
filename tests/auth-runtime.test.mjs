import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
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
 console.log('Cloudflare workerd runtime: signup, native scrypt, D1 and session lookup passed.');
} finally { await mf.dispose(); }

import { betterAuth } from 'better-auth';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

const encoder = new TextEncoder();
const LEGACY_PREFIX = 'legacy-pbkdf2$';

// Imported accounts retain their original password until the next successful
// sign-in, when it is upgraded to Better Auth's default scrypt hash.
async function verifyImportedPassword({ hash, password }) {
  if (!hash.startsWith(LEGACY_PREFIX)) return verifyPassword({ hash, password });
  try {
    const [, count, salt, expected] = hash.split('$');
    const iterations = Number(count);
    if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 100000) return false;
    const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt), iterations }, key, 256));
    const target = decode(expected);
    if (actual.length !== target.length) return false;
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ target[i];
    return difference === 0;
  } catch { return false; }
}

export function authOptions(env, request) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be configured as a Cloudflare secret.');
  }
  // Use the actual URL, never untrusted forwarded host headers. Cookies remain
  // host-only; the apex domain redirects to www in Cloudflare.
  const origin = new URL(request.url).origin;
  return {
    appName: 'MarketTech Kitchen',
    baseURL: origin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyImportedPassword }
    },
    user: {
      modelName: 'mt_auth_user',
      additionalFields: { phone: { type: 'string', required: true } }
    },
    session: {
      modelName: 'mt_auth_session',
      expiresIn: 14 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false }
    },
    account: { modelName: 'mt_auth_account', accountLinking: { enabled: false } },
    verification: { modelName: 'mt_auth_verification' },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'mt_auth_rate_limit',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 900, max: 8 },
        '/sign-up/email': { window: 900, max: 5 }
      }
    },
    advanced: {
      cookiePrefix: 'mt_auth',
      useSecureCookies: new URL(request.url).protocol === 'https:',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // Schema is generated and checked in tests before deployment. Avoid
      // introspecting all store tables on every edge request (D1 query limits).
      database: { generateId: () => crypto.randomUUID(), validateSchema: false }
    },
    databaseHooks: {
      user: { create: { after: async user => {
        // Preserve the customers table used by checkout, CRM and order history.
        // Passwords now live exclusively in Better Auth's account table.
        await env.DB.prepare(`INSERT INTO customers
          (id, email, name, phone, password_salt, password_hash, password_iterations, created_at)
          VALUES (?, ?, ?, ?, '', '', 0, ?)`)
          .bind(user.id, user.email, user.name, user.phone || '', new Date(user.createdAt).toISOString()).run();
      } } }
    }
  };
}

export function createAuth(env, request) {
  return betterAuth(authOptions(env, request));
}

export async function upgradeImportedPassword(env, userId, password) {
  const account = await env.DB.prepare("SELECT id, password FROM mt_auth_account WHERE userId = ? AND providerId = 'credential'").bind(userId).first();
  if (account?.password?.startsWith(LEGACY_PREFIX)) {
    const upgraded = await hashPassword(password);
    await env.DB.prepare('UPDATE mt_auth_account SET password = ?, updatedAt = ? WHERE id = ? AND password = ?')
      .bind(upgraded, Date.now(), account.id, account.password).run();
  }
}

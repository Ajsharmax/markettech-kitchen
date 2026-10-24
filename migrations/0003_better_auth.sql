-- Additive Better Auth schema; preserves customer IDs and existing orders.
create table if not exists "mt_auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "phone" text not null);

create table if not exists "mt_auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "mt_auth_user" ("id") on delete cascade);

create table if not exists "mt_auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "mt_auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table if not exists "mt_auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table if not exists "mt_auth_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index if not exists "mt_auth_session_userId_idx" on "mt_auth_session" ("userId");

create index if not exists "mt_auth_account_userId_idx" on "mt_auth_account" ("userId");

create index if not exists "mt_auth_verification_identifier_idx" on "mt_auth_verification" ("identifier");

-- Import credentials without reading or exposing customer passwords. Existing
-- unverified emails stay unverified. No accounts are linked on email alone.
INSERT OR IGNORE INTO mt_auth_user (id, name, email, emailVerified, createdAt, updatedAt, phone)
SELECT id, name, lower(email), 0,
  COALESCE(unixepoch(created_at) * 1000, unixepoch() * 1000),
  COALESCE(unixepoch(created_at) * 1000, unixepoch() * 1000), phone
FROM customers;

INSERT OR IGNORE INTO mt_auth_account (id, accountId, providerId, userId, password, createdAt, updatedAt)
SELECT 'imported-' || c.id, c.id, 'credential', c.id,
  'legacy-pbkdf2$' || c.password_iterations || '$' || c.password_salt || '$' || c.password_hash,
  COALESCE(unixepoch(c.created_at) * 1000, unixepoch() * 1000),
  COALESCE(unixepoch(c.created_at) * 1000, unixepoch() * 1000)
FROM customers c JOIN mt_auth_user u ON u.id = c.id
WHERE c.password_hash <> ''
  AND NOT EXISTS (SELECT 1 FROM mt_auth_account a WHERE a.userId = c.id AND a.providerId = 'credential');

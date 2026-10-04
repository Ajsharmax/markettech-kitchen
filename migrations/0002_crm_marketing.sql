-- CRM, coupon and timed-offer tables for MarketTech Kitchen.
CREATE TABLE IF NOT EXISTS crm_customer_meta (
  customer_id TEXT PRIMARY KEY,
  tags TEXT NOT NULL DEFAULT '[]',
  segment TEXT NOT NULL DEFAULT 'General',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crm_notes (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_notes_customer_idx ON crm_notes (customer_id, created_at);

CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value INTEGER NOT NULL CHECK (discount_value >= 0),
  min_order INTEGER NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  max_discount INTEGER NOT NULL DEFAULT 0 CHECK (max_discount >= 0),
  usage_limit INTEGER NOT NULL DEFAULT 0 CHECK (usage_limit >= 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  per_customer_limit INTEGER NOT NULL DEFAULT 0 CHECK (per_customer_limit >= 0),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  scope_type TEXT NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all','product','category')),
  scope_value TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS coupons_active_dates_idx ON coupons (active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value INTEGER NOT NULL CHECK (value >= 0),
  scope_type TEXT NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all','product','category')),
  scope_value TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  banner TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_active_dates_idx ON offers (active, starts_at, ends_at);

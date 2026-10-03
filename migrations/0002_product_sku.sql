-- Optional: adds the SKU column used by the bulk product importer
-- (Admin → Products → Import Products).
--
-- The importer creates this column and its index automatically the first time
-- it runs, so applying this file by hand is optional. Run it once per database
-- only if you would like the SKU column available before the first import, or
-- if you want to query SKUs directly in the D1 console.
--
-- Do not run it twice: SQLite reports "duplicate column name" for a second run,
-- which is harmless but noisy.
--
-- Existing products keep an empty SKU. The importer matches on SKU, so
-- products created by hand are never merged into an imported row.

ALTER TABLE products ADD COLUMN sku TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_idx
  ON products (sku)
  WHERE sku IS NOT NULL AND sku <> '';

/**
 * End-to-end test for the bulk product importer (Admin → Products → Import Products).
 *
 * Runs the real Pages Function (functions/api/[[path]].js) against a real SQLite
 * database with a small Cloudflare D1 shim, using .xlsx and .csv uploads built
 * inside this file. Nothing here talks to the network.
 *
 * Requires Node 22.5+ (node:sqlite). Run with: npm run test:import
 */

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

const BASE_URL = 'https://store.example.com';
const failures = [];
let checks = 0;

function check(condition, message) {
  checks++;
  if (!condition) failures.push(message);
}

function equal(actual, expected, message) {
  checks++;
  if (actual !== expected) failures.push(`${message} (expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)})`);
}

/* ------------------------------- D1 shim -------------------------------- */

class D1Statement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) { return new D1Statement(this.database, this.sql, params); }
  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.params);
    if (!row) return null;
    return column ? row[column] : row;
  }
  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params), success: true, meta: {} };
  }
  async run() {
    const info = this.database.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: { changes: Number(info.changes || 0), last_row_id: Number(info.lastInsertRowid || 0) } };
  }
}

class D1Database {
  constructor(database) { this.database = database; }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

/* ----------------------------- ZIP writer ------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFiles(files, compress) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const content = Buffer.from(file.content, 'utf8');
    const payload = compress ? deflateRawSync(content) : content;
    const method = compress ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc32(content), 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc32(content), 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + payload.length;
  }
  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuffer, end]);
}

/* --------------------------- XLSX generator ----------------------------- */

const escapeXml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnName(index) {
  let name = '';
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function makeXlsx(rows, { sharedStrings = true, compress = true } = {}) {
  const shared = [];
  const sharedIndex = new Map();
  const rowXml = rows.map((values, rowIndex) => {
    const cells = values.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const text = String(value ?? '');
      if (!text) return '';
      if (!sharedStrings) return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
      if (!sharedIndex.has(text)) {
        sharedIndex.set(text, shared.length);
        shared.push(text);
      }
      return `<c r="${reference}" t="s"><v>${sharedIndex.get(text)}</v></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const files = [
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>` },
    { name: 'xl/sharedStrings.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map(text => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('')}</sst>` }
  ];
  return zipFiles(files, compress);
}

/* ------------------------------ Fixtures -------------------------------- */

const HEADER = ['SKU', 'Product Name', 'Slug', 'Category', 'MRP (₹)', 'Selling Price', 'Stock Quantity', 'HSN Code', 'GST %', 'Description', 'Status', 'Featured', 'Package Length (cm)', 'Package Breadth (cm)', 'Package Height (cm)', 'Package Weight (kg)', 'Flipkart Listing ID'];

function productRows(overrides = {}) {
  return [
    HEADER,
    ['MTK-001', 'Everyday Cast Iron Skillet', 'everyday-cast-iron-skillet', 'Cookware', '2990', '2490', '24', '73239990', '18', 'Pre-seasoned skillet with a satin-smooth finish.', 'active', 'yes', '31', '27', '11', '2.4', 'FLP-IGNORED-1'],
    ['MTK-002', 'Nesting Stoneware Bowls', '', 'Tableware', '', '1890', '31', '', '', 'Three hand-finished stoneware bowls.', '', '', '', '', '', '', 'FLP-IGNORED-2'],
    ['MTK-003', 'Walnut Chef Knife', 'walnut-chef-knife', 'Prep', '2690', '', '18', '82119310', '18', 'Full-tang blade.', 'active', 'no', '34', '9', '4', '0.4', ''],
    ['MTK-004', 'Brushed Steel Saucepan', 'brushed-steel-saucepan', 'Cookware', '3790', '3290', '', '73239390', '18', 'Tidy pour rim and snug lid.', 'active', 'no', '36', '22', '16', '1.6', ''],
    ['MTK-002', 'Nesting Stoneware Bowls (repeated row)', '', 'Tableware', '2190', '1890', '31', '', '12', 'Repeated SKU row.', 'active', 'no', '', '', '', '', ''],
    ['MTK-005', 'Copper Pour-Over Kettle', 'copper-pour-over-kettle', 'Cookware', '2950', '2490', '38', '74181021', '18', 'Hand-finished copper kettle with a gooseneck spout.', 'inactive', 'no', '24', '18', '18', '1.1', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ...(overrides.extra || [])
  ];
}

/* ------------------------------- Harness -------------------------------- */

const repoRoot = new URL('..', import.meta.url);
const { onRequest } = await import(new URL('functions/api/[[path]].js', repoRoot));

const database = new DatabaseSync(':memory:');
database.exec(readFileSync(new URL('migrations/0001_init.sql', repoRoot), 'utf8'));

const env = { DB: new D1Database(database), ADMIN_EMAIL: 'admin@markettech.in', ADMIN_PASSWORD: 'test-password-123' };
let cookie = '';

async function call(path, { method = 'POST', body, raw } = {}) {
  const request = new Request(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : raw
  });
  const response = await onRequest({ request, env });
  const setCookie = response.headers.get('Set-Cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data };
}

const upload = (filename, buffer) => ({ filename, data: Buffer.from(buffer).toString('base64') });

function productRow(id) {
  return database.prepare('SELECT id, sku, stock, data FROM products WHERE id = ?').get(id);
}
function productCount() {
  return Number(database.prepare('SELECT COUNT(*) AS count FROM products').get().count);
}

/* --------------------------------- Test --------------------------------- */

// 1. Admin sign-in is required.
const unauthenticated = await call('/api/admin/products/import/preview', { body: { filename: 'a.csv', data: 'c2t1Cg==' } });
equal(unauthenticated.status, 401, 'Import preview must require an admin session');

const login = await call('/api/admin/login', { body: { email: 'admin@markettech.in', password: 'test-password-123' } });
equal(login.status, 200, 'Admin sign-in should succeed');
check(Boolean(cookie), 'Admin session cookie should be issued');

// 2. Preview of the .xlsx upload.
const before = productCount();
const xlsx = makeXlsx(productRows());
const preview = await call('/api/admin/products/import/preview', { body: upload('markettech_website_products_final_clean.xlsx', xlsx) });
equal(preview.status, 200, 'Preview should return 200');
const previewBody = preview.data.preview;
equal(previewBody.file.format, 'xlsx', 'Preview should detect the xlsx format');
equal(previewBody.file.sheetName, 'Products', 'Preview should report the sheet name');
equal(previewBody.file.rowCount, 6, 'Preview should read 6 product rows (blank row ignored)');
equal(previewBody.file.blankRows, 1, 'Preview should ignore the blank row');
equal(previewBody.summary.total, 6, 'Preview total rows');
equal(previewBody.summary.create, 3, 'Preview new products');
equal(previewBody.summary.update, 0, 'Preview updates (nothing exists yet)');
equal(previewBody.summary.skip, 1, 'Preview skipped rows (duplicate SKU in file)');
equal(previewBody.summary.error, 2, 'Preview invalid rows');
equal(productCount(), before, 'Preview must not write to the database');

const skuRow = sku => previewBody.rows.find(row => row.sku === sku);
equal(skuRow('MTK-001').action, 'NEW', 'MTK-001 should be a new product');
equal(skuRow('MTK-003').action, 'ERROR', 'MTK-003 should be an error row');
equal(skuRow('MTK-003').errors[0], 'Selling price is missing.', 'Selling price error message');
equal(skuRow('MTK-004').action, 'ERROR', 'MTK-004 should be an error row');
equal(skuRow('MTK-004').errors[0], 'Stock quantity is missing.', 'Stock quantity error message');
equal(skuRow('MTK-002').action, 'NEW', 'First MTK-002 row should be new');
equal(previewBody.rows.filter(row => row.sku === 'MTK-002' && row.action === 'SKIP').length, 1, 'Repeated SKU should be skipped');
check(skuRow('MTK-002').warnings.some(message => message.includes('MRP')), 'Missing MRP should warn');
equal(previewBody.columns.ignored.includes('Flipkart Listing ID'), true, 'Marketplace-only columns should be ignored');
equal(skuRow('MTK-001').mrp, 2990, 'MRP should be parsed');
equal(skuRow('MTK-001').sellingPrice, 2490, 'Selling price should be parsed');
equal(skuRow('MTK-001').stock, 24, 'Stock should be parsed');
equal(preview.data.preview.rows.find(row => row.sku === 'MTK-001').rowNumber, 2, 'Spreadsheet row numbers should be reported');

// 3. Import the same file.
const imported = await call('/api/admin/products/import', { body: upload('markettech_website_products_final_clean.xlsx', xlsx) });
equal(imported.status, 200, 'Import should return 200');
const result = imported.data.result;
equal(result.summary.created, 3, 'Import should create 3 products');
equal(result.summary.updated, 0, 'Import should update nothing on the first run');
equal(result.summary.skipped, 1, 'Import should skip the repeated SKU');
equal(result.summary.errors, 2, 'Import should report 2 errors');
equal(productCount(), before + 3, 'Exactly 3 products should be added');

// 4. Stored product fields.
const skillet = JSON.parse(productRow('everyday-cast-iron-skillet').data);
equal(productRow('everyday-cast-iron-skillet').sku, 'MTK-001', 'SKU should be stored on the row');
equal(skillet.sku, 'MTK-001', 'SKU should be stored in the product data');
equal(skillet.name, 'Everyday Cast Iron Skillet', 'Product name should be stored');
equal(skillet.category, 'Cookware', 'Category should be stored');
equal(skillet.price, 2490, 'Selling price should be stored');
equal(skillet.compareAt, 2990, 'MRP should be stored as the compare-at price');
equal(skillet.stock, 24, 'Stock should be stored in the product data');
equal(productRow('everyday-cast-iron-skillet').stock, 24, 'Stock should be stored in the stock column');
equal(skillet.hsnCode, '73239990', 'HSN code should be stored');
equal(skillet.gst, 18, 'GST should be stored');
equal(skillet.status, 'active', 'Status should be stored');
equal(skillet.featured, true, 'Featured should be stored');
equal(skillet.slug, 'everyday-cast-iron-skillet', 'Slug should be stored');
equal(skillet.package.lengthCm, 31, 'Package length should be stored');
equal(skillet.package.weightKg, 2.4, 'Package weight should be stored');
equal(skillet.rating, 0, 'New products should start without a rating');
check(!Object.keys(skillet).some(key => /flipkart/i.test(key)), 'No Flipkart fields should be stored');
check(!JSON.stringify(skillet).includes('FLP-IGNORED'), 'Ignored marketplace values must not be stored');

// 5. Defaults for blank optional cells.
const bowlsId = productRow('nesting-stoneware-bowls')?.id || database.prepare("SELECT id FROM products WHERE json_extract(data, '$.sku') = 'MTK-002'").get()?.id;
const bowls = JSON.parse(productRow(bowlsId).data);
equal(bowls.slug, 'nesting-stoneware-bowls', 'Missing slug should be generated from the product name');
equal(bowls.compareAt ?? null, null, 'Missing MRP should leave compareAt empty');
equal(bowls.status, 'active', 'Missing status should default to active');
equal(bowls.gst, 0, 'Missing GST should default to 0');
equal(bowls.featured, false, 'Missing featured should default to false');

// 6. Inactive products stay out of the storefront but remain in admin.
equal(database.prepare("SELECT COUNT(*) AS count FROM products WHERE json_extract(data, '$.sku') = 'MTK-005'").get().count, 1, 'Inactive product should be imported');
const storefront = await call('/api/products', { method: 'GET' });
equal(storefront.data.some(product => product.name === 'Copper Pour-Over Kettle'), false, 'Inactive products should be hidden from the storefront');
const adminProducts = await call('/api/admin/products', { method: 'GET' });
equal(adminProducts.data.some(product => product.name === 'Copper Pour-Over Kettle'), true, 'Inactive products should still be visible in admin');

// 7. Re-importing updates instead of duplicating and keeps IDs.
const secondXlsx = makeXlsx(productRows({
  extra: [['MTK-006', 'Olivewood Utensil Trio', 'olivewood-utensil-trio', 'Prep', '1190', '990', '42', '44199090', '12', 'A spoon, turner and spatula in olivewood.', 'active', 'yes', '30', '12', '5', '0.5', '']]
}));
const second = await call('/api/admin/products/import', { body: upload('markettech_website_products_final_clean.xlsx', secondXlsx) });
equal(second.data.result.summary.created, 1, 'Only the new SKU should be created on the second run');
equal(second.data.result.summary.updated, 3, 'Existing SKUs should be updated');
equal(second.data.result.summary.errors, 2, 'The same 2 rows should still error');
equal(productCount(), before + 4, 'Re-importing must not duplicate products');
equal(productRow('everyday-cast-iron-skillet').id, 'everyday-cast-iron-skillet', 'Existing product IDs must be preserved');

// 8. Price and stock edits flow through on update.
const editedXlsx = makeXlsx([
  HEADER,
  ['MTK-001', 'Everyday Cast Iron Skillet', 'everyday-cast-iron-skillet', 'Cookware', '3190', '2790', '7', '73239990', '18', 'Pre-seasoned skillet with a satin-smooth finish.', 'active', 'yes', '31', '27', '11', '2.4', '']
]);
const edited = await call('/api/admin/products/import', { body: upload('prices.xlsx', editedXlsx) });
equal(edited.data.result.summary.updated, 1, 'The edited row should update one product');
equal(edited.data.result.summary.created, 0, 'The edited row should not create a product');
const updatedSkillet = JSON.parse(productRow('everyday-cast-iron-skillet').data);
equal(updatedSkillet.price, 2790, 'Updated price should be stored');
equal(updatedSkillet.compareAt, 3190, 'Updated MRP should be stored');
equal(productRow('everyday-cast-iron-skillet').stock, 7, 'Updated stock should be stored in the stock column');
check(Array.isArray(updatedSkillet.images) && updatedSkillet.images.length > 0, 'Existing product images must be preserved');

// 9. CSV uploads work and report spreadsheet-style row numbers.
const csv = [
  'sku,product_name,slug,category,mrp,selling_price,stock_quantity,hsn_code,gst,description,status,featured',
  'MTK-CSV-1,Linen Tea Towels,linen-tea-towels,Textiles,1090,890,27,63026000,5,"Soft, absorbent linen-blend towels",active,yes',
  'MTK-CSV-1,Duplicate linen row,linen-tea-towels,Textiles,1090,890,27,,5,Duplicate SKU,active,no',
  'MTK-CSV-2,Broken row,broken-row,Storage,abc,def,ghi,,,Bad numbers,active,no'
].join('\r\n');
const csvPreview = await call('/api/admin/products/import/preview', { body: upload('products.csv', Buffer.from(csv, 'utf8')) });
equal(csvPreview.data.preview.file.format, 'csv', 'CSV format should be detected');
equal(csvPreview.data.preview.summary.create, 1, 'CSV should have one new product');
equal(csvPreview.data.preview.summary.skip, 1, 'CSV duplicate SKU should be skipped');
equal(csvPreview.data.preview.summary.error, 1, 'CSV invalid row should error');
const csvError = csvPreview.data.preview.rows.find(row => row.sku === 'MTK-CSV-2');
equal(csvError.rowNumber, 4, 'CSV row numbers should match the file lines');
equal(csvError.errors.length, 3, 'Every invalid CSV value (MRP, selling price, stock) should be reported');

const csvImport = await call('/api/admin/products/import', { body: upload('products.csv', Buffer.from(csv, 'utf8')) });
equal(csvImport.data.result.summary.created, 1, 'CSV import should create one product');
const linenRow = database.prepare("SELECT id FROM products WHERE json_extract(data, '$.sku') = 'MTK-CSV-1'").get();
const linen = JSON.parse(productRow(linenRow.id).data);
equal(linen.description, 'Soft, absorbent linen-blend towels', 'Quoted CSV descriptions should be read');
equal(linen.gst, 5, 'CSV GST should be parsed');

// 10. Guard rails.
const badFile = await call('/api/admin/products/import/preview', { body: upload('products.pdf', Buffer.from('%PDF-1.4 not a spreadsheet')) });
equal(badFile.status, 400, 'Non-spreadsheet uploads should be rejected');
const oldXls = await call('/api/admin/products/import/preview', { body: upload('products.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) });
equal(oldXls.status, 400, 'Legacy .xls uploads should be rejected with a clear message');
check(/\.xls/.test(oldXls.data.error || ''), 'Legacy .xls message should mention .xls');
const noSkuColumn = await call('/api/admin/products/import/preview', { body: upload('bad.csv', Buffer.from('name,price\nThing,10')) });
equal(noSkuColumn.status, 400, 'Files without required columns should be rejected');
check(/required column/.test(noSkuColumn.data.error || ''), 'Missing column message should explain the problem');
const emptyFile = await call('/api/admin/products/import/preview', { body: { filename: 'empty.csv', data: '' } });
equal(emptyFile.status, 400, 'Empty uploads should be rejected');
const noValidRows = await call('/api/admin/products/import', { body: upload('allbad.csv', Buffer.from('sku,product_name,category,mrp,selling_price,stock_quantity\nA,Name,Cat,10,,5')) });
equal(noValidRows.status, 400, 'An import with nothing valid to write should be refused');

// 11. Manual admin product saves keep working with the SKU column in place.
const manual = await call('/api/admin/products', { body: { name: 'Manual Product', category: 'Prep', price: 500, stock: 5, sku: 'MTK-MANUAL-1', image: '/images/product-pan.jpg' } });
equal(manual.status, 201, 'Creating a product by hand should still work');
const duplicateSku = await call('/api/admin/products', { body: { name: 'Another Product', category: 'Prep', price: 500, stock: 5, sku: 'MTK-MANUAL-1', image: '/images/product-pan.jpg' } });
equal(duplicateSku.status, 409, 'Duplicate manual SKUs should be refused with a friendly message');

/* -------------------------------- Report -------------------------------- */

if (failures.length) {
  console.error(`\n✕ ${failures.length} of ${checks} checks failed:\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
console.log(`\n✓ Product importer: all ${checks} checks passed.`);

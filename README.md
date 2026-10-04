# MarketTech Kitchen

A responsive kitchen-products storefront and admin panel. The storefront is static HTML/CSS/JavaScript; Cloudflare Pages Functions provide the API, Cloudflare D1 stores products/orders/customers/settings, and Cloudflare R2 stores uploaded product and UPI QR images.

## Included features

- Product catalogue, search, category filters, cart and stock-aware checkout.
- Bulk product import from `.xlsx`/`.csv` with validation preview (Admin → Products → Import Products).
- Customer registration/sign-in and private order history.
- Admin panel for products, inventory, orders, customers, site copy, policies, delivery settings and coupons.
- Up to 8 photos per product, uploaded to R2; admin-managed UPI QR image also uses R2.
- Cash on delivery and manual UPI. UPI transfers must be checked manually in your bank/UPI app; the store does not verify them automatically.
- Optional Razorpay code remains available, but it is off until keys are added privately in Cloudflare Pages settings.
- Wishlist saved in the customer’s browser.

## Cloudflare Pages setup

The repository is configured for Cloudflare Pages with no build step: **Build command:** leave blank; **Build output directory:** `public`; **Root directory:** `/`. Pages detects the `functions/` folder automatically.

### 1. Create the storage resources

1. In Cloudflare, create a D1 database for the store.
2. Open its SQL console and run the complete file `migrations/0001_init.sql` once. It creates the tables and inserts the sample catalogue and starter site settings.
3. Create an R2 bucket for product photos and UPI QR uploads. Leave the bucket’s public-access setting disabled; the Pages Function serves images through the store’s own `/uploads/...` route.

### 2. Connect the resources to the Pages project

After the first Git deployment creates the Pages project, open **Settings → Bindings** and add:

- D1 database binding: variable name `DB`, select the store database.
- R2 bucket binding: variable name `UPLOADS`, select the image bucket.

Add each binding to both **Production** and **Preview** if Cloudflare shows separate environment tabs. Redeploy after changing bindings; Cloudflare applies new bindings on a new deployment.

### 3. Set the admin sign-in privately

In **Settings → Variables and Secrets**, set `ADMIN_EMAIL` (a plain-text variable) and `ADMIN_PASSWORD` (a secret). Use a unique, strong password. Add them for both Preview and Production. The hosted app intentionally has no default/demo admin password; admin sign-in will remain disabled until `ADMIN_PASSWORD` is configured.

Do not put passwords, payment secrets, OTPs or tokens in GitHub or in chat. Keep them in Cloudflare's private settings. Optional Razorpay keys can be added there later; COD and manual UPI do not need them.

### 4. Test the temporary `pages.dev` site

Before connecting `markettech.in`, test the Pages address:

- Open the home page and `/api/health`.
- Sign in at `/admin`; add/edit a sample product and upload a photo.
- Test a customer account and order with COD, then check the order and inventory in Admin.
- If you choose to test UPI, use your own test VPA/QR and remember transfers are not automatically verified.
- Test on a phone-sized screen and check the policies/contact details.

Keep the current electronics storefront and all existing DNS/email records unchanged until the kitchen site passes testing and you explicitly approve the domain switch. The site will not automatically take over `markettech.in`.

## Bulk product import

Open **Admin → Products → Import Products**, choose an `.xlsx` or `.csv` file, check the
preview, then press **Confirm Import**. The file is read inside the Pages Function and
nothing is written to D1 until you confirm; cancel any time and the database is untouched.

- Columns: `sku, product_name, slug, category, mrp, selling_price, stock_quantity, hsn_code, gst, description, status, featured, package_length_cm, package_breadth_cm, package_height_cm, package_weight_kg`. Common header spellings such as `Name`, `Selling Price (₹)`, `Stock` or `Package Weight (kg)` are recognised, and unknown columns are ignored.
- **SKU is the unique key.** A new SKU creates a product; a matching SKU updates that product in place and keeps its existing ID. Repeating a SKU inside one file skips the repeats, so re-uploading the same file updates instead of duplicating. Products that are missing from the file are never deleted.
- The preview reports total rows, new products, products to update, skipped rows and invalid rows, with a `SKU | Product Name | Category | MRP | Selling Price | Stock | Action` table (`NEW`, `UPDATE`, `ERROR`, `SKIP`).
- Invalid rows are listed with their spreadsheet row number and the exact problem (for example `Selling price is missing`). Invalid rows are skipped and reported after the import; every other row is still written.
- Product images, ratings and tags are preserved on update. New products start with the default cover image; R2 is not required and no image column is needed.
- Marketplace-only columns (Flipkart listing IDs, seller details, marketplace pricing or URLs) are ignored and never stored.
- `stock_quantity` is written to the existing `products.stock` column, so Inventory, checkout and stock alerts stay in sync.
- Limits: 4 MB and 2,000 rows per upload. Legacy `.xls` workbooks must be re-saved as `.xlsx` or `.csv`.
- The import window links to a ready-to-use template at `/templates/product-import-template.csv`.
- Optional: run `migrations/0002_product_sku.sql` once per database to add the `sku` column before your first import. The importer creates the column and its unique index automatically, so most stores do not need to run anything.

## Costs and limits

Cloudflare Pages, D1 and R2 have free-tier allowances, not unlimited free usage. Usage beyond the current free limits can be billable. Check Cloudflare’s current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [R2 pricing](https://developers.cloudflare.com/r2/pricing/) before public promotion, and keep an eye on usage. No paid payment gateway is needed for COD/manual UPI; a gateway may charge transaction fees.

Customer passwords are hashed with PBKDF2-SHA256 at a 20,000-iteration work factor to stay within the very small CPU budget of Cloudflare’s free runtime, with IP-based login throttling and a 10-character minimum. This is a deliberate free-tier compromise, not a substitute for a dedicated identity service. Ask customers to use long, unique passwords; consider a dedicated auth provider or a paid runtime before handling higher-risk or high-volume accounts.

## Source checks

The repository includes a dependency-free `npm run check` command for JavaScript syntax checks, `npm run test:import`, which runs the bulk importer end to end against a temporary SQLite database (needs Node 22.5+ for `node:sqlite`), and `npm run test:storefront`, which verifies that every element the storefront and admin scripts look up actually exists on their pages (a single typo there stops the whole script and hides the catalogue). `npm test` runs both test suites. The deployed site runs on Cloudflare Pages Functions; it does not run the old Node file server or use local JSON files for production data.

## Important launch notes

- Replace the sample products, prices, photos, support details and policies in Admin before taking real orders.
- Have your shipping, refund, privacy and terms copy reviewed for your business and local requirements.
- UPI payment is manual: confirm the transfer in your bank/UPI app before dispatching.
- The newsletter form stores email addresses in D1; it does not send emails automatically.
- Take periodic backups of your D1 data and exported product/order records. Do not treat the sample catalogue as real inventory.

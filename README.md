# MarketTech Kitchen

A responsive kitchen-products storefront and admin panel. The storefront is static HTML/CSS/JavaScript; Cloudflare Pages Functions provide the API, Cloudflare D1 stores products/orders/customers/settings, and Cloudflare R2 stores uploaded product and UPI QR images.

## Included features

- Product catalogue, search, category filters, cart and stock-aware checkout.
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

## Costs and limits

Cloudflare Pages, D1 and R2 have free-tier allowances, not unlimited free usage. Usage beyond the current free limits can be billable. Check Cloudflare’s current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [R2 pricing](https://developers.cloudflare.com/r2/pricing/) before public promotion, and keep an eye on usage. No paid payment gateway is needed for COD/manual UPI; a gateway may charge transaction fees.

Customer passwords are hashed with PBKDF2-SHA256 at a 20,000-iteration work factor to stay within the very small CPU budget of Cloudflare’s free runtime, with IP-based login throttling and a 10-character minimum. This is a deliberate free-tier compromise, not a substitute for a dedicated identity service. Ask customers to use long, unique passwords; consider a dedicated auth provider or a paid runtime before handling higher-risk or high-volume accounts.

## Source checks

The repository includes a dependency-free `npm run check` command for JavaScript syntax checks. The deployed site runs on Cloudflare Pages Functions; it does not run the old Node file server or use local JSON files for production data.

## Important launch notes

- Replace the sample products, prices, photos, support details and policies in Admin before taking real orders.
- Have your shipping, refund, privacy and terms copy reviewed for your business and local requirements.
- UPI payment is manual: confirm the transfer in your bank/UPI app before dispatching.
- The newsletter form stores email addresses in D1; it does not send emails automatically.
- Take periodic backups of your D1 data and exported product/order records. Do not treat the sample catalogue as real inventory.

-- MarketTech Kitchen Cloudflare D1 schema and starter data.
-- Apply once to both the Pages Preview and Production D1 databases if you use separate databases.

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  stock INTEGER NOT NULL CHECK (stock >= 0),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('admin', 'customer')),
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  key_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('admin', 'customer')),
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  PRIMARY KEY (key_hash, kind)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders (customer_id, created_at);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at);

CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS products_stock_idx ON products (stock);

-- Starter copy, policy text, delivery settings and payment defaults.
INSERT OR IGNORE INTO store_settings (id, data) VALUES ('default', '{"site":{"storeName":"MarketTech Kitchen","announcement":"Thoughtful tools for everyday cooking","heroEyebrow":"THE KITCHEN EDIT · NO. 01","heroLine1":"Good things","heroLine2":"happen in here.","heroSubtitle":"Thoughtful tools, honest materials and little details that make everyday cooking feel like your favourite part of the day.","storyTitle1":"Buy less.","storyTitle2":"Love it longer.","storyText1":"We believe the best kitchen is not the one with the most things. It is the one with the right things — pieces that work hard, feel good in your hands and earn their place on your counter.","storyText2":"So we look for honest materials, considered design and the kind of quality you notice every time you reach for it.","categoryEyebrow":"FIND YOUR GOOD STUFF","categoryTitle1":"A place for every","categoryTitle2":"little ritual.","categoryDescription":"From the first cup of chai to the last plate at dinner, find the piece that makes it yours.","shopEyebrow":"THE GOOD STUFF","shopTitle1":"Everyday","shopTitle2":"favourites.","newsletterEyebrow":"A LITTLE NOTE FROM US","newsletterTitle1":"Good things,","newsletterTitle2":"in your inbox.","newsletterDescription":"Fresh finds, thoughtful tips and the occasional very good recipe. No clutter, promise.","quoteLine1":"It’s the little things that turn making dinner into","quoteEm":"making a day.","quoteAttribution":"THE MARKETTECH WAY","heroPrimaryCta":"Shop the collection","heroSecondaryCta":"A little about us","storyCta":"Meet your new favourite","contactEmail":"hello@markettech.in","contactPhone":"","contactAddress":"Delhi · India","upiVpa":"","shippingFee":99,"freeShippingAt":1999,"lowStockThreshold":8,"seoTitle":"MarketTech Kitchen — Good things happen in the kitchen","seoDescription":"Thoughtful kitchen tools for the rituals you return to. Shop considered cookware, prep tools, tableware and everyday essentials.","upiQrImage":""},"policies":{"shipping":"We currently deliver across India. Orders are packed with care and usually dispatched within 2–4 business days. Free shipping applies to orders above ₹1,999; other orders have a flat ₹99 delivery fee.","returns":"If something is not quite right, contact us within 7 days of delivery. Products must be unused and in their original packaging. We will help arrange a return or exchange. Contact hello@markettech.in to get started.","privacy":"We use the details you share only to fulfil orders, provide support and send updates you have requested. We do not sell your personal information. Contact hello@markettech.in with privacy questions.","terms":"Product descriptions, prices and availability may change. Orders are subject to stock confirmation. Cash-on-delivery orders are payable at the time of delivery. Please contact hello@markettech.in for help."},"marketing":{"promoBanner":"","couponCode":"","discountPercent":0,"metaPixelId":"","googleAnalyticsId":"","googleAdsId":"","googleAdsConversionLabel":"","googleTagManagerId":"","whatsappNumber":""}}');

-- Sample catalogue. Replace or edit these products in Admin after the preview is approved.
INSERT OR IGNORE INTO products (id, stock, data) VALUES ('cast-iron-skillet', 24, '{"id":"cast-iron-skillet","name":"Everyday Cast Iron Skillet","category":"Cookware","price":2490,"compareAt":2990,"image":"/images/product-pan.jpg","tag":"Bestseller","rating":4.9,"reviews":128,"stock":24,"featured":true,"description":"A forever pan for weekday breakfasts and slow Sunday suppers. Pre-seasoned, beautifully balanced, and made to move from hob to oven to table.","images":["/images/product-pan.jpg"]}');
INSERT OR IGNORE INTO products (id, stock, data) VALUES ('stoneware-bowls', 31, '{"id":"stoneware-bowls","name":"Nesting Stoneware Bowls","category":"Tableware","price":1890,"compareAt":2190,"image":"/images/product-ceramics.jpg","tag":"Hand-finished","rating":4.8,"reviews":86,"stock":31,"featured":true,"description":"Three easy-going bowls for mixing, serving and everything in between. Finished by hand in a speckled, food-safe glaze.","images":["/images/product-ceramics.jpg"]}');
INSERT OR IGNORE INTO products (id, stock, data) VALUES ('walnut-chef-knife', 18, '{"id":"walnut-chef-knife","name":"Walnut & Steel Chef Knife","category":"Prep","price":2250,"compareAt":2690,"image":"/images/product-knife.jpg","tag":"Staff pick","rating":4.9,"reviews":94,"stock":18,"featured":true,"description":"A dependable everyday blade with a full-tang stainless-steel core and a warm walnut handle that feels right at home in your hand.","images":["/images/product-knife.jpg"]}');
INSERT OR IGNORE INTO products (id, stock, data) VALUES ('steel-saucepan', 15, '{"id":"steel-saucepan","name":"Brushed Steel Saucepan","category":"Cookware","price":3290,"compareAt":3790,"image":"/images/product-saucepan.jpg","tag":"New","rating":4.7,"reviews":42,"stock":15,"featured":true,"description":"Your new go-to for chai, sauces and one-pot comfort. An even-heating base, tidy pour rim and snug lid make the everyday feel effortless.","images":["/images/product-saucepan.jpg"]}');
INSERT OR IGNORE INTO products (id, stock, data) VALUES ('olivewood-utensils', 42, '{"id":"olivewood-utensils","name":"Olivewood Utensil Trio","category":"Prep","price":990,"compareAt":1190,"image":"/images/product-utensils.jpg","tag":"","rating":4.8,"reviews":57,"stock":42,"featured":true,"description":"A spoon, turner and spatula carved from naturally beautiful olivewood. Gentle on your cookware and lovely enough to leave out.","images":["/images/product-utensils.jpg"]}');
INSERT OR IGNORE INTO products (id, stock, data) VALUES ('ribbed-oil-bottle', 38, '{"id":"ribbed-oil-bottle","name":"Ribbed Glass Oil Bottle","category":"Storage","price":790,"compareAt":950,"image":"/images/product-oil-bottle.jpg","tag":"Bestseller","rating":4.6,"reviews":63,"stock":38,"featured":true,"description":"A clear ribbed bottle with a smooth-pour metal spout. Keep olive oil, infused oils or your favourite dressing close at hand.","images":["/images/product-oil-bottle.jpg"]}');
INSERT OR IGNORE INTO products (id, stock, data) VALUES ('linen-towels', 27, '{"id":"linen-towels","name":"Everyday Linen Tea Towels","category":"Textiles","price":890,"compareAt":1090,"image":"/images/product-linen.jpg","tag":"Set of 2","rating":4.8,"reviews":71,"stock":27,"featured":true,"description":"Soft, absorbent and made for real kitchen life. A pair of naturally textured linen-blend towels with a quiet olive stripe.","images":["/images/product-linen.jpg"]}');
INSERT OR IGNORE INTO products (id, stock, data) VALUES ('ceramic-salt-cellar', 21, '{"id":"ceramic-salt-cellar","name":"Stoneware Salt Cellar","category":"Storage","price":1090,"compareAt":1290,"image":"/images/product-ceramics.jpg","tag":"Hand-finished","rating":4.7,"reviews":35,"stock":21,"featured":false,"description":"A palm-sized stoneware cellar that keeps finishing salt within reach. Its easy-grab lid and tactile glaze make seasoning a pleasure.","images":["/images/product-ceramics.jpg"]}');

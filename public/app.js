(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  let products = [];
  let activeCategory = 'all';
  let searchTerm = '';
  let sortOrder = 'featured';
  let toastTimer;
  let cart = loadCart();
  let wishlist = loadWishlist();
  let config = { shippingFee: 99, freeShippingAt: 1999, paymentOptions: { cashOnDelivery: true, upi: false, razorpay: false } };
  let storefrontSettings = { site: {}, policies: {}, marketing: {}, developer: {}, offers: [] };
  let appliedCoupon = '';
  let currentCustomer = null;
  let checkoutAfterAuth = false;
  let modalGalleryImages = [];
  let modalGalleryIndex = 0;
  let activeModalProduct = null;
  let customerPreviewToken = '';
  // Customer-facing fallback used only when a mobile browser cannot reach the catalogue API.
  // The live D1 catalogue remains the source of truth whenever the API succeeds.
  const FALLBACK_PRODUCTS = [
    { id: 'i-phone-19-pro-max-35f5', name: 'i Phone 19 pro Max', category: 'Mobile Phones', price: 549989, compareAt: 699999, image: '/uploads/1791104656694-2af20aef9a276984.jpg', images: ['/uploads/1791104656694-2af20aef9a276984.jpg'], tag: 'Bestseller', rating: 4.8, reviews: 0, stock: 9990, featured: true, description: 'i Phone 19 pro Max' },
    { id: 'bottle-dd44', name: 'Bottle', category: 'Bottle and Flask', price: 1299, compareAt: 2999, image: '/images/product-pan.jpg', images: ['/images/product-pan.jpg'], tag: 'New', rating: 4.8, reviews: 0, stock: 999, featured: true, description: 'Everyday reusable bottle.' },
    { id: 'drtfyui-b80b', name: 'drtfyui', category: 'ghij', price: 2345, compareAt: 23455, image: '/images/product-pan.jpg', images: ['/images/product-pan.jpg'], tag: 'New', rating: 0, reviews: 0, stock: 33333, featured: true, description: 'Everyday product.' },
    { id: 'getfit-silicone-back-scrubber', name: 'GetFit Silicone Back Scrubber', category: 'Bath & Personal Care', price: 129, compareAt: null, image: '/images/product-bath-belt.svg', images: ['/images/product-bath-belt.svg'], brand: 'GetFit', rating: 0, reviews: 0, stock: 97, featured: true, description: 'Flexible silicone back scrubber for everyday bathing.' }
  ];
  try { customerPreviewToken = sessionStorage.getItem('mt-customer-preview-token') || ''; } catch { /* storage may be disabled */ }

  function loadCart() {
    try {
      const stored = JSON.parse(localStorage.getItem('mt-kitchen-bag') || '{}');
      return stored && typeof stored === 'object' ? stored : {};
    } catch { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem('mt-kitchen-bag', JSON.stringify(cart)); } catch { /* cart still works for this visit */ }
  }
  function loadWishlist() {
    try {
      const stored = JSON.parse(localStorage.getItem('mt-kitchen-wishlist') || '[]');
      return Array.isArray(stored) ? [...new Set(stored.filter(value => typeof value === 'string'))] : [];
    } catch { return []; }
  }
  function saveWishlist() {
    try { localStorage.setItem('mt-kitchen-wishlist', JSON.stringify(wishlist)); } catch { /* saved items still work for this visit */ }
  }
  function toggleWishlist(id) {
    if (wishlist.includes(id)) {
      wishlist = wishlist.filter(value => value !== id);
      showToast('Removed from your saved items.');
    } else {
      wishlist = [...wishlist, id];
      showToast('Saved for later.');
    }
    saveWishlist();
    renderFilters();
    renderProducts();
    const modalButton = $('[data-action="modal-wishlist"]');
    if (modalButton && activeModalProduct) {
      const saved = wishlist.includes(activeModalProduct.id);
      modalButton.classList.toggle('is-saved', saved);
      modalButton.setAttribute('aria-pressed', String(saved));
      modalButton.textContent = saved ? '♥ Saved' : '♡ Save for later';
    }
  }
  function formatMoney(value) { return money.format(Number(value) || 0); }
  function ratingMarkup(product) {
    return `<span aria-hidden="true">★</span> ${Number(product.rating || 0).toFixed(1)} <span class="rating-count">(${Number(product.reviews || 0)})</span>`;
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(customerPreviewToken ? { Authorization: `Bearer ${customerPreviewToken}` } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }
  function updateAccountButtons() {
    const firstName = currentCustomer?.name?.trim().split(/\s+/)[0] || '';
    $('#open-account').textContent = firstName ? `Hi, ${firstName}` : 'Account';
    $('#open-account').setAttribute('aria-label', firstName ? `Open ${firstName}'s account` : 'Open your account');
    $('#mobile-account-link').textContent = firstName ? `Your account · ${firstName}` : 'Your account';
  }
  function setAccountMode(mode = 'login') {
    const register = mode === 'register';
    $('#customer-login-form').hidden = register;
    $('#customer-register-form').hidden = !register;
    $$('[data-account-mode]').forEach(button => button.classList.toggle('active', button.dataset.accountMode === mode));
    $('#customer-login-error').textContent = '';
    $('#customer-register-error').textContent = '';
  }
  function renderAccountOrders(orderList) {
    const container = $('#account-orders');
    if (!orderList.length) {
      container.innerHTML = '<div class="account-orders-empty"><span>✳</span><strong>Your first kitchen find is waiting.</strong><small>Orders you place while signed in will appear here.</small><button type="button" class="button button-outline" data-account-shop>Explore the collection ↗</button></div>';
      return;
    }
    container.innerHTML = orderList.map(order => {
      const orderItems = (order.items || []).map(item => `${escapeHtml(item.name)} × ${Number(item.quantity) || 1}`).join(', ');
      const date = order.createdAt ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(order.createdAt)) : 'Recently';
      return `<article class="account-order-card"><div class="account-order-top"><strong>${escapeHtml(order.id)}</strong><span>${formatMoney(order.total)}</span></div><div class="account-order-meta"><span>${escapeHtml(date)}</span><span>${escapeHtml(order.status || 'New')}</span></div><p>${orderItems}</p><small>${escapeHtml(order.paymentMethod || 'Payment')} · ${escapeHtml(order.paymentStatus || 'Pending')}</small></article>`;
    }).join('');
  }
  async function loadAccountOrders() {
    $('#account-orders').innerHTML = '<div class="account-orders-loading">A moment while we find your orders…</div>';
    try { renderAccountOrders(await api('/api/account/orders')); }
    catch (error) {
      $('#account-orders').innerHTML = `<div class="account-orders-error">${escapeHtml(error.message)}</div>`;
      if (error.message.toLowerCase().includes('sign in')) { currentCustomer = null; updateAccountButtons(); }
    }
  }
  async function showAccountProfile() {
    if (!currentCustomer) return;
    $('#account-auth-view').hidden = true;
    $('#account-profile-view').hidden = false;
    $('#account-greeting').textContent = `Hello, ${currentCustomer.name.split(/\s+/)[0]}.`;
    $('#account-email').textContent = currentCustomer.email;
    updateAccountButtons();
    await loadAccountOrders();
  }
  async function openAccount() {
    $('#mobile-nav').hidden = true;
    $('#mobile-menu-toggle').setAttribute('aria-expanded', 'false');
    $('#mobile-menu-toggle').setAttribute('aria-label', 'Open menu');
    openLayer($('#account-modal'));
    $('#account-auth-view').hidden = false;
    $('#account-profile-view').hidden = true;
    $('#account-orders').innerHTML = '';
    setAccountMode('login');
    try {
      const result = await api('/api/auth/me');
      currentCustomer = result.customer || null;
    } catch { currentCustomer = null; }
    updateAccountButtons();
    if (currentCustomer) await showAccountProfile();
    else $('#customer-login-form').elements.namedItem('email').focus({ preventScroll: true });
  }
  async function refreshCustomerSession() {
    try {
      const result = await api('/api/auth/me');
      currentCustomer = result.customer || null;
    } catch { currentCustomer = null; }
    updateAccountButtons();
  }
  async function submitCustomerAuth(form, endpoint, errorSelector) {
    const shouldContinueToCheckout = checkoutAfterAuth;
    const button = $('button[type="submit"]', form);
    const original = button.innerHTML;
    $(errorSelector).textContent = '';
    button.disabled = true;
    button.textContent = endpoint.endsWith('register') ? 'Creating your account…' : 'Signing you in…';
    try {
      const credentials = Object.fromEntries(new FormData(form).entries());
      const result = await api(endpoint, { method: 'POST', body: JSON.stringify(credentials) });
      if (result.previewToken) {
        customerPreviewToken = result.previewToken;
        try { sessionStorage.setItem('mt-customer-preview-token', customerPreviewToken); } catch { /* token is also kept for this page */ }
      }
      currentCustomer = result.customer;
      form.reset();
      if (shouldContinueToCheckout) {
        checkoutAfterAuth = false;
        closeLayer($('#account-modal'));
        showToast(endpoint.endsWith('register') ? 'Account created. Continuing to checkout…' : 'Signed in. Continuing to checkout…');
        setTimeout(() => startCheckout(), 120);
      } else {
        await showAccountProfile();
        showToast(endpoint.endsWith('register') ? 'Your account is ready. Welcome in!' : 'You’re signed in. Welcome back.');
      }
    } catch (error) { $(errorSelector).textContent = error.message; }
    finally { button.disabled = false; button.innerHTML = original; }
  }

  async function loadStore() {
    try {
      // Products are the critical storefront data. Load and render them first so
      // a settings/payment endpoint problem cannot make the whole catalogue disappear.
      products = await api('/api/products');
      if (!Array.isArray(products) || products.length === 0) {
        console.warn('MarketTech product API returned no products; using storefront fallback.');
        products = FALLBACK_PRODUCTS.map(product => ({ ...product }));
      }

      const availableProductIds = new Set(products.map(product => product.id));
      const activeWishlist = wishlist.filter(id => availableProductIds.has(id));
      if (activeWishlist.length !== wishlist.length) { wishlist = activeWishlist; saveWishlist(); }

      renderFilters();
      renderProducts();
      syncCartWithProducts();
      updateCartUI();

      // Settings are secondary. Keep the catalogue visible even if one settings
      // request fails, while retaining the last known safe defaults.
      const [settingsResult, contentResult] = await Promise.allSettled([
        api('/api/config'),
        api('/api/storefront-settings')
      ]);
      if (settingsResult.status === 'fulfilled') config = settingsResult.value;
      else console.error('MarketTech config failed:', settingsResult.reason);
      if (contentResult.status === 'fulfilled') storefrontSettings = contentResult.value;
      else console.error('MarketTech storefront settings failed:', contentResult.reason);

      // Settings only decorate the catalogue. If applying them fails, keep the
      // products on screen instead of replacing the whole grid with an error.
      try { applyStorefrontSettings(); }
      catch (error) { console.error('MarketTech storefront content failed:', error); }
      try { renderPaymentOptions(); }
      catch (error) { console.error('MarketTech payment options failed:', error); }
    } catch (error) {
      // Never leave the mobile storefront blank because a customer's browser
      // temporarily cannot reach /api/products. Keep the catalogue usable.
      console.error('MarketTech product API failed; using storefront fallback:', error);
      products = FALLBACK_PRODUCTS.map(product => ({ ...product }));
      renderFilters();
      renderProducts();
      syncCartWithProducts();
      updateCartUI();
      const grid = $('#product-grid');
      grid.hidden = false;
      $('#empty-products').hidden = true;
    }
  }

  function applyStorefrontSettings() {
    const site = storefrontSettings.site || {};
    const marketing = storefrontSettings.marketing || {};
    const developer = storefrontSettings.developer || {};
    const overrides = developer.textOverrides || {};
    for (const element of $$('[data-site]')) {
      const key = element.dataset.site;
      const value = Object.hasOwn(overrides, key) && overrides[key] ? overrides[key] : site[key];
      if (value != null) element.textContent = value;
    }
    const overrideMap = {
      heroPrimaryCta: '.hero-actions .button',
      heroSecondaryCta: '.hero-actions .button:nth-child(2)',
      storyCta: '#story .button',
      shopEyebrow: '.shop-heading [data-site="shopEyebrow"]',
      shopTitle1: '.shop-heading [data-site="shopTitle1"]',
      shopTitle2: '.shop-heading [data-site="shopTitle2"]'
    };
    for (const [key, selector] of Object.entries(overrideMap)) {
      if (overrides[key]) $(selector).forEach(element => { element.childNodes[0] && (element.childNodes[0].textContent = overrides[key]); });
    }
    const threshold = Number(config.freeShippingAt) || 0;
    const shippingCopy = threshold > 0 ? `Free delivery on orders over ${formatMoney(threshold)}` : 'Free delivery on every order';
    $$('[data-free-shipping-copy]').forEach(element => { element.textContent = shippingCopy; });
    $$('[data-free-shipping-benefit]').forEach(element => { element.textContent = threshold > 0 ? `Free shipping over ${formatMoney(threshold)}` : 'Free shipping on every order'; });
    // MarketTech business contact details shown publicly on the storefront.
    // Keep these values independent from older sample settings saved in D1.
    const email = 'primecreation.selling@gmail.com';
    $$('[data-contact-email]').forEach(element => {
      element.href = `mailto:${email}`;
      element.textContent = email;
    });
    $$('[data-contact-address]').forEach(element => { element.textContent = 'Delhi · 110042'; });
    const phone = String(site.contactPhone || '').trim();
    $$('[data-contact-phone]').forEach(element => {
      element.hidden = !phone;
      if (phone) { element.href = `tel:${phone.replace(/[^+\d]/g, '')}`; element.textContent = `Call us ${phone}`; }
    });
    document.title = site.seoTitle || site.storeName || document.title;
    const metaDescription = $('meta[name="description"]');
    if (metaDescription && site.seoDescription) metaDescription.content = site.seoDescription;
    const campaign = $('#campaign-banner');
    $('#checkout-coupon-section').hidden = false;
    const activeOffers = Array.isArray(storefrontSettings.offers) ? storefrontSettings.offers.filter(offer => offer.active) : [];
    const offerBanner = activeOffers.find(offer => offer.banner)?.banner || '';
    if (campaign && (marketing.promoBanner || offerBanner)) {
      campaign.hidden = false;
      $('#campaign-banner-text').textContent = offerBanner || marketing.promoBanner;
      $('#campaign-coupon').textContent = marketing.couponCode ? `Use ${marketing.couponCode}` : '';
    }
    const whatsapp = String(marketing.whatsappNumber || '7827685375').replace(/\D/g, '');
    const whatsappMessage = 'Hi MarketTech Team, I need some help with my order. Could you please assist me?';
    if (whatsapp.length >= 10) {
      const chatUrl = `https://wa.me/${whatsapp.startsWith('91') ? whatsapp : '91' + whatsapp}?text=${encodeURIComponent(whatsappMessage)}`;
            $$('[data-contact-whatsapp]').forEach(element => { element.href = chatUrl; });
    }
    setupTracking(marketing);
  }
  function loadTrackingScripts(marketing) {
    if (window.__marketTechTrackingLoaded) return;
    window.__marketTechTrackingLoaded = true;
    if (marketing.googleTagManagerId) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      const script = document.createElement('script');
      script.async = true; script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(marketing.googleTagManagerId)}`;
      document.head.appendChild(script);
    }
    if (marketing.googleAnalyticsId || marketing.googleAdsId) {
      const tagId = marketing.googleAnalyticsId || marketing.googleAdsId;
      const script = document.createElement('script');
      script.async = true; script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`;
      document.head.appendChild(script);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function(){ window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      if (marketing.googleAnalyticsId) window.gtag('config', marketing.googleAnalyticsId);
      if (marketing.googleAdsId) window.gtag('config', marketing.googleAdsId);
    }
    if (marketing.metaPixelId) {
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', marketing.metaPixelId); window.fbq('track', 'PageView');
    }
  }
  function trackEvent(eventName, payload = {}) {
    const marketing = storefrontSettings.marketing || {};
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, payload);
      if (eventName === 'purchase' && marketing.googleAdsId && marketing.googleAdsConversionLabel) {
        window.gtag('event', 'conversion', { send_to: `${marketing.googleAdsId}/${marketing.googleAdsConversionLabel}`, value: payload.value, currency: payload.currency || 'INR', transaction_id: payload.transaction_id });
      }
    }
    if (typeof window.fbq === 'function') window.fbq('track', eventName === 'purchase' ? 'Purchase' : eventName === 'add_to_cart' ? 'AddToCart' : eventName, payload);
  }
  function setupTracking(marketing) {
    const hasTracker = Boolean(marketing.googleAnalyticsId || marketing.googleAdsId || marketing.googleTagManagerId || marketing.metaPixelId);
    if (!hasTracker) return;
    let consent = '';
    try { consent = localStorage.getItem('mt-kitchen-consent') || ''; } catch { /* storage may be disabled */ }
    if (consent === 'accepted') loadTrackingScripts(marketing);
    else if (!consent) $('#cookie-banner').hidden = false;
  }
  function renderPaymentOptions() {
    const options = config.paymentOptions || {};
    $('#payment-upi').hidden = !options.upi;
    $('#payment-razorpay').hidden = !options.razorpay;
    const selected = $('input[name="paymentMethod"]:checked');
    if (selected && selected.closest('label').hidden) $('input[name="paymentMethod"][value="cod"]').checked = true;
    $$('.payment-choice').forEach(label => label.classList.toggle('is-selected', $('input', label)?.checked));
  }

  function syncCartWithProducts() {
    let changed = false;
    for (const [id, entry] of Object.entries(cart)) {
      const product = products.find(item => item.id === id);
      if (!product || product.stock <= 0) { delete cart[id]; changed = true; continue; }
      if (entry.quantity > product.stock) { entry.quantity = product.stock; changed = true; }
      entry.quantity = Math.max(1, Number(entry.quantity) || 1);
    }
    if (changed) saveCart();
  }

  function renderFilters() {
    const base = ['all', 'Cookware', 'Prep', 'Tableware', 'Storage', 'Textiles', 'Bakeware'];
    const seen = new Set(products.map(product => product.category));
    const categories = base.filter(category => category === 'all' || seen.has(category));
    for (const category of seen) if (!categories.includes(category)) categories.push(category);
    categories.push('saved');
    $('#filter-list').innerHTML = categories.map(category => {
      const label = category === 'all' ? 'All goods' : category === 'saved' ? `Saved ♡${wishlist.length ? ` ${wishlist.length}` : ''}` : category === 'Prep' ? 'Prep & tools' : category === 'Tableware' ? 'Table & serve' : category;
      return `<button type="button" class="filter-chip${activeCategory === category ? ' active' : ''}" data-filter="${escapeHtml(category)}">${escapeHtml(label)}</button>`;
    }).join('');
  }

  function getVisibleProducts() {
    let list = products.filter(product => activeCategory === 'all' || (activeCategory === 'saved' ? wishlist.includes(product.id) : product.category === activeCategory));
    const query = searchTerm.trim().toLowerCase();
    if (query) list = list.filter(product => `${product.name} ${product.category} ${product.description} ${product.tag}`.toLowerCase().includes(query));
    if (sortOrder === 'price-low') list.sort((a, b) => a.price - b.price);
    else if (sortOrder === 'price-high') list.sort((a, b) => b.price - a.price);
    else if (sortOrder === 'rating') list.sort((a, b) => Number(b.rating) - Number(a.rating));
    else list.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || products.indexOf(a) - products.indexOf(b));
    return list;
  }

  function productCard(product) {
    const outOfStock = Number(product.stock) <= 0;
    const tag = product.tag ? `<span class="product-tag">${escapeHtml(product.tag)}</span>` : '';
    const imageCount = new Set([product.image, ...(Array.isArray(product.images) ? product.images : [])].filter(Boolean)).size;
    const photoBadge = imageCount > 1 ? `<button type="button" class="product-photo-count" data-action="view" aria-label="View all ${imageCount} photos of ${escapeHtml(product.name)}">${imageCount} photos</button>` : '';
    const saved = wishlist.includes(product.id);
    const compare = product.compareAt && product.compareAt > product.price ? `<del class="product-compare">${formatMoney(product.compareAt)}</del>` : '';
    return `<article class="product-card" data-product-id="${escapeHtml(product.id)}">
      <div class="product-visual">
        ${tag}<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">
        ${photoBadge}<button class="wishlist-toggle${saved ? ' is-saved' : ''}" type="button" data-action="wishlist" aria-label="${saved ? 'Remove from' : 'Add to'} saved items: ${escapeHtml(product.name)}" aria-pressed="${saved}">${saved ? '♥' : '♡'}</button>
        <button class="quick-view" type="button" data-action="view" aria-label="Quick view ${escapeHtml(product.name)}">↗</button>
      </div>
      <button class="product-add" type="button" data-action="add" ${outOfStock ? 'disabled' : ''}><span>${outOfStock ? 'Sold out' : 'Add to bag'}</span><span aria-hidden="true">${outOfStock ? '—' : '+'}</span></button>
      <div class="product-info"><div class="product-meta"><h3 class="product-name">${escapeHtml(product.name)}</h3><span class="product-rating">${ratingMarkup(product)}</span></div>
        ${product.brand ? `<div class="product-brand">${escapeHtml(product.brand)}</div>` : ""}<div class="product-category">${escapeHtml(product.category)}</div>
        <div class="product-price-row"><span class="product-price">${formatMoney(product.price)}</span>${compare}<span class="product-stock">${outOfStock ? 'Out of stock' : Number(product.stock) <= 5 ? `Only ${Number(product.stock)} left` : ''}</span></div>
      </div>
    </article>`;
  }

  function renderProducts() {
    const list = getVisibleProducts();
    $('#product-grid').innerHTML = list.map(productCard).join('');
    const empty = $('#empty-products');
    empty.hidden = list.length > 0;
    $('#product-grid').hidden = list.length === 0;
    if (activeCategory === 'saved' && list.length === 0) {
      $('h3', empty).textContent = 'Your saved shelf is still empty.';
      $('p', empty).textContent = 'Tap the heart on anything you’d like to keep close.';
      $('#reset-filters').textContent = 'Browse the collection';
    } else {
      $('h3', empty).textContent = searchTerm ? 'We couldn’t find that item yet.' : 'Our new collection is coming together.';
      $('p', empty).textContent = searchTerm ? 'Try a different search, or browse the full collection.' : 'We’re preparing the next MarketTech collection. Visit the About page to meet the owner while we add the products.';
      $('#reset-filters').textContent = searchTerm ? 'See all goods' : 'Meet Ajay';

    }
    $('#search-result-note').textContent = searchTerm ? `${list.length} ${list.length === 1 ? 'good thing' : 'good things'} for “${searchTerm}”` : '';
  }

  function currentCartItems() {
    return Object.entries(cart).map(([id, item]) => {
      const product = products.find(entry => entry.id === id) || item;
      // Keep the customer's selected variant when rebuilding cart lines.
      // Previously only the product object was returned, so color/size stored
      // in localStorage was silently dropped before checkout. The API then
      // correctly rejected the order because the variant fields were empty.
      return {
        ...product,
        quantity: Math.max(1, Number(item.quantity) || 1),
        color: String(item.color || '').trim(),
        size: String(item.size || '').trim()
      };
    }).filter(item => item.id && item.quantity > 0);
  }
  function cartSubtotal() {
    return currentCartItems().reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
  }
  function itemCount() {
    return currentCartItems().reduce((sum, item) => sum + item.quantity, 0);
  }
  function cartDiscountPercent() {
    const extraUnits = Math.max(0, itemCount() - 1);
    return Math.min(20, extraUnits * 5);
  }
  function cartQuantityDiscount() {
    const subtotal = cartSubtotal();
    return Math.round(subtotal * cartDiscountPercent() / 100);
  }
  function lineDiscount(item) {
    const totalDiscount = cartQuantityDiscount();
    const subtotal = cartSubtotal();
    if (!totalDiscount || !subtotal) return 0;
    return Math.round(totalDiscount * ((Number(item.price) * item.quantity) / subtotal));
  }
  function addToCart(product, quantity = 1, color = '', size = '') {
    if (!product || Number(product.stock) <= 0) return showToast('That piece is currently out of stock.');
    const minQty = Math.max(1, Number(product.minOrderQty) || 1);
    quantity = Math.max(minQty, Math.floor(Number(quantity) || minQty));
    const existing = Number(cart[product.id]?.quantity || 0);
    if (existing + quantity > Number(product.stock)) return showToast(`Only ${product.stock} of this piece are available.`);
    if (product.colors?.length && !color) return showToast('Please choose a colour.');
    if (product.sizes?.length && !size) return showToast('Please choose a size.');
    cart[product.id] = { id: product.id, quantity: existing + quantity, color, size };
    saveCart();
    updateCartUI();
    trackEvent('add_to_cart', { value: Number(product.price) * quantity, currency: 'INR', item_name: product.name });
    showToast(quantity > 1 || itemCount() > 1 ? `${product.name} added to your bag. 5% extra-unit discount applied.` : `${product.name} added to your bag.`);
  }
  function changeQuantity(id, delta) {
    const product = products.find(item => item.id === id);
    if (!product || !cart[id]) return;
    const minQty = Math.max(1, Number(product.minOrderQty) || 1);
    const next = Number(cart[id].quantity) + delta;
    if (next < minQty) {
      if (delta < 0) showToast(`Minimum order quantity is ${minQty}. Remove the item instead.`);
      return;
    }
    if (next > Number(product.stock)) showToast(`Only ${product.stock} of this piece are available.`);
    else cart[id].quantity = next;
    saveCart(); updateCartUI();
  }
  function updateCartUI() {
    const items = currentCartItems();
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cartSubtotal();
    $('#bag-count').textContent = count;
    $('#drawer-count').textContent = `(${count})`;
    $('#cart-subtotal').textContent = formatMoney(subtotal);
    $('#cart-items').innerHTML = items.map(item => {
      const itemDiscount = lineDiscount(item);
      const options = [item.color && `Colour: ${item.color}`, item.size && `Size: ${item.size}`].filter(Boolean).join(' · ');
      return `<div class="cart-line" data-cart-id="${escapeHtml(item.id)}">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
      <div class="cart-line-main"><div class="cart-line-name">${escapeHtml(item.name)}</div><div class="cart-line-category">${escapeHtml(item.category)}${options ? ` · ${escapeHtml(options)}` : ''}</div><div class="cart-line-price">${formatMoney(Number(item.price) * item.quantity - itemDiscount)} ${itemDiscount ? `<del>${formatMoney(Number(item.price) * item.quantity)}</del>` : ''}</div>
      <div class="qty-stepper"><button type="button" data-cart-action="decrease" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-cart-action="increase" aria-label="Increase quantity">+</button></div></div>
      <button type="button" class="cart-remove" data-cart-action="remove" aria-label="Remove ${escapeHtml(item.name)}">×</button></div>`;
    }).join('');
    $('#cart-empty').classList.toggle('is-visible', items.length === 0);
    $('#cart-items').style.display = items.length ? 'block' : 'none';
    $('#drawer-foot').classList.toggle('is-hidden', items.length === 0);
    $('#shipping-progress').classList.toggle('is-hidden', items.length === 0);
    const threshold = Number.isFinite(Number(config.freeShippingAt)) ? Number(config.freeShippingAt) : 1999;
    const remaining = Math.max(0, threshold - subtotal);
    $('#shipping-message').textContent = remaining ? `You’re ${formatMoney(remaining)} away from free shipping` : 'Lovely — your delivery is on us.';
    $('#shipping-progress-fill').style.width = `${Math.min(100, (subtotal / threshold) * 100)}%`;
    $('#bag-count').setAttribute('aria-label', `${count} items in bag`);
  }

  function openLayer(layer) {
    $('#overlay').hidden = false;
    layer.hidden = false;
    document.body.classList.add('locked');
  }
  function closeLayer(layer) {
    if (layer) layer.hidden = true;
    const anyOpen = ['#cart-drawer', '#product-modal', '#checkout-modal', '#success-modal', '#policy-modal', '#account-modal', '#contact-modal'].some(selector => !$(selector).hidden);
    if (!anyOpen) {
      $('#overlay').hidden = true;
      document.body.classList.remove('locked');
    }
  }
  function closeAllLayers() {
    ['#cart-drawer', '#product-modal', '#checkout-modal', '#success-modal', '#policy-modal', '#account-modal', '#contact-modal'].forEach(selector => { $(selector).hidden = true; });
    $('#overlay').hidden = true;
    document.body.classList.remove('locked');
  }
  function openCart() { updateCartUI(); openLayer($('#cart-drawer')); }

  function renderModalGallery() {
    if (!modalGalleryImages.length) return;
    const image = modalGalleryImages[modalGalleryIndex];
    $('#product-gallery-main-image').src = image;
    $('#product-gallery-main-image').alt = `${activeModalProduct?.name || 'Product'} · photo ${modalGalleryIndex + 1} of ${modalGalleryImages.length}`;
    $('#product-gallery-count').textContent = `${modalGalleryIndex + 1} / ${modalGalleryImages.length}`;
    $('#product-gallery-count').hidden = modalGalleryImages.length < 2;
    $('#product-gallery-thumbs').innerHTML = modalGalleryImages.map((src, index) => `<button type="button" data-gallery-select="${index}" class="product-gallery-thumb-button${index === modalGalleryIndex ? ' active' : ''}" aria-label="Show product photo ${index + 1}" aria-pressed="${index === modalGalleryIndex}"><img src="${escapeHtml(src)}" alt=""></button>`).join('');
    $('#product-gallery-thumbs').hidden = modalGalleryImages.length < 2;
    $$('.gallery-arrow').forEach(button => { button.hidden = modalGalleryImages.length < 2; });
  }
  function stepModalGallery(step) {
    if (modalGalleryImages.length < 2) return;
    modalGalleryIndex = (modalGalleryIndex + step + modalGalleryImages.length) % modalGalleryImages.length;
    renderModalGallery();
  }
  function openProductModal(product) {
    activeModalProduct = product;
    modalGalleryImages = [...new Set([product.image, ...(Array.isArray(product.images) ? product.images : [])].filter(Boolean))].slice(0, 8);
    modalGalleryIndex = 0;
    if (!modalGalleryImages.length) modalGalleryImages = ['/images/product-pan.jpg'];
    const compare = product.compareAt && product.compareAt > product.price ? `<del>${formatMoney(product.compareAt)}</del>` : '';
    const colors = Array.isArray(product.colors) ? product.colors.filter(Boolean) : [];
    const sizes = Array.isArray(product.sizes) ? product.sizes.filter(Boolean) : [];
    const minQty = Math.max(1, Number(product.minOrderQty) || 1);
    const optionFields = [
      colors.length ? `<label class="product-option"><span>Colour</span><select id="modal-product-color"><option value="">Choose colour</option>${colors.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}</select></label>` : '',
      sizes.length ? `<label class="product-option"><span>Size</span><select id="modal-product-size"><option value="">Choose size</option>${sizes.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}</select></label>` : '',
      `<label class="product-option"><span>Quantity</span><div class="modal-qty"><button type="button" id="modal-qty-minus" aria-label="Decrease quantity">−</button><input id="modal-product-quantity" type="number" min="${minQty}" max="${Math.max(minQty, Number(product.stock) || minQty)}" value="${minQty}" inputmode="numeric"><button type="button" id="modal-qty-plus" aria-label="Increase quantity">+</button></div></label>`
    ].join('');
    const discountText = `<div class="quantity-discount-note">Add extra units and save 5% more per unit, up to 20% of the cart total.</div>`;
    $('#product-modal-body').innerHTML = `<div class="product-detail-grid"><div class="product-detail-gallery"><div class="product-detail-image"><img id="product-gallery-main-image" src="${escapeHtml(modalGalleryImages[0])}" alt="${escapeHtml(product.name)}"><button type="button" class="gallery-arrow gallery-arrow-prev" data-gallery-step="-1" aria-label="Previous product photo">‹</button><button type="button" class="gallery-arrow gallery-arrow-next" data-gallery-step="1" aria-label="Next product photo">›</button><span class="gallery-image-count" id="product-gallery-count"></span></div><div class="product-gallery-thumbs" id="product-gallery-thumbs"></div></div>` +
      `<div class="product-detail-copy"><div class="eyebrow"><span class="eyebrow-line"></span> ${escapeHtml(product.category.toUpperCase())}</div>${product.brand ? `<div class="product-brand product-detail-brand">${escapeHtml(product.brand)}</div>` : ""}<h2 id="modal-product-name">${escapeHtml(product.name)}</h2><div class="product-detail-rating">${ratingMarkup(product)}</div><div class="product-detail-price">${formatMoney(product.price)} ${compare}</div><p>${escapeHtml(product.description || '')}</p><div class="product-option-grid">${optionFields}</div>${discountText}<div class="product-detail-stock">${Number(product.stock) > 0 ? `✳ &nbsp;In stock · ${product.stock} available` : 'Currently out of stock'}</div><div class="product-detail-actions"><button class="button button-dark detail-add" type="button" data-action="modal-add" data-id="${escapeHtml(product.id)}" ${Number(product.stock) <= 0 ? 'disabled' : ''}><span>${Number(product.stock) > 0 ? 'Add to bag' : 'Sold out'}</span><span>+</span></button><button type="button" class="detail-wishlist${wishlist.includes(product.id) ? ' is-saved' : ''}" data-action="modal-wishlist" aria-pressed="${wishlist.includes(product.id)}">${wishlist.includes(product.id) ? '♥ Saved' : '♡ Save for later'}</button></div></div></div>`;
    renderModalGallery();
    openLayer($('#product-modal'));
  }
  function openPolicy(key) {
    const labels = { shipping: 'Shipping policy', returns: 'Returns & refunds', privacy: 'Privacy policy', terms: 'Terms & conditions' };
    const content = storefrontSettings.policies?.[key] || 'Please contact our team for the latest information.';
    $('#policy-title').textContent = labels[key] || 'Store policy';
    $('#policy-content').textContent = content;
    openLayer($('#policy-modal'));
  }

  function renderCheckoutSummary() {
    const items = currentCartItems();
    const subtotal = cartSubtotal();
    const threshold = Number.isFinite(Number(config.freeShippingAt)) ? Number(config.freeShippingAt) : 1999;
    const fee = Number.isFinite(Number(config.shippingFee)) ? Number(config.shippingFee) : 99;
    const shipping = subtotal >= threshold ? 0 : fee;
    const marketing = storefrontSettings.marketing || {};
    const validCoupon = appliedCoupon && appliedCoupon.toUpperCase() === String(marketing.couponCode || '').toUpperCase() && Number(marketing.discountPercent) > 0;
    const discount = validCoupon ? Math.round(subtotal * Number(marketing.discountPercent) / 100) : 0;
    $('#checkout-discount-line').hidden = !discount;
    $('#checkout-discount').textContent = `−${formatMoney(discount)}`;
    $('#checkout-item-count').textContent = `${items.reduce((total, item) => total + item.quantity, 0)} ${items.length === 1 ? 'item' : 'items'}`;
    $('#checkout-items').innerHTML = items.map(item => {
      const itemDiscount = lineDiscount(item);
      const options = [item.color && `Colour: ${item.color}`, item.size && `Size: ${item.size}`].filter(Boolean).join(' · ');
      return `<div class="checkout-item"><img src="${escapeHtml(item.image)}" alt=""><div class="checkout-item-name">${escapeHtml(item.name)}<small>Qty ${item.quantity}${options ? ` · ${escapeHtml(options)}` : ''}</small></div><strong>${formatMoney(item.price * item.quantity - itemDiscount)}</strong></div>`;
    }).join('');
    const quantityDiscount = cartQuantityDiscount();
    $('#checkout-subtotal').textContent = formatMoney(subtotal);
    $('#checkout-discount-line').hidden = !quantityDiscount && !discount;
    $('#checkout-discount').textContent = quantityDiscount || discount ? `−${formatMoney(quantityDiscount + discount)}` : '−₹0';
    $('#checkout-shipping').textContent = shipping ? formatMoney(shipping) : 'On us';
    $('#checkout-total').textContent = formatMoney(subtotal - quantityDiscount - discount + shipping);
    $('.summary-note').textContent = threshold > 0 ? `Free delivery on orders over ${formatMoney(threshold)}.` : 'Delivery is on us for every order.';
  }
  function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        if (window.Razorpay) return resolve();
      }
      const script = document.createElement('script');
      script.src = src; script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load the secure payment window. Check your connection and try again.'));
      document.head.appendChild(script);
    });
  }
  async function launchRazorpay(order, customer) {
    await loadExternalScript('https://checkout.razorpay.com/v1/checkout.js');
    return new Promise(resolve => {
      const checkout = new window.Razorpay({
        key: order.razorpay.keyId,
        amount: order.razorpay.amount,
        currency: order.razorpay.currency,
        name: config.storeName || 'MarketTech Kitchen',
        description: `Order ${order.id}`,
        order_id: order.razorpay.orderId,
        prefill: { name: customer.name, email: customer.email, contact: customer.phone },
        theme: { color: '#354737' },
        handler: async response => {
          try {
            const verified = await api('/api/payment/razorpay/verify', { method: 'POST', body: JSON.stringify({ orderId: order.id, ...response }) });
            resolve({ verified: true, order: verified.order });
          } catch (error) { resolve({ error: error.message }); }
        },
        modal: { ondismiss: () => resolve({ dismissed: true })
        }
      });
      checkout.on('payment.failed', response => resolve({ error: response.error?.description || 'Payment was not completed.' }));
      checkout.open();
    });
  }
  async function completeOrder(order, upiLink = '') {
    appliedCoupon = '';
    if (order.paymentStatus === 'Paid' || order.paymentMethod === 'Cash on Delivery') trackEvent('purchase', { transaction_id: order.id, value: Number(order.total), currency: 'INR' });
    cart = {}; saveCart(); updateCartUI();
    $('#checkout-modal').hidden = true;
    $('#success-order-id').textContent = order.id;
    const upiButton = $('#success-upi-link');
    upiButton.hidden = !upiLink;
    const upiDetails = $('#upi-payment-details');
    const qrWrap = $('#upi-qr-wrap');
    upiDetails.hidden = !upiLink;
    qrWrap.hidden = !upiLink || !order.upiQrImage;
    if (upiLink) {
      upiButton.href = upiLink;
      $('#success-upi-vpa').textContent = order.upiVpa || '';
      if (order.upiQrImage) $('#success-upi-qr').src = order.upiQrImage;
      $('#success-description').textContent = `Your order is saved. Complete the UPI payment in your app; we’ll verify the transfer before dispatch.`;
    } else if (order.paymentStatus === 'Paid') {
      $('#success-description').textContent = 'Your payment is confirmed. Thank you for making space for us in your kitchen.';
    } else {
      $('#success-description').textContent = 'Thank you for making space for us in your kitchen. We’ll call to confirm your delivery details.';
    }
    openLayer($('#success-modal'));
    $('#checkout-form').reset();
    await loadStore();
  }

  function startCheckout() {
    if (!itemCount()) return showToast('Your bag is empty for now.');
    if (!currentCustomer) {
      checkoutAfterAuth = true;
      openLayer($('#account-modal'));
      $('#account-auth-view').hidden = false;
      $('#account-profile-view').hidden = true;
      setAccountMode('login');
      $('#customer-login-error').textContent = '';
      const loginEmail = $('#customer-login-form')?.elements.namedItem('email');
      if (loginEmail) setTimeout(() => loginEmail.focus({ preventScroll: true }), 80);
      showToast('Please sign in or create an account to place your order.');
      return;
    }
    if (currentCustomer) {
      for (const field of ['name', 'phone', 'email']) {
        const input = $('#checkout-form').elements.namedItem(field);
        if (input && !input.value) input.value = currentCustomer[field] || '';
      }
    }
    appliedCoupon = '';
    $('#coupon-input').value = '';
    $('#coupon-message').textContent = '';
    $('#cart-drawer').hidden = true;
    renderCheckoutSummary();
    $('#checkout-error').textContent = '';
    $('#checkout-modal').hidden = false;
    $('#overlay').hidden = false;
  }

  $('#product-grid').addEventListener('click', event => {
    const card = event.target.closest('.product-card');
    if (!card) return;
    const product = products.find(item => item.id === card.dataset.productId);
    if (event.target.closest('[data-action="wishlist"]')) { toggleWishlist(product.id); return; }
    if (event.target.closest('[data-action="add"]')) { openProductModal(product); return; }
    if (event.target.closest('[data-action="view"]')) openProductModal(product);
  });
  $('#product-modal-body').addEventListener('click', event => {
    const step = event.target.closest('[data-gallery-step]');
    if (step) { stepModalGallery(Number(step.dataset.galleryStep)); return; }
    const thumb = event.target.closest('[data-gallery-select]');
    if (thumb) { modalGalleryIndex = Number(thumb.dataset.gallerySelect); renderModalGallery(); return; }
    const wishlistButton = event.target.closest('[data-action="modal-wishlist"]');
    if (wishlistButton && activeModalProduct) { toggleWishlist(activeModalProduct.id); return; }
    const qtyPlus = event.target.closest('#modal-qty-plus');
    const qtyMinus = event.target.closest('#modal-qty-minus');
    if ((qtyPlus || qtyMinus) && activeModalProduct) {
      const input = $('#modal-product-quantity');
      const minQty = Math.max(1, Number(activeModalProduct.minOrderQty) || 1);
      const maxQty = Math.max(minQty, Number(activeModalProduct.stock) || minQty);
      const step = qtyPlus ? 1 : -1;
      input.value = Math.max(minQty, Math.min(maxQty, Math.floor(Number(input.value) || minQty) + step));
      return;
    }
    const button = event.target.closest('[data-action="modal-add"]');
    if (!button) return;
    const product = products.find(item => item.id === button.dataset.id);
    if (product && Number(product.stock) > 0) {
      const minQty = Math.max(1, Number(product.minOrderQty) || 1);
      const quantity = Math.max(minQty, Math.floor(Number($('#modal-product-quantity')?.value) || minQty));
      const color = $('#modal-product-color')?.value || '';
      const size = $('#modal-product-size')?.value || '';
      addToCart(product, quantity, color, size);
      closeAllLayers(); openCart();
    }
  });
  $('#product-modal-body').addEventListener('change', event => {
    // Quantity/option controls are handled in click/change events inside the modal.
    if (event.target.id === 'modal-product-quantity' && activeModalProduct) {
      const minQty = Math.max(1, Number(activeModalProduct.minOrderQty) || 1);
      event.target.value = Math.max(minQty, Math.min(Number(activeModalProduct.stock) || minQty, Math.floor(Number(event.target.value) || minQty)));
    }
  });

  $('#filter-list').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    activeCategory = button.dataset.filter;
    renderFilters(); renderProducts();
  });
  $('#sort-select').addEventListener('change', event => { sortOrder = event.target.value; renderProducts(); });
  $('#view-all-link')?.addEventListener('click', event => { event.preventDefault(); activeCategory = 'all'; searchTerm = ''; $('#search-input').value = ''; renderFilters(); renderProducts(); });
  $('#reset-filters').addEventListener('click', () => {
    if (!products.length && !searchTerm) {
      window.location.href = '/about.html';
      return;
    }
    activeCategory = 'all'; searchTerm = ''; $('#search-input').value = ''; renderFilters(); renderProducts();
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-category-link], [data-nav-filter]');
    if (!link) return;
    const value = link.dataset.categoryLink || link.dataset.navFilter;
    if (!value) return;
    event.preventDefault();
    activeCategory = value === 'all' ? 'all' : value;
    searchTerm = '';
    $('#search-input').value = '';
    renderFilters(); renderProducts();
    $('#mobile-nav').hidden = true;
    $('#mobile-menu-toggle').setAttribute('aria-expanded', 'false');
    $('#mobile-menu-toggle').setAttribute('aria-label', 'Open menu');
    document.querySelector('#shop').scrollIntoView({ behavior: 'smooth' });
  });
  document.addEventListener('click', event => {
    const contactLink = event.target.closest('[data-contact-open]');
    if (!contactLink) return;
    event.preventDefault();
    $('#mobile-nav').hidden = true;
    $('#mobile-menu-toggle').setAttribute('aria-expanded', 'false');
    $('#mobile-menu-toggle').setAttribute('aria-label', 'Open menu');
    openLayer($('#contact-modal'));
  });
  document.addEventListener('click', event => {
    const policyLink = event.target.closest('[data-policy]');
    if (!policyLink) return;
    event.preventDefault();
    openPolicy(policyLink.dataset.policy);
  });
  $('#search-toggle').addEventListener('click', () => {
    const row = $('#search-row');
    row.hidden = !row.hidden;
    if (!row.hidden) $('#search-input').focus();
    else { searchTerm = ''; $('#search-input').value = ''; renderProducts(); }
  });
  $('#close-search').addEventListener('click', () => { $('#search-row').hidden = true; searchTerm = ''; $('#search-input').value = ''; renderProducts(); });
  $('#search-input').addEventListener('input', event => { searchTerm = event.target.value; renderProducts(); if (searchTerm) document.querySelector('#shop').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  function runQuickSearch(value) {
    searchTerm = String(value || '').trim();
    $('#search-input').value = searchTerm;
    const heroInput = $('#quick-search-input');
    const quickInput = $('#quick-find-input');
    if (heroInput) heroInput.value = searchTerm;
    if (quickInput) quickInput.value = searchTerm;
    activeCategory = 'all';
    renderFilters();
    renderProducts();
    document.querySelector('#shop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#quick-search-button')?.addEventListener('click', () => runQuickSearch($('#quick-search-input')?.value));
  $('#quick-search-input')?.addEventListener('keydown', event => { if (event.key === 'Enter') runQuickSearch(event.currentTarget.value); });
  $('#quick-find-search-button')?.addEventListener('click', () => runQuickSearch($('#quick-find-input')?.value));
  $('#quick-find-input')?.addEventListener('keydown', event => { if (event.key === 'Enter') runQuickSearch(event.currentTarget.value); });
  $('#quick-find-input')?.addEventListener('input', event => {
    const value = event.currentTarget.value;
    if (!value) { searchTerm = ''; $('#search-input').value = ''; renderProducts(); }
  });
  $('#open-cart').addEventListener('click', openCart);
  $('#open-account').addEventListener('click', openAccount);
  $('#mobile-account-link').addEventListener('click', openAccount);
  $$('[data-account-mode]').forEach(button => button.addEventListener('click', () => setAccountMode(button.dataset.accountMode)));
  $('#customer-login-form').addEventListener('submit', event => { event.preventDefault(); submitCustomerAuth(event.currentTarget, '/api/auth/login', '#customer-login-error'); });
  $('#customer-register-form').addEventListener('submit', event => { event.preventDefault(); submitCustomerAuth(event.currentTarget, '/api/auth/register', '#customer-register-error'); });
  $('#account-orders').addEventListener('click', event => {
    if (event.target.closest('[data-account-shop]')) { closeAllLayers(); document.querySelector('#shop').scrollIntoView({ behavior: 'smooth' }); }
  });
  $('#account-signout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* clear this browser even if the server is unavailable */ }
    currentCustomer = null;
    customerPreviewToken = '';
    try { sessionStorage.removeItem('mt-customer-preview-token'); } catch { /* storage may be disabled */ }
    $('#account-profile-view').hidden = true;
    $('#account-auth-view').hidden = false;
    setAccountMode('login');
    updateAccountButtons();
    showToast('You’ve signed out. See you again soon.');
  });
  $('#start-checkout').addEventListener('click', startCheckout);
  $('#cart-items').addEventListener('click', event => {
    const button = event.target.closest('[data-cart-action]');
    if (!button) return;
    const line = button.closest('[data-cart-id]');
    if (!line) return;
    const id = line.dataset.cartId;
    const action = button.dataset.cartAction;
    if (action === 'increase') changeQuantity(id, 1);
    else if (action === 'decrease') changeQuantity(id, -1);
    else if (action === 'remove') { delete cart[id]; saveCart(); updateCartUI(); }
  });
  $('#overlay').addEventListener('click', closeAllLayers);
  $$('[data-close-drawer]').forEach(button => button.addEventListener('click', () => closeLayer($('#cart-drawer'))));
  $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeLayer($('#product-modal'))));
  $$('[data-close-checkout]').forEach(button => button.addEventListener('click', closeAllLayers));
  $$('[data-close-success]').forEach(button => button.addEventListener('click', closeAllLayers));
  $$('[data-close-policy]').forEach(button => button.addEventListener('click', closeAllLayers));
  $$('[data-close-account]').forEach(button => button.addEventListener('click', () => closeLayer($('#account-modal'))));
  $$('.payment-choice input[name="paymentMethod"]').forEach(input => input.addEventListener('change', renderPaymentOptions));
  $('#cookie-accept').addEventListener('click', () => { try { localStorage.setItem('mt-kitchen-consent', 'accepted'); } catch {} $('#cookie-banner').hidden = true; loadTrackingScripts(storefrontSettings.marketing || {}); });
  $('#cookie-essential').addEventListener('click', () => { try { localStorage.setItem('mt-kitchen-consent', 'essential'); } catch {} $('#cookie-banner').hidden = true; });
  $('#copy-upi-vpa').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#success-upi-vpa').textContent); showToast('UPI ID copied.'); }
    catch { showToast('Please copy the UPI ID shown above.'); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAllLayers();
    if (!$('#product-modal').hidden && !event.target.closest('input,textarea,select')) {
      if (event.key === 'ArrowLeft') stepModalGallery(-1);
      if (event.key === 'ArrowRight') stepModalGallery(1);
    }
  });
  $('#mobile-menu-toggle').addEventListener('click', () => {
    const menu = $('#mobile-nav');
    menu.hidden = !menu.hidden;
    $('#mobile-menu-toggle').setAttribute('aria-expanded', String(!menu.hidden));
    $('#mobile-menu-toggle').setAttribute('aria-label', menu.hidden ? 'Open menu' : 'Close menu');
  });
  $('#mobile-nav').addEventListener('click', event => {
    if (!event.target.closest('a')) return;
    $('#mobile-nav').hidden = true;
    $('#mobile-menu-toggle').setAttribute('aria-expanded', 'false');
    $('#mobile-menu-toggle').setAttribute('aria-label', 'Open menu');
  });

  $$('[data-close-contact]').forEach(button => button.addEventListener('click', () => closeLayer($('#contact-modal'))));

  $('#apply-coupon').addEventListener('click', () => {
    const entered = $('#coupon-input').value.trim().toUpperCase();
    appliedCoupon = entered;
    if (entered) {
      $('#coupon-message').textContent = 'Code added. We’ll verify it when you place the order.';
      $('#coupon-message').classList.remove('coupon-error');
    } else {
      $('#coupon-message').textContent = '';
      $('#coupon-message').classList.remove('coupon-error');
    }
    renderCheckoutSummary();
  });

  $('#coupon-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('#apply-coupon').click(); } });

  $('#checkout-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('.place-order-button', event.currentTarget);
    const label = button.innerHTML;
    const form = new FormData(event.currentTarget);
    const paymentMethod = form.get('paymentMethod') || 'cod';
    const customer = Object.fromEntries(form.entries());
    delete customer.paymentMethod;
    const items = currentCartItems().map(item => ({ id: item.id, quantity: item.quantity, color: item.color || '', size: item.size || '' }));
    $('#checkout-error').textContent = '';
    button.disabled = true; button.innerHTML = 'Placing your order…';
    try {
      const result = await api('/api/orders', { method: 'POST', body: JSON.stringify({ customer, items, paymentMethod, couponCode: appliedCoupon }) });
      if (result.order.razorpay) {
        button.innerHTML = 'Opening secure payment…';
        const payment = await launchRazorpay(result.order, customer);
        if (payment.verified) await completeOrder(payment.order);
        else $('#checkout-error').textContent = payment.error || `Payment window closed. Order ${result.order.id} is still awaiting payment; you can cancel it from the admin panel.`;
      } else {
        await completeOrder(result.order, result.order.upiLink || '');
      }
    } catch (error) {
      $('#checkout-error').textContent = error.message;
    } finally {
      button.disabled = false; button.innerHTML = label;
    }
  });

  // The newsletter section is optional: some storefronts are published without it.
  // Guard the element lookups so a missing section can never stop the rest of the
  // store (the product catalogue in particular) from loading.
  const newsletterForm = $('#newsletter-form');
  const newsletterEmail = $('#newsletter-email');
  const newsletterMessage = $('#newsletter-message');
  if (newsletterForm && newsletterEmail && newsletterMessage) {
    newsletterForm.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = newsletterMessage;
      const button = $('button', form);
      button.disabled = true;
      try {
        const result = await api('/api/newsletter', { method: 'POST', body: JSON.stringify({ email: newsletterEmail.value }) });
        message.textContent = result.message;
        form.classList.add('is-success');
        newsletterEmail.value = '';
      } catch (error) { message.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }

  $('#year').textContent = new Date().getFullYear();
  if (window.location.hash === '#contact') {
    setTimeout(() => openLayer($('#contact-modal')), 80);
  }
  updateAccountButtons();
  updateCartUI();
  refreshCustomerSession();
  loadStore();
})();

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const statuses = ['New', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  let products = [];
  let orders = [];
  let customers = [];
  let productGalleryImages = [];
  let summary = {};
  let settings = {};
  let integrationStatus = {};
  let currentPage = 'overview';
  let toastTimer;
  let previewToken = '';
  try { previewToken = sessionStorage.getItem('mt-admin-preview-token') || ''; } catch { /* storage may be disabled */ }

  const IMPORT_MAX_BYTES = 4 * 1024 * 1024;
  const IMPORT_STATUS_LABELS = { created: 'CREATED', updated: 'UPDATED', skipped: 'SKIPPED', error: 'ERROR', failed: 'FAILED' };
  const IMPORT_FIELD_LABELS = {
    sku: 'sku', product_name: 'product_name', slug: 'slug', category: 'category', mrp: 'mrp',
    selling_price: 'selling_price', stock_quantity: 'stock_quantity', hsn_code: 'hsn_code', gst: 'gst',
    description: 'description', status: 'status', featured: 'featured',
    package_length_cm: 'package_length_cm', package_breadth_cm: 'package_breadth_cm',
    package_height_cm: 'package_height_cm', package_weight_kg: 'package_weight_kg'
  };
  const importFieldLabel = field => IMPORT_FIELD_LABELS[field] || field;
  let importPayload = null;
  let importPreview = null;
  let importResult = null;
  let importFilter = 'all';
  let importBusy = false;

  const formatMoney = amount => money.format(Number(amount) || 0);
  const dateShort = value => {
    if (!value) return '—';
    const date = new Date(value);
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  };
  const timeAgo = value => {
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return dateShort(value);
  };
  const statusClass = status => `status-${String(status || '').toLowerCase().replace(/[^a-z]+/g, '-')}`;
  function showToast(message) {
    const element = $('#admin-toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
  }
  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        credentials: 'same-origin', ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(previewToken ? { Authorization: `Bearer ${previewToken}` } : {}), ...(options.headers || {}) }
      });
    } catch {
      throw new Error('Could not reach the store API. Check your internet connection and open the deployed Cloudflare Pages address.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }
  function showLogin() {
    $('#login-screen').hidden = false;
    $('#admin-layout').hidden = true;
    $('#login-email').focus({ preventScroll: true });
  }
  async function showAdmin(email) {
    $('#login-screen').hidden = true;
    $('#admin-layout').hidden = false;
    $('#admin-email-label').textContent = email || 'Store admin';
    const now = new Date();
    $('#today-label').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(now).toUpperCase();
    await refreshAll();
  }
  async function refreshAll() {
    try {
      const data = await Promise.all([api('/api/admin/summary'), api('/api/admin/products'), api('/api/admin/orders'), api('/api/admin/settings'), api('/api/admin/integrations'), api('/api/admin/customers')]);
      [summary, products, orders, settings, integrationStatus, customers] = data;
      renderOverview(); renderProducts(); renderOrders(); renderCustomers(); renderInventory(); renderSettings(); renderIntegrations();
    } catch (error) {
      if (error.message.includes('sign in')) showLogin();
      else showToast(error.message);
    }
  }

  function openPage(page) {
    if (!['overview', 'products', 'orders', 'customers', 'inventory', 'website', 'integrations'].includes(page)) return;
    currentPage = page;
    $$('.admin-page').forEach(section => { section.hidden = section.id !== `page-${page}`; });
    $$('.admin-nav-item[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    $('#breadcrumb-current').textContent = page[0].toUpperCase() + page.slice(1);
    $('#admin-sidebar').classList.remove('mobile-open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'orders') renderOrders();
    if (page === 'customers') renderCustomers();
    if (page === 'products') renderProducts();
    if (page === 'inventory') renderInventory();
    if (page === 'website') renderSettings();
    if (page === 'integrations') renderIntegrations();
  }

  function renderOverview() {
    $('#stat-revenue').textContent = formatMoney(summary.revenue || 0);
    $('#stat-orders').textContent = String(summary.orders || 0);
    $('#stat-pending').textContent = `${summary.pending || 0} pending`;
    $('#stat-products').textContent = String(products.length);
    $('#stat-subscribers').textContent = String(summary.subscribers || 0);
    $('#stat-low-stock').textContent = summary.lowStock ? `${summary.lowStock} need a restock` : 'Everything in good shape';
    $('#nav-pending-count').textContent = String(summary.pending || 0);

    const today = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setHours(0, 0, 0, 0);
      date.setDate(today.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      return { date, key, count: orders.filter(order => String(order.createdAt || '').slice(0, 10) === key).length };
    });
    const maxCount = Math.max(1, ...days.map(day => day.count));
    $('#mini-chart').innerHTML = days.map((day, index) => {
      const height = day.count === 0 ? 3 : Math.max(13, (day.count / maxCount) * 100);
      const label = new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(day.date);
      return `<div class="chart-column${index === 6 ? ' today' : ''}"><span class="chart-value">${day.count || ''}</span><span class="chart-bar" style="height:${height}%"></span><span class="chart-label">${escapeHtml(label)}</span></div>`;
    }).join('');

    const stockThreshold = Number(settings?.site?.lowStockThreshold ?? 8);
    const lowItems = [...products].filter(product => Number(product.stock) <= stockThreshold).sort((a, b) => a.stock - b.stock).slice(0, 4);
    $('#low-stock-list').innerHTML = lowItems.length ? lowItems.map(product => `<div class="low-stock-item"><img src="${escapeHtml(product.image)}" alt=""><div class="low-stock-copy"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)}</small></div><span class="stock-pill">${Number(product.stock) === 0 ? 'Sold out' : `${Number(product.stock)} left`}</span></div>`).join('') : `<div class="low-stock-empty">✳<br>All shelves are looking good.<br>Nothing needs a restock just yet.</div>`;
    const recent = orders.slice(0, 5);
    $('#recent-order-rows').innerHTML = recent.map(order => orderRow(order, false)).join('');
    $('#empty-recent-orders').hidden = recent.length > 0;
  }

  function orderRow(order, full) {
    const customer = order.customer || {};
    const count = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const statusOptions = statuses.map(status => `<option value="${status}"${status === order.status ? ' selected' : ''}>${status}</option>`).join('');
    if (full) return `<tr data-order-id="${escapeHtml(order.id)}"><td><span class="order-id">${escapeHtml(order.id)}</span></td><td><div class="customer-cell"><strong>${escapeHtml(customer.name || 'Customer')}</strong><small>${escapeHtml(customer.phone || '')}</small></div></td><td class="date-cell">${escapeHtml(timeAgo(order.createdAt))}</td><td>${count} ${count === 1 ? 'item' : 'items'}</td><td><span class="order-total">${formatMoney(order.total)}</span></td><td><select class="inline-select" data-status-select aria-label="Change status for ${escapeHtml(order.id)}">${statusOptions}</select></td><td class="order-row-actions"><button type="button" data-action="view-order" aria-label="View order">↗</button></td></tr>`;
    return `<tr data-order-id="${escapeHtml(order.id)}"><td><span class="order-id">${escapeHtml(order.id)}</span></td><td><div class="customer-cell"><strong>${escapeHtml(customer.name || 'Customer')}</strong><small>${escapeHtml(customer.phone || '')}</small></div></td><td class="date-cell">${escapeHtml(timeAgo(order.createdAt))}</td><td><span class="order-total">${formatMoney(order.total)}</span></td><td><span class="status-pill ${statusClass(order.status)}">${escapeHtml(order.status || 'New')}</span></td><td><button type="button" class="row-view" data-action="view-order" aria-label="View order">↗</button></td></tr>`;
  }

  function renderProducts() {
    const search = ($('#product-search')?.value || '').trim().toLowerCase();
    const list = products.filter(product => `${product.name} ${product.category} ${product.tag}`.toLowerCase().includes(search));
    $('#products-count-label').textContent = `${list.length} ${list.length === 1 ? 'product' : 'products'}`;
    $('#product-rows').innerHTML = list.map(product => {
      const available = Number(product.stock) > 0;
      const stockClass = Number(product.stock) <= Number(settings?.site?.lowStockThreshold ?? 8) ? 'stock-low' : '';
      return `<tr data-product-id="${escapeHtml(product.id)}"><td><div class="product-table-item"><img src="${escapeHtml(product.image)}" alt=""><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku ? (product.tag ? `${product.sku} · ${product.tag}` : product.sku) : (product.tag || product.id))}</small></span></div></td><td><span class="category-label">${escapeHtml(product.category)}</span></td><td><span class="price-label">${formatMoney(product.price)}</span></td><td><span class="stock-label ${stockClass}">${Number(product.stock)} units</span></td><td><span class="product-status${available ? '' : ' out'}">${available ? 'Active' : 'Out of stock'}</span></td><td><div class="table-actions"><button type="button" data-action="edit-product">Edit</button><button type="button" class="delete-action" data-action="delete-product">Delete</button></div></td></tr>`;
    }).join('');
    $('#empty-products-admin').hidden = list.length > 0;
  }

  function fillForm(form, source = {}) {
    if (!form) return;
    for (const element of [...form.elements]) {
      if (!element.name || !Object.hasOwn(source, element.name)) continue;
      if (element.type === 'checkbox') element.checked = Boolean(source[element.name]);
      else element.value = source[element.name] ?? '';
    }
  }
  function renderSettings() {
    if (!settings || !settings.site) return;
    fillForm($('#site-settings-form'), settings.site);
    fillForm($('#operations-settings-form'), settings.site);
    fillForm($('#policies-form'), settings.policies || {});
    fillForm($('#marketing-settings-form'), settings.marketing || {});
    $('#upi-qr-preview').hidden = !settings.site.upiQrImage;
    if (settings.site.upiQrImage) $('#upi-qr-preview').src = settings.site.upiQrImage;
    $('#upi-qr-file').value = '';
  }
  function renderIntegrations() {
    const razorpay = integrationStatus.razorpay || {};
    const upi = integrationStatus.upi || {};
    const analytics = integrationStatus.analytics || {};
    const email = integrationStatus.emailProvider || {};
    const setStatus = (id, active, text) => {
      const element = $(id);
      element.textContent = text;
      element.classList.toggle('is-connected', Boolean(active));
      element.classList.toggle('is-disconnected', !active);
    };
    setStatus('#razorpay-status', razorpay.configured, razorpay.configured ? `Connected · ${(razorpay.mode || 'test').toUpperCase()}` : 'Needs setup');
    $('#razorpay-detail').textContent = razorpay.configured ? `Razorpay is configured in ${String(razorpay.mode || 'test').toUpperCase()} mode${razorpay.keyId ? ` · ${razorpay.keyId.slice(0, 9)}…` : ''}.` : 'Add your Razorpay keys to the private server environment to enable online checkout.';
    setStatus('#upi-status', upi.configured, upi.configured ? `Ready · ${upi.vpa}` : 'Needs UPI ID');
    $('#upi-detail').textContent = upi.configured ? `UPI intent is available for ${upi.vpa}. Payment confirmation is manual until a gateway verifies it.` : 'Set your UPI ID in Website & policies → Contact & store operations.';
    const analyticsCount = Object.values(analytics).filter(Boolean).length;
    setStatus('#analytics-status', analyticsCount > 0, analyticsCount ? `${analyticsCount} ID${analyticsCount === 1 ? '' : 's'} saved` : 'Not connected');
    $('#analytics-detail').textContent = analyticsCount ? `${analyticsCount} analytics/ad integration${analyticsCount === 1 ? '' : 's'} configured. Trackers wait for visitor consent.` : 'Add your public measurement IDs in the Marketing & ads form below. Trackers load only after a visitor gives optional analytics consent.';
    setStatus('#email-provider-status', email.configured, email.configured ? 'Server key found' : 'Not connected');
  }
  function renderInventory() {
    const search = ($('#inventory-search')?.value || '').trim().toLowerCase();
    const threshold = Number(settings?.site?.lowStockThreshold ?? 8);
    $('#inventory-threshold-label').textContent = String(threshold);
    const list = products.filter(product => `${product.name} ${product.category} ${product.id}`.toLowerCase().includes(search));
    $('#inventory-count-label').textContent = `${list.length} ${list.length === 1 ? 'item' : 'items'}`;
    $('#inventory-rows').innerHTML = list.map(product => {
      const stock = Number(product.stock);
      const state = stock <= 0 ? 'Sold out' : stock <= threshold ? 'Low stock' : 'In stock';
      const stateClass = stock <= 0 ? 'inventory-out' : stock <= threshold ? 'inventory-low' : 'inventory-good';
      return `<tr data-product-id="${escapeHtml(product.id)}"><td><div class="product-table-item"><img src="${escapeHtml(product.image)}" alt=""><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category)}</small></span></div></td><td><span class="category-label">${escapeHtml(product.sku || product.id)}</span></td><td><input class="inventory-stock-input" type="number" min="0" step="1" value="${stock}" aria-label="Stock quantity for ${escapeHtml(product.name)}"></td><td><span class="inventory-state ${stateClass}">${state}</span></td><td><button type="button" class="admin-button admin-button-light stock-save-button" data-action="save-stock">Save quantity</button></td></tr>`;
    }).join('');
    $('#empty-inventory').hidden = list.length > 0;
  }
  function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
  function downloadCsv(filename, rows) {
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function renderOrders() {
    const search = ($('#order-search')?.value || '').trim().toLowerCase();
    const status = $('#order-status-filter')?.value || 'all';
    const list = orders.filter(order => {
      const customer = order.customer || {};
      const searchable = `${order.id} ${customer.name || ''} ${customer.phone || ''} ${customer.email || ''}`.toLowerCase();
      return (!search || searchable.includes(search)) && (status === 'all' || order.status === status);
    });
    $('#orders-count-label').textContent = `${list.length} ${list.length === 1 ? 'order' : 'orders'} · all payment methods`;
    $('#order-rows').innerHTML = list.map(order => orderRow(order, true)).join('');
    $('#empty-orders-admin').hidden = list.length > 0;
  }

  function renderCustomers() {
    const search = ($('#customer-search')?.value || '').trim().toLowerCase();
    const list = customers.filter(customer => `${customer.name} ${customer.email} ${customer.phone}`.toLowerCase().includes(search));
    $('#customers-count-label').textContent = `${list.length} ${list.length === 1 ? 'customer' : 'customers'}`;
    $('#customer-rows').innerHTML = list.map(customer => `<tr><td><div class="customer-cell"><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.email)}</small></div></td><td>${escapeHtml(customer.phone || '—')}</td><td class="date-cell">${escapeHtml(dateShort(customer.createdAt))}</td><td>${Number(customer.orderCount || 0)}</td><td><span class="order-total">${formatMoney(customer.spend || 0)}</span></td></tr>`).join('');
    $('#empty-customers-admin').hidden = list.length > 0;
  }

  function openAdminModal(selector) {
    $('#admin-modal-backdrop').hidden = false;
    $(selector).hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeAdminModals() {
    $$('.admin-modal').forEach(modal => { modal.hidden = true; });
    $('#admin-modal-backdrop').hidden = true;
    document.body.classList.remove('modal-open');
  }
  function renderProductGalleryEditor() {
    const hiddenInput = $('#product-gallery-images');
    if (hiddenInput) hiddenInput.value = JSON.stringify(productGalleryImages);
    const preview = $('#product-gallery-admin');
    if (!preview) return;
    preview.innerHTML = productGalleryImages.map((image, index) => `<div class="product-gallery-thumb${index === 0 ? ' is-cover' : ''}" data-gallery-index="${index}"><img src="${escapeHtml(image)}" alt="Product photo ${index + 1}"><span>${index === 0 ? 'Cover photo' : `Photo ${index + 1}`}</span><div><button type="button" data-gallery-cover="${index}"${index === 0 ? ' disabled' : ''}>${index === 0 ? 'Cover' : 'Make cover'}</button>${index > 0 ? `<button type="button" class="gallery-remove" data-gallery-remove="${index}" aria-label="Remove photo ${index + 1}">×</button>` : ''}</div></div>`).join('');
  }

  function openProductEditor(product = null) {
    const form = $('#product-form');
    form.reset();
    $('#product-form-error').textContent = '';
    $('#product-modal-title').innerHTML = product ? 'Edit your <em>product.</em>' : 'Add a <em>product.</em>';
    const set = (name, value) => { const element = form.elements.namedItem(name); if (element) element.value = value ?? ''; };
    set('id', product?.id || '');
    set('name', product?.name || '');
    set('sku', product?.sku || '');
    const categorySelect = form.elements.namedItem('category');
    const existingOption = [...categorySelect.options].find(option => option.value === product?.category);
    if (product?.category && !existingOption) categorySelect.add(new Option(product.category, product.category));
    set('category', product?.category || '');
    set('image', product?.image || '/images/product-pan.jpg');
    $('#product-image-preview').src = product?.image || '/images/product-pan.jpg';
    $('#product-image-file').value = '';
    $('#product-gallery-files').value = '';
    productGalleryImages = [...new Set([product?.image || '/images/product-pan.jpg', ...(Array.isArray(product?.images) ? product.images : [])])].slice(0, 8);
    renderProductGalleryEditor();
    set('price', product?.price ?? '');
    set('compareAt', product?.compareAt ?? '');
    set('stock', product?.stock ?? '');
    set('tag', product?.tag || '');
    set('description', product?.description || '');
    form.elements.namedItem('featured').checked = Boolean(product?.featured);
    openAdminModal('#product-edit-modal');
    setTimeout(() => form.elements.namedItem('name').focus(), 50);
  }

  function openOrderDetails(order) {
    if (!order) return;
    const customer = order.customer || {};
    const items = Array.isArray(order.items) ? order.items : [];
    $('#order-detail-title').innerHTML = `A parcel <em>on its way.</em>`;
    const fullAddress = [customer.address, customer.city, customer.state, customer.pincode].filter(Boolean).map(escapeHtml).join(', ');
    const currentPaymentStatus = order.paymentStatus || (order.paymentMethod === 'Cash on Delivery' ? 'Due on delivery' : 'Pending');
    const paymentOptions = ['Pending', 'Paid', 'Due on delivery', 'Failed'].map(status => `<option value="${status}"${status === currentPaymentStatus ? ' selected' : ''}>${status}</option>`).join('');
    $('#order-detail-content').innerHTML = `<div class="detail-topline"><strong>${escapeHtml(order.id)}</strong><span class="status-pill ${statusClass(order.status)}">${escapeHtml(order.status || 'New')}</span></div>
      <div class="detail-customer"><div class="detail-info"><small>Placed on</small><strong>${escapeHtml(dateShort(order.createdAt))}</strong></div><div class="detail-info"><small>Payment method</small><strong>${escapeHtml(order.paymentMethod || 'Cash on Delivery')}</strong></div><div class="detail-info"><small>Customer</small><strong>${escapeHtml(customer.name || '')}</strong></div><div class="detail-info"><small>Phone</small><strong>${escapeHtml(customer.phone || '')}</strong></div>${customer.email ? `<div class="detail-info"><small>Email</small><strong>${escapeHtml(customer.email)}</strong></div>` : ''}</div>
      <label class="payment-status-control">Payment status<select id="detail-payment-status" data-order-id="${escapeHtml(order.id)}">${paymentOptions}</select></label>
      <div class="detail-items">${items.map(item => `<div class="detail-item"><img src="${escapeHtml(item.image || '/images/product-pan.jpg')}" alt=""><div><strong>${escapeHtml(item.name)}</strong><small>Qty ${Number(item.quantity)} × ${formatMoney(item.price)}</small></div><span>${formatMoney(Number(item.price) * Number(item.quantity))}</span></div>`).join('')}</div>
      <div class="detail-totals"><div><span>Subtotal</span><span>${formatMoney(order.subtotal)}</span></div>${Number(order.discount) ? `<div><span>Promo ${escapeHtml(order.discountCode || '')}</span><span>−${formatMoney(order.discount)}</span></div>` : ''}<div><span>Delivery</span><span>${Number(order.shipping) ? formatMoney(order.shipping) : 'On us'}</span></div><div><strong>Total due</strong><strong>${formatMoney(order.total)}</strong></div></div>
      <div class="detail-address"><strong>Deliver to</strong><p>${escapeHtml(customer.name || '')}<br>${fullAddress}<br>${escapeHtml(customer.phone || '')}</p></div>${customer.note ? `<p class="detail-note">Customer note: “${escapeHtml(customer.note)}”</p>` : ''}`;
    $('#detail-payment-status').addEventListener('change', event => updatePaymentStatus(order.id, event.target.value, event.target));
    openAdminModal('#order-detail-modal');
  }

  async function updatePaymentStatus(id, paymentStatus, select) {
    if (select) select.disabled = true;
    try {
      await api(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ paymentStatus }) });
      await refreshAll();
      const order = orders.find(item => item.id === id);
      if (order) openOrderDetails(order);
      showToast(`Payment for ${id} marked ${paymentStatus.toLowerCase()}.`);
    } catch (error) { showToast(error.message); }
    finally { if (select) select.disabled = false; }
  }

  async function updateOrderStatus(id, status, select) {
    if (status === 'Cancelled') {
      const order = orders.find(item => item.id === id);
      if (order && order.status !== 'Cancelled' && !window.confirm(`Cancel ${id}? The items will be returned to stock.`)) {
        if (select) select.value = order.status;
        return;
      }
    }
    if (select) select.disabled = true;
    try {
      await api(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await refreshAll();
      showToast(`Order ${id} updated to ${status}.`);
    } catch (error) {
      if (select) select.value = orders.find(item => item.id === id)?.status || 'New';
      showToast(error.message);
    } finally { if (select) select.disabled = false; }
  }

  async function saveSettingsForm(form, section, numericFields = []) {
    const button = $('button[type="submit"]', form);
    const original = button.innerHTML;
    const values = Object.fromEntries(new FormData(form).entries());
    for (const field of numericFields) values[field] = Number(values[field]);
    button.disabled = true; button.textContent = 'Saving…';
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ [section]: values }) });
      await refreshAll();
      showToast('Your website settings have been saved.');
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; button.innerHTML = original; }
  }
  function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read that image.'));
      reader.readAsDataURL(file);
    });
  }

  /* ----- Bulk product import (Admin → Products → Import Products) ----- */
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  function importRows() {
    if (importResult) return importResult.rows || [];
    return importPreview ? importPreview.rows || [] : [];
  }
  function setImportProgress(message) {
    const element = $('#import-progress');
    element.textContent = message;
    element.classList.remove('is-done');
    element.hidden = !message;
  }
  function resetImportModal() {
    importPayload = null; importPreview = null; importResult = null; importFilter = 'all'; importBusy = false;
    $('#product-import-file').value = '';
    $('#import-error').textContent = '';
    for (const selector of ['#import-file-card', '#import-summary', '#import-issues', '#import-table-card']) {
      const element = $(selector);
      element.hidden = true;
      if (selector !== '#import-table-card') element.innerHTML = '';
    }
    $('#import-rows-body').innerHTML = '';
    $('#import-empty').hidden = true;
    $('#import-filter').value = 'all';
    setImportProgress('');
    $('#import-upload-panel').hidden = false;
    $('#import-reset-button').hidden = true;
    $('#import-download-errors').hidden = true;
    const button = $('#import-confirm-button');
    button.disabled = true;
    button.innerHTML = 'Confirm Import <span>↗</span>';
  }
  function openImportModal() {
    resetImportModal();
    openAdminModal('#product-import-modal');
  }
  function fileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : '');
      };
      reader.onerror = () => reject(new Error('That file could not be read. Please try again.'));
      reader.readAsDataURL(file);
    });
  }
  function renderImportFileCard() {
    const card = $('#import-file-card');
    if (!importPreview) { card.hidden = true; return; }
    const file = importPreview.file;
    const columns = importPreview.columns || {};
    const parts = [
      `<span>File <b>${escapeHtml(file.name)}</b></span>`,
      `<span>Format <b>${escapeHtml(String(file.format).toUpperCase())}</b>${file.sheetName ? ` · sheet <b>${escapeHtml(file.sheetName)}</b>` : ''}</span>`,
      `<span>Size <b>${escapeHtml(formatBytes(file.sizeBytes))}</b></span>`,
      `<span>Product rows <b>${Number(file.rowCount) || 0}</b>${file.blankRows ? ` · ${Number(file.blankRows)} blank row${Number(file.blankRows) === 1 ? '' : 's'} ignored` : ''}</span>`,
      `<span>Header row <b>${Number(file.headerRowNumber) || 1}</b></span>`
    ];
    const missing = (columns.missingOptional || []).map(label => importFieldLabel(label));
    if (missing.length) parts.push(`<span>Not in your file <b>${escapeHtml(missing.join(', '))}</b> — existing values are kept</span>`);
    if ((columns.ignored || []).length) parts.push(`<span>Columns ignored <b>${escapeHtml(columns.ignored.slice(0, 8).join(', '))}</b>${columns.ignored.length > 8 ? ` and ${columns.ignored.length - 8} more` : ''}</span>`);
    card.innerHTML = parts.join('');
    card.hidden = false;
  }
  function renderImportSummary(mode) {
    const container = $('#import-summary');
    const summary = mode === 'result' ? importResult?.summary : importPreview?.summary;
    if (!summary) { container.hidden = true; return; }
    const stats = mode === 'result'
      ? [['New products', summary.created, 'is-new'], ['Updated products', summary.updated, 'is-update'], ['Skipped', summary.skipped, 'is-skip'], ['Errors', summary.errors, 'is-error'], ['Rows with warnings', summary.warnings, 'is-skip']]
      : [['Total rows', summary.total, ''], ['New products', summary.create, 'is-new'], ['Existing products to update', summary.update, 'is-update'], ['Skipped', summary.skip, 'is-skip'], ['Invalid rows', summary.error, 'is-error']];
    const heading = mode === 'result' ? 'Import completed' : 'Nothing has been imported yet';
    const note = mode === 'result'
      ? `Finished just now. Products missing from your file were left untouched.${summary.warnings ? ` ${summary.warnings} row${summary.warnings === 1 ? ' has' : 's have'} warnings.` : ''}`
      : 'Review the rows below, then press “Confirm Import” to write to your store.';
    container.innerHTML = `<h3>${heading}</h3><small>${escapeHtml(note)}</small><div class="import-stat-grid">${stats.map(([label, value, className]) => `<div class="import-stat ${className}"><span>${escapeHtml(label)}</span><strong>${Number(value) || 0}</strong></div>`).join('')}</div>`;
    container.hidden = false;
  }
  function renderImportIssues() {
    const container = $('#import-issues');
    const rows = importRows().filter(row => (row.errors || []).length || row.error || row.status === 'failed');
    if (!rows.length) { container.hidden = true; container.innerHTML = ''; return; }
    const shown = rows.slice(0, 40);
    container.innerHTML = `<strong>${rows.length} row${rows.length === 1 ? '' : 's'} need attention</strong>${shown.map(row => {
      const messages = [...(row.errors || []), row.error].filter(Boolean).join(' ');
      return `<div class="import-issue"><b>Row ${Number(row.rowNumber) || '—'}</b> · SKU ${escapeHtml(row.sku || 'not set')} — ${escapeHtml(messages)}</div>`;
    }).join('')}${rows.length > shown.length ? `<div class="import-issue">…and ${rows.length - shown.length} more. Download the rows for the full list.</div>` : ''}`;
    container.hidden = false;
  }
  function renderImportRows() {
    const all = importRows();
    const rows = all.filter(row => importFilter === 'all' || row.action === importFilter);
    const shown = rows.slice(0, 400);
    $('#import-rows-body').innerHTML = shown.map(row => {
      const badge = importResult ? (IMPORT_STATUS_LABELS[row.status] || row.action) : row.action;
      const badgeClass = row.status === 'failed' ? 'is-error' : row.status === 'error' ? 'is-error' : row.action === 'NEW' || row.status === 'created' ? 'is-new' : row.action === 'UPDATE' || row.status === 'updated' ? 'is-update' : 'is-skip';
      const note = row.error || row.skipReason || (row.action === 'ERROR' ? (row.errors || []).join(' ') : '');
      const warnings = (row.warnings || []).length ? `<span class="import-row-flag" title="${escapeHtml(row.warnings.join(' '))}">⚠</span>` : '';
      return `<tr><td>${Number(row.rowNumber) || '—'}</td><td>${escapeHtml(row.sku || '—')}</td><td>${escapeHtml(row.name || '—')}${warnings}</td><td>${escapeHtml(row.category || '—')}</td><td>${row.mrpProvided && row.mrp != null ? formatMoney(row.mrp) : '—'}</td><td>${row.sellingPrice != null ? formatMoney(row.sellingPrice) : '—'}</td><td>${row.stock != null ? Number(row.stock) : '—'}</td><td><span class="import-badge ${badgeClass}">${escapeHtml(badge)}</span>${note ? `<span class="import-row-note">${escapeHtml(note)}</span>` : ''}</td></tr>`;
    }).join('');
    $('#import-empty').hidden = rows.length > 0;
    const note = rows.length > shown.length
      ? `Showing the first ${shown.length} of ${rows.length} rows. Download the rows for the full list.`
      : `${rows.length} of ${all.length} row${all.length === 1 ? '' : 's'} shown.`;
    $('#import-preview-note').textContent = note;
  }
  function downloadImportRows() {
    const rows = importRows();
    if (!rows.length) return;
    const report = [['Row', 'SKU', 'Product name', 'Category', 'MRP', 'Selling price', 'Stock', 'Action', 'Result', 'Errors', 'Warnings'],
      ...rows.map(row => [
        row.rowNumber,
        row.sku,
        row.name,
        row.category,
        row.mrpProvided && row.mrp != null ? row.mrp : '',
        row.sellingPrice ?? '',
        row.stock ?? '',
        row.action,
        row.status || '',
        [...(row.errors || []), row.error, row.skipReason].filter(Boolean).join(' '),
        (row.warnings || []).join(' ')
      ])];
    downloadCsv(importResult ? 'markettech-import-results.csv' : 'markettech-import-preview.csv', report);
  }
  async function handleImportFile(file) {
    if (!file) return;
    const errorBox = $('#import-error');
    errorBox.textContent = '';
    const name = String(file.name || '');
    const extension = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    const xlsMessage = 'Old .xls workbooks are not supported. Open the file in Excel, choose “Save as” → .xlsx or .csv, then upload it again.';
    if (extension === '.xls') { errorBox.textContent = xlsMessage; return; }
    if (!['.xlsx', '.csv'].includes(extension)) { errorBox.textContent = 'Please choose an .xlsx or .csv file exported from your product spreadsheet.'; return; }
    if (!file.size) { errorBox.textContent = 'That file is empty.'; return; }
    if (file.size > IMPORT_MAX_BYTES) { errorBox.textContent = `That file is ${formatBytes(file.size)}. The importer accepts files up to 4 MB.`; return; }
    const signature = [...new Uint8Array(await file.slice(0, 4).arrayBuffer())].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (signature.startsWith('d0cf11e0')) { errorBox.textContent = xlsMessage; return; }
    if (extension === '.xlsx' && !signature.startsWith('504b0304')) { errorBox.textContent = 'That file does not look like a real .xlsx workbook. Save it again from Excel as .xlsx and try once more.'; return; }
    resetImportModal();
    const input = $('#product-import-file');
    const confirmButton = $('#import-confirm-button');
    confirmButton.disabled = true;
    setImportProgress('Reading the file and checking every row…');
    try {
      importPayload = { filename: name, data: await fileAsBase64(file) };
      const response = await api('/api/admin/products/import/preview', { method: 'POST', body: JSON.stringify(importPayload) });
      importPreview = response.preview;
      importResult = null;
      $('#import-upload-panel').hidden = true;
      $('#import-reset-button').hidden = false;
      renderImportFileCard(); renderImportSummary('preview'); renderImportIssues(); renderImportRows();
      $('#import-table-card').hidden = false;
      const importable = Number(importPreview.summary.create) + Number(importPreview.summary.update);
      confirmButton.disabled = importable === 0;
      $('#import-download-errors').hidden = !(importPreview.summary.error + importPreview.summary.skip);
      setImportProgress('');
      if (!importable) errorBox.textContent = 'There are no valid new or updated rows to import. Fix the errors listed above and upload the file again.';
    } catch (error) {
      importPayload = null;
      importPreview = null;
      setImportProgress('');
      errorBox.textContent = error.message;
    } finally {
      input.value = '';
    }
  }
  async function confirmImport() {
    if (!importPayload || !importPreview || importBusy) return;
    const importable = Number(importPreview.summary.create) + Number(importPreview.summary.update);
    if (!importable) return;
    importBusy = true;
    const button = $('#import-confirm-button');
    button.disabled = true;
    button.innerHTML = 'Importing… <span>✳</span>';
    $('#import-error').textContent = '';
    setImportProgress(`Writing ${importable} product${importable === 1 ? '' : 's'} to Cloudflare D1…`);
    try {
      const response = await api('/api/admin/products/import', { method: 'POST', body: JSON.stringify(importPayload) });
      importResult = response.result;
      renderImportSummary('result');
      renderImportIssues();
      renderImportRows();
      renderImportFileCard();
      $('#import-download-errors').hidden = false;
      setImportProgress(`Import completed — ${importResult.summary.created} new, ${importResult.summary.updated} updated, ${importResult.summary.skipped} skipped, ${importResult.summary.errors} error${importResult.summary.errors === 1 ? '' : 's'}.`);
      $('#import-progress').classList.add('is-done');
      button.innerHTML = 'Imported <span>✓</span>';
      showToast(`Import completed — ${importResult.summary.created} new and ${importResult.summary.updated} updated product${importResult.summary.created + importResult.summary.updated === 1 ? '' : 's'}.`);
      await refreshAll();
      renderImportRows();
    } catch (error) {
      $('#import-error').textContent = error.message;
      setImportProgress('');
      button.disabled = false;
      button.innerHTML = 'Confirm Import <span>↗</span>';
    } finally {
      importBusy = false;
    }
  }
  $('#products-import-button').addEventListener('click', openImportModal);
  $('#product-import-file').addEventListener('change', event => handleImportFile(event.target.files?.[0]));
  $('#import-filter').addEventListener('change', event => { importFilter = event.target.value; renderImportRows(); });
  $('#import-confirm-button').addEventListener('click', confirmImport);
  $('#import-reset-button').addEventListener('click', resetImportModal);
  $('#import-download-errors').addEventListener('click', downloadImportRows);

  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('.login-submit', event.currentTarget);
    const original = button.innerHTML;
    $('#login-error').textContent = '';
    button.disabled = true; button.innerHTML = '<span>Signing in…</span><span>✳</span>';
    try {
      const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }) });
      if (result.previewToken) {
        previewToken = result.previewToken;
        try { sessionStorage.setItem('mt-admin-preview-token', previewToken); } catch { /* cookie auth remains available */ }
      }
      await showAdmin(result.email);
    } catch (error) { $('#login-error').textContent = error.message; }
    finally { button.disabled = false; button.innerHTML = original; }
  });
  $('#logout-button').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch { /* local sign-out still continues */ }
    previewToken = '';
    try { sessionStorage.removeItem('mt-admin-preview-token'); } catch { /* storage may be disabled */ }
    $('#login-form').reset();
    showLogin();
  });

  $$('.admin-nav-item[data-page]').forEach(button => button.addEventListener('click', () => openPage(button.dataset.page)));
  document.addEventListener('click', event => {
    const pageLink = event.target.closest('[data-page-link]');
    if (pageLink) { event.preventDefault(); openPage(pageLink.dataset.pageLink); }
  });
  $('#overview-add-product').addEventListener('click', () => openProductEditor());
  $('#products-add-button').addEventListener('click', () => openProductEditor());
  $('#product-search').addEventListener('input', renderProducts);
  $('#inventory-search').addEventListener('input', renderInventory);
  $('#export-products').addEventListener('click', () => downloadCsv('markettech-inventory.csv', [['Product', 'SKU', 'Category', 'Price INR', 'Stock', 'Status'], ...products.map(product => [product.name, product.sku || product.id, product.category, product.price, product.stock, Number(product.stock) > 0 ? 'Active' : 'Out of stock'])]));
  $('#inventory-rows').addEventListener('click', async event => {
    const button = event.target.closest('[data-action="save-stock"]');
    if (!button) return;
    const row = button.closest('[data-product-id]');
    const product = products.find(item => item.id === row?.dataset.productId);
    const stock = Number($('.inventory-stock-input', row)?.value);
    if (!product || !Number.isInteger(stock) || stock < 0) return showToast('Enter a whole number of zero or more.');
    button.disabled = true;
    try {
      await api(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: 'PATCH', body: JSON.stringify({ ...product, stock }) });
      await refreshAll(); showToast(`Stock updated for ${product.name}.`);
    } catch (error) { showToast(error.message); button.disabled = false; }
  });
  $('#site-settings-form').addEventListener('submit', event => { event.preventDefault(); saveSettingsForm(event.currentTarget, 'site'); });
  $('#operations-settings-form').addEventListener('submit', event => { event.preventDefault(); saveSettingsForm(event.currentTarget, 'site', ['shippingFee', 'freeShippingAt', 'lowStockThreshold']); });
  $('#policies-form').addEventListener('submit', event => { event.preventDefault(); saveSettingsForm(event.currentTarget, 'policies'); });
  $('#marketing-settings-form').addEventListener('submit', event => { event.preventDefault(); saveSettingsForm(event.currentTarget, 'marketing', ['discountPercent']); });
  $('#refresh-integrations').addEventListener('click', refreshAll);
  $('#export-subscribers').addEventListener('click', async () => {
    try {
      const subscribers = await api('/api/admin/subscribers');
      downloadCsv('markettech-subscribers.csv', [['Email'], ...subscribers.map(email => [email])]);
      showToast(`${subscribers.length} subscriber${subscribers.length === 1 ? '' : 's'} exported.`);
    } catch (error) { showToast(error.message); }
  });
  $('#copy-env-snippet').addEventListener('click', async () => {
    const snippet = 'RAZORPAY_KEY_ID=rzp_test_your_key_id\\nRAZORPAY_KEY_SECRET=your_secret\\nRAZORPAY_MODE=test';
    try { await navigator.clipboard.writeText(snippet); showToast('Razorpay setup snippet copied.'); }
    catch { showToast('Copy these keys from the setup box into your server environment.'); }
  });
  $('#product-image-path').addEventListener('input', event => {
    const image = event.target.value.trim();
    if (!image.startsWith('/')) return;
    $('#product-image-preview').src = image;
    productGalleryImages = [image, ...productGalleryImages.filter(value => value !== image)].slice(0, 8);
    renderProductGalleryEditor();
  });
  $('#product-image-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      $('#product-form-error').textContent = 'Choose a JPG, PNG or WebP image under 5 MB.'; event.target.value = ''; return;
    }
    $('#product-form-error').textContent = '';
    try {
      const dataUrl = await fileAsDataUrl(file);
      const result = await api('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ dataUrl }) });
      $('#product-image-path').value = result.url;
      $('#product-image-preview').src = result.url;
      productGalleryImages = [result.url, ...productGalleryImages.filter(value => value !== result.url)].slice(0, 8);
      renderProductGalleryEditor();
      showToast('Cover photo uploaded. Save the product to publish it.');
    } catch (error) { $('#product-form-error').textContent = error.message; }
    finally { event.target.value = ''; }
  });
  $('#product-gallery-files').addEventListener('change', async event => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (productGalleryImages.length + files.length > 8) {
      $('#product-form-error').textContent = 'A product can have up to 8 photos total. Remove a photo or choose fewer files.'; event.target.value = ''; return;
    }
    if (files.some(file => !allowed.includes(file.type) || file.size > 5 * 1024 * 1024)) {
      $('#product-form-error').textContent = 'Each photo must be JPG, PNG or WebP and under 5 MB.'; event.target.value = ''; return;
    }
    const input = event.target;
    input.disabled = true;
    $('#product-form-error').textContent = '';
    try {
      for (let index = 0; index < files.length; index++) {
        const dataUrl = await fileAsDataUrl(files[index]);
        const result = await api('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ dataUrl }) });
        productGalleryImages.push(result.url);
        renderProductGalleryEditor();
        $('#product-gallery-status').textContent = `Uploaded ${index + 1} of ${files.length} photos…`;
      }
      showToast(`${files.length} photo${files.length === 1 ? '' : 's'} uploaded. Save the product to publish.`);
    } catch (error) { $('#product-form-error').textContent = error.message; }
    finally { input.disabled = false; input.value = ''; $('#product-gallery-status').textContent = ''; }
  });
  $('#product-gallery-admin').addEventListener('click', event => {
    const makeCover = event.target.closest('[data-gallery-cover]');
    const remove = event.target.closest('[data-gallery-remove]');
    if (makeCover) {
      const index = Number(makeCover.dataset.galleryCover);
      if (index > 0 && productGalleryImages[index]) {
        const [image] = productGalleryImages.splice(index, 1);
        productGalleryImages.unshift(image);
        $('#product-image-path').value = image;
        $('#product-image-preview').src = image;
        renderProductGalleryEditor();
      }
    } else if (remove) {
      const index = Number(remove.dataset.galleryRemove);
      if (index > 0) { productGalleryImages.splice(index, 1); renderProductGalleryEditor(); }
    }
  });
  $('#upi-qr-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      showToast('Choose a JPG, PNG or WebP QR image under 5 MB.'); event.target.value = ''; return;
    }
    try {
      const dataUrl = await fileAsDataUrl(file);
      const result = await api('/api/admin/uploads', { method: 'POST', body: JSON.stringify({ dataUrl }) });
      $('#upi-qr-path').value = result.url;
      $('#upi-qr-preview').src = result.url;
      $('#upi-qr-preview').hidden = false;
      showToast('UPI QR uploaded. Save contact & operations to publish it.');
    } catch (error) { showToast(error.message); }
  });
  $('#order-search').addEventListener('input', renderOrders);
  $('#order-status-filter').addEventListener('change', renderOrders);
  $('#refresh-orders').addEventListener('click', refreshAll);
  $('#customer-search').addEventListener('input', renderCustomers);
  $('#refresh-customers').addEventListener('click', refreshAll);
  $('#sidebar-toggle').addEventListener('click', () => $('#admin-sidebar').classList.toggle('mobile-open'));
  document.addEventListener('click', event => {
    if (window.innerWidth <= 760 && $('#admin-sidebar').classList.contains('mobile-open') && !event.target.closest('#admin-sidebar, #sidebar-toggle')) $('#admin-sidebar').classList.remove('mobile-open');
  });

  $('#product-rows').addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = button.closest('[data-product-id]');
    const product = products.find(item => item.id === row?.dataset.productId);
    if (button.dataset.action === 'edit-product' && product) openProductEditor(product);
    if (button.dataset.action === 'delete-product' && product) {
      if (!window.confirm(`Remove “${product.name}” from your collection?`)) return;
      button.disabled = true;
      try {
        await api(`/api/admin/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
        await refreshAll(); showToast(`${product.name} removed from your collection.`);
      } catch (error) { showToast(error.message); button.disabled = false; }
    }
  });
  $('#product-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.namedItem('id').value;
    const product = Object.fromEntries(new FormData(form).entries());
    try { product.images = JSON.parse(product.images || '[]'); }
    catch { product.images = []; }
    product.price = Number(product.price);
    product.compareAt = product.compareAt === '' ? null : Number(product.compareAt);
    product.stock = Number(product.stock);
    product.featured = form.elements.namedItem('featured').checked;
    const button = $('#save-product-button');
    const original = button.innerHTML;
    $('#product-form-error').textContent = '';
    button.disabled = true; button.textContent = 'Saving…';
    try {
      if (id) await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(product) });
      else await api('/api/admin/products', { method: 'POST', body: JSON.stringify(product) });
      closeAdminModals();
      await refreshAll();
      showToast(id ? 'Your product has been updated.' : 'A new piece has joined the collection.');
    } catch (error) { $('#product-form-error').textContent = error.message; }
    finally { button.disabled = false; button.innerHTML = original; }
  });

  document.addEventListener('click', event => {
    const view = event.target.closest('[data-action="view-order"]');
    if (view) {
      const order = orders.find(item => item.id === view.closest('[data-order-id]')?.dataset.orderId);
      openOrderDetails(order);
    }
  });
  $('#order-rows').addEventListener('change', event => {
    const select = event.target.closest('[data-status-select]');
    if (select) updateOrderStatus(select.closest('[data-order-id]').dataset.orderId, select.value, select);
  });
  $$('[data-close-admin-modal]').forEach(button => button.addEventListener('click', closeAdminModals));
  $('#admin-modal-backdrop').addEventListener('click', closeAdminModals);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAdminModals(); });

  $$('[data-year]').forEach(element => { element.textContent = new Date().getFullYear(); });
  async function boot() {
    try {
      const config = await api('/api/config');
      $('#demo-note').hidden = !config.demoAdmin;
      const me = await api('/api/admin/me');
      await showAdmin(me.email);
    } catch { showLogin(); }
  }
  boot();
})();

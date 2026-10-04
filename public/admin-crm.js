(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0});
  let crmCustomers=[], coupons=[], offers=[], initialized=false;

  async function api(path, options={}) {
    const res=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||'Something went wrong.');
    return data;
  }
  function toast(message){const el=$('#admin-toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(window.__crmToast);window.__crmToast=setTimeout(()=>el.classList.remove('show'),2800);}
  function iso(v){return v?new Date(v).toISOString():'';}
  function date(v){if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);}
  function segment(c){if(c.segment&&c.segment!=='General')return c.segment;if(Number(c.spend||0)>=5000)return 'VIP';if(Number(c.orders||0)>=2)return 'Repeat';if(!c.lastOrder)return 'New';return (Date.now()-new Date(c.lastOrder).getTime())/86400000>45?'At risk':'General';}

  async function loadCRM(){try{crmCustomers=await api('/api/admin/crm/segments');renderCRM();}catch(e){toast(e.message);}}
  function renderCRM(){
    const q=($('#crm-search')?.value||'').toLowerCase().trim(), f=$('#crm-segment-filter')?.value||'all';
    const list=crmCustomers.filter(c=>{const s=segment(c),h=(c.name+' '+c.email+' '+c.phone+' '+(c.tags||[]).join(' ')).toLowerCase();return(!q||h.includes(q))&&(f==='all'||s===f);});
    $('#crm-total-customers').textContent=crmCustomers.length;
    $('#crm-vip-customers').textContent=crmCustomers.filter(c=>segment(c)==='VIP').length;
    $('#crm-repeat-customers').textContent=crmCustomers.filter(c=>segment(c)==='Repeat').length;
    $('#crm-risk-customers').textContent=crmCustomers.filter(c=>segment(c)==='At risk').length;
    $('#crm-customer-rows').innerHTML=list.map(c=>{
      const tags=(c.tags||[]).slice(0,3).map(t=>'<span class="crm-tag">'+esc(t)+'</span>').join('');
      return '<tr><td><strong>'+esc(c.name)+'</strong><small>'+esc(c.email||'')+'</small></td><td><span class="crm-segment">'+esc(segment(c))+'</span></td><td>'+Number(c.orders||0)+'</td><td><strong>'+money.format(Number(c.spend||0))+'</strong></td><td>'+(c.lastOrder?date(c.lastOrder):'—')+'</td><td><div class="crm-tags">'+tags+'</div></td><td><button class="table-action-button" type="button" data-crm-open="'+esc(c.id)+'">Open</button></td></tr>';
    }).join('');
    $('#crm-empty').hidden=list.length>0;
  }

  async function openCustomer(id){
    try{
      const data=await api('/api/admin/crm/customers/'+encodeURIComponent(id)), c=data.customer, m=data.meta||{tags:[],segment:'General',note:''};
      const back=document.createElement('div');back.className='crm-drawer-backdrop';back.id='crm-drawer-backdrop';
      const drawer=document.createElement('aside');drawer.className='crm-drawer';drawer.id='crm-drawer';
      const spend=(data.orders||[]).filter(o=>o.status!=='Cancelled').reduce((s,o)=>s+Number(o.total||0),0);
      let notes=(data.notes||[]).map(n=>'<div class="crm-note-item">'+esc(n.body)+'<small>'+date(n.created_at||n.createdAt)+'</small></div>').join('');
      let orders=(data.orders||[]).map(o=>'<div class="crm-order-item"><div><strong>'+esc(o.id)+'</strong><small>'+date(o.createdAt)+'</small></div><div><strong>'+money.format(o.total)+'</strong><small>'+esc(o.status)+'</small></div></div>').join('');
      drawer.innerHTML='<button class="crm-drawer-close" id="crm-drawer-close">×</button><div class="crm-profile-head"><div class="admin-eyebrow">CUSTOMER PROFILE</div><h2>'+esc(c.name)+'</h2><div class="crm-profile-email">'+esc(c.email||'')+' · '+esc(c.phone||'No phone')+'</div></div><div class="crm-detail-grid"><div class="crm-detail-stat"><small>Orders</small><strong>'+data.orders.length+'</strong></div><div class="crm-detail-stat"><small>Lifetime spend</small><strong>'+money.format(spend)+'</strong></div><div class="crm-detail-stat"><small>Joined</small><strong>'+date(c.createdAt)+'</strong></div></div><section class="crm-drawer-section"><h3>Relationship profile</h3><form class="crm-meta-form" id="crm-meta-form"><label>Segment<select name="segment"><option>General</option><option>VIP</option><option>Repeat</option><option>New</option><option>At risk</option></select></label><label>Tags<input name="tags" value="'+esc((m.tags||[]).join(', '))+'" placeholder="VIP, Kitchen, COD"></label><label class="full">Profile note<input name="note" value="'+esc(m.note||'')+'" placeholder="Important customer context"></label><div class="full"><button class="admin-button admin-button-dark" type="submit">Save relationship ↗</button></div></form></section><section class="crm-drawer-section"><h3>Internal notes</h3><form class="crm-note-form" id="crm-note-form"><textarea name="body" maxlength="2000" placeholder="Add a private note about this customer…"></textarea><button class="admin-button admin-button-light" type="submit">Add note</button></form><div id="crm-notes-list">'+(notes||'<small>No internal notes yet.</small>')+'</div></section><section class="crm-drawer-section"><h3>Order timeline</h3>'+(orders||'<small>No orders yet.</small>')+'</section>';
      document.body.append(back,drawer);
      $('#crm-meta-form').elements.segment.value=m.segment||'General';
      const close=()=>{$('#crm-drawer-backdrop')?.remove();$('#crm-drawer')?.remove();};
      $('#crm-drawer-close').onclick=close;back.onclick=close;
      $('#crm-meta-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{await api('/api/admin/crm/customers/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({segment:f.elements.segment.value,tags:f.elements.tags.value.split(',').map(x=>x.trim()).filter(Boolean),note:f.elements.note.value})});toast('Customer profile saved.');close();loadCRM();}catch(err){toast(err.message);}};
      $('#crm-note-form').onsubmit=async e=>{e.preventDefault();const body=e.currentTarget.elements.body.value.trim();if(!body)return;try{await api('/api/admin/crm/notes',{method:'POST',body:JSON.stringify({customerId:id,body:body})});e.currentTarget.reset();const d=await api('/api/admin/crm/customers/'+encodeURIComponent(id));$('#crm-notes-list').innerHTML=d.notes.map(n=>'<div class="crm-note-item">'+esc(n.body)+'<small>'+date(n.created_at||n.createdAt)+'</small></div>').join('');toast('Private note added.');}catch(err){toast(err.message);}};
    }catch(e){toast(e.message);}
  }

  async function loadMarketing(){try{[coupons,offers]=await Promise.all([api('/api/admin/coupons'),api('/api/admin/offers')]);renderCoupons();renderOffers();}catch(e){toast(e.message);}}
  function couponStatus(c){const now=Date.now(),s=new Date(c.startsAt).getTime(),e=c.endsAt?new Date(c.endsAt).getTime():Infinity;if(!c.active)return['Paused','paused'];if(s>now)return['Scheduled','scheduled'];if(e<now)return['Expired','expired'];if(c.usageLimit&&c.usedCount>=c.usageLimit)return['Used up','expired'];return['Live','live'];}
  function renderCoupons(){
    const el=$('#coupon-rows');if(!el)return;
    el.innerHTML=coupons.map(c=>{const x=couponStatus(c);return '<tr><td><strong class="coupon-code">'+esc(c.code)+'</strong></td><td>'+(c.discountType==='percent'?c.discountValue+'%':money.format(c.discountValue))+'</td><td>'+(c.scopeType==='all'?'Store':esc(c.scopeType)+': '+esc(c.scopeValue))+' · Min '+money.format(c.minOrder)+'</td><td><small>'+date(c.startsAt)+(c.endsAt?'<br>→ '+date(c.endsAt):'')+'</small></td><td>'+c.usedCount+(c.usageLimit?' / '+c.usageLimit:' / ∞')+'</td><td><span class="offer-status '+x[1]+'">'+x[0]+'</span></td><td><button type="button" class="table-action-button" data-coupon-toggle="'+esc(c.id)+'">'+(c.active?'Pause':'Enable')+'</button> <button type="button" class="table-action-button delete-action" data-coupon-delete="'+esc(c.id)+'">Delete</button></td></tr>';}).join('');
  }
  function renderOffers(){
    const el=$('#offer-timeline');if(!el)return;
    const list=[...offers].sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt));
    el.innerHTML=list.length?list.map(o=>{const now=Date.now(),s=new Date(o.startsAt).getTime(),e=new Date(o.endsAt).getTime(),cl=!o.active||e<now?'expired':s>now?'scheduled':'',st=!o.active?'Paused':e<now?'Expired':s>now?'Scheduled':'Live';return '<div class="offer-timeline-item"><div class="offer-date">'+date(o.startsAt)+'<br>→ '+date(o.endsAt)+'</div><div><div class="offer-title">'+esc(o.name)+'</div><div class="offer-meta">'+(o.scopeType==='all'?'Entire store':esc(o.scopeType)+' · '+esc(o.scopeValue))+(o.banner?' · '+esc(o.banner):'')+'</div></div><div><div class="offer-discount">'+(o.type==='percent'?o.value+'%':money.format(o.value))+'</div><span class="offer-status '+cl+'">'+st+'</span><br><button class="table-action-button" data-offer-toggle="'+esc(o.id)+'">'+(o.active?'Pause':'Enable')+'</button> <button class="table-action-button delete-action" data-offer-delete="'+esc(o.id)+'">Delete</button></div></div>';}).join(''):'<div class="admin-empty"><span>✦</span><strong>No offers scheduled</strong><small>Create your first timed product or category promotion.</small></div>';
  }

  async function loadDeveloper(){try{const s=await api('/api/admin/settings'),d=s.developer||{textOverrides:{}},t=d.textOverrides||{};const f=$('#developer-text-fields');if(f)$$('[name]',f).forEach(el=>el.value=t[el.name]||'');$('#developer-json').value=JSON.stringify(d,null,2);}catch(e){toast(e.message);}}
  const formObject=f=>Object.fromEntries(new FormData(f).entries());

  function bind(){
    if(initialized)return;initialized=true;
    $('#crm-search')?.addEventListener('input',renderCRM);$('#crm-segment-filter')?.addEventListener('change',renderCRM);$('#crm-refresh')?.addEventListener('click',loadCRM);
    $('#crm-customer-rows')?.addEventListener('click',e=>{const b=e.target.closest('[data-crm-open]');if(b)openCustomer(b.dataset.crmOpen);});
    $('#coupon-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,v=formObject(f);v.discountValue=Number(v.discountValue);v.minOrder=Number(v.minOrder);v.maxDiscount=Number(v.maxDiscount);v.usageLimit=Number(v.usageLimit);v.perCustomerLimit=Number(v.perCustomerLimit);v.startsAt=iso(v.startsAt);v.endsAt=iso(v.endsAt);v.active=f.elements.active.checked;try{await api('/api/admin/coupons',{method:'POST',body:JSON.stringify(v)});f.reset();f.elements.active.checked=true;await loadMarketing();toast('Coupon created.');}catch(err){toast(err.message);}});
    $('#offer-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,v=formObject(f);v.value=Number(v.value);v.startsAt=iso(v.startsAt);v.endsAt=iso(v.endsAt);v.active=f.elements.active.checked;try{await api('/api/admin/offers',{method:'POST',body:JSON.stringify(v)});f.reset();f.elements.active.checked=true;await loadMarketing();toast('Offer scheduled.');}catch(err){toast(err.message);}});
    $('#coupon-rows')?.addEventListener('click',async e=>{const t=e.target.closest('[data-coupon-toggle]'),d=e.target.closest('[data-coupon-delete]');try{if(t){const x=coupons.find(c=>c.id===t.dataset.couponToggle);await api('/api/admin/coupons/'+encodeURIComponent(x.id),{method:'PATCH',body:JSON.stringify({...x,active:!x.active})});await loadMarketing();toast('Coupon status updated.');}if(d&&confirm('Delete this coupon?')){await api('/api/admin/coupons/'+encodeURIComponent(d.dataset.couponDelete),{method:'DELETE'});await loadMarketing();toast('Coupon deleted.');}}catch(err){toast(err.message);}});
    $('#offer-timeline')?.addEventListener('click',async e=>{const t=e.target.closest('[data-offer-toggle]'),d=e.target.closest('[data-offer-delete]');try{if(t){const x=offers.find(o=>o.id===t.dataset.offerToggle);await api('/api/admin/offers/'+encodeURIComponent(x.id),{method:'PATCH',body:JSON.stringify({...x,active:!x.active})});await loadMarketing();toast('Offer status updated.');}if(d&&confirm('Delete this offer?')){await api('/api/admin/offers/'+encodeURIComponent(d.dataset.offerDelete),{method:'DELETE'});await loadMarketing();toast('Offer deleted.');}}catch(err){toast(err.message);}});
    $('#save-developer-text')?.addEventListener('click',async()=>{const o=formObject($('#developer-text-fields'));try{await api('/api/admin/settings',{method:'PUT',body:JSON.stringify({developer:{textOverrides:o}})});toast('Developer text overrides saved.');}catch(e){toast(e.message);}});
    $('#save-developer-json')?.addEventListener('click',async()=>{try{const v=JSON.parse($('#developer-json').value);if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Developer JSON must be an object.');await api('/api/admin/settings',{method:'PUT',body:JSON.stringify({developer:v})});await loadDeveloper();toast('Developer configuration saved.');}catch(e){toast(e.message);}});
    document.addEventListener('click',e=>{const n=e.target.closest('.admin-nav-item[data-page]');if(n)setTimeout(()=>{if(n.dataset.page==='crm')loadCRM();if(n.dataset.page==='marketing')loadMarketing();if(n.dataset.page==='developer')loadDeveloper();},100);});
  }
  function start(){if(!$('#admin-layout'))return;if($('#admin-layout').hidden){setTimeout(start,600);return;}bind();loadCRM();loadMarketing();loadDeveloper();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
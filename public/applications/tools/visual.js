/* Visual tools: crop, organize pages, sign, redact. Each export has { custom: true, mount(root) }. */
import { h, lib, UserError, Job, Cancelled, statusLine, dropZone, ACCEPT, readBytes, openPdfLib, openPdfJs, renderPage, canvasBlob, parseRanges, baseName, downloadBlob, fmtSize } from "/applications/core.js";
import { createStage } from "/applications/stage.js";
import { visualMapper } from "/applications/tools/pages.js";

const specs = {};
const RENDER_SCALE = 1.4;

/* ---------- shared pieces ---------- */
function pickPdf(root, { title = "1. Add a PDF", onLoad, onReset }) {
  const status = statusLine();
  const info = h("p", { class: "tk-note" });
  const zone = dropZone({
    id: "tk-pick-" + Math.random().toString(36).slice(2), accept: ACCEPT.pdf, multiple: false, text: "Drop a PDF here or click to choose",
    onFiles: async files => {
      const file = files.find(ACCEPT.pdf.test);
      if (!file) { status.set("That is not a PDF file.", "error"); return; }
      status.set("Opening " + file.name + "…");
      try {
        const bytes = await readBytes(file), pdf = await openPdfJs(bytes, file.name);
        info.textContent = file.name + " · " + fmtSize(file.size) + " · " + pdf.numPages + (pdf.numPages === 1 ? " page" : " pages");
        status.set("");
        await onLoad({ file, bytes, pdf });
      } catch (e) { status.set(e.message, "error"); }
    }
  });
  const panel = h("section", { class: "tk-panel" }, h("h2", {}, title), zone, info, status);
  root.append(panel);
  return { panel, status, info, reset() { info.textContent = ""; status.set(""); if (onReset) onReset(); } };
}

function pageNav(onGo) {
  let page = 1, total = 1;
  const label = h("span", { class: "tk-pagelabel", "aria-live": "polite" });
  const prev = h("button", { class: "tk-btn", type: "button", onclick: () => go(page - 1) }, "← Previous");
  const next = h("button", { class: "tk-btn", type: "button", onclick: () => go(page + 1) }, "Next →");
  const jump = h("input", { type: "number", min: 1, value: 1, "aria-label": "Go to page", class: "tk-jump" });
  jump.addEventListener("change", () => go(Number(jump.value)));
  function go(n) { n = Math.max(1, Math.min(total, Math.round(n) || 1)); if (n === page && label.textContent) { jump.value = n; return; } page = n; update(); onGo(n); }
  function update() { label.textContent = "Page " + page + " of " + total; jump.value = page; jump.max = total; prev.disabled = page <= 1; next.disabled = page >= total; }
  const el = h("div", { class: "tk-row tk-nav" }, prev, label, next, h("label", { class: "tk-inline" }, "Go to", jump));
  return { el, set(p, t) { page = p; total = t; update(); }, get page() { return page; } };
}

async function pageToStage(stage, pdf, n) {
  const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 });
  const canvas = await renderPage(pdf, n, { scale: RENDER_SCALE });
  stage.show(canvas, vp.width, vp.height);
  return { w: vp.width, h: vp.height };
}

function outputPanel(root) {
  const box = h("section", { class: "tk-panel tk-results", hidden: true, "aria-live": "polite" });
  root.append(box);
  return {
    show(name, data, note) {
      const blob = new Blob([data], { type: "application/pdf" });
      box.replaceChildren(h("h2", {}, "Result"), note ? h("p", { class: "tk-note" }, note) : null,
        h("ul", { class: "tk-outputs" }, h("li", {}, h("span", { class: "tk-file-name" }, name), h("small", {}, fmtSize(blob.size)), h("button", { class: "tk-btn primary", type: "button", onclick: () => downloadBlob(blob, name) }, "Download"))));
      box.hidden = false;
    },
    hide() { box.hidden = true; }
  };
}

/* Converts a rectangle on the displayed page (top-left origin, points) into user-space bounds. */
function userBox(vm, r) {
  const a = vm.map(r.x, vm.vh - r.y - r.h), b = vm.map(r.x + r.w, vm.vh - r.y);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function runButton(label, onRun) {
  const status = statusLine(), progress = h("progress", { class: "tk-progress", max: 100, value: 0, hidden: true });
  const btn = h("button", { class: "tk-btn primary", type: "button", disabled: true }, label);
  const cancel = h("button", { class: "tk-btn", type: "button", hidden: true }, "Cancel");
  let job = null;
  btn.addEventListener("click", async () => {
    if (job) return;
    job = new Job((v, m) => { progress.value = v; if (m) status.set(m); });
    btn.disabled = true; cancel.hidden = false; progress.hidden = false; progress.value = 0; status.set("Working…");
    try { await onRun(job, status); status.set("Done. Your file never left this device.", "ok"); progress.value = 100; }
    catch (e) { if (e instanceof Cancelled) status.set("Cancelled."); else { console.error(e); status.set(e instanceof UserError ? e.message : "Something went wrong: " + (e && e.message || e), "error"); } }
    finally { job = null; btn.disabled = false; cancel.hidden = true; }
  });
  cancel.addEventListener("click", () => job && job.cancel());
  return { btn, status, progress, cancel, row: h("div", { class: "tk-row" }, btn, cancel) };
}

/* =====================================================================
   Crop PDF
   ===================================================================== */
specs["crop-pdf"] = {
  custom: true,
  mount(root) {
    const st = { pdf: null, bytes: null, file: null, rects: new Map(), page: 1 };
    const stage = createStage({ label: "Crop area" });
    const nav = pageNav(async n => { st.page = n; await pageToStage(stage, st.pdf, n); stage.setRects(st.rects.has(n) ? [st.rects.get(n)] : []); refreshNote(); });
    const note = h("p", { class: "tk-note" });
    const apply = h("select", { id: "crop-apply" }, [["all", "Every page (same area)"], ["current", "This page only"], ["range", "Pages in a range"]].map(([v, l]) => h("option", { value: v }, l)));
    const rangeIn = h("input", { type: "text", id: "crop-range", value: "1-3", hidden: true, "aria-label": "Page range" });
    apply.addEventListener("change", () => { rangeIn.hidden = apply.value !== "range"; });
    const whole = h("button", { class: "tk-btn", type: "button", onclick: () => { if (st.pdf) { stage.setRects([{ x: 0, y: 0, w: stage.ptW, h: stage.ptH }]); store(); } } }, "Select the whole page");
    const out = outputPanel(root);
    const run = runButton("Crop PDF", async job => {
      const r = stage.rects[0]; if (!r) throw new UserError("Drag on the page to choose the area to keep.");
      const doc = await openPdfLib(st.bytes, st.file.name), pages = doc.getPages(), total = pages.length;
      const fr = { x: r.x / stage.ptW, y: r.y / stage.ptH, w: r.w / stage.ptW, h: r.h / stage.ptH };
      const targets = apply.value === "all" ? pages.map((_, i) => i + 1) : apply.value === "current" ? [st.page] : parseRanges(rangeIn.value, total);
      targets.forEach((n, i) => {
        const page = pages[n - 1], vm = visualMapper(page);
        const box = userBox(vm, n === st.page ? r : { x: fr.x * vm.vw, y: fr.y * vm.vh, w: fr.w * vm.vw, h: fr.h * vm.vh });
        page.setMediaBox(box.x, box.y, box.w, box.h); page.setCropBox(box.x, box.y, box.w, box.h);
        job.progress(Math.round((i + 1) / targets.length * 90));
      });
      doc.setProducer("MarketTech Applications");
      out.show(baseName(st.file.name) + "-cropped.pdf", await doc.save(), "Cropped " + targets.length + " of " + total + " pages. The cut-off area is hidden, not redacted: use Redact PDF to remove sensitive content.");
    });
    function store() { if (stage.rects[0]) st.rects.set(st.page, { ...stage.rects[0] }); else st.rects.delete(st.page); refreshNote(); }
    stage.onchange = () => store();
    function refreshNote() { note.textContent = stage.rects[0] ? "Keeping " + Math.round(stage.rects[0].w) + " × " + Math.round(stage.rects[0].h) + " pt of this page. Drag the box or its handles to adjust." : "Drag on the page to choose the area to keep."; }
    const picker = pickPdf(root, {
      async onLoad({ file, bytes, pdf }) {
        Object.assign(st, { pdf, bytes, file, rects: new Map(), page: 1 });
        await pageToStage(stage, pdf, 1); stage.setRects([]); nav.set(1, pdf.numPages); work.hidden = false; run.btn.disabled = false; out.hide(); refreshNote();
      },
      onReset() { work.hidden = true; }
    });
    const work = h("section", { class: "tk-panel", hidden: true }, h("h2", {}, "2. Choose the area to keep"), nav.el, note, h("div", { class: "tk-stagewrap" }, stage.el), h("div", { class: "tk-row" }, whole),
      h("div", { class: "tk-field" }, h("label", { for: "crop-apply" }, "Apply to"), apply, rangeIn), run.row, run.progress, run.status);
    root.append(work);
    void picker;
  }
};

/* =====================================================================
   Organize pages
   ===================================================================== */
specs["organize-pages"] = {
  custom: true,
  mount(root) {
    const st = { pdf: null, bytes: null, file: null, items: [], thumbs: [] };
    const grid = h("ul", { class: "tk-grid", "aria-label": "Pages" });
    const summary = h("p", { class: "tk-note" });
    const out = outputPanel(root);
    let dragFrom = -1;
    const run = runButton("Save organized PDF", async job => {
      if (!st.items.length) throw new UserError("There are no pages to save. Add a blank page or start over.");
      const { PDFDocument, degrees } = await lib("pdflib"), src = await openPdfLib(st.bytes, st.file.name), doc = await PDFDocument.create();
      const first = src.getPages()[0].getSize();
      for (let i = 0; i < st.items.length; i++) {
        const it = st.items[i];
        if (it.blank) doc.addPage([first.width, first.height]);
        else {
          const [p] = await doc.copyPages(src, [it.src]); p.setRotation(degrees((((p.getRotation().angle + it.rot) % 360) + 360) % 360)); doc.addPage(p);
        }
        job.progress(Math.round((i + 1) / st.items.length * 90)); if (i % 10 === 9) await job.tick();
      }
      doc.setProducer("MarketTech Applications");
      out.show(baseName(st.file.name) + "-organized.pdf", await doc.save(), st.items.length + " pages saved.");
    });
    function draw() {
      grid.replaceChildren();
      st.items.forEach((it, i) => {
        const thumb = it.blank ? h("div", { class: "tk-blank" }, "Blank page") : (() => { const c = h("canvas", { class: "tk-gthumb", "aria-hidden": "true" }); const t = st.thumbs[it.src]; if (t) { c.width = t.width; c.height = t.height; c.getContext("2d").drawImage(t, 0, 0); } c.style.transform = "rotate(" + it.rot + "deg)"; return c; })();
        const b = (label, fn, aria, dis) => h("button", { class: "tk-mini", type: "button", onclick: fn, "aria-label": aria + " (page " + (i + 1) + ")", disabled: dis }, label);
        const li = h("li", { class: "tk-gitem", draggable: "true" }, h("div", { class: "tk-gframe" }, thumb), h("span", { class: "tk-gnum" }, String(i + 1)),
          h("div", { class: "tk-gbtns" },
            b("↺", () => { it.rot = (it.rot + 270) % 360; draw(); }, "Rotate left"), b("↻", () => { it.rot = (it.rot + 90) % 360; draw(); }, "Rotate right"),
            b("◀", () => mv(i, i - 1), "Move earlier", i === 0), b("▶", () => mv(i, i + 1), "Move later", i === st.items.length - 1),
            b("⧉", () => { st.items.splice(i + 1, 0, { ...it }); draw(); }, "Duplicate"), b("＋", () => { st.items.splice(i + 1, 0, { blank: true, rot: 0 }); draw(); }, "Insert blank page after"),
            b("✕", () => { st.items.splice(i, 1); draw(); }, "Delete")));
        li.addEventListener("dragstart", e => { dragFrom = i; e.dataTransfer.setData("text/plain", String(i)); });
        li.addEventListener("dragover", e => e.preventDefault());
        li.addEventListener("drop", e => { e.preventDefault(); if (dragFrom >= 0) mv(dragFrom, i); dragFrom = -1; });
        grid.append(li);
      });
      summary.textContent = st.items.length + " pages. Use the buttons under a page, or drag pages to reorder.";
    }
    function mv(a, b) { if (b < 0 || b >= st.items.length) return; const [x] = st.items.splice(a, 1); st.items.splice(b, 0, x); draw(); }
    const tools = h("div", { class: "tk-row" },
      h("button", { class: "tk-btn", type: "button", onclick: () => { st.items.reverse(); draw(); } }, "Reverse order"),
      h("button", { class: "tk-btn", type: "button", onclick: () => { st.items.forEach(i => { i.rot = (i.rot + 90) % 360; }); draw(); } }, "Rotate all clockwise"),
      h("button", { class: "tk-btn", type: "button", onclick: () => { st.items = st.pdf ? Array.from({ length: st.pdf.numPages }, (_, i) => ({ src: i, rot: 0 })) : []; draw(); } }, "Undo all changes"));
    const work = h("section", { class: "tk-panel", hidden: true }, h("h2", {}, "2. Arrange the pages"), summary, tools, grid, run.row, run.progress, run.status);
    pickPdf(root, {
      async onLoad({ file, bytes, pdf }) {
        if (pdf.numPages > 300) throw new UserError("This PDF has " + pdf.numPages + " pages. Organize works best up to 300 pages; split it first.");
        Object.assign(st, { pdf, bytes, file, thumbs: [], items: Array.from({ length: pdf.numPages }, (_, i) => ({ src: i, rot: 0 })) });
        work.hidden = false; out.hide(); run.btn.disabled = false; draw();
        for (let p = 1; p <= pdf.numPages; p++) { if (st.pdf !== pdf) return; st.thumbs[p - 1] = await renderPage(pdf, p, { scale: 0.28 }); if (p % 4 === 0 || p === pdf.numPages) draw(); }
      },
      onReset() { work.hidden = true; }
    });
    root.append(work);
  }
};

/* =====================================================================
   Redact PDF
   ===================================================================== */
specs["redact-pdf"] = {
  custom: true,
  mount(root) {
    const st = { pdf: null, bytes: null, file: null, boxes: new Map(), page: 1 };
    const stage = createStage({ multi: true, variant: "redact", label: "Redaction box" });
    const nav = pageNav(async n => { st.page = n; await pageToStage(stage, st.pdf, n); stage.setRects(st.boxes.get(n) || []); stage.sel = -1; stage.render(); summary(); });
    const note = h("p", { class: "tk-note" });
    const out = outputPanel(root);
    function summary() {
      let n = 0, pages = 0; for (const list of st.boxes.values()) if (list.length) { n += list.length; pages++; }
      note.textContent = n ? n + " box" + (n === 1 ? "" : "es") + " on " + pages + " page" + (pages === 1 ? "" : "s") + ". Pages with boxes become flat images, so the covered text is truly removed." : "Drag on the page to draw a box over text or images to remove. Draw as many as you need.";
    }
    stage.onchange = rects => { st.boxes.set(st.page, rects.map(r => ({ ...r }))); summary(); };
    const clearPage = h("button", { class: "tk-btn", type: "button", onclick: () => stage.clear() }, "Clear this page");
    const delSel = h("button", { class: "tk-btn", type: "button", onclick: () => stage.remove(stage.sel) }, "Delete selected box");
    const run = runButton("Redact and save", async job => {
      const pagesWith = [...st.boxes.entries()].filter(([, l]) => l.length);
      if (!pagesWith.length) throw new UserError("Draw at least one box first.");
      const { PDFDocument } = await lib("pdflib"), src = await openPdfLib(st.bytes, st.file.name), doc = await PDFDocument.create();
      const total = src.getPageCount();
      for (let p = 1; p <= total; p++) {
        const boxes = st.boxes.get(p) || [];
        if (!boxes.length) { const [pg] = await doc.copyPages(src, [p - 1]); doc.addPage(pg); }
        else {
          const page = await st.pdf.getPage(p), base = page.getViewport({ scale: 1 }), scale = 200 / 72;
          const canvas = await renderPage(st.pdf, p, { scale }), ctx = canvas.getContext("2d");
          ctx.fillStyle = "#000"; for (const b of boxes) ctx.fillRect(Math.floor(b.x * scale), Math.floor(b.y * scale), Math.ceil(b.w * scale) + 1, Math.ceil(b.h * scale) + 1);
          const img = await doc.embedJpg(new Uint8Array(await (await canvasBlob(canvas, "image/jpeg", 0.92)).arrayBuffer()));
          const np = doc.addPage([base.width, base.height]); np.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height }); canvas.width = canvas.height = 1;
        }
        job.progress(Math.round(p / total * 92), "Page " + p + " of " + total); await job.tick();
      }
      doc.setProducer("MarketTech Applications");
      out.show(baseName(st.file.name) + "-redacted.pdf", await doc.save(), "Redacted " + pagesWith.length + " page(s). Check the result before sharing it.");
    });
    const work = h("section", { class: "tk-panel", hidden: true }, h("h2", {}, "2. Draw boxes over what to remove"), nav.el, note, h("div", { class: "tk-stagewrap" }, stage.el), h("div", { class: "tk-row" }, clearPage, delSel), run.row, run.progress, run.status);
    pickPdf(root, {
      async onLoad({ file, bytes, pdf }) {
        Object.assign(st, { pdf, bytes, file, boxes: new Map(), page: 1 });
        await pageToStage(stage, pdf, 1); stage.setRects([]); nav.set(1, pdf.numPages); work.hidden = false; run.btn.disabled = false; out.hide(); summary();
      },
      onReset() { work.hidden = true; }
    });
    root.append(work);
  }
};

/* =====================================================================
   Sign PDF
   ===================================================================== */
function trimCanvas(c) {
  const ctx = c.getContext("2d", { willReadFrequently: true }), { width, height } = c, d = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (d[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 4, out = document.createElement("canvas"); out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
  out.getContext("2d").drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return out;
}
function signatureMaker(onChange) {
  const color = h("select", { id: "sig-color", "aria-label": "Ink colour" }, [["#111111", "Black ink"], ["#1b3a8a", "Blue ink"]].map(([v, l]) => h("option", { value: v }, l)));
  const pad = h("canvas", { width: 720, height: 240, class: "tk-pad", "aria-label": "Draw your signature here" });
  const pctx = pad.getContext("2d"); let drawing = false, last = null;
  const clear = () => { pctx.clearRect(0, 0, pad.width, pad.height); onChange(null); };
  const pos = e => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * pad.width, y: (e.clientY - r.top) / r.height * pad.height }; };
  pad.addEventListener("pointerdown", e => { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); e.preventDefault(); });
  pad.addEventListener("pointermove", e => { if (!drawing) return; const p = pos(e); pctx.strokeStyle = color.value; pctx.lineWidth = 5; pctx.lineCap = pctx.lineJoin = "round"; pctx.beginPath(); pctx.moveTo(last.x, last.y); pctx.lineTo(p.x, p.y); pctx.stroke(); last = p; });
  const finish = () => { if (!drawing) return; drawing = false; onChange(trimCanvas(pad)); };
  pad.addEventListener("pointerup", finish); pad.addEventListener("pointercancel", finish);
  const drawPane = h("div", { class: "tk-pane" }, pad, h("div", { class: "tk-row" }, color, h("button", { class: "tk-btn", type: "button", onclick: clear }, "Clear")));

  const text = h("input", { type: "text", id: "sig-text", placeholder: "Type your name", "aria-label": "Your name" });
  const fontSel = h("select", { id: "sig-font", "aria-label": "Style" }, [["'Segoe Script','Brush Script MT','Snell Roundhand','Apple Chancery',cursive", "Handwriting"], ["italic 'Georgia','Times New Roman',serif", "Serif italic"], ["'Courier New',monospace", "Typewriter"]].map(([v, l]) => h("option", { value: v }, l)));
  const tcan = h("canvas", { class: "tk-typed", "aria-hidden": "true" });
  const renderTyped = () => {
    const t = text.value.trim(); if (!t) { onChange(null); tcan.width = 1; tcan.height = 1; return; }
    const c = document.createElement("canvas"), x = c.getContext("2d"), font = fontSel.value.startsWith("italic") ? fontSel.value.replace("italic ", "") : fontSel.value, italic = fontSel.value.startsWith("italic") ? "italic " : "";
    x.font = italic + "96px " + font; c.width = Math.ceil(x.measureText(t).width) + 40; c.height = 160;
    x.font = italic + "96px " + font; x.fillStyle = color.value; x.textBaseline = "middle"; x.fillText(t, 20, 80);
    const tr = trimCanvas(c); if (tr) { tcan.width = tr.width; tcan.height = tr.height; tcan.getContext("2d").drawImage(tr, 0, 0); } onChange(tr);
  };
  text.addEventListener("input", renderTyped); fontSel.addEventListener("change", renderTyped); color.addEventListener("change", () => { if (!panes.type.hidden) renderTyped(); });
  const typePane = h("div", { class: "tk-pane" }, h("div", { class: "tk-row" }, text, fontSel), tcan);

  const file = h("input", { type: "file", id: "sig-file", accept: "image/png,image/jpeg,.png,.jpg,.jpeg", "aria-label": "Signature image" });
  const clean = h("input", { type: "checkbox", id: "sig-clean", checked: true });
  const loadFile = async () => {
    const f = file.files[0]; if (!f) { onChange(null); return; }
    const bmp = await createImageBitmap(f), c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    if (clean.checked) { const img = x.getImageData(0, 0, c.width, c.height), d = img.data; for (let i = 0; i < d.length; i += 4) { const lum = (d[i] + d[i + 1] + d[i + 2]) / 3; if (lum > 235) d[i + 3] = 0; else if (lum > 170) d[i + 3] = Math.round(255 * (235 - lum) / 65); } x.putImageData(img, 0, 0); }
    onChange(trimCanvas(c));
  };
  file.addEventListener("change", loadFile); clean.addEventListener("change", loadFile);
  const upPane = h("div", { class: "tk-pane" }, file, h("div", { class: "tk-field check" }, clean, h("label", { for: "sig-clean" }, "Make a white background transparent")));

  const panes = { draw: drawPane, type: typePane, upload: upPane }, tabs = h("div", { class: "tk-tabs", role: "tablist" });
  const show = key => { for (const [k, p] of Object.entries(panes)) p.hidden = k !== key; [...tabs.children].forEach(b => b.setAttribute("aria-selected", String(b.dataset.k === key))); if (key === "type") renderTyped(); else if (key === "upload") loadFile(); else onChange(trimCanvas(pad)); };
  for (const [k, l] of [["draw", "Draw"], ["type", "Type"], ["upload", "Upload image"]]) tabs.append(h("button", { class: "tk-tab", type: "button", role: "tab", dataset: { k }, onclick: () => show(k) }, l));
  panes.type.hidden = panes.upload.hidden = true; tabs.firstChild.setAttribute("aria-selected", "true");
  return h("div", {}, tabs, drawPane, typePane, upPane);
}

specs["sign-pdf"] = {
  custom: true,
  mount(root) {
    const st = { pdf: null, bytes: null, file: null, sig: null, page: 1, sigUrl: "" };
    const stage = createStage({ aspect: 3, variant: "place", label: "Signature", decorate: (box) => { if (st.sigUrl) box.append(h("img", { src: st.sigUrl, alt: "Your signature", draggable: "false" })); } });
    const nav = pageNav(async n => { st.page = n; const keep = stage.rects[0] ? { ...stage.rects[0] } : null; await pageToStage(stage, st.pdf, n); stage.setRects(keep ? [keep] : []); });
    const note = h("p", { class: "tk-note" }, "Create a signature above, then drag the box on the page to place it. Drag a corner to resize.");
    const apply = h("select", { id: "sign-apply" }, [["current", "This page only"], ["last", "Last page"], ["all", "Every page"], ["range", "Pages in a range"]].map(([v, l]) => h("option", { value: v }, l)));
    const rangeIn = h("input", { type: "text", id: "sign-range", value: "1", hidden: true, "aria-label": "Page range" });
    apply.addEventListener("change", () => { rangeIn.hidden = apply.value !== "range"; });
    const out = outputPanel(root);
    const run = runButton("Sign and save", async job => {
      if (!st.sig) throw new UserError("Create a signature first.");
      const r = stage.rects[0]; if (!r) throw new UserError("Drag the signature box onto the page where it should go.");
      const { degrees } = await lib("pdflib"), doc = await openPdfLib(st.bytes, st.file.name), pages = doc.getPages(), total = pages.length;
      const img = await doc.embedPng(new Uint8Array(await (await canvasBlob(st.sig, "image/png")).arrayBuffer()));
      const targets = apply.value === "all" ? pages.map((_, i) => i + 1) : apply.value === "last" ? [total] : apply.value === "range" ? parseRanges(rangeIn.value, total) : [st.page];
      const fr = { x: r.x / stage.ptW, y: r.y / stage.ptH, w: r.w / stage.ptW };
      targets.forEach((n, i) => {
        const page = pages[n - 1], vm = visualMapper(page);
        const w = n === st.page ? r.w : fr.w * vm.vw, hh = w / (st.sig.width / st.sig.height);
        const x = n === st.page ? r.x : fr.x * vm.vw, y = n === st.page ? r.y : fr.y * vm.vh;
        const p = vm.map(Math.min(x, vm.vw - w), Math.max(0, vm.vh - Math.min(y, vm.vh - hh) - hh));
        page.drawImage(img, { x: p.x, y: p.y, width: w, height: hh, rotate: degrees(vm.rot) });
        job.progress(Math.round((i + 1) / targets.length * 90));
      });
      doc.setProducer("MarketTech Applications");
      out.show(baseName(st.file.name) + "-signed.pdf", await doc.save(), "Signature added to " + targets.length + " page(s). This is an image of your signature, not a certified digital signature.");
    });
    const maker = signatureMaker(canvas => {
      st.sig = canvas;
      if (!canvas) { st.sigUrl = ""; stage.setRects([]); return; }
      st.sigUrl = canvas.toDataURL("image/png"); stage.aspect = canvas.width / canvas.height;
      if (st.pdf) { const w = Math.min(180, stage.ptW * 0.4); stage.setRects([{ x: Math.max(0, stage.ptW - w - 40), y: Math.max(0, stage.ptH - w / stage.aspect - 60), w, h: w / stage.aspect }]); }
    });
    const sigPanel = h("section", { class: "tk-panel" }, h("h2", {}, "1. Create your signature"), maker, h("p", { class: "tk-note" }, "Your signature stays in this browser tab. It is never saved or uploaded."));
    root.append(sigPanel);
    const work = h("section", { class: "tk-panel", hidden: true }, h("h2", {}, "3. Place it on the page"), nav.el, note, h("div", { class: "tk-stagewrap" }, stage.el),
      h("div", { class: "tk-field" }, h("label", { for: "sign-apply" }, "Apply to"), apply, rangeIn), run.row, run.progress, run.status);
    pickPdf(root, {
      title: "2. Add the PDF to sign",
      async onLoad({ file, bytes, pdf }) {
        Object.assign(st, { pdf, bytes, file, page: 1 });
        await pageToStage(stage, pdf, 1); nav.set(1, pdf.numPages); work.hidden = false; run.btn.disabled = false; out.hide();
        if (st.sig) { const w = Math.min(180, stage.ptW * 0.4); stage.setRects([{ x: Math.max(0, stage.ptW - w - 40), y: Math.max(0, stage.ptH - w / stage.aspect - 60), w, h: w / stage.aspect }]); } else stage.setRects([]);
      },
      onReset() { work.hidden = true; }
    });
    root.append(work);
  }
};

export default specs;

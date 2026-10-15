/* MarketTech Applications: shared engine.
 * Everything runs in the browser. Libraries are self-hosted under /applications/vendor.
 * No function in this file performs a network request with user data. */

const VENDOR = "/applications/vendor/";

/* ---------- small DOM helper ---------- */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (["value", "checked", "disabled", "hidden", "textContent", "id"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const add = kid => {
    if (Array.isArray(kid)) kid.forEach(add);
    else if (kid === null || kid === undefined || kid === false) return;
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

export class UserError extends Error {}
export class Cancelled extends Error {}

/* ---------- formatting ---------- */
export function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}
export function baseName(name) { return String(name || "file").replace(/\.[^.]+$/, ""); }
export function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"); }

/* ---------- library loading (pinned, self-hosted) ---------- */
const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = () => resolve(); s.onerror = () => { scripts.delete(src); reject(new UserError("A required local library failed to load. Reload the page and try again.")); };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}
export async function lib(name) {
  if (name === "pdflib") { if (!window.PDFLib) await loadScript(VENDOR + "pdf-lib-1.10.0.min.js"); return window.PDFLib; }
  if (name === "pdfjs") {
    if (!window.pdfjsLib) await loadScript(VENDOR + "pdfjs-3.11.174.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR + "pdfjs-3.11.174.worker.min.js";
    return window.pdfjsLib;
  }
  if (name === "jszip") { if (!window.JSZip) await loadScript(VENDOR + "jszip-3.10.1.min.js"); return window.JSZip; }
  if (name === "pptxgenjs") {
    /* PptxGenJS uses the local JSZip global. Both libraries are self-hosted; no CDN or upload. */
    await lib("jszip");
    if (!window.PptxGenJS) await loadScript(VENDOR + "pptxgenjs-3.12.0.min.js");
    if (typeof window.PptxGenJS !== "function") throw new UserError("The local PowerPoint library did not start. Reload the page and try again.");
    return window.PptxGenJS;
  }
  throw new Error("Unknown library " + name);
}

/* ---------- files ---------- */
export async function readBytes(file) { return new Uint8Array(await file.arrayBuffer()); }

export function isPdf(file) { return file.type === "application/pdf" || /\.pdf$/i.test(file.name); }
export function isImage(file) { return /^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name); }

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename, style: "display:none" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function toBlob(data, mime) {
  if (data instanceof Blob) return data;
  return new Blob([data], { type: mime || "application/octet-stream" });
}
export async function makeZip(items) {
  const JSZip = await lib("jszip");
  const zip = new JSZip();
  for (const it of items) zip.file(it.name, it.data instanceof Blob ? it.data : it.data);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

/* ---------- password dialog ---------- */
export function askPassword(name, wrong) {
  return new Promise(resolve => {
    const input = h("input", { type: "password", id: "tk-pw", autocomplete: "off", required: true });
    const dlg = h("dialog", { class: "tk-dialog" },
      h("form", { method: "dialog" },
        h("h2", {}, "Password needed"),
        h("p", {}, (wrong ? "That password was not correct. " : "") + "Enter the password to open “" + name + "”. It is used only in this browser."),
        h("label", { for: "tk-pw" }, "Password"), input,
        h("div", { class: "tk-row" },
          h("button", { class: "tk-btn primary", value: "ok" }, "Open file"),
          h("button", { class: "tk-btn", value: "cancel", formnovalidate: true }, "Cancel"))));
    document.body.append(dlg);
    dlg.addEventListener("close", () => { const ok = dlg.returnValue === "ok"; const v = input.value; dlg.remove(); resolve(ok ? v : null); });
    if (dlg.showModal) dlg.showModal(); else { const v = window.prompt("Password for " + name); dlg.remove(); resolve(v); }
    input.focus();
  });
}

/* ---------- PDF open helpers ---------- */
function friendly(error, name) {
  const msg = String(error && error.message || error);
  if (error && error.name === "PasswordException") return new UserError("“" + name + "” needs the correct password.");
  if (error && error.name === "InvalidPDFException") return new UserError("“" + name + "” is damaged or is not a valid PDF.");
  if (/Worker was destroyed|destroy/i.test(msg)) return new UserError("“" + name + "” was not opened because no password was entered.");
  if (error instanceof UserError) return error;
  return new UserError("“" + name + "” could not be read: " + msg);
}
export async function openPdfJs(bytes, name, { disableFontFace = true } = {}) {
  const pdfjs = await lib("pdfjs");
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace });
  task.onPassword = async (update, reason) => {
    const pw = await askPassword(name, reason === 2);
    if (pw === null) { task.destroy(); return; }
    update(pw);
  };
  try { return await task.promise; } catch (e) { throw friendly(e, name); }
}
export async function openPdfLib(bytes, name) {
  const { PDFDocument } = await lib("pdflib");
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    if (/encrypt/i.test(String(e && e.message))) {
      throw new UserError("“" + name + "” is password-protected, so it cannot be edited directly. Open it in a PDF viewer and print it to a new PDF, or use the Unlock PDF tool when it is available.");
    }
    throw new UserError("“" + name + "” could not be read. It may be damaged or not a real PDF.");
  }
}
export async function renderPage(pdf, pageNumber, { scale = 1, canvas, skipText = false } = {}) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const c = canvas || document.createElement("canvas");
  c.width = Math.max(1, Math.round(viewport.width)); c.height = Math.max(1, Math.round(viewport.height));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  if (!skipText) await page.render({ canvasContext: ctx, viewport }).promise;
  else {
    /* Keep vector lines and images as artwork while text is rebuilt as editable PowerPoint boxes. */
    const fillText = ctx.fillText, strokeText = ctx.strokeText, suppressText = () => {};
    try {
      try { ctx.fillText = suppressText; ctx.strokeText = suppressText; }
      catch { throw new UserError("This browser cannot isolate PDF text for editable conversion."); }
      if (ctx.fillText !== suppressText || ctx.strokeText !== suppressText) throw new UserError("This browser cannot isolate PDF text for editable conversion.");
      await page.render({ canvasContext: ctx, viewport }).promise;
    } finally {
      try { ctx.fillText = fillText; } catch {}
      try { ctx.strokeText = strokeText; } catch {}
    }
  }
  return c;
}
export function canvasBlob(canvas, type = "image/png", quality = 0.92) {
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new UserError("The browser could not encode an image. Try a smaller page size or DPI.")), type, quality));
}

/* ---------- page ranges ---------- */
export function parseRanges(text, total, { allowEmpty = false } = {}) {
  const src = String(text || "").trim().toLowerCase();
  if (!src) { if (allowEmpty) return []; throw new UserError("Enter the pages to use, for example 1-3, 5, 8-"); }
  const out = new Set();
  for (let part of src.split(",").map(s => s.trim()).filter(Boolean)) {
    if (part === "all") { for (let i = 1; i <= total; i++) out.add(i); continue; }
    if (part === "odd") { for (let i = 1; i <= total; i += 2) out.add(i); continue; }
    if (part === "even") { for (let i = 2; i <= total; i += 2) out.add(i); continue; }
    part = part.replace(/\blast\b/g, String(total));
    const m = part.match(/^(\d*)\s*(-)?\s*(\d*)$/);
    if (!m || (!m[1] && !m[3])) throw new UserError("“" + part + "” is not a valid page range. Use numbers like 1-3, 5, 8-");
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : total) : a;
    if (a < 1 || b < a || b > total) throw new UserError("Pages must be between 1 and " + total + " (you entered “" + part + "”).");
    for (let i = a; i <= b; i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}
/* Splits "1-3, 5" into separate groups, keeping each comma part as its own group (used by Split). */
export function parseGroups(text, total) {
  const parts = String(text || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!parts.length) throw new UserError("Enter the page groups, for example 1-3, 4-6, 7-");
  return parts.map(p => parseRanges(p, total));
}

/* ---------- jobs: progress + cancel ---------- */
export class Job {
  constructor(onProgress) { this.ctl = new AbortController(); this.onProgress = onProgress || (() => {}); }
  get cancelled() { return this.ctl.signal.aborted; }
  cancel() { this.ctl.abort(); }
  progress(value, message) { this.onProgress(Math.max(0, Math.min(100, value)), message || ""); }
  async tick() { if (this.cancelled) throw new Cancelled(); await new Promise(r => setTimeout(r, 0)); if (this.cancelled) throw new Cancelled(); }
}

/* ---------- status line ---------- */
export function statusLine() {
  const el = h("p", { class: "tk-status", role: "status", "aria-live": "polite" });
  el.set = (msg, kind) => { el.textContent = msg || ""; el.className = "tk-status" + (kind ? " " + kind : ""); };
  return el;
}

/* ---------- drop zone ---------- */
export function dropZone({ accept, multiple, text, hint, onFiles, id }) {
  const input = h("input", { type: "file", id, class: "tk-sr", multiple: multiple ? true : undefined, accept: accept.exts });
  const label = h("label", { class: "tk-drop", for: id },
    h("strong", {}, text || (multiple ? "Drop files here or click to choose" : "Drop a file here or click to choose")),
    h("span", {}, hint || "Processed on this device. Nothing is uploaded."), input);
  input.addEventListener("change", () => { onFiles([...input.files]); input.value = ""; });
  label.addEventListener("dragover", e => { e.preventDefault(); label.classList.add("over"); });
  label.addEventListener("dragleave", () => label.classList.remove("over"));
  label.addEventListener("drop", e => { e.preventDefault(); label.classList.remove("over"); if (e.dataTransfer && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
  return label;
}
export const ACCEPT = {
  pdf: { exts: "application/pdf,.pdf", test: isPdf, noun: "PDF" },
  image: { exts: "image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp", test: isImage, noun: "image (JPG, PNG, WebP, GIF)" },
  "pdf-image": { exts: "application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp", test: f => isPdf(f) || isImage(f), noun: "PDF or image" }
};

/* ---------- generic tool runner ---------- */
let uid = 0;
export async function mountSpec(root, spec) {
  const accept = ACCEPT[spec.accept || "pdf"];
  const multiple = !!spec.multiple;
  const min = spec.min || 1;
  let files = [];
  let job = null;
  const state = { opts: {} };
  const status = statusLine();
  const list = h("ul", { class: "tk-files", "aria-label": "Selected files" });
  const optionsBox = h("div", { class: "tk-options" });
  const progress = h("progress", { class: "tk-progress", max: 100, value: 0, hidden: true });
  const results = h("section", { class: "tk-panel tk-results", hidden: true, "aria-live": "polite" });
  const runBtn = h("button", { class: "tk-btn primary", type: "button", disabled: true }, spec.action || "Run");
  const cancelBtn = h("button", { class: "tk-btn", type: "button", hidden: true }, "Cancel");
  const resetBtn = h("button", { class: "tk-btn", type: "button" }, "Start over");
  const countNote = h("p", { class: "tk-note" });
  const optionsSection = h("section", { class: "tk-panel", hidden: true }, h("h2", {}, "2. Options"), optionsBox);

  /* options form */
  const fields = new Map();
  function readOpts() {
    const o = {};
    for (const def of spec.options || []) {
      const f = fields.get(def.id); if (!f) continue;
      if (def.type === "checkbox") o[def.id] = f.input.checked;
      else if (def.type === "number" || def.type === "range") o[def.id] = f.input.value === "" ? null : Number(f.input.value);
      else if (def.type === "file") o[def.id] = f.input.files[0] || null;
      else o[def.id] = f.input.value;
    }
    return o;
  }
  function applyVisibility() {
    const o = readOpts();
    for (const def of spec.options || []) {
      const f = fields.get(def.id);
      if (f && def.show) f.wrap.hidden = !def.show(o);
    }
  }
  for (const def of spec.options || []) {
    const id = "tk-opt-" + def.id + "-" + (++uid);
    let input;
    if (def.type === "select") input = h("select", { id }, (def.choices || []).map(([v, l]) => h("option", { value: v }, l)));
    else if (def.type === "textarea") input = h("textarea", { id, rows: def.rows || 3, placeholder: def.placeholder || "" });
    else if (def.type === "checkbox") input = h("input", { id, type: "checkbox" });
    else if (def.type === "file") input = h("input", { id, type: "file", accept: def.accept || "" });
    else input = h("input", { id, type: def.type === "range" ? "range" : (def.type || "text"), min: def.min, max: def.max, step: def.step, placeholder: def.placeholder || "", autocomplete: "off" });
    if (def.default !== undefined && def.type !== "file") { if (def.type === "checkbox") input.checked = !!def.default; else input.value = def.default; }
    const readout = def.type === "range" ? h("output", { class: "tk-readout" }, String(def.default)) : null;
    input.addEventListener("input", () => { if (readout) readout.textContent = input.value; applyVisibility(); });
    input.addEventListener("change", applyVisibility);
    const wrap = def.type === "checkbox"
      ? h("div", { class: "tk-field check" }, input, h("label", { for: id }, def.label), def.help ? h("small", {}, def.help) : null)
      : h("div", { class: "tk-field" }, h("label", { for: id }, def.label, readout ? [" ", readout] : null), input, def.help ? h("small", {}, def.help) : null);
    fields.set(def.id, { input, wrap, def });
    optionsBox.append(wrap);
  }
  const ui = {
    setOption(id, value) { const f = fields.get(id); if (!f) return; if (f.def.type === "checkbox") f.input.checked = !!value; else f.input.value = value; applyVisibility(); },
    status, files: () => files
  };

  /* file list */
  function sync() {
    list.replaceChildren();
    files.forEach((f, i) => {
      const thumb = f.kind === "image" ? h("img", { src: f.url, alt: "", class: "tk-thumb" }) : h("span", { class: "tk-badge" }, "PDF");
      const meta = [fmtSize(f.size)];
      if (f.pages) meta.push(f.pages + (f.pages === 1 ? " page" : " pages"));
      if (f.locked) meta.push("password-protected");
      const btn = (label, fn, disabled, aria) => h("button", { class: "tk-mini", type: "button", disabled, "aria-label": aria, onclick: fn }, label);
      const li = h("li", { class: "tk-file", draggable: multiple && spec.reorder !== false ? "true" : null },
        thumb,
        h("div", { class: "tk-file-info" }, h("span", { class: "tk-file-name" }, f.name), h("small", {}, meta.join(" · "))),
        h("div", { class: "tk-file-actions" },
          multiple && spec.reorder !== false ? [
            btn("↑", () => move(i, i - 1), i === 0, "Move " + f.name + " up"),
            btn("↓", () => move(i, i + 1), i === files.length - 1, "Move " + f.name + " down")] : null,
          btn("Remove", () => { files.splice(i, 1); if (f.url) URL.revokeObjectURL(f.url); changed(); }, false, "Remove " + f.name)));
      li.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", String(i)); });
      li.addEventListener("dragover", e => e.preventDefault());
      li.addEventListener("drop", e => { e.preventDefault(); const from = Number(e.dataTransfer.getData("text/plain")); if (Number.isInteger(from)) move(from, i); });
      list.append(li);
    });
    const ok = files.length >= min && (multiple || files.length === 1);
    runBtn.disabled = !ok || !!job;
    countNote.textContent = files.length ? files.length + (files.length === 1 ? " file" : " files") + " selected" + (files.length < min ? ". Add at least " + min + "." : ".") : "";
    optionsSection.hidden = !(spec.options || []).length || !files.length;
  }
  function move(from, to) { if (to < 0 || to >= files.length) return; const [f] = files.splice(from, 1); files.splice(to, 0, f); sync(); }
  function changed() { sync(); results.hidden = true; if (spec.onFiles) spec.onFiles(files, ui); }

  async function addFiles(incoming) {
    const good = [], bad = [];
    for (const file of incoming) (accept.test(file) ? good : bad).push(file);
    if (bad.length) status.set("Skipped " + bad.length + " file(s) that are not a " + accept.noun + ": " + bad.map(b => b.name).join(", "), "error");
    if (!good.length) return;
    const take = multiple ? good : [good[0]];
    if (!multiple) { files.forEach(f => f.url && URL.revokeObjectURL(f.url)); files = []; }
    for (const file of take) {
      const entry = { id: ++uid, file, name: file.name, size: file.size, kind: isPdf(file) ? "pdf" : "image", pages: 0, locked: false, _bytes: null };
      entry.bytes = async () => entry._bytes || (entry._bytes = await readBytes(file));
      if (entry.kind === "image") entry.url = URL.createObjectURL(file);
      files.push(entry);
    }
    if (!bad.length) status.set(file0Warning(take) || "", file0Warning(take) ? "warn" : "");
    changed();
    /* Read page counts in the background; password-protected files are flagged. */
    for (const entry of take) {
      if (entry.kind !== "pdf") continue;
      try {
        const { PDFDocument } = await lib("pdflib");
        const doc = await PDFDocument.load(await entry.bytes(), { updateMetadata: false });
        entry.pages = doc.getPageCount();
      } catch (e) { if (/encrypt/i.test(String(e && e.message))) entry.locked = true; }
      sync();
      if (spec.onFiles) spec.onFiles(files, ui);
    }
  }
  function file0Warning(list) { const big = list.find(f => f.size > 100 * 1024 * 1024); return big ? "“" + big.name + "” is over 100 MB. Processing may be slow and use a lot of memory." : ""; }

  /* run */
  runBtn.addEventListener("click", async () => {
    if (job) return;
    let opts;
    try { opts = readOpts(); } catch (e) { status.set(e.message, "error"); return; }
    job = new Job((v, m) => { progress.value = v; if (m) status.set(m); });
    runBtn.disabled = true; cancelBtn.hidden = false; progress.hidden = false; progress.value = 0; results.hidden = true;
    status.set("Working…");
    try {
      const out = await spec.run({ files, opts, job, h });
      const outputs = Array.isArray(out) ? out : out.outputs;
      await showResults(outputs, out && out.view, out && out.note);
      progress.value = 100; status.set("Done. Your files never left this device.", "ok");
    } catch (e) {
      if (e instanceof Cancelled) status.set("Cancelled.");
      else { console.error(e); status.set(e instanceof UserError ? e.message : "Something went wrong: " + (e && e.message ? e.message : e), "error"); }
    } finally { job = null; cancelBtn.hidden = true; sync(); }
  });
  cancelBtn.addEventListener("click", () => { if (job) job.cancel(); });
  resetBtn.addEventListener("click", () => {
    if (job) job.cancel();
    files.forEach(f => f.url && URL.revokeObjectURL(f.url)); files = [];
    for (const f of fields.values()) { const d = f.def; if (d.type === "file") f.input.value = ""; else if (d.default !== undefined) { if (d.type === "checkbox") f.input.checked = !!d.default; else f.input.value = d.default; } else f.input.value = ""; }
    progress.hidden = true; results.hidden = true; status.set(""); sync(); applyVisibility();
  });

  async function showResults(outputs, view, note) {
    results.replaceChildren(h("h2", {}, "Result"));
    if (note) results.append(h("p", { class: "tk-note" }, note));
    if (outputs && outputs.length) {
      const ul = h("ul", { class: "tk-outputs" });
      for (const o of outputs) {
        const blob = toBlob(o.data, o.mime);
        ul.append(h("li", {}, h("span", { class: "tk-file-name" }, o.name), h("small", {}, fmtSize(blob.size)),
          h("button", { class: "tk-btn", type: "button", onclick: () => downloadBlob(blob, o.name) }, "Download")));
      }
      results.append(ul);
      if (outputs.length > 1) {
        results.append(h("button", { class: "tk-btn primary", type: "button", onclick: async ev => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = "Preparing ZIP…";
          try { downloadBlob(await makeZip(outputs.map(o => ({ name: o.name, data: toBlob(o.data, o.mime) }))), (spec.zipName || "markettech-pdf") + "-" + stamp() + ".zip"); }
          finally { b.disabled = false; b.textContent = "Download all as ZIP"; }
        } }, "Download all as ZIP"));
      } else {
        const only = outputs[0];
        results.querySelector(".tk-outputs button").classList.add("primary");
        void only;
      }
    }
    if (view) results.append(view);
    results.hidden = false;
  }

  /* assemble */
  const dz = dropZone({ id: "tk-file-input", accept, multiple, text: spec.dropText, hint: spec.dropHint, onFiles: addFiles });
  root.append(
    h("section", { class: "tk-panel" }, h("h2", {}, multiple ? "1. Add files" : "1. Add a file"), dz, list, countNote),
    optionsSection,
    h("section", { class: "tk-panel tk-actions" }, h("div", { class: "tk-row" }, runBtn, cancelBtn, resetBtn), progress, status),
    results);
  if (spec.intro) root.prepend(h("p", { class: "tk-note tk-intro" }, spec.intro));
  applyVisibility(); sync();
}

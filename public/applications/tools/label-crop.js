/* Label Crop 4×6: finds the shipping label on each A4 order page, lets you adjust it, and exports label-sized pages. */
import { h, lib, UserError, statusLine, dropZone, ACCEPT, readBytes, openPdfLib, openPdfJs, renderPage, downloadBlob, fmtSize } from "/applications/core.js";
import { createStage } from "/applications/stage.js";
import { visualMapper } from "/applications/tools/pages.js";

const RENDER = 1.5;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Finds the label: everything above the first row of ink that spans most of the page (the dashed line above the invoice). */
export function detectLabel(canvas, ptW, ptH, pad) {
  const W = canvas.width, H = canvas.height;
  const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const minX = new Int32Array(H).fill(W), maxX = new Int32Array(H).fill(-1);
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      const i = row + x * 4;
      if (d[i + 3] > 128 && (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 < 200) { if (x < minX[y]) minX[y] = x; if (x > maxX[y]) maxX[y] = x; }
    }
  }
  const bbox = limit => {
    let top = -1, bottom = -1, left = W, right = -1;
    for (let y = 0; y < limit; y++) { if (maxX[y] < 0) continue; if (top < 0) top = y; bottom = y; if (minX[y] < left) left = minX[y]; if (maxX[y] > right) right = maxX[y]; }
    return top < 0 ? null : { top, bottom, left, right };
  };
  let cut = H;
  for (let y = 0; y < H; y++) if (maxX[y] >= 0 && maxX[y] - minX[y] > 0.6 * W) { cut = y; break; }
  let b = bbox(cut);
  if (!b || b.bottom - b.top < 0.15 * H) b = bbox(H);
  if (!b) return { x: 0, y: 0, w: ptW, h: ptH };
  const s = W / ptW, w = (b.right - b.left + 1) / s + pad * 2, hh = (b.bottom - b.top + 1) / s + pad * 2;
  return fitRect({ x: b.left / s - pad, y: b.top / s - pad, w, h: hh }, ptW, ptH);
}
function fitRect(c, W, H) { const w = clamp(c.w, Math.min(24, W), W), hh = clamp(c.h, Math.min(24, H), H); return { x: clamp(c.x, 0, W - w), y: clamp(c.y, 0, H - hh), w, h: hh }; }

export default {
  "label-crop-4x6": {
    custom: true,
    mount(root) {
      const st = { files: [], pages: [], sel: -1 };
      const status = statusLine();
      const stage = createStage({ label: "Label crop", maxWidth: 620 });
      const thumbs = h("ul", { class: "tk-lc-thumbs", "aria-label": "Pages" });
      const count = h("span", { class: "tk-meta" });
      const meta = h("p", { class: "tk-meta" });
      const prev = h("canvas", { class: "tk-lc-prev", width: 576, height: 864, role: "img", "aria-label": "Preview of the printed label page" });
      const prevCap = h("p", { class: "tk-meta" });
      const dl = h("button", { class: "tk-btn primary tk-wide", type: "button", disabled: true }, "Download label PDF");
      const progress = h("progress", { class: "tk-progress", max: 100, value: 0, hidden: true });
      const num = id => h("input", { type: "number", id: "lc-" + id, step: 1, "aria-label": id.toUpperCase() });
      const nx = num("x"), ny = num("y"), nw = num("w"), nh = num("h");
      const size = h("select", { id: "lc-size" }, [["288x432", "4 × 6 in (288 × 432 pt)"], ["283.46x425.2", "100 × 150 mm"], ["297.64x419.53", "A6 (105 × 148 mm)"]].map(([v, l]) => h("option", { value: v }, l)));
      const fit = h("select", { id: "lc-fit" }, [["contain", "Fit the whole label on the paper"], ["cover", "Fill the paper, trim the edges"]].map(([v, l]) => h("option", { value: v }, l)));
      const margin = h("input", { type: "number", id: "lc-margin", value: 4, min: 0, max: 40 });
      const padIn = h("input", { type: "number", id: "lc-pad", value: 6, min: 0, max: 40 });
      const field = (label, input, id) => h("div", { class: "tk-field" }, h("label", { for: id }, label), input);

      const cur = () => st.pages[st.sel] || null;
      const outSize = () => size.value.split("x").map(Number);
      const sizeName = () => size.selectedOptions[0].text.split(" (")[0];
      const pad = () => { const v = parseFloat(padIn.value); return Number.isFinite(v) ? v : 6; };

      function place(c, W, H) {
        const cover = fit.value === "cover", m = cover ? 0 : clamp(parseFloat(margin.value) || 0, 0, Math.min(W, H) / 2 - 10);
        const aw = W - 2 * m, ah = H - 2 * m, s = cover ? Math.max(aw / c.w, ah / c.h) : Math.min(aw / c.w, ah / c.h);
        return { s, x: (W - c.w * s) / 2, y: (H - c.h * s) / 2 };
      }
      function drawPreview() {
        const [W, H] = outSize(), px = 2, ctx = prev.getContext("2d");
        prev.width = Math.round(W * px); prev.height = Math.round(H * px);
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, prev.width, prev.height);
        const p = cur(); if (!p) { prevCap.textContent = sizeName() + " · no page loaded"; return; }
        const c = p.crop, pl = place(c, W, H), k = p.canvas.width / p.w;
        ctx.drawImage(p.canvas, c.x * k, c.y * k, c.w * k, c.h * k, pl.x * px, pl.y * px, c.w * pl.s * px, c.h * pl.s * px);
        prevCap.textContent = sizeName() + " · crop " + Math.round(c.w) + " × " + Math.round(c.h) + " pt · scaled to " + Math.round(pl.s * 100) + "%";
      }
      function syncNums() { const p = cur(); if (!p) return; nx.value = Math.round(p.crop.x); ny.value = Math.round(p.crop.y); nw.value = Math.round(p.crop.w); nh.value = Math.round(p.crop.h); }
      function renderThumbs() {
        thumbs.replaceChildren(); let used = 0;
        st.pages.forEach((p, i) => {
          if (p.include) used++;
          const mini = h("span", { class: "tk-lc-mini" }, h("img", { src: p.thumb, alt: "" }),
            h("i", { style: "left:" + p.crop.x / p.w * 100 + "%;top:" + p.crop.y / p.h * 100 + "%;width:" + p.crop.w / p.w * 100 + "%;height:" + p.crop.h / p.h * 100 + "%" }));
          const pick = h("button", { type: "button", class: "tk-lc-pick", "aria-label": "Edit crop for page " + (i + 1), onclick: () => select(i) }, mini);
          const cb = h("input", { type: "checkbox", id: "lc-inc-" + i, checked: p.include });
          cb.addEventListener("change", () => { p.include = cb.checked; renderThumbs(); });
          thumbs.append(h("li", { class: "tk-lc-thumb" + (i === st.sel ? " on" : "") + (p.include ? "" : " off") }, pick, h("label", { class: "tk-lc-inc", for: "lc-inc-" + i }, cb, h("span", { title: p.fileName }, p.tag || "Page " + (i + 1)))));
        });
        count.textContent = st.pages.length ? "· " + used + " of " + st.pages.length + " in PDF" : "";
        dl.disabled = used === 0; dl.textContent = used > 1 ? "Download label PDF (" + used + " labels)" : "Download label PDF";
      }
      async function select(i) {
        st.sel = i; const p = cur(); if (!p) return;
        stage.show(p.canvas, p.w, p.h); stage.setRects([p.crop]); syncNums(); drawPreview(); renderThumbs();
        meta.textContent = "Page " + (i + 1) + " of " + st.pages.length + (p.tag ? " · " + p.tag : "") + " · " + Math.round(p.w) + " × " + Math.round(p.h) + " pt";
        workArea.hidden = false; emptyNote.hidden = true;
      }
      stage.onchange = rects => { const p = cur(); if (!p || !rects[0]) return; p.crop = { ...rects[0] }; syncNums(); drawPreview(); };
      stage.el.addEventListener("pointerup", () => renderThumbs());
      for (const n of [nx, ny, nw, nh]) n.addEventListener("change", () => {
        const p = cur(); if (!p) return;
        p.crop = fitRect({ x: parseFloat(nx.value) || 0, y: parseFloat(ny.value) || 0, w: parseFloat(nw.value) || p.crop.w, h: parseFloat(nh.value) || p.crop.h }, p.w, p.h);
        stage.setRects([p.crop]); syncNums(); drawPreview(); renderThumbs();
      });
      for (const el of [size, fit, margin]) el.addEventListener("input", drawPreview);

      /* adding files */
      async function addFiles(list) {
        const files = list.filter(ACCEPT.pdf.test);
        if (!files.length) { status.set("Choose PDF files.", "error"); return; }
        const before = st.pages.length;
        for (const file of files) {
          status.set("Reading " + file.name + "…");
          try {
            const bytes = await readBytes(file);
            await openPdfLib(bytes, file.name);            /* fails early for password-protected or damaged files */
            const pdf = await openPdfJs(bytes, file.name), fileIdx = st.files.push({ name: file.name, bytes }) - 1;
            for (let n = 1; n <= pdf.numPages; n++) {
              const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 });
              const canvas = await renderPage(pdf, n, { scale: RENDER });
              let tag = "";
              try { const tc = await page.getTextContent(), text = tc.items.map(t => t.str).join(" "), m = text.match(/FMP[A-Z]\d{9,}/) || text.match(/OD\d{12,}/); if (m) tag = m[0]; } catch (e) { /* tag is optional */ }
              const t = document.createElement("canvas"); t.width = 140; t.height = Math.round(140 * canvas.height / canvas.width); t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
              st.pages.push({ fileIdx, pageIdx: n - 1, fileName: file.name, w: vp.width, h: vp.height, canvas, thumb: t.toDataURL("image/jpeg", 0.7), tag, include: true, crop: detectLabel(canvas, vp.width, vp.height, pad()) });
            }
          } catch (e) { status.set(e.message, "error"); renderThumbs(); if (st.pages.length > before) break; return; }
        }
        if (st.pages.length > before) { status.set("Added " + (st.pages.length - before) + " page(s). The label was found on each; check the box, then download.", "ok"); await select(before); }
      }

      /* export */
      dl.addEventListener("click", async () => {
        const list = st.pages.filter(p => p.include); if (!list.length) return;
        dl.disabled = true; progress.hidden = false; progress.value = 0; status.set("Building PDF…");
        try {
          const { PDFDocument, degrees } = await lib("pdflib"), out = await PDFDocument.create(), cache = {}, [W, H] = outSize();
          for (let i = 0; i < list.length; i++) {
            const p = list[i];
            const src = cache[p.fileIdx] || (cache[p.fileIdx] = await PDFDocument.load(st.files[p.fileIdx].bytes, { updateMetadata: false }));
            const [copied] = await out.copyPages(src, [p.pageIdx]), vm = visualMapper(copied);
            const a = vm.map(p.crop.x, vm.vh - p.crop.y - p.crop.h), b = vm.map(p.crop.x + p.crop.w, vm.vh - p.crop.y);
            const box = { left: Math.min(a.x, b.x), bottom: Math.min(a.y, b.y), right: Math.max(a.x, b.x), top: Math.max(a.y, b.y) };
            const emb = await out.embedPage(copied, box), bw = box.right - box.left, bh = box.top - box.bottom;
            const pl = place(p.crop, W, H), s = pl.s, px = pl.x, py = H - pl.y - p.crop.h * s;
            const page = out.addPage([W, H]);
            if (vm.rot === 90) page.drawPage(emb, { x: px, y: py + bw * s, xScale: s, yScale: s, rotate: degrees(-90) });
            else if (vm.rot === 180) page.drawPage(emb, { x: px + bw * s, y: py + bh * s, xScale: s, yScale: s, rotate: degrees(-180) });
            else if (vm.rot === 270) page.drawPage(emb, { x: px + bh * s, y: py, xScale: s, yScale: s, rotate: degrees(-270) });
            else page.drawPage(emb, { x: px, y: py, xScale: s, yScale: s });
            progress.value = Math.round((i + 1) / list.length * 95); await new Promise(r => setTimeout(r));
          }
          out.setProducer("MarketTech Applications");
          const bytes = await out.save(), name = "labels-" + size.value.split("x").map(v => Math.round(Number(v) / 72 * 10) / 10).join("x") + "in-" + list.length + ".pdf";
          downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
          status.set("Saved " + list.length + " label" + (list.length > 1 ? "s" : "") + " (" + fmtSize(bytes.length) + "). Print at 100% scale, not “fit to page”.", "ok");
        } catch (e) { console.error(e); status.set(e instanceof UserError ? e.message : "Could not build the PDF: " + e.message, "error"); }
        finally { dl.disabled = !st.pages.some(p => p.include); progress.value = 100; }
      });

      /* layout */
      const zone = dropZone({ id: "lc-file", accept: ACCEPT.pdf, multiple: true, text: "Drop order PDFs here or click to choose", hint: "One or many A4 order sheets. Each page becomes a label.", onFiles: addFiles });
      const clear = h("button", { class: "tk-btn", type: "button", onclick: () => { st.files = []; st.pages = []; st.sel = -1; workArea.hidden = true; emptyNote.hidden = false; status.set(""); renderThumbs(); drawPreview(); progress.hidden = true; } }, "Clear all");
      const detectOne = h("button", { class: "tk-btn", type: "button", onclick: () => { const p = cur(); if (!p) return; p.crop = detectLabel(p.canvas, p.w, p.h, pad()); stage.setRects([p.crop]); syncNums(); drawPreview(); renderThumbs(); } }, "Find label again");
      const detectAll = h("button", { class: "tk-btn", type: "button", onclick: () => { st.pages.forEach(p => { p.crop = detectLabel(p.canvas, p.w, p.h, pad()); }); const p = cur(); if (p) { stage.setRects([p.crop]); syncNums(); } drawPreview(); renderThumbs(); } }, "Find labels on all pages");
      const ratio = h("button", { class: "tk-btn", type: "button", onclick: () => {
        const p = cur(); if (!p) return; const [W, H] = outSize(), r = W / H, c = p.crop, cx = c.x + c.w / 2, cy = c.y + c.h / 2; let w = c.w, hh = c.h;
        if (w / hh < r) w = hh * r; else hh = w / r; if (w > p.w) { w = p.w; hh = w / r; } if (hh > p.h) { hh = p.h; w = hh * r; }
        p.crop = fitRect({ x: cx - w / 2, y: cy - hh / 2, w, h: hh }, p.w, p.h); stage.setRects([p.crop]); syncNums(); drawPreview(); renderThumbs();
      } }, "Match paper shape");
      const applyAll = h("button", { class: "tk-btn", type: "button", onclick: () => { const p = cur(); if (!p) return; st.pages.forEach(q => { q.crop = fitRect(p.crop, q.w, q.h); }); drawPreview(); renderThumbs(); } }, "Use this crop on all pages");

      let emptyNote;
      const workArea = h("div", { hidden: true },
        meta, h("div", { class: "tk-stagewrap" }, stage.el),
        h("div", { class: "tk-nums" }, field("X (pt)", nx, "lc-x"), field("Y (pt)", ny, "lc-y"), field("Width", nw, "lc-w"), field("Height", nh, "lc-h")),
        h("div", { class: "tk-row" }, detectOne, ratio, applyAll, detectAll),
        h("p", { class: "tk-note" }, "Drag the box or its handles. Arrow keys move it 1 pt, or 10 pt with Shift."));

      root.append(h("div", { class: "tk-lc" },
        h("div", { class: "tk-col" },
          h("section", { class: "tk-panel" }, h("h2", {}, "Order PDFs"), zone, h("div", { class: "tk-row" }, clear)),
          h("section", { class: "tk-panel" }, h("h2", {}, "Labels ", count), thumbs),
          h("section", { class: "tk-panel" }, h("h2", {}, "Output"), field("Paper size", size, "lc-size"), field("Placement", fit, "lc-fit"),
            h("div", { class: "tk-two" }, field("Margin (pt)", margin, "lc-margin"), field("Find-label padding (pt)", padIn, "lc-pad")))),
        h("section", { class: "tk-panel tk-lc-main" }, h("h2", {}, "Crop area"),
          emptyNote = h("p", { class: "tk-note" }, "Add an order PDF. The label is found automatically: it is everything above the dashed line that separates the label from the invoice."), workArea),
        h("section", { class: "tk-panel tk-col" }, h("h2", {}, "Printed page"), h("div", { class: "tk-lc-prevwrap" }, prev), prevCap, dl, progress, status)));
            drawPreview(); renderThumbs();
    }
  }
};

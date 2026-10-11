/* Page-level tools: merge, split, remove, extract, rotate, page numbers, watermark, metadata. */
import { lib, UserError, openPdfLib, parseRanges, parseGroups, baseName, readBytes, canvasBlob } from "/applications/core.js";

/* Maps a point measured on the displayed page (origin bottom-left, after /Rotate) to PDF user space. */
export function visualMapper(page) {
  const mb = page.getCropBox();
  const W = mb.width, H = mb.height, x0 = mb.x, y0 = mb.y;
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const vw = rot % 180 ? H : W, vh = rot % 180 ? W : H;
  const map = (vx, vy) => {
    if (rot === 90) return { x: x0 + W - vy, y: y0 + vx };
    if (rot === 180) return { x: x0 + W - vx, y: y0 + H - vy };
    if (rot === 270) return { x: x0 + vy, y: y0 + H - vx };
    return { x: x0 + vx, y: y0 + vy };
  };
  return { vw, vh, rot, map };
}

async function copyPagesInto(out, src, indices) {
  const pages = await out.copyPages(src, indices);
  pages.forEach(p => out.addPage(p));
}
function pdfOut(bytes, name) { return { name, data: bytes, mime: "application/pdf" }; }
async function newDoc() { const { PDFDocument } = await lib("pdflib"); return PDFDocument.create(); }

/* A watermark / number stamp that can be text (vector when possible) or an image. */
async function makeTextStamp(doc, text, size, rgbColor) {
  const { StandardFonts, rgb, degrees } = await lib("pdflib");
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const [r, g, b] = rgbColor;
  try {
    const w = font.widthOfTextAtSize(text, size);
    return { w, h: size * 0.72, draw: (page, x, y, angle, opacity) => page.drawText(text, { x, y, size, font, color: rgb(r, g, b), opacity, rotate: degrees(angle) }) };
  } catch (e) {
    /* Characters outside the standard font (for example Hindi or Tamil): render the text to an image instead. */
    const px = Math.max(24, Math.round(size * 3));
    const c = document.createElement("canvas"); const ctx = c.getContext("2d");
    ctx.font = "bold " + px + "px system-ui, 'Noto Sans', 'Segoe UI', sans-serif";
    const w = Math.ceil(ctx.measureText(text).width) + 8, hh = Math.ceil(px * 1.4);
    c.width = w; c.height = hh; ctx.font = "bold " + px + "px system-ui, 'Noto Sans', 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgb(" + [r, g, b].map(v => Math.round(v * 255)).join(",") + ")"; ctx.textBaseline = "middle"; ctx.fillText(text, 4, hh / 2);
    const img = await doc.embedPng(await readBytes(await canvasBlob(c, "image/png")));
    const scale = size / px;
    return { w: w * scale, h: hh * scale * 0.8, draw: (page, x, y, angle, opacity) => page.drawImage(img, { x, y, width: w * scale, height: hh * scale, opacity, rotate: degrees(angle) }) };
  }
}
function hexToRgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

/* Places a stamp so its centre sits at visual (cx, cy), rotated by `ang` degrees on the displayed page. */
function drawStampCentered(page, vm, stamp, cx, cy, ang, opacity) {
  const rad = ang * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  const hx = stamp.w / 2, hy = stamp.h / 2;
  const blx = cx - (c * hx - s * hy), bly = cy - (s * hx + c * hy);
  const p = vm.map(blx, bly);
  stamp.draw(page, p.x, p.y, ang + vm.rot, opacity);
}

const specs = {};

specs["merge-pdf"] = {
  accept: "pdf", multiple: true, min: 2, reorder: true, action: "Merge PDFs", zipName: "merged",
  dropText: "Drop PDF files here or click to choose",
  intro: "Files are joined in the order shown below. Use the arrows or drag a row to change the order.",
  async run({ files, job }) {
    const out = await newDoc();
    for (let i = 0; i < files.length; i++) {
      const src = await openPdfLib(await files[i].bytes(), files[i].name);
      await copyPagesInto(out, src, src.getPageIndices());
      job.progress(Math.round((i + 1) / files.length * 90), "Added " + (i + 1) + " of " + files.length + " files");
      await job.tick();
    }
    out.setProducer("MarketTech Applications"); out.setCreator("MarketTech Applications");
    return [pdfOut(await out.save(), "merged-" + files.length + "-files.pdf")];
  }
};

specs["split-pdf"] = {
  accept: "pdf", multiple: false, action: "Split PDF", zipName: "split",
  options: [
    { id: "mode", type: "select", label: "Split by", default: "ranges", choices: [["ranges", "Page ranges (one file per range)"], ["every", "Every N pages"], ["each", "Every page as its own file"]] },
    { id: "ranges", type: "text", label: "Ranges", default: "1-3, 4-6", help: "Separate groups with commas. Each group becomes its own PDF. Example: 1-3, 4, 5-", show: o => o.mode === "ranges" },
    { id: "n", type: "number", label: "Pages per file", default: 2, min: 1, show: o => o.mode === "every" }
  ],
  async run({ files, opts, job }) {
    const f = files[0], src = await openPdfLib(await f.bytes(), f.name), total = src.getPageCount();
    let groups;
    if (opts.mode === "ranges") groups = parseGroups(opts.ranges, total);
    else if (opts.mode === "every") {
      const n = Math.max(1, Math.floor(opts.n || 1)); groups = [];
      for (let s = 1; s <= total; s += n) groups.push(Array.from({ length: Math.min(n, total - s + 1) }, (_, k) => s + k));
    } else groups = Array.from({ length: total }, (_, i) => [i + 1]);
    const pad = String(groups.length).length, outputs = [];
    for (let i = 0; i < groups.length; i++) {
      const out = await newDoc();
      await copyPagesInto(out, src, groups[i].map(p => p - 1));
      const label = groups[i].length === 1 ? "page-" + groups[i][0] : "pages-" + groups[i][0] + "-" + groups[i][groups[i].length - 1];
      outputs.push(pdfOut(await out.save(), baseName(f.name) + "-" + String(i + 1).padStart(pad, "0") + "-" + label + ".pdf"));
      job.progress(Math.round((i + 1) / groups.length * 95), "Created " + (i + 1) + " of " + groups.length + " files");
      await job.tick();
    }
    return outputs;
  }
};

specs["remove-pages"] = {
  accept: "pdf", multiple: false, action: "Remove pages",
  options: [{ id: "pages", type: "text", label: "Pages to remove", placeholder: "e.g. 2, 5-7", help: "Use page numbers and ranges. You can also write odd, even or last." }],
  async run({ files, opts, job }) {
    const f = files[0], src = await openPdfLib(await f.bytes(), f.name), total = src.getPageCount();
    const drop = new Set(parseRanges(opts.pages, total));
    const keep = []; for (let i = 1; i <= total; i++) if (!drop.has(i)) keep.push(i - 1);
    if (!keep.length) throw new UserError("That would remove every page. Keep at least one page.");
    const out = await newDoc(); await copyPagesInto(out, src, keep); job.progress(80);
    return { outputs: [pdfOut(await out.save(), baseName(f.name) + "-removed-" + drop.size + "-pages.pdf")], note: "Removed " + drop.size + " of " + total + " pages. " + keep.length + " remain." };
  }
};

specs["extract-pages"] = {
  accept: "pdf", multiple: false, action: "Extract pages",
  options: [{ id: "pages", type: "text", label: "Pages to keep", placeholder: "e.g. 1-3, 8", help: "Pages are kept in their original order." }],
  async run({ files, opts, job }) {
    const f = files[0], src = await openPdfLib(await f.bytes(), f.name), total = src.getPageCount();
    const keep = parseRanges(opts.pages, total);
    const out = await newDoc(); await copyPagesInto(out, src, keep.map(p => p - 1)); job.progress(80);
    return { outputs: [pdfOut(await out.save(), baseName(f.name) + "-extract-" + keep.length + "-pages.pdf")], note: "Extracted " + keep.length + " of " + total + " pages." };
  }
};

specs["rotate-pdf"] = {
  accept: "pdf", multiple: false, action: "Rotate PDF",
  options: [
    { id: "angle", type: "select", label: "Rotate", default: "90", choices: [["90", "90° clockwise"], ["180", "180°"], ["270", "90° counter-clockwise"]] },
    { id: "pages", type: "text", label: "Pages", default: "all", help: "all, odd, even, or numbers and ranges such as 1-3, 5" }
  ],
  async run({ files, opts, job }) {
    const { degrees } = await lib("pdflib");
    const f = files[0], doc = await openPdfLib(await f.bytes(), f.name), total = doc.getPageCount();
    const sel = parseRanges(opts.pages, total), add = Number(opts.angle);
    const pages = doc.getPages();
    for (const p of sel) { const pg = pages[p - 1]; pg.setRotation(degrees((((pg.getRotation().angle + add) % 360) + 360) % 360)); }
    job.progress(80);
    return { outputs: [pdfOut(await doc.save(), baseName(f.name) + "-rotated.pdf")], note: "Rotated " + sel.length + " of " + total + " pages." };
  }
};

specs["add-page-numbers"] = {
  accept: "pdf", multiple: false, action: "Add page numbers",
  options: [
    { id: "pos", type: "select", label: "Position", default: "bc", choices: [["bc", "Bottom centre"], ["br", "Bottom right"], ["bl", "Bottom left"], ["tc", "Top centre"], ["tr", "Top right"], ["tl", "Top left"]] },
    { id: "fmt", type: "select", label: "Format", default: "{n}", choices: [["{n}", "1"], ["Page {n}", "Page 1"], ["{n} / {total}", "1 / 10"], ["Page {n} of {total}", "Page 1 of 10"]] },
    { id: "start", type: "number", label: "First number", default: 1, min: 0 },
    { id: "size", type: "number", label: "Font size (pt)", default: 11, min: 6, max: 48 },
    { id: "margin", type: "number", label: "Distance from edge (pt)", default: 24, min: 6, max: 120 },
    { id: "pages", type: "text", label: "Number these pages", default: "all", help: "all, odd, even, or ranges such as 2-10. Numbering counts only the pages you pick." }
  ],
  async run({ files, opts, job }) {
    const { StandardFonts, rgb, degrees } = await lib("pdflib");
    const f = files[0], doc = await openPdfLib(await f.bytes(), f.name), total = doc.getPageCount();
    const sel = parseRanges(opts.pages, total), font = await doc.embedFont(StandardFonts.Helvetica);
    const size = opts.size || 11, margin = opts.margin || 24, start = Number.isFinite(opts.start) ? opts.start : 1;
    const pages = doc.getPages();
    sel.forEach((pn, idx) => {
      const page = pages[pn - 1], vm = visualMapper(page);
      const text = opts.fmt.replace("{n}", String(start + idx)).replace("{total}", String(start + sel.length - 1));
      const w = font.widthOfTextAtSize(text, size);
      const col = opts.pos[1], row = opts.pos[0];
      const vx = col === "l" ? margin : col === "r" ? vm.vw - margin - w : (vm.vw - w) / 2;
      const vy = row === "b" ? margin : vm.vh - margin - size * 0.72;
      const p = vm.map(vx, vy);
      page.drawText(text, { x: p.x, y: p.y, size, font, color: rgb(0.1, 0.1, 0.1), rotate: degrees(vm.rot) });
    });
    job.progress(80);
    return { outputs: [pdfOut(await doc.save(), baseName(f.name) + "-numbered.pdf")], note: "Numbered " + sel.length + " pages." };
  }
};

specs["add-watermark"] = {
  accept: "pdf", multiple: false, action: "Add watermark",
  options: [
    { id: "kind", type: "select", label: "Watermark type", default: "text", choices: [["text", "Text"], ["image", "Image (PNG or JPG)"]] },
    { id: "text", type: "text", label: "Text", default: "CONFIDENTIAL", show: o => o.kind === "text" },
    { id: "image", type: "file", label: "Image", accept: "image/png,image/jpeg,.png,.jpg,.jpeg", show: o => o.kind === "image" },
    { id: "color", type: "color", label: "Colour", default: "#b3261e", show: o => o.kind === "text" },
    { id: "size", type: "number", label: "Text size (pt)", default: 64, min: 8, max: 300, show: o => o.kind === "text" },
    { id: "scale", type: "range", label: "Image width (% of page)", default: 50, min: 5, max: 100, step: 5, show: o => o.kind === "image" },
    { id: "opacity", type: "range", label: "Opacity (%)", default: 25, min: 5, max: 100, step: 5 },
    { id: "angle", type: "number", label: "Rotation (degrees, anticlockwise)", default: 45, min: -180, max: 180 },
    { id: "layout", type: "select", label: "Layout", default: "center", choices: [["center", "One, centred"], ["tile", "Repeat across the page"]] },
    { id: "pages", type: "text", label: "Pages", default: "all" }
  ],
  async run({ files, opts, job }) {
    const { degrees } = await lib("pdflib");
    const f = files[0], doc = await openPdfLib(await f.bytes(), f.name), total = doc.getPageCount();
    const sel = parseRanges(opts.pages, total), opacity = (opts.opacity || 25) / 100;
    let stamp;
    if (opts.kind === "image") {
      if (!opts.image) throw new UserError("Choose an image for the watermark.");
      const bytes = await readBytes(opts.image);
      const img = /png$/i.test(opts.image.type) || /\.png$/i.test(opts.image.name) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const pageW = doc.getPages()[sel[0] - 1].getSize().width, w = pageW * (opts.scale || 50) / 100, hh = w * img.height / img.width;
      stamp = { w, h: hh, draw: (page, x, y, angle, op) => page.drawImage(img, { x, y, width: w, height: hh, opacity: op, rotate: degrees(angle) }) };
    } else {
      if (!String(opts.text || "").trim()) throw new UserError("Type the watermark text.");
      stamp = await makeTextStamp(doc, String(opts.text).trim(), opts.size || 64, hexToRgb(opts.color));
    }
    const ang = Number.isFinite(opts.angle) ? opts.angle : 45, pages = doc.getPages();
    for (let i = 0; i < sel.length; i++) {
      const page = pages[sel[i] - 1], vm = visualMapper(page);
      if (opts.layout === "tile") {
        const gx = stamp.w * 1.6 + 40, gy = stamp.h * 4 + 60;
        let row = 0;
        for (let y = gy / 2; y < vm.vh + gy; y += gy, row++) for (let x = (row % 2 ? gx / 2 : 0); x < vm.vw + gx; x += gx) drawStampCentered(page, vm, stamp, x, y, ang, opacity);
      } else drawStampCentered(page, vm, stamp, vm.vw / 2, vm.vh / 2, ang, opacity);
      job.progress(Math.round((i + 1) / sel.length * 90));
      if (i % 5 === 4) await job.tick();
    }
    return { outputs: [pdfOut(await doc.save(), baseName(f.name) + "-watermarked.pdf")], note: "Watermarked " + sel.length + " pages." };
  }
};

specs["edit-metadata"] = {
  accept: "pdf", multiple: false, action: "Save PDF with new details",
  options: [
    { id: "title", type: "text", label: "Title" }, { id: "author", type: "text", label: "Author" },
    { id: "subject", type: "text", label: "Subject" }, { id: "keywords", type: "text", label: "Keywords", help: "Separate with commas." },
    { id: "creator", type: "text", label: "Creator application" },
    { id: "clear", type: "checkbox", label: "Remove all of the above instead", help: "Blank title, author, subject, keywords and creator." }
  ],
  async onFiles(files, ui) {
    if (!files.length || files[0]._meta) return;
    try {
      const f = files[0], doc = await openPdfLib(await f.bytes(), f.name); f._meta = true;
      ui.setOption("title", doc.getTitle() || ""); ui.setOption("author", doc.getAuthor() || ""); ui.setOption("subject", doc.getSubject() || "");
      ui.setOption("keywords", doc.getKeywords() || ""); ui.setOption("creator", doc.getCreator() || "");
    } catch (e) { ui.status.set(e.message, "error"); }
  },
  async run({ files, opts, job }) {
    const f = files[0], doc = await openPdfLib(await f.bytes(), f.name);
    const v = k => opts.clear ? "" : String(opts[k] || "");
    doc.setTitle(v("title")); doc.setAuthor(v("author")); doc.setSubject(v("subject")); doc.setCreator(v("creator"));
    doc.setKeywords(v("keywords").split(",").map(s => s.trim()).filter(Boolean));
    doc.setProducer("MarketTech Applications"); job.progress(80);
    return [pdfOut(await doc.save(), baseName(f.name) + "-details.pdf")];
  }
};

export default specs;

/* Conversion tools: images to PDF, PDF to images/PowerPoint, text extraction, PDF to Word (text), compress, grayscale. */
import { lib, UserError, openPdfLib, openPdfJs, renderPage, canvasBlob, parseRanges, baseName, readBytes, isPdf, h } from "/applications/core.js";

const specs = {};
const MAX_PIXELS = 120e6;

function checkCanvas(w, h2) {
  if (w * h2 > MAX_PIXELS || w > 16000 || h2 > 16000) throw new UserError("This page is too large to render at that quality. Choose a lower DPI.");
}

/* ---------- images to PDF ---------- */
async function decodeToCanvas(file) {
  const bmp = await createImageBitmap(file).catch(() => { throw new UserError("“" + file.name + "” could not be read as an image."); });
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d"); ctx.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
  return c;
}
async function hasAlpha(canvas) {
  const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 255) return true;
  return false;
}

specs["images-to-pdf"] = {
  accept: "image", multiple: true, min: 1, reorder: true, action: "Create PDF", zipName: "images",
  dropText: "Drop images here or click to choose", dropHint: "JPG, PNG, WebP, GIF or BMP. Each image becomes one page.",
  options: [
    { id: "size", type: "select", label: "Page size", default: "a4", choices: [["a4", "A4"], ["letter", "US Letter"], ["a6", "A6 (105 × 148 mm)"], ["label", "4 × 6 in label"], ["fit", "Same size as the image"]] },
    { id: "orient", type: "select", label: "Orientation", default: "auto", choices: [["auto", "Automatic"], ["portrait", "Portrait"], ["landscape", "Landscape"]], show: o => o.size !== "fit" },
    { id: "margin", type: "select", label: "Margin", default: "18", choices: [["0", "None"], ["18", "Small"], ["36", "Large"]] }
  ],
  async run({ files, opts, job }) {
    const { PDFDocument } = await lib("pdflib"), doc = await PDFDocument.create();
    const sizes = { a4: [595.28, 841.89], letter: [612, 792], a6: [297.64, 419.53], label: [288, 432] };
    const margin = Number(opts.margin) || 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const canvas = await decodeToCanvas(f.file);
      const png = f.file.type === "image/png" || (await hasAlpha(canvas));
      const bytes = new Uint8Array(await (await canvasBlob(canvas, png ? "image/png" : "image/jpeg", 0.95)).arrayBuffer());
      const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      let pw, ph;
      if (opts.size === "fit") { const k = Math.min(1, 1200 / Math.max(img.width, img.height)) * 0.75; pw = img.width * k + margin * 2; ph = img.height * k + margin * 2; }
      else {
        [pw, ph] = sizes[opts.size];
        const land = opts.orient === "landscape" || (opts.orient === "auto" && img.width > img.height);
        if (land !== pw > ph) [pw, ph] = [ph, pw];
      }
      const page = doc.addPage([pw, ph]);
      const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
      const w = img.width * s, hh = img.height * s;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
      job.progress(Math.round((i + 1) / files.length * 92), "Added image " + (i + 1) + " of " + files.length); await job.tick();
    }
    doc.setProducer("MarketTech Applications");
    return [{ name: files.length === 1 ? baseName(files[0].name) + ".pdf" : "images-" + files.length + "-pages.pdf", data: await doc.save(), mime: "application/pdf" }];
  }
};

/* ---------- PDF to images ---------- */
specs["pdf-to-images"] = {
  accept: "pdf", multiple: false, action: "Convert to images", zipName: "pages",
  options: [
    { id: "fmt", type: "select", label: "Format", default: "jpeg", choices: [["jpeg", "JPG (smaller files)"], ["png", "PNG (sharper text)"]] },
    { id: "dpi", type: "select", label: "Quality", default: "150", choices: [["72", "Screen (72 DPI)"], ["110", "Good (110 DPI)"], ["150", "High (150 DPI)"], ["200", "Print (200 DPI)"], ["300", "Very high (300 DPI)"]] },
    { id: "pages", type: "text", label: "Pages", default: "all" }
  ],
  async run({ files, opts, job }) {
    const f = files[0], pdf = await openPdfJs(await f.bytes(), f.name), sel = parseRanges(opts.pages, pdf.numPages);
    const ext = opts.fmt === "png" ? "png" : "jpg", pad = String(pdf.numPages).length, out = [];
    for (let i = 0; i < sel.length; i++) {
      const page = await pdf.getPage(sel[i]), vp = page.getViewport({ scale: Number(opts.dpi) / 72 });
      checkCanvas(vp.width, vp.height);
      const canvas = await renderPage(pdf, sel[i], { scale: Number(opts.dpi) / 72 });
      const blob = await canvasBlob(canvas, "image/" + opts.fmt, 0.92);
      out.push({ name: baseName(f.name) + "-page-" + String(sel[i]).padStart(pad, "0") + "." + ext, data: blob, mime: "image/" + opts.fmt });
      canvas.width = canvas.height = 1;
      job.progress(Math.round((i + 1) / sel.length * 95), "Converted page " + sel[i] + " (" + (i + 1) + " of " + sel.length + ")"); await job.tick();
    }
    return out;
  }
};

/* ---------- PDF to PowerPoint (one full-page image per slide) ---------- */
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PPTX_MAX_FILE_BYTES = 150 * 1024 * 1024;
const PPTX_MAX_SLIDES = 200;
const PPTX_MAX_PAGE_PIXELS = 32e6;
const PPTX_MAX_EMBEDDED_BYTES = 80 * 1024 * 1024;
const MAX_SLIDE_INCHES = 13.333333;

function powerpointPageSize(mode, firstPageWidth, firstPageHeight) {
  if (mode === "wide") return { layout: "LAYOUT_WIDE", width: 13.333333, height: 7.5 };
  if (mode === "standard") return { layout: "LAYOUT_4x3", width: 10, height: 7.5 };
  const aspect = firstPageWidth / firstPageHeight;
  if (!Number.isFinite(aspect) || aspect <= 0) throw new UserError("The first selected page has an invalid size.");
  const width = aspect >= 1 ? MAX_SLIDE_INCHES : MAX_SLIDE_INCHES * aspect;
  const height = aspect >= 1 ? MAX_SLIDE_INCHES / aspect : MAX_SLIDE_INCHES;
  return { layout: "pdf-first-page", width, height };
}

function fitImageToSlide(aspect, slideWidth, slideHeight) {
  let width = slideWidth, height = width / aspect;
  if (height > slideHeight) { height = slideHeight; width = height * aspect; }
  return { x: (slideWidth - width) / 2, y: (slideHeight - height) / 2, w: width, h: height };
}

specs["pdf-to-powerpoint"] = {
  accept: "pdf", multiple: false, action: "Convert to PowerPoint",
  intro: "Each selected PDF page becomes a full-slide picture. The page appearance is preserved, but its text and graphics will not be individually editable. Pages with a different shape or orientation are fitted without cropping.",
  options: [
    { id: "pages", type: "text", label: "Pages to convert", default: "all", help: "Use all, odd, even, or page ranges such as 1-4, 6." },
    { id: "slideSize", type: "select", label: "PowerPoint slide size", default: "match", choices: [["match", "Match the first selected PDF page"], ["wide", "Widescreen (16:9)"], ["standard", "Standard (4:3)"]], help: "All slides share one size. Other page shapes are centered on a white background." },
    { id: "dpi", type: "select", label: "Image quality", default: "200", choices: [["150", "Standard (150 DPI)"], ["200", "High (200 DPI)"], ["300", "Print (300 DPI)"]], help: "Higher resolution keeps small details clearer but uses more memory and creates a larger PowerPoint." },
    { id: "format", type: "select", label: "Image format", default: "jpeg", choices: [["jpeg", "JPEG · smaller file"], ["png", "PNG · crisp text, larger file"]] }
  ],
  async run({ files, opts, job }) {
    const file = files[0];
    if (file.size > PPTX_MAX_FILE_BYTES) throw new UserError("This PDF is over 150 MB. Split it into smaller files before converting.");
    job.progress(1, "Opening PDF…");
    const pdf = await openPdfJs(await file.bytes(), file.name);
    const pages = parseRanges(opts.pages, pdf.numPages);
    if (pages.length > PPTX_MAX_SLIDES) throw new UserError("This export has more than 200 slides. Convert a smaller page range, or split the PDF first.");
    if (!pages.length) throw new UserError("Choose at least one page to convert.");

    const firstPage = await pdf.getPage(pages[0]);
    const firstSize = firstPage.getViewport({ scale: 1 });
    const size = powerpointPageSize(opts.slideSize, firstSize.width, firstSize.height);
    const PptxGenJS = await lib("pptxgenjs");
    const pptx = new PptxGenJS();
    if (size.layout === "pdf-first-page") pptx.defineLayout({ name: size.layout, width: size.width, height: size.height });
    pptx.layout = size.layout;
    pptx.author = "MarketTech Applications";
    pptx.company = "MarketTech Applications";
    pptx.title = baseName(file.name);
    pptx.subject = "Image-based PowerPoint slides converted from a PDF";
    pptx.lang = "en-IN";

    const dpi = Number(opts.dpi);
    const scale = dpi / 72;
    const imageType = opts.format === "png" ? "image/png" : "image/jpeg";
    const slideWidth = size.width, slideHeight = size.height;
    let embeddedBytes = 0;

    for (let i = 0; i < pages.length; i++) {
      const pageNumber = pages[i];
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const pixelWidth = Math.ceil(viewport.width), pixelHeight = Math.ceil(viewport.height);
      if (pixelWidth > 16000 || pixelHeight > 16000 || pixelWidth * pixelHeight > PPTX_MAX_PAGE_PIXELS) {
        throw new UserError("Page " + pageNumber + " is too large at " + dpi + " DPI. Choose a lower image quality.");
      }

      job.progress(Math.round(5 + i / pages.length * 83), "Rendering page " + pageNumber + " of " + pdf.numPages + "…");
      const canvas = await renderPage(pdf, pageNumber, { scale });
      let imageData;
      try { imageData = canvas.toDataURL(imageType, 0.92); }
      catch { canvas.width = canvas.height = 1; throw new UserError("Page " + pageNumber + " could not be encoded. Choose a lower quality or JPEG format."); }
      canvas.width = canvas.height = 1;
      if (!imageData || imageData === "data:,") throw new UserError("Page " + pageNumber + " could not be encoded. Choose a lower quality or JPEG format.");

      const payload = imageData.slice(imageData.indexOf(",") + 1);
      embeddedBytes += Math.ceil(payload.length * 0.75);
      if (embeddedBytes > PPTX_MAX_EMBEDDED_BYTES) {
        throw new UserError("The slide images would exceed 80 MB. Select fewer pages, lower the image quality, or choose JPEG.");
      }

      const aspect = viewport.width / viewport.height;
      const position = fitImageToSlide(aspect, slideWidth, slideHeight);
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };
      slide.addImage({ data: imageData, ...position });
      job.progress(Math.round(5 + (i + 1) / pages.length * 83), "Rendered page " + pageNumber + " (" + (i + 1) + " of " + pages.length + ")");
      await job.tick();
    }

    job.progress(92, "Building PowerPoint…");
    const packed = await pptx.write({ outputType: "blob", compression: true });
    const data = new Blob([packed], { type: PPTX_MIME });
    const sizeLabel = opts.slideSize === "wide" ? "16:9 widescreen" : opts.slideSize === "standard" ? "4:3 standard" : "matched to the first selected PDF page";
    const formatLabel = opts.format === "png" ? "PNG" : "JPEG";
    return {
      outputs: [{ name: baseName(file.name) + ".pptx", data, mime: PPTX_MIME }],
      note: "Created " + pages.length + " image-based slides at " + dpi + " DPI (" + formatLabel + "); slide size " + sizeLabel + ". Text inside the slides is not individually editable."
    };
  }
};

/* ---------- text extraction ---------- */
export async function pageLines(pdf, n) {
  const page = await pdf.getPage(n), tc = await page.getTextContent();
  const lines = []; let cur = "", lastY = null, lastEnd = null;
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    const y = it.transform[5], x = it.transform[4];
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, (it.height || 8) * 0.5)) { lines.push(cur); cur = ""; lastEnd = null; }
    else if (lastEnd !== null && x - lastEnd > 1.5 && cur && !/\s$/.test(cur) && !/^\s/.test(it.str)) cur += " ";
    cur += it.str; lastY = y; lastEnd = x + (it.width || 0);
    if (it.hasEOL) { lines.push(cur); cur = ""; lastY = null; lastEnd = null; }
  }
  if (cur) lines.push(cur);
  return lines.map(s => s.replace(/\s+$/, ""));
}

specs["extract-text"] = {
  accept: "pdf", multiple: true, reorder: false, action: "Extract text", zipName: "text",
  options: [{ id: "marks", type: "checkbox", label: "Mark each page (for example “--- Page 3 ---”)", default: true }],
  async run({ files, opts, job }) {
    const out = []; let empty = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i], pdf = await openPdfJs(await f.bytes(), f.name), parts = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const lines = await pageLines(pdf, p);
        parts.push((opts.marks ? "--- Page " + p + " ---\n" : "") + lines.join("\n"));
        job.progress(Math.round(((i + p / pdf.numPages) / files.length) * 95), "Reading " + f.name + ", page " + p); if (p % 5 === 0) await job.tick();
      }
      const text = parts.join("\n\n");
      if (!text.replace(/--- Page \d+ ---/g, "").trim()) empty++;
      out.push({ name: baseName(f.name) + ".txt", data: new Blob([text], { type: "text/plain;charset=utf-8" }), mime: "text/plain" });
    }
    return { outputs: out, note: empty ? "No selectable text was found in " + empty + " file(s). Scanned PDFs are pictures of text and need OCR, which this toolkit does not include yet." : "" };
  }
};

/* ---------- PDF to Word (text only) ---------- */
const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function buildDocx(pages) {
  const JSZip = await lib("jszip"), zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  let body = "";
  pages.forEach((lines, i) => {
    if (i > 0) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    for (const line of lines) body += '<w:p><w:r><w:t xml:space="preserve">' + xmlEsc(line) + "</w:t></w:r></w:p>";
  });
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>');
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}
specs["pdf-to-word"] = {
  accept: "pdf", multiple: false, action: "Convert to Word",
  intro: "This makes an editable Word file from the text in the PDF. Layout, tables, fonts and pictures are not kept. For exact layout, use a desktop converter.",
  async run({ files, job }) {
    const f = files[0], pdf = await openPdfJs(await f.bytes(), f.name), pages = [];
    for (let p = 1; p <= pdf.numPages; p++) { pages.push(await pageLines(pdf, p)); job.progress(Math.round(p / pdf.numPages * 90), "Reading page " + p + " of " + pdf.numPages); if (p % 5 === 0) await job.tick(); }
    if (!pages.some(l => l.join("").trim())) throw new UserError("No selectable text was found. This looks like a scanned PDF, which needs OCR.");
    return [{ name: baseName(f.name) + ".docx", data: await buildDocx(pages), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }];
  }
};

/* ---------- raster tools: compress and grayscale ---------- */
async function rasterise(pdfBytes, name, { dpi, quality, gray, job }) {
  const { PDFDocument } = await lib("pdflib"), pdf = await openPdfJs(pdfBytes, name), out = await PDFDocument.create();
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: dpi / 72 });
    checkCanvas(vp.width, vp.height);
    const canvas = await renderPage(pdf, p, { scale: dpi / 72 });
    if (gray) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true }), img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; d[i] = d[i + 1] = d[i + 2] = v; }
      ctx.putImageData(img, 0, 0);
    }
    const jpg = await out.embedJpg(new Uint8Array(await (await canvasBlob(canvas, "image/jpeg", quality)).arrayBuffer()));
    const np = out.addPage([base.width, base.height]); np.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
    canvas.width = canvas.height = 1;
    job.progress(Math.round(p / pdf.numPages * 95), "Processed page " + p + " of " + pdf.numPages); await job.tick();
  }
  out.setProducer("MarketTech Applications");
  return out.save();
}
const kb = n => n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(2) + " MB";

specs["compress-pdf"] = {
  accept: "pdf", multiple: false, action: "Compress PDF",
  options: [
    { id: "mode", type: "select", label: "Compression", default: "balanced", choices: [["lossless", "Light: keep text sharp (small saving)"], ["balanced", "Balanced: pages become images (good saving)"], ["strong", "Strong: smaller images (largest saving)"]] }
  ],
  intro: "Balanced and Strong turn each page into a picture. File size drops a lot, but text can no longer be selected or searched.",
  async run({ files, opts, job }) {
    const f = files[0], before = f.size, bytes = await f.bytes();
    let data;
    if (opts.mode === "lossless") {
      const doc = await openPdfLib(bytes, f.name); doc.setProducer("MarketTech Applications"); doc.setCreator(""); job.progress(60);
      data = await doc.save({ useObjectStreams: true });
    } else data = await rasterise(bytes, f.name, { dpi: opts.mode === "strong" ? 90 : 130, quality: opts.mode === "strong" ? 0.55 : 0.72, gray: false, job });
    let after = data.length;
    if (after >= before) {
      /* Rebuilding made it bigger (already compact, or mostly text). Hand back the original bytes instead of a worse file. */
      return { outputs: [{ name: baseName(f.name) + "-compressed.pdf", data: bytes, mime: "application/pdf" }], note: "This PDF is already compact (" + kb(before) + "), so it was left unchanged. Try Strong if it is full of photos." };
    }
    const pct = Math.round((1 - after / before) * 100);
    return { outputs: [{ name: baseName(f.name) + "-compressed.pdf", data, mime: "application/pdf" }], note: "Before " + kb(before) + ", after " + kb(after) + " (" + pct + "% smaller)." };
  }
};

specs["grayscale-pdf"] = {
  accept: "pdf", multiple: false, action: "Convert to grayscale",
  intro: "Each page is converted to a black-and-white picture. Text can no longer be selected. Useful for saving colour ink when printing.",
  async run({ files, job }) {
    const f = files[0];
    const data = await rasterise(await f.bytes(), f.name, { dpi: 150, quality: 0.85, gray: true, job });
    return [{ name: baseName(f.name) + "-grayscale.pdf", data, mime: "application/pdf" }];
  }
};

/* ---------- compare two PDFs ---------- */
specs["compare-pdf"] = {
  accept: "pdf", multiple: true, min: 2, reorder: true, action: "Compare PDFs",
  intro: "Add exactly two PDFs. The first is the original and the second is the changed version. Only the text is compared.",
  async run({ files, job }) {
    if (files.length !== 2) throw new UserError("Add exactly two PDF files to compare.");
    const texts = [];
    for (let i = 0; i < 2; i++) {
      const pdf = await openPdfJs(await files[i].bytes(), files[i].name), lines = [];
      for (let p = 1; p <= pdf.numPages; p++) { for (const l of await pageLines(pdf, p)) if (l.trim()) lines.push(l.trim()); job.progress((i + p / pdf.numPages) * 40); if (p % 5 === 0) await job.tick(); }
      texts.push(lines);
    }
    const [a, b] = texts;
    if (a.length * b.length > 25e6) throw new UserError("These documents are too long to compare line by line in the browser.");
    const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const rows = []; let i = 0, j = 0, added = 0, removed = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { rows.push(["same", a[i]]); i++; j++; }
      else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) { rows.push(["add", b[j]]); j++; added++; }
      else { rows.push(["del", a[i]]); i++; removed++; }
    }
    job.progress(95);
    const box = h("div", { class: "tk-diff", role: "region", "aria-label": "Differences" });
    const shown = rows.filter((r, k) => r[0] !== "same" || rows.slice(Math.max(0, k - 1), k + 2).some(x => x[0] !== "same"));
    for (const [kind, text] of shown) box.append(h("div", { class: "tk-diff-" + kind }, h("span", { "aria-hidden": "true" }, kind === "add" ? "+" : kind === "del" ? "−" : " "), h("span", { class: "tk-sr" }, kind === "add" ? "Added: " : kind === "del" ? "Removed: " : "Unchanged: "), text));
    const report = rows.map(r => (r[0] === "add" ? "+ " : r[0] === "del" ? "- " : "  ") + r[1]).join("\n");
    return { outputs: [{ name: "comparison.txt", data: new Blob([report], { type: "text/plain;charset=utf-8" }), mime: "text/plain" }], view: added + removed ? box : h("p", { class: "tk-note" }, "No text differences found."), note: added + " lines added, " + removed + " lines removed." };
  }
};

export default specs;
void isPdf; void readBytes;
